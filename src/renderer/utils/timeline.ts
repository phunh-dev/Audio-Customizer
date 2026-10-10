/** Coordinate <-> time conversion and ruler tick computation for the timeline. */

export interface Viewport {
  /** pixels per second */
  pxPerSec: number;
  /** seconds at the left edge */
  scroll: number;
}

export const MIN_PX_PER_SEC = 2;
export const MAX_PX_PER_SEC = 20000;

export function timeToX(t: number, vp: Viewport): number {
  return (t - vp.scroll) * vp.pxPerSec;
}

export function xToTime(x: number, vp: Viewport): number {
  return x / vp.pxPerSec + vp.scroll;
}

export function clampZoom(pxPerSec: number): number {
  return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, pxPerSec));
}

/** Zoom by `factor` keeping the time under `anchorX` fixed. */
export function zoomAt(vp: Viewport, factor: number, anchorX: number): Viewport {
  const anchorT = xToTime(anchorX, vp);
  const pxPerSec = clampZoom(vp.pxPerSec * factor);
  const scroll = Math.max(0, anchorT - anchorX / pxPerSec);
  return { pxPerSec, scroll };
}

/** Zoom level that fits `duration` seconds into `width` pixels. */
export function fitZoom(duration: number, width: number): number {
  if (duration <= 0 || width <= 0) return 100;
  return clampZoom(width / duration);
}

/** Clamp horizontal scroll so that the content (duration) stays reachable. */
export function clampScroll(scroll: number, duration: number, viewSeconds: number): number {
  const max = Math.max(0, duration - viewSeconds);
  return Math.min(max, Math.max(0, scroll));
}

const NICE_STEPS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
];

/** Pick a major tick interval so labels are at least `minPx` apart. */
export function tickStep(pxPerSec: number, minPx = 80): number {
  for (const s of NICE_STEPS) if (s * pxPerSec >= minPx) return s;
  return NICE_STEPS[NICE_STEPS.length - 1]!;
}

/** Major tick times visible in [scroll, scroll + width/pxPerSec]. */
export function ticks(vp: Viewport, width: number, minPx = 80): number[] {
  const step = tickStep(vp.pxPerSec, minPx);
  const end = vp.scroll + width / vp.pxPerSec;
  const first = Math.ceil(vp.scroll / step - 1e-9) * step;
  const out: number[] = [];
  for (let t = first; t <= end + 1e-9 && out.length < 1000; t += step) out.push(Number(t.toFixed(6)));
  return out;
}

/** Snap `t` to the nearest multiple of `grid` when within `thresholdSec`. */
export function snapTime(t: number, candidates: readonly number[], thresholdSec: number): number {
  let best = t;
  let bestDist = thresholdSec;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Frequency (Hz) -> y for a log-frequency axis of `height` px (y=0 top = maxFreq). */
export function freqToY(freq: number, minFreq: number, maxFreq: number, height: number): number {
  const lo = Math.log(Math.max(1, minFreq));
  const hi = Math.log(Math.max(minFreq + 1, maxFreq));
  const f = Math.log(Math.min(maxFreq, Math.max(minFreq, freq)));
  return height * (1 - (f - lo) / (hi - lo));
}

/** Frequency (Hz) -> y for a linear axis. */
export function freqToYLinear(freq: number, minFreq: number, maxFreq: number, height: number): number {
  const f = Math.min(maxFreq, Math.max(minFreq, freq));
  return height * (1 - (f - minFreq) / (maxFreq - minFreq));
}
