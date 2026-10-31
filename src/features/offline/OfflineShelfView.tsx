import React, { useState, useEffect } from 'react';
import {
  HardDrive,
  Trash2,
  Play,
  BookOpen,
  FolderDown,
} from 'lucide-react';
import { db } from '../../core/database/db';
import { nativeStorage } from '../../core/storage/nativeStorage';
import { useI18n } from '../../core/i18n';
import type { OfflineBookMeta } from '../../types/kavita';

interface OfflineShelfViewProps {
  onOpenReader: (params: {
    seriesId: number;
    seriesName: string;
    volumeId: number;
    chapterId: number;
    chapterTitle: string;
    format: 'comic' | 'epub';
  }) => void;
}

export const OfflineShelfView: React.FC<OfflineShelfViewProps> = ({ onOpenReader }) => {
  const { t } = useI18n();
  const [offlineBooks, setOfflineBooks] = useState<OfflineBookMeta[]>([]);
  const [storageInfo, setStorageInfo] = useState<{ totalBytes: number; bookCount: number }>({
    totalBytes: 0,
    bookCount: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  const loadOfflineData = async () => {
    try {
      setIsLoading(true);
      const books = await db.offline_books.toArray();
      setOfflineBooks(books);
      const info = await nativeStorage.getStorageUsage();
      setStorageInfo(info);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOfflineData();
  }, []);

  const handleDelete = async (chapterId: number, format: 'comic' | 'epub') => {
    if (!window.confirm(t('offline.deleteConfirm'))) return;
    await nativeStorage.deleteOfflineChapter(chapterId, format);
    await loadOfflineData();
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 select-none overflow-hidden">
      {/* 頂部 Header */}
      <div
        className="px-4 py-3 bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 flex items-center justify-between"
        style={{ paddingTop: 'calc(var(--sat) + 0.75rem)' }}
      >
        <div className="flex items-center space-x-2">
          <FolderDown className="w-5 h-5 text-emerald-400" />
          <h1 className="text-base font-bold">{t('offline.title')}</h1>
        </div>
      </div>

      {/* 內容區塊 */}
      <div className="flex-1 overflow-y-auto p-4 pb-24 max-w-3xl mx-auto w-full flex flex-col space-y-4">
        {/* 儲存空間與沙盒狀態卡片 */}
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-900/40 border border-zinc-800 rounded-2xl p-4 shadow-xl flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3.5 min-w-0 flex-1">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <HardDrive className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-zinc-400">{t('offline.storageUsed')}</div>
              <div className="text-xl font-bold font-mono text-white">
                {formatSize(storageInfo.totalBytes)}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right whitespace-nowrap">
            <div className="text-xs text-zinc-500">{t('offline.downloadedChapters')}</div>
            <div className="text-lg font-bold font-mono text-zinc-200">
              {t('offline.chaptersCount', { count: storageInfo.bookCount })}
            </div>
          </div>
        </div>

        {/* 離線書籍列表 */}
        <div className="flex flex-col space-y-3">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            {t('offline.localDownloaded')}
          </h2>

          {isLoading ? (
            <div className="text-center py-12 text-zinc-500 text-sm animate-pulse">
              {t('offline.readingSandbox')}
            </div>
          ) : offlineBooks.length === 0 ? (
            <div className="text-center py-16 bg-zinc-900/30 border border-zinc-800/40 rounded-2xl p-6 flex flex-col items-center">
              <BookOpen className="w-10 h-10 text-zinc-600 mb-2" />
              <p className="text-sm text-zinc-400">{t('offline.emptyTitle')}</p>
              <p className="text-xs text-zinc-500 mt-1">
                {t('offline.emptyDesc')}
              </p>
            </div>
          ) : (
            offlineBooks.map((book) => (
              <div
                key={book.chapterId}
                className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3.5 flex items-center justify-between hover:border-zinc-700 transition-all"
              >
                <div
                  onClick={() =>
                    onOpenReader({
                      seriesId: book.seriesId,
                      seriesName: book.seriesName,
                      volumeId: book.volumeId,
                      chapterId: book.chapterId,
                      chapterTitle: book.chapterTitle,
                      format: book.format,
                    })
                  }
                  className="flex-1 flex items-center space-x-3 cursor-pointer overflow-hidden"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                    <Play className="w-4 h-4 fill-emerald-500" />
                  </div>
                  <div className="truncate">
                    <h3 className="text-sm font-semibold text-white truncate">
                      {book.seriesName}
                    </h3>
                    <div className="flex items-center space-x-2 text-xs text-zinc-400 mt-0.5 font-mono">
                      <span>{book.chapterTitle}</span>
                      <span>•</span>
                      <span>{formatSize(book.fileSizeBytes)}</span>
                      <span>•</span>
                      <span className="uppercase text-[10px] px-1 bg-zinc-800 rounded">
                        {book.format}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(book.chapterId, book.format)}
                  className="p-2 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors ml-2"
                  title={t('offline.deleteTooltip')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
