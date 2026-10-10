import { useEffect, useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useActiveTab, useAppStore } from '../../store';
import { useElementSize } from '../../hooks/useCanvas';
import { projectDuration } from '../../utils/edit';
import { durationsOf } from '../../store/appStore';
import { clampScroll, fitZoom, timeToX, xToTime, zoomAt, type Viewport } from '../../utils/timeline';
import { Ruler } from './Ruler';
import { MasterView } from './MasterView';
import { TrackLanes } from './TrackLanes';
import { HScrollbar } from './HScrollbar';
import { IconButton } from '../ui/Button';

const WAVE_HEIGHT = 56;

/** Spectrogram height: about a third of the editor, so big windows get a bigger view. */
export function spectrumHeightFor(areaHeight: number): number {
  if (areaHeight <= 0) return 196;
  return Math.round(Math.min(360, Math.max(150, areaHeight * 0.34)));
}
const ZOOM_STEP = 1.25;

/** Content length shown by the timeline (some room after the end). */
export function timelineTotal(duration: number, viewSeconds: number): number {
  return Math.max(duration * 1.05 + 0.5, viewSeconds);
}

export function EditorView() {
  const { t } = useTranslation();
  const tab = useActiveTab();
  const sources = useAppStore((s) => s.sources);
  const transport = useAppStore((s) => s.transport);
  const setViewport = useAppStore((s) => s.setViewport);
  const [areaRef, size] = useElementSize<HTMLDivElement>();
  const width = size.width;
  const spectrumHeight = spectrumHeightFor(size.height);
  const vp: Viewport = { pxPerSec: tab.pxPerSec, scroll: tab.scroll };
  const projDur = projectDuration(tab.project.tracks, durationsOf(sources));
  const duration = Math.max(projDur, tab.render?.duration ?? 0);
  const viewSeconds = width > 0 ? width / vp.pxPerSec : 0;
  const total = timelineTotal(duration, viewSeconds);
  const selectDrag = useRef<{ t0: number; moved: boolean; x: number; deselect: boolean } | null>(null);

  // fit the whole project when content first appears (flag set by the first import)
  useEffect(() => {
    if (tab.needsFit && width > 0 && duration > 0) {
      setViewport({ pxPerSec: fitZoom(duration * 1.05, width), scroll: 0 });
    }
  }, [tab.needsFit, duration, width, setViewport]);

  // keep the playhead visible while playing
  const playing = transport.state === 'playing' && transport.sessionId === tab.id;
  useEffect(() => {
    if (!playing || width <= 0) return;
    const x = timeToX(tab.playhead, vp);
    if (x > width - 16 || x < 0) {
      setViewport({ scroll: clampScroll(tab.playhead - viewSeconds * 0.05, total, viewSeconds) });
    }
  }, [tab.playhead, playing]);

  // Ctrl/Cmd + wheel zooms around the pointer, wheel/shift+wheel scrolls horizontally
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      const s = useAppStore.getState();
      const cur = s.tabs.find((x) => x.id === s.activeTabId);
      if (!cur) return;
      const curVp = { pxPerSec: cur.pxPerSec, scroll: cur.scroll };
      const rect = el.getBoundingClientRect();
      const viewSec = rect.width / curVp.pxPerSec;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const next = zoomAt(curVp, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX - rect.left);
        s.setViewport(next);
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const delta = (e.shiftKey ? e.deltaY : e.deltaX) / curVp.pxPerSec;
        const totalNow = timelineTotal(projectDuration(cur.project.tracks, durationsOf(s.sources)), viewSec);
        s.setViewport({ scroll: clampScroll(curVp.scroll + delta, totalNow, viewSec) });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [areaRef]);

  const zoomBy = (factor: number): void => setViewport(zoomAt(vp, factor, width / 2));
  const fit = (): void => setViewport({ pxPerSec: fitZoom(Math.max(duration, 1) * 1.05, width), scroll: 0 });

  // region selection (drag) / seek (click) on the master view and empty lane area
  const timeAt = (e: PointerEvent<HTMLElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, xToTime(e.clientX - rect.left, vp));
  };
  const onSelectDown = (deselect: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    selectDrag.current = { t0: timeAt(e), moved: false, x: e.clientX, deselect };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onSelectMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = selectDrag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < 3) return;
    d.moved = true;
    useAppStore.getState().setSelection({ start: d.t0, end: Math.min(duration, timeAt(e)) });
  };
  const onSelectUp = (e: PointerEvent<HTMLDivElement>): void => {
    const d = selectDrag.current;
    if (!d) return;
    selectDrag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const s = useAppStore.getState();
    if (!d.moved) {
      s.setSelection(null);
      if (d.deselect) s.selectTrack(null);
      void s.seek(Math.min(duration, d.t0));
    }
  };

  const phX = timeToX(tab.playhead, vp);
  const sel = tab.selection;

  return (
    <section aria-label={t('timeline.title')} className="flex h-full min-h-0 flex-col" id="timeline">
      <div ref={areaRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <Ruler vp={vp} width={width} duration={duration} playhead={tab.playhead} />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div onPointerDown={onSelectDown(false)} onPointerMove={onSelectMove} onPointerUp={onSelectUp} className="shrink-0 cursor-text">
            <MasterView render={tab.render} vp={vp} width={width} spectrumHeight={spectrumHeight} waveHeight={WAVE_HEIGHT} />
          </div>
          <div
            data-testid="lanes-scroll"
            className="scroll-thin relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-border bg-bg"
            onPointerDown={onSelectDown(true)}
            onPointerMove={onSelectMove}
            onPointerUp={onSelectUp}
          >
            <TrackLanes tab={tab} vp={vp} width={width} />
            <p data-testid="lanes-hint" className="pointer-events-none px-3 py-2.5 text-[11px] text-fg-subtle">
              {t('timeline.lanesHint')}
            </p>
          </div>
          {sel && (
            <div
              data-testid="selection-overlay"
              className="pointer-events-none absolute inset-y-0 border-x border-accent bg-[var(--color-selection)]"
              style={{ left: timeToX(sel.start, vp), width: Math.max(1, (sel.end - sel.start) * vp.pxPerSec) }}
            />
          )}
          {phX >= 0 && phX <= width && (
            <div
              data-testid="playhead"
              className="pointer-events-none absolute inset-y-0 w-px bg-[var(--color-playhead)] shadow-[0_0_6px_var(--color-playhead)]"
              style={{ left: phX }}
            />
          )}
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-t border-border bg-surface px-2">
        <IconButton size="xs" label={t('timeline.zoomOut')} icon={<ZoomOut className="size-3.5" />} onClick={() => zoomBy(1 / ZOOM_STEP)} />
        <IconButton size="xs" label={t('timeline.zoomIn')} icon={<ZoomIn className="size-3.5" />} onClick={() => zoomBy(ZOOM_STEP)} />
        <IconButton size="xs" label={t('timeline.fit')} icon={<Maximize2 className="size-3.5" />} onClick={fit} />
        <HScrollbar
          total={total}
          view={viewSeconds}
          scroll={vp.scroll}
          onScroll={(scroll) => setViewport({ scroll })}
        />
        <span className="w-24 text-right font-mono text-[10px] text-fg-subtle">
          {t('timeline.zoomValue', { value: Math.round(vp.pxPerSec) })}
        </span>
      </div>
    </section>
  );
}
