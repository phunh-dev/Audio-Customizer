/**
 * Native addon (crates/audio-napi) typing + loading.
 * Keep `NativeEngine` in sync with crates/audio-napi/index.d.ts.
 */
import { join } from 'node:path';
import type { RenderResult, SourceInfo, TransportState } from '@shared/api';

export interface NativeEngine {
  ping(): string;
  loadSource(path: string): Promise<SourceInfo>;
  unloadSource(id: string): void;
  sourcePeaks(id: string, buckets: number): Promise<Float32Array>;
  render(
    sessionId: string,
    projectJson: string,
    previewJson: string | null,
    peaksBuckets: number,
    spectrogramWidth: number,
    spectrogramHeight: number,
  ): Promise<RenderResult>;
  estimateSize(sessionId: string, projectJson: string, optionsJson: string): Promise<number>;
  export(sessionId: string, projectJson: string, optionsJson: string, path: string): Promise<number>;
  releaseSession(sessionId: string): void;
  play(sessionId: string): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  step(deltaSeconds: number): void;
  setLoop(enabled: boolean): void;
  transportState(): TransportState;
  closeOutput(): void;
}

export const ADDON_FILE = 'audio_napi.node';

export interface AddonLocation {
  isPackaged: boolean;
  /** `process.resourcesPath` */
  resourcesPath: string;
  /** `app.getAppPath()` (project root in development) */
  appPath: string;
}

/** dev: <root>/native/audio_napi.node, packaged: <resources>/native/audio_napi.node */
export function resolveAddonPath(loc: AddonLocation): string {
  const base = loc.isPackaged ? loc.resourcesPath : loc.appPath;
  return join(base, 'native', ADDON_FILE);
}

const REQUIRED: (keyof NativeEngine)[] = [
  'ping',
  'loadSource',
  'unloadSource',
  'sourcePeaks',
  'render',
  'estimateSize',
  'export',
  'releaseSession',
  'play',
  'pause',
  'stop',
  'seek',
  'setLoop',
  'transportState',
];

/** Load and sanity check the addon. Throws `ERR_IO: ...` when unusable. */
export function loadAddon(path: string, requireFn: (id: string) => unknown): NativeEngine {
  let mod: unknown;
  try {
    mod = requireFn(path);
  } catch (e) {
    throw new Error(`ERR_IO: cannot load native engine ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const missing = REQUIRED.filter((k) => typeof (mod as Record<string, unknown>)?.[k] !== 'function');
  if (missing.length > 0) {
    throw new Error(`ERR_IO: native engine ${path} is missing ${missing.join(', ')}`);
  }
  return mod as NativeEngine;
}
