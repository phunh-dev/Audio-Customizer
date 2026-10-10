import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { errorCodeOf, type RenderResult, type TransportState } from '@shared/api';
import { createDefaultProject, DEFAULT_EXPORT_OPTIONS } from '@shared/types';
import { createApi } from '../preload/api';
import { IPC } from './channels';
import { createMainApi, registerIpcHandlers, type HandlerDeps } from './handlers';
import type { NativeEngine } from './native';

const transport: TransportState = { state: 'stopped', position: 0, duration: 0, sessionId: null, loop: false };

const renderResult: RenderResult = {
  duration: 1,
  sampleRate: 44100,
  channels: 2,
  peaks: new Float32Array([-1, 1]),
  spectrogram: { width: 1, height: 1, data: new Uint8Array([7]), minFreq: 20, maxFreq: 22050, dbFloor: -90 },
  peakDb: -1,
  lufs: null,
  averageSpectrum: new Float32Array(64),
};

type MockEngine = { [K in keyof NativeEngine]: Mock<NativeEngine[K]> };

function mockEngine(): MockEngine {
  return {
    ping: vi.fn(() => 'pong'),
    loadSource: vi.fn(async (p: string) => ({ id: p, path: p, name: 'a.wav' }) as never),
    unloadSource: vi.fn(),
    sourcePeaks: vi.fn(async () => new Float32Array([0, 1])),
    render: vi.fn(async () => renderResult),
    estimateSize: vi.fn(async () => 4242),
    export: vi.fn(async () => 99),
    releaseSession: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    step: vi.fn(),
    setLoop: vi.fn(),
    transportState: vi.fn(() => transport),
    closeOutput: vi.fn(),
  } as never;
}

function setup(overrides: Partial<HandlerDeps> = {}) {
  const engine = mockEngine();
  const onTransportChange = vi.fn();
  const deps: HandlerDeps = {
    engine,
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    env: {},
    defaultDir: () => '/music',
    onTransportChange,
    ...overrides,
  };
  const api = createMainApi(deps);
  // Fake ipcMain/ipcRenderer pair, going through the real envelope code.
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const registered = registerIpcHandlers({ handle: (c, l) => handlers.set(c, l) }, api);
  const listeners = new Map<string, Set<(e: unknown, ...a: unknown[]) => void>>();
  const ipcRenderer = {
    invoke: async (channel: string, ...args: unknown[]) => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler ${channel}`);
      // emulate structured clone of arguments
      return h({}, ...structuredClone(args));
    },
    on: (c: string, l: (e: unknown, ...a: unknown[]) => void) => {
      if (!listeners.has(c)) listeners.set(c, new Set());
      listeners.get(c)!.add(l);
    },
    removeListener: (c: string, l: (e: unknown, ...a: unknown[]) => void) => listeners.get(c)?.delete(l),
  };
  const windowApi = createApi(ipcRenderer, { getPathForFile: () => '/dropped.wav' });
  return { engine, deps, api, windowApi, registered, onTransportChange };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ac-handlers-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('registerIpcHandlers', () => {
  it('registers every channel', () => {
    const { registered } = setup();
    expect(new Set(registered)).toEqual(new Set(Object.values(IPC)));
  });
});

describe('AudioApi through IPC', () => {
  it('loadSource / unloadSource / sourcePeaks', async () => {
    const { windowApi, engine } = setup();
    const info = await windowApi.loadSource('/a.wav');
    expect(info.id).toBe('/a.wav');
    await windowApi.unloadSource('/a.wav');
    expect(engine.unloadSource).toHaveBeenCalledWith('/a.wav');
    const peaks = await windowApi.sourcePeaks('/a.wav', 99.6);
    expect(peaks).toBeInstanceOf(Float32Array);
    expect(engine.sourcePeaks).toHaveBeenCalledWith('/a.wav', 100);
  });

  it('render passes JSON + sizes and notifies the transport', async () => {
    const { windowApi, engine, onTransportChange } = setup();
    const project = createDefaultProject();
    const r = await windowApi.render({
      sessionId: 's',
      project,
      preview: DEFAULT_EXPORT_OPTIONS,
      peaksBuckets: 800,
      spectrogramWidth: 400,
      spectrogramHeight: 0,
    });
    expect(r.peaks).toBeInstanceOf(Float32Array);
    expect(r.spectrogram.data).toBeInstanceOf(Uint8Array);
    const [sid, pj, prev, buckets, w, h] = engine.render.mock.calls[0]!;
    expect(sid).toBe('s');
    expect(JSON.parse(pj)).toEqual(project);
    expect(JSON.parse(prev!)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect([buckets, w, h]).toEqual([800, 400, 1]);
    expect(onTransportChange).toHaveBeenCalled();
    await windowApi.render({ sessionId: 's', project, preview: null, peaksBuckets: 1, spectrogramWidth: 1, spectrogramHeight: 1 });
    expect(engine.render.mock.calls[1]![2]).toBeNull();
  });

  it('estimateSize', async () => {
    const { windowApi, engine } = setup();
    expect(await windowApi.estimateSize('s', createDefaultProject(), DEFAULT_EXPORT_OPTIONS)).toBe(4242);
    expect(JSON.parse(engine.estimateSize.mock.calls[0]![2])).toEqual(DEFAULT_EXPORT_OPTIONS);
  });

  it('exportAudio: cancel writes nothing', async () => {
    const { windowApi, engine } = setup();
    const r = await windowApi.exportAudio('s', createDefaultProject(), DEFAULT_EXPORT_OPTIONS, 'name');
    expect(r).toEqual({ canceled: true });
    expect(engine.export).not.toHaveBeenCalled();
  });

  it('exportAudio: chosen path goes to engine.export', async () => {
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/out/x.wav' }));
    const { windowApi, engine } = setup({ showSaveDialog });
    const r = await windowApi.exportAudio('s', createDefaultProject(), DEFAULT_EXPORT_OPTIONS, 'x');
    expect(r).toEqual({ canceled: false, path: '/out/x.wav', bytes: 99 });
    expect(engine.export.mock.calls[0]![3]).toBe('/out/x.wav');
  });

  it('transport calls notify the pump', async () => {
    const { windowApi, engine, onTransportChange } = setup();
    await windowApi.play('s');
    await windowApi.seek(1.5);
    await windowApi.setLoop(true);
    await windowApi.pause();
    await windowApi.stop();
    await windowApi.releaseSession('s');
    expect(engine.play).toHaveBeenCalledWith('s');
    expect(engine.seek).toHaveBeenCalledWith(1.5);
    expect(engine.setLoop).toHaveBeenCalledWith(true);
    expect(engine.pause).toHaveBeenCalled();
    expect(engine.stop).toHaveBeenCalled();
    expect(engine.releaseSession).toHaveBeenCalledWith('s');
    expect(onTransportChange).toHaveBeenCalledTimes(6);
    expect(await windowApi.getTransport()).toEqual(transport);
  });

  it('engine errors reach the renderer with their code', async () => {
    const { windowApi, engine } = setup();
    engine.loadSource.mockRejectedValueOnce(new Error('ERR_DECODE_FAILED: corrupt'));
    const err = await windowApi.loadSource('/bad.wav').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('ERR_DECODE_FAILED: corrupt');
    expect(errorCodeOf(err)).toBe('ERR_DECODE_FAILED');
    engine.play.mockImplementationOnce(() => {
      throw new Error('ERR_NO_AUDIO_DEVICE: none');
    });
    await expect(windowApi.play('s')).rejects.toThrow(/^ERR_NO_AUDIO_DEVICE: none$/);
    engine.render.mockRejectedValueOnce(new Error('weird'));
    await expect(
      windowApi.render({ sessionId: 's', project: createDefaultProject(), preview: null, peaksBuckets: 1, spectrogramWidth: 1, spectrogramHeight: 1 }),
    ).rejects.toThrow(/^ERR_UNKNOWN: weird$/);
  });

  it('validates arguments with ERR_INVALID_PARAM', async () => {
    const { windowApi, engine } = setup();
    await expect(windowApi.loadSource('')).rejects.toThrow(/^ERR_INVALID_PARAM/);
    await expect(windowApi.seek(Number.NaN)).rejects.toThrow(/^ERR_INVALID_PARAM/);
    await expect(windowApi.play(undefined as never)).rejects.toThrow(/^ERR_INVALID_PARAM/);
    await expect(windowApi.render(null as never)).rejects.toThrow(/^ERR_INVALID_PARAM/);
    await expect(windowApi.expandPaths('x' as never)).rejects.toThrow(/^ERR_INVALID_PARAM/);
    await expect(windowApi.estimateSize('s', null as never, DEFAULT_EXPORT_OPTIONS)).rejects.toThrow(/^ERR_INVALID_PARAM/);
    expect(engine.loadSource).not.toHaveBeenCalled();
    expect(engine.seek).not.toHaveBeenCalled();
  });

  it('dialogs: cancel -> [], selection -> expanded supported files', async () => {
    writeFileSync(join(tmp, 'b.wav'), 'x');
    writeFileSync(join(tmp, 'a.OGG'), 'x');
    writeFileSync(join(tmp, 'c.txt'), 'x');
    const showOpenDialog = vi
      .fn()
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [join(tmp, 'b.wav'), join(tmp, 'c.txt')] })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [tmp] });
    const { windowApi } = setup({ showOpenDialog });
    expect(await windowApi.openFilesDialog()).toEqual([]);
    expect(await windowApi.openFilesDialog()).toEqual([resolve(tmp, 'b.wav')]);
    expect(showOpenDialog.mock.calls[0]![0].properties).toEqual(['openFile', 'multiSelections']);
    expect(await windowApi.openFolderDialog()).toEqual([]);
    expect(await windowApi.openFolderDialog()).toEqual([resolve(tmp, 'a.OGG'), resolve(tmp, 'b.wav')]);
    expect(showOpenDialog.mock.calls[2]![0].properties).toContain('openDirectory');
  });

  it('expandPaths through IPC', async () => {
    writeFileSync(join(tmp, 'z.flac'), 'x');
    const { windowApi } = setup();
    expect(await windowApi.expandPaths([tmp, join(tmp, 'z.flac')])).toEqual([resolve(tmp, 'z.flac')]);
  });
});
