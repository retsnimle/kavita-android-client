export interface UserDto {
  username: string;
  email?: string;
  token: string;
  apiKey?: string;
  preferences?: UserPreferencesDto;
}

export interface UserPreferencesDto {
  readingDirection?: number; // 0: LTR, 1: RTL, 2: Vertical
  scalingOption?: number;
  pageSplitOption?: number;
  readerMode?: number; // 0: Manga, 1: Webtoon, 2: Book
  theme?: string;
}

export interface LibraryDto {
  id: number;
  name: string;
  type: number; // 0: Manga, 1: Comic, 2: Book
  coverImage?: string;
}

export interface SeriesDto {
  id: number;
  name: string;
  originalName?: string;
  localizedName?: string;
  sortName?: string;
  summary?: string;
  pages?: number;
  format: number; // 0: Image, 1: Archive, 2: None, 3: Epub, 4: Pdf
  coverImageLocked?: boolean;
  libraryId: number;
  created?: string;
  lastModified?: string;
}

export interface VolumeDto {
  id: number;
  name?: string;
  minNumber: number;
  maxNumber: number;
  seriesId: number;
  chapters?: ChapterDto[];
  pages?: number;
}

export interface ChapterDto {
  id: number;
  range?: string;
  number?: string;
  title?: string;
  pages: number;
  volumeId: number;
  seriesId: number;
  files?: MangaFileDto[];
}

export interface MangaFileDto {
  id: number;
  filePath: string;
  pages: number;
  format: number;
}

export interface ProgressDto {
  volumeId: number;
  chapterId: number;
  pageNum: number;
  page?: number;
  pagesRead?: number;
  seriesId: number;
  libraryId?: number;
  bookScrollId?: string | null;
  lastModifiedUtc?: string;
}

export interface ChapterInfoDto {
  chapterId: number;
  seriesId: number;
  volumeId: number;
  pages: number;
  pageDimensions?: { width: number; height: number }[];
}

export interface ServerConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  token?: string;
  username?: string;
  isActive: boolean;
}

export interface OfflineBookMeta {
  seriesId: number;
  seriesName: string;
  volumeId: number;
  chapterId: number;
  chapterTitle: string;
  format: 'comic' | 'epub';
  pageCount: number;
  fileSizeBytes: number;
  localPath: string; // Android 沙盒相對路徑
  downloadDate: string;
  coverBlobKey?: string;
}

export interface EpubFont {
  id: number;
  name: string;
  family: string;
  fileName: string;
  provider: number; // 0: System, 1: User
  style?: string;
  weight?: string;
}

export interface BookChapterItem {
  id: number;
  title: string;
  order: number;
  page: number; // 章節對應的伺服器內部索引
}

export interface BookInfoDto {
  bookTitle: string;
  seriesFormat: number;
  pages: number;
  libraryId: number;
  seriesId: number;
}

