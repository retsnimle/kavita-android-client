import React, { useEffect, useRef } from 'react';
import type { UseReaderPreferencesReturn } from '../hooks/useReaderPreferences';
import { getWeightName } from '../types';
import { useI18n } from '../../../core/i18n';

interface ReaderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UseReaderPreferencesReturn;
  triggerBtnRef?: React.RefObject<HTMLButtonElement | null>;
  getIframeDoc?: () => Document | null | undefined;
}

export const ReaderSettingsModal: React.FC<ReaderSettingsModalProps> = ({
  isOpen,
  onClose,
  preferences,
  triggerBtnRef,
  getIframeDoc,
}) => {
  const { t } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);

  // 點選 Popup 焦點外自動關閉
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        modalRef.current &&
        !modalRef.current.contains(target) &&
        triggerBtnRef?.current &&
        !triggerBtnRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [isOpen, onClose, triggerBtnRef]);

  if (!isOpen) return null;

  const {
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    paddingX,
    setPaddingX,
    theme,
    setTheme,
    fontFamily,
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
  } = preferences;

  return (
    <>
      {/* 透明全螢幕遮罩層：點選任何外部位置（包括 iframe 與所有控制條）保證關閉面板 */}
      <div
        className="fixed inset-0 z-40 bg-transparent"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />

      <div
        ref={modalRef}
        className="absolute top-16 right-4 z-50 bg-zinc-900 border border-zinc-700 rounded-xl p-4 shadow-2xl w-80 max-h-[80vh] overflow-y-auto flex flex-col space-y-4 text-xs text-zinc-200"
        style={{ marginTop: 'var(--sat)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 字級調整 */}
        <div className="flex items-center justify-between">
          <span>{t('epub.fontSize', { size: fontSize })}</span>
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
          <span>{t('epub.lineHeight', { height: lineHeight })}</span>
          <div className="flex space-x-2">
            <button
              onClick={() => setLineHeight((h) => Math.max(1.2, parseFloat((h - 0.2).toFixed(1))))}
              className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
            >
              {t('epub.lineHeightCompact')}
            </button>
            <button
              onClick={() => setLineHeight((h) => Math.min(2.4, parseFloat((h + 0.2).toFixed(1))))}
              className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
            >
              {t('epub.lineHeightLoose')}
            </button>
          </div>
        </div>

        {/* 留白邊距調整 */}
        <div className="flex items-center justify-between">
          <span>{t('epub.padding', { padding: paddingX })}</span>
          <div className="flex space-x-2">
            <button
              onClick={() => setPaddingX((p) => Math.max(8, p - 4))}
              className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
            >
              {t('epub.paddingNarrow')}
            </button>
            <button
              onClick={() => setPaddingX((p) => Math.min(64, p + 4))}
              className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700"
            >
              {t('epub.paddingWide')}
            </button>
          </div>
        </div>

        {/* 直排 / 橫排切換 */}
        <div className="flex items-center justify-between">
          <span>{t('epub.direction')}</span>
          <div className="flex bg-zinc-800 rounded p-1">
            <button
              onClick={() => setIsVertical(false)}
              className={`px-3 py-1 rounded ${!isVertical ? 'bg-zinc-700 font-bold' : ''}`}
            >
              {t('epub.horizontal')}
            </button>
            <button
              onClick={() => setIsVertical(true)}
              className={`px-3 py-1 rounded ${isVertical ? 'bg-zinc-700 font-bold' : ''}`}
            >
              {t('epub.vertical')}
            </button>
          </div>
        </div>

        {/* 版面模式（滾動 / 單欄） */}
        <div className="flex items-center justify-between">
          <span>{t('epub.layout')}</span>
          <div className="flex bg-zinc-800 rounded p-1">
            <button
              onClick={() => setLayoutMode('scroll')}
              className={`px-3 py-1 rounded transition-colors ${
                layoutMode === 'scroll' ? 'bg-zinc-700 font-bold text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t('epub.scroll')}
            </button>
            <button
              onClick={() => setLayoutMode('paged')}
              className={`px-3 py-1 rounded transition-colors ${
                layoutMode === 'paged' ? 'bg-zinc-700 font-bold text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t('epub.paged')}
            </button>
          </div>
        </div>

        {/* 字型樣式（下拉選單） */}
        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-300">{t('epub.font')}</span>
            <div className="flex items-center space-x-2">
              {fontDownloadProgress?.isDownloading && (
                <span className="text-[10px] text-emerald-400 animate-pulse font-mono font-bold">
                  {fontDownloadProgress.percentage}%
                </span>
              )}
              <select
                value={fontFamily}
                onChange={(e) => {
                  const doc = getIframeDoc ? getIframeDoc() : null;
                  handleSelectFont(e.target.value, doc);
                }}
                disabled={fontDownloadProgress?.isDownloading}
                className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 max-w-[160px] truncate cursor-pointer"
              >
                <option value="sans-serif">{t('epub.fontSans')}</option>
                <option value="serif">{t('epub.fontSerif')}</option>
                {fontFamilies.length > 0 && (
                  <optgroup label={t('epub.serverFonts')}>
                    {fontFamilies.map((group) => {
                      const isCached = downloadedFamilies.has(group.family);
                      return (
                        <option key={group.family} value={group.family}>
                          {group.name || group.family} {!isCached ? t('epub.needsDownload') : ''}
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
            <div
              className={`p-2 bg-zinc-800/90 border rounded-lg flex flex-col space-y-1.5 animate-fadeIn ${
                fontDownloadProgress.error ? 'border-rose-500/50 bg-rose-950/20' : 'border-emerald-500/30'
              }`}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span
                  className={`font-medium truncate max-w-[160px] ${
                    fontDownloadProgress.error ? 'text-rose-400' : 'text-zinc-200'
                  }`}
                >
                  {fontDownloadProgress.error
                    ? t('epub.downloadFailed', { error: fontDownloadProgress.error })
                    : t('epub.downloadingFont', { name: fontDownloadProgress.fontName })}
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
                      {(fontDownloadProgress.loadedBytes / 1024 / 1024).toFixed(1)} MB /{' '}
                      {(fontDownloadProgress.totalBytes / 1024 / 1024).toFixed(1)} MB
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 字重調節（智慧依字型可用字重增減） */}
        <div className="flex items-center justify-between">
          <span>{t('epub.fontWeight', { weight: getWeightName(activeWeightNum, t) })}</span>
          <div className="flex space-x-2">
            <button
              onClick={handleDecreaseWeight}
              disabled={!canDecreaseWeight}
              className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer disabled:cursor-not-allowed"
              title={t('epub.weightDecrease')}
            >
              {t('epub.weightDecrease')}
            </button>
            <button
              onClick={handleIncreaseWeight}
              disabled={!canIncreaseWeight}
              className="px-2.5 py-1 bg-zinc-800 rounded hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer disabled:cursor-not-allowed"
              title={t('epub.weightIncrease')}
            >
              {t('epub.weightIncrease')}
            </button>
          </div>
        </div>

        {/* 配色主題 */}
        <div className="flex items-center justify-between">
          <span>{t('epub.theme')}</span>
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
  );
};
