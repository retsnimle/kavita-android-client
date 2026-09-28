import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { kavitaClient } from '../../../api/kavitaClient';
import { fontLoader, type FontDownloadProgress } from '../../../core/storage/fontLoader';
import type { EpubFont } from '../../../types/kavita';
import { type ReaderTheme, type LayoutMode, normalizeWeight } from '../types';

export interface UseReaderPreferencesReturn {
  fontSize: number;
  setFontSize: React.Dispatch<React.SetStateAction<number>>;
  lineHeight: number;
  setLineHeight: React.Dispatch<React.SetStateAction<number>>;
  paddingX: number;
  setPaddingX: React.Dispatch<React.SetStateAction<number>>;
  theme: ReaderTheme;
  setTheme: React.Dispatch<React.SetStateAction<ReaderTheme>>;
  fontFamily: string;
  setFontFamily: React.Dispatch<React.SetStateAction<string>>;
  fontWeight: string;
  setFontWeight: React.Dispatch<React.SetStateAction<string>>;
  activeWeightNum: number;
  canDecreaseWeight: boolean;
  canIncreaseWeight: boolean;
  handleDecreaseWeight: () => void;
  handleIncreaseWeight: () => void;
  isVertical: boolean;
  setIsVertical: React.Dispatch<React.SetStateAction<boolean>>;
  layoutMode: LayoutMode;
  setLayoutMode: React.Dispatch<React.SetStateAction<LayoutMode>>;
  fontFamilies: { family: string; name: string; fonts: EpubFont[] }[];
  downloadedFamilies: Set<string>;
  fontDownloadProgress: FontDownloadProgress | null;
  handleSelectFont: (family: string, iframeDoc?: Document | null) => Promise<void>;
}

export const useReaderPreferences = (
  getIframeDoc?: () => Document | null | undefined
): UseReaderPreferencesReturn => {
  // 閱讀器外觀排版狀態
  const [fontSize, setFontSize] = useState<number>(18);
  const [lineHeight, setLineHeight] = useState<number>(1.75);
  const [paddingX, setPaddingX] = useState<number>(() => {
    const saved = localStorage.getItem('kavita_reader_padding_x');
    return saved ? parseInt(saved, 10) : 24;
  });
  const [theme, setTheme] = useState<ReaderTheme>('dark');
  const [fontFamily, setFontFamily] = useState<string>(() => {
    return localStorage.getItem('kavita_reader_font_family') || 'sans-serif';
  });
  const [fontWeight, setFontWeight] = useState<string>(() => {
    return localStorage.getItem('kavita_reader_font_weight') || 'normal';
  });
  const [serverFonts, setServerFonts] = useState<EpubFont[]>([]);
  const serverFontsRef = useRef<EpubFont[]>([]);
  serverFontsRef.current = serverFonts;
  const [downloadedFamilies, setDownloadedFamilies] = useState<Set<string>>(new Set());
  const [fontDownloadProgress, setFontDownloadProgress] = useState<FontDownloadProgress | null>(null);
  const [isVertical, setIsVertical] = useState<boolean>(false);

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    return (localStorage.getItem('kavita_reader_layout_mode') as LayoutMode) || 'scroll';
  });

  // 將伺服器字型按 family 聚合分組
  const fontFamilies = useMemo(() => {
    const map = new Map<string, { family: string; name: string; fonts: EpubFont[] }>();
    for (const f of serverFonts) {
      if (!map.has(f.family)) {
        map.set(f.family, {
          family: f.family,
          name: f.family,
          fonts: [],
        });
      }
      map.get(f.family)!.fonts.push(f);
    }
    return Array.from(map.values());
  }, [serverFonts]);

  // 依據當前選中的字型家族，智慧提取可用的字重列表（由小到大排序）
  const availableWeights = useMemo(() => {
    const targetGroup = fontFamilies.find((g) => g.family === fontFamily);
    if (targetGroup && targetGroup.fonts.length > 0) {
      const weights = new Set<number>();
      for (const f of targetGroup.fonts) {
        if (f.weight) {
          weights.add(normalizeWeight(f.weight));
        }
      }
      if (weights.size > 0) {
        return Array.from(weights).sort((a, b) => a - b);
      }
    }
    return [300, 400, 500, 600, 700, 900];
  }, [fontFamilies, fontFamily]);

  const currentWeightNum = normalizeWeight(fontWeight);

  // 當前有效的字重數值（若切換字型後不符合該字型，自動貼齊最接近的可用字重）
  const activeWeightNum = useMemo(() => {
    if (availableWeights.includes(currentWeightNum)) return currentWeightNum;
    let closest = availableWeights[0];
    let minDiff = Math.abs(currentWeightNum - closest);
    for (const w of availableWeights) {
      const diff = Math.abs(currentWeightNum - w);
      if (diff < minDiff) {
        minDiff = diff;
        closest = w;
      }
    }
    return closest;
  }, [availableWeights, currentWeightNum]);

  // 減少字重（自動選擇上一階更小的可用字重）
  const handleDecreaseWeight = useCallback(() => {
    const idx = availableWeights.indexOf(activeWeightNum);
    if (idx > 0) {
      setFontWeight(String(availableWeights[idx - 1]));
    }
  }, [availableWeights, activeWeightNum]);

  // 增加字重（自動選擇下一階更大的可用字重）
  const handleIncreaseWeight = useCallback(() => {
    const idx = availableWeights.indexOf(activeWeightNum);
    if (idx >= 0 && idx < availableWeights.length - 1) {
      setFontWeight(String(availableWeights[idx + 1]));
    }
  }, [availableWeights, activeWeightNum]);

  const canDecreaseWeight = availableWeights.indexOf(activeWeightNum) > 0;
  const canIncreaseWeight =
    availableWeights.indexOf(activeWeightNum) >= 0 &&
    availableWeights.indexOf(activeWeightNum) < availableWeights.length - 1;

  // 檢查所有字型家族的本地快取狀態
  const refreshDownloadedFonts = useCallback(async () => {
    const downloaded = new Set<string>();
    for (const group of fontFamilies) {
      const isCached = await fontLoader.isFamilyDownloaded(group.fonts);
      if (isCached) downloaded.add(group.family);
    }
    setDownloadedFamilies(downloaded);
  }, [fontFamilies]);

  // 載入伺服器端字型清單並檢查本地快取
  useEffect(() => {
    const fetchFonts = async () => {
      if (kavitaClient.isConfigured()) {
        const fonts = await kavitaClient.getFonts();
        setServerFonts(fonts);
      }
    };
    fetchFonts();
  }, []);

  useEffect(() => {
    if (serverFonts.length > 0) {
      refreshDownloadedFonts();
    }
  }, [serverFonts, refreshDownloadedFonts]);

  // 使用者點選字型家族處理函式（未下載則啟動下載進度條，完成後立即套用）
  const handleSelectFont = useCallback(
    async (family: string, directDoc?: Document | null) => {
      if (family === 'sans-serif' || family === 'serif') {
        setFontFamily(family);
        return;
      }

      const targetGroup = fontFamilies.find((g) => g.family === family);
      if (!targetGroup) return;

      const iframeDoc = directDoc !== undefined ? directDoc : getIframeDoc ? getIframeDoc() : null;

      // 開始載入 / 下載（支援進度回報）
      const success = await fontLoader.loadFontFamilyWithProgress(
        family,
        targetGroup.fonts,
        (progress) => {
          setFontDownloadProgress(progress);
          if (!progress.isDownloading && progress.error) {
            setTimeout(() => setFontDownloadProgress(null), 4000);
          } else if (!progress.isDownloading && !progress.error) {
            setTimeout(() => setFontDownloadProgress(null), 800);
          }
        },
        iframeDoc || undefined
      );

      if (success) {
        setFontFamily(family);
        setDownloadedFamilies((prev) => new Set(prev).add(family));
        if (iframeDoc) {
          fontLoader.syncFontsToDocument(iframeDoc);
        }
      }
    },
    [fontFamilies, getIframeDoc]
  );

  // 當初次進入 App 且已選擇自訂字型時，靜默載入本地快取字型
  useEffect(() => {
    if (!fontFamily || fontFamily === 'sans-serif' || fontFamily === 'serif') return;
    const targetGroup = fontFamilies.find((g) => g.family === fontFamily);
    if (targetGroup) {
      const iframeDoc = getIframeDoc ? getIframeDoc() : null;
      fontLoader
        .loadFontFamilyWithProgress(fontFamily, targetGroup.fonts, undefined, iframeDoc || undefined)
        .then((success) => {
          if (success && iframeDoc) {
            fontLoader.syncFontsToDocument(iframeDoc);
            setDownloadedFamilies((prev) => new Set(prev).add(fontFamily));
          }
        });
    }
  }, [fontFamily, fontFamilies, getIframeDoc]);

  useEffect(() => {
    localStorage.setItem('kavita_reader_font_family', fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem('kavita_reader_font_weight', fontWeight);
  }, [fontWeight]);

  useEffect(() => {
    localStorage.setItem('kavita_reader_padding_x', paddingX.toString());
  }, [paddingX]);

  useEffect(() => {
    localStorage.setItem('kavita_reader_layout_mode', layoutMode);
  }, [layoutMode]);

  return {
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    paddingX,
    setPaddingX,
    theme,
    setTheme,
    fontFamily,
    setFontFamily,
    fontWeight,
    setFontWeight,
    activeWeightNum,
    canDecreaseWeight,
    canIncreaseWeight,
    handleDecreaseWeight,
    handleIncreaseWeight,
    isVertical,
    setIsVertical,
    layoutMode,
    setLayoutMode,
    fontFamilies,
    downloadedFamilies,
    fontDownloadProgress,
    handleSelectFont,
  };
};
