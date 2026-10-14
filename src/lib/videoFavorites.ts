import { FavoriteManga, normalizeSourceId, normalizeTitle } from "./favorites";

const VIDEO_FAVORITES_STORAGE_KEY = "manga_video_favorites";

/**
 * Deduplicates video favorites based on normalized source + title/ID
 */
export function deduplicateVideoFavorites(list: FavoriteManga[]): FavoriteManga[] {
  const map = new Map<string, FavoriteManga>();
  for (const item of list) {
    if (!item || !item.id) continue;
    const normSource = normalizeSourceId(item.sourceId);
    const normTitle = normalizeTitle(item.title);
    const rawId = String(item.id).replace(/^suwayomi_/, "").trim();
    const key = normSource ? `${normSource}___${normTitle || rawId}` : (normTitle || rawId);
    const existing = map.get(key);
    if (!existing || (item.addedAt && item.addedAt >= (existing.addedAt || 0))) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

/**
 * Read current video favorites synchronously from localStorage (0ms instant load)
 */
export function getVideoFavorites(): FavoriteManga[] {
  try {
    const raw = localStorage.getItem(VIDEO_FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return deduplicateVideoFavorites(list);
  } catch (e) {
    console.warn("Failed to load video favorites from localStorage", e);
    return [];
  }
}

/**
 * Internal helper to save to localStorage and dispatch reactive event
 */
function persistLocalVideoFavorites(list: FavoriteManga[]): void {
  try {
    localStorage.setItem(VIDEO_FAVORITES_STORAGE_KEY, JSON.stringify(list));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("manga_video_favorites_updated", { detail: list }));
    }
  } catch (e) {
    console.error("Failed to save video favorite to localStorage", e);
  }
}

/**
 * Checks if a specific manga is in video favorites.
 */
export function isVideoFavorite(mangaId: string, title?: string, sourceId?: string): boolean {
  if (!mangaId && !title) return false;
  const list = getVideoFavorites();
  const targetRawId = mangaId ? String(mangaId).replace(/^suwayomi_/, "").trim() : "";
  const targetNormSource = normalizeSourceId(sourceId);
  const targetNormTitle = title ? normalizeTitle(title) : "";

  return list.some((m) => {
    if (!m) return false;
    const mRawId = m.id ? String(m.id).replace(/^suwayomi_/, "").trim() : "";
    const mNormSource = normalizeSourceId(m.sourceId);
    const mNormTitle = m.title ? normalizeTitle(m.title) : "";

    if (targetNormSource && mNormSource) {
      if (targetNormSource === mNormSource) {
        if (mangaId && (m.id === mangaId || (targetRawId !== "" && mRawId === targetRawId))) return true;
        if (targetNormTitle && mNormTitle && targetNormTitle === mNormTitle) return true;
      }
      return false;
    }

    if (mangaId && m.id === mangaId) return true;
    if (mangaId && targetRawId && mRawId === targetRawId) return true;
    if (targetNormTitle && mNormTitle && targetNormTitle === mNormTitle) return true;

    return false;
  });
}

/**
 * Adds or updates a manga in Video Favorites
 */
export function addVideoFavorite(manga: Omit<FavoriteManga, "addedAt"> & { addedAt?: number }): FavoriteManga[] {
  const list = getVideoFavorites();
  const targetRawId = String(manga.id).replace(/^suwayomi_/, "").trim();
  const targetNormSource = normalizeSourceId(manga.sourceId);
  const targetNormTitle = normalizeTitle(manga.title);

  const filtered = list.filter((m) => {
    if (!m) return false;
    const mRawId = String(m.id).replace(/^suwayomi_/, "").trim();
    const mNormSource = normalizeSourceId(m.sourceId);
    const mNormTitle = normalizeTitle(m.title);

    if (targetNormSource && mNormSource) {
      if (targetNormSource === mNormSource) {
        if (m.id === manga.id || (targetRawId !== "" && mRawId === targetRawId)) return false;
        if (targetNormTitle && mNormTitle && targetNormTitle === mNormTitle) return false;
      }
      return true;
    }

    if (m.id === manga.id) return false;
    if (targetRawId && mRawId === targetRawId) return false;
    if (targetNormTitle && mNormTitle && targetNormTitle === mNormTitle) return false;

    return true;
  });

  const updatedItem: FavoriteManga = {
    ...manga,
    addedAt: manga.addedAt || Date.now()
  };

  const nextList = [updatedItem, ...filtered];
  persistLocalVideoFavorites(nextList);
  return nextList;
}

/**
 * Removes a manga from Video Favorites
 */
export function removeVideoFavorite(mangaId: string, title?: string, sourceId?: string): FavoriteManga[] {
  const list = getVideoFavorites();
  const targetRawId = mangaId ? String(mangaId).replace(/^suwayomi_/, "").trim() : "";
  const targetNormSource = normalizeSourceId(sourceId);
  const targetNormTitle = title ? normalizeTitle(title) : "";

  const nextList = list.filter((m) => {
    if (!m) return false;
    const mRawId = m.id ? String(m.id).replace(/^suwayomi_/, "").trim() : "";
    const mNormSource = normalizeSourceId(m.sourceId);
    const mNormTitle = m.title ? normalizeTitle(m.title) : "";

    if (targetNormSource && mNormSource) {
      if (targetNormSource === mNormSource) {
        if (mangaId && (m.id === mangaId || (targetRawId !== "" && mRawId === targetRawId))) return false;
        if (targetNormTitle && mNormTitle && targetNormTitle === mNormTitle) return false;
      }
      return true;
    }

    if (mangaId && m.id === mangaId) return false;
    if (mangaId && targetRawId && mRawId === targetRawId) return false;
    if (targetNormTitle && mNormTitle && targetNormTitle === mNormTitle) return false;

    return true;
  });

  persistLocalVideoFavorites(nextList);
  return nextList;
}

/**
 * Remove by ID or Manga item
 */
export function removeVideoFavoriteItem(docIdOrManga: any): FavoriteManga[] {
  if (!docIdOrManga) return getVideoFavorites();
  if (typeof docIdOrManga === "string") {
    return removeVideoFavorite(docIdOrManga);
  } else {
    return removeVideoFavorite(docIdOrManga.id, docIdOrManga.title, docIdOrManga.sourceId);
  }
}

/**
 * Toggles a manga in/out of Video Favorites
 */
export function toggleVideoFavorite(manga: FavoriteManga | any): boolean {
  if (!manga) return false;
  const isFav = isVideoFavorite(manga.id, manga.title, manga.sourceId);
  if (isFav) {
    removeVideoFavorite(manga.id, manga.title, manga.sourceId);
    return false;
  } else {
    addVideoFavorite(manga);
    return true;
  }
}

/**
 * Clears all video favorites
 */
export function clearAllVideoFavorites(): void {
  persistLocalVideoFavorites([]);
}

/**
 * Exports video favorites as JSON
 */
export function exportVideoFavoritesJson(): string {
  const list = getVideoFavorites();
  return JSON.stringify(list, null, 2);
}

/**
 * Imports video favorites from JSON
 */
export function importVideoFavoritesJson(jsonStr: string): number {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) throw new Error("الملف لا يحتوي على قائمة صالحة");
    let count = 0;
    for (const item of parsed) {
      if (item && item.id && item.title) {
        addVideoFavorite(item);
        count++;
      }
    }
    return count;
  } catch (e: any) {
    throw new Error(e.message || "فشل قراءة ملف مفضلة الفيديو");
  }
}
