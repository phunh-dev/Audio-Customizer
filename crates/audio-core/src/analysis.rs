//! Analysis used for visualisation and tests: waveform peaks, spectrogram,
//! average spectrum, tone measurement.

use crate::buffer::AudioBuffer;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::f64::consts::PI;

pub const SPECTROGRAM_DB_FLOOR: f32 = -90.0;

/// Min/max pairs per bucket (`[min0, max0, min1, max1, ...]`) across all channels.
pub fn peaks(buf: &AudioBuffer, buckets: usize) -> Vec<f32> {
    let frames = buf.frames();
    let buckets = buckets.max(1);
    let mut out = Vec::with_capacity(buckets * 2);
    for b in 0..buckets {
        let s = b * frames / buckets;
        let e = ((b + 1) * frames / buckets).max(s + 1).min(frames);
        let (mut mn, mut mx) = (0.0f32, 0.0f32);
        if s < e {
            mn = f32::MAX;
            mx = f32::MIN;
            for ch in &buf.channels {
                for v in &ch[s..e] {
                    mn = mn.min(*v);
                    mx = mx.max(*v);
                }
            }
        }
        out.push(mn);
        out.push(mx);
    }
    out
}

pub fn hann(n: usize) -> Vec<f64> {
    (0..n).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).collect()
}

/// Amplitude spectrum (linear, a full-scale sine reads ~1.0) of `n` samples
/// centred at `center`, zero padded at the buffer edges.
fn amplitude_spectrum(mono: &[f32], center: isize, n: usize, window: &[f64], planner: &mut FftPlanner<f64>) -> Vec<f64> {
    let fft = planner.plan_fft_forward(n);
    let start = center - n as isize / 2;
    let mut data: Vec<Complex<f64>> = (0..n)
        .map(|i| {
            let idx = start + i as isize;
            let v = if idx >= 0 && (idx as usize) < mono.len() { mono[idx as usize] as f64 } else { 0.0 };
            Complex::new(v * window[i], 0.0)
        })
        .collect();
    fft.process(&mut data);
    let wsum: f64 = window.iter().sum();
    data[..n / 2 + 1].iter().map(|c| 2.0 * c.norm() / wsum).collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Spectrogram {
    pub width: u32,
    pub height: u32,
    /// Row-major, row 0 is the highest frequency. 0 = floor dB, 255 = 0 dBFS.
    pub data: Vec<u8>,
    pub min_freq: f32,
    pub max_freq: f32,
    pub db_floor: f32,
}

fn log_band_edges(min_f: f64, max_f: f64, bands: usize) -> Vec<f64> {
    (0..=bands).map(|i| min_f * (max_f / min_f).powf(i as f64 / bands as f64)).collect()
}

/// Reduce a linear amplitude spectrum to `edges.len() - 1` log bands (max of bins in each band).
fn spectrum_to_bands(spec: &[f64], edges: &[f64], bin_hz: f64) -> Vec<f64> {
    edges
        .windows(2)
        .map(|w| {
            let lo = w[0] / bin_hz;
            let hi = w[1] / bin_hz;
            let b0 = lo.floor() as usize;
            let b1 = (hi.ceil() as usize).min(spec.len() - 1);
            if b1 <= b0 + 1 {
                // Band narrower than a bin: interpolate at its centre.
                let c = ((lo + hi) / 2.0).min((spec.len() - 1) as f64);
                let i = c.floor() as usize;
                let f = c - i as f64;
                let j = (i + 1).min(spec.len() - 1);
                spec[i] * (1.0 - f) + spec[j] * f
            } else {
                spec[b0..=b1].iter().cloned().fold(0.0, f64::max)
            }
        })
        .collect()
}

fn amp_to_u8(amp: f64, floor_db: f32) -> u8 {
    let db = 20.0 * amp.max(1e-12).log10();
    let norm = ((db as f32 - floor_db) / -floor_db).clamp(0.0, 1.0);
    (norm * 255.0).round() as u8
}

pub fn spectrogram(buf: &AudioBuffer, width: usize, height: usize) -> Spectrogram {
    let width = width.max(1);
    let height = height.max(1);
    let mono = buf.to_mono();
    let samples = &mono.channels[0];
    let sr = buf.sample_rate.max(1) as f64;
    let n = if sr > 64_000.0 { 4096 } else { 2048 };
    let window = hann(n);
    let mut planner = FftPlanner::new();
    let min_f = 20.0f64;
    let max_f = (sr / 2.0).max(min_f * 2.0);
    let edges = log_band_edges(min_f, max_f, height);
    let bin_hz = sr / n as f64;
    let mut data = vec![0u8; width * height];
    let frames = samples.len();
    if frames > 0 {
        for col in 0..width {
            let center = ((col as f64 + 0.5) / width as f64 * frames as f64) as isize;
            let spec = amplitude_spectrum(samples, center, n, &window, &mut planner);
            let bands = spectrum_to_bands(&spec, &edges, bin_hz);
            for (r, amp) in bands.iter().enumerate() {
                let row = height - 1 - r;
                data[row * width + col] = amp_to_u8(*amp, SPECTROGRAM_DB_FLOOR);
            }
        }
    }
    Spectrogram {
        width: width as u32,
        height: height as u32,
        data,
        min_freq: min_f as f32,
        max_freq: max_f as f32,
        db_floor: SPECTROGRAM_DB_FLOOR,
    }
}

/// Long-term average spectrum in dB over `bands` log bands from 20 Hz to Nyquist.
pub fn average_spectrum(buf: &AudioBuffer, bands: usize) -> Vec<f32> {
    let mono = buf.to_mono();
    let samples = &mono.channels[0];
    let sr = buf.sample_rate.max(1) as f64;
    let n = 4096usize;
    let window = hann(n);
    let mut planner = FftPlanner::new();
    let mut acc = vec![0.0f64; n / 2 + 1];
    let hop = n / 2;
    let mut count = 0usize;
    let mut center = (n / 2) as isize;
    while (center as usize) < samples.len().max(1) || count == 0 {
        let spec = amplitude_spectrum(samples, center, n, &window, &mut planner);
        for (a, s) in acc.iter_mut().zip(&spec) {
            *a += s * s;
        }
        count += 1;
        center += hop as isize;
        if samples.is_empty() {
            break;
        }
    }
    let rms: Vec<f64> = acc.iter().map(|a| (a / count as f64).sqrt()).collect();
    let edges = log_band_edges(20.0, (sr / 2.0).max(40.0), bands.max(1));
    spectrum_to_bands(&rms, &edges, sr / n as f64)
        .into_iter()
        .map(|a| (20.0 * a.max(1e-12).log10()) as f32)
        .collect()
}

/// Frequency of the strongest spectral peak (parabolic interpolation).
pub fn dominant_frequency(buf: &AudioBuffer) -> f64 {
    let mono = buf.to_mono();
    let x = &mono.channels[0];
    let n = x.len().next_power_of_two().max(2);
    let window = hann(x.len().max(1));
    let mut data: Vec<Complex<f64>> = (0..n)
        .map(|i| Complex::new(if i < x.len() { x[i] as f64 * window[i] } else { 0.0 }, 0.0))
        .collect();
    FftPlanner::new().plan_fft_forward(n).process(&mut data);
    let mags: Vec<f64> = data[..n / 2].iter().map(|c| c.norm()).collect();
    let (k, _) = mags.iter().enumerate().skip(1).fold((1, 0.0), |acc, (i, m)| if *m > acc.1 { (i, *m) } else { acc });
    let (a, b, c) = (mags[k - 1], mags[k], mags.get(k + 1).copied().unwrap_or(0.0));
    let denom = a - 2.0 * b + c;
    let delta = if denom.abs() > 1e-12 { 0.5 * (a - c) / denom } else { 0.0 };
    (k as f64 + delta) * buf.sample_rate as f64 / n as f64
}

/// Amplitude of the sinusoidal component at `freq` (Hann-windowed DFT
/// probe over the whole buffer of the first channel's mono mix).
pub fn tone_amplitude(buf: &AudioBuffer, freq: f64) -> f64 {
    let mono = buf.to_mono();
    let x = &mono.channels[0];
    if x.is_empty() {
        return 0.0;
    }
    let w = hann(x.len());
    let sr = buf.sample_rate as f64;
    let (mut re, mut im) = (0.0, 0.0);
    for (i, v) in x.iter().enumerate() {
        let ph = 2.0 * PI * freq * i as f64 / sr;
        re += *v as f64 * w[i] * ph.cos();
        im -= *v as f64 * w[i] * ph.sin();
    }
    2.0 * (re * re + im * im).sqrt() / w.iter().sum::<f64>()
}

pub fn to_db(lin: f64) -> f64 {
    20.0 * lin.max(1e-12).log10()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signals::{add, sine, silence};

    #[test]
    fn peaks_report_min_max_per_bucket() {
        let b = AudioBuffer::mono(10, vec![0.1, -0.5, 0.9, 0.2, -0.1, 0.0]);
        let p = peaks(&b, 2);
        assert_eq!(p, vec![-0.5, 0.9, -0.1, 0.2]);
        let stereo = AudioBuffer::from_channels(10, vec![vec![0.5, 0.0], vec![-0.7, 0.1]]);
        assert_eq!(peaks(&stereo, 1), vec![-0.7, 0.5]);
        // More buckets than frames still yields the requested length.
        assert_eq!(peaks(&b, 20).len(), 40);
        assert_eq!(peaks(&AudioBuffer::new(10, 1, 0), 3), vec![0.0; 6]);
    }

    #[test]
    fn dominant_frequency_finds_sine() {
        for f in [100.0, 440.0, 1000.0, 5000.0] {
            let d = dominant_frequency(&sine(f, 44100, 0.5, 0.5));
            assert!((d - f).abs() < 2.0, "{f} -> {d}");
        }
    }

    #[test]
    fn tone_amplitude_measures_components() {
        let s = add(&sine(440.0, 48000, 1.0, 0.5), &sine(3000.0, 48000, 1.0, 0.25));
        assert!((tone_amplitude(&s, 440.0) - 0.5).abs() < 0.01);
        assert!((tone_amplitude(&s, 3000.0) - 0.25).abs() < 0.01);
        assert!(tone_amplitude(&s, 10000.0) < 0.001);
    }

    #[test]
    fn spectrogram_shows_sine_in_correct_row() {
        let s = sine(1000.0, 48000, 1.0, 1.0);
        let sp = spectrogram(&s, 16, 128);
        assert_eq!(sp.data.len(), 16 * 128);
        // Expected row for 1 kHz on the log axis.
        let r = ((1000f64 / 20.0).ln() / (24000f64 / 20.0).ln() * 128.0) as usize;
        let row = 127 - r;
        let col = 8;
        let (best_row, _) = (0..128).map(|y| (y, sp.data[y * 16 + col])).max_by_key(|(_, v)| *v).unwrap();
        assert!((best_row as isize - row as isize).abs() <= 1, "best {best_row} expected {row}");
        assert!(sp.data[best_row * 16 + col] > 240, "near 0 dBFS");
        // Far from the tone it must be near the floor.
        assert!(sp.data[5 * 16 + col] < 60);
    }

    #[test]
    fn spectrogram_of_silence_is_floor() {
        let sp = spectrogram(&silence(44100, 2, 0.2), 8, 32);
        assert!(sp.data.iter().all(|v| *v == 0));
        let empty = spectrogram(&AudioBuffer::new(44100, 1, 0), 4, 4);
        assert_eq!(empty.data.len(), 16);
    }

    #[test]
    fn spectrogram_changes_with_signal() {
        let a = spectrogram(&sine(500.0, 44100, 0.5, 0.5), 8, 64);
        let b = spectrogram(&sine(5000.0, 44100, 0.5, 0.5), 8, 64);
        assert_ne!(a.data, b.data);
    }

    #[test]
    fn average_spectrum_peaks_at_tone() {
        let s = sine(1000.0, 44100, 1.0, 0.5);
        let bands = average_spectrum(&s, 64);
        assert_eq!(bands.len(), 64);
        let (i, _) = bands.iter().enumerate().fold((0, f32::MIN), |a, (i, v)| if *v > a.1 { (i, *v) } else { a });
        let edges = log_band_edges(20.0, 22050.0, 64);
        assert!(edges[i] <= 1100.0 && edges[i + 1] >= 900.0, "band {i}: {}..{}", edges[i], edges[i + 1]);
        assert_eq!(average_spectrum(&AudioBuffer::new(44100, 1, 0), 8).len(), 8);
    }

    #[test]
    fn db_conversion() {
        assert!((to_db(1.0)).abs() < 1e-12);
        assert!((to_db(0.5) + 6.0206).abs() < 1e-3);
        assert!(to_db(0.0) <= -239.0);
    }
}
