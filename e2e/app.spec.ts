import { join } from 'node:path';
import { expect, launchApp, sessionTabs, test } from './fixtures';

test.describe('app shell', () => {
  test('launches with the main window, custom title bar and native engine', async ({ app, page }) => {
    expect(await page.title()).toBe('Audio Customizer');
    // custom title bar: app name + session tabs + new-tab button
    await expect(page.locator('header').getByText('Audio Customizer', { exact: true })).toBeVisible();
    await expect(sessionTabs(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'New tab' })).toBeVisible();
    await expect(page.getByTestId('drop-zone')).toBeVisible();

    const info = await app.evaluate(({ BrowserWindow, app: a }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return { visible: w.isVisible(), title: w.getTitle(), userData: a.getPath('userData') };
    });
    expect(info.visible).toBe(true);
    expect(info.title).toBe('Audio Customizer');

    // dev build: <root>/native + <root>/build/icons; packaged: <resources>/native + <resources>/icons
    const res = await app.evaluate(({ app: a }) => {
      const fs = process.mainModule!.require('node:fs') as typeof import('node:fs');
      const path = process.mainModule!.require('node:path') as typeof import('node:path');
      const base = a.isPackaged ? process.resourcesPath : a.getAppPath();
      const icon = a.isPackaged ? path.join(base, 'icons', '256x256.png') : path.join(base, 'build', 'icons', '256x256.png');
      return {
        packaged: a.isPackaged,
        addonFile: fs.existsSync(path.join(base, 'native', 'audio_napi.node')),
        iconFile: fs.existsSync(icon),
      };
    });
    expect(res.packaged).toBe(!!process.env['AUDIO_CUSTOMIZER_E2E_EXECUTABLE']);
    expect(res.addonFile).toBe(true);
    expect(res.iconFile).toBe(true);

    // preload bridge -> main -> native engine round trip
    const t = await page.evaluate(() => (window as unknown as { api: { getTransport(): Promise<{ state: string }> } }).api.getTransport());
    expect(t.state).toBe('stopped');
    // the engine was loaded from <base>/native (never from inside app.asar)
    const loaded = await app.evaluate(() => {
      const Module = process.mainModule!.require('node:module') as { _cache: Record<string, unknown> };
      return Object.keys(Module._cache).filter((k) => k.endsWith('.node'));
    });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).not.toContain('app.asar');
    expect(loaded[0]!.split('\\').join('/')).toMatch(/\/native\/audio_napi\.node$/);
  });

  test('isolates user data per test run', async ({ app, tmp }) => {
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
    expect(userData.toLowerCase()).toBe(join(tmp, 'user-data').toLowerCase());
  });

  test('title bar overlay follows the theme', async ({ app, page }) => {
    const themeSource = () => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
    await expect.poll(themeSource).toBe('dark');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(themeSource).toBe('light');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect.poll(themeSource).toBe('dark');
  });

  test('language switch EN <-> VI changes visible text and persists (with theme)', async ({ page, tmp, app }) => {
    await expect(page.getByRole('button', { name: 'Open files', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('radio', { name: 'VI' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    await expect(page.getByRole('button', { name: 'Open files', exact: true })).toHaveCount(0);
    const viText = await page.getByRole('toolbar').or(page.locator('body')).first().innerText();
    expect(viText).not.toContain('Open files');
    expect(viText).toMatch(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i);

    // persisted across restarts
    await app.close();
    const relaunched = await launchApp(join(tmp, 'user-data'));
    try {
      await expect(relaunched.page.locator('html')).toHaveAttribute('lang', 'vi');
      await expect(relaunched.page.locator('html')).toHaveAttribute('data-theme', 'light');
      await relaunched.page.getByRole('radio', { name: 'EN' }).click();
      await expect(relaunched.page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(relaunched.page.getByRole('button', { name: 'Open files', exact: true }).first()).toBeVisible();
    } finally {
      await relaunched.app.close();
    }
  });
});
