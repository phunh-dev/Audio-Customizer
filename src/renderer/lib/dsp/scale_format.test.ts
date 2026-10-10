import { describe, expect, it } from 'vitest';
import {
  clamp,
  freqToPos,
  linToPos,
  logFrequencies,
  posToFreq,
  posToLin,
  posToValue,
  snapToStep,
  stepDecimals,
  valueToPos,
} from './scale';
import {
  formatBytes,
  formatDb,
  formatFreq,
  formatFreqCompact,
  formatFreqShort,
  formatNumber,
  formatSampleRate,
  formatSigned,
  formatTime,
  percentChange,
} from './format';

describe('scale', () => {
  it('log frequency mapping is monotonic and invertible', () => {
    expect(freqToPos(20)).toBe(0);
    expect(freqToPos(20000)).toBe(1);
    expect(freqToPos(632.455532)).toBeCloseTo(0.5, 6); // geometric mean
    for (const f of [20, 63, 1000, 4567, 20000]) expect(posToFreq(freqToPos(f))).toBeCloseTo(f, 6);
    expect(freqToPos(5)).toBe(0);
    expect(posToFreq(2)).toBe(20000);
  });

  it('linear mapping and generic value<->pos', () => {
    expect(linToPos(0, -10, 10)).toBe(0.5);
    expect(posToLin(0.25, -10, 10)).toBe(-5);
    expect(linToPos(5, 5, 5)).toBe(0);
    expect(valueToPos(1000, 20, 20000, 'log')).toBeCloseTo(freqToPos(1000));
    expect(posToValue(0.5, 0, 100)).toBe(50);
  });

  it('clamp, steps and snapping', () => {
    expect(clamp(Number.NaN, 1, 2)).toBe(1);
    expect(stepDecimals(0.01)).toBe(2);
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(1e-7)).toBe(7);
    expect(stepDecimals(0)).toBe(0);
    expect(snapToStep(0.7071, 0.1, 18, 0.01)).toBe(0.71);
    expect(snapToStep(7, 0, 10, 5)).toBe(5);
    expect(snapToStep(99, 0, 10, 0)).toBe(10);
  });

  it('logFrequencies spans the range', () => {
    const f = logFrequencies(4, 10, 10000);
    expect(f[0]).toBeCloseTo(10);
    expect(f[1]).toBeCloseTo(100);
    expect(f[3]).toBeCloseTo(10000);
    expect(logFrequencies(1)).toEqual([20]);
  });
});

describe('format', () => {
  it('formats decibels with sign', () => {
    expect(formatDb(6)).toBe('+6.0 dB');
    expect(formatDb(-12.34)).toBe('-12.3 dB');
    expect(formatDb(-0.01)).toBe('0.0 dB');
    expect(formatDb(Number.NEGATIVE_INFINITY)).toBe('-inf dB');
    expect(formatDb(3, 0, '')).toBe('+3');
  });

  it('formats frequencies', () => {
    expect(formatFreq(20)).toBe('20 Hz');
    expect(formatFreq(630)).toBe('630 Hz');
    expect(formatFreq(1600)).toBe('1.6 kHz');
    expect(formatFreq(10000)).toBe('10 kHz');
    expect(formatFreq(22050)).toBe('22.1 kHz');
    expect(formatFreq(Number.NaN)).toBe('-');
    expect(formatFreqShort(2500)).toBe('2.5k');
    expect(formatFreqShort(63)).toBe('63');
    expect(formatFreqCompact(1250)).toBe('1.25k');
    expect(formatFreqCompact(80.4)).toBe('80');
    expect(formatSampleRate(44100)).toBe('44.1 kHz');
    expect(formatSampleRate(22050)).toBe('22.05 kHz');
    expect(formatSampleRate(8000)).toBe('8 kHz');
  });

  it('formats byte sizes and percent changes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(-1)).toBe('-');
    expect(percentChange(200, 50)).toBe(-75);
    expect(percentChange(0, 50)).toBeNull();
  });

  it('formats generic numbers and time', () => {
    expect(formatNumber(1.005, 1, 'ms')).toBe('1.0 ms');
    expect(formatNumber(Number.NaN)).toBe('-');
    expect(formatSigned(3)).toBe('+3');
    expect(formatSigned(-0.001, 1)).toBe('0.0');
    expect(formatSigned(-2, 0, 'st')).toBe('-2 st');
    expect(formatTime(61.5)).toBe('1:01.500');
    expect(formatTime(3725.25)).toBe('1:02:05.250');
    expect(formatTime(-3)).toBe('0:00.000');
  });
});
