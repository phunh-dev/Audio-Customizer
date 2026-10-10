import { useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  /** total content length (seconds) */
  total: number;
  /** visible length (seconds) */
  view: number;
  /** left edge (seconds) */
  scroll: number;
  onScroll: (scroll: number) => void;
}

/** Thumb geometry in percent of the track. */
export function thumbGeometry(total: number, view: number, scroll: number): { left: number; width: number } {
  if (total <= 0 || view >= total) return { left: 0, width: 100 };
  const width = Math.max(4, (view / total) * 100);
  const maxLeft = 100 - width;
  const left = Math.min(maxLeft, Math.max(0, (scroll / (total - view)) * maxLeft));
  return { left, width };
}

/** Horizontal scrollbar for the timeline (content can be far wider than any DOM element). */
export function HScrollbar({ total, view, scroll, onScroll }: Props) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number } | null>(null);
  const { left, width } = thumbGeometry(total, view, scroll);
  const maxScroll = Math.max(0, total - view);

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    drag.current = { x: e.clientX, scroll };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current || !trackRef.current) return;
    const trackW = trackRef.current.getBoundingClientRect().width || 1;
    const thumbW = (width / 100) * trackW;
    const secPerPx = maxScroll / Math.max(1, trackW - thumbW);
    onScroll(Math.min(maxScroll, Math.max(0, drag.current.scroll + (e.clientX - drag.current.x) * secPerPx)));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onTrackDown = (e: PointerEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    onScroll(Math.min(maxScroll, Math.max(0, frac * total - view / 2)));
  };

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-orientation="horizontal"
      aria-label={t('timeline.scroll')}
      aria-controls="timeline"
      aria-valuemin={0}
      aria-valuemax={Number(maxScroll.toFixed(3))}
      aria-valuenow={Number(scroll.toFixed(3))}
      onPointerDown={onTrackDown}
      className="relative h-2.5 flex-1 rounded-full bg-surface-3"
    >
      <div
        data-testid="hscroll-thumb"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="absolute inset-y-0 rounded-full bg-border-strong hover:bg-fg-subtle"
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    </div>
  );
}
