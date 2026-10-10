/**
 * Project model shared by renderer, preload and main.
 *
 * MUST stay JSON-identical to the Rust model (`crates/audio-core/src/project.rs`)
 * and the DSP settings structs — see docs/CONTRACTS.md section 1 and 2.
 * All defaults below are the contract defaults.
 */

// ---------------------------------------------------------------------------
// Fades
// ---------------------------------------------------------------------------

export type FadeCurve = 'linear' | 'exponential' | 'logarithmic' | 'sCurve' | 'equalPower';

export const FADE_CURVES: readonly FadeCurve[] = ['linear', 'exponential', 'logarithmic', 'sCurve', 'equalPower'];

export interface Fade {
  /** seconds */
  duration: number;
  curve: FadeCurve;
}

// ---------------------------------------------------------------------------
// Effect settings (one interface per Rust DSP settings struct)
// ---------------------------------------------------------------------------

export type DenoiseMode = 'spectral' | 'rnnoise';

export interface DenoiseSettings {
  enabled: boolean;
  mode: DenoiseMode;
  reductionDb: number;
  sensitivityDb: number;
  smoothing: number;
  attackMs: number;
  releaseMs: number;
  /** seconds inside the processed buffer; null = estimate automatically */
  profileStart: number | null;
  profileEnd: number | null;
}

export type StretchMode = 'stretch' | 'varispeed';

export interface PitchTempoSettings {
  enabled: boolean;
  semitones: number;
  cents: number;
  /** percent, 100 = unchanged */
  tempo: number;
  mode: StretchMode;
}

export type FilterType = 'highpass' | 'lowpass' | 'bandpass' | 'notch' | 'lowshelf' | 'highshelf';

export const FILTER_TYPES: readonly FilterType[] = ['highpass', 'lowpass', 'bandpass', 'notch', 'lowshelf', 'highshelf'];

export type FilterSlope = 12 | 24 | 48;

export interface FilterBand {
  id: string;
  type: FilterType;
  freq: number;
  q: number;
  slope: FilterSlope;
  gainDb: number;
  enabled: boolean;
}

export interface FilterSettings {
  enabled: boolean;
  items: FilterBand[];
}

export const EQ_FREQS: readonly number[] = [
  25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000, 20000,
];
export const EQ_DEFAULT_Q = 1.4;
export const EQ_GAIN_MIN = -18;
export const EQ_GAIN_MAX = 18;

export interface EqBand {
  freq: number;
  gainDb: number;
  q: number;
}

export interface EqSettings {
  enabled: boolean;
  bands: EqBand[];
}

export type NormalizeMode = 'off' | 'peak' | 'lufs';

export interface VolumeSettings {
  gainDb: number;
  normalize: NormalizeMode;
  normalizeTarget: number;
  limiter: boolean;
  limiterCeilingDb: number;
  limiterReleaseMs: number;
}

export interface LoopSettings {
  enabled: boolean;
  crossfadeMs: number;
  curve: FadeCurve;
  start: number | null;
  end: number | null;
  zeroCrossing: boolean;
  matchLoudness: boolean;
}

export interface TrimSilenceSettings {
  enabled: boolean;
  thresholdDb: number;
  padMs: number;
}

/** Order of processing: denoise -> pitchTempo -> filters -> eq -> volume. */
export interface EffectChain {
  denoise: DenoiseSettings;
  pitchTempo: PitchTempoSettings;
  filters: FilterSettings;
  eq: EqSettings;
  volume: VolumeSettings;
}

export type EffectKey = keyof EffectChain;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Track {
  id: string;
  sourceId: string;
  name: string;
  /** seconds on the timeline (>= 0) */
  offset: number;
  /** seconds inside the source */
  clipStart: number;
  /** seconds inside the source, null = end of source */
  clipEnd: number | null;
  gainDb: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  mute: boolean;
  solo: boolean;
  fadeIn: Fade;
  fadeOut: Fade;
  effects: EffectChain;
}

export interface MasterSettings {
  effects: EffectChain;
  loop: LoopSettings;
  trimSilence: TrimSilenceSettings;
}

export interface Project {
  tracks: Track[];
  master: MasterSettings;
}

/** Target of an effect-chain edit: the master bus or a track id. */
export type EffectTarget = 'master' | string;

// ---------------------------------------------------------------------------
// Export options (Rust encode.rs)
// ---------------------------------------------------------------------------

export type ExportFormat = 'wav' | 'aiff' | 'flac' | 'mp3' | 'ogg';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['wav', 'aiff', 'flac', 'mp3', 'ogg'];
export type ChannelMode = 'source' | 'mono' | 'stereo';
export type BitDepth = 16 | 24 | 32;
export type BitrateMode = 'cbr' | 'vbr';
export type ResampleQuality = 'fast' | 'balanced' | 'best';

export interface ExportOptions {
  format: ExportFormat;
  /** 0 = keep the project sample rate */
  sampleRate: number;
  channels: ChannelMode;
  bitDepth: BitDepth;
  bitrateMode: BitrateMode;
  bitrateKbps: number;
  /** 0 (smallest) .. 1 (best) */
  vbrQuality: number;
  resampleQuality: ResampleQuality;
  dither: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: Readonly<ExportOptions> = Object.freeze({
  format: 'wav',
  sampleRate: 0,
  channels: 'source',
  bitDepth: 16,
  bitrateMode: 'cbr',
  bitrateKbps: 192,
  vbrQuality: 0.7,
  resampleQuality: 'best',
  dither: true,
} satisfies ExportOptions);

export const MP3_SAMPLE_RATES: readonly number[] = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
export const MP3_BITRATES: readonly number[] = [8, 16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
export const SUPPORTED_EXTENSIONS: readonly string[] = ['mp3', 'wav', 'aiff', 'aif', 'ogg', 'flac'];

// ---------------------------------------------------------------------------
// Default factories (always return fresh objects)
// ---------------------------------------------------------------------------

export function createDefaultFade(): Fade {
  return { duration: 0, curve: 'linear' };
}

export function createDefaultDenoise(): DenoiseSettings {
  return {
    enabled: false,
    mode: 'spectral',
    reductionDb: 12,
    sensitivityDb: 6,
    smoothing: 0.5,
    attackMs: 5,
    releaseMs: 50,
    profileStart: null,
    profileEnd: null,
  };
}

export function createDefaultPitchTempo(): PitchTempoSettings {
  return { enabled: false, semitones: 0, cents: 0, tempo: 100, mode: 'stretch' };
}

export function createDefaultFilterBand(id: string, type: FilterType = 'highpass'): FilterBand {
  return { id, type, freq: 100, q: 0.7071, slope: 12, gainDb: 0, enabled: true };
}

export function createDefaultFilters(): FilterSettings {
  return { enabled: false, items: [] };
}

export function createDefaultEq(): EqSettings {
  return { enabled: false, bands: EQ_FREQS.map((freq) => ({ freq, gainDb: 0, q: EQ_DEFAULT_Q })) };
}

export function createDefaultVolume(): VolumeSettings {
  return {
    gainDb: 0,
    normalize: 'off',
    normalizeTarget: -1,
    limiter: false,
    limiterCeilingDb: -1,
    limiterReleaseMs: 50,
  };
}

export function createDefaultLoop(): LoopSettings {
  return {
    enabled: false,
    crossfadeMs: 100,
    curve: 'equalPower',
    start: null,
    end: null,
    zeroCrossing: true,
    matchLoudness: false,
  };
}

export function createDefaultTrimSilence(): TrimSilenceSettings {
  return { enabled: false, thresholdDb: -60, padMs: 10 };
}

export function createDefaultEffectChain(): EffectChain {
  return {
    denoise: createDefaultDenoise(),
    pitchTempo: createDefaultPitchTempo(),
    filters: createDefaultFilters(),
    eq: createDefaultEq(),
    volume: createDefaultVolume(),
  };
}

export function createDefaultMaster(): MasterSettings {
  return {
    effects: createDefaultEffectChain(),
    loop: createDefaultLoop(),
    trimSilence: createDefaultTrimSilence(),
  };
}

export function createDefaultTrack(id: string, sourceId: string, name: string, offset = 0): Track {
  return {
    id,
    sourceId,
    name,
    offset,
    clipStart: 0,
    clipEnd: null,
    gainDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    fadeIn: createDefaultFade(),
    fadeOut: createDefaultFade(),
    effects: createDefaultEffectChain(),
  };
}

export function createDefaultProject(): Project {
  return { tracks: [], master: createDefaultMaster() };
}

export function createDefaultExportOptions(): ExportOptions {
  return { ...DEFAULT_EXPORT_OPTIONS };
}
