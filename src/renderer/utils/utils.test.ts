import { describe, expect, it } from 'vitest';
import {
  clamp,
  formatDuration,
  formatRulerLabel,
  formatTime,
  stepPosition,
  stepSeconds,
  STEP_UNITS,
} from './time';
import {
  clampScroll,
  clampZoom,
  fitZoom,
  freqToY,
  freqToYLinear,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  snapTime,
  tickStep,
  ticks,
  timeToX,
  xToTime,
  zoomAt,
} from './timeline';
import { applyColormap, colormapLut } from './colormap';
import { drawPeakColumns, peakColumns } from './peaks';
import { formatBytes, formatDb, formatHzShort } from './format';
import { readJson, readString, writeJson, writeString } from './storage';

describe('time formatting', () => {
  it('formats mm:ss.mmm', () => {
    expect(formatTime(0)).toBe('00:00.000');
    expect(formatTime(1.5)).toBe('00:01.500');
    expect(formatTime(61.0456)).toBe('01:01.046');
    expect(formatTime(3725.25)).toBe('1:02:05.250');
    expect(formatTime(-3)).toBe('00:00.000');
    expect(formatTime(Number.NaN)).toBe('00:00.000');
  });

  it('formats ruler labels and durations', () => {
    expect(formatRulerLabel(65)).toBe('1:05');
    expect(formatRulerLabel(1.25, true)).toBe('0:01.250');
    expect(formatRulerLabel(-1)).toBe('0:00');
    expect(formatDuration(83.44)).toBe('1:23.4');
    expect(formatDuration(0.5)).toBe('0:00.5');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00.0');
  });

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(Number.NaN, 1, 3)).toBe(1);
  });
});

describe('step units', () => {
  it('step sizes', () => {
    expect(stepSeconds('sample', 48000)).toBeCloseTo(1 / 48000, 12);
    expect(stepSeconds('sample', 0)).toBeCloseTo(1 / 44100, 12);
    expect(stepSeconds('ms1')).toBe(0.001);
    expect(stepSeconds('ms10')).toBe(0.01);
    expect(stepSeconds('ms100')).toBe(0.1);
    expect(stepSeconds('s1')).toBe(1);
    expect(stepSeconds('frame24')).toBeCloseTo(1 / 24);
    expect(stepSeconds('frame30')).toBeCloseTo(1 / 30);
    expect(stepSeconds('frame60')).toBeCloseTo(1 / 60);
    expect(STEP_UNITS).toHaveLength(8);
  });

  it('steps forward/back on the unit grid and clamps', () => {
    expect(stepPosition(1, 1, 's1', 10)).toBe(2);
    expect(stepPosition(1.5, 1, 's1', 10)).toBe(2);
    expect(stepPosition(1.5, -1, 's1', 10)).toBe(1);
    expect(stepPosition(1, -1, 's1', 10)).toBe(0);
    expect(stepPosition(0, -1, 's1', 10)).toBe(0);
    expect(stepPosition(9.5, 1, 's1', 10)).toBe(10);
    expect(stepPosition(0.05, 1, 'frame24', 10)).toBeCloseTo(2 / 24);
    expect(stepPosition(0.1, 1, 'ms100', 10)).toBeCloseTo(0.2);
    expect(stepPosition(0, 1, 'sample', 10, 1000)).toBeCloseTo(0.001);
    expect(stepPosition(5, 1, 'ms1', -1)).toBe(0);
  });
});

describe('timeline coordinates', () => {
  const vp = { pxPerSec: 100, scroll: 2 };
  it('converts both ways', () => {
    expect(timeToX(3, vp)).toBe(100);
    expect(xToTime(100, vp)).toBe(3);
    expect(xToTime(timeToX(7.25, vp), vp)).toBeCloseTo(7.25);
  });

  it('zooms around an anchor', () => {
    const z = zoomAt(vp, 2, 100);
    expect(z.pxPerSec).toBe(200);
    expect(xToTime(100, z)).toBeCloseTo(3);
    expect(zoomAt({ pxPerSec: 10, scroll: 0 }, 0.5, 500).scroll).toBe(0);
    expect(clampZoom(0.1)).toBe(MIN_PX_PER_SEC);
    expect(clampZoom(1e9)).toBe(MAX_PX_PER_SEC);
  });

  it('fits and clamps scroll', () => {
    expect(fitZoom(10, 1000)).toBe(100);
    expect(fitZoom(0, 1000)).toBe(100);
    expect(clampScroll(50, 20, 5)).toBe(15);
    expect(clampScroll(-3, 20, 5)).toBe(0);
    expect(clampScroll(3, 2, 5)).toBe(0);
  });

  it('computes ticks', () => {
    expect(tickStep(100)).toBe(1);
    expect(tickStep(1000)).toBe(0.1);
    expect(tickStep(0.001)).toBe(600);
    expect(ticks({ pxPerSec: 100, scroll: 0.5 }, 300)).toEqual([1, 2, 3]);
  });

  it('snaps to the nearest candidate within threshold', () => {
    expect(snapTime(1.02, [0, 1, 2], 0.05)).toBe(1);
    expect(snapTime(1.2, [0, 1, 2], 0.05)).toBe(1.2);
  });

  it('maps frequency to y', () => {
    expect(freqToY(20000, 20, 20000, 100)).toBeCloseTo(0);
    expect(freqToY(20, 20, 20000, 100)).toBeCloseTo(100);
    expect(freqToY(632.45, 20, 20000, 100)).toBeCloseTo(50, 0);
    expect(freqToYLinear(10010, 20, 20000, 100)).toBeCloseTo(50, 0);
  });
});

describe('colormap', () => {
  it('builds a 256-entry LUT from dark to bright', () => {
    const lut = colormapLut('magma');
    expect(lut).toHaveLength(768);
    expect([lut[0], lut[1], lut[2]]).toEqual([0, 0, 4]);
    expect([lut[765], lut[766], lut[767]]).toEqual([252, 253, 191]);
    expect(colormapLut('magma')).toBe(lut);
    const inferno = colormapLut('inferno');
    expect([inferno[765], inferno[766], inferno[767]]).toEqual([252, 255, 164]);
    // luminance increases monotonically (roughly)
    const lum = (i: number) => lut[i * 3]! + lut[i * 3 + 1]! + lut[i * 3 + 2]!;
    expect(lum(200)).toBeGreaterThan(lum(100));
  });

  it('maps values to RGBA', () => {
    const rgba = applyColormap(new Uint8Array([0, 255]), 'magma');
    expect(Array.from(rgba)).toEqual([0, 0, 4, 255, 252, 253, 191, 255]);
    const out = new Uint8ClampedArray(4);
    expect(applyColormap(new Uint8Array([0]), 'inferno', out)).toBe(out);
  });
});

describe('peaks', () => {
  const peaks = new Float32Array([-0.1, 0.1, -0.5, 0.5, -0.2, 0.9, -1, 0.3]); // 4 buckets over 4 s

  it('resamples to pixel columns', () => {
    const cols = peakColumns(peaks, 4, 0, 2, 2);
    expect(Array.from(cols)).toEqual([-0.5, 0.5, -1, expect.closeTo(0.9, 5)]);
    const fine = peakColumns(peaks, 4, 0, 0.5, 8);
    expect(fine[0]).toBeCloseTo(-0.1);
    expect(fine[1]).toBeCloseTo(0.1);
  });

  it('leaves columns outside the domain empty', () => {
    const cols = peakColumns(peaks, 4, -2, 1, 8);
    expect(cols[0]).toBe(0);
    expect(cols[2 * 2]).toBeCloseTo(-0.1);
    expect(cols[7 * 2]).toBe(0);
    expect(peakColumns(new Float32Array(), 4, 0, 1, 3)).toEqual(new Float32Array(6));
  });

  it('draws columns', () => {
    const rects: number[][] = [];
    const ctx = { fillStyle: '', fillRect: (...a: number[]) => rects.push(a) } as unknown as CanvasRenderingContext2D;
    drawPeakColumns(ctx, new Float32Array([-1, 1, 0, 0, -0.5, 0.5]), 10, 0, 100, { color: 'red' });
    expect(rects).toEqual([
      [10, 0, 1, 100],
      [12, 25, 1, 50],
    ]);
  });
});

describe('format & storage', () => {
  it('formats numbers', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
    expect(formatBytes(-1)).toBe('-');
    expect(formatDb(-1.234)).toBe('-1.2');
    expect(formatDb(null)).toBe('-inf');
    expect(formatDb(Number.NEGATIVE_INFINITY)).toBe('-inf');
    expect(formatHzShort(1000)).toBe('1k');
    expect(formatHzShort(2500)).toBe('2.5k');
    expect(formatHzShort(50)).toBe('50');
  });

  it('reads and writes localStorage safely', () => {
    writeJson('k', { a: 1 });
    expect(readJson('k', null)).toEqual({ a: 1 });
    expect(readJson('missing', 7)).toBe(7);
    localStorage.setItem('bad', '{');
    expect(readJson('bad', 'fallback')).toBe('fallback');
    writeString('s', 'v');
    expect(readString('s')).toBe('v');
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    expect(() => writeJson('x', 1)).not.toThrow();
    expect(() => writeString('x', '1')).not.toThrow();
    Storage.prototype.setItem = orig;
    const origGet = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    expect(readString('s')).toBeNull();
    expect(readJson('s', 1)).toBe(1);
    Storage.prototype.getItem = origGet;
  });
});
