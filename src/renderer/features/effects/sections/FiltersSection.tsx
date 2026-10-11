import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { createDefaultFilterBand, FILTER_TYPES, type FilterBand, type FilterSlope, type FilterType } from '@shared/types';
import { Button, FieldRow, Hint, IconButton, Section, SegmentedControl, Select, SliderField, Switch, cn, tw } from '@renderer/components/ui';
import { formatDb, formatFreqCompact } from '@renderer/lib/dsp/format';
import { filterBandResponseDb, filterUsesGain, filterUsesSlope, filtersResponseDb } from '@renderer/lib/dsp/response';
import { logFrequencies } from '@renderer/lib/dsp/scale';
import { ResponseCurve } from '../ResponseCurve';
import { FILTER_SLOPES, PARAMS, rangeProps } from '../params';
import type { ChainSectionProps } from './VolumeSection';

export const RESPONSE_POINTS = 200;
const FREQS = logFrequencies(RESPONSE_POINTS);
const MAX_FILTERS = 8;

let bandCounter = 0;
export function newFilterId(): string {
  bandCounter += 1;
  return `flt-${Date.now().toString(36)}-${bandCounter.toString(36)}`;
}

/** Sensible starting frequency per filter type. */
export const DEFAULT_FREQ: Record<FilterType, number> = {
  highpass: 80,
  lowpass: 12000,
  bandpass: 1000,
  notch: 1000,
  lowshelf: 200,
  highshelf: 6000,
};

export function FiltersSection({ fx }: ChainSectionProps) {
  const { t } = useTranslation();
  const f = fx.source.filters;
  const P = PARAMS.filter;

  const curves = useMemo(
    () => [
      ...f.items.filter((b) => b.enabled).map((b) => ({ values: filterBandResponseDb(b, FREQS), width: 1, dashed: true, color: '#6c7590' })),
      { values: filtersResponseDb(f, FREQS, undefined, true), fill: true },
    ],
    [f],
  );

  const add = () =>
    fx.apply((c) => {
      const used = new Set(c.filters.items.map((b) => b.type));
      const type: FilterType = !used.has('highpass') ? 'highpass' : !used.has('lowpass') ? 'lowpass' : 'bandpass';
      c.filters.items.push({ ...createDefaultFilterBand(newFilterId(), type), freq: DEFAULT_FREQ[type] });
      c.filters.enabled = true;
    });

  return (
    <Section
      title={t('effects.filters.title')}
      description={t('effects.filters.description')}
      icon={<SlidersHorizontal size={14} aria-hidden />}
      enabled={f.enabled}
      onEnabledChange={(on) => fx.set('filters.enabled', on)}
      onReset={() => fx.apply((c) => void (c.filters.items = []))}
      actions={
        <Button size="xs" variant="outline" icon={<Plus size={12} aria-hidden />} onClick={add} disabled={f.items.length >= MAX_FILTERS}>
          {t('effects.filters.add')}
        </Button>
      }
    >
      <ResponseCurve
        aria-label={t('effects.filters.curve')}
        freqs={FREQS}
        curves={curves}
        bypassed={!f.enabled}
        markers={f.items.filter((b) => b.enabled).map((b) => ({ freq: b.freq, db: filterUsesGain(b.type) ? b.gainDb : 0 }))}
      />
      {f.items.length === 0 ? <Hint>{t('effects.filters.empty')}</Hint> : null}
      <ul className="flex flex-col gap-2">
        {f.items.map((band, i) => (
          <FilterBandEditor key={band.id} index={i} band={band} fx={fx} P={P} />
        ))}
      </ul>
    </Section>
  );
}

function FilterBandEditor({
  index,
  band,
  fx,
  P,
}: {
  index: number;
  band: FilterBand;
  fx: ChainSectionProps['fx'];
  P: typeof PARAMS.filter;
}) {
  const { t } = useTranslation();
  const base = `filters.items.${index}`;
  const name = t('effects.filters.bandName', { index: index + 1, type: t(`effects.filters.types.${band.type}`) });
  const slopeFixedQ = filterUsesSlope(band.type) && band.slope > 12;

  return (
    <li
      aria-label={name}
      className={cn('flex flex-col gap-2 rounded-md border p-2', tw.surface2, tw.border, !band.enabled && 'opacity-60')}
    >
      <div className="flex items-center gap-2">
        <Switch size="sm" aria-label={t('effects.filters.enableBand', { name })} checked={band.enabled} onCheckedChange={(on) => fx.set(`${base}.enabled`, on)} />
        <Select<FilterType>
          aria-label={t('effects.filters.type')}
          className="flex-1"
          value={band.type}
          onValueChange={(type) => fx.set(`${base}.type`, type)}
          options={FILTER_TYPES.map((ty) => ({ value: ty, label: t(`effects.filters.types.${ty}`), description: t(`effects.filters.typeHints.${ty}`) }))}
        />
        <IconButton
          size="xs"
          variant="ghost"
          label={t('effects.filters.remove', { name })}
          icon={<Trash2 size={13} aria-hidden />}
          onClick={() => fx.apply((c) => void c.filters.items.splice(index, 1))}
        />
      </div>
      <SliderField
        label={t('effects.filters.freq')}
        hint={t('effects.filters.freqHint')}
        unit="Hz"
        {...rangeProps(P.freq)}
        format={formatFreqCompact}
        {...fx.num(`${base}.freq`)}
      />
      <SliderField
        label={t('effects.filters.q')}
        hint={slopeFixedQ ? t('effects.filters.qFixedHint') : t('effects.filters.qHint')}
        {...rangeProps(P.q)}
        disabled={slopeFixedQ}
        {...fx.num(`${base}.q`)}
      />
      {filterUsesSlope(band.type) ? (
        <FieldRow label={t('effects.filters.slope')} hint={t('effects.filters.slopeHint')}>
          <SegmentedControl<string>
            aria-label={t('effects.filters.slope')}
            value={String(band.slope)}
            onValueChange={(s) => fx.set(`${base}.slope`, Number(s) as FilterSlope)}
            options={FILTER_SLOPES.map((s) => ({ value: String(s), label: t('effects.filters.slopeValue', { value: s }) }))}
          />
        </FieldRow>
      ) : null}
      {filterUsesGain(band.type) ? (
        <SliderField
          label={t('effects.filters.gain')}
          hint={t('effects.filters.gainHint')}
          unit="dB"
          origin={0}
          {...rangeProps(P.gainDb)}
          format={(v) => formatDb(v, 1, '').trim()}
          {...fx.num(`${base}.gainDb`)}
        />
      ) : null}
    </li>
  );
}

export default FiltersSection;
