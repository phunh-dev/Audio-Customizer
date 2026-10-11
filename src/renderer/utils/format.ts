/** Locale-neutral formatting helpers for the shell (numbers only, never words). */

/** 512 B, 1.5 KB, 12.3 MB (base 1024). */
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
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** "-1.2 dB" / "-inf dB" */
export function formatDb(db: number | null | undefined, decimals = 1): string {
  if (db === null || db === undefined || !Number.isFinite(db)) return '-inf';
  return db.toFixed(decimals);
}

/** 1000 -> "1k", 2500 -> "2.5k", 100 -> "100" */
export function formatHzShort(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${Math.round(hz)}`;
}
