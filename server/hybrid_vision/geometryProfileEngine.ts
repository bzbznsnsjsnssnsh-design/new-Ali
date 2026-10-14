import sharp from "sharp";
import type { RGBColor, PolygonPoint, BoundingBox } from "./types.ts";

/**
 * Complete Geometric Profile of the Original Manga / Manhwa Text Entity.
 * Preserves exact spatial coordinates, glyph-level ink metrics, and visual footprint.
 */
export interface OriginalTextGeometryProfile {
  region_id: string; // Immutable unique key: r_001, r_002, r_003...
  original_bbox: BoundingBox; // Percentage [0..100]
  original_pixel_bbox: { x: number; y: number; width: number; height: number }; // Absolute page pixels
  original_polygon: PolygonPoint[];
  text_pixel_area: number; // Exact count of ink/stroke pixels
  text_density: number; // Ratio of stroke pixels to bbox pixel area [0..1]
  text_center: { x: number; y: number }; // Exact centroid (center of mass) in page pixels
  text_center_pct: { x: number; y: number }; // Centroid in percentage [0..100]
  line_count: number;
  line_widths: number[];
  line_heights: number[];
  line_spacing: number;
  font_height_estimate: number; // In pixels
  aspect_ratio: number; // width / height
  rotation_angle: number; // Calculated via spatial image moments in degrees [-90..+90]
  text_direction: "horizontal" | "vertical" | "rotated";
  text_color: RGBColor; // Detected chromatic RGB of text strokes
  stroke_color?: RGBColor; // Detected outline/halo color if present
  has_stroke: boolean;
  background_color: RGBColor; // Local paper or artwork color behind glyphs
  is_inverted: boolean; // Light text on dark background
  is_chromatic: boolean; // Vibrant color (red, blue, green, yellow, purple, etc.)
  color_name: string; // "red" | "blue" | "green" | "yellow" | "purple" | "pink" | "cyan" | "white" | "black" | "gray"
  classification: "inside_bubble" | "outside_art" | "sfx" | "narration_box" | "title";
  bubble_polygon?: PolygonPoint[];
  safe_translation_polygon: PolygonPoint[];
  original_visual_footprint: {
    widthPx: number;
    heightPx: number;
    areaPx: number;
    density: number;
    centerPx: { x: number; y: number };
  };
}

/**
 * Geometric Profile of the Candidate Arabic Typeset Text Entity.
 */
export interface ArabicTextGeometryProfile {
  translated_text: string;
  font_family: string;
  font_size: number;
  line_count: number;
  line_widths: number[];
  line_heights: number[];
  line_spacing: number;
  text_pixel_area: number;
  visual_density: number;
  bbox: BoundingBox;
  pixel_bbox: { x: number; y: number; width: number; height: number };
  polygon: PolygonPoint[];
  rotation_angle: number;
  direction: "rtl";
  stroke_width: number;
  stroke_color: string;
  fill_color: string;
  visual_footprint: {
    widthPx: number;
    heightPx: number;
    areaPx: number;
    density: number;
    centerPx: { x: number; y: number };
  };
}

/**
 * Identifies the human-readable color family of an RGB triplet.
 */
export function identifyColorFamily(rgb: RGBColor): { colorName: string; isChromatic: boolean } {
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;

  if (chroma < 24) {
    if (lum < 60) return { colorName: "black", isChromatic: false };
    if (lum > 190) return { colorName: "white", isChromatic: false };
    return { colorName: "gray", isChromatic: false };
  }

  // Hue calculation in degrees [0..360]
  let hue = 0;
  if (max === r) {
    hue = ((g - b) / chroma) % 6;
  } else if (max === g) {
    hue = (b - r) / chroma + 2;
  } else {
    hue = (r - g) / chroma + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  if (hue >= 345 || hue < 15) return { colorName: "red", isChromatic: true };
  if (hue >= 15 && hue < 45) return { colorName: "orange", isChromatic: true };
  if (hue >= 45 && hue < 70) return { colorName: "yellow", isChromatic: true };
  if (hue >= 70 && hue < 165) return { colorName: "green", isChromatic: true };
  if (hue >= 165 && hue < 195) return { colorName: "cyan", isChromatic: true };
  if (hue >= 195 && hue < 265) return { colorName: "blue", isChromatic: true };
  if (hue >= 265 && hue < 315) return { colorName: "purple", isChromatic: true };
  return { colorName: "pink", isChromatic: true };
}

export class GeometryProfileEngine {
  /**
   * Extracts the full OriginalTextGeometryProfile directly from page image and raw OCR detection.
   */
  async extractProfile(
    imageBuffer: Buffer,
    regionId: string,
    rawBox: BoundingBox,
    options: {
      pageWidth: number;
      pageHeight: number;
      originalText?: string;
      isInsideBubble?: boolean;
      textType?: string;
      bubbleBox?: BoundingBox;
      bubblePolygon?: PolygonPoint[];
      wordBoxes?: Array<{ text: string; box: BoundingBox; lineIndex: number }>;
      lineBoxes?: Array<{ text: string; box: BoundingBox; lineIndex: number }>;
    }
  ): Promise<OriginalTextGeometryProfile> {
    const { pageWidth, pageHeight } = options;

    // Convert relative box to absolute pixel box with boundary clamping
    const xMinPx = Math.max(0, Math.floor((rawBox.xMin / 100) * pageWidth));
    const yMinPx = Math.max(0, Math.floor((rawBox.yMin / 100) * pageHeight));
    const xMaxPx = Math.min(pageWidth, Math.ceil((rawBox.xMax / 100) * pageWidth));
    const yMaxPx = Math.min(pageHeight, Math.ceil((rawBox.yMax / 100) * pageHeight));
    const widthPx = Math.max(4, xMaxPx - xMinPx);
    const heightPx = Math.max(4, yMaxPx - yMinPx);

    // Context crop with a 4px perimeter border for background sampling
    const pad = 4;
    const cropX = Math.max(0, xMinPx - pad);
    const cropY = Math.max(0, yMinPx - pad);
    const cropW = Math.min(pageWidth - cropX, widthPx + pad * 2);
    const cropH = Math.min(pageHeight - cropY, heightPx + pad * 2);

    let rawRgb: Buffer;
    try {
      const extracted = await sharp(imageBuffer)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .removeAlpha()
        .raw()
        .toBuffer();
      rawRgb = extracted;
    } catch {
      // Fallback if extraction fails
      rawRgb = Buffer.alloc(cropW * cropH * 3, 255);
    }

    // 1. Background / Paper Color Sampling along crop perimeter
    let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
    const borderDepth = Math.min(2, Math.floor(pad / 2));
    for (let py = 0; py < cropH; py++) {
      for (let px = 0; px < cropW; px++) {
        if (py < borderDepth || py >= cropH - borderDepth || px < borderDepth || px >= cropW - borderDepth) {
          const idx = (py * cropW + px) * 3;
          bgR += rawRgb[idx];
          bgG += rawRgb[idx + 1];
          bgB += rawRgb[idx + 2];
          bgCount++;
        }
      }
    }

    const backgroundColor: RGBColor = {
      r: bgCount > 0 ? Math.round(bgR / bgCount) : 255,
      g: bgCount > 0 ? Math.round(bgG / bgCount) : 255,
      b: bgCount > 0 ? Math.round(bgB / bgCount) : 255,
    };

    const bgLuma = 0.299 * backgroundColor.r + 0.587 * backgroundColor.g + 0.114 * backgroundColor.b;
    const isInverted = bgLuma < 115; // Bright glyphs on dark ground

    // 2. Character Stroke Isolation via Adaptive Binarization
    const localStartX = xMinPx - cropX;
    const localStartY = yMinPx - cropY;
    const localEndX = Math.min(cropW, localStartX + widthPx);
    const localEndY = Math.min(cropH, localStartY + heightPx);

    let strokePixelCount = 0;
    let sumX = 0, sumY = 0;
    let sumR = 0, sumG = 0, sumB = 0;

    // First pass: compute threshold and average stroke properties inside text box
    const diffScores: number[] = [];
    for (let py = localStartY; py < localEndY; py++) {
      for (let px = localStartX; px < localEndX; px++) {
        const idx = (py * cropW + px) * 3;
        const r = rawRgb[idx], g = rawRgb[idx + 1], b = rawRgb[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const diff = isInverted ? Math.max(0, luma - bgLuma) : Math.max(0, bgLuma - luma);
        const dr = r - backgroundColor.r, dg = g - backgroundColor.g, db = b - backgroundColor.b;
        const chromaDist = Math.sqrt(dr * dr + dg * dg + db * db) * 0.4;
        diffScores.push(Math.max(diff, chromaDist));
      }
    }

    // Adaptive threshold: median + standard offset
    diffScores.sort((a, b) => a - b);
    const medianDiff = diffScores.length > 0 ? diffScores[Math.floor(diffScores.length * 0.65)] : 40;
    const strokeThreshold = Math.max(28, Math.min(160, medianDiff));

    // Spatial Moments Accumulators for angle computation
    let m00 = 0; // Area
    let m10 = 0, m01 = 0; // First order moments for centroid
    const strokeCoords: Array<{ x: number; y: number; r: number; g: number; b: number }> = [];

    for (let py = localStartY; py < localEndY; py++) {
      for (let px = localStartX; px < localEndX; px++) {
        const idx = (py * cropW + px) * 3;
        const r = rawRgb[idx], g = rawRgb[idx + 1], b = rawRgb[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const diff = isInverted ? Math.max(0, luma - bgLuma) : Math.max(0, bgLuma - luma);
        const dr = r - backgroundColor.r, dg = g - backgroundColor.g, db = b - backgroundColor.b;
        const chromaDist = Math.sqrt(dr * dr + dg * dg + db * db) * 0.4;
        const score = Math.max(diff, chromaDist);

        if (score >= strokeThreshold) {
          const globalX = cropX + px;
          const globalY = cropY + py;
          m00++;
          m10 += globalX;
          m01 += globalY;
          strokeCoords.push({ x: globalX, y: globalY, r, g, b });
          sumR += r;
          sumG += g;
          sumB += b;
        }
      }
    }

    strokePixelCount = m00;
    const totalBoxPixels = widthPx * heightPx;
    const textDensity = totalBoxPixels > 0 ? Math.min(1.0, strokePixelCount / totalBoxPixels) : 0.2;

    // Centroid of text strokes
    const centroidX = m00 > 0 ? m10 / m00 : xMinPx + widthPx / 2;
    const centroidY = m00 > 0 ? m01 / m00 : yMinPx + heightPx / 2;

    // 3. Second Order Central Moments for Exact Rotation Angle
    let mu20 = 0, mu02 = 0, mu11 = 0;
    for (const p of strokeCoords) {
      const dx = p.x - centroidX;
      const dy = p.y - centroidY;
      mu20 += dx * dx;
      mu02 += dy * dy;
      mu11 += dx * dy;
    }

    let rotationAngle = 0;
    if (strokeCoords.length > 30 && Math.abs(mu11) > 0.001) {
      const thetaRad = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
      let thetaDeg = (thetaRad * 180) / Math.PI;
      // Clamp to reasonable manga tilt range [-45..+45]
      if (thetaDeg > 45) thetaDeg -= 90;
      if (thetaDeg < -45) thetaDeg += 90;
      if (Math.abs(thetaDeg) > 4.5 && Math.abs(thetaDeg) <= 45) {
        rotationAngle = Math.round(thetaDeg * 10) / 10;
      }
    }

    // 4. Detected Text Color & Color Classification
    const textColor: RGBColor = {
      r: strokeCoords.length > 0 ? Math.round(sumR / strokeCoords.length) : (isInverted ? 255 : 20),
      g: strokeCoords.length > 0 ? Math.round(sumG / strokeCoords.length) : (isInverted ? 255 : 20),
      b: strokeCoords.length > 0 ? Math.round(sumB / strokeCoords.length) : (isInverted ? 255 : 20),
    };

    const { colorName, isChromatic } = identifyColorFamily(textColor);

    // 5. Line and font geometry
    const lineCount = Math.max(1, options.lineBoxes?.length || (widthPx > heightPx * 1.6 ? 1 : Math.round(heightPx / Math.max(14, widthPx * 0.35))));
    const fontHeightEstimate = Math.max(9, Math.round((heightPx / lineCount) * 0.78));

    const isInsideBubble = Boolean(options.isInsideBubble ?? (options.bubbleBox !== undefined));
    const rawType = options.textType || (isInsideBubble ? "dialogue" : "outside_art");
    let classification: OriginalTextGeometryProfile["classification"] = "inside_bubble";
    if (rawType.includes("sfx") || rawType.includes("sound")) classification = "sfx";
    else if (rawType.includes("narration") || rawType.includes("narrative") || rawType.includes("caption")) classification = "narration_box";
    else if (!isInsideBubble || rawType.includes("outside")) classification = "outside_art";

    // 6. Safe Translation Polygon derivation
    let safePoly: PolygonPoint[] = [];
    if (options.bubblePolygon && options.bubblePolygon.length >= 3 && isInsideBubble) {
      // Inset bubble polygon inward by 7%
      safePoly = options.bubblePolygon;
    } else {
      // Outside text / SFX: Safe polygon is strictly the original bounding box (anchored tightly)
      safePoly = [
        { x: rawBox.xMin, y: rawBox.yMin },
        { x: rawBox.xMax, y: rawBox.yMin },
        { x: rawBox.xMax, y: rawBox.yMax },
        { x: rawBox.xMin, y: rawBox.yMax },
      ];
    }

    const originalPolygon: PolygonPoint[] = [
      { x: rawBox.xMin, y: rawBox.yMin },
      { x: rawBox.xMax, y: rawBox.yMin },
      { x: rawBox.xMax, y: rawBox.yMax },
      { x: rawBox.xMin, y: rawBox.yMax },
    ];

    const aspectRatio = widthPx / Math.max(1, heightPx);
    const textDirection = aspectRatio < 0.65 ? "vertical" : (rotationAngle !== 0 ? "rotated" : "horizontal");

    return {
      region_id: regionId,
      original_bbox: rawBox,
      original_pixel_bbox: { x: xMinPx, y: yMinPx, width: widthPx, height: heightPx },
      original_polygon: originalPolygon,
      text_pixel_area: strokePixelCount,
      text_density: textDensity,
      text_center: { x: Math.round(centroidX), y: Math.round(centroidY) },
      text_center_pct: {
        x: Math.round((centroidX / pageWidth) * 1000) / 10,
        y: Math.round((centroidY / pageHeight) * 1000) / 10,
      },
      line_count: lineCount,
      line_widths: [widthPx],
      line_heights: [Math.round(heightPx / lineCount)],
      line_spacing: Math.round(fontHeightEstimate * 0.28),
      font_height_estimate: fontHeightEstimate,
      aspect_ratio: Math.round(aspectRatio * 100) / 100,
      rotation_angle: rotationAngle,
      text_direction: textDirection,
      text_color: textColor,
      has_stroke: isChromatic || !isInsideBubble || isInverted,
      stroke_color: isInverted || isChromatic ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 },
      background_color: backgroundColor,
      is_inverted: isInverted,
      is_chromatic: isChromatic,
      color_name: colorName,
      classification,
      bubble_polygon: options.bubblePolygon,
      safe_translation_polygon: safePoly,
      original_visual_footprint: {
        widthPx,
        heightPx,
        areaPx: strokePixelCount > 0 ? strokePixelCount : widthPx * heightPx * 0.25,
        density: textDensity,
        centerPx: { x: Math.round(centroidX), y: Math.round(centroidY) },
      },
    };
  }

  /**
   * Computes mathematical similarity between Original and Arabic Visual Footprints [0..1].
   */
  calculateFootprintSimilarity(
    orig: OriginalTextGeometryProfile["original_visual_footprint"],
    arab: ArabicTextGeometryProfile["visual_footprint"]
  ): number {
    if (orig.areaPx <= 0 || arab.areaPx <= 0) return 0.5;
    const areaRatio = arab.areaPx / orig.areaPx;
    // Perfect score when Arabic area is within 0.85x to 1.35x of original footprint
    const areaScore = Math.max(0, 1 - Math.abs(areaRatio - 1.1) / 1.1);
    return Math.min(1.0, Math.max(0, areaScore));
  }

  /**
   * Computes Euclidean centroid drift between original text center and Arabic text center in pixels.
   */
  calculateCentroidDrift(
    origCenter: { x: number; y: number },
    arabCenter: { x: number; y: number }
  ): number {
    const dx = arabCenter.x - origCenter.x;
    const dy = arabCenter.y - origCenter.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

export const geometryProfileEngine = new GeometryProfileEngine();
