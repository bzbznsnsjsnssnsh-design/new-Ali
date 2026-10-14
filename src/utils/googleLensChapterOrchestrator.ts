import { OCRBlock } from "../types";
import { ReaderTranslationCache } from "./readerTranslationCache";
import { ChapterContextManager, ChapterTranslationContext } from "./chapterTranslationContext";
import {
  groupPageBlocksIntoSpeechUnits,
  applySpeechUnitTranslation,
  SpeechUnit
} from "./speechUnitGrouping";

export interface GoogleLensProgress {
  phase: "idle" | "ocr_scanning" | "ocr_completed" | "translating" | "completed" | "error";
  analyzedPages: number;
  totalPages: number;
  translatedTexts: number;
  totalTexts: number;
  message: string;
  submessage: string;
}

export interface GoogleLensOrchestratorOptions {
  chapterId: string | number;
  pages: string[];
  targetLang: string;
  translatorEngine: "gemini_cookies" | "metaai" | "google";
  geminiCookieModel?: string;
  mangaTitle?: string;
  workType?: string;
  readingDirection?: "rtl" | "ltr";
  forceRefresh?: boolean;
  onProgress: (progress: GoogleLensProgress) => void;
  onPageOcrReady: (pageIndex: number, blocks: OCRBlock[]) => void;
  onPageTranslationReady: (pageIndex: number, blocks: OCRBlock[]) => void;
  onError: (error: string) => void;
  onCompleted: (allPageBlocks: Record<number, OCRBlock[]>) => void;
}

interface TextItemReference {
  pageIndex: number;
  regionId: string;
  speechUnitId: string;
  regionIds: string[];
  sourceText: string;
  readingOrder: number;
  textType: string;
}

export class GoogleLensChapterOrchestrator {
  private options: GoogleLensOrchestratorOptions;
  private isCancelled: boolean = false;
  private abortController: AbortController = new AbortController();
  
  // Storage of OCR blocks per page
  private pageBlocks: Record<number, OCRBlock[]> = {};
  // Overall translated count
  private translatedTextsCount: number = 0;
  // Total detected texts across chapter
  private totalTextsCount: number = 0;

  constructor(options: GoogleLensOrchestratorOptions) {
    this.options = options;
  }

  public stop(): void {
    this.isCancelled = true;
    this.abortController.abort();
  }

  /**
   * Main Execution Pipeline following the user's explicit specification:
   * 1. Fetch all pages of the chapter.
   * 2. Send pages to Google Lens OCR in the background with controlled concurrency.
   * 3. Do NOT start translating after page 1 - wait until OCR phase completes for all pages.
   * 4. Collect, clean, and organize all texts into a unified chapter list.
   * 5. Start translation phase via Gemini Cookies in large batches.
   * 6. Match results back using stable region_id.
   * 7. Deliver final translations to original pages.
   */
  public async execute(): Promise<void> {
    const { pages, chapterId, targetLang, translatorEngine } = this.options;
    if (pages.length === 0) {
      this.options.onError("الفصل لا يحتوي على أي صفحات لمعالجتها.");
      return;
    }

    try {
      // -------------------------------------------------------------
      // PHASE 1: Google Lens OCR on ALL Chapter Pages (in Background)
      // -------------------------------------------------------------
      this.options.onProgress({
        phase: "ocr_scanning",
        analyzedPages: 0,
        totalPages: pages.length,
        translatedTexts: 0,
        totalTexts: 0,
        message: "الذكاء الاصطناعي يحلل الفصل",
        submessage: "جاري التعرف على النصوص والفقاعات في جميع الصفحات..."
      });

      let analyzedCount = 0;
      const concurrency = 3; // 3 parallel pages in background to balance speed and stability
      const pageIndices = pages.map((_, i) => i);

      // Worker pool for parallel background OCR
      const runOcrWorker = async (index: number): Promise<void> => {
        if (this.isCancelled) return;

        const imgUrl = pages[index];
        let blocks: OCRBlock[] = [];

        // Check cache first (unless forced refresh)
        if (!this.options.forceRefresh) {
          try {
            const cached = await ReaderTranslationCache.getPageTranslation(
              chapterId,
              index,
              translatorEngine,
              targetLang
            );
            if (cached && cached.length > 0) {
              blocks = cached;
            }
          } catch (_) {}
        }

        if (blocks.length === 0) {
          try {
            const res = await fetch("/api/manga/google-lens-ocr", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageUrl: imgUrl,
                pageId: index,
                pageIndex: index,
                readingDirection: this.options.readingDirection || "rtl",
                language: "auto",
                forceRefresh: Boolean(this.options.forceRefresh)
              }),
              signal: this.abortController.signal
            });

            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data.blocks)) {
                blocks = data.blocks;
              }
            }
          } catch (fetchErr: any) {
            if (this.isCancelled) return;
            console.warn(`[GoogleLensOrchestrator] Lens OCR fetch notice for page ${index + 1}:`, fetchErr.message || fetchErr);
          }
        }

        if (this.isCancelled) return;

        this.pageBlocks[index] = blocks;
        this.options.onPageOcrReady(index, blocks);

        analyzedCount++;
        const currentTotalTexts = Object.values(this.pageBlocks).reduce(
          (acc, bList) => acc + bList.length,
          0
        );
        this.totalTextsCount = currentTotalTexts;

        this.options.onProgress({
          phase: "ocr_scanning",
          analyzedPages: analyzedCount,
          totalPages: pages.length,
          translatedTexts: 0,
          totalTexts: currentTotalTexts,
          message: "الذكاء الاصطناعي يحلل الفصل",
          submessage: `تم تحليل ${analyzedCount} / ${pages.length} صفحة`
        });
      };

      // Execute with controlled concurrency
      for (let i = 0; i < pageIndices.length; i += concurrency) {
        if (this.isCancelled) return;
        const chunk = pageIndices.slice(i, i + concurrency);
        await Promise.all(chunk.map((idx) => runOcrWorker(idx)));
      }

      if (this.isCancelled) return;

      // -------------------------------------------------------------
      // PHASE 2: Group consecutive regions into Speech Units per page
      // -------------------------------------------------------------
      const allSpeechUnits: SpeechUnit[] = [];

      for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        const rawBlocks = this.pageBlocks[pIdx] || [];
        // Ensure stable globally unique region_id before grouping
        for (let bIdx = 0; bIdx < rawBlocks.length; bIdx++) {
          const block = rawBlocks[bIdx];
          if (!block.region_id || !block.region_id.startsWith(`p${pIdx}_`)) {
            const rawId = block.region_id || block.id || `reg_${bIdx + 1}`;
            block.region_id = `p${pIdx}_${rawId}`;
            block.id = block.region_id;
          }
        }

        // Group consecutive regions belonging to the same sentence into speech_unit_id
        const { speechUnits, updatedBlocks } = groupPageBlocksIntoSpeechUnits(rawBlocks, pIdx);
        this.pageBlocks[pIdx] = updatedBlocks;
        allSpeechUnits.push(...speechUnits);
      }

      const allTextItems: TextItemReference[] = allSpeechUnits.map((unit, uIdx) => ({
        pageIndex: unit.pageIndex,
        regionId: unit.regionIds[0], // primary region_id for backward compatibility
        speechUnitId: unit.speech_unit_id,
        regionIds: unit.regionIds,
        sourceText: unit.sourceText,
        readingOrder: uIdx + 1,
        textType: unit.textType
      }));

      this.totalTextsCount = allTextItems.length;

      this.options.onProgress({
        phase: "ocr_completed",
        analyzedPages: pages.length,
        totalPages: pages.length,
        translatedTexts: 0,
        totalTexts: allTextItems.length,
        message: "تم التعرف على جميع النصوص وتجميع الجمل",
        submessage: `تم تجميع واستخراج ${allTextItems.length} جملة صوتية (Speech Units) عبر جميع صفحات الفصل`
      });

      // Brief transition delay for pleasant UX
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (this.isCancelled) return;

      if (allTextItems.length === 0) {
        this.options.onProgress({
          phase: "completed",
          analyzedPages: pages.length,
          totalPages: pages.length,
          translatedTexts: 0,
          totalTexts: 0,
          message: "اكتمل فحص الفصل",
          submessage: "لم يتم العثور على نصوص تتطلب الترجمة في هذا الفصل."
        });
        this.options.onCompleted(this.pageBlocks);
        return;
      }

      // -------------------------------------------------------------
      // PHASE 3: Send ALL texts across ALL pages to Gemini in ONE unified batch
      // -------------------------------------------------------------
      this.options.onProgress({
        phase: "translating",
        analyzedPages: pages.length,
        totalPages: pages.length,
        translatedTexts: 0,
        totalTexts: allTextItems.length,
        message: "جاري إرسال جميع نصوص الفصل إلى Gemini...",
        submessage: `جاري إرسال جميع نصوص الفصل (${allTextItems.length} جملة) دفعة واحدة دون ترك أي نص أو صفحة إلى Gemini`
      });

      // Ensure ChapterTranslationContext is active for this session
      const ctx = ChapterContextManager.getOrCreateContext({
        chapterId: String(chapterId),
        mangaId: String(chapterId),
        mangaTitle: this.options.mangaTitle || "",
        workType: this.options.workType || "مانجا / مانهوا",
        provider: translatorEngine,
        targetLang: targetLang,
        model: this.options.geminiCookieModel || "3.6-flash"
      });

      // User instruction: Send ALL texts across all pages of the chapter in ONE single batch, leaving no text or page behind
      const batches: TextItemReference[][] = [allTextItems];

      // Check Gemini Cookies if required
      if (translatorEngine === "gemini_cookies") {
        const cookies = localStorage.getItem("gemini_cookies");
        if (!cookies || !cookies.trim()) {
          const err = "ملفات تعريف الارتباط (Cookies) لـ Gemini غير مضافة. يرجى إضافتها في الإعدادات.";
          this.options.onError(err);
          this.options.onProgress({
            phase: "error",
            analyzedPages: pages.length,
            totalPages: pages.length,
            translatedTexts: this.translatedTextsCount,
            totalTexts: allTextItems.length,
            message: "توقف الترجمة",
            submessage: err
          });
          return;
        }
      }

      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        if (this.isCancelled) return;

        const currentBatch = batches[bIdx];
        const translationPayload = {
          texts: currentBatch.map((item) => item.sourceText),
          blockIds: currentBatch.map((item) => item.regionId),
          items: currentBatch.map((item) => ({
            region_id: item.regionId,
            speech_unit_id: item.speechUnitId,
            region_ids: item.regionIds,
            source_text: item.sourceText,
            reading_order: item.readingOrder,
            text_type: item.textType
          })),
          targetLanguage: targetLang,
          mangaContext: this.options.mangaTitle || "",
          workName: this.options.mangaTitle || "",
          workType: this.options.workType || "مانجا / مانهوا",
          chapterId: String(chapterId),
          sessionId: ctx.sessionId,
          provider: translatorEngine,
          model: this.options.geminiCookieModel || "3.6-flash",
          cookies: translatorEngine === "gemini_cookies" ? (localStorage.getItem("gemini_cookies") || "") : undefined
        };

        const endpoint = translatorEngine === "gemini_cookies"
          ? "/api/manga/translate-gemini"
          : translatorEngine === "metaai"
          ? "/api/manga/translate-metaai"
          : "/api/manga/translate-google";

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(translationPayload),
            signal: this.abortController.signal
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${response.status} from ${endpoint}`);
          }

          const resData = await response.json();
          const translations: string[] = resData.translations || [];
          const translationMap: Record<string, string> = resData.translationMap || {};

          // -------------------------------------------------------------
          // PHASE 4: Apply Speech Unit Translation cleanly
          // -------------------------------------------------------------
          const touchedPages = new Set<number>();

          allSpeechUnits.forEach((unit, uIdx) => {
            const translatedText = translationMap[unit.speech_unit_id] ||
                                   translationMap[unit.regionIds[0]] ||
                                   translationMap[String(uIdx + 1)] ||
                                   translationMap[`region_${uIdx + 1}`] ||
                                   translations[uIdx] ||
                                   unit.sourceText;

            applySpeechUnitTranslation(unit, translatedText);
            touchedPages.add(unit.pageIndex);
          });

          // Deliver updated pages to UI immediately
          touchedPages.forEach((pIdx) => {
            const updated = this.pageBlocks[pIdx];
            if (updated) {
              this.options.onPageTranslationReady(pIdx, [...updated]);
              // Persist to cache
              ReaderTranslationCache.savePageTranslation(
                chapterId,
                pIdx,
                updated,
                translatorEngine,
                targetLang
              ).catch(() => {});
            }
          });

          this.translatedTextsCount += currentBatch.length;

          this.options.onProgress({
            phase: "translating",
            analyzedPages: pages.length,
            totalPages: pages.length,
            translatedTexts: Math.min(this.translatedTextsCount, allTextItems.length),
            totalTexts: allTextItems.length,
            message: "جاري ترجمة الفصل...",
            submessage: `تمت ترجمة ${Math.min(this.translatedTextsCount, allTextItems.length)} / ${allTextItems.length} نصًا`
          });

        } catch (transErr: any) {
          if (this.isCancelled) return;
          console.error(`[GoogleLensOrchestrator] Batch ${bIdx + 1} translation error:`, transErr);
          // Strictly do NOT fallback to another provider
          this.options.onError(`خطأ أثناء ترجمة الدفعة بواسطة ${translatorEngine}: ${transErr.message || transErr}`);
          this.options.onProgress({
            phase: "error",
            analyzedPages: pages.length,
            totalPages: pages.length,
            translatedTexts: this.translatedTextsCount,
            totalTexts: allTextItems.length,
            message: "توقف الترجمة",
            submessage: transErr.message || "حدث خطأ أثناء الترجمة"
          });
          return;
        }
      }

      if (this.isCancelled) return;

      // -------------------------------------------------------------
      // PHASE 5: Completion
      // -------------------------------------------------------------
      this.options.onProgress({
        phase: "completed",
        analyzedPages: pages.length,
        totalPages: pages.length,
        translatedTexts: allTextItems.length,
        totalTexts: allTextItems.length,
        message: "تمت ترجمة الفصل بالكامل",
        submessage: `اكتملت ترجمة جميع النصوص (${allTextItems.length} نصاً) بنجاح!`
      });

      this.options.onCompleted(this.pageBlocks);

    } catch (globalErr: any) {
      if (this.isCancelled) return;
      console.error("[GoogleLensOrchestrator] Unexpected error:", globalErr);
      this.options.onError(globalErr.message || "حدث خطأ غير متوقع في معالجة الفصل.");
      this.options.onProgress({
        phase: "error",
        analyzedPages: 0,
        totalPages: pages.length,
        translatedTexts: 0,
        totalTexts: 0,
        message: "فشل التحليل",
        submessage: globalErr.message || "حدث خطأ غير متوقع."
      });
    }
  }
}
