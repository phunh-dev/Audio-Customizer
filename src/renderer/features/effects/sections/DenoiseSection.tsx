import { useTranslation } from 'react-i18next';
import { Eraser, Crosshair, X } from 'lucide-react';
import { createDefaultDenoise, type DenoiseMode, type Track } from '@shared/types';
import { Button, FieldRow, Hint, Knob, Section, SegmentedControl, SliderField, cn, tw } from '@renderer/components/ui';
import { formatTime } from '@renderer/lib/dsp/format';
import { PARAMS, rangeProps } from '../params';
import { selectionToProfile, type TimeRange } from '../regions';
import type { ChainSectionProps } from './VolumeSection';

export interface DenoiseSectionProps extends ChainSectionProps {
  selection: TimeRange | null;
  /** Track being edited (null = master). */
  track: Pick<Track, 'offset' | 'clipStart' | 'clipEnd'> | null;
}

export function DenoiseSection({ fx, selection, track }: DenoiseSectionProps) {
  const { t } = useTranslation();
  const d = fx.source.denoise;
  const P = PARAMS.denoise;
  const profile = selectionToProfile(selection, track);
  const hasProfile = d.profileStart !== null && d.profileEnd !== null;

  return (
    <Section
      title={t('effects.denoise.title')}
      description={t('effects.denoise.description')}
      icon={<Eraser size={14} aria-hidden />}
      enabled={d.enabled}
      onEnabledChange={(on) => fx.set('denoise.enabled', on)}
      onReset={() => fx.apply((c) => void (c.denoise = { ...createDefaultDenoise(), enabled: c.denoise.enabled }))}
    >
      <FieldRow label={t('effects.denoise.mode')}>
        <SegmentedControl<DenoiseMode>
          aria-label={t('effects.denoise.mode')}
          value={d.mode}
          onValueChange={(m) => fx.set('denoise.mode', m)}
          options={(['spectral', 'rnnoise'] as const).map((m) => ({ value: m, label: t(`effects.denoise.modes.${m}`) }))}
        />
      </FieldRow>
      <Hint>{t(`effects.denoise.modeHint.${d.mode}`)}</Hint>

      <SliderField label={t('effects.denoise.reduction')} hint={t('effects.denoise.reductionHint')} unit="dB" {...rangeProps(P.reductionDb)} {...fx.num('denoise.reductionDb')} />
      <SliderField label={t('effects.denoise.sensitivity')} hint={t('effects.denoise.sensitivityHint')} unit="dB" {...rangeProps(P.sensitivityDb)} {...fx.num('denoise.sensitivityDb')} />
      <SliderField
        label={t('effects.denoise.smoothing')}
        hint={t('effects.denoise.smoothingHint')}
        {...rangeProps(P.smoothing)}
        format={(v) => v.toFixed(2)}
        {...fx.num('denoise.smoothing')}
      />
      <div className="flex justify-around">
        <Knob label={t('effects.denoise.attack')} aria-label={t('effects.denoise.attack')} unit="ms" {...rangeProps(P.attackMs)} {...fx.num('denoise.attackMs')} />
        <Knob label={t('effects.denoise.release')} aria-label={t('effects.denoise.release')} unit="ms" {...rangeProps(P.releaseMs)} scale="log" {...fx.num('denoise.releaseMs')} />
      </div>

      <div className={cn('flex flex-col gap-2 rounded-md border p-2', tw.surface2, tw.border)}>
        <FieldRow label={t('effects.denoise.profile')} hint={t('effects.denoise.profileHint')}>
          <span data-testid="denoise-profile" className={cn('text-[11px]', tw.mono, hasProfile ? tw.fg : tw.fgSubtle)}>
            {hasProfile
              ? t('effects.denoise.profileRange', { start: formatTime(d.profileStart ?? 0), end: formatTime(d.profileEnd ?? 0) })
              : t('effects.denoise.profileAuto')}
          </span>
        </FieldRow>
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="outline"
            icon={<Crosshair size={12} aria-hidden />}
            disabled={!profile}
            title={profile ? undefined : t('effects.denoise.needSelection')}
            onClick={() =>
              profile &&
              fx.apply((c) => {
                c.denoise.profileStart = profile.start;
                c.denoise.profileEnd = profile.end;
              })
            }
          >
            {t('effects.denoise.learn')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={<X size={12} aria-hidden />}
            disabled={!hasProfile}
            onClick={() =>
              fx.apply((c) => {
                c.denoise.profileStart = null;
                c.denoise.profileEnd = null;
              })
            }
          >
            {t('effects.denoise.clearProfile')}
          </Button>
        </div>
        {!profile ? <Hint>{t('effects.denoise.needSelection')}</Hint> : null}
      </div>
    </Section>
  );
}

export default DenoiseSection;
