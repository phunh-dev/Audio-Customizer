/**
 * Pure helpers for export options: validation (mirrors Rust
 * `encode::validate`), sanitising when switching format, choice lists and
 * file naming. No React, no IPC.
 */
import {
  MP3_BITRATES,
  MP3_SAMPLE_RATES,
  type BitDepth,
  type ChannelMode,
  type ExportFormat,
  type ExportOptions,
} from '@shared/types';

export const LOSSY_FORMATS: readonly ExportFormat[] = ['mp3', 'ogg'];

/** General sample-rate choices offered by the UI (0 = keep project rate). */
export const SAMPLE_RATE_CHOICES: readonly number[] = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000];

export const OGG_BITRATE_MIN = 32;
export const OGG_BITRATE_MAX = 320;
/** Rust accepts up to 500 kbps for OGG; the UI offers 32..320. */
export const OGG_BITRATE_RUST_MAX = 500;
export const OGG_BITRATE_CHOICES: readonly number[] = [32, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

export const SAMPLE_RATE_MIN = 4000;
export const SAMPLE_RATE_MAX = 384000;

export function isLossy(format: ExportFormat): boolean {
  return LOSSY_FORMATS.includes(format);
}

/** Bit depths shown for a format (empty for lossy formats). */
export function bitDepthsFor(format: ExportFormat): BitDepth[] {
  switch (format) {
    case 'wav':
    case 'aiff':
      return [16, 24, 32];
    case 'flac':
      return [16, 24];
    default:
      return [];
  }
}

/** Sample-rate choices (excluding "keep") for a format. */
export function sampleRatesFor(format: ExportFormat): number[] {
  return format === 'mp3' ? [...MP3_SAMPLE_RATES] : [...SAMPLE_RATE_CHOICES];
}

/** CBR bitrate choices for a format (empty for lossless). */
export function bitratesFor(format: ExportFormat): number[] {
  if (format === 'mp3') return [...MP3_BITRATES];
  if (format === 'ogg') return [...OGG_BITRATE_CHOICES];
  return [];
}

export function outputChannels(mode: ChannelMode, sourceChannels: number): number {
  switch (mode) {
    case 'mono':
      return 1;
    case 'stereo':
      return 2;
    default:
      return Math.max(1, sourceChannels);
  }
}

/** Effective output sample rate (0 = keep the project rate). */
export function effectiveSampleRate(opts: Pick<ExportOptions, 'sampleRate'>, projectSampleRate: number): number {
  return opts.sampleRate === 0 ? projectSampleRate : opts.sampleRate;
}

export type ValidationCode =
  | 'bitDepth'
  | 'vbrQuality'
  | 'sampleRate'
  | 'mp3SampleRate'
  | 'mp3Bitrate'
  | 'mp3Channels'
  | 'oggBitrate';

export interface ValidationIssue {
  field: keyof ExportOptions;
  /** i18n key under `export:validation.*` */
  code: ValidationCode;
  params?: Record<string, string | number>;
}

/**
 * Validate options against the project they will be applied to. Mirrors Rust
 * `encode::validate` (same checks, same order) but reports every issue.
 */
export function validateExportOptions(
  opts: ExportOptions,
  projectSampleRate: number,
  projectChannels: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!([16, 24, 32] as number[]).includes(opts.bitDepth)) {
    issues.push({ field: 'bitDepth', code: 'bitDepth', params: { value: opts.bitDepth } });
  }
  if (!(opts.vbrQuality >= 0 && opts.vbrQuality <= 1)) {
    issues.push({ field: 'vbrQuality', code: 'vbrQuality', params: { value: opts.vbrQuality } });
  }
  const sr = effectiveSampleRate(opts, projectSampleRate);
  if (!(sr >= SAMPLE_RATE_MIN && sr <= SAMPLE_RATE_MAX)) {
    issues.push({ field: 'sampleRate', code: 'sampleRate', params: { value: sr } });
  }
  if (opts.format === 'mp3') {
    if (!MP3_SAMPLE_RATES.includes(sr)) {
      issues.push({ field: 'sampleRate', code: 'mp3SampleRate', params: { value: sr } });
    }
    if (opts.bitrateMode === 'cbr' && !MP3_BITRATES.includes(opts.bitrateKbps)) {
      issues.push({ field: 'bitrateKbps', code: 'mp3Bitrate', params: { value: opts.bitrateKbps } });
    }
    if (outputChannels(opts.channels, projectChannels) > 2) {
      issues.push({ field: 'channels', code: 'mp3Channels' });
    }
  }
  if (
    opts.format === 'ogg' &&
    opts.bitrateMode === 'cbr' &&
    !(opts.bitrateKbps >= OGG_BITRATE_MIN && opts.bitrateKbps <= OGG_BITRATE_RUST_MAX)
  ) {
    issues.push({ field: 'bitrateKbps', code: 'oggBitrate', params: { value: opts.bitrateKbps } });
  }
  return issues;
}

export function isValidExport(opts: ExportOptions, projectSampleRate: number, projectChannels: number): boolean {
  return validateExportOptions(opts, projectSampleRate, projectChannels).length === 0;
}

/** Closest value of a list (ties -> the higher value). */
export function nearest(list: readonly number[], value: number): number {
  let best = list[0] ?? value;
  for (const v of list) {
    const d = Math.abs(v - value);
    const bd = Math.abs(best - value);
    if (d < bd || (d === bd && v > best)) best = v;
  }
  return best;
}

/**
 * Make options consistent with their format: called whenever the format (or
 * any option) changes so the user never ends up with an invalid combination.
 */
export function sanitizeExportOptions(
  opts: ExportOptions,
  projectSampleRate: number,
  projectChannels: number,
): ExportOptions {
  const o: ExportOptions = { ...opts };
  if (!([16, 24, 32] as number[]).includes(o.bitDepth)) o.bitDepth = 16;
  if (o.format === 'flac' && o.bitDepth === 32) o.bitDepth = 24;
  o.vbrQuality = Number.isFinite(o.vbrQuality) ? Math.min(1, Math.max(0, o.vbrQuality)) : 0.7;

  if (o.sampleRate !== 0) {
    o.sampleRate = Math.min(SAMPLE_RATE_MAX, Math.max(SAMPLE_RATE_MIN, Math.round(o.sampleRate)));
  }
  if (o.format === 'mp3') {
    const sr = effectiveSampleRate(o, projectSampleRate);
    if (!MP3_SAMPLE_RATES.includes(sr)) {
      o.sampleRate = nearest(MP3_SAMPLE_RATES, sr > 0 ? sr : 44100);
    }
    if (!MP3_BITRATES.includes(o.bitrateKbps)) o.bitrateKbps = nearest(MP3_BITRATES, o.bitrateKbps);
    if (outputChannels(o.channels, projectChannels) > 2) o.channels = 'stereo';
  } else if (o.format === 'ogg') {
    o.bitrateKbps = Math.min(OGG_BITRATE_MAX, Math.max(OGG_BITRATE_MIN, Math.round(o.bitrateKbps)));
  }
  return o;
}

/** Change the format and sanitise the rest of the options. */
export function withFormat(
  opts: ExportOptions,
  format: ExportFormat,
  projectSampleRate: number,
  projectChannels: number,
): ExportOptions {
  return sanitizeExportOptions({ ...opts, format }, projectSampleRate, projectChannels);
}

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const AUDIO_EXT = /\.(wav|aiff?|flac|mp3|ogg)$/i;

/** Suggested file name for the save dialog: "<base>.<ext>". */
export function suggestedFileName(base: string | null | undefined, format: ExportFormat): string {
  let name = (base ?? '').trim().replace(AUDIO_EXT, '').replace(INVALID_FILENAME_CHARS, '_').trim();
  name = name.replace(/[. ]+$/, '');
  if (!name) name = 'export';
  return `${name}.${format}`;
}

/** Replace the extension of a user-edited name to match the format. */
export function fileNameForFormat(name: string, format: ExportFormat): string {
  return suggestedFileName(name, format);
}

export interface ProjectFormat {
  sampleRate: number;
  channels: number;
}

export const FALLBACK_PROJECT_FORMAT: Readonly<ProjectFormat> = Object.freeze({ sampleRate: 44100, channels: 2 });

interface TrackLike {
  sourceId: string;
  mute: boolean;
  solo: boolean;
}
interface SourceLike {
  sampleRate: number;
  channels: number;
  fileSize?: number;
}

/**
 * Project output format per the contract: sample rate = max source rate of the
 * audible tracks, channels = 2 if any audible track has >= 2 channels else 1.
 * Falls back to 44.1 kHz stereo when nothing is audible / loaded.
 */
export function projectFormat(tracks: readonly TrackLike[], sources: Readonly<Record<string, SourceLike>>): ProjectFormat {
  const audible = tracks.filter((t) => !t.mute);
  const anySolo = audible.some((t) => t.solo);
  const playing = anySolo ? audible.filter((t) => t.solo) : audible;
  let sampleRate = 0;
  let stereo = false;
  let found = false;
  for (const t of playing) {
    const s = sources[t.sourceId];
    if (!s) continue;
    found = true;
    sampleRate = Math.max(sampleRate, s.sampleRate);
    if (s.channels >= 2) stereo = true;
  }
  if (!found || sampleRate <= 0) return { ...FALLBACK_PROJECT_FORMAT };
  return { sampleRate, channels: stereo ? 2 : 1 };
}

/** Total size of the distinct source files used by the tracks. */
export function sourceBytes(tracks: readonly TrackLike[], sources: Readonly<Record<string, SourceLike>>): number {
  const seen = new Set<string>();
  let total = 0;
  for (const t of tracks) {
    if (seen.has(t.sourceId)) continue;
    seen.add(t.sourceId);
    total += sources[t.sourceId]?.fileSize ?? 0;
  }
  return total;
}
