import { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { kavitaClient } from '../../../api/kavitaClient';
import { nativeStorage } from '../../../core/storage/nativeStorage';
import { downloadManager } from '../../../core/storage/downloadManager';
import type { ChapterSection } from '../types';

interface UseEpubLoaderProps {
  seriesId: number;
  seriesName: string;
  volumeId: number;
  chapterId: number;
  chapterTitle: string;
}

export interface UseEpubLoaderReturn {
  sections: ChapterSection[];
  setSections: React.Dispatch<React.SetStateAction<ChapterSection[]>>;
  isLoading: boolean;
  isSectionLoading: boolean;
  setIsSectionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isOffline: boolean;
  downloadProgress: number | null;
  handleDownload: () => Promise<void>;
  getSectionHtml: (sectionIndex: number, currentReqId: number, requestIdRef: React.MutableRefObject<number>) => Promise<string | null>;
  resolveRelativePath: (base: string, rel: string) => string;
}

export const useEpubLoader = ({
  seriesId,
  seriesName,
  volumeId,
  chapterId,
  chapterTitle,
}: UseEpubLoaderProps): UseEpubLoaderReturn => {
  const [sections, setSections] = useState<ChapterSection[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSectionLoading, setIsSectionLoading] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const zipRef = useRef<JSZip | null>(null);
  const imageCacheRef = useRef<Record<string, string>>({});

  // 監聽下載動態進度
  useEffect(() => {
    const unsubscribe = downloadManager.subscribe((p) => {
      if (p.chapterId === chapterId) {
        if (p.status === 'downloading') {
          setDownloadProgress(p.percentage);
        } else if (p.status === 'completed') {
          setDownloadProgress(null);
          setIsOffline(true);
        } else if (p.status === 'error') {
          setDownloadProgress(null);
        }
      }
    });
    return () => {
      unsubscribe();
    };
  }, [chapterId]);

  // 相對路徑轉換輔助
  const resolveRelativePath = useCallback((base: string, rel: string): string => {
    const cleanRel = rel.split('?')[0].split('#')[0];
    if (cleanRel.startsWith('data:') || cleanRel.startsWith('http://') || cleanRel.startsWith('https://')) {
      return cleanRel;
    }
    const baseParts = base.split('/').slice(0, -1);
    for (const part of cleanRel.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        baseParts.pop();
      } else {
        baseParts.push(part);
      }
    }
    return baseParts.join('/');
  }, []);

  // 單張圖片按需解壓（改用 Blob URL，極速並行，記憶體零膨脹）
  const getImageDataUrl = useCallback(async (targetPath: string): Promise<string | null> => {
    if (imageCacheRef.current[targetPath]) return imageCacheRef.current[targetPath];
    const zip = zipRef.current;
    if (!zip) return null;

    let zipFile = zip.file(targetPath);
    if (!zipFile) {
      const pureTarget = targetPath.split('/').pop() || '';
      const foundKey = Object.keys(zip.files).find((k) => k.endsWith('/' + pureTarget) || k === pureTarget);
      if (foundKey) zipFile = zip.file(foundKey);
    }

    if (zipFile) {
      const lower = zipFile.name.toLowerCase();
      const ext = lower.split('.').pop() || 'jpeg';
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'gif'
          ? 'image/gif'
          : ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
      const blobData = await zipFile.async('blob');
      const objectUrl = URL.createObjectURL(new Blob([blobData], { type: mime }));
      imageCacheRef.current[targetPath] = objectUrl;
      return objectUrl;
    }
    return null;
  }, []);

  // 1. 下載或讀取沙盒 EPUB 檔案並僅解析骨架 Spine（秒開，不遍歷所有章節與圖片）
  useEffect(() => {
    let mounted = true;

    const loadAndParseEpub = async () => {
      try {
        setIsLoading(true);
        const offline = await downloadManager.isChapterOffline(chapterId);
        if (!mounted) return;
        setIsOffline(offline);

        let skeletalSections: ChapterSection[] = [];

        if (offline) {
          // === 軌道 A：離線沙盒模式（直接本地解壓）===
          const epubBlob = await nativeStorage.getEpubBlob(chapterId);
          if (!epubBlob) throw new Error('離線 EPUB 檔案不存在');

          const zip = await JSZip.loadAsync(epubBlob);
          zipRef.current = zip;
          imageCacheRef.current = {};

          const containerXml = await zip.file('META-INF/container.xml')?.async('text');
          if (!containerXml) throw new Error('Invalid EPUB: Missing container.xml');

          const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
          const opfPath = opfPathMatch ? opfPathMatch[1] : 'OEBPS/content.opf';
          const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

          const opfContent = await zip.file(opfPath)?.async('text');
          if (!opfContent) throw new Error('Invalid EPUB: Missing OPF');

          const parser = new DOMParser();
          const opfDoc = parser.parseFromString(opfContent, 'application/xml');

          const manifestItems: Record<string, string> = {};
          opfDoc.querySelectorAll('manifest > item').forEach((item) => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            if (id && href) {
              manifestItems[id] = opfDir + href;
            }
          });

          const spineItems: string[] = [];
          opfDoc.querySelectorAll('spine > itemref').forEach((item) => {
            const idref = item.getAttribute('idref');
            if (idref && manifestItems[idref]) {
              spineItems.push(manifestItems[idref]);
            }
          });

          skeletalSections = spineItems.map((href, i) => ({
            id: `sec-${i}`,
            href,
            title: `第 ${i + 1} 節`,
          }));
        } else {
          // === 軌道 B：線上串流按需模式（極致省流，零整書下載，毫秒秒開）===
          zipRef.current = null;
          imageCacheRef.current = {};

          try {
            const serverChapters = await kavitaClient.getBookChapters(chapterId);
            if (serverChapters && serverChapters.length > 0) {
              skeletalSections = serverChapters.map((c, i) => ({
                id: `sec-${c.page ?? i}`,
                href: `page-${c.page ?? i}`,
                title: c.title || `第 ${i + 1} 節`,
              }));
            } else {
              const info = await kavitaClient.getChapterInfo(chapterId);
              const total = info.pages || 1;
              skeletalSections = Array.from({ length: total }, (_, i) => ({
                id: `sec-${i}`,
                href: `page-${i}`,
                title: `第 ${i + 1} 節`,
              }));
            }
          } catch (e) {
            console.warn('線上取得章節清單失敗，嘗試回退 chapterInfo:', e);
            const info = await kavitaClient.getChapterInfo(chapterId);
            const total = info.pages || 1;
            skeletalSections = Array.from({ length: total }, (_, i) => ({
              id: `sec-${i}`,
              href: `page-${i}`,
              title: `第 ${i + 1} 節`,
            }));
          }
        }

        if (mounted) {
          setSections(skeletalSections);
        }
      } catch (err) {
        console.error('解析 EPUB 失敗:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadAndParseEpub();
    return () => {
      mounted = false;
      zipRef.current = null;
      imageCacheRef.current = {};
    };
  }, [chapterId]);

  // 單章節按需載入 HTML 並並行替換圖片路徑
  const getSectionHtml = useCallback(
    async (
      sectionIndex: number,
      currentReqId: number,
      requestIdRef: React.MutableRefObject<number>
    ): Promise<string | null> => {
      const currentSection = sections[sectionIndex];
      if (!currentSection) return null;
      if (currentSection.htmlContent) return currentSection.htmlContent;

      if (isOffline && zipRef.current) {
        // === 軌道 A：離線本地解壓 ===
        const rawHtml = await zipRef.current.file(currentSection.href)?.async('text');
        if (currentReqId !== requestIdRef.current) return null;
        if (!rawHtml) return null;

        let processedHtml = rawHtml;
        // 1. 並行替換 <img> 標籤
        const imgMatches = Array.from(processedHtml.matchAll(/(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi));
        if (imgMatches.length > 0) {
          const imgReplacements = await Promise.all(
            imgMatches.map(async ([fullMatch, prefix, src, suffix]) => {
              const resolved = resolveRelativePath(currentSection.href, src);
              const dataUrl = (await getImageDataUrl(resolved)) || (await getImageDataUrl(src));
              return { fullMatch, replacement: dataUrl ? `${prefix}${dataUrl}${suffix}` : fullMatch };
            })
          );
          if (currentReqId !== requestIdRef.current) return null;
          for (const { fullMatch, replacement } of imgReplacements) {
            processedHtml = processedHtml.replace(fullMatch, replacement);
          }
        }

        // 2. 並行替換 <image> / <use> (SVG 格式)
        const svgMatches = Array.from(
          processedHtml.matchAll(/(<(?:image|use)[^>]+(?:xlink:href|href)=["'])([^"']+)(["'][^>]*>)/gi)
        );
        if (svgMatches.length > 0) {
          const svgReplacements = await Promise.all(
            svgMatches.map(async ([fullMatch, prefix, src, suffix]) => {
              const resolved = resolveRelativePath(currentSection.href, src);
              const dataUrl = (await getImageDataUrl(resolved)) || (await getImageDataUrl(src));
              return { fullMatch, replacement: dataUrl ? `${prefix}${dataUrl}${suffix}` : fullMatch };
            })
          );
          if (currentReqId !== requestIdRef.current) return null;
          for (const { fullMatch, replacement } of svgReplacements) {
            processedHtml = processedHtml.replace(fullMatch, replacement);
          }
        }

        currentSection.htmlContent = processedHtml;
        return processedHtml;
      } else {
        // === 軌道 B：線上串流按需加載（只抓取該節 HTML，10~50 KB，瞬間完成）===
        try {
          const rawHtml = await kavitaClient.getBookPage(chapterId, sectionIndex);
          if (currentReqId !== requestIdRef.current) return null;
          if (!rawHtml) return null;

          let processedHtml = rawHtml;
          const baseUrl = kavitaClient.getBaseUrl();
          const apiKey = localStorage.getItem('kavita_api_key') || '';
          const authQuery = apiKey ? `apiKey=${encodeURIComponent(apiKey)}` : '';

          // 替換 img src
          processedHtml = processedHtml.replace(
            /(<img[^>]+src=["'])([^"']+)(["'][^>]*>)/gi,
            (fullMatch, prefix, src, suffix) => {
              if (
                src.startsWith('data:') ||
                src.startsWith('blob:') ||
                src.startsWith('http://') ||
                src.startsWith('https://')
              ) {
                return fullMatch;
              }
              const cleanSrc = src.startsWith('/') ? src : `/${src}`;
              const sep = cleanSrc.includes('?') ? '&' : '?';
              const fullUrl = authQuery ? `${baseUrl}${cleanSrc}${sep}${authQuery}` : `${baseUrl}${cleanSrc}`;
              return `${prefix}${fullUrl}${suffix}`;
            }
          );

          // 替換 svg image href
          processedHtml = processedHtml.replace(
            /(<(?:image|use)[^>]+(?:xlink:href|href)=["'])([^"']+)(["'][^>]*>)/gi,
            (fullMatch, prefix, src, suffix) => {
              if (
                src.startsWith('data:') ||
                src.startsWith('blob:') ||
                src.startsWith('http://') ||
                src.startsWith('https://')
              ) {
                return fullMatch;
              }
              const cleanSrc = src.startsWith('/') ? src : `/${src}`;
              const sep = cleanSrc.includes('?') ? '&' : '?';
              const fullUrl = authQuery ? `${baseUrl}${cleanSrc}${sep}${authQuery}` : `${baseUrl}${cleanSrc}`;
              return `${prefix}${fullUrl}${suffix}`;
            }
          );

          currentSection.htmlContent = processedHtml;
          return processedHtml;
        } catch (e) {
          console.error(`線上加載章節第 ${sectionIndex} 節失敗:`, e);
          return null;
        }
      }
    },
    [sections, isOffline, chapterId, getImageDataUrl, resolveRelativePath]
  );

  // 下載整本 EPUB 至 Android 原生沙盒
  const handleDownload = useCallback(async () => {
    if (isOffline || downloadProgress !== null) return;
    try {
      await downloadManager.downloadEpubChapter(
        seriesId,
        seriesName,
        volumeId,
        chapterId,
        chapterTitle
      );
    } catch (e) {
      console.warn('下載 EPUB 失敗:', e);
    }
  }, [isOffline, downloadProgress, seriesId, seriesName, volumeId, chapterId, chapterTitle]);

  return {
    sections,
    setSections,
    isLoading,
    isSectionLoading,
    setIsSectionLoading,
    isOffline,
    downloadProgress,
    handleDownload,
    getSectionHtml,
    resolveRelativePath,
  };
};
