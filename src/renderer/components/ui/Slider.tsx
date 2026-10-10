import { useId, type ReactNode } from 'react';
import { Slider as RSlider } from 'radix-ui';
import { posToValue, valueToPos } from '@renderer/lib/dsp/scale';
import { cn } from './cn';
import { tw } from './theme';
import { NumberField } from './NumberField';
import { InfoTip } from './Tooltip';
import { defaultFormat, normalizeValue, type RangeSpec } from './valueMath';

const LOG_RES = 1000;

export interface SliderProps extends RangeSpec {
  value: number;
  onChange: (value: number) => void;
  /** End of a gesture (pointer up / key press). */
  onCommit?: (value: number) => void;
  /** Double-click resets to this value. */
  defaultValue?: number;
  orientation?: 'horizontal' | 'vertical';
  /** Fill the track from this value instead of `min` (e.g. 0 dB). */
  origin?: number;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Read-out for assistive technology. */
  valueText?: string;
  disabled?: boolean;
  className?: string;
  /** Thumb size/shape classes (default: 14 px circle). */
  thumbClassName?: string;
}

/**
 * Single-thumb slider on radix. Supports log scale (frequency), bipolar fill
 * and double-click reset. Keyboard: arrows, PageUp/PageDown, Home/End.
 */
export function Slider({
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  scale = 'linear',
  defaultValue,
  orientation = 'horizontal',
  origin,
  valueText,
  disabled,
  className,
  thumbClassName,
  ...aria
}: SliderProps) {
  const range: RangeSpec = { min, max, step, scale };
  const isLog = scale === 'log';
  const toInternal = (v: number) => (isLog ? Math.round(valueToPos(v, min, max, 'log') * LOG_RES) : v);
  const fromInternal = (iv: number) => normalizeValue(isLog ? posToValue(iv / LOG_RES, min, max, 'log') : iv, range);
  const vertical = orientation === 'vertical';

  const pos = valueToPos(value, min, max, scale);
  const originPos = origin === undefined ? 0 : valueToPos(origin, min, max, scale);
  const lo = Math.min(pos, originPos) * 100;
  const hi = Math.max(pos, originPos) * 100;

  const reset = () => {
    if (defaultValue === undefined || disabled) return;
    onChange(defaultValue);
    onCommit?.(defaultValue);
  };

  return (
    <RSlider.Root
      value={[toInternal(value)]}
      min={isLog ? 0 : min}
      max={isLog ? LOG_RES : max}
      step={isLog ? 1 : step}
      orientation={orientation}
      disabled={disabled}
      onValueChange={(v) => {
        const n = fromInternal(v[0] ?? toInternal(value));
        if (n !== value) onChange(n);
      }}
      onValueCommit={(v) => onCommit?.(fromInternal(v[0] ?? toInternal(value)))}
      className={cn(
        'relative flex touch-none select-none items-center data-[disabled]:opacity-40',
        vertical ? 'h-full w-5 flex-col' : 'h-5 w-full',
        className,
      )}
    >
      <RSlider.Track
        className={cn('relative grow overflow-hidden rounded-full', tw.surface3, vertical ? 'w-1' : 'h-1')}
      >
        {/* custom fill so it can start at `origin` */}
        <span
          aria-hidden
          className={cn('absolute rounded-full', tw.accentBg)}
          style={vertical ? { left: 0, right: 0, bottom: `${lo}%`, top: `${100 - hi}%` } : { top: 0, bottom: 0, left: `${lo}%`, right: `${100 - hi}%` }}
        />
        <RSlider.Range className="hidden" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        aria-valuetext={valueText}
        {...(isLog ? { 'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': value } : {})}
        onDoubleClick={reset}
        className={cn(
          'block cursor-grab border-2 bg-white shadow transition-[transform,box-shadow] hover:shadow-[0_0_0_4px_var(--color-accent-soft)] active:cursor-grabbing active:scale-110',
          tw.accentBorder,
          tw.focus,
          // `thumbClassName` replaces the default round thumb shape
          thumbClassName ?? 'size-3.5 rounded-full',
        )}
      />
    </RSlider.Root>
  );
}

export interface SliderFieldProps extends Omit<SliderProps, 'orientation' | 'aria-label' | 'aria-labelledby'> {
  label: ReactNode;
  /** Explanation tooltip shown in an (i) icon. */
  hint?: ReactNode;
  unit?: string;
  /** Read-out formatter (number field + aria). */
  format?: (value: number) => string;
  id?: string;
}

/**
 * Labelled slider + typed number entry. Double-click the label or the thumb
 * to reset to `defaultValue`.
 */
export function SliderField({ label, hint, unit, format, id, ...slider }: SliderFieldProps) {
  const autoId = useId();
  const labelId = `${id ?? autoId}-label`;
  const fmt = format ?? ((v: number) => defaultFormat(v, slider.step));
  const reset = () => {
    if (slider.defaultValue === undefined || slider.disabled) return;
    slider.onChange(slider.defaultValue);
    slider.onCommit?.(slider.defaultValue);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <span
            id={labelId}
            onDoubleClick={reset}
            className={cn('text-[11px] font-medium leading-tight', tw.fgMuted, slider.disabled && 'opacity-40')}
          >
            {label}
          </span>
          {hint ? <InfoTip content={hint} label={typeof label === 'string' ? label : 'info'} /> : null}
        </span>
        <NumberField
          id={id}
          aria-labelledby={labelId}
          value={slider.value}
          onChange={slider.onChange}
          onCommit={slider.onCommit}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          scale={slider.scale}
          unit={unit}
          format={format}
          disabled={slider.disabled}
          className="w-24 shrink-0"
        />
      </div>
      <Slider {...slider} aria-labelledby={labelId} valueText={unit ? `${fmt(slider.value)} ${unit}` : fmt(slider.value)} />
    </div>
  );
}

export default Slider;
