/**
 * Expand dropped / picked files and folders to the list of supported audio
 * files: recursive folder scan, extension filter (case-insensitive),
 * de-duplication, natural sort. Missing or unreadable entries are skipped.
 */
import { readdir, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { SUPPORTED_EXTENSIONS } from '@shared/types';

export function isSupportedAudioPath(p: string): boolean {
  const ext = extname(p).slice(1).toLowerCase();
  return ext.length > 0 && SUPPORTED_EXTENSIONS.includes(ext);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

export interface ExpandOptions {
  /** de-duplicate case-insensitively (default: true on Windows/macOS) */
  caseInsensitive?: boolean;
}

export async function expandPaths(paths: readonly string[], opts: ExpandOptions = {}): Promise<string[]> {
  const caseInsensitive = opts.caseInsensitive ?? (process.platform === 'win32' || process.platform === 'darwin');
  const keyOf = (p: string) => (caseInsensitive ? p.toLowerCase() : p);
  const found = new Map<string, string>();
  const visitedDirs = new Set<string>();

  const addFile = (p: string) => {
    const abs = resolve(p);
    const k = keyOf(abs);
    if (!found.has(k)) found.set(k, abs);
  };

  const walk = async (dir: string): Promise<void> => {
    let real: string;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    const k = keyOf(real);
    if (visitedDirs.has(k)) return; // symlink loops / duplicates
    visitedDirs.add(k);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(child);
      } else if (e.isFile()) {
        if (isSupportedAudioPath(child)) addFile(child);
      } else if (e.isSymbolicLink()) {
        await visit(child);
      }
    }
  };

  const visit = async (p: string): Promise<void> => {
    let st;
    try {
      st = await stat(p);
    } catch {
      return;
    }
    if (st.isDirectory()) await walk(resolve(p));
    else if (st.isFile() && isSupportedAudioPath(p)) addFile(p);
  };

  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) continue;
    await visit(p);
  }
  return sortPaths([...found.values()]);
}
