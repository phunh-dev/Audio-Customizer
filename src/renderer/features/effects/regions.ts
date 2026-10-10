/** Conversions between the timeline selection and effect regions. */

export interface TimeRange {
  start: number;
  end: number;
}

interface TrackPlacement {
  offset: number;
  clipStart: number;
  clipEnd: number | null;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Noise-profile range (seconds inside the processed buffer) from a timeline
 * selection. Master: timeline time. Track: relative to the clip start on the
 * timeline (the track chain processes the clipped source). Returns null when
 * the selection does not overlap the processed audio.
 */
export function selectionToProfile(selection: TimeRange | null, track: TrackPlacement | null): TimeRange | null {
  if (!selection) return null;
  let start = Math.min(selection.start, selection.end);
  let end = Math.max(selection.start, selection.end);
  if (track) {
    start -= track.offset;
    end -= track.offset;
    if (track.clipEnd !== null) {
      const len = Math.max(0, track.clipEnd - track.clipStart);
      end = Math.min(end, len);
    }
  }
  start = Math.max(0, start);
  if (!(end - start > 0)) return null;
  return { start: round(start), end: round(end) };
}

/** Loop region on the master output from a timeline selection. */
export function selectionToLoopRegion(selection: TimeRange | null): TimeRange | null {
  return selectionToProfile(selection, null);
}
