/**
 * Frequency responses of the filter bank and the 16-band EQ, mirroring the
 * Rust designs in `dsp/filter.rs` and `dsp/eq.rs`.
 */
import type { EqSettings, FilterBand, FilterSettings, FilterType } from '@shared/types';
import { biquadCoeffs, butterworthQs, cascadeMagnitudeDb, type BiquadKind, type Coeffs } from './biquad';

export const DEFAULT_RESPONSE_SAMPLE_RATE = 48000;

const KIND_OF: Record<FilterType, BiquadKind> = {
  highpass: 'highpass',
  lowpass: 'lowpass',
  bandpass: 'bandpass',
  notch: 'notch',
  lowshelf: 'lowShelf',
  highshelf: 'highShelf',
};

export function filterKind(type: FilterType): BiquadKind {
  return KIND_OF[type];
}

/** Whether the slope parameter applies to this filter type (shelves are single-section). */
export function filterUsesSlope(type: FilterType): boolean {
  return type !== 'lowshelf' && type !== 'highshelf';
}

/** Whether the gain parameter applies to this filter type. */
export function filterUsesGain(type: FilterType): boolean {
  return type === 'lowshelf' || type === 'highshelf';
}

/**
 * Design the biquad cascade of one filter band.
 * HP/LP with slope 12 use the band Q; slope 24/48 use Butterworth section Qs
 * (order 4 / 8). Band-pass / notch repeat the section slope/12 times (1, 2, 4);
 * shelves are a single section. Mirrors `design` in `dsp/filter.rs`.
 */
export function designFilterBand(band: FilterBand, sampleRate: number): Coeffs[] {
  const kind = filterKind(band.type);
  const stages = band.slope <= 12 ? 1 : band.slope <= 24 ? 2 : 4;
  if ((band.type === 'highpass' || band.type === 'lowpass') && stages > 1) {
    const order = stages * 2;
    return butterworthQs(order).map((q) => biquadCoeffs(kind, band.freq, q, 0, sampleRate));
  }
  if (band.type === 'bandpass' || band.type === 'notch') {
    return Array.from({ length: stages }, () => biquadCoeffs(kind, band.freq, band.q, 0, sampleRate));
  }
  const gain = filterUsesGain(band.type) ? band.gainDb : 0;
  return [biquadCoeffs(kind, band.freq, band.q, gain, sampleRate)];
}

/** All sections of the enabled bands (empty when the filter bank is disabled). */
export function designFilters(s: FilterSettings, sampleRate: number, ignoreEnabled = false): Coeffs[] {
  if (!s.enabled && !ignoreEnabled) return [];
  return s.items.filter((b) => b.enabled).flatMap((b) => designFilterBand(b, sampleRate));
}

/** EQ sections: skips flat bands and bands at/above 0.49 fs (like Rust). */
export function designEq(s: EqSettings, sampleRate: number, ignoreEnabled = false): Coeffs[] {
  if (!s.enabled && !ignoreEnabled) return [];
  return s.bands
    .filter((b) => Math.abs(b.gainDb) >= 0.01 && b.freq < 0.49 * sampleRate)
    .map((b) => biquadCoeffs('peaking', b.freq, b.q, b.gainDb, sampleRate));
}

/** Evaluate a cascade at each frequency, in dB. */
export function responseDb(cascade: readonly Coeffs[], freqs: readonly number[], sampleRate: number): number[] {
  return freqs.map((f) => (f >= sampleRate / 2 ? cascadeMagnitudeDb(cascade, sampleRate / 2 - 1, sampleRate) : cascadeMagnitudeDb(cascade, f, sampleRate)));
}

export function filterBandResponseDb(band: FilterBand, freqs: readonly number[], sampleRate = DEFAULT_RESPONSE_SAMPLE_RATE): number[] {
  return responseDb(designFilterBand(band, sampleRate), freqs, sampleRate);
}

export function filtersResponseDb(
  s: FilterSettings,
  freqs: readonly number[],
  sampleRate = DEFAULT_RESPONSE_SAMPLE_RATE,
  ignoreEnabled = false,
): number[] {
  return responseDb(designFilters(s, sampleRate, ignoreEnabled), freqs, sampleRate);
}

export function eqResponseDb(
  s: EqSettings,
  freqs: readonly number[],
  sampleRate = DEFAULT_RESPONSE_SAMPLE_RATE,
  ignoreEnabled = false,
): number[] {
  return responseDb(designEq(s, sampleRate, ignoreEnabled), freqs, sampleRate);
}
