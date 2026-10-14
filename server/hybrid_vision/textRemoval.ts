import sharp from "sharp";
import type { HybridRegion, ITextRemoval } from "./types.ts";
import { textMaskGenerator } from "./textMaskGenerator.ts";
import { inpaintingEngine } from "./inpaintingEngine.ts";

export class TextRemoval implements ITextRemoval {
  /**
   * Cleans the manga page by eliminating original text without destroying artwork or bubble borders.
   * Dual-path architecture:
   * Path A (Inside Bubble): Paper-tone sampling + precise glyph erasure + interior tone restoration.
   * Path B (Outside Bubble / Complex Art): Precise glyph mask + PDE isophote inpainting.
   */
  async cleanPage(
    imageBuffer: Buffer,
    regions: HybridRegion[],
    pageWidth: number,
    pageHeight: number
  ): Promise<Buffer> {
    if (!regions || regions.length === 0) {
      return imageBuffer;
    }

    // 1. Generate precise character-level glyph masks for all regions
    const { pageMaskBuffer, regionMasks } = await textMaskGenerator.generatePreciseMask(
      imageBuffer,
      regions,
      pageWidth,
      pageHeight
    );

    // 2. Separate regions into (A) inside bubbles and (B) outside on artwork
    const insideBubbleRegions: HybridRegion[] = [];
    const artworkRegions: HybridRegion[] = [];

    for (const r of regions) {
      if (r.is_inside_bubble && r.bubble_type !== "none") {
        insideBubbleRegions.push(r);
      } else {
        artworkRegions.push(r);
      }
    }

    // Load full image into raw RGB pixel buffer
    const { data: pageRgb, info } = await sharp(imageBuffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const workingBuffer = Buffer.from(pageRgb);

    // 3. Path A: Clean Inside Speech Bubbles
    for (const region of insideBubbleRegions) {
      const glyphData = regionMasks.get(region.region_id);
      if (!glyphData) continue;

      const { x: rx, y: ry, width: rw, height: rh } = glyphData.bounds;
      const paperColor = glyphData.paperColor;
      const mask = glyphData.maskBuffer;

      // Fill only the detected character stroke pixels with the exact local paper color
      for (let ly = 0; ly < rh; ly++) {
        const py = ry + ly;
        if (py < 0 || py >= h) continue;

        for (let lx = 0; lx < rw; lx++) {
          const px = rx + lx;
          if (px < 0 || px >= w) continue;

          // Check if this pixel is inside the dilated glyph mask on the page
          const pageMaskVal = pageMaskBuffer[py * w + px];
          if (pageMaskVal === 255) {
            const pageIdx = (py * w + px) * 3;
            workingBuffer[pageIdx] = paperColor.r;
            workingBuffer[pageIdx + 1] = paperColor.g;
            workingBuffer[pageIdx + 2] = paperColor.b;
          }
        }
      }

      // If speech bubble is white/light, apply subtle interior cleaning only adjacent to character strokes
      if (!glyphData.isInverted && paperColor.r > 200 && paperColor.g > 200 && paperColor.b > 200) {
        this.cleanBubbleInteriorHalos(workingBuffer, pageMaskBuffer, glyphData.bounds, w, h, paperColor);
      }
    }

    // 4. Path B: Clean Outside Text / Artwork (Hair, Clothes, Scenery, Wall) via Inpainting
    let intermediateBuffer = await sharp(workingBuffer, {
      raw: { width: w, height: h, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    if (artworkRegions.length > 0) {
      const artworkBoxes = artworkRegions.map((r) => r.bbox);
      intermediateBuffer = await inpaintingEngine.inpaintArtwork(
        intermediateBuffer,
        pageMaskBuffer,
        artworkBoxes,
        w,
        h
      );
    }

    return intermediateBuffer;
  }

  /**
   * Erases faint residual ink halos inside a clean speech bubble without touching the outer stroke.
   */
  private cleanBubbleInteriorHalos(
    rgb: Buffer,
    pageMask: Buffer,
    bounds: { x: number; y: number; width: number; height: number },
    pageW: number,
    pageH: number,
    paperColor: { r: number; g: number; b: number }
  ): void {
    const { x: rx, y: ry, width: rw, height: rh } = bounds;
    const inset = 4;
    const x1 = Math.max(0, rx + inset);
    const y1 = Math.max(0, ry + inset);
    const x2 = Math.min(pageW, rx + rw - inset);
    const y2 = Math.min(pageH, ry + rh - inset);

    for (let py = y1; py < y2; py++) {
      for (let px = x1; px < x2; px++) {
        const maskIdx = py * pageW + px;
        // Strictly only clean if this pixel or its immediate 1px neighbor is part of a masked character stroke
        let isNearMask = pageMask[maskIdx] === 255;
        if (!isNearMask) {
          for (let dy = -1; dy <= 1 && !isNearMask; dy++) {
            for (let dx = -1; dx <= 1 && !isNearMask; dx++) {
              const ny = py + dy;
              const nx = px + dx;
              if (nx >= 0 && nx < pageW && ny >= 0 && ny < pageH) {
                if (pageMask[ny * pageW + nx] === 255) {
                  isNearMask = true;
                }
              }
            }
          }
        }

        if (!isNearMask) continue;

        const idx = maskIdx * 3;
        const r = rgb[idx];
        const g = rgb[idx + 1];
        const b = rgb[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;

        // If the pixel is near-white (light gray anti-aliasing halo adjacent to the character > 220)
        if (luma > 220 && luma < 252) {
          rgb[idx] = paperColor.r;
          rgb[idx + 1] = paperColor.g;
          rgb[idx + 2] = paperColor.b;
        }
      }
    }
  }
}

export const textRemoval = new TextRemoval();
