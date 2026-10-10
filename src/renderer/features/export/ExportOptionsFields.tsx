import { useTranslation } from 'react-i18next';
import { EXPORT_FORMATS, type BitDepth, type ChannelMode, type ExportFormat, type ExportOptions, type ResampleQuality } from '@shared/types';
import { FieldRow, SegmentedControl, Select, SliderField, Switch, cn, tw } from '@renderer/components/ui';
import { formatSampleRate } from '@renderer/lib/dsp/format';
import {
  bitDepthsFor,
  bitratesFor,
  isLossy,
  OGG_BITRATE_MAX,
  OGG_BITRATE_MIN,
  sampleRatesFor,
  withFormat,
  type ProjectFormat,
} from './exportOptions';

export interface ExportOptionsFieldsProps {
  options: ExportOptions;
  onChange: (options: ExportOptions) => void;
  format: ProjectFormat;
  /** Hide less common fields (resample quality, dither). */
  compact?: boolean;
  className?: string;
}

const KEEP = 'keep';

/** All export option controls; the parent stores (and sanitises) the result. */
export function ExportOptionsFields({ options, onChange, format, compact, className }: ExportOptionsFieldsProps) {
  const { t } = useTranslation();
  const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => onChange({ ...options, [key]: value });
  const lossy = isLossy(options.format);
  const depths = bitDepthsFor(options.format);
  const rates = sampleRatesFor(options.format);
  const bitrates = bitratesFor(options.format);
  const keepAllowed = options.format !== 'mp3' || rates.includes(format.sampleRate);

  const rateOptions = [
    ...(keepAllowed
      ? [{ value: KEEP, label: t('export.sampleRate.keep', { rate: formatSampleRate(format.sampleRate) }), description: t('export.sampleRate.keepHint') }]
      : []),
    ...rates.map((r) => ({
      value: String(r),
      label: formatSampleRate(r),
      description: t(`export.sampleRateHint.${r}`),
    })),
  ];

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <FieldRow label={t('export.fields.format')} hint={t('export.hints.format')}>
        <SegmentedControl<ExportFormat>
          aria-label={t('export.fields.format')}
          value={options.format}
          onValueChange={(f) => onChange(withFormat(options, f, format.sampleRate, format.channels))}
          options={EXPORT_FORMATS.map((f) => ({ value: f, label: t(`export.formats.${f}`), tooltip: t(`export.formatHint.${f}`) }))}
        />
      </FieldRow>

      <FieldRow label={t('export.fields.sampleRate')} hint={t('export.hints.sampleRate')}>
        <Select
          aria-label={t('export.fields.sampleRate')}
          className="w-44"
          value={options.sampleRate === 0 ? KEEP : String(options.sampleRate)}
          onValueChange={(v) => set('sampleRate', v === KEEP ? 0 : Number(v))}
          options={rateOptions}
        />
      </FieldRow>

      <FieldRow label={t('export.fields.channels')} hint={t('export.hints.channels')}>
        <SegmentedControl<ChannelMode>
          aria-label={t('export.fields.channels')}
          value={options.channels}
          onValueChange={(v) => set('channels', v)}
          options={(['source', 'mono', 'stereo'] as const).map((c) => ({ value: c, label: t(`export.channels.${c}`) }))}
        />
      </FieldRow>

      {depths.length > 0 ? (
        <FieldRow label={t('export.fields.bitDepth')} hint={t('export.hints.bitDepth')}>
          <SegmentedControl<string>
            aria-label={t('export.fields.bitDepth')}
            value={String(options.bitDepth)}
            onValueChange={(v) => set('bitDepth', Number(v) as BitDepth)}
            options={depths.map((d) => ({
              value: String(d),
              label: d === 32 && options.format === 'wav' ? t('export.bitDepth.32f') : t(`export.bitDepth.${d}`),
            }))}
          />
        </FieldRow>
      ) : null}

      {!lossy && !compact ? (
        <FieldRow label={t('export.fields.dither')} hint={t('export.hints.dither')}>
          <Switch
            aria-label={t('export.fields.dither')}
            checked={options.dither}
            onCheckedChange={(v) => set('dither', v)}
            disabled={options.bitDepth === 32 && options.format === 'wav'}
          />
        </FieldRow>
      ) : null}

      {lossy ? (
        <>
          <FieldRow label={t('export.fields.bitrateMode')} hint={t('export.hints.bitrateMode')}>
            <SegmentedControl<ExportOptions['bitrateMode']>
              aria-label={t('export.fields.bitrateMode')}
              value={options.bitrateMode}
              onValueChange={(v) => set('bitrateMode', v)}
              options={(['cbr', 'vbr'] as const).map((m) => ({ value: m, label: t(`export.bitrateMode.${m}`) }))}
            />
          </FieldRow>
          {options.bitrateMode === 'cbr' ? (
            options.format === 'mp3' ? (
              <FieldRow label={t('export.fields.bitrate')} hint={t('export.hints.bitrate')}>
                <Select
                  aria-label={t('export.fields.bitrate')}
                  className="w-32"
                  value={String(options.bitrateKbps)}
                  onValueChange={(v) => set('bitrateKbps', Number(v))}
                  options={bitrates.map((b) => ({ value: String(b), label: t('export.kbps', { value: b }) }))}
                />
              </FieldRow>
            ) : (
              <SliderField
                label={t('export.fields.bitrate')}
                hint={t('export.hints.bitrate')}
                unit="kbps"
                min={OGG_BITRATE_MIN}
                max={OGG_BITRATE_MAX}
                step={1}
                defaultValue={192}
                value={options.bitrateKbps}
                onChange={(v) => set('bitrateKbps', v)}
              />
            )
          ) : (
            <SliderField
              label={t('export.fields.vbrQuality')}
              hint={t('export.hints.vbrQuality')}
              min={0}
              max={1}
              step={0.05}
              defaultValue={0.7}
              value={options.vbrQuality}
              format={(v) => v.toFixed(2)}
              onChange={(v) => set('vbrQuality', v)}
            />
          )}
        </>
      ) : null}

      {!compact ? (
        <FieldRow label={t('export.fields.resampleQuality')} hint={t('export.hints.resampleQuality')}>
          <SegmentedControl<ResampleQuality>
            aria-label={t('export.fields.resampleQuality')}
            value={options.resampleQuality}
            onValueChange={(v) => set('resampleQuality', v)}
            options={(['fast', 'balanced', 'best'] as const).map((q) => ({ value: q, label: t(`export.resampleQuality.${q}`) }))}
          />
        </FieldRow>
      ) : null}
      {lossy && options.format === 'ogg' && options.bitrateMode === 'cbr' ? (
        <p className={cn('text-[11px]', tw.fgSubtle)}>{t('export.hints.oggAbr')}</p>
      ) : null}
    </div>
  );
}

export default ExportOptionsFields;
