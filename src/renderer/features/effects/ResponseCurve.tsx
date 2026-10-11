import { useEffect, useRef, useState } from 'react';
import { cssVar } from '@renderer/components/ui';
import { formatFreqShort } from '@renderer/lib/dsp/format';
import { freqToPos } from '@renderer/lib/dsp/scale';
import { useAppStore } from '@renderer/store';
import { useDevicePixelRatio } from '@renderer/hooks/useCanvas';

export interface CurveSpec {
  /** dB values, one per entry of `freqs`. */
  values: readonly number[];
  /** CSS colour; default accent. */
  color?: string;
  /** Fill between curve and 0 dB. */
  fill?: boolean;
  dashed?: boolean;
  width?: number;
}

export interface CurveMarker {
  freq: number;
  db: number;
  active?: boolean;
}

export interface ResponseCurveProps {
  freqs: readonly number[];
  curves: readonly CurveSpec[];
  /** Symmetric dB range of the plot (e.g. 24 -> -24..+24). */
  dbRange?: number;
  /** Average spectrum of the output (64 log bands, dB) drawn behind the curve. */
  spectrum?: Float32Array | readonly number[] | null;
  markers?: readonly CurveMarker[];
  height?: number;
  'aria-label': string;
  /** Dim the curve (effect bypassed). */
  bypassed?: boolean;
  className?: string;
}

const GRID_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

export function dbToY(db: number, range: number, top: number, height: number): number {
  const clamped = Math.max(-range, Math.min(range, db));
  return top + ((range - clamped) / (2 * range)) * height;
}

/** Canvas plot of frequency responses on a log axis (20 Hz..20 kHz). */
export function ResponseCurve({
  freqs,
  curves,
  dbRange = 24,
  spectrum,
  markers,
  height = 120,
  bypassed,
  className,
  ...aria
}: ResponseCurveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  // colours come from CSS variables: redraw when the theme or the pixel ratio changes
  const theme = useAppStore((s) => s.settings.theme);
  const dpr = useDevicePixelRatio();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const accent = cssVar('--color-accent', '#7c6cff', canvas);
    const grid = cssVar('--color-border', '#2a3044', canvas);
    const text = cssVar('--color-fg-subtle', '#6c7590', canvas);
    const wave = cssVar('--color-wave', '#6fd3ff', canvas);
    const fg = cssVar('--color-fg', '#e9ebf8', canvas);
    const top = 4;
    const plotH = height - 18;
    const x = (f: number) => freqToPos(f) * width;
    const y = (db: number) => dbToY(db, dbRange, top, plotH);

    // grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    ctx.fillStyle = text;
    ctx.font = '9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of GRID_FREQS) {
      const gx = Math.round(x(f)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, top);
      ctx.lineTo(gx, top + plotH);
      ctx.stroke();
      if (f !== 20 && f !== 20000) ctx.fillText(formatFreqShort(f), gx, height - 4);
    }
    const dbStep = dbRange >= 24 ? 12 : 6;
    ctx.textAlign = 'left';
    for (let d = -dbRange; d <= dbRange; d += dbStep) {
      const gy = Math.round(y(d)) + 0.5;
      ctx.globalAlpha = d === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (d !== -dbRange && d !== dbRange) ctx.fillText(`${d > 0 ? '+' : ''}${d}`, 2, gy - 2);
    }

    // output spectrum (independent scale: -96..0 dB mapped to plot height)
    if (spectrum && spectrum.length > 1) {
      const n = spectrum.length;
      ctx.beginPath();
      ctx.moveTo(0, top + plotH);
      for (let i = 0; i < n; i++) {
        const px = ((i + 0.5) / n) * width;
        const v = Number(spectrum[i]);
        const norm = Math.max(0, Math.min(1, (Number.isFinite(v) ? v + 96 : 0) / 96));
        ctx.lineTo(px, top + plotH - norm * plotH);
      }
      ctx.lineTo(width, top + plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = wave;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // curves
    for (const c of curves) {
      if (c.values.length !== freqs.length || freqs.length === 0) continue;
      const color = c.color ?? accent;
      ctx.beginPath();
      freqs.forEach((f, i) => {
        const px = x(f);
        const py = y(c.values[i] ?? 0);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.globalAlpha = bypassed ? 0.35 : 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = c.width ?? 2;
      ctx.setLineDash(c.dashed ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (c.fill) {
        ctx.lineTo(x(freqs[freqs.length - 1] ?? 20000), y(0));
        ctx.lineTo(x(freqs[0] ?? 20), y(0));
        ctx.closePath();
        ctx.globalAlpha = bypassed ? 0.06 : 0.14;
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // markers
    for (const m of markers ?? []) {
      ctx.beginPath();
      ctx.arc(x(m.freq), y(m.db), m.active ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = m.active ? fg : accent;
      ctx.globalAlpha = bypassed ? 0.4 : 1;
      ctx.fill();
      if (m.active) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = accent;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }, [width, height, freqs, curves, dbRange, spectrum, markers, bypassed, theme, dpr]);

  return (
    <div ref={wrapRef} className={className} style={{ height }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={aria['aria-label']}
        style={{ width: '100%', height }}
        className="block rounded-md bg-[var(--color-lane,#121520)]"
      />
    </div>
  );
}

export default ResponseCurve;
