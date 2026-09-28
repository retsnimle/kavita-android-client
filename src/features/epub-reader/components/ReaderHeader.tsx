import React from 'react';
import { ArrowLeft, Type, Download, CheckCircle } from 'lucide-react';

interface ReaderHeaderProps {
  showControls: boolean;
  seriesName: string;
  chapterTitle: string;
  isOffline: boolean;
  isDownloading: boolean;
  downloadProgress: number | null;
  onClose: () => void;
  onToggleSettings: () => void;
  onDownload: () => void;
  settingsBtnRef?: React.RefObject<HTMLButtonElement | null>;
}

export const ReaderHeader: React.FC<ReaderHeaderProps> = ({
  showControls,
  seriesName,
  chapterTitle,
  isOffline,
  isDownloading,
  downloadProgress,
  onClose,
  onToggleSettings,
  onDownload,
  settingsBtnRef,
}) => {
  return (
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
        {/* 排版設定按鈕 */}
        <button
          ref={settingsBtnRef}
          onClick={onToggleSettings}
          className="p-2 rounded-full hover:bg-zinc-800 text-zinc-300 hover:text-white"
        >
          <Type className="w-5 h-5" />
        </button>

        {/* 下載按鈕 */}
        <button
          onClick={onDownload}
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
  );
};
