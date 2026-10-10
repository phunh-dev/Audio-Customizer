import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultExportOptions } from '@shared/types';
import {
  getStore,
  redo,
  resetAppStore,
  sealHistory,
  selectEffectChain,
  setExportOptions,
  setPreviewExport,
  undo,
  updateEffects,
  updateMaster,
  useActiveProject,
  useActiveTab,
  useCanRedo,
  useCanUndo,
  useEffectChain,
  useEffectTarget,
  useSelectedTrack,
  useSessionId,
} from './index';

beforeEach(() => {
  resetAppStore();
});

describe('public store API', () => {
  it('exposes the active tab through hooks', async () => {
    const { result } = renderHook(() => ({
      tab: useActiveTab(),
      project: useActiveProject(),
      session: useSessionId(),
      selected: useSelectedTrack(),
      target: useEffectTarget(),
      chain: useEffectChain('master'),
      canUndo: useCanUndo(),
      canRedo: useCanRedo(),
    }));
    expect(result.current.session).toBe(getStore().activeTabId);
    expect(result.current.tab.id).toBe(result.current.session);
    expect(result.current.project.tracks).toEqual([]);
    expect(result.current.selected).toBeNull();
    expect(result.current.target).toBe('master');
    expect(result.current.chain).toBe(result.current.project.master.effects);
    expect(result.current.canUndo).toBe(false);

    await act(() => getStore().addTracksFromPaths(['/a.wav']));
    const id = result.current.project.tracks[0]!.id;
    expect(result.current.selected?.id).toBe(id);
    expect(result.current.target).toBe(id);
    expect(result.current.canUndo).toBe(true);
    expect(selectEffectChain(getStore(), id)).toBe(result.current.project.tracks[0]!.effects);
    expect(selectEffectChain(getStore(), 'missing')).toBeNull();

    act(() => undo());
    expect(result.current.canRedo).toBe(true);
    act(() => redo());
    expect(result.current.project.tracks).toHaveLength(1);
  });

  it('imperative helpers for effect panels are undoable and coalesce', () => {
    updateEffects('master', (c) => void (c.volume.gainDb = 1), 'vol');
    updateEffects('master', (c) => void (c.volume.gainDb = 2), 'vol');
    sealHistory();
    updateEffects('master', (c) => void (c.volume.gainDb = 3), 'vol');
    updateMaster((m) => void (m.loop.enabled = true));
    const tab = () => getStore().tabs[0]!;
    expect(tab().history.past).toHaveLength(3);
    undo();
    undo();
    expect(tab().project.master.effects.volume.gainDb).toBe(2);
    expect(tab().project.master.loop.enabled).toBe(false);

    const opts = { ...createDefaultExportOptions(), format: 'ogg' as const };
    setPreviewExport(opts);
    setExportOptions(opts);
    expect(tab().previewExport?.format).toBe('ogg');
    expect(tab().exportOptions.format).toBe('ogg');
    setPreviewExport(null);
    expect(tab().previewExport).toBeNull();
  });
});
