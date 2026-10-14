import type { HybridRegion, IReadingOrder } from "./types.ts";

export class ReadingOrderEngine implements IReadingOrder {
  /**
   * Sorts text regions into natural narrative reading order.
   * Japanese Manga: Top-to-Bottom, Right-to-Left (RTL).
   * Korean Manhwa / Webtoon / Western Comics: Top-to-Bottom, Left-to-Right (LTR).
   */
  orderRegions(
    regions: HybridRegion[],
    options: {
      readingDirection: "rtl" | "ltr";
      isWebtoon: boolean;
      pageWidth: number;
      pageHeight: number;
    }
  ): HybridRegion[] {
    if (!regions || regions.length <= 1) {
      return [...regions];
    }

    const { readingDirection = "rtl", isWebtoon = false } = options;

    // Clone regions to prevent side-effects
    const sorted = [...regions];

    sorted.sort((a, b) => {
      // 1. If both belong to distinct panels, panel order takes precedence
      if (a.panel_id && b.panel_id && a.panel_id !== b.panel_id) {
        return a.panel_id.localeCompare(b.panel_id);
      }

      const aCenterY = (a.bbox.yMin + a.bbox.yMax) / 2;
      const bCenterY = (b.bbox.yMin + b.bbox.yMax) / 2;
      const yDiff = aCenterY - bCenterY;

      // 2. For Webtoons, vertical position strongly dominates
      if (isWebtoon) {
        if (Math.abs(yDiff) > 1.5) {
          return yDiff;
        }
        return a.bbox.xMin - b.bbox.xMin; // Left to right within same horizontal band
      }

      // 3. Manga Standard Layout: Bands and Columns
      // If two bubbles are roughly in the same vertical row (within 10% page height)
      if (Math.abs(yDiff) < 10) {
        if (readingDirection === "rtl") {
          // Right-to-left: the bubble further to the RIGHT comes first (higher xMin/xMax)
          return b.bbox.xMax - a.bbox.xMax;
        } else {
          // Left-to-right: the bubble further to the LEFT comes first
          return a.bbox.xMin - b.bbox.xMin;
        }
      }

      // Otherwise, the bubble higher on the page comes first
      return yDiff;
    });

    // Re-assign reading_order indices sequentially
    return sorted.map((region, idx) => ({
      ...region,
      reading_order: idx + 1,
    }));
  }
}

export const readingOrderEngine = new ReadingOrderEngine();
