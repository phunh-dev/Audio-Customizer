import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { createDefaultPitchTempo, type StretchMode } from '@shared/types';
import { Button, FieldRow, Hint, Knob, Section, SegmentedControl, SliderField } from '@renderer/components/ui';
import { formatSigned } from '@renderer/lib/dsp/format';
import { PARAMS, rangeProps } from '../params';
import type { ChainSectionProps } from './VolumeSection';

const TEMPO_PRESETS = [50, 75, 100, 125, 150, 200] as const;

/** Pitch ratio and length factor implied by the settings (contract formula). */
export function pitchTempoSummary(semitones: number, cents: number, tempo: number, mode: StretchMode) {
  const tempoRatio = tempo / 100;
  const pitch = Math.pow(2, (semitones + cents / 100) / 12) * (mode === 'varispeed' ? tempoRatio : 1);
  return { pitchRatio: pitch, lengthFactor: 1 / tempoRatio };
}

export function PitchTempoSection({ fx }: ChainSectionProps) {
  const { t } = useTranslation();
  const p = fx.source.pitchTempo;
  const P = PARAMS.pitchTempo;
  const sum = pitchTempoSummary(p.semitones, p.cents, p.tempo, p.mode);

  return (
    <Section
      title={t('effects.pitchTempo.title')}
      description={t('effects.pitchTempo.description')}
      icon={<Gauge size={14} aria-hidden />}
      enabled={p.enabled}
      onEnabledChange={(on) => fx.set('pitchTempo.enabled', on)}
      onReset={() => fx.apply((c) => void (c.pitchTempo = { ...createDefaultPitchTempo(), enabled: c.pitchTempo.enabled }))}
    >
      <div className="flex items-start justify-around">
        <Knob
          label={t('effects.pitchTempo.semitones')}
          aria-label={t('effects.pitchTempo.semitones')}
          unit="st"
          origin={0}
          size={52}
          format={(x) => formatSigned(x)}
          {...rangeProps(P.semitones)}
          {...fx.num('pitchTempo.semitones')}
        />
        <Knob
          label={t('effects.pitchTempo.cents')}
          aria-label={t('effects.pitchTempo.cents')}
          unit="ct"
          origin={0}
          size={52}
          format={(x) => formatSigned(x)}
          {...rangeProps(P.cents)}
          {...fx.num('pitchTempo.cents')}
        />
      </div>
      <SliderField
        label={t('effects.pitchTempo.tempo')}
        hint={t('effects.pitchTempo.tempoHint')}
        unit="%"
        origin={100}
        {...rangeProps(P.tempo)}
        {...fx.num('pitchTempo.tempo')}
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('effects.pitchTempo.tempoPresets')}>
        {TEMPO_PRESETS.map((v) => (
          <Button key={v} size="xs" variant={p.tempo === v ? 'primary' : 'outline'} onClick={() => fx.set('pitchTempo.tempo', v)}>
            {v}%
          </Button>
        ))}
      </div>
      <FieldRow label={t('effects.pitchTempo.mode')}>
        <SegmentedControl<StretchMode>
          aria-label={t('effects.pitchTempo.mode')}
          value={p.mode}
          onValueChange={(m) => fx.set('pitchTempo.mode', m)}
          options={(['stretch', 'varispeed'] as const).map((m) => ({ value: m, label: t(`effects.pitchTempo.modes.${m}`) }))}
        />
      </FieldRow>
      <Hint>{t(`effects.pitchTempo.modeHint.${p.mode}`)}</Hint>
      <Hint>
        {t('effects.pitchTempo.summary', { pitch: sum.pitchRatio.toFixed(3), length: sum.lengthFactor.toFixed(3) })}
      </Hint>
    </Section>
  );
}

export default PitchTempoSection;
