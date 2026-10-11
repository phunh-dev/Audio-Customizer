//! Track rendering and mixing (contract section 2):
//! source -> resample to project rate -> clip -> track chain -> fades ->
//! gainDb -> pan -> placed at offset; overlapping tracks are summed.

use crate::buffer::{secs_to_frames, AudioBuffer};
use crate::chain::{hash_parts, process_chain, StageCache};
use crate::dsp;
use crate::dsp::resample::{resample, ResampleQuality};
use crate::error::{AudioError, Result};
use crate::project::{Project, Track};
use std::collections::HashMap;
use std::sync::Arc;

/// Quality used to bring sources to the project rate.
pub const SOURCE_RESAMPLE_QUALITY: ResampleQuality = ResampleQuality::Best;

/// A decoded source as seen by the renderer. `generation` changes whenever
/// the source is (re)loaded so caches never serve stale audio.
#[derive(Clone, Debug)]
pub struct SourceRef {
    pub buffer: Arc<AudioBuffer>,
    pub generation: u64,
}

pub type SourceMap = HashMap<String, SourceRef>;

fn lookup<'a>(sources: &'a SourceMap, track: &Track) -> Result<&'a SourceRef> {
    sources.get(&track.source_id).ok_or_else(|| AudioError::SourceNotLoaded(track.source_id.clone()))
}

/// Project sample rate and channel count: max source rate among audible
/// tracks; 2 channels if any audible source has >= 2 channels else 1.
/// With no audible track the format of all tracks with a loaded source is
/// used (fallback 44.1 kHz mono). A project without tracks is an error.
pub fn project_format(project: &Project, sources: &SourceMap) -> Result<(u32, usize)> {
    if project.tracks.is_empty() {
        return Err(AudioError::EmptyProject);
    }
    let audible = project.audible_tracks();
    if !audible.is_empty() {
        let mut rate = 0u32;
        let mut ch = 1usize;
        for t in audible {
            let s = lookup(sources, t)?;
            rate = rate.max(s.buffer.sample_rate);
            if s.buffer.num_channels() >= 2 {
                ch = 2;
            }
        }
        return Ok((rate.max(1), ch));
    }
    let rate = project
        .tracks
        .iter()
        .filter_map(|t| sources.get(&t.source_id))
        .map(|s| s.buffer.sample_rate)
        .max()
        .unwrap_or(44_100);
    Ok((rate, 1))
}

/// Clip range `[start, end)` in frames of a buffer with `frames` frames at `rate`.
pub fn clip_range(track: &Track, rate: u32, frames: usize) -> (usize, usize) {
    let start = secs_to_frames(track.clip_start, rate).min(frames);
    let end = match track.clip_end {
        Some(e) => secs_to_frames(e, rate).min(frames),
        None => frames,
    };
    (start, end.max(start))
}

/// Fades, gain, channel conversion and pan of an already processed track.
pub fn place_track(buf: &AudioBuffer, track: &Track, channels: usize) -> AudioBuffer {
    let mut b = buf.clone();
    dsp::fade::apply_fades(&mut b, &track.fade_in, &track.fade_out);
    if track.gain_db != 0.0 {
        dsp::gain::apply_gain_db(&mut b, track.gain_db);
    }
    let mut b = if b.num_channels() == channels { b } else { b.with_channels(channels) };
    if channels >= 2 && track.pan != 0.0 {
        dsp::gain::apply_pan(&mut b, track.pan.clamp(-1.0, 1.0));
    }
    b
}

/// Sum buffers placed at frame offsets into one buffer.
pub fn mix_buffers(rate: u32, channels: usize, items: &[(usize, &AudioBuffer)]) -> AudioBuffer {
    let len = items.iter().filter(|(_, b)| !b.is_empty()).map(|(o, b)| o + b.frames()).max().unwrap_or(0);
    let mut out = AudioBuffer::new(rate, channels, len);
    for (offset, b) in items {
        for (c, dst) in out.channels.iter_mut().enumerate() {
            let src = &b.channels[c.min(b.num_channels() - 1)];
            for (d, s) in dst[*offset..*offset + src.len()].iter_mut().zip(src) {
                *d += *s;
            }
        }
    }
    out
}

/// Resampled + clipped source for a track, cached.
fn track_input(cache: &mut StageCache, track: &Track, src: &SourceRef, rate: u32) -> Result<(Arc<AudioBuffer>, u64)> {
    let mut key = hash_parts(&[&"source", &track.source_id, &src.generation, &rate]);
    let buffer = src.buffer.clone();
    let resampled = if buffer.sample_rate == rate {
        buffer
    } else {
        cache.get_or_run(key, "resample", || Ok(resample(&buffer, rate, SOURCE_RESAMPLE_QUALITY)))?
    };
    let (start, end) = clip_range(track, rate, resampled.frames());
    if start == 0 && end == resampled.frames() {
        return Ok((resampled, key));
    }
    key = hash_parts(&[&key, &"clip", &start, &end]);
    let clipped = cache.get_or_run(key, "clip", || Ok(resampled.slice(start, end)))?;
    Ok((clipped, key))
}

/// Mix all audible tracks of the project. Returns the mix and its cache key.
pub fn mix_project(cache: &mut StageCache, project: &Project, sources: &SourceMap) -> Result<(Arc<AudioBuffer>, u64)> {
    let (rate, channels) = project_format(project, sources)?;
    let audible = project.audible_tracks();
    let mut processed = Vec::with_capacity(audible.len());
    let mut mix_key = hash_parts(&[&"mix", &rate, &channels]);
    for track in audible {
        let src = lookup(sources, track)?;
        let (input, key) = track_input(cache, track, src, rate)?;
        let (out, chain_key) = process_chain(cache, input, key, &track.effects)?;
        let offset = secs_to_frames(track.offset, rate);
        let place = serde_json::to_string(&(&track.fade_in, &track.fade_out, track.gain_db, track.pan)).unwrap_or_default();
        mix_key = hash_parts(&[&mix_key, &chain_key, &offset, &place]);
        processed.push((track, out, offset));
    }
    let mixed = cache.get_or_run(mix_key, "mix", || {
        let placed: Vec<(usize, AudioBuffer)> =
            processed.iter().map(|(t, b, o)| (*o, place_track(b, t, channels))).collect();
        let refs: Vec<(usize, &AudioBuffer)> = placed.iter().map(|(o, b)| (*o, b)).collect();
        Ok(mix_buffers(rate, channels, &refs))
    })?;
    Ok((mixed, mix_key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{average_spectrum, tone_amplitude};
    use crate::dsp::fade::{Fade, FadeCurve};
    use crate::signals;

    fn src(buf: AudioBuffer) -> SourceRef {
        SourceRef { buffer: Arc::new(buf), generation: 1 }
    }

    fn one_track(buf: AudioBuffer) -> (Project, SourceMap) {
        let mut sources = SourceMap::new();
        sources.insert("a".into(), src(buf));
        let mut p = Project::default();
        p.tracks.push(Track::new("t1", "a"));
        (p, sources)
    }

    fn mix(p: &Project, s: &SourceMap) -> Arc<AudioBuffer> {
        mix_project(&mut StageCache::new(), p, s).unwrap().0
    }

    #[test]
    fn empty_project_is_error() {
        let e = mix_project(&mut StageCache::new(), &Project::default(), &SourceMap::new()).unwrap_err();
        assert_eq!(e.code(), "ERR_EMPTY_PROJECT");
    }

    #[test]
    fn missing_source_is_error() {
        let mut p = Project::default();
        p.tracks.push(Track::new("t", "nope"));
        let e = mix_project(&mut StageCache::new(), &p, &SourceMap::new()).unwrap_err();
        assert_eq!(e.code(), "ERR_SOURCE_NOT_LOADED");
        assert!(e.to_string().contains("nope"));
    }

    #[test]
    fn single_track_passes_through() {
        let s = signals::sine(440.0, 8000, 0.1, 0.5);
        let (p, sources) = one_track(s.clone());
        let out = mix(&p, &sources);
        assert_eq!(*out, s);
    }

    #[test]
    fn offset_places_track() {
        let (mut p, sources) = one_track(AudioBuffer::mono(1000, vec![1.0; 10]));
        p.tracks[0].offset = 0.5;
        let out = mix(&p, &sources);
        assert_eq!(out.frames(), 510);
        assert!(out.channels[0][..500].iter().all(|s| *s == 0.0));
        assert!(out.channels[0][500..].iter().all(|s| *s == 1.0));
    }

    #[test]
    fn clip_cuts_exact_frames() {
        let data: Vec<f32> = (0..1000).map(|i| i as f32).collect();
        let (mut p, sources) = one_track(AudioBuffer::mono(1000, data));
        p.tracks[0].clip_start = 0.1;
        p.tracks[0].clip_end = Some(0.25);
        let out = mix(&p, &sources);
        assert_eq!(out.frames(), 150);
        assert_eq!(out.channels[0][0], 100.0);
        assert_eq!(out.channels[0][149], 249.0);
        // clip end beyond the source and reversed clips are clamped
        p.tracks[0].clip_end = Some(99.0);
        assert_eq!(mix(&p, &sources).frames(), 900);
        p.tracks[0].clip_end = Some(0.05);
        assert_eq!(mix(&p, &sources).frames(), 0);
    }

    #[test]
    fn gain_and_pan_coefficients() {
        let (mut p, sources) = one_track(AudioBuffer::from_channels(1000, vec![vec![0.5; 10], vec![0.5; 10]]));
        p.tracks[0].gain_db = -6.0206;
        let out = mix(&p, &sources);
        assert!((out.channels[0][0] - 0.25).abs() < 1e-4);
        p.tracks[0].gain_db = 0.0;
        p.tracks[0].pan = -1.0;
        let out = mix(&p, &sources);
        assert!((out.channels[0][0] - 0.5).abs() < 1e-6);
        assert!(out.channels[1][0].abs() < 1e-6);
        p.tracks[0].pan = 0.5;
        let out = mix(&p, &sources);
        let (l, r) = dsp::gain::pan_gains(0.5);
        assert!((out.channels[0][0] - 0.5 * l).abs() < 1e-6);
        assert!((out.channels[1][0] - 0.5 * r).abs() < 1e-6);
    }

    #[test]
    fn mono_track_in_stereo_project_is_duplicated_and_pannable() {
        let mut sources = SourceMap::new();
        sources.insert("m".into(), src(AudioBuffer::mono(1000, vec![1.0; 10])));
        sources.insert("s".into(), src(AudioBuffer::new(1000, 2, 10)));
        let mut p = Project::default();
        p.tracks.push(Track::new("t1", "m"));
        p.tracks.push(Track::new("t2", "s"));
        let out = mix(&p, &sources);
        assert_eq!(out.num_channels(), 2);
        assert_eq!(out.channels[0][0], 1.0);
        assert_eq!(out.channels[1][0], 1.0);
        p.tracks[0].pan = 1.0;
        let out = mix(&p, &sources);
        assert!(out.channels[0][0].abs() < 1e-6);
        assert!((out.channels[1][0] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn mono_project_ignores_pan() {
        let (mut p, sources) = one_track(AudioBuffer::mono(1000, vec![1.0; 10]));
        p.tracks[0].pan = 1.0;
        let out = mix(&p, &sources);
        assert_eq!(out.num_channels(), 1);
        assert_eq!(out.channels[0][0], 1.0);
    }

    #[test]
    fn project_rate_and_channels_rules() {
        let mut sources = SourceMap::new();
        sources.insert("lo".into(), src(signals::sine(440.0, 22_050, 0.1, 0.5)));
        sources.insert("hi".into(), src(AudioBuffer::new(48_000, 2, 4800)));
        let mut p = Project::default();
        p.tracks.push(Track::new("a", "lo"));
        p.tracks.push(Track::new("b", "hi"));
        assert_eq!(project_format(&p, &sources).unwrap(), (48_000, 2));
        p.tracks[1].mute = true;
        assert_eq!(project_format(&p, &sources).unwrap(), (22_050, 1));
        // Muted tracks don't need a loaded source.
        p.tracks[1].source_id = "unloaded".into();
        assert_eq!(project_format(&p, &sources).unwrap(), (22_050, 1));
        // Nothing audible: fallback to the loaded sources' rate.
        p.tracks[0].mute = true;
        assert_eq!(project_format(&p, &sources).unwrap(), (22_050, 1));
        p.tracks[0].source_id = "unloaded".into();
        assert_eq!(project_format(&p, &sources).unwrap(), (44_100, 1));
    }

    #[test]
    fn lower_rate_source_is_resampled_to_project_rate() {
        let mut sources = SourceMap::new();
        sources.insert("lo".into(), src(signals::sine(1000.0, 22_050, 0.5, 0.5)));
        sources.insert("hi".into(), src(AudioBuffer::new(44_100, 1, 100)));
        let mut p = Project::default();
        p.tracks.push(Track::new("a", "lo"));
        p.tracks.push(Track::new("b", "hi"));
        let out = mix(&p, &sources);
        assert_eq!(out.sample_rate, 44_100);
        assert!((out.frames() as i64 - 22_050).abs() <= 2);
        assert!((tone_amplitude(&out, 1000.0) - 0.5).abs() < 0.02);
    }

    #[test]
    fn mute_and_solo() {
        let mut sources = SourceMap::new();
        sources.insert("a".into(), src(AudioBuffer::mono(1000, vec![0.25; 10])));
        sources.insert("b".into(), src(AudioBuffer::mono(1000, vec![0.5; 10])));
        let mut p = Project::default();
        p.tracks.push(Track::new("t1", "a"));
        p.tracks.push(Track::new("t2", "b"));
        assert_eq!(mix(&p, &sources).channels[0][0], 0.75);
        p.tracks[0].mute = true;
        assert_eq!(mix(&p, &sources).channels[0][0], 0.5);
        p.tracks[0].mute = false;
        p.tracks[0].solo = true;
        assert_eq!(mix(&p, &sources).channels[0][0], 0.25);
        p.tracks[1].solo = true;
        assert_eq!(mix(&p, &sources).channels[0][0], 0.75);
        p.tracks[0].mute = true;
        p.tracks[1].mute = true;
        let out = mix(&p, &sources);
        assert!(out.is_empty(), "nothing audible -> empty mix");
    }

    #[test]
    fn two_sines_give_two_spectral_peaks() {
        let mut sources = SourceMap::new();
        sources.insert("a".into(), src(signals::sine(500.0, 16_000, 1.0, 0.4)));
        sources.insert("b".into(), src(signals::sine(3000.0, 16_000, 1.0, 0.4)));
        let mut p = Project::default();
        p.tracks.push(Track::new("t1", "a"));
        p.tracks.push(Track::new("t2", "b"));
        let out = mix(&p, &sources);
        assert!((tone_amplitude(&out, 500.0) - 0.4).abs() < 0.02);
        assert!((tone_amplitude(&out, 3000.0) - 0.4).abs() < 0.02);
        assert!(tone_amplitude(&out, 1500.0) < 0.01);
        let spec = average_spectrum(&out, 64);
        let mut idx: Vec<usize> = (0..spec.len()).collect();
        idx.sort_by(|a, b| spec[*b].partial_cmp(&spec[*a]).unwrap());
        let band_of = |f: f64| ((f / 20.0).ln() / (8000.0f64 / 20.0).ln() * 64.0).floor() as usize;
        let top: Vec<usize> = idx[..4].to_vec();
        assert!(top.iter().any(|i| i.abs_diff(band_of(500.0)) <= 1), "{top:?}");
        assert!(top.iter().any(|i| i.abs_diff(band_of(3000.0)) <= 1), "{top:?}");
    }

    #[test]
    fn crossfade_overlap_keeps_constant_level() {
        // Two DC tracks overlapping by 0.1 s with linear fades: the sum stays 1.
        let mut sources = SourceMap::new();
        sources.insert("a".into(), src(AudioBuffer::mono(1000, vec![1.0; 500])));
        sources.insert("b".into(), src(AudioBuffer::mono(1000, vec![1.0; 500])));
        let mut p = Project::default();
        let mut a = Track::new("t1", "a");
        a.fade_out = Fade { duration: 0.1, curve: FadeCurve::Linear };
        let mut b = Track::new("t2", "b");
        b.offset = 0.4;
        b.fade_in = Fade { duration: 0.1, curve: FadeCurve::Linear };
        p.tracks.push(a);
        p.tracks.push(b);
        let out = mix(&p, &sources);
        assert_eq!(out.frames(), 900, "total = 500 + 500 - 100");
        let x = &out.channels[0];
        assert_eq!(x[0], 1.0);
        assert_eq!(x[899], 1.0);
        for (i, v) in x.iter().enumerate() {
            assert!((v - 1.0).abs() < 0.02, "frame {i}: {v}");
        }
        let max_step = x.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(max_step < 0.02);
    }

    #[test]
    fn track_chain_is_applied() {
        let (mut p, sources) = one_track(AudioBuffer::mono(1000, vec![0.5; 10]));
        p.tracks[0].effects.volume.gain_db = -6.0206;
        let out = mix(&p, &sources);
        assert!((out.channels[0][5] - 0.25).abs() < 1e-3);
    }

    #[test]
    fn mix_cache_reused_and_invalidated() {
        let (mut p, sources) = one_track(signals::sine(440.0, 8000, 0.1, 0.5));
        p.tracks[0].effects.volume.gain_db = -3.0;
        let mut cache = StageCache::new();
        let (a, ka) = mix_project(&mut cache, &p, &sources).unwrap();
        let (b, kb) = mix_project(&mut cache, &p, &sources).unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(ka, kb);
        assert_eq!(cache.runs("mix"), 1);
        assert_eq!(cache.runs("volume"), 1);
        p.tracks[0].pan = 0.3; // placement only: chain stays cached
        mix_project(&mut cache, &p, &sources).unwrap();
        assert_eq!(cache.runs("mix"), 2);
        assert_eq!(cache.runs("volume"), 1);
        p.tracks[0].offset = 0.1;
        mix_project(&mut cache, &p, &sources).unwrap();
        assert_eq!(cache.runs("mix"), 3);
    }

    #[test]
    fn source_generation_invalidates() {
        let (mut p, mut sources) = one_track(signals::sine(440.0, 8000, 0.1, 0.5));
        p.tracks[0].clip_start = 0.01;
        let mut cache = StageCache::new();
        mix_project(&mut cache, &p, &sources).unwrap();
        mix_project(&mut cache, &p, &sources).unwrap();
        assert_eq!(cache.runs("clip"), 1);
        sources.get_mut("a").unwrap().generation = 2;
        mix_project(&mut cache, &p, &sources).unwrap();
        assert_eq!(cache.runs("clip"), 2);
    }

    #[test]
    fn mix_buffers_sums_overlaps() {
        let a = AudioBuffer::mono(10, vec![1.0, 1.0]);
        let b = AudioBuffer::mono(10, vec![2.0, 2.0]);
        let out = mix_buffers(10, 1, &[(0, &a), (1, &b)]);
        assert_eq!(out.channels[0], vec![1.0, 3.0, 2.0]);
        assert_eq!(mix_buffers(10, 2, &[]).frames(), 0);
    }
}
