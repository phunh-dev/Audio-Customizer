import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { tickStep, ticks, timeToX, xToTime, type Viewport } from '../../utils/timeline';
import { formatRulerLabel, formatTime } from '../../utils/time';

interface Props {
  vp: Viewport;
  width: number;
  duration: number;
  playhead: number;
}

export const RULER_HEIGHT = 26;

/**
 * Time ruler. Click or drag to seek: when playing, playback continues from the
 * new position (api.seek). Arrow keys step by the transport step unit.
 */
export function Ruler({ vp, width, duration, playhead }: Props) {
  const { t } = useTranslation();
  const seek = useAppStore((s) => s.seek);
  const step = useAppStore((s) => s.step);
  const dragging = useRef(false);
  const pending = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  const timeAt = (e: PointerEvent<HTMLDivElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(duration, xToTime(e.clientX - rect.left, vp)));
  };

  const seekThrottled = (time: number): void => {
    pending.current = time;
    if (frame.current !== null) return;
    const flush = (): void => {
      frame.current = null;
      if (pending.current !== null) void seek(pending.current);
      pending.current = null;
    };
    if (typeof requestAnimationFrame === 'function') frame.current = requestAnimationFrame(flush);
    else flush();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    void seek(timeAt(e));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragging.current) seekThrottled(timeAt(e));
  };
  const cancelPending = (): void => {
    if (frame.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
  };
  useEffect(() => cancelPending, []);

  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    cancelPending();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    void seek(timeAt(e));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      void step(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      void seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      void seek(duration);
    }
  };

  const major = ticks(vp, width);
  const stepSec = tickStep(vp.pxPerSec);
  const withMs = stepSec < 1;
  const minor = stepSec / 4;
  const minorTicks: number[] = [];
  if (minor * vp.pxPerSec >= 6) {
    const first = Math.ceil(vp.scroll / minor) * minor;
    const end = vp.scroll + width / vp.pxPerSec;
    for (let x = first; x <= end && minorTicks.length < 2000; x += minor) minorTicks.push(x);
  }
  const phX = timeToX(playhead, vp);

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t('timeline.seek')}
      aria-valuemin={0}
      aria-valuemax={Number(duration.toFixed(3))}
      aria-valuenow={Number(playhead.toFixed(3))}
      aria-valuetext={formatTime(playhead)}
      data-testid="ruler"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="relative shrink-0 cursor-pointer overflow-hidden border-b border-border bg-surface outline-none focus-visible:ring-1 focus-visible:ring-accent"
      style={{ height: RULER_HEIGHT }}
    >
      {minorTicks.map((tm) => (
        <span key={`m${tm}`} className="absolute bottom-0 h-1.5 w-px bg-border" style={{ left: timeToX(tm, vp) }} />
      ))}
      {major.map((tm) => (
        <span key={tm} className="absolute bottom-0 flex h-full flex-col justify-end" style={{ left: timeToX(tm, vp) }}>
          {/* labels sit right of their tick: hide the ones that would be cut at the right edge */}
          {timeToX(tm, vp) < width - (withMs ? 52 : 30) && (
            <span className="absolute top-1 left-1 whitespace-nowrap font-mono text-[10px] text-fg-muted">
              {formatRulerLabel(tm, withMs)}
            </span>
          )}
          <span className="h-2.5 w-px bg-border-strong" />
        </span>
      ))}
      {duration > 0 && (
        <span
          className="absolute inset-y-0 bg-black/10"
          style={{ left: Math.max(0, timeToX(duration, vp)), right: 0 }}
          aria-hidden
        />
      )}
      {phX >= -8 && phX <= width + 8 && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent border-t-[var(--color-playhead)]"
          style={{ left: phX }}
        />
      )}
    </div>
  );
}
