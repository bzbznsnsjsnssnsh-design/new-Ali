import type { HybridRegion, GlyphMaskData, ITextMaskGenerator } from "./types.ts";
import { textSegmentation } from "./textSegmentation.ts";

export class TextMaskGenerator implements ITextMaskGenerator {
  /**
   * Generates a precise glyph-following mask across all regions of a manga page.
   * Strictly avoids crude white bounding boxes or solid rectangle covers.
   * Ensures 'HELLO' is masked as individual strokes 'H E L L O'.
   */
  async generatePreciseMask(
    imageBuffer: Buffer,
    regions: HybridRegion[],
    pageWidth: number,
    pageHeight: number
  ): Promise<{
    pageMaskBuffer: Buffer;
    regionMasks: Map<string, GlyphMaskData>;
  }> {
    const totalPagePixels = pageWidth * pageHeight;
    const pageMask = Buffer.alloc(totalPagePixels, 0); // 0 = keep original, 255 = text to inpaint
    const regionMasks = new Map<string, GlyphMaskData>();

    for (const region of regions) {
      // 1. Perform pixel-level segmentation on this region
      const glyphData = await textSegmentation.segmentRegion(
        imageBuffer,
        region,
        pageWidth,
        pageHeight
      );

      // Store in map
      regionMasks.set(region.region_id, glyphData);
      region.glyph_mask = glyphData;
      region.paper_color = glyphData.paperColor;
      region.text_color = glyphData.textColor;

      // 2. Controlled Morphological Dilation (Radius: 2px)
      // Absorbs antialiasing fringes and ink bleed while strictly preserving bubble borders
      const dilatedMask = this.dilateMask(glyphData.maskBuffer, glyphData.width, glyphData.height, 2);

      // 3. Composite dilated glyph mask onto the global page mask
      const { x: rx, y: ry, width: rw, height: rh } = glyphData.bounds;

      for (let y = 0; y < rh; y++) {
        const pageY = ry + y;
        if (pageY < 0 || pageY >= pageHeight) continue;

        for (let x = 0; x < rw; x++) {
          const pageX = rx + x;
          if (pageX < 0 || pageX >= pageWidth) continue;

          const localIdx = y * rw + x;
          if (dilatedMask[localIdx] === 255) {
            const pageIdx = pageY * pageWidth + pageX;
            pageMask[pageIdx] = 255;
          }
        }
      }
    }

    return {
      pageMaskBuffer: pageMask,
      regionMasks,
    };
  }

  /**
   * Morphological dilation using a 3x3 circular/cross structuring element.
   * Based on juvian/Manga-Text-Segmentation binary_dilation technique.
   */
  private dilateMask(
    src: Buffer,
    w: number,
    h: number,
    iterations: number = 2
  ): Buffer {
    let current = Buffer.from(src);

    for (let iter = 0; iter < iterations; iter++) {
      const next = Buffer.alloc(w * h, 0);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (current[idx] === 255) {
            next[idx] = 255;
            // Dilate 8-connected neighbors
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                  next[ny * w + nx] = 255;
                }
              }
            }
          }
        }
      }
      current = next;
    }

    return current;
  }
}

export const textMaskGenerator = new TextMaskGenerator();
