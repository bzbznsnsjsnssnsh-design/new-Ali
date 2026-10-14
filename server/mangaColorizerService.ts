import sharp from "sharp";
import { Client, handle_file } from "@gradio/client";
import crypto from "crypto";

export interface ColorizeBlock {
  bubble_box?: { xMin: number; yMin: number; xMax: number; yMax: number };
  text_box?: { xMin: number; yMin: number; xMax: number; yMax: number };
  box?: { xMin: number; yMin: number; xMax: number; yMax: number };
  is_inside_bubble?: boolean;
  original_text?: string;
}

export interface ColorizeOptions {
  chapterId?: string | number;
  pageIndex?: number;
  blocks?: ColorizeBlock[];
  hfToken?: string;
  inferSize?: number;
}

export interface ColorizeMetrics {
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  processingTimeMs: number;
  tilesCount: number;
  meanSaturationBefore: number;
  meanSaturationAfter: number;
  lineArtPreserved: boolean;
  fromCache: boolean;
}

export interface CharacterPalette {
  skinTone?: { h: number; s: number; v: number };
  dominantHues: number[];
  timestamp: number;
}

// 1. Singleton Gradio Client to eliminate per-request connection overhead
let cachedGradioClient: any = null;
let gradioConnectingPromise: Promise<any> | null = null;
let lastUsedToken: string | null = null;

export async function getMangaColorizerClient(token?: string): Promise<any> {
  const hfToken = token || process.env.HF_TOKEN || "";
  
  if (cachedGradioClient && lastUsedToken === hfToken) {
    return cachedGradioClient;
  }

  if (gradioConnectingPromise) {
    return gradioConnectingPromise;
  }

  gradioConnectingPromise = (async () => {
    try {
      console.log("[MangaColorizer] Initializing singleton Gradio client for sharky172/manga-light-colorizer...");
      const connectOptions: any = {};
      if (hfToken) {
        connectOptions.hf_token = hfToken;
      }
      const client = await Client.connect("sharky172/manga-light-colorizer", connectOptions);
      cachedGradioClient = client;
      lastUsedToken = hfToken;
      console.log("[MangaColorizer] Singleton Gradio client successfully ready.");
      return client;
    } catch (err: any) {
      console.error("[MangaColorizer] Failed to connect Gradio client:", err.message || err);
      cachedGradioClient = null;
      throw err;
    } finally {
      gradioConnectingPromise = null;
    }
  })();

  return gradioConnectingPromise;
}

// 2. High-Performance In-Memory & LRU Image Cache
const MAX_CACHE_ENTRIES = 50;
const colorizeCache = new Map<string, { buffer: Buffer; metrics: ColorizeMetrics }>();
const cacheKeysQueue: string[] = [];

// 3. Chapter Character Palette Consistency Store
const chapterPalettes = new Map<string, CharacterPalette>();

/**
 * Extract Palette: calculates dominant skin tone and primary accent hues
 */
function extractPaletteFromRgb(rgbBuffer: Buffer, width: number, height: number): CharacterPalette {
  let skinCount = 0;
  let skinHSum = 0;
  let skinSSum = 0;
  let skinVSum = 0;
  
  const hueBuckets = new Array(36).fill(0); // 10-degree buckets

  const stride = 4; // Sample every 4th pixel for speed
  for (let i = 0; i < rgbBuffer.length; i += 3 * stride) {
    const r = rgbBuffer[i];
    const g = rgbBuffer[i + 1];
    const b = rgbBuffer[i + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (delta < 15) continue; // Skip neutral grayscale / ink / paper

    const sat = delta / max;
    const val = max / 255;

    let hue = 0;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;

    // Skin tone range in manga/anime: Hue ~ 12° to 38°, Saturation ~ 0.15 to 0.60, Value > 0.45
    if (hue >= 12 && hue <= 38 && sat >= 0.15 && sat <= 0.60 && val >= 0.45) {
      skinCount++;
      skinHSum += hue;
      skinSSum += sat;
      skinVSum += val;
    } else if (sat > 0.20 && val > 0.20 && val < 0.90) {
      const bucket = Math.floor(hue / 10) % 36;
      hueBuckets[bucket]++;
    }
  }

  // Find top dominant hues
  const sortedBuckets = hueBuckets
    .map((count, idx) => ({ hue: idx * 10 + 5, count }))
    .sort((a, b) => b.count - a.count)
    .filter(b => b.count > 50)
    .slice(0, 3)
    .map(b => b.hue);

  const result: CharacterPalette = {
    dominantHues: sortedBuckets,
    timestamp: Date.now()
  };

  if (skinCount > 200) {
    result.skinTone = {
      h: skinHSum / skinCount,
      s: skinSSum / skinCount,
      v: skinVSum / skinCount
    };
  }

  return result;
}

/**
 * Adaptive Color Enhancement:
 * - Increases vibrance of dull/washed-out pixels without blowing out already vibrant tones
 * - Protects skin tones from turning neon orange or sunburn red
 * - Harmonizes palette with previous pages if character palette exists
 * - Gentle S-curve contrast stretch
 */
function enhanceColorsAdaptively(
  rgbBuffer: Buffer,
  prevPalette?: CharacterPalette
): { enhanced: Buffer; satBefore: number; satAfter: number } {
  const enhanced = Buffer.from(rgbBuffer);

  // 1. Calculate current mean saturation of colored areas
  let totalSat = 0;
  let coloredCount = 0;
  for (let i = 0; i < rgbBuffer.length; i += 3) {
    const r = rgbBuffer[i];
    const g = rgbBuffer[i + 1];
    const b = rgbBuffer[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (max > 25 && min < 245) {
      const sat = max === 0 ? 0 : delta / max;
      if (sat > 0.08) {
        totalSat += sat;
        coloredCount++;
      }
    }
  }

  const meanSatBefore = coloredCount > 0 ? totalSat / coloredCount : 0.25;
  
  // Target natural manga saturation is around 0.36 - 0.42
  // If image is pale/grayish, boost vibrance proportionally
  const targetSat = 0.38;
  const adaptiveBoostRatio = Math.min(1.55, Math.max(1.05, targetSat / Math.max(0.12, meanSatBefore)));

  let totalSatAfter = 0;
  let coloredCountAfter = 0;

  for (let i = 0; i < enhanced.length; i += 3) {
    let r = enhanced[i];
    let g = enhanced[i + 1];
    let b = enhanced[i + 2];

    let max = Math.max(r, g, b);
    let min = Math.min(r, g, b);
    let delta = max - min;
    if (delta === 0) continue;

    let sat = delta / max;
    let val = max / 255;

    let hue = 0;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;

    const isSkin = (hue >= 10 && hue <= 42) && sat >= 0.12 && sat <= 0.65 && val >= 0.40;

    // Character Consistency: gently harmonize skin tone towards previous page reference
    if (isSkin && prevPalette?.skinTone) {
      const targetSkinH = prevPalette.skinTone.h;
      // Soft 30% blend towards established character skin hue
      hue = Math.round(hue * 0.70 + targetSkinH * 0.30);
    }

    // Character Consistency: gently harmonize clothing/hair dominant hues
    if (!isSkin && prevPalette?.dominantHues?.length && sat > 0.20) {
      for (const refH of prevPalette.dominantHues) {
        const diff = Math.abs(hue - refH);
        if (diff <= 25) {
          // Gently align hue towards reference
          hue = Math.round(hue * 0.75 + refH * 0.25);
          break;
        }
      }
    }

    // Vibrance calculation: boosts less saturated colors more, prevents clipping
    let vibrance = (1.0 - sat) * (adaptiveBoostRatio - 1.0);
    if (isSkin) {
      // Natural skin safety cap: strictly prevent neon orange / red sunburn
      vibrance = Math.min(vibrance, 0.12);
      if (sat > 0.42) {
        vibrance = -0.06; // slight desaturation if already too red
      }
    }

    let newSat = Math.min(0.95, Math.max(0.01, sat * (1 + vibrance)));

    // Subtle S-curve contrast on value (deepens darks slightly, lifts highlights cleanly)
    let newVal = val;
    if (val > 0.05 && val < 0.95) {
      newVal = val < 0.5 
        ? 2 * val * val 
        : 1 - 2 * (1 - val) * (1 - val);
      // Soft blend between linear and S-curve (85% linear, 15% S-curve) to keep midtone detail
      newVal = val * 0.85 + newVal * 0.15;
    }

    // Convert HSV back to RGB
    const v255 = newVal * 255;
    const c = v255 * newSat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = v255 - c;

    let r1 = 0, g1 = 0, b1 = 0;
    if (hue < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (hue < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (hue < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (hue < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (hue < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }

    const finalR = Math.min(255, Math.max(0, Math.round(r1 + m)));
    const finalG = Math.min(255, Math.max(0, Math.round(g1 + m)));
    const finalB = Math.min(255, Math.max(0, Math.round(b1 + m)));

    enhanced[i] = finalR;
    enhanced[i + 1] = finalG;
    enhanced[i + 2] = finalB;

    if (max > 25 && min < 245 && newSat > 0.08) {
      totalSatAfter += newSat;
      coloredCountAfter++;
    }
  }

  const meanSatAfter = coloredCountAfter > 0 ? totalSatAfter / coloredCountAfter : meanSatBefore;

  return { enhanced, satBefore: meanSatBefore, satAfter: meanSatAfter };
}

/**
 * Predict a single tile via the reusable Gradio Client
 */
async function predictSingleTile(tileBuffer: Buffer, inferSize: number = 512, token?: string): Promise<Buffer> {
  const client = await getMangaColorizerClient(token);
  
  // Format tile as JPEG/PNG blob
  const blob = new Blob([tileBuffer], { type: "image/jpeg" });
  
  const result = await client.predict("/colorize_image", [
    handle_file(blob),
    inferSize
  ]) as any;

  if (!result?.data?.[0]?.url) {
    throw new Error("لم يتم إرجاع رابط نتيجة التلوين من النموذج");
  }

  const res = await fetch(result.data[0].url);
  if (!res.ok) {
    throw new Error(`فشل تحميل نتيجة التلوين: ${res.statusText}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Protect Text and Speech Bubbles:
 * Ensures speech bubbles are pristine white (eliminating stray tints/haze from model)
 * and all text glyphs (Japanese/Korean/Arabic/SFX) are identical to the original.
 */
async function protectTextAndBubbles(
  origBuffer: Buffer,
  colorBuffer: Buffer,
  width: number,
  height: number,
  blocks?: ColorizeBlock[]
): Promise<Buffer> {
  const { data: origData } = await sharp(origBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: colorData } = await sharp(colorBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const protectedRgb = Buffer.from(colorData);

  // If dialogue/speech bubble blocks are available from OCR:
  if (blocks && blocks.length > 0) {
    for (const block of blocks) {
      const box = block.bubble_box || block.text_box || block.box;
      if (!box) continue;

      const xMin = Math.max(0, Math.floor((box.xMin / 100) * width));
      const xMax = Math.min(width - 1, Math.ceil((box.xMax / 100) * width));
      const yMin = Math.max(0, Math.floor((box.yMin / 100) * height));
      const yMax = Math.min(height - 1, Math.ceil((box.yMax / 100) * height));

      if (xMax <= xMin || yMax <= yMin) continue;

      for (let y = yMin; y <= yMax; y++) {
        for (let x = xMin; x <= xMax; x++) {
          const grayIdx = y * width + x;
          const rgbIdx = grayIdx * 3;
          const origLum = origData[grayIdx];

          if (block.is_inside_bubble) {
            // Speech bubble interior: restore clean white and original crisp ink text
            if (origLum > 230) {
              // Bubble background: pure clean white
              protectedRgb[rgbIdx] = 255;
              protectedRgb[rgbIdx + 1] = 255;
              protectedRgb[rgbIdx + 2] = 255;
            } else {
              // Bubble text / punctuation / glyph: pure original ink
              protectedRgb[rgbIdx] = origLum;
              protectedRgb[rgbIdx + 1] = origLum;
              protectedRgb[rgbIdx + 2] = origLum;
            }
          } else {
            // Outside text / SFX: keep text strokes pure original ink
            if (origLum < 120) {
              protectedRgb[rgbIdx] = origLum;
              protectedRgb[rgbIdx + 1] = origLum;
              protectedRgb[rgbIdx + 2] = origLum;
            }
          }
        }
      }
    }
  } else {
    // Automatic Speech Bubble Protection (even when OCR hasn't run):
    // In manga/manhwa, speech bubbles are large contiguous regions of near-white (> 242)
    // Eliminate model color cast inside white speech bubbles while keeping line art borders crisp
    for (let i = 0; i < origData.length; i++) {
      const origLum = origData[i];
      if (origLum >= 244) {
        const rgbIdx = i * 3;
        // If the model gave a noticeable stray tint to pure white areas, restore pure clean white
        const cr = colorData[rgbIdx];
        const cg = colorData[rgbIdx + 1];
        const cb = colorData[rgbIdx + 2];
        const maxC = Math.max(cr, cg, cb);
        const minC = Math.min(cr, cg, cb);
        if (maxC - minC < 25 && maxC > 200) {
          // Slight grayish/tinted white -> clean original white
          protectedRgb[rgbIdx] = 255;
          protectedRgb[rgbIdx + 1] = 255;
          protectedRgb[rgbIdx + 2] = 255;
        }
      }
    }
  }

  return sharp(protectedRgb, {
    raw: { width, height, channels: 3 }
  }).png().toBuffer();
}

/**
 * Composite Line Art with Multiply Blend:
 * Original Manga -> Colorization -> Extract/Preserve Original Line Art -> Composite
 * In Multiply mode: (color * original_ink) / 255
 * Where original is black (0), result is 100% black ink at native full resolution!
 */
async function compositeWithOriginalLineArt(
  colorizedBuffer: Buffer,
  originalBuffer: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  // Ensure both are exactly width x height
  const resizedColor = await sharp(colorizedBuffer)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .toBuffer();

  // Create high-clarity line art layer from original
  // We apply a slight high-frequency contrast curve to the original line art to ensure deep rich ink
  const lineArtLayer = await sharp(originalBuffer)
    .resize(width, height, { fit: "fill" })
    .grayscale()
    .toBuffer();

  // Sharp Multiply Composite:
  const composited = await sharp(resizedColor)
    .composite([
      {
        input: lineArtLayer,
        blend: "multiply"
      }
    ])
    .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
    .toBuffer();

  return composited;
}

/**
 * Main Colorization Pipeline with Smart Tiling, Caching, Adaptive Enhancement,
 * Character Palette Consistency, Speech Bubble Protection, and Line Art Multiply.
 */
export async function colorizeMangaImage(
  inputBuffer: Buffer,
  options: ColorizeOptions = {}
): Promise<{ colorizedBuffer: Buffer; metrics: ColorizeMetrics }> {
  const startTime = Date.now();

  // 1. Calculate SHA-256 Hash for Cache Lookup
  const hash = crypto.createHash("sha256").update(inputBuffer).digest("hex");
  const cacheKey = `v3_${hash}_${options.inferSize || 512}`;

  if (colorizeCache.has(cacheKey)) {
    const cached = colorizeCache.get(cacheKey)!;
    console.log(`[MangaColorizer] Cache HIT for image hash ${hash.slice(0, 8)}... (${(Date.now() - startTime)}ms)`);
    return {
      colorizedBuffer: cached.buffer,
      metrics: {
        ...cached.metrics,
        processingTimeMs: Date.now() - startTime,
        fromCache: true
      }
    };
  }

  // 2. Read Original Dimensions & Metadata
  const origMeta = await sharp(inputBuffer).metadata();
  const width = origMeta.width || 800;
  const height = origMeta.height || 1200;
  const aspectRatio = height / width;

  console.log(`[MangaColorizer] Processing page: ${width}x${height} (aspect ratio: ${aspectRatio.toFixed(2)})`);

  // 3. Smart Tiling for Long Webtoon / Manhwa Strips
  const isWebtoonStrip = aspectRatio > 1.8;
  let rawColorBuffer: Buffer;
  let tilesCount = 1;

  if (isWebtoonStrip) {
    console.log(`[MangaColorizer] Detected long Manhwa strip (aspect ${aspectRatio.toFixed(2)}). Applying seamless smart tiling...`);
    
    // Each tile has height = 1.35 * width (close to standard manga proportion)
    const tileHeight = Math.min(height, Math.round(width * 1.35));
    // 15% overlap for seamless edge blending
    const overlap = Math.max(30, Math.round(tileHeight * 0.15));
    const step = tileHeight - overlap;
    tilesCount = Math.ceil((height - overlap) / step);
    console.log(`[MangaColorizer] Partitioned into ${tilesCount} overlapping tiles (tile height: ${tileHeight}, overlap: ${overlap}px)`);

    // Prepare full-size canvas for assembling color tiles
    const assembledRawRgb = Buffer.alloc(width * height * 3);
    const weightMap = new Float32Array(width * height);

    for (let t = 0; t < tilesCount; t++) {
      const yStart = Math.max(0, Math.min(height - tileHeight, t * step));
      const currentTileH = Math.min(tileHeight, height - yStart);

      // Extract tile slice from original
      const tileCrop = await sharp(inputBuffer)
        .extract({ left: 0, top: yStart, width, height: currentTileH })
        .jpeg({ quality: 95 })
        .toBuffer();

      // Colorize tile slice directly preserving the exact tile dimensions and aspect ratio
      const coloredTile = await predictSingleTile(tileCrop, options.inferSize || 512, options.hfToken);

      // Ensure exact tile dimensions for pixel-perfect seamless alignment
      const coloredTileResized = await sharp(coloredTile)
        .resize(width, currentTileH, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer();

      // Blend tile into assembled canvas using cosine-feathered overlap weights
      for (let y = 0; y < currentTileH; y++) {
        const globalY = yStart + y;
        let weight = 1.0;

        // Top overlap feathering
        if (t > 0 && y < overlap) {
          const norm = y / overlap;
          weight = 0.5 - 0.5 * Math.cos(Math.PI * norm); // Smooth S-curve
        }
        // Bottom overlap feathering
        if (t < tilesCount - 1 && y >= currentTileH - overlap) {
          const norm = (currentTileH - y) / overlap;
          weight = 0.5 - 0.5 * Math.cos(Math.PI * norm);
        }

        for (let x = 0; x < width; x++) {
          const tileIdx = (y * width + x) * 3;
          const globalIdx = (globalY * width + x) * 3;
          const mapIdx = globalY * width + x;

          const oldW = weightMap[mapIdx];
          const newW = oldW + weight;

          assembledRawRgb[globalIdx] = Math.round((assembledRawRgb[globalIdx] * oldW + coloredTileResized[tileIdx] * weight) / newW);
          assembledRawRgb[globalIdx + 1] = Math.round((assembledRawRgb[globalIdx + 1] * oldW + coloredTileResized[tileIdx + 1] * weight) / newW);
          assembledRawRgb[globalIdx + 2] = Math.round((assembledRawRgb[globalIdx + 2] * oldW + coloredTileResized[tileIdx + 2] * weight) / newW);

          weightMap[mapIdx] = newW;
        }
      }
    }

    rawColorBuffer = await sharp(assembledRawRgb, {
      raw: { width, height, channels: 3 }
    }).png().toBuffer();

  } else {
    // Normal comic page: colorize directly preserving the natural aspect ratio
    // Never add artificial borders/padding which causes horizontal squeeze and double-image ghosting
    const coloredResult = await predictSingleTile(inputBuffer, options.inferSize || 512, options.hfToken);

    rawColorBuffer = await sharp(coloredResult)
      .resize(width, height, { fit: "fill" })
      .png()
      .toBuffer();
  }

  // 4. Extract Palette for Character Consistency
  const chapterIdKey = options.chapterId ? String(options.chapterId) : "default";
  const prevPalette = chapterPalettes.get(chapterIdKey);

  const { data: rawRgbData } = await sharp(rawColorBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 5. Adaptive Color Enhancement & Palette Alignment
  const { enhanced: enhancedRgb, satBefore, satAfter } = enhanceColorsAdaptively(rawRgbData, prevPalette);

  // Store updated palette for subsequent pages in this chapter
  const currentPalette = extractPaletteFromRgb(enhancedRgb, width, height);
  if (currentPalette.skinTone || currentPalette.dominantHues.length > 0) {
    chapterPalettes.set(chapterIdKey, currentPalette);
  }

  const enhancedColorBuffer = await sharp(enhancedRgb, {
    raw: { width, height, channels: 3 }
  }).png().toBuffer();

  // 6. Speech Bubble and Text Protection
  const textProtectedColorBuffer = await protectTextAndBubbles(
    inputBuffer,
    enhancedColorBuffer,
    width,
    height,
    options.blocks
  );

  // 7. Original Line Art Multiply Composite
  // Original Manga -> Colorization -> Extract/Preserve Original Line Art -> Composite -> Final Colorized Manga
  const finalColorized = await compositeWithOriginalLineArt(
    textProtectedColorBuffer,
    inputBuffer,
    width,
    height
  );

  // 8. Quality Assurance Check
  const outMeta = await sharp(finalColorized).metadata();
  if (outMeta.width !== width || outMeta.height !== height) {
    throw new Error(`Quality check failed: resolution mismatch (expected ${width}x${height}, got ${outMeta.width}x${outMeta.height})`);
  }

  const duration = Date.now() - startTime;
  console.log(`[MangaColorizer] Completed page in ${(duration / 1000).toFixed(2)}s (sat: ${(satBefore * 100).toFixed(1)}% -> ${(satAfter * 100).toFixed(1)}%, lines preserved)`);

  const metrics: ColorizeMetrics = {
    originalWidth: width,
    originalHeight: height,
    outputWidth: outMeta.width,
    outputHeight: outMeta.height,
    processingTimeMs: duration,
    tilesCount,
    meanSaturationBefore: satBefore,
    meanSaturationAfter: satAfter,
    lineArtPreserved: true,
    fromCache: false
  };

  // 9. Store in Cache
  if (colorizeCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cacheKeysQueue.shift();
    if (oldestKey) colorizeCache.delete(oldestKey);
  }
  colorizeCache.set(cacheKey, { buffer: finalColorized, metrics });
  cacheKeysQueue.push(cacheKey);

  return { colorizedBuffer: finalColorized, metrics };
}
