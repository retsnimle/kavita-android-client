import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Download,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { kavitaClient } from '../../api/kavitaClient';
import { nativeStorage } from '../../core/storage/nativeStorage';
import { progressReconciler } from '../../core/sync/reconciler';
import { downloadManager } from '../../core/storage/downloadManager';
import { backButtonManager } from '../../core/navigation/backButtonManager';
import { useI18n } from '../../core/i18n';


interface ComicReaderProps {
  seriesId: number;
  seriesName: string;
  volumeId: number;
  chapterId: number;
  chapterTitle: string;
  initialPage?: number;
  onClose: () => void;
}

export type ReaderMode = 'rtl' | 'ltr' | 'webtoon';

export const ComicReader: React.FC<ComicReaderProps> = ({
  seriesId,
  seriesName,
  volumeId,
  chapterId,
  chapterTitle,
  initialPage = 0,
  onClose,
}) => {
  const { t } = useI18n();
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [mode, setMode] = useState<ReaderMode>('rtl'); // 預設日漫右至左
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadPercent, setDownloadPercent] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const initialTargetPageRef = useRef<number>(initialPage);
  const isRestoringScrollRef = useRef<boolean>(false);

  // 監聽 Android 返回鍵：退出漫畫閱讀器
  useEffect(() => {
    const unregister = backButtonManager.register(() => {
      onClose();
      return true;
    });
    return unregister;
  }, [onClose]);


  // 1. 初始化章節資訊與離線狀態
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        setIsLoading(true);
        const offline = await downloadManager.isChapterOffline(chapterId);
        if (!mounted) return;
        setIsOffline(offline);

        // 取得有效進度（含伺服器/本地最新對齊）
        const eff = await progressReconciler.getEffectiveProgress(chapterId);
        if (eff.page > 0 && currentPage === 0) {
          setCurrentPage(eff.page);
          initialTargetPageRef.current = eff.page;
        }

        // 取得章節總頁數
        const info = await kavitaClient.getChapterInfo(chapterId);
        if (!mounted) return;
        setTotalPages(info.pages);
      } catch (e) {
        console.error('初始化章節失敗:', e);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [chapterId]);

  // 2. 載入與預快取圖片 URL
  const loadPageUrl = useCallback(
    async (pageIndex: number) => {
      if (pageUrls[pageIndex]) return pageUrls[pageIndex];

      let url = '';
      if (isOffline) {
        url = await nativeStorage.getComicPageUrl(chapterId, pageIndex);
      } else {
        url = kavitaClient.getChapterImageUrl(chapterId, pageIndex);
      }

      if (url) {
        setPageUrls((prev) => ({ ...prev, [pageIndex]: url }));
      }
      return url;
    },
    [chapterId, isOffline, pageUrls]
  );

  // 翻頁時預載當前頁及前後 2 頁
  useEffect(() => {
    if (totalPages === 0) return;
    loadPageUrl(currentPage);
    if (currentPage + 1 < totalPages) loadPageUrl(currentPage + 1);
    if (currentPage + 2 < totalPages) loadPageUrl(currentPage + 2);
    if (currentPage - 1 >= 0) loadPageUrl(currentPage - 1);
  }, [currentPage, totalPages, loadPageUrl]);

  // 3. 翻頁與樂觀進度同步
  const handlePageChange = useCallback(
    (newPage: number, scrollToElement = true) => {
      if (newPage < 0 || newPage >= totalPages || newPage === currentPage) return;
      setCurrentPage(newPage);
      // 樂觀上報至後端與本地佇列
      progressReconciler.updateProgressOptimistic(seriesId, volumeId, chapterId, newPage);

      if (mode === 'webtoon' && scrollToElement) {
        const el = document.getElementById(`webtoon-page-${newPage}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    },
    [totalPages, currentPage, mode, seriesId, volumeId, chapterId]
  );

  // Webtoon 模式初始化滾動至上次閱讀頁面
  useEffect(() => {
    if (mode === 'webtoon' && !isLoading && totalPages > 0 && initialTargetPageRef.current > 0) {
      const target = initialTargetPageRef.current;
      initialTargetPageRef.current = 0;
      isRestoringScrollRef.current = true;
      setTimeout(() => {
        const el = document.getElementById(`webtoon-page-${target}`);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
      }, 150);
      setTimeout(() => {
        const el = document.getElementById(`webtoon-page-${target}`);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
        isRestoringScrollRef.current = false;
      }, 500);
    }
  }, [mode, isLoading, totalPages]);

  // Webtoon 模式使用 IntersectionObserver 高效即時判定可視頁碼並上報進度
  useEffect(() => {
    if (mode !== 'webtoon' || isLoading || totalPages === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const visibleRatios = new Map<number, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        if (isRestoringScrollRef.current) return;

        entries.forEach((entry) => {
          const pageAttr = entry.target.getAttribute('data-page-index');
          if (pageAttr !== null) {
            const pageIdx = parseInt(pageAttr, 10);
            if (!isNaN(pageIdx)) {
              if (entry.isIntersecting) {
                visibleRatios.set(pageIdx, entry.intersectionRatio);
              } else {
                visibleRatios.delete(pageIdx);
              }
            }
          }
        });

        if (visibleRatios.size === 0) return;

        // 找出可視比例最高（或最主要呈現）的頁面
        let bestPage = -1;
        let maxRatio = -1;
        visibleRatios.forEach((ratio, pageIdx) => {
          if (ratio > maxRatio) {
            maxRatio = ratio;
            bestPage = pageIdx;
          }
        });

        if (bestPage >= 0 && bestPage !== currentPage) {
          setCurrentPage(bestPage);
          progressReconciler.updateProgressOptimistic(seriesId, volumeId, chapterId, bestPage);
        }
      },
      {
        root: container,
        threshold: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
      }
    );

    // 尋找所有帶有 data-page-index 的圖片元素
    const pageElements = container.querySelectorAll('[data-page-index]');
    pageElements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, [mode, isLoading, totalPages, currentPage, seriesId, volumeId, chapterId]);

  // 4. 點擊翻頁邏輯
  const handleScreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 點擊頂部或底部區域不翻頁，僅點擊中間喚出/關閉控制列
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const clickZone = x / width;

    if (mode === 'webtoon') {
      // Webtoon 模式點擊任意處切換控制列
      setShowControls((prev) => !prev);
      return;
    }

    if (clickZone >= 0.35 && clickZone <= 0.65) {
      // 中央區域：切換選單
      setShowControls((prev) => !prev);
    } else if (clickZone < 0.35) {
      // 左側點擊
      if (mode === 'rtl') {
        handlePageChange(currentPage + 1); // RTL: 往左翻是下一頁
      } else {
        handlePageChange(currentPage - 1); // LTR: 往左翻是上一頁
      }
    } else {
      // 右側點擊
      if (mode === 'rtl') {
        handlePageChange(currentPage - 1); // RTL: 往右翻是上一頁
      } else {
        handlePageChange(currentPage + 1); // LTR: 往右翻是下一頁
      }
    }
  };

  // 鍵盤導航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        if (mode === 'rtl') {
          handlePageChange(currentPage + 1);
        } else {
          handlePageChange(currentPage - 1);
        }
      } else if (e.key === 'ArrowRight') {
        if (mode === 'rtl') {
          handlePageChange(currentPage - 1);
        } else {
          handlePageChange(currentPage + 1);
        }
      } else if (e.key === ' ') {
        setShowControls((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, mode, handlePageChange]);

  // 5. 下載本話至 Android 沙盒
  const handleDownload = async () => {
    if (isOffline || isDownloading) return;
    setIsDownloading(true);

    const unsubscribe = downloadManager.subscribe((p) => {
      if (p.chapterId === chapterId) {
        setDownloadPercent(p.percentage);
        if (p.status === 'completed') {
          setIsOffline(true);
          setIsDownloading(false);
        } else if (p.status === 'error') {
          setIsDownloading(false);
        }
      }
    });

    try {
      await downloadManager.downloadComicChapter(
        seriesId,
        seriesName,
        volumeId,
        chapterId,
        chapterTitle
      );
    } catch {
      // 錯誤已在 downloadManager 處理
    } finally {
      unsubscribe();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black select-none overflow-hidden flex flex-col">
      {/* 頂部控制列 */}
      <div
        className={`absolute top-0 left-0 right-0 z-40 bg-zinc-900/90 backdrop-blur-md px-4 py-3 border-b border-zinc-800 flex items-center justify-between transition-transform duration-300 ${
          showControls ? 'translate-y-0' : '-translate-y-full'
        }`}
        style={{ paddingTop: 'calc(var(--sat) + 0.75rem)' }}
      >
        <div className="flex items-center space-x-3 overflow-hidden">
          <button
            onClick={onClose}
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
          {/* 模式切換按鈕 */}
          <div className="flex bg-zinc-800 rounded-lg p-1 text-xs">
            <button
              onClick={() => setMode('rtl')}
              className={`px-2 py-1 rounded ${
                mode === 'rtl' ? 'bg-zinc-700 text-white font-medium' : 'text-zinc-400'
              }`}
            >
              {t('comic.modeRtl')}
            </button>
            <button
              onClick={() => setMode('ltr')}
              className={`px-2 py-1 rounded ${
                mode === 'ltr' ? 'bg-zinc-700 text-white font-medium' : 'text-zinc-400'
              }`}
            >
              {t('comic.modeLtr')}
            </button>
            <button
              onClick={() => setMode('webtoon')}
              className={`px-2 py-1 rounded ${
                mode === 'webtoon' ? 'bg-zinc-700 text-white font-medium' : 'text-zinc-400'
              }`}
            >
              {t('comic.modeWebtoon')}
            </button>
          </div>

          {/* 下載按鈕 */}
          <button
            onClick={handleDownload}
            disabled={isOffline || isDownloading}
            className={`p-2 rounded-full ${
              isOffline
                ? 'text-emerald-400'
                : isDownloading
                ? 'text-yellow-400'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
            title={isOffline ? t('comic.inSandboxTooltip') : t('comic.downloadChapterTooltip')}
          >
            {isOffline ? (
              <CheckCircle className="w-5 h-5" />
            ) : isDownloading ? (
              <span className="text-xs font-bold">{downloadPercent}%</span>
            ) : (
              <Download className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* 閱讀畫布區塊 */}
      <div
        ref={containerRef}
        onClick={handleScreenClick}
        className="flex-1 w-full h-full relative overflow-y-auto overflow-x-hidden flex items-center justify-center"
      >
        {isLoading ? (
          <div className="text-zinc-400 text-sm animate-pulse">{t('comic.loading')}</div>
        ) : mode === 'webtoon' ? (
          /* Webtoon 瀑布流連續滾動模式 */
          <div className="w-full max-w-3xl flex flex-col items-center">
            {Array.from({ length: totalPages }).map((_, idx) => {
              const url = pageUrls[idx] || kavitaClient.getChapterImageUrl(chapterId, idx);
              return (
                <img
                  id={`webtoon-page-${idx}`}
                  data-page-index={idx}
                  key={idx}
                  src={url}
                  alt={`Page ${idx + 1}`}
                  loading="lazy"
                  className="w-full h-auto block select-none"
                />
              );
            })}
          </div>
        ) : (
          /* 日漫 / 美漫單頁或拼合顯示 */
          <div className="w-full h-full flex items-center justify-center p-0">
            {pageUrls[currentPage] ? (
              <img
                src={pageUrls[currentPage]}
                alt={`Page ${currentPage + 1}`}
                className="max-w-full max-h-full object-contain select-none shadow-2xl transition-opacity duration-150"
              />
            ) : (
              <div className="text-zinc-500 text-sm">{t('comic.loadingPage', { page: currentPage + 1 })}</div>
            )}
          </div>
        )}
      </div>

      {/* 底部控制列與頁碼滑桿 */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-40 bg-zinc-900/90 backdrop-blur-md px-6 py-4 border-t border-zinc-800 transition-transform duration-300 ${
          showControls ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'calc(var(--sab) + 1rem)' }}
      >
        <div className="max-w-xl mx-auto flex flex-col space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
            <span>
              {t('comic.pageIndicator', { current: currentPage + 1, total: totalPages })}
            </span>
            <span className="text-emerald-400 font-sans">
              {isOffline ? t('common.inSandbox') : t('common.onlineStream')}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {mode === 'rtl' ? (
              // 日漫模式 (RTL): 閱讀方向由右向左，進度滑桿從右至左增長
              <>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages - 1}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                  title={t('comic.nextPageRtl')}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <input
                  type="range"
                  dir="rtl"
                  min={0}
                  max={Math.max(0, totalPages - 1)}
                  value={currentPage}
                  onChange={(e) => handlePageChange(parseInt(e.target.value, 10))}
                  className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 0}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                  title={t('comic.prevPageRtl')}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            ) : (
              // 美漫/普通模式 (LTR): 閱讀方向由左向右
              <>
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 0}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                  title={t('comic.prevPageLtr')}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <input
                  type="range"
                  dir="ltr"
                  min={0}
                  max={Math.max(0, totalPages - 1)}
                  value={currentPage}
                  onChange={(e) => handlePageChange(parseInt(e.target.value, 10))}
                  className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages - 1}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                  title={t('comic.nextPageLtr')}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
