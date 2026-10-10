//! Offline band-limited (windowed-sinc, Kaiser) sample rate conversion.

use crate::buffer::AudioBuffer;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ResampleQuality {
    Fast,
    #[default]
    Balanced,
    Best,
}

struct Params {
    half_taps: usize,
    oversample: usize,
    rolloff: f64,
    beta: f64,
}

fn params(q: ResampleQuality) -> Params {
    match q {
        ResampleQuality::Fast => Params { half_taps: 8, oversample: 256, rolloff: 0.90, beta: 6.0 },
        ResampleQuality::Balanced => Params { half_taps: 24, oversample: 512, rolloff: 0.94, beta: 8.0 },
        ResampleQuality::Best => Params { half_taps: 64, oversample: 1024, rolloff: 0.97, beta: 10.0 },
    }
}

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let y = x * x / 4.0;
    for k in 1..50 {
        term *= y / (k as f64 * k as f64);
        sum += term;
        if term < 1e-12 * sum {
            break;
        }
    }
    sum
}

/// Windowed sinc table indexed by `u * oversample` for `u` in `[0, half_taps]`.
fn build_table(p: &Params) -> Vec<f64> {
    let len = p.half_taps * p.oversample + 2;
    let i0_beta = bessel_i0(p.beta);
    (0..len)
        .map(|i| {
            let u = i as f64 / p.oversample as f64;
            if u >= p.half_taps as f64 {
                return 0.0;
            }
            let sinc = if u == 0.0 { 1.0 } else { (PI * u).sin() / (PI * u) };
            let r = u / p.half_taps as f64;
            let w = bessel_i0(p.beta * (1.0 - r * r).max(0.0).sqrt()) / i0_beta;
            sinc * w
        })
        .collect()
}

pub fn resample(buf: &AudioBuffer, target_rate: u32, quality: ResampleQuality) -> AudioBuffer {
    if target_rate == 0 || target_rate == buf.sample_rate || buf.is_empty() {
        let mut out = buf.clone();
        if target_rate != 0 {
            out.sample_rate = target_rate;
        }
        return out;
    }
    let ratio = target_rate as f64 / buf.sample_rate as f64;
    AudioBuffer { sample_rate: target_rate, channels: resample_channels(buf, ratio, quality) }
}

/// Resample by an arbitrary ratio (output frames per input frame) while
/// keeping the declared sample rate. Used for varispeed / pitch shifting:
/// the output length is `round(frames * ratio_out_per_in)`.
pub fn resample_by_ratio(buf: &AudioBuffer, ratio_out_per_in: f64, quality: ResampleQuality) -> AudioBuffer {
    if !ratio_out_per_in.is_finite() || ratio_out_per_in <= 0.0 || ratio_out_per_in == 1.0 || buf.is_empty() {
        return buf.clone();
    }
    AudioBuffer { sample_rate: buf.sample_rate, channels: resample_channels(buf, ratio_out_per_in, quality) }
}

fn resample_channels(buf: &AudioBuffer, ratio: f64, quality: ResampleQuality) -> Vec<Vec<f32>> {
    let p = params(quality);
    let table = build_table(&p);
    let cutoff = ratio.min(1.0) * p.rolloff;
    let half_width = p.half_taps as f64 / cutoff;
    let in_len = buf.frames();
    let out_len = (in_len as f64 * ratio).round() as usize;
    let os = p.oversample as f64;

    buf.channels
        .iter()
        .map(|input| {
            let mut out = Vec::with_capacity(out_len);
            for n in 0..out_len {
                let t = n as f64 / ratio;
                let k_min = ((t - half_width).ceil().max(0.0)) as usize;
                let k_max = ((t + half_width).floor() as isize).min(in_len as isize - 1);
                let mut acc = 0.0f64;
                let mut wsum = 0.0f64;
                if k_max >= k_min as isize {
                    for (k, sample) in input.iter().enumerate().take(k_max as usize + 1).skip(k_min) {
                        let u = ((t - k as f64) * cutoff).abs() * os;
                        let idx = u as usize;
                        if idx + 1 >= table.len() {
                            continue;
                        }
                        let frac = u - idx as f64;
                        let w = table[idx] + (table[idx + 1] - table[idx]) * frac;
                        acc += *sample as f64 * w;
                        wsum += w;
                    }
                }
                // Normalising by the weight sum keeps DC gain exactly 1 and
                // compensates the truncated kernel at the buffer edges.
                out.push(if wsum.abs() > 1e-9 { (acc / wsum) as f32 } else { 0.0 });
            }
            out
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::dominant_frequency;
    use crate::signals::{sine, silence};

    #[test]
    fn same_rate_is_identity() {
        let s = sine(440.0, 44100, 0.1, 0.5);
        assert_eq!(resample(&s, 44100, ResampleQuality::Best), s);
    }

    #[test]
    fn length_scales_with_ratio() {
        let s = silence(44100, 2, 1.0);
        let r = resample(&s, 48000, ResampleQuality::Fast);
        assert_eq!(r.frames(), 48000);
        assert_eq!(r.num_channels(), 2);
        assert_eq!(r.sample_rate, 48000);
        let d = resample(&s, 22050, ResampleQuality::Fast);
        assert_eq!(d.frames(), 22050);
    }

    #[test]
    fn sine_keeps_frequency_and_amplitude() {
        for q in [ResampleQuality::Fast, ResampleQuality::Balanced, ResampleQuality::Best] {
            for (from, to) in [(44100, 48000), (48000, 22050), (22050, 96000)] {
                let s = sine(1000.0, from, 0.5, 0.5);
                let r = resample(&s, to, q);
                let f = dominant_frequency(&r);
                assert!((f - 1000.0).abs() < 10.0, "{q:?} {from}->{to}: {f}");
                // Ignore edges where the kernel is truncated.
                let mid = r.slice(r.frames() / 4, r.frames() * 3 / 4);
                assert!((mid.peak() - 0.5).abs() < 0.02, "{q:?} {from}->{to}: {}", mid.peak());
            }
        }
    }

    #[test]
    fn downsampling_rejects_content_above_new_nyquist() {
        // 6 kHz cannot exist at 8 kHz sample rate; it must be filtered out, not aliased to 2 kHz.
        let s = sine(6000.0, 48000, 0.5, 0.5);
        let r = resample(&s, 8000, ResampleQuality::Best);
        let mid = r.slice(r.frames() / 4, r.frames() * 3 / 4);
        let db = 20.0 * (mid.peak() / 0.5).log10();
        assert!(db < -40.0, "alias level {db} dB");
    }

    #[test]
    fn dc_is_preserved() {
        let s = AudioBuffer::mono(44100, vec![0.25; 4410]);
        let r = resample(&s, 32000, ResampleQuality::Balanced);
        for v in &r.channels[0] {
            assert!((v - 0.25).abs() < 1e-4);
        }
    }

    #[test]
    fn resample_by_ratio_changes_length_and_pitch() {
        let s = sine(1000.0, 48000, 0.5, 0.5);
        let up = resample_by_ratio(&s, 2.0, ResampleQuality::Balanced);
        assert_eq!(up.frames(), 48000);
        assert_eq!(up.sample_rate, 48000);
        assert!((dominant_frequency(&up) - 500.0).abs() < 5.0);
        let down = resample_by_ratio(&s, 0.5, ResampleQuality::Balanced);
        assert_eq!(down.frames(), 12000);
        assert!((dominant_frequency(&down) - 2000.0).abs() < 20.0);
        assert_eq!(resample_by_ratio(&s, 1.0, ResampleQuality::Fast), s);
        assert_eq!(resample_by_ratio(&s, 0.0, ResampleQuality::Fast), s);
        assert_eq!(resample_by_ratio(&s, f64::NAN, ResampleQuality::Fast), s);
    }

    #[test]
    fn zero_target_rate_or_empty_is_noop() {
        let s = sine(440.0, 44100, 0.01, 0.5);
        assert_eq!(resample(&s, 0, ResampleQuality::Fast), s);
        let e = AudioBuffer::new(44100, 1, 0);
        assert_eq!(resample(&e, 48000, ResampleQuality::Fast).sample_rate, 48000);
    }
}
