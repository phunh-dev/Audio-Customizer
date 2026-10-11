/** Preload (sandboxed): exposes the AudioApi as `window.api`. */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { createApi } from './api';
import { watchTheme } from './themeSync';

contextBridge.exposeInMainWorld('api', createApi(ipcRenderer, webUtils));

// native title bar colours follow html[data-theme] (no renderer code needed)
window.addEventListener('DOMContentLoaded', () => {
  watchTheme<HTMLElement>(document.documentElement, ipcRenderer, (cb) => new MutationObserver(cb));
});
