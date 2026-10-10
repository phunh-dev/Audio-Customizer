/** Pure value math shared by Knob, Fader, Slider and NumberField. */
import { clamp, posToValue, snapToStep, stepDecimals, valueToPos, type ScaleKind } from '@renderer/lib/dsp/scale';

export interface RangeSpec {
  min: number;
  max: number;
  step: number;
  scale?: ScaleKind;
}

/** Pixels of vertical drag for a full-range sweep (normal / fine). */
export const DRAG_PIXELS = 200;
export const FINE_FACTOR = 10;

/** Snap + clamp a value according to the range. */
export function normalizeValue(v: number, r: RangeSpec): number {
  return snapToStep(v, r.min, r.max, r.step);
}

/**
 * Keyboard / wheel step. Linear: +-step (x10 with `large`). Log: moves 1 % of
 * the position range (10 % large, 0.1 % fine) so that frequencies feel even.
 */
export function nudge(
  value: number,
  direction: 1 | -1,
  r: RangeSpec,
  opts: { large?: boolean; fine?: boolean } = {},
): number {
  if (r.scale === 'log') {
    const delta = opts.large ? 0.1 : opts.fine ? 0.001 : 0.01;
    const pos = valueToPos(value, r.min, r.max, 'log') + direction * delta;
    const next = normalizeValue(posToValue(pos, r.min, r.max, 'log'), r);
    // guarantee progress for coarse steps
    if (next === value && pos > 0 && pos < 1) return normalizeValue(value + direction * r.step, r);
    return next;
  }
  const mult = opts.large ? 10 : 1;
  return normalizeValue(value + direction * r.step * mult, r);
}

/** Normalised position after moving `dy` pixels (positive = upwards). */
export function dragPosition(pos: number, dy: number, fine = false): number {
  return clamp(pos + dy / (DRAG_PIXELS * (fine ? FINE_FACTOR : 1)), 0, 1);
}

/** Value after a vertical drag of `dy` pixels (positive = upwards). */
export function dragValue(startValue: number, dy: number, r: RangeSpec, fine = false): number {
  const startPos = valueToPos(startValue, r.min, r.max, r.scale);
  const pos = clamp(startPos + dy / (DRAG_PIXELS * (fine ? FINE_FACTOR : 1)), 0, 1);
  return normalizeValue(posToValue(pos, r.min, r.max, r.scale), r);
}

/** Default read-out of a value with decimals derived from the step. */
export function defaultFormat(v: number, step: number, unit?: string): string {
  const d = Math.min(stepDecimals(step), 4);
  const s = (Object.is(Number(v.toFixed(d)), -0) ? 0 : v).toFixed(d);
  return unit ? `${s} ${unit}` : s;
}

/**
 * Parse a typed number. Accepts "," as decimal separator (Vietnamese
 * locale), surrounding unit text and "k" suffix (2.5k = 2500).
 * Returns null when nothing numeric can be read.
 */
export function parseNumberInput(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(',', '.');
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(k)?/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] ? n * 1000 : n;
}
