import fs from "fs";
import path from "path";
import sharp from "sharp";
import { createCanvas, loadImage, registerFont } from "canvas";
import type { HybridRegion } from "./types.ts";
import { textRemoval } from "./textRemoval.ts";
import { textRenderer } from "./textRenderer.ts";
import { geometryProfileEngine, type OriginalTextGeometryProfile, type ArabicTextGeometryProfile } from "./geometryProfileEngine.ts";
import { comicVisionOnnxAdapter } from "./adapters/comicVisionOnnxAdapter.ts";

export interface ValidationReport {
  pageName: string;
  totalRegions: number;
  containmentRatePct: number;
  zeroCollisionRatePct: number;
  averageCentroidDriftPx: number;
  averageFootprintSimilarityPct: number;
  whiteBoxAnomaliesDetected: number;
  colorPreservationRatePct: number;
  passedAllCriteria: boolean;
  regionDetails: Array<{
    region_id: string;
    textType: string;
    isInsideBubble: boolean;
    containedInSafePolygon: boolean;
    hasCollision: boolean;
    centroidDriftPx: number;
    footprintSimilarity: number;
    fontSize: number;
    lineCount: number;
    textColor: string;
  }>;
}

export class VisualValidationEngine {
  /**
   * Runs the full end-to-end visual validation loop on a manga image.
   * Produces:
   * 1. Cleaned page (verifying absence of white boxes).
   * 2. Arabic typeset page.
   * 3. 4-quadrant visual audit comparison image (Original vs Mask vs Clean vs Arabic Typeset).
   * 4. Detailed geometric alignment score report.
   */
  async validatePage(
    imagePath: string,
    outputDir: string = "calibration_results/validation",
    sampleTranslations?: Record<string, string>
  ): Promise<{ report: ValidationReport; comparisonImagePath: string; typesetImagePath: string }> {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Test image not found: ${imagePath}`);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseName = path.basename(imagePath, path.extname(imagePath));
    const originalBuffer = fs.readFileSync(imagePath);
    const meta = await sharp(originalBuffer).metadata();
    const width = meta.width || 1000;
    const height = meta.height || 1500;

    // Step 1: Detect using Unified Vision Adapter
    const detection = await comicVisionOnnxAdapter.detectBubblesAndText(originalBuffer);
    const regions = detection.regions;

    // Apply sample or fallback translations for validation
    const defaultTranslations: Record<string, string> = {
      default_dialogue: "هذا لا يمكن أن يحدث أبداً! علينا التحرك فوراً قبل فوات الأوان.",
      default_short: "مرحباً بك!",
      default_sfx: "طرااااخ!",
      default_narration: "في ذلك اليوم المشؤوم، بدأت الرحلة الطويلة نحو المجهول.",
    };

    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      if (sampleTranslations && sampleTranslations[r.region_id]) {
        r.translated_text = sampleTranslations[r.region_id];
      } else if (r.text_type === "sfx") {
        r.translated_text = defaultTranslations.default_sfx;
      } else if (r.text_type === "narration" || r.text_type === "narrative") {
        r.translated_text = defaultTranslations.default_narration;
      } else if (r.original_text && r.original_text.length < 5) {
        r.translated_text = defaultTranslations.default_short;
      } else {
        r.translated_text = defaultTranslations.default_dialogue;
      }
    }

    // Step 2: Clean Page (Glyph Masking + Inpainting)
    const cleanBuffer = await textRemoval.cleanPage(originalBuffer, regions, width, height);
    const cleanPath = path.join(outputDir, `${baseName}_clean.jpg`);
    fs.writeFileSync(cleanPath, cleanBuffer);

    // Step 3: Typeset Arabic Text with Geometry-Aware Scoring
    const typesetBuffer = await textRenderer.renderArabicText(cleanBuffer, regions, width, height);
    const typesetPath = path.join(outputDir, `${baseName}_arabic_typeset.jpg`);
    fs.writeFileSync(typesetPath, typesetBuffer);

    // Step 4: Verify Geometry and Generate Validation Report
    let totalContained = 0;
    let totalZeroCollision = 0;
    let totalDrift = 0;
    let totalFootprintSim = 0;
    let colorPreservedCount = 0;

    const details: ValidationReport["regionDetails"] = [];

    for (const r of regions) {
      const origProf: OriginalTextGeometryProfile | undefined = r.original_geometry_profile;
      const arabProf: ArabicTextGeometryProfile | undefined = r.arabic_geometry_profile;

      let contained = true;
      let drift = 0;
      let footprintSim = 1.0;

      if (origProf && arabProf) {
        const origCenter = origProf.original_visual_footprint.centerPx;
        const arabCenter = arabProf.visual_footprint.centerPx;
        drift = Math.sqrt(
          Math.pow(origCenter.x - arabCenter.x, 2) + Math.pow(origCenter.y - arabCenter.y, 2)
        );

        const origArea = origProf.original_visual_footprint.areaPx;
        const arabArea = arabProf.visual_footprint.areaPx;
        footprintSim = origArea > 0 ? Math.min(1.0, arabArea / origArea) : 1.0;

        if (origProf.classification === "inside_bubble") {
          contained = !r.collision_status?.hasCollision;
        }
      }

      if (contained) totalContained++;
      if (!r.collision_status?.hasCollision) totalZeroCollision++;
      totalDrift += drift;
      totalFootprintSim += footprintSim;
      if (r.color_style?.textColor) colorPreservedCount++;

      details.push({
        region_id: r.region_id,
        textType: r.text_type,
        isInsideBubble: r.is_inside_bubble,
        containedInSafePolygon: contained,
        hasCollision: Boolean(r.collision_status?.hasCollision),
        centroidDriftPx: Math.round(drift * 10) / 10,
        footprintSimilarity: Math.round(footprintSim * 100) / 100,
        fontSize: arabProf?.font_size || 12,
        lineCount: arabProf?.line_count || 1,
        textColor: r.color_style?.textColor || "#000000",
      });
    }

    const regCount = Math.max(1, regions.length);
    const containmentRatePct = Math.round((totalContained / regCount) * 100);
    const zeroCollisionRatePct = Math.round((totalZeroCollision / regCount) * 100);
    const averageCentroidDriftPx = Math.round((totalDrift / regCount) * 10) / 10;
    const averageFootprintSimilarityPct = Math.round((totalFootprintSim / regCount) * 100);
    const colorPreservationRatePct = Math.round((colorPreservedCount / regCount) * 100);

    // Step 5: Check for White Box Artifacts on Clean Buffer (Artificially bleached rectangles)
    const { data: cleanRgb } = await sharp(cleanBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data: origRgb } = await sharp(originalBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });

    let whiteBoxAnomaliesDetected = 0;
    for (const r of regions) {
      if (!r.is_inside_bubble) {
        // Outside bubble text must not have art bleached into solid white boxes
        const bx = Math.floor((r.bbox.xMin / 100) * width);
        const by = Math.floor((r.bbox.yMin / 100) * height);
        const bw = Math.floor(((r.bbox.xMax - r.bbox.xMin) / 100) * width);
        const bh = Math.floor(((r.bbox.yMax - r.bbox.yMin) / 100) * height);

        let cleanWhiteCount = 0;
        let origWhiteCount = 0;
        const totalSampled = Math.max(1, bw * bh);

        for (let py = by; py < by + bh && py < height; py++) {
          for (let px = bx; px < bx + bw && px < width; px++) {
            const idx = (py * width + px) * 3;
            if (cleanRgb[idx] > 250 && cleanRgb[idx + 1] > 250 && cleanRgb[idx + 2] > 250) {
              cleanWhiteCount++;
            }
            if (origRgb[idx] > 250 && origRgb[idx + 1] > 250 && origRgb[idx + 2] > 250) {
              origWhiteCount++;
            }
          }
        }

        const cleanWhiteRatio = cleanWhiteCount / totalSampled;
        const origWhiteRatio = origWhiteCount / totalSampled;

        // An anomaly is when the original artwork was dark/patterned, but became >85% solid white
        if (cleanWhiteRatio > 0.85 && origWhiteRatio < 0.60) {
          whiteBoxAnomaliesDetected++;
        }
      }
    }

    const report: ValidationReport = {
      pageName: baseName,
      totalRegions: regions.length,
      containmentRatePct,
      zeroCollisionRatePct,
      averageCentroidDriftPx,
      averageFootprintSimilarityPct,
      whiteBoxAnomaliesDetected,
      colorPreservationRatePct,
      passedAllCriteria:
        containmentRatePct >= 95 &&
        zeroCollisionRatePct === 100 &&
        averageCentroidDriftPx <= 12 &&
        whiteBoxAnomaliesDetected === 0,
      regionDetails: details,
    };

    // Step 6: Generate Side-by-Side Diagnostic Quad-Comparison Image
    const quadCanvas = createCanvas(width * 2, height * 2);
    const qctx = quadCanvas.getContext("2d");

    // Load sub-images
    const origImg = await sharp(originalBuffer).png().toBuffer();
    const cleanImg = await sharp(cleanBuffer).png().toBuffer();
    const typeImg = await sharp(typesetBuffer).png().toBuffer();

    // Geometric Diagnostic Overlay
    const diagCanvas = createCanvas(width, height);
    const dctx = diagCanvas.getContext("2d");
    const origImageCanvas = await loadImage(originalBuffer);
    dctx.drawImage(origImageCanvas, 0, 0);

    for (const r of regions) {
      const origProf = r.original_geometry_profile;
      const arabProf = r.arabic_geometry_profile;

      // Draw bubble boundary (dashed cyan)
      if (r.bubble_box) {
        dctx.strokeStyle = "rgba(6, 182, 212, 0.8)";
        dctx.lineWidth = 2;
        dctx.setLineDash([4, 4]);
        const bx = (r.bubble_box.xMin / 100) * width;
        const by = (r.bubble_box.yMin / 100) * height;
        const bw = ((r.bubble_box.xMax - r.bubble_box.xMin) / 100) * width;
        const bh = ((r.bubble_box.yMax - r.bubble_box.yMin) / 100) * height;
        dctx.strokeRect(bx, by, bw, bh);
      }

      // Draw original text box (blue)
      dctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
      dctx.lineWidth = 2;
      dctx.setLineDash([]);
      const ox = (r.bbox.xMin / 100) * width;
      const oy = (r.bbox.yMin / 100) * height;
      const ow = ((r.bbox.xMax - r.bbox.xMin) / 100) * width;
      const oh = ((r.bbox.yMax - r.bbox.yMin) / 100) * height;
      dctx.strokeRect(ox, oy, ow, oh);

      // Draw Arabic bounding polygon (solid green)
      if (r.arabic_text_polygon) {
        dctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
        dctx.lineWidth = 2.5;
        dctx.beginPath();
        for (let i = 0; i < r.arabic_text_polygon.length; i++) {
          const pt = r.arabic_text_polygon[i];
          if (i === 0) dctx.moveTo(pt.x, pt.y);
          else dctx.lineTo(pt.x, pt.y);
        }
        dctx.closePath();
        dctx.stroke();
      }

      // Centroid markers
      if (origProf && arabProf) {
        const oc = origProf.original_visual_footprint.centerPx;
        const ac = arabProf.visual_footprint.centerPx;

        // Original centroid (blue dot)
        dctx.fillStyle = "#3b82f6";
        dctx.beginPath();
        dctx.arc(oc.x, oc.y, 4, 0, Math.PI * 2);
        dctx.fill();

        // Arabic centroid (green dot)
        dctx.fillStyle = "#22c55e";
        dctx.beginPath();
        dctx.arc(ac.x, ac.y, 4, 0, Math.PI * 2);
        dctx.fill();

        // Drift line (red)
        dctx.strokeStyle = "#ef4444";
        dctx.lineWidth = 1.5;
        dctx.beginPath();
        dctx.moveTo(oc.x, oc.y);
        dctx.lineTo(ac.x, ac.y);
        dctx.stroke();
      }
    }

    const diagImg = diagCanvas.toBuffer("image/png");

    // Composite 4 quadrants
    const quadComp = await sharp({
      create: {
        width: width * 2,
        height: height * 2,
        channels: 3,
        background: { r: 15, g: 23, b: 42 },
      },
    })
      .composite([
        { input: origImg, left: 0, top: 0 },
        { input: cleanImg, left: width, top: 0 },
        { input: typeImg, left: 0, top: height },
        { input: diagImg, left: width, top: height },
      ])
      .jpeg({ quality: 92 })
      .toBuffer();

    const comparisonImagePath = path.join(outputDir, `${baseName}_validation_quad.jpg`);
    fs.writeFileSync(comparisonImagePath, quadComp);

    return {
      report,
      comparisonImagePath,
      typesetImagePath: typesetPath,
    };
  }
}

export const visualValidationEngine = new VisualValidationEngine();
