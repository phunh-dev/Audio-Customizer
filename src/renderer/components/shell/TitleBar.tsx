import { useTranslation } from 'react-i18next';
import logoUrl from '../../assets/logo.svg';
import { TabBar } from './TabBar';
import { cn } from '../ui/cn';

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
}

/**
 * Custom title bar (frameless window). The whole bar is a drag region; tabs and
 * buttons opt out with `no-drag`. Space is reserved for the native window
 * controls: traffic lights on the left (macOS, 78 px) or the overlay buttons on
 * the right (Windows/Linux, 140 px).
 *
 * The bar is dark in both themes: its colour (`--color-titlebar`) matches the
 * native window-controls overlay drawn by Electron, which does not follow the
 * page theme.
 */
export function TitleBar() {
  const { t } = useTranslation();
  const mac = isMac();
  return (
    <header
      data-testid="title-bar"
      className={cn(
        'drag-region flex h-9 shrink-0 items-end gap-3 bg-[var(--color-titlebar)]',
        mac ? 'pl-[78px] pr-3' : 'pl-3 pr-[140px]',
      )}
    >
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <img src={logoUrl} alt="" aria-hidden draggable={false} className="size-5 select-none" />
        <span className="text-[13px] font-semibold tracking-tight text-white/90">{t('app.name')}</span>
      </div>
      <div className="min-w-0 flex-1">
        <TabBar />
      </div>
    </header>
  );
}
