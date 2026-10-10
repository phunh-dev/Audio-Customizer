import { useState, type KeyboardEvent } from 'react';
import { cn } from './cn';
import { tw } from './theme';
import { defaultFormat, normalizeValue, nudge, parseNumberInput, type RangeSpec } from './valueMath';

export interface NumberFieldProps extends RangeSpec {
  value: number;
  /** Called with the clamped/snapped value. */
  onChange: (value: number) => void;
  /** Called once per finished edit (typed entry / key step). */
  onCommit?: (value: number) => void;
  unit?: string;
  /** Format for display while not editing (default: decimals from step). */
  format?: (value: number) => string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Typed numeric entry (role spinbutton). Enter / blur commits with clamping +
 * snapping, Escape reverts, Arrow Up/Down steps (Shift = x10).
 */
export function NumberField({
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  scale,
  unit,
  format,
  id,
  disabled,
  className,
  ...aria
}: NumberFieldProps) {
  const range: RangeSpec = { min, max, step, scale };
  const [draft, setDraft] = useState<string | null>(null);
  const display = format ? format(value) : defaultFormat(value, step);

  const apply = (v: number) => {
    const n = normalizeValue(v, range);
    onChange(n);
    onCommit?.(n);
    return n;
  };

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseNumberInput(draft);
    setDraft(null);
    if (parsed === null) return; // revert
    apply(parsed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Escape') {
      if (draft !== null) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(null);
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = draft !== null ? (parseNumberInput(draft) ?? value) : value;
      setDraft(null);
      apply(nudge(normalizeValue(base, range), e.key === 'ArrowUp' ? 1 : -1, range, { large: e.shiftKey }));
    }
  };

  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded border pr-1.5 text-[11px]',
        tw.surface2,
        tw.border,
        'focus-within:border-[var(--color-accent,#7c6cff)]',
        disabled && 'opacity-40',
        className,
      )}
    >
      <input
        id={id}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={unit ? `${display} ${unit}` : display}
        disabled={disabled}
        value={draft ?? display}
        onFocus={(e) => {
          setDraft(display);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={onKeyDown}
        className={cn('h-full w-full min-w-0 bg-transparent px-1.5 text-right outline-none', tw.fg, tw.mono)}
      />
      {unit ? <span className={cn('shrink-0 select-none', tw.fgSubtle)}>{unit}</span> : null}
    </span>
  );
}

export default NumberField;
