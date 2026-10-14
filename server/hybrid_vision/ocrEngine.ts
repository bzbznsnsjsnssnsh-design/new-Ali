import sharp from "sharp";
import type { HybridRegion, IOCREngine } from "./types.ts";
import { scanLensHierarchical } from "../ocrReadingOrderEngine.ts";
import { getLensInstance } from "./lensHelper.ts";
import { createWorker } from "tesseract.js";

export class OCREngine implements IOCREngine {
  private tesseractWorkers = new Map<string, any>();

  /**
   * Recognizes text within a region, applying language-specific routing and fallback heuristics.
   */
  async recognizeRegion(
    imageBuffer: Buffer,
    region: HybridRegion,
    options?: {
      preferredLanguage?: string;
      isVertical?: boolean;
    }
  ): Promise<{
    text: string;
    confidence: number;
    detectedLanguage: string;
    wordBoxes?: Array<{ text: string; box: any; lineIndex: number; wordIndex: number }>;
    lineBoxes?: Array<{ text: string; box: any; lineIndex: number }>;
  }> {
    // If region already has high quality reconstructed text from page-level hierarchical scan, reuse it
    if (region.original_text && region.confidence > 0.85 && region.word_boxes && region.word_boxes.length > 0) {
      return {
        text: region.original_text,
        confidence: region.confidence,
        detectedLanguage: this.detectLanguageFromScript(region.original_text),
        wordBoxes: region.word_boxes as any,
        lineBoxes: region.line_boxes as any,
      };
    }

    // Otherwise, perform targeted crop OCR on this specific region
    const meta = await sharp(imageBuffer).metadata();
    const pw = meta.width || 1000;
    const ph = meta.height || 1500;

    const box = region.bbox;
    const pad = 4;
    const x = Math.max(0, Math.floor((box.xMin / 100) * pw) - pad);
    const y = Math.max(0, Math.floor((box.yMin / 100) * ph) - pad);
    const w = Math.min(pw - x, Math.ceil(((box.xMax - box.xMin) / 100) * pw) + pad * 2);
    const h = Math.min(ph - y, Math.ceil(((box.yMax - box.yMin) / 100) * ph) + pad * 2);

    if (w <= 5 || h <= 5) {
      return {
        text: "",
        confidence: 0,
        detectedLanguage: "unknown",
      };
    }

    // Extract cropped image with contrast enhancement
    const cropBuffer = await sharp(imageBuffer)
      .extract({ left: x, top: y, width: w, height: h })
      .normalize()
      .sharpen()
      .png()
      .toBuffer();

    // 1. Try Google Lens Hierarchical Scan on Crop
    try {
      const lensResult = await scanLensHierarchical(
        getLensInstance(),
        cropBuffer,
        w,
        h,
        options?.preferredLanguage || "en"
      );
      const fullText = (lensResult.allLines?.map((l) => l.text).join("\n") || "").trim();
      if (fullText.length > 0) {
        const text = fullText;
        return {
          text,
          confidence: 0.92,
          detectedLanguage: this.detectLanguageFromScript(text),
        };
      }
    } catch {
      // Fall through to Tesseract fallback
    }

    // 2. Multilingual Tesseract Fallback
    try {
      const worker = await this.getWorker(options?.preferredLanguage || "eng");
      const tessRes = await worker.recognize(cropBuffer);
      const text = (tessRes?.data?.text || "").trim();
      const conf = Math.max(0.3, Math.min(1.0, (tessRes?.data?.confidence || 50) / 100));

      return {
        text,
        confidence: conf,
        detectedLanguage: this.detectLanguageFromScript(text),
      };
    } catch {
      return {
        text: region.original_text || "",
        confidence: 0.5,
        detectedLanguage: "unknown",
      };
    }
  }

  /**
   * Fast script analysis to detect language family from character Unicode codepoints.
   */
  private detectLanguageFromScript(text: string): string {
    if (!text) return "unknown";
    if (/[\u3040-\u30ff]/.test(text)) return "ja"; // Hiragana / Katakana
    if (/[\uac00-\ud7af]/.test(text)) return "ko"; // Hangul
    if (/[\u4e00-\u9fff]/.test(text)) return "zh"; // Hanzi
    if (/[\u0600-\u06ff]/.test(text)) return "ar"; // Arabic
    if (/[a-zA-Z]/.test(text)) return "en";
    return "auto";
  }

  private async getWorker(langCode: string): Promise<any> {
    let target = "eng";
    const lower = langCode.toLowerCase();
    if (lower.includes("ja")) target = "jpn+eng";
    else if (lower.includes("ko")) target = "kor+eng";
    else if (lower.includes("zh")) target = "chi_sim+eng";

    if (this.tesseractWorkers.has(target)) {
      return this.tesseractWorkers.get(target);
    }

    const worker = await createWorker(target);
    this.tesseractWorkers.set(target, worker);
    return worker;
  }
}

export const ocrEngine = new OCREngine();
