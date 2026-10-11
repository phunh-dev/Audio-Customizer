import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applyTitleBarTheme,
  isAllowedNavigation,
  parseTitleBarTheme,
  resolveIconPath,
  THEME_COLORS,
  TITLE_BAR_COLORS,
  TITLE_BAR_HEIGHT,
  titleBarOverlay,
  WINDOW_BACKGROUND,
  windowOptions,
} from './windowOptions';

describe('windowOptions', () => {
  it('is secure on every platform', () => {
    for (const p of ['win32', 'darwin', 'linux'] as const) {
      const o = windowOptions(p, '/preload.js');
      expect(o.webPreferences).toMatchObject({
        preload: '/preload.js',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      });
      expect(o.show).toBe(false);
    }
  });

  it('uses titleBarOverlay on Windows/Linux', () => {
    for (const p of ['win32', 'linux'] as const) {
      const o = windowOptions(p, '/p.js');
      expect(o.titleBarStyle).toBe('hidden');
      expect(o.titleBarOverlay).toMatchObject({ height: TITLE_BAR_HEIGHT });
      expect(o.trafficLightPosition).toBeUndefined();
    }
  });

  it('uses hiddenInset on macOS', () => {
    const o = windowOptions('darwin', '/p.js');
    expect(o.titleBarStyle).toBe('hiddenInset');
    expect(o.titleBarOverlay).toBeUndefined();
    expect(o.trafficLightPosition).toBeDefined();
  });
});

describe('isAllowedNavigation', () => {
  it('allows app content only', () => {
    expect(isAllowedNavigation('file:///app/index.html', undefined)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/#x', 'http://localhost:5173')).toBe(true);
    expect(isAllowedNavigation('https://evil.example', 'http://localhost:5173')).toBe(false);
    expect(isAllowedNavigation('http://localhost:5173/', undefined)).toBe(false);
  });
});

describe('title bar theme', () => {
  function fakeWin(destroyed = false) {
    return {
      isDestroyed: vi.fn(() => destroyed),
      setBackgroundColor: vi.fn(),
      setTitleBarOverlay: vi.fn(),
    };
  }

  it('parses only dark / light', () => {
    expect(parseTitleBarTheme('dark')).toBe('dark');
    expect(parseTitleBarTheme('light')).toBe('light');
    for (const v of ['', 'Dark', null, undefined, 1, {}]) expect(parseTitleBarTheme(v)).toBeNull();
  });

  it('title bar colour is the same in main and in the renderer CSS', () => {
    const css = readFileSync(join(__dirname, '../renderer/styles/index.css'), 'utf8');
    const m = css.match(/--color-titlebar:\s*(#[0-9a-fA-F]{6})/);
    expect(m?.[1]?.toLowerCase()).toBe(TITLE_BAR_COLORS.background);
    // no theme overrides it: the bar is dark in both themes
    expect(css.match(/--color-titlebar:/g)).toHaveLength(1);
  });

  it('overlay always matches the (always dark) renderer title bar and keeps its height', () => {
    const d = titleBarOverlay('dark');
    const l = titleBarOverlay('light');
    expect(d).toEqual({ color: TITLE_BAR_COLORS.background, symbolColor: TITLE_BAR_COLORS.symbol, height: TITLE_BAR_HEIGHT });
    expect(l).toEqual(d);
    expect(windowOptions('win32', '/p.js').titleBarOverlay).toEqual(d);
    expect(windowOptions('win32', '/p.js').backgroundColor).toBe(WINDOW_BACKGROUND);
  });

  it('applies overlay, background and native theme on Windows/Linux', () => {
    for (const p of ['win32', 'linux'] as const) {
      const win = fakeWin();
      const nt = { themeSource: 'system' as const } as { themeSource: 'system' | 'light' | 'dark' };
      expect(applyTitleBarTheme(win, p, 'light', nt)).toBe('light');
      expect(win.setTitleBarOverlay).toHaveBeenCalledWith(titleBarOverlay('light'));
      expect(win.setBackgroundColor).toHaveBeenCalledWith(THEME_COLORS.light.background);
      expect(nt.themeSource).toBe('light');
    }
  });

  it('does not touch the overlay on macOS', () => {
    const win = fakeWin();
    const nt = { themeSource: 'system' } as { themeSource: 'system' | 'light' | 'dark' };
    expect(applyTitleBarTheme(win, 'darwin', 'dark', nt)).toBe('dark');
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(nt.themeSource).toBe('dark');
  });

  it('ignores invalid values, missing or destroyed windows', () => {
    const win = fakeWin();
    expect(applyTitleBarTheme(win, 'win32', 'purple')).toBeNull();
    expect(win.setBackgroundColor).not.toHaveBeenCalled();
    expect(applyTitleBarTheme(null, 'win32', 'dark')).toBeNull();
    const dead = fakeWin(true);
    expect(applyTitleBarTheme(dead, 'win32', 'dark')).toBeNull();
    expect(dead.setTitleBarOverlay).not.toHaveBeenCalled();
  });

  it('survives a window without overlay support', () => {
    const win = { isDestroyed: () => false, setBackgroundColor: vi.fn() };
    expect(applyTitleBarTheme(win, 'win32', 'dark')).toBe('dark');
    const throwing = { ...fakeWin(), setTitleBarOverlay: vi.fn(() => { throw new Error('no overlay'); }) };
    expect(applyTitleBarTheme(throwing, 'linux', 'dark')).toBe('dark');
  });
});

describe('window icon', () => {
  it('resolves the dev and packaged icon paths', () => {
    expect(resolveIconPath({ isPackaged: false, resourcesPath: '/res', appPath: '/repo' })).toBe(
      join('/repo', 'build', 'icons', '256x256.png'),
    );
    expect(resolveIconPath({ isPackaged: true, resourcesPath: '/res', appPath: '/repo/app.asar' })).toBe(
      join('/res', 'icons', '256x256.png'),
    );
  });

  it('sets the window icon on Windows/Linux only when given', () => {
    expect(windowOptions('win32', '/p.js', '/i.png').icon).toBe('/i.png');
    expect(windowOptions('linux', '/p.js', '/i.png').icon).toBe('/i.png');
    expect(windowOptions('darwin', '/p.js', '/i.png').icon).toBeUndefined();
    expect(windowOptions('win32', '/p.js').icon).toBeUndefined();
  });
});
