import { describe, expect, it } from 'vitest';
import { biquadCoeffs, butterworthQs, cascadeMagnitudeDb, clampDesignFreq, IDENTITY, magnitudeDb } from './biquad';

const FS = 48000;
const BW = Math.SQRT1_2;

describe('biquad (RBJ cookbook)', () => {
  it('Butterworth low-pass is -3.01 dB at the cutoff, 0 dB at DC, -40 dB a decade above', () => {
    const c = biquadCoeffs('lowpass', 1000, BW, 0, FS);
    expect(magnitudeDb(c, 1000, FS)).toBeCloseTo(-3.0103, 2);
    expect(magnitudeDb(c, 1, FS)).toBeCloseTo(0, 3);
    // far from Nyquist the bilinear transform matches the analog 12 dB/oct slope
    const low = biquadCoeffs('lowpass', 100, BW, 0, FS);
    expect(magnitudeDb(low, 100, FS)).toBeCloseTo(-3.0103, 2);
    expect(magnitudeDb(low, 1000, FS)).toBeCloseTo(-40, 0);
  });

  it('Butterworth high-pass is -3.01 dB at the cutoff and flat at high frequencies', () => {
    const c = biquadCoeffs('highpass', 500, BW, 0, FS);
    expect(magnitudeDb(c, 500, FS)).toBeCloseTo(-3.0103, 2);
    expect(magnitudeDb(c, 15000, FS)).toBeCloseTo(0, 1);
    expect(magnitudeDb(c, 50, FS)).toBeLessThan(-39);
  });

  it('peaking +6 dB has +6 dB at the centre and ~0 dB far away', () => {
    const c = biquadCoeffs('peaking', 1000, 1.4, 6, FS);
    expect(magnitudeDb(c, 1000, FS)).toBeCloseTo(6, 4);
    expect(magnitudeDb(c, 20, FS)).toBeCloseTo(0, 1);
    const cut = biquadCoeffs('peaking', 1000, 1.4, -12, FS);
    expect(magnitudeDb(cut, 1000, FS)).toBeCloseTo(-12, 4);
  });

  it('band-pass peaks at 0 dB at the centre', () => {
    const c = biquadCoeffs('bandpass', 2000, 2, 0, FS);
    expect(magnitudeDb(c, 2000, FS)).toBeCloseTo(0, 4);
    expect(magnitudeDb(c, 200, FS)).toBeLessThan(-15);
  });

  it('notch removes the centre frequency', () => {
    const c = biquadCoeffs('notch', 60, 10, 0, FS);
    expect(magnitudeDb(c, 60, FS)).toBeLessThan(-60);
    expect(magnitudeDb(c, 1000, FS)).toBeCloseTo(0, 1);
  });

  it('shelves reach their gain on their side and 0 dB on the other', () => {
    const lo = biquadCoeffs('lowShelf', 200, BW, 6, FS);
    expect(magnitudeDb(lo, 10, FS)).toBeCloseTo(6, 1);
    expect(magnitudeDb(lo, 200, FS)).toBeCloseTo(3, 0);
    expect(magnitudeDb(lo, 15000, FS)).toBeCloseTo(0, 1);
    const hi = biquadCoeffs('highShelf', 4000, BW, -9, FS);
    expect(magnitudeDb(hi, 23000, FS)).toBeCloseTo(-9, 0);
    expect(magnitudeDb(hi, 20, FS)).toBeCloseTo(0, 2);
  });

  it('identity has 0 dB everywhere and cascades add up', () => {
    expect(magnitudeDb(IDENTITY, 1234, FS)).toBeCloseTo(0, 10);
    const p = biquadCoeffs('peaking', 1000, 1, 3, FS);
    expect(cascadeMagnitudeDb([p, p], 1000, FS)).toBeCloseTo(6, 4);
    expect(cascadeMagnitudeDb([], 1000, FS)).toBe(0);
  });

  it('Butterworth section Qs match the known tables', () => {
    expect(butterworthQs(2)).toEqual([expect.closeTo(0.7071, 4)]);
    const q4 = butterworthQs(4);
    expect(q4[0]).toBeCloseTo(0.5412, 4);
    expect(q4[1]).toBeCloseTo(1.3066, 4);
    const q8 = butterworthQs(8);
    expect(q8.map((q) => Number(q.toFixed(4)))).toEqual([0.5098, 0.6013, 0.9, 2.5629]);
  });

  it('4th and 8th order Butterworth cascades are -3.01 dB at the cutoff', () => {
    for (const order of [4, 8]) {
      const cascade = butterworthQs(order).map((q) => biquadCoeffs('lowpass', 1000, q, 0, FS));
      expect(cascadeMagnitudeDb(cascade, 1000, FS)).toBeCloseTo(-3.0103, 1);
      // slope: order * 6 dB/oct -> one decade above ≈ -order*20 dB
      expect(cascadeMagnitudeDb(cascade, 10000, FS)).toBeLessThan(-order * 20 + 3);
    }
  });

  it('clamps the design frequency into (1 Hz, 0.49 fs) and tolerates bad input', () => {
    expect(clampDesignFreq(0, FS)).toBe(1);
    expect(clampDesignFreq(30000, FS)).toBeCloseTo(0.49 * FS);
    expect(clampDesignFreq(Number.NaN, FS)).toBe(1000);
    const c = biquadCoeffs('lowpass', 1e9, 0, 0, FS);
    expect(Number.isFinite(c.b0)).toBe(true);
  });
});
