import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../../core/i18n';
import type { LayoutMode } from '../types';

interface ReaderFooterProps {
  showControls: boolean;
  currentSectionIndex: number;
  totalSections: number;
  layoutMode: LayoutMode;
  virtualPageIndex: number;
  totalVirtualPages: number;
  isOffline: boolean;
  isVertical: boolean;
  onSectionChange: (index: number) => void;
}

export const ReaderFooter: React.FC<ReaderFooterProps> = ({
  showControls,
  currentSectionIndex,
  totalSections,
  layoutMode,
  virtualPageIndex,
  totalVirtualPages,
  isOffline,
  isVertical,
  onSectionChange,
}) => {
  const { t } = useI18n();

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-40 bg-zinc-900/90 backdrop-blur-md px-6 py-4 border-t border-zinc-800 transition-transform duration-300 ${
        showControls ? 'translate-y-0' : 'translate-y-full'
      }`}
      style={{ paddingBottom: 'calc(var(--sab) + 1rem)' }}
    >
      <div className="max-w-xl mx-auto flex flex-col space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>
            {t('epub.chapterIndicator', { current: currentSectionIndex + 1, total: totalSections })}
            {layoutMode === 'paged' && t('epub.pageIndicator', { current: virtualPageIndex + 1, total: totalVirtualPages })}
          </span>
          <span className="text-emerald-400">
            {isOffline ? t('common.inSandbox') : t('common.onlineReading')}
          </span>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => onSectionChange(isVertical ? currentSectionIndex + 1 : currentSectionIndex - 1)}
            disabled={isVertical ? currentSectionIndex >= totalSections - 1 : currentSectionIndex <= 0}
            className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-30"
            title={isVertical ? t('epub.nextChapter') : t('epub.prevChapter')}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, totalSections - 1)}
            value={currentSectionIndex}
            onChange={(e) => onSectionChange(parseInt(e.target.value, 10))}
            style={isVertical ? { direction: 'rtl' } : undefined}
            className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <button
            onClick={() => onSectionChange(isVertical ? currentSectionIndex - 1 : currentSectionIndex + 1)}
            disabled={isVertical ? currentSectionIndex <= 0 : currentSectionIndex >= totalSections - 1}
            className="p-1 rounded text-zinc-400 hover:text-white disabled:opacity-30"
            title={isVertical ? t('epub.prevChapter') : t('epub.nextChapter')}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
