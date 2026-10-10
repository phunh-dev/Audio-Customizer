import { describe, expect, it, vi } from 'vitest';
import type { TransportState } from '@shared/api';
import { IPC, TRANSPORT_EVENT } from '../main/channels';
import { createApi, type IpcRendererLike } from './api';

function fakeIpc(response: unknown = { ok: true, value: 'v' }) {
  const listeners = new Map<string, Set<(e: unknown, ...a: any[]) => void>>();
  const ipc: IpcRendererLike & { emit(c: string, ...a: unknown[]): void } = {
    invoke: vi.fn(async () => response),
    on: vi.fn((c, l) => {
      if (!listeners.has(c)) listeners.set(c, new Set());
      listeners.get(c)!.add(l);
    }),
    removeListener: vi.fn((c, l) => listeners.get(c)?.delete(l)),
    emit: (c, ...a) => listeners.get(c)?.forEach((l) => l({}, ...a)),
  };
  return ipc;
}

describe('preload api', () => {
  it('maps each method to its channel with arguments', async () => {
    const ipc = fakeIpc();
    const api = createApi(ipc, { getPathForFile: () => '' });
    const cases: [() => Promise<unknown>, string, unknown[]][] = [
      [() => api.openFilesDialog(), IPC.openFilesDialog, []],
      [() => api.openFolderDialog(), IPC.openFolderDialog, []],
      [() => api.expandPaths(['/a']), IPC.expandPaths, [['/a']]],
      [() => api.loadSource('/a'), IPC.loadSource, ['/a']],
      [() => api.unloadSource('/a'), IPC.unloadSource, ['/a']],
      [() => api.sourcePeaks('/a', 5), IPC.sourcePeaks, ['/a', 5]],
      [() => api.render({ sessionId: 's' } as never), IPC.render, [{ sessionId: 's' }]],
      [() => api.estimateSize('s', {} as never, {} as never), IPC.estimateSize, ['s', {}, {}]],
      [() => api.exportAudio('s', {} as never, {} as never, 'n'), IPC.exportAudio, ['s', {}, {}, 'n']],
      [() => api.releaseSession('s'), IPC.releaseSession, ['s']],
      [() => api.play('s'), IPC.play, ['s']],
      [() => api.pause(), IPC.pause, []],
      [() => api.stop(), IPC.stop, []],
      [() => api.seek(2), IPC.seek, [2]],
      [() => api.setLoop(true), IPC.setLoop, [true]],
      [() => api.getTransport(), IPC.getTransport, []],
    ];
    for (const [call, channel, args] of cases) {
      await expect(call()).resolves.toBe('v');
      expect(ipc.invoke).toHaveBeenLastCalledWith(channel, ...args);
    }
  });

  it('rejects with the engine message', async () => {
    const api = createApi(fakeIpc({ ok: false, error: 'ERR_IO: nope' }), { getPathForFile: () => '' });
    await expect(api.loadSource('/a')).rejects.toThrow(/^ERR_IO: nope$/);
  });

  it('getPathForFile delegates to webUtils', () => {
    const getPathForFile = vi.fn(() => '/x/y.wav');
    const api = createApi(fakeIpc(), { getPathForFile });
    const file = {} as File;
    expect(api.getPathForFile(file)).toBe('/x/y.wav');
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });

  it('onTransport subscribes and unsubscribes', () => {
    const ipc = fakeIpc();
    const api = createApi(ipc, { getPathForFile: () => '' });
    const cb = vi.fn();
    const off = api.onTransport(cb);
    const s: TransportState = { state: 'playing', position: 1, duration: 2, sessionId: 's', loop: false };
    ipc.emit(TRANSPORT_EVENT, s);
    expect(cb).toHaveBeenCalledWith(s);
    off();
    ipc.emit(TRANSPORT_EVENT, s);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(ipc.removeListener).toHaveBeenCalled();
  });
});
