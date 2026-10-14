import type { GlyphMaskData, HybridRegion, ITextSegmentation } from "./types.ts";

export class TextSegmentation implements ITextSegmentation {
  async segmentRegion(
    _imageBuffer: Buffer,
    region: HybridRegion,
    pageWidth: number,
    pageHeight: number
  ): Promise<GlyphMaskData> {
    const x = Math.max(0, Math.round((region.bbox.x / 100) * pageWidth));
    const y = Math.max(0, Math.round((region.bbox.y / 100) * pageHeight));
    const width = Math.max(1, Math.round((region.bbox.width / 100) * pageWidth));
    const height = Math.max(1, Math.round((region.bbox.height / 100) * pageHeight));

    return {
      width,
      height,
      maskBuffer: Buffer.alloc(width * height, 0),
      bounds: { x, y, width, height },
      textColor: { r: 15, g: 23, b: 42 },
      paperColor: { r: 255, g: 255, b: 255 },
      isInverted: false,
      glyphContours: [],
    };
  }
}

export const textSegmentation = new TextSegmentation();
