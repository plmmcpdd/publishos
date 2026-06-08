import i18next from 'i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';

i18next.init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export function resolveLanguage(header?: string) {
  return header?.toLowerCase().includes('zh') ? 'zh' : 'en';
}

export function translate(language: string, key: string) {
  return i18next.t(key, { lng: language });
}
