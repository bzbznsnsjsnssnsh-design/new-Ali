import { globalEngine } from "./mangaGlobalEngine";

export type EngineMode = 'suwayomi';

export interface MangaSource {
  id: string;
  name: string;
  language: string;
  type: string;
}

export interface Manga {
  id: string;
  title: string;
  coverUrl: string;
}

export interface MangaChapter {
  id: string;
  title: string;
  chapterNumber: string;
}

export interface MangaDetails extends Manga {
  description: string;
  author: string;
  status: string;
  chapters: MangaChapter[];
}

export class MangaMegaEngine {
  private static instance: MangaMegaEngine;

  private constructor() {}

  public static getInstance(): MangaMegaEngine {
    if (!MangaMegaEngine.instance) {
      MangaMegaEngine.instance = new MangaMegaEngine();
    }
    return MangaMegaEngine.instance;
  }

  public getMode(): EngineMode {
    return 'suwayomi';
  }

  public setMode(_mode: any) {
    globalEngine.setMode('suwayomi');
  }

  public getProxiedUrl(originalUrl: string): string {
    return globalEngine.getProxiedUrl(originalUrl);
  }

  public async fetchSources(): Promise<MangaSource[]> {
    const list = await globalEngine.fetchSources();
    return list.map(s => ({
      id: s.id,
      name: s.name,
      language: s.language || 'all',
      type: 'suwayomi'
    }));
  }

  public async searchManga(sourceId: string, query: string): Promise<Manga[]> {
    const results = await globalEngine.searchMangaInSource(sourceId, query);
    return results.map(m => ({
      id: m.id,
      title: m.title,
      coverUrl: m.coverUrl
    }));
  }

  public async fetchMangaDetails(sourceId: string, mangaId: string): Promise<MangaDetails | null> {
    const res = await globalEngine.fetchMangaDetails(sourceId, mangaId);
    if (!res) return null;
    return {
      id: res.details.id,
      title: res.details.title,
      coverUrl: res.details.coverUrl,
      description: res.details.description || '',
      author: res.details.author || '',
      status: res.details.status || '',
      chapters: (res.chapters || []).map(ch => ({
        id: ch.id,
        title: ch.title || `فصل ${ch.chapterNumber}`,
        chapterNumber: ch.chapterNumber
      }))
    };
  }

  public async fetchChapterPages(chapterId: string, mangaId?: string, options?: { mangaTitle?: string; chapterNumber?: string; language?: string }): Promise<string[]> {
    return await globalEngine.fetchChapterPages(chapterId, mangaId, options);
  }
}

export const mangaEngine = MangaMegaEngine.getInstance();
