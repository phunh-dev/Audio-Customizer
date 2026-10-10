/**
 * IPC API exposed by the preload script as `window.api`.
 * Contract: docs/CONTRACTS.md section 3 (Agent B implements, renderer consumes).
 *
 * Errors: every promise rejects with an `Error` whose message starts with an
 * `ERR_*` code (e.g. `ERR_DECODE_FAILED: ...`). The UI maps the code to the
 * i18n key `errors.<code>`.
 */
import type { ExportOptions, Project } from './types';

export interface SourceInfo {
  /** normalized absolute path */
  id: string;
  path: string;
  name: string;
  format: string;
  sampleRate: number;
  channels: number;
  frames: number;
  duration: number;
  bitDepth: number | null;
  fileSize: number;
}

export interface SpectrogramData {
  width: number;
  height: number;
  /** row-major, row 0 = highest frequency, values 0..255 (dB mapped) */
  data: Uint8Array;
  minFreq: number;
  maxFreq: number;
  dbFloor: number;
}

export interface RenderRequest {
  sessionId: string;
  project: Project;
  /** apply export settings to the preview (null = full quality preview) */
  preview: ExportOptions | null;
  peaksBuckets: number;
  spectrogramWidth: number;
  spectrogramHeight: number;
}

export interface RenderResult {
  duration: number;
  sampleRate: number;
  channels: number;
  /** min,max pairs */
  peaks: Float32Array;
  spectrogram: SpectrogramData;
  peakDb: number;
  lufs: number | null;
  /** 64 log-spaced bands, dB */
  averageSpectrum: Float32Array;
}

export type PlayState = 'playing' | 'paused' | 'stopped';

export interface TransportState {
  state: PlayState;
  position: number;
  duration: number;
  sessionId: string | null;
  loop: boolean;
}

export interface ExportResult {
  canceled: boolean;
  path?: string;
  bytes?: number;
}

export interface AudioApi {
  /** multi-select audio files */
  openFilesDialog(): Promise<string[]>;
  /** supported audio files found recursively in the chosen folder */
  openFolderDialog(): Promise<string[]>;
  /** files + folders -> supported audio files (recursive, dedup, sorted) */
  expandPaths(paths: string[]): Promise<string[]>;
  /** webUtils.getPathForFile */
  getPathForFile(file: File): string;
  /** id = normalized absolute path */
  loadSource(path: string): Promise<SourceInfo>;
  unloadSource(id: string): Promise<void>;
  sourcePeaks(id: string, buckets: number): Promise<Float32Array>;
  /** also becomes the playback buffer of that session */
  render(req: RenderRequest): Promise<RenderResult>;
  /** exact bytes */
  estimateSize(sessionId: string, project: Project, options: ExportOptions): Promise<number>;
  /** main shows the save dialog FIRST; nothing is written if canceled */
  exportAudio(sessionId: string, project: Project, options: ExportOptions, suggestedName: string): Promise<ExportResult>;
  /** tab sleep: free render cache + playback buffer */
  releaseSession(sessionId: string): Promise<void>;
  play(sessionId: string): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  /** continues playing from there if playing */
  seek(seconds: number): Promise<void>;
  setLoop(enabled: boolean): Promise<void>;
  getTransport(): Promise<TransportState>;
  /** pushed ~30 Hz while playing + on every change; returns an unsubscribe function */
  onTransport(cb: (s: TransportState) => void): () => void;
}

/** Every error code the engine / main process can produce. */
export const ERROR_CODES = [
  'ERR_FILE_NOT_FOUND',
  'ERR_UNSUPPORTED_FORMAT',
  'ERR_DECODE_FAILED',
  'ERR_ENCODE_FAILED',
  'ERR_INVALID_PARAM',
  'ERR_IO',
  'ERR_NO_AUDIO_DEVICE',
  'ERR_SOURCE_NOT_LOADED',
  'ERR_SESSION_NOT_FOUND',
  'ERR_EMPTY_PROJECT',
  'ERR_UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Extract the `ERR_*` code from an error (or anything thrown). Unknown -> 'ERR_UNKNOWN'. */
export function errorCodeOf(err: unknown): ErrorCode {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const m = /^(ERR_[A-Z_]+)/.exec(msg);
  if (m && (ERROR_CODES as readonly string[]).includes(m[1]!)) return m[1] as ErrorCode;
  return 'ERR_UNKNOWN';
}

/** Detail part of an error message (after `ERR_X: `). */
export function errorDetailOf(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const m = /^ERR_[A-Z_]+:?\s*(.*)$/s.exec(msg);
  return m ? m[1]! : msg;
}

declare global {
  interface Window {
    api: AudioApi;
  }
}
