import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Sparkles, HardDrive } from 'lucide-react';
import { createDefaultExportOptions, createDefaultTrimSilence } from '@shared/types';
import { Hint, Section, SliderField, Switch, cn, tw } from '@renderer/components/ui';
import { formatBytes, percentChange } from '@renderer/lib/dsp/format';
import { selectActiveTab, useAppStore } from '@renderer/store';
import { ExportOptionsFields } from '@renderer/features/export/ExportOptionsFields';
import { useEstimatedSize } from '@renderer/features/export/useEstimatedSize';
import { useExportSettings } from '@renderer/features/export/useExportSettings';
import { PARAMS, rangeProps } from '../params';
import { applyOptimizePreset, getOptimizePreset, matchOptimizePreset, OPTIMIZE_PRESETS, type OptimizePresetId } from '../optimizePresets';
import type { MasterSectionProps } from './LoopSection';

export function OptimizeSection({ mx }: MasterSectionProps) {
  const { t } = useTranslation();
  const ts = mx.source.trimSilence;
  const P = PARAMS.trimSilence;
  const { options, setOptions, previewOn, setPreviewOn, format, sessionId, sourceBytes } = useExportSettings();
  const project = useAppStore((s) => selectActiveTab(s).project);
  const active = matchOptimizePreset(options);
  const baseline = useMemo(() => createDefaultExportOptions(), []);
  const before = useEstimatedSize(sessionId, project, baseline);
  const after = useEstimatedSize(sessionId, project, options);
  const pct = before.bytes !== null && after.bytes !== null ? percentChange(before.bytes, after.bytes) : null;

  const applyPreset = (id: OptimizePresetId) => {
    setOptions(applyOptimizePreset(options, id));
    const trim = getOptimizePreset(id).trimSilence;
    if (trim !== ts.enabled) mx.set('trimSilence.enabled', trim);
  };

  const sizeText = (s: { bytes: number | null; loading: boolean }) =>
    s.bytes !== null ? formatBytes(s.bytes) : s.loading ? t('effects.optimize.estimating') : '-';

  return (
    <div className="flex flex-col gap-3">
      <Section
        title={t('effects.optimize.presetsTitle')}
        description={t('effects.optimize.presetsDescription')}
        icon={<Sparkles size={14} aria-hidden />}
      >
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('effects.optimize.presetsTitle')}>
          {OPTIMIZE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={active === p.id}
              onClick={() => applyPreset(p.id)}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors',
                tw.focus,
                active === p.id
                  ? 'border-[var(--color-accent,#7c6cff)] bg-[var(--color-accent-soft,rgba(124,108,255,0.16))]'
                  : cn(tw.border, tw.surface2, 'hover:border-[var(--color-border-strong,#3a4260)]'),
              )}
            >
              <span className={cn('text-xs font-semibold', tw.fg)}>{t(`effects.optimize.presets.${p.id}.name`)}</span>
              <span className={cn('text-[10px] leading-tight', tw.fgSubtle)}>{t(`effects.optimize.presets.${p.id}.detail`)}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title={t('effects.optimize.outputTitle')}
        description={t('effects.optimize.outputDescription')}
        icon={<HardDrive size={14} aria-hidden />}
      >
        <ExportOptionsFields options={options} onChange={setOptions} format={format} />
        <Switch
          label={t('effects.optimize.preview')}
          hint={t('effects.optimize.previewHint')}
          checked={previewOn}
          onCheckedChange={setPreviewOn}
        />
        <dl className={cn('grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md px-3 py-2 text-[11px]', tw.surface2)}>
          <dt className={tw.fgMuted}>{t('effects.optimize.sourceSize')}</dt>
          <dd data-testid="size-source" className={cn(tw.mono, tw.fg)}>
            {sourceBytes > 0 ? formatBytes(sourceBytes) : '-'}
          </dd>
          <dt className={tw.fgMuted}>{t('effects.optimize.beforeSize')}</dt>
          <dd data-testid="size-before" className={cn(tw.mono, tw.fg)}>
            {sizeText(before)}
          </dd>
          <dt className={tw.fgMuted}>{t('effects.optimize.afterSize')}</dt>
          <dd data-testid="size-after" className={cn(tw.mono, 'font-semibold', tw.accentText)}>
            {sizeText(after)}
            {pct !== null ? <span className={cn('ml-1 font-normal', pct <= 0 ? tw.successText : tw.warningText)}>({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)</span> : null}
          </dd>
        </dl>
        {project.tracks.length === 0 ? <Hint>{t('effects.optimize.noAudio')}</Hint> : null}
      </Section>

      <Section
        title={t('effects.trimSilence.title')}
        description={t('effects.trimSilence.description')}
        icon={<Scissors size={14} aria-hidden />}
        enabled={ts.enabled}
        onEnabledChange={(on) => mx.set('trimSilence.enabled', on)}
        onReset={() => mx.apply((m) => void (m.trimSilence = { ...createDefaultTrimSilence(), enabled: m.trimSilence.enabled }))}
      >
        <SliderField label={t('effects.trimSilence.threshold')} hint={t('effects.trimSilence.thresholdHint')} unit="dBFS" {...rangeProps(P.thresholdDb)} {...mx.num('trimSilence.thresholdDb')} />
        <SliderField label={t('effects.trimSilence.pad')} hint={t('effects.trimSilence.padHint')} unit="ms" {...rangeProps(P.padMs)} {...mx.num('trimSilence.padMs')} />
      </Section>
    </div>
  );
}

export default OptimizeSection;
