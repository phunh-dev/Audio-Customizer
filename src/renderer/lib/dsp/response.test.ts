import { describe, expect, it } from 'vitest';
import { createDefaultEq, createDefaultFilterBand, type FilterBand } from '@shared/types';
import {
  designEq,
  designFilterBand,
  designFilters,
  eqResponseDb,
  filterBandResponseDb,
  filterKind,
  filterUsesGain,
  filterUsesSlope,
  filtersResponseDb,
  responseDb,
} from './response';

const band = (p: Partial<FilterBand>): FilterBand => ({ ...createDefaultFilterBand('b'), ...p });

describe('filter design', () => {
  it('maps filter types to biquad kinds and parameter usage', () => {
    expect(filterKind('lowshelf')).toBe('lowShelf');
    expect(filterKind('highshelf')).toBe('highShelf');
    expect(filterUsesSlope('highpass')).toBe(true);
    expect(filterUsesSlope('notch')).toBe(true);
    expect(filterUsesSlope('bandpass')).toBe(true);
    expect(filterUsesSlope('lowshelf')).toBe(false);
    expect(filterUsesGain('lowshelf')).toBe(true);
    expect(filterUsesGain('bandpass')).toBe(false);
  });

  it('slope 12/24/48 -> 1/2/4 sections (HP/LP/BP/notch), shelves always 1', () => {
    expect(designFilterBand(band({ type: 'highpass', slope: 12 }), 48000)).toHaveLength(1);
    expect(designFilterBand(band({ type: 'highpass', slope: 24 }), 48000)).toHaveLength(2);
    expect(designFilterBand(band({ type: 'lowpass', slope: 48 }), 48000)).toHaveLength(4);
    expect(designFilterBand(band({ type: 'notch', slope: 48 }), 48000)).toHaveLength(4);
    expect(designFilterBand(band({ type: 'bandpass', slope: 24 }), 48000)).toHaveLength(2);
    expect(designFilterBand(band({ type: 'lowshelf', slope: 48 }), 48000)).toHaveLength(1);
  });

  it('every slope of a Butterworth HP is -3 dB at the cutoff with steeper roll-off', () => {
    const freqs = [1000, 125];
    const r12 = filterBandResponseDb(band({ type: 'highpass', freq: 1000, slope: 12 }), freqs);
    const r24 = filterBandResponseDb(band({ type: 'highpass', freq: 1000, slope: 24 }), freqs);
    const r48 = filterBandResponseDb(band({ type: 'highpass', freq: 1000, slope: 48 }), freqs);
    for (const r of [r12, r24, r48]) expect(r[0]).toBeCloseTo(-3.01, 1);
    // 3 octaves below: ~ -36 / -72 / -144 dB
    expect(r12[1]!).toBeLessThan(-33);
    expect(r24[1]!).toBeLessThan(-68);
    expect(r48[1]!).toBeLessThan(-135);
  });

  it('shelf gain only applies to shelves', () => {
    const shelf = filterBandResponseDb(band({ type: 'lowshelf', freq: 200, gainDb: 6 }), [20]);
    expect(shelf[0]).toBeCloseTo(6, 0);
    const bp = filterBandResponseDb(band({ type: 'bandpass', freq: 1000, gainDb: 12, q: 1 }), [1000]);
    expect(bp[0]).toBeCloseTo(0, 3);
  });

  it('designFilters honours the bank and per-band enable flags', () => {
    const s = { enabled: false, items: [band({ type: 'highpass' }), band({ id: 'x', type: 'lowpass', enabled: false })] };
    expect(designFilters(s, 48000)).toHaveLength(0);
    expect(designFilters(s, 48000, true)).toHaveLength(1);
    expect(designFilters({ ...s, enabled: true }, 48000)).toHaveLength(1);
    expect(filtersResponseDb({ ...s, enabled: true }, [20000])[0]).toBeCloseTo(0, 1);
  });
});

describe('EQ design', () => {
  it('skips flat bands and bands at/above 0.49 fs', () => {
    const eq = createDefaultEq();
    eq.enabled = true;
    expect(designEq(eq, 48000)).toHaveLength(0);
    eq.bands[8]!.gainDb = 6;
    eq.bands[15]!.gainDb = 6; // 20 kHz
    expect(designEq(eq, 48000)).toHaveLength(2);
    expect(designEq(eq, 32000)).toHaveLength(1); // 20 kHz >= 15.68 kHz
  });

  it('response peaks at the band gain at its centre', () => {
    const eq = createDefaultEq();
    eq.enabled = true;
    eq.bands[8]!.gainDb = 6; // 1 kHz
    expect(eqResponseDb(eq, [1000])[0]).toBeCloseTo(6, 1);
    eq.enabled = false;
    expect(eqResponseDb(eq, [1000])[0]).toBe(0);
    expect(eqResponseDb(eq, [1000], 48000, true)[0]).toBeCloseTo(6, 1);
  });

  it('responseDb evaluates frequencies at/above Nyquist safely', () => {
    const r = responseDb([], [30000], 48000);
    expect(r[0]).toBe(0);
  });
});
