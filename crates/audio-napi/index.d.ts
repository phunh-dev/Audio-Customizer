/**
 * Type declarations of the native addon `native/audio_napi.node`
 * (crates/audio-napi). Hand-written; keep in sync with src/lib.rs.
 *
 * - Projects and export options are passed as JSON strings (camelCase,
 *   identical to src/shared/types.ts).
 * - Every rejection / throw is an Error whose message starts with an
 *   `ERR_*` code, e.g. `ERR_DECODE_FAILED: ...`.
 * - Promise-returning calls run on the libuv thread pool.
 */

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
  /** row-major, row 0 = highest frequency, 0..255 */
  data: Uint8Array;
  minFreq: number;
  maxFreq: number;
  dbFloor: number;
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
  /** 64 log bands, dB */
  averageSpectrum: Float32Array;
}

export interface TransportState {
  state: 'playing' | 'paused' | 'stopped';
  position: number;
  duration: number;
  sessionId: string | null;
  loop: boolean;
}

export declare function ping(): string;

/** Decode a file; id = normalized absolute path. Reloading replaces it. */
export declare function loadSource(path: string): Promise<SourceInfo>;
export declare function unloadSource(id: string): void;
export declare function sourcePeaks(id: string, buckets: number): Promise<Float32Array>;

/**
 * Render `projectJson` for a session. `previewJson` (ExportOptions JSON or
 * null) renders the result as it will be exported. The result becomes the
 * session's playback buffer.
 */
export declare function render(
  sessionId: string,
  projectJson: string,
  previewJson: string | null,
  peaksBuckets: number,
  spectrogramWidth: number,
  spectrogramHeight: number,
): Promise<RenderResult>;

/** Exact size in bytes of the exported file. */
export declare function estimateSize(sessionId: string, projectJson: string, optionsJson: string): Promise<number>;

/** Encode and write to `path` (and nowhere else). Resolves to bytes written. */
declare function exportAudio(sessionId: string, projectJson: string, optionsJson: string, path: string): Promise<number>;
export { exportAudio as export };

/** Free the session's caches and playback buffer (tab sleep). */
export declare function releaseSession(sessionId: string): void;

/** Throws ERR_SESSION_NOT_FOUND (nothing rendered) or ERR_NO_AUDIO_DEVICE. */
export declare function play(sessionId: string): void;
export declare function pause(): void;
export declare function stop(): void;
export declare function seek(seconds: number): void;
export declare function step(deltaSeconds: number): void;
export declare function setLoop(enabled: boolean): void;
export declare function transportState(): TransportState;
/** Close the audio device (reopened on the next play). */
export declare function closeOutput(): void;
