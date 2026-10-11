import { _electron } from '@playwright/test';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
export const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '..');
export const fx = (n) => join(here, 'fixtures', n);
export const allFixtures = () => readdirSync(join(here, 'fixtures')).map(fx);
export const SHOTS = process.env.SHOTS || join(here, 'shots');
mkdirSync(SHOTS, { recursive: true });

export async function launch({ width = 1280, height = 800, theme = 'dark', language = 'en' } = {}) {
  const ud = join(tmpdir(), 'ac-visual-' + Date.now());
  const app = await _electron.launch({ args: [root, `--user-data-dir=${ud}`], cwd: root, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')) });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  if (theme === 'light') await page.getByRole('button', { name: /light theme|giao diện sáng/i }).click();
  if (language === 'vi') await page.getByRole('radio', { name: /^VI|Vietnamese|Tiếng Việt/i }).or(page.getByRole('button', { name: /^VI$/ })).first().click();
  await setSize(app, width, height);
  await page.waitForTimeout(400);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { app, page };
}
export async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); }, [w, h]);
}
export async function stubOpen(app, paths) {
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, paths);
}
export async function importFiles(app, page, paths) {
  await stubOpen(app, paths);
  await page.getByRole('button', { name: /Open files|Mở tệp/i }).first().click();
  await page.waitForTimeout(1500);
}
export async function shot(page, name) {
  const p = join(SHOTS, name + '.png');
  await page.screenshot({ path: p });
  console.log('shot', p);
  return p;
}
