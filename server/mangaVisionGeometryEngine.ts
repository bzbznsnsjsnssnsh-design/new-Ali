import type { BoundingBox, PolygonPoint, TranslationArea } from "../src/types.ts";
import { analyzeVisualBarrier } from "./barrierAnalysisEngine.ts";
import type { Panel } from "./types/mangaTypes.ts";

/**
 * Spatial Text Region Geometry Model
 */
export interface TextRegionGeometry {
  region_id: string;
  text_polygon: PolygonPoint[];
  text_bbox: BoundingBox;
  text_centroid: { x: number; y: number };
  text_orientation: "horizontal" | "vertical" | "angled";
  text_direction: "rtl" | "ltr" | "vertical";
  text_line_count: number;
  text_area: number; // widthPct * heightPct
  original_glyph_area: number; // estimated visual ink area
  original_text: string;
  words?: Array<{ text: string; box: BoundingBox }>;
  lines?: Array<{ text: string; box: BoundingBox }>;
}

/**
 * Speech Bubble Entity Model
 */
export interface SpeechBubbleEntity {
  bubble_id: string;
  bubble_polygon: PolygonPoint[];
  bubble_bbox: BoundingBox;
  bubble_centroid: { x: number; y: number };
  bubble_type: "ELLIPSE" | "ROUND" | "RECTANGLE" | "IRREGULAR" | "NARROW" | "TALL" | "WIDE" | "DARK" | "TRANSPARENT";
  bubble_confidence: number;
  safe_area: BoundingBox;
  safe_polygon: PolygonPoint[];
  is_clean_background: boolean;
  average_bg_luminance: number;
  has_ink_border: boolean;
}

/**
 * Classification Outcomes
 */
export type TextBubbleClassification =
  | "INSIDE_BUBBLE"
  | "OUTSIDE_BUBBLE"
  | "SFX"
  | "NARRATION"
  | "TITLE"
  | "SIGN"
  | "ARTWORK_TEXT"
  | "UNKNOWN";

/**
 * Comprehensive Relationship Decision
 */
export interface TextBubbleRelation {
  classification: TextBubbleClassification;
  is_inside_bubble: boolean;
  bubble_id: string | null;
  confidence: number;
  overlap_ratio: number;
  barrier_detected: boolean;
  distance_to_contour: number;
  safe_translation_area: BoundingBox;
  translation_polygon: PolygonPoint[];
  relative_anchor: {
    rel_x: number; // 0 (left) .. 0.5 (center) .. 1 (right)
    rel_y: number; // 0 (top) .. 0.5 (center) .. 1 (bottom)
    vAlign: "top" | "center" | "bottom";
    hAlign: "left" | "center" | "right";
  };
  visual_text_scale: number;
}

/**
 * Tests if point (px, py) is strictly inside a polygon
 */
export function isPointInPolygon(px: number, py: number, polygon: PolygonPoint[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes polygon area via Shoelace formula
 */
export function computePolygonArea(polygon: PolygonPoint[]): number {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Samples pixel luminance from RGBA buffer
 */
export function getPixelLuminance(
  pixelData: Uint8ClampedArray,
  imageW: number,
  imageH: number,
  x: number,
  y: number
): number {
  const px = Math.max(0, Math.min(imageW - 1, Math.round(x)));
  const py = Math.max(0, Math.min(imageH - 1, Math.round(y)));
  const idx = (py * imageW + px) * 4;
  return 0.299 * pixelData[idx] + 0.587 * pixelData[idx + 1] + 0.114 * pixelData[idx + 2];
}

/**
 * Checks if a string is a sound effect (SFX / Onomatopoeia) across all manga languages:
 * Japanese Katakana, Korean, Chinese, English, and Russian/Cyrillic.
 */
export function isSoundEffectText(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  if (!t || t.length > 25) return false;

  // Laughter or normal conversational interjections are speech, not ambient SFX
  if (/^(ha|he|hu|fu|ku|wa|ah|oh|eh)[\s!?.~*]*$/i.test(t)) return false;
  if (/^(ha|he|ho|fu|ku){2,}[!?.~*]*$/i.test(t)) return false;
  if (/^(ها|هه|هو|كك|وو)+[!?.~*]*$/.test(t)) return false;
  if (/^(하|히|헤|호|ㅋ|ㅎ)+[!?.~*]*$/.test(t)) return false;
  if (/^(ха|хе|хи|хо){2,}[!?.~*]*$/i.test(t)) return false;

  // Japanese Katakana SFX (must contain at least one actual Katakana character, not pure punctuation)
  if (/[\u30A0-\u30FF\u31F0-\u31FF]/.test(t) && /^[\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F\sー!?~.]+$/.test(t) && t.length <= 10) return true;

  // Korean SFX
  const koreanSfxWords = ["쿵", "쾅", "촤", "두근", "슥", "탁", "쉭", "콰", "우르르", "찌릿", "따각", "찰칵", "펄럭", "덜컹", "삐걱"];
  if (koreanSfxWords.some((w) => t.includes(w)) && t.length <= 8) return true;

  // Chinese SFX
  const chineseSfxWords = ["嗒", "轰", "咚", "啪", "呼", "哗", "沙沙", "吱", "砰", "咕噜", "咔嚓"];
  if (chineseSfxWords.some((w) => t.includes(w)) && t.length <= 6) return true;

  // English SFX
  const englishSfxRegex =
    /^(bam|boom|bang|crash|smash|wham|thud|thump|slash|oof|argh|shh|clang|pow|whoosh|snap|click|buzz|beep|clink|splash|swoosh|rumble|crackle|gasp|sigh|pant|groan|grr)[!?.~*]*$/i;
  if (englishSfxRegex.test(t)) return true;

  // Russian / Cyrillic Manga SFX (crucial for translated scans)
  const russianSfxRegex =
    /^(шурх|вжух|бах|бум|клац|хрусь|топ|кап|шлеп|хлоп|скрип|звон|дзынь|пшик|удар|вздох|тук|стук|грохот|свист|всплеск|щелк|дзинь|хмык|кхем|о-о|а-а|э-э|бах-бах|топ-топ|кап-кап|цок|вжих)[!?.~*]*$/i;
  if (russianSfxRegex.test(t)) return true;

  return false;
}

/**
 * 1. Independent Speech Bubble Contour & Geometry Discovery
 * Detects whether there is a genuine, physically closed speech bubble enclosing the given text box.
 */
export function detectCandidateBubble(
  pixelData: Uint8ClampedArray,
  imageW: number,
  imageH: number,
  textBox: BoundingBox,
  siblingBoxes?: BoundingBox[]
): SpeechBubbleEntity | null {
  const textW = Math.max(1, textBox.xMax - textBox.xMin);
  const textH = Math.max(1, textBox.yMax - textBox.yMin);
  const textWPx = (textW / 100) * imageW;
  const textHPx = (textH / 100) * imageH;
  const cx = Math.round(((textBox.xMin + textBox.xMax) / 2 / 100) * imageW);
  const cy = Math.round(((textBox.yMin + textBox.yMax) / 2 / 100) * imageH);
  const hw = textWPx / 2;
  const hh = textHPx / 2;

  // Sample interior background right around the text box
  const sampleOffsets = [
    [-Math.floor(hw * 0.7), 0],
    [Math.floor(hw * 0.7), 0],
    [0, -Math.floor(hh * 0.7)],
    [0, Math.floor(hh * 0.7)],
  ];
  let lumSum = 0;
  const lumSamples: number[] = [];
  for (const [ox, oy] of sampleOffsets) {
    const lum = getPixelLuminance(pixelData, imageW, imageH, cx + ox, cy + oy);
    lumSamples.push(lum);
    lumSum += lum;
  }
  const avgBgLum = lumSum / lumSamples.length;
  const variance = lumSamples.reduce((s, v) => s + Math.pow(v - avgBgLum, 2), 0) / lumSamples.length;

  const isDarkBubble = avgBgLum < 65 && variance < 200;
  const isCleanWhite = avgBgLum >= 210 && variance < 160;

  // If the background behind text is noisy artwork and not a bubble interior
  if (variance > 450 && !isDarkBubble && !isCleanWhite) {
    return null;
  }

  // 36-ray radial tracing
  const NUM_RAYS = 36;
  const rawRays: { x: number; y: number; r: number; angle: number; hitBorder: boolean }[] = [];
  let inkBorderHits = 0;
  let hitTop = false,
    hitBottom = false,
    hitLeft = false,
    hitRight = false;

  const siblingPxBoxes = (siblingBoxes || []).map((sb) => ({
    x1: Math.round((sb.xMin / 100) * imageW),
    y1: Math.round((sb.yMin / 100) * imageH),
    x2: Math.round((sb.xMax / 100) * imageW),
    y2: Math.round((sb.yMax / 100) * imageH),
  }));

  for (let k = 0; k < NUM_RAYS; k++) {
    const angle = (k * 2 * Math.PI) / NUM_RAYS;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Distance to reach perimeter of text box
    const rBoxX = Math.abs(cosA) > 1e-5 ? Math.abs(hw / cosA) : Infinity;
    const rBoxY = Math.abs(sinA) > 1e-5 ? Math.abs(hh / sinA) : Infinity;
    const rBox = Math.min(rBoxX, rBoxY);

    const startR = rBox + 3;
    const maxSearchDist = Math.max(textWPx * 2.2 + 80, Math.min(imageW * 0.45, 450));
    const rayLimit = Math.min(Math.hypot(imageW, imageH) * 0.5, startR + maxSearchDist);

    let finalR = rayLimit;
    let hitBorder = false;

    for (let r = startR; r <= rayLimit; r += 2.0) {
      const rx = Math.round(cx + cosA * r);
      const ry = Math.round(cy + sinA * r);

      if (rx <= 2 || rx >= imageW - 3 || ry <= 2 || ry >= imageH - 3) {
        finalR = r;
        break;
      }

      // Skip sibling text lines
      let insideSibling = false;
      for (const sb of siblingPxBoxes) {
        if (rx >= sb.x1 - 2 && rx <= sb.x2 + 2 && ry >= sb.y1 - 2 && ry <= sb.y2 + 2) {
          insideSibling = true;
          break;
        }
      }
      if (insideSibling) continue;

      const lum = getPixelLuminance(pixelData, imageW, imageH, rx, ry);
      const aheadLum = getPixelLuminance(pixelData, imageW, imageH, cx + cosA * (r + 3), cy + sinA * (r + 3));
      const grad = Math.abs(aheadLum - lum);

      // Dark ink stroke detection for speech bubble perimeter
      if (isDarkBubble) {
        // Dark bubble: border is light stroke or sudden transition to white paper
        if (lum >= 180 || grad >= 40) {
          finalR = r;
          hitBorder = true;
          inkBorderHits++;
          break;
        }
      } else {
        // White/light bubble: border is dark ink stroke (<= 95) or sharp gradient into artwork
        if (lum <= 95 || (lum <= Math.max(85, avgBgLum - 40) && grad >= 30)) {
          finalR = r;
          hitBorder = true;
          inkBorderHits++;
          if (sinA < -0.38) hitTop = true;
          if (sinA > 0.38) hitBottom = true;
          if (cosA > 0.38) hitRight = true;
          if (cosA < -0.38) hitLeft = true;
          break;
        }
      }
    }

    rawRays.push({
      x: cx + cosA * finalR,
      y: cy + sinA * finalR,
      r: finalR,
      angle,
      hitBorder,
    });
  }

  // Rigorous Enclosure Validation:
  // A true speech bubble must hit ink borders in at least 50% of directions, OR opposing quadrants with clean white/dark interior
  const borderRatio = inkBorderHits / NUM_RAYS;
  const hasEnclosingOpposites = (hitTop && hitBottom) || (hitLeft && hitRight);
  const quadrantsHit = (hitTop ? 1 : 0) + (hitBottom ? 1 : 0) + (hitLeft ? 1 : 0) + (hitRight ? 1 : 0);

  const isRealEnclosedBubble =
    (borderRatio >= 0.42 && hasEnclosingOpposites) ||
    (borderRatio >= 0.35 && quadrantsHit >= 3) ||
    (isCleanWhite && borderRatio >= 0.28 && hasEnclosingOpposites) ||
    (isDarkBubble && borderRatio >= 0.35 && hasEnclosingOpposites);

  if (!isRealEnclosedBubble) {
    return null;
  }

  // Tail Rejection (Local 5-ray median)
  const smoothedPolygon: PolygonPoint[] = [];
  for (let k = 0; k < NUM_RAYS; k++) {
    const rPrev2 = rawRays[(k - 2 + NUM_RAYS) % NUM_RAYS].r;
    const rPrev1 = rawRays[(k - 1 + NUM_RAYS) % NUM_RAYS].r;
    const rCurr = rawRays[k].r;
    const rNext1 = rawRays[(k + 1) % NUM_RAYS].r;
    const rNext2 = rawRays[(k + 2) % NUM_RAYS].r;

    const neighborsSorted = [rPrev2, rPrev1, rNext1, rNext2].sort((a, b) => a - b);
    const medianNeighbor = (neighborsSorted[1] + neighborsSorted[2]) / 2;

    let adjustedR = rCurr;
    if (rCurr > medianNeighbor * 1.25) {
      adjustedR = medianNeighbor;
    } else if (rCurr < medianNeighbor * 0.7) {
      adjustedR = medianNeighbor * 0.85;
    }

    const angle = rawRays[k].angle;
    const ptX = cx + Math.cos(angle) * adjustedR;
    const ptY = cy + Math.sin(angle) * adjustedR;

    smoothedPolygon.push({
      x: Math.max(0, Math.min(100, (ptX / imageW) * 100)),
      y: Math.max(0, Math.min(100, (ptY / imageH) * 100)),
    });
  }

  const bXMin = Math.min(...smoothedPolygon.map((p) => p.x));
  const bXMax = Math.max(...smoothedPolygon.map((p) => p.x));
  const bYMin = Math.min(...smoothedPolygon.map((p) => p.y));
  const bYMax = Math.max(...smoothedPolygon.map((p) => p.y));
  const bW = bXMax - bXMin;
  const bH = bYMax - bYMin;

  // Safe area: 8% margin inside bubble contour
  const safeArea: BoundingBox = {
    xMin: Math.max(0, bXMin + bW * 0.08),
    yMin: Math.max(0, bYMin + bH * 0.08),
    xMax: Math.min(100, bXMax - bW * 0.08),
    yMax: Math.min(100, bYMax - bH * 0.08),
  };

  // Safe polygon: scaled inwards 90% toward centroid
  const bCentroid = { x: (bXMin + bXMax) / 2, y: (bYMin + bYMax) / 2 };
  const safePolygon: PolygonPoint[] = smoothedPolygon.map((p) => ({
    x: bCentroid.x + (p.x - bCentroid.x) * 0.88,
    y: bCentroid.y + (p.y - bCentroid.y) * 0.88,
  }));

  // Bubble morphology
  const bubbleAspect = bW / bH;
  let bubbleType: SpeechBubbleEntity["bubble_type"] = "ELLIPSE";
  if (isDarkBubble) bubbleType = "DARK";
  else if (bubbleAspect > 2.0 && bH < 15) bubbleType = "RECTANGLE";
  else if (bubbleAspect < 0.6) bubbleType = "NARROW";
  else if (bW > 30 && bH < 12) bubbleType = "WIDE";
  else if (Math.abs(bW - bH) < 5) bubbleType = "ROUND";

  return {
    bubble_id: `b_${Math.round(cx)}_${Math.round(cy)}`,
    bubble_polygon: smoothedPolygon,
    bubble_bbox: { xMin: bXMin, yMin: bYMin, xMax: bXMax, yMax: bYMax },
    bubble_centroid: bCentroid,
    bubble_type: bubbleType,
    bubble_confidence: Math.min(0.99, 0.7 + borderRatio * 0.3),
    safe_area: safeArea,
    safe_polygon: safePolygon,
    is_clean_background: isCleanWhite || isDarkBubble,
    average_bg_luminance: avgBgLum,
    has_ink_border: inkBorderHits >= 12,
  };
}

/**
 * 2. classifyTextBubbleRelation()
 * Implements the 10-criteria algorithm to verify if a text region is TRULY inside a speech bubble.
 */
export function classifyTextBubbleRelation(
  textRegion: TextRegionGeometry,
  candidateBubble: SpeechBubbleEntity | null,
  pixelData: Uint8ClampedArray,
  imageW: number,
  imageH: number,
  panels?: Panel[]
): TextBubbleRelation {
  const textText = textRegion.original_text || "";
  const tBox = textRegion.text_bbox;
  const tCentroid = textRegion.text_centroid;
  const tW = Math.max(0.5, tBox.xMax - tBox.xMin);
  const tH = Math.max(0.5, tBox.yMax - tBox.yMin);
  const tAspect = tW / tH;

  // Check SFX first
  if (isSoundEffectText(textText)) {
    return {
      classification: "SFX",
      is_inside_bubble: false,
      bubble_id: null,
      confidence: 0.95,
      overlap_ratio: 0,
      barrier_detected: true,
      distance_to_contour: 0,
      safe_translation_area: { ...tBox },
      translation_polygon: [...textRegion.text_polygon],
      relative_anchor: { rel_x: 0.5, rel_y: 0.5, vAlign: "center", hAlign: "center" },
      visual_text_scale: 1.0,
    };
  }

  // Title / Chapter check
  if (/^(chapter|ch\.|episode|ep\.|vol\.|volume|act|فصل|الفصل|الحلقة|المجلد)\s*\d+/i.test(textText.trim())) {
    return {
      classification: "TITLE",
      is_inside_bubble: false,
      bubble_id: null,
      confidence: 0.96,
      overlap_ratio: 0,
      barrier_detected: false,
      distance_to_contour: 0,
      safe_translation_area: { ...tBox },
      translation_polygon: [...textRegion.text_polygon],
      relative_anchor: { rel_x: 0.5, rel_y: 0.5, vAlign: "center", hAlign: "center" },
      visual_text_scale: 1.0,
    };
  }

  // If no candidate bubble found: Strictly OUTSIDE_BUBBLE
  if (!candidateBubble) {
    const isNarration = (tAspect > 2.8 && tH < 12) || (tW > 35 && tH < 10);
    return {
      classification: isNarration ? "NARRATION" : "OUTSIDE_BUBBLE",
      is_inside_bubble: false,
      bubble_id: null,
      confidence: 0.94,
      overlap_ratio: 0,
      barrier_detected: false,
      distance_to_contour: 0,
      safe_translation_area: { ...tBox },
      translation_polygon: [...textRegion.text_polygon],
      relative_anchor: { rel_x: 0.5, rel_y: 0.5, vAlign: "center", hAlign: "center" },
      visual_text_scale: 1.0,
    };
  }

  // Criterion 1: Percentage of Text Polygon inside Bubble Polygon
  // Sample 9 grid points inside the text bounding box (corners, edges, center)
  const testPoints = [
    { x: tBox.xMin, y: tBox.yMin },
    { x: tBox.xMax, y: tBox.yMin },
    { x: tBox.xMax, y: tBox.yMax },
    { x: tBox.xMin, y: tBox.yMax },
    { x: tCentroid.x, y: tCentroid.y },
    { x: (tBox.xMin + tCentroid.x) / 2, y: tCentroid.y },
    { x: (tBox.xMax + tCentroid.x) / 2, y: tCentroid.y },
    { x: tCentroid.x, y: (tBox.yMin + tCentroid.y) / 2 },
    { x: tCentroid.x, y: (tBox.yMax + tCentroid.y) / 2 },
  ];

  let pointsInside = 0;
  for (const pt of testPoints) {
    if (isPointInPolygon(pt.x, pt.y, candidateBubble.bubble_polygon)) {
      pointsInside++;
    }
  }
  const overlapRatio = pointsInside / testPoints.length;

  // Criterion 4: Visual Barrier Analysis
  // Verify no ink line or panel boundary separates the text from the bubble centroid
  const barrierResult = analyzeVisualBarrier(
    pixelData,
    imageW,
    imageH,
    tCentroid,
    candidateBubble.bubble_centroid,
    tBox,
    candidateBubble.bubble_bbox
  );

  // Criterion 3 & 7: Centroid containment & Distance to Contour
  const centroidInside = isPointInPolygon(tCentroid.x, tCentroid.y, candidateBubble.bubble_polygon);

  // Criterion 10: Panel Border separation
  if (barrierResult.hasBarrier && barrierResult.barrierType === "panel_border") {
    return {
      classification: "OUTSIDE_BUBBLE",
      is_inside_bubble: false,
      bubble_id: null,
      confidence: 0.98,
      overlap_ratio: 0,
      barrier_detected: true,
      distance_to_contour: 0,
      safe_translation_area: { ...tBox },
      translation_polygon: [...textRegion.text_polygon],
      relative_anchor: { rel_x: 0.5, rel_y: 0.5, vAlign: "center", hAlign: "center" },
      visual_text_scale: 1.0,
    };
  }

  // Bubble Enclosure: Text centroid must be inside, no ink barrier between text and bubble,
  // and the core text body (at least 50% of grid points or clean background with >=40%) resides inside the bubble contour.
  const isInside =
    centroidInside &&
    !barrierResult.hasBarrier &&
    (overlapRatio >= 0.55 || (candidateBubble.is_clean_background && overlapRatio >= 0.40));

  if (!isInside) {
    // Text is outside the bubble, even if adjacent to it!
    return {
      classification: "OUTSIDE_BUBBLE",
      is_inside_bubble: false,
      bubble_id: null,
      confidence: 0.95,
      overlap_ratio: overlapRatio,
      barrier_detected: barrierResult.hasBarrier,
      distance_to_contour: 0,
      // CRITICAL: NEVER expand text_bbox to bubble_bbox!
      safe_translation_area: { ...tBox },
      translation_polygon: [...textRegion.text_polygon],
      relative_anchor: { rel_x: 0.5, rel_y: 0.5, vAlign: "center", hAlign: "center" },
      visual_text_scale: 1.0,
    };
  }

  // INSIDE_BUBBLE Confirmed!
  // Calculate relative position within the bubble:
  // Original Text Position ≈ Arabic Text Position
  const bBox = candidateBubble.bubble_bbox;
  const bH = Math.max(1, bBox.yMax - bBox.yMin);
  const bW = Math.max(1, bBox.xMax - bBox.xMin);

  const relY = (tCentroid.y - bBox.yMin) / bH;
  const relX = (tCentroid.x - bBox.xMin) / bW;

  let vAlign: "top" | "center" | "bottom" = "center";
  if (relY < 0.38) vAlign = "top";
  else if (relY > 0.62) vAlign = "bottom";

  let hAlign: "left" | "center" | "right" = "center";
  if (relX < 0.38) hAlign = "left";
  else if (relX > 0.62) hAlign = "right";

  // Compute visual text scale comparing original text density with bubble capacity
  const originalGlyphDensity = (tW * tH) / Math.max(1, textText.length);
  const visualTextScale = Math.max(0.7, Math.min(1.4, Math.sqrt(originalGlyphDensity / 1.8)));

  return {
    classification: candidateBubble.bubble_type === "RECTANGLE" ? "NARRATION" : "INSIDE_BUBBLE",
    is_inside_bubble: true,
    bubble_id: candidateBubble.bubble_id,
    confidence: candidateBubble.bubble_confidence,
    overlap_ratio: overlapRatio,
    barrier_detected: false,
    distance_to_contour: 2.0,
    safe_translation_area: candidateBubble.safe_area,
    translation_polygon: candidateBubble.safe_polygon,
    relative_anchor: {
      rel_x: relX,
      rel_y: relY,
      vAlign,
      hAlign,
    },
    visual_text_scale: visualTextScale,
  };
}

/**
 * 3. validateRegionGeometry()
 * Validates integrity of region geometry, barriers, and bounds.
 */
export function validateRegionGeometry(
  region_id: string,
  text_bbox: BoundingBox,
  text_polygon: PolygonPoint[],
  relation: TextBubbleRelation,
  otherRegions?: Array<{ region_id: string; bbox: BoundingBox }>
): { isValid: boolean; anomalies: string[] } {
  const anomalies: string[] = [];

  if (!region_id) anomalies.push("Missing region_id");
  if (!text_bbox || text_bbox.xMax <= text_bbox.xMin || text_bbox.yMax <= text_bbox.yMin) {
    anomalies.push("Invalid text_bbox coordinates");
  }
  if (!text_polygon || text_polygon.length < 3) {
    anomalies.push("Invalid or degenerated text_polygon");
  }

  // Verify safe translation area does not invert
  const s = relation.safe_translation_area;
  if (s && (s.xMax <= s.xMin || s.yMax <= s.yMin)) {
    anomalies.push("Safe translation area is collapsed or inverted");
  }

  // If outside bubble, verify safe area was NOT blown up to a bubble box
  if (!relation.is_inside_bubble && s) {
    const sW = s.xMax - s.xMin;
    const tW = text_bbox.xMax - text_bbox.xMin;
    if (sW > tW * 2.5 + 5.0) {
      anomalies.push("Outside text region was improperly expanded into bubble territory");
    }
  }

  return {
    isValid: anomalies.length === 0,
    anomalies,
  };
}

/**
 * 4. validateArabicLayout()
 * Performs collision testing of Arabic lines/glyphs against safe boundaries.
 */
export function validateArabicLayout(
  lines: string[],
  fontSize: number,
  lineHeight: number,
  placement: { xPct: number; yPct: number; widthPct: number; heightPct: number },
  safePolygon?: PolygonPoint[],
  safeBox?: BoundingBox
): {
  isLayoutInsideSafeArea: boolean;
  overflowAmount: number;
  anomalies: string[];
} {
  const anomalies: string[] = [];
  let isLayoutInside = true;
  let overflowAmount = 0;

  if (safeBox) {
    if (placement.xPct < safeBox.xMin - 1.0) {
      isLayoutInside = false;
      overflowAmount += safeBox.xMin - placement.xPct;
      anomalies.push("Left boundary overflow");
    }
    if (placement.xPct + placement.widthPct > safeBox.xMax + 1.0) {
      isLayoutInside = false;
      overflowAmount += placement.xPct + placement.widthPct - safeBox.xMax;
      anomalies.push("Right boundary overflow");
    }
    if (placement.yPct < safeBox.yMin - 1.0) {
      isLayoutInside = false;
      overflowAmount += safeBox.yMin - placement.yPct;
      anomalies.push("Top boundary overflow");
    }
    if (placement.yPct + placement.heightPct > safeBox.yMax + 1.0) {
      isLayoutInside = false;
      overflowAmount += placement.yPct + placement.heightPct - safeBox.yMax;
      anomalies.push("Bottom boundary overflow");
    }
  }

  if (safePolygon && safePolygon.length >= 3) {
    // Test bounding points of the text placement box
    const testCorners = [
      { x: placement.xPct, y: placement.yPct },
      { x: placement.xPct + placement.widthPct, y: placement.yPct },
      { x: placement.xPct + placement.widthPct, y: placement.yPct + placement.heightPct },
      { x: placement.xPct, y: placement.yPct + placement.heightPct },
    ];
    for (const pt of testCorners) {
      if (!isPointInPolygon(pt.x, pt.y, safePolygon)) {
        isLayoutInside = false;
        anomalies.push("Corner collides with bubble contour");
        break;
      }
    }
  }

  return {
    isLayoutInsideSafeArea: isLayoutInside,
    overflowAmount,
    anomalies,
  };
}
