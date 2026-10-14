// Persistent IndexedDB Cache for Reader TTS Speech Bubbles with Stable Identity & Strict Validation
export function computeStableTextHash(text: string): string {
  const normalized = (text || "").trim().toLowerCase().replace(/\s+/g, " ");
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h) ^ normalized.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export interface CachedAudioRecord {
  key: string;
  chapterId: string;
  generationId?: string;
  pageIndex: number;
  blockId: string;
  region_id?: string;
  region_ids?: string[];
  speech_unit_id?: string;
  fullText: string;
  normalizedText: string;
  textHash: string;
  voiceGroup: string;
  voiceName: string;
  playbackSpeed?: number;
  audioData: string;
  timestamp: number;
}

export interface CacheValidationOptions {
  expectedBlockId?: string | number;
  expectedRegionId?: string;
  expectedSpeechUnitId?: string;
  expectedText?: string;
  expectedVoice?: string;
  expectedGenerationId?: string;
}

export class ReaderAudioCache {
  private static readonly DB_NAME = "ai_manga_reader_tts_cache";
  private static readonly STORE_NAME = "bubble_audio_v2";
  private static readonly DB_VERSION = 2;
  private static dbPromise: Promise<IDBDatabase> | null = null;
  private static memoryCache: Map<string, CachedAudioRecord> = new Map();

  private static getDB(): Promise<IDBDatabase> {
    if (typeof window === "undefined" || !window.indexedDB) {
      return Promise.reject(new Error("IndexedDB is not available"));
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
        req.onupgradeneeded = (event) => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            const store = db.createObjectStore(this.STORE_NAME, { keyPath: "key" });
            store.createIndex("chapterId", "chapterId", { unique: false });
            store.createIndex("blockId", "blockId", { unique: false });
            store.createIndex("textHash", "textHash", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  /**
   * Generates a stable key based on chapter, page, block identifier (segmentId), text content hash, voice, and optional generationId.
   * Structure: chapterId_p<page>_blk_<segmentId>_h_<textHash>_<voiceGroup>_<voiceName>_gen_<genId>
   */
  public static makeKey(
    chapterId: string | number,
    pageIndex: number,
    blockIdentifier: string | number,
    voiceGroup: string,
    voiceName: string,
    text?: string,
    playbackSpeed?: number,
    generationId?: string
  ): string {
    const cleanBlockId = String(blockIdentifier || "blk").replace(/[^a-zA-Z0-9_-]/g, "_");
    const textHash = text ? computeStableTextHash(text) : "raw";
    const cleanVoice = (voiceName || "default").replace(/^gemini-/, "").trim();
    const genPart = generationId ? `_gen_${generationId.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
    const spd = playbackSpeed && playbackSpeed !== 1.0 ? `_s${Math.round(playbackSpeed * 100)}` : "";
    return `${chapterId}_p${pageIndex}_blk_${cleanBlockId}_h_${textHash}_${voiceGroup}_${cleanVoice}${genPart}${spd}`;
  }

  /**
   * Fetches cached audio with strict validation:
   * - Confirms blockId matches clicked element
   * - Confirms text content hash matches exactly
   * - Confirms voice matches active selection strictly
   */
  public static async get(
    key: string,
    validation?: CacheValidationOptions
  ): Promise<string | null> {
    // 1. Fast memory check
    if (this.memoryCache.has(key)) {
      const record = this.memoryCache.get(key)!;
      if (this.validateRecord(record, validation)) {
        return record.audioData;
      } else {
        console.warn(`[ReaderAudioCache] Memory cache validation failed for key: ${key}`);
        this.memoryCache.delete(key);
        return null;
      }
    }

    // 2. IndexedDB check
    try {
      const db = await this.getDB();
      return await new Promise<string | null>((resolve) => {
        const tx = db.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          const record = req.result as CachedAudioRecord | undefined;
          if (record && record.audioData) {
            if (this.validateRecord(record, validation)) {
              this.memoryCache.set(key, record);
              resolve(record.audioData);
            } else {
              console.warn(`[ReaderAudioCache] IndexedDB validation failed for key: ${key}`);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /**
   * Fetches full cached audio record with strict region_id and speech_unit_id validation.
   */
  public static async getRecord(
    key: string,
    validation?: CacheValidationOptions
  ): Promise<CachedAudioRecord | null> {
    // 1. Fast memory check
    if (this.memoryCache.has(key)) {
      const record = this.memoryCache.get(key)!;
      if (this.validateRecord(record, validation)) {
        return record;
      } else {
        return null;
      }
    }

    // 2. IndexedDB check
    try {
      const db = await this.getDB();
      return await new Promise<CachedAudioRecord | null>((resolve) => {
        const tx = db.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          const record = req.result as CachedAudioRecord | undefined;
          if (record && record.audioData) {
            if (this.validateRecord(record, validation)) {
              this.memoryCache.set(key, record);
              resolve(record);
            } else {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  private static validateRecord(
    record: CachedAudioRecord,
    validation?: CacheValidationOptions
  ): boolean {
    if (!validation) return true;

    // Strict Region ID check: ensure audio matches the clicked region_id or constituent speech unit
    if (validation.expectedRegionId !== undefined && validation.expectedRegionId.trim()) {
      const expRegId = String(validation.expectedRegionId).trim();
      const matchesRegion = 
        record.region_id === expRegId ||
        record.blockId === expRegId ||
        (Array.isArray(record.region_ids) && record.region_ids.includes(expRegId));

      const matchesSpeechUnit = Boolean(
        validation.expectedSpeechUnitId &&
        (record.speech_unit_id === validation.expectedSpeechUnitId || record.blockId === validation.expectedSpeechUnitId)
      );

      if (!matchesRegion && !matchesSpeechUnit) {
        console.warn(`[ReaderAudioCache] Region mismatch: cached region="${record.region_id || record.blockId}" vs clicked "${expRegId}"`);
        return false;
      }
    }

    // Strict Speech Unit check if explicitly requested
    if (validation.expectedSpeechUnitId !== undefined && validation.expectedSpeechUnitId.trim()) {
      const expUnitId = String(validation.expectedSpeechUnitId).trim();
      if (record.speech_unit_id && record.speech_unit_id !== expUnitId && record.blockId !== expUnitId) {
        return false;
      }
    }

    // Validate block identifier if provided
    if (validation.expectedBlockId !== undefined) {
      const expectedId = String(validation.expectedBlockId);
      if (record.blockId && record.blockId !== expectedId) {
        console.warn(`[ReaderAudioCache] Block ID mismatch: cached "${record.blockId}" vs clicked "${expectedId}"`);
        return false;
      }
    }

    // Validate text content if provided
    if (validation.expectedText !== undefined && validation.expectedText.trim()) {
      const expectedHash = computeStableTextHash(validation.expectedText);
      if (record.textHash && record.textHash !== expectedHash) {
        console.warn(`[ReaderAudioCache] Text hash mismatch: cached "${record.textHash}" vs requested "${expectedHash}"`);
        return false;
      }
    }

    // Strict Voice Lock check: ensure cached voice matches requested voice
    if (validation.expectedVoice && record.voiceName) {
      const normExpected = validation.expectedVoice.replace(/^gemini-/, "").trim().toLowerCase();
      const normCached = record.voiceName.replace(/^gemini-/, "").trim().toLowerCase();
      if (normCached !== normExpected && normExpected !== "google demo" && normExpected !== "achernar") {
        console.warn(`[ReaderAudioCache] Voice lock mismatch: cached "${record.voiceName}" vs requested "${validation.expectedVoice}"`);
        return false;
      }
    }

    // Validate generationId if provided
    if (validation.expectedGenerationId && record.generationId) {
      if (record.generationId !== validation.expectedGenerationId) {
        return false;
      }
    }

    return true;
  }

  public static async set(
    key: string,
    chapterId: string | number,
    audioData: string,
    meta?: {
      generationId?: string;
      pageIndex?: number;
      blockId?: string | number;
      region_id?: string;
      region_ids?: string[];
      speech_unit_id?: string;
      text?: string;
      voiceGroup?: string;
      voiceName?: string;
      playbackSpeed?: number;
      fallbackUsed?: boolean;
    }
  ): Promise<void> {
    // Strictly forbid caching fallback audio
    if (meta?.fallbackUsed) {
      console.warn(`[ReaderAudioCache] Refusing to cache fallback audio under voice "${meta?.voiceName}"`);
      return;
    }

    const fullText = meta?.text || "";
    const cleanVoice = (meta?.voiceName || "").replace(/^gemini-/, "").trim();

    const record: CachedAudioRecord = {
      key,
      chapterId: String(chapterId),
      generationId: meta?.generationId,
      pageIndex: meta?.pageIndex ?? 0,
      blockId: String(meta?.blockId || meta?.region_id || ""),
      region_id: meta?.region_id ? String(meta.region_id) : undefined,
      region_ids: meta?.region_ids,
      speech_unit_id: meta?.speech_unit_id ? String(meta.speech_unit_id) : undefined,
      fullText,
      normalizedText: fullText.trim().toLowerCase().replace(/\s+/g, " "),
      textHash: computeStableTextHash(fullText),
      voiceGroup: meta?.voiceGroup || "",
      voiceName: cleanVoice,
      playbackSpeed: meta?.playbackSpeed ?? 1.0,
      audioData,
      timestamp: Date.now(),
    };

    this.memoryCache.set(key, record);

    try {
      const db = await this.getDB();
      const tx = db.transaction(this.STORE_NAME, "readwrite");
      const store = tx.objectStore(this.STORE_NAME);
      store.put(record);
    } catch (err) {
      console.warn("[ReaderAudioCache] Failed to persist audio to IndexedDB:", err);
    }
  }

  /**
   * Persists audio under primary key and creates alias records for constituent region IDs
   * ensuring instant 0ms cache hits whether looked up by speech_unit_id or individual region_id.
   */
  public static async setWithAliases(
    primaryKey: string,
    aliasKeys: string[],
    chapterId: string | number,
    audioData: string,
    meta?: {
      generationId?: string;
      pageIndex?: number;
      blockId?: string | number;
      region_id?: string;
      region_ids?: string[];
      speech_unit_id?: string;
      text?: string;
      voiceGroup?: string;
      voiceName?: string;
      playbackSpeed?: number;
      fallbackUsed?: boolean;
    }
  ): Promise<void> {
    await this.set(primaryKey, chapterId, audioData, meta);
    for (const aKey of aliasKeys) {
      if (aKey && aKey !== primaryKey) {
        await this.set(aKey, chapterId, audioData, meta).catch(() => {});
      }
    }
  }

  public static async getAllForChapter(chapterId: string | number): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    const chId = String(chapterId);

    try {
      const db = await this.getDB();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        const index = store.index("chapterId");
        const req = index.getAll(chId);

        req.onsuccess = () => {
          const list = (req.result as CachedAudioRecord[]) || [];
          for (const item of list) {
            if (item.key && item.audioData) {
              this.memoryCache.set(item.key, item);
              results[item.key] = item.audioData;
            }
          }
          resolve();
        };
        req.onerror = () => resolve();
      });
    } catch {
      // ignore
    }

    return results;
  }

  public static async clearForChapter(chapterId: string | number): Promise<void> {
    const chId = String(chapterId);
    for (const [k, v] of this.memoryCache.entries()) {
      if (String(v.chapterId) === chId) {
        this.memoryCache.delete(k);
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
            if (String(cursor.value.chapterId) === chId) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // ignore
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
    } catch {
      // ignore
    }
  }
}
