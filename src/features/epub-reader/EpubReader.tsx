import React, { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import {
  ArrowLeft,
  Type,
  ChevronLeft,
  ChevronRight,
  Download,
  CheckCircle,
} from 'lucide-react';
import { kavitaClient } from '../../api/kavitaClient';
import { nativeStorage } from '../../core/storage/nativeStorage';
import { progressReconciler } from '../../core/sync/reconciler';
import { downloadManager } from '../../core/storage/downloadManager';
import { backButtonManager } from '../../core/navigation/backButtonManager';
import { fontLoader, type FontDownloadProgress } from '../../core/storage/fontLoader';
import { App } from '@capacitor/app';
import type { EpubFont } from '../../types/kavita';






interface EpubReaderProps {
  seriesId: number;
  seriesName: string;
  volumeId: number;
  chapterId: number;
  chapterTitle: string;
  initialPage?: number;
  onClose: () => void;
}

interface ChapterSection {
  id: string;
  href: string;
  title: string;
  htmlContent?: string;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'black';
export type LayoutMode = 'scroll' | 'paged';

export const THEME_STYLES: Record<ReaderTheme, { bg: string; text: string }> = {
  light: { bg: '#ffffff', text: '#111827' },
  sepia: { bg: '#fbf0d9', text: '#5f4b32' },
  dark: { bg: '#1f2024', text: '#d1d5db' },
  black: { bg: '#000000', text: '#9ca3af' },
};

const normalizeWeight = (w?: string | number): number => {
  if (!w) return 400;
  if (typeof w === 'number') return w;
  const lower = w.trim().toLowerCase();
  if (lower === 'normal' || lower === 'regular') return 400;
  if (lower === 'bold') return 700;
  if (lower === 'light') return 300;
  if (lower === 'medium') return 500;
  if (lower === 'thin') return 100;
  if (lower === 'black' || lower === 'heavy') return 900;
  const parsed = parseInt(lower, 10);
  return isNaN(parsed) ? 400 : parsed;
};

const getWeightName = (w: number): string => {
  if (w <= 100) return '極細 (100)';
  if (w <= 200) return '特細 (200)';
  if (w <= 300) return '細體 (300)';
  if (w <= 400) return '常規 (400)';
  if (w <= 500) return '適中 (500)';
  if (w <= 600) return '半粗 (600)';
  if (w <= 700) return '粗體 (700)';
  if (w <= 800) return '特粗 (800)';
  return '黑體 (900)';
};

// 依據元素在 DOM 中的結構路徑生成標準 XPath (與 Kavita 官方 Web 閱讀器完全互通，例如 /body/p[14])
const getXPathForElement = (el: Element | null): string => {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'body' || el.id === 'kavita-book-wrapper') return '/body';
  if (tag === 'html') return '/html';

  // 取得父節點，穿透自定義注入的 kavita-book-wrapper 虛擬容器
  let parent = el.parentElement;
  while (parent && parent.id === 'kavita-book-wrapper') {
    parent = parent.parentElement;
  }

  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.id !== 'kavita-book-wrapper' && sibling.tagName.toLowerCase() === tag) {
      index++;
    }
    sibling = sibling.previousElementSibling;
  }

  if (!parent || parent.tagName.toLowerCase() === 'html' || parent.tagName.toLowerCase() === 'body') {
    return `/body/${tag}[${index}]`;
  }
  const parentXPath = getXPathForElement(parent);
  return `${parentXPath}/${tag}[${index}]`;
};

// 依據 XPath 在 iframe document 中查找元素節點（全相容標準 DOM、Kavita 官方 Web XPath 與模糊容錯）
const getElementByXPath = (doc: Document, xpath: string): Element | null => {
  if (!xpath || !doc) return null;
  try {
    let cleanXpath = xpath.trim();
    // 根節點為 <html>，單斜線 /body 在標準 DOM evaluate 下永遠找不到節點，正規化轉為 //body
    if (cleanXpath.startsWith('/body')) {
      cleanXpath = `/${cleanXpath}`;
    } else if (!cleanXpath.startsWith('/') && !cleanXpath.startsWith('id(')) {
      cleanXpath = `//${cleanXpath}`;
    }

    const result = doc.evaluate(
      cleanXpath,
      doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    if (result.singleNodeValue && (result.singleNodeValue as Element).nodeType === 1) {
      return result.singleNodeValue as Element;
    }
  } catch (err) {
    console.warn('XPath evaluate 解析失敗，將嘗試正則與 fallback:', xpath, err);
  }

  // 容錯 Fallback 1：正則提取最後的標籤與索引（例如 .../p[14] -> 第 14 個 p 標籤）
  const tagMatch = xpath.match(/\/([a-z0-9]+)\[(\d+)\]$/i);
  if (tagMatch) {
    const tagName = tagMatch[1].toLowerCase();
    const idx = parseInt(tagMatch[2], 10) - 1;
    const elements = doc.querySelectorAll(tagName);
    if (elements[idx]) return elements[idx];
  }

  // 容錯 Fallback 2：如果是 id("...")
  const idMatch = xpath.match(/id\(["']([^"']+)["']\)/i);
  if (idMatch) {
    const el = doc.getElementById(idMatch[1]);
    if (el) return el;
  }

  return null;
};

export const EpubReader: React.FC<EpubReaderProps> = ({
  seriesId,
  seriesName,
  volumeId,
  chapterId,
  chapterTitle,
  initialPage = 0,
  onClose,
}) => {
  const [sections, setSections] = useState<ChapterSection[]>([]);
  const [currentSectionIndex, setCurrentSectionIndex] = useState<number>(initialPage);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSectionLoading, setIsSectionLoading] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);


  // 監聽下載動態進度
  useEffect(() => {
    const unsubscribe = downloadManager.subscribe((p) => {
      if (p.chapterId === chapterId) {
        if (p.status === 'downloading') {
          setDownloadProgress(p.percentage);
        } else if (p.status === 'completed') {
          setDownloadProgress(null);
          setIsOffline(true);
        } else if (p.status === 'error') {
          setDownloadProgress(null);
        }
      }
    });
    return () => {
      unsubscribe();
    };
  }, [chapterId]);

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
  const [isVertical, setIsVertical] = useState<boolean>(false); // 直排支援

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    return (localStorage.getItem('kavita_reader_layout_mode') as LayoutMode) || 'scroll';
  });

  // 將伺服器字型按 family 聚合分組
  const fontFamilies = React.useMemo(() => {
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
  const availableWeights = React.useMemo(() => {
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
    // 預設或系統字型提供標準字重階梯
    return [300, 400, 500, 600, 700, 900];
  }, [fontFamilies, fontFamily]);

  const currentWeightNum = normalizeWeight(fontWeight);

  // 當前有效的字重數值（若切換字型後不符合該字型，自動貼齊最接近的可用字重）
  const activeWeightNum = React.useMemo(() => {
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
  const handleDecreaseWeight = () => {
    const idx = availableWeights.indexOf(activeWeightNum);
    if (idx > 0) {
      setFontWeight(String(availableWeights[idx - 1]));
    }
  };

  // 增加字重（自動選擇下一階更大的可用字重）
  const handleIncreaseWeight = () => {
    const idx = availableWeights.indexOf(activeWeightNum);
    if (idx >= 0 && idx < availableWeights.length - 1) {
      setFontWeight(String(availableWeights[idx + 1]));
    }
  };

  const canDecreaseWeight = availableWeights.indexOf(activeWeightNum) > 0;
  const canIncreaseWeight =
    availableWeights.indexOf(activeWeightNum) >= 0 &&
    availableWeights.indexOf(activeWeightNum) < availableWeights.length - 1;

  // 檢查所有字型家族的本地快取狀態
  const refreshDownloadedFonts = React.useCallback(async () => {
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
  const handleSelectFont = async (family: string) => {
    if (family === 'sans-serif' || family === 'serif') {
      setFontFamily(family);
      return;
    }

    const targetGroup = fontFamilies.find((g) => g.family === family);
    if (!targetGroup) return;

    const iframeDoc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;

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
  };


  // 當初次進入 App 且已選擇自訂字型時，靜默載入本地快取字型
  useEffect(() => {
    if (!fontFamily || fontFamily === 'sans-serif' || fontFamily === 'serif') return;
    const targetGroup = fontFamilies.find((g) => g.family === fontFamily);
    if (targetGroup) {
      const iframeDoc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
      fontLoader.loadFontFamilyWithProgress(fontFamily, targetGroup.fonts, undefined, iframeDoc || undefined).then((success) => {
        if (success && iframeDoc) {
          fontLoader.syncFontsToDocument(iframeDoc);
          setDownloadedFamilies((prev) => new Set(prev).add(fontFamily));
        }
      });
    }
  }, [fontFamily, fontFamilies]);




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


  // 點選設定 Popup 焦點外自動關閉
  useEffect(() => {
    if (!showSettings) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        settingsRef.current && !settingsRef.current.contains(target) &&
        settingsBtnRef.current && !settingsBtnRef.current.contains(target)
      ) {
        setShowSettings(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [showSettings]);

  const handleClose = useCallback(() => {
    progressReconciler.flushPendingProgress(chapterId);
    onClose();
  }, [chapterId, onClose]);

  // 監聽 Android 返回鍵：優先關閉排版設定面板，否則退出閱讀器回到書庫
  useEffect(() => {
    const unregister = backButtonManager.register(() => {
      if (showSettings) {
        setShowSettings(false);
        return true;
      }
      handleClose();
      return true;
    });
    return unregister;
  }, [showSettings, handleClose]);


  const [virtualPageIndex, setVirtualPageIndex] = useState<number>(0);
  const [totalVirtualPages, setTotalVirtualPages] = useState<number>(1);
  const virtualPageIndexRef = useRef<number>(0);
  const totalVirtualPagesRef = useRef<number>(1);
  const initialVirtualTargetRef = useRef<number | 'last' | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const pendingTargetXPathRef = useRef<string | null>(null);
  const isRestoringProgressRef = useRef<boolean>(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const zipRef = useRef<JSZip | null>(null);
  const imageCacheRef = useRef<Record<string, string>>({});
  const pendingAnchorRef = useRef<string | null>(null);

  // 定時器清理與非同步請求世代保護鎖（防止快速切換時舊章節覆蓋新章節）
  const renderTimerIdsRef = useRef<number[]>([]);
  const sectionRequestIdRef = useRef<number>(0);

  // 生命週期監聽：切換到後台、螢幕鎖定、關閉 App 或組件卸載時，立即 Flush 未決閱讀進度
  useEffect(() => {
    const handleFlush = () => {
      progressReconciler.flushPendingProgress(chapterId);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleFlush();
      }
    };

    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', handleFlush);
    window.addEventListener('beforeunload', handleFlush);

    let appListenerHandle: any = null;
    App.addListener('appStateChange', (state) => {
      if (!state.isActive) {
        handleFlush();
      }
    }).then((handle) => {
      appListenerHandle = handle;
    }).catch(() => {});

    return () => {
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', handleFlush);
      window.removeEventListener('beforeunload', handleFlush);
      if (appListenerHandle && typeof appListenerHandle.remove === 'function') {
        appListenerHandle.remove();
      }
      renderTimerIdsRef.current.forEach((id) => clearTimeout(id));
      renderTimerIdsRef.current = [];
      handleFlush();
    };
  }, [chapterId]);

  // 1. 下載或讀取沙盒 EPUB 檔案並僅解析骨架 Spine（秒開，不遍歷所有章節與圖片）
  useEffect(() => {
    let mounted = true;

    const loadAndParseEpub = async () => {
      try {
        setIsLoading(true);
        const offline = await downloadManager.isChapterOffline(chapterId);
        if (!mounted) return;
        setIsOffline(offline);

        let skeletalSections: ChapterSection[] = [];

        if (offline) {
          // === 軌道 A：離線沙盒模式（直接本地解壓）===
          const epubBlob = await nativeStorage.getEpubBlob(chapterId);
          if (!epubBlob) throw new Error('離線 EPUB 檔案不存在');

          const zip = await JSZip.loadAsync(epubBlob);
          zipRef.current = zip;
          imageCacheRef.current = {};

          const containerXml = await zip.file('META-INF/container.xml')?.async('text');
          if (!containerXml) throw new Error('Invalid EPUB: Missing container.xml');

          const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
          const opfPath = opfPathMatch ? opfPathMatch[1] : 'OEBPS/content.opf';
          const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

          const opfContent = await zip.file(opfPath)?.async('text');
          if (!opfContent) throw new Error('Invalid EPUB: Missing OPF');

          const parser = new DOMParser();
          const opfDoc = parser.parseFromString(opfContent, 'application/xml');

          const manifestItems: Record<string, string> = {};
          opfDoc.querySelectorAll('manifest > item').forEach((item) => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            if (id && href) {
              manifestItems[id] = opfDir + href;
            }
          });

          const spineItems: string[] = [];
          opfDoc.querySelectorAll('spine > itemref').forEach((item) => {
            const idref = item.getAttribute('idref');
            if (idref && manifestItems[idref]) {
              spineItems.push(manifestItems[idref]);
            }
          });

          skeletalSections = spineItems.map((href, i) => ({
            id: `sec-${i}`,
            href,
            title: `第 ${i + 1} 節`,
          }));
        } else {
          // === 軌道 B：線上串流按需模式（極致省流，零整書下載，毫秒秒開）===
          zipRef.current = null;
          imageCacheRef.current = {};

          try {
            const serverChapters = await kavitaClient.getBookChapters(chapterId);
            if (serverChapters && serverChapters.length > 0) {
              skeletalSections = serverChapters.map((c, i) => ({
                id: `sec-${c.page ?? i}`,
                href: `page-${c.page ?? i}`,
                title: c.title || `第 ${i + 1} 節`,
              }));
            } else {
              const info = await kavitaClient.getChapterInfo(chapterId);
              const total = info.pages || 1;
              skeletalSections = Array.from({ length: total }, (_, i) => ({
                id: `sec-${i}`,
                href: `page-${i}`,
                title: `第 ${i + 1} 節`,
              }));
            }
          } catch (e) {
            console.warn('線上取得章節清單失敗，嘗試回退 chapterInfo:', e);
            const info = await kavitaClient.getChapterInfo(chapterId);
            const total = info.pages || 1;
            skeletalSections = Array.from({ length: total }, (_, i) => ({
              id: `sec-${i}`,
              href: `page-${i}`,
              title: `第 ${i + 1} 節`,
            }));
          }
        }

        if (mounted) {
          setSections(skeletalSections);
          // 還原有效進度（支援 Kavita 官方 DOM XPath 規範與向下相容）
          const effProgress = await progressReconciler.getEffectiveProgress(chapterId);
          if (effProgress.page < skeletalSections.length) {
            pendingTargetXPathRef.current = effProgress.bookScrollId || null;
            let vTarget: number | 'last' = 0;
            if (effProgress.bookScrollId && effProgress.bookScrollId.startsWith('vpage:')) {
              const parsed = effProgress.bookScrollId.replace('vpage:', '');
              vTarget = parsed === 'last' ? 'last' : parseInt(parsed, 10) || 0;
            }
            initialVirtualTargetRef.current = vTarget;
            if (effProgress.bookScrollId && effProgress.bookScrollId.startsWith('scroll:')) {
              pendingScrollTopRef.current = parseInt(effProgress.bookScrollId.replace('scroll:', ''), 10) || 0;
            } else {
              pendingScrollTopRef.current = 0;
            }
            setCurrentSectionIndex(effProgress.page);
          }
        }
      } catch (err) {
        console.error('解析 EPUB 失敗:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadAndParseEpub();
    return () => {
      mounted = false;
      zipRef.current = null;
      imageCacheRef.current = {};
    };
  }, [chapterId]);

  // 相對路徑轉換輔助
  const resolveRelativePath = (base: string, rel: string): string => {
    const cleanRel = rel.split('?')[0].split('#')[0];
    if (cleanRel.startsWith('data:') || cleanRel.startsWith('http://') || cleanRel.startsWith('https://')) {
      return cleanRel;
    }
    const baseParts = base.split('/').slice(0, -1);
    for (const part of cleanRel.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        baseParts.pop();
      } else {
        baseParts.push(part);
      }
    }
    return baseParts.join('/');
  };

  // 單張圖片按需解壓（改用 Blob URL，極速並行，記憶體零膨脹）
  const getImageDataUrl = async (targetPath: string): Promise<string | null> => {
    if (imageCacheRef.current[targetPath]) return imageCacheRef.current[targetPath];
    const zip = zipRef.current;
    if (!zip) return null;

    let zipFile = zip.file(targetPath);
    if (!zipFile) {
      const pureTarget = targetPath.split('/').pop() || '';
      const foundKey = Object.keys(zip.files).find((k) => k.endsWith('/' + pureTarget) || k === pureTarget);
      if (foundKey) zipFile = zip.file(foundKey);
    }

    if (zipFile) {
      const lower = zipFile.name.toLowerCase();
      const ext = lower.split('.').pop() || 'jpeg';
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'gif'
          ? 'image/gif'
          : ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
      const blobData = await zipFile.async('blob');
      const objectUrl = URL.createObjectURL(new Blob([blobData], { type: mime }));
      imageCacheRef.current[targetPath] = objectUrl;
      return objectUrl;
    }
    return null;
  };

  // 3. 切換章節並樂觀同步
  const handleSectionChange = useCallback(
    (newIndex: number, targetVirtual: number | 'last' = 0) => {
      if (newIndex < 0 || newIndex >= sections.length || newIndex === currentSectionIndex) return;
      pendingTargetXPathRef.current = targetVirtual === 'last' ? 'last' : '/body/p[1]';
      initialVirtualTargetRef.current = targetVirtual;
      pendingScrollTopRef.current = targetVirtual === 'last' ? 9999999 : 0;
      setCurrentSectionIndex(newIndex);
      const scrollId = targetVirtual === 'last' ? 'last' : '/body/p[1]';
      progressReconciler.updateProgressOptimistic(seriesId, volumeId, chapterId, newIndex, scrollId);
    },
    [sections.length, currentSectionIndex, seriesId, volumeId, chapterId]
  );

  // 跳轉至指定虛擬分頁（透過 CSS Transform 絕對像素平移，徹底杜絕 WebView 滾動條 Bug 與座標反轉）
  const goToVirtualPage = useCallback(
    (pageIdx: number, animate = true, reportProgress = true) => {
      const win = iframeRef.current?.contentWindow;
      const doc = iframeRef.current?.contentDocument || win?.document;
      if (!win || !doc) return;

      const pageWidth = iframeRef.current?.clientWidth || win.innerWidth || doc.documentElement.clientWidth;
      const wrapper = doc.getElementById('kavita-book-wrapper');

      if (wrapper) {
        // 直排：由右至左排列，第 0 頁在最右側 (x=0)；翻至第 pageIdx 頁需將容器向右平移 pageIdx * pageWidth
        // 橫排：由左至右排列，第 0 頁在最左側 (x=0)；翻至第 pageIdx 頁需將容器向左平移 -pageIdx * pageWidth
        const offset = isVertical ? pageIdx * pageWidth : -pageIdx * pageWidth;
        wrapper.style.transition = animate ? 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)' : 'none';
        wrapper.style.transform = `translateX(${offset}px)`;
      } else {
        const targetLeft = isVertical ? -pageIdx * pageWidth : pageIdx * pageWidth;
        win.scrollTo({
          left: targetLeft,
          top: 0,
          behavior: animate ? 'smooth' : 'auto',
        });
      }
      virtualPageIndexRef.current = pageIdx;
      setVirtualPageIndex(pageIdx);

      if (reportProgress) {
        // 從當前可視分頁提取代表性段落元素，生成 Kavita 官方標準 XPath (如 /body/p[14])
        let currentXPath = '';
        try {
          const wrapperEl = doc.getElementById('kavita-book-wrapper') || doc.body;
          const candidates = Array.from(
            wrapperEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, div')
          ).filter((el) => {
            return el.id !== 'kavita-book-wrapper' && el.textContent && el.textContent.trim().length > 0;
          });

          const wrapperRect = wrapperEl.getBoundingClientRect();
          const pageStart = pageIdx * pageWidth;
          const pageEnd = (pageIdx + 1) * pageWidth;

          if (isVertical) {
            // 直排：由右至左排列，wrapperRect.right 為起點基準
            const targetEl =
              candidates.find((el) => {
                const elRect = el.getBoundingClientRect();
                const visualX = wrapperRect.right - elRect.right;
                return visualX >= pageStart - 20 && visualX < pageEnd;
              }) ||
              candidates.find((el) => {
                const elRect = el.getBoundingClientRect();
                const visualX = wrapperRect.right - elRect.right;
                return visualX + elRect.width > pageStart;
              }) ||
              candidates[0];
            if (targetEl) currentXPath = getXPathForElement(targetEl);
          } else {
            // 橫排：由左至右排列，wrapperRect.left 為起點基準（徹底拋棄在多欄佈局中失效的 offsetLeft）
            const targetEl =
              candidates.find((el) => {
                const elRect = el.getBoundingClientRect();
                const visualX = elRect.left - wrapperRect.left;
                return visualX >= pageStart - 20 && visualX < pageEnd;
              }) ||
              candidates.find((el) => {
                const elRect = el.getBoundingClientRect();
                const visualX = elRect.left - wrapperRect.left;
                return visualX + elRect.width > pageStart;
              }) ||
              candidates[0];
            if (targetEl) currentXPath = getXPathForElement(targetEl);
          }
        } catch (e) {
          console.warn('提取分頁段落 XPath 失敗，將 fallback 至虛擬頁碼:', e);
        }

        const scrollId = currentXPath || `vpage:${pageIdx}`;
        progressReconciler.updateProgressOptimistic(
          seriesId,
          volumeId,
          chapterId,
          currentSectionIndex,
          scrollId
        );
      }
    },
    [isVertical, seriesId, volumeId, chapterId, currentSectionIndex]
  );

  const goToVirtualPageRef = useRef(goToVirtualPage);
  goToVirtualPageRef.current = goToVirtualPage;

  // 單欄分頁翻頁邏輯（依賴 ref 讀取當前虛擬頁碼，絕不觸發組件/iframe重渲染）
  const turnPage = useCallback(
    (direction: 'next' | 'prev') => {
      if (layoutMode !== 'paged') return;

      const current = virtualPageIndexRef.current;
      const total = totalVirtualPagesRef.current;

      if (direction === 'next') {
        if (current + 1 < total) {
          goToVirtualPageRef.current(current + 1);
        } else {
          if (currentSectionIndex < sections.length - 1) {
            handleSectionChange(currentSectionIndex + 1, 0);
          }
        }
      } else {
        if (current > 0) {
          goToVirtualPageRef.current(current - 1);
        } else {
          if (currentSectionIndex > 0) {
            handleSectionChange(currentSectionIndex - 1, 'last');
          }
        }
      }
    },
    [
      layoutMode,
      currentSectionIndex,
      sections.length,
      handleSectionChange,
    ]
  );

  const turnPageRef = useRef(turnPage);
  turnPageRef.current = turnPage;

  // 錨點平滑滾動
  const scrollToAnchor = useCallback((anchorId: string) => {
    const iframeDoc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
    if (!iframeDoc) return;
    const cleanId = decodeURIComponent(anchorId);
    const targetEl =
      iframeDoc.getElementById(cleanId) ||
      iframeDoc.querySelector(`[name="${cleanId}"]`) ||
      iframeDoc.querySelector(`[id*="${cleanId}"]`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // 處理 EPUB 內部超連結點擊跳轉（目錄、正文註釋、跨章節錨點）
  const handleLinkClick = useCallback((rawHref: string) => {
    if (!rawHref) return;
    const currentSection = sections[currentSectionIndex];
    if (!currentSection) return;

    const [filePart, hashPart] = rawHref.split('#');

    // 1. 同頁錨點跳轉 (例如 "#note1" 或 "part0001.html#note1")
    const currentFileName = currentSection.href.split('/').pop() || '';
    if (!filePart || filePart === '' || filePart === currentFileName) {
      if (hashPart) {
        scrollToAnchor(hashPart);
      }
      return;
    }

    // 2. 跨頁跳轉 (例如 "part0005.html#4OIQ0" 或 "part0005.html")
    const resolvedPath = resolveRelativePath(currentSection.href, filePart);
    const targetIndex = sections.findIndex((s) => {
      return (
        s.href === resolvedPath ||
        s.href.endsWith('/' + filePart) ||
        s.href === filePart
      );
    });

    if (targetIndex !== -1) {
      if (hashPart) {
        pendingAnchorRef.current = hashPart;
      }
      handleSectionChange(targetIndex);
    }
  }, [sections, currentSectionIndex, scrollToAnchor, handleSectionChange]);

  // 當前章節按需渲染（翻到哪一節才解析哪一節的 HTML 與圖片）
  const renderCurrentSection = useCallback(async () => {
    if (!iframeRef.current || sections.length === 0) return;
    if (isOffline && !zipRef.current) return;
    const currentSection = sections[currentSectionIndex];
    if (!currentSection) return;

    // 1. 清理上一輪殘留的所有定時器
    renderTimerIdsRef.current.forEach((id) => clearTimeout(id));
    renderTimerIdsRef.current = [];

    // 2. 領取當前渲染輪次的唯一世代 ID
    const currentReqId = ++sectionRequestIdRef.current;

    setIsSectionLoading(true);
    let htmlContent = currentSection.htmlContent;

    if (!htmlContent) {
      if (isOffline && zipRef.current) {
        // === 軌道 A：離線本地解壓 ===
        const rawHtml = await zipRef.current.file(currentSection.href)?.async('text');
        if (currentReqId !== sectionRequestIdRef.current) return;
        if (rawHtml) {
          let processedHtml = rawHtml;
          // 1. 並行替換 <img> 標籤
          const imgMatches = Array.from(processedHtml.matchAll(/(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi));
          if (imgMatches.length > 0) {
            const imgReplacements = await Promise.all(
              imgMatches.map(async ([fullMatch, prefix, src, suffix]) => {
                const resolved = resolveRelativePath(currentSection.href, src);
                const dataUrl = (await getImageDataUrl(resolved)) || (await getImageDataUrl(src));
                return { fullMatch, replacement: dataUrl ? `${prefix}${dataUrl}${suffix}` : fullMatch };
              })
            );
            if (currentReqId !== sectionRequestIdRef.current) return;
            for (const { fullMatch, replacement } of imgReplacements) {
              processedHtml = processedHtml.replace(fullMatch, replacement);
            }
          }

          // 2. 並行替換 <image> / <use> (SVG 格式)
          const svgMatches = Array.from(
            processedHtml.matchAll(/(<(?:image|use)[^>]+(?:xlink:href|href)=["'])([^"']+)(["'][^>]*>)/gi)
          );
          if (svgMatches.length > 0) {
            const svgReplacements = await Promise.all(
              svgMatches.map(async ([fullMatch, prefix, src, suffix]) => {
                const resolved = resolveRelativePath(currentSection.href, src);
                const dataUrl = (await getImageDataUrl(resolved)) || (await getImageDataUrl(src));
                return { fullMatch, replacement: dataUrl ? `${prefix}${dataUrl}${suffix}` : fullMatch };
              })
            );
            if (currentReqId !== sectionRequestIdRef.current) return;
            for (const { fullMatch, replacement } of svgReplacements) {
              processedHtml = processedHtml.replace(fullMatch, replacement);
            }
          }
          htmlContent = processedHtml;
          currentSection.htmlContent = htmlContent;
        }
      } else {
        // === 軌道 B：線上串流按需加載（只抓取該節 HTML，10~50 KB，瞬間完成）===
        try {
          const rawHtml = await kavitaClient.getBookPage(chapterId, currentSectionIndex);
          if (currentReqId !== sectionRequestIdRef.current) return;
          if (rawHtml) {
            let processedHtml = rawHtml;
            // 處理線上 HTML 中的圖片：將相對路徑轉為帶 API 金鑰的伺服器絕對路徑
            const baseUrl = kavitaClient.getBaseUrl();
            const apiKey = localStorage.getItem('kavita_api_key') || '';
            const authQuery = apiKey ? `apiKey=${encodeURIComponent(apiKey)}` : '';

            // 替換 img src
            processedHtml = processedHtml.replace(
              /(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi,
              (fullMatch, prefix, src, suffix) => {
                if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
                  return fullMatch;
                }
                const cleanSrc = src.startsWith('/') ? src : `/${src}`;
                const sep = cleanSrc.includes('?') ? '&' : '?';
                const fullUrl = authQuery ? `${baseUrl}${cleanSrc}${sep}${authQuery}` : `${baseUrl}${cleanSrc}`;
                return `${prefix}${fullUrl}${suffix}`;
              }
            );

            // 替換 svg image href
            processedHtml = processedHtml.replace(
              /(<(?:image|use)[^>]+(?:xlink:href|href)=["'])([^"']+)(["'][^>]*>)/gi,
              (fullMatch, prefix, src, suffix) => {
                if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
                  return fullMatch;
                }
                const cleanSrc = src.startsWith('/') ? src : `/${src}`;
                const sep = cleanSrc.includes('?') ? '&' : '?';
                const fullUrl = authQuery ? `${baseUrl}${cleanSrc}${sep}${authQuery}` : `${baseUrl}${cleanSrc}`;
                return `${prefix}${fullUrl}${suffix}`;
              }
            );

            htmlContent = processedHtml;
            currentSection.htmlContent = htmlContent;
          }
        } catch (e) {
          if (currentReqId !== sectionRequestIdRef.current) return;
          console.error('線上載入章節頁面失敗:', e);
        }
      }
    }

    if (currentReqId !== sectionRequestIdRef.current) return;
    setIsSectionLoading(false);
    if (!htmlContent) return;

    const iframeDoc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
    if (!iframeDoc) return;

    const winWidth = iframeRef.current?.clientWidth || window.innerWidth;
    const winHeight = iframeRef.current?.clientHeight || window.innerHeight;

    const currentTheme = THEME_STYLES[theme];

    // 直排樣式
    const writingMode = isVertical ? 'vertical-rl' : 'horizontal-tb';
    const paddingStyle = isVertical ? `${paddingX}px 24px` : `24px ${paddingX}px`;

    // 版面模式專用樣式與微調
    let pagedCss = '';
    let effectiveLineHeight = lineHeight;

    if (layoutMode === 'paged') {
      const iframeW = iframeRef.current?.clientWidth || Math.max(100, winWidth - 2 * paddingX);
      const iframeH = iframeRef.current?.clientHeight || Math.max(100, winHeight);

      if (isVertical) {
        // 直排單欄排版核心：
        // 1. 水平方向（X 軸）：以螢幕寬度 iframeW 計算整數列數 cols，調整 line-height 使每一頁剛好容納 cols 列
        const colStep = fontSize * lineHeight;
        const cols = Math.max(1, Math.floor(iframeW / colStep));
        const colWidth = iframeW / cols;
        effectiveLineHeight = parseFloat((colWidth / fontSize).toFixed(4));

        // 2. 垂直方向（Y 軸）：佔滿可用高度 (calc(100vh - 48px))，文字從頂到底填滿後自動向左換列
        // 嚴格禁止使用 column-width（會導致 Chromium 在 vertical-rl 下錯誤截斷高度造成下半部空白）
        pagedCss = `
          html, body {
            width: 100% !important;
            height: 100vh !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #kavita-book-wrapper {
            height: calc(100vh - 48px) !important;
            margin: 24px 0 !important;
            padding: 0 !important;
            writing-mode: vertical-rl !important;
            display: inline-block !important;
            box-sizing: border-box !important;
            line-height: ${effectiveLineHeight} !important;
            will-change: transform !important;
          }
          #kavita-book-wrapper * {
            box-sizing: border-box !important;
          }
          #kavita-book-wrapper p,
          #kavita-book-wrapper div,
          #kavita-book-wrapper section,
          #kavita-book-wrapper article,
          #kavita-book-wrapper blockquote,
          #kavita-book-wrapper h1,
          #kavita-book-wrapper h2,
          #kavita-book-wrapper h3,
          #kavita-book-wrapper h4,
          #kavita-book-wrapper h5,
          #kavita-book-wrapper h6 {
            margin: 0 !important;
            padding: 0 !important;
          }
          #kavita-book-wrapper p {
            text-indent: 2em !important;
          }
        `;
      } else {
        // 橫排單欄：微調行距確保一頁整數行
        const availH = Math.max(100, iframeH - 48); // 上下各 24px
        const rowHeight = fontSize * lineHeight;
        const rows = Math.max(1, Math.floor(availH / rowHeight));
        effectiveLineHeight = parseFloat(((availH / rows) / fontSize).toFixed(3));

        pagedCss = `
          html, body {
            width: 100% !important;
            height: 100vh !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #kavita-book-wrapper {
            height: calc(100vh - 48px) !important;
            margin: 24px 0 !important;
            padding: 0 !important;
            writing-mode: horizontal-tb !important;
            column-width: ${iframeW}px !important;
            column-gap: 0px !important;
            column-fill: auto !important;
            box-sizing: border-box !important;
            line-height: ${effectiveLineHeight} !important;
            will-change: transform !important;
          }
        `;
      }
    } else {
      pagedCss = `
        html, body {
          overflow: auto !important;
          touch-action: auto !important;
        }
      `;
    }

    // 解析字型 CSS font-family
    const resolvedFontFamily = (() => {
      if (fontFamily === 'serif') {
        return '"Noto Serif TC", serif';
      }
      if (fontFamily === 'sans-serif') {
        return 'system-ui, -apple-system, sans-serif';
      }
      // 自訂伺服器字型（已由 fontLoader 快取同步至 document）
      return `"${fontFamily}", "Noto Serif TC", serif`;
    })();

    // 注入隔離樣式與自訂字型（徹底移除無差別外部 Google Fonts 及未下載字型請求，加入 Fade-in 動畫消除跳頁抖動）
    const customCss = `
      <style>
        html, body, #kavita-book-wrapper, #kavita-book-wrapper *, body * {
          font-family: ${resolvedFontFamily} !important;
          font-weight: ${activeWeightNum} !important;
        }
        html, body {
          background-color: ${currentTheme.bg} !important;
          color: ${currentTheme.text} !important;
          font-size: ${fontSize}px !important;
          line-height: ${effectiveLineHeight} !important;
          writing-mode: ${writingMode} !important;
          margin: 0 !important;
          padding: ${layoutMode === 'paged' ? 0 : paddingStyle} !important;
          box-sizing: border-box !important;
          word-break: break-word !important;
          user-select: text !important;
        }
        #kavita-book-wrapper {
          opacity: 0;
          transition: opacity 0.22s ease-out, transform 0.25s cubic-bezier(0.2, 0, 0, 1) !important;
        }
        #kavita-book-wrapper.is-ready {
          opacity: 1 !important;
        }
        ${pagedCss}
        img {
          max-width: 100% !important;
          height: auto !important;
          display: block !important;
          margin: 16px auto !important;
        }
        a { color: #10b981 !important; text-decoration: underline !important; cursor: pointer !important; }
        p { ${layoutMode === 'paged' && isVertical ? 'margin: 0 !important;' : 'margin-bottom: 1.25em !important;'} text-indent: 2em !important; }
      </style>
    `;

    // 處理原始 HTML 內容，替換相對路徑與注入樣式
    let content = currentSection.htmlContent || '';
    if (!content) return;

    if (layoutMode === 'paged') {
      if (content.includes('<body')) {
        content = content.replace(/(<body[^>]*>)/i, '$1<div id="kavita-book-wrapper">');
        content = content.replace(/<\/body>/i, '</div></body>');
      } else {
        content = `<div id="kavita-book-wrapper">${content}</div>`;
      }
    }

    if (content.includes('</head>')) {
      content = content.replace('</head>', `${customCss}</head>`);
    } else {
      content = customCss + content;
    }

    // 決定目標還原位置：若非切換章節引發的重繪，則保留當前實際閱讀進度
    const win = iframeRef.current?.contentWindow;
    const doc = iframeRef.current?.contentDocument || win?.document;
    const currentActualScroll = win?.scrollY || doc?.documentElement?.scrollTop || doc?.body?.scrollTop || 0;
    const targetScroll = pendingScrollTopRef.current !== null ? pendingScrollTopRef.current : currentActualScroll;
    pendingScrollTopRef.current = null;

    const targetVirtual = initialVirtualTargetRef.current !== null ? initialVirtualTargetRef.current : virtualPageIndexRef.current;
    initialVirtualTargetRef.current = null;

    // 寫入同源 iframe 文檔
    iframeDoc.open();
    iframeDoc.write(content);
    iframeDoc.close();

    // 同步主視窗快取字型進 iframe（同源 context 下可靠繼承）
    fontLoader.syncFontsToDocument(iframeDoc);

    // 若為單欄模式，徹底阻止 touchmove 與 wheel，防止手勢自由滑動
    if (layoutMode === 'paged') {
      const blockScroll = (e: TouchEvent | WheelEvent) => {
        e.preventDefault();
      };
      iframeDoc.addEventListener('touchmove', blockScroll, { passive: false });
      iframeDoc.addEventListener('wheel', blockScroll, { passive: false });
    }

    // 綁定 iframe 點擊事件
    iframeDoc.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (anchor) {
        const href = anchor.getAttribute('href');
        if (href && !href.startsWith('javascript:')) {
          e.preventDefault();
          handleLinkClick(href);
          return;
        }
      }

      if (layoutMode === 'paged') {
        const clickX = e.clientX;
        const screenWidth = iframeDoc.documentElement.clientWidth || window.innerWidth;
        const ratio = clickX / screenWidth;

        if (ratio < 0.3) {
          if (isVertical) {
            turnPageRef.current('next');
          } else {
            turnPageRef.current('prev');
          }
        } else if (ratio > 0.7) {
          if (isVertical) {
            turnPageRef.current('prev');
          } else {
            turnPageRef.current('next');
          }
        } else {
          setShowControls((prev) => !prev);
        }
      } else {
        setShowControls((prev) => !prev);
      }
    };

    const iframeWin = iframeRef.current?.contentWindow;
    if (!iframeWin) return;

    if (layoutMode === 'scroll') {
      isRestoringProgressRef.current = true;
    }

    // 1. 單欄分頁測量與目標頁跳轉（初次跳轉定位就緒後揭示畫面，平滑淡入消除抽動）
    const calculatePages = (shouldJump = false) => {
      if (currentReqId !== sectionRequestIdRef.current) return;
      const win = iframeRef.current?.contentWindow;
      const doc = iframeRef.current?.contentDocument || win?.document;
      if (!win || !doc) return;

      const w = iframeRef.current?.clientWidth || win.innerWidth || doc.documentElement.clientWidth;
      if (w <= 0) return;

      const wrapper = doc.getElementById('kavita-book-wrapper') || doc.body;
      const wrapperRect = wrapper.getBoundingClientRect ? wrapper.getBoundingClientRect().width : 0;
      const scrollW = Math.max(
        wrapperRect,
        wrapper.scrollWidth || 0,
        doc.documentElement.scrollWidth || 0,
        doc.body.scrollWidth || 0,
        w,
      );

      // 減去微小的 2px 浮點容差，即刻算出總頁數並更新 UI（告別 10 秒頁 1/1 等待）
      const pages = Math.max(1, Math.ceil((scrollW - 2) / w));
      totalVirtualPagesRef.current = pages;
      setTotalVirtualPages(pages);

      if (shouldJump) {
        let targetPage = 0;
        let located = false;

        // 1. 優先嘗試依據 DOM XPath 尋找段落節點換算精確頁碼（與 Kavita 官方 Web 完全互通）
        if (pendingTargetXPathRef.current) {
          const xp = pendingTargetXPathRef.current;
          if (xp === 'last' || xp === 'vpage:last') {
            targetPage = pages - 1;
            located = true;
          } else if (xp.includes('/') || xp.startsWith('id(')) {
            const el = getElementByXPath(doc, xp);
            if (el) {
              const wrapperEl = doc.getElementById('kavita-book-wrapper') || doc.body;
              const wrapperBox = wrapperEl.getBoundingClientRect();
              const elBox = el.getBoundingClientRect();

              if (isVertical) {
                // 直排：由右至左排列，wrapperBox.right 為第 0 頁右邊界
                const visualX = wrapperBox.right - elBox.right;
                targetPage = Math.max(0, Math.floor((visualX + 2) / w));
              } else {
                // 橫排：由左至右排列，wrapperBox.left 為第 0 頁左邊界（徹底拋棄無效的 offsetLeft）
                const visualX = elBox.left - wrapperBox.left;
                targetPage = Math.max(0, Math.floor((visualX + 2) / w));
              }
              located = true;
            }
          } else if (xp.startsWith('vpage:')) {
            const parsed = xp.replace('vpage:', '');
            targetPage = parsed === 'last' ? pages - 1 : parseInt(parsed, 10) || 0;
            located = true;
          }
        }

        // 2. Fallback 至原有的 targetVirtual
        if (!located) {
          const target = targetVirtual;
          targetPage = target === 'last' ? pages - 1 : Math.min(typeof target === 'number' ? target : 0, pages - 1);
        }

        targetPage = Math.max(0, Math.min(targetPage, pages - 1));
        // 還原進度時傳入 false，絕不在初始化時回寫覆蓋資料庫存檔
        goToVirtualPageRef.current(targetPage, false, false);
      }

      // 初次跳轉定位完成，揭示 wrapper 呈現淡入動畫（消除抽動）
      const wrapperEl = doc.getElementById('kavita-book-wrapper');
      if (wrapperEl && !wrapperEl.classList.contains('is-ready')) {
        wrapperEl.classList.add('is-ready');
      }
    };

    // 2. 連續滾動模式精準還原定位
    const performScroll = (unlock = false) => {
      if (currentReqId !== sectionRequestIdRef.current) return;
      const win = iframeRef.current?.contentWindow;
      const doc = iframeRef.current?.contentDocument || win?.document;
      if (!win || !doc) return;

      let located = false;
      if (pendingTargetXPathRef.current) {
        const xp = pendingTargetXPathRef.current;
        if (xp.includes('/') || xp.startsWith('id(')) {
          const el = getElementByXPath(doc, xp);
          if (el) {
            el.scrollIntoView({ behavior: 'auto', block: 'start' });
            located = true;
          }
        }
      }

      if (!located) {
        let actualTop = targetScroll;
        if (targetScroll >= 9999999) {
          const scrollH = Math.max(doc.documentElement.scrollHeight || 0, doc.body.scrollHeight || 0);
          actualTop = Math.max(0, scrollH - (win.innerHeight || 0));
        }

        win.scrollTo({ top: actualTop, left: 0, behavior: 'auto' });
        if (doc.documentElement) doc.documentElement.scrollTop = actualTop;
        if (doc.body) doc.body.scrollTop = actualTop;
      }

      const wrapperEl = doc.getElementById('kavita-book-wrapper') || doc.body;
      if (wrapperEl && !wrapperEl.classList.contains('is-ready')) {
        wrapperEl.classList.add('is-ready');
      }

      if (unlock) {
        const tUnlock = window.setTimeout(() => {
          if (currentReqId !== sectionRequestIdRef.current) return;
          isRestoringProgressRef.current = false;
        }, 200);
        renderTimerIdsRef.current.push(tUnlock);
      }
    };

    // 3. 快速三階段排版測量（保存 timer ID，並在組件/新渲染時清理）：
    // - 50ms：文字載入後立即算出初版頁數並跳轉目標頁，同時以 Fade-in 平滑淡入，絕不在首頁停留 450ms 產生抽動
    // - 200ms：圖片排版展開後自動微調頁數與平移位移
    // - 450ms：最終定型確認，釋放 XPath 暫存鎖，並安全解鎖進度回報
    if (layoutMode === 'paged') {
      const t1 = window.setTimeout(() => calculatePages(true), 50);
      const t2 = window.setTimeout(() => calculatePages(true), 200);
      const t3 = window.setTimeout(() => {
        calculatePages(true);
        pendingTargetXPathRef.current = null;
      }, 450);
      renderTimerIdsRef.current.push(t1, t2, t3);
    } else {
      const t1 = window.setTimeout(() => performScroll(false), 50);
      const t2 = window.setTimeout(() => performScroll(false), 200);
      const t3 = window.setTimeout(() => {
        performScroll(true);
        pendingTargetXPathRef.current = null;
      }, 450);
      renderTimerIdsRef.current.push(t1, t2, t3);
    }

    if (pendingAnchorRef.current) {
      const anchorToScroll = pendingAnchorRef.current;
      pendingAnchorRef.current = null;
      const tAnchor = window.setTimeout(() => {
        if (currentReqId !== sectionRequestIdRef.current) return;
        scrollToAnchor(anchorToScroll);
      }, 150);
      renderTimerIdsRef.current.push(tAnchor);
    }

    // 滾動模式進度上報監聽
    if (layoutMode === 'scroll') {
      let scrollTimer: any = null;
      const onScroll = () => {
        if (isRestoringProgressRef.current) return;
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (isRestoringProgressRef.current) return;
          const top = iframeWin.scrollY || iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop || 0;

          let currentXPath = '';
          try {
            const wrapperEl = iframeDoc.getElementById('kavita-book-wrapper') || iframeDoc.body;
            const candidates = Array.from(
              wrapperEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, div')
            ).filter((el) => el.id !== 'kavita-book-wrapper' && el.textContent && el.textContent.trim().length > 0);

            const targetEl = candidates.find((el) => {
              const elTop = (el as HTMLElement).offsetTop || 0;
              const elHeight = (el as HTMLElement).offsetHeight || 0;
              return elTop + elHeight >= top + 15;
            }) || candidates[0];

            if (targetEl) currentXPath = getXPathForElement(targetEl);
          } catch (e) {
            console.warn('滾動提取段落 XPath 失敗:', e);
          }

          const scrollId = currentXPath || `scroll:${Math.round(top)}`;
          progressReconciler.updateProgressOptimistic(
            seriesId,
            volumeId,
            chapterId,
            currentSectionIndex,
            scrollId
          );
        }, 300);
      };
      iframeWin.addEventListener('scroll', onScroll, { passive: true });
    }
  }, [
    sections,
    currentSectionIndex,
    fontSize,
    lineHeight,
    paddingX,
    theme,
    fontFamily,
    activeWeightNum,
    isVertical,
    layoutMode,
    seriesId,
    volumeId,
    chapterId,
    handleLinkClick,
    scrollToAnchor,
  ]);

  useEffect(() => {
    if (!isLoading && sections.length > 0) {
      renderCurrentSection();
    }
  }, [isLoading, renderCurrentSection, sections.length]);

  // 4. 下載整本 EPUB 至 Android 沙盒
  const handleDownload = async () => {
    if (isOffline || downloadProgress !== null) return;

    try {
      await downloadManager.downloadEpubChapter(
        seriesId,
        seriesName,
        volumeId,
        chapterId,
        chapterTitle
      );
    } catch {
      //
    }
  };

  const isDownloading = downloadProgress !== null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden">
      {/* 頂部控制列 */}
      <div
        className={`absolute top-0 left-0 right-0 z-40 bg-zinc-900/90 backdrop-blur-md px-4 py-3 border-b border-zinc-800 flex items-center justify-between transition-transform duration-300 ${
          showControls ? 'translate-y-0' : '-translate-y-full'
        }`}
        style={{ paddingTop: 'calc(var(--sat) + 0.75rem)' }}
      >
        <div className="flex items-center space-x-3 overflow-hidden">
          <button
            onClick={handleClose}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-300 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="truncate">
            <h2 className="text-sm font-semibold text-white truncate">{seriesName}</h2>
            <p className="text-xs text-zinc-400 truncate">{chapterTitle}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* 排版設定按鈕 */}
          <button
            ref={settingsBtnRef}
            onClick={() => setShowSettings((p) => !p)}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-300 hover:text-white"
          >
            <Type className="w-5 h-5" />
          </button>

          {/* 下載按鈕 */}
          <button
            onClick={handleDownload}
            disabled={isOffline || isDownloading}
            className={`p-2 rounded-full flex items-center justify-center min-w-[2.25rem] ${
              isOffline
                ? 'text-emerald-400'
                : isDownloading
                ? 'text-yellow-400'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {isOffline ? (
              <CheckCircle className="w-5 h-5" />
            ) : isDownloading ? (
              <span className="text-xs font-mono font-bold">{downloadProgress}%</span>
            ) : (
              <Download className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* 排版自訂懸浮面板與全螢幕點擊遮罩 */}
      {showSettings && (
        <>
          {/* 透明全螢幕遮罩層：點選任何外部位置（包括 iframe 與所有控制條）保證關閉面板 */}
          <div
            className="fixed inset-0 z-40 bg-transparent"
            onClick={(e) => {
              e.stopPropagation();
              setShowSettings(false);
            }}
          />

          <div
            ref={settingsRef}
            className="absolute top-16 right-4 z-50 bg-zinc-900 border border-zinc-700 rounded-xl p-4 shadow-2xl w-80 max-h-[80vh] overflow-y-auto flex flex-col space-y-4 text-xs text-zinc-200"
            style={{ marginTop: 'var(--sat)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 字級調整 */}
            <div className="flex items-center justify-between">
              <span>字號 ({fontSize}px)</span>
              <div className="flex space-x-2">
                <button
                  onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                  className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                  A-
                </button>
                <button
                  onClick={() => setFontSize((s) => Math.min(32, s + 2))}
                  className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                  A+
                </button>
              </div>
            </div>

            {/* 行高調整 */}
            <div className="flex items-center justify-between">
              <span>行距 ({lineHeight})</span>
              <div className="flex space-x-2">
                <button
                  onClick={() => setLineHeight((h) => Math.max(1.2, parseFloat((h - 0.2).toFixed(1))))}
                  className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                  緊湊
                </button>
                <button
                  onClick={() => setLineHeight((h) => Math.min(2.4, parseFloat((h + 0.2).toFixed(1))))}
                  className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                  寬鬆
                </button>
              </div>
            </div>

            {/* 留白邊距調整 */}
            <div className="flex items-center justify-between">
              <span>留白邊距 ({paddingX}px)</span>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPaddingX((p) => Math.max(8, p - 4))}
                  className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                  收窄
                </button>
                <button
                  onClick={() => setPaddingX((p) => Math.min(64, p + 4))}
                  className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                  擴寬
                </button>
              </div>
            </div>

            {/* 直排 / 橫排切換 */}
            <div className="flex items-center justify-between">
              <span>閱讀方向</span>
              <div className="flex bg-zinc-800 rounded p-1">
                <button
                  onClick={() => setIsVertical(false)}
                  className={`px-3 py-1 rounded ${!isVertical ? 'bg-zinc-700 font-bold' : ''}`}
                >
                  橫排
                </button>
                <button
                  onClick={() => setIsVertical(true)}
                  className={`px-3 py-1 rounded ${isVertical ? 'bg-zinc-700 font-bold' : ''}`}
                >
                  直排
                </button>
              </div>
            </div>

            {/* 版面模式（滾動 / 單欄） */}
            <div className="flex items-center justify-between">
              <span>版面模式</span>
              <div className="flex bg-zinc-800 rounded p-1">
                <button
                  onClick={() => setLayoutMode('scroll')}
                  className={`px-3 py-1 rounded transition-colors ${
                    layoutMode === 'scroll' ? 'bg-zinc-700 font-bold text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  滾動
                </button>
                <button
                  onClick={() => setLayoutMode('paged')}
                  className={`px-3 py-1 rounded transition-colors ${
                    layoutMode === 'paged' ? 'bg-zinc-700 font-bold text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  單欄
                </button>
              </div>
            </div>

            {/* 字型樣式（下拉選單） */}
            <div className="flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">字型</span>
                <div className="flex items-center space-x-2">
                  {fontDownloadProgress?.isDownloading && (
                    <span className="text-[10px] text-emerald-400 animate-pulse font-mono font-bold">
                      {fontDownloadProgress.percentage}%
                    </span>
                  )}
                  <select
                    value={fontFamily}
                    onChange={(e) => handleSelectFont(e.target.value)}
                    disabled={fontDownloadProgress?.isDownloading}
                    className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 max-w-[160px] truncate cursor-pointer"
                  >
                    <option value="sans-serif">預設黑體</option>
                    <option value="serif">思源宋體</option>
                    {fontFamilies.length > 0 && (
                      <optgroup label="伺服器字型">
                        {fontFamilies.map((group) => {
                          const isCached = downloadedFamilies.has(group.family);
                          return (
                            <option key={group.family} value={group.family}>
                              {group.name || group.family} {!isCached ? '(☁️ 需下載)' : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>

              {/* 即時下載進度與狀態卡片 */}
              {fontDownloadProgress && (
                <div className={`p-2 bg-zinc-800/90 border rounded-lg flex flex-col space-y-1.5 animate-fadeIn ${
                  fontDownloadProgress.error
                    ? 'border-rose-500/50 bg-rose-950/20'
                    : 'border-emerald-500/30'
                }`}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={`font-medium truncate max-w-[160px] ${
                      fontDownloadProgress.error ? 'text-rose-400' : 'text-zinc-200'
                    }`}>
                      {fontDownloadProgress.error
                        ? `下載失敗: ${fontDownloadProgress.error}`
                        : `正在下載 ${fontDownloadProgress.fontName}`}
                    </span>
                    {!fontDownloadProgress.error && (
                      <span className="font-mono text-emerald-400 font-bold">
                        {fontDownloadProgress.percentage}%
                      </span>
                    )}
                  </div>
                  {!fontDownloadProgress.error && (
                    <>
                      <div className="w-full bg-zinc-700 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full transition-all duration-150 rounded-full"
                          style={{ width: `${fontDownloadProgress.percentage}%` }}
                        />
                      </div>
                      {fontDownloadProgress.totalBytes > 0 && (
                        <div className="text-[9px] text-zinc-400 text-right font-mono">
                          {(fontDownloadProgress.loadedBytes / 1024 / 1024).toFixed(1)} MB / {(fontDownloadProgress.totalBytes / 1024 / 1024).toFixed(1)} MB
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 字重調節（智慧依字型可用字重增減） */}
            <div className="flex items-center justify-between">
              <span>字重 ({getWeightName(activeWeightNum)})</span>
              <div className="flex space-x-2">
                <button
                  onClick={handleDecreaseWeight}
                  disabled={!canDecreaseWeight}
                  className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  title="減少字重"
                >
                  減少
                </button>
                <button
                  onClick={handleIncreaseWeight}
                  disabled={!canIncreaseWeight}
                  className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  title="增加字重"
                >
                  增加
                </button>
              </div>
            </div>




          {/* 配色主題 */}
          <div className="flex items-center justify-between">
            <span>主題</span>
            <div className="flex space-x-2">
              <button
                onClick={() => setTheme('light')}
                className={`w-6 h-6 rounded-full bg-white border ${
                  theme === 'light' ? 'ring-2 ring-emerald-500' : ''
                }`}
              />
              <button
                onClick={() => setTheme('sepia')}
                className={`w-6 h-6 rounded-full bg-[#fbf0d9] border ${
                  theme === 'sepia' ? 'ring-2 ring-emerald-500' : ''
                }`}
              />
              <button
                onClick={() => setTheme('dark')}
                className={`w-6 h-6 rounded-full bg-[#1f2024] border ${
                  theme === 'dark' ? 'ring-2 ring-emerald-500' : ''
                }`}
              />
              <button
                onClick={() => setTheme('black')}
                className={`w-6 h-6 rounded-full bg-black border ${
                  theme === 'black' ? 'ring-2 ring-emerald-500' : ''
                }`}
              />
            </div>
          </div>
        </div>
      </>
    )}



      {/* 閱讀核心 iframe 容器 */}
      <div
        className="flex-1 w-full h-full relative flex items-center justify-center overflow-hidden transition-all duration-200"
        style={{
          backgroundColor: THEME_STYLES[theme].bg,
          paddingLeft: layoutMode === 'paged' ? `${paddingX}px` : 0,
          paddingRight: layoutMode === 'paged' ? `${paddingX}px` : 0,
        }}
        onClick={() => {
          if (layoutMode === 'scroll') {
            setShowControls((prev) => !prev);
          }
        }}
      >
        {isLoading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black text-zinc-400 text-sm">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
            <span>載入 EPUB 章節中...</span>
          </div>
        )}
        {isSectionLoading && !isLoading && (
          <div className="absolute top-4 right-4 z-30 bg-zinc-900/80 px-3 py-1 rounded-full text-xs text-emerald-400 flex items-center space-x-1.5 backdrop-blur-sm shadow">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>渲染章節中...</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          title="Epub Content"
          className="w-full h-full border-none"
          style={{ backgroundColor: THEME_STYLES[theme].bg }}
          sandbox="allow-same-origin"
          onLoad={() => {
            if (!isLoading && sections.length > 0) {
              renderCurrentSection();
            }
          }}
        />

        {/* 單欄模式頂層透明點擊翻頁熱區 (Tap to Paginate Overlay) */}
        {layoutMode === 'paged' && (
          <div className="absolute inset-0 z-20 flex pointer-events-none">
            {/* 左側熱區 (28%) */}
            <div
              className="w-[28%] h-full pointer-events-auto cursor-pointer select-none active:bg-white/5 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                if (isVertical) {
                  turnPage('next');
                } else {
                  turnPage('prev');
                }
              }}
            />
            {/* 中央穿透區 (44%)：點擊切換控制列 */}
            <div
              className="w-[44%] h-full pointer-events-auto cursor-pointer select-none"
              onClick={(e) => {
                e.stopPropagation();
                setShowControls((prev) => !prev);
              }}
            />
            {/* 右側熱區 (28%) */}
            <div
              className="w-[28%] h-full pointer-events-auto cursor-pointer select-none active:bg-white/5 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                if (isVertical) {
                  turnPage('prev');
                } else {
                  turnPage('next');
                }
              }}
            />
          </div>
        )}
      </div>

      {/* 底部導航與節選進度 */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-40 bg-zinc-900/90 backdrop-blur-md px-6 py-4 border-t border-zinc-800 transition-transform duration-300 ${
          showControls ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'calc(var(--sab) + 1rem)' }}
      >
        <div className="max-w-xl mx-auto flex flex-col space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>
              章節 {currentSectionIndex + 1} / {sections.length}
              {layoutMode === 'paged' && ` · 頁 ${virtualPageIndex + 1} / ${totalVirtualPages}`}
            </span>
            <span className="text-emerald-400">
              {isOffline ? '已在 Android 原生沙盒' : '線上讀取'}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => handleSectionChange(isVertical ? currentSectionIndex + 1 : currentSectionIndex - 1)}
              disabled={isVertical ? currentSectionIndex >= sections.length - 1 : currentSectionIndex <= 0}
              className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-30"
              title={isVertical ? "下一章節" : "上一章節"}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, sections.length - 1)}
              value={currentSectionIndex}
              onChange={(e) => handleSectionChange(parseInt(e.target.value, 10))}
              style={isVertical ? { direction: 'rtl' } : undefined}
              className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <button
              onClick={() => handleSectionChange(isVertical ? currentSectionIndex - 1 : currentSectionIndex + 1)}
              disabled={isVertical ? currentSectionIndex <= 0 : currentSectionIndex >= sections.length - 1}
              className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-30"
              title={isVertical ? "上一章節" : "下一章節"}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
