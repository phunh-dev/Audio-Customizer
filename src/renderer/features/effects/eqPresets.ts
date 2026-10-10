/** 16-band EQ presets (pure data + helpers). Gains follow EQ_FREQS order. */
import { EQ_DEFAULT_Q, EQ_FREQS, EQ_GAIN_MAX, EQ_GAIN_MIN, type EqSettings } from '@shared/types';

export type EqPresetId = 'flat' | 'bassBoost' | 'trebleBoost' | 'vocalPresence' | 'loFi' | 'telephone';

export interface EqPreset {
  id: EqPresetId;
  /** 16 gains in dB, one per EQ_FREQS entry */
  gains: readonly number[];
}

//                         25   40   63  100  160  250  400  630   1k 1.6k 2.5k   4k 6.3k  10k  16k  20k
export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 'flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bassBoost', gains: [6, 6, 5.5, 4.5, 3, 1.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'trebleBoost', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6, 6] },
  { id: 'vocalPresence', gains: [-6, -5, -3, -2, -1, 0, 0, 1, 2, 3, 4, 3.5, 2, 1, 0, 0] },
  { id: 'loFi', gains: [-18, -15, -10, -6, -2, 0, 2, 3, 3, 2, 0, -3, -8, -12, -18, -18] },
  { id: 'telephone', gains: [-18, -18, -18, -15, -10, -4, 0, 3, 4.5, 4.5, 2, -4, -12, -18, -18, -18] },
];

export const EQ_PRESET_IDS: readonly EqPresetId[] = EQ_PRESETS.map((p) => p.id);

export function getEqPreset(id: EqPresetId): EqPreset {
  const p = EQ_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown EQ preset ${id}`);
  return p;
}

/**
 * Apply a preset to an EQ draft (immer recipe friendly): resets the 16 bands
 * to the contract frequencies with default Q and the preset gains and
 * enables the EQ (except for "flat").
 */
export function applyEqPreset(eq: EqSettings, id: EqPresetId): void {
  const preset = getEqPreset(id);
  eq.bands = EQ_FREQS.map((freq, i) => ({
    freq,
    gainDb: Math.min(EQ_GAIN_MAX, Math.max(EQ_GAIN_MIN, preset.gains[i] ?? 0)),
    q: EQ_DEFAULT_Q,
  }));
  if (id !== 'flat') eq.enabled = true;
}

/** Reset all bands to 0 dB / default Q (keeps the enabled flag). */
export function resetEqBands(eq: EqSettings): void {
  eq.bands = EQ_FREQS.map((freq) => ({ freq, gainDb: 0, q: EQ_DEFAULT_Q }));
}

/** Id of the preset the EQ currently matches exactly, or null ("custom"). */
export function matchEqPreset(eq: EqSettings): EqPresetId | null {
  if (eq.bands.length !== EQ_FREQS.length) return null;
  for (const p of EQ_PRESETS) {
    const ok = eq.bands.every(
      (b, i) => b.freq === EQ_FREQS[i] && Math.abs(b.gainDb - (p.gains[i] ?? 0)) < 1e-6 && Math.abs(b.q - EQ_DEFAULT_Q) < 1e-6,
    );
    if (ok) return p.id;
  }
  return null;
}
