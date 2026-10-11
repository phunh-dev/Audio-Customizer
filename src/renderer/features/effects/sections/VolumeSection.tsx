import { useTranslation } from 'react-i18next';
import { Volume2 } from 'lucide-react';
import { createDefaultVolume, type EffectChain, type NormalizeMode } from '@shared/types';
import { FieldRow, Hint, Section, SegmentedControl, SliderField, Switch } from '@renderer/components/ui';
import { formatDb } from '@renderer/lib/dsp/format';
import type { Binder } from '../binding';
import { normalizeTargetSpec, PARAMS, rangeProps } from '../params';

export interface ChainSectionProps {
  fx: Binder<EffectChain>;
  /** Measured output levels of the current render (master only). */
  meter?: { peakDb: number; lufs: number | null } | null;
}

export function VolumeSection({ fx, meter }: ChainSectionProps) {
  const { t } = useTranslation();
  const v = fx.source.volume;
  const P = PARAMS.volume;
  const target = normalizeTargetSpec(v.normalize);
  const db1 = (x: number) => formatDb(x, 1, '').trim();

  const setMode = (mode: NormalizeMode) =>
    fx.apply((c) => {
      const prev = c.volume.normalize;
      c.volume.normalize = mode;
      if (mode === 'off' || prev === mode) return;
      // peak (dBFS) and loudness (LUFS) targets are different units: switching
      // between them starts from the new mode's default; coming from "off"
      // keeps the stored target when it is valid for the mode
      const spec = normalizeTargetSpec(mode);
      const cur = c.volume.normalizeTarget;
      if (prev !== 'off' || cur < spec.min || cur > spec.max) c.volume.normalizeTarget = spec.default;
    });

  return (
    <Section
      title={t('effects.volume.title')}
      description={t('effects.volume.description')}
      icon={<Volume2 size={14} aria-hidden />}
      onReset={() => fx.apply((c) => void (c.volume = createDefaultVolume()))}
    >
      <SliderField
        label={t('effects.volume.gain')}
        hint={t('effects.volume.gainHint')}
        unit="dB"
        {...rangeProps(P.gainDb)}
        origin={0}
        format={db1}
        {...fx.num('volume.gainDb')}
      />

      <FieldRow label={t('effects.volume.normalize')} hint={t('effects.volume.normalizeHint')}>
        <SegmentedControl<NormalizeMode>
          aria-label={t('effects.volume.normalize')}
          value={v.normalize}
          onValueChange={setMode}
          options={(['off', 'peak', 'lufs'] as const).map((m) => ({ value: m, label: t(`effects.volume.normalizeModes.${m}`) }))}
        />
      </FieldRow>
      {v.normalize !== 'off' ? (
        <SliderField
          label={v.normalize === 'peak' ? t('effects.volume.peakTarget') : t('effects.volume.lufsTarget')}
          hint={v.normalize === 'peak' ? t('effects.volume.peakTargetHint') : t('effects.volume.lufsTargetHint')}
          unit={v.normalize === 'peak' ? 'dBFS' : 'LUFS'}
          min={target.min}
          max={target.max}
          step={target.step}
          defaultValue={target.default}
          format={db1}
          {...fx.num('volume.normalizeTarget')}
        />
      ) : null}

      <div className="flex flex-col gap-2 border-t border-[var(--color-border,#2a3044)] pt-3">
        <Switch
          label={t('effects.volume.limiter')}
          hint={t('effects.volume.limiterHint')}
          checked={v.limiter}
          onCheckedChange={(on) => fx.set('volume.limiter', on)}
        />
        <SliderField
          label={t('effects.volume.ceiling')}
          hint={t('effects.volume.ceilingHint')}
          unit="dBTP"
          {...rangeProps(P.limiterCeilingDb)}
          format={db1}
          disabled={!v.limiter}
          {...fx.num('volume.limiterCeilingDb')}
        />
        <SliderField
          label={t('effects.volume.release')}
          hint={t('effects.volume.releaseHint')}
          unit="ms"
          {...rangeProps(P.limiterReleaseMs)}
          disabled={!v.limiter}
          {...fx.num('volume.limiterReleaseMs')}
        />
      </div>

      {meter ? (
        <Hint>
          {t('effects.volume.meter', {
            peak: Number.isFinite(meter.peakDb) ? formatDb(meter.peakDb, 1, 'dBFS') : '-inf',
            lufs: meter.lufs === null ? '-' : `${meter.lufs.toFixed(1)} LUFS`,
          })}
        </Hint>
      ) : null}
    </Section>
  );
}

export default VolumeSection;
