export interface EpubReaderProps {
  seriesId: number;
  seriesName: string;
  volumeId: number;
  chapterId: number;
  chapterTitle: string;
  initialPage?: number;
  onClose: () => void;
}

export interface ChapterSection {
  id: string;
  href: string;
  title: string;
  htmlContent?: string;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'black';
export type LayoutMode = 'scroll' | 'paged';

export const THEME_STYLES: Record<ReaderTheme, { bg: string; text: string }> = {
  light: { bg: '#ffffff', text: '#111827' },
  sepia: { bg: '#fbf0d9', text: '#5f4b32' },
  dark: { bg: '#1f2024', text: '#d1d5db' },
  black: { bg: '#000000', text: '#9ca3af' },
};

export const normalizeWeight = (w?: string | number): number => {
  if (!w) return 400;
  if (typeof w === 'number') return w;
  const lower = w.trim().toLowerCase();
  if (lower === 'normal' || lower === 'regular') return 400;
  if (lower === 'bold') return 700;
  if (lower === 'light') return 300;
  if (lower === 'medium') return 500;
  if (lower === 'thin') return 100;
  if (lower === 'black' || lower === 'heavy') return 900;
  const parsed = parseInt(lower, 10);
  return isNaN(parsed) ? 400 : parsed;
};

export const getWeightName = (w: number, t?: (k: any) => string): string => {
  if (t) {
    if (w <= 100) return t('epub.weightThin');
    if (w <= 200) return t('epub.weightExtraLight');
    if (w <= 300) return t('epub.weightLight');
    if (w <= 400) return t('epub.weightRegular');
    if (w <= 500) return t('epub.weightMedium');
    if (w <= 600) return t('epub.weightSemiBold');
    if (w <= 700) return t('epub.weightBold');
    if (w <= 800) return t('epub.weightExtraBold');
    return t('epub.weightBlack');
  }
  if (w <= 100) return '極細 (100)';
  if (w <= 200) return '特細 (200)';
  if (w <= 300) return '細體 (300)';
  if (w <= 400) return '常規 (400)';
  if (w <= 500) return '適中 (500)';
  if (w <= 600) return '半粗 (600)';
  if (w <= 700) return '粗體 (700)';
  if (w <= 800) return '特粗 (800)';
  return '黑體 (900)';
};
