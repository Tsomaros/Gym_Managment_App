import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import el from './el.json';
import en from './en.json';

export const LANGUAGES = ['el', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'gym.lang';

function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'el' || value === 'en' ? value : null;
  } catch {
    return null; // storage blocked (private mode, previews)
  }
}

export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // the choice just won't survive a reload
  }
}

void i18n.use(initReactI18next).init({
  resources: { el: { translation: el }, en: { translation: en } },
  lng: storedLanguage() ?? 'el',
  fallbackLng: 'en', // a key missing in Greek shows English, never the raw key
  supportedLngs: LANGUAGES,
  interpolation: { escapeValue: false }, // React escapes
  initAsync: false,
});

function syncHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}
i18n.on('languageChanged', syncHtmlLang);
syncHtmlLang(i18n.language); // the stored language, for screen readers, from the first paint

export default i18n;
