/** Quick optimisation presets (export settings + trim silence) and sample-rate hints. */
import { createDefaultExportOptions, type ExportOptions, type MasterSettings } from '@shared/types';

export type OptimizePresetId = 'sfxMobile' | 'bgm' | 'voice' | 'losslessMaster';

export interface OptimizePreset {
  id: OptimizePresetId;
  /** Fields overriding the current export options. */
  options: Partial<ExportOptions>;
  /** Enable trim-silence on the master. */
  trimSilence: boolean;
}

export const OPTIMIZE_PRESETS: readonly OptimizePreset[] = [
  {
    id: 'sfxMobile',
    options: { format: 'ogg', sampleRate: 22050, channels: 'mono', bitrateMode: 'vbr', vbrQuality: 0.4 },
    trimSilence: true,
  },
  {
    id: 'bgm',
    options: { format: 'ogg', sampleRate: 44100, channels: 'stereo', bitrateMode: 'vbr', vbrQuality: 0.6 },
    trimSilence: false,
  },
  {
    id: 'voice',
    options: { format: 'mp3', sampleRate: 22050, channels: 'mono', bitrateMode: 'cbr', bitrateKbps: 64 },
    trimSilence: true,
  },
  {
    id: 'losslessMaster',
    options: { format: 'flac', sampleRate: 48000, channels: 'source', bitDepth: 24, dither: true },
    trimSilence: false,
  },
];

export function getOptimizePreset(id: OptimizePresetId): OptimizePreset {
  const p = OPTIMIZE_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown optimize preset ${id}`);
  return p;
}

/** Export options after applying a preset on top of `base`. */
export function applyOptimizePreset(base: ExportOptions | null | undefined, id: OptimizePresetId): ExportOptions {
  return { ...(base ?? createDefaultExportOptions()), ...getOptimizePreset(id).options };
}

/** Master recipe for the preset's trim-silence setting. */
export function applyOptimizePresetToMaster(master: MasterSettings, id: OptimizePresetId): void {
  master.trimSilence.enabled = getOptimizePreset(id).trimSilence;
}

/** Id of the preset whose options are all matched by `opts`, or null. */
export function matchOptimizePreset(opts: ExportOptions): OptimizePresetId | null {
  for (const p of OPTIMIZE_PRESETS) {
    const ok = (Object.keys(p.options) as (keyof ExportOptions)[]).every((k) => opts[k] === p.options[k]);
    if (ok) return p.id;
  }
  return null;
}
