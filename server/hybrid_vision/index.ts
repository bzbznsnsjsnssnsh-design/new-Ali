export type * from "./types.ts";
export * from "./regionManager.ts";
export * from "./textSegmentation.ts";
export * from "./textMaskGenerator.ts";
export * from "./inpaintingEngine.ts";
export * from "./textRemoval.ts";
export * from "./ocrEngine.ts";
export * from "./ocrValidator.ts";
export * from "./textClassifier.ts";
export * from "./readingOrder.ts";
export * from "./textDetector.ts";
export * from "./textRenderer.ts";
export * from "./finalComposer.ts";
export * from "./geometryProfileEngine.ts";
export * from "./arabicLayoutSearch.ts";
export * from "./adapters/comicVisionOnnxAdapter.ts";

import { textRemoval } from "./textRemoval.ts";
import { textRenderer } from "./textRenderer.ts";
import { regionManager } from "./regionManager.ts";
import type { HybridRegion } from "./types.ts";
import sharp from "sharp";

/**
 * Drop-in upgrade for the server's inpaintPageText function.
 * Replaces crude rectangles with:
 * 1. Precise glyph-level masking.
 * 2. Paper-tone sampling + flood-fill inside speech bubbles.
 * 3. Contextual inpainting for text over artwork/clothes/hair.
 */
export async function hybridInpaintPageText(
  imageBuffer: Buffer,
  blocks: any[]
): Promise<Buffer> {
  if (!blocks || blocks.length === 0) {
    return imageBuffer;
  }

  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width || 1000;
  const h = meta.height || 1500;

  // Adapt incoming blocks into HybridRegion objects
  const regions: HybridRegion[] = blocks.map((b, idx) => {
    const rawBox = b.original_text_box || b.text_box || b.box || b.bbox || { xMin: 0, yMin: 0, xMax: 10, yMax: 10 };
    const r = regionManager.createRegion({
      region_id: b.region_id || b.id || regionManager.generateRegionId(idx + 1),
      reading_order: b.reading_order || idx + 1,
      original_text: b.original_text || b.originalText || "",
      translated_text: b.translated_text || b.translatedText || "",
      bbox: rawBox,
      is_inside_bubble: b.is_inside_bubble !== undefined ? b.is_inside_bubble : !Boolean(b.is_sfx || b.is_outside_text),
      text_type: b.text_type || (b.is_sfx ? "sfx" : (b.is_inside_bubble ? "dialogue" : "outside")),
      bubble_type: b.bubble_type || (b.is_inside_bubble ? "white" : "none"),
      confidence: b.confidence || 0.95,
    });

    if (b.bubble_polygon) r.bubble_polygon = b.bubble_polygon;
    if (b.safe_translation_polygon) r.safe_translation_polygon = b.safe_translation_polygon;
    if (b.safe_translation_area) r.safe_area = b.safe_translation_area;
    if (b.bubble_box) r.bubble_box = b.bubble_box;
    if (b.text_color) r.text_color = b.text_color;
    if (b.paper_color) r.paper_color = b.paper_color;
    if (b.rotation_angle) {
      r.rotation_angle = b.rotation_angle;
      r.is_rotated = true;
    }
    if (b.original_geometry_profile) r.original_geometry_profile = b.original_geometry_profile;

    return r;
  });

  const cleaned = await textRemoval.cleanPage(imageBuffer, regions, w, h);

  // Sync back extracted vision attributes onto the caller's blocks
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    const b = blocks[i];
    if (b) {
      if (r.text_color && !b.text_color) b.text_color = r.text_color;
      if (r.paper_color && !b.paper_color) b.paper_color = r.paper_color;
      if (r.original_geometry_profile && !b.original_geometry_profile) b.original_geometry_profile = r.original_geometry_profile;
    }
  }

  return cleaned;
}

/**
 * High-fidelity Arabic Typesetting renderer for cleaned pages.
 */
export async function hybridRenderArabicPage(
  cleanImageBuffer: Buffer,
  blocks: any[]
): Promise<Buffer> {
  if (!blocks || blocks.length === 0) {
    return cleanImageBuffer;
  }

  const meta = await sharp(cleanImageBuffer).metadata();
  const w = meta.width || 1000;
  const h = meta.height || 1500;

  const regions: HybridRegion[] = blocks.map((b, idx) => {
    const rawBox = b.original_text_box || b.text_box || b.box || b.bbox || { xMin: 0, yMin: 0, xMax: 10, yMax: 10 };
    const r = regionManager.createRegion({
      region_id: b.region_id || b.id || regionManager.generateRegionId(idx + 1),
      reading_order: b.reading_order || idx + 1,
      original_text: b.original_text || b.originalText || "",
      translated_text: b.translated_text || b.translatedText || "",
      bbox: rawBox,
      is_inside_bubble: b.is_inside_bubble !== undefined ? b.is_inside_bubble : !Boolean(b.is_sfx || b.is_outside_text),
      text_type: b.text_type || (b.is_sfx ? "sfx" : (b.is_inside_bubble ? "dialogue" : "outside")),
      bubble_type: b.bubble_type || "white",
    });

    if (b.safe_translation_area) r.safe_translation_area = b.safe_translation_area;
    if (b.bubble_box) r.bubble_box = b.bubble_box;
    if (b.bubble_polygon) r.bubble_polygon = b.bubble_polygon;
    if (b.safe_translation_polygon) r.safe_translation_polygon = b.safe_translation_polygon;
    if (b.polygon) r.polygon = b.polygon;
    if (b.rotation_angle) {
      r.rotation_angle = b.rotation_angle;
      r.is_rotated = true;
    }
    if (b.text_color) r.text_color = b.text_color;
    if (b.paper_color) r.paper_color = b.paper_color;
    if (b.original_geometry_profile) r.original_geometry_profile = b.original_geometry_profile;
    if (b.relative_anchor) r.relative_anchor = b.relative_anchor;
    if (b.visual_text_scale) r.visual_text_scale = b.visual_text_scale;

    return r;
  });

  return await textRenderer.renderArabicText(cleanImageBuffer, regions, w, h);
}
