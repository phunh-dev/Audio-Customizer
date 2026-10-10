//! Pass / notch / shelf filters built from biquad cascades.

use crate::buffer::AudioBuffer;
use crate::dsp::biquad::{process_cascade, BiquadKind, Coeffs};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum FilterType {
    #[default]
    Highpass,
    Lowpass,
    Bandpass,
    Notch,
    Lowshelf,
    Highshelf,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FilterBand {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: FilterType,
    pub freq: f32,
    pub q: f32,
    /// 12, 24 or 48 dB/oct.
    pub slope: u8,
    pub gain_db: f32,
    pub enabled: bool,
}

impl Default for FilterBand {
    // 0.7071 is the contract's literal default (shown as-is in the UI).
    #[allow(clippy::approx_constant)]
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: FilterType::Highpass,
            freq: 100.0,
            q: 0.7071,
            slope: 12,
            gain_db: 0.0,
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FilterSettings {
    pub enabled: bool,
    pub items: Vec<FilterBand>,
}

/// Number of second-order stages for a slope in dB/oct (12 -> 1, 24 -> 2, 48 -> 4).
fn stages_for_slope(slope: u8) -> usize {
    match slope {
        0..=12 => 1,
        13..=24 => 2,
        _ => 4,
    }
}

/// Q of each biquad section of an order-`2 * stages` Butterworth filter.
fn butterworth_qs(stages: usize) -> Vec<f64> {
    let n = (2 * stages) as f64;
    (1..=stages).map(|k| 1.0 / (2.0 * (PI * (2.0 * k as f64 - 1.0) / (2.0 * n)).cos())).collect()
}

/// Biquad cascade for one band. HP/LP slopes above 12 dB/oct use Butterworth
/// section Qs (-3 dB at the cutoff); slope 12 uses the band's Q.
pub fn design(band: &FilterBand, sample_rate: f64) -> Vec<Coeffs> {
    let f = band.freq as f64;
    let q = band.q as f64;
    let g = band.gain_db as f64;
    let stages = stages_for_slope(band.slope);
    let pass = |kind: BiquadKind| -> Vec<Coeffs> {
        if stages == 1 {
            vec![Coeffs::new(kind, f, q, 0.0, sample_rate)]
        } else {
            butterworth_qs(stages).into_iter().map(|qk| Coeffs::new(kind, f, qk, 0.0, sample_rate)).collect()
        }
    };
    match band.kind {
        FilterType::Highpass => pass(BiquadKind::Highpass),
        FilterType::Lowpass => pass(BiquadKind::Lowpass),
        FilterType::Bandpass => vec![Coeffs::new(BiquadKind::Bandpass, f, q, 0.0, sample_rate); stages],
        FilterType::Notch => vec![Coeffs::new(BiquadKind::Notch, f, q, 0.0, sample_rate); stages],
        FilterType::Lowshelf => vec![Coeffs::new(BiquadKind::LowShelf, f, q, g, sample_rate)],
        FilterType::Highshelf => vec![Coeffs::new(BiquadKind::HighShelf, f, q, g, sample_rate)],
    }
}

/// Apply every enabled band in order. Bit-identical when disabled or empty.
pub fn apply_filters(buf: &mut AudioBuffer, s: &FilterSettings) {
    if !s.enabled {
        return;
    }
    let sr = buf.sample_rate as f64;
    let cascade: Vec<Coeffs> = s.items.iter().filter(|b| b.enabled).flat_map(|b| design(b, sr)).collect();
    process_cascade(buf, &cascade);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{to_db, tone_amplitude};
    use crate::signals::{sine, white_noise};

    const SR: u32 = 48000;

    fn band(kind: FilterType, freq: f32, slope: u8) -> FilterBand {
        FilterBand { kind, freq, slope, ..Default::default() }
    }

    fn response(d: &[Coeffs], f: f64) -> f64 {
        d.iter().map(|c| c.magnitude_db(f, SR as f64)).sum()
    }

    /// Process a 0.5-amplitude sine and measure the steady-state gain in dB.
    fn measured_db(b: &FilterBand, f: f64) -> f64 {
        let mut s = sine(f, SR, 0.6, 0.5);
        apply_filters(&mut s, &FilterSettings { enabled: true, items: vec![b.clone()] });
        let steady = s.slice(SR as usize / 5, s.frames());
        to_db(tone_amplitude(&steady, f) / 0.5)
    }

    #[test]
    fn butterworth_minus_3db_at_cutoff_and_slopes() {
        for kind in [FilterType::Highpass, FilterType::Lowpass] {
            for slope in [12u8, 24, 48] {
                let b = band(kind, 1000.0, slope);
                let d = design(&b, SR as f64);
                assert_eq!(d.len(), slope as usize / 12);
                let at_fc = response(&d, 1000.0);
                assert!((at_fc + 3.0).abs() < 0.5, "{kind:?} {slope}: {at_fc}");
                let octave = if kind == FilterType::Highpass { 500.0 } else { 2000.0 };
                let r = response(&d, octave);
                assert!((r + slope as f64).abs() < 2.0, "{kind:?} {slope}: {r} at one octave");
                // Pass band ~0 dB.
                let pass = if kind == FilterType::Highpass { 10000.0 } else { 100.0 };
                assert!(response(&d, pass).abs() < 0.2);
                // Measured on real signals.
                for f in [1000.0, octave, pass] {
                    let m = measured_db(&b, f);
                    let e = response(&d, f);
                    assert!((m - e).abs() < 0.3, "{kind:?} {slope} {f}: measured {m} expected {e}");
                }
            }
        }
    }

    #[test]
    fn butterworth_q_values() {
        let q2 = butterworth_qs(2);
        assert!((q2[0] - 0.5412).abs() < 1e-3 && (q2[1] - 1.3066).abs() < 1e-3);
        let q1 = butterworth_qs(1);
        assert!((q1[0] - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-9);
        assert_eq!(butterworth_qs(4).len(), 4);
        assert_eq!(stages_for_slope(6), 1);
        assert_eq!(stages_for_slope(36), 4);
    }

    #[test]
    fn bandpass_and_notch() {
        for slope in [12u8, 24] {
            let bp = FilterBand { q: 2.0, ..band(FilterType::Bandpass, 1000.0, slope) };
            assert!(measured_db(&bp, 1000.0).abs() < 0.3);
            let off = measured_db(&bp, 250.0);
            assert!(off < -10.0 * slope as f64 / 12.0, "{off}");
            let n = FilterBand { q: 2.0, ..band(FilterType::Notch, 1000.0, slope) };
            assert!(measured_db(&n, 1000.0) < -30.0);
            assert!(measured_db(&n, 100.0).abs() < 0.3);
            assert!(measured_db(&n, 8000.0).abs() < 0.3);
        }
    }

    #[test]
    fn shelves() {
        let ls = FilterBand { gain_db: 6.0, ..band(FilterType::Lowshelf, 200.0, 12) };
        assert_eq!(design(&ls, SR as f64).len(), 1);
        assert!((measured_db(&ls, 30.0) - 6.0).abs() < 0.3);
        assert!(measured_db(&ls, 8000.0).abs() < 0.3);
        let hs = FilterBand { gain_db: -6.0, ..band(FilterType::Highshelf, 4000.0, 48) };
        assert_eq!(design(&hs, SR as f64).len(), 1);
        assert!((measured_db(&hs, 20000.0) + 6.0).abs() < 0.5);
        assert!(measured_db(&hs, 100.0).abs() < 0.3);
    }

    #[test]
    fn disabled_is_bit_identical() {
        let s = white_noise(SR, 0.2, 0.5, 1).with_channels(2);
        let items = vec![band(FilterType::Highpass, 1000.0, 48)];
        let mut a = s.clone();
        apply_filters(&mut a, &FilterSettings { enabled: false, items: items.clone() });
        assert_eq!(a, s);
        let mut b = s.clone();
        apply_filters(&mut b, &FilterSettings { enabled: true, items: vec![] });
        assert_eq!(b, s);
        let mut c = s.clone();
        let off = FilterBand { enabled: false, ..items[0].clone() };
        apply_filters(&mut c, &FilterSettings { enabled: true, items: vec![off] });
        assert_eq!(c, s);
        let mut d = s.clone();
        apply_filters(&mut d, &FilterSettings { enabled: true, items });
        assert_ne!(d, s);
    }

    #[test]
    fn multiple_bands_combine() {
        let items = vec![band(FilterType::Highpass, 100.0, 24), band(FilterType::Lowpass, 5000.0, 24)];
        let mut s = sine(1000.0, SR, 0.5, 0.5);
        apply_filters(&mut s, &FilterSettings { enabled: true, items: items.clone() });
        assert!(to_db(tone_amplitude(&s.slice(4800, s.frames()), 1000.0) / 0.5).abs() < 0.2);
        let mut lo = sine(25.0, SR, 1.0, 0.5);
        apply_filters(&mut lo, &FilterSettings { enabled: true, items });
        assert!(to_db(tone_amplitude(&lo.slice(9600, lo.frames()), 25.0) / 0.5) < -20.0);
    }

    #[test]
    #[allow(clippy::approx_constant)]
    fn serde_names_and_defaults() {
        let b: FilterBand = serde_json::from_str("{}").unwrap();
        assert_eq!(b, FilterBand::default());
        assert_eq!((b.freq, b.q, b.slope, b.enabled), (100.0, 0.7071, 12, true));
        let b: FilterBand =
            serde_json::from_str(r#"{"id":"x","type":"lowshelf","freq":200,"q":1,"slope":24,"gainDb":4,"enabled":false}"#)
                .unwrap();
        assert_eq!(b.kind, FilterType::Lowshelf);
        assert_eq!(b.gain_db, 4.0);
        let json = serde_json::to_string(&b).unwrap();
        assert!(json.contains("\"type\":\"lowshelf\"") && json.contains("\"gainDb\":4"));
        let s: FilterSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, FilterSettings { enabled: false, items: vec![] });
        let s = FilterSettings { enabled: true, items: vec![b] };
        assert_eq!(serde_json::from_str::<FilterSettings>(&serde_json::to_string(&s).unwrap()).unwrap(), s);
        for (t, n) in [
            (FilterType::Highpass, "highpass"),
            (FilterType::Lowpass, "lowpass"),
            (FilterType::Bandpass, "bandpass"),
            (FilterType::Notch, "notch"),
            (FilterType::Lowshelf, "lowshelf"),
            (FilterType::Highshelf, "highshelf"),
        ] {
            assert_eq!(serde_json::to_string(&t).unwrap(), format!("\"{n}\""));
        }
    }
}
