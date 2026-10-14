export interface ChapterProgress {
  chapterId: string;
  mangaId?: string;
  currentPage: number;
  totalPages: number;
  percent: number;
  updatedAt: number;
}

const PROGRESS_STORAGE_KEY = "manga_reading_progress_v1";

export function getAllChapterProgress(): Record<string, ChapterProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function getChapterProgress(chapterId: string | number): ChapterProgress | null {
  if (!chapterId) return null;
  const all = getAllChapterProgress();
  return all[String(chapterId)] || null;
}

export function saveChapterProgress(
  chapterId: string | number,
  mangaId: string | undefined,
  currentPage: number,
  totalPages: number,
  percent: number
): void {
  if (!chapterId) return;
  try {
    const all = getAllChapterProgress();
    all[String(chapterId)] = {
      chapterId: String(chapterId),
      mangaId,
      currentPage: Math.max(1, currentPage),
      totalPages: Math.max(1, totalPages),
      percent: Math.min(100, Math.max(0, Math.round(percent))),
      updatedAt: Date.now(),
    };
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("Failed to save chapter progress:", e);
  }
}
