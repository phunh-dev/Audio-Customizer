import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight, Pause, Play, Repeat, Square } from 'lucide-react';
import { useActiveTab, useAppStore, tabDuration } from '../../store';
import { formatTime, STEP_UNITS, type StepUnit } from '../../utils/time';
import { Select } from '../ui/Select';
import { cn } from '../ui/cn';

function RoundButton({
  label,
  onClick,
  children,
  disabled,
  primary,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  primary?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center rounded-full transition-[background-color,color,transform] active:scale-95 disabled:pointer-events-none disabled:opacity-40',
        primary
          ? 'size-10 bg-accent text-accent-fg shadow-[0_4px_14px_var(--color-accent-soft)] hover:brightness-110'
          : 'size-8 text-fg-muted hover:bg-surface-3 hover:text-fg',
        pressed && 'bg-accent-soft text-accent',
      )}
    >
      {children}
    </button>
  );
}

export function TransportBar() {
  const { t } = useTranslation();
  const tab = useActiveTab();
  const sources = useAppStore((s) => s.sources);
  const transport = useAppStore((s) => s.transport);
  const stepUnit = useAppStore((s) => s.settings.stepUnit);
  const s = useAppStore.getState;
  const duration = tabDuration(tab, sources);
  const playing = transport.state === 'playing' && transport.sessionId === tab.id;
  const canPlay = tab.render !== null && !tab.sleeping && !tab.loading;
  const unitLabel = (u: StepUnit): string => t(`transport.units.${u}`);

  return (
    <footer
      aria-label={t('transport.title')}
      className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-surface px-4"
    >
      <div className="flex items-center gap-1">
        <RoundButton label={t('transport.stop')} onClick={() => void s().stop()} disabled={!canPlay}>
          <Square className="size-3.5 fill-current" />
        </RoundButton>
        <RoundButton label={`${t('transport.stepBack')} (←)`} onClick={() => void s().step(-1)} disabled={duration <= 0}>
          <ChevronsLeft className="size-4" />
        </RoundButton>
        <RoundButton
          primary
          label={`${playing ? t('transport.pause') : t('transport.play')} (${t('transport.space')})`}
          onClick={() => void s().togglePlay()}
          disabled={!canPlay}
        >
          {playing ? <Pause className="size-4.5 fill-current" /> : <Play className="ml-0.5 size-4.5 fill-current" />}
        </RoundButton>
        <RoundButton label={`${t('transport.stepForward')} (→)`} onClick={() => void s().step(1)} disabled={duration <= 0}>
          <ChevronsRight className="size-4" />
        </RoundButton>
        <RoundButton label={t('transport.loop')} pressed={transport.loop} onClick={() => void s().setLoop(!transport.loop)}>
          <Repeat className="size-4" />
        </RoundButton>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span>{t('transport.stepUnit')}</span>
        <Select<StepUnit>
          value={stepUnit}
          onValueChange={(u) => s().setStepUnit(u)}
          options={STEP_UNITS.map((u) => ({ value: u, label: unitLabel(u) }))}
          size="sm"
          className="w-36"
        />
      </label>

      <div className="flex-1" />

      <div className="flex items-baseline gap-1.5 rounded-lg border border-border bg-bg px-3 py-1.5 font-mono tabular-nums">
        <span data-testid="time-position" className="text-[17px] font-medium text-fg" aria-label={t('transport.position')}>
          {formatTime(tab.playhead)}
        </span>
        <span className="text-xs text-fg-subtle">/</span>
        <span data-testid="time-duration" className="text-xs text-fg-muted" aria-label={t('transport.duration')}>
          {formatTime(duration)}
        </span>
      </div>
      {tab.render && (
        <div className="hidden flex-col items-end font-mono text-[10px] leading-tight text-fg-subtle lg:flex">
          <span>{t('transport.sampleRateValue', { value: tab.render.sampleRate })}</span>
          <span>{tab.render.channels === 1 ? t('tracks.mono') : t('tracks.stereo')}</span>
        </div>
      )}
    </footer>
  );
}
