//! Effect chain processing with a per-stage result cache.
//!
//! Every stage result is cached under `hash(input_key, stage, settings JSON)`.
//! Since the key of a stage feeds into the next one, changing a parameter of
//! stage N re-runs stage N and the stages after it only. Disabled or neutral
//! stages are skipped entirely (their key passes through unchanged).

use crate::buffer::AudioBuffer;
use crate::dsp;
use crate::error::Result;
use crate::project::EffectChain;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;

/// Chain stages in processing order (contract section 2).
pub const CHAIN_STAGES: [&str; 5] = ["denoise", "pitchTempo", "filters", "eq", "volume"];

/// Deterministic 64-bit hash of a list of parts.
pub fn hash_parts(parts: &[&dyn HashPart]) -> u64 {
    let mut h = DefaultHasher::new();
    for p in parts {
        p.feed(&mut h);
    }
    h.finish()
}

/// Values that can take part in a cache key.
pub trait HashPart {
    fn feed(&self, h: &mut DefaultHasher);
}

impl HashPart for u64 {
    fn feed(&self, h: &mut DefaultHasher) {
        self.hash(h);
    }
}
impl HashPart for u32 {
    fn feed(&self, h: &mut DefaultHasher) {
        self.hash(h);
    }
}
impl HashPart for usize {
    fn feed(&self, h: &mut DefaultHasher) {
        self.hash(h);
    }
}
impl HashPart for &str {
    fn feed(&self, h: &mut DefaultHasher) {
        self.hash(h);
    }
}
impl HashPart for String {
    fn feed(&self, h: &mut DefaultHasher) {
        self.hash(h);
    }
}
impl HashPart for f64 {
    fn feed(&self, h: &mut DefaultHasher) {
        self.to_bits().hash(h);
    }
}

pub fn stage_key(input_key: u64, stage: &str, settings_json: &str) -> u64 {
    hash_parts(&[&input_key, &stage, &settings_json])
}

/// Cache of stage outputs. Use `begin_pass` / `end_pass` around a render so
/// entries not used by the latest render are dropped (bounded memory).
#[derive(Default, Debug)]
pub struct StageCache {
    entries: HashMap<u64, Arc<AudioBuffer>>,
    used: HashSet<u64>,
    runs: HashMap<String, u64>,
    hits: u64,
}

impl StageCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin_pass(&mut self) {
        self.used.clear();
    }

    /// Drop every entry that was not used since `begin_pass`.
    pub fn end_pass(&mut self) {
        let used = &self.used;
        self.entries.retain(|k, _| used.contains(k));
    }

    /// Return the cached result for `key` or run `f` and cache it.
    pub fn get_or_run(&mut self, key: u64, stage: &str, f: impl FnOnce() -> Result<AudioBuffer>) -> Result<Arc<AudioBuffer>> {
        self.used.insert(key);
        if let Some(b) = self.entries.get(&key) {
            self.hits += 1;
            return Ok(b.clone());
        }
        let out = Arc::new(f()?);
        *self.runs.entry(stage.to_string()).or_insert(0) += 1;
        self.entries.insert(key, out.clone());
        Ok(out)
    }

    pub fn contains(&self, key: u64) -> bool {
        self.entries.contains_key(&key)
    }

    /// How many times `stage` actually ran (cache misses).
    pub fn runs(&self, stage: &str) -> u64 {
        self.runs.get(stage).copied().unwrap_or(0)
    }

    pub fn hits(&self) -> u64 {
        self.hits
    }

    pub fn stats(&self) -> HashMap<String, u64> {
        self.runs.clone()
    }

    pub fn reset_stats(&mut self) {
        self.runs.clear();
        self.hits = 0;
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.used.clear();
    }
}

/// Whether a chain stage changes the signal at all.
pub fn is_stage_active(chain: &EffectChain, stage: &str) -> bool {
    match stage {
        "denoise" => chain.denoise.enabled,
        "pitchTempo" => {
            let p = &chain.pitch_tempo;
            p.enabled && !(p.semitones == 0.0 && p.cents == 0.0 && p.tempo == 100.0)
        }
        "filters" => chain.filters.enabled && chain.filters.items.iter().any(|b| b.enabled),
        "eq" => chain.eq.enabled && chain.eq.bands.iter().any(|b| b.gain_db != 0.0),
        "volume" => !chain.volume.is_neutral(),
        _ => false,
    }
}

fn settings_json(chain: &EffectChain, stage: &str) -> String {
    let v = match stage {
        "denoise" => serde_json::to_string(&chain.denoise),
        "pitchTempo" => serde_json::to_string(&chain.pitch_tempo),
        "filters" => serde_json::to_string(&chain.filters),
        "eq" => serde_json::to_string(&chain.eq),
        "volume" => serde_json::to_string(&chain.volume),
        _ => Ok(String::new()),
    };
    v.unwrap_or_default()
}

fn run_stage(chain: &EffectChain, stage: &str, input: &AudioBuffer) -> Result<AudioBuffer> {
    Ok(match stage {
        "denoise" => dsp::denoise::apply_denoise(input, &chain.denoise),
        "pitchTempo" => dsp::stretch::apply_pitch_tempo(input, &chain.pitch_tempo),
        "filters" => {
            let mut b = input.clone();
            dsp::filter::apply_filters(&mut b, &chain.filters);
            b
        }
        "eq" => {
            let mut b = input.clone();
            dsp::eq::apply_eq(&mut b, &chain.eq);
            b
        }
        "volume" => {
            let mut b = input.clone();
            dsp::gain::apply_volume(&mut b, &chain.volume);
            b
        }
        _ => input.clone(),
    })
}

/// Process `input` (identified by `input_key`) through the chain. Returns
/// the output buffer and its cache key.
pub fn process_chain(
    cache: &mut StageCache,
    input: Arc<AudioBuffer>,
    input_key: u64,
    chain: &EffectChain,
) -> Result<(Arc<AudioBuffer>, u64)> {
    let mut buf = input;
    let mut key = input_key;
    for stage in CHAIN_STAGES {
        if !is_stage_active(chain, stage) || buf.is_empty() {
            continue;
        }
        key = stage_key(key, stage, &settings_json(chain, stage));
        let src = buf.clone();
        buf = cache.get_or_run(key, stage, || run_stage(chain, stage, &src))?;
    }
    Ok((buf, key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::gain::NormalizeMode;
    use crate::signals;

    fn active_chain() -> EffectChain {
        let mut c = EffectChain::default();
        c.denoise.enabled = true;
        c.pitch_tempo.enabled = true;
        c.pitch_tempo.tempo = 110.0;
        c.filters.enabled = true;
        c.filters.items.push(crate::dsp::filter::FilterBand::default());
        c.eq.enabled = true;
        c.eq.bands[8].gain_db = 3.0;
        c.volume.gain_db = -3.0;
        c
    }

    #[test]
    fn neutral_chain_is_identity_and_runs_nothing() {
        let mut cache = StageCache::new();
        let input = Arc::new(signals::sine(440.0, 8000, 0.1, 0.5));
        let (out, key) = process_chain(&mut cache, input.clone(), 42, &EffectChain::default()).unwrap();
        assert!(Arc::ptr_eq(&out, &input));
        assert_eq!(key, 42);
        assert!(cache.stats().is_empty());
        for s in CHAIN_STAGES {
            assert!(!is_stage_active(&EffectChain::default(), s), "{s}");
        }
        assert!(!is_stage_active(&EffectChain::default(), "bogus"));
    }

    #[test]
    fn enabled_but_neutral_stages_are_skipped() {
        let mut c = EffectChain::default();
        c.pitch_tempo.enabled = true; // 0 semitones, 100 %
        c.filters.enabled = true; // no items
        c.eq.enabled = true; // all flat
        for s in CHAIN_STAGES {
            assert!(!is_stage_active(&c, s), "{s}");
        }
        c.filters.items.push(crate::dsp::filter::FilterBand { enabled: false, ..Default::default() });
        assert!(!is_stage_active(&c, "filters"));
        c.volume.normalize = NormalizeMode::Peak;
        assert!(is_stage_active(&c, "volume"));
    }

    #[test]
    fn stage_key_depends_on_all_parts() {
        let k = stage_key(1, "eq", "{}");
        assert_eq!(k, stage_key(1, "eq", "{}"));
        assert_ne!(k, stage_key(2, "eq", "{}"));
        assert_ne!(k, stage_key(1, "volume", "{}"));
        assert_ne!(k, stage_key(1, "eq", "{\"a\":1}"));
        assert_ne!(hash_parts(&[&1.0f64]), hash_parts(&[&2.0f64]));
        assert_ne!(hash_parts(&[&1u32]), hash_parts(&[&2usize]));
        assert_ne!(hash_parts(&[&String::from("a")]), hash_parts(&[&String::from("b")]));
    }

    #[test]
    fn volume_stage_applies_gain() {
        let mut cache = StageCache::new();
        let input = Arc::new(AudioBuffer::mono(8000, vec![0.5; 100]));
        let mut c = EffectChain::default();
        c.volume.gain_db = -6.0206;
        let (out, key) = process_chain(&mut cache, input, 1, &c).unwrap();
        assert_ne!(key, 1);
        assert!((out.channels[0][10] - 0.25).abs() < 1e-3, "{}", out.channels[0][10]);
        assert_eq!(cache.runs("volume"), 1);
    }

    #[test]
    fn changing_one_parameter_only_reruns_that_stage_and_later() {
        let mut cache = StageCache::new();
        let input = Arc::new(signals::sine(440.0, 8000, 0.25, 0.5));
        let mut c = active_chain();
        process_chain(&mut cache, input.clone(), 7, &c).unwrap();
        for s in CHAIN_STAGES {
            assert_eq!(cache.runs(s), 1, "{s}");
        }
        // Same settings again: everything cached.
        process_chain(&mut cache, input.clone(), 7, &c).unwrap();
        for s in CHAIN_STAGES {
            assert_eq!(cache.runs(s), 1, "{s} must be cached");
        }
        // Change an EQ gain: denoise/pitch/filters cached, eq + volume rerun.
        c.eq.bands[8].gain_db = 6.0;
        process_chain(&mut cache, input.clone(), 7, &c).unwrap();
        assert_eq!(cache.runs("denoise"), 1);
        assert_eq!(cache.runs("pitchTempo"), 1);
        assert_eq!(cache.runs("filters"), 1);
        assert_eq!(cache.runs("eq"), 2);
        assert_eq!(cache.runs("volume"), 2);
        // Change the last stage only.
        c.volume.gain_db = -1.0;
        process_chain(&mut cache, input.clone(), 7, &c).unwrap();
        assert_eq!(cache.runs("eq"), 2);
        assert_eq!(cache.runs("volume"), 3);
        // Change the first stage: everything reruns.
        c.denoise.reduction_db = 20.0;
        process_chain(&mut cache, input.clone(), 7, &c).unwrap();
        for s in CHAIN_STAGES {
            assert!(cache.runs(s) >= 2, "{s}");
        }
        assert_eq!(cache.runs("denoise"), 2);
        // A different input key misses the cache.
        process_chain(&mut cache, input, 8, &c).unwrap();
        assert_eq!(cache.runs("denoise"), 3);
        assert!(cache.hits() > 0);
    }

    #[test]
    fn pass_retention_drops_unused_entries() {
        let mut cache = StageCache::new();
        let input = Arc::new(signals::sine(440.0, 8000, 0.05, 0.5));
        let mut c = EffectChain::default();
        c.volume.gain_db = -1.0;
        cache.begin_pass();
        let (_, k1) = process_chain(&mut cache, input.clone(), 1, &c).unwrap();
        cache.end_pass();
        assert!(cache.contains(k1));
        c.volume.gain_db = -2.0;
        cache.begin_pass();
        let (_, k2) = process_chain(&mut cache, input, 1, &c).unwrap();
        cache.end_pass();
        assert!(!cache.contains(k1));
        assert!(cache.contains(k2));
        assert_eq!(cache.len(), 1);
        assert!(!cache.is_empty());
        cache.reset_stats();
        assert_eq!(cache.runs("volume"), 0);
        assert_eq!(cache.hits(), 0);
        cache.clear();
        assert!(cache.is_empty());
    }

    #[test]
    fn errors_are_not_cached() {
        let mut cache = StageCache::new();
        let r = cache.get_or_run(5, "x", || Err(crate::AudioError::InvalidParam("boom".into())));
        assert_eq!(r.unwrap_err().code(), "ERR_INVALID_PARAM");
        assert!(!cache.contains(5));
        assert_eq!(cache.runs("x"), 0);
    }

    #[test]
    fn empty_input_skips_stages() {
        let mut cache = StageCache::new();
        let input = Arc::new(AudioBuffer::new(8000, 1, 0));
        let (out, key) = process_chain(&mut cache, input, 3, &active_chain()).unwrap();
        assert!(out.is_empty());
        assert_eq!(key, 3);
    }
}
