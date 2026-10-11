import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { FADE_CURVES, type Fade, type FadeCurve } from '@shared/types';
import { useAppStore, useSelectedTrack } from '../../store';
import { SliderField } from '../ui/Slider';
import { NumberField } from '../ui/NumberField';
import { Select } from '../ui/Select';
import { clipEndOf } from '../../utils/edit';
import { readJson, writeJson } from '../../utils/storage';
import { cn } from '../ui/cn';

export const INSPECTOR_OPEN_KEY = 'audio-customizer.clipInspectorOpen';

/** Clip / mix properties of the selected track (gain, pan, position, clip bounds, fades). */
export function TrackInspector() {
  const { t } = useTranslation();
  const track = useSelectedTrack();
  const source = useAppStore((s) => (track ? s.sources[track.sourceId] : undefined));
  const updateTrack = useAppStore((s) => s.updateTrack);
  const seal = useAppStore((s) => s.sealHistory);
  const [open, setOpen] = useState(() => readJson<boolean>(INSPECTOR_OPEN_KEY, true) !== false);
  if (!track) return null;
  const toggle = (): void => {
    setOpen(!open);
    writeJson(INSPECTOR_OPEN_KEY, !open);
  };
  const id = track.id;
  const srcDur = source?.duration ?? 0;
  const key = (field: string): string => `track:${id}:${field}`;

  const fadeRow = (which: 'fadeIn' | 'fadeOut', fade: Fade) => (
    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
      <SliderField
        label={t(`tracks.inspector.${which}`)}
        value={fade.duration * 1000}
        onChange={(v) => updateTrack(id, { [which]: { ...fade, duration: v / 1000 } }, key(which))}
        onCommit={() => seal()}
        min={0}
        max={Math.max(100, Math.min(30000, srcDur * 1000))}
        step={1}
        defaultValue={0}
        unit={t('app.units.ms')}
      />
      <Select<FadeCurve>
        value={fade.curve}
        onValueChange={(c) => updateTrack(id, { [which]: { ...fade, curve: c } })}
        options={FADE_CURVES.map((c) => ({ value: c, label: t(`app.curves.${c}`) }))}
        size="sm"
        aria-label={t('tracks.inspector.curve')}
        className="w-32"
      />
    </div>
  );

  return (
    <section
      aria-label={t('tracks.inspector.title')}
      className={cn('flex flex-col border-b border-border', open ? 'gap-3 p-3' : 'px-3 py-2')}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        title={open ? t('tracks.inspector.collapse') : t('tracks.inspector.expand')}
        className="focus-ring -mx-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted hover:text-fg"
      >
        <SlidersHorizontal className="size-3.5 shrink-0 text-accent" aria-hidden />
        <span>{t('tracks.inspector.title')}</span>
        <span className="min-w-0 flex-1 truncate text-right font-normal normal-case tracking-normal text-fg-subtle">{track.name}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden />
      </button>
      {open && (
        <>
      <SliderField
        label={t('tracks.inspector.gain')}
        value={track.gainDb}
        onChange={(v) => updateTrack(id, { gainDb: v }, key('gain'))}
        onCommit={() => seal()}
        min={-60}
        max={24}
        step={0.1}
        defaultValue={0}
        origin={0}
        unit={t('app.units.db')}
      />
      <SliderField
        label={t('tracks.inspector.pan')}
        value={Math.round(track.pan * 100)}
        onChange={(v) => updateTrack(id, { pan: v / 100 }, key('pan'))}
        onCommit={() => seal()}
        min={-100}
        max={100}
        step={1}
        defaultValue={0}
        origin={0}
      />
      <div className="grid grid-cols-3 gap-2 text-[11px] text-fg-muted">
        <label className="flex flex-col gap-1">
          <span>{t('tracks.inspector.offset')}</span>
          <NumberField
            aria-label={t('tracks.inspector.offset')}
            value={track.offset}
            onChange={(v) => updateTrack(id, { offset: v }, key('offset'))}
            min={0}
            max={36000}
            step={0.001}
            unit={t('app.units.s')}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('tracks.inspector.clipStart')}</span>
          <NumberField
            aria-label={t('tracks.inspector.clipStart')}
            value={track.clipStart}
            onChange={(v) => updateTrack(id, { clipStart: Math.min(v, clipEndOf(track, srcDur) - 0.001) }, key('clipStart'))}
            min={0}
            max={Math.max(0, srcDur)}
            step={0.001}
            unit={t('app.units.s')}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('tracks.inspector.clipEnd')}</span>
          <NumberField
            aria-label={t('tracks.inspector.clipEnd')}
            value={clipEndOf(track, srcDur)}
            onChange={(v) =>
              updateTrack(id, { clipEnd: v >= srcDur - 1e-6 ? null : Math.max(v, track.clipStart + 0.001) }, key('clipEnd'))
            }
            min={0}
            max={Math.max(0, srcDur)}
            step={0.001}
            unit={t('app.units.s')}
          />
        </label>
      </div>
      {fadeRow('fadeIn', track.fadeIn)}
      {fadeRow('fadeOut', track.fadeOut)}
        </>
      )}
    </section>
  );
}
