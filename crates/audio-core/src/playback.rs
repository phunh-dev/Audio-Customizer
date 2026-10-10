//! Playback: a pure, device-independent transport state machine plus a cpal
//! based output that pulls samples from it.
//!
//! The transport works in frames of its current buffer. All seeks while
//! playing are click free: the output is faded out over ~5 ms, the cursor
//! jumps, then the output is faded back in over ~5 ms.

use crate::buffer::AudioBuffer;
use crate::dsp::resample::{resample, ResampleQuality};
use crate::error::{AudioError, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;

/// Length of the micro fades around a seek.
pub const SEEK_FADE_SECS: f64 = 0.005;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PlayState {
    Playing,
    Paused,
    #[default]
    Stopped,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransportState {
    pub state: PlayState,
    pub position: f64,
    pub duration: f64,
    pub session_id: Option<String>,
    #[serde(rename = "loop")]
    pub loop_enabled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Ramp {
    None,
    /// Fading out; `remaining` frames left, then jump to `target`.
    Out { remaining: usize, target: usize },
    /// Fading in; `remaining` frames left.
    In { remaining: usize },
}

#[derive(Debug)]
pub struct Transport {
    buffer: Option<Arc<AudioBuffer>>,
    session_id: Option<String>,
    pos: usize,
    state: PlayState,
    looping: bool,
    ramp: Ramp,
    /// Last requested seek (seconds, unclamped) not yet consumed by `play`.
    /// A seek issued before a session's buffer is installed (first play of a
    /// tab, or switching tabs) would otherwise be lost: `set_buffer` for a new
    /// session starts from this position instead of 0.
    pending_seek: Option<f64>,
}

impl Default for Transport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport {
    pub fn new() -> Self {
        Self {
            buffer: None,
            session_id: None,
            pos: 0,
            state: PlayState::Stopped,
            looping: false,
            ramp: Ramp::None,
            pending_seek: None,
        }
    }

    fn frames(&self) -> usize {
        self.buffer.as_ref().map_or(0, |b| b.frames())
    }

    fn rate(&self) -> u32 {
        self.buffer.as_ref().map_or(0, |b| b.sample_rate)
    }

    fn fade_len(&self) -> usize {
        ((self.rate() as f64 * SEEK_FADE_SECS).round() as usize).max(1)
    }

    pub fn buffer(&self) -> Option<&Arc<AudioBuffer>> {
        self.buffer.as_ref()
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    pub fn play_state(&self) -> PlayState {
        self.state
    }

    pub fn is_looping(&self) -> bool {
        self.looping
    }

    /// Logical cursor in frames (the seek target while a seek fade runs).
    pub fn position_frames(&self) -> usize {
        match self.ramp {
            Ramp::Out { target, .. } => target,
            _ => self.pos,
        }
    }

    pub fn position(&self) -> f64 {
        let r = self.rate();
        if r == 0 {
            0.0
        } else {
            self.position_frames() as f64 / r as f64
        }
    }

    pub fn duration(&self) -> f64 {
        self.buffer.as_ref().map_or(0.0, |b| b.duration_secs())
    }

    pub fn state(&self) -> TransportState {
        TransportState {
            state: self.state,
            position: self.position(),
            duration: self.duration(),
            session_id: self.session_id.clone(),
            loop_enabled: self.looping,
        }
    }

    /// Replace the buffer (new render or different session). The position in
    /// seconds is kept (clamped to the new length) when the session is the
    /// same; a different session starts from the pending seek (if any, see
    /// `pending_seek`) or 0, paused or stopped.
    pub fn set_buffer(&mut self, buffer: Arc<AudioBuffer>, session_id: Option<String>) {
        let same_session = self.session_id == session_id;
        let secs = self.position();
        let pending = self.pending_seek.take();
        self.buffer = Some(buffer);
        if same_session {
            let frames = self.frames();
            let p = crate::buffer::secs_to_frames(secs, self.rate()).min(frames);
            self.pos = p;
            if self.state == PlayState::Playing {
                self.ramp = Ramp::In { remaining: self.fade_len() };
            } else {
                self.ramp = Ramp::None;
            }
        } else {
            self.session_id = session_id;
            self.pos = 0;
            self.ramp = Ramp::None;
            self.state = PlayState::Stopped;
            if let Some(s) = pending {
                self.seek(s);
            }
        }
    }

    /// Drop the buffer (session released).
    pub fn clear(&mut self) {
        self.buffer = None;
        self.session_id = None;
        self.pos = 0;
        self.state = PlayState::Stopped;
        self.ramp = Ramp::None;
        self.pending_seek = None;
    }

    pub fn play(&mut self) {
        self.pending_seek = None;
        let frames = self.frames();
        if frames == 0 {
            return;
        }
        if self.state == PlayState::Playing {
            return;
        }
        if self.pos >= frames {
            self.pos = 0;
        }
        self.state = PlayState::Playing;
        self.ramp = Ramp::In { remaining: self.fade_len() };
    }

    pub fn pause(&mut self) {
        if self.state == PlayState::Playing {
            self.finish_ramp();
            self.state = PlayState::Paused;
        }
    }

    pub fn stop(&mut self) {
        self.state = PlayState::Stopped;
        self.pos = 0;
        self.ramp = Ramp::None;
        self.pending_seek = None;
    }

    pub fn set_loop(&mut self, enabled: bool) {
        self.looping = enabled;
    }

    fn finish_ramp(&mut self) {
        if let Ramp::Out { target, .. } = self.ramp {
            self.pos = target;
        }
        self.ramp = Ramp::None;
    }

    /// Move the cursor to `seconds` (clamped to `[0, duration]`). While
    /// playing, the jump happens after a short fade-out and is followed by a
    /// fade-in; otherwise it is immediate.
    pub fn seek(&mut self, seconds: f64) {
        let frames = self.frames();
        let secs = if seconds.is_finite() { seconds.max(0.0) } else { 0.0 };
        self.pending_seek = Some(secs);
        let target = crate::buffer::secs_to_frames(secs, self.rate()).min(frames);
        self.seek_frames(target);
    }

    pub fn seek_frames(&mut self, target: usize) {
        let target = target.min(self.frames());
        if self.state == PlayState::Playing {
            let len = self.fade_len();
            let remaining = match self.ramp {
                // Already fading out: keep the current fade, just retarget.
                Ramp::Out { remaining, .. } => remaining,
                // Fading in: start fading out from the current gain level.
                Ramp::In { remaining } => len - remaining.min(len),
                Ramp::None => len,
            };
            if remaining == 0 {
                self.pos = target;
                self.ramp = Ramp::In { remaining: len };
            } else {
                self.ramp = Ramp::Out { remaining, target };
            }
        } else {
            self.ramp = Ramp::None;
            self.pos = target;
            if self.state == PlayState::Stopped && target > 0 {
                self.state = PlayState::Paused;
            }
        }
    }

    /// Relative seek by `delta` seconds (step buttons).
    pub fn step(&mut self, delta: f64) {
        let p = self.position() + delta;
        self.seek(p);
    }

    /// Relative seek by a number of frames (1-sample steps).
    pub fn step_frames(&mut self, delta: i64) {
        let p = self.position_frames() as i64 + delta;
        self.seek_frames(p.max(0) as usize);
    }

    /// Fill an interleaved output block of `channels` channels. Silence when
    /// not playing. Mono buffers go to every output channel; a stereo buffer
    /// on a mono device is averaged.
    pub fn fill(&mut self, out: &mut [f32], channels: usize) {
        let channels = channels.max(1);
        out.iter_mut().for_each(|s| *s = 0.0);
        if self.state != PlayState::Playing {
            return;
        }
        let Some(buf) = self.buffer.clone() else { return };
        let frames = buf.frames();
        let len = self.fade_len();
        let src_ch = buf.num_channels();
        for frame in out.chunks_exact_mut(channels) {
            if self.pos >= frames {
                if self.looping && frames > 0 {
                    self.pos = 0;
                } else {
                    self.pos = frames;
                    self.state = PlayState::Paused;
                    self.ramp = Ramp::None;
                    return;
                }
            }
            let gain = match self.ramp {
                Ramp::None => 1.0,
                Ramp::Out { remaining, .. } => remaining as f32 / len as f32,
                Ramp::In { remaining } => 1.0 - remaining as f32 / len as f32,
            };
            let i = self.pos;
            for (c, o) in frame.iter_mut().enumerate() {
                let v = if src_ch == 1 {
                    buf.channels[0][i]
                } else if channels == 1 {
                    buf.channels.iter().map(|ch| ch[i]).sum::<f32>() / src_ch as f32
                } else if c < src_ch {
                    buf.channels[c][i]
                } else {
                    0.0
                };
                *o = v * gain;
            }
            self.pos += 1;
            self.ramp = match self.ramp {
                Ramp::None => Ramp::None,
                Ramp::Out { remaining, target } => {
                    if remaining <= 1 {
                        self.pos = target;
                        Ramp::In { remaining: len }
                    } else {
                        Ramp::Out { remaining: remaining - 1, target }
                    }
                }
                Ramp::In { remaining } => {
                    if remaining <= 1 {
                        Ramp::None
                    } else {
                        Ramp::In { remaining: remaining - 1 }
                    }
                }
            };
        }
    }
}

/// Something that renders a shared transport to an audio device.
pub trait OutputHandle: Send {
    fn sample_rate(&self) -> u32;
    fn channels(&self) -> usize;
}

/// Resample a buffer for an output running at `device_rate`.
pub fn prepare_for_device(buf: &AudioBuffer, device_rate: u32) -> AudioBuffer {
    if buf.sample_rate == device_rate || device_rate == 0 {
        return buf.clone();
    }
    resample(buf, device_rate, ResampleQuality::Balanced)
}

/// cpal output stream owned by a dedicated thread (the stream itself may not
/// be `Send`). Dropping the value stops the stream.
pub struct AudioOutput {
    sample_rate: u32,
    channels: usize,
    shutdown: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl AudioOutput {
    pub fn open(transport: Arc<Mutex<Transport>>) -> Result<Self> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(u32, usize)>>();
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();
        let thread = std::thread::Builder::new()
            .name("audio-output".into())
            .spawn(move || {
                let stream = match build_stream(transport) {
                    Ok((stream, rate, ch)) => {
                        let _ = ready_tx.send(Ok((rate, ch)));
                        stream
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                // Park until asked to stop (or the sender is dropped).
                let _ = shutdown_rx.recv();
                drop(stream);
            })
            .map_err(|e| AudioError::NoAudioDevice(e.to_string()))?;
        match ready_rx.recv() {
            Ok(Ok((sample_rate, channels))) => {
                Ok(Self { sample_rate, channels, shutdown: Some(shutdown_tx), thread: Some(thread) })
            }
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                let _ = thread.join();
                Err(AudioError::NoAudioDevice("audio thread terminated".into()))
            }
        }
    }
}

impl OutputHandle for AudioOutput {
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    fn channels(&self) -> usize {
        self.channels
    }
}

impl Drop for AudioOutput {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn build_stream(transport: Arc<Mutex<Transport>>) -> Result<(cpal::Stream, u32, usize)> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| AudioError::NoAudioDevice("no default output device".into()))?;
    let supported = device.default_output_config().map_err(|e| AudioError::NoAudioDevice(e.to_string()))?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let rate = config.sample_rate.0;
    let channels = config.channels as usize;
    let stream = match format {
        cpal::SampleFormat::F32 => make_stream::<f32>(&device, &config, transport),
        cpal::SampleFormat::F64 => make_stream::<f64>(&device, &config, transport),
        cpal::SampleFormat::I16 => make_stream::<i16>(&device, &config, transport),
        cpal::SampleFormat::U16 => make_stream::<u16>(&device, &config, transport),
        cpal::SampleFormat::I32 => make_stream::<i32>(&device, &config, transport),
        cpal::SampleFormat::U8 => make_stream::<u8>(&device, &config, transport),
        cpal::SampleFormat::I8 => make_stream::<i8>(&device, &config, transport),
        other => Err(AudioError::NoAudioDevice(format!("unsupported sample format {other:?}"))),
    }?;
    stream.play().map_err(|e| AudioError::NoAudioDevice(e.to_string()))?;
    Ok((stream, rate, channels))
}

fn make_stream<T>(device: &cpal::Device, config: &cpal::StreamConfig, transport: Arc<Mutex<Transport>>) -> Result<cpal::Stream>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    use cpal::traits::DeviceTrait;
    let channels = config.channels as usize;
    let mut scratch: Vec<f32> = Vec::new();
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                scratch.resize(data.len(), 0.0);
                transport.lock().fill(&mut scratch, channels);
                for (d, s) in data.iter_mut().zip(&scratch) {
                    *d = T::from_sample(*s);
                }
            },
            |_err| {},
            None,
        )
        .map_err(|e| AudioError::NoAudioDevice(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp_buf(rate: u32, frames: usize) -> Arc<AudioBuffer> {
        Arc::new(AudioBuffer::mono(rate, vec![1.0; frames]))
    }

    fn transport_with(rate: u32, frames: usize) -> Transport {
        let mut t = Transport::new();
        t.set_buffer(ramp_buf(rate, frames), Some("s".into()));
        t
    }

    #[test]
    fn initial_state_is_stopped_and_empty() {
        let t = Transport::new();
        let s = t.state();
        assert_eq!(s.state, PlayState::Stopped);
        assert_eq!(s.position, 0.0);
        assert_eq!(s.duration, 0.0);
        assert_eq!(s.session_id, None);
        assert!(!s.loop_enabled);
    }

    #[test]
    fn play_without_buffer_is_noop() {
        let mut t = Transport::new();
        t.play();
        assert_eq!(t.play_state(), PlayState::Stopped);
        let mut out = [1.0f32; 8];
        t.fill(&mut out, 2);
        assert!(out.iter().all(|s| *s == 0.0));
    }

    #[test]
    fn state_json_is_camel_case_with_loop() {
        let t = transport_with(1000, 1000);
        let json = serde_json::to_value(t.state()).unwrap();
        assert_eq!(json["state"], "stopped");
        assert_eq!(json["sessionId"], "s");
        assert_eq!(json["loop"], false);
        assert_eq!(json["duration"], 1.0);
    }

    #[test]
    fn play_pause_stop_state_machine() {
        let mut t = transport_with(1000, 1000);
        t.play();
        assert_eq!(t.play_state(), PlayState::Playing);
        let mut out = vec![0.0; 100];
        t.fill(&mut out, 1);
        assert_eq!(t.position_frames(), 100);
        t.pause();
        assert_eq!(t.play_state(), PlayState::Paused);
        t.fill(&mut out, 1);
        assert!(out.iter().all(|s| *s == 0.0), "paused outputs silence");
        assert_eq!(t.position_frames(), 100, "pause keeps position");
        t.play();
        t.fill(&mut out, 1);
        assert_eq!(t.position_frames(), 200, "resume continues");
        t.stop();
        assert_eq!(t.play_state(), PlayState::Stopped);
        assert_eq!(t.position_frames(), 0);
        t.pause();
        assert_eq!(t.play_state(), PlayState::Stopped, "pause when stopped is a no-op");
    }

    #[test]
    fn play_twice_does_not_restart_fade() {
        let mut t = transport_with(1000, 1000);
        t.play();
        let mut out = vec![0.0; 50];
        t.fill(&mut out, 1);
        t.play();
        t.fill(&mut out, 1);
        assert!(out.iter().all(|s| (*s - 1.0).abs() < 1e-6));
    }

    #[test]
    fn seek_while_paused_moves_cursor_and_play_continues_from_there() {
        let mut t = transport_with(1000, 1000);
        t.seek(0.25);
        assert_eq!(t.position_frames(), 250);
        assert_eq!(t.play_state(), PlayState::Paused);
        t.play();
        let mut out = vec![0.0; 10];
        t.fill(&mut out, 1);
        assert_eq!(t.position_frames(), 260);
    }

    #[test]
    fn seek_to_zero_when_stopped_stays_stopped() {
        let mut t = transport_with(1000, 1000);
        t.seek(0.0);
        assert_eq!(t.play_state(), PlayState::Stopped);
    }

    #[test]
    fn seek_is_clamped() {
        let mut t = transport_with(1000, 1000);
        t.seek(-5.0);
        assert_eq!(t.position_frames(), 0);
        t.seek(99.0);
        assert_eq!(t.position_frames(), 1000);
        t.seek(f64::NAN);
        assert_eq!(t.position_frames(), 0);
    }

    #[test]
    fn step_by_units_and_clamp() {
        let mut t = transport_with(1000, 1000);
        t.step(0.1);
        assert_eq!(t.position_frames(), 100);
        t.step(0.001);
        assert_eq!(t.position_frames(), 101);
        t.step_frames(1);
        assert_eq!(t.position_frames(), 102);
        t.step_frames(-1);
        assert_eq!(t.position_frames(), 101);
        t.step(-10.0);
        assert_eq!(t.position_frames(), 0);
        t.step_frames(-5);
        assert_eq!(t.position_frames(), 0);
        t.step(10.0);
        assert_eq!(t.position_frames(), 1000);
        t.step_frames(5);
        assert_eq!(t.position_frames(), 1000);
    }

    #[test]
    fn seek_while_playing_reports_target_and_continues_playing_there() {
        let mut t = transport_with(1000, 1000);
        t.play();
        let mut out = vec![0.0; 100];
        t.fill(&mut out, 1);
        t.seek(0.5);
        assert_eq!(t.position_frames(), 500, "UI sees the target immediately");
        assert_eq!(t.play_state(), PlayState::Playing);
        t.fill(&mut out, 1);
        // fade-out (5 frames at 1 kHz) then continue from 500.
        assert_eq!(t.position_frames(), 500 + 100 - 5);
        assert_eq!(t.play_state(), PlayState::Playing);
    }

    #[test]
    fn seek_while_playing_is_click_free() {
        // Sine whose phase jumps at the seek point: the micro-fade must keep
        // sample-to-sample steps small.
        let rate = 48_000;
        let sine = crate::signals::sine(440.0, rate, 2.0, 0.9);
        let mut t = Transport::new();
        t.set_buffer(Arc::new(sine), Some("a".into()));
        t.play();
        let mut out = vec![0.0; 4800];
        t.fill(&mut out, 1);
        let mut all = out.clone();
        t.seek(1.23457);
        t.fill(&mut out, 1);
        all.extend_from_slice(&out);
        // Max step of the unfaded sine is 2*pi*440/48000*0.9 ~= 0.052.
        let max_step = all.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(max_step < 0.08, "max step {max_step}");
        // Contrast: an instant jump would produce a large discontinuity.
        let a = crate::signals::sine(440.0, rate, 2.0, 0.9);
        let jump = (a.channels[0][59_259] - a.channels[0][4800]).abs();
        assert!(jump > 0.1, "test signal must contain a real discontinuity, got {jump}");
    }

    #[test]
    fn seek_during_fade_out_retargets() {
        let mut t = transport_with(1000, 1000);
        t.play();
        let mut out = vec![0.0; 50];
        t.fill(&mut out, 1);
        t.seek(0.5);
        let mut two = vec![0.0; 2];
        t.fill(&mut two, 1);
        t.seek(0.8);
        assert_eq!(t.position_frames(), 800);
        let mut rest = vec![0.0; 3];
        t.fill(&mut rest, 1);
        assert_eq!(t.position_frames(), 800);
        // Pausing mid fade lands on the target.
        t.seek(0.1);
        t.pause();
        assert_eq!(t.position_frames(), 100);
    }

    #[test]
    fn seek_during_fade_in_starts_from_current_gain() {
        let mut t = transport_with(1000, 1000);
        t.play();
        // still at the very beginning of the fade-in (gain 0): seeking jumps
        // straight to the target and fades in again.
        t.seek(0.3);
        assert_eq!(t.position_frames(), 300);
        let mut out = vec![0.0; 1];
        t.fill(&mut out, 1);
        assert_eq!(t.position_frames(), 301);
        assert_eq!(out[0], 0.0);
    }

    #[test]
    fn fade_in_on_play_starts_from_silence() {
        let mut t = transport_with(1000, 1000);
        t.play();
        let mut out = vec![0.0; 10];
        t.fill(&mut out, 1);
        assert_eq!(out[0], 0.0);
        assert!(out[1] > 0.0 && out[1] < 1.0);
        assert!((out[9] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn end_pauses_at_end_and_play_restarts_from_zero() {
        let mut t = transport_with(1000, 100);
        t.play();
        let mut out = vec![0.0; 150];
        t.fill(&mut out, 1);
        assert_eq!(t.play_state(), PlayState::Paused);
        assert_eq!(t.position_frames(), 100);
        assert!(out[100..].iter().all(|s| *s == 0.0));
        assert!(out[50] > 0.9);
        t.play();
        assert_eq!(t.position_frames(), 0);
        assert_eq!(t.play_state(), PlayState::Playing);
    }

    #[test]
    fn loop_wraps_around() {
        let mut t = Transport::new();
        t.set_buffer(Arc::new(AudioBuffer::mono(1000, (0..100).map(|i| i as f32).collect())), None);
        t.set_loop(true);
        assert!(t.is_looping());
        t.seek(0.09);
        t.play();
        let mut out = vec![0.0; 30];
        t.fill(&mut out, 1);
        assert_eq!(t.play_state(), PlayState::Playing);
        assert_eq!(t.position_frames(), 20);
        // after the fade-in, values continue 99 -> 0 -> 1 ...
        assert_eq!(out[9], 99.0);
        assert_eq!(out[10], 0.0);
        assert_eq!(out[11], 1.0);
    }

    #[test]
    fn mono_goes_to_all_channels_and_stereo_maps() {
        let mut t = Transport::new();
        t.set_buffer(Arc::new(AudioBuffer::mono(1000, vec![0.5; 100])), None);
        t.play();
        let mut out = vec![0.0; 40];
        t.fill(&mut out, 2);
        assert_eq!(out[38], 0.5);
        assert_eq!(out[39], 0.5);

        let st = AudioBuffer::from_channels(1000, vec![vec![1.0; 100], vec![-0.5; 100]]);
        t.set_buffer(Arc::new(st), Some("x".into()));
        t.play();
        let mut out = vec![0.0; 60];
        t.fill(&mut out, 3);
        let last = &out[57..];
        assert_eq!(last, &[1.0, -0.5, 0.0]);
        let mut mono = vec![0.0; 20];
        t.fill(&mut mono, 1);
        assert_eq!(mono[19], 0.25);
    }

    #[test]
    fn set_buffer_same_session_keeps_position_new_session_resets() {
        let mut t = transport_with(1000, 1000);
        t.seek(0.4);
        t.set_buffer(ramp_buf(2000, 4000), Some("s".into()));
        assert_eq!(t.position_frames(), 800);
        assert!((t.position() - 0.4).abs() < 1e-9);
        t.set_buffer(ramp_buf(1000, 100), Some("s".into()));
        assert_eq!(t.position_frames(), 100, "clamped to shorter buffer");
        t.play();
        t.set_buffer(ramp_buf(1000, 1000), Some("other".into()));
        assert_eq!(t.position_frames(), 0);
        assert_eq!(t.play_state(), PlayState::Stopped);
        assert_eq!(t.session_id(), Some("other"));
    }

    #[test]
    fn set_buffer_while_playing_keeps_playing_with_fade_in() {
        let mut t = transport_with(1000, 1000);
        t.play();
        let mut out = vec![0.0; 100];
        t.fill(&mut out, 1);
        t.set_buffer(ramp_buf(1000, 1000), Some("s".into()));
        assert_eq!(t.play_state(), PlayState::Playing);
        let mut out = vec![0.0; 2];
        t.fill(&mut out, 1);
        assert_eq!(out[0], 0.0);
        assert_eq!(t.position_frames(), 102);
    }

    #[test]
    fn seek_before_buffer_applies_to_new_session() {
        // first play of a tab: the UI seeks, then the engine installs the buffer
        let mut t = Transport::new();
        t.seek(0.5);
        assert_eq!(t.position(), 0.0);
        t.set_buffer(ramp_buf(1000, 1000), Some("a".into()));
        assert_eq!(t.position_frames(), 500);
        assert_eq!(t.play_state(), PlayState::Paused);
        t.play();
        assert_eq!(t.position_frames(), 500);
        assert_eq!(t.play_state(), PlayState::Playing);
    }

    #[test]
    fn seek_while_other_session_loaded_applies_to_new_session() {
        let mut t = transport_with(1000, 1000);
        t.play();
        t.seek(0.25); // fade-out on the old session, retargeted for the new one
        t.set_buffer(ramp_buf(1000, 2000), Some("b".into()));
        assert_eq!(t.position_frames(), 250);
        assert_eq!(t.session_id(), Some("b"));
    }

    #[test]
    fn consumed_or_stale_seek_does_not_leak_into_new_session() {
        let mut t = transport_with(1000, 1000);
        t.seek(0.5);
        t.play(); // consumes the pending seek
        t.set_buffer(ramp_buf(1000, 1000), Some("other".into()));
        assert_eq!(t.position_frames(), 0);
        assert_eq!(t.play_state(), PlayState::Stopped);

        let mut t = Transport::new();
        t.seek(0.5);
        t.stop();
        t.set_buffer(ramp_buf(1000, 1000), Some("a".into()));
        assert_eq!(t.position_frames(), 0);
    }

    #[test]
    fn clear_drops_buffer() {
        let mut t = transport_with(1000, 1000);
        t.play();
        t.clear();
        assert!(t.buffer().is_none());
        assert_eq!(t.state(), TransportState::default());
    }

    #[test]
    fn prepare_for_device_resamples_only_when_needed() {
        let b = crate::signals::sine(1000.0, 44_100, 0.1, 0.5);
        assert_eq!(prepare_for_device(&b, 44_100), b);
        let r = prepare_for_device(&b, 48_000);
        assert_eq!(r.sample_rate, 48_000);
        assert!((r.frames() as i64 - 4800).abs() <= 1);
    }

    #[test]
    fn audio_output_opens_or_reports_no_device() {
        // Never panics: either a device exists or we get the right code.
        let t = Arc::new(Mutex::new(Transport::new()));
        match AudioOutput::open(t) {
            Ok(o) => {
                assert!(o.sample_rate() > 0);
                assert!(o.channels() > 0);
            }
            Err(e) => assert_eq!(e.code(), "ERR_NO_AUDIO_DEVICE"),
        }
    }
}
