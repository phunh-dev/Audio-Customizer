//! 16-band parametric (peaking) equaliser.

use crate::buffer::AudioBuffer;
use crate::dsp::biquad::{process_cascade, BiquadKind, Coeffs};
use serde::{Deserialize, Serialize};

pub const EQ_FREQS: [f32; 16] = [
    25.0, 40.0, 63.0, 100.0, 160.0, 250.0, 400.0, 630.0, 1000.0, 1600.0, 2500.0, 4000.0, 6300.0, 10000.0, 16000.0,
    20000.0,
];
pub const EQ_DEFAULT_Q: f32 = 1.4;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EqBand {
    pub freq: f32,
    /// -18..18 dB.
    pub gain_db: f32,
    pub q: f32,
}

impl Default for EqBand {
    fn default() -> Self {
        Self { freq: 1000.0, gain_db: 0.0, q: EQ_DEFAULT_Q }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EqSettings {
    pub enabled: bool,
    pub bands: Vec<EqBand>,
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            bands: EQ_FREQS.iter().map(|f| EqBand { freq: *f, gain_db: 0.0, q: EQ_DEFAULT_Q }).collect(),
        }
    }
}

/// Peaking biquads for the non-flat bands that fit below `0.49 * sample_rate`
/// (also usable for drawing the response curve).
pub fn eq_cascade(s: &EqSettings, sample_rate: f64) -> Vec<Coeffs> {
    s.bands
        .iter()
        .filter(|b| b.gain_db.is_finite() && b.gain_db.abs() >= 0.01)
        .filter(|b| b.freq > 0.0 && (b.freq as f64) < 0.49 * sample_rate)
        .map(|b| Coeffs::new(BiquadKind::Peaking, b.freq as f64, b.q as f64, b.gain_db as f64, sample_rate))
        .collect()
}

/// Bit-identical when disabled or flat.
pub fn apply_eq(buf: &mut AudioBuffer, s: &EqSettings) {
    if !s.enabled {
        return;
    }
    let cascade = eq_cascade(s, buf.sample_rate as f64);
    process_cascade(buf, &cascade);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{to_db, tone_amplitude};
    use crate::signals::{sine, white_noise};

    const SR: u32 = 48000;

    fn gain_at(s: &EqSettings, f: f64) -> f64 {
        let mut x = sine(f, SR, 1.2, 0.25);
        apply_eq(&mut x, s);
        let steady = x.slice(SR as usize / 5, x.frames());
        to_db(tone_amplitude(&steady, f) / 0.25)
    }

    #[test]
    fn each_band_boosts_and_cuts_at_its_centre() {
        for (i, f) in EQ_FREQS.iter().enumerate() {
            for g in [6.0f32, -6.0] {
                let mut s = EqSettings { enabled: true, ..Default::default() };
                s.bands[i].gain_db = g;
                let m = gain_at(&s, *f as f64);
                assert!((m - g as f64).abs() < 0.5, "band {f} Hz {g} dB measured {m}");
            }
        }
    }

    #[test]
    fn combined_bands_match_response() {
        let mut s = EqSettings { enabled: true, ..Default::default() };
        for (i, b) in s.bands.iter_mut().enumerate() {
            b.gain_db = if i % 2 == 0 { 4.0 } else { -3.0 };
        }
        let cascade = eq_cascade(&s, SR as f64);
        assert_eq!(cascade.len(), 16);
        for f in [100.0, 1000.0, 3000.0] {
            let expected: f64 = cascade.iter().map(|c| c.magnitude_db(f, SR as f64)).sum();
            let m = gain_at(&s, f);
            assert!((m - expected).abs() < 0.2, "{f}: {m} vs {expected}");
        }
    }

    #[test]
    fn flat_or_disabled_is_bit_identical() {
        let x = white_noise(SR, 0.2, 0.5, 4).with_channels(2);
        let mut a = x.clone();
        apply_eq(&mut a, &EqSettings { enabled: true, ..Default::default() });
        assert_eq!(a, x);
        let mut s = EqSettings::default();
        s.bands[3].gain_db = 12.0;
        let mut b = x.clone();
        apply_eq(&mut b, &s);
        assert_eq!(b, x);
        // Tiny gains are treated as flat.
        let mut t = EqSettings { enabled: true, ..Default::default() };
        t.bands[5].gain_db = 0.001;
        let mut c = x.clone();
        apply_eq(&mut c, &t);
        assert_eq!(c, x);
    }

    #[test]
    fn bands_above_nyquist_limit_are_skipped() {
        let mut s = EqSettings { enabled: true, ..Default::default() };
        for b in &mut s.bands {
            b.gain_db = 6.0;
        }
        // At 22050 Hz, 0.49 fs = 10804.5 Hz: the 16k and 20k bands are dropped.
        let c = eq_cascade(&s, 22050.0);
        assert_eq!(c.len(), 14);
        let mut x = sine(1000.0, 22050, 0.2, 0.25);
        apply_eq(&mut x, &s);
        assert!(x.channels[0].iter().all(|v| v.is_finite()));
        assert_eq!(eq_cascade(&s, 8000.0).len(), 11);
    }

    #[test]
    fn serde_names_and_defaults() {
        let s: EqSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, EqSettings::default());
        assert!(!s.enabled);
        assert_eq!(s.bands.len(), 16);
        assert_eq!(s.bands[8], EqBand { freq: 1000.0, gain_db: 0.0, q: 1.4 });
        let b: EqBand = serde_json::from_str(r#"{"freq":63,"gainDb":-4.5}"#).unwrap();
        assert_eq!(b, EqBand { freq: 63.0, gain_db: -4.5, q: EQ_DEFAULT_Q });
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"gainDb\""));
        assert_eq!(serde_json::from_str::<EqSettings>(&json).unwrap(), s);
    }
}
