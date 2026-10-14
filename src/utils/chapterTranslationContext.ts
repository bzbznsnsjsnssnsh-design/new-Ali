import { OCRBlock } from "../types";

export interface ChapterContextInit {
  chapterId: string | number;
  mangaId: string | number;
  mangaTitle: string;
  workType: string;
  provider?: string;
  targetLang?: string;
  model?: string;
  sessionId?: string;
}

export interface TranslationBatchItem {
  pageIndex: number;
  blockIndex: number;
  regionId: string;
  sourceText: string;
  textType: string;
}

export interface TranslationBatch {
  batchId: string;
  pageIndices: number[];
  items: TranslationBatchItem[];
}

export class ChapterTranslationContext {
  public chapterId: string;
  public mangaId: string;
  public mangaTitle: string;
  public workType: string;
  public provider: string;
  public targetLang: string;
  public model: string;
  public sessionId: string;
  public isActive: boolean = true;
  private pageBlocksMap: Map<number, OCRBlock[]> = new Map();

  constructor(init: ChapterContextInit) {
    this.chapterId = String(init.chapterId);
    this.mangaId = String(init.mangaId);
    this.mangaTitle = init.mangaTitle || "";
    this.workType = init.workType || "مانهوا كورية";
    this.provider = init.provider || "gemini_cookies";
    this.targetLang = init.targetLang || "ar";
    this.model = init.model || "3.6-flash";
    this.sessionId =
      init.sessionId ||
      `sess_${this.chapterId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  public deactivate(): void {
    this.isActive = false;
  }

  public setPageBlocks(pageIdx: number, blocks: OCRBlock[]): void {
    this.pageBlocksMap.set(pageIdx, blocks);
  }

  public getPageBlocks(pageIdx: number): OCRBlock[] | undefined {
    return this.pageBlocksMap.get(pageIdx);
  }

  public getUntranslatedItems(pageIndices: number[]): TranslationBatchItem[] {
    const items: TranslationBatchItem[] = [];
    for (const pIdx of pageIndices) {
      const blocks = this.pageBlocksMap.get(pIdx) || [];
      blocks.forEach((b, bIdx) => {
        const src = (b.original || (b as any).source_text || "").trim();
        const trans = (b.translated || (b as any).translatedText || (b as any).translated_text || "").trim();
        if (src && !trans) {
          const regionId = b.region_id || b.id || `p${pIdx}_reg_${bIdx + 1}`;
          b.region_id = regionId;
          b.id = regionId;
          items.push({
            pageIndex: pIdx,
            blockIndex: bIdx,
            regionId,
            sourceText: src,
            textType: b.text_type || "dialogue",
          });
        }
      });
    }
    return items;
  }

  public createBatch(items: TranslationBatchItem[], pageIndices: number[]): TranslationBatch {
    return {
      batchId: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      pageIndices,
      items,
    };
  }
}

export class ChapterContextManager {
  private static contexts: Map<string, ChapterTranslationContext> = new Map();
  private static activeChapterId: string | null = null;

  public static getContext(chapterId: string | number): ChapterTranslationContext | undefined {
    return this.contexts.get(String(chapterId));
  }

  public static getOrCreateContext(init: ChapterContextInit): ChapterTranslationContext {
    const key = String(init.chapterId);
    let ctx = this.contexts.get(key);
    if (!ctx) {
      ctx = new ChapterTranslationContext(init);
      this.contexts.set(key, ctx);
    } else {
      ctx.isActive = true;
      if (init.provider) ctx.provider = init.provider;
      if (init.targetLang) ctx.targetLang = init.targetLang;
      if (init.model) ctx.model = init.model;
    }
    this.activeChapterId = key;
    return ctx;
  }

  public static switchActiveChapter(init: ChapterContextInit): ChapterTranslationContext {
    for (const [k, c] of this.contexts.entries()) {
      if (k !== String(init.chapterId)) c.deactivate();
    }
    return this.getOrCreateContext(init);
  }

  public static createFreshContext(init: ChapterContextInit): ChapterTranslationContext {
    const key = String(init.chapterId);
    const old = this.contexts.get(key);
    if (old) old.deactivate();
    const fresh = new ChapterTranslationContext(init);
    this.contexts.set(key, fresh);
    this.activeChapterId = key;
    return fresh;
  }

  public static isChapterActive(chapterId: string | number): boolean {
    const key = String(chapterId);
    const ctx = this.contexts.get(key);
    return Boolean(ctx && ctx.isActive && this.activeChapterId === key);
  }
}

export async function executeTranslationBatch(
  ctx: ChapterTranslationContext,
  batch: TranslationBatch
): Promise<void> {
  if (!batch.items.length || !ctx.isActive) return;

  const endpoint =
    ctx.provider === "gemini" || ctx.provider === "gemini_cookies"
      ? "/api/manga/translate-gemini"
      : ctx.provider === "metaai"
      ? "/api/manga/translate-metaai"
      : "/api/manga/translate-google";

  const payload = {
    texts: batch.items.map((i) => i.sourceText),
    blockIds: batch.items.map((i) => i.regionId),
    items: batch.items.map((i, idx) => ({
      region_id: i.regionId,
      source_text: i.sourceText,
      reading_order: idx + 1,
      text_type: i.textType,
    })),
    targetLanguage: ctx.targetLang,
    mangaContext: ctx.mangaTitle,
    workName: ctx.mangaTitle,
    workType: ctx.workType,
    chapterId: ctx.chapterId,
    sessionId: ctx.sessionId,
    provider: ctx.provider,
    model: ctx.model,
    cookies:
      ctx.provider === "gemini" || ctx.provider === "gemini_cookies"
        ? localStorage.getItem("gemini_cookies") || ""
        : undefined,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Translation batch failed (${res.status})`);
  }

  const data = await res.json();
  const translations: string[] = data.translations || [];
  const translationMap: Record<string, string> = data.translationMap || {};

  batch.items.forEach((item, idx) => {
    const translated =
      translationMap[item.regionId] ||
      translationMap[String(idx + 1)] ||
      translations[idx] ||
      item.sourceText;
    const pageBlocks = ctx.getPageBlocks(item.pageIndex);
    if (pageBlocks && pageBlocks[item.blockIndex]) {
      pageBlocks[item.blockIndex].translated = translated;
      (pageBlocks[item.blockIndex] as any).translatedText = translated;
      (pageBlocks[item.blockIndex] as any).translated_text = translated;
    }
  });
}

export interface ChapterBatchPipelineOptions {
  context: ChapterTranslationContext;
  pages: string[];
  startIdx: number;
  forceRetranslate?: boolean;
  ocrFn: (imgUrl: string, pageIdx: number) => Promise<OCRBlock[]>;
  onPageUpdated: (pageIdx: number, blocks: OCRBlock[]) => void;
  onStatusUpdated: (status: {
    translatingPages: Record<number, boolean>;
    translatedTexts: number;
    completedPages: number;
    totalPages: number;
    isSubstantialBatchDone: boolean;
  }) => void;
  onTranslationError: (errorMsg: string) => void;
  onSubstantialBatchCompleted: (info: {
    translatedTexts: number;
    completedPages: number;
    totalPages: number;
  }) => void;
  onFirstBatchCompleted: (completedPages: number[]) => void;
}

export class ChapterBatchPipeline {
  private opts: ChapterBatchPipelineOptions;
  private stopped: boolean = false;

  constructor(opts: ChapterBatchPipelineOptions) {
    this.opts = opts;
  }

  public stop(): void {
    this.stopped = true;
  }

  public async start(): Promise<void> {
    const { context, pages, startIdx, ocrFn } = this.opts;
    const totalPages = pages.length;
    const order: number[] = [];
    for (let i = startIdx; i < totalPages; i++) order.push(i);
    for (let i = 0; i < startIdx; i++) order.push(i);

    const translatingPages: Record<number, boolean> = {};
    let translatedTexts = 0;
    let completedPages = 0;
    let firstDone = false;

    for (const pIdx of order) {
      if (this.stopped || !context.isActive) break;
      translatingPages[pIdx] = true;
      this.opts.onStatusUpdated({
        translatingPages: { ...translatingPages },
        translatedTexts,
        completedPages,
        totalPages,
        isSubstantialBatchDone: firstDone,
      });

      try {
        const blocks = await ocrFn(pages[pIdx], pIdx);
        if (this.stopped || !context.isActive) break;
        context.setPageBlocks(pIdx, blocks);

        const untranslated = context.getUntranslatedItems([pIdx]);
        if (untranslated.length > 0) {
          const batch = context.createBatch(untranslated, [pIdx]);
          await executeTranslationBatch(context, batch);
          translatedTexts += untranslated.length;
        }

        const updatedBlocks = context.getPageBlocks(pIdx) || blocks;
        this.opts.onPageUpdated(pIdx, updatedBlocks);
        completedPages++;
        translatingPages[pIdx] = false;

        if (!firstDone) {
          firstDone = true;
          this.opts.onFirstBatchCompleted([pIdx]);
          this.opts.onSubstantialBatchCompleted({
            translatedTexts,
            completedPages,
            totalPages,
          });
        }

        this.opts.onStatusUpdated({
          translatingPages: { ...translatingPages },
          translatedTexts,
          completedPages,
          totalPages,
          isSubstantialBatchDone: firstDone,
        });
      } catch (err: any) {
        translatingPages[pIdx] = false;
        this.opts.onTranslationError(err?.message || "Translation error");
      }
    }
  }
}
