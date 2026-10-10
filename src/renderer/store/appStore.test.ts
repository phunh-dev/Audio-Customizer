import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultExportOptions } from '@shared/types';
import { createAppStore, fileNameOf, loadSettings, SETTINGS_KEY, tabDuration, type AppStoreHook, type Tab } from './appStore';
import { createMockApi, type MockAudioApi } from '../testing/mockApi';

let api: MockAudioApi;
let store: AppStoreHook;

const active = (): Tab => {
  const s = store.getState();
  return s.tabs.find((t) => t.id === s.activeTabId)!;
};
const tracks = () => active().project.tracks;

/** durations: a.wav 10 s, b.wav 4 s, c.wav 6 s */
const DUR: Record<string, number> = { '/a.wav': 10, '/b.wav': 4, '/c.wav': 6 };

beforeEach(() => {
  api = createMockApi({ durationOf: (p) => DUR[p] ?? 2, failPaths: ['/broken.wav'] });
  store = createAppStore(() => api);
});

afterEach(() => {
  vi.useRealTimers();
});

async function addAll(): Promise<void> {
  await store.getState().addTracksFromPaths(['/a.wav', '/b.wav', '/c.wav']);
}

describe('import', () => {
  it('adds tracks from paths and loads sources + peaks', async () => {
    const n = await store.getState().addTracksFromPaths(['/a.wav', '/b.wav']);
    expect(n).toBe(2);
    expect(tracks().map((t) => t.name)).toEqual(['a.wav', 'b.wav']);
    expect(tracks().every((t) => t.offset === 0)).toBe(true);
    expect(store.getState().sources['/a.wav']!.duration).toBe(10);
    expect(store.getState().loadedSources['/a.wav']).toBe(true);
    expect(active().selectedTrackId).toBe(tracks()[0]!.id);
    expect(store.getState().importing).toBe(false);
    await vi.waitFor(() => expect(store.getState().sourcePeaks['/a.wav']).toBeInstanceOf(Float32Array));
    // one undo step for the whole import
    store.getState().undo();
    expect(tracks()).toHaveLength(0);
    expect(active().selectedTrackId).toBeNull();
  });

  it('reports failed files as error toasts and keeps the others', async () => {
    const n = await store.getState().addTracksFromPaths(['/broken.wav', '/a.wav', '/x.txt']);
    expect(n).toBe(1);
    const codes = store.getState().toasts.map((t) => t.code);
    expect(codes).toEqual(['ERR_DECODE_FAILED', 'ERR_UNSUPPORTED_FORMAT']);
    // the toast says which file failed
    expect(store.getState().toasts[0]!.detail.startsWith('broken.wav')).toBe(true);
    expect(store.getState().toasts[1]!.detail.startsWith('x.txt')).toBe(true);
    expect(await store.getState().addTracksFromPaths([])).toBe(0);
  });

  it('imports dropped files through getPathForFile + expandPaths', async () => {
    api.folderFiles['/music'] = ['/music/b.wav', '/music/a.wav'];
    const folder = new File([], 'music');
    Object.defineProperty(folder, 'path', { value: '/music' });
    const n = await store.getState().importFiles([folder, new File([], 'notes.txt')]);
    expect(n).toBe(2);
    expect(api.callsTo('expandPaths')[0]![0]).toEqual(['/music', 'notes.txt']);
    expect(tracks().map((t) => t.name)).toEqual(['a.wav', 'b.wav']);
  });

  it('shows an info toast when nothing supported was dropped', async () => {
    expect(await store.getState().importFiles([new File([], 'x.txt')])).toBe(0);
    expect(store.getState().toasts[0]).toMatchObject({ kind: 'info', messageKey: 'import.noSupportedFiles' });
    expect(await store.getState().importFiles([])).toBe(0);
  });

  it('handles import errors', async () => {
    api.expandPaths = () => Promise.reject(new Error('ERR_IO: denied'));
    expect(await store.getState().importFiles([new File([], 'a.wav')])).toBe(0);
    expect(store.getState().toasts[0]!.code).toBe('ERR_IO');
  });

  it('opens files and folders through dialogs', async () => {
    api.dialogFiles = ['/a.wav'];
    expect(await store.getState().openFilesDialog()).toBe(1);
    api.folderFiles['/f'] = ['/b.wav', '/c.wav'];
    expect(await store.getState().openFolderDialog()).toBe(2);
    expect(tracks()).toHaveLength(3);
    api.openFilesDialog = () => Promise.reject(new Error('ERR_IO: x'));
    api.openFolderDialog = () => Promise.reject(new Error('ERR_IO: y'));
    expect(await store.getState().openFilesDialog()).toBe(0);
    expect(await store.getState().openFolderDialog()).toBe(0);
    expect(store.getState().toasts).toHaveLength(2);
  });

  it('reports peak loading errors', async () => {
    api.sourcePeaks = () => Promise.reject(new Error('ERR_SOURCE_NOT_LOADED: x'));
    await store.getState().loadPeaks('/a.wav');
    expect(store.getState().toasts[0]!.code).toBe('ERR_SOURCE_NOT_LOADED');
  });
});

describe('project edits + undo/redo', () => {
  beforeEach(addAll);

  it('remove track (X) is undoable and restores the exact track', async () => {
    const before = tracks()[1]!;
    store.getState().selectTrack(before.id);
    store.getState().removeTrack(before.id);
    expect(tracks().map((t) => t.name)).toEqual(['a.wav', 'c.wav']);
    expect(active().selectedTrackId).toBeNull();
    store.getState().undo();
    expect(tracks()).toHaveLength(3);
    expect(tracks()[1]).toEqual(before);
    store.getState().redo();
    expect(tracks()).toHaveLength(2);
    // removing an unknown id is a no-op (no history entry)
    const len = active().history.past.length;
    store.getState().removeTrack('nope');
    expect(active().history.past.length).toBe(len);
  });

  it('updates track fields with clamping', () => {
    const id = tracks()[0]!.id;
    store.getState().updateTrack(id, { gainDb: -6, pan: 3, mute: true, offset: -2, name: 'x', solo: undefined });
    expect(tracks()[0]).toMatchObject({ gainDb: -6, pan: 1, mute: true, offset: 0, name: 'x', solo: false });
    store.getState().updateTrack(id, { clipStart: -1, fadeIn: { duration: 1, curve: 'sCurve' } });
    expect(tracks()[0]!.clipStart).toBe(0);
    expect(tracks()[0]!.fadeIn.curve).toBe('sCurve');
    store.getState().undo();
    store.getState().undo();
    expect(tracks()[0]!.gainDb).toBe(0);
    store.getState().updateTrack('nope', { gainDb: 3 });
  });

  it('coalesces a drag of the clip offset into one undo step', () => {
    const id = tracks()[0]!.id;
    const past = active().history.past.length;
    for (let i = 1; i <= 10; i++) store.getState().setTrackOffset(id, i * 0.1, 'drag:1');
    expect(tracks()[0]!.offset).toBeCloseTo(1);
    expect(active().history.past.length).toBe(past + 1);
    store.getState().sealHistory();
    store.getState().setTrackOffset(id, 2, 'drag:1');
    expect(active().history.past.length).toBe(past + 2);
    store.getState().undo();
    store.getState().undo();
    expect(tracks()[0]!.offset).toBe(0);
    store.getState().setTrackOffset(id, -5);
    expect(tracks()[0]!.offset).toBe(0);
  });

  it('a new action clears redo', () => {
    const id = tracks()[0]!.id;
    store.getState().updateTrack(id, { gainDb: 1 });
    store.getState().undo();
    expect(active().history.future).toHaveLength(1);
    store.getState().updateTrack(id, { gainDb: 2 });
    expect(active().history.future).toHaveLength(0);
    store.getState().redo(); // nothing to redo
    expect(tracks()[0]!.gainDb).toBe(2);
  });

  it('updates effect chains of master and tracks', () => {
    const id = tracks()[2]!.id;
    store.getState().updateEffects('master', (c) => void (c.volume.gainDb = 3));
    store.getState().updateEffects(id, (c) => void (c.eq.enabled = true));
    store.getState().updateEffects('missing', (c) => void (c.eq.enabled = true));
    expect(active().project.master.effects.volume.gainDb).toBe(3);
    expect(tracks()[2]!.effects.eq.enabled).toBe(true);
    for (let i = 0; i < 5; i++) store.getState().updateEffects(id, (c) => void (c.eq.bands[0]!.gainDb = i), 'eq0');
    const steps = active().history.past.length;
    store.getState().undo();
    expect(tracks()[2]!.effects.eq.bands[0]!.gainDb).toBe(0);
    expect(active().history.past.length).toBe(steps - 1);
  });

  it('updates master settings and arbitrary project recipes', () => {
    store.getState().updateMaster((m) => void (m.loop.enabled = true), 'loop');
    store.getState().updateProject((p) => void (p.master.trimSilence.enabled = true));
    expect(active().project.master.loop.enabled).toBe(true);
    expect(active().project.master.trimSilence.enabled).toBe(true);
    store.getState().undo();
    store.getState().undo();
    expect(active().project.master.loop.enabled).toBe(false);
  });

  it('reorders tracks', () => {
    const [a, b, c] = tracks();
    store.getState().reorderTrack(c!.id, 0);
    expect(tracks().map((t) => t.id)).toEqual([c!.id, a!.id, b!.id]);
    store.getState().reorderTrack(c!.id, 0);
    store.getState().reorderTrack('nope', 1);
    store.getState().undo();
    expect(tracks().map((t) => t.id)).toEqual([a!.id, b!.id, c!.id]);
  });

  it('trims the selected track to the selection', () => {
    const a = tracks()[0]!;
    store.getState().selectTrack(a.id);
    store.getState().trimToSelection(); // no selection: no-op
    store.getState().setSelection({ start: 6, end: 2 });
    expect(active().selection).toEqual({ start: 2, end: 6 });
    store.getState().trimToSelection();
    expect(tracks()[0]).toMatchObject({ offset: 2, clipStart: 2, clipEnd: 6 });
    expect(tracks()[1]!.clipEnd).toBeNull();
    expect(active().selection).toBeNull();
    store.getState().undo();
    expect(tracks()[0]).toMatchObject({ offset: 0, clipStart: 0, clipEnd: null });
  });

  it('trims all tracks when none is selected (removing tracks outside)', () => {
    store.getState().selectTrack(null);
    store.getState().setTrackOffset(tracks()[1]!.id, 20);
    store.getState().setSelection({ start: 1, end: 3 });
    store.getState().trimToSelection();
    expect(tracks()).toHaveLength(2);
    expect(tracks().every((t) => t.offset === 1)).toBe(true);
  });

  it('keeps a selected track outside the selection untouched', () => {
    const b = tracks()[1]!;
    store.getState().setTrackOffset(b.id, 20);
    store.getState().selectTrack(b.id);
    store.getState().setSelection({ start: 1, end: 3 });
    store.getState().trimToSelection();
    expect(tracks()).toHaveLength(3);
  });

  it('splits at the playhead (selected track or all crossing tracks)', () => {
    store.getState().setPlayhead(3);
    store.getState().selectTrack(tracks()[0]!.id);
    store.getState().splitAtPlayhead();
    expect(tracks()).toHaveLength(4);
    expect(tracks()[0]!.clipEnd).toBe(3);
    expect(tracks()[1]!.offset).toBe(3);
    store.getState().undo();
    store.getState().selectTrack(null);
    store.getState().splitAtPlayhead();
    expect(tracks()).toHaveLength(6);
  });

  it('ripple-deletes the selected region', () => {
    store.getState().setPlayhead(8);
    store.getState().setSelection({ start: 1, end: 3 });
    store.getState().deleteSelection();
    expect(active().selection).toBeNull();
    expect(active().playhead).toBe(6);
    // every track spans [1, 3] and is split in two
    expect(tracks().length).toBe(6);
    store.getState().deleteSelection(); // no selection: no-op
    store.getState().undo();
    expect(tracks()).toHaveLength(3);
  });

  it('deselects a track removed by ripple delete', () => {
    store.getState().setTrackOffset(tracks()[1]!.id, 20);
    store.getState().selectTrack(tracks()[1]!.id);
    store.getState().setSelection({ start: 19, end: 30 });
    store.getState().deleteSelection();
    expect(active().selectedTrackId).toBeNull();
  });

  it('arranges tracks sequentially with crossfade', () => {
    store.getState().arrangeSequential(0, 1);
    expect(tracks().map((t) => t.offset)).toEqual([0, 9, 12]);
    expect(tracks()[0]!.fadeOut).toEqual({ duration: 1, curve: 'equalPower' });
    store.getState().undo();
    expect(tracks().map((t) => t.offset)).toEqual([0, 0, 0]);
    store.getState().arrangeSequential(1, 0, 'linear');
    expect(tracks().map((t) => t.offset)).toEqual([0, 11, 16]);
  });

  it('undo clears selection of tracks that no longer exist', () => {
    const id = tracks()[2]!.id;
    store.getState().undo(); // undo import
    expect(tracks()).toHaveLength(0);
    store.getState().redo();
    store.getState().selectTrack(id);
    store.getState().undo();
    expect(active().selectedTrackId).toBeNull();
    store.getState().redo();
    expect(active().selectedTrackId).toBeNull();
  });

  it('caps history at 200 steps', () => {
    const id = tracks()[0]!.id;
    for (let i = 0; i < 230; i++) store.getState().updateTrack(id, { gainDb: (i % 50) - 25 + (i > 100 ? 0.5 : 0) });
    expect(active().history.past.length).toBeLessThanOrEqual(200);
  });
});

describe('view state', () => {
  it('sets selection, playhead, viewport and export settings without history', async () => {
    await addAll();
    const past = active().history.past.length;
    store.getState().setSelection({ start: 1, end: 1 });
    expect(active().selection).toBeNull();
    store.getState().setSelection({ start: -2, end: 3 });
    expect(active().selection).toEqual({ start: 0, end: 3 });
    store.getState().setSelection(null);
    store.getState().setPlayhead(-1);
    expect(active().playhead).toBe(0);
    store.getState().setViewport({ pxPerSec: 300, scroll: -5 });
    expect(active().pxPerSec).toBe(300);
    expect(active().scroll).toBe(0);
    store.getState().setViewport({ pxPerSec: 0 });
    expect(active().pxPerSec).toBe(300);
    const opts = { ...createDefaultExportOptions(), format: 'mp3' as const };
    store.getState().setPreviewExport(opts);
    expect(active().previewExport).toEqual(opts);
    expect(active().previewExport).not.toBe(opts);
    store.getState().setPreviewExport(null);
    expect(active().previewExport).toBeNull();
    store.getState().setExportOptions(opts);
    expect(active().exportOptions.format).toBe('mp3');
    expect(active().history.past.length).toBe(past);
  });

  it('stores render results and clamps the playhead', () => {
    const id = active().id;
    store.getState().setPlayhead(50);
    store.getState().setRenderStatus(id, 'rendering');
    expect(active().renderStatus).toBe('rendering');
    store.getState().setRenderStatus(id, 'error', 'boom');
    expect(active().renderError).toBe('boom');
    const result = { duration: 12 } as never;
    store.getState().setRenderResult(id, result);
    expect(active().render).toEqual({ duration: 12 });
    expect(active().renderStatus).toBe('idle');
    expect(active().playhead).toBe(12);
    expect(tabDuration(active(), {})).toBe(12);
  });
});

describe('tabs', () => {
  it('creates, renames, switches and closes tabs', async () => {
    const first = active().id;
    const second = store.getState().newTab();
    expect(store.getState().activeTabId).toBe(second);
    expect(active().number).toBe(2);
    store.getState().renameTab(second, '  Voice  ');
    expect(active().title).toBe('Voice');
    store.getState().renameTab(second, '   ');
    expect(active().title).toBeNull();
    store.getState().renameTab(second, null);
    await store.getState().setActiveTab(first);
    expect(store.getState().activeTabId).toBe(first);
    await store.getState().setActiveTab('missing');
    expect(store.getState().activeTabId).toBe(first);
    await store.getState().closeTab(first);
    expect(store.getState().tabs.map((t) => t.id)).toEqual([second]);
    expect(store.getState().activeTabId).toBe(second);
    expect(api.callsTo('releaseSession')).toEqual([[first]]);
    await store.getState().closeTab('missing');
    await store.getState().closeTab(second);
    expect(store.getState().tabs).toHaveLength(1);
    expect(store.getState().activeTabId).not.toBe(second);
  });

  it('keeps an independent history per tab', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    const t1 = active().id;
    store.getState().newTab();
    await store.getState().addTracksFromPaths(['/b.wav', '/c.wav']);
    store.getState().removeTrack(tracks()[0]!.id);
    expect(tracks()).toHaveLength(1);
    await store.getState().setActiveTab(t1);
    store.getState().undo(); // undoes tab 1's import only
    expect(tracks()).toHaveLength(0);
    const tab2 = store.getState().tabs[1]!;
    expect(tab2.project.tracks).toHaveLength(1);
    expect(tab2.history.past).toHaveLength(2);
  });

  it('unloads sources not used by remaining tabs when closing', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    const t1 = active().id;
    store.getState().newTab();
    await store.getState().addTracksFromPaths(['/a.wav', '/b.wav']);
    const t2 = active().id;
    await store.getState().closeTab(t2);
    expect(api.callsTo('unloadSource')).toEqual([['/b.wav']]);
    expect(store.getState().loadedSources['/a.wav']).toBe(true);
    expect(store.getState().activeTabId).toBe(t1);
  });

  it('stops playback of a closed tab', async () => {
    await store.getState().addTracksFromPaths(['/a.wav']);
    const id = active().id;
    store.getState().handleTransport({ state: 'playing', position: 1, duration: 10, sessionId: id, loop: false });
    await store.getState().closeTab(id);
    expect(api.callsTo('stop')).toHaveLength(1);
  });

  it('pauses playback when switching to another tab (only the active tab plays)', async () => {
    const t1 = active().id;
    store.getState().handleTransport({ state: 'playing', position: 1, duration: 10, sessionId: t1, loop: false });
    store.getState().newTab();
    await vi.waitFor(() => expect(api.callsTo('pause')).toHaveLength(1));
    store.getState().handleTransport({ state: 'playing', position: 1, duration: 10, sessionId: t1, loop: false });
    await store.getState().setActiveTab(t1);
    expect(api.callsTo('pause')).toHaveLength(1);
    const t3 = store.getState().newTab();
    store.getState().handleTransport({ state: 'playing', position: 1, duration: 10, sessionId: t3, loop: false });
    await store.getState().setActiveTab(t1);
    expect(api.callsTo('pause')).toHaveLength(3);
  });
});

describe('tab sleep / wake', () => {
  it('sleeps inactive tabs after the configured minutes and wakes them on activation', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await store.getState().addTracksFromPaths(['/a.wav', '/b.wav']);
    const t1 = active().id;
    store.getState().setRenderResult(t1, { duration: 10 } as never);
    store.getState().newTab();
    await store.getState().addTracksFromPaths(['/b.wav']);
    const t2 = active().id;

    vi.setSystemTime(1_000_000 + 4 * 60_000);
    expect(await store.getState().checkSleep()).toEqual([]);
    vi.setSystemTime(1_000_000 + 5 * 60_000 + 1);
    expect(await store.getState().checkSleep()).toEqual([t1]);

    const tab1 = store.getState().tabs.find((t) => t.id === t1)!;
    expect(tab1.sleeping).toBe(true);
    expect(tab1.render).toBeNull();
    expect(tab1.project.tracks).toHaveLength(2); // project + history kept
    expect(api.callsTo('releaseSession')).toEqual([[t1]]);
    // /a.wav is only used by the sleeping tab; /b.wav still used by tab 2
    expect(api.callsTo('unloadSource')).toEqual([['/a.wav']]);
    expect(store.getState().loadedSources['/a.wav']).toBeUndefined();
    expect(store.getState().loadedSources['/b.wav']).toBe(true);

    // the active tab never sleeps; sleeping tabs are not re-slept
    vi.setSystemTime(1_000_000 + 60 * 60_000);
    expect(await store.getState().checkSleep()).toEqual([]);

    const nonceBefore = tab1.renderNonce;
    await store.getState().setActiveTab(t1);
    const woke = store.getState().tabs.find((t) => t.id === t1)!;
    expect(woke.sleeping).toBe(false);
    expect(woke.loading).toBe(false);
    expect(woke.renderNonce).toBe(nonceBefore + 1);
    expect(api.callsTo('loadSource').slice(-1)).toEqual([['/a.wav']]);
    expect(store.getState().loadedSources['/a.wav']).toBe(true);
    expect(store.getState().activeTabId).toBe(t1);
    expect(t2).not.toBe(t1);
  });

  it('respects the sleepMinutes setting and reports reload errors', async () => {
    vi.useFakeTimers({ now: 0 });
    await store.getState().addTracksFromPaths(['/a.wav']);
    const t1 = active().id;
    store.getState().newTab();
    store.getState().setSleepMinutes(1);
    vi.setSystemTime(61_000);
    expect(await store.getState().checkSleep()).toEqual([t1]);
    api.loadSource = () => Promise.reject(new Error('ERR_FILE_NOT_FOUND: gone'));
    await store.getState().setActiveTab(t1);
    expect(store.getState().toasts.at(-1)!.code).toBe('ERR_FILE_NOT_FOUND');
    expect(active().sleeping).toBe(false);
  });

  it('ignores sleep requests for the active tab / unknown tabs and wake for awake tabs', async () => {
    await store.getState().sleepTab(active().id);
    await store.getState().sleepTab('nope');
    expect(active().sleeping).toBe(false);
    await store.getState().wakeTab(active().id);
    await store.getState().wakeTab('nope');
    expect(api.callsTo('releaseSession')).toHaveLength(0);
  });

  it('wakes the next active tab when closing the current one', async () => {
    const t1 = active().id;
    const t2 = store.getState().newTab();
    await store.getState().setActiveTab(t1);
    await store.getState().sleepTab(t2);
    expect(store.getState().tabs.find((t) => t.id === t2)!.sleeping).toBe(true);
    await store.getState().closeTab(t1);
    expect(active().id).toBe(t2);
    expect(active().sleeping).toBe(false);
  });
});

describe('transport', () => {
  beforeEach(async () => {
    await addAll();
    store.getState().setRenderResult(active().id, { duration: 10, sampleRate: 1000 } as never);
  });

  it('play / pause / toggle / stop', async () => {
    store.getState().setPlayhead(2);
    await store.getState().play();
    expect(api.callsTo('seek')).toEqual([[2]]);
    expect(api.callsTo('play')).toEqual([[active().id]]);
    expect(store.getState().transport.state).toBe('playing');
    await store.getState().togglePlay();
    expect(api.callsTo('pause')).toHaveLength(1);
    expect(store.getState().transport.state).toBe('paused');
    await store.getState().togglePlay();
    expect(api.callsTo('play')).toHaveLength(2);
    await store.getState().stop();
    expect(store.getState().transport.state).toBe('stopped');
    expect(active().playhead).toBe(0);
  });

  it('restarts from 0 when at the end and does nothing without a render', async () => {
    store.getState().setPlayhead(10);
    await store.getState().play();
    expect(api.callsTo('seek')).toEqual([[0]]);
    store.getState().newTab();
    await store.getState().play();
    expect(api.callsTo('play')).toHaveLength(1);
  });

  it('seeks (clamped) and continues playing from there', async () => {
    await store.getState().play();
    await store.getState().seek(4.5);
    expect(api.callsTo('seek').at(-1)).toEqual([4.5]);
    expect(active().playhead).toBe(4.5);
    expect(store.getState().transport.state).toBe('playing');
    await store.getState().seek(99);
    expect(active().playhead).toBe(10);
    await store.getState().seek(-1);
    expect(active().playhead).toBe(0);
  });

  it('steps by the selected unit', async () => {
    store.getState().setStepUnit('s1');
    await store.getState().step(1);
    expect(active().playhead).toBe(1);
    store.getState().setStepUnit('sample');
    await store.getState().step(1);
    expect(active().playhead).toBeCloseTo(1.001);
    await store.getState().step(-1);
    expect(active().playhead).toBeCloseTo(1);
    store.getState().setStepUnit('frame30');
    await store.getState().step(-1);
    expect(active().playhead).toBeCloseTo(29 / 30);
  });

  it('toggles loop and mirrors engine transport pushes', async () => {
    await store.getState().setLoop(true);
    expect(api.callsTo('setLoop')).toEqual([[true]]);
    expect(store.getState().transport.loop).toBe(true);
    store.getState().handleTransport({ state: 'playing', position: 3.3, duration: 10, sessionId: active().id, loop: true });
    expect(active().playhead).toBe(3.3);
    store.getState().handleTransport({ state: 'playing', position: 7, duration: 10, sessionId: 'other', loop: true });
    expect(active().playhead).toBe(3.3);
  });

  it('turns engine errors into toasts', async () => {
    const fail = () => Promise.reject(new Error('ERR_NO_AUDIO_DEVICE: none'));
    api.play = fail;
    api.pause = fail;
    api.stop = fail;
    api.seek = fail;
    api.setLoop = fail;
    await store.getState().play();
    await store.getState().pause();
    await store.getState().stop();
    await store.getState().seek(1);
    await store.getState().setLoop(true);
    expect(store.getState().toasts.length).toBeGreaterThan(0);
    expect(store.getState().toasts.every((t) => t.code === 'ERR_NO_AUDIO_DEVICE')).toBe(true);
  });
});

describe('settings & toasts', () => {
  it('persists settings in localStorage', () => {
    const lang: string[] = [];
    const s2 = createAppStore(() => api, { onLanguageChange: (l) => lang.push(l) });
    s2.getState().setLanguage('vi');
    s2.getState().setTheme('light');
    s2.getState().setSleepMinutes(0);
    s2.getState().setSnap(false);
    s2.getState().setStepUnit('frame60');
    s2.getState().setColormap('inferno');
    expect(lang).toEqual(['vi']);
    expect(loadSettings()).toEqual({
      language: 'vi',
      theme: 'light',
      sleepMinutes: 1,
      snap: false,
      stepUnit: 'frame60',
      colormap: 'inferno',
    });
    expect(createAppStore(() => api).getState().settings.language).toBe('vi');
  });

  it('ignores invalid persisted settings', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: 'fr', theme: 'pink', sleepMinutes: -1, stepUnit: 'x' }));
    expect(loadSettings()).toMatchObject({ language: 'en', theme: 'dark', sleepMinutes: 5, stepUnit: 'ms100' });
  });

  it('prefixes the error detail with a context', () => {
    store.getState().pushError(new Error('ERR_IO: denied'), 'a.wav');
    store.getState().pushError(new Error('ERR_IO'), 'b.wav');
    expect(store.getState().toasts.map((t) => t.detail)).toEqual(['a.wav: denied', 'b.wav']);
  });

  it('extracts file names from both path styles', () => {
    expect(fileNameOf('C:\\music\\a.wav')).toBe('a.wav');
    expect(fileNameOf('/home/u/b.flac')).toBe('b.flac');
    expect(fileNameOf('c.ogg')).toBe('c.ogg');
  });

  it('keeps at most 5 toasts and dismisses them', () => {
    for (let i = 0; i < 7; i++) store.getState().pushError(new Error('ERR_IO: x'));
    expect(store.getState().toasts).toHaveLength(5);
    store.getState().pushInfo('import.noSupportedFiles');
    const id = store.getState().toasts[0]!.id;
    store.getState().dismissToast(id);
    expect(store.getState().toasts.some((t) => t.id === id)).toBe(false);
  });
});
