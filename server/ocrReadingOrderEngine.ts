export interface SpatialBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface OcrWord {
  text: string;
  box: SpatialBox;
  lineIndex?: number;
  paragraphIndex?: number;
  wordIndex?: number;
  writingDirection?: string;
  confidence?: number;
}

export function createSpatialBox(
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number
): SpatialBox {
  const width = Math.max(0.01, xMax - xMin);
  const height = Math.max(0.01, yMax - yMin);
  return {
    xMin,
    yMin,
    xMax,
    yMax,
    width,
    height,
    centerX: xMin + width / 2,
    centerY: yMin + height / 2,
  };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  delayMs: number = 400
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < maxRetries) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

export async function scanLensHierarchical(
  lens: any,
  imageBuffer: Buffer,
  _width?: number,
  _height?: number,
  _lang?: string
): Promise<{
  allWords: OcrWord[];
  detectedLanguage?: string;
  segments?: any[];
}> {
  const res = await withRetry<any>(() => lens.scanByBuffer(imageBuffer));
  const segments = Array.isArray(res?.segments) ? res.segments : [];
  const allWords: OcrWord[] = [];

  segments.forEach((seg: any, sIdx: number) => {
    const text = String(seg?.text || "").trim();
    if (!text) return;
    const b = seg?.boundingBox || {};
    const cx = (b.centerPerX ?? 0.5) * 100;
    const cy = (b.centerPerY ?? 0.5) * 100;
    const w = Math.max(1, (b.perWidth ?? 0.1) * 100);
    const h = Math.max(1, (b.perHeight ?? 0.04) * 100);
    const xMin = Math.max(0, cx - w / 2);
    const yMin = Math.max(0, cy - h / 2);
    const xMax = Math.min(100, cx + w / 2);
    const yMax = Math.min(100, cy + h / 2);

    allWords.push({
      text,
      box: createSpatialBox(xMin, yMin, xMax, yMax),
      lineIndex: sIdx,
      paragraphIndex: sIdx,
      confidence: 0.94,
    });
  });

  return {
    allWords,
    detectedLanguage: res?.language || "auto",
    segments,
  };
}

export function reconstructReadingOrder(
  words: OcrWord[],
  options?: {
    preferredDirection?: "rtl" | "ltr" | "vertical";
    isJapaneseManga?: boolean;
  }
): {
  reconstructedText: string;
  direction: "horizontal" | "vertical";
  orderedWords: OcrWord[];
  lines: OcrWord[][];
} {
  if (!words || words.length === 0) {
    return {
      reconstructedText: "",
      direction: "horizontal",
      orderedWords: [],
      lines: [],
    };
  }

  const isRtl = options?.preferredDirection === "rtl" || Boolean(options?.isJapaneseManga);
  const sorted = [...words].sort((a, b) => {
    const dy = a.box.centerY - b.box.centerY;
    const avgH = (a.box.height + b.box.height) / 2;
    if (Math.abs(dy) > avgH * 0.6) {
      return dy;
    }
    return isRtl ? b.box.centerX - a.box.centerX : a.box.centerX - b.box.centerX;
  });

  return {
    reconstructedText: sorted.map((w) => w.text).join(" ").trim(),
    direction: options?.preferredDirection === "vertical" ? "vertical" : "horizontal",
    orderedWords: sorted,
    lines: [sorted],
  };
}

export function deduplicateRegionWords(words: OcrWord[]): OcrWord[] {
  if (!words || words.length <= 1) return words || [];
  const out: OcrWord[] = [];
  for (const w of words) {
    const isDup = out.some(
      (existing) =>
        existing.text === w.text &&
        Math.abs(existing.box.centerX - w.box.centerX) < 1.5 &&
        Math.abs(existing.box.centerY - w.box.centerY) < 1.5
    );
    if (!isDup) out.push(w);
  }
  return out;
}

export function sortBlocksByReadingOrder<T extends { box?: any; bbox?: any }>(
  blocks: T[],
  isRtl: boolean = false
): T[] {
  return [...blocks].sort((a, b) => {
    const ay = a.box?.y ?? a.box?.yMin ?? a.bbox?.y ?? 0;
    const by = b.box?.y ?? b.box?.yMin ?? b.bbox?.y ?? 0;
    const ax = a.box?.x ?? a.box?.xMin ?? a.bbox?.x ?? 0;
    const bx = b.box?.x ?? b.box?.xMin ?? b.bbox?.x ?? 0;
    if (Math.abs(ay - by) > 6) {
      return ay - by;
    }
    return isRtl ? bx - ax : ax - bx;
  });
}
