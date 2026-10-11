import { useId, type ReactNode } from 'react';
import { Switch as RSwitch } from 'radix-ui';
import { cn } from './cn';
import { tw } from './theme';
import { InfoTip } from './Tooltip';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label (optional). When absent, `aria-label` is required. */
  label?: ReactNode;
  'aria-label'?: string;
  /** Explanation shown in an (i) tooltip next to the label. */
  hint?: ReactNode;
  hintLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
}

/** On/off switch (radix). */
export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  hintLabel,
  disabled,
  size = 'md',
  className,
  id,
  ...aria
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const sm = size === 'sm';
  const control = (
    <RSwitch.Root
      id={switchId}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={aria['aria-label']}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        tw.focus,
        sm ? 'h-4 w-7' : 'h-5 w-9',
        checked ? tw.accentBg : 'bg-[var(--color-surface-3,#252a3c)]',
      )}
    >
      <RSwitch.Thumb
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow transition-transform',
          sm ? 'size-3 translate-x-0.5 data-[state=checked]:translate-x-3' : 'size-4 translate-x-0.5 data-[state=checked]:translate-x-4',
        )}
      />
    </RSwitch.Root>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {control}
      <label htmlFor={switchId} className={cn('cursor-pointer select-none text-xs', tw.fg, disabled && 'opacity-40')}>
        {label}
      </label>
      {hint ? <InfoTip content={hint} label={hintLabel ?? String(label)} /> : null}
    </span>
  );
}

export default Switch;
