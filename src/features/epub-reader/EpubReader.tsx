import React, { useState, useEffect, useRef, useCallback } from 'react';
import { backButtonManager } from '../../core/navigation/backButtonManager';
import { fontLoader } from '../../core/storage/fontLoader';
import {
  type EpubReaderProps,
  THEME_STYLES,
} from './types';
import { useReaderPreferences } from './hooks/useReaderPreferences';
import { useEpubLoader } from './hooks/useEpubLoader';
import { useReadingProgress } from './hooks/useReadingProgress';
import { usePagination } from './hooks/usePagination';
import { ReaderHeader } from './components/ReaderHeader';
import { ReaderFooter } from './components/ReaderFooter';
import { ReaderSettingsModal } from './components/ReaderSettingsModal';

export const EpubReader: React.FC<EpubReaderProps> = ({
  seriesId,
  seriesName,
  volumeId,
  chapterId,
  chapterTitle,
  initialPage = 0,
  onClose,
}) => {
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pendingAnchorRef = useRef<string | null>(null);

  // 定時器清理與非同步世代保護鎖
  const renderTimerIdsRef = useRef<number[]>([]);
  const sectionRequestIdRef = useRef<number>(0);

  const getIframeDoc = useCallback(() => {
    return iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
  }, []);

  // 1. 排版與字型設定 Hook
  const preferences = useReaderPreferences(getIframeDoc);
  const {
    fontSize,
    lineHeight,
    paddingX,
    theme,
    fontFamily,
    activeWeightNum,
    isVertical,
    layoutMode,
  } = preferences;

  // 2. 雙軌 EPUB 內容載入 Hook
  const loader = useEpubLoader({
    seriesId,
    seriesName,
    volumeId,
    chapterId,
    chapterTitle,
  });
  const {
    sections,
    isLoading,
    isSectionLoading,
    setIsSectionLoading,
    isOffline,
    downloadProgress,
    handleDownload,
    getSectionHtml,
    resolveRelativePath,
  } = loader;

  // 3. 閱讀進度與雙向 XPath 同步 Hook
  const progress = useReadingProgress({
    seriesId,
    volumeId,
    chapterId,
    initialPage,
  });
  const {
    currentSectionIndex,
    pendingTargetXPathRef,
    initialVirtualTargetRef,
    pendingScrollTopRef,
    isRestoringProgressRef,
    initEffectiveProgress,
    handleSectionChange: syncSectionChange,
    reportPagedProgress,
    reportScrollProgress,
    resolveTargetPageFromXPath,
    resolveScrollTarget,
    flushProgress,
  } = progress;

  // 關閉閱讀器（立即 Flush 進度）
  const handleClose = useCallback(async () => {
    await flushProgress();
    onClose();
  }, [flushProgress, onClose]);

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

  // 4. 多欄分頁幾何與頁碼 Hook
  const pagination = usePagination({
    layoutMode,
    isVertical,
    totalSections: sections.length,
    currentSectionIndex,
    onTurnSection: (nextSec, targetVirtual) => {
      syncSectionChange(nextSec, sections.length, targetVirtual);
    },
    onReportProgress: (pageIdx, pageWidth, doc) => {
      reportPagedProgress(pageIdx, pageWidth, doc, isVertical);
    },
    onResolveTargetPage: (doc, pageWidth, totalPages, isVert, targetVirtual) => {
      return resolveTargetPageFromXPath(doc, pageWidth, totalPages, isVert, targetVirtual);
    },
  });
  const {
    virtualPageIndex,
    totalVirtualPages,
    turnPage,
    calculatePages,
  } = pagination;

  const [isProgressReady, setIsProgressReady] = useState<boolean>(false);

  useEffect(() => {
    setIsProgressReady(false);
  }, [chapterId]);

  // 當骨架解析完成時，初始化雙向有效進度，對齊完成後才標記就緒（徹底杜絕搶先渲染封面）
  useEffect(() => {
    let mounted = true;
    if (sections.length > 0) {
      initEffectiveProgress(sections.length)
        .catch((err) => {
          console.warn('初始化閱讀進度失敗:', err);
        })
        .finally(() => {
          if (mounted) {
            setIsProgressReady(true);
          }
        });
    }
    return () => {
      mounted = false;
    };
  }, [sections.length, initEffectiveProgress]);

  // 錨點平滑滾動
  const scrollToAnchor = useCallback((anchorId: string) => {
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;
    const cleanId = decodeURIComponent(anchorId);
    const targetEl =
      iframeDoc.getElementById(cleanId) ||
      iframeDoc.querySelector(`[name="${cleanId}"]`) ||
      iframeDoc.querySelector(`[id*="${cleanId}"]`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [getIframeDoc]);

  // 處理 EPUB 內部超連結跳轉
  const handleLinkClick = useCallback(
    (rawHref: string) => {
      if (!rawHref) return;
      const currentSection = sections[currentSectionIndex];
      if (!currentSection) return;

      const [filePart, hashPart] = rawHref.split('#');
      const currentFileName = currentSection.href.split('/').pop() || '';

      if (!filePart || filePart === '' || filePart === currentFileName) {
        if (hashPart) {
          scrollToAnchor(hashPart);
        }
        return;
      }

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
        syncSectionChange(targetIndex, sections.length);
      }
    },
    [sections, currentSectionIndex, resolveRelativePath, scrollToAnchor, syncSectionChange]
  );

  // 核心章節渲染管線
  const renderCurrentSection = useCallback(async () => {
    if (!iframeRef.current || sections.length === 0) return;
    const iframeDoc = getIframeDoc();
    if (!iframeDoc) return;

    // 清理上一輪定時器並領取世代 ID
    renderTimerIdsRef.current.forEach((id) => clearTimeout(id));
    renderTimerIdsRef.current = [];
    const currentReqId = ++sectionRequestIdRef.current;

    setIsSectionLoading(true);
    const rawHtml = await getSectionHtml(currentSectionIndex, currentReqId, sectionRequestIdRef);
    if (currentReqId !== sectionRequestIdRef.current || !rawHtml) {
      setIsSectionLoading(false);
      return;
    }

    const currentTheme = THEME_STYLES[theme];
    const effectiveLineHeight = isVertical ? '1.9' : lineHeight.toString();
    const writingMode = isVertical ? 'vertical-rl' : 'horizontal-tb';
    const paddingStyle = isVertical ? `${paddingX}px 1.5rem` : `1.5rem ${paddingX}px`;

    const pagedCss =
      layoutMode === 'paged'
        ? `
          html, body {
            overflow: hidden !important;
            height: 100% !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #kavita-book-wrapper {
            column-width: 100vw !important;
            column-gap: 0px !important;
            column-fill: auto !important;
            height: 100vh !important;
            box-sizing: border-box !important;
            padding: ${isVertical ? `24px 0` : `16px 0`} !important;
            transform: translateX(0px);
            will-change: transform;
          }
        `
        : `
          body {
            overflow-y: auto !important;
            height: auto !important;
          }
        `;

    const resolvedFontFamily = (() => {
      if (fontFamily === 'serif') return '"Noto Serif TC", serif';
      if (fontFamily === 'sans-serif') return 'system-ui, -apple-system, sans-serif';
      return `"${fontFamily}", "Noto Serif TC", serif`;
    })();

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

    let content = rawHtml;
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

    const win = iframeRef.current?.contentWindow;
    const doc = iframeDoc;
    const currentActualScroll = win?.scrollY || doc?.documentElement?.scrollTop || doc?.body?.scrollTop || 0;
    const targetScroll = pendingScrollTopRef.current !== null ? pendingScrollTopRef.current : currentActualScroll;
    pendingScrollTopRef.current = null;

    const targetVirtual = initialVirtualTargetRef.current;
    initialVirtualTargetRef.current = null;

    iframeDoc.open();
    iframeDoc.write(content);
    iframeDoc.close();

    fontLoader.syncFontsToDocument(iframeDoc);

    if (layoutMode === 'paged') {
      const blockScroll = (e: TouchEvent | WheelEvent) => {
        e.preventDefault();
      };
      iframeDoc.addEventListener('touchmove', blockScroll, { passive: false });
      iframeDoc.addEventListener('wheel', blockScroll, { passive: false });
    }

    // 綁定 iframe 點擊熱區與超連結
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
            turnPage(iframeDoc, screenWidth, 'next');
          } else {
            turnPage(iframeDoc, screenWidth, 'prev');
          }
        } else if (ratio > 0.7) {
          if (isVertical) {
            turnPage(iframeDoc, screenWidth, 'prev');
          } else {
            turnPage(iframeDoc, screenWidth, 'next');
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

    const w = iframeRef.current?.clientWidth || iframeWin.innerWidth || iframeDoc.documentElement.clientWidth;

    // 快速三階段排版測量
    if (layoutMode === 'paged') {
      const t1 = window.setTimeout(() => calculatePages(iframeDoc, w, targetVirtual, true), 50);
      const t2 = window.setTimeout(() => calculatePages(iframeDoc, w, targetVirtual, true), 200);
      const t3 = window.setTimeout(() => {
        calculatePages(iframeDoc, w, targetVirtual, true);
        pendingTargetXPathRef.current = null;
        setIsSectionLoading(false);
      }, 450);
      renderTimerIdsRef.current.push(t1, t2, t3);
    } else {
      const performScroll = (unlock = false) => {
        if (currentReqId !== sectionRequestIdRef.current) return;
        resolveScrollTarget(iframeWin, iframeDoc, targetScroll);

        const wrapperEl = iframeDoc.getElementById('kavita-book-wrapper') || iframeDoc.body;
        if (wrapperEl && !wrapperEl.classList.contains('is-ready')) {
          wrapperEl.classList.add('is-ready');
        }

        if (unlock) {
          const tUnlock = window.setTimeout(() => {
            if (currentReqId !== sectionRequestIdRef.current) return;
            isRestoringProgressRef.current = false;
            setIsSectionLoading(false);
          }, 200);
          renderTimerIdsRef.current.push(tUnlock);
        }
      };

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

    // 滾動模式防抖進度上報
    if (layoutMode === 'scroll') {
      let scrollTimer: any = null;
      const onScroll = () => {
        if (isRestoringProgressRef.current) return;
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (isRestoringProgressRef.current) return;
          const top = iframeWin.scrollY || iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop || 0;
          reportScrollProgress(top, iframeDoc);
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
    getIframeDoc,
    getSectionHtml,
    setIsSectionLoading,
    handleLinkClick,
    calculatePages,
    resolveScrollTarget,
    reportScrollProgress,
    scrollToAnchor,
    turnPage,
    pendingScrollTopRef,
    initialVirtualTargetRef,
    pendingTargetXPathRef,
    isRestoringProgressRef,
  ]);

  const isReaderReady = !isLoading && isProgressReady && sections.length > 0;

  useEffect(() => {
    if (isReaderReady) {
      renderCurrentSection();
    }
  }, [isReaderReady, renderCurrentSection]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col select-none overflow-hidden">
      {/* 頂部控制列 */}
      <ReaderHeader
        showControls={showControls}
        seriesName={seriesName}
        chapterTitle={chapterTitle}
        isOffline={isOffline}
        isDownloading={downloadProgress !== null}
        downloadProgress={downloadProgress}
        onClose={handleClose}
        onToggleSettings={() => setShowSettings((p) => !p)}
        onDownload={handleDownload}
        settingsBtnRef={settingsBtnRef}
      />

      {/* 排版設定彈窗 */}
      <ReaderSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        preferences={preferences}
        triggerBtnRef={settingsBtnRef}
        getIframeDoc={getIframeDoc}
      />

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
        {!isReaderReady && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black text-zinc-400 text-sm">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
            <span>載入 EPUB 章節中...</span>
          </div>
        )}
        {isSectionLoading && isReaderReady && (
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
        />

        {/* 單欄模式頂層透明點擊翻頁熱區 */}
        {layoutMode === 'paged' && (
          <div className="absolute inset-0 z-20 flex pointer-events-none">
            {/* 左側熱區 (28%) */}
            <div
              className="w-[28%] h-full pointer-events-auto cursor-pointer select-none active:bg-white/5 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                const doc = getIframeDoc();
                const w = iframeRef.current?.clientWidth || window.innerWidth;
                if (!doc) return;
                if (isVertical) {
                  turnPage(doc, w, 'next');
                } else {
                  turnPage(doc, w, 'prev');
                }
              }}
            />
            {/* 中央穿透區 (44%) */}
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
                const doc = getIframeDoc();
                const w = iframeRef.current?.clientWidth || window.innerWidth;
                if (!doc) return;
                if (isVertical) {
                  turnPage(doc, w, 'prev');
                } else {
                  turnPage(doc, w, 'next');
                }
              }}
            />
          </div>
        )}
      </div>

      {/* 底部導航與節選進度 */}
      <ReaderFooter
        showControls={showControls}
        currentSectionIndex={currentSectionIndex}
        totalSections={sections.length}
        layoutMode={layoutMode}
        virtualPageIndex={virtualPageIndex}
        totalVirtualPages={totalVirtualPages}
        isOffline={isOffline}
        isVertical={isVertical}
        onSectionChange={(index) => syncSectionChange(index, sections.length)}
      />
    </div>
  );
};
