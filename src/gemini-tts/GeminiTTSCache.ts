import type { GeminiTTSRequest, GeminiTTSResponse } from "./GeminiTTSTypes";

export class GeminiTTSCache {
  private static memoryCache: Map<string, GeminiTTSResponse> = new Map();
  private static dbPromise: Promise<IDBDatabase> | null = null;
  private static readonly DB_NAME = "ai_manga_gemini_tts_cache";
  private static readonly STORE_NAME = "audio_entries";

  private static getDB(): Promise<IDBDatabase> {
    if (typeof window === "undefined" || !window.indexedDB) {
      return Promise.reject(new Error("IndexedDB is not supported in this environment"));
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            db.createObjectStore(this.STORE_NAME, { keyPath: "cacheKey" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  /**
   * Generates a deterministic cache key including generationId + segmentId + voiceName + textHash
   */
  public static generateKey(request: GeminiTTSRequest): string {
    const text = (request.text || "").trim();
    const textHash = this.fastHash(text);
    const voice = (request.voiceName || "Achernar").replace(/^gemini-/, "").trim();
    const genId = request.generationId || "default";
    const segId = request.segmentId || "seg";
    const lang = request.languageCode || "ar-EG";
    const spd = Math.round((request.audioConfig?.speakingRate ?? 1.0) * 100);
    const dirHash = request.voiceDirection ? this.fastHash(request.voiceDirection.trim()) : "none";

    // Format: gmtts_gen_<generationId>_seg_<segmentId>_v_<voiceName>_th_<textHash>_...
    return `gmtts_gen_${genId}_seg_${segId}_v_${voice}_th_${textHash}_l_${lang}_s_${spd}_d_${dirHash}`;
  }

  private static fastHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36) + "_" + str.length;
  }

  /**
   * Retrieves an audio entry if present in memory or IndexedDB, enforcing strict voice match
   */
  public static async get(request: GeminiTTSRequest): Promise<GeminiTTSResponse | null> {
    const key = this.generateKey(request);
    const expectedVoice = (request.voiceName || "").replace(/^gemini-/, "").trim();

    // 1. Check memory cache
    if (this.memoryCache.has(key)) {
      const item = this.memoryCache.get(key)!;
      // Strict Voice Validation: ensure cached voice matches requested voice
      if (expectedVoice && item.voiceName && item.voiceName !== expectedVoice) {
        console.warn(`[GeminiTTSCache] Stale voice in memory: got ${item.voiceName}, expected ${expectedVoice}`);
        this.memoryCache.delete(key);
      } else {
        return { ...item, cached: true };
      }
    }

    // 2. Check IndexedDB
    try {
      const db = await this.getDB();
      return await new Promise<GeminiTTSResponse | null>((resolve) => {
        const tx = db.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result && req.result.response) {
            const res = req.result.response as GeminiTTSResponse;
            if (expectedVoice && res.voiceName && res.voiceName !== expectedVoice) {
              console.warn(`[GeminiTTSCache] Stale voice in IndexedDB: got ${res.voiceName}, expected ${expectedVoice}`);
              resolve(null);
            } else {
              this.memoryCache.set(key, res);
              resolve({ ...res, cached: true });
            }
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * Stores an audio entry in both memory and IndexedDB.
   * Strictly refuses to cache any fallback or mismatched audio.
   */
  public static async set(request: GeminiTTSRequest, response: GeminiTTSResponse): Promise<void> {
    if (response.fallbackUsed) {
      console.warn(`[GeminiTTSCache] Rejected caching fallback audio under requested voice "${request.voiceName}"`);
      return;
    }
    const key = this.generateKey(request);
    this.memoryCache.set(key, response);

    try {
      const db = await this.getDB();
      const tx = db.transaction(this.STORE_NAME, "readwrite");
      const store = tx.objectStore(this.STORE_NAME);
      store.put({
        cacheKey: key,
        response,
        timestamp: Date.now(),
      });
    } catch (_) {}
  }

  /**
   * Clears the entire audio cache
   */
  public static async clear(): Promise<void> {
    this.memoryCache.clear();
    try {
      const db = await this.getDB();
      const tx = db.transaction(this.STORE_NAME, "readwrite");
      tx.objectStore(this.STORE_NAME).clear();
    } catch (_) {}
  }
}
