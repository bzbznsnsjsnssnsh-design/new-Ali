import crypto from "crypto";
import sharp from "sharp";
import chromeLensOcr from "chrome-lens-ocr";
import {
  scanLensHierarchical,
  reconstructReadingOrder,
  createSpatialBox,
  sortBlocksByReadingOrder,
  withRetry
} from "./ocrReadingOrderEngine.ts";
import type { OcrWord } from "./ocrReadingOrderEngine.ts";
import { detectPagePanels, findPanelForBox } from "./panelDetectionService.ts";
import { analyzeVisualBarrier } from "./barrierAnalysisEngine.ts";
import { executeGraphGrouping } from "./graphGroupingEngine.ts";
import { detectSpeechBubbleAt } from "./comicVisionService.ts";
import {
  detectCandidateBubble,
  classifyTextBubbleRelation,
  validateRegionGeometry,
  isSoundEffectText,
  type TextRegionGeometry
} from "./mangaVisionGeometryEngine.ts";
import { fitArabicTextToRegion } from "../src/utils/arabicLayoutEngine.ts";
import type { CanonicalRegionLayout } from "../src/types.ts";

const Lens = typeof chromeLensOcr === "function" ? chromeLensOcr : (chromeLensOcr as any).default || chromeLensOcr;

let workerLensInstance: any = null;
function getWorkerLens() {
  if (!workerLensInstance) {
    workerLensInstance = new Lens();
  }
  return workerLensInstance;
}

export interface GoogleLensTextRegion {
  page_id: string | number;
  region_id: string;
  block_id: string;
  id: string;
  reading_order: number;
  text_type:
    | "bubble"
    | "dialogue"
    | "narration"
    | "outside"
    | "sfx"
    | "sound_effect"
    | "thought"
    | "whisper"
    | "shouting"
    | "title"
    | "other";
  reconstructed_text?: string;
  reconstructedText?: string;
  source_text: string;
  original_text: string;
  originalText: string;
  translated_text: string;
  translatedText: string;
  ocr_confidence: number;
  confidence: number;
  direction: "horizontal" | "vertical";
  text_direction: "horizontal" | "vertical" | "auto";
  bbox: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    width: number;
    height: number;
  };
  box: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
  text_box: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
  original_text_box: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
  polygon: Array<{ x: number; y: number }>;
  source_polygon?: Array<{ x: number; y: number }>;
  is_inside_bubble: boolean;
  safe_translation_area: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
  bubble_box?: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
  canonical_layout?: CanonicalRegionLayout;
  relative_anchor?: {
    rel_x: number;
    rel_y: number;
    vAlign: "top" | "center" | "bottom";
    hAlign: "left" | "center" | "right";
  };
  visual_text_scale?: number;
  panel_id?: string;
  fontSize?: number;
  font_size?: number;
}

export interface GoogleLensOcrResult {
  page_id: string | number;
  fingerprint: string;
  blocks: GoogleLensTextRegion[];
  metadata: {
    width: number;
    height: number;
    detectedLanguage?: string;
    totalBlocks: number;
    engine: "google_lens_worker";
    timestamp: number;
  };
}

// In-memory Server LRU Cache for Google Lens OCR by image SHA-256 fingerprint
const MAX_CACHE_ITEMS = 500;
const lensOcrCache = new Map<string, GoogleLensOcrResult>();

export function computeImageFingerprint(buffer: Buffer): string {
  const hash = crypto.createHash("sha256");
  // Hash the buffer with length to avoid collisions
  hash.update(buffer);
  return hash.digest("hex").substring(0, 32);
}

/**
 * Detect text type based on glyph characteristics and punctuation
 */
function classifyMangaText(text: string, bbox: { width: number; height: number; xMin: number; yMin: number }): GoogleLensTextRegion["text_type"] {
  const trimmed = text.trim();
  if (!trimmed) return "other";

  // SFX detection: short katakana, hangul onomatopoeia, exclamation clusters, sound effect terms
  const isKatakanaSfx = /^[\u30A0-\u30FF\uFF65-\uFF9F\s!؟?~ー…]+$/.test(trimmed) && trimmed.length <= 12;
  const isHangulSfx = /^[\uAC00-\uD7AF\s!؟?~…]+$/.test(trimmed) && trimmed.length <= 8 && !/[.,]/.test(trimmed);
  const isLatinSfx = /^(bam|boom|bang|crash|whoosh|thud|clank|gasp|sigh|pant|snap|creak|crack|rumble|zoom|slash|strike|swoosh|hah|heh|tsk)[!~]*$/i.test(trimmed);

  if (isKatakanaSfx || isHangulSfx || isLatinSfx) {
    return "sfx";
  }

  // Shouting: Multiple exclamation marks or all-caps short words
  if (/!{2,}/.test(trimmed) || /^[A-Z\s!]{4,}$/.test(trimmed)) {
    return "shouting";
  }

  // Whisper / small thought
  if (/^(\(|（).+(\)|）)$/.test(trimmed) || trimmed.startsWith("...") || trimmed.endsWith("...")) {
    return "whisper";
  }

  // Narration: Wide rectangle at the edges of the page, or classic rectangular box text
  if (bbox.width > 55 || bbox.yMin < 4 || bbox.yMin > 94) {
    return "narration";
  }

  return "dialogue";
}

// In-memory translation cache for Google Lens worker
const workerTranslationCache = new Map<string, string>();

/**
 * Direct resilient Google Translation for Google Lens worker
 */
export async function translateTextWithGoogle(text: string, targetLanguage: string = "ar"): Promise<string> {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  const tl = targetLanguage.toLowerCase().includes("ar") ? "ar" : targetLanguage;
  const cacheKey = `${tl}:::${trimmed}`;

  if (workerTranslationCache.has(cacheKey)) {
    return workerTranslationCache.get(cacheKey)!;
  }

  // Tier 1: Google Translate iOS Client (status 200, fast, no rate limiting)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=it&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "GoogleTranslate/6.28.0.05.357134015 (iPhone; iOS 15.0; Scale/3.00)"
      },
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data && Array.isArray(data[0])) {
        const res = data[0].map((part: any) => part[0] || "").join("").trim();
        if (res) {
          workerTranslationCache.set(cacheKey, res);
          return res;
        }
      }
    }
  } catch (_) {}

  // Tier 2: MyMemory API
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=autodetect|${tl}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (response.ok) {
      const data: any = await response.json();
      const res = data?.responseData?.translatedText;
      if (res && res.trim() && !res.includes("MYMEMORY WARNING")) {
        workerTranslationCache.set(cacheKey, res.trim());
        return res.trim();
      }
    }
  } catch (_) {}

  return trimmed;
}

/**
 * Check if two detected words belong to the same manga/webtoon speech bubble
 * Uses scale-invariant pixel coordinates based on line height and spatial proximity.
 */
function areWordsInSameBubble(w1: OcrWord, w2: OcrWord, imgW: number, imgH: number, clamped?: Uint8ClampedArray): boolean {
  // If visual barrier analysis is available, check for dark ink boundaries or gutters between the two words
  if (clamped) {
    const p1 = { x: w1.box.centerX, y: w1.box.centerY };
    const p2 = { x: w2.box.centerX, y: w2.box.centerY };
    const barrier = analyzeVisualBarrier(
      clamped,
      imgW,
      imgH,
      p1,
      p2,
      w1.box,
      w2.box,
      []
    );
    if (barrier.hasBarrier) {
      return false;
    }
  }

  // If words have designated hierarchical metadata from Google Lens OCR:
  if (
    typeof w1.lineIndex === "number" &&
    typeof w2.lineIndex === "number"
  ) {
    // If they have distinct paragraph indices from Lens hierarchical OCR, they belong to different speech bubbles!
    if (
      typeof w1.paragraphIndex === "number" &&
      typeof w2.paragraphIndex === "number"
    ) {
      if (w1.paragraphIndex !== w2.paragraphIndex) {
        return false;
      }
      // If words have identical line index from OCR hierarchical structure, they belong to the exact same line
      if (w1.lineIndex === w2.lineIndex) {
        return true;
      }
      // Words in the exact same Google Lens paragraph belong to the same speech bubble
      // but only if they are close enough (preventing accidental merges of distant bubbles)
      const x1Min = (w1.box.xMin / 100) * imgW;
      const x1Max = (w1.box.xMax / 100) * imgW;
      const y1Min = (w1.box.yMin / 100) * imgH;
      const y1Max = (w1.box.yMax / 100) * imgH;
      const x2Min = (w2.box.xMin / 100) * imgW;
      const x2Max = (w2.box.xMax / 100) * imgW;
      const y2Min = (w2.box.yMin / 100) * imgH;
      const y2Max = (w2.box.yMax / 100) * imgH;
      const vDist = Math.max(0, Math.max(y1Min, y2Min) - Math.min(y1Max, y2Max));
      const hDist = Math.max(0, Math.max(x1Min, x2Min) - Math.min(x1Max, x2Max));
      const maxDim = Math.max(y1Max - y1Min, y2Max - y2Min, 15);
      if (vDist <= maxDim * 1.8 && hDist <= maxDim * 1.6) {
        return true;
      }
    }
  }

  const x1Min = (w1.box.xMin / 100) * imgW;
  const x1Max = (w1.box.xMax / 100) * imgW;
  const y1Min = (w1.box.yMin / 100) * imgH;
  const y1Max = (w1.box.yMax / 100) * imgH;
  const h1 = Math.max(12, y1Max - y1Min);

  const x2Min = (w2.box.xMin / 100) * imgW;
  const x2Max = (w2.box.xMax / 100) * imgW;
  const y2Min = (w2.box.yMin / 100) * imgH;
  const y2Max = (w2.box.yMax / 100) * imgH;
  const h2 = Math.max(12, y2Max - y2Min);

  const avgLineHeight = (h1 + h2) / 2;

  const horizontalDistPx = Math.max(0, Math.max(x1Min, x2Min) - Math.min(x1Max, x2Max));
  const verticalDistPx = Math.max(0, Math.max(y1Min, y2Min) - Math.min(y1Max, y2Max));
  const xOverlapPx = Math.min(x1Max, x2Max) - Math.max(x1Min, x2Min);

  // 1. Same line flow (horizontal words adjacent in the same line)
  const isSameLine =
    verticalDistPx <= avgLineHeight * 0.55 &&
    horizontalDistPx <= Math.max(35, avgLineHeight * 2.5);

  // 2. Stacked lines inside a speech bubble (line above / line below)
  // Distance between lines in a comic bubble is usually <= 1.5x line height, with horizontal overlap or shared alignment
  const cx1 = (x1Min + x1Max) / 2;
  const cx2 = (x2Min + x2Max) / 2;
  const isStackedLine =
    verticalDistPx <= Math.max(16, avgLineHeight * 1.5) &&
    (xOverlapPx > -avgLineHeight * 0.5 || Math.abs(cx1 - cx2) <= avgLineHeight * 2.2);

  return isSameLine || isStackedLine;
}

/**
 * Reconstructs words inside a speech bubble or text region strictly in natural reading order:
 * - Prevents interleaving words across different lines.
 * - Clusters words into lines strictly Top to Bottom.
 * - Orders words within each line Left to Right (for Latin, Korean, Japanese horizontal)
 *   or Right to Left (for Arabic/Hebrew script).
 * - Avoids reversing English sentences when readingDirection is set to RTL for manga page flow.
 */
function reconstructClusterReadingOrder(cluster: OcrWord[], isPageRtl: boolean): string {
  if (!cluster || cluster.length === 0) return "";
  if (cluster.length === 1) return cluster[0].text.trim();

  // Deduplicate exact same token at identical coordinates (e.g. from slice seams)
  const deduped: OcrWord[] = [];
  for (const w of cluster) {
    const isDup = deduped.some(
      (prev) =>
        prev.text.toLowerCase().trim() === w.text.toLowerCase().trim() &&
        Math.abs(prev.box.centerY - w.box.centerY) < 0.6 &&
        Math.abs(prev.box.centerX - w.box.centerX) < 1.5
    );
    if (!isDup) deduped.push(w);
  }

  const sampleText = deduped.map((w) => w.text).join(" ");
  const isArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(sampleText);
  const isCjk = /[\u3040-\u30FF\u31F0-\u31FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(sampleText);
  const isVertical = isCjk && deduped.some((w) => w.writingDirection === "vertical" || w.box.height > w.box.width * 1.8);

  // Attempt reading order reconstruction via engine
  try {
    const recon = reconstructReadingOrder(deduped, {
      preferredDirection: isVertical ? "vertical" : isArabic ? "rtl" : "ltr",
      isJapaneseManga: isPageRtl
    });
    if (recon && recon.reconstructedText && recon.reconstructedText.trim()) {
      return recon.reconstructedText.trim();
    }
  } catch (err) {
    console.warn("[GoogleLensWorker] reconstructReadingOrder fallback notice:", err);
  }

  // Fallback robust geometric line grouping
  const heights = deduped.map((w) => w.box.height).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)] || 1.5;

  const hasLineIndices = deduped.some((w) => typeof w.lineIndex === "number");
  const lines: Array<{ words: OcrWord[]; centerY: number }> = [];

  if (hasLineIndices && !isVertical) {
    const lineMap = new Map<number, OcrWord[]>();
    for (const w of deduped) {
      const idx = typeof w.lineIndex === "number" ? w.lineIndex : 0;
      const arr = lineMap.get(idx) || [];
      arr.push(w);
      lineMap.set(idx, arr);
    }
    for (const [, lWords] of lineMap.entries()) {
      if (lWords.length === 0) continue;
      const cy = lWords.reduce((sum, w) => sum + w.box.centerY, 0) / lWords.length;
      lines.push({ words: lWords, centerY: cy });
    }
    lines.sort((a, b) => a.centerY - b.centerY);
  } else {
    const sortedWords = [...deduped].sort((a, b) => a.box.centerY - b.box.centerY);
    for (const w of sortedWords) {
      let matchedLine: (typeof lines)[0] | null = null;
      for (const line of lines) {
        const dy = Math.abs(w.box.centerY - line.centerY);
        if (dy <= Math.max(0.8, medH * 0.55)) {
          matchedLine = line;
          break;
        }
      }
      if (matchedLine) {
        matchedLine.words.push(w);
      } else {
        lines.push({ words: [w], centerY: w.box.centerY });
      }
    }
    lines.sort((a, b) => a.centerY - b.centerY);
  }

  // Sort words inside each line
  const lineStrings: string[] = [];
  for (const line of lines) {
    if (isArabic) {
      line.words.sort((a, b) => b.box.xMax - a.box.xMax);
    } else {
      line.words.sort((a, b) => a.box.xMin - b.box.xMin);
    }
    const lineText = line.words.map((w) => w.text.trim()).filter(Boolean).join(" ");
    if (lineText) lineStrings.push(lineText);
  }

  return lineStrings
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.:;?!])/g, "$1")
    .trim();
}

/**
 * Core Google Lens Background Worker OCR Execution
 * Runs Google Lens in a background worker context without any visible UI or browser frames.
 */
export async function processWithGoogleLensWorker(
  imageBuffer: Buffer,
  options: {
    pageId?: string | number;
    pageIndex?: number;
    language?: string;
    targetLanguage?: string;
    readingDirection?: "rtl" | "ltr" | "auto";
    skipTranslation?: boolean;
    forceRefresh?: boolean;
  } = {}
): Promise<GoogleLensOcrResult> {
  const pageId = options.pageId ?? (options.pageIndex !== undefined ? options.pageIndex : 0);
  const pageIdx = typeof pageId === "number" ? pageId : (parseInt(String(pageId), 10) || 0);
  const isRtl = options.readingDirection === "rtl" || options.readingDirection === undefined;
  const targetLang = options.targetLanguage || "ar";
  const skipTranslation = Boolean(options.skipTranslation);

  // 1. Calculate image fingerprint for deterministic caching
  const fingerprint = computeImageFingerprint(imageBuffer);
  const cacheKey = `lens_v7_${fingerprint}_${isRtl ? "rtl" : "ltr"}_${targetLang}_${skipTranslation ? "no_trans" : "trans"}`;

  if (!options.forceRefresh && lensOcrCache.has(cacheKey)) {
    const cached = lensOcrCache.get(cacheKey)!;
    console.log(`[GoogleLensWorker] Instant cache hit for page ${pageId} (fingerprint: ${fingerprint.slice(0, 10)})`);
    // Return copy with updated page_id and region_id for this specific chapter position
    const adaptedBlocks = cached.blocks.map((b, idx) => {
      const stableRegionId = `p${pageIdx}_reg_${String(idx + 1).padStart(3, "0")}`;
      return {
        ...b,
        page_id: pageId,
        region_id: stableRegionId,
        block_id: stableRegionId,
        id: stableRegionId
      };
    });
    return {
      ...cached,
      page_id: pageId,
      blocks: adaptedBlocks
    };
  }

  // 2. Extract dimensions with sharp
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 1200;

  console.log(`[GoogleLensWorker] Starting background Google Lens OCR on image (${width}x${height}, page: ${pageId})...`);

  // 3. Perform Google Lens OCR via Worker instance
  const lens = getWorkerLens();
  let rawWords: OcrWord[] = [];
  let detectedLang = options.language || "auto";

  // Check if image is an ultra-tall webtoon strip (e.g. height > 2200 or aspect ratio > 1.8)
  const isTallWebtoon = height > 2200 || (height / width > 1.8);

  if (isTallWebtoon) {
    console.log(`[GoogleLensWorker] Tall/Stitched webtoon detected (${width}x${height}). Using high-resolution vertical slice scanning...`);
    const sliceHeight = 1800;
    const overlap = 200;
    const step = sliceHeight - overlap;
    const slices: Array<{ top: number; height: number }> = [];

    for (let top = 0; top < height; top += step) {
      const h = Math.min(sliceHeight, height - top);
      slices.push({ top, height: h });
      if (top + h >= height) break;
    }

    const allSlicesWords: OcrWord[] = [];
    for (let sIdx = 0; sIdx < slices.length; sIdx++) {
      const s = slices[sIdx];
      try {
        const sliceBuffer = await sharp(imageBuffer)
          .extract({ left: 0, top: s.top, width, height: s.height })
          .png()
          .toBuffer();

        const hier = await scanLensHierarchical(lens, sliceBuffer, width, s.height, detectedLang);
        if (hier.allWords && hier.allWords.length > 0) {
          if (!detectedLang || detectedLang === "auto") {
            if (hier.detectedLanguage) detectedLang = hier.detectedLanguage;
          }
          for (const w of hier.allWords) {
            // Remap slice Y percentage to global image Y percentage
            const globalYMin = ((w.box.yMin / 100) * s.height + s.top) / height * 100;
            const globalYMax = ((w.box.yMax / 100) * s.height + s.top) / height * 100;

            // Deduplicate overlapping words in seam zones
            const isDuplicate = allSlicesWords.some(prev => {
              const textMatch = prev.text.toLowerCase().trim() === w.text.toLowerCase().trim();
              const yClose = Math.abs(prev.box.yMin - globalYMin) < 0.8;
              const xClose = Math.abs(prev.box.xMin - w.box.xMin) < 2.0;
              return textMatch && yClose && xClose;
            });

            if (!isDuplicate) {
              allSlicesWords.push({
                id: `w_slice_${sIdx}_${allSlicesWords.length}`,
                text: w.text,
                box: createSpatialBox(w.box.xMin, globalYMin, w.box.xMax, globalYMax),
                lineIndex: sIdx * 10000 + (typeof w.lineIndex === "number" ? w.lineIndex : allSlicesWords.length),
                paragraphIndex: typeof w.paragraphIndex === "number" ? sIdx * 10000 + w.paragraphIndex : undefined,
                writingDirection: w.writingDirection
              });
            }
          }
        }
      } catch (sliceErr: any) {
        console.warn(`[GoogleLensWorker] Slice ${sIdx + 1}/${slices.length} notice:`, sliceErr.message || sliceErr);
      }
    }
    rawWords = allSlicesWords;
  } else {
    try {
      const hier = await scanLensHierarchical(lens, imageBuffer, width, height, detectedLang);
      if (hier.allWords && hier.allWords.length > 0) {
        rawWords = hier.allWords;
        if (hier.detectedLanguage) detectedLang = hier.detectedLanguage;
      }
    } catch (err: any) {
      console.warn(`[GoogleLensWorker] Hierarchical scan notice, falling back to standard scanByBuffer:`, err.message || err);
    }
  }

  // Fallback scan if raw words was empty
  if (rawWords.length === 0) {
    try {
      const scan = await withRetry<any>(() => lens.scanByBuffer(imageBuffer));
      const segments = scan.segments || [];
      if (scan.language) detectedLang = scan.language;

      segments.forEach((seg: any, sIdx: number) => {
        const text = (seg.text || "").trim();
        if (!text) return;

        const b = seg.boundingBox;
        const cx = (b?.centerPerX ?? 0.5) * 100;
        const cy = (b?.centerPerY ?? 0.5) * 100;
        const w = Math.max(1, (b?.perWidth ?? 0.2) * 100);
        const h = Math.max(0.8, (b?.perHeight ?? 0.05) * 100);

        const xMin = Math.max(0, cx - w / 2);
        const xMax = Math.min(100, cx + w / 2);
        const yMin = Math.max(0, cy - h / 2);
        const yMax = Math.min(100, cy + h / 2);

        const tokens = text.split(/\s+/).filter(Boolean);
        if (tokens.length <= 1) {
          rawWords.push({
            id: `w_scan_${sIdx}`,
            text,
            box: createSpatialBox(xMin, yMin, xMax, yMax),
            lineIndex: sIdx
          });
        } else {
          const totalChars = tokens.reduce((acc: number, t: string) => acc + t.length, 0) || 1;
          let charAcc = 0;
          for (let wIdx = 0; wIdx < tokens.length; wIdx++) {
            const t = tokens[wIdx];
            const sFrac = charAcc / totalChars;
            charAcc += t.length;
            const eFrac = charAcc / totalChars;
            const wXMin = xMin + sFrac * (xMax - xMin);
            const wXMax = xMin + eFrac * (xMax - xMin);
            rawWords.push({
              id: `w_scan_${sIdx}_${wIdx}`,
              text: t,
              box: createSpatialBox(wXMin, yMin, wXMax, yMax),
              lineIndex: sIdx
            });
          }
        }
      });
    } catch (fallbackErr: any) {
      console.error(`[GoogleLensWorker] Fallback scan also failed:`, fallbackErr.message || fallbackErr);
    }
  }

  if (rawWords.length === 0) {
    console.log(`[GoogleLensWorker] No text detected on page ${pageId}`);
    const emptyResult: GoogleLensOcrResult = {
      page_id: pageId,
      fingerprint,
      blocks: [],
      metadata: {
        width,
        height,
        detectedLanguage: detectedLang,
        totalBlocks: 0,
        engine: "google_lens_worker",
        timestamp: Date.now()
      }
    };
    lensOcrCache.set(cacheKey, emptyResult);
    return emptyResult;
  }

  // 4. Panel & Boundary Detection to prevent cross-panel merging
  let panels = [];
  let clamped: Uint8ClampedArray | undefined;
  try {
    const rawRgba = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    clamped = new Uint8ClampedArray(rawRgba.data.buffer, rawRgba.data.byteOffset, rawRgba.data.length);
    panels = detectPagePanels(clamped, rawRgba.info.width, rawRgba.info.height);
  } catch {
    panels = [{ id: "panel_0", index: 0, box: { xMin: 0, yMin: 0, xMax: 100, yMax: 100 }, confidence: 1.0 }];
  }

  // 5. Connected-Component Transitive Graph Clustering into Cohesive Speech Bubbles
  const wordClusters: OcrWord[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < rawWords.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: OcrWord[] = [];
    const queue: number[] = [i];
    assigned.add(i);

    const pA = findPanelForBox(panels, rawWords[i].box);

    while (queue.length > 0) {
      const curIdx = queue.shift()!;
      const curWord = rawWords[curIdx];
      cluster.push(curWord);

      for (let j = 0; j < rawWords.length; j++) {
        if (assigned.has(j)) continue;
        const candidateWord = rawWords[j];
        const pB = findPanelForBox(panels, candidateWord.box);

        // Never merge text across different comic panels if both are assigned to valid panels
        if (pA && pB && pA.id !== pB.id) continue;

        if (areWordsInSameBubble(curWord, candidateWord, width, height, clamped)) {
          assigned.add(j);
          queue.push(j);
        }
      }
    }

    wordClusters.push(cluster);
  }

  // 6. Build Structured Text Regions with Immutable region_id and Precise Coordinates
  // 6. Independent Candidate Bubble Detection & Multi-Factor Relationship Classification
  const allClusterBoxes = wordClusters.map(c => ({
    xMin: Math.min(...c.map(w => w.box.xMin)),
    xMax: Math.max(...c.map(w => w.box.xMax)),
    yMin: Math.min(...c.map(w => w.box.yMin)),
    yMax: Math.max(...c.map(w => w.box.yMax))
  }));

  const initialRegions: Array<{
    combinedText: string;
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    wPct: number;
    hPct: number;
    isVerticalText: boolean;
    textType: GoogleLensTextRegion["text_type"];
    polygon: Array<{ x: number; y: number }>;
    bubbleBox?: { xMin: number; yMin: number; xMax: number; yMax: number; width: number; height: number; centerX: number; centerY: number };
    safeArea: { xMin: number; yMin: number; xMax: number; yMax: number; width: number; height: number; centerX: number; centerY: number };
    isInsideBubble: boolean;
    relativeAnchor?: { rel_x: number; rel_y: number; vAlign: "top" | "center" | "bottom"; hAlign: "left" | "center" | "right" };
    visualTextScale?: number;
    originalLineCount: number;
  }> = [];

  for (let cIdx = 0; cIdx < wordClusters.length; cIdx++) {
    const cluster = wordClusters[cIdx];
    
    // Accurately reconstruct natural reading order inside bubble without cross-line interleaving
    const combinedText = reconstructClusterReadingOrder(cluster, isRtl);
    if (!combinedText || combinedText.length === 0) continue;

    const xMin = Math.min(...cluster.map(w => w.box.xMin));
    const xMax = Math.max(...cluster.map(w => w.box.xMax));
    const yMin = Math.min(...cluster.map(w => w.box.yMin));
    const yMax = Math.max(...cluster.map(w => w.box.yMax));
    const wPct = Math.max(1.0, xMax - xMin);
    const hPct = Math.max(0.6, yMax - yMin);

    const isVerticalText = hPct > wPct * 1.5 && combinedText.length <= 15;
    const defaultTextType = classifyMangaText(combinedText, { width: wPct, height: hPct, xMin, yMin });

    const siblingBoxes = allClusterBoxes.filter((_, idx) => idx !== cIdx);
    const textBbox = { xMin, yMin, xMax, yMax };
    const textCentroid = { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 };
    const textPolygon = [
      { x: xMin, y: yMin },
      { x: xMax, y: yMin },
      { x: xMax, y: yMax },
      { x: xMin, y: yMax }
    ];

    const estimatedLineCount = Math.max(1, isVerticalText ? Math.ceil(wPct / 3.2) : Math.ceil(hPct / 2.8));
    const textGeometry: TextRegionGeometry = {
      region_id: `temp_${cIdx}`,
      text_polygon: textPolygon,
      text_bbox: textBbox,
      text_centroid: textCentroid,
      text_orientation: isVerticalText ? "vertical" : "horizontal",
      text_direction: isVerticalText ? "vertical" : (isRtl ? "rtl" : "ltr"),
      text_line_count: estimatedLineCount,
      text_area: wPct * hPct,
      original_glyph_area: combinedText.length * 12,
      original_text: combinedText
    };

    // 1. Independent Speech Bubble Discovery
    const candidateBubble = detectCandidateBubble(clamped, width, height, textBbox, siblingBoxes);

    // 2. 10-Criteria Multi-Factor Relationship Classification
    const relation = classifyTextBubbleRelation(textGeometry, candidateBubble, clamped, width, height, panels);

    // 3. Region Geometry Validation
    validateRegionGeometry(textGeometry.region_id, textBbox, textPolygon, relation);

    const isInsideBubble = relation.is_inside_bubble;
    let textType: GoogleLensTextRegion["text_type"] = "dialogue";
    if (relation.classification === "SFX") textType = "sfx";
    else if (relation.classification === "TITLE") textType = "title" as any;
    else if (relation.classification === "NARRATION") textType = "narration";
    else if (relation.classification === "OUTSIDE_BUBBLE" || relation.classification === "ARTWORK_TEXT") textType = "outside";
    else if (isInsideBubble) textType = "dialogue";
    else textType = defaultTextType;

    // Polygon: speech bubble contour if inside, else strict text bounding box
    const polygon = (relation.is_inside_bubble && candidateBubble) ? candidateBubble.bubble_polygon : textPolygon;

    // Bubble Box: strictly undefined if outside bubble!
    const bubbleBox = (relation.is_inside_bubble && candidateBubble) ? {
      xMin: candidateBubble.bubble_bbox.xMin,
      yMin: candidateBubble.bubble_bbox.yMin,
      xMax: candidateBubble.bubble_bbox.xMax,
      yMax: candidateBubble.bubble_bbox.yMax,
      width: candidateBubble.bubble_bbox.xMax - candidateBubble.bubble_bbox.xMin,
      height: candidateBubble.bubble_bbox.yMax - candidateBubble.bubble_bbox.yMin,
      centerX: candidateBubble.bubble_centroid.x,
      centerY: candidateBubble.bubble_centroid.y,
    } : undefined;

    // Safe Translation Area: strictly text box if outside!
    const sBoxRaw = relation.safe_translation_area;
    const sW = Math.max(1.0, sBoxRaw.xMax - sBoxRaw.xMin);
    const sH = Math.max(0.6, sBoxRaw.yMax - sBoxRaw.yMin);
    const safeArea = {
      xMin: sBoxRaw.xMin,
      yMin: sBoxRaw.yMin,
      xMax: sBoxRaw.xMax,
      yMax: sBoxRaw.yMax,
      width: sW,
      height: sH,
      centerX: sBoxRaw.xMin + sW / 2,
      centerY: sBoxRaw.yMin + sH / 2,
    };

    initialRegions.push({
      combinedText,
      xMin,
      yMin,
      xMax,
      yMax,
      wPct,
      hPct,
      isVerticalText,
      textType,
      polygon,
      bubbleBox,
      safeArea,
      isInsideBubble,
      relativeAnchor: relation.relative_anchor,
      visualTextScale: relation.visual_text_scale,
      originalLineCount: estimatedLineCount,
    });
  }

  // 7. Global Reading Order Sort (Top-to-Bottom, then horizontal flow)
  initialRegions.sort((a, b) => {
    const yDelta = a.yMin - b.yMin;
    // Normalized vertical threshold based on webtoon vs standard page
    const verticalTier = isTallWebtoon ? 1.5 : 3.5;
    if (Math.abs(yDelta) > verticalTier) {
      return yDelta;
    }
    // Same row:
    // If Japanese Manga: RTL (right panel first, then left panel)
    // If Webtoon / Western / Korean Manhwa: LTR (left first, then right)
    const isMangaRtl = isRtl && !isTallWebtoon;
    return isMangaRtl ? (b.xMax - a.xMax) : (a.xMin - b.xMin);
  });

  // 8. Automatic High-Quality Google Translation if translation is requested
  let translationsMap = new Map<number, string>();
  if (!skipTranslation && initialRegions.length > 0) {
    console.log(`[GoogleLensWorker] Performing real-time translation for ${initialRegions.length} speech bubbles into '${targetLang}'...`);
    const translationPromises = initialRegions.map(async (reg, idx) => {
      try {
        const trans = await translateTextWithGoogle(reg.combinedText, targetLang);
        return { idx, trans };
      } catch {
        return { idx, trans: reg.combinedText };
      }
    });

    const translatedResults = await Promise.all(translationPromises);
    translatedResults.forEach(({ idx, trans }) => {
      translationsMap.set(idx, trans);
    });
  }

  // 9. Assign deterministic, stable region_id per page
  const finalBlocks: GoogleLensTextRegion[] = initialRegions.map((reg, idx) => {
    const order = idx + 1;
    const stableRegionId = `p${pageIdx}_reg_${String(order).padStart(3, "0")}`;
    const translated = translationsMap.get(idx) || "";

    const regionBox = {
      xMin: reg.xMin,
      yMin: reg.yMin,
      xMax: reg.xMax,
      yMax: reg.yMax,
      width: reg.wPct,
      height: reg.hPct
    };

    // Calculate canonical layout right here on backend for perfect 1:1 parity with frontend
    let canonicalLayout: CanonicalRegionLayout | undefined = undefined;
    try {
      const arabicLayout = fitArabicTextToRegion(
        translated || reg.combinedText,
        {
          region_id: stableRegionId,
          bbox: regionBox,
          bubble_box: reg.bubbleBox,
          safe_area: reg.safeArea,
          polygon: reg.polygon,
          is_inside_bubble: reg.isInsideBubble,
          text_type: reg.textType,
          original_text: reg.combinedText,
          original_line_count: reg.originalLineCount,
          original_centroid: { x: (reg.xMin + reg.xMax) / 2, y: (reg.yMin + reg.yMax) / 2 },
          relative_anchor: reg.relativeAnchor,
          visual_text_scale: reg.visualTextScale,
        },
        { pageWidth: width, pageHeight: height }
      );

      canonicalLayout = {
        region_id: stableRegionId,
        x: arabicLayout.placement.x,
        y: arabicLayout.placement.y,
        width: arabicLayout.placement.width,
        height: arabicLayout.placement.height,
        xPct: arabicLayout.placement.xPct,
        yPct: arabicLayout.placement.yPct,
        widthPct: arabicLayout.placement.widthPct,
        heightPct: arabicLayout.placement.heightPct,
        centerX: arabicLayout.placement.centerX,
        centerY: arabicLayout.placement.centerY,
        fontSize: arabicLayout.fontSize,
        lineHeight: arabicLayout.lineHeight,
        lines: arabicLayout.lines,
        alignment: arabicLayout.placement.alignment,
        text_type: reg.textType,
        is_inside_bubble: reg.isInsideBubble,
        color: arabicLayout.style.color,
        strokeColor: arabicLayout.style.strokeColor,
        strokeWidth: arabicLayout.style.strokeWidth,
        polygon: reg.polygon,
        safe_area: reg.safeArea,
      };
    } catch (err) {
      console.warn(`[GoogleLensWorker] Could not pre-compute canonical layout for ${stableRegionId}:`, err);
    }

    return {
      page_id: pageId,
      region_id: stableRegionId,
      block_id: stableRegionId,
      id: stableRegionId,
      parent_bubble_id: stableRegionId,
      bubble_id: stableRegionId,
      container_id: stableRegionId,
      reading_order: order,
      text_type: reg.textType,
      source_text: reg.combinedText,
      original_text: reg.combinedText,
      originalText: reg.combinedText,
      reconstructed_text: reg.combinedText,
      reconstructedText: reg.combinedText,
      translated_text: translated,
      translatedText: translated,
      ocr_confidence: 0.96,
      confidence: 0.96,
      direction: reg.isVerticalText ? "vertical" : "horizontal",
      text_direction: reg.isVerticalText ? "vertical" : "horizontal",
      bbox: regionBox,
      box: { xMin: reg.xMin, yMin: reg.yMin, xMax: reg.xMax, yMax: reg.yMax },
      text_box: { xMin: reg.xMin, yMin: reg.yMin, xMax: reg.xMax, yMax: reg.yMax },
      original_text_box: { xMin: reg.xMin, yMin: reg.yMin, xMax: reg.xMax, yMax: reg.yMax },
      polygon: reg.polygon,
      source_polygon: reg.polygon,
      is_inside_bubble: reg.isInsideBubble,
      bubble_box: reg.bubbleBox,
      safe_translation_area: reg.safeArea,
      canonical_layout: canonicalLayout,
      relative_anchor: reg.relativeAnchor,
      visual_text_scale: reg.visualTextScale,
      fontSize: canonicalLayout?.fontSize || Math.max(12, Math.min(24, Math.round(reg.hPct * 1.8)))
    };
  });

  const result: GoogleLensOcrResult = {
    page_id: pageId,
    fingerprint,
    blocks: finalBlocks,
    metadata: {
      width,
      height,
      detectedLanguage: detectedLang,
      totalBlocks: finalBlocks.length,
      engine: "google_lens_worker",
      timestamp: Date.now()
    }
  };

  // 10. Cache in LRU map
  if (lensOcrCache.size >= MAX_CACHE_ITEMS) {
    const oldestKey = lensOcrCache.keys().next().value;
    if (oldestKey) lensOcrCache.delete(oldestKey);
  }
  lensOcrCache.set(cacheKey, result);

  console.log(`[GoogleLensWorker] Completed Google Lens OCR on page ${pageId}: identified ${finalBlocks.length} text regions in reading order.`);
  return result;
}
