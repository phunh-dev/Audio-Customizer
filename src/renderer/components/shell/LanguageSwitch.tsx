import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { useAppStore, type Language } from '../../store';
import { LANGUAGES } from '../../i18n';
import { cn } from '../ui/cn';

/** EN / VI switch. The choice is persisted by the settings store. */
export function LanguageSwitch() {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.settings.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  return (
    <div
      role="radiogroup"
      aria-label={t('app.language.label')}
      className="no-drag flex h-7 items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5"
    >
      <Languages className="mx-1 size-3.5 text-fg-subtle" aria-hidden />
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          role="radio"
          aria-checked={language === lang}
          title={t(`app.language.${lang}`)}
          onClick={() => setLanguage(lang as Language)}
          className={cn(
            'h-5 rounded px-1.5 text-[11px] font-semibold transition-colors',
            language === lang ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {t(`app.language.short.${lang}`)}
        </button>
      ))}
    </div>
  );
}
