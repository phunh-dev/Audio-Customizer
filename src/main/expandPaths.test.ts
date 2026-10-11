import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandPaths, isSupportedAudioPath, sortPaths } from './expandPaths';

let root: string;

function touch(...parts: string[]): string {
  const p = join(root, ...parts);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, 'x');
  return p;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ac-expand-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('isSupportedAudioPath', () => {
  it('accepts the 6 extensions case-insensitively', () => {
    for (const f of ['a.mp3', 'b.WAV', 'c.Aiff', 'd.aif', 'e.OGG', 'f.flac']) {
      expect(isSupportedAudioPath(f)).toBe(true);
    }
  });
  it('rejects others', () => {
    for (const f of ['a.txt', 'b', 'c.wav.bak', 'mp3', '.wav2', 'x.m4a']) {
      expect(isSupportedAudioPath(f)).toBe(false);
    }
  });
});

describe('sortPaths', () => {
  it('sorts naturally', () => {
    expect(sortPaths(['/a/sfx10.wav', '/a/sfx2.wav', '/a/Sfx1.wav'])).toEqual(['/a/Sfx1.wav', '/a/sfx2.wav', '/a/sfx10.wav']);
  });
});

describe('expandPaths', () => {
  it('scans folders recursively and filters extensions', async () => {
    const a = touch('a.wav');
    const b = touch('sub', 'deep', 'b.MP3');
    const c = touch('sub', 'c.flac');
    touch('sub', 'notes.txt');
    touch('sub', 'deep', 'image.png');
    const out = await expandPaths([root]);
    expect(out).toEqual(sortPaths([a, b, c].map((p) => resolve(p))));
  });

  it('mixes files and folders, dedups and sorts', async () => {
    const a = touch('z', 'a.ogg');
    const b = touch('b.aif');
    const out = await expandPaths([b, join(root, 'z'), a, root, b]);
    expect(out).toEqual(sortPaths([resolve(a), resolve(b)]));
    expect(new Set(out).size).toBe(out.length);
  });

  it('dedups case-insensitively when requested', async () => {
    const a = touch('Song.wav');
    const out = await expandPaths([a, a.toUpperCase().replace(root.toUpperCase(), root)], { caseInsensitive: true });
    expect(out).toHaveLength(1);
  });

  it('skips missing paths, unsupported files and bad input', async () => {
    const txt = touch('readme.txt');
    const out = await expandPaths([join(root, 'missing.wav'), txt, '', 42 as unknown as string]);
    expect(out).toEqual([]);
  });

  it('returns empty for an empty folder', async () => {
    mkdirSync(join(root, 'empty'));
    expect(await expandPaths([join(root, 'empty')])).toEqual([]);
  });

  it('survives symlink loops', async () => {
    const a = touch('loop', 'x.wav');
    try {
      symlinkSync(join(root, 'loop'), join(root, 'loop', 'again'), 'junction');
    } catch {
      // symlinks may be unavailable; the scan must still work
    }
    const out = await expandPaths([root]);
    expect(out).toEqual([resolve(a)]);
  });
});
