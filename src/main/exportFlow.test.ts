import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultProject, DEFAULT_EXPORT_OPTIONS, type ExportOptions } from '@shared/types';
import {
  createExporter,
  E2E_SAVE_PATH_ENV,
  ensureExtension,
  filtersFor,
  suggestedFileName,
  type ExportDeps,
  type SaveDialogOptions,
} from './exportFlow';

function setup(dialogResult: { canceled: boolean; filePath?: string }, env: Record<string, string | undefined> = {}) {
  const calls: string[] = [];
  const engine = {
    export: vi.fn(async (..._args: [string, string, string, string]) => {
      calls.push('engine');
      return 1234;
    }),
  };
  const showSaveDialog = vi.fn(async (_opts: SaveDialogOptions) => {
    calls.push('dialog');
    return dialogResult;
  });
  const deps: ExportDeps = { engine, showSaveDialog, env, defaultDir: () => join('/home', 'music') };
  return { exporter: createExporter(deps), engine, showSaveDialog, calls };
}

const project = createDefaultProject();
const mp3: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, format: 'mp3' };

describe('exportAudio flow', () => {
  it('cancel -> no engine call, nothing written', async () => {
    const { exporter, engine, showSaveDialog } = setup({ canceled: true });
    const r = await exporter('s1', project, mp3, 'Boom');
    expect(r).toEqual({ canceled: true });
    expect(showSaveDialog).toHaveBeenCalledTimes(1);
    expect(engine.export).not.toHaveBeenCalled();
  });

  it('empty path counts as cancel', async () => {
    const { exporter, engine } = setup({ canceled: false, filePath: '' });
    expect(await exporter('s1', project, mp3, 'x')).toEqual({ canceled: true });
    expect(engine.export).not.toHaveBeenCalled();
  });

  it('dialog first, then engine.export with the chosen path', async () => {
    const chosen = join('/out', 'final.mp3');
    const { exporter, engine, showSaveDialog, calls } = setup({ canceled: false, filePath: chosen });
    const r = await exporter('s1', project, mp3, 'Boom.wav');
    expect(calls).toEqual(['dialog', 'engine']);
    expect(r).toEqual({ canceled: false, path: chosen, bytes: 1234 });
    const opts = showSaveDialog.mock.calls[0]![0];
    expect(opts.defaultPath).toBe(join('/home', 'music', 'Boom.mp3'));
    expect(opts.filters).toEqual([{ name: 'MP3 audio', extensions: ['mp3'] }]);
    const [sid, pj, oj, path] = engine.export.mock.calls[0]!;
    expect(sid).toBe('s1');
    expect(JSON.parse(pj)).toEqual(project);
    expect(JSON.parse(oj)).toEqual(mp3);
    expect(path).toBe(chosen);
  });

  it('remembers the last folder and appends a missing extension', async () => {
    const { exporter, engine, showSaveDialog } = setup({ canceled: false, filePath: join('/out', 'noext') });
    await exporter('s1', project, mp3, 'a');
    expect(engine.export.mock.calls[0]![3]).toBe(join('/out', 'noext.mp3'));
    await exporter('s1', project, mp3, 'b');
    const second = showSaveDialog.mock.calls[1]![0];
    expect(second.defaultPath).toBe(join('/out', 'b.mp3'));
  });

  it('E2E env bypasses the dialog', async () => {
    const { exporter, engine, showSaveDialog } = setup({ canceled: true }, { [E2E_SAVE_PATH_ENV]: '/tmp/e2e.wav' });
    const r = await exporter('s1', project, DEFAULT_EXPORT_OPTIONS, 'x');
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(engine.export.mock.calls[0]![3]).toBe('/tmp/e2e.wav');
    expect(r).toEqual({ canceled: false, path: '/tmp/e2e.wav', bytes: 1234 });
  });

  it('engine errors propagate (nothing reported as written)', async () => {
    const { exporter, engine } = setup({ canceled: false, filePath: '/out/x.wav' });
    engine.export.mockRejectedValueOnce(new Error('ERR_IO: disk full'));
    await expect(exporter('s1', project, DEFAULT_EXPORT_OPTIONS, 'x')).rejects.toThrow(/^ERR_IO: disk full$/);
  });

  it('invalid format is rejected before any dialog', async () => {
    const { exporter, showSaveDialog } = setup({ canceled: true });
    const bad = { ...DEFAULT_EXPORT_OPTIONS, format: 'wma' } as unknown as ExportOptions;
    await expect(exporter('s1', project, bad, 'x')).rejects.toThrow(/^ERR_INVALID_PARAM/);
    expect(showSaveDialog).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('filters per format', () => {
    expect(filtersFor('wav')[0]!.extensions).toEqual(['wav']);
    expect(filtersFor('aiff')[0]!.extensions).toEqual(['aiff', 'aif']);
    expect(filtersFor('flac')[0]!.extensions).toEqual(['flac']);
    expect(filtersFor('ogg')[0]!.extensions).toEqual(['ogg']);
  });

  it('suggested names', () => {
    expect(suggestedFileName('Explosion.wav', 'ogg')).toBe('Explosion.ogg');
    expect(suggestedFileName('C:\\sfx\\hit.mp3', 'wav')).toBe('hit.wav');
    expect(suggestedFileName('a:b*c?', 'flac')).toBe('a_b_c_.flac');
    expect(suggestedFileName('', 'aiff')).toBe('export.aiff');
    expect(suggestedFileName('   ', 'wav')).toBe('export.wav');
    expect(suggestedFileName('v1.2 final', 'mp3')).toBe('v1.2 final.mp3');
  });

  it('ensureExtension', () => {
    expect(ensureExtension('/a/b', 'flac')).toBe('/a/b.flac');
    expect(ensureExtension('/a/b.wave', 'wav')).toBe('/a/b.wave');
  });
});
