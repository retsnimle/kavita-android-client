import React, { useState, useEffect, useCallback } from 'react';
import {
  Download,
  CheckCircle,
  Play,
  RotateCw,
  Search,
  ArrowLeft,
  Clock,
  X,
} from 'lucide-react';
import { kavitaClient } from '../../api/kavitaClient';
import { downloadManager, type DownloadProgress } from '../../core/storage/downloadManager';
import { progressReconciler } from '../../core/sync/reconciler';
import { db } from '../../core/database/db';
import { backButtonManager } from '../../core/navigation/backButtonManager';
import { useI18n } from '../../core/i18n';
import type { ChapterDto, LibraryDto, SeriesDto, VolumeDto } from '../../types/kavita';


interface LibraryViewProps {
  onOpenReader: (params: {
    seriesId: number;
    seriesName: string;
    volumeId: number;
    chapterId: number;
    chapterTitle: string;
    format: 'comic' | 'epub';
  }) => void;
}

interface RecentEntry {
  seriesId: number;
  seriesName: string;
  volumeId: number;
  chapterId: number;
  chapterTitle: string;
  format: 'comic' | 'epub';
  pageNum: number;
  updatedAt: number;
}

const LAST_LIBRARY_KEY = 'kavita_last_library_id';

export const LibraryView: React.FC<LibraryViewProps> = ({ onOpenReader }) => {
  const { t } = useI18n();
  const [libraries, setLibraries] = useState<LibraryDto[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | null>(() => {
    const saved = localStorage.getItem(LAST_LIBRARY_KEY);
    return saved ? parseInt(saved, 10) : null;
  });
  const [seriesList, setSeriesList] = useState<SeriesDto[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<SeriesDto | null>(null);
  const [volumes, setVolumes] = useState<VolumeDto[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [offlineMap, setOfflineMap] = useState<Record<number, boolean>>({});
  const [downloadProgressMap, setDownloadProgressMap] = useState<Record<number, DownloadProgress>>({});
  const [recentlyRead, setRecentlyRead] = useState<RecentEntry[]>([]);

  // 0. 載入最近閱讀記錄（從 cached_progress，按更新時間排序，並支援跨頁面/閱讀完後即時刷新）
  const loadRecent = useCallback(async () => {
    try {
      const allProgress = await db.cached_progress.toArray();
      if (!allProgress || allProgress.length === 0) {
        setRecentlyRead([]);
        return;
      }

      // 按 timestamp 倒序，去重（每個 seriesId 只保留最新一筆），取最多 12 筆
      const seen = new Set<number>();
      const sorted = [...allProgress]
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .filter((p) => {
          if (seen.has(p.seriesId)) return false;
          seen.add(p.seriesId);
          return true;
        })
        .slice(0, 12);

      // 從 cached_series 補充 seriesName 等資訊
      const entries: RecentEntry[] = [];
      for (const p of sorted) {
        const series = await db.cached_series.get(p.seriesId);
        if (!series) continue;

        const isEpub = series.format === 3;
        entries.push({
          seriesId: p.seriesId,
          seriesName: series.name,
          volumeId: p.volumeId,
          chapterId: p.chapterId,
          chapterTitle: t('common.pageIndicator', { page: p.page + 1 }),
          format: isEpub ? 'epub' : 'comic',
          pageNum: p.page || 0,
          updatedAt: p.timestamp || 0,
        });
      }
      setRecentlyRead(entries);
    } catch (err) {
      console.warn('載入最近閱讀失敗:', err);
    }
  }, [t]);

  useEffect(() => {
    loadRecent();
    const handleProgressUpdate = () => loadRecent();
    window.addEventListener('kavita-progress-updated', handleProgressUpdate);
    window.addEventListener('focus', handleProgressUpdate);
    document.addEventListener('visibilitychange', handleProgressUpdate);
    return () => {
      window.removeEventListener('kavita-progress-updated', handleProgressUpdate);
      window.removeEventListener('focus', handleProgressUpdate);
      document.removeEventListener('visibilitychange', handleProgressUpdate);
    };
  }, [loadRecent]);

  // 1. 載入書庫列表
  useEffect(() => {
    const fetchLibraries = async () => {
      try {
        setIsLoading(true);
        const libs = await kavitaClient.getLibraries();
        setLibraries(libs);
        if (libs.length > 0 && selectedLibraryId === null) {
          const firstId = libs[0].id;
          setSelectedLibraryId(firstId);
        } else if (selectedLibraryId !== null) {
          // 確認已儲存的書庫仍在清單中，若已被移除則 fallback 第一個
          if (libs.length > 0 && !libs.find((l) => l.id === selectedLibraryId)) {
            setSelectedLibraryId(libs[0].id);
          }
        }
      } catch (err) {
        console.error('取得書庫失敗:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchLibraries();
  }, []);

  // 當選擇的書庫變更時，寫入 localStorage
  useEffect(() => {
    if (selectedLibraryId !== null) {
      localStorage.setItem(LAST_LIBRARY_KEY, selectedLibraryId.toString());
    }
  }, [selectedLibraryId]);

  // 監聽 Android 返回鍵：若已開啟某系列詳情頁，按返回鍵回到系列列表
  useEffect(() => {
    if (!selectedSeries) return;
    const unregister = backButtonManager.register(() => {
      setSelectedSeries(null);
      return true;
    });
    return unregister;
  }, [selectedSeries]);



  // 2. 監聽下載管理器
  useEffect(() => {
    const unsubscribe = downloadManager.subscribe((p) => {
      setDownloadProgressMap((prev) => ({ ...prev, [p.chapterId]: p }));
      if (p.status === 'completed') {
        setOfflineMap((prev) => ({ ...prev, [p.chapterId]: true }));
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // 3. 載入某書庫下的系列
  useEffect(() => {
    if (!selectedLibraryId) return;
    setSeriesList([]); // 切換書庫時先清空，避免畫面混淆
    const fetchSeries = async () => {
      try {
        setIsLoading(true);
        const data = await kavitaClient.getSeriesForLibrary(selectedLibraryId);
        setSeriesList(data);
        // 快取至本地資料庫供離線時展示
        if (data.length > 0) {
          await db.cached_series.bulkPut(data);
        }
      } catch (err) {
        console.warn('線上取得系列失敗，降級從本地快取讀取:', err);
        const cached = await db.cached_series.where('libraryId').equals(selectedLibraryId).toArray();
        setSeriesList(cached);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSeries();
  }, [selectedLibraryId]);

  // 4. 點選某個系列載入詳情
  const handleSelectSeries = async (series: SeriesDto) => {
    setSelectedSeries(series);
    setVolumes([]);
    try {
      setIsLoading(true);
      const vols = await kavitaClient.getSeriesVolumes(series.id);
      setVolumes(vols || []);

      // 檢查有哪些章節已下載到本地沙盒
      const offlineBooks = await db.offline_books.where('seriesId').equals(series.id).toArray();
      const map: Record<number, boolean> = {};
      offlineBooks.forEach((b) => {
        map[b.chapterId] = true;
      });
      setOfflineMap(map);
    } catch (err) {
      console.error('取得系列卷冊失敗:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 5. 觸發手動同步
  const handleSyncProgress = async () => {
    setIsSyncing(true);
    try {
      await progressReconciler.reconcileProgressQueue();
    } finally {
      setIsSyncing(false);
    }
  };

  // 格式化章節名稱（過濾 100000 等 Kavita 內部哨兵值）
  const formatChapterTitle = (ch: ChapterDto, idx: number, total: number, seriesName: string) => {
    const isSentinelStr = (s?: string | number | null) => {
      if (s === undefined || s === null) return false;
      const str = String(s).trim().toLowerCase();
      return ['100000', '-100000', '100000.0', '-100000.0', '0', '0.0'].includes(str) || str.includes('100000');
    };

    const rawTitle = ch.title?.trim() || '';
    if (rawTitle && !isSentinelStr(rawTitle)) {
      return rawTitle;
    }
    const numVal = parseFloat(String(ch.number || '0'));
    if (!isNaN(numVal) && !isSentinelStr(ch.number) && numVal > 0 && numVal < 100000) {
      return t('common.chapterIndicator', { chapter: ch.number || '' });
    }
    if (total === 1) {
      return seriesName;
    }
    return t('common.chapterIndicator', { chapter: idx + 1 });
  };

  // 6. 下載章節
  const handleDownloadChapter = async (vol: VolumeDto, ch: ChapterDto, format: 'comic' | 'epub', idx = 0, total = 1) => {
    if (offlineMap[ch.id]) return;
    const title = formatChapterTitle(ch, idx, total, selectedSeries?.name || '');
    if (format === 'comic') {
      await downloadManager.downloadComicChapter(
        selectedSeries!.id,
        selectedSeries!.name,
        vol.id,
        ch.id,
        title
      );
    } else {
      await downloadManager.downloadEpubChapter(
        selectedSeries!.id,
        selectedSeries!.name,
        vol.id,
        ch.id,
        title
      );
    }
  };

  // 過濾搜尋
  const filteredSeries = seriesList.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 select-none overflow-hidden">
      {/* 頂部 Header */}
      <div
        className="px-4 py-3 bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 flex items-center justify-between"
        style={{ paddingTop: 'calc(var(--sat) + 0.75rem)' }}
      >
        {selectedSeries ? (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedSeries(null)}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold truncate max-w-xs">{selectedSeries.name}</h1>
          </div>
        ) : (
          <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar py-1">
            {libraries.map((lib) => (
              <button
                key={lib.id}
                onClick={() => setSelectedLibraryId(lib.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedLibraryId === lib.id
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {lib.name}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleSyncProgress}
          disabled={isSyncing}
          className={`p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 ${
            isSyncing ? 'animate-spin text-emerald-400' : ''
          }`}
          title={t('library.syncTooltip')}
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      {/* 當在書庫主頁時，將 搜尋列 與 最近閱讀 固定置頂，不隨作品列表滾動而消失 */}
      {!selectedSeries && (
        <div className="px-4 pt-3 pb-2.5 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-900 flex flex-col space-y-3 z-10 shrink-0">
          {/* 搜尋條 */}
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('library.searchPlaceholder')}
              className="w-full pl-9 pr-9 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 p-1 rounded-full text-zinc-400 hover:text-white bg-zinc-800/80 active:scale-90 transition-all cursor-pointer"
                title={t('library.clearSearch')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 最近閱讀（固定橫向滑動列） */}
          {recentlyRead.length > 0 && !searchQuery && (
            <div className="flex flex-col space-y-1.5 pb-0.5">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-zinc-400">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t('library.recentlyRead')}</span>
              </div>
              <div className="flex space-x-3 overflow-x-auto no-scrollbar py-0.5">
                {recentlyRead.map((entry) => (
                  <button
                    key={`${entry.seriesId}-${entry.chapterId}`}
                    onClick={() => onOpenReader({
                      seriesId: entry.seriesId,
                      seriesName: entry.seriesName,
                      volumeId: entry.volumeId,
                      chapterId: entry.chapterId,
                      chapterTitle: entry.chapterTitle,
                      format: entry.format,
                    })}
                    className="flex-shrink-0 flex flex-col w-20 bg-zinc-900/70 border border-zinc-800/70 rounded-xl overflow-hidden cursor-pointer hover:border-zinc-600 active:scale-95 transition-all text-left"
                  >
                    <div className="w-20 h-[4.5rem] relative overflow-hidden bg-zinc-800">
                      <img
                        src={kavitaClient.getSeriesCoverUrl(entry.seriesId)}
                        alt={entry.seriesName}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="px-1.5 py-1">
                      <p className="text-[10px] font-semibold text-white truncate leading-tight">{entry.seriesName}</p>
                      <p className="text-[9px] text-zinc-500 truncate leading-tight mt-0.5">{entry.chapterTitle}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 內容區塊 */}
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {selectedSeries ? (
          /* 系列卷冊與章節詳情檢視 */
          <div className="flex flex-col space-y-6 max-w-3xl mx-auto">
            {(() => {
              const currentLib = libraries.find(
                (l) => l.id === selectedSeries.libraryId || l.id === selectedLibraryId
              );
              const isEpub =
                selectedSeries.format === 3 ||
                (selectedSeries.format !== 4 && currentLib?.type === 2);
              const isPdf = selectedSeries.format === 4;
              const format: 'epub' | 'comic' = isEpub ? 'epub' : 'comic';

              const firstPlayable = (() => {
                for (const v of volumes) {
                  if (v.chapters && v.chapters.length > 0) {
                    return { volume: v, chapter: v.chapters[0] };
                  }
                }
                return null;
              })();

              return (
                <>
                  <div className="flex space-x-4 items-start bg-zinc-900/60 p-4 rounded-2xl border border-zinc-800/80">
                    <img
                      src={kavitaClient.getSeriesCoverUrl(selectedSeries.id)}
                      alt={selectedSeries.name}
                      className="w-24 h-36 object-cover rounded-xl shadow-lg border border-zinc-700/50 shrink-0"
                    />
                    <div className="flex-1 flex flex-col justify-between min-h-[9rem]">
                      <div>
                        <h2 className="text-lg font-bold text-white line-clamp-1">
                          {selectedSeries.name}
                        </h2>
                        <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                          {selectedSeries.summary || t('library.noSummary')}
                        </p>
                      </div>
                      <div className="flex flex-col space-y-2 mt-2">
                        <div className="flex items-center space-x-2 text-xs text-zinc-400">
                          <span className={`px-2 py-0.5 rounded-md border ${
                            isEpub
                              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                              : isPdf
                              ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                          }`}>
                            {isEpub ? t('common.epubNovel') : isPdf ? t('common.pdfDocument') : t('common.comicFormat')}
                          </span>
                        </div>
                        {firstPlayable && (
                          <button
                            onClick={() =>
                              onOpenReader({
                                seriesId: selectedSeries.id,
                                seriesName: selectedSeries.name,
                                volumeId: firstPlayable.volume.id,
                                chapterId: firstPlayable.chapter.id,
                                chapterTitle: formatChapterTitle(
                                  firstPlayable.chapter,
                                  0,
                                  firstPlayable.volume.chapters?.length || 1,
                                  selectedSeries.name
                                ),
                                format,
                              })
                            }
                            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-medium text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer w-fit"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>{t('library.startReading')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 卷冊列表 */}
                  <div className="flex flex-col space-y-4">
                    <h3 className="text-sm font-semibold text-zinc-300">{t('library.allVolumesAndChapters')}</h3>
                    {isLoading ? (
                      <div className="flex flex-col items-center justify-center py-12 space-y-2">
                        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-zinc-500">{t('library.fetchingVolumes')}</span>
                      </div>
                    ) : volumes.length === 0 ? (
                      <div className="text-center py-10 text-zinc-500 text-sm bg-zinc-900/30 rounded-xl border border-zinc-800/40">
                        {t('library.noVolumesAvailable')}
                      </div>
                    ) : (
                      volumes.map((vol) => {
                        const chapters = vol.chapters || [];

                        const isSentinel = (name?: string, num?: number) => {
                          if (num !== undefined && (num >= 100000 || num < 0)) return true;
                          if (!name || !name.trim()) return true;
                          const clean = name.trim().toLowerCase();
                          return ['100000', '-100000', '100000.0', '-100000.0', '0', '0.0', 'specials', 'special'].includes(clean);
                        };

                        const volTitle = (() => {
                          if (volumes.length <= 1) return '';
                          if (vol.name && !isSentinel(vol.name, vol.minNumber)) {
                            return vol.name;
                          }
                          if (vol.minNumber !== undefined && vol.minNumber > 0 && vol.minNumber < 100000) {
                            return t('common.volumeIndicator', { volume: vol.minNumber });
                          }
                          return t('common.specialVolume');
                        })();

                        return (
                          <div
                            key={vol.id}
                            className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 flex flex-col space-y-2"
                          >
                            {volTitle && (
                              <div className="text-xs font-semibold text-emerald-400">
                                {volTitle}
                              </div>
                            )}
                            <div className="divide-y divide-zinc-800/40">
                              {chapters.map((ch, chIdx) => {
                                const isDownloaded = offlineMap[ch.id];
                                const downloadProg = downloadProgressMap[ch.id];
                                const isDownloading = downloadProg?.status === 'downloading';
                                const title = formatChapterTitle(ch, chIdx, chapters.length, selectedSeries.name);

                                return (
                                  <div
                                    key={ch.id}
                                    className="py-2.5 flex items-center justify-between hover:bg-zinc-800/30 px-2 rounded-lg transition-colors"
                                  >
                                    <div
                                      onClick={() =>
                                        onOpenReader({
                                          seriesId: selectedSeries.id,
                                          seriesName: selectedSeries.name,
                                          volumeId: vol.id,
                                          chapterId: ch.id,
                                          chapterTitle: title,
                                          format,
                                        })
                                      }
                                      className="flex-1 flex items-center space-x-3 cursor-pointer"
                                    >
                                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                                        <Play className="w-4 h-4 fill-emerald-500" />
                                      </div>
                                      <div>
                                        <h4 className="text-sm font-medium text-white">{title}</h4>
                                        <p className="text-xs text-zinc-500 font-mono">
                                          {ch.pages ? t('common.pagesCount', { count: ch.pages }) : t('common.epubFormat')}
                                        </p>
                                      </div>
                                    </div>

                                    <button
                                      onClick={() => handleDownloadChapter(vol, ch, format, chIdx, chapters.length)}
                                      disabled={isDownloaded || isDownloading}
                                      className={`p-2 rounded-lg transition-colors ${
                                        isDownloaded
                                          ? 'text-emerald-400'
                                          : isDownloading
                                          ? 'text-yellow-400'
                                          : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                                      }`}
                                      title={
                                        isDownloaded
                                          ? t('library.inSandboxTooltip')
                                          : t('library.downloadToSandboxTooltip')
                                      }
                                    >
                                      {isDownloaded ? (
                                        <CheckCircle className="w-5 h-5" />
                                      ) : isDownloading ? (
                                        <span className="text-xs font-mono font-bold">
                                          {downloadProg?.percentage}%
                                        </span>
                                      ) : (
                                        <Download className="w-5 h-5" />
                                      )}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          /* 系列網格列表 */
          <div className="max-w-5xl mx-auto flex flex-col space-y-4">
            {isLoading ? (
              <div className="text-center py-16 text-zinc-500 text-sm animate-pulse">
                {t('library.loadingContent')}
              </div>
            ) : filteredSeries.length === 0 ? (
              <div className="text-center py-16 text-zinc-500 text-sm">{t('library.noMatchingSeries')}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
                {filteredSeries.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSeries(s)}
                    className="group bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden cursor-pointer hover:border-zinc-700 transition-all flex flex-col active:scale-[0.98]"
                  >
                    <div className="aspect-[2/3] w-full relative overflow-hidden bg-zinc-800">
                      <img
                        src={kavitaClient.getSeriesCoverUrl(s.id)}
                        alt={s.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <span
                        className={`absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[10px] backdrop-blur-md font-mono font-medium ${
                          s.format === 3
                            ? 'bg-blue-600/80 text-blue-100 shadow-sm'
                            : s.format === 4
                            ? 'bg-rose-600/80 text-rose-100 shadow-sm'
                            : 'bg-black/70 text-zinc-300'
                        }`}
                      >
                        {s.format === 3 ? 'EPUB' : s.format === 4 ? 'PDF' : 'COMIC'}
                      </span>
                    </div>
                    <div className="p-2.5 flex flex-col">
                      <h3 className="text-xs font-semibold text-white truncate">{s.name}</h3>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
