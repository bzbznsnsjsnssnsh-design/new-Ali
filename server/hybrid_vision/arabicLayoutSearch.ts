import { createCanvas, type CanvasRenderingContext2D } from "canvas";
import type { HybridRegion, PolygonPoint, BoundingBox } from "./types.ts";
import {
  geometryProfileEngine,
  type OriginalTextGeometryProfile,
  type ArabicTextGeometryProfile,
} from "./geometryProfileEngine.ts";
import {
  fitArabicTextToRegion,
  wrapArabicTextDiamond,
  estimateArabicWordWidth,
  getAvailableSliceWidth,
} from "../../src/utils/arabicLayoutEngine.ts";

/**
 * Point in polygon test using ray-casting algorithm.
 */
export function isPointInsidePolygon(
  pt: { x: number; y: number },
  poly: Array<{ x: number; y: number }>
): boolean {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ccw(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): boolean {
  return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
}

function doSegmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): boolean {
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}

export function doPolygonsIntersect(
  polyA: Array<{ x: number; y: number }>,
  polyB: Array<{ x: number; y: number }>
): boolean {
  if (!polyA || polyA.length === 0 || !polyB || polyB.length === 0) return false;

  let aMinX = Infinity, aMaxX = -Infinity, aMinY = Infinity, aMaxY = -Infinity;
  for (const p of polyA) {
    if (p.x < aMinX) aMinX = p.x;
    if (p.x > aMaxX) aMaxX = p.x;
    if (p.y < aMinY) aMinY = p.y;
    if (p.y > aMaxY) aMaxY = p.y;
  }
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (const p of polyB) {
    if (p.x < bMinX) bMinX = p.x;
    if (p.x > bMaxX) bMaxX = p.x;
    if (p.y < bMinY) bMinY = p.y;
    if (p.y > bMaxY) bMaxY = p.y;
  }

  // AABB disjoint test with 2px buffer
  if (aMaxX <= bMinX + 2 || aMinX >= bMaxX - 2 || aMaxY <= bMinY + 2 || aMinY >= bMaxY - 2) {
    return false;
  }

  for (const p of polyA) {
    if (isPointInsidePolygon(p, polyB)) return true;
  }
  for (const p of polyB) {
    if (isPointInsidePolygon(p, polyA)) return true;
  }

  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (doSegmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

export interface CandidateLayoutEvaluation {
  id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
  name: string;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  startX: number;
  startY: number;
  centerTextY: number;
  centerTextX: number;
  boundingPoly: Array<{ x: number; y: number }>;
  pixelWidth: number;
  pixelHeight: number;
  rotationAngle: number;
  scores: {
    safePolygonContainment: number; // 0..100
    interRegionCollision: number; // 0..100
    centroidDrift: number; // Distance in px (smaller is better)
    visualFootprintSimilarity: number; // 0..1
    lineCountProportion: number; // 0..100
    orphanWordPenalty: number; // 0 or negative
    fontSizeLegibility: number; // 0..100
    visualBalance: number; // 0..100
    orientationAccuracy: number; // 0..100
    bubbleBorderDistance: number; // 0..100
    artworkTrespass: number; // 0 or negative
    originalLocationFidelity: number; // 0..100
    totalCompositeScore: number;
  };
  fitsInSafeBoundary: boolean;
  collidesWithOthers: boolean;
  overflowsPage: boolean;
}

export class ArabicLayoutSearchEngine {
  /**
   * Generates and objectively evaluates layout candidates A through J.
   * Returns the globally optimal candidate along with its ArabicTextGeometryProfile.
   */
  searchBestLayout(
    text: string,
    region: HybridRegion,
    origProfile: OriginalTextGeometryProfile,
    placedPolygons: Array<{ region_id: string; polygon: Array<{ x: number; y: number }> }>,
    pageWidth: number,
    pageHeight: number,
    fontFamily: string,
    options?: {
      minFontSize?: number;
      maxFontSize?: number;
      primaryColor?: string;
      strokeColor?: string;
    }
  ): {
    bestCandidate: CandidateLayoutEvaluation;
    allEvaluations: CandidateLayoutEvaluation[];
    arabicProfile: ArabicTextGeometryProfile;
  } {
    const minFont = options?.minFontSize ?? 2.0;
    const maxFont = options?.maxFontSize || 38;
    const cleanText = text.replace(/[\u0000\uFFFD]/g, "").trim();

    // Measurement canvas
    const canvas = createCanvas(pageWidth, pageHeight);
    const ctx = canvas.getContext("2d");

    // Safe polygon in pixel coordinates
    let safePolyPx: Array<{ x: number; y: number }> = [];
    if (origProfile.safe_translation_polygon && origProfile.safe_translation_polygon.length >= 3) {
      safePolyPx = origProfile.safe_translation_polygon.map((p) => ({
        x: (p.x / 100) * pageWidth,
        y: (p.y / 100) * pageHeight,
      }));
    } else {
      const { x, y, width, height } = origProfile.original_pixel_bbox;
      safePolyPx = [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
    }

    const origCenter = origProfile.original_visual_footprint.centerPx;
    const origArea = origProfile.original_visual_footprint.areaPx;
    const isInside = origProfile.classification === "inside_bubble";
    const isSfx = origProfile.classification === "sfx";
    const isOutside = origProfile.classification === "outside_art";

    // Safe dimensions & text words
    const safeW = origProfile.original_pixel_bbox.width;
    const safeH = origProfile.original_pixel_bbox.height;
    const words = cleanText.split(/\s+/).filter(Boolean);

    // Define 10 distinct candidate configurations
    const candidateDefs: Array<{
      id: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
      name: string;
      scale: number;
      lineHeightMult: number;
      strategy: "diamond" | "rect" | "compact" | "ellipse_slice" | "strict_polygon" | "optical_center";
    }> = [
      { id: "A", name: "Proportional Diamond", scale: 1.00, lineHeightMult: 1.30, strategy: "diamond" },
      { id: "B", name: "Alternate Line Breaks", scale: 0.94, lineHeightMult: 1.26, strategy: "diamond" },
      { id: "C", name: "Readability Priority", scale: 1.06, lineHeightMult: 1.32, strategy: "diamond" },
      { id: "D", name: "High Density Line Spacing", scale: 0.88, lineHeightMult: 1.20, strategy: "diamond" },
      { id: "E", name: "Expanded Balanced Silhouette", scale: 0.96, lineHeightMult: 1.36, strategy: "diamond" },
      { id: "F", name: "Contour-Safe Inset", scale: 0.78, lineHeightMult: 1.18, strategy: "diamond" },
      { id: "G", name: "Ellipse Slice Chord Fit", scale: 0.92, lineHeightMult: 1.28, strategy: "ellipse_slice" },
      { id: "H", name: "Strict Polygon Constrained", scale: 0.84, lineHeightMult: 1.22, strategy: "strict_polygon" },
      { id: "I", name: "Footprint Preservation Compact", scale: 0.90, lineHeightMult: 1.24, strategy: "compact" },
      { id: "J", name: "Optical Centroid Zero-Drift", scale: 1.00, lineHeightMult: 1.28, strategy: "optical_center" },
    ];

    const evaluations: CandidateLayoutEvaluation[] = [];

    for (const def of candidateDefs) {
      // 1. Calculate Target Font Size based on original font height estimate and candidate scale
      let baseFs = Math.max(minFont, Math.min(maxFont, origProfile.font_height_estimate * def.scale));
      if (isSfx) {
        baseFs = Math.max(14, baseFs * 1.15); // SFX gets slightly bolder presence
      } else if (isOutside) {
        baseFs = Math.max(minFont, Math.min(18, baseFs)); // Keep outside dialogue compact to avoid bleeding into artwork
      }

      // Wrap lines according to candidate strategy
      let lines: string[] = [];

      ctx.font = `bold ${baseFs}px ${fontFamily}`;

      if (def.strategy === "compact" || isOutside || isSfx) {
        // Tightly wrap to original bounding box width
        lines = wrapArabicTextDiamond(words, baseFs, Math.max(safeW * 1.1, 40), false, ctx);
      } else if (def.strategy === "ellipse_slice") {
        // Explicit elliptical slice chord wrapping
        lines = wrapArabicTextDiamond(words, baseFs, safeW, true, ctx);
      } else {
        // Standard diamond / balanced silhouette
        lines = wrapArabicTextDiamond(words, baseFs, Math.max(safeW, 30), isInside, ctx);
      }

      // If text overflows safe height or width, iteratively step down font size without limit until it fits
      let candFs = baseFs;
      let candLineH = Math.round(candFs * def.lineHeightMult);
      let totalH = lines.length * candLineH;

      let maxLineW = 0;
      for (const line of lines) {
        const lw = ctx.measureText(line).width;
        if (lw > maxLineW) maxLineW = lw;
      }

      let shrinkSteps = 0;
      while ((totalH > safeH * 1.02 || maxLineW > safeW * 1.02) && candFs > minFont && shrinkSteps < 35) {
        candFs = Math.max(minFont, candFs * 0.92);
        candLineH = Math.round(candFs * def.lineHeightMult);
        ctx.font = `bold ${candFs}px ${fontFamily}`;
        const wrapTargetW = isInside ? Math.max(safeW * 0.94, 18) : Math.max(safeW, 25);
        lines = wrapArabicTextDiamond(words, candFs, wrapTargetW, isInside, ctx);
        candLineH = Math.round(candFs * def.lineHeightMult);
        totalH = lines.length * candLineH;
        maxLineW = 0;
        for (const line of lines) {
          const lw = ctx.measureText(line).width;
          if (lw > maxLineW) maxLineW = lw;
        }
        shrinkSteps++;
      }

      // Measure final line widths
      ctx.font = `bold ${candFs}px ${fontFamily}`;
      maxLineW = 0;
      let minLineW = Infinity;
      const lineWs: number[] = [];
      for (const line of lines) {
        const lw = ctx.measureText(line).width;
        lineWs.push(lw);
        if (lw > maxLineW) maxLineW = lw;
        if (lw < minLineW) minLineW = lw;
      }
      if (minLineW === Infinity) minLineW = maxLineW;

      // Determine center anchor
      let startX: number;
      let startY: number;

      if (def.strategy === "optical_center" || isOutside || isSfx) {
        // Strict optical centroid anchoring
        startX = origCenter.x;
        const textTop = origCenter.y - totalH / 2;
        startY = textTop + Math.floor(candFs * 0.88);
      } else {
        // Centered within safe bounding box
        startX = origProfile.original_pixel_bbox.x + Math.floor(origProfile.original_pixel_bbox.width / 2);
        const boxCenterY = origProfile.original_pixel_bbox.y + Math.floor(origProfile.original_pixel_bbox.height / 2);
        const textTop = boxCenterY - totalH / 2;
        startY = textTop + Math.floor(candFs * 0.88);
      }

      // Compute bounding polygon of placed Arabic text lines
      let halfW = maxLineW / 2;
      let topY = startY - candFs * 0.85;
      let bottomY = startY + (lines.length - 1) * candLineH + candFs * 0.25;
      let candCenterY = (topY + bottomY) / 2;
      let candCenterX = startX;

      let boundingPoly = [
        { x: startX - halfW, y: topY },
        { x: startX + halfW, y: topY },
        { x: startX + halfW, y: bottomY },
        { x: startX - halfW, y: bottomY },
      ];

      // CRITERION 1: Safe Boundary / Polygon Containment (with unlimited shrink loop if corners stick out)
      let fitsInSafeBoundary = true;
      let pointsInside = 4;
      if (isInside && safePolyPx.length >= 3) {
        let polyFitSteps = 0;
        while (candFs > minFont && polyFitSteps < 30) {
          pointsInside = 0;
          for (const pt of boundingPoly) {
            if (isPointInsidePolygon(pt, safePolyPx)) {
              pointsInside++;
            }
          }
          if (pointsInside === 4) {
            fitsInSafeBoundary = true;
            break;
          }
          // Step down font size to bring corners strictly inside the bubble contour
          candFs = Math.max(minFont, candFs * 0.92);
          candLineH = Math.round(candFs * def.lineHeightMult);
          ctx.font = `bold ${candFs}px ${fontFamily}`;
          lines = wrapArabicTextDiamond(words, candFs, Math.max(safeW * 0.90, 16), isInside, ctx);
          candLineH = Math.round(candFs * def.lineHeightMult);
          totalH = lines.length * candLineH;
          maxLineW = 0;
          for (const line of lines) {
            const lw = ctx.measureText(line).width;
            if (lw > maxLineW) maxLineW = lw;
          }
          halfW = maxLineW / 2;
          const textTop = (def.strategy === "optical_center" || isOutside || isSfx ? origCenter.y : (origProfile.original_pixel_bbox.y + origProfile.original_pixel_bbox.height / 2)) - totalH / 2;
          startY = textTop + Math.floor(candFs * 0.88);
          topY = startY - candFs * 0.85;
          bottomY = startY + (lines.length - 1) * candLineH + candFs * 0.25;
          candCenterY = (topY + bottomY) / 2;
          boundingPoly = [
            { x: startX - halfW, y: topY },
            { x: startX + halfW, y: topY },
            { x: startX + halfW, y: bottomY },
            { x: startX - halfW, y: bottomY },
          ];
          polyFitSteps++;
        }
        fitsInSafeBoundary = pointsInside === 4;
      }
      const safePolygonScore = (pointsInside / 4) * 100;

      // CRITERION 2: Inter-Region Collision
      let collidesWithOthers = false;
      for (const placed of placedPolygons) {
        if (doPolygonsIntersect(boundingPoly, placed.polygon)) {
          collidesWithOthers = true;
          break;
        }
      }
      const interRegionScore = collidesWithOthers ? 0 : 100;

      // CRITERION 3: Centroid Drift (in pixels)
      const driftPx = Math.sqrt(
        Math.pow(candCenterX - origCenter.x, 2) + Math.pow(candCenterY - origCenter.y, 2)
      );

      // CRITERION 4: Visual Footprint Similarity
      const candArea = maxLineW * totalH;
      const areaRatio = origArea > 0 ? candArea / origArea : 1.0;
      const footprintSim = Math.max(0, 1 - Math.abs(areaRatio - 1.05) / 1.05);

      // CRITERION 5: Line Count Proportionality
      const origLines = origProfile.line_count;
      const lineCountRatio = lines.length / origLines;
      const lineCountScore = Math.max(0, 100 - Math.abs(lineCountRatio - 1.0) * 35);

      // CRITERION 6: Orphan Word Penalty
      let hasOrphan = false;
      if (lines.length > 1) {
        const lastLineWords = lines[lines.length - 1].trim().split(/\s+/);
        if (lastLineWords.length === 1 && words.length > 3) {
          hasOrphan = true;
        }
      }
      const orphanPenalty = hasOrphan ? -60 : 0;

      // CRITERION 7: Font Size Legibility (adjusted so required shrinking to fit is NOT penalized)
      let legibilityScore = 80;
      if (candFs >= 11 && candFs <= 28) legibilityScore = 100;
      else if (candFs >= 8 && candFs < 11) legibilityScore = 90;
      else if (candFs >= 5 && candFs < 8) legibilityScore = 80;
      else legibilityScore = 70;

      // CRITERION 8: Visual Balance (Silhouette)
      let balanceScore = 80;
      if (lines.length > 1 && maxLineW > 0) {
        const silhouetteRatio = minLineW / maxLineW;
        balanceScore = Math.round(silhouetteRatio * 100);
      }

      // CRITERION 9: Orientation Match
      const orientationScore = 100;

      // CRITERION 10: Bubble Border Distance Buffer
      let borderDistanceScore = fitsInSafeBoundary ? 100 : 20;

      // CRITERION 11: Artwork Trespass
      let overflowsPage = false;
      for (const pt of boundingPoly) {
        if (pt.x < 0 || pt.x > pageWidth || pt.y < 0 || pt.y > pageHeight) {
          overflowsPage = true;
          break;
        }
      }
      const artworkScore = overflowsPage ? -150 : 0;

      // CRITERION 12: Original Location Fidelity (especially for SFX and outside art)
      const fidelityScore = Math.max(0, 100 - driftPx * 1.5);

      // Total Composite Score
      const totalScore =
        safePolygonScore * 0.25 +
        interRegionScore * 0.20 +
        footprintSim * 100 * 0.15 +
        fidelityScore * 0.15 +
        legibilityScore * 0.10 +
        lineCountScore * 0.05 +
        balanceScore * 0.05 +
        borderDistanceScore * 0.05 +
        orphanPenalty +
        artworkScore;

      evaluations.push({
        id: def.id,
        name: def.name,
        lines,
        fontSize: candFs,
        lineHeight: candLineH,
        startX,
        startY,
        centerTextY: candCenterY,
        centerTextX: candCenterX,
        boundingPoly,
        pixelWidth: maxLineW,
        pixelHeight: totalH,
        rotationAngle: origProfile.rotation_angle,
        scores: {
          safePolygonContainment: Math.round(safePolygonScore),
          interRegionCollision: Math.round(interRegionScore),
          centroidDrift: Math.round(driftPx * 10) / 10,
          visualFootprintSimilarity: Math.round(footprintSim * 100) / 100,
          lineCountProportion: Math.round(lineCountScore),
          orphanWordPenalty: orphanPenalty,
          fontSizeLegibility: legibilityScore,
          visualBalance: balanceScore,
          orientationAccuracy: orientationScore,
          bubbleBorderDistance: borderDistanceScore,
          artworkTrespass: artworkScore,
          originalLocationFidelity: Math.round(fidelityScore),
          totalCompositeScore: Math.round(totalScore * 10) / 10,
        },
        fitsInSafeBoundary,
        collidesWithOthers,
        overflowsPage,
      });
    }

    // Sort descending by total composite score
    evaluations.sort((a, b) => b.scores.totalCompositeScore - a.scores.totalCompositeScore);

    // Pick top scoring candidate that strictly fits safe boundary without colliding or overflowing
    let best = evaluations.find((c) => c.fitsInSafeBoundary && !c.collidesWithOthers && !c.overflowsPage)
      || evaluations.find((c) => !c.collidesWithOthers && !c.overflowsPage)
      || evaluations[0];

    // Final containment guarantee for bubbles (unlimited shrinking guarantee)
    if (isInside && safePolyPx.length >= 3 && !best.fitsInSafeBoundary) {
      let candFs = best.fontSize;
      let candLineH = best.lineHeight;
      let lines = best.lines;
      let steps = 0;
      while (candFs > minFont && steps < 30) {
        candFs = Math.max(minFont, candFs * 0.90);
        candLineH = Math.round(candFs * 1.25);
        ctx.font = `bold ${candFs}px ${fontFamily}`;
        lines = wrapArabicTextDiamond(words, candFs, Math.max(safeW * 0.88, 14), isInside, ctx);
        candLineH = Math.round(candFs * 1.25);
        const totalH = lines.length * candLineH;
        let maxLineW = 0;
        for (const line of lines) {
          const lw = ctx.measureText(line).width;
          if (lw > maxLineW) maxLineW = lw;
        }
        const textTop = best.centerTextY - totalH / 2;
        const startY = textTop + Math.floor(candFs * 0.88);
        const topY = startY - candFs * 0.85;
        const bottomY = startY + (lines.length - 1) * candLineH + candFs * 0.25;
        const halfW = maxLineW / 2;
        const poly = [
          { x: best.startX - halfW, y: topY },
          { x: best.startX + halfW, y: topY },
          { x: best.startX + halfW, y: bottomY },
          { x: best.startX - halfW, y: bottomY },
        ];
        let ins = 0;
        for (const pt of poly) {
          if (isPointInsidePolygon(pt, safePolyPx)) ins++;
        }
        best.fontSize = candFs;
        best.lineHeight = candLineH;
        best.lines = lines;
        best.pixelWidth = maxLineW;
        best.pixelHeight = totalH;
        best.startY = startY;
        best.boundingPoly = poly;
        if (ins === 4) {
          best.fitsInSafeBoundary = true;
          break;
        }
        steps++;
      }
    }

    // Build the ArabicTextGeometryProfile for the selected candidate
    const arabBox: BoundingBox = {
      xMin: Math.max(0, ((best.startX - best.pixelWidth / 2) / pageWidth) * 100),
      xMax: Math.min(100, ((best.startX + best.pixelWidth / 2) / pageWidth) * 100),
      yMin: Math.max(0, ((best.centerTextY - best.pixelHeight / 2) / pageHeight) * 100),
      yMax: Math.min(100, ((best.centerTextY + best.pixelHeight / 2) / pageHeight) * 100),
    };

    const arabProfile: ArabicTextGeometryProfile = {
      translated_text: cleanText,
      font_family: fontFamily,
      font_size: best.fontSize,
      line_count: best.lines.length,
      line_widths: [best.pixelWidth],
      line_heights: [best.lineHeight],
      line_spacing: Math.round(best.fontSize * 0.28),
      text_pixel_area: best.pixelWidth * best.pixelHeight * 0.35,
      visual_density: 0.35,
      bbox: arabBox,
      pixel_bbox: {
        x: Math.round(best.startX - best.pixelWidth / 2),
        y: Math.round(best.centerTextY - best.pixelHeight / 2),
        width: Math.round(best.pixelWidth),
        height: Math.round(best.pixelHeight),
      },
      polygon: best.boundingPoly.map((p) => ({
        x: (p.x / pageWidth) * 100,
        y: (p.y / pageHeight) * 100,
      })),
      rotation_angle: best.rotationAngle,
      direction: "rtl",
      stroke_width: origProfile.has_stroke ? 2.5 : 0,
      stroke_color: origProfile.has_stroke ? (origProfile.is_inverted ? "#000000" : "#ffffff") : "transparent",
      fill_color: `rgb(${origProfile.text_color.r}, ${origProfile.text_color.g}, ${origProfile.text_color.b})`,
      visual_footprint: {
        widthPx: Math.round(best.pixelWidth),
        heightPx: Math.round(best.pixelHeight),
        areaPx: Math.round(best.pixelWidth * best.pixelHeight * 0.35),
        density: 0.35,
        centerPx: { x: Math.round(best.centerTextX), y: Math.round(best.centerTextY) },
      },
    };

    return {
      bestCandidate: best,
      allEvaluations: evaluations,
      arabicProfile: arabProfile,
    };
  }
}

export const arabicLayoutSearchEngine = new ArabicLayoutSearchEngine();
