import { useTranslation } from 'react-i18next';
import { Repeat, Crosshair, Maximize2 } from 'lucide-react';
import { createDefaultLoop, FADE_CURVES, type FadeCurve, type MasterSettings } from '@shared/types';
import { Button, FieldRow, Hint, Section, Select, SliderField, Switch, cn, tw } from '@renderer/components/ui';
import { formatTime } from '@renderer/lib/dsp/format';
import type { Binder } from '../binding';
import { PARAMS, rangeProps } from '../params';
import { selectionToLoopRegion, type TimeRange } from '../regions';

export interface MasterSectionProps {
  mx: Binder<MasterSettings>;
}

export interface LoopSectionProps extends MasterSectionProps {
  selection: TimeRange | null;
}

export function LoopSection({ mx, selection }: LoopSectionProps) {
  const { t } = useTranslation();
  const l = mx.source.loop;
  const region = selectionToLoopRegion(selection);
  const whole = l.start === null && l.end === null;

  return (
    <Section
      title={t('effects.loop.title')}
      description={t('effects.loop.description')}
      icon={<Repeat size={14} aria-hidden />}
      enabled={l.enabled}
      onEnabledChange={(on) => mx.set('loop.enabled', on)}
      onReset={() => mx.apply((m) => void (m.loop = { ...createDefaultLoop(), enabled: m.loop.enabled }))}
    >
      <SliderField
        label={t('effects.loop.crossfade')}
        hint={t('effects.loop.crossfadeHint')}
        unit="ms"
        {...rangeProps(PARAMS.loop.crossfadeMs)}
        {...mx.num('loop.crossfadeMs')}
      />
      <FieldRow label={t('effects.loop.curve')} hint={t('effects.loop.curveHint')}>
        <Select<FadeCurve>
          aria-label={t('effects.loop.curve')}
          className="w-40"
          value={l.curve}
          onValueChange={(c) => mx.set('loop.curve', c)}
          options={FADE_CURVES.map((c) => ({ value: c, label: t(`effects.curves.${c}`) }))}
        />
      </FieldRow>

      <div className={cn('flex flex-col gap-2 rounded-md border p-2', tw.surface2, tw.border)}>
        <FieldRow label={t('effects.loop.region')} hint={t('effects.loop.regionHint')}>
          <span data-testid="loop-region" className={cn('text-[11px]', tw.mono, whole ? tw.fgSubtle : tw.fg)}>
            {whole
              ? t('effects.loop.whole')
              : t('effects.loop.regionRange', {
                  start: l.start === null ? t('effects.loop.begin') : formatTime(l.start),
                  end: l.end === null ? t('effects.loop.end') : formatTime(l.end),
                })}
          </span>
        </FieldRow>
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="outline"
            icon={<Crosshair size={12} aria-hidden />}
            disabled={!region}
            onClick={() =>
              region &&
              mx.apply((m) => {
                m.loop.start = region.start;
                m.loop.end = region.end;
              })
            }
          >
            {t('effects.loop.fromSelection')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={<Maximize2 size={12} aria-hidden />}
            disabled={whole}
            onClick={() =>
              mx.apply((m) => {
                m.loop.start = null;
                m.loop.end = null;
              })
            }
          >
            {t('effects.loop.useWhole')}
          </Button>
        </div>
      </div>

      <Switch label={t('effects.loop.zeroCrossing')} hint={t('effects.loop.zeroCrossingHint')} checked={l.zeroCrossing} onCheckedChange={(on) => mx.set('loop.zeroCrossing', on)} />
      <Switch label={t('effects.loop.matchLoudness')} hint={t('effects.loop.matchLoudnessHint')} checked={l.matchLoudness} onCheckedChange={(on) => mx.set('loop.matchLoudness', on)} />
      <Hint>{t('effects.loop.hint')}</Hint>
    </Section>
  );
}

export default LoopSection;
