//! Gain, pan, normalisation and limiting.

use crate::buffer::AudioBuffer;
use ebur128::{EbuR128, Mode};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum NormalizeMode {
    #[default]
    Off,
    Peak,
    Lufs,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct VolumeSettings {
    pub gain_db: f32,
    pub normalize: NormalizeMode,
    /// dBFS for `Peak`, LUFS for `Lufs`.
    pub normalize_target: f32,
    pub limiter: bool,
    pub limiter_ceiling_db: f32,
    pub limiter_release_ms: f32,
}

impl Default for VolumeSettings {
    fn default() -> Self {
        Self {
            gain_db: 0.0,
            normalize: NormalizeMode::Off,
            normalize_target: -1.0,
            limiter: false,
            limiter_ceiling_db: -1.0,
            limiter_release_ms: 50.0,
        }
    }
}

impl VolumeSettings {
    /// True when `apply_volume` would leave the buffer untouched.
    pub fn is_neutral(&self) -> bool {
        self.gain_db == 0.0 && self.normalize == NormalizeMode::Off && !self.limiter
    }
}

pub fn db_to_lin(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Linear gain to dB; 0 (or negative) maps to a very low finite value.
pub fn lin_to_db(lin: f32) -> f32 {
    20.0 * lin.max(1e-12).log10()
}

pub fn apply_gain_db(buf: &mut AudioBuffer, db: f32) {
    if db == 0.0 {
        return;
    }
    buf.scale(db_to_lin(db));
}

/// Balance law: the opposite side is attenuated linearly, the near side stays at unity.
pub fn pan_gains(pan: f32) -> (f32, f32) {
    let p = if pan.is_nan() { 0.0 } else { pan.clamp(-1.0, 1.0) };
    let left = if p > 0.0 { 1.0 - p } else { 1.0 };
    let right = if p < 0.0 { 1.0 + p } else { 1.0 };
    (left, right)
}

/// Applies balance to channels 0 (left) and 1 (right); no-op for mono.
pub fn apply_pan(buf: &mut AudioBuffer, pan: f32) {
    if buf.num_channels() < 2 {
        return;
    }
    let (l, r) = pan_gains(pan);
    if l != 1.0 {
        buf.channels[0].iter_mut().for_each(|s| *s *= l);
    }
    if r != 1.0 {
        buf.channels[1].iter_mut().for_each(|s| *s *= r);
    }
}

/// Scale so that the sample peak equals `target_db` dBFS (silence is left alone).
pub fn normalize_peak(buf: &mut AudioBuffer, target_db: f32) {
    let peak = buf.peak();
    if peak <= 0.0 || !peak.is_finite() {
        return;
    }
    let g = (db_to_lin(target_db) as f64 / peak as f64) as f32;
    buf.scale(g);
}

/// Integrated loudness (EBU R128 / BS.1770) in LUFS. `None` for silent or
/// too short (< 400 ms) material.
pub fn integrated_lufs(buf: &AudioBuffer) -> Option<f64> {
    if buf.sample_rate == 0 || (buf.frames() as f64) < 0.4 * buf.sample_rate as f64 {
        return None;
    }
    let mut meter = EbuR128::new(buf.num_channels() as u32, buf.sample_rate, Mode::I).ok()?;
    let planes: Vec<&[f32]> = buf.channels.iter().map(|c| c.as_slice()).collect();
    meter.add_frames_planar_f32(&planes).ok()?;
    let l = meter.loudness_global().ok()?;
    if l.is_finite() {
        Some(l)
    } else {
        None
    }
}

/// Scale to `target_lufs` integrated loudness (no-op when loudness is undefined).
pub fn normalize_lufs(buf: &mut AudioBuffer, target_lufs: f32) {
    if let Some(l) = integrated_lufs(buf) {
        let g = 10f64.powf((target_lufs as f64 - l) / 20.0);
        buf.scale(g as f32);
    }
}

/// Look-ahead brickwall peak limiter. Output never exceeds `ceiling_db` dBFS.
pub fn limit(buf: &mut AudioBuffer, ceiling_db: f32, release_ms: f32) {
    let frames = buf.frames();
    if frames == 0 {
        return;
    }
    let ceil = db_to_lin(ceiling_db.min(0.0)) as f64;
    let sr = buf.sample_rate.max(1) as f64;
    // Required gain per frame.
    let g_req: Vec<f64> = (0..frames)
        .map(|i| {
            let p = buf.channels.iter().fold(0.0f64, |m, c| m.max(c[i].abs() as f64));
            if p > ceil {
                ceil / p
            } else {
                1.0
            }
        })
        .collect();
    if g_req.iter().all(|g| *g >= 1.0) {
        return;
    }
    let look = ((0.005 * sr).round() as usize).max(1);
    // m[i] = min(g_req[i..=i+look]) via a monotonic deque.
    let mut m = vec![1.0f64; frames];
    let mut dq: VecDeque<usize> = VecDeque::new();
    let mut next = 0usize;
    for (i, mi) in m.iter_mut().enumerate() {
        let hi = (i + look).min(frames - 1);
        while next <= hi {
            while let Some(&b) = dq.back() {
                if g_req[b] >= g_req[next] {
                    dq.pop_back();
                } else {
                    break;
                }
            }
            dq.push_back(next);
            next += 1;
        }
        while let Some(&f) = dq.front() {
            if f < i {
                dq.pop_front();
            } else {
                break;
            }
        }
        *mi = g_req[*dq.front().unwrap()];
    }
    // avg[i] = mean(m[i-look..=i]); every m[j] in that window covers frame i,
    // so avg[i] <= g_req[i]. Out-of-range indices use m[0] (which also covers i).
    let win = look + 1;
    let mut sum = m[0] * win as f64;
    let rel_samples = (release_ms.max(0.0) as f64 * sr / 1000.0).max(1.0);
    let coef = 1.0 - (-1.0 / rel_samples).exp();
    let mut env = 1.0f64;
    let mut gains = vec![1.0f64; frames];
    for i in 0..frames {
        if i > 0 {
            let out_idx = i.saturating_sub(win);
            let out = if i >= win { m[out_idx] } else { m[0] };
            sum += m[i] - out;
        }
        let avg = (sum / win as f64).min(m[i]);
        env = avg.min(env + (1.0 - env) * coef);
        gains[i] = env;
    }
    let c = ceil as f32;
    for ch in &mut buf.channels {
        for (s, g) in ch.iter_mut().zip(&gains) {
            *s = ((*s as f64) * g) as f32;
            *s = s.clamp(-c, c);
        }
    }
}

/// gain -> normalize -> limiter.
pub fn apply_volume(buf: &mut AudioBuffer, s: &VolumeSettings) {
    apply_gain_db(buf, s.gain_db);
    match s.normalize {
        NormalizeMode::Off => {}
        NormalizeMode::Peak => normalize_peak(buf, s.normalize_target),
        NormalizeMode::Lufs => normalize_lufs(buf, s.normalize_target),
    }
    if s.limiter {
        limit(buf, s.limiter_ceiling_db, s.limiter_release_ms);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signals::{add, sine, silence, white_noise};

    #[test]
    fn db_lin_conversion() {
        assert!((db_to_lin(0.0) - 1.0).abs() < 1e-7);
        assert!((db_to_lin(-6.0206) - 0.5).abs() < 1e-4);
        assert!((db_to_lin(20.0) - 10.0).abs() < 1e-4);
        assert!((lin_to_db(0.5) + 6.0206).abs() < 1e-3);
        assert!(lin_to_db(0.0) <= -239.0);
        for db in [-60.0f32, -12.5, 0.0, 3.0, 24.0] {
            assert!((lin_to_db(db_to_lin(db)) - db).abs() < 1e-4);
        }
    }

    #[test]
    fn gain_db_scales() {
        let mut b = AudioBuffer::mono(10, vec![0.5, -0.25]);
        apply_gain_db(&mut b, 0.0);
        assert_eq!(b.channels[0], vec![0.5, -0.25]);
        apply_gain_db(&mut b, 6.0206);
        assert!((b.channels[0][0] - 1.0).abs() < 1e-4);
        assert!((b.channels[0][1] + 0.5).abs() < 1e-4);
    }

    #[test]
    fn pan_law() {
        assert_eq!(pan_gains(0.0), (1.0, 1.0));
        assert_eq!(pan_gains(-1.0), (1.0, 0.0));
        assert_eq!(pan_gains(1.0), (0.0, 1.0));
        assert_eq!(pan_gains(0.5), (0.5, 1.0));
        assert_eq!(pan_gains(-0.25), (1.0, 0.75));
        assert_eq!(pan_gains(5.0), (0.0, 1.0));
        assert_eq!(pan_gains(f32::NAN), (1.0, 1.0));
        let mut st = AudioBuffer::from_channels(10, vec![vec![1.0; 3], vec![1.0; 3]]);
        apply_pan(&mut st, 0.5);
        assert_eq!(st.channels[0], vec![0.5; 3]);
        assert_eq!(st.channels[1], vec![1.0; 3]);
        let mut mono = AudioBuffer::mono(10, vec![1.0; 3]);
        apply_pan(&mut mono, 1.0);
        assert_eq!(mono.channels[0], vec![1.0; 3]);
    }

    #[test]
    fn normalize_peak_hits_exact_dbfs() {
        for target in [-1.0f32, -6.0, 0.0, -20.0] {
            let mut b = sine(440.0, 44100, 0.2, 0.3);
            normalize_peak(&mut b, target);
            assert!((lin_to_db(b.peak()) - target).abs() < 0.01, "{target}");
        }
        let mut s = silence(44100, 2, 0.1);
        normalize_peak(&mut s, -1.0);
        assert_eq!(s.peak(), 0.0);
    }

    #[test]
    fn lufs_measurement_and_normalisation() {
        // 997 Hz full-scale sine on one channel reads -3.01 LUFS.
        let s = sine(997.0, 48000, 3.0, 1.0);
        let l = integrated_lufs(&s).unwrap();
        assert!((l + 3.01).abs() < 0.2, "{l}");
        for target in [-23.0f32, -16.0, -14.0] {
            let mut b = add(&sine(440.0, 48000, 3.0, 0.1), &white_noise(48000, 3.0, 0.05, 3));
            normalize_lufs(&mut b, target);
            let got = integrated_lufs(&b).unwrap();
            assert!((got - target as f64).abs() <= 0.5, "{target} -> {got}");
        }
        assert_eq!(integrated_lufs(&silence(48000, 2, 2.0)), None);
        assert_eq!(integrated_lufs(&sine(440.0, 48000, 0.2, 0.5)), None);
        let mut short = sine(440.0, 48000, 0.2, 0.5);
        let before = short.clone();
        normalize_lufs(&mut short, -10.0);
        assert_eq!(short, before);
    }

    #[test]
    fn limiter_never_exceeds_ceiling() {
        let mut b = add(&sine(100.0, 44100, 1.0, 0.5), &white_noise(44100, 1.0, 1.0, 9));
        b.scale(2.0);
        let mut st = b.with_channels(2);
        st.channels[1].iter_mut().for_each(|s| *s *= -0.7);
        for ceiling in [-1.0f32, -3.0, -0.1] {
            let mut x = st.clone();
            limit(&mut x, ceiling, 50.0);
            assert!(x.peak() <= db_to_lin(ceiling) + 1e-6, "{ceiling}: {}", x.peak());
            // Limited output keeps substantial level.
            assert!(x.rms() > 0.2 * st.rms());
        }
        // Impulse-like transient.
        let mut imp = AudioBuffer::mono(44100, vec![0.0; 1000]);
        imp.channels[0][500] = 4.0;
        imp.channels[0][501] = -3.0;
        limit(&mut imp, -1.0, 10.0);
        assert!(imp.peak() <= db_to_lin(-1.0) + 1e-6);
    }

    #[test]
    fn limiter_leaves_quiet_signal_unchanged() {
        let s = sine(440.0, 44100, 0.5, 0.5);
        let mut x = s.clone();
        limit(&mut x, -1.0, 50.0);
        assert_eq!(x, s);
        // Gain reduction is local: far after a loud burst the signal is ~unchanged.
        let mut burst = sine(440.0, 44100, 2.0, 0.3);
        for v in burst.channels[0][1000..2000].iter_mut() {
            *v *= 4.0;
        }
        let orig = burst.clone();
        limit(&mut burst, -1.0, 50.0);
        let tail = 44100..88200;
        let err = burst.channels[0][tail.clone()]
            .iter()
            .zip(&orig.channels[0][tail])
            .fold(0.0f32, |m, (a, b)| m.max((a - b).abs()));
        assert!(err < 1e-3, "{err}");
        let mut e = AudioBuffer::new(44100, 1, 0);
        limit(&mut e, -1.0, 50.0);
    }

    #[test]
    fn apply_volume_chain() {
        let s = sine(440.0, 44100, 0.5, 0.25);
        let mut x = s.clone();
        let neutral = VolumeSettings::default();
        assert!(neutral.is_neutral());
        apply_volume(&mut x, &neutral);
        assert_eq!(x, s);
        let vs = VolumeSettings { gain_db: 12.0, limiter: true, limiter_ceiling_db: -3.0, ..Default::default() };
        assert!(!vs.is_neutral());
        apply_volume(&mut x, &vs);
        assert!(x.peak() <= db_to_lin(-3.0) + 1e-6);
        let mut y = s.clone();
        apply_volume(
            &mut y,
            &VolumeSettings { gain_db: -10.0, normalize: NormalizeMode::Peak, normalize_target: -2.0, ..Default::default() },
        );
        assert!((lin_to_db(y.peak()) + 2.0).abs() < 0.01);
        let mut z = sine(440.0, 48000, 2.0, 0.25);
        apply_volume(
            &mut z,
            &VolumeSettings { normalize: NormalizeMode::Lufs, normalize_target: -18.0, ..Default::default() },
        );
        assert!((integrated_lufs(&z).unwrap() + 18.0).abs() < 0.5);
    }

    #[test]
    fn serde_names_and_defaults() {
        let v: VolumeSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(v, VolumeSettings::default());
        assert_eq!(v.normalize_target, -1.0);
        assert_eq!(v.limiter_release_ms, 50.0);
        let v: VolumeSettings = serde_json::from_str(
            r#"{"gainDb":3,"normalize":"lufs","normalizeTarget":-14,"limiter":true,"limiterCeilingDb":-0.5,"limiterReleaseMs":20}"#,
        )
        .unwrap();
        assert_eq!(v.gain_db, 3.0);
        assert_eq!(v.normalize, NormalizeMode::Lufs);
        assert_eq!(v.limiter_ceiling_db, -0.5);
        let json = serde_json::to_string(&v).unwrap();
        assert!(json.contains("\"gainDb\"") && json.contains("\"limiterReleaseMs\""));
        assert_eq!(serde_json::from_str::<VolumeSettings>(&json).unwrap(), v);
        assert_eq!(serde_json::to_string(&NormalizeMode::Peak).unwrap(), "\"peak\"");
        assert_eq!(serde_json::to_string(&NormalizeMode::Off).unwrap(), "\"off\"");
    }
}
