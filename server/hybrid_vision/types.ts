import type { BoundingBox, PolygonPoint, TranslationArea, OCRBlock } from "../../src/types.ts";
export type { BoundingBox, PolygonPoint, TranslationArea, OCRBlock };

/**
 * Text classification types for manga/webtoon text entities.
 */
export type HybridTextType =
  | "outside"
  | "title"
  | "dialogue"
  | "bubble"
  | "narrative"
  | "narration"
  | "sfx"
  | "sound_effect"
  | "other";

/**
 * Bubble morphology and color profile.
 */
export type HybridBubbleType = "white" | "dark" | "transparent" | "screentone" | "none";

/**
 * Spatial direction of the detected text lines.
 */
export type HybridTextDirection = "horizontal" | "vertical" | "rotated" | "auto";

/**
 * Color representation in 8-bit RGB.
 */
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Pixel-level contour representation for characters and speech bubbles.
 */
export interface ContourPath {
  points: Array<{ x: number; y: number }>;
  area: number;
  isClosed: boolean;
  boundingBox: { x: number; y: number; width: number; height: number };
}

/**
 * Glyph-level mask data for precise character stroke isolation.
 */
export interface GlyphMaskData {
  width: number;
  height: number;
  /** Binary mask buffer (255 = text stroke, 0 = background/drawing) */
  maskBuffer: Buffer;
  /** Bounds of the glyph mask within the parent page coordinate system */
  bounds: { x: number; y: number; width: number; height: number };
  /** Detected dominant color of the text glyphs */
  textColor: RGBColor;
  /** Detected paper or background tone directly behind or surrounding the glyphs */
  paperColor: RGBColor;
  /** Whether the text is inverted (light glyphs on dark background) */
  isInverted: boolean;
  /** Contours of isolated individual glyphs */
  glyphContours: ContourPath[];
}

/**
 * The primary unified Region data model for the Hybrid Manga Vision Engine.
 * Conforms to the project's OCRBlock contract while adding deep vision capabilities.
 */
export interface HybridRegion extends OCRBlock {
  region_id: string; // Guaranteed primary key: r_001, r_002, r_003...
  id: string; // Mirror of region_id for OCRBlock contract compatibility
  bbox: BoundingBox;
  polygon: PolygonPoint[];
  text_type: HybridTextType;
  bubble_type: HybridBubbleType;
  direction: "horizontal" | "vertical";
  reading_order: number;
  original_text: string;
  translated_text: string;
  confidence: number;
  is_inside_bubble: boolean;
  
  // Vision metadata
  glyph_mask?: GlyphMaskData;
  paper_color?: RGBColor;
  text_color?: RGBColor;
  is_rotated?: boolean;
  rotation_angle?: number;
  panel_id?: string | null;
  bubble_id?: string | null;
  word_count?: number;
  line_count?: number;
  
  // Real geometric bubble and polygon boundaries
  bubble_box?: BoundingBox;
  bubble_polygon?: PolygonPoint[];
  text_polygon?: PolygonPoint[];
  safe_area?: TranslationArea;
  safe_translation_area: TranslationArea;
  safe_translation_polygon?: PolygonPoint[];
  outside_text_polygon?: PolygonPoint[];
  relative_anchor?: {
    rel_x: number;
    rel_y: number;
    vAlign: "top" | "center" | "bottom";
    hAlign: "left" | "center" | "right";
  };
  visual_text_scale?: number;
  arabic_text_polygon?: PolygonPoint[];
  original_geometry_profile?: any;
  arabic_geometry_profile?: any;
  collision_status?: {
    hasCollision: boolean;
    resolved: boolean;
    attempts: number;
  };
  color_style?: {
    textColor: string;
    strokeColor?: string;
    strokeWidth?: number;
    isColored: boolean;
  };
  
  // Pipeline & OCR compatibility aliases
  originalText: string;
  translatedText: string;
  parent_bubble_id: string | null;
  text_direction?: "horizontal" | "vertical" | "auto" | "ltr" | "rtl";
  reconstructed_text?: string;
  reconstructedText?: string;
  is_sfx?: boolean;
  is_narration?: boolean;
  
  // Validation status
  validation_status: {
    isValid: boolean;
    retryCount: number;
    anomalies: string[];
  };
}

/**
 * Page Analysis container for the Hybrid Vision pipeline.
 */
export interface HybridPageAnalysis {
  pageId: string | number;
  dimensions: { width: number; height: number; aspectRatio: number; isWebtoon: boolean };
  regions: HybridRegion[];
  cleanImageBuffer?: Buffer;
  finalImageBuffer?: Buffer;
  metadata: {
    detectorEngine: string;
    ocrEnginesUsed: string[];
    inpaintingMethod: string;
    totalProcessingTimeMs: number;
  };
}

/**
 * 1. ITextDetector Interface
 * Discovers text blocks, speech bubbles, SFX, and narration panels.
 */
export interface ITextDetector {
  detectTextAndBubbles(
    imageBuffer: Buffer,
    options?: {
      sourceLanguage?: string;
      readingDirection?: "rtl" | "ltr";
      minConfidence?: number;
    }
  ): Promise<{
    regions: HybridRegion[];
    pageWidth: number;
    pageHeight: number;
  }>;
}

/**
 * 2. ITextSegmentation Interface
 * Isolates glyph strokes from the background art and bubble boundaries.
 */
export interface ITextSegmentation {
  segmentRegion(
    imageBuffer: Buffer,
    region: HybridRegion,
    pageWidth: number,
    pageHeight: number
  ): Promise<GlyphMaskData>;
}

/**
 * 3. IRegionManager Interface
 * Generates and maintains strictly stable region_id keys (r_001, r_002...) across all stages.
 */
export interface IRegionManager {
  generateRegionId(index: number): string;
  createRegion(params: Partial<HybridRegion> & { reading_order: number }): HybridRegion;
  assignStableIds(regions: HybridRegion[]): HybridRegion[];
  getRegionById(regions: HybridRegion[], regionId: string): HybridRegion | undefined;
  mergeAdjacentRegions(r1: HybridRegion, r2: HybridRegion): HybridRegion;
}

/**
 * 4. IOCREngine Interface
 * Multi-Engine OCR supporting Japanese, Korean, Chinese, English, Arabic, and mixed text.
 */
export interface IOCREngine {
  recognizeRegion(
    imageBuffer: Buffer,
    region: HybridRegion,
    options?: {
      preferredLanguage?: string;
      isVertical?: boolean;
    }
  ): Promise<{
    text: string;
    confidence: number;
    detectedLanguage: string;
    wordBoxes?: Array<{ text: string; box: BoundingBox; lineIndex: number; wordIndex: number }>;
    lineBoxes?: Array<{ text: string; box: BoundingBox; lineIndex: number }>;
  }>;
}

/**
 * 5. IOCRValidator Interface
 * Evaluates OCR outputs, detects distortion or garbled tokens, and triggers targeted retry loops.
 */
export interface IOCRValidator {
  validate(
    text: string,
    confidence: number,
    region: HybridRegion
  ): {
    isValid: boolean;
    isSuspicious: boolean;
    score: number;
    anomalies: string[];
    recommendedAction: "accept" | "retry_with_contrast" | "retry_with_rotation" | "retry_with_sharpen" | "reject";
  };
}

/**
 * 6. ITextClassifier Interface
 * Categorizes regions into dialogue, narration, sfx, outside_text, title, etc.
 */
export interface ITextClassifier {
  classify(
    region: HybridRegion,
    imageBuffer: Buffer,
    pageWidth: number,
    pageHeight: number
  ): HybridTextType;
}

/**
 * 7. IReadingOrder Interface
 * Resolves natural reading order across panels, bubbles, and RTL/LTR flows.
 */
export interface IReadingOrder {
  orderRegions(
    regions: HybridRegion[],
    options: {
      readingDirection: "rtl" | "ltr";
      isWebtoon: boolean;
      pageWidth: number;
      pageHeight: number;
    }
  ): HybridRegion[];
}

/**
 * 8. ITextMaskGenerator Interface
 * Builds precise character-following masks (H E L L O, not solid white rectangles).
 */
export interface ITextMaskGenerator {
  generatePreciseMask(
    imageBuffer: Buffer,
    regions: HybridRegion[],
    pageWidth: number,
    pageHeight: number
  ): Promise<{
    pageMaskBuffer: Buffer; // Grayscale mask for the entire page (255 = text, 0 = keep)
    regionMasks: Map<string, GlyphMaskData>;
  }>;
}

/**
 * 9. IInpaintingEngine Interface
 * Reconstructs artwork behind text using context-aware diffusion / exemplar algorithms.
 */
export interface IInpaintingEngine {
  inpaintArtwork(
    imageBuffer: Buffer,
    maskBuffer: Buffer,
    boundingBoxes: BoundingBox[],
    pageWidth: number,
    pageHeight: number
  ): Promise<Buffer>;
}

/**
 * 10. ITextRemoval Interface
 * Implements the dual-path removal strategy (Paper-Tone FloodFill for bubbles, Inpainting for artwork).
 */
export interface ITextRemoval {
  cleanPage(
    imageBuffer: Buffer,
    regions: HybridRegion[],
    pageWidth: number,
    pageHeight: number
  ): Promise<Buffer>;
}

/**
 * 11. ITextRenderer Interface
 * Typesets high-fidelity Arabic text with RTL shaping, Cairo font, and dynamic bubble fitting.
 */
export interface ITextRenderer {
  renderArabicText(
    cleanImageBuffer: Buffer,
    regions: HybridRegion[],
    pageWidth: number,
    pageHeight: number,
    options?: {
      fontFamily?: string;
      primaryColor?: string;
      strokeColor?: string;
      minFontSize?: number;
      maxFontSize?: number;
    }
  ): Promise<Buffer>;
}

/**
 * 12. IFinalComposer Interface
 * Orchestrates the full end-to-end vision, translation, and rendering pipeline.
 */
export interface IFinalComposer {
  processPage(
    imageBuffer: Buffer,
    options: {
      pageId: string | number;
      targetLanguage?: string;
      sourceLanguage?: string;
      readingDirection?: "rtl" | "ltr";
      forceRefresh?: boolean;
      skipTranslation?: boolean;
      skipInpainting?: boolean;
      renderArabicOverlay?: boolean;
    }
  ): Promise<HybridPageAnalysis>;
}
