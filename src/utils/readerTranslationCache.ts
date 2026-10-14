// Persistent IndexedDB Cache for Reader OCR & Page Translations
import { OCRBlock } from "../types";

export interface CachedPageTranslation {
  key: string;
  chapterId: string | number;
  pageIndex: number;
  engine: string;
  provider: string;
  targetLang: string;
  sourceHash?: string;
  blocks: OCRBlock[];
  timestamp: number;
}

export function computeBlocksSourceHash(blocks?: OCRBlock[]): string {
  if (!blocks || blocks.length === 0) return "none";
  let str = "";
  for (let i = 0; i < blocks.length; i++) {
    const orig = (blocks[i].originalText || blocks[i].original_text || "").trim();
    str += `${blocks[i].id || i}:${orig};`;
  }
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export class ReaderTranslationCache {
  private static readonly DB_NAME = "ai_manga_reader_translations_v5";
  private static readonly STORE_NAME = "page_translations";
  private static readonly DB_VERSION = 5;
  private static dbPromise: Promise<IDBDatabase> | null = null;
  private static memoryCache = new Map<string, OCRBlock[]>();

  public static normalizeProvider(engineOrProvider: string): string {
    if (!engineOrProvider) return "google";
    const p = engineOrProvider.toLowerCase().trim();
    if (p === "gemini" || p === "gemini_cookies") return "gemini_cookies";
    if (p === "metaai" || p === "meta") return "metaai";
    if (p === "google") return "google";
    return p;
  }

  public static isValidCachedBlocks(blocks?: OCRBlock[]): boolean {
    if (!Array.isArray(blocks) || blocks.length === 0) return false;
    return blocks.some(b => {
      const trans = (b.translatedText || b.translated_text || "").trim();
      const orig = (b.originalText || b.original_text || "").trim();
      return trans.length > 0 && trans !== orig;
    });
  }

  private static getDB(): Promise<IDBDatabase> {
    if (typeof window === "undefined" || !window.indexedDB) {
      return Promise.reject(new Error("IndexedDB is not available"));
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            const store = db.createObjectStore(this.STORE_NAME, { keyPath: "key" });
            store.createIndex("chapterId", "chapterId", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  public static makeKey(
    chapterId: string | number,
    pageIndex: number,
    provider: string,
    targetLang: string,
    sourceHash?: string
  ): string {
    const norm = this.normalizeProvider(provider);
    const hashPart = sourceHash && sourceHash !== "none" ? `_h${sourceHash}` : "";
    return `${String(chapterId)}_p${pageIndex}_${norm}_${targetLang}${hashPart}`;
  }

  public static async savePageTranslation(
    chapterId: string | number,
    pageIndex: number,
    blocks: OCRBlock[],
    provider: string,
    targetLang: string
  ): Promise<void> {
    if (!blocks || blocks.length === 0) return;

    // Strict validation: Only persist if blocks have actual translated text
    const hasValidTranslation = blocks.some(b => {
      const orig = (b.originalText || b.original_text || "").trim();
      const trans = (b.translatedText || b.translated_text || "").trim();
      return trans.length > 0 && trans !== orig;
    });

    if (!hasValidTranslation && provider !== "ocr_only") {
      return;
    }

    const norm = this.normalizeProvider(provider);
    const chId = String(chapterId);
    const sourceHash = computeBlocksSourceHash(blocks);

    const hashedKey = this.makeKey(chId, pageIndex, norm, targetLang, sourceHash);
    const genericKey = this.makeKey(chId, pageIndex, norm, targetLang);

    this.memoryCache.set(hashedKey, blocks);
    this.memoryCache.set(genericKey, blocks);

    try {
      const db = await this.getDB();
      const tx = db.transaction(this.STORE_NAME, "readwrite");
      const store = tx.objectStore(this.STORE_NAME);
      const record: CachedPageTranslation = {
        key: hashedKey,
        chapterId: chId,
        pageIndex,
        engine: norm,
        provider: norm,
        targetLang,
        sourceHash,
        blocks,
        timestamp: Date.now()
      };
      await new Promise<void>((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn("[TranslationCache] Failed to persist page:", err);
    }
  }

  public static async getPageTranslation(
    chapterId: string | number,
    pageIndex: number,
    provider: string,
    targetLang: string,
    sourceBlocks?: OCRBlock[]
  ): Promise<OCRBlock[] | null> {
    const chId = String(chapterId);
    const norm = this.normalizeProvider(provider);
    const sourceHash = sourceBlocks && sourceBlocks.length > 0 ? computeBlocksSourceHash(sourceBlocks) : undefined;

    const hashedKey = this.makeKey(chId, pageIndex, norm, targetLang, sourceHash);
    const genericKey = this.makeKey(chId, pageIndex, norm, targetLang);

    if (sourceHash && this.memoryCache.has(hashedKey)) {
      return this.memoryCache.get(hashedKey)!;
    }
    if (!sourceHash && this.memoryCache.has(genericKey)) {
      return this.memoryCache.get(genericKey)!;
    }

    try {
      const db = await this.getDB();
      const tx = db.transaction(this.STORE_NAME, "readonly");
      const store = tx.objectStore(this.STORE_NAME);

      if (sourceHash) {
        const record = await new Promise<CachedPageTranslation | undefined>((resolve, reject) => {
          const req = store.get(hashedKey);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (
          record &&
          (record.provider === norm || record.engine === norm) &&
          record.targetLang === targetLang &&
          this.isValidCachedBlocks(record.blocks)
        ) {
          this.memoryCache.set(hashedKey, record.blocks);
          this.memoryCache.set(genericKey, record.blocks);
          return record.blocks;
        }
      }

      // Query store by chapter index to find matching provider and targetLang
      const records = await new Promise<CachedPageTranslation[]>((resolve, reject) => {
        const index = store.index("chapterId");
        const req = index.getAll(chId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      const match = records.find(r => 
        r.pageIndex === pageIndex &&
        (r.provider === norm || r.engine === norm) &&
        r.targetLang === targetLang &&
        (!sourceHash || !r.sourceHash || r.sourceHash === sourceHash) &&
        this.isValidCachedBlocks(r.blocks)
      );

      if (match && this.isValidCachedBlocks(match.blocks)) {
        this.memoryCache.set(genericKey, match.blocks);
        return match.blocks;
      }
    } catch (err) {
      console.warn("[TranslationCache] Failed to load page:", err);
    }
    return null;
  }

  public static async getChapterTranslations(
    chapterId: string | number,
    provider: string,
    targetLang: string
  ): Promise<Record<number, OCRBlock[]>> {
    const result: Record<number, OCRBlock[]> = {};
    const chId = String(chapterId);
    const norm = this.normalizeProvider(provider);

    try {
      const db = await this.getDB();
      const tx = db.transaction(this.STORE_NAME, "readonly");
      const store = tx.objectStore(this.STORE_NAME);

      const records = await new Promise<CachedPageTranslation[]>((resolve, reject) => {
        const index = store.index("chapterId");
        const req = index.getAll(chId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      for (const rec of records) {
        if (
          String(rec.chapterId) === chId &&
          (rec.provider === norm || rec.engine === norm) &&
          rec.targetLang === targetLang &&
          this.isValidCachedBlocks(rec.blocks)
        ) {
          result[rec.pageIndex] = rec.blocks;
          this.memoryCache.set(rec.key, rec.blocks);
        }
      }
    } catch (err) {
      console.warn("[TranslationCache] Failed to load chapter:", err);
    }
    return result;
  }

  public static async clearChapterTranslations(chapterId: string | number): Promise<void> {
    const chId = String(chapterId);
    const prefix = `${chId}_`;
    for (const key of Array.from(this.memoryCache.keys())) {
      if (key.startsWith(prefix) || key.startsWith(`${chapterId}_`)) {
        this.memoryCache.delete(key);
      }
    }
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(this.STORE_NAME, "readwrite");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.openCursor();
        req.onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            const val = cursor.value;
            if (
              String(val.chapterId) === chId ||
              String(val.chapterId) === String(chapterId) ||
              String(val.key).startsWith(prefix)
            ) {
              this.memoryCache.delete(val.key);
              cursor.delete();
            }
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (err) {
      console.warn("[TranslationCache] Failed to clear chapter:", err);
    }
  }

  public static async clearAll(): Promise<void> {
    this.memoryCache.clear();
    try {
      const db = await this.getDB();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(this.STORE_NAME, "readwrite");
        const store = tx.objectStore(this.STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (err) {
      console.warn("[TranslationCache] Failed to clear all:", err);
    }
  }
}
