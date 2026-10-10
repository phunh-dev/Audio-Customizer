import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore, type AppStoreHook } from './appStore';
import { bindTransport, RENDER_DEBOUNCE_MS, startEngine, startRenderLoop, startSleepMonitor } from './engine';
import { createMockApi, type MockAudioApi } from '../testing/mockApi';
import { createDefaultExportOptions } from '@shared/types';

let api: MockAudioApi;
let store: AppStoreHook;
const cfg = { peaksBuckets: 16, spectrogramWidth: 8, spectrogramHeight: 4 };
const active = () => store.getState().tabs.find((t) => t.id === store.getState().activeTabId)!;

beforeEach(() => {
  api = createMockApi({ durationOf: () => 3 });
  store = createAppStore(() => api);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('render loop', () => {
  it('debounces project changes of the active tab into one render', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    vi.useFakeTimers();
    const stop = startRenderLoop(store, () => api, cfg);
    const id = active().project.tracks[0]!.id;
    for (let i = 0; i < 5; i++) {
      store.getState().updateTrack(id, { gainDb: i }, 'g');
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(api.callsTo('render')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS);
    expect(api.callsTo('render')).toHaveLength(1);
    const req = api.callsTo('render')[0]![0] as { sessionId: string; project: { tracks: { gainDb: number }[] }; peaksBuckets: number };
    expect(req.sessionId).toBe(active().id);
    expect(req.project.tracks[0]!.gainDb).toBe(4);
    expect(req.peaksBuckets).toBe(16);
    await vi.waitFor(() => expect(active().render).not.toBeNull());
    expect(active().render!.duration).toBe(3);
    expect(active().renderStatus).toBe('idle');
    stop();
  });

  it('re-renders when preview export settings change', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    vi.useFakeTimers();
    const stop = startRenderLoop(store, () => api, cfg, 10);
    await vi.advanceTimersByTimeAsync(20);
    expect(api.callsTo('render')).toHaveLength(1);
    store.getState().setPreviewExport({ ...createDefaultExportOptions(), sampleRate: 22050 });
    await vi.advanceTimersByTimeAsync(20);
    expect(api.callsTo('render')).toHaveLength(2);
    expect((api.callsTo('render')[1]![0] as { preview: { sampleRate: number } }).preview.sampleRate).toBe(22050);
    await vi.waitFor(() => expect(active().render?.sampleRate).toBe(22050));
    // unrelated state changes do not re-render
    store.getState().setPlayhead(1);
    store.getState().setSelection({ start: 0, end: 1 });
    await vi.advanceTimersByTimeAsync(50);
    expect(api.callsTo('render')).toHaveLength(2);
    stop();
  });

  it('clears the render of an empty project without calling the engine', async () => {
    vi.useFakeTimers();
    store.getState().setRenderResult(active().id, { duration: 1 } as never);
    store.getState().updateProject((p) => void (p.master.loop.enabled = true));
    const stop = startRenderLoop(store, () => api, cfg, 10);
    await vi.advanceTimersByTimeAsync(20);
    expect(api.callsTo('render')).toHaveLength(0);
    expect(active().render).toBeNull();
    stop();
  });

  it('only renders the active tab and skips re-render when switching back unchanged', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    const t1 = active().id;
    vi.useFakeTimers();
    const stop = startRenderLoop(store, () => api, cfg, 10);
    await vi.advanceTimersByTimeAsync(20);
    expect(api.callsTo('render')).toHaveLength(1);
    store.getState().newTab();
    await vi.advanceTimersByTimeAsync(20);
    // empty tab: no engine call
    expect(api.callsTo('render')).toHaveLength(1);
    await store.getState().setActiveTab(t1);
    await vi.advanceTimersByTimeAsync(20);
    expect(api.callsTo('render')).toHaveLength(1);
    stop();
  });

  it('does not render sleeping tabs and re-renders after wake', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    const t1 = active().id;
    vi.useFakeTimers();
    const stop = startRenderLoop(store, () => api, cfg, 10);
    await vi.advanceTimersByTimeAsync(20);
    store.getState().newTab();
    await store.getState().sleepTab(t1);
    await vi.advanceTimersByTimeAsync(20);
    expect(api.callsTo('render')).toHaveLength(1);
    await store.getState().setActiveTab(t1);
    await vi.advanceTimersByTimeAsync(20);
    expect(api.callsTo('render')).toHaveLength(2);
    await vi.waitFor(() => expect(active().render).not.toBeNull());
    stop();
  });

  it('reports render errors and ignores stale results', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    vi.useFakeTimers();
    let calls = 0;
    const resolvers: (() => void)[] = [];
    const realRender = api.render.bind(api);
    api.render = (req) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('ERR_INVALID_PARAM: tempo'));
      return new Promise((resolve) => resolvers.push(() => void realRender(req).then(resolve)));
    };
    const stop = startRenderLoop(store, () => api, cfg, 10);
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(active().renderStatus).toBe('error'));
    expect(store.getState().toasts[0]!.code).toBe('ERR_INVALID_PARAM');
    const id = active().project.tracks[0]!.id;
    store.getState().updateTrack(id, { gainDb: 1 });
    await vi.advanceTimersByTimeAsync(20);
    store.getState().updateTrack(id, { gainDb: 2 });
    await vi.advanceTimersByTimeAsync(20);
    expect(resolvers).toHaveLength(2);
    resolvers[0]!(); // stale
    await vi.advanceTimersByTimeAsync(1);
    expect(active().render).toBeNull();
    resolvers[1]!();
    await vi.waitFor(() => expect(active().render).not.toBeNull());
    stop();
  });

  it('stop() cancels pending renders', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    vi.useFakeTimers();
    const stop = startRenderLoop(store, () => api, cfg, 10);
    stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(api.callsTo('render')).toHaveLength(0);
  });
});

describe('sleep monitor & transport binding', () => {
  it('checks for sleeping tabs periodically', async () => {
    vi.useFakeTimers({ now: 0 });
    const t1 = store.getState().tabs[0]!.id;
    store.getState().newTab();
    const stop = startSleepMonitor(store, 1000);
    vi.setSystemTime(6 * 60_000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().tabs.find((t) => t.id === t1)!.sleeping).toBe(true);
    stop();
  });

  it('mirrors transport pushes and unsubscribes', async () => {
    const off = bindTransport(store, () => api);
    expect(api.listenerCount()).toBe(1);
    await vi.waitFor(() => expect(api.callsTo('getTransport')).toHaveLength(1));
    api.emitTransport({ state: 'playing', position: 1.5, sessionId: active().id });
    expect(store.getState().transport.state).toBe('playing');
    expect(active().playhead).toBe(1.5);
    off();
    expect(api.listenerCount()).toBe(0);
  });

  it('startEngine wires everything and stops cleanly', () => {
    const stop = startEngine(store, () => api, cfg);
    expect(api.listenerCount()).toBe(1);
    stop();
    expect(api.listenerCount()).toBe(0);
  });
});
