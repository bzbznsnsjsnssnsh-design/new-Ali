export type EngineMode = "suwayomi";

export interface GlobalSource {
  id: string;
  name: string;
  language?: string;
  iconUrl?: string;
}

export interface MangaChapter {
  id: string;
  title: string;
  chapterNumber: string;
}

export class MangaGlobalEngine {
  private mode: EngineMode = "suwayomi";

  public getMode(): EngineMode {
    return this.mode;
  }

  public setMode(mode: EngineMode): void {
    this.mode = mode;
  }

  public getProxiedUrl(originalUrl: string): string {
    if (!originalUrl) return "";
    if (originalUrl.startsWith("/api/") || originalUrl.startsWith("data:") || originalUrl.startsWith("blob:")) {
      return originalUrl;
    }
    return `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
  }

  public async fetchSources(): Promise<GlobalSource[]> {
    try {
      const res = await fetch("/api/suwayomi/sources");
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : data.sources || [];
    } catch {
      return [];
    }
  }

  public async searchMangaInSource(
    sourceId: string,
    query: string
  ): Promise<Array<{ id: string; title: string; coverUrl: string }>> {
    try {
      const res = await fetch(
        `/api/suwayomi/source/${encodeURIComponent(sourceId)}/search?q=${encodeURIComponent(query)}`
      );
      if (!res.ok) return [];
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.mangaList || data.results || [];
      return list.map((m: any) => ({
        id: String(m.id || ""),
        title: String(m.title || ""),
        coverUrl: String(m.thumbnailUrl || m.coverUrl || ""),
      }));
    } catch {
      return [];
    }
  }

  public async fetchMangaDetails(
    sourceId: string,
    mangaId: string
  ): Promise<{
    details: { id: string; title: string; coverUrl: string; description?: string; author?: string; status?: string };
    chapters: MangaChapter[];
  } | null> {
    try {
      const res = await fetch(
        `/api/suwayomi/manga/${encodeURIComponent(mangaId)}?sourceId=${encodeURIComponent(sourceId)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return {
        details: {
          id: String(data.id || mangaId),
          title: String(data.title || ""),
          coverUrl: String(data.thumbnailUrl || data.coverUrl || ""),
          description: data.description || "",
          author: data.author || "",
          status: data.status || "",
        },
        chapters: Array.isArray(data.chapters)
          ? data.chapters.map((ch: any) => ({
              id: String(ch.id || ""),
              title: String(ch.name || ch.title || ""),
              chapterNumber: String(ch.chapterNumber ?? ch.chapter ?? ""),
            }))
          : [],
      };
    } catch {
      return null;
    }
  }

  public async fetchChapterPages(
    chapterId: string,
    sourceOrMangaId?: string,
    options?: { mangaTitle?: string; chapterNumber?: string; language?: string }
  ): Promise<string[]> {
    try {
      const cleanChapterId = String(chapterId).replace(/^suwayomi_/, "");
      const params = new URLSearchParams();
      if (sourceOrMangaId) {
        params.set("sourceId", sourceOrMangaId);
        params.set("provider", sourceOrMangaId);
      }
      if (options?.mangaTitle) params.set("mangaTitle", options.mangaTitle);
      if (options?.chapterNumber) params.set("chapterNumber", options.chapterNumber);
      if (options?.language) params.set("lang", options.language);
      const qs = params.toString() ? `?${params.toString()}` : "";

      const suwRes = await fetch(`/api/suwayomi/chapter/${encodeURIComponent(cleanChapterId)}/pages${qs}`);
      if (suwRes.ok) {
        const suwData = await suwRes.json();
        const suwPages = Array.isArray(suwData) ? suwData : suwData.pages || suwData.pageUrls || [];
        if (Array.isArray(suwPages) && suwPages.length > 0) {
          return suwPages;
        }
      }

      const fallbackRes = await fetch(`/api/manga/chapter-pages/${encodeURIComponent(chapterId)}${qs}`);
      if (!fallbackRes.ok) return [];
      const data = await fallbackRes.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.pages)) return data.pages;
      if (Array.isArray(data.pageUrls)) return data.pageUrls;
      return [];
    } catch {
      return [];
    }
  }
}

export const globalEngine = new MangaGlobalEngine();
