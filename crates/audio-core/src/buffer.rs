//! Planar floating point audio buffer used across the engine.

#[derive(Clone, Debug, PartialEq)]
pub struct AudioBuffer {
    pub sample_rate: u32,
    /// One `Vec` per channel, all of equal length.
    pub channels: Vec<Vec<f32>>,
}

impl AudioBuffer {
    pub fn new(sample_rate: u32, num_channels: usize, frames: usize) -> Self {
        Self { sample_rate, channels: vec![vec![0.0; frames]; num_channels.max(1)] }
    }

    pub fn from_channels(sample_rate: u32, channels: Vec<Vec<f32>>) -> Self {
        debug_assert!(!channels.is_empty());
        debug_assert!(channels.iter().all(|c| c.len() == channels[0].len()));
        Self { sample_rate, channels }
    }

    pub fn mono(sample_rate: u32, samples: Vec<f32>) -> Self {
        Self { sample_rate, channels: vec![samples] }
    }

    pub fn from_interleaved(sample_rate: u32, num_channels: usize, data: &[f32]) -> Self {
        let n = num_channels.max(1);
        let frames = data.len() / n;
        let mut channels = vec![Vec::with_capacity(frames); n];
        for frame in data.chunks_exact(n) {
            for (c, s) in frame.iter().enumerate() {
                channels[c].push(*s);
            }
        }
        Self { sample_rate, channels }
    }

    pub fn frames(&self) -> usize {
        self.channels.first().map_or(0, Vec::len)
    }

    pub fn num_channels(&self) -> usize {
        self.channels.len()
    }

    pub fn duration_secs(&self) -> f64 {
        if self.sample_rate == 0 {
            return 0.0;
        }
        self.frames() as f64 / self.sample_rate as f64
    }

    pub fn is_empty(&self) -> bool {
        self.frames() == 0
    }

    pub fn to_interleaved(&self) -> Vec<f32> {
        let n = self.num_channels();
        let frames = self.frames();
        let mut out = Vec::with_capacity(n * frames);
        for i in 0..frames {
            for ch in &self.channels {
                out.push(ch[i]);
            }
        }
        out
    }

    /// Frames `[start, end)`, clamped to the buffer.
    pub fn slice(&self, start: usize, end: usize) -> AudioBuffer {
        let frames = self.frames();
        let s = start.min(frames);
        let e = end.clamp(s, frames);
        AudioBuffer {
            sample_rate: self.sample_rate,
            channels: self.channels.iter().map(|c| c[s..e].to_vec()).collect(),
        }
    }

    pub fn secs_to_frames(&self, secs: f64) -> usize {
        secs_to_frames(secs, self.sample_rate)
    }

    /// Average all channels into one.
    pub fn to_mono(&self) -> AudioBuffer {
        if self.num_channels() == 1 {
            return self.clone();
        }
        let n = self.num_channels() as f32;
        let frames = self.frames();
        let mut out = vec![0.0f32; frames];
        for ch in &self.channels {
            for (o, s) in out.iter_mut().zip(ch) {
                *o += *s;
            }
        }
        out.iter_mut().for_each(|s| *s /= n);
        AudioBuffer::mono(self.sample_rate, out)
    }

    /// Convert to `target` channels: mono is duplicated, extra channels are
    /// folded down by averaging into the requested layout.
    pub fn with_channels(&self, target: usize) -> AudioBuffer {
        let target = target.max(1);
        let cur = self.num_channels();
        if cur == target {
            return self.clone();
        }
        if target == 1 {
            return self.to_mono();
        }
        if cur == 1 {
            return AudioBuffer {
                sample_rate: self.sample_rate,
                channels: vec![self.channels[0].clone(); target],
            };
        }
        if cur > target {
            // Fold extra channels into the first `target` channels.
            let mut out: Vec<Vec<f32>> = self.channels[..target].to_vec();
            let mut counts = vec![1.0f32; target];
            for (i, ch) in self.channels[target..].iter().enumerate() {
                let dst = i % target;
                counts[dst] += 1.0;
                for (o, s) in out[dst].iter_mut().zip(ch) {
                    *o += *s;
                }
            }
            for (ch, c) in out.iter_mut().zip(counts) {
                ch.iter_mut().for_each(|s| *s /= c);
            }
            return AudioBuffer { sample_rate: self.sample_rate, channels: out };
        }
        // cur < target, cur > 1: keep channels and pad with silence.
        let mut out = self.channels.clone();
        out.resize(target, vec![0.0; self.frames()]);
        AudioBuffer { sample_rate: self.sample_rate, channels: out }
    }

    pub fn peak(&self) -> f32 {
        self.channels.iter().flat_map(|c| c.iter()).fold(0.0f32, |m, s| m.max(s.abs()))
    }

    pub fn rms(&self) -> f32 {
        let n = (self.frames() * self.num_channels()) as f64;
        if n == 0.0 {
            return 0.0;
        }
        let sum: f64 = self.channels.iter().flat_map(|c| c.iter()).map(|s| (*s as f64).powi(2)).sum();
        (sum / n).sqrt() as f32
    }

    pub fn scale(&mut self, gain: f32) {
        for ch in &mut self.channels {
            ch.iter_mut().for_each(|s| *s *= gain);
        }
    }

    /// Append another buffer of the same rate and channel count.
    pub fn append(&mut self, other: &AudioBuffer) {
        debug_assert_eq!(self.num_channels(), other.num_channels());
        for (a, b) in self.channels.iter_mut().zip(&other.channels) {
            a.extend_from_slice(b);
        }
    }
}

pub fn secs_to_frames(secs: f64, sample_rate: u32) -> usize {
    if secs <= 0.0 || !secs.is_finite() {
        0
    } else {
        (secs * sample_rate as f64).round() as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interleave_round_trip() {
        let b = AudioBuffer::from_channels(10, vec![vec![1.0, 2.0, 3.0], vec![-1.0, -2.0, -3.0]]);
        let inter = b.to_interleaved();
        assert_eq!(inter, vec![1.0, -1.0, 2.0, -2.0, 3.0, -3.0]);
        assert_eq!(AudioBuffer::from_interleaved(10, 2, &inter), b);
    }

    #[test]
    fn frames_duration_and_empty() {
        let b = AudioBuffer::new(48000, 2, 24000);
        assert_eq!(b.frames(), 24000);
        assert_eq!(b.num_channels(), 2);
        assert!((b.duration_secs() - 0.5).abs() < 1e-12);
        assert!(!b.is_empty());
        assert!(AudioBuffer::new(48000, 1, 0).is_empty());
        assert_eq!(AudioBuffer::new(0, 1, 10).duration_secs(), 0.0);
    }

    #[test]
    fn slice_is_clamped() {
        let b = AudioBuffer::mono(10, (0..10).map(|i| i as f32).collect());
        assert_eq!(b.slice(2, 5).channels[0], vec![2.0, 3.0, 4.0]);
        assert_eq!(b.slice(8, 100).frames(), 2);
        assert_eq!(b.slice(20, 30).frames(), 0);
        assert_eq!(b.slice(5, 2).frames(), 0);
    }

    #[test]
    fn mono_downmix_averages() {
        let b = AudioBuffer::from_channels(10, vec![vec![1.0, 0.0], vec![0.0, 1.0]]);
        assert_eq!(b.to_mono().channels, vec![vec![0.5, 0.5]]);
    }

    #[test]
    fn channel_conversion() {
        let m = AudioBuffer::mono(10, vec![0.25, 0.5]);
        let s = m.with_channels(2);
        assert_eq!(s.channels, vec![vec![0.25, 0.5], vec![0.25, 0.5]]);
        assert_eq!(s.with_channels(1).channels, vec![vec![0.25, 0.5]]);
        let quad = AudioBuffer::from_channels(10, vec![vec![1.0], vec![1.0], vec![3.0], vec![3.0]]);
        assert_eq!(quad.with_channels(2).channels, vec![vec![2.0], vec![2.0]]);
        let padded = s.with_channels(4);
        assert_eq!(padded.num_channels(), 4);
        assert_eq!(padded.channels[3], vec![0.0, 0.0]);
    }

    #[test]
    fn peak_rms_scale_append() {
        let mut b = AudioBuffer::mono(10, vec![0.5, -1.0, 0.5, 0.0]);
        assert_eq!(b.peak(), 1.0);
        assert!((b.rms() - (1.5f32 / 4.0).sqrt()).abs() < 1e-6);
        b.scale(0.5);
        assert_eq!(b.peak(), 0.5);
        b.append(&AudioBuffer::mono(10, vec![0.1]));
        assert_eq!(b.frames(), 5);
        assert_eq!(AudioBuffer::new(10, 1, 0).rms(), 0.0);
    }

    #[test]
    fn secs_to_frames_handles_edge_cases() {
        assert_eq!(secs_to_frames(1.0, 44100), 44100);
        assert_eq!(secs_to_frames(-1.0, 44100), 0);
        assert_eq!(secs_to_frames(f64::NAN, 44100), 0);
        assert_eq!(AudioBuffer::new(1000, 1, 1).secs_to_frames(0.0105), 11);
    }
}
