//! Deterministic test signal generators (used by unit tests and fixtures).

use crate::buffer::AudioBuffer;
use std::f64::consts::PI;

pub fn sine(freq: f64, sample_rate: u32, secs: f64, amp: f32) -> AudioBuffer {
    let n = (secs * sample_rate as f64).round() as usize;
    let data = (0..n)
        .map(|i| (amp as f64 * (2.0 * PI * freq * i as f64 / sample_rate as f64).sin()) as f32)
        .collect();
    AudioBuffer::mono(sample_rate, data)
}

pub fn silence(sample_rate: u32, channels: usize, secs: f64) -> AudioBuffer {
    AudioBuffer::new(sample_rate, channels, (secs * sample_rate as f64).round() as usize)
}

/// Uniform white noise in `[-amp, amp]` from a fixed-seed xorshift generator.
pub fn white_noise(sample_rate: u32, secs: f64, amp: f32, seed: u64) -> AudioBuffer {
    let n = (secs * sample_rate as f64).round() as usize;
    let mut rng = Rng::new(seed);
    AudioBuffer::mono(sample_rate, (0..n).map(|_| amp * rng.next_bipolar()).collect())
}

/// Logarithmic sine sweep from `f0` to `f1`.
pub fn sweep(f0: f64, f1: f64, sample_rate: u32, secs: f64, amp: f32) -> AudioBuffer {
    let n = (secs * sample_rate as f64).round() as usize;
    let k = (f1 / f0).ln();
    let data = (0..n)
        .map(|i| {
            let t = i as f64 / sample_rate as f64;
            let phase = 2.0 * PI * f0 * secs / k * ((t / secs * k).exp() - 1.0);
            (amp as f64 * phase.sin()) as f32
        })
        .collect();
    AudioBuffer::mono(sample_rate, data)
}

pub fn impulse(sample_rate: u32, frames: usize, at: usize) -> AudioBuffer {
    let mut data = vec![0.0; frames];
    if at < frames {
        data[at] = 1.0;
    }
    AudioBuffer::mono(sample_rate, data)
}

/// Element-wise sum of two mono buffers of equal rate (length of the longer).
pub fn add(a: &AudioBuffer, b: &AudioBuffer) -> AudioBuffer {
    let n = a.frames().max(b.frames());
    let get = |buf: &AudioBuffer, i: usize| buf.channels[0].get(i).copied().unwrap_or(0.0);
    AudioBuffer::mono(a.sample_rate, (0..n).map(|i| get(a, i) + get(b, i)).collect())
}

/// Small deterministic PRNG (xorshift64*), also used for dithering.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in `[0, 1)`.
    pub fn next_unit(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }

    /// Uniform in `[-1, 1)`.
    pub fn next_bipolar(&mut self) -> f32 {
        self.next_unit() * 2.0 - 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_has_expected_length_and_amplitude() {
        let s = sine(1000.0, 48000, 0.5, 0.8);
        assert_eq!(s.frames(), 24000);
        assert!((s.peak() - 0.8).abs() < 1e-3);
        assert!((s.rms() - 0.8 / 2f32.sqrt()).abs() < 1e-3);
    }

    #[test]
    fn noise_is_deterministic_and_bounded() {
        let a = white_noise(8000, 0.1, 0.5, 7);
        let b = white_noise(8000, 0.1, 0.5, 7);
        assert_eq!(a, b);
        assert!(a.peak() <= 0.5);
        assert_ne!(a, white_noise(8000, 0.1, 0.5, 8));
    }

    #[test]
    fn rng_ranges() {
        let mut r = Rng::new(0);
        for _ in 0..10_000 {
            let u = r.next_unit();
            assert!((0.0..1.0).contains(&u));
            let b = r.next_bipolar();
            assert!((-1.0..1.0).contains(&b));
        }
    }

    #[test]
    fn other_generators() {
        assert_eq!(silence(100, 2, 1.0).frames(), 100);
        assert_eq!(silence(100, 2, 1.0).peak(), 0.0);
        let imp = impulse(100, 10, 3);
        assert_eq!(imp.channels[0][3], 1.0);
        assert_eq!(imp.peak(), 1.0);
        let sw = sweep(20.0, 2000.0, 8000, 1.0, 0.5);
        assert_eq!(sw.frames(), 8000);
        assert!(sw.peak() <= 0.5 + 1e-6);
        let sum = add(&AudioBuffer::mono(10, vec![1.0, 1.0]), &AudioBuffer::mono(10, vec![1.0]));
        assert_eq!(sum.channels[0], vec![2.0, 1.0]);
    }
}
