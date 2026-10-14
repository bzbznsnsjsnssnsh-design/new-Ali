/**
 * Production Geometry-Aware Arabic Manga Layout & Typesetting Engine
 * 
 * Complies with strict manga/manhwa lettering principles:
 * 1. region_id stability & geometry-first layout (polygon, safe area, aspect ratio).
 * 2. Diamond / Oval line wrapping matching speech bubble silhouettes.
 * 3. Proportional Arabic typography:
 *    - Balanced lines (no single-word orphan lines).
 *    - Arabic line-height (1.28 to 1.38) preventing diacritic / ascender clipping.
 *    - Non-destructive word wrapping (never breaks Arabic words mid-letter).
 * 4. Outside text & SFX handling (transparent background, high-contrast outline/shadow).
 * 5. Dynamic font sizing that adapts to bubble area and line density.
 */

export interface RegionGeometry {
  region_id: string;
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
  bubble_box?: { xMin: number; yMin: number; xMax: number; yMax: number };
  polygon?: Array<{ x: number; y: number }>;
  safe_area?: { xMin: number; yMin: number; xMax: number; yMax: number };
  is_inside_bubble: boolean;
  text_type?: string; // "dialogue" | "thought" | "shouting" | "whisper" | "narration" | "sfx" | "outside"
  reading_direction?: "rtl" | "ltr" | "vertical";
  aspect_ratio?: number;
  original_text?: string;
  original_line_count?: number;
  original_centroid?: { x: number; y: number };
  relative_anchor?: {
    rel_x: number;
    rel_y: number;
    vAlign: "top" | "center" | "bottom";
    hAlign: "left" | "center" | "right";
  };
  visual_text_scale?: number;
}

export interface ContainerDimensions {
  pageWidth: number;
  pageHeight: number;
}

export interface LayoutOptions {
  fontFamily?: string;
  targetFillRatio?: number;
  minFontSize?: number;
  maxFontSize?: number;
  lineHeightMultiplier?: number;
  scaleFactor?: number;
  fontColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface ArabicLayoutResult {
  region_id: string;
  fontSize: number;
  lines: string[];
  lineHeight: number;
  placement: {
    x: number; // px from container left
    y: number; // px from container top
    width: number; // px
    height: number; // px
    xPct: number; // percentage [0..100]
    yPct: number;
    widthPct: number;
    heightPct: number;
    centerX: number;
    centerY: number;
    alignment: "center" | "right" | "left";
  };
  style: {
    color: string;
    strokeColor?: string;
    strokeWidth?: number;
    textShadow?: string;
    direction: "rtl";
    textAlign: "center";
    fontFamily: string;
    lineHeight: string;
    isOutside: boolean;
    backgroundColor: string;
  };
  metrics: {
    fillRatio: number;
    lineCount: number;
    totalTextHeight: number;
    maxLineWidth: number;
  };
}

// Calibrated Arabic character width ratios relative to font size (for Cairo / Amiri / Noto Sans Arabic)
const ARABIC_WIDE_CHARS = new Set(["س", "ش", "ص", "ض", "ط", "ظ", "ف", "ق", "ك", "m", "w", "W", "M"]);
const ARABIC_NARROW_CHARS = new Set(["ا", "أ", "إ", "آ", "ل", "د", "ذ", "ر", "ز", "و", "ؤ", "ء", "1", "i", "l", "I", "|", "!", "."]);

/**
 * Estimates word width in pixels based on character composition and font metrics.
 */
export function estimateArabicWordWidth(
  word: string,
  fontSize: number,
  ctx?: any
): number {
  if (ctx && typeof ctx.measureText === "function") {
    try {
      return ctx.measureText(word).width;
    } catch {
      // fallback
    }
  }

  let totalUnits = 0;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    // Arabic diacritics (tashkeel) occupy zero horizontal advance width
    if (/[\u064B-\u065F\u0670]/.test(ch)) {
      continue;
    }
    if (ch === " ") {
      totalUnits += 0.28;
    } else if (ARABIC_NARROW_CHARS.has(ch)) {
      totalUnits += 0.34;
    } else if (ARABIC_WIDE_CHARS.has(ch)) {
      totalUnits += 0.72;
    } else {
      totalUnits += 0.54;
    }
  }

  return totalUnits * fontSize;
}

/**
 * Computes available width at a given vertical slice [0..1] within a speech bubble.
 * Standard speech bubbles are elliptical/oval; captions are rectangular.
 */
export function getAvailableSliceWidth(
  yNorm: number, // 0 = top of safe area, 1 = bottom of safe area
  safeWidthPx: number,
  isOval: boolean = true
): number {
  if (!isOval) {
    return safeWidthPx;
  }
  // Ellipse chord formula: w(y) = W * sqrt(1 - (2y - 1)^2)
  // Clamp normalized distance to keep at least 62% width at the extreme top/bottom
  const clampedY = Math.max(0.05, Math.min(0.95, yNorm));
  const normY = 2 * clampedY - 1; // -1 to 1
  const chord = Math.sqrt(Math.max(0.15, 1 - normY * normY));
  return safeWidthPx * Math.max(0.62, Math.min(1.0, chord));
}

/**
 * Wraps Arabic words into balanced lines matching the speech bubble's geometric profile.
 * Produces an aesthetic diamond/oval silhouette:
 * - Top line: slightly shorter (~75-85% max width)
 * - Middle lines: full width (~95-100% max width)
 * - Bottom line: slightly shorter (~75-85% max width)
 * - Never breaks words mid-string.
 * - Prevents solitary orphan words.
 */
export function wrapArabicTextDiamond(
  words: string[],
  fontSize: number,
  safeWidthPx: number,
  isOval: boolean = true,
  ctx?: any
): string[] {
  if (words.length === 0) return [];
  if (words.length === 1) return [words[0]];

  const wordWidths = words.map((w) => estimateArabicWordWidth(w, fontSize, ctx));
  const spaceWidth = estimateArabicWordWidth(" ", fontSize, ctx);
  const totalTextWidth = wordWidths.reduce((a, b) => a + b, 0) + (words.length - 1) * spaceWidth;

  // Single line check: if the entire text fits within 85% of safe width, keep it as 1 clean centered line
  if (totalTextWidth <= safeWidthPx * 0.88) {
    return [words.join(" ")];
  }

  // 2-line balanced split check
  if (words.length <= 4) {
    const halfLen = Math.ceil(words.length / 2);
    const line1 = words.slice(0, halfLen).join(" ");
    const line2 = words.slice(halfLen).join(" ");
    const w1 = estimateArabicWordWidth(line1, fontSize, ctx);
    const w2 = estimateArabicWordWidth(line2, fontSize, ctx);
    const chord1 = getAvailableSliceWidth(0.3, safeWidthPx, isOval);
    const chord2 = getAvailableSliceWidth(0.7, safeWidthPx, isOval);

    if (w1 <= chord1 && w2 <= chord2) {
      return [line1, line2];
    }
  }

  // Multi-line geometric greedy wrap with diamond silhouette constraints
  const lines: string[] = [];
  let currentLineWords: string[] = [];
  let currentLineWidth = 0;

  // Estimate total line count needed to calculate vertical slice positions
  const avgChord = safeWidthPx * (isOval ? 0.85 : 0.95);
  const estimatedLineCount = Math.max(2, Math.ceil(totalTextWidth / avgChord));

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wWidth = wordWidths[i];
    const currentLineIdx = lines.length;
    const yNorm = (currentLineIdx + 0.5) / estimatedLineCount;
    const allowedWidth = getAvailableSliceWidth(yNorm, safeWidthPx, isOval);

    const neededWidth = currentLineWidth === 0 ? wWidth : currentLineWidth + spaceWidth + wWidth;

    if (neededWidth <= allowedWidth || currentLineWords.length === 0) {
      currentLineWords.push(word);
      currentLineWidth = neededWidth;
    } else {
      // Commit line
      lines.push(currentLineWords.join(" "));
      currentLineWords = [word];
      currentLineWidth = wWidth;
    }
  }

  if (currentLineWords.length > 0) {
    lines.push(currentLineWords.join(" "));
  }

  // Post-process: Orphan elimination (if last line is just 1 short word, balance with previous line)
  if (lines.length >= 2) {
    const lastLineWords = lines[lines.length - 1].split(/\s+/);
    if (lastLineWords.length === 1 && words.length > 3) {
      const prevLineWords = lines[lines.length - 2].split(/\s+/);
      if (prevLineWords.length >= 3) {
        // Move one word from previous line to last line
        const stolenWord = prevLineWords.pop()!;
        lastLineWords.unshift(stolenWord);
        lines[lines.length - 2] = prevLineWords.join(" ");
        lines[lines.length - 1] = lastLineWords.join(" ");
      }
    }
  }

  return lines;
}

/**
 * Core Geometry-Aware Text Layout Engine
 * 
 * Computes exact font size, line count, diamond wrapping, coordinates,
 * and typographic styles tailored to the comic bubble shape.
 */
export function fitArabicTextToRegion(
  text: string,
  region: RegionGeometry,
  containerDimensions: ContainerDimensions,
  options: LayoutOptions = {}
): ArabicLayoutResult {
  const { pageWidth, pageHeight } = containerDimensions;
  const cleanText = text.replace(/[\u0000\uFFFD]/g, "").trim();

  // If no text, return empty stub
  if (!cleanText) {
    return {
      region_id: region.region_id,
      fontSize: 12,
      lines: [],
      lineHeight: 16,
      placement: {
        x: (region.bbox.xMin / 100) * pageWidth,
        y: (region.bbox.yMin / 100) * pageHeight,
        width: Math.max(20, ((region.bbox.xMax - region.bbox.xMin) / 100) * pageWidth),
        height: Math.max(16, ((region.bbox.yMax - region.bbox.yMin) / 100) * pageHeight),
        xPct: region.bbox.xMin,
        yPct: region.bbox.yMin,
        widthPct: region.bbox.xMax - region.bbox.xMin,
        heightPct: region.bbox.yMax - region.bbox.yMin,
        centerX: (region.bbox.xMin + region.bbox.xMax) / 2,
        centerY: (region.bbox.yMin + region.bbox.yMax) / 2,
        alignment: "center"
      },
      style: {
        color: "#111827",
        direction: "rtl",
        textAlign: "center",
        fontFamily: options.fontFamily || "'Cairo', 'Amiri', 'Noto Sans Arabic', sans-serif",
        lineHeight: "1.32",
        isOutside: false,
        backgroundColor: "transparent"
      },
      metrics: {
        fillRatio: 0,
        lineCount: 0,
        totalTextHeight: 0,
        maxLineWidth: 0
      }
    };
  }

  const textType = region.text_type || (region.is_inside_bubble ? "dialogue" : "outside");
  const isOutside = !region.is_inside_bubble || textType === "outside" || textType === "sfx";
  const isNarration = textType === "narration" || textType === "caption";
  const isOval = region.is_inside_bubble && !isNarration;

  // Compute Safe Translation Area in pixel coordinates
  const safeAreaBox = region.safe_area || region.bubble_box || region.bbox;
  let safeXPct = safeAreaBox.xMin;
  let safeYPct = safeAreaBox.yMin;
  let safeWPct = safeAreaBox.xMax - safeAreaBox.xMin;
  let safeHPct = safeAreaBox.yMax - safeAreaBox.yMin;

  // Add internal safety buffer for inside-bubble dialogue so text never touches ink boundaries
  if (region.is_inside_bubble && !region.safe_area) {
    const bufX = safeWPct * 0.10;
    const bufY = safeHPct * 0.10;
    safeXPct += bufX;
    safeYPct += bufY;
    safeWPct = Math.max(1.0, safeWPct - 2 * bufX);
    safeHPct = Math.max(1.0, safeHPct - 2 * bufY);
  }

  const safeWidthPx = Math.max(16, (safeWPct / 100) * pageWidth);
  const safeHeightPx = Math.max(14, (safeHPct / 100) * pageHeight);
  const safeAreaSqPx = safeWidthPx * safeHeightPx;

  // Split words preserving punctuation and Arabic letters
  const words = cleanText.split(/\s+/).filter((w) => w.length > 0);

  // Setup Canvas Context if available for exact font metrics measurement
  let measureCtx: CanvasRenderingContext2D | null = null;
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      measureCtx = canvas.getContext("2d");
    } catch {
      measureCtx = null;
    }
  }

  const fontFamily = options.fontFamily || "'Cairo', 'Amiri', 'Noto Sans Arabic', sans-serif";
  const lineHeightMult = options.lineHeightMultiplier || 1.30;
  const userScale = options.scaleFactor || 1.0;

  // Natural Visual Scale Anchoring:
  // Estimate original text line height and visual weight
  const origLineCount = Math.max(1, region.original_line_count || 1);
  const origBoxH = ((region.bbox.yMax - region.bbox.yMin) / 100) * pageHeight;
  const origLineH = origBoxH / origLineCount;
  const origEstimatedFs = Math.max(9.0, origLineH * 0.72);

  const cleanOrigText = (region.original_text || "").trim();
  const charRatio = cleanOrigText.length > 0 ? cleanText.length / cleanOrigText.length : 1.0;
  
  // If Arabic has roughly same length: font size matches original font size
  // If Arabic is much longer: scale down proportionally so it fits without blowing out
  let visualScale = region.visual_text_scale || 1.0;
  if (charRatio > 1.4) {
    visualScale *= Math.pow(1.4 / charRatio, 0.4);
  }
  const targetFs = Math.max(8.5, origEstimatedFs * visualScale * userScale);

  // Dynamic Font Size Boundaries:
  // minFs: allow shrinking without limits down to 2.0px so text never overflows bubble boundaries
  const minFs = Math.max(options.minFontSize || 2.0, 2.0) * userScale;
  const maxFs = options.maxFontSize 
    ? options.maxFontSize * userScale 
    : Math.min(targetFs * 1.25, Math.min(safeHeightPx * 0.70, Math.max(minFs + 6, safeWidthPx * 0.50)) * userScale);

  // Binary search for the optimal font size starting from natural targetFs
  let low = minFs;
  let high = Math.max(minFs + 1, maxFs);
  let bestFs = Math.max(minFs, Math.min(high, targetFs));
  let bestLines: string[] = [cleanText];

  for (let iter = 0; iter < 20; iter++) {
    if (high - low < 0.2) break;
    const testFs = (low + high) / 2;

    if (measureCtx) {
      measureCtx.font = `${Math.round(testFs)}px ${fontFamily}`;
    }

    const testLines = wrapArabicTextDiamond(words, testFs, safeWidthPx, isOval, measureCtx);
    const testLineHeight = testFs * lineHeightMult;
    const testTotalHeight = testLines.length * testLineHeight;

    // Check if every line fits its respective geometric slice width
    let allLinesFitHorizontally = true;
    for (let li = 0; li < testLines.length; li++) {
      const yNorm = (li + 0.5) / Math.max(1, testLines.length);
      const chordW = getAvailableSliceWidth(yNorm, safeWidthPx, isOval);
      const lineW = estimateArabicWordWidth(testLines[li], testFs, measureCtx);
      if (lineW > chordW + 1.0) {
        allLinesFitHorizontally = false;
        break;
      }
    }

    const fitsVertically = testTotalHeight <= safeHeightPx + 0.5;

    if (allLinesFitHorizontally && fitsVertically) {
      bestFs = testFs;
      bestLines = testLines;
      low = testFs; // try slightly larger if natural
    } else {
      high = testFs; // too large, shrink
    }
  }

  // Cap bestFs close to targetFs for short text to prevent giant fonts
  if (cleanText.length <= 15 && bestFs > targetFs * 1.15) {
    bestFs = targetFs * 1.15;
  }

  // Final wrap with best font size
  if (measureCtx) {
    measureCtx.font = `${Math.round(bestFs)}px ${fontFamily}`;
  }
  let finalLines = wrapArabicTextDiamond(words, bestFs, safeWidthPx, isOval, measureCtx);
  let finalLineHeight = Math.round(bestFs * lineHeightMult * 10) / 10;
  let totalTextHeight = finalLines.length * finalLineHeight;

  // Calculate actual bounding width of wrapped lines
  let maxLineWidth = 0;
  for (const l of finalLines) {
    const lw = estimateArabicWordWidth(l, bestFs, measureCtx);
    if (lw > maxLineWidth) maxLineWidth = lw;
  }

  // If text still overflows safe boundary, progressively step down without limit until it fits!
  let shrinkSteps = 0;
  while ((totalTextHeight > safeHeightPx || maxLineWidth > safeWidthPx) && bestFs > minFs && shrinkSteps < 25) {
    bestFs = Math.max(minFs, bestFs * 0.90);
    if (measureCtx) {
      measureCtx.font = `${Math.round(bestFs)}px ${fontFamily}`;
    }
    finalLines = wrapArabicTextDiamond(words, bestFs, safeWidthPx * 0.96, isOval, measureCtx);
    finalLineHeight = Math.round(bestFs * lineHeightMult * 10) / 10;
    totalTextHeight = finalLines.length * finalLineHeight;
    maxLineWidth = 0;
    for (const l of finalLines) {
      const lw = estimateArabicWordWidth(l, bestFs, measureCtx);
      if (lw > maxLineWidth) maxLineWidth = lw;
    }
    shrinkSteps++;
  }

  // Calculate Fill Ratio
  const textBoundingArea = maxLineWidth * totalTextHeight;
  const fillRatio = safeAreaSqPx > 0 ? Number((textBoundingArea / safeAreaSqPx).toFixed(2)) : 0;

  // Precise Anchor Placement:
  // If region is OUTSIDE bubble: strictly anchor to region.bbox center!
  // If region is INSIDE bubble: anchor according to relative_anchor (Original Text Position ≈ Arabic Text Position)
  let placeX: number;
  let placeY: number;
  let placeW = Math.min(safeWidthPx, Math.max(maxLineWidth + 4, safeWidthPx * 0.60));
  let placeH = Math.max(totalTextHeight, safeHeightPx * 0.35);

  const boxX = (safeXPct / 100) * pageWidth;
  const boxY = (safeYPct / 100) * pageHeight;

  if (!region.is_inside_bubble) {
    // Strictly original text location!
    const origCX = ((region.bbox.xMin + region.bbox.xMax) / 2 / 100) * pageWidth;
    const origCY = ((region.bbox.yMin + region.bbox.yMax) / 2 / 100) * pageHeight;
    placeW = Math.max(maxLineWidth + 4, ((region.bbox.xMax - region.bbox.xMin) / 100) * pageWidth);
    placeH = Math.max(totalTextHeight, ((region.bbox.yMax - region.bbox.yMin) / 100) * pageHeight);
    placeX = origCX - placeW / 2;
    placeY = origCY - placeH / 2;
  } else {
    // Inside bubble: adhere to relative_anchor
    const anchor = region.relative_anchor || {
      rel_x: 0.5,
      rel_y: 0.5,
      vAlign: "center",
      hAlign: "center",
    };

    // Vertical placement
    if (anchor.vAlign === "top") {
      placeY = boxY + Math.max(4, safeHeightPx * 0.08);
    } else if (anchor.vAlign === "bottom") {
      placeY = boxY + safeHeightPx - Math.max(4, safeHeightPx * 0.08) - totalTextHeight;
    } else {
      placeY = boxY + (safeHeightPx - totalTextHeight) / 2;
    }

    // Horizontal placement
    if (anchor.hAlign === "left") {
      placeX = boxX + Math.max(4, safeWidthPx * 0.08);
    } else if (anchor.hAlign === "right") {
      placeX = boxX + safeWidthPx - Math.max(4, safeWidthPx * 0.08) - placeW;
    } else {
      placeX = boxX + (safeWidthPx - placeW) / 2;
    }
  }

  // Ensure placement does not cross container bounds
  placeX = Math.max(0, Math.min(pageWidth - placeW, placeX));
  placeY = Math.max(0, Math.min(pageHeight - placeH, placeY));
  const centerX = placeX + placeW / 2;
  const centerY = placeY + placeH / 2;

  // Styling
  let color = options.fontColor || "#111827";
  let strokeColor: string | undefined = undefined;
  let strokeWidth: number | undefined = undefined;
  let textShadow: string | undefined = undefined;

  if (isOutside) {
    // Outside text / SFX: Transparent background, strong contrasting outline
    color = options.fontColor || "#ffffff";
    strokeColor = options.strokeColor || "#000000";
    strokeWidth = options.strokeWidth || Math.max(1.8, bestFs * 0.14);
    textShadow = "0 0 3px #000000, 0 0 6px rgba(0,0,0,0.8)";
  }

  return {
    region_id: region.region_id,
    fontSize: Math.round(bestFs * 10) / 10,
    lines: finalLines,
    lineHeight: finalLineHeight,
    placement: {
      x: Math.round(placeX),
      y: Math.round(placeY),
      width: Math.round(placeW),
      height: Math.round(placeH),
      xPct: Number(((placeX / pageWidth) * 100).toFixed(2)),
      yPct: Number(((placeY / pageHeight) * 100).toFixed(2)),
      widthPct: Number(((placeW / pageWidth) * 100).toFixed(2)),
      heightPct: Number(((placeH / pageHeight) * 100).toFixed(2)),
      centerX: Number(((centerX / pageWidth) * 100).toFixed(2)),
      centerY: Number(((centerY / pageHeight) * 100).toFixed(2)),
      alignment: "center"
    },
    style: {
      color,
      strokeColor,
      strokeWidth,
      textShadow,
      direction: "rtl",
      textAlign: "center",
      fontFamily,
      lineHeight: String(lineHeightMult),
      isOutside,
      backgroundColor: "transparent"
    },
    metrics: {
      fillRatio,
      lineCount: finalLines.length,
      totalTextHeight: Math.round(totalTextHeight),
      maxLineWidth: Math.round(maxLineWidth)
    }
  };
}
