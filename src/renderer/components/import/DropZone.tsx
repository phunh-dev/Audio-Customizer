import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus2, FolderOpen, UploadCloud } from 'lucide-react';
import { SUPPORTED_EXTENSIONS } from '@shared/types';
import { useAppStore } from '../../store';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';

function hasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

/**
 * Accept files / folders dropped anywhere on the window. Returns whether a
 * drag with files is currently over the window (to show the overlay).
 */
export function useWindowDrop(): boolean {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setActive(true);
    };
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) void useAppStore.getState().importFiles(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return active;
}

/** Full-window overlay shown while dragging files over the app. */
export function DropOverlay({ active }: { active: boolean }) {
  const { t } = useTranslation();
  if (!active) return null;
  return (
    <div
      data-testid="drop-overlay"
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/70 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-surface/80 px-16 py-12 text-fg shadow-[var(--shadow-pop)]">
        <UploadCloud className="size-10 text-accent" aria-hidden />
        <p className="text-base font-semibold">{t('import.dropNow')}</p>
      </div>
    </div>
  );
}

/** Empty-state drop zone with instructions and open buttons. */
export function DropZone() {
  const { t } = useTranslation();
  const importing = useAppStore((s) => s.importing);
  const [hover, setHover] = useState(false);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        data-testid="drop-zone"
        onDragEnter={() => setHover(true)}
        onDragLeave={() => setHover(false)}
        onDrop={() => setHover(false)}
        className={cn(
          'flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-10 py-12 text-center transition-colors',
          hover ? 'border-accent bg-accent-soft' : 'border-border-strong bg-surface/60',
        )}
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-cyan/20 via-accent/25 to-pink/20 text-accent ring-1 ring-accent/30">
          <UploadCloud className="size-7" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-fg">{t('import.title')}</h2>
          <p className="text-sm text-fg-muted">{t('import.instructions')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="primary"
            size="md"
            disabled={importing}
            icon={<FilePlus2 className="size-4" />}
            onClick={() => void useAppStore.getState().openFilesDialog()}
          >
            {t('app.toolbar.openFiles')}
          </Button>
          <Button
            variant="outline"
            size="md"
            disabled={importing}
            icon={<FolderOpen className="size-4" />}
            onClick={() => void useAppStore.getState().openFolderDialog()}
          >
            {t('app.toolbar.openFolder')}
          </Button>
        </div>
        <p className="text-xs text-fg-subtle">
          {t('import.supported', { formats: SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(' ') })}
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-left text-[11px] text-fg-subtle">
          <li>{t('import.tipDrag')}</li>
          <li>{t('import.tipSpace')}</li>
          <li>{t('import.tipZoom')}</li>
          <li>{t('import.tipUndo')}</li>
        </ul>
      </div>
    </div>
  );
}
