//! Seamless loop builder (tail/head crossfade).
//!
//! Given a region `[start, end)` of `L` frames and a crossfade of `C` frames,
//! the output is `[tail * fadeOut + head * fadeIn, region[C..L-C]]` where
//! `head = region[0..C]` and `tail = region[L-C..L]`. Its length is `L - C`
//! and playing it in a loop is continuous: the last output sample is
//! `region[L-C-1]`, immediately followed by (mostly) `region[L-C]`.

use crate::buffer::AudioBuffer;
use crate::dsp::fade::FadeCurve;
use crate::error::{AudioError, Result};
use serde::{Deserialize, Serialize};

/// Minimum region length in frames.
const MIN_REGION_FRAMES: usize = 4;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LoopSettings {
    pub enabled: bool,
    pub crossfade_ms: f32,
    pub curve: FadeCurve,
    /// Seconds.
    pub start: Option<f64>,
    /// Seconds.
    pub end: Option<f64>,
    pub zero_crossing: bool,
    pub match_loudness: bool,
}

impl Default for LoopSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            crossfade_ms: 100.0,
            curve: FadeCurve::EqualPower,
            start: None,
            end: None,
            zero_crossing: true,
            match_loudness: false,
        }
    }
}

/// Nearest zero crossing to `idx` within `radius` frames (index of the
/// sample closer to zero of the sign-changing pair). Returns `idx` when none.
fn snap_zero_crossing(mono: &[f32], idx: usize, radius: usize, lo: usize, hi: usize) -> usize {
    if mono.len() < 2 {
        return idx;
    }
    let lo = lo.max(1);
    let hi = hi.min(mono.len() - 1);
    let is_cross = |i: usize| -> bool {
        let (a, b) = (mono[i - 1], mono[i]);
        (a < 0.0 && b >= 0.0) || (a >= 0.0 && b < 0.0) || a == 0.0
    };
    let pick = |i: usize| -> usize {
        if mono[i - 1].abs() < mono[i].abs() {
            i - 1
        } else {
            i
        }
    };
    for d in 0..=radius {
        for i in [idx.checked_sub(d), idx.checked_add(d)].into_iter().flatten() {
            if i >= lo && i <= hi && is_cross(i) {
                return pick(i);
            }
        }
    }
    idx
}

fn rms(x: &[f32]) -> f64 {
    if x.is_empty() {
        return 0.0;
    }
    (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
}

/// Build a seamless loop. Disabled settings return the input unchanged.
pub fn build_loop(buf: &AudioBuffer, s: &LoopSettings) -> Result<AudioBuffer> {
    if !s.enabled {
        return Ok(buf.clone());
    }
    let frames = buf.frames();
    let mut start = s.start.map(|t| buf.secs_to_frames(t)).unwrap_or(0).min(frames);
    let mut end = s.end.map(|t| buf.secs_to_frames(t)).unwrap_or(frames).min(frames);
    if s.zero_crossing && end > start {
        let mono = buf.to_mono();
        let radius = buf.secs_to_frames(0.010);
        let m = &mono.channels[0];
        start = snap_zero_crossing(m, start, radius, 0, frames);
        end = snap_zero_crossing(m, end, radius, 0, frames);
    }
    if end < start + MIN_REGION_FRAMES {
        return Err(AudioError::InvalidParam(format!(
            "loop region too short ({} frames)",
            end.saturating_sub(start)
        )));
    }
    let region = buf.slice(start, end);
    let len = region.frames();
    let c = buf.secs_to_frames(s.crossfade_ms.max(0.0) as f64 / 1000.0).min(len / 2);
    if c == 0 {
        return Ok(region);
    }
    let fade_in: Vec<f64> = (0..c).map(|i| s.curve.gain((i as f64 + 0.5) / c as f64)).collect();
    let fade_out: Vec<f64> = (0..c).map(|i| s.curve.gain(1.0 - (i as f64 + 0.5) / c as f64)).collect();

    let channels = region
        .channels
        .iter()
        .map(|x| {
            let head = &x[..c];
            let tail = &x[len - c..];
            let g = if s.match_loudness {
                let (rh, rt) = (rms(head), rms(tail));
                if rt > 1e-9 && rh > 1e-9 {
                    (rh / rt).clamp(0.25, 4.0)
                } else {
                    1.0
                }
            } else {
                1.0
            };
            let mut out = Vec::with_capacity(len - c);
            for i in 0..c {
                out.push((tail[i] as f64 * g * fade_out[i] + head[i] as f64 * fade_in[i]) as f32);
            }
            // The body ramps from unity to `g` so the seam into the
            // (gain-matched) tail stays continuous.
            let body = &x[c..len - c];
            let bl = body.len().max(1) as f64;
            for (j, v) in body.iter().enumerate() {
                let gj = if g == 1.0 { 1.0 } else { 1.0 + (g - 1.0) * (j as f64 + 1.0) / bl };
                out.push((*v as f64 * gj) as f32);
            }
            out
        })
        .collect();
    Ok(AudioBuffer { sample_rate: buf.sample_rate, channels })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signals::{sine, white_noise};

    fn on(crossfade_ms: f32) -> LoopSettings {
        LoopSettings { enabled: true, crossfade_ms, zero_crossing: false, ..Default::default() }
    }

    fn max_step(x: &[f32]) -> f32 {
        x.windows(2).fold(0.0f32, |m, w| m.max((w[1] - w[0]).abs()))
    }

    fn max_second_diff(x: &[f32]) -> f32 {
        x.windows(3).fold(0.0f32, |m, w| m.max((w[2] - 2.0 * w[1] + w[0]).abs()))
    }

    #[test]
    fn seam_is_continuous() {
        let sr = 44100;
        let s = sine(440.0, sr, 1.0, 0.5);
        let st = LoopSettings { end: Some(0.7506), ..on(50.0) };
        let out = build_loop(&s, &st).unwrap();
        let x = &out.channels[0];
        let n = x.len();
        let step = max_step(x);
        let seam = (x[0] - x[n - 1]).abs();
        assert!(seam <= step * 1.05, "seam {seam} vs max step {step}");
        let second = (x[0] - 2.0 * x[n - 1] + x[n - 2]).abs();
        assert!(second <= max_second_diff(x) * 1.5 + 1e-4, "seam curvature {second}");
        // A naive loop of the same region jumps much more.
        let naive = s.slice(0, s.secs_to_frames(0.7506));
        let y = &naive.channels[0];
        let naive_seam = (y[0] - y[y.len() - 1]).abs();
        assert!(naive_seam > 5.0 * seam, "naive {naive_seam} vs {seam}");
    }

    #[test]
    fn exact_length_and_region() {
        let s = white_noise(1000, 2.0, 0.5, 1).with_channels(2);
        let st = LoopSettings { start: Some(0.25), end: Some(1.25), ..on(100.0) };
        let out = build_loop(&s, &st).unwrap();
        assert_eq!(out.frames(), 1000 - 100);
        assert_eq!(out.num_channels(), 2);
        // Body is the untouched region after the crossfade.
        assert_eq!(out.channels[0][100..], s.channels[0][250 + 100..250 + 900]);
        // Crossfade longer than half the region is clamped.
        let big = build_loop(&s, &LoopSettings { start: Some(0.0), end: Some(0.1), ..on(5000.0) }).unwrap();
        assert_eq!(big.frames(), 50);
        // No crossfade = plain region; whole buffer when no bounds.
        let plain = build_loop(&s, &on(0.0)).unwrap();
        assert_eq!(plain, s);
        // End beyond the buffer is clamped.
        let clamp = build_loop(&s, &LoopSettings { end: Some(99.0), ..on(10.0) }).unwrap();
        assert_eq!(clamp.frames(), 2000 - 10);
    }

    #[test]
    fn equal_power_preserves_energy_of_uncorrelated_material() {
        let sr = 48000;
        let s = white_noise(sr, 2.0, 0.5, 11);
        let reference = rms(&s.channels[0]);
        let c = 24000;
        let ep = build_loop(&s, &LoopSettings { curve: FadeCurve::EqualPower, ..on(500.0) }).unwrap();
        let ep_db = 20.0 * (rms(&ep.channels[0][..c]) / reference).log10();
        assert!(ep_db.abs() < 0.5, "equal power {ep_db} dB");
        let lin = build_loop(&s, &LoopSettings { curve: FadeCurve::Linear, ..on(500.0) }).unwrap();
        let lin_db = 20.0 * (rms(&lin.channels[0][..c]) / reference).log10();
        assert!(lin_db < -1.0, "linear {lin_db} dB");
    }

    #[test]
    fn zero_crossing_snap() {
        let sr = 44100;
        let s = sine(100.0, sr, 1.0, 0.8);
        let st = LoopSettings { start: Some(0.1025), end: Some(0.8037), zero_crossing: true, ..on(0.0) };
        let out = build_loop(&s, &st).unwrap();
        let x = &out.channels[0];
        let step = 0.8 * 2.0 * std::f32::consts::PI * 100.0 / sr as f32;
        assert!(x[0].abs() <= step, "start sample {}", x[0]);
        // Without snapping the region starts at a large sample.
        let raw = build_loop(&s, &LoopSettings { zero_crossing: false, ..st.clone() }).unwrap();
        assert!(raw.channels[0][0].abs() > 0.3);
        // Helper: nearest crossing.
        let m = [0.5f32, 0.4, 0.1, -0.2, -0.5, -0.4, 0.3];
        assert_eq!(snap_zero_crossing(&m, 1, 3, 0, 7), 2);
        assert_eq!(snap_zero_crossing(&m, 6, 0, 0, 7), 6);
        assert_eq!(snap_zero_crossing(&[0.5f32, 0.5, 0.5], 1, 5, 0, 3), 1);
    }

    #[test]
    fn match_loudness_balances_tail() {
        let sr = 8000;
        let mut s = sine(200.0, sr, 1.0, 0.5);
        // Second half is twice as loud.
        for v in s.channels[0][4000..].iter_mut() {
            *v *= 2.0;
        }
        let st = LoopSettings { match_loudness: true, ..on(100.0) };
        let out = build_loop(&s, &st).unwrap();
        let x = &out.channels[0];
        let n = x.len();
        // The end of the loop now has about the head's level.
        let end_rms = rms(&x[n - 400..]);
        assert!((end_rms - 0.5 / 2f64.sqrt()).abs() < 0.05, "{end_rms}");
        assert!((x[0] - x[n - 1]).abs() <= max_step(x) * 1.05);
        assert_eq!(n, 8000 - 800);
    }

    #[test]
    fn invalid_region_and_disabled() {
        let s = sine(440.0, 1000, 1.0, 0.5);
        let err = build_loop(&s, &LoopSettings { start: Some(0.5), end: Some(0.501), ..on(10.0) }).unwrap_err();
        assert_eq!(err.code(), "ERR_INVALID_PARAM");
        assert!(build_loop(&s, &LoopSettings { start: Some(0.8), end: Some(0.2), ..on(10.0) }).is_err());
        assert!(build_loop(&AudioBuffer::new(1000, 1, 0), &on(10.0)).is_err());
        assert_eq!(build_loop(&s, &LoopSettings::default()).unwrap(), s);
    }

    #[test]
    fn serde_names_and_defaults() {
        let s: LoopSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, LoopSettings::default());
        assert_eq!((s.crossfade_ms, s.curve, s.zero_crossing, s.match_loudness), (100.0, FadeCurve::EqualPower, true, false));
        let s: LoopSettings = serde_json::from_str(
            r#"{"enabled":true,"crossfadeMs":20,"curve":"linear","start":1.5,"end":null,"zeroCrossing":false,"matchLoudness":true}"#,
        )
        .unwrap();
        assert_eq!(s.start, Some(1.5));
        assert_eq!(s.end, None);
        assert!(s.match_loudness && !s.zero_crossing);
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("crossfadeMs") && json.contains("\"curve\":\"linear\""));
        assert_eq!(serde_json::from_str::<LoopSettings>(&json).unwrap(), s);
    }
}
