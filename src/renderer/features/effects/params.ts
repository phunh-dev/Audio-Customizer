/**
 * Ranges, steps and defaults of every editable effect parameter (plan
 * section 4 + docs/CONTRACTS.md). Defaults come from the contract factories.
 */
import {
  createDefaultDenoise,
  createDefaultFilterBand,
  createDefaultLoop,
  createDefaultPitchTempo,
  createDefaultTrimSilence,
  createDefaultVolume,
  EQ_DEFAULT_Q,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
} from '@shared/types';
import type { ScaleKind } from '@renderer/lib/dsp/scale';

export interface ParamSpec {
  min: number;
  max: number;
  step: number;
  default: number;
  scale?: ScaleKind;
}

const vol = createDefaultVolume();
const pt = createDefaultPitchTempo();
const band = createDefaultFilterBand('spec');
const dn = createDefaultDenoise();
const lp = createDefaultLoop();
const ts = createDefaultTrimSilence();

export const PARAMS = {
  volume: {
    gainDb: { min: -60, max: 24, step: 0.1, default: vol.gainDb },
    peakTarget: { min: -24, max: 0, step: 0.1, default: -1 },
    lufsTarget: { min: -40, max: -5, step: 0.5, default: -14 },
    limiterCeilingDb: { min: -24, max: 0, step: 0.1, default: vol.limiterCeilingDb },
    limiterReleaseMs: { min: 1, max: 1000, step: 1, default: vol.limiterReleaseMs },
  },
  pitchTempo: {
    semitones: { min: -24, max: 24, step: 1, default: pt.semitones },
    cents: { min: -100, max: 100, step: 1, default: pt.cents },
    tempo: { min: 25, max: 400, step: 1, default: pt.tempo },
  },
  filter: {
    freq: { min: 20, max: 20000, step: 1, default: band.freq, scale: 'log' },
    q: { min: 0.1, max: 18, step: 0.01, default: band.q },
    gainDb: { min: -24, max: 24, step: 0.1, default: band.gainDb },
  },
  eq: {
    gainDb: { min: EQ_GAIN_MIN, max: EQ_GAIN_MAX, step: 0.1, default: 0 },
    q: { min: 0.1, max: 18, step: 0.01, default: EQ_DEFAULT_Q },
  },
  denoise: {
    reductionDb: { min: 0, max: 48, step: 0.5, default: dn.reductionDb },
    sensitivityDb: { min: 0, max: 24, step: 0.5, default: dn.sensitivityDb },
    smoothing: { min: 0, max: 1, step: 0.01, default: dn.smoothing },
    attackMs: { min: 0, max: 500, step: 1, default: dn.attackMs },
    releaseMs: { min: 1, max: 2000, step: 1, default: dn.releaseMs },
  },
  loop: {
    crossfadeMs: { min: 0, max: 5000, step: 1, default: lp.crossfadeMs },
  },
  trimSilence: {
    thresholdDb: { min: -96, max: -20, step: 1, default: ts.thresholdDb },
    padMs: { min: 0, max: 1000, step: 1, default: ts.padMs },
  },
} as const satisfies Record<string, Record<string, ParamSpec>>;

export const FILTER_SLOPES = [12, 24, 48] as const;

/** Default normalize target per mode (switching mode moves the target into range). */
export function normalizeTargetSpec(mode: 'off' | 'peak' | 'lufs'): ParamSpec {
  return mode === 'lufs' ? PARAMS.volume.lufsTarget : PARAMS.volume.peakTarget;
}

/** Props for Slider / SliderField / Knob from a spec. */
export function rangeProps(p: ParamSpec): { min: number; max: number; step: number; scale?: ScaleKind; defaultValue: number } {
  return p.scale ? { min: p.min, max: p.max, step: p.step, scale: p.scale, defaultValue: p.default } : { min: p.min, max: p.max, step: p.step, defaultValue: p.default };
}
