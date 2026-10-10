/** Value <-> normalised-position mappings used by sliders, knobs and plots. */

export const FREQ_MIN = 20;
export const FREQ_MAX = 20000;

export function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

/** Map a frequency onto [0, 1] logarithmically. */
export function freqToPos(freq: number, min = FREQ_MIN, max = FREQ_MAX): number {
  const f = clamp(freq, min, max);
  return Math.log(f / min) / Math.log(max / min);
}

/** Inverse of {@link freqToPos}. */
export function posToFreq(pos: number, min = FREQ_MIN, max = FREQ_MAX): number {
  const p = clamp(pos, 0, 1);
  return min * Math.pow(max / min, p);
}

/** Linear value -> [0, 1]. */
export function linToPos(v: number, min: number, max: number): number {
  if (max === min) return 0;
  return (clamp(v, min, max) - min) / (max - min);
}

/** [0, 1] -> linear value. */
export function posToLin(pos: number, min: number, max: number): number {
  return min + clamp(pos, 0, 1) * (max - min);
}

export type ScaleKind = 'linear' | 'log';

export function valueToPos(v: number, min: number, max: number, scale: ScaleKind = 'linear'): number {
  return scale === 'log' ? freqToPos(v, min, max) : linToPos(v, min, max);
}

export function posToValue(pos: number, min: number, max: number, scale: ScaleKind = 'linear'): number {
  return scale === 'log' ? posToFreq(pos, min, max) : posToLin(pos, min, max);
}

/** Count decimals of a step value (0.01 -> 2). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Snap a value onto the step grid anchored at `min`, then clamp. */
export function snapToStep(v: number, min: number, max: number, step: number): number {
  const c = clamp(v, min, max);
  if (!(step > 0)) return c;
  const snapped = min + Math.round((c - min) / step) * step;
  const d = stepDecimals(step) + Math.max(0, stepDecimals(min));
  return clamp(Number(snapped.toFixed(Math.min(d, 12))), min, max);
}

/** `n` frequencies spaced logarithmically between min and max (inclusive). */
export function logFrequencies(n: number, min = FREQ_MIN, max = FREQ_MAX): number[] {
  if (n <= 1) return [min];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(posToFreq(i / (n - 1), min, max));
  return out;
}
