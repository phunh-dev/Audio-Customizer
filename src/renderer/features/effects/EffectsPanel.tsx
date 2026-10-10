import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from 'radix-ui';
import { AudioLines, Eraser, Gauge, HardDrive, Repeat, SlidersHorizontal, Volume2 } from 'lucide-react';
import type { EffectChain } from '@shared/types';
import { Select, Tooltip, cn, tw } from '@renderer/components/ui';
import { selectActiveTab, useAppStore } from '@renderer/store';
import { effectsBinder, masterBinder } from './binding';
import { DenoiseSection } from './sections/DenoiseSection';
import { EqSection } from './sections/EqSection';
import { FiltersSection } from './sections/FiltersSection';
import { LoopSection } from './sections/LoopSection';
import { OptimizeSection } from './sections/OptimizeSection';
import { PitchTempoSection } from './sections/PitchTempoSection';
import { VolumeSection } from './sections/VolumeSection';

export type EffectsTab = 'volume' | 'pitchTempo' | 'filters' | 'eq' | 'denoise' | 'loop' | 'optimize';

export const EFFECTS_TABS: readonly EffectsTab[] = ['volume', 'pitchTempo', 'filters', 'eq', 'denoise', 'loop', 'optimize'];
export const MASTER_ONLY_TABS: readonly EffectsTab[] = ['loop', 'optimize'];

const ICONS: Record<EffectsTab, ReactNode> = {
  volume: <Volume2 size={13} aria-hidden />,
  pitchTempo: <Gauge size={13} aria-hidden />,
  filters: <SlidersHorizontal size={13} aria-hidden />,
  eq: <AudioLines size={13} aria-hidden />,
  denoise: <Eraser size={13} aria-hidden />,
  loop: <Repeat size={13} aria-hidden />,
  optimize: <HardDrive size={13} aria-hidden />,
};

/** Whether a tab's effect currently changes the sound (dot on the tab). */
export function isTabActive(tab: EffectsTab, chain: EffectChain, master: { loop: boolean; trim: boolean; preview: boolean }): boolean {
  switch (tab) {
    case 'volume': {
      const v = chain.volume;
      return v.gainDb !== 0 || v.normalize !== 'off' || v.limiter;
    }
    case 'pitchTempo':
      return chain.pitchTempo.enabled;
    case 'filters':
      return chain.filters.enabled && chain.filters.items.some((b) => b.enabled);
    case 'eq':
      return chain.eq.enabled && chain.eq.bands.some((b) => b.gainDb !== 0);
    case 'denoise':
      return chain.denoise.enabled;
    case 'loop':
      return master.loop;
    case 'optimize':
      return master.trim || master.preview;
  }
}

const MASTER = 'master';

export interface EffectsPanelProps {
  className?: string;
  /** Initially opened tab. */
  defaultTab?: EffectsTab;
}

/** Right side panel: every effect parameter of the master bus or the selected track. */
export function EffectsPanel({ className, defaultTab = 'volume' }: EffectsPanelProps) {
  const { t } = useTranslation();
  const project = useAppStore((s) => selectActiveTab(s).project);
  const selectedTrackId = useAppStore((s) => selectActiveTab(s).selectedTrackId);
  const selection = useAppStore((s) => selectActiveTab(s).selection);
  const render = useAppStore((s) => selectActiveTab(s).render);
  const previewOn = useAppStore((s) => selectActiveTab(s).previewExport !== null);
  const selectTrack = useAppStore((s) => s.selectTrack);

  const [mode, setMode] = useState<'master' | 'track'>(selectedTrackId ? 'track' : 'master');
  const [tab, setTab] = useState<EffectsTab>(defaultTab);

  // follow the track list: selecting a track edits that track
  useEffect(() => {
    setMode(selectedTrackId ? 'track' : 'master');
  }, [selectedTrackId]);

  const track = mode === 'track' ? (project.tracks.find((tr) => tr.id === selectedTrackId) ?? null) : null;
  const target = track ? track.id : MASTER;
  const chain = track ? track.effects : project.master.effects;
  const isMaster = target === MASTER;
  const current: EffectsTab = !isMaster && MASTER_ONLY_TABS.includes(tab) ? 'volume' : tab;

  const fx = useMemo(() => effectsBinder(target, chain), [target, chain]);
  const mx = useMemo(() => masterBinder(project.master), [project.master]);
  const masterFlags = { loop: project.master.loop.enabled, trim: project.master.trimSilence.enabled, preview: previewOn };

  const targetOptions = [
    { value: MASTER, label: t('effects.target.master') },
    ...project.tracks.map((tr) => ({ value: tr.id, label: t('effects.target.track', { name: tr.name }) })),
  ];

  const sectionFor = (id: EffectsTab): ReactNode => {
    switch (id) {
      case 'volume':
        return <VolumeSection fx={fx} meter={isMaster && render ? { peakDb: render.peakDb, lufs: render.lufs } : null} />;
      case 'pitchTempo':
        return <PitchTempoSection fx={fx} />;
      case 'filters':
        return <FiltersSection fx={fx} />;
      case 'eq':
        return <EqSection fx={fx} spectrum={isMaster ? (render?.averageSpectrum ?? null) : null} />;
      case 'denoise':
        return <DenoiseSection fx={fx} selection={selection} track={track} />;
      case 'loop':
        return <LoopSection mx={mx} selection={selection} />;
      case 'optimize':
        return <OptimizeSection mx={mx} />;
    }
  };

  return (
    <aside
      data-testid="effects-panel"
      aria-label={t('effects.panel.title')}
      className={cn('flex flex-col', tw.surface, className)}
    >
      <div className={cn('flex items-center gap-2 border-b px-3 py-2', tw.border)}>
        <span className={cn('text-[11px] font-semibold uppercase tracking-wide', tw.fgMuted)}>{t('effects.target.label')}</span>
        <Select<string>
          aria-label={t('effects.target.label')}
          className="min-w-0 flex-1"
          value={target}
          onValueChange={(v) => {
            if (v === MASTER) setMode('master');
            else {
              if (v !== selectedTrackId) selectTrack(v);
              setMode('track');
            }
          }}
          options={targetOptions}
        />
      </div>

      <Tabs.Root value={current} onValueChange={(v) => setTab(v as EffectsTab)} className="flex flex-col">
        {/* sticky so the tabs stay reachable while the (scrolling) side panel scrolls */}
        <Tabs.List
          aria-label={t('effects.panel.tabs')}
          className={cn('sticky top-0 z-10 flex flex-wrap gap-1 border-b px-2 py-1.5', tw.border, tw.surface)}
        >
          {EFFECTS_TABS.map((id) => {
            const disabled = !isMaster && MASTER_ONLY_TABS.includes(id);
            const on = isTabActive(id, chain, masterFlags);
            const trigger = (
              <Tabs.Trigger
                key={id}
                value={id}
                disabled={disabled}
                className={cn(
                  'relative inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors disabled:opacity-35',
                  tw.focus,
                  'data-[state=active]:bg-[var(--color-surface-3,#252a3c)] data-[state=active]:text-[var(--color-fg,#e7eaf3)]',
                  'data-[state=inactive]:text-[var(--color-fg-muted,#9aa3b9)] data-[state=inactive]:hover:text-[var(--color-fg,#e7eaf3)]',
                )}
              >
                {ICONS[id]}
                {t(`effects.tabs.${id}`)}
                {on ? (
                  <span
                    data-testid={`tab-active-${id}`}
                    aria-label={t('effects.panel.activeEffect')}
                    className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-[var(--color-accent,#7c6cff)]"
                  />
                ) : null}
              </Tabs.Trigger>
            );
            return disabled ? (
              <Tooltip key={id} content={t('effects.panel.masterOnly')}>
                <span>{trigger}</span>
              </Tooltip>
            ) : (
              trigger
            );
          })}
        </Tabs.List>
        <div className="p-3">
          {!isMaster && track ? (
            <p className={cn('mb-2 text-[11px]', tw.fgSubtle)}>{t('effects.panel.editingTrack', { name: track.name })}</p>
          ) : null}
          <Tabs.Content value={current} className="outline-none">
            {sectionFor(current)}
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </aside>
  );
}

export default EffectsPanel;
