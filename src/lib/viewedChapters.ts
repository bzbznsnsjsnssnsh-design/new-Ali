export interface ViewedChapterInfo {
  mangaId: string;
  chapterId: string;
  chapterNumber?: string;
  mangaTitle?: string;
  viewedAt: number;
}

const VIEWED_CHAPTERS_STORAGE_KEY = "manga_viewed_chapters";

/**
 * Builds the canonical lookup key for a chapter tied to its specific manga
 */
function makeLookupKey(mangaId: string, chapterId: string): string {
  const cleanManga = String(mangaId || "").replace(/^suwayomi_/, "").trim();
  const cleanChapter = String(chapterId || "").replace(/^suwayomi_/, "").trim();
  return `${cleanManga}::${cleanChapter}`;
}

function makeChapterNumberKey(mangaId: string, chapterNumber: string): string {
  const cleanManga = String(mangaId || "").replace(/^suwayomi_/, "").trim();
  const cleanNum = String(chapterNumber || "").trim();
  return `${cleanManga}::num::${cleanNum}`;
}

export function getViewedChaptersMap(): Record<string, ViewedChapterInfo> {
  try {
    const raw = localStorage.getItem(VIEWED_CHAPTERS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to load viewed chapters from localStorage", e);
    return {};
  }
}

export function isChapterViewed(mangaId: string, chapterId: string, chapterNumber?: string): boolean {
  if (!chapterId && !chapterNumber) return false;
  const map = getViewedChaptersMap();

  // 1. Direct match by mangaId + chapterId
  if (mangaId && chapterId) {
    const key = makeLookupKey(mangaId, chapterId);
    if (map[key]) return true;
  }

  // 2. Direct match by mangaId + chapterNumber
  if (mangaId && chapterNumber) {
    const numKey = makeChapterNumberKey(mangaId, chapterNumber);
    if (map[numKey]) return true;
  }

  // 3. Fallback by raw chapterId if mangaId is missing
  if (chapterId) {
    const cleanChapter = String(chapterId).replace(/^suwayomi_/, "").trim();
    if (map[`raw::${cleanChapter}`]) return true;
  }

  return false;
}

export function markChapterAsViewed(
  mangaId: string,
  chapterId: string,
  chapterNumber?: string,
  mangaTitle?: string
): void {
  try {
    const map = getViewedChaptersMap();
    const info: ViewedChapterInfo = {
      mangaId: String(mangaId || ""),
      chapterId: String(chapterId || ""),
      chapterNumber: chapterNumber ? String(chapterNumber) : undefined,
      mangaTitle,
      viewedAt: Date.now()
    };

    if (mangaId && chapterId) {
      map[makeLookupKey(mangaId, chapterId)] = info;
    }

    if (mangaId && chapterNumber) {
      map[makeChapterNumberKey(mangaId, chapterNumber)] = info;
    }

    if (chapterId) {
      const cleanChapter = String(chapterId).replace(/^suwayomi_/, "").trim();
      map[`raw::${cleanChapter}`] = info;
    }

    localStorage.setItem(VIEWED_CHAPTERS_STORAGE_KEY, JSON.stringify(map));

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("manga_chapter_viewed_update", {
          detail: { mangaId, chapterId, chapterNumber }
        })
      );
    }
  } catch (e) {
    console.error("Failed to mark chapter as viewed in localStorage", e);
  }
}
