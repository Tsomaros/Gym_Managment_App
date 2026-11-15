import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';

/** Toggles Greek / English. The choice is remembered on this device (localStorage `gym.lang`). */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="flex rounded-md border border-slate-500 p-0.5 text-sm"
    >
      {LANGUAGES.map((lang) => {
        const active = i18n.resolvedLanguage === lang;
        return (
          <button
            key={lang}
            type="button"
            lang={lang}
            aria-pressed={active}
            onClick={() => setLanguage(lang)}
            className={`min-h-11 rounded px-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
              active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {t(`language.${lang}`)}
          </button>
        );
      })}
    </div>
  );
}
