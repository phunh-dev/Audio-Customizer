import { useEffect, useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceInfo } from '@shared/api';
import type { Track } from '@shared/types';
import { useAppStore, type Tab } from '../../store';
import { timeToX, snapTime, type Viewport } from '../../utils/timeline';
import { clipEndOf, trackDuration, trackEnd, trackSpeed } from '../../utils/edit';
import { drawPeakColumns, peakColumns } from '../../utils/peaks';
import { prepareCanvas, themeColor, useDevicePixelRatio } from '../../hooks/useCanvas';
import { cn } from '../ui/cn';

export const LANE_HEIGHT = 64;
const SNAP_PX = 8;

/** Snap candidates for a dragged clip: 0, playhead and the edges of other clips. */
export function snapCandidates(tracks: readonly Track[], exceptId: string, sources: Record<string, SourceInfo>, playhead: number): number[] {
  const out = [0, playhead];
  for (const t of tracks) {
    if (t.id === exceptId) continue;
    out.push(t.offset, trackEnd(t, sources[t.sourceId]?.duration ?? 0));
  }
  return out;
}

/**
 * New offset for a clip being dragged by `dx` pixels. With snapping, either
 * the clip start or the clip end sticks to a candidate within SNAP_PX.
 */
export function dragOffset(
  startOffset: number,
  dx: number,
  pxPerSec: number,
  clipLength: number,
  candidates: readonly number[] | null,
): number {
  let off = Math.max(0, startOffset + dx / pxPerSec);
  if (candidates) {
    const thr = SNAP_PX / pxPerSec;
    const snappedStart = snapTime(off, candidates, thr);
    if (snappedStart !== off) off = snappedStart;
    else {
      const end = off + clipLength;
      const snappedEnd = snapTime(end, candidates, thr);
      if (snappedEnd !== end) off = snappedEnd - clipLength;
    }
  }
  return Math.max(0, off);
}

interface LaneProps {
  track: Track;
  source: SourceInfo | undefined;
  peaks: Float32Array | undefined;
  vp: Viewport;
  width: number;
  selected: boolean;
  tab: Tab;
}

function Lane({ track, source, peaks, vp, width, selected, tab }: LaneProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useAppStore((s) => s.settings.theme);
  const dpr = useDevicePixelRatio();
  const drag = useRef<{ x: number; offset: number; key: string; moved: boolean } | null>(null);
  const srcDur = source?.duration ?? 0;
  const len = trackDuration(track, srcDur);
  const x0 = timeToX(track.offset, vp);
  const w = len * vp.pxPerSec;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = prepareCanvas(canvas, width, LANE_HEIGHT);
    if (!ctx) return;
    const left = Math.max(0, x0);
    const right = Math.min(width, x0 + w);
    if (right <= left) return;
    ctx.fillStyle = themeColor(selected ? '--color-clip-selected' : '--color-clip', selected ? '#2e3d62' : '#233049');
    ctx.fillRect(left, 2, right - left, LANE_HEIGHT - 4);
    if (peaks && srcDur > 0) {
      const speed = trackSpeed(track);
      const tStart = vp.scroll + left / vp.pxPerSec;
      const srcStart = track.clipStart + (tStart - track.offset) * speed;
      const cols = peakColumns(peaks, srcDur, srcStart, speed / vp.pxPerSec, right - left);
      // hide columns that fall past the clip end
      const clipEnd = clipEndOf(track, srcDur);
      const maxCols = Math.max(0, Math.floor(((clipEnd - srcStart) / speed) * vp.pxPerSec));
      const trimmed = cols.subarray(0, Math.min(cols.length, maxCols * 2));
      ctx.globalAlpha = track.mute ? 0.35 : 1;
      drawPeakColumns(ctx, trimmed, left, 14, LANE_HEIGHT - 18, {
        color: themeColor('--color-wave', '#6fd3ff'),
        gain: Math.pow(10, track.gainDb / 20),
      });
      ctx.globalAlpha = 1;
    }
    // fade ramps
    ctx.strokeStyle = themeColor('--color-fg-muted', 'rgba(255,255,255,0.55)');
    ctx.lineWidth = 1;
    const fi = track.fadeIn.duration * vp.pxPerSec;
    const fo = track.fadeOut.duration * vp.pxPerSec;
    if (fi > 1) {
      ctx.beginPath();
      ctx.moveTo(x0, LANE_HEIGHT - 2);
      ctx.lineTo(x0 + fi, 2);
      ctx.stroke();
    }
    if (fo > 1) {
      ctx.beginPath();
      ctx.moveTo(x0 + w - fo, 2);
      ctx.lineTo(x0 + w, LANE_HEIGHT - 2);
      ctx.stroke();
    }
  }, [track, peaks, srcDur, vp, width, x0, w, selected, theme, dpr]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = useAppStore.getState();
    s.selectTrack(track.id);
    drag.current = { x: e.clientX, offset: track.offset, key: `drag:${track.id}:${e.timeStamp}:${Math.random()}`, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 2) return;
    d.moved = true;
    const s = useAppStore.getState();
    const candidates = s.settings.snap && !e.altKey ? snapCandidates(tab.project.tracks, track.id, s.sources, tab.playhead) : null;
    s.setTrackOffset(track.id, dragOffset(d.offset, dx, vp.pxPerSec, len, candidates), d.key);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    useAppStore.getState().sealHistory();
  };

  // clamp the interactive box to the visible area (very long clips at high zoom)
  const boxLeft = Math.max(-4, x0);
  const boxRight = Math.min(width + 4, x0 + w);

  return (
    <div className="relative border-b border-border bg-lane" style={{ height: LANE_HEIGHT }} data-testid="lane">
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {boxRight > boxLeft && (
        <div
          role="button"
          tabIndex={-1}
          aria-label={t('timeline.clip', { name: track.name })}
          data-testid={`clip-${track.id}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          title={t('timeline.dragHint')}
          className={cn(
            'absolute top-0.5 bottom-0.5 cursor-grab rounded-md border active:cursor-grabbing',
            selected
              ? 'border-accent shadow-[0_0_0_1px_var(--color-accent),0_0_14px_var(--color-accent-soft)]'
              : 'border-border-strong/60 hover:border-fg-subtle',
          )}
          style={{ left: boxLeft, width: boxRight - boxLeft }}
        >
          <span className="pointer-events-none absolute left-1 top-0.5 max-w-[calc(100%-8px)] truncate rounded-sm bg-surface/70 px-1 text-[10.5px] font-medium leading-4 text-fg">
            {track.name}
          </span>
        </div>
      )}
    </div>
  );
}

interface Props {
  tab: Tab;
  vp: Viewport;
  width: number;
}

export function TrackLanes({ tab, vp, width }: Props) {
  const sources = useAppStore((s) => s.sources);
  const peaks = useAppStore((s) => s.sourcePeaks);
  return (
    <div data-testid="track-lanes">
      {tab.project.tracks.map((tr) => (
        <Lane
          key={tr.id}
          track={tr}
          source={sources[tr.sourceId]}
          peaks={peaks[tr.sourceId]}
          vp={vp}
          width={width}
          selected={tr.id === tab.selectedTrackId}
          tab={tab}
        />
      ))}
    </div>
  );
}
