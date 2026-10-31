import type { Locale } from './types';

/**
 * 偵測裝置系統語言：
 * 若系統偏好語言為繁體中文（zh-TW, zh-HK, zh-MO, Hant, CHT, 或泛型 zh 且非簡體），預設顯示繁體中文 (zh-TW)；
 * 否則一律預設為英文 (en-US)。
 */
export const detectDeviceLanguage = (): Locale => {
  try {
    const rawCandidates: string[] = [];

    // 1. 取得 Intl 解析語系（現代瀏覽器 / WebView 最可靠的 BCP 47 標籤）
    try {
      const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
      if (intlLocale) rawCandidates.push(intlLocale);
    } catch {
      // Ignore
    }

    // 2. 取得瀏覽器 / WebView 語系清單
    if (navigator.languages && navigator.languages.length > 0) {
      rawCandidates.push(...navigator.languages);
    }
    if (navigator.language) {
      rawCandidates.push(navigator.language);
    }

    // 逐一檢查候選標籤
    for (const raw of rawCandidates) {
      if (!raw) continue;
      const lower = raw.toLowerCase().trim();

      // 明確的繁體中文標記 (zh-tw, zh-hk, zh-mo, hant, cht)
      if (
        lower.startsWith('zh-tw') ||
        lower.startsWith('zh-hk') ||
        lower.startsWith('zh-mo') ||
        lower.includes('hant') ||
        lower.includes('cht')
      ) {
        return 'zh-TW';
      }

      // 若標籤為純 "zh" 或以 "zh-" 開頭，且非簡體 (cn / hans / sg)
      if (lower === 'zh' || lower.startsWith('zh-')) {
        const isSimplified = lower.includes('cn') || lower.includes('hans') || lower.includes('sg');
        if (!isSimplified) {
          return 'zh-TW';
        }
      }
    }
  } catch {
    // Fallback if APIs are unavailable
  }

  return 'en-US';
};
