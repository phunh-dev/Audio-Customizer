/**
 * i18n setup. Translations live in `src/renderer/locales/<lang>/<group>.json`
 * (one folder per language, one file per feature group so translators can edit
 * them independently). Each file becomes the top-level key named after the file:
 *   locales/en/app.json  { "tabs": { "new": "New tab" } }  ->  t('app.tabs.new')
 * A file may also wrap its content in a single key equal to the file name
 * ({ "app": { ... } }); it is unwrapped automatically.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readJson } from '../utils/storage';

export const LANGUAGES = ['en', 'vi'] as const;
export type LanguageCode = (typeof LANGUAGES)[number];
export const FALLBACK_LANGUAGE: LanguageCode = 'en';

type Json = Record<string, unknown>;

const modules = import.meta.glob<Json>('../locales/*/*.json', { eager: true, import: 'default' });

/** Build `{ en: { app: {...}, effects: {...} }, vi: {...} }` from glob results. */
export function buildResources(mods: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [path, content] of Object.entries(mods)) {
    const m = /locales\/([^/]+)\/([^/]+)\.json$/.exec(path.replace(/\\/g, '/'));
    if (!m) continue;
    const lang = m[1]!;
    const group = m[2]!;
    const keys = Object.keys(content);
    const body =
      keys.length === 1 && keys[0] === group && typeof content[group] === 'object' ? (content[group] as Json) : content;
    out[lang] ??= {};
    out[lang][group] = body;
  }
  return out;
}

export const translations = buildResources(modules);

/** Language persisted by the settings store (same storage key). */
export function initialLanguage(): LanguageCode {
  const s = readJson<{ language?: string }>('audio-customizer.settings', {});
  return s.language === 'vi' ? 'vi' : 'en';
}

const resources = Object.fromEntries(Object.entries(translations).map(([lang, tr]) => [lang, { translation: tr }]));

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: [...LANGUAGES],
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

export default i18n;
