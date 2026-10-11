import { useId, type ReactNode } from 'react';
import { Power, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { tw } from './theme';
import { Button, IconButton } from './Button';
import { Switch } from './Switch';
import { InfoTip } from './Tooltip';

export interface SectionProps {
  title: ReactNode;
  /** Plain-text title for accessible names (defaults to `title` if string). */
  name?: string;
  description?: ReactNode;
  icon?: ReactNode;
  /** When defined, an enable switch is shown in the header. */
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  /** When defined, a reset button is shown in the header. */
  onReset?: () => void;
  /** Extra header controls (presets, add buttons...). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Card with title, optional enable switch and reset button. */
export function Section({
  title,
  name,
  description,
  icon,
  enabled,
  onEnabledChange,
  onReset,
  actions,
  children,
  className,
}: SectionProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const plain = name ?? (typeof title === 'string' ? title : '');
  const dimmed = enabled === false;
  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-lg border', tw.surface, tw.border, className)}
      data-enabled={enabled === undefined ? undefined : String(enabled)}
    >
      <header className={cn('flex items-center gap-2 border-b px-3 py-2', tw.border)}>
        {icon ? <span className={cn('shrink-0', enabled === false ? tw.fgSubtle : tw.accentText)}>{icon}</span> : null}
        <h3 id={headingId} className={cn('min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide', tw.fg)}>
          {title}
        </h3>
        {description ? <InfoTip content={description} label={t('effects.ui.about', { name: plain })} /> : null}
        {actions}
        {onReset ? (
          <IconButton
            size="xs"
            label={t('effects.ui.resetSection', { name: plain })}
            icon={<RotateCcw size={13} aria-hidden />}
            onClick={onReset}
          />
        ) : null}
        {enabled !== undefined && onEnabledChange ? (
          <Switch size="sm" checked={enabled} onCheckedChange={onEnabledChange} aria-label={t('effects.ui.enableSection', { name: plain })} />
        ) : null}
      </header>
      {dimmed && onEnabledChange ? (
        <div
          data-testid="section-off"
          className={cn(
            'mx-3 mt-3 flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-[11px] leading-snug',
            tw.borderStrong,
            tw.fgMuted,
          )}
        >
          <Power size={12} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1">{t('effects.ui.offHint')}</span>
          <Button size="xs" variant="outline" onClick={() => onEnabledChange(true)} className="shrink-0">
            {t('effects.ui.turnOn')}
          </Button>
        </div>
      ) : null}
      <div className={cn('flex flex-col gap-3 p-3 transition-opacity', dimmed && 'opacity-60')}>{children}</div>
    </section>
  );
}

/** Small labelled row used inside sections. */
export function FieldRow({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className="flex min-w-0 items-center gap-1">
        <span className={cn('text-[11px] font-medium leading-tight', tw.fgMuted)}>{label}</span>
        {hint ? <InfoTip content={hint} label={typeof label === 'string' ? label : 'info'} /> : null}
      </span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** Muted explanatory text. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[11px] leading-snug', tw.fgSubtle, className)}>{children}</p>;
}

export default Section;
