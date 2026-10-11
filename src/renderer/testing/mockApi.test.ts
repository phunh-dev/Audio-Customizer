import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultExportOptions, createDefaultProject, createDefaultTrack } from '@shared/types';
import { createMockApi } from './mockApi';

afterEach(() => vi.useRealTimers());

describe('mock AudioApi', () => {
  it('loads sources, renders and estimates sizes', async () => {
    const api = createMockApi();
    const info = await api.loadSource('/x/abc.wav');
    expect(info).toMatchObject({ id: '/x/abc.wav', name: 'abc.wav', format: 'wav', channels: 2 });
    await expect(api.loadSource('/x/readme.txt')).rejects.toThrow(/^ERR_UNSUPPORTED_FORMAT/);
    const project = createDefaultProject();
    await expect(api.render({ sessionId: 's', project, preview: null, peaksBuckets: 4, spectrogramWidth: 2, spectrogramHeight: 2 })).rejects.toThrow(
      /^ERR_EMPTY_PROJECT/,
    );
    project.tracks.push(createDefaultTrack('t', '/missing.wav', 'm'));
    await expect(api.render({ sessionId: 's', project, preview: null, peaksBuckets: 4, spectrogramWidth: 2, spectrogramHeight: 2 })).rejects.toThrow(
      /^ERR_SOURCE_NOT_LOADED/,
    );
    project.tracks[0] = createDefaultTrack('t', info.id, 'abc');
    const mono = { ...createDefaultExportOptions(), channels: 'mono' as const, sampleRate: 8000 };
    const r = await api.render({ sessionId: 's', project, preview: mono, peaksBuckets: 4, spectrogramWidth: 2, spectrogramHeight: 2 });
    expect(r.duration).toBe(info.duration);
    expect(r.channels).toBe(1);
    expect(r.sampleRate).toBe(8000);
    expect(r.peaks).toHaveLength(8);
    expect(r.spectrogram.data).toHaveLength(4);
    const wav = await api.estimateSize('s', project, createDefaultExportOptions());
    expect(wav).toBe(Math.round(info.duration * 44100 * 2 * 2) + 44);
    const mp3 = await api.estimateSize('s', project, { ...createDefaultExportOptions(), format: 'mp3', bitrateKbps: 128 });
    expect(mp3).toBe(Math.round((info.duration * 128000) / 8));
    expect(await api.exportAudio('s', project, createDefaultExportOptions(), 'a')).toEqual({ canceled: true });
    await api.unloadSource(info.id);
    expect(api.loaded.has(info.id)).toBe(false);
    await api.releaseSession('s');
    expect(await api.estimateSize('s', project, createDefaultExportOptions())).toBe(44);
  });

  it('simulates playback, looping and stop', async () => {
    vi.useFakeTimers({ now: 0 });
    const api = createMockApi({ simulatePlayback: true, durationOf: () => 1 });
    const info = await api.loadSource('/a.wav');
    const project = createDefaultProject();
    project.tracks.push(createDefaultTrack('t', info.id, 'a'));
    await api.render({ sessionId: 's', project, preview: null, peaksBuckets: 2, spectrogramWidth: 1, spectrogramHeight: 1 });
    const states: string[] = [];
    const off = api.onTransport((s) => states.push(`${s.state}:${s.position.toFixed(1)}`));
    await api.play('s');
    await vi.advanceTimersByTimeAsync(500);
    expect(api.transport.position).toBeGreaterThan(0.3);
    await api.setLoop(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(api.transport.state).toBe('playing');
    expect(api.transport.position).toBeLessThan(0.5);
    await api.pause();
    expect(api.transport.state).toBe('paused');
    await api.setLoop(false);
    await api.play('s');
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.transport.state).toBe('stopped');
    await api.play('s');
    await api.stop();
    expect(api.transport).toMatchObject({ state: 'stopped', position: 0 });
    expect(await api.getTransport()).toEqual(api.transport);
    off();
    expect(states.length).toBeGreaterThan(5);
  });

  it('dialogs, folder expansion and paths', async () => {
    const api = createMockApi();
    api.dialogFiles = ['/a.wav'];
    api.folderFiles['/dir'] = ['/dir/b.mp3'];
    expect(await api.openFilesDialog()).toEqual(['/a.wav']);
    expect(await api.openFolderDialog()).toEqual(['/dir/b.mp3']);
    expect(await api.expandPaths(['/dir', '/c.FLAC', '/d.doc'])).toEqual(['/c.FLAC', '/dir/b.mp3']);
    expect(api.getPathForFile(new File([], 'x.wav'))).toBe('x.wav');
    expect((await api.sourcePeaks('/a.wav', 3)).length).toBe(6);
    expect(api.callsTo('sourcePeaks')).toEqual([['/a.wav', 3]]);
  });
});
