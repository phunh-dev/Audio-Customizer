/** Time formatting and transport step math. */

export type StepUnit = 'sample' | 'ms1' | 'ms10' | 'ms100' | 's1' | 'frame24' | 'frame30' | 'frame60';

export const STEP_UNITS: readonly StepUnit[] = ['sample', 'ms1', 'ms10', 'ms100', 's1', 'frame24', 'frame30', 'frame60'];

export const DEFAULT_SAMPLE_RATE = 44100;

/** Size of one step in seconds. `sampleRate` is only used by the 'sample' unit. */
export function stepSeconds(unit: StepUnit, sampleRate: number = DEFAULT_SAMPLE_RATE): number {
  switch (unit) {
    case 'sample':
      return 1 / (sampleRate > 0 ? sampleRate : DEFAULT_SAMPLE_RATE);
    case 'ms1':
      return 0.001;
    case 'ms10':
      return 0.01;
    case 'ms100':
      return 0.1;
    case 's1':
      return 1;
    case 'frame24':
      return 1 / 24;
    case 'frame30':
      return 1 / 30;
    case 'frame60':
      return 1 / 60;
  }
}

export function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/**
 * Move `position` by `direction` steps of `unit`, clamped to [0, duration].
 * Frame and sample units snap to the grid of that unit so repeated stepping
 * stays aligned (e.g. 0.05 -> next 24 fps frame = 1/24).
 */
export function stepPosition(
  position: number,
  direction: 1 | -1,
  unit: StepUnit,
  duration: number,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): number {
  const step = stepSeconds(unit, sampleRate);
  const index = position / step;
  const eps = 1e-6;
  let next: number;
  if (direction > 0) next = (Math.floor(index + eps) + 1) * step;
  else next = (Math.ceil(index - eps) - 1) * step;
  return clamp(next, 0, Math.max(0, duration));
}

/** mm:ss.mmm (or h:mm:ss.mmm when >= 1 hour). Negative values are clamped to 0. */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalMs = Math.round(s * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hours = Math.floor(totalMin / 60);
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}.${mmm}` : `${mm}:${ss}.${mmm}`;
}

/** Short ruler label: "0:05", "1:30", "0:00.250" when `withMs`. */
export function formatRulerLabel(seconds: number, withMs = false): string {
  const s = Math.max(0, seconds);
  const min = Math.floor(s / 60);
  const sec = s - min * 60;
  if (withMs) {
    const whole = Math.floor(sec + 1e-9);
    const ms = Math.round((sec - whole) * 1000);
    return `${min}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }
  return `${min}:${String(Math.floor(sec + 1e-9)).padStart(2, '0')}`;
}

/** Human duration for track info: "1:23.4" / "0:00.5". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const tenths = Math.round(s * 10);
  const min = Math.floor(tenths / 600);
  const rest = (tenths - min * 600) / 10;
  return `${min}:${rest.toFixed(1).padStart(4, '0')}`;
}
