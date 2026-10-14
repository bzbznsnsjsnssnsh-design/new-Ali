import type { BoundingBox, IInpaintingEngine } from "./types.ts";

export class InpaintingEngine implements IInpaintingEngine {
  async inpaintArtwork(
    imageBuffer: Buffer,
    _maskBuffer: Buffer,
    _boundingBoxes: BoundingBox[],
    _pageWidth: number,
    _pageHeight: number
  ): Promise<Buffer> {
    return imageBuffer;
  }
}

export const inpaintingEngine = new InpaintingEngine();
