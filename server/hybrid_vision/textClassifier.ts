import type { HybridRegion, HybridTextType, ITextClassifier } from "./types.ts";
import { isSoundEffectText } from "../mangaVisionGeometryEngine.ts";

export class TextClassifier implements ITextClassifier {
  /**
   * Classifies regions into semantic manga text categories:
   * dialogue, narration, sfx, outside, title.
   */
  classify(
    region: HybridRegion,
    imageBuffer: Buffer,
    pageWidth: number,
    pageHeight: number
  ): HybridTextType {
    const text = (region.original_text || "").trim();
    const box = region.bbox;
    const boxW = box.xMax - box.xMin;
    const boxH = box.yMax - box.yMin;
    const aspectRatio = boxW / Math.max(0.1, boxH);
    const boxArea = boxW * boxH;

    // 1. Multilingual SFX (Sound Effects) check across Japanese, Korean, Chinese, English, Cyrillic, Arabic
    if (isSoundEffectText(text)) {
      return "sfx";
    }

    const isKatakanaDominant = /^[\u30A0-\u30FF\u31F0-\u31FF\s!?.~ー]+$/.test(text);
    if ((!region.is_inside_bubble || region.bubble_type === "none") && (isKatakanaDominant || region.is_sfx)) {
      return "sfx";
    }

    // Huge standalone text without bubble
    if (!region.is_inside_bubble && boxArea > 50 && text.length <= 8) {
      return "sfx";
    }

    // 2. Title / Chapter headers
    if (/^(chapter|ch\.|episode|ep\.|vol\.|volume|act|فصل|الفصل|الحلقة|المجلد)\s*\d+/i.test(text)) {
      return "title";
    }

    // 3. Narration Box check
    if (region.is_narration) {
      return "narration";
    }
    // Wide rectangular narration banner or vertical column
    if (region.is_inside_bubble && (aspectRatio > 2.6 || aspectRatio < 0.35) && text.length > 20) {
      return "narration";
    }

    // 4. Outside Text
    if (!region.is_inside_bubble || region.bubble_type === "none") {
      return "outside";
    }

    // 5. Default Dialogue inside speech bubble
    return "dialogue";
  }
}

export const textClassifier = new TextClassifier();

