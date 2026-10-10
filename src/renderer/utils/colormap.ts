/** Perceptual colormaps (magma / inferno) as 256-entry RGB lookup tables. */

export type ColormapName = 'magma' | 'inferno';

type Stop = [number, number, number, number]; // t, r, g, b

const MAGMA: Stop[] = [
  [0.0, 0, 0, 4],
  [0.125, 28, 16, 68],
  [0.25, 79, 18, 123],
  [0.375, 129, 37, 129],
  [0.5, 181, 54, 122],
  [0.625, 229, 80, 100],
  [0.75, 251, 135, 97],
  [0.875, 254, 194, 135],
  [1.0, 252, 253, 191],
];

const INFERNO: Stop[] = [
  [0.0, 0, 0, 4],
  [0.125, 31, 12, 72],
  [0.25, 85, 15, 109],
  [0.375, 136, 34, 106],
  [0.5, 186, 54, 85],
  [0.625, 227, 89, 51],
  [0.75, 249, 140, 10],
  [0.875, 249, 201, 50],
  [1.0, 252, 255, 164],
];

function interpolate(stops: Stop[], t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    if (x <= b[0]) {
      const a = stops[i - 1]!;
      const f = (x - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f),
        Math.round(a[3] + (b[3] - a[3]) * f),
      ];
    }
  }
  const last = stops[stops.length - 1]!;
  return [last[1], last[2], last[3]];
}

const cache = new Map<ColormapName, Uint8Array>();

/** 256 * 3 bytes (r,g,b per index). */
export function colormapLut(name: ColormapName = 'magma'): Uint8Array {
  const hit = cache.get(name);
  if (hit) return hit;
  const stops = name === 'magma' ? MAGMA : INFERNO;
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = interpolate(stops, i / 255);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  cache.set(name, lut);
  return lut;
}

/** Map a u8 intensity buffer to RGBA pixels (alpha 255). */
export function applyColormap(values: Uint8Array, name: ColormapName = 'magma', out?: Uint8ClampedArray): Uint8ClampedArray {
  const lut = colormapLut(name);
  const rgba = out ?? new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! * 3;
    const o = i * 4;
    rgba[o] = lut[v]!;
    rgba[o + 1] = lut[v + 1]!;
    rgba[o + 2] = lut[v + 2]!;
    rgba[o + 3] = 255;
  }
  return rgba;
}
