/**
 * Shared E2E fixtures: launches the real Electron app (out/main/index.js, or a
 * packaged binary via AUDIO_CUSTOMIZER_E2E_EXECUTABLE) with an isolated user
 * data dir, plus helpers to drive it. Native dialogs are stubbed in the main
 * process (`dialog.showOpenDialog` / `showSaveDialog`), everything else goes
 * through the real UI -> preload -> IPC -> Rust engine path.
 */
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(__dirname, '..');
export const FIXTURES = join(ROOT, 'tests', 'fixtures');
export const FIXTURE_FILES = ['tone.wav', 'tone.aiff', 'tone.aif', 'tone.flac', 'tone.mp3', 'tone.ogg'] as const;
export const fixture = (name: string): string => join(FIXTURES, name);

export interface SourceInfo {
  id: string;
  format: string;
  sampleRate: number;
  channels: number;
  frames: number;
  duration: number;
  bitDepth: number | null;
  fileSize: number;
}

interface NativeEngine {
  loadSource(path: string): Promise<SourceInfo>;
  unloadSource(id: string): void;
}

let engine: NativeEngine | null = null;
/** The native addon loaded in the test runner (Node-API: same binary the app uses). */
export function nativeEngine(): NativeEngine {
  engine ??= createRequire(__filename)(join(ROOT, 'native', 'audio_napi.node')) as NativeEngine;
  return engine;
}

/** Decode a file with the engine (in the test process) and return its info. */
export async function decode(path: string): Promise<SourceInfo> {
  const e = nativeEngine();
  const info = await e.loadSource(path);
  e.unloadSource(info.id);
  return info;
}

/** 16-bit PCM WAV, one sine per channel (for tests that need longer audio than the fixtures). */
export function writeToneWav(path: string, seconds: number, sampleRate = 44100, freqs: number[] = [440, 660]): string {
  const n = Math.round(seconds * sampleRate);
  const ch = freqs.length;
  const data = n * ch * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const f of freqs) {
      buf.writeInt16LE(Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * f * i) / sampleRate)), o);
      o += 2;
    }
  }
  writeFileSync(path, buf);
  return path;
}

export async function launchApp(
  userDataDir: string,
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env['AUDIO_CUSTOMIZER_E2E_EXECUTABLE'];
  const args = [`--user-data-dir=${userDataDir}`];
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL') childEnv[k] = v;
  }
  Object.assign(childEnv, env);
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    // `electron .` (package.json main = out/main/index.js) so app.getAppPath() is the repo root,
    // where the dev build looks for native/audio_napi.node
    args: executablePath ? args : [ROOT, ...args],
    cwd: ROOT,
    env: childEnv,
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(sessionTabList(page)).toBeVisible();
  return { app, page };
}

/** Make the native "open" dialog return `paths` (or cancel when null). Main-process stub, real IPC. */
export async function stubOpenDialog(app: ElectronApplication, paths: string[] | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () =>
      p ? { canceled: false, filePaths: p } : { canceled: true, filePaths: [] }) as unknown as typeof dialog.showOpenDialog;
  }, paths);
}

/** Make the native "save" dialog return `path` (or cancel when null) and count its calls. */
export async function stubSaveDialog(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    const g = globalThis as { __saveDialogCalls?: number };
    g.__saveDialogCalls = 0;
    dialog.showSaveDialog = (async () => {
      g.__saveDialogCalls = (g.__saveDialogCalls ?? 0) + 1;
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: '' };
    }) as unknown as typeof dialog.showSaveDialog;
  }, path);
}

export async function saveDialogCalls(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as { __saveDialogCalls?: number }).__saveDialogCalls ?? 0);
}

/** Set / clear AUDIO_CUSTOMIZER_E2E_SAVE_PATH in the running main process (read on every export). */
export async function setSavePathEnv(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate((_e, p) => {
    if (p) process.env['AUDIO_CUSTOMIZER_E2E_SAVE_PATH'] = p;
    else delete process.env['AUDIO_CUSTOMIZER_E2E_SAVE_PATH'];
  }, path);
}

export const trackItems = (page: Page) => page.getByTestId('track-item');
/** Session tab strip in the title bar (the effects panel has its own tablist). */
export const sessionTabList = (page: Page) => page.locator('header [role="tablist"]').first();
export const sessionTabs = (page: Page) => page.locator('header [role="tab"]');

/** Import files through the toolbar "Open files" button (stubbed native dialog). */
export async function importFiles(app: ElectronApplication, page: Page, paths: string[]): Promise<void> {
  const before = await trackItems(page).count();
  await stubOpenDialog(app, paths);
  await page.getByRole('button', { name: 'Open files', exact: true }).first().click();
  await expect(trackItems(page)).toHaveCount(before + paths.length, { timeout: 20_000 });
}

/** Id of the active session tab. */
export async function activeTabId(page: Page): Promise<string> {
  const id = await sessionTabs(page).and(page.locator('[aria-selected="true"]')).getAttribute('data-testid');
  expect(id).toMatch(/^tab-/);
  return id!.slice('tab-'.length);
}

export const playButton = (page: Page) => page.getByRole('button', { name: /^(Play|Pause) \(/ });

/** Wait until the active tab has a rendered result (master view + playable transport). */
export async function waitForRender(page: Page): Promise<void> {
  await expect(page.getByTestId('master-view')).toBeVisible({ timeout: 20_000 });
  await expect(playButton(page)).toBeEnabled({ timeout: 20_000 });
}

export interface TransportState {
  state: 'playing' | 'paused' | 'stopped';
  position: number;
  duration: number;
  sessionId: string | null;
  loop: boolean;
}

export async function transport(page: Page): Promise<TransportState> {
  return page.evaluate(() => (window as unknown as { api: { getTransport(): Promise<TransportState> } }).api.getTransport());
}

/** Current playhead (seconds) from the timeline ruler (aria-valuenow). */
export async function playhead(page: Page): Promise<number> {
  return Number(await page.getByTestId('ruler').getAttribute('aria-valuenow'));
}

type Fixtures = { tmp: string; app: ElectronApplication; page: Page };

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  tmp: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-e2e-'));
    await use(dir);
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // files may still be locked on Windows right after the app exits
    }
  },
  app: async ({ tmp }, use) => {
    const { app } = await launchApp(join(tmp, 'user-data'));
    await use(app);
    await app.close().catch(() => undefined);
  },
  page: async ({ app }, use) => {
    await use(await app.firstWindow());
  },
});

export { expect };
