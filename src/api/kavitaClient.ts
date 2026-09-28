import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type {
  ChapterDto,
  ChapterInfoDto,
  EpubFont,
  LibraryDto,
  ProgressDto,
  SeriesDto,
  UserDto,
  VolumeDto,
  BookChapterItem,
  BookInfoDto,
} from '../types/kavita';



function base64ToBlob(base64: string, mimeType: string): Blob {
  // 清理前綴如果有的話
  const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
  const byteCharacters = atob(cleanBase64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
}

class KavitaClient {
  private baseUrl: string = '';
  private token: string = '';
  private apiKey: string = '';

  constructor() {
    const savedUrl = localStorage.getItem('kavita_base_url');
    const savedToken = localStorage.getItem('kavita_token');
    const savedApiKey = localStorage.getItem('kavita_api_key');
    if (savedUrl) this.baseUrl = savedUrl.replace(/\/+$/, '');
    if (savedToken) this.token = savedToken;
    if (savedApiKey) this.apiKey = savedApiKey;
  }

  setServer(url: string, token?: string, apiKey?: string) {
    this.baseUrl = url.replace(/\/+$/, '');
    localStorage.setItem('kavita_base_url', this.baseUrl);
    if (token) {
      this.token = token;
      localStorage.setItem('kavita_token', token);
    }
    if (apiKey) {
      this.apiKey = apiKey;
      localStorage.setItem('kavita_api_key', apiKey);
    }
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  isConfigured() {
    return !!this.baseUrl && (!!this.token || !!this.apiKey);
  }

  getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }


  private buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`);
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      });
    }
    if (this.apiKey && !url.searchParams.has('apiKey')) {
      url.searchParams.set('apiKey', this.apiKey);
    }
    return url.toString();
  }

  // 通用底層請求方法：原生環境使用 CapacitorHttp (完全免除 CORS 限制)，Web 使用 fetch
  private async request<T = any>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      params?: Record<string, string | number | boolean>;
      body?: any;
    } = {}
  ): Promise<T> {
    const url = this.buildUrl(path, options.params);
    const headers = this.getHeaders();
    const method = options.method || 'GET';

    if (Capacitor.isNativePlatform()) {
      try {
        const res = await CapacitorHttp.request({
          url,
          method,
          headers,
          data: options.body,
        });

        if (res.status >= 400) {
          const errDetail =
            typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          throw new Error(`伺服器回應錯誤 (${res.status}): ${errDetail}`);
        }
        return res.data as T;
      } catch (e: any) {
        console.error('[CapacitorHttp] 請求失敗:', e);
        throw new Error(e.message || '原生連線失敗，請確認伺服器網址是否正確');
      }
    } else {
      const res = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`請求失敗 (${res.status}): ${errText || res.statusText}`);
      }
      return await res.json();
    }
  }

  // 登入驗證
  async login(username: string, password: string): Promise<UserDto> {
    const data = await this.request<UserDto>('/api/Account/login', {
      method: 'POST',
      body: { username, password },
    });

    this.token = data.token;
    this.apiKey = data.apiKey || '';
    localStorage.setItem('kavita_token', this.token);
    if (this.apiKey) localStorage.setItem('kavita_api_key', this.apiKey);
    return data;
  }

  // API Key 驗證
  async authenticateApiKey(
    apiKey: string,
    pluginName: string = 'KavitaAndroidClient'
  ): Promise<UserDto> {
    const data = await this.request<UserDto>('/api/Plugin/authenticate', {
      method: 'POST',
      params: { apiKey, pluginName },
    });

    this.token = data.token;
    this.apiKey = apiKey;
    localStorage.setItem('kavita_token', this.token);
    localStorage.setItem('kavita_api_key', apiKey);
    return data;
  }

  // 取得書庫列表
  async getLibraries(): Promise<LibraryDto[]> {
    return await this.request<LibraryDto[]>('/api/Library/libraries');
  }

  // 取得某書庫的所有系列 (使用 Kavita 官方端點 POST /api/Series/all-v2，並按 LibraryId 精確過濾)
  async getSeriesForLibrary(libraryId: number): Promise<SeriesDto[]> {
    try {
      const data = await this.request<any>('/api/Series/all-v2', {
        method: 'POST',
        params: {
          libraryId,
          pageNumber: 1,
          pageSize: 0,
        },
        body: {
          id: 0,
          name: 'All',
          statements: [
            {
              comparison: 0, // Equals
              field: 19,    // FilterField.Library = 19
              value: String(libraryId),
            },
          ],
        },
      });

      if (Array.isArray(data)) {
        return data;
      } else if (data && Array.isArray(data.result)) {
        return data.result;
      } else if (data && Array.isArray(data.items)) {
        return data.items;
      }
      return [];
    } catch (err) {
      console.warn('POST /api/Series/all-v2 失敗，嘗試回退方案:', err);
      try {
        const fallback = await this.request<any>('/api/Series/v2', {
          method: 'POST',
          params: { pageNumber: 1, pageSize: 0 },
          body: {
            id: 0,
            name: 'All',
            statements: [{ comparison: 0, field: 19, value: String(libraryId) }],
          },
        });
        if (Array.isArray(fallback)) return fallback;
        if (fallback?.result) return fallback.result;
      } catch (e) {
        console.error('所有獲取系列端點均失敗:', e);
      }
      return [];
    }
  }

  // 取得系列的所有卷冊與章節 (Kavita 官方端點: GET /api/Series/volumes)
  async getSeriesVolumes(seriesId: number): Promise<VolumeDto[]> {
    try {
      const data = await this.request<VolumeDto[]>('/api/Series/volumes', {
        params: { seriesId },
      });
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('取得系列卷冊失敗:', e);
      return [];
    }
  }

  // 取得章節詳情 (包含總頁數等，開啟 extractPdf 支援 PDF 格式書籍)
  async getChapterInfo(chapterId: number): Promise<ChapterInfoDto> {

    return await this.request<ChapterInfoDto>('/api/Reader/chapter-info', {
      params: { chapterId, extractPdf: true },
    });
  }

  // 取得閱讀進度
  async getProgress(chapterId: number): Promise<ProgressDto | null> {
    try {
      return await this.request<ProgressDto>('/api/Reader/get-progress', {
        params: { chapterId },
      });
    } catch {
      return null;
    }
  }

  // 提交閱讀進度 (完全符合 Kavita 官方 ProgressDto 規範)
  async saveProgress(progress: ProgressDto): Promise<void> {
    const payload = {
      libraryId: progress.libraryId ?? 0,
      seriesId: progress.seriesId,
      volumeId: progress.volumeId,
      chapterId: progress.chapterId,
      pageNum: progress.pageNum ?? progress.page ?? 0,
      bookScrollId: progress.bookScrollId ?? null,
    };
    await this.request('/api/Reader/progress', {
      method: 'POST',
      body: payload,
    });
  }

  // 取得繼續閱讀錨點
  async getContinuePoint(seriesId: number): Promise<ChapterDto | null> {
    try {
      return await this.request<ChapterDto>('/api/Reader/continue-point', {
        params: { seriesId },
      });
    } catch {
      return null;
    }
  }

  // 產生漫畫/書籍單頁圖片 URL (開啟 extractPdf 確保 PDF 也能串流即時抽取單頁圖片)
  getChapterImageUrl(chapterId: number, page: number): string {
    return this.buildUrl('/api/Reader/image', { chapterId, page, extractPdf: true });
  }

  // 取得章節實體下載 URL
  getChapterDownloadUrl(chapterId: number): string {
    return this.buildUrl('/api/Download/chapter', { chapterId });
  }

  // 產生系列封面 URL
  getSeriesCoverUrl(seriesId: number): string {
    return this.buildUrl('/api/Image/series-cover', { seriesId });
  }

  // 產生卷冊封面 URL
  getVolumeCoverUrl(volumeId: number): string {
    return this.buildUrl('/api/Image/volume-cover', { volumeId });
  }

  // 產生章節封面 URL
  getChapterCoverUrl(chapterId: number): string {
    return this.buildUrl('/api/Image/chapter-cover', { chapterId });
  }

  // 下載單頁漫畫圖片 Blob
  async fetchChapterImageBlob(chapterId: number, page: number): Promise<Blob> {
    const url = this.getChapterImageUrl(chapterId, page);
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: this.getHeaders(),
        responseType: 'blob',
      });
      return base64ToBlob(res.data, 'image/jpeg');
    } else {
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) throw new Error(`下載圖片失敗 P.${page} (${res.status})`);
      return await res.blob();
    }
  }

  // 下載整本 EPUB 二進位檔案 (Kavita 官方端點: GET /api/Download/chapter?chapterId={chapterId})
  async fetchChapterEpubBlob(chapterId: number): Promise<Blob> {
    const url = this.buildUrl('/api/Download/chapter', { chapterId });
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: this.getHeaders(),
        responseType: 'blob',
      });
      return base64ToBlob(res.data, 'application/epub+zip');
    } else {
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) throw new Error(`下載 EPUB 失敗 (${res.status})`);
      return await res.blob();
    }
  }

  // 取得伺服器端所有字型列表 (Kavita 官方端點: GET /api/Font/all)
  async getFonts(): Promise<EpubFont[]> {
    try {
      const data = await this.request<EpubFont[]>('/api/Font/all');
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('取得伺服器字型清單失敗:', e);
      return [];
    }
  }

  // 取得伺服器字型檔案 URL
  getFontUrl(fontId: number): string {
    return this.buildUrl('/api/Font', { fontId });
  }

  // 取得書籍章節清單（極輕量，數 KB，零流量浪費）
  async getBookChapters(chapterId: number): Promise<BookChapterItem[]> {
    return await this.request<BookChapterItem[]>(`/api/book/${chapterId}/chapters`);
  }

  // 按需取得單一章節的 HTML 內容（純文字 HTML，通常僅 10~50 KB，瞬間秒開）
  async getBookPage(chapterId: number, page: number): Promise<string> {
    const url = this.buildUrl(`/api/book/${chapterId}/book-page`, { page });
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: this.getHeaders(),
        responseType: 'text',
      });
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    } else {
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) throw new Error(`載入章節頁面失敗 (${res.status})`);
      return await res.text();
    }
  }

  // 取得書籍元資料 (總頁數等)
  async getBookInfo(chapterId: number): Promise<BookInfoDto> {
    return await this.request<BookInfoDto>(`/api/book/${chapterId}/book-info`);
  }
}

export const kavitaClient = new KavitaClient();



