import type { ReactNode } from 'react';
import { cn } from './cn';
import { tw } from './theme';
import { Slider } from './Slider';
import { defaultFormat, type RangeSpec } from './valueMath';

export interface FaderProps extends RangeSpec {
  value: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  defaultValue?: number;
  /** Fill origin (EQ faders use 0 dB). */
  origin?: number;
  /** Caption under the fader (e.g. "1k"). */
  label?: ReactNode;
  'aria-label': string;
  unit?: string;
  format?: (value: number) => string;
  /** Track height in px. */
  height?: number;
  disabled?: boolean;
  className?: string;
  /** Highlight (e.g. selected band). */
  active?: boolean;
  onSelect?: () => void;
}

/** Vertical fader (EQ). Keyboard via radix slider; double-click resets. */
export function Fader({
  label,
  unit,
  format,
  height = 140,
  className,
  active,
  onSelect,
  ...slider
}: FaderProps) {
  const text = format ? format(slider.value) : defaultFormat(slider.value, slider.step);
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1.5 rounded py-1 transition-colors',
        active && 'bg-[var(--color-surface-3,#252a3c)]',
        className,
      )}
      onPointerDownCapture={onSelect}
      onFocusCapture={onSelect}
    >
      <span className={cn('whitespace-nowrap text-[9px] leading-none tabular-nums', slider.value === 0 ? tw.fgSubtle : tw.fg)}>{text}</span>
      <div style={{ height }} className="flex justify-center">
        <Slider
          {...slider}
          orientation="vertical"
          valueText={unit ? `${text} ${unit}` : text}
          thumbClassName="h-2.5 w-4 rounded-sm"
        />
      </div>
      {label ? <span className={cn('whitespace-nowrap text-[9px] leading-none', tw.fgMuted)}>{label}</span> : null}
    </div>
  );
}

export default Fader;
