import { Network } from '@capacitor/network';
import { db } from '../database/db';
import { kavitaClient } from '../../api/kavitaClient';
import type { ProgressDto } from '../../types/kavita';

class ProgressReconciler {
  private isSyncing = false;

  constructor() {
    this.initNetworkListener();
  }

  // 初始化網路監聽器，斷網重連時自動觸發進度對齊
  private async initNetworkListener() {
    try {
      Network.addListener('networkStatusChange', async (status) => {
        if (status.connected) {
          console.log('[Reconciler] 網路已恢復，觸發離線進度對齊...');
          await this.reconcileProgressQueue();
        }
      });
    } catch {
      // 網頁環境 fallback
      window.addEventListener('online', async () => {
        console.log('[Reconciler] Web online 事件，觸發進度對齊...');
        await this.reconcileProgressQueue();
      });
    }
  }

  private progressDebounceTimers = new Map<number, any>();
  private pendingProgressDtos = new Map<number, ProgressDto>();

  /**
   * 立即提交所有處於防抖等待中的進度（通常在退出閱讀器時呼叫）
   */
  async flushPendingProgress(targetChapterId?: number): Promise<void> {
    const chapterIds = targetChapterId !== undefined ? [targetChapterId] : Array.from(this.pendingProgressDtos.keys());
    for (const chId of chapterIds) {
      const timer = this.progressDebounceTimers.get(chId);
      if (timer) {
        clearTimeout(timer);
        this.progressDebounceTimers.delete(chId);
      }
      const dto = this.pendingProgressDtos.get(chId);
      if (dto) {
        this.pendingProgressDtos.delete(chId);
        await this.submitProgressToServerOrQueue(dto);
      }
    }
  }

  private async submitProgressToServerOrQueue(progressDto: ProgressDto): Promise<void> {
    const { chapterId, seriesId, volumeId, pageNum, page, bookScrollId } = progressDto;
    const finalPage = pageNum ?? page ?? 0;
    const timestamp = Date.now();

    let isConnected = true;
    try {
      const status = await Network.getStatus();
      isConnected = status.connected;
    } catch {
      isConnected = navigator.onLine;
    }

    if (isConnected && kavitaClient.isConfigured()) {
      try {
        await kavitaClient.saveProgress(progressDto);
        console.log(`[Reconciler] 進度上報伺服器成功: Chapter ${chapterId} P.${finalPage} (${bookScrollId || 'no-scroll'})`);
        setTimeout(() => {
          this.reconcileProgressQueue().catch(() => {});
        }, 100);
        return;
      } catch (e) {
        console.warn('[Reconciler] 上報伺服器失敗，降級存入離線佇列:', e);
      }
    }

    // 離線或上報失敗，入列待同步
    const existing = await db.progress_queue.where('chapterId').equals(chapterId).first();
    if (existing && existing.id) {
      await db.progress_queue.update(existing.id, {
        page: finalPage,
        bookScrollId,
        timestamp,
        status: 'pending',
      });
    } else {
      await db.progress_queue.add({
        seriesId,
        volumeId,
        chapterId,
        page: finalPage,
        bookScrollId,
        timestamp,
        status: 'pending',
      });
    }
    console.log(`[Reconciler] 離線進度已暫存至佇列: Chapter ${chapterId} P.${finalPage} (${bookScrollId || 'no-scroll'})`);
  }

  /**
   * 翻頁時觸發樂觀進度更新
   * 1. 立即更新本地快取 (本地即時權威，零延遲)
   * 2. 防抖 500ms 嘗試聯網上報，避免連續翻頁時高頻打擊伺服器 API
   */
  async updateProgressOptimistic(
    seriesId: number,
    volumeId: number,
    chapterId: number,
    page: number,
    bookScrollId?: string | null
  ): Promise<void> {
    const timestamp = Date.now();

    // 1. 本地立即寫入 (IndexedDB + 內部事件廣播)
    await db.cached_progress.put({
      chapterId,
      seriesId,
      volumeId,
      page,
      bookScrollId,
      timestamp,
    });

    try {
      window.dispatchEvent(new CustomEvent('kavita-progress-updated', { detail: { seriesId, chapterId, page, bookScrollId } }));
    } catch {}

    let libraryId: number | undefined;
    try {
      const s = await db.cached_series.get(seriesId);
      if (s) libraryId = s.libraryId;
    } catch {}

    const progressDto: ProgressDto = {
      seriesId,
      volumeId,
      chapterId,
      pageNum: page,
      page,
      bookScrollId,
      libraryId,
    };

    // 2. 防抖向伺服器提交（500ms 內連續翻頁只發送最後一筆）
    if (this.progressDebounceTimers.has(chapterId)) {
      clearTimeout(this.progressDebounceTimers.get(chapterId));
    }
    this.pendingProgressDtos.set(chapterId, progressDto);

    const timer = setTimeout(() => {
      this.progressDebounceTimers.delete(chapterId);
      const pending = this.pendingProgressDtos.get(chapterId);
      if (pending) {
        this.pendingProgressDtos.delete(chapterId);
        this.submitProgressToServerOrQueue(pending).catch(() => {});
      }
    }, 500);

    this.progressDebounceTimers.set(chapterId, timer);
  }

  /**
   * 批次對齊進度佇列至 Kavita 伺服器
   */
  async reconcileProgressQueue(): Promise<{ success: number; failed: number }> {
    if (this.isSyncing || !kavitaClient.isConfigured()) return { success: 0, failed: 0 };
    this.isSyncing = true;
    let successCount = 0;
    let failedCount = 0;

    try {
      // 包含 pending 以及曾失敗過待重試的進度 (failed)
      const pendingItems = await db.progress_queue.where('status').anyOf(['pending', 'failed']).toArray();
      if (pendingItems.length === 0) {
        return { success: 0, failed: 0 };
      }

      console.log(`[Reconciler] 開始對齊 ${pendingItems.length} 筆離線進度...`);

      for (const item of pendingItems) {
        try {
          if (item.id) {
            await db.progress_queue.update(item.id, { status: 'syncing' });
          }

          let itemLibId: number | undefined;
          try {
            const s = await db.cached_series.get(item.seriesId);
            if (s) itemLibId = s.libraryId;
          } catch {}

          await kavitaClient.saveProgress({
            seriesId: item.seriesId,
            volumeId: item.volumeId,
            chapterId: item.chapterId,
            pageNum: item.page,
            page: item.page,
            bookScrollId: item.bookScrollId,
            libraryId: itemLibId,
          });

          // 同步成功，自佇列刪除
          if (item.id) {
            await db.progress_queue.delete(item.id);
          }
          successCount++;
          console.log(`[Reconciler] 對齊成功: Chapter ${item.chapterId} -> P.${item.page}`);
        } catch (err) {
          console.error(`[Reconciler] 對齊失敗 Chapter ${item.chapterId}:`, err);
          failedCount++;
          if (item.id) {
            await db.progress_queue.update(item.id, { status: 'failed' });
          }
        }
      }
      return { success: successCount, failed: failedCount };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 取得某章節的最新進度（雙向比對，取時間戳較新的那一方為準）
   *
   * 邏輯：
   * 1. 同時讀取本地快取與伺服器進度
   * 2. 比較時間戳 (lastModifiedUtc vs local.timestamp)
   * 3. 伺服器較新 → 回傳伺服器進度，並更新本地快取
   * 4. 本地較新  → 回傳本地進度，並順帶將本地上推至伺服器
   * 5. 兩者皆無  → 回傳 { page: 0, bookScrollId: null }
   */
  async getEffectiveProgress(chapterId: number): Promise<{ page: number; bookScrollId?: string | null }> {
    const local = await db.cached_progress.get(chapterId);

    // 嘗試向伺服器取得進度
    let remote: ProgressDto | null = null;

    if (kavitaClient.isConfigured()) {
      try {
        remote = await kavitaClient.getProgress(chapterId);
      } catch {
        // 離線或連線失敗，沿用本地
      }
    }

    const remotePage = remote?.pageNum ?? remote?.pagesRead ?? remote?.page ?? null;
    const remoteScrollId = remote?.bookScrollId ?? null;
    // Kavita 伺服器回傳的時間戳為 ISO 字串（UTC），轉為毫秒
    const remoteTs = remote?.lastModifiedUtc
      ? new Date(remote.lastModifiedUtc).getTime()
      : 0;
    const localTs = local?.timestamp ?? 0;
    const localPage = local?.page ?? null;
    const localScrollId = local?.bookScrollId ?? null;

    // 兩者都沒有
    if (localPage === null && remotePage === null) {
      return { page: 0, bookScrollId: null };
    }
    // 只有一方有資料
    if (localPage === null) {
      return { page: remotePage ?? 0, bookScrollId: remoteScrollId };
    }
    if (remotePage === null) {
      return { page: localPage, bookScrollId: localScrollId };
    }

    // 兩者都有，比較時間戳
    if (remoteTs > localTs) {
      // 伺服器較新：更新本地快取，以伺服器為準
      console.log(`[Reconciler] 伺服器進度較新 (P.${remotePage} [${remoteScrollId}] > local P.${localPage} [${localScrollId}])，更新本地快取`);
      await db.cached_progress.put({
        chapterId,
        seriesId: remote!.seriesId ?? local?.seriesId ?? 0,
        volumeId: remote!.volumeId ?? local?.volumeId ?? 0,
        page: remotePage,
        bookScrollId: remoteScrollId,
        timestamp: remoteTs,
      });
      return { page: remotePage, bookScrollId: remoteScrollId };
    } else if (localTs > remoteTs) {
      // 本地較新：非同步上推至伺服器（不阻塞開書）
      console.log(`[Reconciler] 本地進度較新 (P.${localPage} [${localScrollId}] > remote P.${remotePage})，背景上推伺服器`);
      const series = await db.cached_series.get(local!.seriesId).catch(() => null);
      kavitaClient.saveProgress({
        seriesId: local!.seriesId,
        volumeId: local!.volumeId,
        chapterId,
        pageNum: localPage,
        page: localPage,
        bookScrollId: localScrollId,
        libraryId: series?.libraryId,
      }).catch(() => {});
      return { page: localPage, bookScrollId: localScrollId };
    }

    // 時間戳相同（含兩者都是 0 的初始情形），沿用本地
    return { page: localPage, bookScrollId: localScrollId };
  }
}

export const progressReconciler = new ProgressReconciler();
