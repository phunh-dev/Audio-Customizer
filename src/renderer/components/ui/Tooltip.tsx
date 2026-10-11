import type { ReactElement, ReactNode } from 'react';
import { Tooltip as RTooltip } from 'radix-ui';
import { Info } from 'lucide-react';
import { cn } from './cn';
import { tw } from './theme';

export interface TooltipProps {
  /** Already-translated text (or node). Nothing is rendered when empty. */
  content?: ReactNode;
  /** A single element that accepts a ref (button, span, ...). */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delayDuration?: number;
}

/** Hover / focus tooltip (radix). The trigger keeps its own semantics. */
export function Tooltip({ content, children, side = 'top', delayDuration = 350 }: TooltipProps) {
  if (content === undefined || content === null || content === '') return children;
  return (
    <RTooltip.Provider delayDuration={delayDuration} skipDelayDuration={150}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              'z-50 max-w-72 rounded-md border px-2.5 py-1.5 text-xs leading-snug shadow-lg',
              tw.surface3,
              tw.border,
              tw.fg,
            )}
          >
            {content}
            <RTooltip.Arrow className="fill-[var(--color-surface-3,#252a3c)]" />
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

export interface InfoTipProps {
  content: ReactNode;
  /** Accessible label of the (i) icon. */
  label: string;
  side?: TooltipProps['side'];
}

/** Small focusable (i) icon that shows an explanation on hover / focus. */
export function InfoTip({ content, label, side }: InfoTipProps) {
  return (
    <Tooltip content={content} side={side}>
      <span
        tabIndex={0}
        role="img"
        aria-label={label}
        className={cn('inline-flex shrink-0 cursor-help rounded-full', tw.fgSubtle, tw.focus, 'hover:text-[var(--color-fg,#e7eaf3)]')}
      >
        <Info size={13} aria-hidden />
      </span>
    </Tooltip>
  );
}

export default Tooltip;
