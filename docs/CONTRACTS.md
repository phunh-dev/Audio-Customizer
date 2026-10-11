# Interface contracts (source of truth for parallel work)

All agents MUST follow these contracts exactly. JSON is camelCase everywhere.
Rust settings structs use `#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]`,
`#[serde(rename_all = "camelCase", default)]` and implement `Default` with the values below.
Enums use `#[serde(rename_all = "camelCase")]` (unit variants -> "highpass", "sCurve", "equalPower", ...).

## 0. Ownership

| Area | Owner | Paths |
|---|---|---|
| Rust core basics (DONE) | lead | `crates/audio-core/src/{buffer,error,signals,decode,encode,analysis}.rs`, `dsp/resample.rs` |
| Rust DSP | Agent A | `crates/audio-core/src/dsp/*` (except resample.rs, may add `resample_by_ratio`) , `dsp/mod.rs` |
| Rust engine + napi + Electron main/preload | Agent B | `crates/audio-core/src/{project,chain,mix,render,playback,engine}.rs`, `crates/audio-napi/**`, `scripts/build-native.mjs`, `src/main/**`, `src/preload/**` |
| Scaffold + renderer UI | Agent C | `package.json`, configs (`electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`, tailwind), `src/renderer/**`, `src/shared/**` |
| Integration (later) | Agent D | `e2e/**`, `.github/**`, `electron-builder.yml`, README |

`crates/audio-core/src/lib.rs`: Agent A adds nothing (dsp already declared via `pub mod dsp;`). Agent B adds its own `pub mod` lines.
Existing public API to reuse: `AudioBuffer` (planar f32: `sample_rate`, `channels: Vec<Vec<f32>>`, `frames()`, `slice()`, `with_channels()`, `to_mono()`, `secs_to_frames()`, `peak()`, `rms()`, `scale()`, `append()`), `AudioError` (+`code()`), `signals::{sine, white_noise, sweep, silence, impulse, add, Rng}`, `analysis::{peaks, spectrogram, average_spectrum, dominant_frequency, tone_amplitude, to_db, hann}`, `decode::{decode_file, decode_bytes, SourceInfo, is_supported_path, SUPPORTED_EXTENSIONS}`, `encode::{ExportOptions, ExportFormat, ChannelMode, BitrateMode, export_bytes, prepare, encode, validate, MP3_SAMPLE_RATES, MP3_BITRATES}`, `dsp::resample::{resample, ResampleQuality}`.

## 1. Rust DSP API (Agent A implements, Agent B consumes)

Convention: same-length ops mutate `&mut AudioBuffer`; length-changing ops return a new `AudioBuffer`.

```rust
// dsp/fade.rs
pub enum FadeCurve { Linear /*default*/, Exponential /*t^2*/, Logarithmic /*1-(1-t)^2*/, SCurve /*0.5-0.5cos(pi t)*/, EqualPower /*sin(pi t/2)*/ }
impl FadeCurve { pub fn gain(self, t: f64) -> f64 }            // fade-in gain, t clamped to [0,1]
pub struct Fade { pub duration: f64 /*sec, 0*/, pub curve: FadeCurve }
pub fn apply_fade_in(buf: &mut AudioBuffer, frames: usize, curve: FadeCurve);
pub fn apply_fade_out(buf: &mut AudioBuffer, frames: usize, curve: FadeCurve); // last sample -> 0
pub fn apply_fades(buf: &mut AudioBuffer, fade_in: &Fade, fade_out: &Fade);

// dsp/gain.rs
pub enum NormalizeMode { Off /*default*/, Peak, Lufs }
pub struct VolumeSettings { gain_db: f32 /*0*/, normalize: NormalizeMode, normalize_target: f32 /*-1*/,
    limiter: bool /*false*/, limiter_ceiling_db: f32 /*-1*/, limiter_release_ms: f32 /*50*/ }
impl VolumeSettings { pub fn is_neutral(&self) -> bool }
pub fn db_to_lin(db: f32) -> f32;  pub fn lin_to_db(lin: f32) -> f32;
pub fn apply_gain_db(buf: &mut AudioBuffer, db: f32);
pub fn pan_gains(pan: f32) -> (f32, f32);   // balance law: 0->(1,1), -1->(1,0), 1->(0,1), 0.5->(0.5,1)
pub fn apply_pan(buf: &mut AudioBuffer, pan: f32); // channels 0/1; no-op for mono
pub fn normalize_peak(buf: &mut AudioBuffer, target_db: f32);
pub fn integrated_lufs(buf: &AudioBuffer) -> Option<f64>;
pub fn normalize_lufs(buf: &mut AudioBuffer, target_lufs: f32);
pub fn limit(buf: &mut AudioBuffer, ceiling_db: f32, release_ms: f32); // never exceeds ceiling
pub fn apply_volume(buf: &mut AudioBuffer, s: &VolumeSettings);     // gain -> normalize -> limiter

// dsp/biquad.rs
pub enum BiquadKind { Lowpass, Highpass, Bandpass /*0 dB peak*/, Notch, Peaking, LowShelf, HighShelf }
pub struct Coeffs { pub b0: f64, pub b1: f64, pub b2: f64, pub a1: f64, pub a2: f64 }
impl Coeffs { pub fn new(kind, freq: f64, q: f64, gain_db: f64, sample_rate: f64) -> Self; // freq clamped (1, 0.49 fs)
              pub fn magnitude_db(&self, freq: f64, sample_rate: f64) -> f64 }
pub fn process_cascade(buf: &mut AudioBuffer, cascade: &[Coeffs]);

// dsp/filter.rs
pub enum FilterType { Highpass /*default*/, Lowpass, Bandpass, Notch, Lowshelf, Highshelf }
pub struct FilterBand { id: String, #[serde(rename="type")] kind: FilterType, freq: f32 /*100*/, q: f32 /*0.7071*/,
    slope: u8 /*12|24|48*/, gain_db: f32 /*0*/, enabled: bool /*true*/ }
pub struct FilterSettings { enabled: bool /*false*/, items: Vec<FilterBand> /*[]*/ }
pub fn design(band: &FilterBand, sample_rate: f64) -> Vec<Coeffs>; // HP/LP slope>12 -> Butterworth Qs
pub fn apply_filters(buf: &mut AudioBuffer, s: &FilterSettings);   // bit-identical when disabled

// dsp/eq.rs
pub const EQ_FREQS: [f32;16] = [25,40,63,100,160,250,400,630,1000,1600,2500,4000,6300,10000,16000,20000];
pub const EQ_DEFAULT_Q: f32 = 1.4;
pub struct EqBand { freq: f32, gain_db: f32 /*0, -18..18*/, q: f32 /*1.4*/ }
pub struct EqSettings { enabled: bool /*false*/, bands: Vec<EqBand> /*16 bands at EQ_FREQS*/ }
pub fn apply_eq(buf: &mut AudioBuffer, s: &EqSettings); // skips flat bands and freq >= 0.49 fs

// dsp/stretch.rs
pub enum StretchMode { Stretch /*default*/, Varispeed }
pub struct PitchTempoSettings { enabled: bool, semitones: f32 /*0*/, cents: f32 /*0*/, tempo: f32 /*100 (%)*/, mode: StretchMode }
pub fn time_stretch(buf: &AudioBuffer, factor: f64) -> AudioBuffer;  // len *= factor, pitch kept (phase vocoder)
pub fn change_speed(buf: &AudioBuffer, ratio: f64) -> AudioBuffer;   // tape: 2.0 = half length, +1 octave
pub fn apply_pitch_tempo(buf: &AudioBuffer, s: &PitchTempoSettings) -> AudioBuffer;
// len_out = len / (tempo/100); pitch ratio = 2^((semi+cents/100)/12), times tempo ratio in Varispeed

// dsp/denoise.rs
pub enum DenoiseMode { Spectral /*default*/, Rnnoise }
pub struct DenoiseSettings { enabled: bool, mode: DenoiseMode, reduction_db: f32 /*12*/, sensitivity_db: f32 /*6*/,
    smoothing: f32 /*0.5*/, attack_ms: f32 /*5*/, release_ms: f32 /*50*/, profile_start: Option<f64>, profile_end: Option<f64> }
pub fn apply_denoise(buf: &AudioBuffer, s: &DenoiseSettings) -> AudioBuffer; // same length

// dsp/loop_builder.rs
pub struct LoopSettings { enabled: bool, crossfade_ms: f32 /*100*/, curve: FadeCurve /*EqualPower*/,
    start: Option<f64>, end: Option<f64>, zero_crossing: bool /*true*/, match_loudness: bool /*false*/ }
pub fn build_loop(buf: &AudioBuffer, s: &LoopSettings) -> Result<AudioBuffer>; // len = region - crossfade

// dsp/silence.rs
pub struct TrimSilenceSettings { enabled: bool, threshold_db: f32 /*-60*/, pad_ms: f32 /*10*/ }
pub fn trim_silence(buf: &AudioBuffer, s: &TrimSilenceSettings) -> AudioBuffer;
```

## 2. Project model (Rust `project.rs` by Agent B, TS `src/shared/types.ts` by Agent C — identical JSON)

```ts
type FadeCurve = 'linear' | 'exponential' | 'logarithmic' | 'sCurve' | 'equalPower';
interface Fade { duration: number; curve: FadeCurve }                       // {0,'linear'}
interface EffectChain {                                                        // order of processing:
  denoise: DenoiseSettings;      // 1
  pitchTempo: PitchTempoSettings;// 2
  filters: FilterSettings;       // 3
  eq: EqSettings;                // 4
  volume: VolumeSettings;        // 5
}
interface Track {
  id: string; sourceId: string; name: string;
  offset: number;          // seconds on the timeline (>= 0)
  clipStart: number;       // seconds inside the source (0)
  clipEnd: number | null;  // seconds inside the source (null = end)
  gainDb: number; pan: number; mute: boolean; solo: boolean;
  fadeIn: Fade; fadeOut: Fade;
  effects: EffectChain;
}
interface MasterSettings { effects: EffectChain; loop: LoopSettings; trimSilence: TrimSilenceSettings }
interface Project { tracks: Track[]; master: MasterSettings }
```
Track processing: source -> resample to project rate -> clip [clipStart, clipEnd) -> track effects chain -> fades -> gainDb -> pan -> placed at offset.
Project sample rate = max source sample rate among audible tracks; output channels = 2 if any audible track has >= 2 channels else 1.
Solo: if any audible track is solo, only solo & non-muted tracks play.
Master: mix -> master.effects -> loop -> trimSilence. Concatenation ("ghép") is done by the UI by setting offsets/fades; crossfades are overlapping fades.

`ExportOptions` (already in Rust `encode.rs`):
```ts
interface ExportOptions { format: 'wav'|'aiff'|'flac'|'mp3'|'ogg'; sampleRate: number /*0 = keep*/; channels: 'source'|'mono'|'stereo';
  bitDepth: 16|24|32; bitrateMode: 'cbr'|'vbr'; bitrateKbps: number; vbrQuality: number /*0..1*/;
  resampleQuality: 'fast'|'balanced'|'best'; dither: boolean }
// defaults: wav, 0, source, 16, cbr, 192, 0.7, best, true
// MP3 sample rates: 8000,11025,12000,16000,22050,24000,32000,44100,48000; MP3 CBR kbps: 8..320 standard list
```

## 3. IPC API exposed by preload as `window.api` (Agent B implements, Agent C consumes; type file `src/shared/api.ts` written by Agent C)

```ts
interface SourceInfo { id: string; path: string; name: string; format: string; sampleRate: number; channels: number;
  frames: number; duration: number; bitDepth: number | null; fileSize: number }
interface SpectrogramData { width: number; height: number; data: Uint8Array /*row-major, row 0 = highest freq*/;
  minFreq: number; maxFreq: number; dbFloor: number }
interface RenderRequest { sessionId: string; project: Project; preview: ExportOptions | null /*apply export settings to preview*/;
  peaksBuckets: number; spectrogramWidth: number; spectrogramHeight: number }
interface RenderResult { duration: number; sampleRate: number; channels: number; peaks: Float32Array /*min,max pairs*/;
  spectrogram: SpectrogramData; peakDb: number; lufs: number | null; averageSpectrum: Float32Array /*64 log bands dB*/ }
type PlayState = 'playing' | 'paused' | 'stopped';
interface TransportState { state: PlayState; position: number; duration: number; sessionId: string | null; loop: boolean }
interface ExportResult { canceled: boolean; path?: string; bytes?: number }
interface AudioApi {
  openFilesDialog(): Promise<string[]>;              // multi-select audio files
  openFolderDialog(): Promise<string[]>;             // returns supported audio files found recursively
  expandPaths(paths: string[]): Promise<string[]>;   // files+folders -> supported audio files (recursive, dedup, sorted)
  getPathForFile(file: File): string;                // webUtils.getPathForFile
  loadSource(path: string): Promise<SourceInfo>;     // id = normalized absolute path
  unloadSource(id: string): Promise<void>;
  sourcePeaks(id: string, buckets: number): Promise<Float32Array>;
  render(req: RenderRequest): Promise<RenderResult>; // also becomes the playback buffer of that session
  estimateSize(sessionId: string, project: Project, options: ExportOptions): Promise<number>; // exact bytes
  exportAudio(sessionId: string, project: Project, options: ExportOptions, suggestedName: string): Promise<ExportResult>;
      // main shows save dialog FIRST; nothing is written if canceled
  releaseSession(sessionId: string): Promise<void>;  // tab sleep: free render cache + playback buffer
  play(sessionId: string): Promise<void>; pause(): Promise<void>; stop(): Promise<void>;
  seek(seconds: number): Promise<void>;              // continues playing from there if playing
  setLoop(enabled: boolean): Promise<void>;
  getTransport(): Promise<TransportState>;
  onTransport(cb: (s: TransportState) => void): () => void; // pushed ~30 Hz while playing + on every change
}
```
Errors: promises reject with `Error` whose message starts with the code, e.g. `ERR_DECODE_FAILED: ...`. UI maps codes to i18n keys `errors.ERR_DECODE_FAILED`.
Test hook: when env `AUDIO_CUSTOMIZER_E2E_SAVE_PATH` is set, `exportAudio` uses it instead of showing the dialog (E2E only).

## 4. Definition of done (every agent)
Every function/component has unit tests; `cargo test --workspace` and `npm test` pass 100%, no skipped/ignored tests.
