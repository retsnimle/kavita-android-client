import { db } from '../database/db';
import { kavitaClient } from '../../api/kavitaClient';
import { nativeStorage } from './nativeStorage';
import type { OfflineBookMeta } from '../../types/kavita';

export interface DownloadProgress {
  chapterId: number;
  seriesName: string;
  chapterTitle: string;
  currentPage: number;
  totalPages: number;
  percentage: number;
  status: 'downloading' | 'completed' | 'error';
  errorMessage?: string;
}

type ProgressListener = (progress: DownloadProgress) => void;

class DownloadManager {
  private activeDownloads: Map<number, DownloadProgress> = new Map();
  private listeners: Set<ProgressListener> = new Set();

  subscribe(listener: ProgressListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(progress: DownloadProgress) {
    this.activeDownloads.set(progress.chapterId, progress);
    this.listeners.forEach((listener) => listener(progress));
  }

  getActiveProgress(chapterId: number): DownloadProgress | undefined {
    return this.activeDownloads.get(chapterId);
  }

  /**
   * 檢查某章節是否已離線保存
   */
  async isChapterOffline(chapterId: number): Promise<boolean> {
    const book = await db.offline_books.get(chapterId);
    return !!book;
  }

  /**
   * 下載整本漫畫/條漫至 Android 原生沙盒
   */
  async downloadComicChapter(
    seriesId: number,
    seriesName: string,
    volumeId: number,
    chapterId: number,
    chapterTitle: string
  ): Promise<void> {
    if (this.activeDownloads.has(chapterId)) return;

    try {
      // 1. 取得章節資訊以確認頁數
      const info = await kavitaClient.getChapterInfo(chapterId);
      const totalPages = info.pages;
      let totalBytes = 0;

      this.notify({
        chapterId,
        seriesName,
        chapterTitle,
        currentPage: 0,
        totalPages,
        percentage: 0,
        status: 'downloading',
      });

      // 2. 依序下載每一頁並寫入 Android 沙盒
      for (let p = 0; p < totalPages; p++) {
        const blob = await kavitaClient.fetchChapterImageBlob(chapterId, p);
        totalBytes += blob.size;
        await nativeStorage.saveComicPage(chapterId, p, blob);

        const percentage = Math.round(((p + 1) / totalPages) * 100);
        this.notify({
          chapterId,
          seriesName,
          chapterTitle,
          currentPage: p + 1,
          totalPages,
          percentage,
          status: 'downloading',
        });
      }

      // 3. 記錄至本地離線資料庫
      const offlineMeta: OfflineBookMeta = {
        seriesId,
        seriesName,
        volumeId,
        chapterId,
        chapterTitle,
        format: 'comic',
        pageCount: totalPages,
        fileSizeBytes: totalBytes,
        localPath: `comics/${chapterId}`,
        downloadDate: new Date().toISOString(),
      };
      await db.offline_books.put(offlineMeta);

      this.notify({
        chapterId,
        seriesName,
        chapterTitle,
        currentPage: totalPages,
        totalPages,
        percentage: 100,
        status: 'completed',
      });
    } catch (err: any) {
      console.error(`下載漫畫章節 ${chapterId} 失敗:`, err);
      this.notify({
        chapterId,
        seriesName,
        chapterTitle,
        currentPage: 0,
        totalPages: 0,
        percentage: 0,
        status: 'error',
        errorMessage: err.message || '下載失敗',
      });
      throw err;
    } finally {
      setTimeout(() => {
        this.activeDownloads.delete(chapterId);
      }, 3000);
    }
  }

  /**
   * 下載 EPUB 至 Android 原生沙盒
   */
  async downloadEpubChapter(
    seriesId: number,
    seriesName: string,
    volumeId: number,
    chapterId: number,
    chapterTitle: string
  ): Promise<void> {
    if (this.activeDownloads.has(chapterId)) return;

    try {
      this.notify({
        chapterId,
        seriesName,
        chapterTitle,
        currentPage: 0,
        totalPages: 1,
        percentage: 0,
        status: 'downloading',
      });

      const downloadUrl = kavitaClient.getChapterDownloadUrl(chapterId);
      const authHeaders = kavitaClient.getAuthHeaders();
      const relativePath = `epubs/${chapterId}.epub`;

      const savedPath = await nativeStorage.downloadLargeFile(
        downloadUrl,
        relativePath,
        authHeaders,
        (percentage, loaded, total) => {
          this.notify({
            chapterId,
            seriesName,
            chapterTitle,
            currentPage: loaded,
            totalPages: total,
            percentage,
            status: 'downloading',
          });
        }
      );

      // 檢查實體檔案大小
      const totalBytes = await nativeStorage.getFileSizeBytes(savedPath).catch(() => 0);

      const offlineMeta: OfflineBookMeta = {
        seriesId,
        seriesName,
        volumeId,
        chapterId,
        chapterTitle,
        format: 'epub',
        pageCount: 1,
        fileSizeBytes: totalBytes,
        localPath: savedPath,
        downloadDate: new Date().toISOString(),
      };
      await db.offline_books.put(offlineMeta);

      this.notify({
        chapterId,
        seriesName,
        chapterTitle,
        currentPage: 1,
        totalPages: 1,
        percentage: 100,
        status: 'completed',
      });
    } catch (err: any) {
      console.error(`下載 EPUB 章節 ${chapterId} 失敗:`, err);
      this.notify({
        chapterId,
        seriesName,
        chapterTitle,
        currentPage: 0,
        totalPages: 1,
        percentage: 0,
        status: 'error',
        errorMessage: err.message || '下載失敗',
      });
      throw err;
    } finally {
      setTimeout(() => {
        this.activeDownloads.delete(chapterId);
      }, 3000);
    }
  }
}

export const downloadManager = new DownloadManager();
