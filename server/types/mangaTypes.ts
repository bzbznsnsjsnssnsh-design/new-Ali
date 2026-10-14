import type { BoundingBox, PolygonPoint, TranslationArea, OCRBlock } from "../../src/types.ts";

/**
 * Hierarchical Page Understanding Model
 * Level 1: PageAnalysis (Global Page Context)
 * Level 2: Panel (Physical Manga Frame / Panel)
 * Level 3: Bubble / Container (Physical Speech Bubble, Thought Bubble, Narration Box)
 * Level 4: TextRegion (Logical Reading Entity / Dialogue Block)
 * Level 5: Line & Word Segments (OCR Raw Glyph Detections)
 */

export interface PageDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  isWebtoon: boolean;
}

export interface OcrSegment {
  idx: number;
  text: string;
  x1Pct: number;
  y1Pct: number;
  x2Pct: number;
  y2Pct: number;
  wPct: number;
  hPct: number;
  cxPct: number;
  cyPct: number;
  confidence?: number;
  words?: any[];
  rawSeg?: any;
}

export type PanelBorderType = "solid_black" | "white_gutter" | "borderless" | "full_page";

export interface Panel {
  id: string; // e.g., 'panel_1', 'panel_2'
  index: number;
  box: BoundingBox; // Normalized 0..100
  pixelBox: { x: number; y: number; width: number; height: number };
  borderType: PanelBorderType;
  confidence: number;
  bubbleIds: string[];
  regionIds: string[];
}

export type BubbleType =
  | "dialogue"
  | "thought"
  | "scream"
  | "narration"
  | "outside"
  | "sfx"
  | "whisper"
  | "title"
  | "other";

export interface Bubble {
  id: string; // Stable ID: e.g. 'bubble_p1_01_24_15'
  panelId: string | null;
  box: BoundingBox; // Outer bounding box (0..100)
  safeArea: TranslationArea; // Bounded safe inset for typesetting
  polygon?: PolygonPoint[];
  bubbleType: BubbleType;
  isInsideBubble: boolean;
  hasBorder: boolean;
  borderStrokeColor?: "dark" | "light" | "none";
  backgroundColor: "white" | "dark" | "transparent" | "screentone";
  confidence: number;
  segmentIndices: number[];
  regionIds: string[];
}

export type EdgeClassification = "ALLOWED" | "BLOCKED" | "POSSIBLE";

export interface GroupingEdge {
  fromIdx: number;
  toIdx: number;
  classification: EdgeClassification;
  weight: number; // 0..1
  reason: string;
}

export interface GraphGroupingResult {
  edges: GroupingEdge[];
  clusters: number[][]; // Groups of segment indices
  auditLog: string[];
}

export interface BarrierAnalysisResult {
  hasBarrier: boolean;
  barrierType?:
    | "panel_border"
    | "gutter"
    | "bubble_contour"
    | "multimodal_artwork_valley"
    | "discrete_bubble_separation"
    | "type_discrepancy"
    | "none";
  confidence: number;
  reason?: string;
}

export interface TextRegion extends OCRBlock {
  panel_id?: string | null;
  panelId?: string | null;
  bubble_id?: string | null;
  bubbleId?: string | null;
  segments_count?: number;
  merging_confidence?: number;
}

export interface PageAnalysis {
  pageDimensions: PageDimensions;
  panels: Panel[];
  bubbles: Bubble[];
  regions: TextRegion[];
  graphResult?: GraphGroupingResult;
  audit: {
    rawSegmentsCount: number;
    deduplicatedSegmentsCount: number;
    validSegmentsCount: number;
    panelsCount: number;
    bubblesCount: number;
    finalRegionsCount: number;
    blockedEdgesCount: number;
    allowedEdgesCount: number;
    droppedItems: { text: string; reason: string }[];
  };
}
