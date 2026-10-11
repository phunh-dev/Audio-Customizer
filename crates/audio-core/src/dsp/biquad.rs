//! RBJ Audio EQ Cookbook biquads (f64, transposed direct form II).

use crate::buffer::AudioBuffer;
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BiquadKind {
    Lowpass,
    Highpass,
    /// Constant 0 dB peak gain.
    Bandpass,
    Notch,
    Peaking,
    LowShelf,
    HighShelf,
}

/// Normalised coefficients (`a0 == 1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Coeffs {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

impl Coeffs {
    /// Identity filter.
    pub const IDENTITY: Coeffs = Coeffs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };

    /// `freq` is clamped to `(1, 0.49 * sample_rate)`, `q` to a small positive minimum.
    pub fn new(kind: BiquadKind, freq: f64, q: f64, gain_db: f64, sample_rate: f64) -> Self {
        let sr = if sample_rate > 0.0 && sample_rate.is_finite() { sample_rate } else { 44100.0 };
        let f = if freq.is_finite() { freq.clamp(1.0, 0.49 * sr) } else { 1000.0 };
        let q = if q.is_finite() { q.max(0.01) } else { std::f64::consts::FRAC_1_SQRT_2 };
        let gain_db = if gain_db.is_finite() { gain_db } else { 0.0 };
        let w0 = 2.0 * PI * f / sr;
        let (sw, cw) = w0.sin_cos();
        let alpha = sw / (2.0 * q);
        let a = 10f64.powf(gain_db / 40.0);
        let (b0, b1, b2, a0, a1, a2) = match kind {
            BiquadKind::Lowpass => {
                ((1.0 - cw) / 2.0, 1.0 - cw, (1.0 - cw) / 2.0, 1.0 + alpha, -2.0 * cw, 1.0 - alpha)
            }
            BiquadKind::Highpass => {
                ((1.0 + cw) / 2.0, -(1.0 + cw), (1.0 + cw) / 2.0, 1.0 + alpha, -2.0 * cw, 1.0 - alpha)
            }
            BiquadKind::Bandpass => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cw, 1.0 - alpha),
            BiquadKind::Notch => (1.0, -2.0 * cw, 1.0, 1.0 + alpha, -2.0 * cw, 1.0 - alpha),
            BiquadKind::Peaking => {
                (1.0 + alpha * a, -2.0 * cw, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cw, 1.0 - alpha / a)
            }
            BiquadKind::LowShelf => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * cw + s),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * cw),
                    a * ((a + 1.0) - (a - 1.0) * cw - s),
                    (a + 1.0) + (a - 1.0) * cw + s,
                    -2.0 * ((a - 1.0) + (a + 1.0) * cw),
                    (a + 1.0) + (a - 1.0) * cw - s,
                )
            }
            BiquadKind::HighShelf => {
                let s = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * cw + s),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * cw),
                    a * ((a + 1.0) + (a - 1.0) * cw - s),
                    (a + 1.0) - (a - 1.0) * cw + s,
                    2.0 * ((a - 1.0) - (a + 1.0) * cw),
                    (a + 1.0) - (a - 1.0) * cw - s,
                )
            }
        };
        Coeffs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
    }

    /// Magnitude response in dB at `freq`, evaluated on the unit circle.
    pub fn magnitude_db(&self, freq: f64, sample_rate: f64) -> f64 {
        let w = 2.0 * PI * freq / sample_rate;
        // z^-1 = e^{-jw}, z^-2 = e^{-2jw}
        let (s1, c1) = (-w).sin_cos();
        let (s2, c2) = (-2.0 * w).sin_cos();
        let nr = self.b0 + self.b1 * c1 + self.b2 * c2;
        let ni = self.b1 * s1 + self.b2 * s2;
        let dr = 1.0 + self.a1 * c1 + self.a2 * c2;
        let di = self.a1 * s1 + self.a2 * s2;
        let num = (nr * nr + ni * ni).sqrt();
        let den = (dr * dr + di * di).sqrt();
        20.0 * (num / den).max(1e-15).log10()
    }
}

/// Run every channel through the cascade (each stage with fresh zero state).
pub fn process_cascade(buf: &mut AudioBuffer, cascade: &[Coeffs]) {
    if cascade.is_empty() || buf.is_empty() {
        return;
    }
    for ch in &mut buf.channels {
        let mut x: Vec<f64> = ch.iter().map(|s| *s as f64).collect();
        for c in cascade {
            let (mut s1, mut s2) = (0.0f64, 0.0f64);
            for v in x.iter_mut() {
                let input = *v;
                let y = c.b0 * input + s1;
                s1 = c.b1 * input - c.a1 * y + s2;
                s2 = c.b2 * input - c.a2 * y;
                *v = y;
            }
        }
        for (o, v) in ch.iter_mut().zip(&x) {
            *o = *v as f32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{to_db, tone_amplitude};
    use crate::signals::{impulse, sine};

    const SR: f64 = 48000.0;
    const BW: f64 = std::f64::consts::FRAC_1_SQRT_2;

    #[test]
    fn lowpass_highpass_known_points() {
        let lp = Coeffs::new(BiquadKind::Lowpass, 1000.0, BW, 0.0, SR);
        assert!((lp.magnitude_db(1000.0, SR) + 3.01).abs() < 0.02);
        assert!(lp.magnitude_db(10.0, SR).abs() < 0.01);
        // 12 dB/oct far above cutoff (well below Nyquist to avoid bilinear warping).
        let lp2 = Coeffs::new(BiquadKind::Lowpass, 250.0, BW, 0.0, SR);
        let d = lp2.magnitude_db(2000.0, SR) - lp2.magnitude_db(4000.0, SR);
        assert!((d - 12.0).abs() < 2.0, "{d}");
        let hp = Coeffs::new(BiquadKind::Highpass, 1000.0, BW, 0.0, SR);
        assert!((hp.magnitude_db(1000.0, SR) + 3.01).abs() < 0.02);
        assert!(hp.magnitude_db(20000.0, SR).abs() < 0.05);
        assert!(hp.magnitude_db(62.5, SR) < -45.0);
    }

    #[test]
    fn bandpass_notch_peaking_shelves() {
        let bp = Coeffs::new(BiquadKind::Bandpass, 2000.0, 2.0, 0.0, SR);
        assert!(bp.magnitude_db(2000.0, SR).abs() < 0.01);
        assert!(bp.magnitude_db(200.0, SR) < -20.0);
        let n = Coeffs::new(BiquadKind::Notch, 2000.0, 2.0, 0.0, SR);
        assert!(n.magnitude_db(2000.0, SR) < -100.0);
        assert!(n.magnitude_db(100.0, SR).abs() < 0.1);
        let pk = Coeffs::new(BiquadKind::Peaking, 1000.0, 1.4, 6.0, SR);
        assert!((pk.magnitude_db(1000.0, SR) - 6.0).abs() < 1e-6);
        assert!(pk.magnitude_db(20.0, SR).abs() < 0.05);
        let pc = Coeffs::new(BiquadKind::Peaking, 1000.0, 1.4, -9.0, SR);
        assert!((pc.magnitude_db(1000.0, SR) + 9.0).abs() < 1e-6);
        let ls = Coeffs::new(BiquadKind::LowShelf, 300.0, BW, 6.0, SR);
        assert!((ls.magnitude_db(5.0, SR) - 6.0).abs() < 0.05);
        assert!((ls.magnitude_db(300.0, SR) - 3.0).abs() < 0.1);
        assert!(ls.magnitude_db(15000.0, SR).abs() < 0.05);
        let hs = Coeffs::new(BiquadKind::HighShelf, 5000.0, BW, -8.0, SR);
        assert!((hs.magnitude_db(23000.0, SR) + 8.0).abs() < 0.1);
        assert!((hs.magnitude_db(5000.0, SR) + 4.0).abs() < 0.1);
        assert!(hs.magnitude_db(50.0, SR).abs() < 0.05);
    }

    #[test]
    fn frequency_is_clamped_and_inputs_sanitised() {
        let a = Coeffs::new(BiquadKind::Lowpass, 30000.0, BW, 0.0, SR);
        let b = Coeffs::new(BiquadKind::Lowpass, 0.49 * SR, BW, 0.0, SR);
        assert_eq!(a, b);
        let c = Coeffs::new(BiquadKind::Highpass, -5.0, BW, 0.0, SR);
        let d = Coeffs::new(BiquadKind::Highpass, 1.0, BW, 0.0, SR);
        assert_eq!(c, d);
        let e = Coeffs::new(BiquadKind::Peaking, 1000.0, 0.0, f64::NAN, SR);
        assert!(e.b0.is_finite() && e.a1.is_finite() && e.a2.is_finite());
        assert!(e.magnitude_db(1000.0, SR).abs() < 1e-9);
    }

    #[test]
    fn processing_matches_magnitude_response() {
        let cascade = [
            Coeffs::new(BiquadKind::Lowpass, 2000.0, BW, 0.0, SR),
            Coeffs::new(BiquadKind::Peaking, 500.0, 1.0, 6.0, SR),
        ];
        for f in [200.0, 500.0, 2000.0, 4000.0] {
            let mut s = sine(f, SR as u32, 0.5, 0.5);
            process_cascade(&mut s, &cascade);
            let steady = s.slice(4800, s.frames());
            let measured = to_db(tone_amplitude(&steady, f) / 0.5);
            let expected: f64 = cascade.iter().map(|c| c.magnitude_db(f, SR)).sum();
            assert!((measured - expected).abs() < 0.1, "{f}: {measured} vs {expected}");
        }
    }

    #[test]
    fn identity_and_empty_cascade() {
        let s = sine(440.0, 48000, 0.05, 0.5).with_channels(2);
        let mut x = s.clone();
        process_cascade(&mut x, &[]);
        assert_eq!(x, s);
        process_cascade(&mut x, &[Coeffs::IDENTITY]);
        assert_eq!(x, s);
        let mut imp = impulse(48000, 16, 0);
        let c = Coeffs { b0: 0.5, b1: 0.25, b2: 0.125, a1: 0.0, a2: 0.0 };
        process_cascade(&mut imp, &[c]);
        assert_eq!(&imp.channels[0][..4], &[0.5, 0.25, 0.125, 0.0]);
        let mut e = AudioBuffer::new(48000, 1, 0);
        process_cascade(&mut e, &[c]);
        assert!(e.is_empty());
    }
}
