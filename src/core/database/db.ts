import Dexie, { type Table } from 'dexie';
import type { OfflineBookMeta, ServerConfig, SeriesDto } from '../../types/kavita';

export interface ProgressQueueItem {
  id?: number;
  seriesId: number;
  volumeId: number;
  chapterId: number;
  page: number;
  bookScrollId?: string | null;
  timestamp: number; // 本地時間戳 (毫秒)
  status: 'pending' | 'syncing' | 'failed';
}

export interface CachedProgress {
  chapterId: number;
  seriesId: number;
  volumeId: number;
  page: number;
  bookScrollId?: string | null;
  timestamp: number;
}

export class KavitaDatabase extends Dexie {
  servers!: Table<ServerConfig, string>;
  offline_books!: Table<OfflineBookMeta, number>; // key: chapterId
  progress_queue!: Table<ProgressQueueItem, number>;
  cached_series!: Table<SeriesDto, number>;
  cached_progress!: Table<CachedProgress, number>; // key: chapterId

  constructor() {
    super('KavitaLocalDB');
    this.version(1).stores({
      servers: 'id, baseUrl, isActive',
      offline_books: 'chapterId, seriesId, volumeId, format, downloadDate',
      progress_queue: '++id, chapterId, seriesId, status, timestamp',
      cached_series: 'id, libraryId, name',
      cached_progress: 'chapterId, seriesId, timestamp',
    });
  }
}

export const db = new KavitaDatabase();
