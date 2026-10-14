import type { HybridRegion, ITextRenderer } from "./types.ts";

export class TextRenderer implements ITextRenderer {
  async renderArabicText(
    cleanImageBuffer: Buffer,
    _regions: HybridRegion[],
    _pageWidth: number,
    _pageHeight: number,
    _options?: {
      fontFamily?: string;
      primaryColor?: string;
      strokeColor?: string;
      minFontSize?: number;
      maxFontSize?: number;
    }
  ): Promise<Buffer> {
    return cleanImageBuffer;
  }
}

export const textRenderer = new TextRenderer();
