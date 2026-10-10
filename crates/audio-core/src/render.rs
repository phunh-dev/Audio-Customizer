//! Per-session renderer: master pipeline with caches, export encoding,
//! optional "preview as exported" and analysis of the final result.
//!
//! Master pipeline: mix -> master effects -> loop -> trimSilence.

use crate::analysis::{self, Spectrogram};
use crate::buffer::AudioBuffer;
use crate::chain::{hash_parts, process_chain, stage_key, StageCache};
use crate::decode::decode_bytes;
use crate::dsp;
use crate::encode::{export_bytes, ExportOptions};
use crate::error::Result;
use crate::mix::{mix_project, SourceMap};
use crate::project::Project;
use std::collections::HashMap;
use std::sync::Arc;

/// Number of log bands of `RenderOutput::average_spectrum`.
pub const AVERAGE_SPECTRUM_BANDS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RenderSizes {
    pub peaks_buckets: usize,
    pub spectrogram_width: usize,
    pub spectrogram_height: usize,
}

impl Default for RenderSizes {
    fn default() -> Self {
        Self { peaks_buckets: 1000, spectrogram_width: 512, spectrogram_height: 128 }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Analysis {
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: usize,
    pub peaks: Vec<f32>,
    pub spectrogram: Spectrogram,
    pub peak_db: f32,
    pub lufs: Option<f64>,
    pub average_spectrum: Vec<f32>,
}

pub fn analyze(buf: &AudioBuffer, sizes: RenderSizes) -> Analysis {
    Analysis {
        duration: buf.duration_secs(),
        sample_rate: buf.sample_rate,
        channels: buf.num_channels(),
        peaks: analysis::peaks(buf, sizes.peaks_buckets),
        spectrogram: analysis::spectrogram(buf, sizes.spectrogram_width, sizes.spectrogram_height),
        peak_db: analysis::to_db(buf.peak() as f64) as f32,
        lufs: if buf.is_empty() { None } else { dsp::gain::integrated_lufs(buf) },
        average_spectrum: analysis::average_spectrum(buf, AVERAGE_SPECTRUM_BANDS),
    }
}

#[derive(Clone, Debug)]
pub struct RenderOutput {
    /// What is played and analysed (the exported result when previewing).
    pub buffer: Arc<AudioBuffer>,
    pub key: u64,
    pub analysis: Analysis,
}

fn options_json(o: &ExportOptions) -> String {
    serde_json::to_string(o).unwrap_or_default()
}

#[derive(Default, Debug)]
pub struct Renderer {
    cache: StageCache,
    preview: Option<(u64, Arc<AudioBuffer>)>,
    encoded: Option<(u64, Arc<Vec<u8>>)>,
    runs: HashMap<String, u64>,
}

impl Renderer {
    pub fn new() -> Self {
        Self::default()
    }

    fn count(&mut self, stage: &str) {
        *self.runs.entry(stage.to_string()).or_insert(0) += 1;
    }

    /// Times each stage actually ran (cache misses), including chain
    /// stages, "mix", "loop", "trimSilence", "encode" and "preview".
    pub fn stats(&self) -> HashMap<String, u64> {
        let mut s = self.cache.stats();
        for (k, v) in &self.runs {
            *s.entry(k.clone()).or_insert(0) += v;
        }
        s
    }

    pub fn runs(&self, stage: &str) -> u64 {
        self.stats().get(stage).copied().unwrap_or(0)
    }

    /// Cached buffers currently held.
    pub fn cached_entries(&self) -> usize {
        self.cache.len() + usize::from(self.preview.is_some()) + usize::from(self.encoded.is_some())
    }

    /// Free every cache (tab sleep).
    pub fn clear(&mut self) {
        self.cache.clear();
        self.preview = None;
        self.encoded = None;
    }

    /// Final master buffer (before export conversion) and its key.
    pub fn master(&mut self, project: &Project, sources: &SourceMap) -> Result<(Arc<AudioBuffer>, u64)> {
        self.cache.begin_pass();
        let r = self.master_inner(project, sources);
        self.cache.end_pass();
        r
    }

    fn master_inner(&mut self, project: &Project, sources: &SourceMap) -> Result<(Arc<AudioBuffer>, u64)> {
        let (mix, key) = mix_project(&mut self.cache, project, sources)?;
        let (mut buf, mut key) = process_chain(&mut self.cache, mix, key, &project.master.effects)?;
        let l = &project.master.loop_settings;
        if l.enabled && !buf.is_empty() {
            key = stage_key(key, "loop", &serde_json::to_string(l).unwrap_or_default());
            let src = buf.clone();
            buf = self.cache.get_or_run(key, "loop", || dsp::loop_builder::build_loop(&src, l))?;
        }
        let t = &project.master.trim_silence;
        if t.enabled && !buf.is_empty() {
            key = stage_key(key, "trimSilence", &serde_json::to_string(t).unwrap_or_default());
            let src = buf.clone();
            buf = self.cache.get_or_run(key, "trimSilence", || Ok(dsp::silence::trim_silence(&src, t)))?;
        }
        Ok((buf, key))
    }

    fn encode_master(&mut self, master: &AudioBuffer, key: u64, options: &ExportOptions) -> Result<Arc<Vec<u8>>> {
        let ekey = hash_parts(&[&key, &"encode", &options_json(options)]);
        if let Some((k, bytes)) = &self.encoded {
            if *k == ekey {
                return Ok(bytes.clone());
            }
        }
        let bytes = Arc::new(export_bytes(master, options)?);
        self.count("encode");
        self.encoded = Some((ekey, bytes.clone()));
        Ok(bytes)
    }

    /// Encoded bytes of the project with the given export options.
    pub fn encode(&mut self, project: &Project, sources: &SourceMap, options: &ExportOptions) -> Result<Arc<Vec<u8>>> {
        let (master, key) = self.master(project, sources)?;
        self.encode_master(&master, key, options)
    }

    /// Exact size in bytes of the exported file.
    pub fn estimate_size(&mut self, project: &Project, sources: &SourceMap, options: &ExportOptions) -> Result<u64> {
        Ok(self.encode(project, sources, options)?.len() as u64)
    }

    /// Render the project; with `preview` the result is encoded with those
    /// options and decoded back, so playback/analysis match the export.
    pub fn render(
        &mut self,
        project: &Project,
        sources: &SourceMap,
        preview: Option<&ExportOptions>,
        sizes: RenderSizes,
    ) -> Result<RenderOutput> {
        let (master, key) = self.master(project, sources)?;
        let (buffer, key) = match preview {
            None => (master, key),
            Some(opts) if master.is_empty() => {
                // Nothing to encode: validate the options anyway.
                crate::encode::validate(opts, master.sample_rate, master.num_channels())?;
                (master, key)
            }
            Some(opts) => {
                let pkey = hash_parts(&[&key, &"preview", &options_json(opts)]);
                match &self.preview {
                    Some((k, b)) if *k == pkey => (b.clone(), pkey),
                    _ => {
                        let bytes = self.encode_master(&master, key, opts)?;
                        let decoded = decode_bytes(bytes.to_vec(), opts.format.extension())?;
                        self.count("preview");
                        let b = Arc::new(decoded.buffer);
                        self.preview = Some((pkey, b.clone()));
                        (b, pkey)
                    }
                }
            }
        };
        let analysis = analyze(&buffer, sizes);
        Ok(RenderOutput { buffer, key, analysis })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode::{ChannelMode, ExportFormat};
    use crate::mix::SourceRef;
    use crate::project::Track;
    use crate::signals;

    fn setup(buf: AudioBuffer) -> (Project, SourceMap) {
        let mut sources = SourceMap::new();
        sources.insert("a".into(), SourceRef { buffer: Arc::new(buf), generation: 1 });
        let mut p = Project::default();
        p.tracks.push(Track::new("t1", "a"));
        (p, sources)
    }

    fn small() -> RenderSizes {
        RenderSizes { peaks_buckets: 100, spectrogram_width: 32, spectrogram_height: 16 }
    }

    #[test]
    fn render_produces_analysis() {
        let (p, s) = setup(signals::sine(1000.0, 16_000, 1.0, 0.5));
        let mut r = Renderer::new();
        let out = r.render(&p, &s, None, small()).unwrap();
        let a = &out.analysis;
        assert!((a.duration - 1.0).abs() < 1e-9);
        assert_eq!(a.sample_rate, 16_000);
        assert_eq!(a.channels, 1);
        assert_eq!(a.peaks.len(), 200);
        assert_eq!(a.spectrogram.width, 32);
        assert_eq!(a.spectrogram.height, 16);
        assert_eq!(a.spectrogram.data.len(), 32 * 16);
        assert!((a.peak_db - (-6.02)).abs() < 0.1, "{}", a.peak_db);
        assert_eq!(a.average_spectrum.len(), AVERAGE_SPECTRUM_BANDS);
    }

    #[test]
    fn render_cache_reuse_and_invalidation() {
        let (mut p, s) = setup(signals::sine(440.0, 8000, 0.5, 0.5));
        p.tracks[0].effects.volume.gain_db = -2.0;
        p.master.effects.volume.gain_db = -1.0;
        let mut r = Renderer::new();
        let a = r.render(&p, &s, None, small()).unwrap();
        let b = r.render(&p, &s, None, small()).unwrap();
        assert!(Arc::ptr_eq(&a.buffer, &b.buffer));
        assert_eq!(a.key, b.key);
        assert_eq!(r.runs("mix"), 1);
        assert_eq!(r.runs("volume"), 2, "track + master volume ran once each");
        // Master-only change: mix stays cached.
        p.master.effects.volume.gain_db = -4.0;
        let c = r.render(&p, &s, None, small()).unwrap();
        assert_ne!(c.key, a.key);
        assert_eq!(r.runs("mix"), 1);
        assert_eq!(r.runs("volume"), 3);
        // Track change: mix + master rerun.
        p.tracks[0].effects.volume.gain_db = -3.0;
        r.render(&p, &s, None, small()).unwrap();
        assert_eq!(r.runs("mix"), 2);
        assert_eq!(r.runs("volume"), 5);
    }

    #[test]
    fn loop_and_trim_stages() {
        let mut buf = signals::silence(8000, 1, 0.5);
        buf.append(&signals::sine(440.0, 8000, 1.0, 0.5));
        buf.append(&signals::silence(8000, 1, 0.5));
        let (mut p, s) = setup(buf);
        p.master.trim_silence.enabled = true;
        p.master.trim_silence.pad_ms = 0.0;
        let mut r = Renderer::new();
        let out = r.render(&p, &s, None, small()).unwrap();
        assert!(out.analysis.duration < 1.1, "{}", out.analysis.duration);
        assert_eq!(r.runs("trimSilence"), 1);
        p.master.loop_settings.enabled = true;
        p.master.loop_settings.crossfade_ms = 100.0;
        let looped = r.render(&p, &s, None, small()).unwrap();
        assert_eq!(r.runs("loop"), 1);
        assert_eq!(r.runs("trimSilence"), 2);
        assert!(looped.analysis.duration < 2.0);
        r.render(&p, &s, None, small()).unwrap();
        assert_eq!(r.runs("loop"), 1);
    }

    #[test]
    fn preview_matches_export_and_is_cached() {
        let (p, s) = setup(AudioBuffer::from_channels(
            44_100,
            vec![signals::sine(440.0, 44_100, 0.5, 0.5).channels[0].clone(), vec![0.0; 22_050]],
        ));
        let opts = ExportOptions {
            format: ExportFormat::Wav,
            sample_rate: 22_050,
            channels: ChannelMode::Mono,
            bit_depth: 16,
            ..Default::default()
        };
        let mut r = Renderer::new();
        let out = r.render(&p, &s, Some(&opts), small()).unwrap();
        assert_eq!(out.analysis.sample_rate, 22_050);
        assert_eq!(out.analysis.channels, 1);
        assert_eq!(out.buffer.frames(), 11_025);
        assert_eq!(r.runs("preview"), 1);
        assert_eq!(r.runs("encode"), 1);
        let again = r.render(&p, &s, Some(&opts), small()).unwrap();
        assert!(Arc::ptr_eq(&out.buffer, &again.buffer));
        assert_eq!(r.runs("preview"), 1);
        // The bytes used for the preview are reused by estimate/export.
        let size = r.estimate_size(&p, &s, &opts).unwrap();
        assert_eq!(r.runs("encode"), 1);
        assert_eq!(size, 44 + 11_025 * 2);
        // Without preview we get the master again.
        let plain = r.render(&p, &s, None, small()).unwrap();
        assert_eq!(plain.analysis.sample_rate, 44_100);
        assert_eq!(plain.analysis.channels, 2);
    }

    #[test]
    fn preview_lossy_round_trip() {
        let (p, s) = setup(signals::sine(440.0, 44_100, 0.5, 0.5));
        let opts = ExportOptions { format: ExportFormat::Mp3, bitrate_kbps: 128, ..Default::default() };
        let mut r = Renderer::new();
        let out = r.render(&p, &s, Some(&opts), small()).unwrap();
        assert_eq!(out.analysis.sample_rate, 44_100);
        assert!((analysis::tone_amplitude(&out.buffer, 440.0) - 0.5).abs() < 0.05);
    }

    #[test]
    fn invalid_preview_options_error() {
        let (p, s) = setup(signals::sine(440.0, 44_100, 0.1, 0.5));
        let opts = ExportOptions { bit_depth: 12, ..Default::default() };
        let e = Renderer::new().render(&p, &s, Some(&opts), small()).unwrap_err();
        assert_eq!(e.code(), "ERR_INVALID_PARAM");
        let mut p2 = p.clone();
        p2.tracks[0].mute = true;
        let e = Renderer::new().render(&p2, &s, Some(&opts), small()).unwrap_err();
        assert_eq!(e.code(), "ERR_INVALID_PARAM");
    }

    #[test]
    fn all_muted_renders_empty_and_cannot_export() {
        let (mut p, s) = setup(signals::sine(440.0, 8000, 0.1, 0.5));
        p.tracks[0].mute = true;
        let mut r = Renderer::new();
        let out = r.render(&p, &s, Some(&ExportOptions::default()), small()).unwrap();
        assert_eq!(out.analysis.duration, 0.0);
        assert_eq!(out.analysis.lufs, None);
        let e = r.estimate_size(&p, &s, &ExportOptions::default()).unwrap_err();
        assert_eq!(e.code(), "ERR_EMPTY_PROJECT");
    }

    #[test]
    fn clear_frees_caches() {
        let (mut p, s) = setup(signals::sine(440.0, 8000, 0.1, 0.5));
        p.tracks[0].effects.volume.gain_db = -1.0;
        let mut r = Renderer::new();
        r.render(&p, &s, Some(&ExportOptions::default()), small()).unwrap();
        assert!(r.cached_entries() > 0);
        r.clear();
        assert_eq!(r.cached_entries(), 0);
        r.render(&p, &s, None, small()).unwrap();
        assert_eq!(r.runs("volume"), 2, "recomputed after clear");
    }

    #[test]
    fn lufs_reported() {
        let (p, s) = setup(signals::sine(1000.0, 48_000, 2.0, 0.5));
        let out = Renderer::new().render(&p, &s, None, small()).unwrap();
        let l = out.analysis.lufs.expect("lufs");
        assert!(l < -3.0 && l > -12.0, "{l}");
    }

    #[test]
    fn render_sizes_default() {
        let d = RenderSizes::default();
        assert!(d.peaks_buckets > 0 && d.spectrogram_width > 0 && d.spectrogram_height > 0);
    }
}
