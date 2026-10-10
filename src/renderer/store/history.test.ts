import { describe, expect, it } from 'vitest';
import { createDefaultProject, createDefaultTrack } from '@shared/types';
import { canRedo, canUndo, commit, COALESCE_WINDOW_MS, createHistory, redo, seal, undo } from './history';

describe('patch history', () => {
  it('records, undoes and redoes a change', () => {
    const p0 = createDefaultProject();
    const h0 = createHistory();
    const r = commit(p0, h0, (p) => {
      p.tracks.push(createDefaultTrack('t', 's', 'n'));
    });
    expect(r.changed).toBe(true);
    expect(r.project.tracks).toHaveLength(1);
    expect(canUndo(r.history)).toBe(true);
    expect(canRedo(r.history)).toBe(false);
    const u = undo(r.project, r.history)!;
    expect(u.project.tracks).toHaveLength(0);
    expect(canRedo(u.history)).toBe(true);
    const rd = redo(u.project, u.history)!;
    expect(rd.project.tracks).toHaveLength(1);
    expect(rd.project.tracks[0]!.id).toBe('t');
  });

  it('ignores no-op recipes', () => {
    const p0 = createDefaultProject();
    const h0 = createHistory();
    const r = commit(p0, h0, () => undefined);
    expect(r.changed).toBe(false);
    expect(r.project).toBe(p0);
    expect(r.history).toBe(h0);
  });

  it('returns null when there is nothing to undo/redo', () => {
    expect(undo(createDefaultProject(), createHistory())).toBeNull();
    expect(redo(createDefaultProject(), createHistory())).toBeNull();
  });

  it('coalesces same-key changes inside the window into one step', () => {
    let p = createDefaultProject();
    let h = createHistory();
    for (let i = 1; i <= 5; i++) {
      const r = commit(p, h, (d) => void (d.master.effects.volume.gainDb = i), 'gain', 1000 + i * 100);
      p = r.project;
      h = r.history;
    }
    expect(h.past).toHaveLength(1);
    const u = undo(p, h)!;
    expect(u.project.master.effects.volume.gainDb).toBe(0);
    const rd = redo(u.project, u.history)!;
    expect(rd.project.master.effects.volume.gainDb).toBe(5);
  });

  it('does not coalesce different keys, null keys, expired windows or sealed groups', () => {
    let p = createDefaultProject();
    let h = createHistory();
    const step = (key: string | null, now: number, v: number) => {
      const r = commit(p, h, (d) => void (d.master.effects.volume.gainDb = v), key, now);
      p = r.project;
      h = r.history;
    };
    step('a', 0, 1);
    step('b', 10, 2);
    step(null, 20, 3);
    step(null, 30, 4);
    step('c', 40, 5);
    step('c', 40 + COALESCE_WINDOW_MS + 1, 6);
    expect(h.past).toHaveLength(6);
    h = seal(h);
    step('c', 50 + COALESCE_WINDOW_MS + 1, 7);
    expect(h.past).toHaveLength(7);
    expect(seal(createHistory()).past).toHaveLength(0);
  });

  it('a new change clears the redo stack', () => {
    let p = createDefaultProject();
    let h = createHistory();
    let r = commit(p, h, (d) => void (d.master.loop.enabled = true));
    const u = undo(r.project, r.history)!;
    expect(u.history.future).toHaveLength(1);
    r = commit(u.project, u.history, (d) => void (d.master.trimSilence.enabled = true));
    expect(r.history.future).toHaveLength(0);
    p = r.project;
    h = r.history;
    expect(p.master.loop.enabled).toBe(false);
    expect(h.past).toHaveLength(1);
  });

  it('caps the history length', () => {
    let p = createDefaultProject();
    let h = createHistory();
    for (let i = 0; i < 10; i++) {
      const r = commit(p, h, (d) => void (d.master.effects.volume.gainDb = i + 1), null, i, 5);
      p = r.project;
      h = r.history;
    }
    expect(h.past).toHaveLength(5);
  });
});
