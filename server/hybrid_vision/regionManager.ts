import type { HybridRegion, IRegionManager } from "./types.ts";

export class RegionManager implements IRegionManager {
  generateRegionId(index: number): string {
    return `r_${String(index + 1).padStart(3, "0")}`;
  }

  createRegion(params: Partial<HybridRegion> & { reading_order: number }): HybridRegion {
    const id = params.region_id || params.id || this.generateRegionId((params.reading_order || 1) - 1);
    const box = params.box || params.bbox || { x: 0, y: 0, width: 10, height: 10 };
    const safeArea = params.safe_translation_area || params.safe_area || box;
    const orig = params.original_text || params.original || params.originalText || "";
    const trans = params.translated_text || params.translated || params.translatedText || "";

    return {
      ...params,
      id,
      region_id: id,
      box,
      bbox: box,
      polygon: params.polygon || [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height },
      ],
      text_type: params.text_type || "dialogue",
      bubble_type: params.bubble_type || "white",
      direction: params.direction || "horizontal",
      reading_order: params.reading_order || 1,
      original: orig,
      original_text: orig,
      originalText: orig,
      translated: trans,
      translated_text: trans,
      translatedText: trans,
      confidence: params.confidence ?? 0.9,
      is_inside_bubble: params.is_inside_bubble ?? true,
      safe_area: safeArea,
      safe_translation_area: safeArea,
      parent_bubble_id: params.parent_bubble_id || null,
      validation_status: params.validation_status || {
        isValid: true,
        retryCount: 0,
        anomalies: [],
      },
    };
  }

  assignStableIds(regions: HybridRegion[]): HybridRegion[] {
    return regions.map((r, idx) => {
      const id = this.generateRegionId(idx);
      return {
        ...r,
        id,
        region_id: id,
        reading_order: idx + 1,
      };
    });
  }

  getRegionById(regions: HybridRegion[], regionId: string): HybridRegion | undefined {
    return regions.find((r) => r.region_id === regionId || r.id === regionId);
  }

  mergeAdjacentRegions(r1: HybridRegion, r2: HybridRegion): HybridRegion {
    const xMin = Math.min(r1.bbox.x, r2.bbox.x);
    const yMin = Math.min(r1.bbox.y, r2.bbox.y);
    const xMax = Math.max(r1.bbox.x + r1.bbox.width, r2.bbox.x + r2.bbox.width);
    const yMax = Math.max(r1.bbox.y + r1.bbox.height, r2.bbox.y + r2.bbox.height);
    const mergedBox = { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin };
    const mergedOrig = `${r1.original_text} ${r2.original_text}`.trim();

    return this.createRegion({
      ...r1,
      box: mergedBox,
      bbox: mergedBox,
      safe_area: mergedBox,
      safe_translation_area: mergedBox,
      original: mergedOrig,
      original_text: mergedOrig,
      originalText: mergedOrig,
    });
  }
}

export const regionManager = new RegionManager();
