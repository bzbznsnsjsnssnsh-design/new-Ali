import type {
  OcrSegment,
  Panel,
  Bubble,
  GraphGroupingResult,
  GroupingEdge
} from "./types/mangaTypes.ts";
import { analyzeVisualBarrier, Point2D } from "./barrierAnalysisEngine.ts";
import type { BoundingBox } from "../src/types.ts";

/**
 * Production-Grade Graph Grouping Engine for Manga / Webtoon Text Regions
 * 
 * Accurately clusters fragmented OCR lines into cohesive speech bubble regions
 * using strict physical barrier detection, panel boundary isolation, and spatial proximity.
 */
export function executeGraphGrouping(
  segments: OcrSegment[],
  panels: Panel[],
  segmentPanels: Map<number, Panel>,
  segmentBubbles: Map<number, Bubble | null>,
  pixels: Uint8ClampedArray | Buffer | null,
  width: number,
  height: number,
  isRtlReading: boolean
): GraphGroupingResult {
  const edges: GroupingEdge[] = [];
  const auditLog: string[] = [];

  if (!segments || segments.length === 0) {
    return { edges: [], clusters: [], auditLog: ["No segments to group"] };
  }

  const n = segments.length;
  // Disjoint Set Union (DSU) for connected components
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (i: number, j: number) => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
    }
  };

  const clampedPixels =
    pixels instanceof Uint8ClampedArray
      ? pixels
      : pixels
      ? new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength)
      : null;

  // Evaluate candidate grouping edges between segment pairs
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const segA = segments[i];
      const segB = segments[j];

      const pA = segmentPanels.get(i);
      const pB = segmentPanels.get(j);

      // 1. HARD RULE: Segments in different panels must NEVER be grouped
      if (pA && pB && pA.id !== pB.id) {
        edges.push({
          fromIdx: i,
          toIdx: j,
          classification: "BLOCKED",
          weight: 0,
          reason: `Distinct panels (${pA.id} vs ${pB.id})`
        });
        continue;
      }

      const bubA = segmentBubbles.get(i);
      const bubB = segmentBubbles.get(j);

      // 2. HARD RULE: Segments in distinct explicit bubbles must NEVER be grouped
      if (bubA && bubB && bubA.id !== bubB.id) {
        edges.push({
          fromIdx: i,
          toIdx: j,
          classification: "BLOCKED",
          weight: 0,
          reason: `Distinct bubble containers (${bubA.id} vs ${bubB.id})`
        });
        continue;
      }

      // 3. STRONG RULE: If both segments are confirmed in the exact same bubble container => ALLOWED
      if (bubA && bubB && bubA.id === bubB.id) {
        edges.push({
          fromIdx: i,
          toIdx: j,
          classification: "ALLOWED",
          weight: 0.98,
          reason: `Shared bubble container (${bubA.id})`
        });
        union(i, j);
        continue;
      }

      // 4. Visual Barrier Analysis
      const boxA: BoundingBox = {
        xMin: segA.x1Pct,
        xMax: segA.x2Pct,
        yMin: segA.y1Pct,
        yMax: segA.y2Pct
      };
      const boxB: BoundingBox = {
        xMin: segB.x1Pct,
        xMax: segB.x2Pct,
        yMin: segB.y1Pct,
        yMax: segB.y2Pct
      };
      const ptA: Point2D = { x: segA.cxPct, y: segA.cyPct };
      const ptB: Point2D = { x: segB.cxPct, y: segB.cyPct };

      if (clampedPixels && width > 0 && height > 0) {
        const barrier = analyzeVisualBarrier(
          clampedPixels,
          width,
          height,
          ptA,
          ptB,
          boxA,
          boxB,
          [],
          pA,
          pB,
          bubA,
          bubB
        );

        if (barrier.hasBarrier) {
          edges.push({
            fromIdx: i,
            toIdx: j,
            classification: "BLOCKED",
            weight: 0,
            reason: barrier.reason || "Visual barrier detected between lines"
          });
          continue;
        }
      }

      // 5. Geometric Proximity Evaluation
      const gapY = Math.max(0, Math.max(boxA.yMin, boxB.yMin) - Math.min(boxA.yMax, boxB.yMax));
      const overlapX = Math.max(0, Math.min(boxA.xMax, boxB.xMax) - Math.max(boxA.xMin, boxB.xMin));
      const minW = Math.min(segA.wPct, segB.wPct);
      const maxH = Math.max(segA.hPct, segB.hPct);

      const gapX = Math.max(0, Math.max(boxA.xMin, boxB.xMin) - Math.min(boxA.xMax, boxB.xMax));
      const overlapY = Math.max(0, Math.min(boxA.yMax, boxB.yMax) - Math.max(boxA.yMin, boxB.yMin));
      const minH = Math.min(segA.hPct, segB.hPct);
      const maxW = Math.max(segA.wPct, segB.wPct);

      // Vertical line stack condition (horizontal text paragraphs)
      const isVerticalStack =
        gapY <= Math.max(maxH * 2.2, 3.5) &&
        (overlapX >= minW * 0.15 || Math.abs(segA.cxPct - segB.cxPct) <= 8.0);

      // Horizontal column stack condition (vertical CJK text)
      const isHorizontalStack =
        gapX <= Math.max(maxW * 2.2, 4.0) &&
        (overlapY >= minH * 0.25 || Math.abs(segA.cyPct - segB.cyPct) <= 8.0);

      if (isVerticalStack || isHorizontalStack) {
        edges.push({
          fromIdx: i,
          toIdx: j,
          classification: "ALLOWED",
          weight: 0.85,
          reason: isVerticalStack ? "Proximity vertical line stack" : "Proximity column stack"
        });
        union(i, j);
      } else {
        edges.push({
          fromIdx: i,
          toIdx: j,
          classification: "BLOCKED",
          weight: 0.1,
          reason: "Too far apart spatially"
        });
      }
    }
  }

  // Aggregate clusters from DSU roots
  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusterMap.has(root)) {
      clusterMap.set(root, []);
    }
    clusterMap.get(root)!.push(i);
  }

  const clusters = Array.from(clusterMap.values());
  auditLog.push(`Formed ${clusters.length} text region clusters from ${n} OCR segments`);

  return {
    edges,
    clusters,
    auditLog
  };
}
