import { kavitaClient } from '../../api/kavitaClient';
import { nativeStorage } from './nativeStorage';
import type { EpubFont } from '../../types/kavita';

export interface FontDownloadProgress {
  family: string;
  fontName: string;
  percentage: number;
  loadedBytes: number;
  totalBytes: number;
  isDownloading: boolean;
  error?: string;
}

class FontLoader {
  private loadedFamilies = new Set<string>();
  private activeLoadingPromises = new Map<string, Promise<boolean>>();
  private cachedFonts = new Set<number>();

  /**
   * 檢查某個字型家族是否所有檔案皆已快取在本地沙盒
   */
  async isFamilyDownloaded(fonts: EpubFont[]): Promise<boolean> {
    if (!fonts || fonts.length === 0) return true;
    for (const f of fonts) {
      if (f.provider === 1 || !f.fileName) continue; // 系統字型無需下載
      const downloaded = await nativeStorage.isFontDownloaded(f.id);
      if (!downloaded) return false;
    }
    return true;
  }

  /**
   * 載入並註冊字型家族（若未下載則會觸發下載，支援進度回調）
   */
  async loadFontFamilyWithProgress(
    family: string,
    fonts: EpubFont[],
    onProgress?: (p: FontDownloadProgress) => void,
    targetDoc?: Document
  ): Promise<boolean> {
    if (!family || family === 'sans-serif' || family === 'serif') return true;

    // 若該家族全部皆為系統字型，直接視為完成
    if (fonts.length > 0 && fonts.every((f) => f.provider === 1 || !f.fileName)) {
      this.loadedFamilies.add(family);
      return true;
    }

    if (this.activeLoadingPromises.has(family)) {
      return this.activeLoadingPromises.get(family)!;
    }

    const loadPromise = (async () => {
      try {
        console.log(`[FontLoader] 處理字型家族: ${family} (${fonts.length} 個檔案)...`);
        const faces: FontFace[] = [];

        for (let i = 0; i < fonts.length; i++) {
          const f = fonts[i];
          if (f.provider === 1 || !f.fileName) continue; // 略過系統端點不可下載之字型
          const style = f.style || 'normal';
          const weight = f.weight || 'normal';

          let buffer = await nativeStorage.getFontArrayBuffer(f.id);

          // 若本地尚未下載，開始串流下載
          if (!buffer) {
            onProgress?.({
              family,
              fontName: f.name || f.family,
              percentage: 0,
              loadedBytes: 0,
              totalBytes: 0,
              isDownloading: true,
            });

            const fontUrl = kavitaClient.getFontUrl(f.id);
            await nativeStorage.downloadFont(
              f.id,
              fontUrl,
              kavitaClient.getAuthHeaders(),
              (pct, loaded, total) => {
                onProgress?.({
                  family,
                  fontName: f.name || f.family,
                  percentage: pct,
                  loadedBytes: loaded,
                  totalBytes: total,
                  isDownloading: true,
                });
              }
            );

            // 下載完成後讀取
            buffer = await nativeStorage.getFontArrayBuffer(f.id);
          }

          if (buffer) {
            try {
              const fontFace = new FontFace(f.family, buffer, { style, weight });
              await fontFace.load();
              faces.push(fontFace);
              (document as any).fonts.add(fontFace);
              this.cachedFonts.add(f.id);
              console.log(`[FontLoader] 成功註冊本地字型: ${f.family} (${f.fileName})`);
            } catch (err) {
              console.warn(`[FontLoader] FontFace.load 失敗 (${f.fileName}):`, err);
            }
          }
        }

        // 同步至目標 iframe Document
        if (targetDoc && (targetDoc as any).fonts) {
          for (const face of faces) {
            try {
              (targetDoc as any).fonts.add(face);
            } catch {}
          }
        }

        this.loadedFamilies.add(family);
        onProgress?.({
          family,
          fontName: family,
          percentage: 100,
          loadedBytes: 0,
          totalBytes: 0,
          isDownloading: false,
        });

        return faces.length > 0;
      } catch (err: any) {
        console.error(`[FontLoader] 字型家族 ${family} 下載/載入失敗:`, err);
        onProgress?.({
          family,
          fontName: family,
          percentage: 0,
          loadedBytes: 0,
          totalBytes: 0,
          isDownloading: false,
          error: err?.message || '下載失敗',
        });
        return false;
      } finally {
        this.activeLoadingPromises.delete(family);
      }
    })();

    this.activeLoadingPromises.set(family, loadPromise);
    return loadPromise;
  }

  /**
   * 同步所有已加載的 FontFace 到 iframe
   */
  syncFontsToDocument(targetDoc: Document) {
    if (!targetDoc || !(targetDoc as any).fonts) return;
    try {
      (document as any).fonts.forEach((face: FontFace) => {
        try {
          (targetDoc as any).fonts.add(face);
        } catch {}
      });
    } catch (e) {
      console.warn('[FontLoader] 同步字型失敗:', e);
    }
  }
}

export const fontLoader = new FontLoader();
