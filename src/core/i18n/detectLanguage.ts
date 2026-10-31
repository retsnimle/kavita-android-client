import type { Locale } from './types';

export const detectDeviceLanguage = (): Locale => {
  try {
    const navLangs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
    for (const l of navLangs) {
      if (!l) continue;
      const lower = l.toLowerCase();
      if (
        lower.startsWith('zh-tw') ||
        lower.startsWith('zh-hk') ||
        lower.startsWith('zh-mo') ||
        lower.includes('hant')
      ) {
        return 'zh-TW';
      }
    }
  } catch {
    // Fallback if navigator is unavailable
  }
  return 'en-US';
};
