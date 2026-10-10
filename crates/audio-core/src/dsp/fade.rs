//! Fade in / fade out with selectable curves.

use crate::buffer::AudioBuffer;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum FadeCurve {
    /// `t`
    #[default]
    Linear,
    /// `t^2`
    Exponential,
    /// `1 - (1 - t)^2`
    Logarithmic,
    /// `0.5 - 0.5 cos(pi t)`
    SCurve,
    /// `sin(pi t / 2)`
    EqualPower,
}

impl FadeCurve {
    /// Fade-in gain at normalised position `t` (clamped to `[0, 1]`).
    pub fn gain(self, t: f64) -> f64 {
        let t = if t.is_nan() { 0.0 } else { t.clamp(0.0, 1.0) };
        match self {
            FadeCurve::Linear => t,
            FadeCurve::Exponential => t * t,
            FadeCurve::Logarithmic => 1.0 - (1.0 - t) * (1.0 - t),
            FadeCurve::SCurve => 0.5 - 0.5 * (PI * t).cos(),
            FadeCurve::EqualPower => (PI * t / 2.0).sin(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Fade {
    /// Seconds.
    pub duration: f64,
    pub curve: FadeCurve,
}

/// Fade in over the first `frames` frames (clamped to the buffer). The first
/// sample becomes exactly 0, the gain reaches 1 at sample `frames`.
pub fn apply_fade_in(buf: &mut AudioBuffer, frames: usize, curve: FadeCurve) {
    let n = frames.min(buf.frames());
    if n == 0 {
        return;
    }
    for ch in &mut buf.channels {
        for (i, s) in ch.iter_mut().take(n).enumerate() {
            *s = (*s as f64 * curve.gain(i as f64 / n as f64)) as f32;
        }
    }
}

/// Fade out over the last `frames` frames (clamped to the buffer). The last
/// sample becomes exactly 0.
pub fn apply_fade_out(buf: &mut AudioBuffer, frames: usize, curve: FadeCurve) {
    let total = buf.frames();
    let n = frames.min(total);
    if n == 0 {
        return;
    }
    let start = total - n;
    for ch in &mut buf.channels {
        for (i, s) in ch[start..].iter_mut().enumerate() {
            // i = n-1 (last sample) -> t = 0 -> gain 0.
            let t = (n - 1 - i) as f64 / n as f64;
            *s = (*s as f64 * curve.gain(t)) as f32;
        }
    }
}

pub fn apply_fades(buf: &mut AudioBuffer, fade_in: &Fade, fade_out: &Fade) {
    let fi = buf.secs_to_frames(fade_in.duration);
    let fo = buf.secs_to_frames(fade_out.duration);
    apply_fade_in(buf, fi, fade_in.curve);
    apply_fade_out(buf, fo, fade_out.curve);
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [FadeCurve; 5] =
        [FadeCurve::Linear, FadeCurve::Exponential, FadeCurve::Logarithmic, FadeCurve::SCurve, FadeCurve::EqualPower];

    #[test]
    fn curves_endpoints_and_monotonic() {
        for c in ALL {
            assert_eq!(c.gain(0.0), 0.0, "{c:?}");
            assert!((c.gain(1.0) - 1.0).abs() < 1e-12, "{c:?}");
            assert_eq!(c.gain(-1.0), 0.0);
            assert!((c.gain(2.0) - 1.0).abs() < 1e-12);
            assert_eq!(c.gain(f64::NAN), 0.0);
            let mut prev = -1.0;
            for i in 0..=100 {
                let g = c.gain(i as f64 / 100.0);
                assert!(g >= prev, "{c:?} not monotonic at {i}");
                prev = g;
            }
        }
    }

    #[test]
    fn curve_shapes() {
        assert!((FadeCurve::Linear.gain(0.5) - 0.5).abs() < 1e-12);
        assert!((FadeCurve::Exponential.gain(0.5) - 0.25).abs() < 1e-12);
        assert!((FadeCurve::Logarithmic.gain(0.5) - 0.75).abs() < 1e-12);
        assert!((FadeCurve::SCurve.gain(0.5) - 0.5).abs() < 1e-12);
        assert!((FadeCurve::SCurve.gain(0.25) - (0.5 - 0.5 * (PI / 4.0).cos())).abs() < 1e-12);
        assert!((FadeCurve::EqualPower.gain(0.5) - (0.5f64).sqrt()).abs() < 1e-12);
        // Equal power: g(t)^2 + g(1-t)^2 == 1.
        for i in 0..=20 {
            let t = i as f64 / 20.0;
            let a = FadeCurve::EqualPower.gain(t);
            let b = FadeCurve::EqualPower.gain(1.0 - t);
            assert!((a * a + b * b - 1.0).abs() < 1e-12);
        }
        // Exponential is below linear, logarithmic above, in the interior.
        for i in 1..10 {
            let t = i as f64 / 10.0;
            assert!(FadeCurve::Exponential.gain(t) < t);
            assert!(FadeCurve::Logarithmic.gain(t) > t);
        }
    }

    #[test]
    fn fade_in_and_out_on_buffer() {
        for c in ALL {
            let mut b = AudioBuffer::from_channels(100, vec![vec![1.0; 100], vec![-1.0; 100]]);
            apply_fade_in(&mut b, 10, c);
            apply_fade_out(&mut b, 20, c);
            for ch in 0..2 {
                let sign = if ch == 0 { 1.0 } else { -1.0 };
                let x = &b.channels[ch];
                assert_eq!(x[0], 0.0);
                assert_eq!(x[99], 0.0);
                assert_eq!(x[10] * sign, 1.0);
                assert_eq!(x[79] * sign, 1.0);
                for i in 1..10 {
                    assert!(x[i] * sign >= x[i - 1] * sign);
                    assert!((x[i] * sign - c.gain(i as f64 / 10.0) as f32).abs() < 1e-6);
                }
                for i in 81..100 {
                    assert!(x[i] * sign <= x[i - 1] * sign);
                }
            }
        }
    }

    #[test]
    fn fade_longer_than_buffer_is_clamped_and_zero_is_noop() {
        let mut b = AudioBuffer::mono(10, vec![1.0; 5]);
        apply_fade_in(&mut b, 0, FadeCurve::Linear);
        apply_fade_out(&mut b, 0, FadeCurve::Linear);
        assert_eq!(b.channels[0], vec![1.0; 5]);
        apply_fade_out(&mut b, 100, FadeCurve::Linear);
        let expected = [0.8f32, 0.6, 0.4, 0.2, 0.0];
        for (a, e) in b.channels[0].iter().zip(expected) {
            assert!((a - e).abs() < 1e-6, "{a} vs {e}");
        }
        assert_eq!(b.channels[0][4], 0.0);
        let mut e = AudioBuffer::new(10, 1, 0);
        apply_fade_in(&mut e, 10, FadeCurve::SCurve);
        apply_fade_out(&mut e, 10, FadeCurve::SCurve);
        assert!(e.is_empty());
    }

    #[test]
    fn apply_fades_uses_seconds() {
        let mut b = AudioBuffer::mono(1000, vec![1.0; 1000]);
        apply_fades(
            &mut b,
            &Fade { duration: 0.1, curve: FadeCurve::Linear },
            &Fade { duration: 0.2, curve: FadeCurve::EqualPower },
        );
        let x = &b.channels[0];
        assert_eq!(x[0], 0.0);
        assert!((x[50] - 0.5).abs() < 1e-6);
        assert_eq!(x[100], 1.0);
        assert_eq!(x[799], 1.0);
        assert!(x[800] < 1.0);
        assert_eq!(x[999], 0.0);
    }

    #[test]
    fn serde_names_and_defaults() {
        let f: Fade = serde_json::from_str("{}").unwrap();
        assert_eq!(f, Fade { duration: 0.0, curve: FadeCurve::Linear });
        let f: Fade = serde_json::from_str(r#"{"duration":1.5,"curve":"sCurve"}"#).unwrap();
        assert_eq!(f.curve, FadeCurve::SCurve);
        assert_eq!(serde_json::to_string(&FadeCurve::EqualPower).unwrap(), "\"equalPower\"");
        for c in ALL {
            let s = serde_json::to_string(&c).unwrap();
            assert_eq!(serde_json::from_str::<FadeCurve>(&s).unwrap(), c);
        }
        let names: Vec<String> = ALL.iter().map(|c| serde_json::to_string(c).unwrap()).collect();
        assert_eq!(names, vec!["\"linear\"", "\"exponential\"", "\"logarithmic\"", "\"sCurve\"", "\"equalPower\""]);
    }
}
