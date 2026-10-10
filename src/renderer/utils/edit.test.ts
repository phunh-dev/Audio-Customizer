import { describe, expect, it } from 'vitest';
import { createDefaultTrack, type Track } from '@shared/types';
import {
  arrangeSequential,
  clipEndOf,
  projectDuration,
  rippleDelete,
  sourceToTimeline,
  splitTrack,
  timelineToSource,
  trackDuration,
  trackEnd,
  trackSpeed,
  trimTrack,
} from './edit';

function track(id: string, src: string, patch: Partial<Track> = {}): Track {
  return { ...createDefaultTrack(id, src, id), ...patch };
}

const durations = { a: 10, b: 4, c: 6 };

describe('track timeline math', () => {
  it('computes durations, ends and mapping', () => {
    const t = track('t', 'a', { offset: 2, clipStart: 1, clipEnd: 5 });
    expect(trackSpeed(t)).toBe(1);
    expect(clipEndOf(t, 10)).toBe(5);
    expect(trackDuration(t, 10)).toBe(4);
    expect(trackEnd(t, 10)).toBe(6);
    expect(timelineToSource(t, 3)).toBe(2);
    expect(sourceToTimeline(t, 2)).toBe(3);
    expect(clipEndOf(track('x', 'a'), 10)).toBe(10);
    expect(clipEndOf(track('x', 'a', { clipEnd: 20 }), 10)).toBe(10);
  });

  it('accounts for tempo when pitch/tempo is enabled', () => {
    const t = track('t', 'a');
    t.effects.pitchTempo.enabled = true;
    t.effects.pitchTempo.tempo = 200;
    expect(trackSpeed(t)).toBe(2);
    expect(trackDuration(t, 10)).toBe(5);
    expect(timelineToSource(t, 1)).toBe(2);
    t.effects.pitchTempo.enabled = false;
    expect(trackDuration(t, 10)).toBe(10);
  });

  it('project duration is the furthest clip end', () => {
    expect(projectDuration([track('1', 'a'), track('2', 'b', { offset: 8 })], durations)).toBe(12);
    expect(projectDuration([], durations)).toBe(0);
    expect(projectDuration([track('1', 'zzz')], durations)).toBe(0);
  });
});

describe('trim', () => {
  it('keeps only the selected timeline range', () => {
    const t = track('t', 'a', { offset: 1 });
    const r = trimTrack(t, 3, 6, 10)!;
    expect(r.offset).toBe(3);
    expect(r.clipStart).toBe(2);
    expect(r.clipEnd).toBe(5);
    expect(trackDuration(r, 10)).toBe(3);
  });

  it('keeps clipEnd null when trimming only the start', () => {
    const r = trimTrack(track('t', 'a'), 2, 100, 10)!;
    expect(r.clipStart).toBe(2);
    expect(r.clipEnd).toBeNull();
  });

  it('returns null when nothing remains', () => {
    expect(trimTrack(track('t', 'a', { offset: 20 }), 0, 5, 10)).toBeNull();
  });

  it('shortens fades that no longer fit', () => {
    const t = track('t', 'a', { fadeIn: { duration: 3, curve: 'linear' }, fadeOut: { duration: 3, curve: 'sCurve' } });
    const r = trimTrack(t, 0, 4, 10)!;
    expect(r.fadeIn.duration).toBe(3);
    expect(r.fadeOut.duration).toBe(1);
    expect(r.fadeOut.curve).toBe('sCurve');
  });
});

describe('split', () => {
  it('splits a clip at the playhead', () => {
    const t = track('t', 'a', {
      offset: 1,
      fadeIn: { duration: 0.5, curve: 'linear' },
      fadeOut: { duration: 0.5, curve: 'linear' },
    });
    const [l, r] = splitTrack(t, 4, 10, 'new')!;
    expect(l.id).toBe('t');
    expect(l.clipEnd).toBe(3);
    expect(l.fadeIn.duration).toBe(0.5);
    expect(l.fadeOut.duration).toBe(0);
    expect(r.id).toBe('new');
    expect(r.offset).toBe(4);
    expect(r.clipStart).toBe(3);
    expect(r.clipEnd).toBeNull();
    expect(r.fadeIn.duration).toBe(0);
    expect(r.fadeOut.duration).toBe(0.5);
    expect(trackDuration(l, 10) + trackDuration(r, 10)).toBeCloseTo(10);
  });

  it('returns null outside the clip', () => {
    const t = track('t', 'a', { offset: 1 });
    expect(splitTrack(t, 0.5, 10, 'n')).toBeNull();
    expect(splitTrack(t, 1, 10, 'n')).toBeNull();
    expect(splitTrack(t, 11, 10, 'n')).toBeNull();
  });
});

describe('ripple delete', () => {
  let n = 0;
  const newId = () => `r${++n}`;

  it('removes the region and shifts later content left', () => {
    const tracks = [
      track('before', 'b', { offset: 0 }), // 0..4
      track('after', 'b', { offset: 10 }), // 10..14
      track('inside', 'b', { offset: 5.5 }), // 5.5..9.5 inside 5..10
    ];
    const out = rippleDelete(tracks, 5, 10, durations, newId);
    expect(out.map((t) => t.id)).toEqual(['before', 'after']);
    expect(out[1]!.offset).toBe(5);
  });

  it('cuts tracks overlapping the region edges', () => {
    const left = track('left', 'a', { offset: 0 }); // 0..10
    const right = track('right', 'c', { offset: 4 }); // 4..10
    const out1 = rippleDelete([left], 8, 12, durations, newId);
    expect(out1).toHaveLength(1);
    expect(out1[0]!.clipEnd).toBe(8);
    const out2 = rippleDelete([right], 2, 6, durations, newId);
    expect(out2[0]!.offset).toBe(2);
    expect(out2[0]!.clipStart).toBe(2);
    expect(trackDuration(out2[0]!, 6)).toBe(4);
  });

  it('splits a track spanning the region', () => {
    const t = track('span', 'a', { offset: 0, fadeIn: { duration: 1, curve: 'linear' }, fadeOut: { duration: 1, curve: 'linear' } });
    const out = rippleDelete([t], 3, 5, durations, newId);
    expect(out).toHaveLength(2);
    const [a, b] = out as [Track, Track];
    expect(a.id).toBe('span');
    expect(a.clipEnd).toBe(3);
    expect(a.fadeOut.duration).toBe(0);
    expect(b.offset).toBe(3);
    expect(b.clipStart).toBe(5);
    expect(b.fadeIn.duration).toBe(0);
    expect(b.fadeOut.duration).toBe(1);
    expect(projectDuration(out, durations)).toBe(8);
  });

  it('accepts reversed bounds and ignores empty regions', () => {
    const t = track('x', 'a', { offset: 6 });
    expect(rippleDelete([t], 5, 2, durations, newId)[0]!.offset).toBe(3);
    expect(rippleDelete([t], 2, 2, durations, newId)[0]).toBe(t);
  });
});

describe('arrange sequential (concatenate)', () => {
  const tracks = [track('1', 'a', { offset: 3 }), track('2', 'b', { offset: 0 }), track('3', 'c')];

  it('places tracks end to end with a gap', () => {
    const out = arrangeSequential(tracks, durations, 0.5, 0);
    expect(out.map((t) => t.offset)).toEqual([0, 10.5, 15]);
    // total = sum + (n-1) * gap
    expect(projectDuration(out, durations)).toBeCloseTo(20 + 2 * 0.5);
    expect(out[1]!.fadeIn.duration).toBe(0);
  });

  it('overlaps tracks with crossfades', () => {
    const out = arrangeSequential(tracks, durations, 0, 1, 'equalPower');
    expect(out.map((t) => t.offset)).toEqual([0, 9, 12]);
    expect(projectDuration(out, durations)).toBeCloseTo(20 - 2 * 1);
    expect(out[0]!.fadeOut).toEqual({ duration: 1, curve: 'equalPower' });
    expect(out[1]!.fadeIn).toEqual({ duration: 1, curve: 'equalPower' });
    expect(out[1]!.fadeOut).toEqual({ duration: 1, curve: 'equalPower' });
    expect(out[2]!.fadeIn).toEqual({ duration: 1, curve: 'equalPower' });
  });

  it('clamps crossfade to the shortest neighbour', () => {
    const out = arrangeSequential([track('1', 'b'), track('2', 'a')], durations, 0, 10);
    expect(out[1]!.offset).toBe(0);
    expect(out[1]!.fadeIn.duration).toBe(4);
  });

  it('combines gap and crossfade', () => {
    const out = arrangeSequential([track('1', 'a'), track('2', 'b')], durations, 2, 1);
    expect(out[1]!.offset).toBe(11);
  });
});
