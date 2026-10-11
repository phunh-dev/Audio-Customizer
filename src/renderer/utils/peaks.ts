/**
 * Waveform peak resampling: `peaks` holds (min, max) pairs covering a domain of
 * `duration` seconds. Produce one (min, max) pair per output pixel column.
 */
export function peakColumns(
  peaks: Float32Array,
  duration: number,
  startTime: number,
  secondsPerPx: number,
  width: number,
): Float32Array {
  const cols = Math.max(0, Math.floor(width));
  const out = new Float32Array(cols * 2);
  const n = Math.floor(peaks.length / 2);
  if (n === 0 || duration <= 0 || secondsPerPx <= 0) return out;
  const bucketsPerSec = n / duration;
  for (let x = 0; x < cols; x++) {
    const t0 = startTime + x * secondsPerPx;
    const t1 = t0 + secondsPerPx;
    if (t1 <= 0 || t0 >= duration) continue;
    let i0 = Math.floor(Math.max(0, t0) * bucketsPerSec);
    let i1 = Math.ceil(Math.min(duration, t1) * bucketsPerSec);
    i0 = Math.min(n - 1, Math.max(0, i0));
    i1 = Math.min(n, Math.max(i0 + 1, i1));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = i0; i < i1; i++) {
      const a = peaks[i * 2]!;
      const b = peaks[i * 2 + 1]!;
      if (a < mn) mn = a;
      if (b > mx) mx = b;
    }
    out[x * 2] = mn;
    out[x * 2 + 1] = mx;
  }
  return out;
}

export interface WaveStyle {
  color: string | CanvasGradient;
  /** vertical scale (1 = full height for amplitude 1) */
  gain?: number;
}

/** Draw columns produced by `peakColumns` centred in [y, y + height). */
export function drawPeakColumns(
  ctx: CanvasRenderingContext2D,
  columns: Float32Array,
  x0: number,
  y: number,
  height: number,
  style: WaveStyle,
): void {
  const mid = y + height / 2;
  const half = (height / 2) * (style.gain ?? 1);
  ctx.fillStyle = style.color;
  const cols = columns.length / 2;
  for (let x = 0; x < cols; x++) {
    const mn = columns[x * 2]!;
    const mx = columns[x * 2 + 1]!;
    if (mn === 0 && mx === 0) continue;
    const top = mid - Math.min(1, Math.max(-1, mx)) * half;
    const bottom = mid - Math.min(1, Math.max(-1, mn)) * half;
    ctx.fillRect(x0 + x, top, 1, Math.max(1, bottom - top));
  }
}
