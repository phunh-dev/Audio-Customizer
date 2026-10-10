import type { ReactNode } from 'react';
import { ToggleGroup } from 'radix-ui';
import { cn } from './cn';
import { tw } from './theme';
import { Tooltip } from './Tooltip';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is an icon. */
  ariaLabel?: string;
  tooltip?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentOption<T>[];
  'aria-label': string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  /** Stretch segments to the full width. */
  fill?: boolean;
}

/**
 * Single-choice segmented control (radix ToggleGroup). Never allows an empty
 * selection; arrow keys move between segments.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = 'sm',
  disabled,
  className,
  fill,
  ...aria
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v: string) => {
        if (v) onValueChange(v as T);
      }}
      aria-label={aria['aria-label']}
      disabled={disabled}
      className={cn('inline-flex rounded-md border p-0.5', tw.surface2, tw.border, fill && 'flex w-full', className)}
    >
      {options.map((o) => {
        const item = (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            className={cn(
              'inline-flex select-none items-center justify-center gap-1 whitespace-nowrap rounded font-medium transition-colors disabled:opacity-40',
              tw.focus,
              size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-8 px-3 text-xs',
              fill && 'flex-1',
              'data-[state=on]:bg-[var(--color-accent,#7c6cff)] data-[state=on]:text-[var(--color-accent-fg,#ffffff)]',
              'data-[state=off]:text-[var(--color-fg-muted,#9aa3b9)] data-[state=off]:hover:text-[var(--color-fg,#e7eaf3)]',
            )}
          >
            {o.label}
          </ToggleGroup.Item>
        );
        return o.tooltip ? (
          <Tooltip key={o.value} content={o.tooltip}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </ToggleGroup.Root>
  );
}

export default SegmentedControl;
