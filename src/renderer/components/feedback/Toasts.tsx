import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAppStore, type Toast } from '../../store';
import { cn } from '../ui/cn';

export const TOAST_TIMEOUT_MS = 6000;

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismiss = useAppStore((s) => s.dismissToast);
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), TOAST_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [toast.id, dismiss]);
  const title = toast.kind === 'error' ? t(`errors.${toast.code ?? 'ERR_UNKNOWN'}`) : t(toast.messageKey ?? 'errors.ERR_UNKNOWN');
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.16 }}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex w-96 items-start gap-2.5 rounded-lg border bg-surface p-3 shadow-[var(--shadow-pop)]',
        toast.kind === 'error' ? 'border-danger/50' : 'border-border',
      )}
    >
      {toast.kind === 'error' ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      ) : (
        <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-fg">{title}</p>
        {toast.detail && <p className="mt-0.5 break-words text-[11px] text-fg-subtle">{toast.detail}</p>}
      </div>
      <button
        type="button"
        aria-label={t('app.dismiss')}
        onClick={() => dismiss(toast.id)}
        className="flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface-3 hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-16 right-4 z-50 flex flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
