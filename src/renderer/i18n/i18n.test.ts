import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import i18n, { buildResources, initialLanguage, translations } from './index';
import { ERROR_CODES } from '@shared/api';

const RENDERER = resolve(__dirname, '..');
const LOCALES = join(RENDERER, 'locales');

type Json = Record<string, unknown>;

function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Json)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  } else {
    out[prefix] = obj;
  }
  return out;
}

function walk(dir: string, filter: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

const languages = readdirSync(LOCALES).filter((d) => statSync(join(LOCALES, d)).isDirectory());

describe('locale files', () => {
  it('has English and Vietnamese folders', () => {
    expect(languages.sort()).toEqual(['en', 'vi']);
  });

  const files = readdirSync(join(LOCALES, 'en')).filter((f) => f.endsWith('.json'));

  it('every language has the same set of files', () => {
    for (const lang of languages) {
      expect(readdirSync(join(LOCALES, lang)).filter((f) => f.endsWith('.json')).sort()).toEqual([...files].sort());
    }
  });

  for (const file of files) {
    it(`${file}: same keys in every language, no empty values`, () => {
      const flat = Object.fromEntries(
        languages.map((lang) => [lang, flatten(JSON.parse(readFileSync(join(LOCALES, lang, file), 'utf8')))]),
      );
      const enKeys = Object.keys(flat.en!).sort();
      expect(enKeys.length).toBeGreaterThan(0);
      for (const lang of languages) {
        expect(Object.keys(flat[lang]!).sort(), `${lang}/${file} keys`).toEqual(enKeys);
        for (const [k, v] of Object.entries(flat[lang]!)) {
          expect(typeof v, `${lang}/${file}: ${k}`).toBe('string');
          expect((v as string).trim().length, `${lang}/${file}: ${k} is empty`).toBeGreaterThan(0);
        }
      }
    });
  }

  it('interpolation placeholders match between languages', () => {
    for (const file of files) {
      const en = flatten(JSON.parse(readFileSync(join(LOCALES, 'en', file), 'utf8')));
      const vi = flatten(JSON.parse(readFileSync(join(LOCALES, 'vi', file), 'utf8')));
      for (const [k, v] of Object.entries(en)) {
        const vars = (s: unknown) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
        expect(vars(vi[k]), `${file}: ${k}`).toEqual(vars(v));
      }
    }
  });

  it('has a translation for every engine error code', () => {
    for (const code of ERROR_CODES) {
      expect(i18n.exists(`errors.${code}`, { lng: 'en' }), code).toBe(true);
      expect(i18n.exists(`errors.${code}`, { lng: 'vi' }), code).toBe(true);
    }
  });
});

describe('i18n runtime', () => {
  it('loads every group of every language by ID', () => {
    expect(Object.keys(translations).sort()).toEqual(['en', 'vi']);
    expect(i18n.t('app.tabs.new', { lng: 'en' })).toBe('New tab');
    expect(i18n.t('app.tabs.new', { lng: 'vi' })).toBe('Tab mới');
    expect(i18n.t('app.tabs.defaultName', { lng: 'en', n: 3 })).toBe('Session 3');
  });

  it('merges files by group name and unwraps a self-named root key', () => {
    const res = buildResources({
      '../locales/en/app.json': { a: '1' },
      '../locales/en/effects.json': { effects: { b: '2' } },
      '..\\locales\\vi\\app.json': { a: 'một' },
      'other/path.json': { ignored: true },
    });
    expect(res).toEqual({ en: { app: { a: '1' }, effects: { b: '2' } }, vi: { app: { a: 'một' } } });
  });

  it('reads the persisted language', () => {
    expect(initialLanguage()).toBe('en');
    localStorage.setItem('audio-customizer.settings', JSON.stringify({ language: 'vi' }));
    expect(initialLanguage()).toBe('vi');
  });
});

describe('no hard-coded UI text', () => {
  const TEXT_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'aria-description', 'aria-valuetext']);
  const LETTER = /\p{L}/u;

  function findHardcoded(source: string, fileName: string): string[] {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const problems: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isJsxText(node)) {
        const text = node.getText(sf).trim();
        if (text && LETTER.test(text)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          problems.push(`${fileName}:${line + 1} "${text}"`);
        }
      } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const name = node.name.getText(sf);
        if (TEXT_ATTRS.has(name) && LETTER.test(node.initializer.text)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          problems.push(`${fileName}:${line + 1} ${name}="${node.initializer.text}"`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return problems;
  }

  it('detects hard-coded text (self-check)', () => {
    const bad = findHardcoded('const a = <div title="Hello">Click me <b>{x}</b> 42 % </div>;', 'x.tsx');
    expect(bad).toHaveLength(2);
    expect(findHardcoded('const a = <div aria-label={t("k")}>{t("k")} 12:00 / + </div>;', 'y.tsx')).toEqual([]);
  });

  it('no .tsx file under src/renderer contains literal UI text', () => {
    const files = walk(RENDERER, (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));
    expect(files.length).toBeGreaterThan(5);
    const problems = files.flatMap((f) => findHardcoded(readFileSync(f, 'utf8'), relative(RENDERER, f)));
    expect(problems).toEqual([]);
  });
});
