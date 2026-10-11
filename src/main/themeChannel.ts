/**
 * preload -> main (ipcRenderer.send): the renderer theme changed. Payload: 'dark' | 'light'.
 * Kept dependency-free: the sandboxed preload imports it (no node built-ins allowed there).
 */
export const TITLE_BAR_THEME_EVENT = 'window:titleBarTheme';
