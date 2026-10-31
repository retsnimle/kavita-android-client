import { useState, useRef, useEffect, useCallback } from 'react';
import { App } from '@capacitor/app';
import { progressReconciler } from '../../../core/sync/reconciler';
import { getXPathForElement, getElementByXPath } from '../utils/xpath';

interface UseReadingProgressProps {
  seriesId: number;
  volumeId: number;
  chapterId: number;
  initialPage?: number;
  onSectionChanged?: (index: number) => void;
}

export interface UseReadingProgressReturn {
  currentSectionIndex: number;
  setCurrentSectionIndex: React.Dispatch<React.SetStateAction<number>>;
  pendingTargetXPathRef: React.MutableRefObject<string | null>;
  initialVirtualTargetRef: React.MutableRefObject<number | 'last' | null>;
  pendingScrollTopRef: React.MutableRefObject<number | null>;
  isRestoringProgressRef: React.MutableRefObject<boolean>;
  initEffectiveProgress: (sectionsLength: number) => Promise<number>;
  handleSectionChange: (
    newIndex: number,
    sectionsLength: number,
    targetVirtual?: number | 'last'
  ) => void;
  reportPagedProgress: (
    pageIdx: number,
    pageWidth: number,
    doc: Document,
    isVertical: boolean,
    totalPages?: number,
    pageOffsets?: number[]
  ) => void;
  reportScrollProgress: (
    top: number,
    doc: Document
  ) => void;
  resolveTargetPageFromXPath: (
    doc: Document,
    pageWidth: number,
    totalPages: number,
    isVertical: boolean,
    targetVirtual: number | 'last' | null,
    pageOffsets?: number[]
  ) => number;
  resolveScrollTarget: (
    win: Window,
    doc: Document,
    fallbackTop: number
  ) => boolean;
  flushProgress: () => Promise<void>;
}

export const useReadingProgress = ({
  seriesId,
  volumeId,
  chapterId,
  initialPage = 0,
  onSectionChanged,
}: UseReadingProgressProps): UseReadingProgressReturn => {
  const [currentSectionIndex, setCurrentSectionIndex] = useState<number>(initialPage);

  const pendingTargetXPathRef = useRef<string | null>(null);
  const initialVirtualTargetRef = useRef<number | 'last' | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const isRestoringProgressRef = useRef<boolean>(false);

  // 立即 Flush 未決進度
  const flushProgress = useCallback(async () => {
    await progressReconciler.flushPendingProgress(chapterId);
  }, [chapterId]);

  // 生命週期監聽：切換到後台、螢幕鎖定、關閉 App 或卸載時，立即 Flush
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      }
    };

    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushProgress);
    window.addEventListener('beforeunload', flushProgress);

    let appListenerHandle: any = null;
    App.addListener('appStateChange', (state) => {
      if (!state.isActive) {
        flushProgress();
      }
    })
      .then((handle) => {
        appListenerHandle = handle;
      })
      .catch(() => {});

    return () => {
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushProgress);
      window.removeEventListener('beforeunload', flushProgress);
      if (appListenerHandle && typeof appListenerHandle.remove === 'function') {
        appListenerHandle.remove();
      }
      flushProgress();
    };
  }, [flushProgress]);

  // 初次載入章節時獲取雙向同步的最新進度
  const initEffectiveProgress = useCallback(
    async (sectionsLength: number): Promise<number> => {
      const effProgress = await progressReconciler.getEffectiveProgress(chapterId);
      if (effProgress.page < sectionsLength) {
        pendingTargetXPathRef.current = effProgress.bookScrollId || null;
        let vTarget: number | 'last' = 0;
        if (effProgress.bookScrollId && effProgress.bookScrollId.startsWith('vpage:')) {
          const parsed = effProgress.bookScrollId.replace('vpage:', '');
          vTarget = parsed === 'last' ? 'last' : parseInt(parsed, 10) || 0;
        }
        initialVirtualTargetRef.current = vTarget;
        if (effProgress.bookScrollId && effProgress.bookScrollId.startsWith('scroll:')) {
          pendingScrollTopRef.current =
            parseInt(effProgress.bookScrollId.replace('scroll:', ''), 10) || 0;
        } else {
          pendingScrollTopRef.current = 0;
        }
        setCurrentSectionIndex(effProgress.page);
        if (onSectionChanged) onSectionChanged(effProgress.page);
        return effProgress.page;
      }
      return 0;
    },
    [chapterId, onSectionChanged]
  );

  // 切換章節並樂觀同步
  const handleSectionChange = useCallback(
    (
      newIndex: number,
      sectionsLength: number,
      targetVirtual: number | 'last' = 0
    ) => {
      if (newIndex < 0 || newIndex >= sectionsLength || newIndex === currentSectionIndex) return;
      // 切換至新章節頂端時不指定特定元素 XPath，由 pendingScrollTopRef = 0 確保完整捲動至章節頂端
      pendingTargetXPathRef.current = targetVirtual === 'last' ? 'last' : null;
      initialVirtualTargetRef.current = targetVirtual;
      pendingScrollTopRef.current = targetVirtual === 'last' ? 9999999 : 0;
      setCurrentSectionIndex(newIndex);
      if (onSectionChanged) onSectionChanged(newIndex);
      const scrollId = targetVirtual === 'last' ? 'last' : 'vpage:0';
      progressReconciler.updateProgressOptimistic(seriesId, volumeId, chapterId, newIndex, scrollId);
    },
    [currentSectionIndex, seriesId, volumeId, chapterId, onSectionChanged]
  );

  // 單欄分頁翻頁時上報當前頁面代表性段落 XPath
  const reportPagedProgress = useCallback(
    (
      pageIdx: number,
      pageWidth: number,
      doc: Document,
      isVert: boolean,
      totalPages = 1,
      pageOffsets?: number[]
    ) => {
      let currentXPath = '';
      try {
        const wrapperEl = doc.getElementById('kavita-book-wrapper') || doc.body;
        const candidates = Array.from(
          wrapperEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, div, img')
        ).filter((el) => {
          if (el.id === 'kavita-book-wrapper') return false;
          if (el.tagName.toLowerCase() === 'img') return true;
          return el.textContent && el.textContent.trim().length > 0;
        });

        const wrapperRect = wrapperEl.getBoundingClientRect();
        const pageStart =
          isVert && pageOffsets && pageOffsets[pageIdx] !== undefined
            ? pageOffsets[pageIdx]
            : pageIdx * pageWidth;
        const pageEnd =
          isVert && pageOffsets && pageOffsets[pageIdx + 1] !== undefined
            ? pageOffsets[pageIdx + 1]
            : isVert && pageOffsets && pageOffsets[pageIdx] !== undefined
            ? pageOffsets[pageIdx] + pageWidth
            : (pageIdx + 1) * pageWidth;

        if (isVert) {
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
        console.warn('提取分頁段落 XPath 失敗，將 fallback 至相對比例:', e);
      }

      const ratio = totalPages > 1 ? (pageIdx / (totalPages - 1)).toFixed(4) : '0.0000';
      const scrollId = currentXPath || `pos:${ratio}`;
      progressReconciler.updateProgressOptimistic(
        seriesId,
        volumeId,
        chapterId,
        currentSectionIndex,
        scrollId
      );
    },
    [seriesId, volumeId, chapterId, currentSectionIndex]
  );

  // 連續滾動模式防抖上報
  const reportScrollProgress = useCallback(
    (top: number, doc: Document) => {
      let currentXPath = '';
      try {
        const wrapperEl = doc.getElementById('kavita-book-wrapper') || doc.body;
        const candidates = Array.from(
          wrapperEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, div, img')
        ).filter((el) => {
          if (el.id === 'kavita-book-wrapper') return false;
          if (el.tagName.toLowerCase() === 'img') return true;
          return el.textContent && el.textContent.trim().length > 0;
        });

        const targetEl =
          candidates.find((el) => {
            const elTop = (el as HTMLElement).offsetTop || 0;
            const elHeight = (el as HTMLElement).offsetHeight || 0;
            return elTop + elHeight >= top + 15;
          }) || candidates[0];

        if (targetEl) currentXPath = getXPathForElement(targetEl);
      } catch (e) {
        console.warn('滾動提取段落 XPath 失敗:', e);
      }

      const scrollH = Math.max(doc.documentElement.scrollHeight || 0, doc.body.scrollHeight || 0, 1);
      const ratio = Math.min(1, Math.max(0, top / scrollH)).toFixed(4);
      const scrollId = currentXPath || `pos:${ratio}`;
      progressReconciler.updateProgressOptimistic(
        seriesId,
        volumeId,
        chapterId,
        currentSectionIndex,
        scrollId
      );
    },
    [seriesId, volumeId, chapterId, currentSectionIndex]
  );

  // 依據 XPath 在 multi-column 中換算目標頁碼（結合 getBoundingClientRect 幾何）
  const resolveTargetPageFromXPath = useCallback(
    (
      doc: Document,
      pageWidth: number,
      totalPages: number,
      isVert: boolean,
      targetVirtual: number | 'last' | null,
      pageOffsets?: number[]
    ): number => {
      let targetPage = 0;
      let located = false;

      if (pendingTargetXPathRef.current) {
        const xp = pendingTargetXPathRef.current;
        if (xp === 'last' || xp === 'vpage:last') {
          targetPage = totalPages - 1;
          located = true;
        } else if (xp.startsWith('pos:')) {
          const ratio = parseFloat(xp.replace('pos:', '')) || 0;
          targetPage = Math.min(totalPages - 1, Math.max(0, Math.round(ratio * (totalPages - 1))));
          located = true;
        } else if (xp.includes('/') || xp.startsWith('id(')) {
          const el = getElementByXPath(doc, xp);
          if (el) {
            const wrapperEl = doc.getElementById('kavita-book-wrapper') || doc.body;
            const wrapperBox = wrapperEl.getBoundingClientRect();
            const elBox = el.getBoundingClientRect();

            if (isVert && pageOffsets && pageOffsets.length > 0) {
              const visualX = wrapperBox.right - elBox.right;
              let foundPage = 0;
              for (let p = 0; p < pageOffsets.length; p++) {
                if (pageOffsets[p] <= visualX) {
                  foundPage = p;
                } else {
                  break;
                }
              }
              targetPage = Math.min(totalPages - 1, foundPage);
            } else if (isVert) {
              const visualX = wrapperBox.right - elBox.right;
              targetPage = Math.max(0, Math.floor((visualX + 2) / pageWidth));
            } else {
              const visualX = elBox.left - wrapperBox.left;
              targetPage = Math.max(0, Math.floor((visualX + 2) / pageWidth));
            }
            located = true;
          }
        } else if (xp.startsWith('vpage:')) {
          const parsed = xp.replace('vpage:', '');
          targetPage = parsed === 'last' ? totalPages - 1 : parseInt(parsed, 10) || 0;
          located = true;
        }
      }

      if (!located) {
        const target = targetVirtual;
        targetPage =
          target === 'last' ? totalPages - 1 : Math.min(typeof target === 'number' ? target : 0, totalPages - 1);
      }

      return Math.max(0, Math.min(targetPage, totalPages - 1));
    },
    []
  );

  // 連續滾動模式尋找 XPath 目標元素
  const resolveScrollTarget = useCallback(
    (win: Window, doc: Document, fallbackTop: number): boolean => {
      let located = false;
      if (pendingTargetXPathRef.current) {
        const xp = pendingTargetXPathRef.current;
        if (xp.startsWith('pos:')) {
          const ratio = parseFloat(xp.replace('pos:', '')) || 0;
          const scrollH = Math.max(doc.documentElement.scrollHeight || 0, doc.body.scrollHeight || 0);
          const maxScroll = Math.max(0, scrollH - (win.innerHeight || 0));
          const targetY = Math.round(ratio * maxScroll);
          win.scrollTo({ top: targetY, left: 0, behavior: 'auto' });
          located = true;
        } else if (xp.includes('/') || xp.startsWith('id(')) {
          const el = getElementByXPath(doc, xp);
          if (el) {
            el.scrollIntoView({ behavior: 'auto', block: 'start' });
            located = true;
          }
        } else if (xp.startsWith('scroll:')) {
          const parsed = parseInt(xp.replace('scroll:', ''), 10) || 0;
          win.scrollTo({ top: parsed, left: 0, behavior: 'auto' });
          located = true;
        }
      }

      if (!located) {
        let actualTop = fallbackTop;
        if (fallbackTop >= 9999999) {
          const scrollH = Math.max(doc.documentElement.scrollHeight || 0, doc.body.scrollHeight || 0);
          actualTop = Math.max(0, scrollH - (win.innerHeight || 0));
        }
        win.scrollTo({ top: actualTop, left: 0, behavior: 'auto' });
        if (doc.documentElement) doc.documentElement.scrollTop = actualTop;
        if (doc.body) doc.body.scrollTop = actualTop;
      }
      return located;
    },
    []
  );

  return {
    currentSectionIndex,
    setCurrentSectionIndex,
    pendingTargetXPathRef,
    initialVirtualTargetRef,
    pendingScrollTopRef,
    isRestoringProgressRef,
    initEffectiveProgress,
    handleSectionChange,
    reportPagedProgress,
    reportScrollProgress,
    resolveTargetPageFromXPath,
    resolveScrollTarget,
    flushProgress,
  };
};
