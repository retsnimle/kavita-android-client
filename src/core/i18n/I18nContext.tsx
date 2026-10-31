import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Preferences } from '@capacitor/preferences';
import { zhTW } from './locales/zh-TW';
import { enUS } from './locales/en-US';
import { detectDeviceLanguage } from './detectLanguage';
import { I18nContext } from './context';
import type { Locale, TranslationKey, I18nContextValue } from './types';

const STORAGE_KEY = 'app_language';

const DICTIONARIES = {
  'zh-TW': zhTW,
  'en-US': enUS,
};

const getInitialLocale = (): Locale => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh-TW' || saved === 'en-US') {
      return saved;
    }
  } catch {
    // Ignore localStorage access errors
  }
  return detectDeviceLanguage();
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  // 非同步自 Android 原生偏好讀取設定（避免 WebView 快取清理後遺失）
  useEffect(() => {
    Preferences.get({ key: STORAGE_KEY })
      .then(({ value }) => {
        if (value === 'zh-TW' || value === 'en-US') {
          if (value !== locale) {
            setLocaleState(value);
            try {
              localStorage.setItem(STORAGE_KEY, value);
            } catch {
              // Ignore
            }
          }
        }
      })
      .catch(() => {});
  }, [locale]);

  const setLocale = useCallback(async (newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {
      // Ignore
    }
    try {
      await Preferences.set({ key: STORAGE_KEY, value: newLocale });
    } catch {
      // Ignore
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const dict = DICTIONARIES[locale] || DICTIONARIES['zh-TW'];
      let text: string = dict[key] || DICTIONARIES['zh-TW'][key] || key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return text;
    },
    [locale]
  );

  const contextValue = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
};
