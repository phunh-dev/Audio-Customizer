import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadAddon, resolveAddonPath } from './native';

describe('resolveAddonPath', () => {
  it('dev uses <root>/native', () => {
    expect(resolveAddonPath({ isPackaged: false, resourcesPath: '/res', appPath: '/proj' })).toBe(
      join('/proj', 'native', 'audio_napi.node'),
    );
  });
  it('packaged uses resourcesPath/native', () => {
    expect(resolveAddonPath({ isPackaged: true, resourcesPath: '/res', appPath: '/proj/app.asar' })).toBe(
      join('/res', 'native', 'audio_napi.node'),
    );
  });
});

const fn = () => {};
const fullAddon = Object.fromEntries(
  [
    'ping',
    'loadSource',
    'unloadSource',
    'sourcePeaks',
    'render',
    'estimateSize',
    'export',
    'releaseSession',
    'play',
    'pause',
    'stop',
    'seek',
    'setLoop',
    'transportState',
    'step',
    'closeOutput',
  ].map((k) => [k, fn]),
);

describe('loadAddon', () => {
  it('returns the module when complete', () => {
    const req = vi.fn(() => fullAddon);
    expect(loadAddon('/x.node', req)).toBe(fullAddon);
    expect(req).toHaveBeenCalledWith('/x.node');
  });

  it('require failure -> ERR_IO', () => {
    expect(() =>
      loadAddon('/x.node', () => {
        throw new Error('not found');
      }),
    ).toThrow(/^ERR_IO: cannot load native engine \/x.node: not found/);
  });

  it('incomplete module -> ERR_IO listing missing functions', () => {
    expect(() => loadAddon('/x.node', () => ({ ping: fn }))).toThrow(/^ERR_IO: .*missing loadSource/);
    expect(() => loadAddon('/x.node', () => null)).toThrow(/^ERR_IO/);
  });
});
