import sharp from "sharp";
import chromeLensOcr from "chrome-lens-ocr";
import { createWorker } from "tesseract.js";
import {
  scanLensHierarchical,
  reconstructReadingOrder,
  deduplicateRegionWords,
  createSpatialBox,
  sortBlocksByReadingOrder,
  withRetry
} from "./ocrReadingOrderEngine.ts";
import type { OcrWord } from "./ocrReadingOrderEngine.ts";
import { detectPagePanels, findPanelForBox, createFullPagePanel } from "./panelDetectionService.ts";
import { analyzeVisualBarrier } from "./barrierAnalysisEngine.ts";
import { executeGraphGrouping } from "./graphGroupingEngine.ts";
import { hybridInpaintPageText } from "./hybrid_vision/index.ts";
import type {
  Panel,
  Bubble,
  TextRegion,
  PageAnalysis,
  OcrSegment,
  GraphGroupingResult
} from "./types/mangaTypes.ts";

// Lens OCR constructor
const Lens = typeof chromeLensOcr === 'function' ? chromeLensOcr : (chromeLensOcr as any).default || chromeLensOcr;
let globalLens: any = null;
function getLensInstance() {
  if (!globalLens) {
    globalLens = new Lens();
  }
  return globalLens;
}

// Cached Tesseract worker per language to avoid reloading per request
const tesseractWorkers = new Map<string, any>();
async function getTesseractWorker(langCode: string = "eng"): Promise<any> {
  let targetLang = "eng";
  const lower = (langCode || "").toLowerCase();
  if (lower.includes("ja") || lower.includes("jpn") || lower.includes("japanese")) {
    targetLang = "jpn+eng";
  } else if (lower.includes("ko") || lower.includes("kor") || lower.includes("korean")) {
    targetLang = "kor+eng";
  } else if (lower.includes("zh") || lower.includes("chi") || lower.includes("chinese")) {
    targetLang = "chi_sim+eng";
  } else if (lower.includes("ar") || lower.includes("arabic")) {
    targetLang = "ara+eng";
  } else if (lower.includes("fr") || lower.includes("french")) {
    targetLang = "fra+eng";
  } else if (lower.includes("es") || lower.includes("spanish")) {
    targetLang = "spa+eng";
  } else if (lower.includes("de") || lower.includes("german")) {
    targetLang = "deu+eng";
  } else if (lower.includes("ru") || lower.includes("russian")) {
    targetLang = "rus+eng";
  }

  if (tesseractWorkers.has(targetLang)) {
    return tesseractWorkers.get(targetLang);
  }

  try {
    const worker = await createWorker(targetLang);
    tesseractWorkers.set(targetLang, worker);
    return worker;
  } catch (err: any) {
    console.warn(`[Tesseract] Could not initialize worker for ${targetLang}:`, err.message || err);
    return null;
  }
}

export interface BoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface TranslationArea {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface ComicBlock {
  id: string;
  region_id: string;
  parent_bubble_id: string | null;
  container_id?: string;
  language: string;
  original_text: string;
  originalText: string;
  source_text?: string;
  translated_text: string;
  translatedText: string;
  original_text_box: BoundingBox;
  source_bbox?: BoundingBox;
  text_box: BoundingBox;
  box: BoundingBox;
  source_polygon?: PolygonPoint[];
  bubble_box?: BoundingBox;
  bubble_polygon?: PolygonPoint[];
  polygon?: PolygonPoint[];
  text_type: "bubble" | "dialogue" | "narrative" | "narration" | "outside" | "sfx" | "sound_effect" | "title" | "thought" | "scream" | "whisper" | "other";
  type?: "bubble" | "dialogue" | "narrative" | "narration" | "outside" | "sfx" | "sound_effect" | "title" | "thought" | "scream" | "whisper" | "other";
  confidence: number;
  reading_order: number;
  is_inside_bubble: boolean;
  is_sfx?: boolean;
  is_narration?: boolean;
  is_speech?: boolean;
  is_outside_text?: boolean;
  text_direction?: "horizontal" | "vertical" | "auto";
  safe_translation_area: TranslationArea;
  translation_safe_area?: TranslationArea;
  safe_area?: TranslationArea;
  translation_area: TranslationArea;
  translation_bbox?: TranslationArea;
  translation_position: { x: number; y: number };
  translation_width: number;
  translation_height: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  font_size: number;
  source_engine: string;
  aspect_ratio?: number;
  original_pixel_box?: { x: number; y: number; width: number; height: number };
  original_page_size?: { width: number; height: number };
  is_locked?: boolean;
  raw_extracted_text?: string;
  rawExtractedText?: string;
  reconstructed_text?: string;
  reconstructedText?: string;
  word_boxes?: Array<{ text: string; box: BoundingBox; lineIndex: number; wordIndex: number }>;
  line_boxes?: Array<{ text: string; box: BoundingBox; lineIndex: number }>;
  validation_info?: { isValid: boolean; repaired: boolean; anomalies: string[] };
  panel_index?: number;
  parent_panel_id?: string;
  original_coordinates?: { x: number; y: number; width: number; height: number };
  translation_input_text?: string;
  bubble_type?: string;
}

export interface ComicAnalysisOptions {
  targetLanguage?: string;
  sourceLanguage?: string;
  mangaTitle?: string;
  workType?: string;
  readingDirection?: "rtl" | "ltr" | "vertical" | "auto";
  performInpaint?: boolean;
}

export interface BubbleDetectionResult {
  isInsideBubble: boolean;
  bubbleType: "bubble" | "dialogue" | "narrative" | "narration" | "outside" | "sfx" | "sound_effect" | "title" | "other";
  bubbleBox?: BoundingBox;
  safeArea: BoundingBox;
  bubblePolygon?: PolygonPoint[];
  aspectRatio: number;
  confidence: number;
}

/**
 * Normalized string similarity (Levenshtein-based)
 */
function textSimilarity(s1: string, s2: string): number {
  const a = (s1 || "").trim().toLowerCase();
  const b = (s2 || "").trim().toLowerCase();
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n);
}

/**
 * Detects whether a text segment represents a title or chapter heading
 */
export function detectIsTitle(text: string, yMinPct: number = 0, isInsideBubble: boolean = false): boolean {
  if (isInsideBubble) return false;
  const t = (text || "").trim().toLowerCase();
  if (/^(chapter|ch\.|episode|ep\.|vol\.|volume|act|فصل|الفصل|الحلقة|المجلد)\s*\d+/i.test(t)) {
    return true;
  }
  return false;
}


/**
 * Detects whether a string is an ambient sound effect (SFX / Onomatopoeia).
 * Does NOT classify dialogue laughter (e.g. "haha", "hehe", "하하") or speech interjections as SFX.
 */
export function detectIsSfx(text: string, language?: string): boolean {
  const t = (text || "").trim();
  if (!t || t.length > 25) return false;

  // Do not classify common laughter or dialogue expressions as SFX
  if (/^(ha|he|hu|fu|ku|wa|ah|oh|eh)[\s!?.~*]*$/i.test(t)) return false;
  if (/^(ha|he|ho|fu|ku){2,}[!?.~*]*$/i.test(t)) return false;
  if (/^(ها|هه|هو|كك|وو)+[!?.~*]*$/.test(t)) return false;
  if (/^(하|히|헤|호|ㅋ|ㅎ)+[!?.~*]*$/.test(t)) return false;

  // Japanese Katakana SFX (e.g. ドキドキ, ドン, バン, ゴゴゴ, ズズズ, ギニャー, パシャ, etc.)
  const isAllKatakana = /^[\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F\sー!?~.]+$/.test(t);
  if (isAllKatakana && t.length <= 10) return true;

  // Korean Onomatopoeia (ambient sounds like 쿵, 쾅, 촤아, 두근, 슥, 탁, 쉭, 콰앙, 우르르)
  const koreanSfxWords = ["쿵", "쾅", "촤", "두근", "슥", "탁", "쉭", "콰", "우르르", "찌릿", "따각", "찰칵", "펄럭"];
  if (koreanSfxWords.some(w => t.includes(w)) && t.length <= 8) return true;

  // Chinese SFX (e.g. 嗒嗒, 轰, 咚, 啪, 呼, 哗)
  const chineseSfxWords = ["嗒", "轰", "咚", "啪", "呼", "哗", "沙沙", "吱", "砰", "咕噜"];
  if (chineseSfxWords.some(w => t.includes(w)) && t.length <= 6) return true;

  // English comic sound effects (ambient impact, collision, mechanics)
  const englishSfxRegex = /^(bam|boom|bang|crash|smash|wham|thud|thump|slash|oof|argh|shh|clang|pow|whoosh|snap|click|buzz|beep|clink|splash|swoosh|rumble|crackle|gasp|sigh|pant|groan|grr)[!?.~*]*$/i;
  if (englishSfxRegex.test(t)) return true;

  // Russian / Cyrillic Manga SFX
  const russianSfxRegex = /^(шурх|вжух|бах|бум|клац|хрусь|топ|кап|шлеп|хлоп|скрип|звон|дзынь|пшик|удар|вздох|тук|стук|грохот|свист|всплеск|щелк|дзинь|хмык|кхем|о-о|а-а|э-э|бах-бах|топ-топ|кап-кап|цок|вжих)[!?.~*]*$/i;
  if (russianSfxRegex.test(t)) return true;

  return false;
}

/**
 * Classifies comic text into specific semantic categories:
 * dialogue, narration, sfx, title, outside, other
 */
export function classifyTextRegion(
  text: string,
  isInsideBubble: boolean,
  aspectRatio: number,
  bubbleW: number,
  bubbleH: number,
  yMinPct: number = 0
): "bubble" | "dialogue" | "narrative" | "narration" | "outside" | "sfx" | "sound_effect" | "title" | "other" {
  if (isInsideBubble) {
    const isNarrationBox = (aspectRatio > 2.2 && bubbleH < 14) || (aspectRatio < 0.45 && bubbleW < 14) || (bubbleW > 32 && bubbleH < 10);
    return isNarrationBox ? "narration" : "dialogue";
  }
  if (detectIsTitle(text, yMinPct)) {
    return "title";
  }
  if (detectIsSfx(text)) {
    return "sfx";
  }
  return "outside";
}

/**
 * Test whether a point (px, py) is strictly inside a polygon
 */
export function pointInPolygon(px: number, py: number, polygon: PolygonPoint[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Advanced Speech Bubble and Enclosure Detector
 * Uses Computer Vision 36-ray radial edge-tracing with Sobel gradient analysis,
 * polygon contour reconstruction, and inscribed Safe Translation Area computation.
 * Supports:
 * - Oval / Elliptical bubbles
 * - Rectangular / Square narration boxes
 * - Borderless bubbles (clean white panel backgrounds)
 * - Tail rejection (median filter on ray lengths to snip off narrow tails)
 */
export function detectSpeechBubbleAt(
  pixelData: Uint8ClampedArray,
  imageW: number,
  imageH: number,
  textPixelBox: { x1: number; y1: number; x2: number; y2: number },
  rawText: string = "",
  siblingBoxes?: Array<{ x1: number; y1: number; x2: number; y2: number }>
): BubbleDetectionResult {
  const cx = Math.floor((textPixelBox.x1 + textPixelBox.x2) / 2);
  const cy = Math.floor((textPixelBox.y1 + textPixelBox.y2) / 2);
  const textW = Math.max(1, textPixelBox.x2 - textPixelBox.x1);
  const textH = Math.max(1, textPixelBox.y2 - textPixelBox.y1);
  const hw = textW / 2;
  const hh = textH / 2;

  const xMinPct = (textPixelBox.x1 / imageW) * 100;
  const xMaxPct = (textPixelBox.x2 / imageW) * 100;
  const yMinPct = (textPixelBox.y1 / imageH) * 100;
  const yMaxPct = (textPixelBox.y2 / imageH) * 100;

  function getLuminance(x: number, y: number): number {
    if (x < 0 || x >= imageW || y < 0 || y >= imageH) return 0;
    const idx = (y * imageW + x) * 4;
    return 0.299 * pixelData[idx] + 0.587 * pixelData[idx + 1] + 0.114 * pixelData[idx + 2];
  }

  // Sample interior background around the boundary of the text box (to sample clean bubble canvas)
  let bestBgLum = 0;
  const bgSamples: number[] = [];
  const sampleOffsets = [
    [-Math.floor(textW * 0.45), 0],
    [Math.floor(textW * 0.45), 0],
    [0, -Math.floor(textH * 0.45)],
    [0, Math.floor(textH * 0.45)],
    [-textPixelBox.x1 + Math.max(0, textPixelBox.x1 - 3), 0],
    [Math.min(imageW - 1, textPixelBox.x2 + 3) - textPixelBox.x2, 0],
    [0, -textPixelBox.y1 + Math.max(0, textPixelBox.y1 - 3)],
    [0, Math.min(imageH - 1, textPixelBox.y2 + 3) - textPixelBox.y2],
  ];

  for (const [ox, oy] of sampleOffsets) {
    const sx = Math.max(0, Math.min(imageW - 1, cx + ox));
    const sy = Math.max(0, Math.min(imageH - 1, cy + oy));
    const lum = getLuminance(sx, sy);
    bgSamples.push(lum);
    if (lum > bestBgLum) bestBgLum = lum;
  }

  const avgBgLum = bgSamples.reduce((a, b) => a + b, 0) / bgSamples.length;
  const bgVariance = bgSamples.reduce((sum, val) => sum + Math.pow(val - avgBgLum, 2), 0) / bgSamples.length;

  // Check for clean borderless white/light speech regions (common in manga)
  const isCleanWhiteBackground = bestBgLum >= 210 && bgVariance < 160;

  // If background inside the text area is completely dark artwork (e.g. night sky / solid black panel where bestBgLum < 95)
  if (bestBgLum < 95) {
    const bubbleType = classifyTextRegion(rawText, false, textW / textH, 0, 0, yMinPct);
    return {
      isInsideBubble: false,
      bubbleType,
      safeArea: { xMin: xMinPct, xMax: xMaxPct, yMin: yMinPct, yMax: yMaxPct },
      aspectRatio: textW / textH,
      confidence: 0.92
    };
  }

  // 36-ray Radial Ray Casting with bounded search envelope starting OUTSIDE the text box
  const NUM_RAYS = 36;
  const rawRayPoints: { x: number; y: number; r: number; angle: number; hitBorder: boolean }[] = [];
  let inkBordersHitCount = 0;
  let cropEdgesHitCount = 0;
  let hitTop = false;
  let hitBottom = false;
  let hitLeft = false;
  let hitRight = false;

  for (let k = 0; k < NUM_RAYS; k++) {
    const angle = (k * 2 * Math.PI) / NUM_RAYS;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Distance to reach the perimeter of textPixelBox along this ray
    const rBoxX = Math.abs(cosA) > 1e-5 ? Math.abs(hw / cosA) : Infinity;
    const rBoxY = Math.abs(sinA) > 1e-5 ? Math.abs(hh / sinA) : Infinity;
    const rBox = Math.min(rBoxX, rBoxY);

    // Start 2px OUTSIDE the text bounding box so we never detect text glyphs as bubble borders!
    const startR = rBox + 2;
    const maxSearchDist = Math.max(textW * 2.8 + 120, Math.min(imageW * 0.55, 600));
    const rayMaxLimit = Math.min(Math.hypot(imageW, imageH) * 0.6, startR + maxSearchDist);

    let hitBorder = false;
    let finalR = rayMaxLimit;

    for (let r = startR; r <= rayMaxLimit; r += 1.5) {
      const rx = Math.round(cx + cosA * r);
      const ry = Math.round(cy + sinA * r);

      if (rx <= 1 || rx >= imageW - 2 || ry <= 1 || ry >= imageH - 2) {
        finalR = r;
        cropEdgesHitCount++;
        break;
      }

      // CRITICAL: If ray is currently passing through any confirmed sibling text line inside the bubble,
      // ignore its dark ink glyphs so adjacent lines are NEVER mistaken for bubble borders!
      if (siblingBoxes && siblingBoxes.length > 0) {
        let insideSiblingText = false;
        for (let sbIdx = 0; sbIdx < siblingBoxes.length; sbIdx++) {
          const sb = siblingBoxes[sbIdx];
          if (rx >= sb.x1 - 2 && rx <= sb.x2 + 2 && ry >= sb.y1 - 2 && ry <= sb.y2 + 2) {
            insideSiblingText = true;
            break;
          }
        }
        if (insideSiblingText) {
          continue;
        }
      }

      const lum = getLuminance(rx, ry);
      const aheadX = Math.round(cx + cosA * (r + 2));
      const aheadY = Math.round(cy + sinA * (r + 2));
      const aheadLum = getLuminance(aheadX, aheadY);
      const gradient = Math.abs(aheadLum - lum);

      // Bubble ink boundary: sharp dark stroke or gradient transition to artwork
      if (lum <= 100 || (lum <= Math.max(80, bestBgLum - 35) && gradient >= 25)) {
        finalR = r;
        hitBorder = true;
        inkBordersHitCount++;

        if (sinA < -0.38) hitTop = true;
        if (sinA > 0.38) hitBottom = true;
        if (cosA > 0.38) hitRight = true;
        if (cosA < -0.38) hitLeft = true;
        break;
      }
    }

    rawRayPoints.push({
      x: cx + cosA * finalR,
      y: cy + sinA * finalR,
      r: finalR,
      angle,
      hitBorder
    });
  }

  const inkBorderRatio = inkBordersHitCount / NUM_RAYS;
  const hasEnclosingOpposites = (hitTop && hitBottom) || (hitLeft && hitRight);
  const quadrantsHit = (hitTop ? 1 : 0) + (hitBottom ? 1 : 0) + (hitLeft ? 1 : 0) + (hitRight ? 1 : 0);
  const isEnclosedBubble = (inkBorderRatio >= 0.40 && hasEnclosingOpposites) ||
    (inkBorderRatio >= 0.35 && quadrantsHit >= 3) ||
    (isCleanWhiteBackground && bestBgLum >= 215 && inkBorderRatio >= 0.28 && hasEnclosingOpposites);

  // If text lacks enclosing opposing borders or escaped towards crop edges, it is strictly outside text!
  if (!isEnclosedBubble) {
    const bubbleType = classifyTextRegion(rawText, false, textW / textH, 0, 0, yMinPct);
    return {
      isInsideBubble: false,
      bubbleType,
      safeArea: { xMin: xMinPct, xMax: xMaxPct, yMin: yMinPct, yMax: yMaxPct },
      aspectRatio: textW / textH,
      confidence: 0.94
    };
  }

  // Tail Rejection & Contour Smoothing:
  // Mathematical tail rejection: computes the local median over a 5-ray window.
  // Any ray extending significantly further (> 1.25x median) is snipped off at the median,
  // preventing the tail from becoming part of the speech bubble polygon or safe text area!
  const smoothedRayPoints: { x: number; y: number; r: number }[] = [];
  for (let k = 0; k < NUM_RAYS; k++) {
    const rPrev2 = rawRayPoints[(k - 2 + NUM_RAYS) % NUM_RAYS].r;
    const rPrev1 = rawRayPoints[(k - 1 + NUM_RAYS) % NUM_RAYS].r;
    const rCurr  = rawRayPoints[k].r;
    const rNext1 = rawRayPoints[(k + 1) % NUM_RAYS].r;
    const rNext2 = rawRayPoints[(k + 2) % NUM_RAYS].r;

    const neighborsSorted = [rPrev2, rPrev1, rNext1, rNext2].sort((a, b) => a - b);
    const medianNeighbor = (neighborsSorted[1] + neighborsSorted[2]) / 2;

    let adjustedR = rCurr;
    // Tail spike rejection
    if (rCurr > medianNeighbor * 1.25) {
      adjustedR = medianNeighbor;
    } else if (rCurr < medianNeighbor * 0.65) {
      adjustedR = medianNeighbor;
    }

    const angle = rawRayPoints[k].angle;
    smoothedRayPoints.push({
      x: cx + Math.cos(angle) * adjustedR,
      y: cy + Math.sin(angle) * adjustedR,
      r: adjustedR
    });
  }

  // Build the tail-free bubble polygon in normalized percentage coordinates (0..100)
  const bubblePolygon: PolygonPoint[] = smoothedRayPoints.map(pt => ({
    x: Math.max(0, Math.min(100, (pt.x / imageW) * 100)),
    y: Math.max(0, Math.min(100, (pt.y / imageH) * 100))
  }));

  const bXMinPct = Math.min(...bubblePolygon.map(p => p.x));
  const bXMaxPct = Math.max(...bubblePolygon.map(p => p.x));
  const bYMinPct = Math.min(...bubblePolygon.map(p => p.y));
  const bYMaxPct = Math.max(...bubblePolygon.map(p => p.y));

  // Verify text centroid is actually enclosed within the detected bubble polygon
  const textCentroidX = (xMinPct + xMaxPct) / 2;
  const textCentroidY = (yMinPct + yMaxPct) / 2;
  let isCentroidInside = false;
  for (let i = 0, j = bubblePolygon.length - 1; i < bubblePolygon.length; j = i++) {
    const xi = bubblePolygon[i].x, yi = bubblePolygon[i].y;
    const xj = bubblePolygon[j].x, yj = bubblePolygon[j].y;
    const intersect = ((yi > textCentroidY) !== (yj > textCentroidY))
      && (textCentroidX < (xj - xi) * (textCentroidY - yi) / (yj - yi) + xi);
    if (intersect) isCentroidInside = !isCentroidInside;
  }

  if (!isCentroidInside) {
    const bubbleType = classifyTextRegion(rawText, false, textW / textH, 0, 0, yMinPct);
    return {
      isInsideBubble: false,
      bubbleType,
      safeArea: { xMin: xMinPct, xMax: xMaxPct, yMin: yMinPct, yMax: yMaxPct },
      aspectRatio: textW / textH,
      confidence: 0.95
    };
  }

  const bubbleW = bXMaxPct - bXMinPct;
  const bubbleH = bYMaxPct - bYMinPct;

  // Edge overflow rejection: only reject if rays hit crop margins without detecting any real border
  if (bubbleW >= 96 && bubbleH >= 96 && inkBordersHitCount === 0 && !isCleanWhiteBackground && bestBgLum < 165) {
    const bubbleType = classifyTextRegion(rawText, false, textW / textH, bubbleW, bubbleH, yMinPct);
    return {
      isInsideBubble: false,
      bubbleType,
      safeArea: { xMin: xMinPct, xMax: xMaxPct, yMin: yMinPct, yMax: yMaxPct },
      aspectRatio: textW / textH,
      confidence: 0.88
    };
  }

  // Inscribe Safe Translation Area:
  // Bounded within the speech bubble with a clean safety margin (~8%) from borders
  const safeXMin = Math.max(0, bXMinPct + bubbleW * 0.08);
  const safeXMax = Math.min(100, bXMaxPct - bubbleW * 0.08);
  const safeYMin = Math.max(0, bYMinPct + bubbleH * 0.08);
  const safeYMax = Math.min(100, bYMaxPct - bubbleH * 0.08);

  const safeArea: BoundingBox = {
    xMin: safeXMin,
    xMax: safeXMax,
    yMin: safeYMin,
    yMax: safeYMax
  };

  const aspectRatio = bubbleW / Math.max(0.1, bubbleH);
  const bubbleType = classifyTextRegion(rawText, true, aspectRatio, bubbleW, bubbleH, yMinPct);

  return {
    isInsideBubble: true,
    bubbleType,
    bubbleBox: { xMin: bXMinPct, xMax: bXMaxPct, yMin: bYMinPct, yMax: bYMaxPct },
    safeArea,
    bubblePolygon,
    aspectRatio,
    confidence: Math.min(0.99, 0.92 + inkBorderRatio * 0.07)
  };
}

/**
 * Visual Path Barrier Validation:
 * Traces a straight ray through the full-page pixel array between two text centers.
 * Detects:
 * 1. Dark bubble ink contours / panel borders (sharp drop in luminance, gradient >= 25, lum <= 85)
 * 2. Multi-modal valley between two white speech bubbles (passing through dark artwork/gutter lum < 135)
 * 3. Extreme background contrast transitions (crossing from bubble into artwork)
 * If any visual barrier is encountered, returns { hasBarrier: true, reason }
 */
export function hasVisualBarrierBetweenPoints(
  fullPixels: Uint8ClampedArray,
  imageW: number,
  imageH: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  boxA?: { xMin: number; xMax: number; yMin: number; yMax: number },
  boxB?: { xMin: number; xMax: number; yMin: number; yMax: number },
  otherBoxes?: Array<{ xMin: number; xMax: number; yMin: number; yMax: number }>
): { hasBarrier: boolean; reason?: string } {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) return { hasBarrier: false };

  const steps = Math.max(20, Math.min(250, Math.ceil(dist * 1.5)));
  const stepX = dx / steps;
  const stepY = dy / steps;

  function getPixelLum(x: number, y: number): number {
    const px = Math.max(0, Math.min(imageW - 1, Math.round(x)));
    const py = Math.max(0, Math.min(imageH - 1, Math.round(y)));
    const idx = (py * imageW + px) * 4;
    return 0.299 * fullPixels[idx] + 0.587 * fullPixels[idx + 1] + 0.114 * fullPixels[idx + 2];
  }

  // Margin around text boxes to absorb descenders, serifs, punctuation
  function isInsideBox(x: number, y: number, box?: { xMin: number; xMax: number; yMin: number; yMax: number }): boolean {
    if (!box) return false;
    const padX = Math.max(3, (box.xMax - box.xMin) * 0.08);
    const padY = Math.max(4, (box.yMax - box.yMin) * 0.28); // Accommodate descenders, commas, quotes
    return x >= box.xMin - padX && x <= box.xMax + padX && y >= box.yMin - padY && y <= box.yMax + padY;
  }

  function isInsideAnyKnownBox(x: number, y: number): boolean {
    if (isInsideBox(x, y, boxA) || isInsideBox(x, y, boxB)) return true;
    if (otherBoxes && otherBoxes.length > 0) {
      for (let i = 0; i < otherBoxes.length; i++) {
        if (isInsideBox(x, y, otherBoxes[i])) return true;
      }
    }
    return false;
  }

  let minLumInPath = 255;
  let maxGradientInPath = 0;
  let darkPixelStreak = 0;
  let maxDarkPixelStreak = 0;
  let sampledCount = 0;
  let brightPointsCount = 0;
  let sumLum = 0;

  let prevLum = -1;

  for (let s = 1; s < steps; s++) {
    const curX = p1.x + stepX * s;
    const curY = p1.y + stepY * s;

    // CRITICAL: Skip pixels that belong to text glyphs inside boxA, boxB, or intermediate lines!
    if (isInsideAnyKnownBox(curX, curY)) {
      continue;
    }

    const lum = getPixelLum(curX, curY);
    sampledCount++;
    sumLum += lum;

    if (lum >= 155) {
      brightPointsCount++;
    }

    if (lum < minLumInPath) minLumInPath = lum;

    if (prevLum >= 0) {
      const grad = Math.abs(lum - prevLum);
      if (grad > maxGradientInPath) maxGradientInPath = grad;
    }

    if (lum <= 85) {
      darkPixelStreak++;
      if (darkPixelStreak > maxDarkPixelStreak) maxDarkPixelStreak = darkPixelStreak;
    } else {
      darkPixelStreak = 0;
    }

    prevLum = lum;
  }

  // If no inter-box pixels sampled or all points are white bubble canvas (>155), no barrier!
  if (sampledCount === 0) {
    return { hasBarrier: false };
  }

  const avgLum = sumLum / sampledCount;
  const brightRatio = brightPointsCount / sampledCount;

  // 1. Multi-modal artwork valley between two distinct bubbles (substantial dark run in artwork/gutter)
  if (minLumInPath < 110 && maxDarkPixelStreak >= 5) {
    return { hasBarrier: true, reason: "multimodal_artwork_valley" };
  }

  // 2. Thick bubble contour or panel stroke crossed outside of bright continuous canvas
  if (minLumInPath <= 70 && maxDarkPixelStreak >= 3 && brightRatio < 0.80) {
    return { hasBarrier: true, reason: "bubble_contour_or_panel_stroke" };
  }

  // 3. If the path overwhelmingly consists of bright speech bubble canvas (avgLum >= 165 and >75% bright),
  // with no sustained dark contour line, the text segments reside in the same continuous bubble/container!
  if (avgLum >= 165 && brightRatio >= 0.75 && maxDarkPixelStreak < 5) {
    return { hasBarrier: false };
  }

  // 4. Panel border with high gradient in non-bright region:
  if (minLumInPath <= 75 && maxGradientInPath >= 35 && maxDarkPixelStreak >= 2 && brightRatio < 0.65) {
    return { hasBarrier: true, reason: "panel_stroke" };
  }

  return { hasBarrier: false };
}

/**
 * Intelligent Font Size & Typesetting Calculator
 * - Starts with natural, aesthetic reading font size (11.5px - 14px)
 * - Automatically wraps words onto multiple balanced lines
 * - Steps down font size gradually if text is long to fit inside Safe Area
 * - Never makes the font giant for short texts
 */
export function computeSmartTypesetting(
  arabicText: string,
  area: { widthPct: number; heightPct: number },
  canvasW: number,
  canvasH: number,
  isInsideBubble: boolean,
  aspectRatio: number = 1.0,
  textType: string = "dialogue"
): { fontSize: number; lineCount: number; maxCharsPerLine: number } {
  const clean = (arabicText || "").replace(/[\u064B-\u065F]/g, "").trim();
  const wordCount = clean ? clean.split(/\s+/).length : 0;
  const charCount = clean.length;

  if (charCount === 0) {
    return { fontSize: 12.5, lineCount: 1, maxCharsPerLine: 10 };
  }

  const pixelW = Math.max(20, (area.widthPct / 100) * canvasW);
  const pixelH = Math.max(15, (area.heightPct / 100) * canvasH);

  const paddingX = isInsideBubble ? 10 : 4;
  const paddingY = isInsideBubble ? 8 : 4;
  const usableW = Math.max(12, pixelW - paddingX);
  const usableH = Math.max(10, pixelH - paddingY);

  // Natural starting font size based on text type
  let baseFs = 13.0;
  if (textType === "title") baseFs = 17.0;
  else if (textType === "sfx") baseFs = 15.0;
  else if (textType === "outside") baseFs = 12.0;
  else if (textType === "narration") baseFs = 12.5;

  // Estimate line count from aspect ratio and word count
  let estimatedLines = 1;
  if (aspectRatio < 0.65) {
    estimatedLines = Math.max(2, Math.min(7, Math.ceil(wordCount / 1.7)));
  } else if (aspectRatio > 1.8) {
    estimatedLines = Math.max(1, Math.min(4, Math.ceil(wordCount / 4.5)));
  } else {
    estimatedLines = Math.max(1, Math.min(6, Math.ceil(wordCount / 2.6)));
  }

  // Iteratively reduce font size until text height and width fit inside usable area
  let optimalFontSize = baseFs;
  for (let step = 0; step < 12; step++) {
    const avgChars = Math.max(2, Math.ceil(charCount / estimatedLines));
    const estimatedTextW = avgChars * (optimalFontSize * 0.52);
    const estimatedTextH = estimatedLines * (optimalFontSize * 1.38);

    if (estimatedTextW <= usableW && estimatedTextH <= usableH) {
      break; // Fits comfortably!
    }

    if (estimatedTextH > usableH && estimatedLines > 1 && optimalFontSize > 9.0) {
      optimalFontSize -= 0.5;
    } else if (estimatedTextW > usableW && optimalFontSize > 8.5) {
      optimalFontSize -= 0.5;
    } else if (estimatedLines < 7 && optimalFontSize <= 10.0) {
      estimatedLines++;
    } else {
      optimalFontSize = Math.max(8.5, optimalFontSize - 0.5);
    }
  }

  optimalFontSize = Math.max(8.5, Math.min(isInsideBubble ? 15.0 : 16.0, Math.round(optimalFontSize * 10) / 10));

  return {
    fontSize: optimalFontSize,
    lineCount: estimatedLines,
    maxCharsPerLine: Math.max(2, Math.ceil(charCount / estimatedLines))
  };
}

/**
 * Stage 1 to 9: Main Comic Vision OCR & Analysis Pipeline
 * Implements:
 * 1. Image Analysis (dimensions, color, webtoon vs manga).
 * 2. Multi-Pass Adaptive OCR (natural, normalized contrast, scaled 1.5x, inverted dark mode).
 * 3. Multi-Pass Deduplication and Merging.
 * 4. Unicode Character Filtering (Universal \p{L}|\p{N} for all world languages).
 * 5. Advanced Speech Bubble & Enclosure Detection (radial ray casting, borderless detection, tail rejection).
 * 6. Single-Bubble Consolidation (All lines inside same bubble merged into 1 block).
 * 7. Authentic Reading Order Sorting (Japanese Manga RTL, Webtoon vertical, Comics LTR).
 * 8. Arabic Typesetting & Dynamic Safe-Area Allocation.
 * 9. Multi-Entity Collision Avoidance & Physics Relaxation.
 */
export interface ComicPipelineAudit {
  rawSegmentsCount: number;
  deduplicatedSegmentsCount: number;
  validSegmentsCount: number;
  groupedContainersCount: number;
  finalBlocksCount: number;
  droppedItems: { text: string; reason: string }[];
}

export async function analyzeComicPage(
  imageBuffer: Buffer,
  options: ComicAnalysisOptions = {}
): Promise<{ blocks: ComicBlock[]; metadata: { width: number; height: number; isWebtoon: boolean }; audit?: ComicPipelineAudit }> {
  const droppedItems: { text: string; reason: string }[] = [];
  // 1. Inspect image metadata and prepare buffer in one pass
  const sharpImg = sharp(imageBuffer).rotate();
  const { data: normalizedBuffer, info: metadata } = await sharpImg.toBuffer({ resolveWithObject: true });
  const width = metadata.width || 800;
  const height = metadata.height || 1200;

  const isWebtoon = height > 2400;
  const targetLanguage = options.targetLanguage || "Arabic";
  const sourceLang = options.sourceLanguage || "auto";

  console.log(`[ComicVision] Analyzing ${isWebtoon ? "Webtoon strip" : "Comic/Manga page"} (${width}x${height})...`);

  // 2. Multi-Pass Adaptive OCR Engine
  const lens = getLensInstance();
  let candidateSegments: any[] = [];

  if (isWebtoon) {
    // Sliced Webtoon processing in parallel
    const CHUNK_HEIGHT = 2000;
    const OVERLAP = 350;
    const STEP = CHUNK_HEIGHT - OVERLAP;

    const sliceTasks: { y: number; sliceH: number }[] = [];
    for (let y = 0; y < height; y += STEP) {
      const sliceH = Math.min(CHUNK_HEIGHT, height - y);
      if (sliceH <= 80) break;
      sliceTasks.push({ y, sliceH });
    }

    const chunkResults = await Promise.all(
      sliceTasks.map(async ({ y, sliceH }) => {
        try {
          const sliceBuffer = await sharp(normalizedBuffer)
            .extract({ left: 0, top: y, width, height: sliceH })
            .jpeg({ quality: 85 })
            .toBuffer();

          const scanResult = await withRetry<any>(() => lens.scanByBuffer(sliceBuffer));
          const segs = scanResult.segments || [];
          const localSegs: any[] = [];

          for (const seg of segs) {
            const localBox = seg.boundingBox;
            if (!localBox) continue;

            const localCenterY = localBox.centerPerY ?? 0.5;
            const localH = localBox.perHeight ?? 0.02;

            const globalCenterY = (y + localCenterY * sliceH) / height;
            const globalH = (localH * sliceH) / height;

            seg.boundingBox.centerPerY = globalCenterY;
            seg.boundingBox.perHeight = globalH;

            if (seg.boundingBox.pixelCoords) {
              seg.boundingBox.pixelCoords.y += y;
            }

            localSegs.push(seg);
          }
          return localSegs;
        } catch (chunkErr: any) {
          console.warn(`[ComicVision] Webtoon tile at y=${y} notice:`, chunkErr.message || chunkErr);
          return [];
        }
      })
    );

    for (const res of chunkResults) {
      candidateSegments.push(...res);
    }
  } else {
    // Multi-Pass OCR for Single Pages (Manga / Comics)
    // Pass 1: Natural original image with Hierarchical Protobuf extraction
    try {
      const p1Buffer = await sharp(normalizedBuffer).jpeg({ quality: 88 }).toBuffer();
      const p1Hier = await scanLensHierarchical(lens, p1Buffer, width, height, targetLanguage);
      if (p1Hier.allLines && p1Hier.allLines.length > 0) {
        for (const line of p1Hier.allLines) {
          candidateSegments.push({
            text: line.text,
            boundingBox: {
              centerPerX: line.box.centerX / 100,
              centerPerY: line.box.centerY / 100,
              perWidth: line.box.width / 100,
              perHeight: line.box.height / 100,
              pixelCoords: {
                x: Math.round((line.box.xMin / 100) * width),
                y: Math.round((line.box.yMin / 100) * height),
                width: Math.round((line.box.width / 100) * width),
                height: Math.round((line.box.height / 100) * height)
              }
            },
            words: line.words
          });
        }
      } else {
        const p1Res = await withRetry<any>(() => lens.scanByBuffer(p1Buffer));
        if (p1Res.segments && Array.isArray(p1Res.segments)) {
          candidateSegments.push(...p1Res.segments);
        }
      }
    } catch (p1Err: any) {
      console.warn("[ComicVision] Pass 1 (Natural) notice:", p1Err.message || p1Err);
    }

    // Adaptive Evaluation: Only execute enhancement passes if Pass 1 found NO text at all (e.g. difficult screentone or low contrast)
    const needEnhancementPasses = candidateSegments.length === 0;

    if (needEnhancementPasses) {
      // Pass 2: Contrast Enhancement & Normalization (linear stretch + sharpen)
      try {
        const p2Buffer = await sharp(normalizedBuffer)
          .normalize()
          .linear(1.15, -10)
          .jpeg({ quality: 90 })
          .toBuffer();
        const p2Res = await withRetry<any>(() => lens.scanByBuffer(p2Buffer));
        if (p2Res.segments && Array.isArray(p2Res.segments)) {
          candidateSegments.push(...p2Res.segments);
        }
      } catch (p2Err: any) {
        console.warn("[ComicVision] Pass 2 (Contrast) notice:", p2Err.message || p2Err);
      }

      // Pass 3: Scaled Magnification (1.4x scaling for small / dense glyphs and katakana signs)
      if (candidateSegments.length === 0 && width < 1600) {
        try {
          const targetW = Math.min(1600, Math.round(width * 1.45));
          const p3Buffer = await sharp(normalizedBuffer)
            .resize({ width: targetW })
            .sharpen({ sigma: 1.1 })
            .jpeg({ quality: 90 })
            .toBuffer();
          const p3Res = await withRetry<any>(() => lens.scanByBuffer(p3Buffer));
          if (p3Res.segments && Array.isArray(p3Res.segments)) {
            candidateSegments.push(...p3Res.segments);
          }
        } catch (p3Err: any) {
          console.warn("[ComicVision] Pass 3 (Magnification) notice:", p3Err.message || p3Err);
        }
      }
    }
  }

  // 3. Multi-Pass Deduplication and Merging
  // Unify candidates from multiple passes: merge boxes with high IoU or high text similarity
  const deduplicatedSegments: any[] = [];
  for (const cand of candidateSegments) {
    const rawTxt = (cand.text || "").trim();
    if (!rawTxt) continue;
    const box = cand.boundingBox;
    if (!box) continue;

    const cx = box.centerPerX ?? 0.5;
    const cy = box.centerPerY ?? 0.5;
    const w = box.perWidth ?? 0.04;
    const h = box.perHeight ?? 0.02;

    const candX1 = cx - w / 2;
    const candX2 = cx + w / 2;
    const candY1 = cy - h / 2;
    const candY2 = cy + h / 2;

    let matchedIndex = -1;
    for (let i = 0; i < deduplicatedSegments.length; i++) {
      const existing = deduplicatedSegments[i];
      const exBox = existing.boundingBox;
      const exCx = exBox.centerPerX ?? 0.5;
      const exCy = exBox.centerPerY ?? 0.5;
      const exW = exBox.perWidth ?? 0.04;
      const exH = exBox.perHeight ?? 0.02;

      const exX1 = exCx - exW / 2;
      const exX2 = exCx + exW / 2;
      const exY1 = exCy - exH / 2;
      const exY2 = exCy + exH / 2;

      const interX = Math.max(0, Math.min(candX2, exX2) - Math.max(candX1, exX1));
      const interY = Math.max(0, Math.min(candY2, exY2) - Math.max(candY1, exY1));
      const interArea = interX * interY;
      const areaA = w * h;
      const areaB = exW * exH;
      const minArea = Math.min(areaA, areaB);
      const ioMin = minArea > 0 ? interArea / minArea : 0;
      const iou = (areaA + areaB - interArea) > 0 ? interArea / (areaA + areaB - interArea) : 0;
      const distPx = Math.sqrt(Math.pow((cx - exCx) * width, 2) + Math.pow((cy - exCy) * height, 2));

      // Match if high spatial overlap OR one box is largely enclosed inside the other with matching text
      const isContained = ioMin >= 0.70 && (
        rawTxt.includes(existing.text) ||
        existing.text.includes(rawTxt) ||
        textSimilarity(rawTxt, existing.text) > 0.40
      );

      if (iou > 0.45 || isContained || (distPx < 35 && textSimilarity(rawTxt, existing.text) > 0.65)) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex >= 0) {
      // Keep the longer / cleaner text version and expand bounding box
      droppedItems.push({ text: rawTxt, reason: "duplicate_removed" });
      const existing = deduplicatedSegments[matchedIndex];
      if (rawTxt.length > existing.text.length && !existing.text.includes(rawTxt)) {
        existing.text = rawTxt;
      }
      if (cand.words && Array.isArray(cand.words)) {
        existing.words = deduplicateRegionWords([...(existing.words || []), ...cand.words]);
      }
      const exBox = existing.boundingBox;
      const newX1 = Math.min(candX1, exBox.centerPerX - exBox.perWidth / 2);
      const newX2 = Math.max(candX2, exBox.centerPerX + exBox.perWidth / 2);
      const newY1 = Math.min(candY1, exBox.centerPerY - exBox.perHeight / 2);
      const newY2 = Math.max(candY2, exBox.centerPerY + exBox.perHeight / 2);
      exBox.centerPerX = (newX1 + newX2) / 2;
      exBox.centerPerY = (newY1 + newY2) / 2;
      exBox.perWidth = newX2 - newX1;
      exBox.perHeight = newY2 - newY1;
    } else {
      deduplicatedSegments.push(cand);
    }
  }

  // 4. Universal Unicode Glyph Filtering
  // Uses \p{L}|\p{N} to ensure Russian/Cyrillic, Japanese, Korean, Chinese, Arabic, Latin, etc. are all accepted
  const validSegments = deduplicatedSegments.filter((seg: any) => {
    const txt = (seg.text || "").trim();
    if (!txt) {
      droppedItems.push({ text: "", reason: "empty_text" });
      return false;
    }
    const b = seg.boundingBox;
    if (!b) {
      droppedItems.push({ text: txt, reason: "missing_box" });
      return false;
    }
    if (b.perWidth >= 0.90 && b.perHeight >= 0.90) {
      droppedItems.push({ text: txt, reason: "full_page_bounding_box_hallucination" });
      return false;
    }

    // Unicode letter or number detection
    const hasGlyphs = /\p{L}|\p{N}/u.test(txt);
    if (!hasGlyphs && !/^[?!؟!…—~*•-]+$/.test(txt)) {
      droppedItems.push({ text: txt, reason: "non_glyph_symbol_noise" });
      return false;
    }
    if (txt.length <= 1 && b.perWidth < 0.004 && b.perHeight < 0.004) {
      droppedItems.push({ text: txt, reason: "sub_pixel_noise" });
      return false;
    }

    return true;
  });

  console.log(`[ComicVision] Multi-Pass OCR detected ${validSegments.length} valid text segments.`);

  // 4. Extract full page pixels with alpha channel for high-precision visual barrier validation
  const fullRaw = await sharp(normalizedBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fullPixels = new Uint8ClampedArray(fullRaw.data.buffer, fullRaw.data.byteOffset, fullRaw.data.byteLength);

  // 5. Container-First Architecture:
  // Step A: Format segments data
  const segmentsData = validSegments.map((seg: any, idx: number) => {
    const cxPct = (seg.boundingBox?.centerPerX ?? 0.5) * 100;
    const cyPct = (seg.boundingBox?.centerPerY ?? 0.5) * 100;
    const wPct = Math.max(0.6, (seg.boundingBox?.perWidth ?? 0.04) * 100);
    const hPct = Math.max(0.4, (seg.boundingBox?.perHeight ?? 0.02) * 100);

    const x1Pct = Math.max(0, cxPct - wPct / 2);
    const x2Pct = Math.min(100, cxPct + wPct / 2);
    const y1Pct = Math.max(0, cyPct - hPct / 2);
    const y2Pct = Math.min(100, cyPct + hPct / 2);

    return {
      idx,
      text: (seg.text || "").trim(),
      x1Pct,
      y1Pct,
      x2Pct,
      y2Pct,
      wPct,
      hPct,
      cxPct,
      cyPct,
      seg
    };
  });

  // 5. Hierarchical Page Understanding & Manga Region Intelligence:
  // Level 1: Page Dimensions & Flow
  const isRtlReading = options.readingDirection === "rtl" || 
    (options.workType && options.workType.includes("مانجا يابانية")) ||
    (options.sourceLanguage && options.sourceLanguage.includes("ja"));

  // Level 2: Panel Detection Engine (gutters, tiers, individual manga frames)
  const panels = detectPagePanels(fullPixels, width, height, isWebtoon);
  console.log(`[ComicVision] Identified ${panels.length} panel frames on page.`);

  const defaultPanel: Panel = panels[0] || createFullPagePanel(width, height);

  const segmentPanels = new Map<number, Panel>();
  for (const s of segmentsData) {
    const p = findPanelForBox(panels, { xMin: s.x1Pct, xMax: s.x2Pct, yMin: s.y1Pct, yMax: s.y2Pct }) || defaultPanel;
    segmentPanels.set(s.idx, p);
  }

  // Level 3: Physical Speech Bubble & Container Detection
  const segmentBubbles = new Map<number, Bubble | null>();
  const rawBubbles: Bubble[] = [];

  for (let idx = 0; idx < segmentsData.length; idx++) {
    const s = segmentsData[idx];
    const panel = segmentPanels.get(s.idx)!;
    const textX1 = Math.floor((s.x1Pct / 100) * width);
    const textX2 = Math.ceil((s.x2Pct / 100) * width);
    const textY1 = Math.floor((s.y1Pct / 100) * height);
    const textY2 = Math.ceil((s.y2Pct / 100) * height);
    const textW = Math.max(1, textX2 - textX1);
    const textH = Math.max(1, textY2 - textY1);

    const padX = Math.min(Math.floor(width * 0.45), Math.max(textW * 2.2, 100));
    const padY = Math.min(Math.floor(height * 0.45), Math.max(textH * 2.5, 120));

    const cropLeft = Math.max(0, Math.floor(textX1 - padX));
    const cropRight = Math.min(width, Math.ceil(textX2 + padX));
    const cropTop = Math.max(0, Math.floor(textY1 - padY));
    const cropBottom = Math.min(height, Math.ceil(textY2 + padY));

    const cropW = Math.max(20, cropRight - cropLeft);
    const cropH = Math.max(20, cropBottom - cropTop);

    try {
      const cropPixels = new Uint8ClampedArray(cropW * cropH * 4);
      const rowBytes = cropW * 4;
      for (let r = 0; r < cropH; r++) {
        const srcY = cropTop + r;
        if (srcY >= 0 && srcY < height) {
          const srcOffset = (srcY * width + cropLeft) * 4;
          const destOffset = r * rowBytes;
          cropPixels.set(fullPixels.subarray(srcOffset, srcOffset + rowBytes), destOffset);
        }
      }

      const localBox = {
        x1: textX1 - cropLeft,
        y1: textY1 - cropTop,
        x2: textX2 - cropLeft,
        y2: textY2 - cropTop
      };

      const siblingBoxesInCrop = segmentsData
        .filter(other => other.idx !== s.idx)
        .map(other => ({
          x1: Math.floor((other.x1Pct / 100) * width) - cropLeft,
          y1: Math.floor((other.y1Pct / 100) * height) - cropTop,
          x2: Math.ceil((other.x2Pct / 100) * width) - cropLeft,
          y2: Math.ceil((other.y2Pct / 100) * height) - cropTop
        }))
        .filter(b => b.x2 >= 0 && b.x1 <= cropW && b.y2 >= 0 && b.y1 <= cropH);

      const res = detectSpeechBubbleAt(cropPixels, cropW, cropH, localBox, s.text, siblingBoxesInCrop);

      if (res.isInsideBubble && res.bubbleBox && res.bubblePolygon) {
        const globalBubbleBox: BoundingBox = {
          xMin: Math.max(0, ((cropLeft + (res.bubbleBox.xMin / 100) * cropW) / width) * 100),
          xMax: Math.min(100, ((cropLeft + (res.bubbleBox.xMax / 100) * cropW) / width) * 100),
          yMin: Math.max(0, ((cropTop + (res.bubbleBox.yMin / 100) * cropH) / height) * 100),
          yMax: Math.min(100, ((cropTop + (res.bubbleBox.yMax / 100) * cropH) / height) * 100)
        };

        const bW = Math.max(1.0, ((res.safeArea.xMax - res.safeArea.xMin) / 100) * (cropW / width) * 100);
        const bH = Math.max(1.0, ((res.safeArea.yMax - res.safeArea.yMin) / 100) * (cropH / height) * 100);
        const sMinX = Math.max(0, ((cropLeft + (res.safeArea.xMin / 100) * cropW) / width) * 100);
        const sMinY = Math.max(0, ((cropTop + (res.safeArea.yMin / 100) * cropH) / height) * 100);

        const globalSafeArea: TranslationArea = {
          xMin: sMinX,
          xMax: Math.min(100, sMinX + bW),
          yMin: sMinY,
          yMax: Math.min(100, sMinY + bH),
          width: bW,
          height: bH,
          centerX: sMinX + bW / 2,
          centerY: sMinY + bH / 2
        };

        const globalPolygon: PolygonPoint[] = res.bubblePolygon.map(pt => ({
          x: Math.max(0, Math.min(100, ((cropLeft + (pt.x / 100) * cropW) / width) * 100)),
          y: Math.max(0, Math.min(100, ((cropTop + (pt.y / 100) * cropH) / height) * 100))
        }));

        const bubbleId = `bubble_p${panel?.index ?? 1}_${idx + 1}_${Math.round(globalBubbleBox.xMin)}_${Math.round(globalBubbleBox.yMin)}`;
        const bubbleObj: Bubble = {
          id: bubbleId,
          panelId: panel?.id ?? "panel_1",
          box: globalBubbleBox,
          safeArea: globalSafeArea,
          polygon: globalPolygon,
          bubbleType: (res.bubbleType as any) || "dialogue",
          isInsideBubble: true,
          hasBorder: true,
          backgroundColor: "white",
          confidence: res.confidence,
          segmentIndices: [s.idx],
          regionIds: []
        };
        rawBubbles.push(bubbleObj);
        segmentBubbles.set(s.idx, bubbleObj);
      } else {
        segmentBubbles.set(s.idx, null);
      }
    } catch (cropErr: any) {
      console.warn(`[ComicVision] Bubble crop detection notice for seg ${idx}:`, cropErr.message || cropErr);
      segmentBubbles.set(s.idx, null);
    }
  }

  // Unify overlapping bubbles and propagate bubbles to adjacent lines in the same bubble
  for (let a = 0; a < segmentsData.length; a++) {
    for (let b = a + 1; b < segmentsData.length; b++) {
      let bubA = segmentBubbles.get(a);
      let bubB = segmentBubbles.get(b);

      const panelA = segmentPanels.get(a);
      const panelB = segmentPanels.get(b);
      if (panelA && panelB && panelA.id !== panelB.id) continue;

      const segA = segmentsData[a];
      const segB = segmentsData[b];
      const gapY = Math.max(0, Math.max(segA.y1Pct, segB.y1Pct) - Math.min(segA.y2Pct, segB.y2Pct));
      const overlapX = Math.max(0, Math.min(segA.x2Pct, segB.x2Pct) - Math.max(segA.x1Pct, segB.x1Pct));
      const minW = Math.min(segA.wPct, segB.wPct);
      const maxLineH = Math.max(segA.hPct, segB.hPct);
      const maxLineW = Math.max(segA.wPct, segB.wPct);
      const distX = Math.abs(segA.cxPct - segB.cxPct);

      const isStackedBubbleLines = gapY <= Math.max(maxLineH * 3.5, 6.0) && (overlapX >= minW * 0.10 || distX <= Math.max(maxLineW * 0.85, 8.5));

      if (bubA && bubB && bubA.id !== bubB.id) {
        const bA = bubA.box;
        const bB = bubB.box;
        const interX = Math.max(0, Math.min(bA.xMax, bB.xMax) - Math.max(bA.xMin, bB.xMin));
        const interY = Math.max(0, Math.min(bA.yMax, bB.yMax) - Math.max(bA.yMin, bB.yMin));
        const interArea = interX * interY;
        const areaA = (bA.xMax - bA.xMin) * (bA.yMax - bA.yMin);
        const areaB = (bB.xMax - bB.xMin) * (bB.yMax - bB.yMin);
        const minArea = Math.min(areaA, areaB);
        const overlapRatio = minArea > 0 ? interArea / minArea : 0;

        if (overlapRatio >= 0.15 || isStackedBubbleLines) {
          bubA.box.xMin = Math.min(bubA.box.xMin, bubB.box.xMin);
          bubA.box.xMax = Math.max(bubA.box.xMax, bubB.box.xMax);
          bubA.box.yMin = Math.min(bubA.box.yMin, bubB.box.yMin);
          bubA.box.yMax = Math.max(bubA.box.yMax, bubB.box.yMax);
          bubA.safeArea.xMin = Math.min(bubA.safeArea.xMin, bubB.safeArea.xMin);
          bubA.safeArea.xMax = Math.max(bubA.safeArea.xMax, bubB.safeArea.xMax);
          bubA.safeArea.yMin = Math.min(bubA.safeArea.yMin, bubB.safeArea.yMin);
          bubA.safeArea.yMax = Math.max(bubA.safeArea.yMax, bubB.safeArea.yMax);
          bubA.safeArea.width = bubA.safeArea.xMax - bubA.safeArea.xMin;
          bubA.safeArea.height = bubA.safeArea.yMax - bubA.safeArea.yMin;
          bubA.safeArea.centerX = (bubA.safeArea.xMin + bubA.safeArea.xMax) / 2;
          bubA.safeArea.centerY = (bubA.safeArea.yMin + bubA.safeArea.yMax) / 2;
          if (!bubA.segmentIndices.includes(b)) {
            bubA.segmentIndices.push(b);
          }
          segmentBubbles.set(b, bubA);
        }
      } else if (isStackedBubbleLines) {
        // If one segment detected a bubble but the other had ray limits stop early, propagate the bubble!
        if (bubA && !bubB) {
          bubA.box.xMin = Math.min(bubA.box.xMin, segB.x1Pct);
          bubA.box.xMax = Math.max(bubA.box.xMax, segB.x2Pct);
          bubA.box.yMin = Math.min(bubA.box.yMin, segB.y1Pct);
          bubA.box.yMax = Math.max(bubA.box.yMax, segB.y2Pct);
          bubA.safeArea.xMin = Math.min(bubA.safeArea.xMin, segB.x1Pct);
          bubA.safeArea.xMax = Math.max(bubA.safeArea.xMax, segB.x2Pct);
          bubA.safeArea.yMin = Math.min(bubA.safeArea.yMin, segB.y1Pct);
          bubA.safeArea.yMax = Math.max(bubA.safeArea.yMax, segB.y2Pct);
          if (!bubA.segmentIndices.includes(b)) {
            bubA.segmentIndices.push(b);
          }
          segmentBubbles.set(b, bubA);
        } else if (!bubA && bubB) {
          bubB.box.xMin = Math.min(bubB.box.xMin, segA.x1Pct);
          bubB.box.xMax = Math.max(bubB.box.xMax, segA.x2Pct);
          bubB.box.yMin = Math.min(bubB.box.yMin, segA.y1Pct);
          bubB.box.yMax = Math.max(bubB.box.yMax, segA.y2Pct);
          bubB.safeArea.xMin = Math.min(bubB.safeArea.xMin, segA.x1Pct);
          bubB.safeArea.xMax = Math.max(bubB.safeArea.xMax, segA.x2Pct);
          bubB.safeArea.yMin = Math.min(bubB.safeArea.yMin, segA.y1Pct);
          bubB.safeArea.yMax = Math.max(bubB.safeArea.yMax, segA.y2Pct);
          if (!bubB.segmentIndices.includes(a)) {
            bubB.segmentIndices.push(a);
          }
          segmentBubbles.set(a, bubB);
        }
      }
    }
  }

  // Level 4: Graph-Based Text Region Intelligence & Grouping
  const graphResult = executeGraphGrouping(
    segmentsData,
    panels,
    segmentPanels,
    segmentBubbles,
    fullPixels,
    width,
    height,
    isRtlReading
  );

  const clusters: typeof segmentsData[] = graphResult.clusters.map(cIdxs => cIdxs.map(i => segmentsData[i]));

  // 9. Authentic Comic Reading Order
  clusters.sort((c1, c2) => {
    const c1MinY = Math.min(...c1.map(i => i.y1Pct));
    const c2MinY = Math.min(...c2.map(i => i.y1Pct));
    const c1MaxY = Math.max(...c1.map(i => i.y2Pct));
    const c2MaxY = Math.max(...c2.map(i => i.y2Pct));
    const c1MinX = Math.min(...c1.map(i => i.x1Pct));
    const c2MinX = Math.min(...c2.map(i => i.x1Pct));

    const vOverlap = Math.max(0, Math.min(c1MaxY, c2MaxY) - Math.max(c1MinY, c2MinY));
    const minH = Math.min(c1MaxY - c1MinY, c2MaxY - c2MinY);
    const inSameRow = (vOverlap >= minH * 0.40) || (Math.abs(c1MinY - c2MinY) <= 3.2);

    if (!inSameRow) {
      return c1MinY - c2MinY;
    }
    return isRtlReading ? (c2MinX - c1MinX) : (c1MinX - c2MinX);
  });

  // 10. Build Final Comic Blocks with Anchored Translation Positions
  const finalBlocks: ComicBlock[] = clusters.map((cluster, clusterIdx) => {
    // 1. Sort segments within cluster by natural line order
    const clusterSorted = [...cluster].sort((a, b) => {
      // If predominantly vertical CJK, sort columns right-to-left
      if (isRtlReading && a.wPct < a.hPct * 0.8) {
        return b.cxPct - a.cxPct;
      }
      // Horizontal lines sort strictly top-to-bottom
      return a.cyPct - b.cyPct;
    });

    // Collect all words with bounding boxes from segments in the sorted cluster
    const clusterWords: OcrWord[] = [];
    clusterSorted.forEach((seg, lineIdx) => {
      if (seg.seg && seg.seg.words && Array.isArray(seg.seg.words) && seg.seg.words.length > 0) {
        seg.seg.words.forEach((w: any, wIdx: number) => {
          clusterWords.push({
            ...w,
            id: `w_cl_${clusterIdx}_${lineIdx}_${wIdx}`,
            lineIndex: lineIdx
          });
        });
      } else {
        const tokens = (seg.text || "").split(/\s+/).filter(Boolean);
        const totalChars = tokens.reduce((acc: number, t: string) => acc + t.length, 0) || 1;
        let charAcc = 0;
        for (let wIdx = 0; wIdx < tokens.length; wIdx++) {
          const t = tokens[wIdx];
          const sFrac = charAcc / totalChars;
          charAcc += t.length;
          const eFrac = charAcc / totalChars;
          const wXMin = seg.x1Pct + sFrac * seg.wPct;
          const wXMax = seg.x1Pct + eFrac * seg.wPct;
          clusterWords.push({
            id: `w_cl_${clusterIdx}_${lineIdx}_${wIdx}`,
            text: t,
            box: createSpatialBox(wXMin, seg.y1Pct, wXMax, seg.y2Pct),
            lineIndex: lineIdx
          });
        }
      }
    });

    // Geometry-grounded reading order reconstruction & anti-scrambling validation
    const reconstructed = reconstructReadingOrder(clusterWords, {
      preferredDirection: isRtlReading ? "rtl" : "ltr",
      isJapaneseManga: isRtlReading
    });

    // Raw extracted text joined directly from OCR detection (IMMUTABLE 1:1)
    const raw_extracted_text = clusterSorted.map(c => c.text).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const original_text = raw_extracted_text; // IMMUTABLE: 1:1 original text as seen by OCR
    const reconstructed_text = reconstructed.reconstructedText || raw_extracted_text;
    const translation_input_text = reconstructed.translationInputText || reconstructed_text;

    // Exact Bounding Box of the original text
    const tMinX = Math.min(...cluster.map(c => c.x1Pct));
    const tMaxX = Math.max(...cluster.map(c => c.x2Pct));
    const tMinY = Math.min(...cluster.map(c => c.y1Pct));
    const tMaxY = Math.max(...cluster.map(c => c.y2Pct));
    const tWidth = Math.max(0.4, tMaxX - tMinX);
    const tHeight = Math.max(0.4, tMaxY - tMinY);
    const tCenterX = tMinX + tWidth / 2;
    const tCenterY = tMinY + tHeight / 2;

    const original_text_box: BoundingBox = {
      xMin: tMinX,
      xMax: tMaxX,
      yMin: tMinY,
      yMax: tMaxY
    };

    const clusterSeg0 = cluster[0];
    const panel = segmentPanels.get(clusterSeg0.idx) || panels[0];
    const bubble = segmentBubbles.get(clusterSeg0.idx) || null;
    const isInside = Boolean(bubble && bubble.isInsideBubble);
    const parentBubbleId = isInside && bubble ? bubble.id : null;
    const containerId = isInside && bubble ? bubble.id : `outside_p${panel?.index ?? 1}_${clusterIdx + 1}`;

    const isSfx = cluster.some(c => detectIsSfx(c.text));
    const bubbleType = isInside ? (bubble?.bubbleType || "dialogue") : (isSfx ? "sfx" : "outside");

    let finalBubbleBox: BoundingBox | undefined;
    let finalPolygon: PolygonPoint[] | undefined;
    let safeArea: TranslationArea;

    if (isInside && bubble && bubble.box && bubble.safeArea) {
      finalBubbleBox = bubble.box;
      finalPolygon = bubble.polygon;

      const sW = Math.max(1.0, bubble.safeArea.width || (bubble.safeArea.xMax - bubble.safeArea.xMin));
      const sH = Math.max(1.0, bubble.safeArea.height || (bubble.safeArea.yMax - bubble.safeArea.yMin));

      safeArea = {
        xMin: bubble.safeArea.xMin,
        xMax: bubble.safeArea.xMax,
        yMin: bubble.safeArea.yMin,
        yMax: bubble.safeArea.yMax,
        width: sW,
        height: sH,
        centerX: bubble.safeArea.centerX || (bubble.safeArea.xMin + sW / 2),
        centerY: bubble.safeArea.centerY || (bubble.safeArea.yMin + sH / 2)
      };
    } else {
      // Outside text: Safe area is exactly the text box itself
      finalBubbleBox = undefined;
      finalPolygon = undefined;
      safeArea = {
        xMin: tMinX,
        xMax: tMaxX,
        yMin: tMinY,
        yMax: tMaxY,
        width: tWidth,
        height: tHeight,
        centerX: tCenterX,
        centerY: tCenterY
      };
    }

    // Translation Dimensions & Anchored Position
    const wordCount = Math.max(1, original_text.trim().split(/\s+/).length);
    const minArabicLegibleW = Math.min(26.0, Math.max(9.0, 7.5 + Math.min(14, wordCount * 1.3)));

    let transW = tWidth;
    let transH = tHeight;
    let transPosX = tCenterX;
    let transPosY = tCenterY;

    if (isInside) {
      // Use the safe area generously - allow 80% to 92% of the safe translation area width/height
      transW = Math.min(safeArea.width, Math.max(tWidth * 1.25, Math.min(safeArea.width * 0.92, minArabicLegibleW)));
      transH = Math.min(safeArea.height, Math.max(tHeight * 1.2, 3.2));

      // Anchor translation center to original text center, clamped strictly within safe area
      const minCx = safeArea.xMin + transW / 2;
      const maxCx = safeArea.xMax - transW / 2;
      transPosX = minCx > maxCx ? safeArea.centerX : Math.max(minCx, Math.min(maxCx, tCenterX));

      const minCy = safeArea.yMin + transH / 2;
      const maxCy = safeArea.yMax - transH / 2;
      transPosY = minCy > maxCy ? safeArea.centerY : Math.max(minCy, Math.min(maxCy, tCenterY));
    } else {
      // Outside text / Narration: Keep compact to avoid overlapping adjacent bubbles
      transW = Math.min(48.0, Math.max(tWidth * 1.15, Math.min(minArabicLegibleW, 30.0)));
      transH = Math.max(tHeight * 1.1, 2.8);
      // Keep center clamped within page margins
      transPosX = Math.max(transW / 2 + 0.8, Math.min(99.2 - transW / 2, tCenterX));
      transPosY = Math.max(transH / 2 + 0.8, Math.min(99.2 - transH / 2, tCenterY));
    }

    const aspect = transW / Math.max(0.1, transH);
    const typesetting = computeSmartTypesetting(
      original_text,
      { widthPct: transW, heightPct: transH },
      width,
      height,
      isInside,
      aspect,
      bubbleType
    );

    const blockId = `block_${clusterIdx + 1}_${Math.round(tMinX)}_${Math.round(tMinY)}`;

    const translation_bbox: TranslationArea = {
      xMin: Math.max(0, transPosX - transW / 2),
      xMax: Math.min(100, transPosX + transW / 2),
      yMin: Math.max(0, transPosY - transH / 2),
      yMax: Math.min(100, transPosY + transH / 2),
      width: transW,
      height: transH,
      centerX: transPosX,
      centerY: transPosY
    };

    return {
      id: blockId,
      region_id: blockId,
      container_id: containerId,
      parent_bubble_id: parentBubbleId,
      language: sourceLang !== "auto" ? sourceLang : (options.workType && options.workType.includes("كورية") ? "ko" : "ja"),
      original_text,
      originalText: original_text,
      source_text: original_text,
      raw_extracted_text,
      rawExtractedText: raw_extracted_text,
      reconstructed_text,
      reconstructedText: reconstructed_text,
      translation_input_text,
      translationInputText: translation_input_text,
      debug_info: reconstructed.debugInfo,
      word_boxes: reconstructed.wordBoxes,
      line_boxes: reconstructed.lineBoxes,
      validation_info: reconstructed.validationInfo,
      translated_text: "",
      translatedText: "",
      original_text_box,
      source_bbox: original_text_box,
      text_box: original_text_box,
      box: original_text_box,
      source_polygon: finalPolygon,
      bubble_box: finalBubbleBox,
      bubble_polygon: finalPolygon,
      polygon: finalPolygon,
      text_type: bubbleType,
      type: bubbleType,
      panel_id: panel?.id || "panel_0",
      panelId: panel?.id || "panel_0",
      bubble_id: parentBubbleId,
      bubbleId: parentBubbleId,
      confidence: bubble?.confidence || 0.95,
      reading_order: clusterIdx + 1,
      is_inside_bubble: isInside,
      is_sfx: isSfx,
      is_narration: (bubbleType as string) === "narration" || (bubbleType as string) === "narrative",
      is_speech: (bubbleType as string) === "dialogue" || (bubbleType as string) === "bubble" || (bubbleType as string) === "whisper" || (bubbleType as string) === "scream" || (bubbleType as string) === "thought",
      is_outside_text: !isInside,
      text_direction: aspect < 0.65 ? "vertical" : "horizontal",
      safe_translation_area: safeArea,
      translation_safe_area: safeArea,
      safe_area: safeArea,
      translation_area: safeArea,
      translation_bbox,
      translation_position: { x: transPosX, y: transPosY },
      translation_width: transW,
      translation_height: transH,
      x: transPosX,
      y: transPosY,
      width: transW,
      height: transH,
      font_size: typesetting.fontSize,
      source_engine: "comic-vision-v2",
      aspect_ratio: aspect,
      original_pixel_box: {
        x: Math.round((tMinX / 100) * width),
        y: Math.round((tMinY / 100) * height),
        width: Math.round((tWidth / 100) * width),
        height: Math.round((tHeight / 100) * height)
      },
      original_page_size: { width, height },
      is_locked: true
    };
  });

  // Filter out truly empty blocks or isolated single sub-pixel artifact noise
  const cleanBlocks = finalBlocks.filter(b => {
    const txt = (b.original_text || "").trim();
    if (!txt) {
      droppedItems.push({ text: "", reason: "empty_block" });
      return false;
    }
    // Never drop text that was detected inside a speech bubble
    const isInsideBubble = b.is_inside_bubble !== false && (Boolean(b.parent_bubble_id) || Boolean(b.container_id?.startsWith("bubble_")));
    if (isInsideBubble) {
      return true;
    }

    const tW = b.box ? b.box.xMax - b.box.xMin : 0;
    const tH = b.box ? b.box.yMax - b.box.yMin : 0;

    // Preserve all short words, exclamations, SFX, laughter, emotion sounds, and manga punctuation
    if (txt.length <= 2 && !/[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0600-\u06FF]/.test(txt)) {
      const isRecognizedShort = /^(ha|he|ah|oh|eh|um|uh|hm|mm|yo|ya|ow|ew|hi|no|ok|so|go|up|me|my|we|us|to|in|on|at|by|if|or|as|но|да|не|угу|эй|ну|он|мы|вы|ты|я|[?!؟!…—~*•-]+)[!?.~*]*$/i.test(txt);
      if (!isRecognizedShort && (tW < 2.0 && tH < 1.2) && /^\d+$/.test(txt)) {
        droppedItems.push({ text: txt, reason: "noise_filter" });
        return false;
      }
    }
    return true;
  });

  // Speech Bubble Consolidation Pass:
  // Ensure that all lines within a single speech bubble are treated as ONE unit,
  // preventing speech bubbles from being fragmented into multiple independent blocks.
  // Outside text (narration, background text, sfx) are never merged with bubbles.
  const consolidatedBubbleBlocks: ComicBlock[] = [];
  const processedBlockIndices = new Set<number>();

  for (let i = 0; i < cleanBlocks.length; i++) {
    if (processedBlockIndices.has(i)) continue;
    let base = { ...cleanBlocks[i] };

    // Only consider speech bubble blocks for speech bubble consolidation
    const isBaseBubble = base.is_inside_bubble !== false && base.bubble_type !== "outside" && base.bubble_type !== "sfx";

    if (isBaseBubble) {
      for (let j = i + 1; j < cleanBlocks.length; j++) {
        if (processedBlockIndices.has(j)) continue;
        const cand = cleanBlocks[j];
        const isCandBubble = cand.is_inside_bubble !== false && cand.bubble_type !== "outside" && cand.bubble_type !== "sfx";
        if (!isCandBubble) continue;

        // Must be in the same panel
        if (base.panel_index !== undefined && cand.panel_index !== undefined && base.panel_index !== cand.panel_index) {
          continue;
        }

        // Check if both explicitly belong to the exact same parent bubble
        const sameExplicitParent = Boolean(
          base.parent_bubble_id && cand.parent_bubble_id && base.parent_bubble_id === cand.parent_bubble_id
        );
        const sameExplicitContainer = Boolean(
          base.container_id && cand.container_id && base.container_id === cand.container_id && !base.container_id.startsWith("outside_")
        );

        // Check geometric stacking within the same speech bubble
        const boxA = base.box;
        const boxB = cand.box;
        const gapY = Math.max(0, Math.max(boxA.yMin, boxB.yMin) - Math.min(boxA.yMax, boxB.yMax));
        const overlapX = Math.max(0, Math.min(boxA.xMax, boxB.xMax) - Math.max(boxA.xMin, boxB.xMin));
        const minW = Math.min(boxA.xMax - boxA.xMin, boxB.xMax - boxB.xMin);
        const maxH = Math.max(boxA.yMax - boxA.yMin, boxB.yMax - boxB.yMin);
        const cxA = (boxA.xMin + boxA.xMax) / 2;
        const cxB = (boxB.xMin + boxB.xMax) / 2;

        const isStackedInBubble = gapY <= Math.max(maxH * 2.8, 5.0) && (overlapX >= minW * 0.15 || Math.abs(cxA - cxB) <= 5.5);

        // Also check if bubble boundaries overlap
        let bubblesOverlap = false;
        if (base.bubble_box && cand.bubble_box) {
          const bInterX = Math.max(0, Math.min(base.bubble_box.xMax, cand.bubble_box.xMax) - Math.max(base.bubble_box.xMin, cand.bubble_box.xMin));
          const bInterY = Math.max(0, Math.min(base.bubble_box.yMax, cand.bubble_box.yMax) - Math.max(base.bubble_box.yMin, cand.bubble_box.yMin));
          const bInter = bInterX * bInterY;
          const bMinArea = Math.min(
            (base.bubble_box.xMax - base.bubble_box.xMin) * (base.bubble_box.yMax - base.bubble_box.yMin),
            (cand.bubble_box.xMax - cand.bubble_box.xMin) * (cand.bubble_box.yMax - cand.bubble_box.yMin)
          );
          if (bMinArea > 0 && (bInter / bMinArea) >= 0.15) {
            bubblesOverlap = true;
          }
        }

        if (sameExplicitParent || sameExplicitContainer || (isStackedInBubble && bubblesOverlap)) {
          processedBlockIndices.add(j);
          const candBelow = boxB.yMin >= boxA.yMin;

          // Preserve text flow in natural top-to-bottom reading order within the speech bubble
          const isCjk = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test((base.original_text || "") + (cand.original_text || ""));
          const sep = isCjk ? "" : " ";

          const baseTxt = (base.original_text || "").trim();
          const candTxt = (cand.original_text || "").trim();
          if (baseTxt.toLowerCase() !== candTxt.toLowerCase()) {
            base.original_text = candBelow ? `${baseTxt}${sep}${candTxt}` : `${candTxt}${sep}${baseTxt}`;
            base.reconstructed_text = base.original_text;
            base.translation_input_text = base.original_text;
          }

          // Unify bounding box
          base.box = {
            xMin: Math.min(boxA.xMin, boxB.xMin),
            xMax: Math.max(boxA.xMax, boxB.xMax),
            yMin: Math.min(boxA.yMin, boxB.yMin),
            yMax: Math.max(boxA.yMax, boxB.yMax),
          };

          if (base.original_text_box && cand.original_text_box) {
            base.original_text_box = {
              xMin: Math.min(base.original_text_box.xMin, cand.original_text_box.xMin),
              xMax: Math.max(base.original_text_box.xMax, cand.original_text_box.xMax),
              yMin: Math.min(base.original_text_box.yMin, cand.original_text_box.yMin),
              yMax: Math.max(base.original_text_box.yMax, cand.original_text_box.yMax),
            };
          } else {
            base.original_text_box = { ...base.box };
          }

          if (base.bubble_box && cand.bubble_box) {
            base.bubble_box = {
              xMin: Math.min(base.bubble_box.xMin, cand.bubble_box.xMin),
              xMax: Math.max(base.bubble_box.xMax, cand.bubble_box.xMax),
              yMin: Math.min(base.bubble_box.yMin, cand.bubble_box.yMin),
              yMax: Math.max(base.bubble_box.yMax, cand.bubble_box.yMax),
            };
          }

          if (base.safe_area && cand.safe_area) {
            const sXMin = Math.min(base.safe_area.xMin, cand.safe_area.xMin);
            const sXMax = Math.max(base.safe_area.xMax, cand.safe_area.xMax);
            const sYMin = Math.min(base.safe_area.yMin, cand.safe_area.yMin);
            const sYMax = Math.max(base.safe_area.yMax, cand.safe_area.yMax);
            base.safe_area = {
              xMin: sXMin,
              xMax: sXMax,
              yMin: sYMin,
              yMax: sYMax,
              width: sXMax - sXMin,
              height: sYMax - sYMin,
              centerX: (sXMin + sXMax) / 2,
              centerY: (sYMin + sYMax) / 2,
            };
          }

          if (Array.isArray(cand.word_boxes) && Array.isArray(base.word_boxes)) {
            base.word_boxes = candBelow ? [...base.word_boxes, ...cand.word_boxes] : [...cand.word_boxes, ...base.word_boxes];
          }

          // Recalculate pixel coordinates
          const tW = base.box.xMax - base.box.xMin;
          const tH = base.box.yMax - base.box.yMin;
          base.original_coordinates = {
            x: Math.round((base.box.xMin / 100) * width),
            y: Math.round((base.box.yMin / 100) * height),
            width: Math.round((tW / 100) * width),
            height: Math.round((tH / 100) * height),
          };
        }
      }
    }
    consolidatedBubbleBlocks.push(base);
  }

  // Global Page Flow Ordering: Order blocks across panels without modifying internal texts
  const sorted = sortBlocksByReadingOrder(consolidatedBubbleBlocks, isRtlReading);
  const orderedBlocks = sorted.map((b, orderIdx) => {
    const regionId = `region_${String(orderIdx + 1).padStart(3, '0')}`;
    return {
      ...b,
      id: regionId,
      region_id: regionId,
      block_id: regionId,
      reading_order: orderIdx + 1,
    };
  });

  const audit: ComicPipelineAudit = {
    rawSegmentsCount: candidateSegments.length,
    deduplicatedSegmentsCount: deduplicatedSegments.length,
    validSegmentsCount: validSegments.length,
    groupedContainersCount: graphResult.clusters.length,
    finalBlocksCount: orderedBlocks.length,
    droppedItems
  };

  console.log(`[ComicVision] Produced ${orderedBlocks.length} structured dialogue blocks in reading order.`);
  return { blocks: orderedBlocks, metadata: { width, height, isWebtoon }, audit };
}

/**
 * Re-run OCR on a specific isolated bounding box region (with language fallback)
 * Fulfills: "أضف إمكانية إعادة OCR لمنطقة محددة عند الحاجة"
 */
export async function reOcrRegion(
  imageBuffer: Buffer,
  regionBox: BoundingBox,
  options: { language?: string; engine?: "lens" | "tesseract" | "auto" } = {}
): Promise<{ text: string; confidence: number; engineUsed: string }> {
  try {
    const meta = await sharp(imageBuffer).metadata();
    const w = meta.width || 800;
    const h = meta.height || 1200;

    const left = Math.max(0, Math.floor((regionBox.xMin / 100) * w));
    const top = Math.max(0, Math.floor((regionBox.yMin / 100) * h));
    const extractW = Math.min(w - left, Math.max(10, Math.ceil(((regionBox.xMax - regionBox.xMin) / 100) * w)));
    const extractH = Math.min(h - top, Math.max(10, Math.ceil(((regionBox.yMax - regionBox.yMin) / 100) * h)));

    // Crop the specific region with slight padding
    const croppedBuffer = await sharp(imageBuffer)
      .extract({ left, top, width: extractW, height: extractH })
      .jpeg({ quality: 95 })
      .toBuffer();

    const targetLang = options.language || "eng";

    // Attempt 1: Tesseract for specific language
    if (options.engine === "tesseract" || options.engine === "auto") {
      const worker = await getTesseractWorker(targetLang);
      if (worker) {
        const ret = await worker.recognize(croppedBuffer);
        const txt = (ret.data?.text || "").trim();
        if (txt) {
          return {
            text: txt,
            confidence: (ret.data?.confidence || 80) / 100,
            engineUsed: "tesseract"
          };
        }
      }
    }

    // Attempt 2: Lens OCR on cropped region with spatial reconstruction
    const lens = getLensInstance();
    const hier = await scanLensHierarchical(lens, croppedBuffer, extractW, extractH, targetLang);
    if (hier.allWords && hier.allWords.length > 0) {
      const reconstructed = reconstructReadingOrder(hier.allWords, {
        preferredDirection: targetLang.includes("ara") ? "rtl" : "ltr"
      });
      return {
        text: reconstructed.reconstructedText || hier.allWords.map(w => w.text).join(" ").trim(),
        confidence: 0.92,
        engineUsed: "lens-hierarchical"
      };
    }

    const scan = await withRetry<any>(() => lens.scanByBuffer(croppedBuffer));
    const txt = (scan.segments || []).map((s: any) => s.text).join(" ").trim();

    return {
      text: txt || "",
      confidence: txt ? 0.88 : 0.2,
      engineUsed: "lens"
    };
  } catch (err: any) {
    console.warn("[ComicVision] Re-OCR region error:", err.message || err);
    return { text: "", confidence: 0.1, engineUsed: "fallback" };
  }
}

/**
 * Text Inpainting: Removes original foreign text from the comic page
 * Inside speech bubbles: fills text boxes with sampled bubble interior color, keeping comic art untouched.
 * Outside bubbles: applies localized median patch synthesis to eliminate glyphs without touching surrounding illustrations.
 */
export async function inpaintPageText(
  imageBuffer: Buffer,
  blocks: ComicBlock[]
): Promise<Buffer> {
  return await hybridInpaintPageText(imageBuffer, blocks);
}

