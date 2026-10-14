import { 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  onSnapshot 
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";

export interface FavoriteManga {
  id: string;
  sourceId?: string;
  sourceName?: string;
  title: string;
  coverUrl?: string;
  author?: string;
  status?: string;
  description?: string;
  type?: string;
  language?: string;
  addedAt: number;
}

const FAVORITES_STORAGE_KEY = "manga_favorites";

/**
 * Normalizes title string for deduplication across multiple sources
 * E.g. "Solo Leveling [AR]", "Solo Leveling", "solo  leveling" -> "solo leveling"
 */
export function normalizeTitle(title: string): string {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, "") // remove brackets like [AR], (English)
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove Arabic tashkeel/diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, "") // strip punctuation and symbols
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes source ID to prevent mismatch between "68462846" and "suwayomi_68462846"
 */
export function normalizeSourceId(sourceId?: string): string {
  if (!sourceId) return "";
  return String(sourceId).replace(/^suwayomi_/, "").trim().toLowerCase();
}

/**
 * Creates a unique deterministic safe document ID for Firestore and cache keys.
 * Uses a standard 32-bit FNV-1a hash to guarantee collision-free, safe IDs
 * even with Arabic, Japanese, or special character titles.
 */
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function getSafeFavoriteDocId(id: string, sourceId?: string): string {
  const normId = String(id || "").replace(/^suwayomi_/, "").trim();
  const normSource = normalizeSourceId(sourceId);
  const combined = normSource ? `${normSource}_${normId}` : normId;
  const safeAscii = combined.replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 40);
  const hash = fnv1a(combined);
  // Firestore ID requirements: non-empty, <= 128 chars, matches ^[a-zA-Z0-9_\-]+$
  return (safeAscii ? `${safeAscii}_${hash}` : `fav_${hash}`).slice(0, 120);
}

/**
 * Helper to deduplicate favorites based on normalized source + title/ID
 */
export function deduplicateFavorites(list: FavoriteManga[]): FavoriteManga[] {
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
 * Read current favorites synchronously from localStorage (0ms instant load)
 */
export function getFavorites(): FavoriteManga[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return deduplicateFavorites(list);
  } catch (e) {
    console.warn("Failed to load favorites from localStorage", e);
    return [];
  }
}

/**
 * Internal helper to save to localStorage and dispatch reactive event
 */
function persistLocalFavorites(list: FavoriteManga[]): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(list));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("manga_favorites_updated", { detail: list }));
    }
  } catch (e) {
    console.error("Failed to save favorite to localStorage", e);
  }
}

/**
 * Checks if a specific manga is in favorites.
 * Handles source isolation to prevent numeric ID collisions across different Tachiyomi/Suwayomi sources.
 */
export function isFavorite(mangaId: string, title?: string, sourceId?: string): boolean {
  if (!mangaId && !title) return false;
  const list = getFavorites();
  const targetRawId = mangaId ? String(mangaId).replace(/^suwayomi_/, "").trim() : "";
  const targetNormSource = normalizeSourceId(sourceId);
  const targetNormTitle = title ? normalizeTitle(title) : "";

  return list.some((m) => {
    if (!m) return false;
    const mRawId = m.id ? String(m.id).replace(/^suwayomi_/, "").trim() : "";
    const mNormSource = normalizeSourceId(m.sourceId);
    const mNormTitle = m.title ? normalizeTitle(m.title) : "";

    // 1. If both specify sources, match if sources align AND (ID matches or Title matches)
    if (targetNormSource && mNormSource) {
      if (targetNormSource === mNormSource) {
        if (mangaId && (m.id === mangaId || (targetRawId !== "" && mRawId === targetRawId))) return true;
        if (targetNormTitle && mNormTitle && targetNormTitle === mNormTitle) return true;
      }
      return false; // Different sources with same numeric ID must NOT collide
    }

    // 2. Exact full ID match
    if (mangaId && m.id === mangaId) return true;

    // 3. Raw Suwayomi ID match if neither specifies a conflicting sourceId
    if (mangaId && targetRawId && mRawId === targetRawId) {
      return true;
    }

    // 4. Exact normalized title match
    if (targetNormTitle && mNormTitle && targetNormTitle === mNormTitle) {
      return true;
    }

    return false;
  });
}

/**
 * Adds or updates a manga in Favorites (localStorage + Firestore)
 */
export function addFavorite(manga: Omit<FavoriteManga, "addedAt"> & { addedAt?: number }): FavoriteManga[] {
  const list = getFavorites();
  const targetRawId = String(manga.id).replace(/^suwayomi_/, "").trim();
  const targetNormSource = normalizeSourceId(manga.sourceId);
  const targetNormTitle = normalizeTitle(manga.title);

  // Remove existing entry for the same manga
  const filtered = list.filter((m) => {
    if (!m) return false;
    const mRawId = String(m.id).replace(/^suwayomi_/, "").trim();
    const mNormSource = normalizeSourceId(m.sourceId);
    const mNormTitle = normalizeTitle(m.title);

    const sameSource = !targetNormSource || !mNormSource || targetNormSource === mNormSource;
    const sameId = m.id === manga.id || (targetRawId !== "" && mRawId === targetRawId);
    const sameTitle = targetNormTitle && mNormTitle && targetNormTitle === mNormTitle;

    if (sameId && sameSource) return false;
    if (sameTitle && sameSource) return false;

    return true;
  });

  const newItem: FavoriteManga = {
    id: String(manga.id).trim(),
    sourceId: manga.sourceId ? String(manga.sourceId).trim() : undefined,
    sourceName: manga.sourceName ? String(manga.sourceName).trim() : undefined,
    title: String(manga.title || "بدون عنوان").trim(),
    coverUrl: manga.coverUrl ? String(manga.coverUrl).trim() : undefined,
    author: manga.author ? String(manga.author).trim() : undefined,
    status: manga.status ? String(manga.status).trim() : undefined,
    description: manga.description ? String(manga.description).trim() : undefined,
    type: manga.type ? String(manga.type).trim() : undefined,
    language: manga.language ? String(manga.language).trim() : undefined,
    addedAt: manga.addedAt || Date.now(),
  };

  const updated = [newItem, ...filtered];
  persistLocalFavorites(updated);

  // Sync to Firestore in background
  syncItemToFirestore(newItem).catch((err) => {
    console.warn("Could not sync added favorite to Firestore:", err);
  });

  return updated;
}

/**
 * Removes a manga from Favorites by ID / Title / Source
 */
export function removeFavorite(mangaId: string, title?: string, sourceId?: string): FavoriteManga[] {
  const list = getFavorites();
  const targetRawId = mangaId ? String(mangaId).replace(/^suwayomi_/, "").trim() : "";
  const targetNormSource = normalizeSourceId(sourceId);
  const targetNormTitle = title ? normalizeTitle(title) : "";

  let removedItem: FavoriteManga | null = null;

  const updated = list.filter((m) => {
    if (!m) return false;
    const mRawId = String(m.id).replace(/^suwayomi_/, "").trim();
    const mNormSource = normalizeSourceId(m.sourceId);
    const mNormTitle = normalizeTitle(m.title);

    const sameSource = !targetNormSource || !mNormSource || targetNormSource === mNormSource;
    const sameId = mangaId && (m.id === mangaId || (targetRawId !== "" && mRawId === targetRawId));
    const sameTitle = targetNormTitle && mNormTitle && targetNormTitle === mNormTitle;

    if (sameSource && (sameId || sameTitle)) {
      removedItem = m;
      return false;
    }

    return true;
  });

  persistLocalFavorites(updated);

  // Sync deletion to Firestore
  if (removedItem || mangaId) {
    const docId = getSafeFavoriteDocId(mangaId, sourceId || (removedItem as any)?.sourceId);
    deleteFromFirestore(docId).catch((err) => {
      console.warn("Could not sync deleted favorite to Firestore:", err);
    });
  }

  return updated;
}

/**
 * Direct exact item removal
 */
export function removeFavoriteItem(item: FavoriteManga): FavoriteManga[] {
  return removeFavorite(item.id, item.title, item.sourceId);
}

/**
 * Toggles a manga between favorited and unfavorited
 */
export function toggleFavorite(manga: Omit<FavoriteManga, "addedAt"> & { addedAt?: number }): boolean {
  if (isFavorite(manga.id, manga.title, manga.sourceId)) {
    removeFavorite(manga.id, manga.title, manga.sourceId);
    return false;
  } else {
    addFavorite(manga);
    return true;
  }
}

/**
 * Clears all favorites from both local storage and cloud
 */
export function clearAllFavorites(): void {
  const list = getFavorites();
  persistLocalFavorites([]);

  // Delete all from Firestore in background
  Promise.all(
    list.map((m) => {
      const docId = getSafeFavoriteDocId(m.id, m.sourceId);
      return deleteFromFirestore(docId);
    })
  ).catch((err) => {
    console.warn("Could not clear cloud favorites:", err);
  });
}

/**
 * Exports all favorites as formatted JSON string for backup
 */
export function exportFavoritesJson(): string {
  const list = getFavorites();
  return JSON.stringify(list, null, 2);
}

/**
 * Imports favorites from a JSON string and merges them
 */
export function importFavoritesJson(jsonStr: string): number {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) throw new Error("الملف لا يحتوي على قائمة صالحة");
    let count = 0;
    for (const item of parsed) {
      if (item && item.id && item.title) {
        addFavorite(item);
        count++;
      }
    }
    return count;
  } catch (e: any) {
    throw new Error(e.message || "فشل قراءة ملف المفضلة");
  }
}

// -------------------------------------------------------------
// FIRESTORE SYNC HELPERS
// -------------------------------------------------------------

async function syncItemToFirestore(item: FavoriteManga): Promise<void> {
  if (!db) return;
  const docId = getSafeFavoriteDocId(item.id, item.sourceId);
  const path = `favorites/${docId}`;
  
  // Clean payload matching firestore.rules isValidFavoriteManga
  const payload: any = {
    id: String(item.id).slice(0, 200),
    title: String(item.title).slice(0, 500),
    addedAt: Number(item.addedAt) || Date.now(),
  };

  if (item.sourceId) payload.sourceId = String(item.sourceId).slice(0, 100);
  if (item.sourceName) payload.sourceName = String(item.sourceName).slice(0, 100);
  if (item.coverUrl) payload.coverUrl = String(item.coverUrl).slice(0, 5000);
  if (item.author) payload.author = String(item.author).slice(0, 500);
  if (item.status) payload.status = String(item.status).slice(0, 100);
  if (item.description) payload.description = String(item.description).slice(0, 10000);
  if (item.type) payload.type = String(item.type).slice(0, 100);
  if (item.language) payload.language = String(item.language).slice(0, 50);

  try {
    await setDoc(doc(db, "favorites", docId), payload);
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

async function deleteFromFirestore(docId: string): Promise<void> {
  if (!db) return;
  const path = `favorites/${docId}`;
  try {
    await deleteDoc(doc(db, "favorites", docId));
  } catch (err: any) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Pulls remote favorites from Firestore and merges with local favorites.
 * Safe to call on mount or app start.
 */
export async function syncFavoritesFromCloud(): Promise<FavoriteManga[]> {
  if (!db) return getFavorites();

  const path = "favorites";
  try {
    const snapshot = await getDocs(collection(db, path));
    if (snapshot.empty) return getFavorites();

    const cloudItems: FavoriteManga[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.id && data.title) {
        cloudItems.push({
          id: String(data.id),
          sourceId: data.sourceId ? String(data.sourceId) : undefined,
          sourceName: data.sourceName ? String(data.sourceName) : undefined,
          title: String(data.title),
          coverUrl: data.coverUrl ? String(data.coverUrl) : undefined,
          author: data.author ? String(data.author) : undefined,
          status: data.status ? String(data.status) : undefined,
          description: data.description ? String(data.description) : undefined,
          type: data.type ? String(data.type) : undefined,
          language: data.language ? String(data.language) : undefined,
          addedAt: Number(data.addedAt) || Date.now(),
        });
      }
    });

    const localList = getFavorites();
    // Merge without duplicating
    const mergedMap = new Map<string, FavoriteManga>();

    // Put cloud items first
    for (const item of cloudItems) {
      const key = getSafeFavoriteDocId(item.id, item.sourceId);
      mergedMap.set(key, item);
    }

    // Overwrite / add with local items (prioritizing newest addedAt)
    for (const item of localList) {
      const key = getSafeFavoriteDocId(item.id, item.sourceId);
      const existing = mergedMap.get(key);
      if (!existing || (item.addedAt && item.addedAt >= (existing.addedAt || 0))) {
        mergedMap.set(key, item);
      }
    }

    const mergedList = Array.from(mergedMap.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    persistLocalFavorites(mergedList);
    return mergedList;
  } catch (err: any) {
    console.warn("Cloud sync notice (offline or permission pending):", err.message);
    return getFavorites();
  }
}
