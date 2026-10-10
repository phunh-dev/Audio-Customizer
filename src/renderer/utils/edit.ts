/**
 * Pure editing math on tracks (non-destructive: only offsets / clip bounds /
 * fades change). Timeline position of a source time `s` is
 * `offset + (s - clipStart) / speed`, where `speed = tempo / 100` when the
 * pitch/tempo effect is enabled (both stretch and varispeed change length).
 */
import type { FadeCurve, Track } from '@shared/types';

export const MIN_CLIP = 0.001;

export type SourceDurations = Readonly<Record<string, number>>;

export function trackSpeed(track: Track): number {
  const pt = track.effects.pitchTempo;
  return pt.enabled && pt.tempo > 0 ? pt.tempo / 100 : 1;
}

export function clipEndOf(track: Track, sourceDuration: number): number {
  const end = track.clipEnd ?? sourceDuration;
  return Math.min(Math.max(end, track.clipStart), sourceDuration > 0 ? sourceDuration : end);
}

/** Length of the clip on the timeline (seconds). */
export function trackDuration(track: Track, sourceDuration: number): number {
  return Math.max(0, (clipEndOf(track, sourceDuration) - track.clipStart) / trackSpeed(track));
}

export function trackEnd(track: Track, sourceDuration: number): number {
  return track.offset + trackDuration(track, sourceDuration);
}

export function timelineToSource(track: Track, t: number): number {
  return track.clipStart + (t - track.offset) * trackSpeed(track);
}

export function sourceToTimeline(track: Track, s: number): number {
  return track.offset + (s - track.clipStart) / trackSpeed(track);
}

/** Timeline length of the whole project (before master loop / trim silence). */
export function projectDuration(tracks: readonly Track[], durations: SourceDurations): number {
  let end = 0;
  for (const t of tracks) end = Math.max(end, trackEnd(t, durations[t.sourceId] ?? 0));
  return end;
}

function clampFades(track: Track, sourceDuration: number): Track {
  const len = trackDuration(track, sourceDuration);
  const fadeIn = Math.min(track.fadeIn.duration, len);
  const fadeOut = Math.min(track.fadeOut.duration, Math.max(0, len - fadeIn));
  if (fadeIn === track.fadeIn.duration && fadeOut === track.fadeOut.duration) return track;
  return { ...track, fadeIn: { ...track.fadeIn, duration: fadeIn }, fadeOut: { ...track.fadeOut, duration: fadeOut } };
}

/**
 * Keep only the part of `track` inside the timeline range [start, end).
 * Returns null when nothing (or less than MIN_CLIP) would remain.
 */
export function trimTrack(track: Track, start: number, end: number, sourceDuration: number): Track | null {
  const s = Math.max(start, track.offset);
  const e = Math.min(end, trackEnd(track, sourceDuration));
  if (e - s < MIN_CLIP) return null;
  const clipStart = timelineToSource(track, s);
  const clipEnd = timelineToSource(track, e);
  const srcEnd = clipEndOf(track, sourceDuration);
  const next: Track = {
    ...track,
    offset: s,
    clipStart,
    clipEnd: track.clipEnd === null && Math.abs(clipEnd - srcEnd) < 1e-9 ? null : clipEnd,
  };
  return clampFades(next, sourceDuration);
}

/**
 * Split `track` at timeline time `at`. The left part keeps the fade-in, the
 * right part keeps the fade-out. Returns null when `at` is not strictly inside.
 */
export function splitTrack(track: Track, at: number, sourceDuration: number, newId: string): [Track, Track] | null {
  const end = trackEnd(track, sourceDuration);
  if (at - track.offset < MIN_CLIP || end - at < MIN_CLIP) return null;
  const srcAt = timelineToSource(track, at);
  const left: Track = { ...track, clipEnd: srcAt, fadeOut: { ...track.fadeOut, duration: 0 } };
  const right: Track = {
    ...track,
    id: newId,
    offset: at,
    clipStart: srcAt,
    fadeIn: { ...track.fadeIn, duration: 0 },
  };
  return [clampFades(left, sourceDuration), clampFades(right, sourceDuration)];
}

/**
 * Ripple-delete the timeline region [a, b) from all tracks: content inside is
 * removed and everything after `b` moves left by (b - a). Tracks spanning the
 * region are split in two (the right part gets an id from `newId`).
 */
export function rippleDelete(
  tracks: readonly Track[],
  a: number,
  b: number,
  durations: SourceDurations,
  newId: () => string,
): Track[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const gap = hi - lo;
  if (gap < MIN_CLIP) return tracks.slice();
  const out: Track[] = [];
  for (const t of tracks) {
    const dur = durations[t.sourceId] ?? 0;
    const s = t.offset;
    const e = trackEnd(t, dur);
    if (e <= lo) {
      out.push(t);
    } else if (s >= hi) {
      out.push({ ...t, offset: s - gap });
    } else if (s >= lo && e <= hi) {
      // fully inside: removed
    } else if (s < lo && e > hi) {
      const left = trimTrack(t, s, lo, dur);
      const right = trimTrack({ ...t, id: newId() }, hi, e, dur);
      if (left) out.push({ ...left, fadeOut: { ...left.fadeOut, duration: 0 } });
      if (right) out.push({ ...right, offset: lo, fadeIn: { ...right.fadeIn, duration: 0 } });
    } else if (s < lo) {
      const left = trimTrack(t, s, lo, dur);
      if (left) out.push(left);
    } else {
      const right = trimTrack(t, hi, e, dur);
      if (right) out.push({ ...right, offset: lo });
    }
  }
  return out;
}

/**
 * Concatenate tracks in the given order: each track starts where the previous
 * one ends plus `gap` seconds, minus `crossfade` seconds of overlap. With a
 * crossfade, overlapping fades (fade-out of the previous, fade-in of the next)
 * are set to the crossfade length with `curve`.
 * Total length = sum(durations) + (n - 1) * (gap - crossfade).
 */
export function arrangeSequential(
  tracks: readonly Track[],
  durations: SourceDurations,
  gap: number,
  crossfade: number,
  curve: FadeCurve = 'equalPower',
): Track[] {
  const g = Math.max(0, gap);
  const out: Track[] = [];
  let cursor = 0;
  tracks.forEach((t, i) => {
    const dur = trackDuration(t, durations[t.sourceId] ?? 0);
    const prev = out[i - 1];
    const prevDur = prev ? trackDuration(prev, durations[prev.sourceId] ?? 0) : 0;
    const xf = i > 0 ? Math.max(0, Math.min(crossfade, dur, prevDur)) : 0;
    const offset = i === 0 ? 0 : Math.max(0, cursor + g - xf);
    let next: Track = { ...t, offset };
    if (xf > 0 && prev) {
      out[i - 1] = { ...prev, fadeOut: { duration: xf, curve } };
      next = { ...next, fadeIn: { duration: xf, curve } };
    }
    out.push(next);
    cursor = offset + dur;
  });
  return out;
}
