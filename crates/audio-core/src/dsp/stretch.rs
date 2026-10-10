//! Time stretching (phase vocoder with identity phase locking), varispeed
//! and pitch shifting.

use crate::buffer::AudioBuffer;
use crate::dsp::resample::{resample_by_ratio, ResampleQuality};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum StretchMode {
    /// Tempo changes keep the pitch.
    #[default]
    Stretch,
    /// Tape-style: tempo changes also change the pitch.
    Varispeed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PitchTempoSettings {
    pub enabled: bool,
    pub semitones: f32,
    pub cents: f32,
    /// Percent (100 = unchanged).
    pub tempo: f32,
    pub mode: StretchMode,
}

impl Default for PitchTempoSettings {
    fn default() -> Self {
        Self { enabled: false, semitones: 0.0, cents: 0.0, tempo: 100.0, mode: StretchMode::Stretch }
    }
}

impl PitchTempoSettings {
    /// Pitch ratio from semitones + cents (excluding the varispeed tempo contribution).
    pub fn pitch_ratio(&self) -> f64 {
        2f64.powf((self.semitones as f64 + self.cents as f64 / 100.0) / 12.0)
    }

    /// Tempo ratio (1.0 = unchanged), clamped to a sane range.
    pub fn tempo_ratio(&self) -> f64 {
        let t = self.tempo as f64 / 100.0;
        if t.is_finite() && t > 0.0 {
            t.clamp(0.05, 20.0)
        } else {
            1.0
        }
    }
}

fn princarg(x: f64) -> f64 {
    x - 2.0 * PI * ((x + PI) / (2.0 * PI)).floor()
}

fn stretch_channel(input: &[f32], factor: f64, n: usize, out_len: usize, planner: &mut FftPlanner<f64>) -> Vec<f32> {
    let hs = n / 4;
    let ha = hs as f64 / factor;
    let half = n / 2;
    let bins = half + 1;
    let fwd = planner.plan_fft_forward(n);
    let inv = planner.plan_fft_inverse(n);
    // Periodic Hann.
    let window: Vec<f64> = (0..n).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).collect();
    // Input padded by n/2 in front: padded index p maps to input p - n/2.
    let sample = |p: isize| -> f64 {
        let i = p - half as isize;
        if i >= 0 && (i as usize) < input.len() {
            input[i as usize] as f64
        } else {
            0.0
        }
    };
    let padded_out = out_len + n;
    let frames = padded_out.div_ceil(hs) + 1;
    let mut out = vec![0.0f64; padded_out + n];
    let mut wsum = vec![0.0f64; padded_out + n];

    let mut prev_a_phase = vec![0.0f64; bins];
    let mut prev_s_phase = vec![0.0f64; bins];
    let mut prev_pos: isize = 0;
    let mut spec = vec![Complex::new(0.0, 0.0); n];
    let mut mag = vec![0.0f64; bins];
    let mut a_phase = vec![0.0f64; bins];
    let mut s_phase = vec![0.0f64; bins];
    let mut peaks: Vec<usize> = Vec::with_capacity(bins);

    for k in 0..frames {
        let pos = (k as f64 * ha).round() as isize;
        for (i, c) in spec.iter_mut().enumerate() {
            *c = Complex::new(sample(pos + i as isize) * window[i], 0.0);
        }
        fwd.process(&mut spec);
        for b in 0..bins {
            mag[b] = spec[b].norm();
            a_phase[b] = spec[b].arg();
        }
        if k == 0 {
            s_phase.copy_from_slice(&a_phase);
        } else {
            let hop_a = (pos - prev_pos) as f64;
            // Peak picking (local maxima over +-2 bins).
            peaks.clear();
            for b in 0..bins {
                let m = mag[b];
                if m <= 1e-12 {
                    continue;
                }
                let lo = b.saturating_sub(2);
                let hi = (b + 2).min(bins - 1);
                if (lo..=hi).all(|j| j == b || mag[j] < m || (j > b && mag[j] <= m)) {
                    peaks.push(b);
                }
            }
            let advance = |b: usize| -> f64 {
                let omega = 2.0 * PI * b as f64 / n as f64;
                let inst = if hop_a > 0.0 {
                    let delta = princarg(a_phase[b] - prev_a_phase[b] - omega * hop_a);
                    omega + delta / hop_a
                } else {
                    omega
                };
                prev_s_phase[b] + inst * hs as f64
            };
            if peaks.is_empty() {
                for (b, sp) in s_phase.iter_mut().enumerate() {
                    *sp = advance(b);
                }
            } else {
                for (pi, &p) in peaks.iter().enumerate() {
                    let start = if pi == 0 { 0 } else { (peaks[pi - 1] + p) / 2 + 1 };
                    let end = if pi + 1 == peaks.len() { bins - 1 } else { (p + peaks[pi + 1]) / 2 };
                    let sp = advance(p);
                    let rot = sp - a_phase[p];
                    for b in start..=end {
                        s_phase[b] = a_phase[b] + rot;
                    }
                }
            }
        }
        prev_a_phase.copy_from_slice(&a_phase);
        prev_s_phase.copy_from_slice(&s_phase);
        prev_pos = pos;

        for b in 0..bins {
            spec[b] = Complex::from_polar(mag[b], s_phase[b]);
        }
        spec[0] = Complex::new(spec[0].re, 0.0);
        spec[half] = Complex::new(spec[half].re, 0.0);
        for b in 1..half {
            spec[n - b] = spec[b].conj();
        }
        inv.process(&mut spec);
        let start = k * hs;
        let scale = 1.0 / n as f64;
        for i in 0..n {
            let idx = start + i;
            if idx >= out.len() {
                break;
            }
            out[idx] += spec[i].re * scale * window[i];
            wsum[idx] += window[i] * window[i];
        }
    }
    (0..out_len)
        .map(|j| {
            let idx = j + half;
            let w = wsum[idx];
            if w > 1e-6 {
                (out[idx] / w) as f32
            } else {
                0.0
            }
        })
        .collect()
}

/// Change duration by `factor` (output length = `round(len * factor)`)
/// while keeping the pitch, using a phase vocoder with identity phase locking.
pub fn time_stretch(buf: &AudioBuffer, factor: f64) -> AudioBuffer {
    if !factor.is_finite() || factor <= 0.0 || factor == 1.0 {
        return buf.clone();
    }
    let out_len = (buf.frames() as f64 * factor).round() as usize;
    if buf.is_empty() || out_len == 0 {
        return AudioBuffer { sample_rate: buf.sample_rate, channels: vec![vec![0.0; out_len]; buf.num_channels()] };
    }
    let n = if buf.sample_rate <= 24000 { 2048 } else { 4096 };
    let mut planner = FftPlanner::new();
    let channels = buf.channels.iter().map(|c| stretch_channel(c, factor, n, out_len, &mut planner)).collect();
    AudioBuffer { sample_rate: buf.sample_rate, channels }
}

/// Tape-style speed change: `ratio` 2.0 halves the length and raises the pitch one octave.
pub fn change_speed(buf: &AudioBuffer, ratio: f64) -> AudioBuffer {
    if !ratio.is_finite() || ratio <= 0.0 || ratio == 1.0 {
        return buf.clone();
    }
    resample_by_ratio(buf, 1.0 / ratio, ResampleQuality::Best)
}

/// Pitch / tempo processing. Output length = `round(len / (tempo / 100))`.
pub fn apply_pitch_tempo(buf: &AudioBuffer, s: &PitchTempoSettings) -> AudioBuffer {
    if !s.enabled {
        return buf.clone();
    }
    let p = s.pitch_ratio();
    let t = s.tempo_ratio();
    let p = if p.is_finite() && p > 0.0 { p.clamp(0.0625, 16.0) } else { 1.0 };
    let pitch_neutral = (p - 1.0).abs() < 1e-9;
    let tempo_neutral = (t - 1.0).abs() < 1e-9;
    if pitch_neutral && tempo_neutral {
        return buf.clone();
    }
    let target_len = (buf.frames() as f64 / t).round() as usize;
    let mut out = match s.mode {
        StretchMode::Stretch => {
            let stretched = time_stretch(buf, p / t);
            if pitch_neutral {
                stretched
            } else {
                change_speed(&stretched, p)
            }
        }
        StretchMode::Varispeed => {
            let sped = change_speed(buf, t);
            if pitch_neutral {
                sped
            } else {
                change_speed(&time_stretch(&sped, p), p)
            }
        }
    };
    for ch in &mut out.channels {
        ch.resize(target_len, 0.0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{dominant_frequency, tone_amplitude};
    use crate::signals::{sine, white_noise};

    fn mid(b: &AudioBuffer) -> AudioBuffer {
        b.slice(b.frames() / 8, b.frames() * 7 / 8)
    }

    fn assert_freq(b: &AudioBuffer, f: f64) {
        let d = dominant_frequency(&mid(b));
        assert!((d - f).abs() / f < 0.01, "expected {f} got {d}");
    }

    #[test]
    fn factor_one_is_identity() {
        let s = sine(440.0, 44100, 0.3, 0.5);
        assert_eq!(time_stretch(&s, 1.0), s);
        assert_eq!(change_speed(&s, 1.0), s);
        assert_eq!(time_stretch(&s, 0.0), s);
        assert_eq!(time_stretch(&s, f64::NAN), s);
        assert_eq!(change_speed(&s, -1.0), s);
        let e = AudioBuffer::new(44100, 2, 0);
        let r = time_stretch(&e, 2.0);
        assert_eq!((r.frames(), r.num_channels()), (0, 2));
    }

    #[test]
    fn time_stretch_keeps_pitch_and_amplitude() {
        let s = sine(440.0, 44100, 1.0, 0.5);
        for factor in [2.0, 0.5, 1.37, 0.8] {
            let r = time_stretch(&s, factor);
            assert_eq!(r.frames(), (44100.0 * factor).round() as usize);
            assert_freq(&r, 440.0);
            let a = tone_amplitude(&mid(&r), 440.0);
            assert!((a - 0.5).abs() < 0.05, "factor {factor}: amp {a}");
        }
    }

    #[test]
    fn time_stretch_output_is_aligned() {
        // An onset at 0.5 s must appear at 1.0 s after stretching by 2.
        let mut s = AudioBuffer::new(48000, 1, 48000);
        for (i, v) in s.channels[0].iter_mut().enumerate().skip(24000) {
            *v = 0.5 * (2.0 * PI * 1000.0 * i as f64 / 48000.0).sin() as f32;
        }
        let r = time_stretch(&s, 2.0);
        let thr = 0.1;
        let onset = r.channels[0].iter().position(|v| v.abs() > thr).unwrap();
        assert!((onset as isize - 48000).abs() < 2048, "onset at {onset}");
    }

    #[test]
    fn stretch_low_sample_rate_and_stereo() {
        let s = sine(300.0, 22050, 0.5, 0.4).with_channels(2);
        let r = time_stretch(&s, 1.5);
        assert_eq!(r.num_channels(), 2);
        assert_eq!(r.frames(), (11025.0f64 * 1.5).round() as usize);
        assert_freq(&r, 300.0);
        let n = white_noise(44100, 0.5, 0.5, 2);
        let r = time_stretch(&n, 0.7);
        assert!(r.channels[0].iter().all(|v| v.is_finite()));
        assert!(r.peak() < 2.0);
    }

    #[test]
    fn change_speed_is_tape_like() {
        let s = sine(500.0, 44100, 1.0, 0.5);
        let fast = change_speed(&s, 2.0);
        assert_eq!(fast.frames(), 22050);
        assert_freq(&fast, 1000.0);
        let slow = change_speed(&s, 0.5);
        assert_eq!(slow.frames(), 88200);
        assert_freq(&slow, 250.0);
    }

    fn settings(semi: f32, cents: f32, tempo: f32, mode: StretchMode) -> PitchTempoSettings {
        PitchTempoSettings { enabled: true, semitones: semi, cents, tempo, mode }
    }

    #[test]
    fn tempo_changes_length_not_pitch() {
        let s = sine(440.0, 44100, 1.0, 0.5);
        let slow = apply_pitch_tempo(&s, &settings(0.0, 0.0, 50.0, StretchMode::Stretch));
        assert_eq!(slow.frames(), 88200);
        assert_freq(&slow, 440.0);
        let fast = apply_pitch_tempo(&s, &settings(0.0, 0.0, 200.0, StretchMode::Stretch));
        assert_eq!(fast.frames(), 22050);
        assert_freq(&fast, 440.0);
    }

    #[test]
    fn pitch_shift_keeps_length() {
        let s = sine(440.0, 44100, 1.0, 0.5);
        let up = apply_pitch_tempo(&s, &settings(12.0, 0.0, 100.0, StretchMode::Stretch));
        assert_eq!(up.frames(), s.frames());
        assert_freq(&up, 880.0);
        let down = apply_pitch_tempo(&s, &settings(-7.0, 0.0, 100.0, StretchMode::Stretch));
        assert_eq!(down.frames(), s.frames());
        assert_freq(&down, 440.0 * 2f64.powf(-7.0 / 12.0));
        let cents = apply_pitch_tempo(&s, &settings(1.0, 50.0, 100.0, StretchMode::Stretch));
        assert_freq(&cents, 440.0 * 2f64.powf(1.5 / 12.0));
        // Pitch and tempo together.
        let both = apply_pitch_tempo(&s, &settings(12.0, 0.0, 150.0, StretchMode::Stretch));
        assert_eq!(both.frames(), (44100.0f64 / 1.5).round() as usize);
        assert_freq(&both, 880.0);
    }

    #[test]
    fn varispeed_changes_both() {
        let s = sine(440.0, 44100, 1.0, 0.5);
        let v = apply_pitch_tempo(&s, &settings(0.0, 0.0, 200.0, StretchMode::Varispeed));
        assert_eq!(v.frames(), 22050);
        assert_freq(&v, 880.0);
        let v2 = apply_pitch_tempo(&s, &settings(-12.0, 0.0, 200.0, StretchMode::Varispeed));
        assert_eq!(v2.frames(), 22050);
        assert_freq(&v2, 440.0);
    }

    #[test]
    fn disabled_or_neutral_is_clone() {
        let s = sine(440.0, 44100, 0.2, 0.5);
        let mut st = settings(12.0, 0.0, 50.0, StretchMode::Stretch);
        st.enabled = false;
        assert_eq!(apply_pitch_tempo(&s, &st), s);
        assert_eq!(apply_pitch_tempo(&s, &settings(0.0, 0.0, 100.0, StretchMode::Varispeed)), s);
        assert_eq!(apply_pitch_tempo(&s, &PitchTempoSettings::default()), s);
        // Bogus tempo is treated as neutral.
        assert_eq!(apply_pitch_tempo(&s, &settings(0.0, 0.0, 0.0, StretchMode::Stretch)), s);
    }

    #[test]
    fn serde_names_and_defaults() {
        let s: PitchTempoSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, PitchTempoSettings::default());
        assert_eq!(s.tempo, 100.0);
        let s: PitchTempoSettings =
            serde_json::from_str(r#"{"enabled":true,"semitones":-3,"cents":20,"tempo":80,"mode":"varispeed"}"#).unwrap();
        assert_eq!(s, settings(-3.0, 20.0, 80.0, StretchMode::Varispeed));
        assert_eq!(serde_json::to_string(&StretchMode::Stretch).unwrap(), "\"stretch\"");
        assert_eq!(serde_json::from_str::<PitchTempoSettings>(&serde_json::to_string(&s).unwrap()).unwrap(), s);
        assert!((s.pitch_ratio() - 2f64.powf(-2.8 / 12.0)).abs() < 1e-12);
        assert!((s.tempo_ratio() - 0.8).abs() < 1e-6);
    }
}
