import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { RenderResult, SpectrogramData } from '@shared/api';
import { useAppStore } from '../../store';
import { applyColormap, type ColormapName } from '../../utils/colormap';
import { freqToY, timeToX, type Viewport } from '../../utils/timeline';
import { drawPeakColumns, peakColumns } from '../../utils/peaks';
import { formatHzShort, formatDb } from '../../utils/format';
import { prepareCanvas, themeColor, useDevicePixelRatio } from '../../hooks/useCanvas';
import { cn } from '../ui/cn';

export const AXIS_FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

/** Colour-mapped spectrogram as an offscreen canvas (built once per render result). */
export function buildSpectrogramImage(spec: SpectrogramData, colormap: ColormapName): HTMLCanvasElement | null {
  if (spec.width <= 0 || spec.height <= 0) return null;
  const c = document.createElement('canvas');
  c.width = spec.width;
  c.height = spec.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(spec.width, spec.height);
  applyColormap(spec.data, colormap, img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Source/destination rectangles to draw the visible part of an image spanning [0, duration]. */
export function visibleSlice(
  imageWidth: number,
  duration: number,
  vp: Viewport,
  width: number,
): { sx: number; sw: number; dx: number; dw: number } | null {
  if (duration <= 0 || imageWidth <= 0 || width <= 0) return null;
  const viewStart = vp.scroll;
  const viewEnd = vp.scroll + width / vp.pxPerSec;
  const t0 = Math.max(0, viewStart);
  const t1 = Math.min(duration, viewEnd);
  if (t1 <= t0) return null;
  const pxPerSecImg = imageWidth / duration;
  return {
    sx: t0 * pxPerSecImg,
    sw: (t1 - t0) * pxPerSecImg,
    dx: timeToX(t0, vp),
    dw: (t1 - t0) * vp.pxPerSec,
  };
}

interface Props {
  render: RenderResult | null;
  vp: Viewport;
  width: number;
  spectrumHeight: number;
  waveHeight: number;
}

export function MasterView({ render, vp, width, spectrumHeight, waveHeight }: Props) {
  const { t } = useTranslation();
  const colormap = useAppStore((s) => s.settings.colormap);
  const theme = useAppStore((s) => s.settings.theme);
  const status = useAppStore((s) => s.tabs.find((x) => x.id === s.activeTabId)?.renderStatus ?? 'idle');
  const specRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  const image = useMemo(
    () => (render ? buildSpectrogramImage(render.spectrogram, colormap) : null),
    [render, colormap],
  );

  useEffect(() => {
    const canvas = specRef.current;
    if (!canvas || width <= 0) return;
    const ctx = prepareCanvas(canvas, width, spectrumHeight);
    if (!ctx) return;
    // outside the rendered audio: the lane colour (not the colormap's black)
    ctx.fillStyle = themeColor('--color-lane', '#0e1122');
    ctx.fillRect(0, 0, width, spectrumHeight);
    if (!render || !image) return;
    const slice = visibleSlice(render.spectrogram.width, render.duration, vp, width);
    if (!slice) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, slice.sx, 0, Math.max(1e-3, slice.sw), render.spectrogram.height, slice.dx, 0, slice.dw, spectrumHeight);
    // end-of-audio marker
    const endX = timeToX(render.duration, vp);
    if (endX > 0 && endX < width) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(Math.round(endX), 0, 1, spectrumHeight);
    }
  }, [render, image, vp, width, spectrumHeight, theme, dpr]);

  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas || width <= 0) return;
    const ctx = prepareCanvas(canvas, width, waveHeight);
    if (!ctx) return;
    ctx.fillStyle = themeColor('--color-lane', '#121520');
    ctx.fillRect(0, 0, width, waveHeight);
    ctx.fillStyle = themeColor('--color-border', '#2a3044');
    ctx.fillRect(0, waveHeight / 2, width, 1);
    if (!render) return;
    const cols = peakColumns(render.peaks, render.duration, vp.scroll, 1 / vp.pxPerSec, width);
    // cyan -> violet -> pink, like the app icon
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, themeColor('--color-cyan', '#22d3ee'));
    grad.addColorStop(0.55, themeColor('--color-wave-master', '#a78bfa'));
    grad.addColorStop(1, themeColor('--color-pink', '#f472b6'));
    drawPeakColumns(ctx, cols, 0, 4, waveHeight - 8, { color: grad });
  }, [render, vp, width, waveHeight, theme, dpr]);

  const axis = render
    ? AXIS_FREQS.filter((f) => f >= render.spectrogram.minFreq && f <= render.spectrogram.maxFreq).map((f) => ({
        f,
        y: freqToY(f, render.spectrogram.minFreq, render.spectrogram.maxFreq, spectrumHeight),
      }))
    : [];

  return (
    <div className="relative" data-testid="master-view">
      <div className="relative" style={{ height: spectrumHeight }}>
        <canvas ref={specRef} aria-label={t('timeline.spectrogram')} role="img" className="absolute inset-0" />
        {render && (
          <div
            data-testid="freq-axis"
            className="pointer-events-none absolute inset-y-0 left-0 w-9 bg-linear-to-r from-black/55 to-transparent"
          >
            {axis.map(({ f, y }) => (
              <div key={f} className="absolute left-0 flex -translate-y-1/2 items-center gap-1" style={{ top: y }}>
                <span className="h-px w-1.5 bg-white/60" />
                <span className="font-mono text-[9.5px] leading-none text-white/80 [text-shadow:0_1px_2px_#000]">{formatHzShort(f)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pointer-events-none absolute right-2 top-1.5 flex items-center gap-2 rounded-md bg-black/45 px-2 py-1 font-mono text-[10.5px] text-white/85 backdrop-blur-sm">
          {status === 'rendering' && <Loader2 aria-label={t('timeline.rendering')} className="size-3 animate-ac-spin" />}
          <span className="font-sans text-white/50">{t('timeline.finalResult')}</span>
          {render && (
            <>
              <span
                title={render.peakDb > 0 ? t('timeline.clippingHint') : t('timeline.peak')}
                data-clipping={render.peakDb > 0 ? 'true' : undefined}
                className={cn(render.peakDb > 0 && 'rounded bg-[var(--color-danger)] px-1 font-semibold text-white')}
              >
                {t('timeline.peakValue', { value: formatDb(render.peakDb) })}
              </span>
              <span title={t('timeline.loudness')}>
                {t('timeline.lufsValue', { value: render.lufs === null ? '-' : render.lufs.toFixed(1) })}
              </span>
            </>
          )}
        </div>
        {!render && status !== 'rendering' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/40">
            {t('timeline.noRender')}
          </div>
        )}
      </div>
      <div className="relative border-t border-border" style={{ height: waveHeight }}>
        <canvas ref={waveRef} aria-label={t('timeline.masterWaveform')} role="img" className="absolute inset-0" />
        <span className="pointer-events-none absolute left-1.5 top-1 rounded bg-surface/80 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider text-fg-muted backdrop-blur-sm">
          {t('timeline.master')}
        </span>
      </div>
    </div>
  );
}
