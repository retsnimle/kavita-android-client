import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { db } from '../database/db';

class NativeStorageManager {
  private isNative = Capacitor.isNativePlatform();

  private getRootDirectory(): Directory {
    return Directory.Data; // Android 內部私有專屬目錄，不會被系統快取機制隨意抹除
  }

  // 將 Blob 轉為 Base64 字串
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        // 去除 data:image/xxx;base64, 標頭
        const content = base64data.split(',')[1] || '';
        resolve(content);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // 確保目錄存在
  private async ensureDir(dirPath: string): Promise<void> {
    if (!this.isNative) return;
    try {
      await Filesystem.mkdir({
        path: dirPath,
        directory: this.getRootDirectory(),
        recursive: true,
      });
    } catch {
      // 目錄可能已存在，忽略
    }
  }

  /**
   * 保存單張漫畫圖片至 Android 沙盒
   * 路徑結構: comics/{chapterId}/{page}.jpg
   */
  async saveComicPage(chapterId: number, page: number, blob: Blob): Promise<string> {
    const dir = `comics/${chapterId}`;
    const filename = `${page}.jpg`;
    const fullPath = `${dir}/${filename}`;

    if (this.isNative) {
      await this.ensureDir(dir);
      const base64Data = await this.blobToBase64(blob);
      await Filesystem.writeFile({
        path: fullPath,
        data: base64Data,
        directory: this.getRootDirectory(),
      });
      return fullPath;
    } else {
      // 網頁環境 Fallback: 存至 CacheStorage
      const cache = await caches.open('kavita-offline-comics');
      const fakeUrl = `http://localhost/offline/comic/${chapterId}/${page}`;
      await cache.put(fakeUrl, new Response(blob));
      return fakeUrl;
    }
  }

  /**
   * 讀取漫畫圖片 URL（供 <img> 標籤或 Canvas 載入）
   */
  async getComicPageUrl(chapterId: number, page: number): Promise<string> {
    const fullPathJpg = `comics/${chapterId}/${page}.jpg`;
    const fullPathImg = `comics/${chapterId}/${page}.img`;

    if (this.isNative) {
      try {
        let uri = '';
        try {
          const res = await Filesystem.getUri({
            path: fullPathJpg,
            directory: this.getRootDirectory(),
          });
          uri = res.uri;
        } catch {
          const fallback = await Filesystem.getUri({
            path: fullPathImg,
            directory: this.getRootDirectory(),
          });
          uri = fallback.uri;
        }
        return Capacitor.convertFileSrc(uri);
      } catch {
        return '';
      }
    } else {
      const cache = await caches.open('kavita-offline-comics');
      const fakeUrl = `http://localhost/offline/comic/${chapterId}/${page}`;
      const res = await cache.match(fakeUrl);
      if (res) {
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      }
      return '';
    }
  }

  /**
   * 原生串流下載大檔案（EPUB, PDF, CBZ）直接寫入沙盒磁碟
   * 避免將整個大檔案讀入 JavaScript 記憶體造成 OOM 崩潰
   */
  async downloadLargeFile(
    url: string,
    relativePath: string,
    headers?: Record<string, string>,
    onProgress?: (percentage: number, loaded: number, total: number) => void
  ): Promise<string> {
    if (this.isNative) {
      const dir = relativePath.includes('/')
        ? relativePath.substring(0, relativePath.lastIndexOf('/'))
        : '';
      if (dir) await this.ensureDir(dir);

      let listenerHandle: any = null;
      if (onProgress) {
        listenerHandle = await Filesystem.addListener('progress', (status) => {
          if (status.contentLength && status.contentLength > 0) {
            const pct = Math.min(99, Math.round((status.bytes / status.contentLength) * 100));
            onProgress(pct, status.bytes, status.contentLength);
          }
        });
      }

      try {
        await Filesystem.downloadFile({
          url,
          path: relativePath,
          directory: this.getRootDirectory(),
          headers,
          progress: true,
        });
      } finally {
        if (listenerHandle) {
          listenerHandle.remove();
        }
      }
      return relativePath;
    } else {
      const res = await fetch(url, { headers });
      const contentLength = +(res.headers.get('content-length') || 0);
      let loaded = 0;
      let blob: Blob;

      if (res.body && contentLength > 0 && onProgress) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loaded += value.length;
            const pct = Math.min(99, Math.round((loaded / contentLength) * 100));
            onProgress(pct, loaded, contentLength);
          }
        }
        blob = new Blob(chunks as unknown as BlobPart[]);
      } else {
        blob = await res.blob();
      }

      const cache = await caches.open('kavita-offline-epubs');
      await cache.put(`http://localhost/offline/${relativePath}`, new Response(blob));
      return relativePath;
    }
  }

  /**
   * 保存 EPUB 二進位檔案至 Android 沙盒
   * 路徑結構: epubs/{chapterId}.epub
   */
  async saveEpubFile(chapterId: number, blob: Blob): Promise<string> {
    const dir = 'epubs';
    const fullPath = `${dir}/${chapterId}.epub`;

    if (this.isNative) {
      await this.ensureDir(dir);
      const base64Data = await this.blobToBase64(blob);
      await Filesystem.writeFile({
        path: fullPath,
        data: base64Data,
        directory: this.getRootDirectory(),
      });
      return fullPath;
    } else {
      const cache = await caches.open('kavita-offline-epubs');
      const fakeUrl = `http://localhost/offline/epub/${chapterId}`;
      await cache.put(fakeUrl, new Response(blob));
      return fakeUrl;
    }
  }

  /**
   * 取得 EPUB 二進位資料 Blob（供 EPUB 渲染引擎解析）
   */
  async getEpubBlob(chapterId: number): Promise<Blob | null> {
    const fullPath = `epubs/${chapterId}.epub`;

    if (this.isNative) {
      try {
        const fileStat = await Filesystem.stat({
          path: fullPath,
          directory: this.getRootDirectory(),
        });
        console.log(`[nativeStorage] 找到離線 EPUB 實體檔案: ${fullPath}，大小: ${fileStat.size} bytes`);

        const uriResult = await Filesystem.getUri({
          path: fullPath,
          directory: this.getRootDirectory(),
        });
        const fileUrl = Capacitor.convertFileSrc(uriResult.uri);
        console.log(`[nativeStorage] 正在透過原生 WebViewAssetLoader 載入: ${fileUrl}`);

        const response = await fetch(fileUrl);
        if (response.ok) {
          const blob = await response.blob();
          console.log(`[nativeStorage] 成功取得本機 EPUB Blob，大小: ${blob.size} bytes`);
          return blob;
        } else {
          console.warn(`[nativeStorage] fetch 原生檔案失敗，HTTP 狀態: ${response.status}`);
        }
      } catch (err) {
        console.error(`[nativeStorage] 透過原生串流讀取 EPUB 失敗:`, err);
      }

      // 如果 fetch 失敗，退回小檔案專用之 readFile (僅限 < 30MB)
      try {
        const res = await Filesystem.readFile({
          path: fullPath,
          directory: this.getRootDirectory(),
        });
        const byteCharacters = atob(res.data as string);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: 'application/epub+zip' });
      } catch (fallbackErr) {
        console.error(`[nativeStorage] readFile 退回讀取亦失敗:`, fallbackErr);
        return null;
      }
    } else {
      const cache = await caches.open('kavita-offline-epubs');
      const fakeUrl = `http://localhost/offline/epub/${chapterId}`;
      const res = await cache.match(fakeUrl);
      if (res) {
        return await res.blob();
      }
      return null;
    }
  }

  /**
   * 取得指定相對路徑之實體檔案大小 (bytes)
   */
  async getFileSizeBytes(relativePath: string): Promise<number> {
    if (this.isNative) {
      try {
        const stat = await Filesystem.stat({
          path: relativePath,
          directory: this.getRootDirectory(),
        });
        return stat.size || 0;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  /**
   * 刪除特定離線章節之本機實體檔案
   */
  async deleteOfflineChapter(chapterId: number, format: 'comic' | 'epub'): Promise<void> {
    if (this.isNative) {
      try {
        if (format === 'comic') {
          await Filesystem.rmdir({
            path: `comics/${chapterId}`,
            directory: this.getRootDirectory(),
            recursive: true,
          });
        } else {
          await Filesystem.deleteFile({
            path: `epubs/${chapterId}.epub`,
            directory: this.getRootDirectory(),
          });
        }
      } catch {
        // 檔案不存在或已刪除
      }
    } else {
      if (format === 'comic') {
        const cache = await caches.open('kavita-offline-comics');
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.url.includes(`/offline/comic/${chapterId}/`)) {
            await cache.delete(req);
          }
        }
      } else {
        const cache = await caches.open('kavita-offline-epubs');
        await cache.delete(`http://localhost/offline/epub/${chapterId}`);
      }
    }

    // 從 IndexedDB 移除記錄
    await db.offline_books.delete(chapterId);
  }

  /**
   * 檢查特定字型是否已下載至本地沙盒
   */
  async isFontDownloaded(fontId: number): Promise<boolean> {
    const fullPath = `fonts/${fontId}.ttf`;
    if (this.isNative) {
      try {
        const stat = await Filesystem.stat({
          path: fullPath,
          directory: this.getRootDirectory(),
        });
        return (stat.size || 0) > 0;
      } catch {
        return false;
      }
    } else {
      const cache = await caches.open('kavita-offline-fonts');
      const res = await cache.match(`http://localhost/offline/fonts/${fontId}`);
      return !!res;
    }
  }

  /**
   * 讀取本地已下載的字型為 ArrayBuffer（供建立 FontFace）
   */
  async getFontArrayBuffer(fontId: number): Promise<ArrayBuffer | null> {
    const fullPath = `fonts/${fontId}.ttf`;
    if (this.isNative) {
      try {
        const fileResult = await Filesystem.readFile({
          path: fullPath,
          directory: this.getRootDirectory(),
        });
        if (fileResult.data) {
          const cleanBase64 = typeof fileResult.data === 'string' && fileResult.data.includes(',')
            ? fileResult.data.split(',')[1]
            : (fileResult.data as string);
          const binaryString = atob(cleanBase64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes.buffer;
        }
      } catch (err) {
        console.warn(`[nativeStorage] 讀取本地字型失敗 (${fontId}):`, err);
      }
      return null;
    } else {
      const cache = await caches.open('kavita-offline-fonts');
      const res = await cache.match(`http://localhost/offline/fonts/${fontId}`);
      if (res) {
        return await res.arrayBuffer();
      }
      return null;
    }
  }

  /**
   * 下載伺服器端字型檔案至本地沙盒（使用 CapacitorHttp 帶認證二進位下載 + writeFile，100% 穩定）
   */
  async downloadFont(
    fontId: number,
    url: string,
    headers?: Record<string, string>,
    onProgress?: (percentage: number, loaded: number, total: number) => void
  ): Promise<string> {
    const relativePath = `fonts/${fontId}.ttf`;

    if (this.isNative) {
      await this.ensureDir('fonts');
      onProgress?.(10, 0, 0);

      try {
        const { CapacitorHttp } = await import('@capacitor/core');
        const res = await CapacitorHttp.request({
          url,
          method: 'GET',
          headers,
          responseType: 'blob',
        });

        if (res.status >= 400) {
          const errDetail = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          throw new Error(`伺服器回應錯誤 (${res.status}): ${errDetail}`);
        }

        onProgress?.(60, 0, 0);
        const cleanBase64 = typeof res.data === 'string' && res.data.includes(',')
          ? res.data.split(',')[1]
          : res.data;

        await Filesystem.writeFile({
          path: relativePath,
          data: cleanBase64,
          directory: this.getRootDirectory(),
        });

        onProgress?.(100, 0, 0);
        return relativePath;
      } catch (err: any) {
        console.warn(`[nativeStorage] CapacitorHttp 下載字型失敗:`, err);
        throw err;
      }
    } else {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`下載失敗 (${res.status})`);
      const blob = await res.blob();
      const cache = await caches.open('kavita-offline-fonts');
      await cache.put(`http://localhost/offline/fonts/${fontId}`, new Response(blob));
      onProgress?.(100, blob.size, blob.size);
      return relativePath;
    }
  }


  /**
   * 計算本機所有已下載離線書籍佔用的實體磁碟容量
   */
  async getStorageUsage(): Promise<{ totalBytes: number; bookCount: number }> {
    const books = await db.offline_books.toArray();
    let totalBytes = 0;
    for (const book of books) {
      totalBytes += book.fileSizeBytes || 0;
    }
    return {
      totalBytes,
      bookCount: books.length,
    };
  }
}

export const nativeStorage = new NativeStorageManager();


