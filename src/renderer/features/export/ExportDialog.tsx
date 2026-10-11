import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from 'radix-ui';
import { AlertTriangle, CheckCircle2, Download, FolderOpen, Loader2, X } from 'lucide-react';
import { errorCodeOf, errorDetailOf, type ErrorCode } from '@shared/api';
import { getApi } from '@renderer/api';
import { selectActiveTab, useAppStore } from '@renderer/store';
import { Button, IconButton, cn, tw } from '@renderer/components/ui';
import { formatBytes } from '@renderer/lib/dsp/format';
import { ExportOptionsFields } from './ExportOptionsFields';
import { fileNameForFormat, suggestedFileName, validateExportOptions } from './exportOptions';
import { useEstimatedSize } from './useEstimatedSize';
import { useExportSettings } from './useExportSettings';

export interface ExportDialogProps {
  /** Controlled open state. When omitted the dialog manages it and renders its own Export button. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Custom trigger element (rendered in both modes when given). */
  trigger?: ReactNode;
}

export type ExportPhase =
  | { kind: 'idle'; canceled?: boolean }
  | { kind: 'exporting' }
  | { kind: 'success'; path: string; bytes: number }
  | { kind: 'error'; code: ErrorCode; detail: string };

/** Default base name: tab title, else first track name, else "export". */
function useBaseName(): string {
  return useAppStore((s) => {
    const tab = selectActiveTab(s);
    return tab.title ?? tab.project.tracks[0]?.name ?? 'export';
  });
}

/**
 * Export dialog. Never writes by itself: "Export" calls `api.exportAudio`,
 * whose main-process side asks for the destination (save dialog) first.
 */
export function ExportDialog({ open: openProp, onOpenChange: onOpenChangeProp, trigger }: ExportDialogProps) {
  const { t } = useTranslation();
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const onOpenChange = (o: boolean) => {
    if (!controlled) setOpenState(o);
    onOpenChangeProp?.(o);
  };
  const settings = useExportSettings();
  const { options, setOptions, format, sessionId } = settings;
  const project = useAppStore((s) => selectActiveTab(s).project);
  const baseName = useBaseName();
  const [fileName, setFileName] = useState(() => suggestedFileName(baseName, options.format));
  const [phase, setPhase] = useState<ExportPhase>({ kind: 'idle' });
  const mounted = useRef(true);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // fresh state + suggested name every time the dialog opens
  useEffect(() => {
    if (open) {
      setPhase({ kind: 'idle' });
      setFileName(suggestedFileName(baseName, options.format));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // keep the extension in sync with the format
  useEffect(() => {
    setFileName((n) => fileNameForFormat(n, options.format));
  }, [options.format]);

  const issues = useMemo(() => validateExportOptions(options, format.sampleRate, format.channels), [options, format]);
  const empty = project.tracks.length === 0;
  const estimate = useEstimatedSize(sessionId, project, options, open && !empty && issues.length === 0);
  const busy = phase.kind === 'exporting';

  const doExport = async () => {
    if (busy || empty || issues.length > 0) return;
    const name = fileNameForFormat(fileName, options.format);
    setFileName(name);
    setOptions(options);
    setPhase({ kind: 'exporting' });
    try {
      const res = await getApi().exportAudio(sessionId, project, options, name);
      if (!mounted.current) return;
      if (res.canceled || !res.path) setPhase({ kind: 'idle', canceled: true });
      else setPhase({ kind: 'success', path: res.path, bytes: res.bytes ?? 0 });
    } catch (err) {
      if (!mounted.current) return;
      setPhase({ kind: 'error', code: errorCodeOf(err), detail: errorDetailOf(err) });
    }
  };

  const close = (o: boolean) => {
    if (!o && busy) return; // cannot close while writing
    onOpenChange(o);
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      {trigger ? (
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      ) : !controlled ? (
        <Dialog.Trigger asChild>
          <Button variant="primary" size="sm" icon={<Download size={14} aria-hidden />}>
            {t('export.actions.open')}
          </Button>
        </Dialog.Trigger>
      ) : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border shadow-2xl',
            tw.surface,
            tw.border,
            tw.fg,
          )}
          onOpenAutoFocus={(e) => {
            // focus the primary action rather than the close (X) button, whose
            // tooltip would pop up and swallow the first Escape
            e.preventDefault();
            exportButtonRef.current?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
        >
          <header className={cn('flex items-center gap-2 border-b px-4 py-3', tw.border)}>
            <Download size={16} className={tw.accentText} aria-hidden />
            <Dialog.Title className="flex-1 text-sm font-semibold">{t('export.title')}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t('export.actions.close')} icon={<X size={14} aria-hidden />} disabled={busy} />
            </Dialog.Close>
          </header>

          {phase.kind === 'success' ? (
            <div className="flex flex-col items-center gap-3 px-6 py-8 text-center" role="status">
              <CheckCircle2 size={36} className={tw.successText} aria-hidden />
              <p className="text-sm font-semibold">{t('export.status.success')}</p>
              <p className={cn('text-xs', tw.fgMuted)}>{t('export.status.savedTo')}</p>
              <code data-testid="export-path" className={cn('max-w-full break-all rounded px-2 py-1 text-xs', tw.surface2, tw.mono)}>
                {phase.path}
              </code>
              <p className={cn('text-xs', tw.fgMuted)}>{t('export.status.bytes', { size: formatBytes(phase.bytes), bytes: phase.bytes })}</p>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={() => setPhase({ kind: 'idle' })}>
                  {t('export.actions.exportAgain')}
                </Button>
                <Button variant="primary" onClick={() => onOpenChange(false)}>
                  {t('export.actions.done')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
                <ExportOptionsFields options={options} onChange={setOptions} format={format} />

                <label className="flex flex-col gap-1">
                  <span className={cn('text-[11px] font-medium', tw.fgMuted)}>{t('export.fields.fileName')}</span>
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    onBlur={() => setFileName((n) => fileNameForFormat(n, options.format))}
                    className={cn('h-8 rounded-md border px-2 text-xs', tw.surface2, tw.border, tw.fg, tw.focus)}
                  />
                  <span className={cn('text-[11px]', tw.fgSubtle)}>{t('export.hints.fileName')}</span>
                </label>

                {issues.length > 0 ? (
                  <ul role="alert" className={cn('flex flex-col gap-1 rounded-md border px-3 py-2 text-xs', tw.border, tw.warningText)}>
                    {issues.map((i) => (
                      <li key={`${i.field}-${i.code}`} className="flex items-center gap-1.5">
                        <AlertTriangle size={12} aria-hidden />
                        {t(`export.validation.${i.code}`, i.params ?? {})}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {empty ? <p className={cn('text-xs', tw.warningText)}>{t('export.emptyProject')}</p> : null}

                <div className={cn('flex items-center justify-between rounded-md px-3 py-2 text-xs', tw.surface2)}>
                  <span className={tw.fgMuted}>{t('export.estimate.label')}</span>
                  <span data-testid="export-estimate" className={cn(tw.mono, 'font-medium')}>
                    {estimate.bytes !== null
                      ? formatBytes(estimate.bytes)
                      : estimate.loading
                        ? t('export.estimate.loading')
                        : t('export.estimate.unavailable')}
                  </span>
                </div>

                {phase.kind === 'error' ? (
                  <div role="alert" className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-xs', tw.border, tw.dangerText)}>
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-semibold">{t('export.status.error')}</span>
                      <span>{t(`errors.${phase.code}`, { defaultValue: t('export.status.unknownError') })}</span>
                      {phase.detail ? <span className={cn('break-all', tw.fgSubtle)}>{phase.detail}</span> : null}
                    </div>
                  </div>
                ) : null}
                {phase.kind === 'idle' && phase.canceled ? (
                  <p role="status" className={cn('text-xs', tw.fgMuted)}>
                    {t('export.status.canceled')}
                  </p>
                ) : null}
                {busy ? (
                  <div role="status" className="flex flex-col gap-1.5">
                    <span className={cn('flex items-center gap-2 text-xs', tw.fgMuted)}>
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                      {t('export.status.exporting')}
                    </span>
                    <div className={cn('h-1 overflow-hidden rounded-full', tw.surface3)} role="progressbar" aria-label={t('export.status.exporting')}>
                      <div className={cn('h-full w-1/3 animate-pulse rounded-full', tw.accentBg)} />
                    </div>
                  </div>
                ) : null}
              </div>

              <footer className={cn('flex items-center gap-2 border-t px-4 py-3', tw.border)}>
                <span className={cn('flex flex-1 items-center gap-1.5 text-[11px]', tw.fgSubtle)}>
                  <FolderOpen size={12} aria-hidden />
                  {t('export.hints.askLocation')}
                </span>
                <Button variant="ghost" size="md" onClick={() => onOpenChange(false)} disabled={busy}>
                  {t('export.actions.cancel')}
                </Button>
                <Button
                  ref={exportButtonRef}
                  data-testid="export-confirm"
                  variant="primary"
                  size="md"
                  icon={busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
                  onClick={() => void doExport()}
                  disabled={busy || empty || issues.length > 0}
                >
                  {phase.kind === 'error' ? t('export.actions.tryAgain') : t('export.actions.export')}
                </Button>
              </footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ExportDialog;
