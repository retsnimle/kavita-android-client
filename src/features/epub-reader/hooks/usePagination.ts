import { useState, useRef, useCallback } from 'react';
import type { LayoutMode } from '../types';

interface UsePaginationProps {
  layoutMode: LayoutMode;
  isVertical: boolean;
  totalSections: number;
  currentSectionIndex: number;
  onTurnSection: (nextSectionIndex: number, targetVirtual: number | 'last') => void;
  onReportProgress: (pageIdx: number, pageWidth: number, doc: Document) => void;
  onResolveTargetPage: (
    doc: Document,
    pageWidth: number,
    totalPages: number,
    isVertical: boolean,
    targetVirtual: number | 'last' | null
  ) => number;
}

export interface UsePaginationReturn {
  virtualPageIndex: number;
  setVirtualPageIndex: React.Dispatch<React.SetStateAction<number>>;
  totalVirtualPages: number;
  setTotalVirtualPages: React.Dispatch<React.SetStateAction<number>>;
  virtualPageIndexRef: React.MutableRefObject<number>;
  totalVirtualPagesRef: React.MutableRefObject<number>;
  goToVirtualPage: (
    doc: Document,
    pageWidth: number,
    pageIdx: number,
    animate?: boolean,
    reportProgress?: boolean
  ) => void;
  turnPage: (
    doc: Document,
    pageWidth: number,
    direction: 'next' | 'prev'
  ) => void;
  calculatePages: (
    doc: Document,
    pageWidth: number,
    targetVirtual: number | 'last' | null,
    shouldJump?: boolean
  ) => number;
}

export const usePagination = ({
  layoutMode,
  isVertical,
  totalSections,
  currentSectionIndex,
  onTurnSection,
  onReportProgress,
  onResolveTargetPage,
}: UsePaginationProps): UsePaginationReturn => {
  const [virtualPageIndex, setVirtualPageIndex] = useState<number>(0);
  const [totalVirtualPages, setTotalVirtualPages] = useState<number>(1);
  const virtualPageIndexRef = useRef<number>(0);
  const totalVirtualPagesRef = useRef<number>(1);

  // 跳轉至指定虛擬分頁
  const goToVirtualPage = useCallback(
    (
      doc: Document,
      pageWidth: number,
      pageIdx: number,
      animate = true,
      reportProgress = true
    ) => {
      if (!doc) return;
      const wrapper = doc.getElementById('kavita-book-wrapper');

      if (wrapper) {
        // 直排：由右至左排列，第 0 頁在最右側 (x=0)；翻至第 pageIdx 頁需將容器向右平移 pageIdx * pageWidth
        // 橫排：由左至右排列，第 0 頁在最左側 (x=0)；翻至第 pageIdx 頁需將容器向左平移 -pageIdx * pageWidth
        const offset = isVertical ? pageIdx * pageWidth : -pageIdx * pageWidth;
        wrapper.style.transition = animate ? 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)' : 'none';
        wrapper.style.transform = `translateX(${offset}px)`;
      } else {
        const targetLeft = isVertical ? -pageIdx * pageWidth : pageIdx * pageWidth;
        doc.defaultView?.scrollTo({
          left: targetLeft,
          top: 0,
          behavior: animate ? 'smooth' : 'auto',
        });
      }
      virtualPageIndexRef.current = pageIdx;
      setVirtualPageIndex(pageIdx);

      if (reportProgress) {
        onReportProgress(pageIdx, pageWidth, doc);
      }
    },
    [isVertical, onReportProgress]
  );

  const goToVirtualPageRef = useRef(goToVirtualPage);
  goToVirtualPageRef.current = goToVirtualPage;

  // 翻頁邏輯
  const turnPage = useCallback(
    (doc: Document, pageWidth: number, direction: 'next' | 'prev') => {
      if (layoutMode !== 'paged') return;

      const current = virtualPageIndexRef.current;
      const total = totalVirtualPagesRef.current;

      if (direction === 'next') {
        if (current + 1 < total) {
          goToVirtualPageRef.current(doc, pageWidth, current + 1);
        } else {
          if (currentSectionIndex < totalSections - 1) {
            onTurnSection(currentSectionIndex + 1, 0);
          }
        }
      } else {
        if (current > 0) {
          goToVirtualPageRef.current(doc, pageWidth, current - 1);
        } else {
          if (currentSectionIndex > 0) {
            onTurnSection(currentSectionIndex - 1, 'last');
          }
        }
      }
    },
    [layoutMode, currentSectionIndex, totalSections, onTurnSection]
  );

  // 單欄分頁測量與目標頁跳轉
  const calculatePages = useCallback(
    (
      doc: Document,
      pageWidth: number,
      targetVirtual: number | 'last' | null,
      shouldJump = false
    ): number => {
      if (!doc || pageWidth <= 0) return 1;

      const wrapper = doc.getElementById('kavita-book-wrapper') || doc.body;
      const wrapperRect = wrapper.getBoundingClientRect ? wrapper.getBoundingClientRect().width : 0;
      const scrollW = Math.max(
        wrapperRect,
        wrapper.scrollWidth || 0,
        doc.documentElement.scrollWidth || 0,
        doc.body.scrollWidth || 0,
        pageWidth
      );

      // 減去微小的 2px 浮點容差，即刻算出總頁數
      const pages = Math.max(1, Math.ceil((scrollW - 2) / pageWidth));
      totalVirtualPagesRef.current = pages;
      setTotalVirtualPages(pages);

      if (shouldJump) {
        const targetPage = onResolveTargetPage(
          doc,
          pageWidth,
          pages,
          isVertical,
          targetVirtual
        );
        goToVirtualPageRef.current(doc, pageWidth, targetPage, false, false);
      }

      // 初次跳轉定位完成，揭示 wrapper 呈現淡入動畫（消除抽動）
      const wrapperEl = doc.getElementById('kavita-book-wrapper');
      if (wrapperEl && !wrapperEl.classList.contains('is-ready')) {
        wrapperEl.classList.add('is-ready');
      }

      return pages;
    },
    [isVertical, onResolveTargetPage]
  );

  return {
    virtualPageIndex,
    setVirtualPageIndex,
    totalVirtualPages,
    setTotalVirtualPages,
    virtualPageIndexRef,
    totalVirtualPagesRef,
    goToVirtualPage,
    turnPage,
    calculatePages,
  };
};
