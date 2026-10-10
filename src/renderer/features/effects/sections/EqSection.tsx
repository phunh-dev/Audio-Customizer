import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, RotateCcw } from 'lucide-react';
import { EQ_DEFAULT_Q } from '@shared/types';
import { Fader, FieldRow, IconButton, Knob, Section, Select, cn, tw } from '@renderer/components/ui';
import { formatDb, formatFreq, formatFreqShort } from '@renderer/lib/dsp/format';
import { eqResponseDb } from '@renderer/lib/dsp/response';
import { logFrequencies } from '@renderer/lib/dsp/scale';
import { ResponseCurve } from '../ResponseCurve';
import { applyEqPreset, EQ_PRESET_IDS, matchEqPreset, resetEqBands, type EqPresetId } from '../eqPresets';
import { PARAMS, rangeProps } from '../params';
import type { ChainSectionProps } from './VolumeSection';

const FREQS = logFrequencies(200);
const CUSTOM = 'custom';

export interface EqSectionProps extends ChainSectionProps {
  /** Output average spectrum (64 log bands, dB) drawn behind the curve. */
  spectrum?: Float32Array | null;
}

export function EqSection({ fx, spectrum }: EqSectionProps) {
  const { t } = useTranslation();
  const eq = fx.source.eq;
  const [selected, setSelected] = useState(8);
  const sel = Math.min(selected, eq.bands.length - 1);
  const band = eq.bands[sel];
  const preset = matchEqPreset(eq);
  const curve = useMemo(() => [{ values: eqResponseDb(eq, FREQS, undefined, true), fill: true }], [eq]);
  const markers = useMemo(() => eq.bands.map((b, i) => ({ freq: b.freq, db: b.gainDb, active: i === sel })), [eq, sel]);
  const db1 = (x: number) => formatDb(x, 1, '').trim();

  return (
    <Section
      title={t('effects.eq.title')}
      description={t('effects.eq.description')}
      icon={<AudioLines size={14} aria-hidden />}
      enabled={eq.enabled}
      onEnabledChange={(on) => fx.set('eq.enabled', on)}
      onReset={() => fx.apply((c) => resetEqBands(c.eq))}
    >
      <FieldRow label={t('effects.eq.preset')}>
        <Select<string>
          aria-label={t('effects.eq.preset')}
          className="w-44"
          value={preset ?? CUSTOM}
          onValueChange={(id) => {
            if (id !== CUSTOM) fx.apply((c) => applyEqPreset(c.eq, id as EqPresetId));
          }}
          options={[
            ...EQ_PRESET_IDS.map((id) => ({ value: id, label: t(`effects.eq.presets.${id}`) })),
            { value: CUSTOM, label: t('effects.eq.presets.custom'), disabled: true },
          ]}
        />
      </FieldRow>

      <ResponseCurve
        aria-label={t('effects.eq.curve')}
        freqs={FREQS}
        curves={curve}
        dbRange={18}
        spectrum={spectrum ?? null}
        markers={markers}
        bypassed={!eq.enabled}
        height={128}
      />

      <div className="-mx-1">
        <div className="flex justify-between" role="group" aria-label={t('effects.eq.bands')}>
          {eq.bands.map((b, i) => (
            <Fader
              key={b.freq}
              aria-label={t('effects.eq.bandGain', { freq: formatFreq(b.freq) })}
              label={formatFreqShort(b.freq)}
              unit="dB"
              height={120}
              origin={0}
              {...rangeProps(PARAMS.eq.gainDb)}
              format={(v) => (v === 0 ? '0' : v.toFixed(Math.abs(v) >= 10 ? 0 : 1))}
              className="min-w-0 flex-1"
              active={i === sel}
              onSelect={() => setSelected(i)}
              {...fx.num(`eq.bands.${i}.gainDb`)}
            />
          ))}
        </div>
      </div>

      {band ? (
        <div
          className={cn('flex items-center gap-3 rounded-md border px-3 py-2', tw.surface2, tw.border)}
          aria-label={t('effects.eq.selectedBand', { freq: formatFreq(band.freq) })}
          role="group"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn('text-[11px] font-semibold', tw.fg)}>{t('effects.eq.selectedBand', { freq: formatFreq(band.freq) })}</span>
            <span className={cn('text-[11px]', tw.fgSubtle, tw.mono)}>{`${db1(band.gainDb)} ${t('app.units.db')}`}</span>
            <span className={cn('text-[10px]', tw.fgSubtle)}>{t('effects.eq.qHint')}</span>
          </div>
          <Knob
            label={t('effects.eq.gain')}
            aria-label={t('effects.eq.bandGain', { freq: formatFreq(band.freq) })}
            unit="dB"
            origin={0}
            format={db1}
            {...rangeProps(PARAMS.eq.gainDb)}
            {...fx.num(`eq.bands.${sel}.gainDb`)}
          />
          <Knob
            label={t('effects.eq.q')}
            aria-label={t('effects.eq.bandQ', { freq: formatFreq(band.freq) })}
            format={(v) => v.toFixed(2)}
            {...rangeProps(PARAMS.eq.q)}
            scale="log"
            {...fx.num(`eq.bands.${sel}.q`)}
          />
          <IconButton
            size="xs"
            label={t('effects.eq.resetBand', { freq: formatFreq(band.freq) })}
            icon={<RotateCcw size={12} aria-hidden />}
            onClick={() =>
              fx.apply((c) => {
                const b = c.eq.bands[sel];
                if (b) {
                  b.gainDb = 0;
                  b.q = EQ_DEFAULT_Q;
                }
              })
            }
          />
        </div>
      ) : null}
    </Section>
  );
}

export default EqSection;
