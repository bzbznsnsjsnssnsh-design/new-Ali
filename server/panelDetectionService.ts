export interface DetectedPanel {
  id: string;
  index: number;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
  pixelBox: { x: number; y: number; width: number; height: number };
  borderType: "solid_black" | "white_gutter" | "borderless" | "full_page";
  confidence: number;
  bubbleIds: string[];
  regionIds: string[];
}

export function createFullPagePanel(width: number = 1000, height: number = 1400): DetectedPanel {
  return {
    id: "panel_1",
    index: 0,
    box: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      xMin: 0,
      yMin: 0,
      xMax: 100,
      yMax: 100,
    },
    pixelBox: { x: 0, y: 0, width, height },
    borderType: "full_page",
    confidence: 1.0,
    bubbleIds: [],
    regionIds: [],
  };
}

export function detectPagePanels(
  pixels: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  _isWebtoon: boolean = false
): DetectedPanel[] {
  if (!pixels || width <= 0 || height <= 0) {
    return [createFullPagePanel(width, height)];
  }

  try {
    const rowHasContent: boolean[] = new Array(height).fill(false);
    const stride = 4;
    for (let y = 0; y < height; y++) {
      let darkCount = 0;
      const rowOffset = y * width * stride;
      for (let x = 0; x < width; x++) {
        const r = pixels[rowOffset + x * stride];
        const g = pixels[rowOffset + x * stride + 1];
        const b = pixels[rowOffset + x * stride + 2];
        const lum = (r * 299 + g * 587 + b * 114) / 1000;
        if (lum < 210) {
          darkCount++;
        }
      }
      if (darkCount > width * 0.02) {
        rowHasContent[y] = true;
      }
    }

    const minGutterHeight = Math.max(8, Math.round(height * 0.03));
    const segments: Array<{ yStart: number; yEnd: number }> = [];
    let inSegment = false;
    let curStart = 0;
    let emptyRowCount = 0;

    for (let y = 0; y < height; y++) {
      if (rowHasContent[y]) {
        if (!inSegment) {
          inSegment = true;
          curStart = y;
        }
        emptyRowCount = 0;
      } else {
        if (inSegment) {
          emptyRowCount++;
          if (emptyRowCount >= minGutterHeight || y === height - 1) {
            const segEnd = y - emptyRowCount;
            if (segEnd - curStart >= Math.max(15, height * 0.04)) {
              segments.push({ yStart: curStart, yEnd: segEnd });
            }
            inSegment = false;
            emptyRowCount = 0;
          }
        }
      }
    }

    if (inSegment && height - curStart >= Math.max(15, height * 0.04)) {
      segments.push({ yStart: curStart, yEnd: height - 1 });
    }

    if (segments.length <= 1) {
      return [createFullPagePanel(width, height)];
    }

    return segments.map((seg, idx) => {
      const yMin = (seg.yStart / height) * 100;
      const yMax = (seg.yEnd / height) * 100;
      const hPct = yMax - yMin;
      return {
        id: `panel_${idx + 1}`,
        index: idx,
        box: {
          x: 0,
          y: yMin,
          width: 100,
          height: hPct,
          xMin: 0,
          yMin: yMin,
          xMax: 100,
          yMax: yMax,
        },
        pixelBox: {
          x: 0,
          y: seg.yStart,
          width,
          height: seg.yEnd - seg.yStart,
        },
        borderType: "white_gutter",
        confidence: 0.95,
        bubbleIds: [],
        regionIds: [],
      };
    });
  } catch {
    return [createFullPagePanel(width, height)];
  }
}

export function findPanelForBox(
  panels: DetectedPanel[],
  box: { xMin?: number; yMin?: number; xMax?: number; yMax?: number; x?: number; y?: number; width?: number; height?: number }
): DetectedPanel | null {
  if (!panels || panels.length === 0) return null;
  const cx =
    box.xMin !== undefined && box.xMax !== undefined
      ? (box.xMin + box.xMax) / 2
      : (box.x || 0) + (box.width || 0) / 2;
  const cy =
    box.yMin !== undefined && box.yMax !== undefined
      ? (box.yMin + box.yMax) / 2
      : (box.y || 0) + (box.height || 0) / 2;

  for (const p of panels) {
    const xMin = p.box.xMin ?? p.box.x ?? 0;
    const xMax = p.box.xMax ?? (p.box.x ?? 0) + (p.box.width ?? 100);
    const yMin = p.box.yMin ?? p.box.y ?? 0;
    const yMax = p.box.yMax ?? (p.box.y ?? 0) + (p.box.height ?? 100);
    if (cx >= xMin && cx <= xMax && cy >= yMin && cy <= yMax) {
      return p;
    }
  }
  return panels[0];
}
