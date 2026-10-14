import type { HybridRegion, IOCRValidator } from "./types.ts";

export class OCRValidator implements IOCRValidator {
  validate(
    text: string,
    confidence: number,
    _region: HybridRegion
  ): {
    isValid: boolean;
    isSuspicious: boolean;
    score: number;
    anomalies: string[];
    recommendedAction:
      | "accept"
      | "retry_with_contrast"
      | "retry_with_rotation"
      | "retry_with_sharpen"
      | "reject";
  } {
    const clean = (text || "").trim();
    if (!clean) {
      return {
        isValid: false,
        isSuspicious: true,
        score: 0,
        anomalies: ["EMPTY_TEXT"],
        recommendedAction: "reject",
      };
    }
    return {
      isValid: true,
      isSuspicious: confidence < 0.45,
      score: Math.max(0, Math.min(1, confidence || 0.9)),
      anomalies: [],
      recommendedAction: "accept",
    };
  }
}

export const ocrValidator = new OCRValidator();
