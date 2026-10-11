//! Noise reduction: spectral gate (general purpose) and RNNoise (speech).

use crate::buffer::AudioBuffer;
use crate::dsp::resample::{resample, ResampleQuality};
use nnnoiseless::DenoiseState;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;
use std::sync::Arc;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum DenoiseMode {
    #[default]
    Spectral,
    Rnnoise,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DenoiseSettings {
    pub enabled: bool,
    pub mode: DenoiseMode,
    /// Attenuation applied to noise bins (spectral) / wet amount (rnnoise: 24 dB = fully wet).
    pub reduction_db: f32,
    /// How far above the noise profile a bin must be to pass.
    pub sensitivity_db: f32,
    /// 0..1, frequency smoothing of the gain mask.
    pub smoothing: f32,
    pub attack_ms: f32,
    pub release_ms: f32,
    /// Seconds.
    pub profile_start: Option<f64>,
    /// Seconds.
    pub profile_end: Option<f64>,
}

impl Default for DenoiseSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: DenoiseMode::Spectral,
            reduction_db: 12.0,
            sensitivity_db: 6.0,
            smoothing: 0.5,
            attack_ms: 5.0,
            release_ms: 50.0,
            profile_start: None,
            profile_end: None,
        }
    }
}

/// Denoise; the output always has the same length and channel count.
pub fn apply_denoise(buf: &AudioBuffer, s: &DenoiseSettings) -> AudioBuffer {
    if !s.enabled || buf.is_empty() {
        return buf.clone();
    }
    match s.mode {
        DenoiseMode::Spectral => spectral_gate(buf, s),
        DenoiseMode::Rnnoise => rnnoise(buf, s),
    }
}

// ---------------------------------------------------------------- spectral

const FFT_SIZE: usize = 2048;
const HOP: usize = 512;

struct Stft {
    n: usize,
    hop: usize,
    /// sqrt-Hann (periodic); analysis * synthesis = Hann.
    window: Vec<f64>,
    fwd: Arc<dyn Fft<f64>>,
    inv: Arc<dyn Fft<f64>>,
}

impl Stft {
    fn new(n: usize, hop: usize) -> Self {
        let window = (0..n).map(|i| (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).sqrt()).collect();
        let mut planner = FftPlanner::new();
        Self { n, hop, window, fwd: planner.plan_fft_forward(n), inv: planner.plan_fft_inverse(n) }
    }

    /// Number of frames so that every input sample is covered by full overlap
    /// (input is virtually padded by n/2 zeros in front).
    fn frame_count(&self, len: usize) -> usize {
        (len + self.n).div_ceil(self.hop) + 1
    }

    /// Windowed spectrum of frame `k` (frame centre at input sample `k * hop`).
    fn analyse(&self, x: &[f32], k: usize, out: &mut [Complex<f64>]) {
        let start = (k * self.hop) as isize - (self.n / 2) as isize;
        for (i, c) in out.iter_mut().enumerate() {
            let idx = start + i as isize;
            let v = if idx >= 0 && (idx as usize) < x.len() { x[idx as usize] as f64 } else { 0.0 };
            *c = Complex::new(v * self.window[i], 0.0);
        }
        self.fwd.process(out);
    }

    fn frame_center(&self, k: usize) -> usize {
        k * self.hop
    }
}

fn frame_energy(x: &[f32], stft: &Stft, k: usize) -> f64 {
    let start = (k * stft.hop) as isize - (stft.n / 2) as isize;
    (0..stft.n)
        .map(|i| {
            let idx = start + i as isize;
            let v = if idx >= 0 && (idx as usize) < x.len() { x[idx as usize] as f64 } else { 0.0 };
            (v * stft.window[i]).powi(2)
        })
        .sum()
}

/// Mean magnitude per bin over the profile frames.
fn noise_profile(x: &[f32], stft: &Stft, s: &DenoiseSettings, sr: f64) -> Vec<f64> {
    let bins = stft.n / 2 + 1;
    let frames = stft.frame_count(x.len());
    // Frames whose centre lies inside the signal.
    let inside: Vec<usize> = (0..frames).filter(|k| stft.frame_center(*k) < x.len()).collect();
    let mut chosen: Vec<usize> = Vec::new();
    if let (Some(ps), Some(pe)) = (s.profile_start, s.profile_end) {
        if ps.is_finite() && pe.is_finite() && pe > ps {
            let a = (ps.max(0.0) * sr).round() as usize;
            let b = (pe.max(0.0) * sr).round() as usize;
            chosen = inside.iter().copied().filter(|k| (a..=b).contains(&stft.frame_center(*k))).collect();
            if chosen.is_empty() && a < x.len() {
                let mid = (a + b.min(x.len())) / 2;
                chosen.push(((mid + stft.hop / 2) / stft.hop).min(frames - 1));
            }
        }
    }
    if chosen.is_empty() {
        // Quietest 10 % of frames.
        let mut e: Vec<(f64, usize)> = inside.iter().map(|k| (frame_energy(x, stft, *k), *k)).collect();
        e.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let count = (e.len() as f64 * 0.1).ceil().max(1.0) as usize;
        chosen = e.iter().take(count).map(|(_, k)| *k).collect();
    }
    let mut acc = vec![0.0f64; bins];
    let mut buf = vec![Complex::new(0.0, 0.0); stft.n];
    for k in &chosen {
        stft.analyse(x, *k, &mut buf);
        for (a, c) in acc.iter_mut().zip(&buf[..bins]) {
            *a += c.norm();
        }
    }
    let n = chosen.len().max(1) as f64;
    acc.iter_mut().for_each(|a| *a /= n);
    acc
}

fn time_coef(ms: f32, hop: usize, sr: f64) -> f64 {
    let samples = ms.max(0.0) as f64 * sr / 1000.0;
    if samples <= 0.0 {
        0.0
    } else {
        (-(hop as f64) / samples).exp()
    }
}

/// Process one channel with a per-bin gain computed by `gain_fn(frame, magnitudes, mask_out)`.
fn stft_process(x: &[f32], stft: &Stft, mut gain_fn: impl FnMut(usize, &[f64], &mut [f64])) -> Vec<f32> {
    let n = stft.n;
    let half = n / 2;
    let bins = half + 1;
    let frames = stft.frame_count(x.len());
    let mut out = vec![0.0f64; x.len()];
    let mut norm = vec![0.0f64; x.len()];
    let mut spec = vec![Complex::new(0.0, 0.0); n];
    let mut mags = vec![0.0f64; bins];
    let mut mask = vec![1.0f64; bins];
    for k in 0..frames {
        stft.analyse(x, k, &mut spec);
        for (m, c) in mags.iter_mut().zip(&spec[..bins]) {
            *m = c.norm();
        }
        gain_fn(k, &mags, &mut mask);
        for b in 0..bins {
            spec[b] *= mask[b];
        }
        for b in 1..half {
            spec[n - b] = spec[b].conj();
        }
        stft.inv.process(&mut spec);
        let start = (k * stft.hop) as isize - half as isize;
        for (i, (c, w)) in spec.iter().zip(&stft.window).enumerate() {
            let idx = start + i as isize;
            if idx < 0 || idx as usize >= x.len() {
                continue;
            }
            let w = *w;
            out[idx as usize] += c.re / n as f64 * w;
            norm[idx as usize] += w * w;
        }
    }
    out.iter().zip(&norm).map(|(o, w)| if *w > 1e-9 { (o / w) as f32 } else { 0.0 }).collect()
}

fn spectral_gate(buf: &AudioBuffer, s: &DenoiseSettings) -> AudioBuffer {
    let sr = buf.sample_rate.max(1) as f64;
    let stft = Stft::new(FFT_SIZE, HOP);
    let bins = FFT_SIZE / 2 + 1;
    let floor = 10f64.powf(-(s.reduction_db.max(0.0) as f64) / 20.0);
    let sens = 10f64.powf(s.sensitivity_db as f64 / 20.0);
    let radius = (s.smoothing.clamp(0.0, 1.0) * 8.0).round() as usize;
    let attack = time_coef(s.attack_ms, HOP, sr);
    let release = time_coef(s.release_ms, HOP, sr);
    let channels = buf
        .channels
        .iter()
        .map(|x| {
            let profile = noise_profile(x, &stft, s, sr);
            let thr: Vec<f64> = profile.iter().map(|p| p * sens).collect();
            let mut target = vec![1.0f64; bins];
            let mut smooth = vec![1.0f64; bins];
            let mut state = vec![1.0f64; bins];
            let mut first = true;
            stft_process(x, &stft, |_, mags, mask| {
                for ((t, m), th) in target.iter_mut().zip(mags).zip(&thr) {
                    *t = if *m > *th { 1.0 } else { floor };
                }
                if radius > 0 {
                    for (b, sm) in smooth.iter_mut().enumerate() {
                        let lo = b.saturating_sub(radius);
                        let hi = (b + radius).min(bins - 1);
                        *sm = target[lo..=hi].iter().sum::<f64>() / (hi - lo + 1) as f64;
                    }
                } else {
                    smooth.copy_from_slice(&target);
                }
                for b in 0..bins {
                    if first {
                        state[b] = smooth[b];
                    } else {
                        let c = if smooth[b] > state[b] { attack } else { release };
                        state[b] = smooth[b] + (state[b] - smooth[b]) * c;
                    }
                    mask[b] = state[b];
                }
                first = false;
            })
        })
        .collect();
    AudioBuffer { sample_rate: buf.sample_rate, channels }
}

// ---------------------------------------------------------------- rnnoise

const RNN_RATE: u32 = 48000;
const RNN_FRAME: usize = DenoiseState::FRAME_SIZE;

fn rnnoise_channel(x: &[f32]) -> Vec<f32> {
    let mut state = DenoiseState::new();
    // One frame of latency: feed an extra frame of zeros and drop the first output frame.
    let total = (x.len() + RNN_FRAME).div_ceil(RNN_FRAME) * RNN_FRAME;
    let mut out = Vec::with_capacity(total);
    let mut inp = [0.0f32; RNN_FRAME];
    let mut frame_out = [0.0f32; RNN_FRAME];
    for f in 0..total / RNN_FRAME {
        for (i, v) in inp.iter_mut().enumerate() {
            *v = x.get(f * RNN_FRAME + i).copied().unwrap_or(0.0) * 32768.0;
        }
        state.process_frame(&mut frame_out, &inp);
        out.extend(frame_out.iter().map(|v| v / 32768.0));
    }
    out.drain(..RNN_FRAME);
    out.truncate(x.len());
    out
}

fn rnnoise(buf: &AudioBuffer, s: &DenoiseSettings) -> AudioBuffer {
    let wet = (s.reduction_db.max(0.0) / 24.0).min(1.0);
    if wet <= 0.0 {
        return buf.clone();
    }
    let work = if buf.sample_rate == RNN_RATE { buf.clone() } else { resample(buf, RNN_RATE, ResampleQuality::Balanced) };
    let processed = AudioBuffer {
        sample_rate: RNN_RATE,
        channels: work.channels.iter().map(|c| rnnoise_channel(c)).collect(),
    };
    let mut back =
        if buf.sample_rate == RNN_RATE { processed } else { resample(&processed, buf.sample_rate, ResampleQuality::Balanced) };
    let len = buf.frames();
    for (ch, dry) in back.channels.iter_mut().zip(&buf.channels) {
        ch.resize(len, 0.0);
        for (w, d) in ch.iter_mut().zip(dry) {
            *w = *d * (1.0 - wet) + *w * wet;
        }
    }
    back
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signals::{add, sine, silence, white_noise};

    const SR: u32 = 48000;

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt()
    }

    fn diff(a: &[f32], b: &[f32]) -> Vec<f32> {
        a.iter().zip(b).map(|(x, y)| x - y).collect()
    }

    fn spectral(reduction: f32) -> DenoiseSettings {
        DenoiseSettings { enabled: true, reduction_db: reduction, ..Default::default() }
    }

    /// 0.5 s noise only, then 2 s of sine + noise. Returns (noisy, clean).
    fn noisy_case() -> (AudioBuffer, AudioBuffer) {
        let mut clean = silence(SR, 1, 0.5);
        clean.append(&sine(1000.0, SR, 2.0, 0.5));
        let noise = white_noise(SR, 2.5, 0.05, 42);
        (add(&clean, &noise), clean)
    }

    fn snr_gain(noisy: &AudioBuffer, clean: &AudioBuffer, out: &AudioBuffer) -> f64 {
        let r = (SR as usize)..(SR as usize * 2); // well inside the sine region
        let c = &clean.channels[0][r.clone()];
        let snr_in = rms(c) / rms(&diff(&noisy.channels[0][r.clone()], c));
        let snr_out = rms(c) / rms(&diff(&out.channels[0][r], c));
        20.0 * (snr_out / snr_in).log10()
    }

    #[test]
    fn mask_one_is_perfect_reconstruction() {
        let x = add(&sine(440.0, SR, 0.5, 0.4), &white_noise(SR, 0.5, 0.2, 3)).with_channels(2);
        // reduction 0 dB => floor 1 => mask == 1 everywhere.
        let out = apply_denoise(&x, &spectral(0.0));
        assert_eq!(out.frames(), x.frames());
        for (a, b) in out.channels.iter().zip(&x.channels) {
            let err = a.iter().zip(b).fold(0.0f32, |m, (p, q)| m.max((p - q).abs()));
            assert!(err < 1e-5, "reconstruction error {err}");
        }
        // Odd, short lengths too.
        let short = white_noise(SR, 0.0123, 0.5, 5);
        let o = apply_denoise(&short, &spectral(0.0));
        let err = o.channels[0].iter().zip(&short.channels[0]).fold(0.0f32, |m, (p, q)| m.max((p - q).abs()));
        assert!(err < 1e-5);
    }

    #[test]
    fn spectral_gate_improves_snr_with_profile_region() {
        let (noisy, clean) = noisy_case();
        let s = DenoiseSettings { profile_start: Some(0.0), profile_end: Some(0.45), ..spectral(12.0) };
        let out = apply_denoise(&noisy, &s);
        assert_eq!(out.frames(), noisy.frames());
        let g = snr_gain(&noisy, &clean, &out);
        assert!(g >= 6.0, "SNR improvement {g} dB");
        // Noise-only part is attenuated by roughly the reduction amount.
        let n_in = rms(&noisy.channels[0][4800..19200]);
        let n_out = rms(&out.channels[0][4800..19200]);
        assert!(20.0 * (n_out / n_in).log10() < -8.0);
    }

    #[test]
    fn spectral_gate_learns_profile_automatically() {
        let (noisy, clean) = noisy_case();
        let out = apply_denoise(&noisy, &spectral(18.0));
        let g = snr_gain(&noisy, &clean, &out);
        assert!(g >= 6.0, "SNR improvement {g} dB");
    }

    #[test]
    fn clean_signal_is_not_distorted() {
        let mut clean = silence(SR, 1, 0.5);
        clean.append(&sine(1000.0, SR, 1.0, 0.5));
        let s = DenoiseSettings { profile_start: Some(0.0), profile_end: Some(0.4), ..spectral(24.0) };
        let out = apply_denoise(&clean, &s);
        let r = (SR as usize * 3 / 4)..(SR as usize * 5 / 4);
        let err = rms(&diff(&out.channels[0][r.clone()], &clean.channels[0][r.clone()]));
        let rel_db = 20.0 * (err / rms(&clean.channels[0][r])).log10();
        assert!(rel_db < -40.0, "distortion {rel_db} dB");
    }

    #[test]
    fn smoothing_and_time_constants_are_bounded() {
        let (noisy, _) = noisy_case();
        for (sm, a, r) in [(0.0, 0.0, 0.0), (1.0, 50.0, 500.0)] {
            let s = DenoiseSettings { smoothing: sm, attack_ms: a, release_ms: r, ..spectral(12.0) };
            let out = apply_denoise(&noisy, &s);
            assert!(out.channels[0].iter().all(|v| v.is_finite()));
            assert!(out.peak() <= noisy.peak() * 1.5);
        }
        assert_eq!(time_coef(0.0, HOP, 48000.0), 0.0);
        assert!((time_coef(10.0, 480, 48000.0) - (-1.0f64).exp()).abs() < 1e-12);
        // Degenerate profile ranges fall back to automatic profiling.
        let s = DenoiseSettings { profile_start: Some(1.0), profile_end: Some(0.5), ..spectral(12.0) };
        assert_eq!(apply_denoise(&noisy, &s).frames(), noisy.frames());
        let s = DenoiseSettings { profile_start: Some(0.1), profile_end: Some(0.1001), ..spectral(12.0) };
        assert_eq!(apply_denoise(&noisy, &s).frames(), noisy.frames());
    }

    /// Low-passed white noise (background hiss / rumble). RNNoise is a speech
    /// model and reacts erratically to perfectly flat synthetic white noise,
    /// but reliably removes this kind of stationary noise.
    fn background_noise(sr: u32, secs: f64, amp: f32, seed: u64) -> AudioBuffer {
        let mut rng = crate::signals::Rng::new(seed);
        let mut lp = 0.0f32;
        let n = (secs * sr as f64).round() as usize;
        AudioBuffer::mono(
            sr,
            (0..n)
                .map(|_| {
                    lp = 0.9 * lp + 0.1 * rng.next_bipolar();
                    amp * lp
                })
                .collect(),
        )
    }

    #[test]
    fn rnnoise_attenuates_noise_and_keeps_length() {
        for (sr, seed) in [(48000u32, 1u64), (48000, 99), (44100, 7)] {
            let n = background_noise(sr, 2.0, 0.03, seed).with_channels(2);
            let s = DenoiseSettings { enabled: true, mode: DenoiseMode::Rnnoise, reduction_db: 24.0, ..Default::default() };
            let out = apply_denoise(&n, &s);
            assert_eq!(out.frames(), n.frames());
            assert_eq!(out.num_channels(), 2);
            assert_eq!(out.sample_rate, sr);
            let half = n.frames() / 2;
            let db = 20.0 * (rms(&out.channels[0][half..]) / rms(&n.channels[0][half..])).log10();
            assert!(db < -20.0, "{sr}/{seed}: rnnoise attenuation {db} dB");
            // Partial reduction mixes dry signal back in (12 dB -> 50 % wet => about -6 dB at most).
            let s12 = DenoiseSettings { reduction_db: 12.0, ..s };
            let o12 = apply_denoise(&n, &s12);
            let db12 = 20.0 * (rms(&o12.channels[0][half..]) / rms(&n.channels[0][half..])).log10();
            assert!(db12 > -6.5 && db12 < -3.0, "{db12}");
        }
        // Zero reduction = dry.
        let n = white_noise(SR, 0.2, 0.1, 8);
        let s = DenoiseSettings { enabled: true, mode: DenoiseMode::Rnnoise, reduction_db: 0.0, ..Default::default() };
        assert_eq!(apply_denoise(&n, &s), n);
    }

    #[test]
    fn rnnoise_latency_is_compensated() {
        // A non-periodic, speech-band sweep: the best-matching lag between
        // input and output must be ~0 (one RNNoise frame of delay removed).
        let x = crate::signals::sweep(150.0, 3000.0, SR, 1.0, 0.3);
        let o = rnnoise_channel(&x.channels[0]);
        assert_eq!(o.len(), x.frames());
        let seg = 12000..36000;
        let corr = |lag: isize| -> f64 {
            seg.clone().map(|i| x.channels[0][i] as f64 * o[(i as isize + lag) as usize] as f64).sum::<f64>()
        };
        let best = (-600isize..=600).max_by(|a, b| corr(*a).partial_cmp(&corr(*b)).unwrap()).unwrap();
        assert!(best.abs() <= 8, "best lag {best}");
    }

    #[test]
    fn disabled_and_empty() {
        let n = white_noise(SR, 0.2, 0.1, 8);
        assert_eq!(apply_denoise(&n, &DenoiseSettings::default()), n);
        let e = AudioBuffer::new(SR, 2, 0);
        assert_eq!(apply_denoise(&e, &spectral(12.0)), e);
    }

    #[test]
    fn serde_names_and_defaults() {
        let s: DenoiseSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, DenoiseSettings::default());
        assert_eq!((s.reduction_db, s.sensitivity_db, s.smoothing, s.attack_ms, s.release_ms), (12.0, 6.0, 0.5, 5.0, 50.0));
        let s: DenoiseSettings = serde_json::from_str(
            r#"{"enabled":true,"mode":"rnnoise","reductionDb":20,"sensitivityDb":3,"smoothing":0.2,"attackMs":1,"releaseMs":100,"profileStart":0.5,"profileEnd":1.0}"#,
        )
        .unwrap();
        assert_eq!(s.mode, DenoiseMode::Rnnoise);
        assert_eq!((s.profile_start, s.profile_end), (Some(0.5), Some(1.0)));
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("reductionDb") && json.contains("profileStart") && json.contains("\"rnnoise\""));
        assert_eq!(serde_json::from_str::<DenoiseSettings>(&json).unwrap(), s);
        assert_eq!(serde_json::to_string(&DenoiseMode::Spectral).unwrap(), "\"spectral\"");
    }
}
