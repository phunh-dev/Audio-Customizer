//! Thread-safe engine facade used by the Node binding.
//!
//! * Sources are decoded once and shared by every session (id = normalized
//!   absolute path).
//! * A session (= UI tab) owns a `Renderer` with its caches and the last
//!   rendered buffer. `release_session` frees all of it (tab sleep).
//! * One transport plays the last render of one session at a time.

use crate::buffer::AudioBuffer;
use crate::decode::decode_file;
use crate::encode::ExportOptions;
use crate::error::{AudioError, Result};
use crate::mix::{SourceMap, SourceRef};
use crate::playback::{prepare_for_device, AudioOutput, OutputHandle, Transport, TransportState};
use crate::project::Project;
use crate::render::{RenderOutput, RenderSizes, Renderer};
use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Source metadata returned to the UI (contract `SourceInfo`).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceDetails {
    pub id: String,
    pub path: String,
    pub name: String,
    pub format: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub frames: u64,
    pub duration: f64,
    pub bit_depth: Option<u32>,
    pub file_size: u64,
}

struct LoadedSource {
    details: SourceDetails,
    source: SourceRef,
}

#[derive(Default)]
struct Session {
    renderer: Renderer,
    last: Option<Arc<AudioBuffer>>,
}

pub type OutputFactory = Box<dyn Fn(Arc<Mutex<Transport>>) -> Result<Box<dyn OutputHandle>> + Send + Sync>;

pub struct Engine {
    sources: RwLock<HashMap<String, LoadedSource>>,
    sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
    transport: Arc<Mutex<Transport>>,
    output: Mutex<Option<Box<dyn OutputHandle>>>,
    output_factory: OutputFactory,
    generation: AtomicU64,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

/// Lexically normalized absolute path (no `.`/`..`), used as source id.
pub fn normalize_path(path: &str) -> Result<String> {
    if path.trim().is_empty() {
        return Err(AudioError::FileNotFound(path.to_string()));
    }
    let abs = std::path::absolute(Path::new(path)).map_err(|e| AudioError::Io(e.to_string()))?;
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    Ok(out.to_string_lossy().into_owned())
}

impl Engine {
    /// Engine using the default cpal output device (opened lazily on play).
    pub fn new() -> Self {
        Self::with_output_factory(Box::new(|t| AudioOutput::open(t).map(|o| Box::new(o) as Box<dyn OutputHandle>)))
    }

    pub fn with_output_factory(output_factory: OutputFactory) -> Self {
        Self {
            sources: RwLock::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            transport: Arc::new(Mutex::new(Transport::new())),
            output: Mutex::new(None),
            output_factory,
            generation: AtomicU64::new(1),
        }
    }

    // ----- sources -------------------------------------------------------

    /// Decode a file (re-decodes when already loaded, e.g. file changed).
    pub fn load_source(&self, path: &str) -> Result<SourceDetails> {
        let id = normalize_path(path)?;
        let p = Path::new(&id);
        let decoded = decode_file(p)?;
        let info = decoded.info;
        let details = SourceDetails {
            id: id.clone(),
            path: id.clone(),
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| id.clone()),
            format: info.format,
            sample_rate: info.sample_rate,
            channels: info.channels,
            frames: info.frames,
            duration: info.duration,
            bit_depth: info.bit_depth,
            file_size: info.file_size,
        };
        let generation = self.generation.fetch_add(1, Ordering::Relaxed);
        let source = SourceRef { buffer: Arc::new(decoded.buffer), generation };
        self.sources.write().insert(id, LoadedSource { details: details.clone(), source });
        Ok(details)
    }

    /// Register an in-memory buffer as a source (tests, generated audio).
    pub fn insert_source(&self, id: &str, buffer: AudioBuffer) -> SourceDetails {
        let details = SourceDetails {
            id: id.to_string(),
            path: id.to_string(),
            name: id.to_string(),
            format: "pcm".into(),
            sample_rate: buffer.sample_rate,
            channels: buffer.num_channels() as u32,
            frames: buffer.frames() as u64,
            duration: buffer.duration_secs(),
            bit_depth: None,
            file_size: 0,
        };
        let generation = self.generation.fetch_add(1, Ordering::Relaxed);
        let source = SourceRef { buffer: Arc::new(buffer), generation };
        self.sources.write().insert(id.to_string(), LoadedSource { details: details.clone(), source });
        details
    }

    /// Forget a source. Unknown ids are ignored.
    pub fn unload_source(&self, id: &str) {
        let removed = self.sources.write().remove(id).is_some();
        if !removed {
            if let Ok(n) = normalize_path(id) {
                self.sources.write().remove(&n);
            }
        }
    }

    pub fn source_count(&self) -> usize {
        self.sources.read().len()
    }

    pub fn source_details(&self, id: &str) -> Result<SourceDetails> {
        self.sources.read().get(id).map(|s| s.details.clone()).ok_or_else(|| AudioError::SourceNotLoaded(id.to_string()))
    }

    pub fn source_peaks(&self, id: &str, buckets: usize) -> Result<Vec<f32>> {
        let buf = self
            .sources
            .read()
            .get(id)
            .map(|s| s.source.buffer.clone())
            .ok_or_else(|| AudioError::SourceNotLoaded(id.to_string()))?;
        Ok(crate::analysis::peaks(&buf, buckets))
    }

    fn snapshot_sources(&self) -> SourceMap {
        self.sources.read().iter().map(|(k, v)| (k.clone(), v.source.clone())).collect()
    }

    // ----- sessions ------------------------------------------------------

    fn session(&self, id: &str, create: bool) -> Result<Arc<Mutex<Session>>> {
        let mut sessions = self.sessions.lock();
        if let Some(s) = sessions.get(id) {
            return Ok(s.clone());
        }
        if !create {
            return Err(AudioError::SessionNotFound(id.to_string()));
        }
        let s = Arc::new(Mutex::new(Session::default()));
        sessions.insert(id.to_string(), s.clone());
        Ok(s)
    }

    pub fn session_count(&self) -> usize {
        self.sessions.lock().len()
    }

    /// Per-stage run counters of a session's renderer.
    pub fn session_stats(&self, id: &str) -> Result<HashMap<String, u64>> {
        Ok(self.session(id, false)?.lock().renderer.stats())
    }

    /// Render a project for a session; the result becomes the session's
    /// playback buffer (live-updated in the transport when it is active).
    pub fn render(
        &self,
        session_id: &str,
        project: &Project,
        preview: Option<&ExportOptions>,
        sizes: RenderSizes,
    ) -> Result<RenderOutput> {
        let sources = self.snapshot_sources();
        let session = self.session(session_id, true)?;
        let mut s = session.lock();
        let out = s.renderer.render(project, &sources, preview, sizes)?;
        s.last = Some(out.buffer.clone());
        drop(s);
        if self.transport.lock().session_id() == Some(session_id) {
            let prepared = self.prepare(&out.buffer);
            self.transport.lock().set_buffer(prepared, Some(session_id.to_string()));
        }
        Ok(out)
    }

    /// Exact byte size of the export.
    pub fn estimate_size(&self, session_id: &str, project: &Project, options: &ExportOptions) -> Result<u64> {
        let sources = self.snapshot_sources();
        let session = self.session(session_id, true)?;
        let mut s = session.lock();
        s.renderer.estimate_size(project, &sources, options)
    }

    /// Encode and write the export to `path` (and nowhere else). Returns
    /// the number of bytes written.
    pub fn export(&self, session_id: &str, project: &Project, options: &ExportOptions, path: &str) -> Result<u64> {
        if path.trim().is_empty() {
            return Err(AudioError::InvalidParam("empty export path".into()));
        }
        let sources = self.snapshot_sources();
        let session = self.session(session_id, true)?;
        let bytes = session.lock().renderer.encode(project, &sources, options)?;
        std::fs::write(path, bytes.as_slice()).map_err(|e| AudioError::Io(format!("{path}: {e}")))?;
        Ok(bytes.len() as u64)
    }

    /// Free a session's caches and playback buffer. Unknown ids are ignored.
    pub fn release_session(&self, session_id: &str) {
        self.sessions.lock().remove(session_id);
        let mut t = self.transport.lock();
        if t.session_id() == Some(session_id) {
            t.clear();
        }
    }

    // ----- transport -----------------------------------------------------

    fn prepare(&self, buf: &Arc<AudioBuffer>) -> Arc<AudioBuffer> {
        match self.output.lock().as_ref().map(|o| o.sample_rate()) {
            Some(rate) if rate != buf.sample_rate => Arc::new(prepare_for_device(buf, rate)),
            _ => buf.clone(),
        }
    }

    fn ensure_output(&self) -> Result<u32> {
        let mut out = self.output.lock();
        if out.is_none() {
            *out = Some((self.output_factory)(self.transport.clone())?);
        }
        Ok(out.as_ref().map(|o| o.sample_rate()).unwrap_or(0))
    }

    /// Play the last render of `session_id` (switching sessions resets the
    /// position; play at the end restarts from 0).
    pub fn play(&self, session_id: &str) -> Result<()> {
        let last = self
            .session(session_id, false)?
            .lock()
            .last
            .clone()
            .ok_or_else(|| AudioError::SessionNotFound(format!("{session_id}: nothing rendered")))?;
        let rate = self.ensure_output()?;
        let needs_buffer = {
            let t = self.transport.lock();
            t.session_id() != Some(session_id) || t.buffer().is_none_or(|b| rate != 0 && b.sample_rate != rate)
        };
        if needs_buffer {
            let prepared = self.prepare(&last);
            self.transport.lock().set_buffer(prepared, Some(session_id.to_string()));
        }
        self.transport.lock().play();
        Ok(())
    }

    pub fn pause(&self) {
        self.transport.lock().pause();
    }

    pub fn stop(&self) {
        self.transport.lock().stop();
    }

    pub fn seek(&self, seconds: f64) {
        self.transport.lock().seek(seconds);
    }

    pub fn step(&self, delta: f64) {
        self.transport.lock().step(delta);
    }

    pub fn set_loop(&self, enabled: bool) {
        self.transport.lock().set_loop(enabled);
    }

    pub fn transport_state(&self) -> TransportState {
        self.transport.lock().state()
    }

    /// Shared transport (used by tests to pull samples like a device would).
    pub fn transport(&self) -> Arc<Mutex<Transport>> {
        self.transport.clone()
    }

    /// Close the output device (it is reopened on the next play).
    pub fn close_output(&self) {
        self.transport.lock().pause();
        *self.output.lock() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_removes_dots_and_is_absolute() {
        let n = normalize_path("a/./b/../c.wav").unwrap();
        assert!(Path::new(&n).is_absolute());
        assert!(n.ends_with(&format!("a{}c.wav", std::path::MAIN_SEPARATOR)), "{n}");
        assert_eq!(normalize_path(&n).unwrap(), n);
        assert_eq!(normalize_path("  ").unwrap_err().code(), "ERR_FILE_NOT_FOUND");
    }
}
