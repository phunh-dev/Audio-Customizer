/**
 * Locale checks for the "effects" and "export" groups:
 * - en and vi have exactly the same keys
 * - no empty strings, same {{placeholders}} in both languages
 * - every literal t('effects.…') / t('export.…') key used in the source exists
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import enEffects from '../../locales/en/effects.json';
import viEffects from '../../locales/vi/effects.json';
import enExport from '../../locales/en/export.json';
import viExport from '../../locales/vi/export.json';

type Json = { [k: string]: string | Json };

function flatten(obj: Json, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const groups = {
  effects: { en: flatten(enEffects as Json), vi: flatten(viEffects as Json) },
  export: { en: flatten(enExport as Json), vi: flatten(viExport as Json) },
};

describe.each(Object.entries(groups))('locale group "%s"', (_name, { en, vi }) => {
  it('en and vi have the same keys', () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty values and the same placeholders', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v.trim(), `en ${k}`).not.toBe('');
      expect(vi[k]?.trim(), `vi ${k}`).not.toBe('');
      expect(placeholders(vi[k] ?? ''), `placeholders of ${k}`).toEqual(placeholders(v));
    }
  });
});

describe('Vietnamese texts', () => {
  it('use diacritics (not ASCII-only transliteration)', () => {
    const all = [...Object.values(groups.effects.vi), ...Object.values(groups.export.vi)].join(' ');
    expect(all).toMatch(/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i);
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('keys used in code', () => {
  it('every literal effects./export. key exists in English', () => {
    const root = resolve(__dirname, '../..');
    const files = [
      ...sourceFiles(join(root, 'features/effects')),
      ...sourceFiles(join(root, 'features/export')),
      ...sourceFiles(join(root, 'components/ui')),
    ];
    const missing: string[] = [];
    let count = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'((?:effects|export)\.[\w.]+)'/g)) {
        count++;
        const [group, ...rest] = m[1]!.split('.');
        const dict = groups[group as keyof typeof groups].en;
        const key = rest.join('.');
        // plain keys or object prefixes (e.g. used with template suffixes)
        if (!(key in dict) && !Object.keys(dict).some((k) => k.startsWith(`${key}.`))) missing.push(`${m[1]} (${f})`);
      }
      for (const m of src.matchAll(/\bt\(\s*`((?:effects|export)\.[\w.]+)\.\$\{/g)) {
        const [group, ...rest] = m[1]!.split('.');
        const dict = groups[group as keyof typeof groups].en;
        if (!Object.keys(dict).some((k) => k.startsWith(`${rest.join('.')}.`))) missing.push(`${m[1]}.* (${f})`);
      }
    }
    expect(count).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('dynamic key families are complete', () => {
    const en = groups.export.en;
    for (const r of [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 96000]) expect(en[`sampleRateHint.${r}`]).toBeTruthy();
    for (const f of ['wav', 'aiff', 'flac', 'mp3', 'ogg']) {
      expect(en[`formats.${f}`]).toBeTruthy();
      expect(en[`formatHint.${f}`]).toBeTruthy();
    }
    for (const c of ['bitDepth', 'vbrQuality', 'sampleRate', 'mp3SampleRate', 'mp3Bitrate', 'mp3Channels', 'oggBitrate']) {
      expect(en[`validation.${c}`]).toBeTruthy();
    }
    const fx = groups.effects.en;
    for (const id of ['flat', 'bassBoost', 'trebleBoost', 'vocalPresence', 'loFi', 'telephone']) expect(fx[`eq.presets.${id}`]).toBeTruthy();
    for (const ty of ['highpass', 'lowpass', 'bandpass', 'notch', 'lowshelf', 'highshelf']) {
      expect(fx[`filters.types.${ty}`]).toBeTruthy();
      expect(fx[`filters.typeHints.${ty}`]).toBeTruthy();
    }
    for (const c of ['linear', 'exponential', 'logarithmic', 'sCurve', 'equalPower']) expect(fx[`curves.${c}`]).toBeTruthy();
    for (const id of ['sfxMobile', 'bgm', 'voice', 'losslessMaster']) {
      expect(fx[`optimize.presets.${id}.name`]).toBeTruthy();
      expect(fx[`optimize.presets.${id}.detail`]).toBeTruthy();
    }
  });
});
