import { describe, expect, it, vi } from 'vitest';
import { TITLE_BAR_THEME_EVENT } from '../main/themeChannel';
import { watchTheme, type ObserverFactory } from './themeSync';

function setup(initial: string | null) {
  let theme = initial;
  const root = { getAttribute: vi.fn((n: string) => (n === 'data-theme' ? theme : null)) };
  const ipc = { send: vi.fn() };
  let fire: () => void = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  const factory: ObserverFactory = (cb) => {
    fire = cb;
    return { observe, disconnect };
  };
  const stop = watchTheme(root, ipc, factory);
  return {
    ipc,
    observe,
    disconnect,
    stop,
    change(v: string | null) {
      theme = v;
      fire();
    },
    root,
  };
}

describe('watchTheme', () => {
  it('reports the current theme immediately and observes data-theme', () => {
    const s = setup('dark');
    expect(s.ipc.send).toHaveBeenCalledWith(TITLE_BAR_THEME_EVENT, 'dark');
    expect(s.observe).toHaveBeenCalledWith(s.root, { attributes: true, attributeFilter: ['data-theme'] });
  });

  it('reports changes once (deduplicated)', () => {
    const s = setup('dark');
    s.change('light');
    s.change('light');
    s.change('dark');
    expect(s.ipc.send.mock.calls.map((c) => c[1])).toEqual(['dark', 'light', 'dark']);
  });

  it('waits until the attribute exists', () => {
    const s = setup(null);
    expect(s.ipc.send).not.toHaveBeenCalled();
    s.change('light');
    expect(s.ipc.send).toHaveBeenCalledWith(TITLE_BAR_THEME_EVENT, 'light');
  });

  it('stop disconnects the observer', () => {
    const s = setup('dark');
    s.stop();
    expect(s.disconnect).toHaveBeenCalled();
  });
});
