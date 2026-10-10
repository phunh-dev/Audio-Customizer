import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { tw } from './theme';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: cn(tw.accentBg, tw.accentFg, 'hover:brightness-110 active:brightness-95 shadow-sm'),
  secondary: cn(tw.surface3, tw.fg, 'hover:brightness-125'),
  ghost: cn('bg-transparent', tw.fgMuted, 'hover:bg-[var(--color-surface-3,#252a3c)] hover:text-[var(--color-fg,#e7eaf3)]'),
  danger: cn(tw.dangerBg, 'text-white hover:brightness-110'),
  outline: cn('border bg-transparent', tw.border, tw.fg, 'hover:bg-[var(--color-surface-3,#252a3c)]'),
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-md',
};

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'sm', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[filter,background-color,color] disabled:pointer-events-none disabled:opacity-40',
        tw.focus,
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

const ICON_SIZES: Record<ButtonSize, string> = {
  xs: 'size-6 rounded',
  sm: 'size-7 rounded-md',
  md: 'size-9 rounded-md',
};

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** Accessible name; also shown as tooltip. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show the label as tooltip (default true). */
  tooltip?: boolean;
  /** Toggle buttons: rendered pressed. */
  pressed?: boolean;
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'sm',
  tooltip = true,
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const btn = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center transition-[filter,background-color,color] disabled:pointer-events-none disabled:opacity-40',
        tw.focus,
        VARIANTS[variant],
        ICON_SIZES[size],
        pressed && cn(tw.accentText, 'bg-[var(--color-surface-3,#252a3c)]'),
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{btn}</Tooltip> : btn;
}

export default Button;
