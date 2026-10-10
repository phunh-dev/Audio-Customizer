/**
 * Electron main process: window, native engine, IPC (AudioApi), transport push.
 * Logic lives in small pure modules (handlers, exportFlow, expandPaths,
 * transportPump, native, windowOptions); this file only wires Electron.
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { TRANSPORT_EVENT } from './channels';
import { createMainApi, registerIpcHandlers } from './handlers';
import { loadAddon, resolveAddonPath, type NativeEngine } from './native';
import { createTransportPump, type TransportPump } from './transportPump';
import {
  applyTitleBarTheme,
  isAllowedNavigation,
  resolveIconPath,
  TITLE_BAR_THEME_EVENT,
  windowOptions,
} from './windowOptions';

const nodeRequire = createRequire(__filename);

let mainWindow: BrowserWindow | null = null;
let engine: NativeEngine | null = null;
let pump: TransportPump | null = null;

function getEngine(): NativeEngine {
  if (!engine) {
    const path = resolveAddonPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    });
    engine = loadAddon(path, nodeRequire);
  }
  return engine;
}

/** Engine proxy: loads the addon on first use so a load failure surfaces as an ERR_IO rejection. */
const lazyEngine = new Proxy({} as NativeEngine, {
  get(_t, prop: string) {
    const e = getEngine() as unknown as Record<string, unknown>;
    const v = e[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(e) : v;
  },
});

/** App icon file if present (custom icon instead of Electron's in dev and on Linux). */
function iconPath(): string | undefined {
  const p = resolveIconPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() });
  return existsSync(p) ? p : undefined;
}

function createWindow(): void {
  const icon = iconPath();
  if (icon && process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon);
  const win = new BrowserWindow(windowOptions(process.platform, join(__dirname, '../preload/index.js'), icon));
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, devUrl)) event.preventDefault();
  });

  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

function setupIpc(): void {
  pump = createTransportPump({
    getState: () => lazyEngine.transportState(),
    send: (state) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(TRANSPORT_EVENT, state);
      }
    },
  });
  const api = createMainApi({
    engine: lazyEngine,
    showOpenDialog: (opts) =>
      mainWindow
        ? dialog.showOpenDialog(mainWindow, opts as Electron.OpenDialogOptions)
        : dialog.showOpenDialog(opts as Electron.OpenDialogOptions),
    showSaveDialog: (opts) =>
      mainWindow
        ? dialog.showSaveDialog(mainWindow, opts as Electron.SaveDialogOptions)
        : dialog.showSaveDialog(opts as Electron.SaveDialogOptions),
    env: process.env,
    defaultDir: () => {
      try {
        return app.getPath('music');
      } catch {
        return app.getPath('home');
      }
    },
    onTransportChange: () => pump?.notify(),
  });
  registerIpcHandlers(ipcMain, api);
  ipcMain.on(TITLE_BAR_THEME_EVENT, (event, theme: unknown) => {
    applyTitleBarTheme(BrowserWindow.fromWebContents(event.sender), process.platform, theme, nativeTheme);
  });
}

void app.whenReady().then(() => {
  setupIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  pump?.dispose();
  if (engine) {
    try {
      engine.stop();
      engine.closeOutput();
    } catch {
      // shutting down anyway
    }
  }
});
