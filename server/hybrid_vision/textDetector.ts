import sharp from "sharp";
import type { HybridRegion, ITextDetector, HybridTextType, HybridBubbleType } from "./types.ts";
import type { TranslationArea } from "../../src/types.ts";
import { regionManager } from "./regionManager.ts";
import { textClassifier } from "./textClassifier.ts";
import { readingOrderEngine } from "./readingOrder.ts";
import { scanLensHierarchical, reconstructReadingOrder } from "../ocrReadingOrderEngine.ts";
import { getLensInstance } from "./lensHelper.ts";
import { detectPagePanels, findPanelForBox } from "../panelDetectionService.ts";
import { analyzeVisualBarrier } from "../barrierAnalysisEngine.ts";
import { executeGraphGrouping } from "../graphGroupingEngine.ts";
import {
  detectCandidateBubble,
  classifyTextBubbleRelation,
  isSoundEffectText,
  type TextRegionGeometry,
} from "../mangaVisionGeometryEngine.ts";

export class TextDetector implements ITextDetector {
  /**
   * Discovers text entities, bubbles, narration boxes, and SFX across the page.
   * Isolates adjacent bubbles to prevent accidental merging of Bubble A and Bubble B.
   */
  async detectTextAndBubbles(
    imageBuffer: Buffer,
    options?: {
      sourceLanguage?: string;
      readingDirection?: "rtl" | "ltr";
      minConfidence?: number;
    }
  ): Promise<{
    regions: HybridRegion[];
    pageWidth: number;
    pageHeight: number;
  }> {
    const meta = await sharp(imageBuffer).metadata();
    const pageWidth = meta.width || 1000;
    const pageHeight = meta.height || 1500;
    const aspectRatio = pageWidth / pageHeight;
    const isWebtoon = aspectRatio < 0.45;
    const readingDirection = options?.readingDirection || (isWebtoon ? "ltr" : "rtl");

    // 1. Hierarchical Vision OCR Scan
    const scanResult = await scanLensHierarchical(
      getLensInstance(),
      imageBuffer,
      pageWidth,
      pageHeight,
      options?.sourceLanguage || "en"
    );
    const rawLines = scanResult.allLines || [];

    if (rawLines.length === 0) {
      return { regions: [], pageWidth, pageHeight };
    }

    const rawSegments = rawLines.map((l, idx) => ({
      idx,
      text: l.text,
      x1Pct: l.box.xMin,
      y1Pct: l.box.yMin,
      x2Pct: l.box.xMax,
      y2Pct: l.box.yMax,
      wPct: l.box.width,
      hPct: l.box.height,
      cxPct: l.box.centerX,
      cyPct: l.box.centerY,
      confidence: 0.95,
      words: l.words,
    }));

    // 2. Physical Panel Detection
    const { data: rawPixels } = await sharp(imageBuffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const pixelData = new Uint8ClampedArray(rawPixels);
    const panels = detectPagePanels(pixelData, pageWidth, pageHeight, isWebtoon);

    // 3. Barrier-Aware Graph Grouping (Separates Bubble A from Bubble B)
    // Runs edge barrier analysis to prevent clustering across gutters or bubble boundaries
    const segmentPanels = new Map();
    const segmentBubbles = new Map();
    rawSegments.forEach((seg, idx) => {
      const bBox = { xMin: seg.x1Pct, yMin: seg.y1Pct, xMax: seg.x2Pct, yMax: seg.y2Pct };
      const p = findPanelForBox(panels, bBox);
      if (p) segmentPanels.set(idx, p);

      const candidateBubble = detectCandidateBubble(pixelData, pageWidth, pageHeight, bBox);
      if (candidateBubble && (candidateBubble.is_clean_background || candidateBubble.has_ink_border)) {
        segmentBubbles.set(idx, {
          id: candidateBubble.bubble_id,
          isInsideBubble: true,
          box: candidateBubble.bubble_bbox,
          polygon: candidateBubble.bubble_polygon,
        });
      }
    });
    const graphResult = executeGraphGrouping(
      rawSegments,
      panels,
      segmentPanels,
      segmentBubbles,
      pixelData,
      pageWidth,
      pageHeight,
      readingDirection === "rtl"
    );
    const clusters = graphResult.clusters || [];

    const rawRegions: HybridRegion[] = [];

    // Pre-calculate approximate bounding boxes of all clusters to prevent merging across bubbles
    const clusterBoxes = clusters.map((segIndices) => {
      let xMin = 100, yMin = 100, xMax = 0, yMax = 0;
      for (const idx of segIndices) {
        const s = rawSegments[idx];
        if (!s) continue;
        xMin = Math.min(xMin, s.x1Pct);
        yMin = Math.min(yMin, s.y1Pct);
        xMax = Math.max(xMax, s.x2Pct);
        yMax = Math.max(yMax, s.y2Pct);
      }
      return {
        xMin: Math.max(0, xMin - 0.5),
        yMin: Math.max(0, yMin - 0.5),
        xMax: Math.min(100, xMax + 0.5),
        yMax: Math.min(100, yMax + 0.5),
      };
    });

    for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
      const segIndices = clusters[cIdx];
      if (!segIndices || segIndices.length === 0) continue;

      const clusterSegs = segIndices
        .map((i) => rawSegments[i])
        .filter(Boolean);

      if (clusterSegs.length === 0) continue;

      // Calculate composite bounding box (0..100 percentage coordinates)
      let xMin = 100, yMin = 100, xMax = 0, yMax = 0;
      let totalConf = 0;
      let confCount = 0;
      const allWords: any[] = [];
      const allLines: any[] = [];

      for (const seg of clusterSegs) {
        xMin = Math.min(xMin, seg.x1Pct);
        yMin = Math.min(yMin, seg.y1Pct);
        xMax = Math.max(xMax, seg.x2Pct);
        yMax = Math.max(yMax, seg.y2Pct);

        if (typeof seg.confidence === "number") {
          totalConf += seg.confidence;
          confCount++;
        }
        if (seg.words && Array.isArray(seg.words)) {
          allWords.push(...seg.words);
        }
        allLines.push({
          text: seg.text,
          box: { xMin: seg.x1Pct, yMin: seg.y1Pct, xMax: seg.x2Pct, yMax: seg.y2Pct },
        });
      }

      // Add a slight 0.5% margin for breathing room
      xMin = Math.max(0, xMin - 0.5);
      yMin = Math.max(0, yMin - 0.5);
      xMax = Math.min(100, xMax + 0.5);
      yMax = Math.min(100, yMax + 0.5);

      const box = { xMin, yMin, xMax, yMax };
      const avgConf = confCount > 0 ? totalConf / confCount : 0.95;

      // Reconstruct combined text respecting reading order
      let reconstructedText = "";
      if (allWords.length > 0) {
        const reconBlock = reconstructReadingOrder(allWords, { preferredDirection: readingDirection === "rtl" ? "rtl" : "ltr" });
        reconstructedText = reconBlock.translationInputText || reconBlock.originalText;
      } else {
        reconstructedText = clusterSegs.map((s) => s.text).join(" ");
      }

      // Determine text direction (vertical vs horizontal)
      const boxW = xMax - xMin;
      const boxH = yMax - yMin;
      const isVertical = boxH > boxW * 1.6;

      // Determine parent panel
      const parentPanel = findPanelForBox(panels, box);

      // Vision Geometry: Detect real bubble polygon contour and safe translation area
      const siblingBoxes = clusterBoxes.filter((_, idx) => idx !== cIdx);
      const candidateBubble = detectCandidateBubble(pixelData, pageWidth, pageHeight, box, siblingBoxes);

      const textGeom: TextRegionGeometry = {
        region_id: regionManager.generateRegionId(cIdx + 1),
        text_polygon: [
          { x: box.xMin, y: box.yMin },
          { x: box.xMax, y: box.yMin },
          { x: box.xMax, y: box.yMax },
          { x: box.xMin, y: box.yMax },
        ],
        text_bbox: box,
        text_centroid: { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 },
        text_orientation: isVertical ? "vertical" : "horizontal",
        text_direction: isVertical ? "vertical" : (readingDirection === "rtl" ? "rtl" : "ltr"),
        text_line_count: Math.max(1, allLines.length),
        text_area: boxW * boxH,
        original_glyph_area: boxW * boxH * 0.45,
        original_text: reconstructedText,
        words: allWords,
        lines: allLines,
      };

      // Detect visual rotation angle from word/segment distribution
      let rotationAngle = 0;
      let isRotated = false;
      if (allWords.length >= 2) {
        const firstW = allWords[0];
        const lastW = allWords[allWords.length - 1];
        if (firstW.box && lastW.box) {
          const dx = ((lastW.box.centerX - firstW.box.centerX) / 100) * pageWidth;
          const dy = ((lastW.box.centerY - firstW.box.centerY) / 100) * pageHeight;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 20) {
            const angleRad = Math.atan2(dy, dx);
            let angleDeg = (angleRad * 180) / Math.PI;
            while (angleDeg > 90) angleDeg -= 180;
            while (angleDeg < -90) angleDeg += 180;
            if (Math.abs(angleDeg) >= 5 && Math.abs(angleDeg) <= 60) {
              rotationAngle = Math.round(angleDeg);
              isRotated = true;
            }
          }
        }
      }

      const relation = classifyTextBubbleRelation(textGeom, candidateBubble, pixelData, pageWidth, pageHeight, panels);

      // Determine semantic text type
      let textType: HybridTextType = "dialogue";
      if (relation.classification === "SFX" || isSoundEffectText(reconstructedText)) {
        textType = "sfx";
      } else if (relation.classification === "NARRATION") {
        textType = "narration";
      } else if (relation.classification === "OUTSIDE_BUBBLE" || relation.classification === "ARTWORK_TEXT") {
        textType = "outside";
      } else if (relation.classification === "TITLE") {
        textType = "title";
      } else {
        textType = relation.is_inside_bubble ? "dialogue" : "outside";
      }

      // Determine bubble type
      let bubbleType: HybridBubbleType = "none";
      if (relation.is_inside_bubble && candidateBubble) {
        if (candidateBubble.bubble_type === "DARK") {
          bubbleType = "dark";
        } else if (candidateBubble.bubble_type === "TRANSPARENT") {
          bubbleType = "transparent";
        } else {
          bubbleType = "white";
        }
      }

      const safeTransBox = relation.safe_translation_area;
      const safeAreaObj: TranslationArea = {
        xMin: safeTransBox.xMin,
        yMin: safeTransBox.yMin,
        xMax: safeTransBox.xMax,
        yMax: safeTransBox.yMax,
        width: Math.max(0.1, safeTransBox.xMax - safeTransBox.xMin),
        height: Math.max(0.1, safeTransBox.yMax - safeTransBox.yMin),
        centerX: (safeTransBox.xMin + safeTransBox.xMax) / 2,
        centerY: (safeTransBox.yMin + safeTransBox.yMax) / 2,
      };

      // Create region with true geometric polygons and safe area
      const baseRegion = regionManager.createRegion({
        reading_order: cIdx + 1,
        original_text: reconstructedText,
        bbox: box,
        confidence: avgConf,
        direction: isVertical ? "vertical" : "horizontal",
        panel_id: parentPanel ? parentPanel.id : null,
        word_boxes: allWords,
        line_boxes: allLines,
        is_inside_bubble: relation.is_inside_bubble,
        text_type: textType,
        bubble_type: bubbleType,
        bubble_id: candidateBubble ? candidateBubble.bubble_id : null,
        bubble_polygon: candidateBubble?.bubble_polygon,
        text_polygon: textGeom.text_polygon,
        safe_area: safeAreaObj,
        safe_translation_area: safeAreaObj,
        safe_translation_polygon: relation.translation_polygon,
        outside_text_polygon: !relation.is_inside_bubble ? textGeom.text_polygon : undefined,
        relative_anchor: relation.relative_anchor,
        visual_text_scale: relation.visual_text_scale,
        is_rotated: isRotated,
        rotation_angle: rotationAngle,
      });

      // Additional sanity classification
      const secondaryType = textClassifier.classify(baseRegion, imageBuffer, pageWidth, pageHeight);
      if (secondaryType === "sfx" || secondaryType === "title" || secondaryType === "narration") {
        baseRegion.text_type = secondaryType;
        if (secondaryType === "sfx") {
          baseRegion.is_inside_bubble = false;
          baseRegion.bubble_type = "none";
        }
      }

      rawRegions.push(baseRegion);
    }

    // 4. Sort into natural narrative reading order
    const orderedRegions = readingOrderEngine.orderRegions(rawRegions, {
      readingDirection,
      isWebtoon,
      pageWidth,
      pageHeight,
    });

    // 5. Assign strict permanent primary keys: r_001, r_002...
    const finalRegions = regionManager.assignStableIds(orderedRegions);

    return {
      regions: finalRegions,
      pageWidth,
      pageHeight,
    };
  }
}

export const textDetector = new TextDetector();
