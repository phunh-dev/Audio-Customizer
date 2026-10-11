/** Locale-neutral number formatting for parameter read-outs. */

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** "+6.0 dB", "-12.5 dB", "0.0 dB", "-inf dB". */
export function formatDb(db: number, decimals = 1, unit = 'dB'): string {
  if (!Number.isFinite(db)) return db > 0 ? `+inf ${unit}` : `-inf ${unit}`;
  const r = Number(db.toFixed(decimals));
  const v = Object.is(r, -0) ? 0 : r;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)} ${unit}`.trimEnd();
}

/** "20 Hz", "630 Hz", "1.6 kHz", "10 kHz", "22.05 kHz". */
export function formatFreq(hz: number): string {
  if (!Number.isFinite(hz)) return '-';
  if (hz >= 1000) {
    const k = hz / 1000;
    const decimals = k >= 10 ? 1 : 2;
    return `${trimZeros(k.toFixed(decimals))} kHz`;
  }
  return `${trimZeros(hz.toFixed(hz >= 100 ? 0 : 1))} Hz`;
}

/** Compact axis label: "20", "100", "1k", "2.5k", "20k". */
export function formatFreqShort(hz: number): string {
  if (hz >= 1000) return `${trimZeros((hz / 1000).toFixed(1))}k`;
  return `${Math.round(hz)}`;
}

/** Sample rate label: 44100 -> "44.1 kHz", 8000 -> "8 kHz". */
export function formatSampleRate(rate: number): string {
  return `${trimZeros((rate / 1000).toFixed(3))} kHz`;
}

/** Byte size: 512 B, 1.5 KB, 12.3 MB, 1.02 GB (base 1024). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const decimals = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${trimZeros(v.toFixed(decimals))} ${units[i]}`;
}

/** Percent change from `before` to `after`: -62.5 means 62.5 % smaller. */
export function percentChange(before: number, after: number): number | null {
  if (!(before > 0) || !Number.isFinite(after)) return null;
  return ((after - before) / before) * 100;
}

/** Generic number with fixed decimals and optional unit. */
export function formatNumber(v: number, decimals = 0, unit?: string): string {
  if (!Number.isFinite(v)) return '-';
  const r = Number(v.toFixed(decimals));
  const s = (Object.is(r, -0) ? 0 : r).toFixed(decimals);
  return unit ? `${s} ${unit}` : s;
}

/** Signed number: "+3", "-12", "0". */
export function formatSigned(v: number, decimals = 0, unit?: string): string {
  const r = Number(v.toFixed(decimals));
  const n = Object.is(r, -0) ? 0 : r;
  const s = `${n > 0 ? '+' : ''}${n.toFixed(decimals)}`;
  return unit ? `${s} ${unit}` : s;
}

/** Seconds -> "m:ss.mmm" (or "h:mm:ss.mmm"). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const h = Math.floor(totalM / 60);
  const pad = (n: number, w: number) => n.toString().padStart(w, '0');
  return h > 0 ? `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}` : `${m}:${pad(s, 2)}.${pad(ms, 3)}`;
}

/** Editable frequency read-out without unit: "80", "1.25k", "12k". */
export function formatFreqCompact(hz: number): string {
  if (!Number.isFinite(hz)) return '-';
  if (hz >= 1000) return `${trimZeros((hz / 1000).toFixed(2))}k`;
  return `${Math.round(hz)}`;
}
