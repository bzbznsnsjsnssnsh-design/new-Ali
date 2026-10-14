// Persistent Storage for Manhwa Video Projects
import { VideoProject } from "./types";

const DB_NAME = "manhwa_video_projects_db";
const STORE_NAME = "projects";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("by_manga", "mangaId", { unique: false });
          store.createIndex("by_chapter", "chapterId", { unique: false });
          store.createIndex("by_updated", "updatedAt", { unique: false });
        }
      };
    });
  }
  return dbPromise;
}

export async function saveVideoProject(project: VideoProject): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({
        ...project,
        updatedAt: Date.now()
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[Video Storage] Failed to save in IndexedDB, fallback to localStorage:", err);
    try {
      localStorage.setItem(`video_proj_${project.id}`, JSON.stringify(project));
    } catch {}
  }
}

export async function getVideoProject(projectId: string): Promise<VideoProject | null> {
  try {
    const db = await getDB();
    return await new Promise<VideoProject | null>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(projectId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    try {
      const raw = localStorage.getItem(`video_proj_${projectId}`);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }
}

export async function getVideoProjectForChapter(chapterId: string): Promise<VideoProject | null> {
  try {
    const db = await getDB();
    return await new Promise<VideoProject | null>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("by_chapter");
      const req = index.get(chapterId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getAllVideoProjects(): Promise<VideoProject[]> {
  try {
    const db = await getDB();
    return await new Promise<VideoProject[]>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteVideoProject(projectId: string): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(projectId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
  try {
    localStorage.removeItem(`video_proj_${projectId}`);
  } catch {}
}
