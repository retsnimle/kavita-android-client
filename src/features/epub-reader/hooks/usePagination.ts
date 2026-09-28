import { useState, useRef, useCallback } from 'react';
import type { LayoutMode } from '../types';

interface UsePaginationProps {
  layoutMode: LayoutMode;
  isVertical: boolean;
  totalSections: number;
  currentSectionIndex: number;
  onTurnSection: (nextSectionIndex: number, targetVirtual: number | 'last') => void;
  onReportProgress: (pageIdx: number, pageWidth: number, doc: Document, totalPages?: number) => void;
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
    shouldJump?: boolean,
    knownScrollWidth?: number
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

  const onTurnSectionRef = useRef(onTurnSection);
  onTurnSectionRef.current = onTurnSection;
  const onReportProgressRef = useRef(onReportProgress);
  onReportProgressRef.current = onReportProgress;
  const onResolveTargetPageRef = useRef(onResolveTargetPage);
  onResolveTargetPageRef.current = onResolveTargetPage;

  const pageOffsetsRef = useRef<number[]>([0]);

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
      const offset = isVertical
        ? (pageOffsetsRef.current[pageIdx] ?? pageIdx * pageWidth)
        : -pageIdx * pageWidth;

      if (wrapper) {
        wrapper.style.transition = animate ? 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)' : 'none';
        wrapper.style.transform = `translateX(${offset}px)`;
      } else {
        const targetLeft = isVertical ? -offset : pageIdx * pageWidth;
        doc.defaultView?.scrollTo({
          left: targetLeft,
          top: 0,
          behavior: animate ? 'smooth' : 'auto',
        });
      }
      virtualPageIndexRef.current = pageIdx;
      setVirtualPageIndex(pageIdx);

      if (reportProgress) {
        onReportProgressRef.current(pageIdx, pageWidth, doc, totalVirtualPagesRef.current);
      }
    },
    [isVertical]
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
            onTurnSectionRef.current(currentSectionIndex + 1, 0);
          }
        }
      } else {
        if (current > 0) {
          goToVirtualPageRef.current(doc, pageWidth, current - 1);
        } else {
          if (currentSectionIndex > 0) {
            onTurnSectionRef.current(currentSectionIndex - 1, 'last');
          }
        }
      }
    },
    [layoutMode, currentSectionIndex, totalSections]
  );

  // 幾何精確分頁測量與目標頁跳轉
  const calculatePages = useCallback(
    (
      doc: Document,
      pageWidth: number,
      targetVirtual: number | 'last' | null,
      shouldJump = false,
      knownScrollWidth?: number
    ): number => {
      if (!doc || pageWidth <= 0) return 1;

      const wrapper = doc.getElementById('kavita-book-wrapper') || doc.body;

      if (isVertical) {
        // 直排：基於真實文字行物理邊界的 Line Snap Paging Engine
        const oldTransform = wrapper.style.transform;
        wrapper.style.transform = 'none';

        const W = pageWidth;
        const wrapperRect = wrapper.getBoundingClientRect();
        const baseRight = wrapperRect.right;

        const textNodes: Text[] = [];
        const walk = doc.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, null);
        let n: Node | null;
        while ((n = walk.nextNode())) {
          if (n.textContent && n.textContent.trim().length > 0) {
            textNodes.push(n as Text);
          }
        }

        const range = doc.createRange();
        const lineDistances: { rightDist: number; leftDist: number; width: number }[] = [];
        for (const node of textNodes) {
          range.selectNodeContents(node);
          const rects = range.getClientRects();
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r.width > 0 && r.height > 0) {
              const rightDist = Math.max(0, baseRight - r.right);
              const leftDist = Math.max(0, baseRight - r.left);
              lineDistances.push({ rightDist, leftDist, width: r.width });
            }
          }
        }

        lineDistances.sort((a, b) => a.rightDist - b.rightDist);

        const offsets: number[] = [0];
        let currentStartDist = 0;

        for (let i = 0; i < lineDistances.length; i++) {
          const line = lineDistances[i];
          if (line.leftDist > currentStartDist + W) {
            const nextStartDist = line.rightDist;
            if (nextStartDist > currentStartDist) {
              offsets.push(nextStartDist);
              currentStartDist = nextStartDist;
            }
          }
        }

        if (offsets.length === 0) offsets.push(0);
        pageOffsetsRef.current = offsets;
        wrapper.style.transform = oldTransform;

        const pages = offsets.length;
        totalVirtualPagesRef.current = pages;
        setTotalVirtualPages(pages);

        if (shouldJump) {
          const targetPage = onResolveTargetPageRef.current(
            doc,
            W,
            pages,
            isVertical,
            targetVirtual
          );
          goToVirtualPageRef.current(doc, pageWidth, targetPage, false, false);
        }

        const wrapperEl = doc.getElementById('kavita-book-wrapper');
        if (wrapperEl && !wrapperEl.classList.contains('is-ready')) {
          wrapperEl.classList.add('is-ready');
        }

        return pages;
      } else {
        // 橫排：CSS Multi-column 視窗寬度分頁
        const scrollW =
          knownScrollWidth !== undefined && knownScrollWidth > 0
            ? Math.max(knownScrollWidth, pageWidth)
            : Math.max(
                wrapper.getBoundingClientRect ? wrapper.getBoundingClientRect().width : 0,
                wrapper.scrollWidth || 0,
                doc.documentElement.scrollWidth || 0,
                doc.body.scrollWidth || 0,
                pageWidth
              );

        const pages = Math.max(1, Math.ceil((scrollW - 2) / pageWidth));
        totalVirtualPagesRef.current = pages;
        setTotalVirtualPages(pages);

        if (shouldJump) {
          const targetPage = onResolveTargetPageRef.current(
            doc,
            pageWidth,
            pages,
            isVertical,
            targetVirtual
          );
          goToVirtualPageRef.current(doc, pageWidth, targetPage, false, false);
        }

        const wrapperEl = doc.getElementById('kavita-book-wrapper');
        if (wrapperEl && !wrapperEl.classList.contains('is-ready')) {
          wrapperEl.classList.add('is-ready');
        }

        return pages;
      }
    },
    [isVertical]
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
