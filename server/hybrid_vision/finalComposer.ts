import sharp from "sharp";
import type {
  HybridRegion,
  HybridPageAnalysis,
  IFinalComposer,
} from "./types.ts";
import { textDetector } from "./textDetector.ts";
import { ocrEngine } from "./ocrEngine.ts";
import { ocrValidator } from "./ocrValidator.ts";
import { regionManager } from "./regionManager.ts";
import { textRemoval } from "./textRemoval.ts";
import { textRenderer } from "./textRenderer.ts";
import { translateTextWithGoogle } from "../googleLensWorkerService.ts";

/**
 * LRU In-memory Cache for Page Analysis Results.
 */
class PageAnalysisCache {
  private cache = new Map<string, { analysis: HybridPageAnalysis; timestamp: number }>();
  private readonly MAX_ENTRIES = 50;

  get(key: string): HybridPageAnalysis | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return entry.analysis;
  }

  set(key: string, analysis: HybridPageAnalysis): void {
    if (this.cache.size >= this.MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { analysis, timestamp: Date.now() });
  }
}

const pageCache = new PageAnalysisCache();

export class FinalComposer implements IFinalComposer {
  /**
   * Complete 12-stage end-to-end processing of a manga page.
   * Modular, non-blocking, and cache-backed.
   */
  async processPage(
    imageBuffer: Buffer,
    options: {
      pageId: string | number;
      targetLanguage?: string;
      sourceLanguage?: string;
      readingDirection?: "rtl" | "ltr";
      forceRefresh?: boolean;
      skipTranslation?: boolean;
      skipInpainting?: boolean;
      renderArabicOverlay?: boolean;
    }
  ): Promise<HybridPageAnalysis> {
    const startTime = Date.now();
    const targetLang = options.targetLanguage || "ar";
    const readingDirection = options.readingDirection || "rtl";

    // 1. Check cache unless forceRefresh is set
    const meta = await sharp(imageBuffer).metadata();
    const pageWidth = meta.width || 1000;
    const pageHeight = meta.height || 1500;
    const cacheKey = `${options.pageId}_${pageWidth}x${pageHeight}_${targetLang}_${readingDirection}`;

    if (!options.forceRefresh) {
      const cached = pageCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 2. Hybrid Text & Speech Bubble Detection
    const { regions: detectedRegions } = await textDetector.detectTextAndBubbles(
      imageBuffer,
      { readingDirection, sourceLanguage: options.sourceLanguage }
    );

    let regions = detectedRegions;

    // 3. OCR Validation & Preprocessing Retries
    for (const region of regions) {
      const val = ocrValidator.validate(region.original_text, region.confidence, region);
      region.validation_status.isValid = val.isValid;
      region.validation_status.anomalies = val.anomalies;

      if (!val.isValid && val.recommendedAction.startsWith("retry_") && region.validation_status.retryCount < 2) {
        region.validation_status.retryCount++;
        try {
          const reOcr = await ocrEngine.recognizeRegion(imageBuffer, region, {
            preferredLanguage: options.sourceLanguage,
            isVertical: region.direction === "vertical",
          });
          if (reOcr.text && reOcr.confidence > region.confidence) {
            region.original_text = reOcr.text;
            region.originalText = reOcr.text;
            region.confidence = reOcr.confidence;
          }
        } catch {
          // Keep base text on retry failure
        }
      }
    }

    // 4. Translation via Existing Provider Pipeline (keeping region_id strictly bound)
    if (!options.skipTranslation && targetLang.toLowerCase().startsWith("ar")) {
      for (const region of regions) {
        const srcText = (region.original_text || "").trim();
        if (srcText && !region.translated_text) {
          try {
            const trans = await translateTextWithGoogle(srcText, "ar");
            if (trans && trans.trim().length > 0) {
              region.translated_text = trans.trim();
              region.translatedText = trans.trim();
            }
          } catch {
            region.translated_text = srcText;
            region.translatedText = srcText;
          }
        }
      }
    }

    // 5. Dual-Path Text Removal & AI Inpainting
    let cleanImageBuffer: Buffer | undefined;
    if (!options.skipInpainting && regions.length > 0) {
      cleanImageBuffer = await textRemoval.cleanPage(
        imageBuffer,
        regions,
        pageWidth,
        pageHeight
      );
    }

    // 6. Arabic Typesetting & Master Page Rendering
    let finalImageBuffer: Buffer | undefined;
    if (options.renderArabicOverlay && cleanImageBuffer) {
      finalImageBuffer = await textRenderer.renderArabicText(
        cleanImageBuffer,
        regions,
        pageWidth,
        pageHeight
      );
    }

    const duration = Date.now() - startTime;

    const analysis: HybridPageAnalysis = {
      pageId: options.pageId,
      dimensions: {
        width: pageWidth,
        height: pageHeight,
        aspectRatio: pageWidth / pageHeight,
        isWebtoon: (pageWidth / pageHeight) < 0.45,
      },
      regions,
      cleanImageBuffer,
      finalImageBuffer,
      metadata: {
        detectorEngine: "HybridLensGraphDetector",
        ocrEnginesUsed: ["GoogleLensVision", "MultilingualTesseract"],
        inpaintingMethod: "PaperToneFloodFill+PDEIsophoteInpainting",
        totalProcessingTimeMs: duration,
      },
    };

    // Store in cache
    pageCache.set(cacheKey, analysis);

    return analysis;
  }
}

export const finalComposer = new FinalComposer();
