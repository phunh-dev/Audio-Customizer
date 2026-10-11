import type { ReactNode } from 'react';
import { Select as RSelect } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';
import { tw } from './theme';

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Secondary line under the label (e.g. a recommendation hint). */
  description?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
  placeholder?: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/** Drop-down select (radix). Values are strings; wrap numbers with String(). */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  size = 'sm',
  className,
  id,
  ...aria
}: SelectProps<T>) {
  return (
    <RSelect.Root value={value} onValueChange={(v) => onValueChange(v as T)} disabled={disabled}>
      <RSelect.Trigger
        id={id}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        className={cn(
          'inline-flex min-w-0 items-center justify-between gap-2 rounded-md border text-left transition-colors disabled:opacity-40',
          tw.surface2,
          tw.border,
          tw.fg,
          tw.focus,
          'hover:border-[var(--color-border-strong,#3a4260)]',
          size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 px-3 text-sm',
          className,
        )}
      >
        <span className="truncate">
          <RSelect.Value placeholder={placeholder} />
        </span>
        <RSelect.Icon className={tw.fgSubtle}>
          <ChevronDown size={14} aria-hidden />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border shadow-xl',
            tw.surface2,
            tw.border,
          )}
        >
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className={cn(
                  'relative flex cursor-pointer select-none flex-col rounded py-1.5 pl-6 pr-2 text-xs outline-none data-[disabled]:opacity-40',
                  tw.fg,
                  'data-[highlighted]:bg-[var(--color-surface-3,#252a3c)]',
                )}
              >
                <RSelect.ItemIndicator className={cn('absolute left-1.5 top-2', tw.accentText)}>
                  <Check size={12} aria-hidden />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                {o.description ? <span className={cn('mt-0.5 text-[10px] leading-tight', tw.fgSubtle)}>{o.description}</span> : null}
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export default Select;
