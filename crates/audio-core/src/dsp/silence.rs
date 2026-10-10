//! Leading / trailing silence trimming.

use crate::buffer::AudioBuffer;
use crate::dsp::gain::db_to_lin;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TrimSilenceSettings {
    pub enabled: bool,
    pub threshold_db: f32,
    pub pad_ms: f32,
}

impl Default for TrimSilenceSettings {
    fn default() -> Self {
        Self { enabled: false, threshold_db: -60.0, pad_ms: 10.0 }
    }
}

/// Remove leading and trailing frames whose samples are all below the
/// threshold, keeping `pad_ms` of context on each side. Returns an empty
/// buffer (same channel count) when everything is below the threshold.
pub fn trim_silence(buf: &AudioBuffer, s: &TrimSilenceSettings) -> AudioBuffer {
    if !s.enabled {
        return buf.clone();
    }
    let thr = db_to_lin(s.threshold_db);
    let frames = buf.frames();
    let loud = |i: usize| buf.channels.iter().any(|c| c[i].abs() >= thr);
    let Some(first) = (0..frames).find(|i| loud(*i)) else {
        return AudioBuffer { sample_rate: buf.sample_rate, channels: vec![Vec::new(); buf.num_channels()] };
    };
    let last = (0..frames).rev().find(|i| loud(*i)).unwrap_or(first);
    let pad = buf.secs_to_frames(s.pad_ms.max(0.0) as f64 / 1000.0);
    let start = first.saturating_sub(pad);
    let end = (last + 1 + pad).min(frames);
    buf.slice(start, end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signals::{sine, silence};

    fn padded(lead: f64, body: f64, tail: f64) -> AudioBuffer {
        let mut b = silence(1000, 1, lead);
        b.append(&AudioBuffer::mono(1000, vec![0.5; (body * 1000.0) as usize]));
        b.append(&silence(1000, 1, tail));
        b
    }

    #[test]
    fn trims_with_pad() {
        let b = padded(0.5, 0.2, 0.3);
        let s = TrimSilenceSettings { enabled: true, threshold_db: -60.0, pad_ms: 10.0 };
        let t = trim_silence(&b, &s);
        assert_eq!(t.frames(), 200 + 2 * 10);
        assert_eq!(t.channels[0][0], 0.0);
        assert_eq!(t.channels[0][10], 0.5);
        assert_eq!(t.channels[0][209], 0.5);
        assert_eq!(t.channels[0][210], 0.0);
        let no_pad = trim_silence(&b, &TrimSilenceSettings { pad_ms: 0.0, ..s.clone() });
        assert_eq!(no_pad.frames(), 200);
        // Pad larger than available silence is clamped to the buffer.
        let big = trim_silence(&b, &TrimSilenceSettings { pad_ms: 2000.0, ..s });
        assert_eq!(big, b);
    }

    #[test]
    fn threshold_is_respected_on_any_channel() {
        let mut st = AudioBuffer::new(1000, 2, 100);
        st.channels[1][40] = 0.01; // -40 dBFS
        st.channels[0][60] = 0.5;
        let s = TrimSilenceSettings { enabled: true, threshold_db: -50.0, pad_ms: 0.0 };
        let t = trim_silence(&st, &s);
        assert_eq!(t.frames(), 21);
        assert_eq!(t.num_channels(), 2);
        let t2 = trim_silence(&st, &TrimSilenceSettings { threshold_db: -20.0, ..s });
        assert_eq!(t2.frames(), 1);
    }

    #[test]
    fn all_silent_gives_empty_buffer() {
        let b = silence(44100, 2, 0.5);
        let t = trim_silence(&b, &TrimSilenceSettings { enabled: true, ..Default::default() });
        assert_eq!(t.frames(), 0);
        assert_eq!(t.num_channels(), 2);
        assert_eq!(t.sample_rate, 44100);
        let q = sine(440.0, 44100, 0.1, 0.0001); // -80 dBFS
        assert!(trim_silence(&q, &TrimSilenceSettings { enabled: true, ..Default::default() }).is_empty());
    }

    #[test]
    fn disabled_is_clone() {
        let b = padded(0.1, 0.1, 0.1);
        assert_eq!(trim_silence(&b, &TrimSilenceSettings::default()), b);
    }

    #[test]
    fn serde_names_and_defaults() {
        let s: TrimSilenceSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, TrimSilenceSettings { enabled: false, threshold_db: -60.0, pad_ms: 10.0 });
        let s: TrimSilenceSettings = serde_json::from_str(r#"{"enabled":true,"thresholdDb":-40,"padMs":5}"#).unwrap();
        assert_eq!(s, TrimSilenceSettings { enabled: true, threshold_db: -40.0, pad_ms: 5.0 });
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("thresholdDb") && json.contains("padMs"));
    }
}
