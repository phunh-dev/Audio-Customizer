/**
 * Title bar theme sync without any renderer code: the preload shares the DOM
 * with the page, so it watches `html[data-theme]` (set by the renderer's
 * settings) and reports changes to main, which recolours the native window
 * controls (see src/main/windowOptions.ts `applyTitleBarTheme`).
 */
import { TITLE_BAR_THEME_EVENT } from '../main/themeChannel';

export interface ThemeElement {
  getAttribute(name: string): string | null;
}

export type ObserverFactory<E extends ThemeElement = ThemeElement> = (cb: () => void) => {
  observe(target: E, options: { attributes: boolean; attributeFilter: string[] }): void;
  disconnect(): void;
};

export interface IpcSendLike {
  send(channel: string, ...args: unknown[]): void;
}

/** Report `data-theme` now and on every change (deduplicated). Returns a stop function. */
export function watchTheme<E extends ThemeElement>(
  root: E,
  ipc: IpcSendLike,
  createObserver: ObserverFactory<E>,
): () => void {
  let last: string | null = null;
  const report = (): void => {
    const theme = root.getAttribute('data-theme');
    if (!theme || theme === last) return;
    last = theme;
    ipc.send(TITLE_BAR_THEME_EVENT, theme);
  };
  const observer = createObserver(report);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  report();
  return () => observer.disconnect();
}
