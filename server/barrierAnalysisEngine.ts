import type { BoundingBox } from "../src/types.ts";
import type { BarrierAnalysisResult, Bubble, Panel } from "./types/mangaTypes.ts";

/**
 * Visual Barrier Analysis Engine
 *
 * Implements physics and geometry-grounded visual path analysis:
 * 1. Panel border / gutter crossing detection
 * 2. Speech bubble ink contour detection (radial boundary crossing)
 * 3. Multi-modal artwork valley detection (artwork between speech bubbles)
 * 4. Discrete bubble separation validation
 * 5. Whitespace and contrast transition barriers
 */

export interface Point2D {
  x: number;
  y: number;
}

export function analyzeVisualBarrier(
  fullPixels: Uint8ClampedArray,
  imageW: number,
  imageH: number,
  p1: Point2D,
  p2: Point2D,
  boxA?: BoundingBox,
  boxB?: BoundingBox,
  otherBoxes?: BoundingBox[],
  panelA?: Panel,
  panelB?: Panel,
  bubbleA?: Bubble | null,
  bubbleB?: Bubble | null
): BarrierAnalysisResult {
  // 1. HARD RULE: Different Panels => Absolute Visual Barrier
  if (panelA && panelB && panelA.id !== panelB.id) {
    return {
      hasBarrier: true,
      barrierType: "panel_border",
      confidence: 0.99,
      reason: `Separated by panel boundary (${panelA.id} vs ${panelB.id})`
    };
  }

  // Check if boxA and boxB are adjacent stacked text lines or side-by-side columns in the same panel (dialogue/narration paragraphs)
  const gapY = (boxA && boxB) ? Math.max(0, Math.max(boxA.yMin, boxB.yMin) - Math.min(boxA.yMax, boxB.yMax)) : 999;
  const overlapX = (boxA && boxB) ? Math.max(0, Math.min(boxA.xMax, boxB.xMax) - Math.max(boxA.xMin, boxB.xMin)) : 0;
  const minW = (boxA && boxB) ? Math.min(boxA.xMax - boxA.xMin, boxB.xMax - boxB.xMin) : 0;
  const maxW = (boxA && boxB) ? Math.max(boxA.xMax - boxA.xMin, boxB.xMax - boxB.xMin) : 0;
  const maxH = (boxA && boxB) ? Math.max(boxA.yMax - boxA.yMin, boxB.yMax - boxB.yMin) : 0;
  const minH = (boxA && boxB) ? Math.min(boxA.yMax - boxA.yMin, boxB.yMax - boxB.yMin) : 0;
  const distX = Math.abs(p1.x - p2.x);
  const gapX = (boxA && boxB) ? Math.max(0, Math.max(boxA.xMin, boxB.xMin) - Math.min(boxA.xMax, boxB.xMax)) : 999;
  const overlapY = (boxA && boxB) ? Math.max(0, Math.min(boxA.yMax, boxB.yMax) - Math.max(boxA.yMin, boxB.yMin)) : 0;

  const isStackedLinesInSamePanel = (boxA && boxB && (!panelA || !panelB || panelA.id === panelB.id))
    ? ((gapY <= Math.max(maxH * 3.5, 6.0) && (overlapX >= minW * 0.08 || distX <= 8.5)) ||
       (gapX <= Math.max(maxW * 2.0, 5.5) && (overlapY >= minH * 0.25 || Math.abs(p1.y - p2.y) <= 8.5)))
    : false;

  // 2. HARD RULE: Discrete Speech Bubbles => Absolute Visual Barrier
  if (bubbleA && bubbleB && bubbleA.isInsideBubble && bubbleB.isInsideBubble) {
    if (bubbleA.id !== bubbleB.id) {
      // Check if one bubble encloses the other (nested or same bubble detected twice)
      const bA = bubbleA.box;
      const bB = bubbleB.box;

      const interX = Math.max(0, Math.min(bA.xMax, bB.xMax) - Math.max(bA.xMin, bB.xMin));
      const interY = Math.max(0, Math.min(bA.yMax, bB.yMax) - Math.max(bA.yMin, bB.yMin));
      const interArea = interX * interY;
      const areaA = Math.max(1, (bA.xMax - bA.xMin) * (bA.yMax - bA.yMin));
      const areaB = Math.max(1, (bB.xMax - bB.xMin) * (bB.yMax - bB.yMin));
      const minArea = Math.min(areaA, areaB);
      const overlapRatio = minArea > 0 ? interArea / minArea : 0;

      // Two speech bubbles with different IDs and without high overlap (>60%) are strictly discrete bubbles
      if (overlapRatio < 0.60) {
        return {
          hasBarrier: true,
          barrierType: "discrete_bubble_separation",
          confidence: 0.98,
          reason: `Segments reside in distinct speech bubbles (${bubbleA.id} vs ${bubbleB.id})`
        };
      }
    }
  }

  // 3. Pixel Ray Tracing between text centers (verifies no ink contours or gutters separate them)
  const p1Px = { x: (p1.x / 100) * imageW, y: (p1.y / 100) * imageH };
  const p2Px = { x: (p2.x / 100) * imageW, y: (p2.y / 100) * imageH };

  const dx = p2Px.x - p1Px.x;
  const dy = p2Px.y - p1Px.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 4) {
    return { hasBarrier: false, barrierType: "none", confidence: 0.95 };
  }

  const steps = Math.max(20, Math.min(280, Math.ceil(dist * 1.5)));
  const stepX = dx / steps;
  const stepY = dy / steps;

  function getPixelLum(x: number, y: number): number {
    const px = Math.max(0, Math.min(imageW - 1, Math.round(x)));
    const py = Math.max(0, Math.min(imageH - 1, Math.round(y)));
    const idx = (py * imageW + px) * 4;
    return 0.299 * fullPixels[idx] + 0.587 * fullPixels[idx + 1] + 0.114 * fullPixels[idx + 2];
  }

  // Convert bounding box from percentage (0..100) to pixel coords with glyph padding
  function isInsideBox(x: number, y: number, b?: BoundingBox): boolean {
    if (!b) return false;
    const xMinPx = (b.xMin / 100) * imageW;
    const xMaxPx = (b.xMax / 100) * imageW;
    const yMinPx = (b.yMin / 100) * imageH;
    const yMaxPx = (b.yMax / 100) * imageH;
    const padX = Math.max(3, (xMaxPx - xMinPx) * 0.08);
    const padY = Math.max(4, (yMaxPx - yMinPx) * 0.28); // Absorbs font descenders, commas, quotes
    return x >= xMinPx - padX && x <= xMaxPx + padX && y >= yMinPx - padY && y <= yMaxPx + padY;
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
    const curX = p1Px.x + stepX * s;
    const curY = p1Px.y + stepY * s;

    // Skip pixels that belong to text glyphs inside boxA, boxB, or intermediate lines
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

  // If no inter-box pixels sampled or all points are white bubble canvas (>155), no barrier
  if (sampledCount === 0) {
    return { hasBarrier: false, barrierType: "none", confidence: 0.90 };
  }

  const avgLum = sumLum / sampledCount;
  const brightRatio = brightPointsCount / sampledCount;

  // 1. Multi-modal artwork valley between two distinct bubbles (substantial dark run in artwork/gutter)
  if (minLumInPath < 110 && maxDarkPixelStreak >= 4) {
    return {
      hasBarrier: true,
      barrierType: "multimodal_artwork_valley",
      confidence: 0.95,
      reason: `Traversed dark artwork valley (minLum: ${Math.round(minLumInPath)}, darkStreak: ${maxDarkPixelStreak})`
    };
  }

  // 2. Thick bubble contour or panel stroke crossed
  if (minLumInPath <= 60 && maxGradientInPath >= 30) {
    return {
      hasBarrier: true,
      barrierType: "panel_border",
      confidence: 0.94,
      reason: `Crossed ink panel border / contour line (minLum: ${Math.round(minLumInPath)}, grad: ${Math.round(maxGradientInPath)})`
    };
  }

  if (minLumInPath <= 75 && (maxDarkPixelStreak >= 2 || maxGradientInPath >= 35)) {
    return {
      hasBarrier: true,
      barrierType: "bubble_contour",
      confidence: 0.94,
      reason: `Crossed ink bubble contour / panel stroke (minLum: ${Math.round(minLumInPath)}, streak: ${maxDarkPixelStreak})`
    };
  }

  // 3. Ambient whitespace gutter separation between two isolated entities
  // If the distance is large (> 8.0% of page height) and not inside the same confirmed bubble:
  const distPct = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (distPct > 8.0 && (!bubbleA?.isInsideBubble || !bubbleB?.isInsideBubble)) {
    return {
      hasBarrier: true,
      barrierType: "gutter",
      confidence: 0.88,
      reason: `Excessive distance across non-bubble canvas (${distPct.toFixed(1)}%)`
    };
  }

  // 4. If the path overwhelmingly consists of bright speech bubble canvas (avgLum >= 165 and >75% bright),
  // with no sustained dark contour line and within normal speech bubble proximity:
  if (avgLum >= 165 && brightRatio >= 0.75 && maxDarkPixelStreak < 4) {
    return { hasBarrier: false, barrierType: "none", confidence: 0.96 };
  }

  return { hasBarrier: false, barrierType: "none", confidence: 0.85 };
}
