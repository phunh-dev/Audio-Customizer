/**
 * Biquad filter math (RBJ "Audio EQ Cookbook"), mirroring the Rust engine
 * implementation in `crates/audio-core/src/dsp/biquad.rs`. Used by the UI to
 * draw live frequency-response curves; the actual audio is processed in Rust.
 */

export type BiquadKind =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'notch'
  | 'peaking'
  | 'lowShelf'
  | 'highShelf';

/** Normalised coefficients (a0 = 1). */
export interface Coeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export const IDENTITY: Readonly<Coeffs> = Object.freeze({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });

/** Clamp the design frequency into (1 Hz, 0.49 fs) like the Rust engine. */
export function clampDesignFreq(freq: number, sampleRate: number): number {
  const max = 0.49 * sampleRate;
  if (!Number.isFinite(freq)) return Math.min(1000, max);
  return Math.min(Math.max(freq, 1), max);
}

/** Design one biquad section. */
export function biquadCoeffs(
  kind: BiquadKind,
  freq: number,
  q: number,
  gainDb: number,
  sampleRate: number,
): Coeffs {
  const f = clampDesignFreq(freq, sampleRate);
  const qq = Math.max(Number.isFinite(q) ? q : 0.7071, 1e-4);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * qq);
  const A = Math.pow(10, gainDb / 40);

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (kind) {
    case 'lowpass':
      b0 = (1 - cosw) / 2;
      b1 = 1 - cosw;
      b2 = (1 - cosw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosw) / 2;
      b1 = -(1 + cosw);
      b2 = (1 + cosw) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case 'bandpass':
      // constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cosw;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosw;
      a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cosw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw;
      a2 = 1 - alpha / A;
      break;
    case 'lowShelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cosw + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cosw);
      b2 = A * (A + 1 - (A - 1) * cosw - s);
      a0 = A + 1 + (A - 1) * cosw + s;
      a1 = -2 * (A - 1 + (A + 1) * cosw);
      a2 = A + 1 + (A - 1) * cosw - s;
      break;
    }
    case 'highShelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cosw + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cosw);
      b2 = A * (A + 1 + (A - 1) * cosw - s);
      a0 = A + 1 - (A - 1) * cosw + s;
      a1 = 2 * (A - 1 - (A + 1) * cosw);
      a2 = A + 1 - (A - 1) * cosw - s;
      break;
    }
    default: {
      const never: never = kind;
      throw new Error(`unknown biquad kind ${String(never)}`);
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Squared magnitude |H(e^jw)|^2 of one section at `freq`. */
export function magnitudeSquared(c: Coeffs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const c2w = Math.cos(2 * w);
  const s2w = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cw + c.b2 * c2w;
  const ni = -(c.b1 * sw + c.b2 * s2w);
  const dr = 1 + c.a1 * cw + c.a2 * c2w;
  const di = -(c.a1 * sw + c.a2 * s2w);
  const den = dr * dr + di * di;
  if (den <= 0) return Number.POSITIVE_INFINITY;
  return (nr * nr + ni * ni) / den;
}

/** Magnitude response in dB of one section. Floors at -240 dB. */
export function magnitudeDb(c: Coeffs, freq: number, sampleRate: number): number {
  const m2 = magnitudeSquared(c, freq, sampleRate);
  return 10 * Math.log10(Math.max(m2, 1e-24));
}

/** Magnitude response in dB of a cascade (sum of the section responses). */
export function cascadeMagnitudeDb(cascade: readonly Coeffs[], freq: number, sampleRate: number): number {
  let db = 0;
  for (const c of cascade) db += magnitudeDb(c, freq, sampleRate);
  return db;
}

/**
 * Q values of the second-order sections of an even-order Butterworth filter.
 * order 2 -> [0.7071], 4 -> [0.5412, 1.3066], 8 -> [0.5098, 0.6013, 0.9000, 2.5629].
 */
export function butterworthQs(order: number): number[] {
  const n = Math.max(2, Math.round(order / 2) * 2);
  const qs: number[] = [];
  for (let k = 0; k < n / 2; k++) {
    const theta = (Math.PI * (2 * k + 1)) / (2 * n);
    qs.push(1 / (2 * Math.sin(theta)));
  }
  return qs.sort((a, b) => a - b);
}
