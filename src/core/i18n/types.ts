import { zhTW } from './locales/zh-TW';

export type Locale = 'zh-TW' | 'en-US';

export type TranslationKey = keyof typeof zhTW;

export type Translations = Record<TranslationKey, string>;

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}
