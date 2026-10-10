//! Node binding of the audio engine (napi-rs).
//!
//! * Heavy calls (`loadSource`, `sourcePeaks`, `render`, `estimateSize`,
//!   `export`) are `AsyncTask`s running on the libuv thread pool and return
//!   Promises; the JS thread never blocks on DSP.
//! * Projects and export options are passed as JSON strings (camelCase,
//!   identical to `src/shared/types.ts`).
//! * Errors are JS `Error`s whose message is `ERR_CODE: detail`.

use audio_core::encode::ExportOptions;
use audio_core::engine::Engine;
use audio_core::playback::TransportState;
use audio_core::project::Project;
use audio_core::render::{RenderOutput, RenderSizes};
use audio_core::AudioError;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::{Arc, OnceLock};

static ENGINE: OnceLock<Arc<Engine>> = OnceLock::new();

fn engine() -> Arc<Engine> {
    ENGINE.get_or_init(|| Arc::new(Engine::new())).clone()
}

fn to_napi(e: AudioError) -> Error {
    Error::new(Status::GenericFailure, e.to_string())
}

fn parse_project(json: &str) -> Result<Project> {
    Project::from_json(json).map_err(to_napi)
}

fn parse_options(json: &str) -> Result<ExportOptions> {
    serde_json::from_str(json).map_err(|e| to_napi(AudioError::InvalidParam(format!("export options: {e}"))))
}

fn non_negative(v: f64, name: &str) -> Result<usize> {
    if !v.is_finite() || v < 0.0 {
        return Err(to_napi(AudioError::InvalidParam(format!("{name} {v}"))));
    }
    Ok(v as usize)
}

#[napi]
pub fn ping() -> String {
    audio_core::ping().to_string()
}

// ----- objects ----------------------------------------------------------

#[napi(object, use_nullable = true)]
pub struct SourceInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub format: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub frames: f64,
    pub duration: f64,
    pub bit_depth: Option<u32>,
    pub file_size: f64,
}

#[napi(object)]
pub struct SpectrogramData {
    pub width: u32,
    pub height: u32,
    /// Row-major, row 0 = highest frequency.
    pub data: Uint8Array,
    pub min_freq: f64,
    pub max_freq: f64,
    pub db_floor: f64,
}

#[napi(object, use_nullable = true)]
pub struct RenderResult {
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
    /// min,max pairs.
    pub peaks: Float32Array,
    pub spectrogram: SpectrogramData,
    pub peak_db: f64,
    pub lufs: Option<f64>,
    /// 64 log bands, dB.
    pub average_spectrum: Float32Array,
}

#[napi(object, use_nullable = true)]
pub struct JsTransportState {
    /// 'playing' | 'paused' | 'stopped'
    pub state: String,
    pub position: f64,
    pub duration: f64,
    pub session_id: Option<String>,
    #[napi(js_name = "loop")]
    pub loop_enabled: bool,
}

impl From<TransportState> for JsTransportState {
    fn from(s: TransportState) -> Self {
        let state = serde_json::to_value(s.state).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        Self { state, position: s.position, duration: s.duration, session_id: s.session_id, loop_enabled: s.loop_enabled }
    }
}

// ----- tasks ------------------------------------------------------------

pub struct LoadSourceTask {
    path: String,
}

impl Task for LoadSourceTask {
    type Output = audio_core::engine::SourceDetails;
    type JsValue = SourceInfo;

    fn compute(&mut self) -> Result<Self::Output> {
        engine().load_source(&self.path).map_err(to_napi)
    }

    fn resolve(&mut self, _env: Env, d: Self::Output) -> Result<Self::JsValue> {
        Ok(SourceInfo {
            id: d.id,
            path: d.path,
            name: d.name,
            format: d.format,
            sample_rate: d.sample_rate,
            channels: d.channels,
            frames: d.frames as f64,
            duration: d.duration,
            bit_depth: d.bit_depth,
            file_size: d.file_size as f64,
        })
    }
}

pub struct SourcePeaksTask {
    id: String,
    buckets: usize,
}

impl Task for SourcePeaksTask {
    type Output = Vec<f32>;
    type JsValue = Float32Array;

    fn compute(&mut self) -> Result<Self::Output> {
        engine().source_peaks(&self.id, self.buckets).map_err(to_napi)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(Float32Array::new(output))
    }
}

pub struct RenderTask {
    session_id: String,
    project: String,
    preview: Option<String>,
    sizes: RenderSizes,
}

impl Task for RenderTask {
    type Output = RenderOutput;
    type JsValue = RenderResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let project = parse_project(&self.project)?;
        let preview = match &self.preview {
            Some(json) => Some(parse_options(json)?),
            None => None,
        };
        engine().render(&self.session_id, &project, preview.as_ref(), self.sizes).map_err(to_napi)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Self::JsValue> {
        let a = out.analysis;
        Ok(RenderResult {
            duration: a.duration,
            sample_rate: a.sample_rate,
            channels: a.channels as u32,
            peaks: Float32Array::new(a.peaks),
            spectrogram: SpectrogramData {
                width: a.spectrogram.width,
                height: a.spectrogram.height,
                data: Uint8Array::new(a.spectrogram.data),
                min_freq: a.spectrogram.min_freq as f64,
                max_freq: a.spectrogram.max_freq as f64,
                db_floor: a.spectrogram.db_floor as f64,
            },
            peak_db: if a.peak_db.is_finite() { a.peak_db as f64 } else { -240.0 },
            lufs: a.lufs.filter(|l| l.is_finite()),
            average_spectrum: Float32Array::new(a.average_spectrum),
        })
    }
}

pub struct EstimateSizeTask {
    session_id: String,
    project: String,
    options: String,
}

impl Task for EstimateSizeTask {
    type Output = u64;
    type JsValue = f64;

    fn compute(&mut self) -> Result<Self::Output> {
        let project = parse_project(&self.project)?;
        let options = parse_options(&self.options)?;
        engine().estimate_size(&self.session_id, &project, &options).map_err(to_napi)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output as f64)
    }
}

pub struct ExportTask {
    session_id: String,
    project: String,
    options: String,
    path: String,
}

impl Task for ExportTask {
    type Output = u64;
    type JsValue = f64;

    fn compute(&mut self) -> Result<Self::Output> {
        let project = parse_project(&self.project)?;
        let options = parse_options(&self.options)?;
        engine().export(&self.session_id, &project, &options, &self.path).map_err(to_napi)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output as f64)
    }
}

// ----- exported functions ---------------------------------------------

/// Decode a file. Resolves to its SourceInfo (id = normalized absolute path).
#[napi(ts_return_type = "Promise<SourceInfo>")]
pub fn load_source(path: String) -> AsyncTask<LoadSourceTask> {
    AsyncTask::new(LoadSourceTask { path })
}

#[napi]
pub fn unload_source(id: String) {
    engine().unload_source(&id);
}

/// Waveform min/max pairs of a loaded source.
#[napi(ts_return_type = "Promise<Float32Array>")]
pub fn source_peaks(id: String, buckets: f64) -> Result<AsyncTask<SourcePeaksTask>> {
    let buckets = non_negative(buckets, "buckets")?.max(1);
    Ok(AsyncTask::new(SourcePeaksTask { id, buckets }))
}

/// Render a project (JSON) for a session; `previewJson` (export options
/// JSON or null) renders "as exported".
#[napi(ts_return_type = "Promise<RenderResult>")]
pub fn render(
    session_id: String,
    project_json: String,
    preview_json: Option<String>,
    peaks_buckets: f64,
    spectrogram_width: f64,
    spectrogram_height: f64,
) -> Result<AsyncTask<RenderTask>> {
    let sizes = RenderSizes {
        peaks_buckets: non_negative(peaks_buckets, "peaksBuckets")?.max(1),
        spectrogram_width: non_negative(spectrogram_width, "spectrogramWidth")?.max(1),
        spectrogram_height: non_negative(spectrogram_height, "spectrogramHeight")?.max(1),
    };
    Ok(AsyncTask::new(RenderTask { session_id, project: project_json, preview: preview_json, sizes }))
}

/// Exact size in bytes of the exported file.
#[napi(ts_return_type = "Promise<number>")]
pub fn estimate_size(session_id: String, project_json: String, options_json: String) -> AsyncTask<EstimateSizeTask> {
    AsyncTask::new(EstimateSizeTask { session_id, project: project_json, options: options_json })
}

/// Encode and write to `path` only. Resolves to the number of bytes written.
#[napi(js_name = "export", ts_return_type = "Promise<number>")]
pub fn export_audio(session_id: String, project_json: String, options_json: String, path: String) -> AsyncTask<ExportTask> {
    AsyncTask::new(ExportTask { session_id, project: project_json, options: options_json, path })
}

/// Free a session's caches and playback buffer (tab sleep).
#[napi]
pub fn release_session(session_id: String) {
    engine().release_session(&session_id);
}

#[napi]
pub fn play(session_id: String) -> Result<()> {
    engine().play(&session_id).map_err(to_napi)
}

#[napi]
pub fn pause() {
    engine().pause();
}

#[napi]
pub fn stop() {
    engine().stop();
}

#[napi]
pub fn seek(seconds: f64) {
    engine().seek(seconds);
}

#[napi]
pub fn step(delta_seconds: f64) {
    engine().step(delta_seconds);
}

#[napi]
pub fn set_loop(enabled: bool) {
    engine().set_loop(enabled);
}

#[napi]
pub fn transport_state() -> JsTransportState {
    engine().transport_state().into()
}

/// Close the audio device (reopened on next play).
#[napi]
pub fn close_output() {
    engine().close_output();
}
