import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { Chapter, OCRBlock, TARGET_LANGUAGES, Language } from "../types";
import { 
  ArrowLeft, ChevronLeft, ChevronRight, Sparkles, Volume2, 
  Settings, Eye, EyeOff, Type, Maximize2, Minimize2, Loader2, Info, Check, CornerDownLeft, VolumeX, Play, Palette, Sliders, X, ChevronDown, ChevronUp, Bookmark, Gauge, Plus, Minus, MessageSquare, RotateCcw, Layers, ScanEye, ExternalLink, CheckCircle2, AlertCircle
} from "lucide-react";
import { saveChapterProgress, getChapterProgress } from "../lib/readingProgress";
import { GEMINI_VOICES, GeminiTTSService } from "../gemini-tts";
import { ReaderTTSQueueManager, TTSTaskStatus } from "../utils/readerTTSQueue";
import { ReaderAudioCache } from "../utils/readerAudioCache";
import { ReaderTranslationCache } from "../utils/readerTranslationCache";
import {
  ChapterContextManager,
  ChapterTranslationContext,
  ChapterBatchPipeline,
  executeTranslationBatch
} from "../utils/chapterTranslationContext";
import {
  GoogleLensChapterOrchestrator,
  GoogleLensProgress
} from "../utils/googleLensChapterOrchestrator";
import { toProxiedUrl } from "../utils/imageProxy";
import { fitArabicTextToRegion, type ArabicLayoutResult } from "../utils/arabicLayoutEngine";
import { MicrosoftVoicePicker } from "./common/MicrosoftVoicePicker";
import { colorizeImageAPI } from "../lib/colorizer";
export { toProxiedUrl };

export const CAPCUT_VOICES = [
  // CapCut-TTS Premium Arabic Neural Voices (Natural-sounding, expressive)
  { id: "ar_female_madina", name: "مدينة (CapCut أنثى ♀️ - عصبي ذكي)" },
  { id: "ar_female_sanaa", name: "سناء (CapCut أنثى ♀️ - دافئ طبيعي)" },
  { id: "ar_male_maged", name: "ماجد (CapCut ذكر ♂️ - فخم وقور)" },
  { id: "ar_male_hamza", name: "حمزة (CapCut ذكر ♂️ - هادئ معبر)" },
  { id: "ar_female_amal", name: "أمل (CapCut أنثى ♀️ - واضح لطيف)" },
  { id: "ar_male_omar", name: "عمر (CapCut ذكر ♂️ - حكواتي طبيعي)" },
  { id: "ar_female_sara", name: "سارة (CapCut أنثى ♀️ - أنيق رقيق)" },
  { id: "ar_male_karim", name: "كريم (CapCut ذكر ♂️ - روائي ممتاز)" },
  { id: "ar_female_nour", name: "نور (CapCut أنثى ♀️ - مبهج مشرق)" },
  { id: "ar_male_youssef", name: "يوسف (CapCut ذكر ♂️ - عميق جهوري)" }
];

export const PREMIUM_VOICES = [
  // Premium Natural Arabic Neural Voices (No limits, high-quality, completely free)
  { id: "ar-EG-SalmaNeural", name: "سلمى (مصر - عصبي طبيعي ♀️)" },
  { id: "ar-EG-ShakirNeural", name: "شاكر (مصر - عصبي طبيعي ♂️)" },
  { id: "ar-SA-ZariyahNeural", name: "زارية (السعودية - عصبي طبيعي ♀️)" },
  { id: "ar-SA-HamedNeural", name: "حامد (السعودية - عصبي طبيعي ♂️)" },
  { id: "ar-AE-FatimaNeural", name: "فاطمة (الإمارات - عصبي طبيعي ♀️)" },
  { id: "ar-AE-HamdanNeural", name: "حمدان (الإمارات - عصبي طبيعي ♂️)" },
  { id: "ar-DZ-AminaNeural", name: "أمينة (الجزائر - عصبي طبيعي ♀️)" },
  { id: "ar-DZ-IsmaelNeural", name: "إسماعيل (الجزائر - عصبي طبيعي ♂️)" },
  { id: "ar-IQ-RanaNeural", name: "رنا (العراق - عصبي طبيعي ♀️)" },
  { id: "ar-IQ-BasselNeural", name: "باسل (العراق - عصبي طبيعي ♂️)" },
  { id: "ar-JO-SanaNeural", name: "سناء (الأردن - عصبي طبيعي ♀️)" },
  { id: "ar-JO-TaimNeural", name: "تيم (الأردن - عصبي طبيعي ♂️)" },
  { id: "ar-KW-NouraNeural", name: "نورة (الكويت - عصبي طبيعي ♀️)" },
  { id: "ar-KW-FahedNeural", name: "فهد (الكويت - عصبي طبيعي ♂️)" },
  { id: "ar-LB-LaylaNeural", name: "ليلى (لبنان - عصبي طبيعي ♀️)" },
  { id: "ar-LB-RamiNeural", name: "رامي (لبنان - عصبي طبيعي ♂️)" },
  { id: "ar-MA-MounaNeural", name: "منى (المغرب - عصبي طبيعي ♀️)" },
  { id: "ar-MA-JamalNeural", name: "جمال (المغرب - عصبي طبيعي ♂️)" },
  { id: "ar-OM-AyshaNeural", name: "عائشة (عُمان - عصبي طبيعي ♀️)" },
  { id: "ar-OM-AbdullahNeural", name: "عبد الله (عُمان - عصبي طبيعي ♂️)" },
  { id: "ar-QA-AmalNeural", name: "أمل (قطر - عصبي طبيعي ♀️)" },
  { id: "ar-QA-MoazNeural", name: "معاذ (قطر - عصبي طبيعي ♂️)" },
  { id: "ar-SY-AmanyNeural", name: "أماني (سوريا - عصبي طبيعي ♀️)" },
  { id: "ar-SY-LaithNeural", name: "ليث (سوريا - عصبي طبيعي ♂️)" },
  { id: "ar-TN-ReemNeural", name: "ريم (تونس - عصبي طبيعي ♀️)" },
  { id: "ar-TN-HediNeural", name: "هادي (تونس - عصبي طبيعي ♂️)" },
  { id: "ar-YE-MaryamNeural", name: "مريم (اليمن - عصبي طبيعي ♀️)" },
  { id: "ar-YE-SalehNeural", name: "صالح (اليمن - عصبي طبيعي ♂️)" },

  // Multilingual voices
  { id: "en-US-AvaMultilingualNeural", name: "أفا (متعدد اللغات - يقرأ العربية بطلاقة ♀️)" },
  { id: "en-US-AndrewMultilingualNeural", name: "أندرو (متعدد اللغات - يقرأ العربية بطلاقة ♂️)" },
  { id: "en-US-EmmaMultilingualNeural", name: "إيما (متعدد اللغات - يقرأ العربية بطلاقة ♀️)" },
  { id: "en-US-BrianMultilingualNeural", name: "برايان (متعدد اللغات - يقرأ العربية بطلاقة ♂️)" },
  { id: "en-AU-WilliamMultilingualNeural", name: "ويليام (أسترالي متعدد اللغات - يقرأ العربية بطلاقة ♂️)" },
  { id: "fr-FR-VivienneMultilingualNeural", name: "فيفيان (فرنسي متعدد اللغات - يقرأ العربية بطلاقة ♀️)" },
  { id: "fr-FR-RemyMultilingualNeural", name: "ريمي (فرنسي متعدد اللغات - يقرأ العربية بطلاقة ♂️)" },
  { id: "de-DE-SeraphinaMultilingualNeural", name: "سيرافينا (ألماني متعدد اللغات - يقرأ العربية بطلاقة ♀️)" },
  { id: "de-DE-FlorianMultilingualNeural", name: "فلوريان (ألماني متعدد اللغات - يقرأ العربية بطلاقة ♂️)" },
  { id: "pt-BR-ThalitaMultilingualNeural", name: "ثاليتا (برازيلي متعدد اللغات - يقرأ العربية بطلاقة ♀️)" }
];

export const CHATGPT_VOICES = [
  { id: "onyx", name: "Onyx (ChatGPT 💎)" },
  { id: "alloy", name: "Alloy (ChatGPT ⚙️)" },
  { id: "echo", name: "Echo (ChatGPT 🗣️)" },
  { id: "ash", name: "Ash (ChatGPT 🌑)" },
  { id: "fable", name: "Fable (ChatGPT 📖)" },
  { id: "ballad", name: "Ballad (ChatGPT 🎶)" },
  { id: "nova", name: "Nova (ChatGPT 🌟)" },
  { id: "shimmer", name: "Shimmer (ChatGPT ✨)" },
  { id: "coral", name: "Coral (ChatGPT 🪸)" },
  { id: "sage", name: "Sage (ChatGPT 🌿)" },
  { id: "verse", name: "Verse (ChatGPT 📝)" },
  { id: "breeze", name: "Breeze (ChatGPT 🍃)" },
  { id: "cove", name: "Cove (ChatGPT 🌊)" },
  { id: "ember", name: "Ember (ChatGPT 🔥)" },
  { id: "juniper", name: "Juniper (ChatGPT 🌲)" },
  { id: "sky", name: "Sky (ChatGPT ☁️)" }
];

const BUBBLE_STYLES = [
  { id: "solid", name: "معتم (أبيض)" },
  { id: "glass", name: "زجاجي داكن" },
  { id: "glowing", name: "مضيء (زمردي)" },
  { id: "outline", name: "إطار أسود" },
  { id: "comic", name: "مانجا كلاسيك" },
  { id: "dark", name: "أسود صلب" },
  { id: "cyberpunk", name: "سايبر بانك" },
  { id: "minimal", name: "بسيط وشفاف" },
  { id: "neon-pink", name: "نيون وردي" },
  { id: "neon-blue", name: "نيون أزرق" },
  { id: "soft", name: "رمادي ناعم" },
  { id: "blood", name: "دموي (أحمر)" },
  { id: "gold", name: "ذهبي فاخر" }
];

/**
 * Strict Translation-to-Bounding-Box Lock & Collision Resolver
 * 
 * Rules strictly enforced:
 * 1. Safe Translation Area (or original text box if outside) is the ABSOLUTE bounding constraint.
 * 2. Original text position is the anchor center. Translation position NEVER drifts across the page.
 * 3. Text size / wrapping adjusts to fit the safe area instead of moving coordinates to arbitrary panels.
 * 4. Duplicate merges happen deterministically without altering coordinates.
 * 5. Idempotent: Can be called repeatedly with zero drift.
 */
export interface NormalizedBubbleBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/**
 * Resolves the exact Bounding Box for any speech bubble or dialogue text.
 * Strictly adheres to bubble coordinates, prevents distortion or drift to the screen center,
 * and handles 0..1 vs 0..100 percentage normalization.
 */
export function resolveBubbleCoordinates(block: OCRBlock): NormalizedBubbleBox {
  // If pre-computed canonical layout exists, use it directly for 1:1 parity
  if (block.canonical_layout) {
    const cl = block.canonical_layout;
    return {
      xMin: cl.xPct,
      yMin: cl.yPct,
      xMax: Number((cl.xPct + cl.widthPct).toFixed(2)),
      yMax: Number((cl.yPct + cl.heightPct).toFixed(2)),
      width: cl.widthPct,
      height: cl.heightPct,
      centerX: cl.centerX,
      centerY: cl.centerY,
    };
  }

  const isInside = block.is_inside_bubble !== false && block.text_type !== "outside" && block.text_type !== "sfx" && block.text_type !== "sound_effect";

  // Select the most specific bounding box available:
  // 1. For INSIDE speech bubbles: bubble_box (detected bubble contour) or safe_translation_area
  // 2. For OUTSIDE text / SFX / captions: STRICTLY original_text_box / text_box / box (never expand into nearby bubbles!)
  let raw: any = null;
  if (isInside && block.bubble_box && typeof block.bubble_box.xMin === "number" && (block.bubble_box.xMax - block.bubble_box.xMin) > 0.5) {
    raw = block.bubble_box;
  } else if (isInside && block.safe_translation_area && typeof block.safe_translation_area.xMin === "number" && block.safe_translation_area.width > 0.5) {
    raw = block.safe_translation_area;
  } else {
    raw = block.original_text_box || block.text_box || block.box || (block as any).bbox;
  }

  if (!raw) {
    return { xMin: 10, yMin: 10, xMax: 30, yMax: 20, width: 20, height: 10, centerX: 20, centerY: 15 };
  }

  let xMin = typeof raw.xMin === "number" ? raw.xMin : (typeof raw.x === "number" ? raw.x : 0);
  let yMin = typeof raw.yMin === "number" ? raw.yMin : (typeof raw.y === "number" ? raw.y : 0);
  let xMax = typeof raw.xMax === "number" ? raw.xMax : (typeof raw.width === "number" ? xMin + raw.width : xMin + 10);
  let yMax = typeof raw.yMax === "number" ? raw.yMax : (typeof raw.height === "number" ? yMin + raw.height : yMin + 5);

  // If coordinates are in 0..1 scale (e.g. 0.25 to 0.45) instead of 0..100%, normalize to percentage
  if (xMax <= 1.05 && yMax <= 1.05 && (xMax > 0.01 || yMax > 0.01)) {
    xMin *= 100;
    xMax *= 100;
    yMin *= 100;
    yMax *= 100;
  }

  // Swap if inverted
  if (xMin > xMax) { const t = xMin; xMin = xMax; xMax = t; }
  if (yMin > yMax) { const t = yMin; yMin = yMax; yMax = t; }

  // Clamp safely within page borders [0.2% - 99.8%]
  xMin = Math.max(0.2, Math.min(98.0, xMin));
  xMax = Math.max(xMin + 1.8, Math.min(99.8, xMax));
  yMin = Math.max(0.2, Math.min(98.0, yMin));
  yMax = Math.max(yMin + 1.5, Math.min(99.8, yMax));

  const width = xMax - xMin;
  const height = yMax - yMin;
  const centerX = (xMin + xMax) / 2;
  const centerY = (yMin + yMax) / 2;

  return {
    xMin: Number(xMin.toFixed(2)),
    yMin: Number(yMin.toFixed(2)),
    xMax: Number(xMax.toFixed(2)),
    yMax: Number(yMax.toFixed(2)),
    width: Number(width.toFixed(2)),
    height: Number(height.toFixed(2)),
    centerX: Number(centerX.toFixed(2)),
    centerY: Number(centerY.toFixed(2)),
  };
}

function resolveDynamicLayoutAndCollisions(blocks: OCRBlock[]): OCRBlock[] {
  if (!blocks || blocks.length === 0) return [];

  // Step 1: Preserve text 1:1 verbatim without deleting characters or punctuation
  const sanitized = blocks
    .map((b) => {
      const rawTrans = b.translatedText ?? b.translated_text ?? "";
      const cleanedTrans = rawTrans.replace(/[\u0000\uFFFD]/g, "").trim();
      return {
        ...b,
        translatedText: cleanedTrans,
        translated_text: cleanedTrans,
        box: { ...b.box },
      };
    })
    .filter((b) => (b.originalText || b.translatedText || "").trim().length > 0);

  if (sanitized.length <= 1) return sanitized;

  // Step 2: Merge exact duplicates and fragmented blocks strictly from the same bubble
  const mergedList: OCRBlock[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < sanitized.length; i++) {
    if (processed.has(i)) continue;
    let base: any = { ...sanitized[i] };

    for (let j = i + 1; j < sanitized.length; j++) {
      if (processed.has(j)) continue;
      const candidate: any = sanitized[j];

      const isBaseInside = base.is_inside_bubble !== false && base.text_type !== "outside";
      const isCandInside = candidate.is_inside_bubble !== false && candidate.text_type !== "outside";

      const basePanel = (base as any).panel_index ?? (base as any).panel_id;
      const candPanel = (candidate as any).panel_index ?? (candidate as any).panel_id;
      const isSamePanel = !basePanel || !candPanel || basePanel === candPanel;

      const overlapX = Math.max(0, Math.min(base.box.xMax, candidate.box.xMax) - Math.max(base.box.xMin, candidate.box.xMin));
      const overlapY = Math.max(0, Math.min(base.box.yMax, candidate.box.yMax) - Math.max(base.box.yMin, candidate.box.yMin));
      
      const verticalDist = Math.max(0, Math.max(base.box.yMin, candidate.box.yMin) - Math.min(base.box.yMax, candidate.box.yMax));
      const horizontalDist = Math.max(0, Math.max(base.box.xMin, candidate.box.xMin) - Math.min(base.box.xMax, candidate.box.xMax));

      const areaBase = Math.max(0.1, (base.box.xMax - base.box.xMin) * (base.box.yMax - base.box.yMin));
      const areaCand = Math.max(0.1, (candidate.box.xMax - candidate.box.xMin) * (candidate.box.yMax - candidate.box.yMin));
      const interArea = overlapX * overlapY;
      const iou = interArea / (areaBase + areaCand - interArea);

      // 1. Check for multi-pass OCR duplicate bounding boxes (same text recognized twice at same spot)
      const isMultiPassDuplicate = iou > 0.65 || (iou > 0.35 && base.originalText?.trim().toLowerCase() === candidate.originalText?.trim().toLowerCase());

      const baseW = base.box.xMax - base.box.xMin;
      const candW = candidate.box.xMax - candidate.box.xMin;
      const minW = Math.min(baseW, candW);
      const maxW = Math.max(baseW, candW);
      const baseH = base.box.yMax - base.box.yMin;
      const candH = candidate.box.yMax - candidate.box.yMin;
      const maxH = Math.max(baseH, candH);
      const cxA = (base.box.xMin + base.box.xMax) / 2;
      const cxB = (candidate.box.xMin + candidate.box.xMax) / 2;
      const distX = Math.abs(cxA - cxB);

      // 2. Explicit same parent bubble or same container ID
      const sameExplicitBubble = Boolean(
        base.parent_bubble_id &&
        candidate.parent_bubble_id &&
        base.parent_bubble_id === candidate.parent_bubble_id
      );

      const sameExplicitContainer = Boolean(
        base.container_id &&
        candidate.container_id &&
        base.container_id === candidate.container_id &&
        !base.container_id.startsWith("outside_")
      );

      // Distinct bubble IDs, region IDs, or block IDs must never be merged
      const hasDistinctIds = Boolean(
        (base.parent_bubble_id && candidate.parent_bubble_id && base.parent_bubble_id !== candidate.parent_bubble_id) ||
        ((base as any).bubble_id && (candidate as any).bubble_id && (base as any).bubble_id !== (candidate as any).bubble_id) ||
        (base.region_id && candidate.region_id && base.region_id !== candidate.region_id) ||
        (base.id && candidate.id && base.id !== candidate.id)
      );

      // STRICT RULE: If blocks have distinct IDs, they are distinct entities (different speech bubbles/captions)
      // and must NEVER be merged together into one block!
      if (hasDistinctIds && !sameExplicitBubble && !sameExplicitContainer && !isMultiPassDuplicate) {
        continue;
      }

      // Only merge if explicitly confirmed same container or exact duplicate
      const shouldMerge = isMultiPassDuplicate || sameExplicitBubble || sameExplicitContainer;
      if (!shouldMerge) {
        continue;
      }

      // If it's a multi-pass duplicate scan, absorb translation if missing and discard duplicate cleanly
      if (isMultiPassDuplicate) {
        processed.add(j);
        const candTrans = (candidate.translatedText || candidate.translated_text || "").trim();
        if (candTrans && (!base.translatedText || !base.translatedText.trim())) {
          base.translatedText = candTrans;
          base.translated_text = candTrans;
        }
        continue;
      }

      // Merge confirmed candidate into base unit
      if (shouldMerge) {
        processed.add(j);
        const candBelow = candidate.box.yMin >= base.box.yMin;

        // If it's a multi-pass duplicate with identical text, do not duplicate the words!
        const isIdenticalText = base.originalText?.trim().toLowerCase() === candidate.originalText?.trim().toLowerCase();

        const candTrans = (candidate.translatedText || candidate.translated_text || "").trim();
        if (candTrans) {
          if (!base.translatedText || !base.translatedText.trim()) {
            base.translatedText = candTrans;
          } else if (!isIdenticalText && !base.translatedText.includes(candTrans)) {
            base.translatedText = candBelow
              ? `${base.translatedText} ${candTrans}`.trim()
              : `${candTrans} ${base.translatedText}`.trim();
          }
          base.translated_text = base.translatedText;
        }

        // Merge originalText only if they are distinct lines of the same bubble
        if (candidate.originalText && !isIdenticalText) {
          if (!base.originalText) {
            base.originalText = candidate.originalText;
          } else if (!base.originalText.includes(candidate.originalText)) {
            base.originalText = candBelow
              ? `${base.originalText} ${candidate.originalText}`.trim()
              : `${candidate.originalText} ${base.originalText}`.trim();
          }
          base.original_text = base.originalText;
        }

        // Merge reconstructedText and translationInputText
        const candInput = candidate.translationInputText || candidate.reconstructedText || candidate.originalText;
        const baseInput = base.translationInputText || base.reconstructedText || base.originalText;
        if (candInput && !isIdenticalText) {
          if (!baseInput) {
            base.translationInputText = candInput;
          } else if (!baseInput.includes(candInput)) {
            base.translationInputText = candBelow
              ? `${baseInput} ${candInput}`.trim()
              : `${candInput} ${baseInput}`.trim();
          }
          base.translation_input_text = base.translationInputText;
          base.reconstructedText = base.translationInputText;
          base.reconstructed_text = base.translationInputText;
        }

        if (Array.isArray(candidate.word_boxes) && Array.isArray(base.word_boxes)) {
          base.word_boxes = candBelow ? [...base.word_boxes, ...candidate.word_boxes] : [...candidate.word_boxes, ...base.word_boxes];
        }
        base.box = {
          xMin: Math.min(base.box.xMin, candidate.box.xMin),
          xMax: Math.max(base.box.xMax, candidate.box.xMax),
          yMin: Math.min(base.box.yMin, candidate.box.yMin),
          yMax: Math.max(base.box.yMax, candidate.box.yMax),
        };
        if (base.original_text_box && candidate.original_text_box) {
          base.original_text_box = {
            xMin: Math.min(base.original_text_box.xMin, candidate.original_text_box.xMin),
            xMax: Math.max(base.original_text_box.xMax, candidate.original_text_box.xMax),
            yMin: Math.min(base.original_text_box.yMin, candidate.original_text_box.yMin),
            yMax: Math.max(base.original_text_box.yMax, candidate.original_text_box.yMax),
          };
        } else if (candidate.original_text_box && !base.original_text_box) {
          base.original_text_box = candidate.original_text_box;
        }

        // Unify bubble and safe areas so the expanded bubble covers all lines
        if (candidate.is_inside_bubble === true || base.is_inside_bubble === true) {
          base.is_inside_bubble = true;
          base.parent_bubble_id = base.parent_bubble_id || candidate.parent_bubble_id || `bubble_unified_${Math.round(base.box.xMin)}_${Math.round(base.box.yMin)}`;
          base.text_type = "dialogue";
        }

        if (candidate.bubble_box && base.bubble_box) {
          base.bubble_box = {
            xMin: Math.min(base.bubble_box.xMin, candidate.bubble_box.xMin),
            xMax: Math.max(base.bubble_box.xMax, candidate.bubble_box.xMax),
            yMin: Math.min(base.bubble_box.yMin, candidate.bubble_box.yMin),
            yMax: Math.max(base.bubble_box.yMax, candidate.bubble_box.yMax),
          };
        } else if (candidate.bubble_box && !base.bubble_box) {
          base.bubble_box = candidate.bubble_box;
        }

        if (candidate.safe_translation_area && base.safe_translation_area) {
          const sXMin = Math.min(base.safe_translation_area.xMin, candidate.safe_translation_area.xMin);
          const sXMax = Math.max(base.safe_translation_area.xMax, candidate.safe_translation_area.xMax);
          const sYMin = Math.min(base.safe_translation_area.yMin, candidate.safe_translation_area.yMin);
          const sYMax = Math.max(base.safe_translation_area.yMax, candidate.safe_translation_area.yMax);
          base.safe_translation_area = {
            xMin: sXMin,
            xMax: sXMax,
            yMin: sYMin,
            yMax: sYMax,
            width: sXMax - sXMin,
            height: sYMax - sYMin,
            centerX: (sXMin + sXMax) / 2,
            centerY: (sYMin + sYMax) / 2,
          };
        } else if ((candidate as any).safe_translation_area && !(base as any).safe_translation_area) {
          (base as any).safe_translation_area = (candidate as any).safe_translation_area;
        }
      }
    }
    mergedList.push(base);
  }

  // Step 3: Strictly anchor translation coordinates to the exact bubble bounding box
  return mergedList.map((b) => {
    const box = resolveBubbleCoordinates(b);

    const lockedBlock: OCRBlock = {
      ...b,
      translation_position: {
        x: box.centerX,
        y: box.centerY,
      },
      translation_width: box.width,
      translation_height: box.height,
      safe_translation_area: {
        xMin: box.xMin,
        xMax: box.xMax,
        yMin: box.yMin,
        yMax: box.yMax,
        width: box.width,
        height: box.height,
        centerX: box.centerX,
        centerY: box.centerY,
      },
      is_locked: true,
    };

    return lockedBlock;
  });
}

function consolidateNearbyBlocks(blocks: OCRBlock[]): OCRBlock[] {
  return blocks;
}

export function applyTranslationsToBlocks(
  blocks: OCRBlock[],
  data: {
    translationMap?: Record<string, string>;
    translations?: string[];
    page_translations?: Array<{ region_id?: string; reading_order?: number; source_text?: string; translated_text?: string; arabic_text?: string }>;
    data?: any;
  }
): OCRBlock[] {
  if (!blocks || blocks.length === 0) return [];

  const rawData = data as any;
  const tMap: Record<string, string> = rawData?.translationMap || rawData?.data?.translationMap || {};
  const pageTrans: any[] = Array.isArray(rawData?.page_translations)
    ? rawData.page_translations
    : (Array.isArray(rawData?.data?.page_translations) ? rawData.data.page_translations : []);
  const transArray: string[] = Array.isArray(rawData?.translations)
    ? rawData.translations
    : (Array.isArray(rawData?.data?.translations) ? rawData.data.translations : []);

  const getPtText = (pt: any): string => {
    if (!pt) return "";
    const val = pt.translated_text ?? pt.arabic_text ?? pt.translation ?? pt.target_text ?? pt.text ?? pt.content ?? "";
    return typeof val === "string" ? val.trim() : "";
  };

  const isValidTrans = (cand: string, origSrc: string): boolean => {
    if (!cand || !cand.trim()) return false;
    const cleanCand = cand.trim();
    const cleanOrig = (origSrc || "").trim();
    if (cleanCand.toLowerCase() === cleanOrig.toLowerCase()) {
      if (/^[\s\d?!.,:;…—~*•\-_/\\()\[\]{}'"]+$/.test(cleanCand)) return true;
      return false;
    }
    return true;
  };

  return blocks.map((block: OCRBlock, idx: number) => {
    const regId = String(block.region_id || block.id || "").trim();
    const cleanId = String(block.id || "").trim();
    const sourceText = String(block.translationInputText || block.reconstructedText || block.originalText || block.source_text || "").trim();
    const numId = parseInt(regId.replace(/\D+/g, "") || cleanId.replace(/\D+/g, ""), 10);
    const order = typeof block.reading_order === "number" ? block.reading_order : (!isNaN(numId) ? numId : idx + 1);

    let foundTrans = "";

    // 1. Direct region_id match in translationMap
    if (regId && tMap[regId] !== undefined && tMap[regId] !== null && String(tMap[regId]).trim()) {
      const cand = String(tMap[regId]).trim();
      if (isValidTrans(cand, sourceText)) foundTrans = cand;
    } else if (cleanId && tMap[cleanId] !== undefined && tMap[cleanId] !== null && String(tMap[cleanId]).trim()) {
      const cand = String(tMap[cleanId]).trim();
      if (isValidTrans(cand, sourceText)) foundTrans = cand;
    }

    // 2. Normalized numeric variations (region_1, region_001, 1, block_1)
    if (!foundTrans && !isNaN(numId)) {
      const candidates = [
        `region_${String(numId).padStart(3, "0")}`,
        `region_${numId}`,
        String(numId),
        `block_${numId}`
      ];
      for (const c of candidates) {
        if (tMap[c] !== undefined && tMap[c] !== null && String(tMap[c]).trim()) {
          const cand = String(tMap[c]).trim();
          if (isValidTrans(cand, sourceText)) {
            foundTrans = cand;
            break;
          }
        }
      }
    }

    // 3. Reading order match in translationMap
    if (!foundTrans && order) {
      const orderCandidates = [
        String(order),
        `region_${order}`,
        `region_${String(order).padStart(3, "0")}`
      ];
      for (const oc of orderCandidates) {
        if (tMap[oc] !== undefined && tMap[oc] !== null && String(tMap[oc]).trim()) {
          const cand = String(tMap[oc]).trim();
          if (isValidTrans(cand, sourceText)) {
            foundTrans = cand;
            break;
          }
        }
      }
    }

    // 4. Check page_translations by region_id or numeric ID
    if (!foundTrans && pageTrans.length > 0) {
      const matchByRId = pageTrans.find(pt => {
        if (!pt) return false;
        const ptId = String(pt.region_id || pt.id || "").trim();
        if (ptId && (ptId === regId || ptId === cleanId)) return true;
        const ptNum = parseInt(ptId.replace(/\D+/g, ""), 10);
        return !isNaN(numId) && !isNaN(ptNum) && ptNum === numId;
      });
      if (matchByRId) {
        const cand = getPtText(matchByRId);
        if (isValidTrans(cand, sourceText)) foundTrans = cand;
      }
    }

    // 5. Check page_translations by source text match
    if (!foundTrans && pageTrans.length > 0 && sourceText) {
      const matchBySrc = pageTrans.find(pt => {
        if (!pt) return false;
        const ptSrc = String(pt.source_text || pt.original_text || "").trim();
        return ptSrc && ptSrc === sourceText;
      });
      if (matchBySrc) {
        const cand = getPtText(matchBySrc);
        if (isValidTrans(cand, sourceText)) foundTrans = cand;
      }
    }

    // 6. Check page_translations by reading order
    if (!foundTrans && pageTrans.length > 0 && order) {
      const matchByOrder = pageTrans.find(pt => pt && (pt.reading_order === order || pt.order === order));
      if (matchByOrder) {
        const cand = getPtText(matchByOrder);
        if (isValidTrans(cand, sourceText)) foundTrans = cand;
      }
    }

    // 7. Positional match in pageTrans
    if (!foundTrans && pageTrans[idx]) {
      const cand = getPtText(pageTrans[idx]);
      if (isValidTrans(cand, sourceText)) foundTrans = cand;
    }

    // 8. Positional match in transArray
    if (!foundTrans && transArray[idx] !== undefined && transArray[idx] !== null && String(transArray[idx]).trim()) {
      const cand = String(transArray[idx]).trim();
      if (isValidTrans(cand, sourceText)) foundTrans = cand;
    }

    // 9. Positional match in translationMap numeric keys
    if (!foundTrans) {
      const mapCandidates = [
        tMap[String(idx + 1)],
        tMap[`region_${idx + 1}`],
        tMap[`region_${String(idx + 1).padStart(3, "0")}`],
        tMap[String(idx)]
      ];
      for (const mc of mapCandidates) {
        if (mc && isValidTrans(String(mc), sourceText)) {
          foundTrans = String(mc).trim();
          break;
        }
      }
    }

    // 10. If translation found, clean and apply. If not, preserve existing translatedText
    const finalTrans = foundTrans || block.translatedText || block.translated_text || "";

    return {
      ...block,
      region_id: regId || `region_${idx + 1}`,
      id: block.id || regId || `region_${idx + 1}`,
      translatedText: finalTrans,
      translated_text: finalTrans,
      source_text: block.originalText || block.original_text,
      source_bbox: block.original_text_box || block.box,
      is_locked: true,
    };
  });
}

export function getStableBlockId(block: any, fallbackIdx: number = 0): string {
  if (block.region_id !== undefined && block.region_id !== null && String(block.region_id).trim()) {
    return String(block.region_id).trim();
  }
  if (block.id && String(block.id).trim()) {
    return String(block.id).trim();
  }
  const box = block.original_text_box || block.text_box || block.box;
  if (box) {
    return `b_${Math.round(box.xMin)}_${Math.round(box.yMin)}`;
  }
  return `idx_${fallbackIdx}`;
}

export function findBlockAtPoint(clickX: number, clickY: number, blocks: OCRBlock[]): OCRBlock | null {
  if (!blocks || blocks.length === 0) return null;

  // Find candidate blocks covering (clickX, clickY) with a comfortable tap margin
  const candidates = blocks.filter((b) => {
    const box = b.original_text_box || b.text_box || b.box;
    if (!box) return false;
    const transPos = b.translation_position;
    const transW = b.translation_width || (box.xMax - box.xMin);
    const transH = b.translation_height || (box.yMax - box.yMin);

    const minX = transPos ? Math.min(box.xMin, transPos.x - transW / 2) : box.xMin;
    const maxX = transPos ? Math.max(box.xMax, transPos.x + transW / 2) : box.xMax;
    const minY = transPos ? Math.min(box.yMin, transPos.y - transH / 2) : box.yMin;
    const maxY = transPos ? Math.max(box.yMax, transPos.y + transH / 2) : box.yMax;

    // 2.0% comfort padding around box
    return clickX >= minX - 2.0 && clickX <= maxX + 2.0 && clickY >= minY - 2.0 && clickY <= maxY + 2.0;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // If both speech bubbles and narration candidates are found, prefer inside speech bubble
  const insideCandidates = candidates.filter((b) => b.is_inside_bubble !== false && b.text_type !== "outside");
  const filtered = insideCandidates.length > 0 ? insideCandidates : candidates;

  // Choose the one whose center is geometrically closest to (clickX, clickY)
  return filtered.slice().sort((a, b) => {
    const ca = a.translation_position || {
      x: (((a.box as any)?.xMin || a.box?.x || 0) + ((a.box as any)?.xMax || (a.box ? a.box.x + a.box.width : 0))) / 2,
      y: (((a.box as any)?.yMin || a.box?.y || 0) + ((a.box as any)?.yMax || (a.box ? a.box.y + a.box.height : 0))) / 2,
    };
    const cb = b.translation_position || {
      x: (((b.box as any)?.xMin || b.box?.x || 0) + ((b.box as any)?.xMax || (b.box ? b.box.x + b.box.width : 0))) / 2,
      y: (((b.box as any)?.yMin || b.box?.y || 0) + ((b.box as any)?.yMax || (b.box ? b.box.y + b.box.height : 0))) / 2,
    };
    const distA = Math.hypot(ca.x - clickX, ca.y - clickY);
    const distB = Math.hypot(cb.x - clickX, cb.y - clickY);
    return distA - distB;
  })[0];
}

interface MangaBubbleProps {
  key?: string;
  block: OCRBlock;
  index: number;
  bubbleStyle: string;
  fontColor: string;
  hideBackground: boolean;
  speakingKey?: string | null;
  speakingBlockIndex?: number | null;
  isTtsLoading?: boolean;
  speakBlock?: (block: OCRBlock, pageIndex: number, fallbackIdx?: number) => void;
  playRegionAudio?: (regionId: string, pageIndex: number) => void;
  speakText?: (text: string, index: number, currentPageIndex: number) => void;
  currentPageIndex: number;
  onToggleHideBackground?: () => void;
  audioStatus?: TTSTaskStatus | "error";
  isAudioReady?: boolean;
  fontScale?: number;
}

interface ComicVisionInspectorOverlayProps {
  blocks: OCRBlock[];
  visible: boolean;
}

/**
 * Comic Vision Inspector Overlay
 * Visually displays:
 * 1. Original Text Box (Blue #2563eb)
 * 2. Parent Bubble Polygon / Box (Green #10b981)
 * 3. Safe Translation Area (Yellow #eab308 dashed)
 * 4. Actual Translation Position (Purple #a855f7)
 */
function ComicVisionInspectorOverlay({ blocks, visible }: ComicVisionInspectorOverlayProps) {
  if (!visible || !blocks || blocks.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-25 overflow-hidden">
      {/* Legend Banner at top */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-3 px-3 py-1.5 rounded-full bg-slate-950/95 border border-slate-700/80 text-[10px] text-white shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" />
          <span className="text-slate-300">النص الأصلي (Original Box)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
          <span className="text-slate-300">الفقاعة (Parent Bubble)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block border border-dashed border-amber-300" />
          <span className="text-slate-300">المنطقة الآمنة (Safe Area)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" />
          <span className="text-slate-300">موضع الترجمة (Translation Target)</span>
        </div>
      </div>

      <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {blocks.map((b, idx) => {
          const textBox = b.original_text_box || b.text_box || b.box;
          const safeArea = b.safe_translation_area || b.translation_area;
          const safeW = safeArea ? (safeArea.width ?? (safeArea as any).w) : undefined;
          const safeH = safeArea ? (safeArea.height ?? (safeArea as any).h) : undefined;
          const safeCx = safeArea ? (safeArea.centerX ?? (safeArea as any).cx) : undefined;
          const safeCy = safeArea ? (safeArea.centerY ?? (safeArea as any).cy) : undefined;

          const safeXMin = safeArea?.xMin ?? (safeCx !== undefined && safeW ? safeCx - safeW / 2 : textBox.xMin);
          const safeYMin = safeArea?.yMin ?? (safeCy !== undefined && safeH ? safeCy - safeH / 2 : textBox.yMin);

          const isInside = b.is_inside_bubble !== false;
          const hasPolygon = isInside && b.bubble_polygon && b.bubble_polygon.length >= 3;

          const transPos = b.translation_position;
          const transW = b.translation_width || Math.max(2.5, textBox.xMax - textBox.xMin);
          const transH = b.translation_height || Math.max(1.8, textBox.yMax - textBox.yMin);

          return (
            <g key={`cv_block_${b.region_id || idx}`}>
              {/* 1. Original Text Box (Blue #2563eb) */}
              <rect
                x={textBox.xMin}
                y={textBox.yMin}
                width={Math.max(0.6, textBox.xMax - textBox.xMin)}
                height={Math.max(0.6, textBox.yMax - textBox.yMin)}
                fill="rgba(37, 99, 235, 0.22)"
                stroke="#2563eb"
                strokeWidth="0.45"
                strokeDasharray="1.2 0.8"
              />

              {/* 2. Parent Bubble Mask (Emerald Green #10b981) */}
              {isInside && (
                <>
                  {hasPolygon ? (
                    <polygon
                      points={b.bubble_polygon!.map(p => `${p.x},${p.y}`).join(" ")}
                      fill="rgba(16, 185, 129, 0.16)"
                      stroke="#10b981"
                      strokeWidth="0.5"
                    />
                  ) : b.bubble_box ? (
                    <rect
                      x={b.bubble_box.xMin}
                      y={b.bubble_box.yMin}
                      width={Math.max(0.6, b.bubble_box.xMax - b.bubble_box.xMin)}
                      height={Math.max(0.6, b.bubble_box.yMax - b.bubble_box.yMin)}
                      fill="rgba(16, 185, 129, 0.14)"
                      stroke="#10b981"
                      strokeWidth="0.45"
                    />
                  ) : null}
                </>
              )}

              {/* 3. Safe Translation Area (Yellow #eab308 dashed) */}
              {safeW && safeH && (
                <rect
                  x={safeXMin}
                  y={safeYMin}
                  width={safeW}
                  height={safeH}
                  fill="rgba(234, 179, 8, 0.18)"
                  stroke="#eab308"
                  strokeWidth="0.45"
                  strokeDasharray="1.5 0.9"
                  rx="0.5"
                />
              )}

              {/* 4. Actual Translation Position (Purple #a855f7) */}
              {transPos && (
                <>
                  <rect
                    x={transPos.x - transW / 2}
                    y={transPos.y - transH / 2}
                    width={transW}
                    height={transH}
                    fill="rgba(168, 85, 247, 0.18)"
                    stroke="#a855f7"
                    strokeWidth="0.45"
                    rx="0.5"
                  />
                  <circle cx={transPos.x} cy={transPos.y} r="0.65" fill="#a855f7" />
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* Floating interactive HUD tags for each block */}
      {blocks.map((b, idx) => {
        const textBox = b.original_text_box || b.text_box || b.box;
        const conf = Math.round((b.confidence || 0.95) * 100);
        const isInside = b.is_inside_bubble !== false;
        const textType = b.text_type || (isInside ? "bubble" : "outside");
        const bubbleId = b.parent_bubble_id || (isInside ? "bubble_auto" : "none (خارج الفقاعة)");

        return (
          <div
            key={`hud_${b.region_id || idx}`}
            style={{
              position: "absolute",
              left: `${Math.max(0.5, textBox.xMin)}%`,
              top: `${Math.max(0.8, textBox.yMin - 3.4)}%`,
              transform: "translateY(-50%)",
            }}
            className="pointer-events-auto group/hud cursor-pointer"
          >
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-950/90 border border-slate-700/80 text-[10px] text-white shadow-xl backdrop-blur-md whitespace-nowrap">
              <span className={`w-1.5 h-1.5 rounded-full ${isInside ? "bg-emerald-400" : "bg-cyan-400"}`} />
              <span className="font-mono text-[9px] text-amber-300">#{idx + 1}</span>
              <span className="text-[9px] text-slate-300">
                {isInside ? "فقاعة" : (textType === "sfx" ? "مؤثر SFX" : "خارج")}
              </span>
            </div>

            {/* Hover details tooltip */}
            <div className="hidden group-hover/hud:flex flex-col gap-1 absolute top-full left-0 mt-1 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-200 shadow-2xl z-50 w-64 backdrop-blur-lg">
              <div className="font-semibold text-amber-400 border-b border-slate-800 pb-1 flex items-center justify-between">
                <span>فحص الرؤية الحاسوبية</span>
                <span className="text-[9px] text-slate-400">عنصر #{idx + 1}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-emerald-400">Parent Bubble ID:</span>
                <span className="font-mono text-slate-300 truncate max-w-[120px]">{bubbleId}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-blue-400">Original Box:</span>
                <span className="font-mono text-slate-300">
                  {Math.round(textBox.xMin)}%, {Math.round(textBox.yMin)}% ({Math.round(textBox.xMax - textBox.xMin)}×{Math.round(textBox.yMax - textBox.yMin)})
                </span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-purple-400">Translation Pos:</span>
                <span className="font-mono text-slate-300">
                  {b.translation_position ? `${Math.round(b.translation_position.x)}%, ${Math.round(b.translation_position.y)}%` : "مطابق للمركز"}
                </span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-amber-400">Safe Area:</span>
                <span className="font-mono text-slate-300">
                  {b.safe_translation_area ? `${Math.round(b.safe_translation_area.width)}% × ${Math.round(b.safe_translation_area.height)}%` : "مطابق للنص"}
                </span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-400">Inside Bubble:</span>
                <span className="font-semibold text-slate-200">{isInside ? "نعم (Yes)" : "لا (No)"}</span>
              </div>
              <div className="mt-1 pt-1 border-t border-slate-800/80 text-[10px] text-slate-400 line-clamp-2">
                "{b.originalText || b.original_text}"
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MangaBubble({
  block,
  index,
  bubbleStyle,
  fontColor,
  hideBackground,
  speakingKey,
  speakingBlockIndex,
  isTtsLoading,
  speakText,
  speakBlock,
  playRegionAudio,
  currentPageIndex,
  audioStatus,
  isAudioReady,
  fontScale,
  onToggleHideBackground,
}: MangaBubbleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [fontSize, setFontSize] = useState<number>(14);

  // Exact coordinates from block.box (1:1 Source of Truth from Old Project)
  const box: any = block.box || {
    yMin: block.safe_translation_area?.yMin ?? block.text_box?.yMin ?? 0,
    xMin: block.safe_translation_area?.xMin ?? block.text_box?.xMin ?? 0,
    yMax: block.safe_translation_area?.yMax ?? block.text_box?.yMax ?? 100,
    xMax: block.safe_translation_area?.xMax ?? block.text_box?.xMax ?? 100,
  };
  const yMin = box.yMin ?? box.y ?? 0;
  const xMin = box.xMin ?? box.x ?? 0;
  const yMax = box.yMax ?? (box.y != null && box.height != null ? box.y + box.height : 100);
  const xMax = box.xMax ?? (box.x != null && box.width != null ? box.x + box.width : 100);
  
  // 1. Text BBox (The exact location of the original text)
  const baseWidth = Math.max(0.1, xMax - xMin);
  const baseHeight = Math.max(0.1, yMax - yMin);
  const centerX = xMin + baseWidth / 2;
  const centerY = yMin + baseHeight / 2;

  // 2. Render Box (Slightly larger than text bbox to act as the bubble/patch, but NEVER scaling to 500px based on Arabic text length)
  // We apply a consistent padding instead of scaling by charCount.
  const paddingX = Math.min(4, baseWidth * 0.2); // max 4% of image width padding
  const paddingY = Math.min(3, baseHeight * 0.2); // max 3% of image height padding
  
  const finalWidth = baseWidth + paddingX;
  const finalHeight = baseHeight + paddingY;

  const text = (block.translatedText || block.translated_text || block.originalText || block.original_text || "").trim();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl || !text) return;

    const calculateFontSize = () => {
      // Fast Binary Search to find the largest fitting font size (4px to 60px)
      let minSize = 4;
      let maxSize = 60;
      let optimalSize = 12;

      for (let i = 0; i < 12; i++) {
        const mid = Math.floor((minSize + maxSize) / 2);
        textEl.style.fontSize = `${mid}px`;

        // Check overflow (accounting for internal padding)
        const padding = hideBackground ? 2 : 12;
        const hasOverflow = 
          textEl.scrollHeight > (container.clientHeight - padding) ||
          textEl.scrollWidth > (container.clientWidth - padding);

        if (hasOverflow) {
          maxSize = mid - 1;
        } else {
          optimalSize = mid;
          minSize = mid + 1;
        }
      }

      setFontSize(Math.max(4, optimalSize));
    };

    calculateFontSize();

    const resizeObserver = new ResizeObserver(() => {
      calculateFontSize();
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [text, finalWidth, finalHeight, hideBackground]);

  const regionId = String(
    block.region_id || block.id || getStableBlockId(block, index)
  ).trim();
  block.region_id = regionId;
  if (!block.id) block.id = regionId;

  const isSpeaking = speakingBlockIndex === index || speakingKey === `${currentPageIndex}_${regionId}`;

  const bubbleStyleProps: React.CSSProperties = {
    position: "absolute",
    left: `${centerX}%`,
    top: `${centerY}%`,
    transform: "translate(-50%, -50%)",
    width: `${finalWidth}%`,
    height: `${finalHeight}%`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: hideBackground ? "2px" : "6px",
    boxSizing: "border-box",
    cursor: "pointer",
    zIndex: isSpeaking ? 35 : 10,
    transition: "all 0.15s ease-out",
  };

  const textStyleProps: React.CSSProperties = {
    fontSize: `${fontSize}px`,
    color: fontColor,
    margin: 0,
    padding: 0,
    width: "100%",
    maxHeight: "100%",
    display: "block",
    textAlign: "center",
    lineHeight: "1.3",
    wordBreak: "break-word",
    overflowY: "auto",
    overflowX: "hidden",
    direction: "rtl",
    unicodeBidi: "plaintext",
    scrollbarWidth: "none",
    msOverflowStyle: "none",
  };

  if (hideBackground) {
    textStyleProps.textShadow = fontColor.toLowerCase() === "#ffffff"
      ? "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000"
      : "1px 1px 2px #fff, -1px -1px 2px #fff, 1px -1px 2px #fff, -1px 1px 2px #fff";
  }

  let bubbleClasses = "";
  if (hideBackground) {
    bubbleClasses = "bg-transparent border-0 shadow-none";
  } else {
    switch (bubbleStyle) {
      case "solid":
        bubbleClasses = "bg-white rounded-[12px]";
        break;
      case "glass":
        bubbleClasses = "bg-slate-950/80 border border-slate-800/80 rounded-[12px] backdrop-blur-sm shadow-md";
        break;
      case "glowing":
        bubbleClasses = "bg-emerald-950/45 border-2 border-emerald-500 rounded-[12px] shadow-[0_0_15px_rgba(16,185,129,0.3)] backdrop-blur-xs";
        break;
      case "outline":
        bubbleClasses = "bg-white border-2 border-black rounded-[12px]";
        break;
      case "comic":
        bubbleClasses = "bg-white border-2 border-black rounded-[12px] shadow-[3px_3px_0px_rgba(0,0,0,1)]";
        break;
      case "dark":
        bubbleClasses = "bg-black border-2 border-white rounded-[12px]";
        break;
      case "cyberpunk":
        bubbleClasses = "bg-yellow-400 border-2 border-cyan-400 rounded-none shadow-[2px_2px_0px_#06b6d4]";
        break;
      case "minimal":
        bubbleClasses = "bg-white/95 border border-slate-200 rounded-[8px] shadow-sm";
        break;
      case "neon-pink":
        bubbleClasses = "bg-pink-950/40 border-2 border-pink-500 rounded-[12px] shadow-[0_0_15px_rgba(236,72,153,0.5)] backdrop-blur-sm";
        break;
      case "neon-blue":
        bubbleClasses = "bg-blue-950/40 border-2 border-blue-500 rounded-[12px] shadow-[0_0_15px_rgba(59,130,246,0.5)] backdrop-blur-sm";
        break;
      case "soft":
        bubbleClasses = "bg-slate-50/95 border border-slate-200 rounded-[16px] shadow-sm";
        break;
      case "blood":
        bubbleClasses = "bg-red-950/80 border border-red-500 rounded-[12px] shadow-[0_0_10px_rgba(239,68,68,0.4)]";
        break;
      case "gold":
        bubbleClasses = "bg-yellow-900/50 border-2 border-yellow-500 rounded-[12px] shadow-[0_0_20px_rgba(234,179,8,0.3)]";
        break;
      default:
        bubbleClasses = "bg-white rounded-[12px]";
    }
  }

  if (!text) return null;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (onToggleHideBackground && e.altKey) {
      onToggleHideBackground();
      return;
    }

    // Direct region_id extraction strictly from event.currentTarget
    const clickedRegionId = e.currentTarget.dataset.regionId || regionId;

    if (playRegionAudio) {
      playRegionAudio(clickedRegionId, currentPageIndex);
    } else if (speakBlock) {
      speakBlock(block, currentPageIndex);
    } else if (speakText) {
      speakText(text, index, currentPageIndex);
    }
  };

  return (
    <div
      ref={containerRef}
      data-bubble="true"
      data-region-id={regionId}
      data-page-index={currentPageIndex}
      className={`group ${bubbleClasses}`}
      style={bubbleStyleProps}
      onClick={handleClick}
      title="اضغط للاستماع | Alt + اضغط لإخفاء الخلفية"
    >
      <p ref={textRef} style={textStyleProps} className="pointer-events-none select-none">
        {text}
      </p>

      {/* Audio Status Indicators */}
      {isSpeaking ? (
        <div className="absolute -top-3 -right-2 bg-emerald-500 text-white rounded-full p-0.5 shadow-md animate-pulse z-30 pointer-events-none">
          <Volume2 className="w-3.5 h-3.5" />
        </div>
      ) : isTtsLoading && speakingKey === `${currentPageIndex}_${regionId}` ? (
        <div className="absolute -top-3 -right-2 bg-amber-500 text-white rounded-full p-0.5 shadow-md z-30 animate-pulse pointer-events-none" title="جاري تجهيز الصوت...">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        </div>
      ) : isAudioReady || audioStatus === "ready" ? (
        <div className="absolute -top-2.5 -right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-emerald-600/90 text-white rounded-full p-0.5 shadow-xs z-20 pointer-events-none" title="الصوت جاهز للاستماع">
          <Volume2 className="w-2.5 h-2.5" />
        </div>
      ) : audioStatus === "generating" ? (
        <div className="absolute -top-2 -right-1.5 opacity-0 group-hover:opacity-80 transition-opacity bg-blue-500/80 text-white rounded-full p-0.5 shadow-xs z-20 pointer-events-none" title="جاري توليد الصوت في الخلفية...">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
        </div>
      ) : audioStatus === "retrying" ? (
        <div className="absolute -top-2 -right-1.5 opacity-80 group-hover:opacity-100 transition-opacity bg-amber-500/90 text-white rounded-full p-0.5 shadow-xs z-20 pointer-events-none" title="إعادة محاولة التوليد بنفس الصوت...">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
        </div>
      ) : audioStatus === "failed" || audioStatus === "error" ? (
        <div className="absolute -top-2 -right-1.5 opacity-80 group-hover:opacity-100 transition-opacity bg-rose-500/80 text-white rounded-full p-0.5 shadow-xs z-20 pointer-events-none" title="فشل إنشاء الصوت، انقر لإعادة المحاولة">
          <VolumeX className="w-2.5 h-2.5" />
        </div>
      ) : null}

      {/* Tooltip containing original text on hover */}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col gap-1 w-48 p-2 rounded bg-slate-900 text-[10px] text-slate-300 border border-slate-800 shadow-xl pointer-events-none">
        <span className="font-bold text-emerald-400 text-[9px] uppercase tracking-wider font-mono">النص الأصلي (OCR):</span>
        <p className="line-clamp-4 leading-normal" style={{ direction: 'ltr', textAlign: 'left' }}>{block.originalText || block.original_text}</p>
      </div>
    </div>
  );
}

interface ReaderPageProps {
  chapter: {
    id: string;
    title: string;
    chapter: string;
    pages?: string[];
    isLocal?: boolean;
    workType?: string;
    mangaTitle?: string;
    sourceId?: string;
    language?: string;
  };
  mangaId: string;
  onBack: () => void;
}

export default function ReaderPage({ chapter, mangaId, onBack }: ReaderPageProps) {
  const [pages, setPages] = useState<string[]>([]);
  const [originalPages, setOriginalPages] = useState<string[]>([]);
  const [colorizedPages, setColorizedPages] = useState<Record<number, string>>({});
  const [showColorized, setShowColorized] = useState<boolean>(true);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Lock document body scrolling while reader is active so touch events exclusively scroll manga
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Chapter Reading Progress State
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [loadedPages, setLoadedPages] = useState<Record<number, boolean>>({});
  const [showMobileSettings, setShowMobileSettings] = useState<boolean>(false);

  const [readingProgressPercent, setReadingProgressPercent] = useState<number>(() => {
    const existing = getChapterProgress(chapter.id);
    return existing ? existing.percent : 0;
  });
  const [currentVisiblePage, setCurrentVisiblePage] = useState<number>(() => {
    const existing = getChapterProgress(chapter.id);
    return existing ? existing.currentPage : 1;
  });
  const currentVisiblePageRef = useRef<number>(currentVisiblePage);
  useEffect(() => {
    currentVisiblePageRef.current = currentVisiblePage;
  }, [currentVisiblePage]);

  const lastScrollTopRef = useRef<number>(0);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const hasRestoredScrollRef = useRef<boolean>(false);
  const hasCleanedOnFinishRef = useRef<boolean>(false);

  // Throttled 60-120 FPS scroll handler with debounced disk writes
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollTop = target.scrollTop;
    const clientHeight = target.clientHeight;
    const scrollHeight = target.scrollHeight - clientHeight;
    if (scrollHeight <= 0) return;

    // Responsive topbar show/hide depending on scroll direction
    const diff = scrollTop - lastScrollTopRef.current;
    if (Math.abs(diff) > 20) {
      if (scrollTop <= 40) {
        setShowTopBar(true);
      } else if (diff > 25) {
        setShowTopBar(false); // scrolling down
      } else if (diff < -25) {
        setShowTopBar(true);  // scrolling up
      }
      lastScrollTopRef.current = scrollTop;
    }

    // Throttle progress calculations using requestAnimationFrame to eliminate lag
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      const scrollPercent = Math.min(100, Math.max(0, Math.round((scrollTop / scrollHeight) * 100)));
      const totalPages = pages.length;

      // Precisely find currently visible page via element boundaries
      let estimatedPage = 1;
      if (totalPages > 0 && target) {
        const pageEls = target.querySelectorAll<HTMLDivElement>("[data-page-index]");
        const containerTop = target.getBoundingClientRect().top;
        const middlePoint = containerTop + clientHeight * 0.35;

        for (let i = 0; i < pageEls.length; i++) {
          const rect = pageEls[i].getBoundingClientRect();
          if (rect.top <= middlePoint && rect.bottom >= containerTop) {
            estimatedPage = i + 1;
            break;
          }
        }
        if (estimatedPage === 1 && scrollPercent > 92) {
          estimatedPage = totalPages;
        }
      }

      setReadingProgressPercent((prev) => (prev !== scrollPercent ? scrollPercent : prev));
      setCurrentVisiblePage((prev) => (prev !== estimatedPage ? estimatedPage : prev));

      // Mark chapter completion without deleting translations
      if ((scrollPercent >= 98 || estimatedPage >= totalPages) && !hasCleanedOnFinishRef.current && chapter.id) {
        hasCleanedOnFinishRef.current = true;
      }

      // Debounce saving progress to localStorage to avoid thread blocking while dragging
      if (chapter.id && totalPages > 0) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          saveChapterProgress(chapter.id, mangaId, estimatedPage, totalPages, scrollPercent);
        }, 350);
      }
    });
  };

  // Exit reader: stop active chapter pipeline without deleting persistent chapter translations
  const handleExitReader = async () => {
    if (activePipelineRef.current) {
      activePipelineRef.current.stop();
      activePipelineRef.current = null;
    }
    const currentCtx = ChapterContextManager.getContext(chapter.id);
    if (currentCtx) {
      currentCtx.deactivate();
    }
    setPageOcrData({});
    setPreloadedAudio({});
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    setActiveAudio(null);
    setSpeakingKey(null);
    currentSpeakingKeyRef.current = null;
    if (ttsQueueRef.current) {
      ttsQueueRef.current.clear();
    }
    onBack();
  };

  // Chapter switch & unmount lifecycle:
  // Strictly isolate contexts: deactivates current chapter and halts its background queue
  // Never mixes OCR text, translations, batches, or session keys between chapters
  useEffect(() => {
    const activeChapterId = chapter.id;
    return () => {
      if (activePipelineRef.current) {
        activePipelineRef.current.stop();
        activePipelineRef.current = null;
      }
      const ctx = ChapterContextManager.getContext(activeChapterId);
      if (ctx) {
        ctx.deactivate();
      }
    };
  }, [chapter.id]);

  useEffect(() => {
    // Reset reading and translation state when chapter changes
    setPageOcrData({});
    setPreloadedAudio({});
    setSpeakingKey(null);
    currentSpeakingKeyRef.current = null;
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    setActiveAudio(null);
    ttsQueueRef.current?.clear();
    hasCleanedOnFinishRef.current = false;
  }, [chapter.id]);

  // Restore saved chapter progress smoothly
  useEffect(() => {
    if (pages.length > 0 && chapter.id && !hasRestoredScrollRef.current) {
      const existing = getChapterProgress(chapter.id);
      if (existing && existing.percent > 0) {
        setReadingProgressPercent(existing.percent);
        setCurrentVisiblePage(existing.currentPage);
        hasRestoredScrollRef.current = true;

        const timer = setTimeout(() => {
          if (scrollContainerRef.current) {
            const sh = scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight;
            if (sh > 0) {
              const targetY = (existing.percent / 100) * sh;
              scrollContainerRef.current.scrollTo({ top: targetY, behavior: "instant" as any });
            }
          }
        }, 150);
        return () => clearTimeout(timer);
      } else {
        hasRestoredScrollRef.current = true;
        saveChapterProgress(chapter.id, mangaId, 1, pages.length, 0);
      }
    }
  }, [pages.length, chapter.id, mangaId]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // Work Type (نوع العمل) state
  const [workType, setWorkType] = useState<string>(() => {
    return chapter.workType || localStorage.getItem("last_selected_work_type") || "مانهوا كورية";
  });
  
  // Work Name (اسم العمل) state
  const [workName, setWorkName] = useState<string>(() => {
    return localStorage.getItem("reader_work_name") || "";
  });
  const [includeWorkName, setIncludeWorkName] = useState<boolean>(() => {
    return localStorage.getItem("reader_include_work_name") === "true";
  });

  // OCR/Translation states
  const [targetLang, setTargetLang] = useState<Language>(TARGET_LANGUAGES[0]); // Default to Arabic
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [translatingPages, setTranslatingPages] = useState<Record<number, boolean>>({});
  const [translatedTextCount, setTranslatedTextCount] = useState<number>(0);
  const [isBackgroundTranslating, setIsBackgroundTranslating] = useState<boolean>(false);
  const [completedPagesCount, setCompletedPagesCount] = useState<number>(0);
  const [pageOcrData, setPageOcrData] = useState<Record<number, OCRBlock[]>>({});
  const [showOverlays, setShowOverlays] = useState<boolean>(true);
  const [showVisionInspector, setShowVisionInspector] = useState<boolean>(false);
  const [bubbleStyle, setBubbleStyle] = useState<string>("solid");
  const [translatorEngine, setTranslatorEngine] = useState<"google" | "gemini" | "gemini_cookies" | "metaai">(() => {
    const saved = localStorage.getItem("reader_translator_engine");
    if (saved === "gemini_cookies" || saved === "gemini") {
      const cookies = localStorage.getItem("gemini_cookies");
      if (cookies && cookies.trim()) return "gemini_cookies";
      return "google";
    }
    if (saved === "metaai") return "metaai";
    if (saved === "google") return "google";
    const cookies = localStorage.getItem("gemini_cookies");
    if (cookies && cookies.trim()) return "gemini_cookies";
    return "google";
  });
  const [translationWarning, setTranslationWarning] = useState<string | null>(null);

  const handleTranslatorEngineChange = (engine: "google" | "gemini_cookies" | "metaai") => {
    if (engine === "gemini_cookies") {
      const gCookies = localStorage.getItem("gemini_cookies");
      if (!gCookies || !gCookies.trim()) {
        setTranslationWarning("تنبيه: ملفات كوكيز Gemini غير مضافة. يرجى إضافتها في الإعدادات أو استخدام محرك Google.");
      } else {
        setTranslationWarning(null);
      }
    } else {
      setTranslationWarning(null);
    }
    setTranslatorEngine(engine);
    localStorage.setItem("reader_translator_engine", engine);
  };

  const [geminiCookieModel, setGeminiCookieModel] = useState<string>(() => {
    return localStorage.getItem("gemini_cookie_model") || "3.6-flash";
  });

  const handleGeminiCookieModelChange = (model: string) => {
    setGeminiCookieModel(model);
    localStorage.setItem("gemini_cookie_model", model);
  };

  useEffect(() => {
    const handleTranslationError = (e: any) => {
      const detail = e.detail;
      if (detail && detail.error) {
        setTranslationWarning(detail.error);
      }
    };
    window.addEventListener("reader_translation_error", handleTranslationError);
    return () => {
      window.removeEventListener("reader_translation_error", handleTranslationError);
    };
  }, []);
  const sessionIdRef = useRef<string>("");
  const activePipelineRef = useRef<ChapterBatchPipeline | null>(null);
  const lensOrchestratorRef = useRef<GoogleLensChapterOrchestrator | null>(null);
  const [lensProgress, setLensProgress] = useState<GoogleLensProgress | null>(null);
  const [ocrEngine, setOcrEngine] = useState<"google_lens" | "comic_vision">(() => {
    return (localStorage.getItem("reader_ocr_engine") as "google_lens" | "comic_vision") || "google_lens";
  });

  useEffect(() => {
    localStorage.setItem("reader_ocr_engine", ocrEngine);
  }, [ocrEngine]);

  // Isolate and restore per-chapter translation context:
  // Automatically restores this chapter's translations whenever the user enters or returns to it!
  useEffect(() => {
    let isCurrent = true;
    if (chapter.id) {
      const ctx = ChapterContextManager.switchActiveChapter({
        chapterId: chapter.id,
        mangaId: mangaId || chapter.id,
        mangaTitle: chapter.mangaTitle || chapter.title || "",
        workType: workType || chapter.workType || "مانهوا كورية",
        provider: translatorEngine,
        targetLang: targetLang.code
      });

      // Restore cached translations from persistent cache into context & UI state
      ReaderTranslationCache.getChapterTranslations(chapter.id, translatorEngine, targetLang.code)
        .then((cached) => {
          if (isCurrent && cached && Object.keys(cached).length > 0) {
            setPageOcrData((prev) => ({
              ...cached,
              ...prev
            }));
            for (const [pIdxStr, blocks] of Object.entries(cached)) {
              if (Array.isArray(blocks) && blocks.length > 0) {
                ctx.setPageBlocks(Number(pIdxStr), blocks as OCRBlock[]);
              }
            }
          }
        })
        .catch(() => {});
    }
    return () => {
      isCurrent = false;
      if (activePipelineRef.current) {
        activePipelineRef.current.stop();
        activePipelineRef.current = null;
      }
      if (lensOrchestratorRef.current) {
        lensOrchestratorRef.current.stop();
        lensOrchestratorRef.current = null;
      }
    };
  }, [chapter.id, translatorEngine, targetLang.code, mangaId, workType]);
  
  // TTS State
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [hfToken, setHfToken] = useState<string>(() => localStorage.getItem("reader_hf_token") || "");

  // Premium TTS States
  const [activeAudio, setActiveAudio] = useState<HTMLAudioElement | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSpeakingKeyRef = useRef<string | null>(null);
  const getValidVoiceForGroup = (group: "gemini" | "capcut" | "current" | "chatgpt" | "huggingface", candidate?: string | null): string => {
    if (group === "gemini") {
      if (candidate && (candidate === "Google Demo" || GEMINI_VOICES.some(v => v.name === candidate))) {
        return candidate;
      }
      return "Aoede";
    }
    if (group === "capcut") {
      if (candidate && CAPCUT_VOICES.some(v => v.id === candidate)) {
        return candidate;
      }
      return "ar_female_madina";
    }
    if (group === "chatgpt") {
      if (candidate && CHATGPT_VOICES.some(v => v.id === candidate)) {
        return candidate;
      }
      return "onyx";
    }
    if (group === "huggingface") {
      return "nabra-arabic";
    }
    // "current" (Edge Neural)
    if (candidate && PREMIUM_VOICES.some(v => v.id === candidate)) {
      return candidate;
    }
    return "ar-EG-SalmaNeural";
  };

  const [selectedVoiceGroup, setSelectedVoiceGroup] = useState<"gemini" | "capcut" | "current" | "chatgpt" | "huggingface">(() => {
    const saved = localStorage.getItem("reader_voice_group");
    if (saved === "tiktok") return "capcut";
    return (saved as "gemini" | "capcut" | "current" | "chatgpt" | "huggingface") || "gemini";
  });
  const [selectedEdgeVoice, setSelectedEdgeVoice] = useState<string>(() => {
    const group = (localStorage.getItem("reader_voice_group") === "tiktok" ? "capcut" : localStorage.getItem("reader_voice_group")) || "gemini";
    let stored: string | null = null;
    if (group === "gemini") stored = localStorage.getItem("reader_gemini_voice") || "Aoede";
    else if (group === "capcut") stored = localStorage.getItem("reader_capcut_voice");
    else if (group === "chatgpt") stored = localStorage.getItem("reader_chatgpt_voice");
    else if (group === "huggingface") stored = localStorage.getItem("reader_huggingface_voice");
    else stored = localStorage.getItem("reader_edge_neural_voice");

    return getValidVoiceForGroup(group as any, stored);
  });
  const [isTtsLoading, setIsTtsLoading] = useState<boolean>(false);
  const [preloadedAudio, setPreloadedAudio] = useState<Record<string, string>>({});
  const [bubbleAudioStatus, setBubbleAudioStatus] = useState<Record<string, TTSTaskStatus>>({});
  const ttsQueueRef = useRef<ReaderTTSQueueManager | null>(null);

  const handleVoiceGroupChange = (group: "gemini" | "capcut" | "current" | "chatgpt" | "huggingface") => {
    setSelectedVoiceGroup(group);
    localStorage.setItem("reader_voice_group", group);
    let stored: string | null = null;
    if (group === "gemini") stored = localStorage.getItem("reader_gemini_voice");
    else if (group === "capcut") stored = localStorage.getItem("reader_capcut_voice");
    else if (group === "chatgpt") stored = localStorage.getItem("reader_chatgpt_voice");
    else if (group === "huggingface") stored = localStorage.getItem("reader_huggingface_voice");
    else stored = localStorage.getItem("reader_edge_neural_voice");

    const validVoice = getValidVoiceForGroup(group, stored);
    setSelectedEdgeVoice(validVoice);
    localStorage.setItem("reader_edge_voice", validVoice);
  };

  const handleVoiceChange = (voice: string) => {
    const validVoice = getValidVoiceForGroup(selectedVoiceGroup, voice);
    setSelectedEdgeVoice(validVoice);
    localStorage.setItem("reader_edge_voice", validVoice);
    if (selectedVoiceGroup === "gemini") {
      localStorage.setItem("reader_gemini_voice", validVoice);
    } else if (selectedVoiceGroup === "capcut") {
      localStorage.setItem("reader_capcut_voice", validVoice);
    } else if (selectedVoiceGroup === "chatgpt") {
      localStorage.setItem("reader_chatgpt_voice", validVoice);
    } else if (selectedVoiceGroup === "huggingface") {
      localStorage.setItem("reader_huggingface_voice", validVoice);
    } else {
      localStorage.setItem("reader_edge_neural_voice", validVoice);
    }
  };

  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem("reader_playback_speed") || "1.0");
    if (isNaN(saved) || saved < 1.0) return 1.0;
    if (saved > 2.0) return 2.0;
    return saved;
  });

  const [voiceDirection, setVoiceDirection] = useState<string>(() => {
    return localStorage.getItem("reader_voice_direction") || "";
  });

  const updatePlaybackSpeed = (val: number) => {
    if (isNaN(val)) return;
    const clamped = Math.min(2.0, Math.max(1.0, Math.round(val * 100) / 100));
    setPlaybackSpeed(clamped);
    localStorage.setItem("reader_playback_speed", String(clamped));
    if (activeAudioRef.current) {
      activeAudioRef.current.playbackRate = clamped;
    }
  };

  const cyclePlaybackSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 1.75, 2.0];
    const currentIndex = speeds.findIndex((s) => Math.abs(s - playbackSpeed) < 0.05);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    updatePlaybackSpeed(nextSpeed);
  };

  // Additional Bubble Styling Preferences
  const [fontColor, setFontColor] = useState<string>(() => {
    return localStorage.getItem("reader_font_color") || "#000000";
  });
  const [hideBackground, setHideBackground] = useState<boolean>(() => {
    return localStorage.getItem("reader_hide_background") === "true";
  });
  const [fontScale, setFontScale] = useState<number>(() => {
    const saved = localStorage.getItem("reader_bubble_font_scale");
    return saved ? parseFloat(saved) : 0.85;
  });

  useEffect(() => {
    localStorage.setItem("reader_bubble_font_scale", String(fontScale));
  }, [fontScale]);

  const [hideColorizeButtons, setHideColorizeButtons] = useState<boolean>(() => {
    return localStorage.getItem("reader_hide_colorize_buttons") === "true";
  });

  const [colorizingPages, setColorizingPages] = useState<Record<number, boolean>>({});
  const [isBulkColorizing, setIsBulkColorizing] = useState<boolean>(false);
  const [autoColorize, setAutoColorize] = useState<boolean>(() => {
    return localStorage.getItem("reader_auto_colorize") === "true";
  });

  // Progressive Speech & Parallel Narration refs
  const [resettingSession, setResettingSession] = useState<boolean>(false);

  const resetChapterSession = async () => {
    if (resettingSession) return;
    try {
      setResettingSession(true);
      // Remove any client-side cached Meta AI conversation url for this chapter
      localStorage.removeItem(`reader_metaai_conv_${chapter.id}`);
      
      const res = await fetch("/api/manga/reset-chapter-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id, engine: "all" })
      });
      
      if (res.ok) {
        alert(`تمت إعادة ضبط محادثة الفصل ${chapter.chapter} بنجاح! جميع طلبات الترجمة القادمة ستتم داخل محادثة جديدة كلياً خاصة بهذا الفصل.`);
      } else {
        alert(`تم مسح الجلسة الخاصة بالفصل ${chapter.chapter}.`);
      }
    } catch (e) {
      console.error("Failed to reset chapter session:", e);
      alert(`تم مسح الجلسة الخاصة بالفصل ${chapter.chapter}.`);
    } finally {
      setResettingSession(false);
    }
  };

  const colorizePage = async (pageIndex: number, currentImgUrl: string) => {
    setColorizingPages((prev) => ({ ...prev, [pageIndex]: true }));
    try {
      const sourceUrl = originalPages[pageIndex] || currentImgUrl;
      const isBase64 = sourceUrl.startsWith("data:");
      const isBlob = sourceUrl.startsWith("blob:");
      let imgData = sourceUrl;
      
      if (!isBase64) {
        const fetchTarget = toProxiedUrl(sourceUrl, isBlob || chapter.isLocal);
        const imgRes = await fetch(fetchTarget);
        if (!imgRes.ok) throw new Error("Failed to load image");
        
        const imgBlob = await imgRes.blob();
        imgData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(imgBlob);
        }) as string;
      }

      // Check if this page already has detected OCR / dialogue blocks to protect
      const pageBlocks = pageOcrData[pageIndex] || [];

      const colorizedBase64 = await colorizeImageAPI(imgData, {
        chapterId: chapter.id,
        pageIndex,
        blocks: pageBlocks,
        hfToken,
        inferSize: 512
      });
      
      setColorizedPages(prev => ({ ...prev, [pageIndex]: colorizedBase64 }));
      setShowColorized(true);

      setPages(prevPages => {
        const newPages = [...prevPages];
        newPages[pageIndex] = colorizedBase64;
        return newPages;
      });
      
    } catch (e: any) {
      console.error(e);
      alert("فشل تلوين الصفحة بالذكاء الاصطناعي: " + (e.message || "حاول مرة أخرى لاحقاً"));
    } finally {
      setColorizingPages((prev) => ({ ...prev, [pageIndex]: false }));
    }
  };

  const toggleColorizedView = () => {
    const nextVal = !showColorized;
    setShowColorized(nextVal);
    if (originalPages.length > 0) {
      if (nextVal) {
        setPages(originalPages.map((orig, idx) => colorizedPages[idx] || orig));
      } else {
        setPages([...originalPages]);
      }
    }
  };

  const togglePageColor = (pageIndex: number) => {
    if (!colorizedPages[pageIndex] || !originalPages[pageIndex]) return;
    const isCurrentlyColorized = pages[pageIndex] === colorizedPages[pageIndex];
    setPages(prev => {
      const updated = [...prev];
      updated[pageIndex] = isCurrentlyColorized ? originalPages[pageIndex] : colorizedPages[pageIndex];
      return updated;
    });
  };

  const [showTopBar, setShowTopBar] = useState(true);
  const [showTopOptions, setShowTopOptions] = useState<boolean>(() => {
    return localStorage.getItem("reader_show_top_options") === "true";
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleBulkColorize = async () => {
    // Start colorization automatically from the current page the user is viewing
    const startIdx = Math.max(0, Math.min(currentVisiblePage - 1, pages.length - 1));
    const confirmMsg = startIdx > 0
      ? `هل أنت متأكد أنك تريد تلوين صفحات الفصل بالذكاء الاصطناعي بدءاً من الصفحة الحالية (${startIdx + 1})؟`
      : "هل أنت متأكد أنك تريد تلوين جميع صفحات الفصل بالذكاء الاصطناعي؟";
    if (!confirm(confirmMsg)) return;

    setIsBulkColorizing(true);
    try {
      // First colorize from current page to the end of the chapter
      for (let i = startIdx; i < pages.length; i++) {
        if (!colorizedPages[i]) {
          await colorizePage(i, pages[i]);
        }
      }
      // Then process preceding pages before current page if not yet colorized
      for (let i = 0; i < startIdx; i++) {
        if (!colorizedPages[i]) {
          await colorizePage(i, pages[i]);
        }
      }
    } finally {
      setIsBulkColorizing(false);
    }
  };

  // Unified TTS Audio Synthesis Engine
  const synthesizeTTSAudio = async (
    textToSpeak: string,
    voice: string = selectedEdgeVoice,
    group: string = selectedVoiceGroup,
    direction?: string,
    speed?: number,
    options?: { generationId?: string; segmentId?: string }
  ): Promise<{ audioBase64: string; mimeType: string; provider?: string; fallbackUsed?: boolean }> => {
    if (group === "gemini") {
      // Official Gemini TTS pipeline matching Gemini TTS Studio
      const cleanVoice = (voice === "Google Demo" || voice.toLowerCase().includes("demo")) ? "Achernar" : voice;
      const res = await GeminiTTSService.synthesize({
        text: textToSpeak,
        voiceName: cleanVoice,
        languageCode: "ar-EG",
        voiceDirection: (direction !== undefined ? direction : voiceDirection).trim() || undefined,
        generationId: options?.generationId,
        segmentId: options?.segmentId,
        allowFallback: false,
        speech_config: {
          voice_config: {
            prebuilt_voice_config: {
              voice_name: cleanVoice,
            },
          },
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: speed ?? playbackSpeed,
          pitch: 0.0,
          volumeGainDb: 0.0,
        },
      });
      return {
        audioBase64: res.audioBase64,
        mimeType: res.mimeType || "audio/mp3",
        provider: "gemini",
        fallbackUsed: res.fallbackUsed,
      };
    }

    const gptCookies = localStorage.getItem("gpt_cookies") || "";
    const res = await fetch("/api/manga/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: textToSpeak,
        voiceName: voice,
        voiceGroup: group,
        gptCookies,
        hfToken,
        voiceDirection: (direction !== undefined ? direction : voiceDirection).trim() || undefined,
        allowFallback: false,
        speech_config: {
          voice_config: {
            prebuilt_voice_config: {
              voice_name: voice,
            },
          },
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: speed ?? playbackSpeed,
        },
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to generate TTS audio");
    }

    const data = await res.json();
    if (!data.audio) {
      throw new Error("No audio returned from server");
    }
    return {
      audioBase64: data.audio,
      mimeType: data.mimeType || "audio/mp3",
      provider: data.provider,
      fallbackUsed: data.fallbackUsed,
    };
  };

  const handleTestVoice = async () => {
    if (isTtsLoading) return;
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
      setActiveAudio(null);
    }
    setSpeakingKey(null);
    currentSpeakingKeyRef.current = null;
    setIsTtsLoading(true);
    try {
      const testPhrase = selectedVoiceGroup === "gemini"
        ? `مرحباً، هذه تجربة حية لصوت ${selectedEdgeVoice} عبر Gemini TTS الرسمي في القارئ.`
        : "مرحباً، هذه تجربة للصوت العربي الجديد في القارئ.";

      const { audioBase64, mimeType } = await synthesizeTTSAudio(
        testPhrase,
        selectedEdgeVoice,
        selectedVoiceGroup
      );

      if (audioBase64) {
        const mime = mimeType || "audio/mp3";
        const audioUrl = `data:${mime};base64,${audioBase64}`;
        const audio = new Audio(audioUrl);
        audio.playbackRate = playbackSpeed;
        activeAudioRef.current = audio;
        setActiveAudio(audio);
        audio.play().catch((e: any) => {
          if (e?.name !== 'AbortError' && e?.name !== 'NotAllowedError' && !e?.message?.includes('interrupted')) {
            console.error("Audio preview playback error:", e);
          }
        });
        audio.onended = () => {
          setActiveAudio(null);
          activeAudioRef.current = null;
        };
      }
    } catch (e: any) {
      console.error(e);
      alert(e.message || "فشل الاتصال بالخادم");
    }
    setIsTtsLoading(false);
  };

  // Reset cached preloaded audio when switching voice or engine to prevent playing old cached voices
  useEffect(() => {
    setPreloadedAudio({});
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
      setActiveAudio(null);
    }
    setSpeakingKey(null);
    currentSpeakingKeyRef.current = null;
  }, [selectedVoiceGroup, selectedEdgeVoice]);

  // Cleanup audio playbacks on unmount
  useEffect(() => {
    return () => {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("reader_font_color", fontColor);
  }, [fontColor]);

  useEffect(() => {
    localStorage.setItem("reader_hide_background", String(hideBackground));
  }, [hideBackground]);

  // Load cached audio for this chapter from IndexedDB on initial chapter load
  useEffect(() => {
    if (!chapter?.id) return;
    ReaderAudioCache.getAllForChapter(chapter.id).then((cachedMap) => {
      if (cachedMap && Object.keys(cachedMap).length > 0) {
        setPreloadedAudio((prev) => ({ ...prev, ...cachedMap }));
      }
    });
  }, [chapter?.id]);

  // Initialize and synchronize the concurrent TTS queue manager
  useEffect(() => {
    if (!chapter?.id) return;

    if (!ttsQueueRef.current) {
      ttsQueueRef.current = new ReaderTTSQueueManager({
        chapterId: chapter.id,
        synthesizer: async (text, voice, group, direction, speed, options) => {
          return await synthesizeTTSAudio(
            text,
            voice || selectedEdgeVoice,
            group || selectedVoiceGroup,
            direction,
            speed,
            options
          );
        },
        onAudioReady: (key, audioDataUrl, task) => {
          setPreloadedAudio((prev) => ({
            ...prev,
            [key]: audioDataUrl,
          }));
          setBubbleAudioStatus((prev) => ({
            ...prev,
            [task.id]: "ready",
          }));
        },
        onStatusChange: (taskId, status) => {
          setBubbleAudioStatus((prev) => ({
            ...prev,
            [taskId]: status,
          }));
        },
        maxConcurrency: 3,
      });
    } else {
      ttsQueueRef.current.setChapterId(chapter.id);
    }
  }, [chapter?.id, selectedEdgeVoice, selectedVoiceGroup, voiceDirection, playbackSpeed]);

  // Update visible page priority in the queue when user navigates
  useEffect(() => {
    if (ttsQueueRef.current) {
      ttsQueueRef.current.updateVisiblePage(currentVisiblePage - 1);
    }
  }, [currentVisiblePage]);

  // Reader View Mode (fit height vs fit width for tall manhwas)
  const [viewMode, setViewMode] = useState<"fit-height" | "fit-width">(() => {
    return (localStorage.getItem("reader_view_mode") as "fit-height" | "fit-width") || "fit-width";
  });

  // References
  const containerRef = useRef<HTMLDivElement>(null);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const fetchPagesRef = useRef<(() => void) | undefined>(undefined);

  // Fetch chapter pages on mount
  useEffect(() => {
    let active = true;

    async function fetchPages() {
      try {
        setLoading(true);
        setError(null);
        
        if (Array.isArray(chapter.pages) && chapter.pages.length > 0) {
          setPages(chapter.pages);
          setOriginalPages(chapter.pages);
          
          // Save progress to localStorage
          const history = JSON.parse(localStorage.getItem("manga_history") || "{}");
          history[mangaId] = {
            chapterId: chapter.id,
            chapterNumber: chapter.chapter,
            pageIndex: 0,
            timestamp: Date.now(),
          };
          localStorage.setItem("manga_history", JSON.stringify(history));
          return;
        }
        
        let loadedPages: string[] = [];
        
        // Resolve sourceId, mangaTitle and chapterNumber from localStorage if missing
        let resolvedSourceId = chapter.sourceId || "";
        let resolvedMangaTitle = chapter.mangaTitle || chapter.title || "";
        let resolvedChapterNum = chapter.chapter || "1";

        if (!resolvedSourceId && mangaId) {
          try {
            const favs = JSON.parse(localStorage.getItem("manga_favorites") || "[]");
            const cleanId = String(mangaId).replace(/^suwayomi_/, "");
            const f = favs.find((item: any) => item.id === mangaId || item.id === cleanId);
            if (f) {
              if (f.sourceId) resolvedSourceId = f.sourceId;
              if (!resolvedMangaTitle && f.title) resolvedMangaTitle = f.title;
            }
            const cached = JSON.parse(localStorage.getItem(`manga_cached_${mangaId}`) || "null");
            if (cached) {
              if (cached.sourceId) resolvedSourceId = cached.sourceId;
              if (!resolvedMangaTitle && cached.manga?.title) resolvedMangaTitle = cached.manga.title;
            }
          } catch (_) {}
        }

        const queryParams = new URLSearchParams({
          sourceId: resolvedSourceId,
          provider: resolvedSourceId,
          mangaTitle: resolvedMangaTitle,
          chapterNumber: resolvedChapterNum,
          lang: chapter.language || "ar"
        }).toString();

        // 1. Direct Suwayomi Chapter Pages endpoint
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);
          const res = await fetch(`/api/suwayomi/chapter/${encodeURIComponent(chapter.id)}/pages`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data.pages && Array.isArray(data.pages) && data.pages.length > 0) {
              loadedPages = data.pages;
            }
          }
        } catch (e: any) {
          console.warn("Suwayomi direct pages fetch notice:", e);
        }

        // 2. Secondary Suwayomi proxy endpoint
        if (loadedPages.length === 0) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);
            const res = await fetch(`/api/manga/chapter-pages/${encodeURIComponent(chapter.id)}?${queryParams}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
              const data = await res.json();
              if (data.pages && Array.isArray(data.pages) && data.pages.length > 0) {
                loadedPages = data.pages;
              }
            }
          } catch (e: any) {
            console.warn("Suwayomi secondary fetch notice:", e);
          }
        }

        if (!active) return;

        if (loadedPages.length > 0) {
          const proxiedPages = loadedPages.map((url: string) => {
            if (url.startsWith("/api/") || url.startsWith("data:") || url.startsWith("blob:")) return url;
            return `/api/proxy-image?url=${encodeURIComponent(url)}`;
          });
          setPages(proxiedPages);
          setOriginalPages(proxiedPages);
        } else {
          throw new Error("الفصل لا يحتوي على أي صفحات أو تعذر جلبها");
        }

        // Save progress to localStorage
        const history = JSON.parse(localStorage.getItem("manga_history") || "{}");
        history[mangaId] = {
          chapterId: chapter.id,
          chapterNumber: chapter.chapter,
          pageIndex: 0,
          timestamp: Date.now(),
        };
        localStorage.setItem("manga_history", JSON.stringify(history));

      } catch (err: any) {
        if (active) setError(err.message || "حدث خطأ غير متوقع أثناء محاولة جلب صفحات الفصل.");
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchPagesRef.current = fetchPages;
    fetchPages();

    return () => {
      active = false;
      window.speechSynthesis.cancel();
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
    };
  }, [chapter.id]);

  // Handle page index change (Removed since we scroll now)
  const handlePageChange = (newIndex: number) => {
    // Keep it in case it's used elsewhere, but not active for navigation
  };

  // Modular OCR worker function
  const ocrPageBlocks = async (
    currentImgUrl: string,
    i: number,
    bypassCache: boolean = false,
    skipTranslation: boolean = false
  ): Promise<OCRBlock[]> => {
    if (!currentImgUrl) return [];

    const body: any = {
      targetLanguage: targetLang.code,
      translatorEngine: skipTranslation ? "none" : translatorEngine,
      skipTranslation: skipTranslation,
      mangaTitle: chapter.mangaTitle || chapter.title || "",
      workType: workType || chapter.workType || "مانهوا كورية",
      forceRefresh: bypassCache,
      ocrEngine: ocrEngine
    };

    if (currentImgUrl.startsWith("data:")) {
      body.imageBase64 = currentImgUrl;
    } else {
      try {
        const imgRes = await fetch(currentImgUrl);
        if (imgRes.ok) {
          const blob = await imgRes.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          if (base64) {
            body.imageBase64 = base64;
          } else {
            body.imageUrl = currentImgUrl;
          }
        } else {
          body.imageUrl = currentImgUrl;
        }
      } catch (imgErr) {
        console.warn("[Reader OCR] Direct image fetch notice, falling back to imageUrl:", imgErr);
        body.imageUrl = currentImgUrl;
      }
    }

    if (ocrEngine === "google_lens" && skipTranslation) {
      try {
        const lensRes = await fetch("/api/manga/google-lens-ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl: body.imageUrl,
            imageBase64: body.imageBase64,
            pageId: i,
            pageIndex: i,
            readingDirection: (workType && workType.includes("مانجا يابانية")) ? "rtl" : "ltr",
            language: "auto",
            forceRefresh: bypassCache
          }),
        });
        if (lensRes.ok) {
          const data = await lensRes.json();
          if (Array.isArray(data.blocks) && data.blocks.length > 0) {
            return consolidateNearbyBlocks(data.blocks);
          }
        }
      } catch (e) {
        console.warn("[Reader OCR] Google Lens direct fetch error, falling back:", e);
      }
    }

    try {
      const response = await fetch("/api/manga/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return [];
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return [];
      const data = await response.json();
      return consolidateNearbyBlocks(data.blocks || []);
    } catch (fetchErr) {
      console.warn(`[Reader OCR] Error on page ${i + 1}:`, fetchErr);
      return [];
    }
  };

  // Process a single page with multi-region batching
  const processPage = async (
    currentImgUrl: string,
    i: number,
    currentSessionId: string,
    bypassCache: boolean = false
  ) => {
    if (!currentImgUrl) return;

    // 0. Check persistent translation cache first (Instant 0ms retrieval) only when NOT bypassing cache
    if (!bypassCache) {
      try {
        const cachedBlocks = await ReaderTranslationCache.getPageTranslation(
          chapter.id,
          i,
          translatorEngine,
          targetLang.code
        );
        if (cachedBlocks && cachedBlocks.length > 0) {
          const untranslatedCount = cachedBlocks.filter((b: OCRBlock) => {
            const tr = (b.translatedText || b.translated_text || "").trim();
            const orig = (b.originalText || b.original_text || "").trim();
            return !tr || tr === orig;
          }).length;

          if (untranslatedCount === 0) {
            setPageOcrData((prev) => ({
              ...prev,
              [i]: cachedBlocks,
            }));
            if (ttsQueueRef.current && !isMuted) {
              ttsQueueRef.current.enqueuePageBlocks(
                i,
                cachedBlocks,
                selectedVoiceGroup,
                selectedEdgeVoice,
                voiceDirection,
                playbackSpeed,
                currentVisiblePage - 1
              );
            }
            return;
          }
        }
      } catch (_) {}
    }

    // 1. OCR detects all text regions on the page
    const blocks = await ocrPageBlocks(currentImgUrl, i, bypassCache);
    if (!blocks || blocks.length === 0) return;

    // Immediately render speech bubbles on screen so boxes appear promptly
    setPageOcrData((prev) => ({
      ...prev,
      [i]: blocks,
    }));

    // 2. Ensure isolated chapter context is retrieved
    const ctx = ChapterContextManager.getOrCreateContext({
      chapterId: chapter.id,
      mangaId: mangaId || chapter.id,
      mangaTitle: chapter.mangaTitle || chapter.title || "",
      workType: workType || chapter.workType || "مانهوا كورية",
      provider: translatorEngine,
      targetLang: targetLang.code,
    });
    ctx.setPageBlocks(i, blocks);

    // 3. Batch all untranslated regions together and send ONE batch request to the chosen provider
    const untranslated = ctx.getUntranslatedItems([i]);
    if (untranslated.length > 0) {
      const batch = ctx.createBatch(untranslated, [i]);
      await executeTranslationBatch(ctx, batch);
    }

    const finalBlocks = ctx.getPageBlocks(i) || blocks;
    const consolidated = consolidateNearbyBlocks(finalBlocks);
    setPageOcrData((prev) => ({
      ...prev,
      [i]: consolidated,
    }));

    // Persist in IndexedDB cache for instant retrieval on reload or revisit
    const hasAnyTranslation = consolidated.some(
      (b) => (b.translatedText || b.translated_text || "").trim().length > 0
    );
    if (hasAnyTranslation || consolidated.length === 0) {
      ReaderTranslationCache.savePageTranslation(
        chapter.id,
        i,
        consolidated,
        translatorEngine,
        targetLang.code
      ).catch(() => {});
    }

    // Enqueue speech bubbles into the background queue to pre-generate audio smoothly
    if (ttsQueueRef.current && !isMuted && consolidated.length > 0) {
      ttsQueueRef.current.enqueuePageBlocks(
        i,
        consolidated,
        selectedVoiceGroup,
        selectedEdgeVoice,
        voiceDirection,
        playbackSpeed,
        currentVisiblePage - 1
      );
    }
  };

  // Run BATCH OCR & translation across chapter pages with isolated per-chapter context & concurrent producer-consumer pipeline
  const runOcrAndTranslate = async (isRetranslate: boolean = false) => {
    if (ocrLoading || pages.length === 0) return;

    const shouldRetranslate = isRetranslate === true;

    try {
      if (translatorEngine === "gemini" || translatorEngine === "gemini_cookies") {
        const gCookies = localStorage.getItem("gemini_cookies");
        if (!gCookies || !gCookies.trim()) {
          const msg = "ملفات تعريف الارتباط (Cookies) لـ Gemini غير موجودة. يرجى إضافتها أولاً في الإعدادات، أو اختر محرك Google للترجمة الفورية.";
          setTranslationWarning(msg);
          return;
        }
      }

      setOcrLoading(true);
      setTranslatedTextCount(0);
      setIsBackgroundTranslating(false);
      setCompletedPagesCount(0);

      // Stop active audio and clear queues
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
      setActiveAudio(null);
      setSpeakingKey(null);
      currentSpeakingKeyRef.current = null;
      if (ttsQueueRef.current) {
        ttsQueueRef.current.clear();
      }

      // Stop any existing active pipeline
      if (activePipelineRef.current) {
        activePipelineRef.current.stop();
        activePipelineRef.current = null;
      }
      if (lensOrchestratorRef.current) {
        lensOrchestratorRef.current.stop();
        lensOrchestratorRef.current = null;
      }

      if (ocrEngine === "google_lens") {
        if (shouldRetranslate) {
          await ReaderTranslationCache.clearChapterTranslations(chapter.id);
          await ReaderAudioCache.clearForChapter(chapter.id).catch(() => {});
          setPageOcrData({});
          setPreloadedAudio({});
        }

        const engineForBatch = (translatorEngine === "gemini" ? "gemini_cookies" : translatorEngine) as "gemini_cookies" | "metaai" | "google";
        const orchestrator = new GoogleLensChapterOrchestrator({
          chapterId: chapter.id,
          pages: pages,
          targetLang: targetLang.code,
          translatorEngine: engineForBatch,
          geminiCookieModel: geminiCookieModel,
          mangaTitle: chapter.mangaTitle || chapter.title || "",
          workType: workType || chapter.workType || "مانهوا كورية",
          readingDirection: (workType && workType.includes("مانجا يابانية")) ? "rtl" : "ltr",
          forceRefresh: shouldRetranslate,
          onProgress: (progress) => {
            if (!ChapterContextManager.isChapterActive(chapter.id)) return;
            setLensProgress(progress);
            if (progress.phase === "translating" || progress.phase === "ocr_completed") {
              setTranslatedTextCount(progress.translatedTexts);
            }
            if (progress.phase === "completed") {
              setIsBackgroundTranslating(false);
              setTimeout(() => {
                setOcrLoading(false);
                setLensProgress(null);
              }, 1400);
            }
          },
          onPageOcrReady: (pageIdx, blocks) => {
            if (!ChapterContextManager.isChapterActive(chapter.id)) return;
            const consolidated = consolidateNearbyBlocks(blocks);
            setPageOcrData((prev) => ({
              ...prev,
              [pageIdx]: consolidated,
            }));
          },
          onPageTranslationReady: (pageIdx, blocks) => {
            if (!ChapterContextManager.isChapterActive(chapter.id)) return;
            const consolidated = consolidateNearbyBlocks(blocks);
            setPageOcrData((prev) => ({
              ...prev,
              [pageIdx]: consolidated,
            }));
            if (ttsQueueRef.current && !isMuted && consolidated.length > 0) {
              ttsQueueRef.current.enqueuePageBlocks(
                pageIdx,
                consolidated,
                selectedVoiceGroup,
                selectedEdgeVoice,
                voiceDirection,
                playbackSpeed,
                currentVisiblePage - 1
              );
            }
            if (autoColorize) {
              colorizePage(pageIdx, pages[pageIdx]).catch(() => {});
            }
          },
          onError: (errMsg) => {
            if (!ChapterContextManager.isChapterActive(chapter.id)) return;
            setTranslationWarning(errMsg);
          },
          onCompleted: (_allBlocks) => {
            if (!ChapterContextManager.isChapterActive(chapter.id)) return;
            setOcrLoading(false);
            setIsBackgroundTranslating(false);
          }
        });

        lensOrchestratorRef.current = orchestrator;
        orchestrator.execute().catch((err) => {
          console.error("[Reader] Google Lens Orchestrator error:", err);
          setTranslationWarning(err.message || "حدث خطأ في طبقة Google Lens OCR");
        });
        return;
      }

      let ctx: ChapterTranslationContext;
      if (shouldRetranslate) {
        console.log(`[Reader] Re-translating chapter ${chapter.id} - resetting context and cache with fresh isolated session...`);
        // 1. Clear persistent translation cache for this chapter
        await ReaderTranslationCache.clearChapterTranslations(chapter.id);
        // 2. Clear audio cache for this chapter
        await ReaderAudioCache.clearForChapter(chapter.id).catch(() => {});
        // 3. Clear local states
        setPageOcrData({});
        setPreloadedAudio({});
        localStorage.removeItem(`reader_metaai_conv_${chapter.id}`);
        localStorage.removeItem(`reader_chapter_session_${chapter.id}`);

        // Generate brand new unique session ID for this specific re-translation run
        const freshSessionId = `retrans_${chapter.id}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        // 4. Reset server-side session for this chapter and any old sessions
        await fetch("/api/manga/reset-chapter-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chapterId: chapter.id, sessionId: freshSessionId, engine: "all" }),
        }).catch(() => {});

        // 5. Create completely fresh isolated context
        ctx = ChapterContextManager.createFreshContext({
          chapterId: chapter.id,
          mangaId: mangaId || chapter.id,
          mangaTitle: chapter.mangaTitle || chapter.title || "",
          workType: workType || chapter.workType || "مانهوا كورية",
          provider: translatorEngine,
          targetLang: targetLang.code,
          model: geminiCookieModel,
          sessionId: freshSessionId
        });
      } else {
        // Ensure isolated context is active for this chapter
        ctx = ChapterContextManager.switchActiveChapter({
          chapterId: chapter.id,
          mangaId: mangaId || chapter.id,
          mangaTitle: chapter.mangaTitle || chapter.title || "",
          workType: workType || chapter.workType || "مانهوا كورية",
          provider: translatorEngine,
          targetLang: targetLang.code,
          model: geminiCookieModel,
        });
      }

      // Chapter-isolated session identifier
      const currentSessionId = ctx.sessionId;
      sessionIdRef.current = currentSessionId;

      // Start translation from the page currently visible to the user!
      const startIdx = Math.max(0, Math.min(currentVisiblePage - 1, pages.length - 1));

      // Build concurrent ChapterBatchPipeline:
      // - Background producer prepares OCR on pages without blocking the UI
      // - Collects multiple text regions into batches
      // - Sends entire batch to selected provider in ONE request
      // - Maps results back to original region_id
      // - Unblocks UI as soon as the first batch finishes
      const pipeline = new ChapterBatchPipeline({
        context: ctx,
        pages: pages,
        startIdx: startIdx,
        forceRetranslate: shouldRetranslate,
        ocrFn: async (imgUrl: string, pageIdx: number) => {
          return await ocrPageBlocks(imgUrl, pageIdx, shouldRetranslate, true /* skipTranslation: batch handles translation */);
        },
        onPageUpdated: (pageIdx: number, blocks: OCRBlock[]) => {
          if (!ChapterContextManager.isChapterActive(chapter.id)) return;
          const consolidated = consolidateNearbyBlocks(blocks);
          setPageOcrData((prev) => ({
            ...prev,
            [pageIdx]: consolidated,
          }));

          // Persist to translation cache
          ReaderTranslationCache.savePageTranslation(
            chapter.id,
            pageIdx,
            consolidated,
            translatorEngine,
            targetLang.code
          ).catch(() => {});

          // Auto TTS enqueue
          if (ttsQueueRef.current && !isMuted && consolidated.length > 0) {
            ttsQueueRef.current.enqueuePageBlocks(
              pageIdx,
              consolidated,
              selectedVoiceGroup,
              selectedEdgeVoice,
              voiceDirection,
              playbackSpeed,
              currentVisiblePage - 1
            );
          }

          if (autoColorize) {
            colorizePage(pageIdx, pages[pageIdx]).catch(() => {});
          }

          // Note: Modal stays active until substantial batch of texts is translated across pages!
        },
        onStatusUpdated: (status) => {
          if (!ChapterContextManager.isChapterActive(chapter.id)) return;
          setTranslatingPages(status.translatingPages);
          if (typeof status.translatedTexts === "number") {
            setTranslatedTextCount(status.translatedTexts);
          }
          if (typeof status.completedPages === "number") {
            setCompletedPagesCount(status.completedPages);
          }
          if (status.isSubstantialBatchDone) {
            const isAnyTranslating = Object.values(status.translatingPages).some(Boolean);
            setIsBackgroundTranslating(isAnyTranslating || status.completedPages < status.totalPages);
          }
        },
        onTranslationError: (errorMsg) => {
          if (!ChapterContextManager.isChapterActive(chapter.id)) return;
          setTranslationWarning(errorMsg);
        },
        onSubstantialBatchCompleted: (info) => {
          if (!ChapterContextManager.isChapterActive(chapter.id)) return;
          console.log(`[Reader] Substantial batch translated (${info.translatedTexts} texts). Dismissing modal and continuing in background.`);
          setOcrLoading(false);
          setIsBackgroundTranslating(info.completedPages < info.totalPages);
        },
        onFirstBatchCompleted: (completedPages: number[]) => {
          if (!ChapterContextManager.isChapterActive(chapter.id)) return;
          console.log(`[Reader] First batch progress reported: [${completedPages.join(", ")}]`);
        },
      });

      activePipelineRef.current = pipeline;

      // Launch pipeline in background (producer runs OCR concurrently with batch translation consumer)
      pipeline.start().catch((err) => {
        console.error("[Reader Pipeline] Error running translation pipeline:", err);
      }).finally(() => {
        setOcrLoading(false);
        setIsBackgroundTranslating(false);
      });

    } catch (err: any) {
      console.error("OCR API error:", err);
      alert(err.message || "فشلت الترجمة الذكية بالذكاء الاصطناعي");
      setOcrLoading(false);
    }
  };

  // Active audio playback session tracking to prevent race conditions and delayed playbacks
  const playbackSessionRef = useRef<{
    sessionId: number;
    clickedRegionId: string;
    clickedSpeechUnitId?: string;
    pageIndex: number;
    abortController: AbortController | null;
    timerId: any;
  }>({
    sessionId: 0,
    clickedRegionId: "",
    pageIndex: -1,
    abortController: null,
    timerId: null,
  });

  const stopActiveAudioImmediately = () => {
    // 1. Invalidate current session ID
    playbackSessionRef.current.sessionId++;

    // 2. Clear any pending timeouts
    if (playbackSessionRef.current.timerId) {
      clearTimeout(playbackSessionRef.current.timerId);
      playbackSessionRef.current.timerId = null;
    }

    // 3. Abort in-flight network requests
    if (playbackSessionRef.current.abortController) {
      try {
        playbackSessionRef.current.abortController.abort();
      } catch (_) {}
      playbackSessionRef.current.abortController = null;
    }

    // 4. Detach all callbacks and stop active HTMLAudioElement immediately
    if (activeAudioRef.current) {
      const audio = activeAudioRef.current;
      audio.onended = null;
      audio.onerror = null;
      audio.onpause = null;
      audio.onplay = null;
      audio.ontimeupdate = null;
      try {
        audio.pause();
      } catch (_) {}
      audio.src = "";
      activeAudioRef.current = null;
    }

    setActiveAudio(null);
    setSpeakingKey(null);
    currentSpeakingKeyRef.current = null;
    setIsTtsLoading(false);
  };

  // Centralized region audio player: strictly enforces User Click -> DOM Region -> region_id -> speech_unit_id -> audio
  const playRegionAudio = async (clickedRegionId: string, pageIndex: number) => {
    if (!clickedRegionId) return;

    // Rule 9: Required debugging logging
    console.log(`CLICK region_id=${clickedRegionId}`);

    // Rule 4: Stop currentAudio and cancel old playback immediately
    stopActiveAudioImmediately();

    // Toggle off if currently speaking this exact region
    const speakingTargetKey = `${pageIndex}_${clickedRegionId}`;
    const wasSpeakingThisExactRegion =
      speakingKey === speakingTargetKey ||
      playbackSessionRef.current.clickedRegionId === clickedRegionId;
    if (wasSpeakingThisExactRegion) {
      return;
    }

    // 1. Locate the clicked region directly from page blocks
    const pageBlocks = pageOcrData[pageIndex] || [];
    let clickedBlock = pageBlocks.find(
      (b) => (b.region_id && b.region_id === clickedRegionId) || (b.id && b.id === clickedRegionId)
    );

    if (!clickedBlock) {
      const currentBlocks = Array.isArray(pageOcrData[pageIndex]) ? pageOcrData[pageIndex] : [];
      const consolidated = consolidateNearbyBlocks(currentBlocks);
      clickedBlock = consolidated.find(
        (b) => (b.region_id && b.region_id === clickedRegionId) || (b.id && b.id === clickedRegionId)
      );
    }

    if (!clickedBlock) {
      console.warn(`[TTS] Could not find region with id "${clickedRegionId}" on page ${pageIndex}`);
      return;
    }

    // 2. Resolve speech_unit_id
    const resolvedSpeechUnitId = (clickedBlock as any).speech_unit_id
      ? String((clickedBlock as any).speech_unit_id).trim()
      : undefined;

    console.log(`RESOLVED speech_unit_id=${resolvedSpeechUnitId || "none"}`);

    // 3. Extract text
    const rawText =
      (clickedBlock as any).speech_unit_text ||
      clickedBlock.translatedText ||
      clickedBlock.translated_text ||
      (clickedBlock as any).text ||
      "";

    const cleanText = rawText
      ? rawText
          .replace(/[\n\r]+/g, " ")
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, "")
          .trim()
      : "";

    if (!cleanText) {
      console.warn(`[TTS] No text content for region "${clickedRegionId}"`);
      return;
    }

    // 4. Fresh playback session
    const thisSessionId = ++playbackSessionRef.current.sessionId;
    playbackSessionRef.current.clickedRegionId = clickedRegionId;
    playbackSessionRef.current.clickedSpeechUnitId = resolvedSpeechUnitId;
    playbackSessionRef.current.pageIndex = pageIndex;
    playbackSessionRef.current.abortController = new AbortController();

    setSpeakingKey(speakingTargetKey);
    currentSpeakingKeyRef.current = speakingTargetKey;

    // 5. Verified single playback function (Rule 5 & 7)
    const executeVerifiedPlayback = (
      audioDataUrl: string,
      audioMeta: {
        region_id?: string;
        speech_unit_id?: string;
        region_ids?: string[];
      }
    ) => {
      // Session freshness check
      if (playbackSessionRef.current.sessionId !== thisSessionId) {
        console.log(`[TTS Safety] Discarding stale audio playback from session ${thisSessionId}`);
        return;
      }

      const audioRegionId = audioMeta.region_id || clickedRegionId;
      const audioSpeechUnitId = audioMeta.speech_unit_id;

      // Rule 5: Strict validation before audio.play()
      const isExactRegionMatch =
        audioRegionId === clickedRegionId ||
        (Array.isArray(audioMeta.region_ids) && audioMeta.region_ids.includes(clickedRegionId));

      const isExactUnitMatch = Boolean(
        resolvedSpeechUnitId &&
        audioSpeechUnitId &&
        audioSpeechUnitId === resolvedSpeechUnitId &&
        (!audioMeta.region_ids || audioMeta.region_ids.includes(clickedRegionId))
      );

      if (!isExactRegionMatch && !isExactUnitMatch) {
        console.error(
          `[TTS Verification Failed] Audio mismatch!`,
          `CLICK region_id=${clickedRegionId}`,
          `PLAYING audio region_id=${audioRegionId}`
        );
        stopActiveAudioImmediately();
        return;
      }

      console.log(`REQUESTED audio region_id=${clickedRegionId}`);
      console.log(`PLAYING audio region_id=${audioRegionId}`);

      // Stop any existing audio
      if (activeAudioRef.current) {
        const prev = activeAudioRef.current;
        prev.onended = null;
        prev.onerror = null;
        try { prev.pause(); } catch (_) {}
        prev.src = "";
        activeAudioRef.current = null;
      }

      const audioUrl = audioDataUrl.startsWith("data:")
        ? audioDataUrl
        : audioDataUrl.startsWith("UklGR")
        ? `data:audio/wav;base64,${audioDataUrl}`
        : `data:audio/mp3;base64,${audioDataUrl}`;

      const audio = new Audio(audioUrl);
      (audio as any).region_id = audioRegionId;
      (audio as any).speech_unit_id = audioSpeechUnitId;
      audio.playbackRate = playbackSpeed;

      activeAudioRef.current = audio;
      setActiveAudio(audio);
      setIsTtsLoading(false);

      // Rule 8: When audio finishes, STOP only. Do not trigger queue or advance to next region!
      audio.onended = () => {
        if (playbackSessionRef.current.sessionId === thisSessionId) {
          stopActiveAudioImmediately();
        }
      };

      audio.onerror = (e) => {
        console.error(`[TTS] Audio playback error for region ${clickedRegionId}:`, e);
        if (playbackSessionRef.current.sessionId === thisSessionId) {
          stopActiveAudioImmediately();
        }
      };

      audio.play().catch((playError: any) => {
        if (
          playError?.name !== "AbortError" &&
          playError?.name !== "NotAllowedError" &&
          !playError?.message?.includes("interrupted")
        ) {
          console.error("Audio playback error:", playError);
        }
        if (playbackSessionRef.current.sessionId === thisSessionId) {
          stopActiveAudioImmediately();
        }
      });
    };

    // Cache keys
    const regionCacheKey = ReaderAudioCache.makeKey(
      chapter.id,
      pageIndex,
      clickedRegionId,
      selectedVoiceGroup,
      selectedEdgeVoice,
      cleanText,
      playbackSpeed
    );

    const unitCacheKey = resolvedSpeechUnitId
      ? ReaderAudioCache.makeKey(
          chapter.id,
          pageIndex,
          resolvedSpeechUnitId,
          selectedVoiceGroup,
          selectedEdgeVoice,
          cleanText,
          playbackSpeed
        )
      : null;

    // Check preloaded memory cache first
    const preloadedRegion = preloadedAudio[regionCacheKey];
    if (preloadedRegion) {
      executeVerifiedPlayback(preloadedRegion, { region_id: clickedRegionId, speech_unit_id: resolvedSpeechUnitId });
      return;
    }

    if (unitCacheKey && preloadedAudio[unitCacheKey]) {
      executeVerifiedPlayback(preloadedAudio[unitCacheKey], { region_id: clickedRegionId, speech_unit_id: resolvedSpeechUnitId });
      return;
    }

    // Check persistent IndexedDB cache
    const cachedRecord =
      (await ReaderAudioCache.getRecord(regionCacheKey, {
        expectedRegionId: clickedRegionId,
        expectedSpeechUnitId: resolvedSpeechUnitId,
        expectedVoice: selectedEdgeVoice,
        expectedText: cleanText,
      })) ||
      (unitCacheKey
        ? await ReaderAudioCache.getRecord(unitCacheKey, {
            expectedRegionId: clickedRegionId,
            expectedSpeechUnitId: resolvedSpeechUnitId,
            expectedVoice: selectedEdgeVoice,
            expectedText: cleanText,
          })
        : null);

    if (cachedRecord && cachedRecord.audioData) {
      executeVerifiedPlayback(cachedRecord.audioData, {
        region_id: cachedRecord.region_id || clickedRegionId,
        speech_unit_id: cachedRecord.speech_unit_id || resolvedSpeechUnitId,
        region_ids: cachedRecord.region_ids,
      });
      return;
    }

    // Urgent synthesis without fallback (Rule 6)
    setIsTtsLoading(true);
    try {
      let resolvedAudio: string | null = null;
      let resolvedMeta: { region_id?: string; speech_unit_id?: string; region_ids?: string[] } = {
        region_id: clickedRegionId,
        speech_unit_id: resolvedSpeechUnitId,
      };

      if (ttsQueueRef.current) {
        resolvedAudio = await ttsQueueRef.current.requestUrgentBubble(
          pageIndex,
          clickedRegionId,
          cleanText,
          selectedVoiceGroup,
          selectedEdgeVoice,
          voiceDirection,
          playbackSpeed,
          resolvedSpeechUnitId
        );
      } else {
        const { audioBase64, mimeType } = await synthesizeTTSAudio(
          cleanText,
          selectedEdgeVoice,
          selectedVoiceGroup
        );
        if (audioBase64) {
          resolvedAudio = `data:${mimeType || "audio/mp3"};base64,${audioBase64}`;
          await ReaderAudioCache.set(regionCacheKey, chapter.id, resolvedAudio, {
            pageIndex,
            blockId: clickedRegionId,
            region_id: clickedRegionId,
            speech_unit_id: resolvedSpeechUnitId,
            text: cleanText,
            voiceGroup: selectedVoiceGroup,
            voiceName: selectedEdgeVoice,
            playbackSpeed,
          });
          if (unitCacheKey) {
            await ReaderAudioCache.set(unitCacheKey, chapter.id, resolvedAudio, {
              pageIndex,
              blockId: resolvedSpeechUnitId,
              region_id: clickedRegionId,
              speech_unit_id: resolvedSpeechUnitId,
              text: cleanText,
              voiceGroup: selectedVoiceGroup,
              voiceName: selectedEdgeVoice,
              playbackSpeed,
            });
          }
        }
      }

      // Session check before playback
      if (playbackSessionRef.current.sessionId !== thisSessionId) {
        console.log(`[TTS] Request for region ${clickedRegionId} discarded due to newer session.`);
        return;
      }

      if (resolvedAudio) {
        setPreloadedAudio((prev) => ({
          ...prev,
          [regionCacheKey]: resolvedAudio!,
          ...(unitCacheKey ? { [unitCacheKey]: resolvedAudio! } : {}),
        }));

        executeVerifiedPlayback(resolvedAudio, resolvedMeta);
      } else {
        // Rule 6: NEVER fallback to another audio!
        stopActiveAudioImmediately();
      }
    } catch (err: any) {
      console.error("[TTS] Generation error for region", clickedRegionId, err);
      if (playbackSessionRef.current.sessionId === thisSessionId) {
        stopActiveAudioImmediately();
      }
    } finally {
      if (playbackSessionRef.current.sessionId === thisSessionId) {
        setIsTtsLoading(false);
      }
    }
  };

  // Stable Block TTS Player with strict region_id binding and instant validated caching
  const speakBlock = async (block: OCRBlock, pageIndex: number) => {
    const regionId = String(
      block.region_id || block.id || getStableBlockId(block, 0)
    ).trim();
    return playRegionAudio(regionId, pageIndex);
  };

  // Backwards compatible speakText helper
  const speakText = async (text: string, index: number, pageIndex: number) => {
    const blocks = pageOcrData[pageIndex] || [];
    const block = blocks[index];
    const regionId = block
      ? String(block.region_id || block.id || getStableBlockId(block, index)).trim()
      : `p${pageIndex}_reg_${index + 1}`;
    return playRegionAudio(regionId, pageIndex);
  };

  // Explicit handler for clicking comic page container:
  // Rule 2: Do NOT trigger or guess audio for background clicks. Direct bubble clicks handle playback.
  const handlePageContainerClick = (
    _e: React.MouseEvent<HTMLDivElement>,
    _pageIndex: number,
    _blocks: OCRBlock[]
  ) => {
    // Intentionally empty. Playback is strictly triggered by clicking direct bubbles.
  };

  if (loading) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-slate-400">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
        <p className="font-mono text-sm">جاري تنزيل وتشفير صفحات الفصل...</p>
      </div>
    );
  }

  if (error || pages.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-red-900/30 bg-red-950/10 p-6 text-center text-slate-200" dir="rtl">
        <p className="text-sm text-slate-400">{error || "هذا الفصل فارغ حالياً."}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => fetchPagesRef.current?.()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 transition"
          >
            إعادة المحاولة
          </button>
          <button
            onClick={handleExitReader}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            العودة للمانجا
          </button>
        </div>
      </div>
    );
  }

  const currentPageUrl = pages[currentPageIndex];
  const proxiedPageUrl = toProxiedUrl(currentPageUrl, chapter.isLocal);
  const currentOcrBlocks = pageOcrData[currentPageIndex] || [];

  return (
    <div className="h-full w-full bg-slate-950 text-slate-100 flex flex-col overflow-hidden relative select-none" dir="rtl">
      
      {/* Translation Engine Warning Toast/Banner */}
      {translationWarning && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 max-w-lg w-11/12 rounded-xl border border-amber-500/30 bg-slate-900/95 backdrop-blur-md px-4 py-3 text-amber-200 shadow-2xl flex items-center justify-between gap-3 text-xs md:text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" />
            <span>{translationWarning}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                handleTranslatorEngineChange("google");
                setTranslationWarning(null);
              }}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition"
            >
              استخدام Google
            </button>
            <button
              onClick={() => setTranslationWarning(null)}
              className="text-slate-400 hover:text-white p-1"
              title="إغلاق"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      
      {/* Top Navigation Control Bar (القسم العلوي المتجاوب للهواتف والحواسيب) */}
      <header className={`sticky top-0 z-30 w-full bg-slate-950/95 backdrop-blur-md transition-all duration-300 ${showTopBar ? 'translate-y-0 opacity-100 border-b border-slate-900/80 shadow-md' : '-translate-y-full opacity-0 pointer-events-none border-0'}`}>
        
        {/* Mobile View (< md): Two-Row Comprehensive Responsive Layout with all counters and all buttons */}
        <div className="flex md:hidden flex-col w-full bg-slate-950/95 border-b border-slate-900/80">
          {/* Row 1: Back, Chapter, All Primary Counters, Fullscreen, Options Toggle */}
          <div className="flex items-center justify-between px-2.5 py-1.5 w-full gap-2">
            {/* Back & Chapter Info */}
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={handleExitReader}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 active:scale-95 border border-slate-800 shrink-0 cursor-pointer"
                title="الرجوع إلى القائمة"
              >
                <ArrowLeft className="h-4 w-4 rotate-180" />
              </button>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-mono text-emerald-400 font-bold leading-tight">
                  فصل {chapter.chapter}
                </span>
                <span className="font-display text-xs font-bold text-white truncate max-w-[85px] xs:max-w-[120px] leading-tight">
                  {chapter.title || chapter.mangaTitle || `فصل ${chapter.chapter}`}
                </span>
              </div>
            </div>

            {/* Comprehensive Live Counters (Progress % + Page count + Speed Counter) */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Reading Progress Counter Pill */}
              <div className="flex items-center gap-1 bg-slate-900/90 border border-teal-500/30 rounded-lg px-2 py-1 shadow-sm shrink-0" title={`الصفحة الحالية ${currentVisiblePage} من إجمالي ${pages.length} صفحات`}>
                <span className="font-mono text-[11px] font-bold text-teal-400">
                  {readingProgressPercent}%
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  ({currentVisiblePage}/{pages.length})
                </span>
              </div>

              {/* TTS Playback Speed Counter Button */}
              <button
                onClick={cyclePlaybackSpeed}
                className="flex items-center gap-0.5 bg-slate-900/90 border border-amber-500/30 hover:border-amber-500/50 rounded-lg px-1.5 py-1 shadow-sm shrink-0 active:scale-95 cursor-pointer"
                title={`سرعة القراءة الصوتية: ${playbackSpeed}x (انقر للتبديل السريع بين 1.0x - 2.0x)`}
              >
                <Gauge className="h-3 w-3 text-amber-400" />
                <span className="font-mono text-[10px] font-bold text-amber-300">
                  {playbackSpeed}x
                </span>
              </button>

              {/* Open in Browser Tab */}
              <a
                href={typeof window !== "undefined" ? window.location.href : "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 active:scale-95 cursor-pointer shrink-0"
                title="فتح في لسان جديد بالمتصفح"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>

              {/* Fullscreen Button */}
              <button
                onClick={toggleFullscreen}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 active:scale-95 cursor-pointer shrink-0"
                title={isFullscreen ? "الخروج من ملء الشاشة" : "عرض بملء الشاشة"}
              >
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>

              {/* Advanced Options Drawer Toggle */}
              <button
                onClick={() => setShowMobileSettings(true)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 active:scale-95 cursor-pointer shrink-0"
                title="جميع الإعدادات والخيارات التفصيلية"
              >
                <Sliders className="h-3.5 w-3.5 text-emerald-400" />
              </button>
            </div>
          </div>

          {/* Row 2: All Action Buttons & Selectors in Smooth Horizontal Scroll Bar */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 overflow-x-auto no-scrollbar border-t border-slate-900/60 bg-slate-950/60 w-full shrink-0 text-xs">
            {/* Target Lang Selector */}
            <select
              value={targetLang.code}
              onChange={(e) => {
                const lang = TARGET_LANGUAGES.find((l) => l.code === e.target.value);
                if (lang) {
                  setTargetLang(lang);
                  setPageOcrData((prev) => {
                    const copy = { ...prev };
                    delete copy[currentPageIndex];
                    return copy;
                  });
                }
              }}
              className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none cursor-pointer shrink-0"
              title="لغة الترجمة المستهدفة"
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>

            {/* Translator Engine Selection */}
            <select
              value={translatorEngine === "gemini" ? "gemini_cookies" : translatorEngine}
              onChange={(e) => {
                handleTranslatorEngineChange(e.target.value as "google" | "gemini_cookies" | "metaai");
              }}
              className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none cursor-pointer shrink-0"
              title="محرك الترجمة"
            >
              <option value="gemini_cookies">✨ Gemini كوكيز</option>
              <option value="metaai">🤖 Meta كوكيز</option>
              <option value="google">🌐 جوجل</option>
            </select>

            {/* Model Selector for Gemini Cookies */}
            {(translatorEngine === "gemini_cookies" || translatorEngine === "gemini") && (
              <select
                value={geminiCookieModel}
                onChange={(e) => handleGeminiCookieModelChange(e.target.value)}
                className="rounded-lg border border-emerald-500/40 bg-slate-900 px-2 py-1 text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none cursor-pointer shrink-0 font-medium"
                title="نموذج الذكاء الاصطناعي (Gemini)"
              >
                <option value="3.5-flash-lite-extended">🧠 3.5 Flash-Lite (تفكير موسع - أسرع إجابات وحل المشاكل المعقدة)</option>
                <option value="3.5-flash-lite">⚡ 3.5 Flash-Lite (فائق السرعة)</option>
                <option value="3.6-flash">🌟 3.6 Flash (الموصى به)</option>
                <option value="3.1-pro">🎯 3.1 Pro (للمشاكل المعقدة)</option>
              </select>
            )}

            {/* Core OCR Action Button (ترجمة الفصل) */}
            <button
              onClick={() => runOcrAndTranslate(true)}
              disabled={ocrLoading}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer whitespace-nowrap shrink-0 ${
                Object.keys(pageOcrData).length > 0
                  ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                  : "bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
              }`}
              title="ترجمة جميع صفحات الفصل بالذكاء الاصطناعي (OCR)"
            >
              {ocrLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>يترجم...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  <span>{Object.keys(pageOcrData).length > 0 ? "إعادة الترجمة" : "ترجمة الفصل"}</span>
                </>
              )}
            </button>

            {/* AI Bulk Colorization Button (تلوين الفصل) */}
            <button
              disabled={isBulkColorizing}
              onClick={handleBulkColorize}
              className="flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 px-2 py-1 text-xs font-bold transition active:scale-95 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
              title="تلوين جميع صفحات الفصل بالذكاء الاصطناعي"
            >
              {isBulkColorizing ? (
                <Loader2 className="h-3 w-3 animate-spin text-purple-400" />
              ) : (
                <Palette className="h-3 w-3 text-purple-400" />
              )}
              <span>تلوين (AI)</span>
            </button>

            {/* Toggle Original / Colorized View */}
            {Object.keys(colorizedPages).length > 0 && (
              <button
                onClick={toggleColorizedView}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 ${
                  showColorized
                    ? "border-purple-500/40 bg-purple-500/20 text-purple-300"
                    : "border-slate-800 bg-slate-900 text-slate-400"
                }`}
                title={showColorized ? "التبديل إلى النسخة الأصلية بالأبيض والأسود" : "التبديل إلى النسخة الملونة"}
              >
                <Palette className="h-3 w-3 text-purple-400" />
                <span>{showColorized ? "عرض الأصل" : "عرض الملونة"}</span>
              </button>
            )}

            {/* Show / Hide Overlays Toggle Button */}
            <button
              onClick={() => setShowOverlays(!showOverlays)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 ${
                showOverlays
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-800 bg-slate-900 text-slate-400"
              }`}
              title={showOverlays ? "إخفاء فقاعات الترجمة" : "إظهار فقاعات الترجمة"}
            >
              {showOverlays ? <Eye className="h-3 w-3 text-emerald-400" /> : <EyeOff className="h-3 w-3" />}
              <span>{showOverlays ? "النصوص ظاهرة" : "النصوص مخفية"}</span>
            </button>

            {/* Toggle White Layer / Transparency (الطبقة البيضاء / الشفافة) */}
            <button
              onClick={() => setHideBackground(!hideBackground)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 ${
                hideBackground
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                  : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700"
              }`}
              title={hideBackground ? "الطبقة البيضاء مخفية (خلفية شفافة) - انقر لإظهارها" : "الطبقة البيضاء ظاهرة - انقر لإخفائها"}
            >
              <Layers className={`h-3 w-3 ${hideBackground ? "text-amber-400" : "text-slate-400"}`} />
              <span>{hideBackground ? "شفافية مفعّلة" : "إخفاء الطبقة البيضاء"}</span>
            </button>

            {/* Bubble Font Size Adjuster (التحكم في حجم خط الفقاعات) */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-0.5 shrink-0" title="تصغير وتكبير خط الفقاعات بدقة">
              <button
                onClick={() => setFontScale((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))}
                className="text-slate-300 hover:text-emerald-400 px-1 py-0.5 text-xs font-black active:scale-95 transition cursor-pointer"
                title="تصغير حجم خط الترجمة"
              >
                A-
              </button>
              <span className="text-[10px] font-mono text-emerald-400 min-w-[34px] text-center font-bold">
                {Math.round(fontScale * 100)}%
              </span>
              <button
                onClick={() => setFontScale((prev) => Math.min(1.3, Number((prev + 0.1).toFixed(2))))}
                className="text-slate-300 hover:text-emerald-400 px-1 py-0.5 text-xs font-black active:scale-95 transition cursor-pointer"
                title="تكبير حجم خط الترجمة"
              >
                A+
              </button>
            </div>

            {/* TTS Mute / Unmute Toggle Button */}
            <button
              onClick={() => {
                if (isMuted) {
                  setIsMuted(false);
                } else {
                  setIsMuted(true);
                  if (activeAudioRef.current) {
                    activeAudioRef.current.pause();
                    activeAudioRef.current = null;
                  }
                  setActiveAudio(null);
                  setSpeakingKey(null);
                  currentSpeakingKeyRef.current = null;
                }
              }}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 ${
                isMuted
                  ? "border-rose-500/30 bg-rose-950/20 text-rose-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              }`}
              title={isMuted ? "الصوت معطّل (انقر للتشغيل)" : "الصوت مفعّل (انقر للكتم)"}
            >
              {isMuted ? <VolumeX className="h-3 w-3 text-rose-400" /> : <Volume2 className="h-3 w-3 text-emerald-400" />}
              <span>{isMuted ? "صامت" : "ناطق"}</span>
            </button>

            {/* View Mode Toggle Button */}
            <button
              onClick={() => {
                const next = viewMode === "fit-width" ? "fit-height" : "fit-width";
                setViewMode(next);
                localStorage.setItem("reader_view_mode", next);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-300 active:scale-95 cursor-pointer whitespace-nowrap shrink-0"
              title="تبديل نمط العرض بين طولي وكامل"
            >
              <span className="font-mono text-[10px] text-emerald-400">
                {viewMode === "fit-width" ? "طولي" : "كامل"}
              </span>
            </button>
          </div>
        </div>

        {/* Desktop View (>= md): Full Suite of Navigation & Quick Action Controls */}
        <div className="hidden md:flex items-center justify-between px-4 py-2.5 w-full gap-2">
          
          {/* Back & Chapter Metadata */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleExitReader}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white transition active:scale-95 cursor-pointer shrink-0 border border-slate-800/80"
              title="الرجوع إلى القائمة"
            >
              <ArrowLeft className="h-5 w-5 rotate-180" />
            </button>
            <div className="flex flex-col">
              <h4 className="text-xs font-mono text-emerald-400 font-bold">الفصل {chapter.chapter}</h4>
              <span className="font-display text-sm font-bold text-white line-clamp-1 max-w-[200px] lg:max-w-xs">
                {chapter.title || chapter.mangaTitle || `فصل ${chapter.chapter}`}
              </span>
            </div>
          </div>

          {/* Live Chapter Reading Progress Indicator & Counters */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-900/90 border border-teal-500/20 rounded-xl px-3 py-1 shadow-sm shrink-0">
              <div className="flex flex-col items-end">
                <span className="font-mono text-xs font-bold text-teal-400">
                  {readingProgressPercent}% من 100
                </span>
                <span className="font-mono text-[9px] text-slate-400">
                  صفحة {currentVisiblePage} من {pages.length}
                </span>
              </div>
            </div>

            {/* TTS Speed Counter Button for Desktop */}
            <button
              onClick={cyclePlaybackSpeed}
              className="flex items-center gap-1.5 bg-slate-900/90 border border-amber-500/30 hover:border-amber-500/60 rounded-xl px-2.5 py-1.5 shadow-sm shrink-0 active:scale-95 cursor-pointer text-amber-300"
              title={`سرعة الصوت: ${playbackSpeed}x (انقر للتبديل السريع بين 1.0x و 2.0x)`}
            >
              <Gauge className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-mono text-xs font-bold">{playbackSpeed}x</span>
            </button>
          </div>

          {/* Complete Suite of Quick Buttons & Features */}
          <div className="flex items-center gap-2">
            
            {/* Target Lang Selector */}
            <select
              value={targetLang.code}
              onChange={(e) => {
                const lang = TARGET_LANGUAGES.find((l) => l.code === e.target.value);
                if (lang) {
                  setTargetLang(lang);
                  setPageOcrData((prev) => {
                    const copy = { ...prev };
                    delete copy[currentPageIndex];
                    return copy;
                  });
                }
              }}
              className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none cursor-pointer"
              title="لغة الترجمة المستهدفة"
            >
              {TARGET_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>

            {/* Translator Engine Selection */}
            <select
              value={translatorEngine === "gemini" ? "gemini_cookies" : translatorEngine}
              onChange={(e) => {
                handleTranslatorEngineChange(e.target.value as "google" | "gemini_cookies" | "metaai");
              }}
              className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none cursor-pointer"
              title="محرك الترجمة"
            >
              <option value="gemini_cookies">✨ Gemini كوكيز</option>
              <option value="metaai">🤖 Meta كوكيز</option>
              <option value="google">🌐 مترجم جوجل</option>
            </select>

            {/* Model Selector for Gemini Cookies */}
            {(translatorEngine === "gemini_cookies" || translatorEngine === "gemini") && (
              <select
                value={geminiCookieModel}
                onChange={(e) => handleGeminiCookieModelChange(e.target.value)}
                className="rounded-lg border border-emerald-500/40 bg-slate-900 px-2 py-1.5 text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none cursor-pointer shrink-0 font-medium"
                title="نموذج الذكاء الاصطناعي (Gemini)"
              >
                <option value="3.5-flash-lite-extended">🧠 3.5 Flash-Lite (تفكير موسع)</option>
                <option value="3.5-flash-lite">⚡ 3.5 Flash-Lite (فائق السرعة)</option>
                <option value="3.6-flash">🌟 3.6 Flash (الموصى به)</option>
                <option value="3.1-pro">🎯 3.1 Pro (للمشاكل المعقدة)</option>
              </select>
            )}

            {/* Core OCR Action Button (ترجمة الفصل بأكمله) */}
            <button
              onClick={() => runOcrAndTranslate(true)}
              disabled={ocrLoading}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer ${
                Object.keys(pageOcrData).length > 0
                  ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
                  : "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/10 hover:opacity-95"
              }`}
              title="ترجمة جميع صفحات الفصل بالذكاء الاصطناعي (OCR)"
            >
              {ocrLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="hidden sm:inline">جاري الترجمة...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    {Object.keys(pageOcrData).length > 0 ? "إعادة الترجمة" : "ترجمة الفصل"}
                  </span>
                </>
              )}
            </button>

            {/* AI Bulk Colorization Button (تلوين الفصل بالكامل) */}
            <button
              disabled={isBulkColorizing}
              onClick={handleBulkColorize}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 px-2.5 py-1.5 text-xs font-bold transition active:scale-95 cursor-pointer disabled:opacity-50"
              title="تلوين جميع صفحات الفصل بالذكاء الاصطناعي"
            >
              {isBulkColorizing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
                  <span className="hidden md:inline">جاري التلوين...</span>
                </>
              ) : (
                <>
                  <Palette className="h-3.5 w-3.5 text-purple-400" />
                  <span className="hidden sm:inline">تلوين الفصل (AI)</span>
                </>
              )}
            </button>

            {/* Show / Hide Overlays Toggle Button (إظهار/إخفاء نصوص الترجمة) */}
            <button
              onClick={() => setShowOverlays(!showOverlays)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition active:scale-95 cursor-pointer ${
                showOverlays 
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" 
                  : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
              title={showOverlays ? "إخفاء فقاعات الترجمة" : "إظهار فقاعات الترجمة"}
            >
              {showOverlays ? <Eye className="h-3.5 w-3.5 text-emerald-400" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span className="hidden lg:inline">{showOverlays ? "الترجمة مفعّلة" : "الترجمة مخفية"}</span>
            </button>

            {/* Toggle White Layer / Transparency (إخفاء / إظهار الطبقة البيضاء) */}
            <button
              onClick={() => setHideBackground(!hideBackground)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition active:scale-95 cursor-pointer ${
                hideBackground 
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25" 
                  : "border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700"
              }`}
              title={hideBackground ? "الطبقة البيضاء مخفية (خلفية شفافة) - انقر لإظهارها" : "الطبقة البيضاء ظاهرة - انقر لإخفائها (شفافية كاملة)"}
            >
              <Layers className={`h-3.5 w-3.5 ${hideBackground ? "text-amber-400" : "text-slate-400"}`} />
              <span className="hidden lg:inline">{hideBackground ? "الطبقة البيضاء: مخفية" : "إخفاء الطبقة البيضاء"}</span>
            </button>

            {/* Bubble Font Size Adjuster for Mobile Bar */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 shrink-0" title="تصغير وتكبير خط الفقاعات بدقة">
              <button
                onClick={() => setFontScale((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))}
                className="text-slate-300 hover:text-emerald-400 px-1 py-0.5 text-xs font-black active:scale-95 transition cursor-pointer"
                title="تصغير حجم خط الترجمة"
              >
                A-
              </button>
              <span className="text-[10px] font-mono text-emerald-400 min-w-[34px] text-center font-bold">
                {Math.round(fontScale * 100)}%
              </span>
              <button
                onClick={() => setFontScale((prev) => Math.min(1.3, Number((prev + 0.1).toFixed(2))))}
                className="text-slate-300 hover:text-emerald-400 px-1 py-0.5 text-xs font-black active:scale-95 transition cursor-pointer"
                title="تكبير حجم خط الترجمة"
              >
                A+
              </button>
            </div>

            {/* Computer Vision Inspector Toggle (فاحص الرؤية والفقاعات) */}
            <button
              onClick={() => setShowVisionInspector(!showVisionInspector)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition active:scale-95 cursor-pointer ${
                showVisionInspector 
                  ? "border-amber-500 bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/50 shadow-sm" 
                  : "border-slate-800 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-700"
              }`}
              title="فاحص الرؤية الحاسوبية: إظهار حدود النص (Text Box)، محيط الفقاعة (Bubble Mask)، ومنطقة الترجمة الآمنة (Safe Area) ونسبة الثقة"
            >
              <ScanEye className={`h-3.5 w-3.5 ${showVisionInspector ? "text-amber-400 animate-pulse" : "text-slate-400"}`} />
              <span className="hidden lg:inline">{showVisionInspector ? "فاحص الرؤية: مفعّل" : "فاحص الرؤية (CV)"}</span>
            </button>

            {/* TTS Mute / Unmute Toggle Button (القارئ الصوتي الناطق) */}
            <button
              onClick={() => {
                if (isMuted) {
                  setIsMuted(false);
                } else {
                  setIsMuted(true);
                  if (activeAudioRef.current) {
                    activeAudioRef.current.pause();
                    activeAudioRef.current = null;
                  }
                  setActiveAudio(null);
                  setSpeakingKey(null);
                  currentSpeakingKeyRef.current = null;
                }
              }}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition active:scale-95 cursor-pointer ${
                isMuted
                  ? "border-rose-500/30 bg-rose-950/20 text-rose-300 hover:bg-rose-950/30"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              }`}
              title={isMuted ? "الصوت معطّل (انقر للتشغيل)" : "الصوت مفعّل (انقر للكتم)"}
            >
              {isMuted ? <VolumeX className="h-3.5 w-3.5 text-rose-400" /> : <Volume2 className="h-3.5 w-3.5 text-emerald-400" />}
              <span className="hidden lg:inline">{isMuted ? "صامت" : "ناطق"}</span>
            </button>

            {/* View Mode Toggle (طريقة عرض الصفحة) */}
            <button
              onClick={() => {
                const next = viewMode === "fit-width" ? "fit-height" : "fit-width";
                setViewMode(next);
                localStorage.setItem("reader_view_mode", next);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 px-2 py-1.5 text-xs text-slate-300 hover:text-white transition active:scale-95 cursor-pointer"
              title="تبديل نمط عرض الصفحة بين ملء العرض (طولي) وملء الارتفاع"
            >
              <span className="font-mono text-[10px] text-emerald-400">
                {viewMode === "fit-width" ? "طولي" : "كامل"}
              </span>
            </button>

            {/* Fullscreen Toggle Button (ملء الشاشة) */}
            <button
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition active:scale-95 cursor-pointer shrink-0"
              title={isFullscreen ? "الخروج من ملء الشاشة" : "عرض بملء الشاشة الكامل"}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>

            {/* Advanced Tools & Features Panel Toggle Button (زر لوحة الخيارات والأدوات الشاملة) */}
            <button
              onClick={() => {
                setShowTopOptions((prev) => {
                  const next = !prev;
                  localStorage.setItem("reader_show_top_options", String(next));
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition active:scale-95 cursor-pointer ${
                showTopOptions
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50"
                  : "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
              title="فتح أو إغلاق شريط الخيارات والأدوات المتقدمة في القسم العلوي"
            >
              <Sliders className="h-3.5 w-3.5 text-emerald-400" />
              <span className="hidden sm:inline">خيارات وأدوات القارئ</span>
              {showTopOptions ? <ChevronUp className="h-3.5 w-3.5 text-emerald-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
            </button>

          </div>

        </div>

        {/* Row 2: Collapsible Comprehensive Features & Tools Panel for Desktop */}
        {showTopOptions && (
          <div className="hidden md:block w-full border-t border-slate-900/90 bg-slate-950/98 px-3 sm:px-4 py-3 shadow-2xl transition-all animate-fadeIn">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs text-slate-300 max-w-7xl mx-auto">
              
              {/* 1. Work Type (نوع العمل) */}
              <div className="flex flex-col gap-1.5 bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <span className="font-bold text-emerald-400 text-[11px] flex items-center gap-1">
                  <span>نوع العمل (التخصص الثقافي):</span>
                </span>
                <select
                  value={workType}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWorkType(val);
                    localStorage.setItem("last_selected_work_type", val);
                  }}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer font-medium"
                >
                  <option value="مانهوا كورية">🇰🇷 مانهوا كورية</option>
                  <option value="مانها صينية">🇨🇳 مانها صينية</option>
                  <option value="مانجا يابانية">🇯🇵 مانجا يابانية</option>
                  <option value="ويب تون عالمي">🌐 ويب تون عالمي</option>
                  <option value="كوميكس غربي">🇺🇸 كوميكس غربي</option>
                  {workType !== "مانهوا كورية" && workType !== "مانها صينية" && workType !== "مانجا يابانية" && workType !== "ويب تون عالمي" && workType !== "كوميكس غربي" && (
                    <option value={workType}>✍️ {workType}</option>
                  )}
                </select>
              </div>

              {/* 2. Work Name (اسم العمل) */}
              <div className="flex flex-col gap-1 bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <span className="font-bold text-emerald-400 text-[11px]">اسم العمل (لتحسين سياق الذكاء الاصطناعي):</span>
                <input
                  type="text"
                  placeholder="اكتب اسم العمل أو عنوان المانغا..."
                  value={workName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWorkName(val);
                    localStorage.setItem("reader_work_name", val);
                  }}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none placeholder-slate-600"
                />
                <label className="flex items-center gap-1.5 mt-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeWorkName}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setIncludeWorkName(val);
                      localStorage.setItem("reader_include_work_name", String(val));
                    }}
                    className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 h-3.5 w-3.5"
                  />
                  <span className="text-[10px] text-slate-400">إضافة اسم العمل للبرومبت</span>
                </label>
              </div>

              {/* 3. Voice Engine Group (محرك الصوت) */}
              <div className="flex flex-col gap-1.5 bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <span className="font-bold text-emerald-400 text-[11px] flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  <span>محرك القارئ الصوتي (TTS):</span>
                </span>
                <select
                  value={selectedVoiceGroup}
                  onChange={(e) => handleVoiceGroupChange(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer"
                >
                  <option value="gemini">✨ أصوات Gemini TTS الرسمية (Google Cloud Demo & Gemgen)</option>
                  <option value="capcut">🎙️ أصوات CapCut العربية (طبيعية ودافئة)</option>
                  <option value="current">⚡ أصوات Edge Neural (مجانية فورية وسريعة)</option>
                  <option value="chatgpt">🍃 أصوات ChatGPT Multimodal (فائقة الواقعية)</option>
                  <option value="huggingface">🎭 أصوات Nabra-82M (تشكيل تلقائي ونطق فخم)</option>
                </select>
              </div>

              {/* 4. Voice Selection & Test (المعلق الصوتي وتجربة الصوت) */}
              <div className="flex flex-col gap-1 bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-400 text-[11px]">المعلق الصوتي:</span>
                  <span className="text-[10px] text-slate-400">السرعة: {playbackSpeed}x</span>
                </div>
                {selectedVoiceGroup === "current" ? (
                  <div className="mt-1">
                    <MicrosoftVoicePicker
                      selectedVoice={selectedEdgeVoice}
                      onSelectVoice={(vId) => handleVoiceChange(vId)}
                      compact={true}
                      label="أصوات Microsoft (جميع اللغات واللهجات ديناميكيًا):"
                    />
                  </div>
                ) : (
                  <select
                    value={selectedEdgeVoice}
                    onChange={(e) => handleVoiceChange(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer"
                  >
                    {selectedVoiceGroup === "gemini" ? (
                      <optgroup label="أصوات Gemini الرسمية (Google Demo 30 Voice)">
                        {GEMINI_VOICES.map((v) => (
                          <option key={v.name} value={v.name}>
                            {v.name} ({v.gender === "Male" ? "ذكر ♂️" : "أنثى ♀️"} • {v.traits[0]})
                          </option>
                        ))}
                      </optgroup>
                    ) : selectedVoiceGroup === "capcut" ? (
                      CAPCUT_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))
                    ) : selectedVoiceGroup === "huggingface" ? (
                      <optgroup label="نبرة Nabra-82M - العربي الفخم مع التشكيل التلقائي">
                        <option value="nabra-arabic">صوت نبرة العربي الفخم (Nabra-82M Auto-Tashkeel 🎙️)</option>
                      </optgroup>
                    ) : (
                      CHATGPT_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))
                    )}
                  </select>
                )}
                
                {/* Manual Speed Control from 1.0 to 2.0 */}
                <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                      <Gauge className="h-3 w-3 text-emerald-400" />
                      سرعة الصوت (1.0 إلى 2.0):
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updatePlaybackSpeed(playbackSpeed - 0.1)}
                        disabled={playbackSpeed <= 1.0}
                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 text-[10px] font-bold"
                        title="إنقاص"
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </button>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min="1.0"
                          max="2.0"
                          step="0.05"
                          value={playbackSpeed}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) updatePlaybackSpeed(val);
                          }}
                          className="w-12 h-6 text-center font-bold text-[11px] bg-slate-950 border border-emerald-500/50 rounded text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-[9px] text-emerald-500 font-bold -mr-3 pointer-events-none select-none">x</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => updatePlaybackSpeed(playbackSpeed + 0.1)}
                        disabled={playbackSpeed >= 2.0}
                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 text-[10px] font-bold"
                        title="زيادة"
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </div>

                  {/* Slider */}
                  <input
                    type="range"
                    min="1.0"
                    max="2.0"
                    step="0.05"
                    value={playbackSpeed}
                    onChange={(e) => updatePlaybackSpeed(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 h-1 bg-slate-800 rounded cursor-pointer"
                  />

                  {/* Speed presets */}
                  <div className="flex items-center gap-1 mt-0.5">
                    {[1.0, 1.25, 1.5, 1.75, 2.0].map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => updatePlaybackSpeed(spd)}
                        className={`flex-1 py-0.5 rounded text-center text-[9px] font-bold transition ${
                          playbackSpeed === spd
                            ? "bg-emerald-500 text-slate-950"
                            : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleTestVoice}
                    disabled={isTtsLoading}
                    className="w-full flex items-center justify-center gap-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 py-1.5 mt-1 transition text-[11px] font-bold active:scale-95 cursor-pointer"
                  >
                    {isTtsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    <span>تجربة الصوت ({playbackSpeed}x)</span>
                  </button>
                </div>
              </div>

              {/* 5. Customization & Display (تخصيص الفقاعات والعرض) */}
              <div className="flex flex-col gap-1.5 bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <span className="font-bold text-emerald-400 text-[11px]">لون خط نصوص الترجمة:</span>
                <div className="flex items-center gap-2">
                  {[
                    { hex: "#000000", label: "أسود", text: "bg-black border-white" },
                    { hex: "#ffffff", label: "أبيض", text: "bg-white border-slate-800" },
                    { hex: "#ef4444", label: "أحمر", text: "bg-red-500 border-red-300" },
                    { hex: "#10b981", label: "أخضر", text: "bg-emerald-500 border-emerald-300" },
                    { hex: "#3b82f6", label: "أزرق", text: "bg-blue-500 border-blue-300" },
                    { hex: "#f59e0b", label: "ذهبي", text: "bg-amber-500 border-amber-300" },
                  ].map((color) => (
                    <button
                      key={color.hex}
                      onClick={() => setFontColor(color.hex)}
                      title={color.label}
                      className={`h-5 w-5 rounded-full border transition-transform ${color.text} ${
                        fontColor === color.hex ? "scale-125 ring-2 ring-emerald-500" : "opacity-75 hover:opacity-100 hover:scale-110"
                      }`}
                    />
                  ))}
                </div>
                <button
                  onClick={() => setHideBackground(!hideBackground)}
                  className="flex items-center justify-between w-full mt-1 rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-[10px] text-slate-300 hover:bg-slate-900 transition"
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3 w-3 text-amber-400" />
                    إخفاء الطبقة البيضاء (خلفية شفافة):
                  </span>
                  <span className={`font-bold ${hideBackground ? "text-emerald-400" : "text-slate-500"}`}>
                    {hideBackground ? "مفعّل (مخفية)" : "معطّل (ظاهرة)"}
                  </span>
                </button>

                <button
                  onClick={() => setShowVisionInspector(!showVisionInspector)}
                  className="flex items-center justify-between w-full mt-1.5 rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-[10px] text-slate-300 hover:bg-slate-900 transition"
                >
                  <span className="flex items-center gap-1.5">
                    <ScanEye className="h-3 w-3 text-amber-400" />
                    فاحص الرؤية الحاسوبية (CV Inspector):
                  </span>
                  <span className={`font-bold ${showVisionInspector ? "text-amber-400" : "text-slate-500"}`}>
                    {showVisionInspector ? "مفعّل (ظاهر)" : "معطّل"}
                  </span>
                </button>
              </div>

              {/* 6. Page Controls & Preferences (تفضيلات الصفحات) */}
              <div className="flex flex-col gap-1.5 bg-slate-900/70 p-2.5 rounded-xl border border-slate-800/80">
                <span className="font-bold text-emerald-400 text-[11px]">خيارات الصفحات والتلوين:</span>
                <button
                  onClick={() => {
                    setHideColorizeButtons((prev) => {
                      const newVal = !prev;
                      localStorage.setItem("reader_hide_colorize_buttons", String(newVal));
                      return newVal;
                    });
                  }}
                  className="flex items-center justify-between w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-900 transition"
                >
                  <span className="flex items-center gap-1.5">
                    {hideColorizeButtons ? <EyeOff className="h-3.5 w-3.5 text-amber-400" /> : <Eye className="h-3.5 w-3.5 text-emerald-400" />}
                    إخفاء زر التلوين بالصفحات
                  </span>
                  {hideColorizeButtons && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </button>

                <button
                  onClick={() => {
                    setAutoColorize((prev) => {
                      const newVal = !prev;
                      localStorage.setItem("reader_auto_colorize", String(newVal));
                      return newVal;
                    });
                  }}
                  className="flex items-center justify-between w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-900 transition"
                >
                  <span className="flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5 text-purple-400" />
                    تلوين تلقائي عند التمرير
                  </span>
                  {autoColorize && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </button>
              </div>

            </div>
          </div>
        )}

      </header>

      {/* Main Manga Layout Area */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative border-0">
        
        {/* Desktop Sidebar Settings Drawer */}
        <div className="hidden md:flex flex-col w-60 shrink-0 bg-slate-900/40 border-l border-slate-900/60 p-4 gap-4 overflow-y-auto text-xs text-slate-300 select-none">
          
          <div className="flex flex-col gap-1 w-full hidden md:flex">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">الخيارات والتحكم</span>
            <div className="h-[1px] bg-slate-800 w-full my-1" />
          </div>

          {/* AI Colorization Button (Bulk/Settings) */}
          <div className="flex flex-col gap-1.5 w-full">
            <button
              disabled={isBulkColorizing}
              onClick={handleBulkColorize}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBulkColorizing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التلوين الشامل...
                </>
              ) : (
                <>
                  <Palette className="h-4 w-4" />
                  تلوين الفصل بالكامل (AI)
                </>
              )}
            </button>
            <button
              onClick={() => {
                setHideColorizeButtons(prev => {
                  const newVal = !prev;
                  localStorage.setItem("reader_hide_colorize_buttons", String(newVal));
                  return newVal;
                });
              }}
              className="flex items-center justify-between w-full rounded-lg border border-slate-700 bg-slate-800/50 px-2 py-2 text-xs text-slate-300 hover:bg-slate-700 transition"
            >
              <div className="flex items-center gap-2">
                {hideColorizeButtons ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                إخفاء زر التلوين بالصفحات
              </div>
              {hideColorizeButtons && <Check className="h-4 w-4 text-emerald-400" />}
            </button>
          </div>

          {/* Work Type (نوع العمل) Selector */}
          <div className="flex flex-col gap-1.5 w-full">
            <span className="font-bold text-emerald-400">نوع العمل (التخصص الثقافي):</span>
            <select
              value={workType}
              onChange={(e) => {
                const val = e.target.value;
                setWorkType(val);
                localStorage.setItem("last_selected_work_type", val);
              }}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer font-medium"
            >
              <option value="مانهوا كورية">🇰🇷 مانهوا كورية</option>
              <option value="مانها صينية">🇨🇳 مانها صينية</option>
              <option value="مانجا يابانية">🇯🇵 مانجا يابانية</option>
              {workType !== "مانهوا كورية" && workType !== "مانها صينية" && workType !== "مانجا يابانية" && (
                <option value={workType}>✍️ {workType}</option>
              )}
            </select>
          </div>

          {/* Work Name (اسم العمل) Input */}
          <div className="flex flex-col gap-1.5 w-full">
            <span className="font-bold text-emerald-400">اسم العمل (لتحسين الترجمة):</span>
            <input
              type="text"
              placeholder="اكتب اسم العمل أو عنوان المانغا..."
              value={workName}
              onChange={(e) => {
                const val = e.target.value;
                setWorkName(val);
                localStorage.setItem("reader_work_name", val);
              }}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none placeholder-slate-600"
            />
            <label className="flex items-center gap-2 mt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={includeWorkName}
                onChange={(e) => {
                  const val = e.target.checked;
                  setIncludeWorkName(val);
                  localStorage.setItem("reader_include_work_name", String(val));
                }}
                className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
              />
              <span className="text-[11px] text-slate-400">إضافة اسم العمل للبرومبت</span>
            </label>
          </div>

          {/* Visibility Toggle */}
          <div className="flex items-center justify-between gap-4 w-full">
            <span>عرض الترجمة:</span>
            <button
              dir="ltr"
              onClick={() => setShowOverlays(!showOverlays)}
              className={`flex h-7 w-12 items-center rounded-full p-1 transition duration-200 focus:outline-none ${
                showOverlays ? "bg-emerald-500" : "bg-slate-700"
              }`}
            >
              <div
                className={`h-5 w-5 rounded-full bg-white shadow-md transform transition duration-200 ${
                  showOverlays ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* View Mode Selector */}
          <div className="flex flex-col gap-1.5 w-full">
            <span>طريقة عرض الصفحة:</span>
            <div className="grid grid-cols-2 gap-1 bg-slate-950 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setViewMode("fit-width");
                  localStorage.setItem("reader_view_mode", "fit-width");
                }}
                className={`rounded py-1 text-[10px] font-bold transition ${
                  viewMode === "fit-width" ? "bg-slate-800 text-emerald-400 font-extrabold" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                طولي (ملء العرض)
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("fit-height");
                  localStorage.setItem("reader_view_mode", "fit-height");
                }}
                className={`rounded py-1 text-[10px] font-bold transition ${
                  viewMode === "fit-height" ? "bg-slate-800 text-emerald-400 font-extrabold" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                كاملة (الارتفاع)
              </button>
            </div>
          </div>

          {/* Speech Synthesis Mute */}
          <div className="flex items-center justify-between gap-4 w-full">
            <span>قارئ ناطق (TTS):</span>
            <button
              onClick={() => {
                setIsMuted(!isMuted);
                if (activeAudioRef.current) {
                  activeAudioRef.current.pause();
                  activeAudioRef.current = null;
                }
                setSpeakingKey(null);
                currentSpeakingKeyRef.current = null;
              }}
              className={`p-1.5 rounded-lg border transition ${
                isMuted 
                  ? "border-red-950 bg-red-500/10 text-red-400" 
                  : "border-emerald-950 bg-emerald-500/10 text-emerald-400"
              }`}
              title={isMuted ? "تم كتم الصوت" : "تشغيل الصوت التلقائي"}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>

          {/* Premium Microsoft Edge Neural TTS Voice Selector */}
          {!isMuted && (
            <div className="flex flex-col gap-2 w-full text-right animate-fadeIn">
              <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                <Sparkles className="h-3 w-3 text-emerald-400 animate-pulse" />
                مجموعة الأصوات:
              </span>
              <select
                value={selectedVoiceGroup}
                onChange={(e) => handleVoiceGroupChange(e.target.value as any)}
                className="w-full mt-1 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-slate-300 focus:border-emerald-500 focus:outline-none cursor-pointer hover:border-slate-700 transition"
              >
                <option value="gemini">أصوات Gemini TTS الرسمية (Google Demo & Gemgen 🌟)</option>
                <option value="capcut">أصوات مشروع CapCut-TTS (ذكاء اصطناعي طبيعي جداً)</option>
                <option value="chatgpt">أصوات ChatGPT Multimodal TTS (فائقة الواقعية والذكاء 🍃)</option>
                <option value="huggingface">أصوات Nabra-82M العربية الفخمة (تشكيل تلقائي ونطق بشري 🎙️)</option>
                <option value="current">الأصوات الحالية الموجودة في المشروع</option>
              </select>

              <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium mt-1">
                <Volume2 className="h-3 w-3 text-emerald-400" />
                الصوت المترجم الذكي:
              </span>
              {selectedVoiceGroup === "current" ? (
                <div className="mt-1">
                  <MicrosoftVoicePicker
                    selectedVoice={selectedEdgeVoice}
                    onSelectVoice={(vId) => handleVoiceChange(vId)}
                    compact={true}
                    label="أصوات Microsoft (جميع اللغات واللهجات المتاحة):"
                  />
                </div>
              ) : (
                <select
                  value={selectedEdgeVoice}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-slate-300 focus:border-emerald-500 focus:outline-none cursor-pointer hover:border-slate-700 transition"
                >
                  {selectedVoiceGroup === "gemini" ? (
                    <optgroup label="أصوات Gemini الرسمية (Google Demo)">
                      {GEMINI_VOICES.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name} ({v.gender === "Male" ? "ذكر ♂️" : "أنثى ♀️"} • {v.traits[0]})
                        </option>
                      ))}
                    </optgroup>
                  ) : selectedVoiceGroup === "capcut" ? (
                    CAPCUT_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))
                  ) : selectedVoiceGroup === "huggingface" ? (
                    <optgroup label="نبرة Nabra-82M - العربي الفخم مع التشكيل التلقائي">
                      <option value="nabra-arabic">صوت نبرة العربي الفخم (Nabra-82M Auto-Tashkeel 🎙️)</option>
                    </optgroup>
                  ) : (
                    CHATGPT_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))
                  )}
                </select>
              )}

              {selectedVoiceGroup === "huggingface" && (
                <div className="mt-2 p-2 bg-slate-900/90 border border-emerald-500/30 rounded-lg flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-emerald-400">🔑 توكن Hugging Face (لتجاوز الحصة):</span>
                    <a 
                      href="https://huggingface.co/settings/tokens" 
                      target="_blank" 
                      rel="noreferrer"
                      className="text-[9px] text-cyan-400 hover:underline"
                    >
                      الحصول على توكن مجاني ↗
                    </a>
                  </div>
                  <input
                    type="password"
                    placeholder="hf_xxxxxxxxxxxxxxxxxxxx"
                    value={hfToken}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      setHfToken(val);
                      localStorage.setItem("reader_hf_token", val);
                    }}
                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-[10px] text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="text-[9px] text-slate-400 leading-tight">
                    * سبيس Nabra-82M يعمل على معالجات ZeroGPU. عند تجاوز الحصة المجانية المؤقتة، يمكنك وضع توكن Hugging Face الخاص بك هنا لزيادة الحصة أو سيتولى النظام التبديل التلقائي السلس إلى الصوت البديل دون انقطاع.
                  </p>
                </div>
              )}


              
              <div className="flex items-center justify-between gap-4 mt-1">
                <span className="text-[10px] text-slate-400">سرعة الصوت:</span>
                <input
                  type="range"
                  min="1.0"
                  max="2.0"
                  step="0.1"
                  value={playbackSpeed}
                  onChange={(e) => {
                    const speed = parseFloat(e.target.value);
                    setPlaybackSpeed(speed);
                    localStorage.setItem("reader_playback_speed", speed.toString());
                    if (activeAudioRef.current) {
                      activeAudioRef.current.playbackRate = speed;
                    }
                  }}
                  className="w-20 accent-emerald-500"
                  title={`${playbackSpeed}x`}
                />
                <span className="text-[10px] font-mono text-emerald-400 font-bold w-6 text-left">{playbackSpeed.toFixed(1)}x</span>
              </div>

              {/* Voice Direction Prompt for Desktop Panel */}
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-emerald-400" />
                    توجيه الصوت (Direction):
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">{voiceDirection.length}/1000</span>
                </div>
                <textarea
                  rows={2}
                  value={voiceDirection}
                  onChange={(e) => {
                    const val = e.target.value;
                    setVoiceDirection(val);
                    localStorage.setItem("reader_voice_direction", val);
                  }}
                  placeholder="تعليمات حرة للنبرة والإلقاء والمشاعر..."
                  className="w-full rounded bg-slate-950 border border-slate-800 p-1.5 text-[10px] text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none resize-none"
                />
              </div>
              
              <button
                onClick={handleTestVoice}
                disabled={isTtsLoading}
                className="mt-1 flex items-center justify-center gap-1.5 w-full rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 py-1.5 transition text-[10px]"
              >
                {isTtsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                تجربة الصوت
              </button>
            </div>
          )}

          {/* Hide Bubble Background Option */}
          <div className="flex items-center justify-between gap-4 w-full">
            <span className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-amber-400" />
              إخفاء الطبقة البيضاء (خلفية شفافة):
            </span>
            <button
              onClick={() => setHideBackground(!hideBackground)}
              className="flex h-7 w-12 items-center rounded-full bg-slate-800 p-1 transition duration-200 focus:outline-none"
              title={hideBackground ? "الطبقة البيضاء مخفية (خلفية شفافة)" : "الطبقة البيضاء ظاهرة"}
            >
              <div
                className={`h-5 w-5 rounded-full shadow-md transform transition duration-200 ${
                  hideBackground ? "bg-emerald-400 translate-x-5" : "bg-slate-500 translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Bubble Styling options */}
          {!hideBackground && (
            <div className="flex flex-col gap-1.5 w-full">
              <span>مظهر فقاعة الترجمة:</span>
              <select
                value={bubbleStyle}
                onChange={(e) => setBubbleStyle(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {BUBBLE_STYLES.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Font Color Selector */}
          <div className="flex flex-col gap-1.5 w-full">
            <span>لون خط الترجمة:</span>
            <div className="flex items-center gap-1 bg-slate-950 p-1.5 rounded-lg justify-between border border-slate-900">
              {[
                { hex: "#000000", label: "أسود", text: "bg-black border-white" },
                { hex: "#ffffff", label: "أبيض", text: "bg-white border-slate-800" },
                { hex: "#ef4444", label: "أحمر", text: "bg-red-500 border-red-350" },
                { hex: "#10b981", label: "أخضر", text: "bg-emerald-500 border-emerald-350" },
                { hex: "#3b82f6", label: "أزرق", text: "bg-blue-500 border-blue-350" },
                { hex: "#f59e0b", label: "ذهبي", text: "bg-amber-500 border-amber-350" },
              ].map((color) => (
                <button
                  key={color.hex}
                  onClick={() => setFontColor(color.hex)}
                  title={color.label}
                  className={`h-5 w-5 rounded-full border transition-transform duration-200 ${color.text} ${
                    fontColor === color.hex ? "scale-125 ring-2 ring-emerald-500" : "opacity-75 hover:opacity-100 hover:scale-110"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="mt-auto hidden md:flex flex-col gap-2 rounded-lg bg-slate-950 p-3 border border-slate-900 text-[10px] leading-relaxed text-slate-500">
            <div className="flex items-center gap-1.5 text-slate-400 font-bold">
              <Info className="h-3.5 w-3.5 text-emerald-400" />
              <span>تعليمات الترجمة:</span>
            </div>
            <p>1. انقر على "ترجمة الصفحة" للتعرف على النصوص عبر Gemini وترجمتها فوراً.</p>
            <p>2. ضع مؤشر الماوس فوق الفقاعات لرؤية النص الأصلي.</p>
            <p>3. انقر على أي فقاعة للاستماع للنطق الصوتي بشكل فوري وبدون أي انتظار.</p>
          </div>

        </div>

        {/* Reader Settings Drawer / Modal (خيارات وإعدادات القارئ للهاتف والكمبيوتر) */}
        {showMobileSettings && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center p-0 md:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
            <div 
              className="absolute inset-0"
              onClick={() => setShowMobileSettings(false)}
            />
            <div className="relative z-10 bg-slate-900 border border-slate-800 rounded-t-2xl md:rounded-2xl p-4 max-h-[88vh] w-full md:max-w-xl flex flex-col shadow-2xl text-xs text-slate-300">
              
              {/* Drag Handle Indicator */}
              <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto mb-2 shrink-0" />

              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 sticky top-0 bg-slate-900 z-10 shrink-0">
                <span className="font-bold text-sm text-white flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-emerald-400" />
                  خيارات وإعدادات القارئ
                </span>
                <button
                  onClick={() => setShowMobileSettings(false)}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition active:scale-95 cursor-pointer"
                  title="إغلاق"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Drawer Scrollable Content */}
              <div className="flex-1 overflow-y-auto overscroll-contain space-y-4 py-3 pr-0.5 pl-0.5 pb-8">
                
                {/* 1. Translation & AI Card */}
                <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-2.5">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                    <Sparkles className="h-4 w-4" />
                    <span>الترجمة الذكية (OCR)</span>
                  </div>

                  <button
                    onClick={() => {
                      runOcrAndTranslate(true);
                      setShowMobileSettings(false);
                    }}
                    disabled={ocrLoading}
                    className={`flex items-center justify-center gap-2 w-full rounded-lg px-3 py-2.5 text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer ${
                      Object.keys(pageOcrData).length > 0
                        ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400"
                        : "bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
                    }`}
                  >
                    {ocrLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري ترجمة صفحات الفصل...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        {Object.keys(pageOcrData).length > 0 ? "إعادة ترجمة الفصل" : "ترجمة جميع صفحات الفصل (OCR)"}
                      </>
                    )}
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-400">لغة الترجمة:</span>
                      <select
                        value={targetLang.code}
                        onChange={(e) => {
                          const lang = TARGET_LANGUAGES.find((l) => l.code === e.target.value);
                          if (lang) {
                            setTargetLang(lang);
                            setPageOcrData((prev) => {
                              const copy = { ...prev };
                              delete copy[currentPageIndex];
                              return copy;
                            });
                          }
                        }}
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none"
                      >
                        {TARGET_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.flag} {lang.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-400">محرك الترجمة:</span>
                      <select
                        value={translatorEngine === "gemini" ? "gemini_cookies" : translatorEngine}
                        onChange={(e) => {
                          handleTranslatorEngineChange(e.target.value as "google" | "gemini_cookies" | "metaai");
                        }}
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none"
                      >
                        <option value="gemini_cookies">✨ Gemini كوكيز</option>
                        <option value="metaai">🤖 Meta كوكيز</option>
                        <option value="google">🌐 مترجم جوجل</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1 col-span-2">
                      <span className="text-[10px] text-teal-400 font-medium flex items-center gap-1">
                        <ScanEye className="h-3 w-3" />
                        محرك التعرف على النصوص والفقاعات (OCR):
                      </span>
                      <select
                        value={ocrEngine}
                        onChange={(e) => setOcrEngine(e.target.value as "google_lens" | "comic_vision")}
                        className="w-full rounded-lg border border-teal-500/40 bg-slate-900 px-2 py-1.5 text-xs text-teal-200 focus:outline-none"
                      >
                        <option value="google_lens">🔍 Google Lens OCR (طبقة متصفح في الخلفية - دقة فائقة)</option>
                        <option value="comic_vision">👁️ Comic Vision OCR (المحرك الهجين)</option>
                      </select>
                    </div>

                    {(translatorEngine === "gemini_cookies" || translatorEngine === "gemini") && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-emerald-400 font-medium">نموذج الذكاء الاصطناعي (Gemini):</span>
                        <select
                          value={geminiCookieModel}
                          onChange={(e) => handleGeminiCookieModelChange(e.target.value)}
                          className="w-full rounded-lg border border-emerald-500/40 bg-slate-900 px-2 py-1.5 text-xs text-emerald-300 focus:outline-none font-medium"
                        >
                          <option value="3.5-flash-lite-extended">🧠 3.5 Flash-Lite (تفكير موسع - أسرع إجابات وحل المشاكل المعقدة)</option>
                          <option value="3.5-flash-lite">⚡ 3.5 Flash-Lite (فائق السرعة)</option>
                          <option value="3.6-flash">🌟 3.6 Flash (الموصى به)</option>
                          <option value="3.1-pro">🎯 3.1 Pro (للمشاكل المعقدة)</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Chapter-Isolated Conversation Session Card */}
                  <div className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-right">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        محادثة مستقلة خاصة بالفصل
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
                        فصل {chapter.chapter}
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-400 leading-tight">
                      كل فصل يمتلك محادثة خاصة به وسجل ترجمة مستقل، لضمان دقة السياق وعدم خلط الفصول مع بعضها.
                    </p>
                    <button
                      onClick={resetChapterSession}
                      disabled={resettingSession}
                      className="mt-0.5 flex items-center justify-center gap-1.5 w-full rounded bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/80 py-1 transition text-[10px] cursor-pointer"
                      title="إعادة ضبط المحادثة الحالية لهذا الفصل وبدء محادثة جديدة كلياً"
                    >
                      {resettingSession ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3 text-amber-400" />
                      )}
                      بدء محادثة جديدة لهذا الفصل
                    </button>
                  </div>

                  <button
                    onClick={() => setShowOverlays(!showOverlays)}
                    className="flex items-center justify-between w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs transition"
                  >
                    <div className="flex items-center gap-2">
                      {showOverlays ? <Eye className="h-4 w-4 text-emerald-400" /> : <EyeOff className="h-4 w-4 text-slate-400" />}
                      <span>إظهار فقاعات الترجمة</span>
                    </div>
                    {showOverlays && <Check className="h-4 w-4 text-emerald-400" />}
                  </button>
                </div>

                {/* 2. Text to Speech Card */}
                <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                      <Volume2 className="h-4 w-4" />
                      <span>القارئ الصوتي الناطق (TTS)</span>
                    </div>
                    <button
                      onClick={() => {
                        if (isMuted) {
                          setIsMuted(false);
                        } else {
                          setIsMuted(true);
                          if (activeAudioRef.current) {
                            activeAudioRef.current.pause();
                            activeAudioRef.current = null;
                          }
                          setActiveAudio(null);
                          setSpeakingKey(null);
                          currentSpeakingKeyRef.current = null;
                        }
                      }}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                        isMuted
                          ? "border-rose-500/40 bg-rose-950/20 text-rose-300"
                          : "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
                      }`}
                    >
                      {isMuted ? "الصوت معطّل (كتم)" : "الصوت مفعّل"}
                    </button>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">محرك الأصوات:</span>
                    <select
                      value={selectedVoiceGroup}
                      onChange={(e) => handleVoiceGroupChange(e.target.value as any)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none"
                    >
                      <option value="gemini">✨ أصوات Gemini TTS الرسمية (Google Demo)</option>
                      <option value="capcut">🎙️ أصوات CapCut العربية (طبيعية ودافئة)</option>
                      <option value="current">⚡ أصوات Edge Neural (سريعة ومجانية)</option>
                      <option value="chatgpt">🍃 أصوات ChatGPT Multimodal (فائقة الواقعية)</option>
                      <option value="huggingface">🎭 أصوات Nabra-82M (تشكيل فخم)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">المعلق الصوتي:</span>
                      <span className="text-[10px] text-slate-400">السرعة: {playbackSpeed}x</span>
                    </div>
                    <select
                      value={selectedEdgeVoice}
                      onChange={(e) => handleVoiceChange(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none"
                    >
                      {selectedVoiceGroup === "gemini" ? (
                        <optgroup label="أصوات Gemini الرسمية (Google Cloud Demo)">
                          {GEMINI_VOICES.map((v) => (
                            <option key={v.name} value={v.name}>
                              {v.name} ({v.gender === "Male" ? "ذكر ♂️" : "أنثى ♀️"} • {v.traits[0]})
                            </option>
                          ))}
                        </optgroup>
                      ) : selectedVoiceGroup === "capcut" ? (
                        CAPCUT_VOICES.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))
                      ) : selectedVoiceGroup === "huggingface" ? (
                        <option value="nabra-arabic">صوت نبرة العربي الفخم (Auto-Tashkeel)</option>
                      ) : selectedVoiceGroup === "chatgpt" ? (
                        CHATGPT_VOICES.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))
                      ) : (
                        PREMIUM_VOICES.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {/* Manual Speed Control from 1.0 to 2.0 (إدخال يدوي وشريط سحب) */}
                  <div className="flex flex-col gap-2.5 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                        <Gauge className="h-4 w-4" />
                        <span>سرعة الصوت (يدوي 1.0x إلى 2.0x):</span>
                      </div>
                      
                      {/* Stepper + Manual Numeric Input */}
                      <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                        <button
                          type="button"
                          onClick={() => updatePlaybackSpeed(playbackSpeed - 0.1)}
                          disabled={playbackSpeed <= 1.0}
                          className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-30 active:scale-95 transition"
                          title="إنقاص السرعة 0.1"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>

                        <div className="relative flex items-center">
                          <input
                            type="number"
                            min="1.0"
                            max="2.0"
                            step="0.05"
                            value={playbackSpeed}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) updatePlaybackSpeed(val);
                            }}
                            className="w-14 h-7 text-center font-extrabold text-sm bg-slate-900 border border-emerald-500/60 rounded text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-[11px] text-emerald-400 font-bold -mr-3.5 pointer-events-none select-none">x</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => updatePlaybackSpeed(playbackSpeed + 0.1)}
                          disabled={playbackSpeed >= 2.0}
                          className="w-7 h-7 flex items-center justify-center rounded bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-30 active:scale-95 transition"
                          title="زيادة السرعة 0.1"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Smooth Range Slider from 1.0 to 2.0 */}
                    <div className="flex flex-col gap-1 px-0.5">
                      <input
                        type="range"
                        min="1.0"
                        max="2.0"
                        step="0.05"
                        value={playbackSpeed}
                        onChange={(e) => updatePlaybackSpeed(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer transition-all"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-medium px-1">
                        <span>1.0x (طبيعي)</span>
                        <span>1.5x (متوسط)</span>
                        <span>2.0x (أقصى سرعة)</span>
                      </div>
                    </div>

                    {/* Quick Speed Pills */}
                    <div className="grid grid-cols-5 gap-1.5 pt-0.5">
                      {[1.0, 1.25, 1.5, 1.75, 2.0].map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => updatePlaybackSpeed(spd)}
                          className={`py-1.5 rounded-lg text-center text-[10px] font-bold transition active:scale-95 ${
                            playbackSpeed === spd
                              ? "bg-emerald-500 text-slate-950 shadow-md ring-1 ring-emerald-400"
                              : "bg-slate-950 text-slate-300 hover:text-white border border-slate-800"
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>

                    {/* Test Voice Button */}
                    <button
                      onClick={handleTestVoice}
                      disabled={isTtsLoading}
                      className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-xs font-bold active:scale-95 transition mt-0.5"
                    >
                      {isTtsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      <span>تجربة الصوت بالسرعة الحالية ({playbackSpeed}x)</span>
                    </button>
                  </div>

                  {/* Voice Direction Prompt Card (توجيه الأداء الصوتي) */}
                  <div className="flex flex-col gap-2.5 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                        <Sparkles className="h-4 w-4" />
                        <span>توجيه أداء ونبرة الصوت (Voice Direction Prompt):</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">{voiceDirection.length}/1000</span>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      خانة اختيارية لكتابة تعليمات حرة للصوت لذكاء Gemini: طريقة الإلقاء، المشاعر، النبرة، السرعة، أسلوب الراوي أو الشخصية (توتر، هدوء، حزن، غضب، خوف، أسلوب سرد مانهوا أو مانجا).
                    </p>

                    <textarea
                      rows={3}
                      value={voiceDirection}
                      onChange={(e) => {
                        const val = e.target.value;
                        setVoiceDirection(val);
                        localStorage.setItem("reader_voice_direction", val);
                      }}
                      placeholder="اكتب تعليمات حرة للصوت هنا (مثال: نبرة حماسية وسريعة لسرد مانهوا، أسلوب غاضب ومتوتر، حزن وهدوء، نبرة راوٍ هادئة ووقورة...)"
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs leading-relaxed text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                    />

                    {/* Quick Preset Helper Tags */}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {[
                        { label: "سرد مانهوا حماسي", prompt: "Manhwa intense action narration. Fast-paced, heroic, passionate and clear." },
                        { label: "هدوء وغموض", prompt: "Calm, mysterious and deep voice. Slow, suspenseful and atmospheric delivery." },
                        { label: "غضب وتوتر", prompt: "Tense, aggressive and shouting voice with high adrenaline and anger." },
                        { label: "حزن ودراما", prompt: "Melancholic, sad, sorrowful and delicate tone with emotional weight." },
                        { label: "راوٍ وثائقي فخم", prompt: "Authoritative, dignified and clear narrator. Natural Arabic classical eloquence." },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setVoiceDirection(item.prompt);
                            localStorage.setItem("reader_voice_direction", item.prompt);
                          }}
                          className="px-2 py-0.5 rounded-full text-[9px] bg-slate-950 border border-slate-800 text-slate-400 hover:text-emerald-300 hover:border-emerald-500/40 transition active:scale-95 cursor-pointer"
                        >
                          + {item.label}
                        </button>
                      ))}
                      {voiceDirection.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setVoiceDirection("");
                            localStorage.removeItem("reader_voice_direction");
                          }}
                          className="px-2 py-0.5 rounded-full text-[9px] bg-rose-950/40 border border-rose-800/40 text-rose-300 hover:bg-rose-900/60 transition active:scale-95 cursor-pointer"
                        >
                          مسح التعليمات
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 3. AI Colorization Card */}
                <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-2.5">
                  <div className="flex items-center gap-2 text-purple-400 font-bold text-xs">
                    <Palette className="h-4 w-4" />
                    <span>التلوين بالذكاء الاصطناعي (AI Colorize)</span>
                  </div>

                  <button
                    disabled={isBulkColorizing}
                    onClick={async () => {
                      setShowMobileSettings(false);
                      handleBulkColorize();
                    }}
                    className="flex items-center justify-center gap-2 w-full rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2.5 text-xs font-bold text-purple-300 hover:bg-purple-500/20 transition active:scale-95 disabled:opacity-50"
                  >
                    {isBulkColorizing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                        جاري تلوين الفصل...
                      </>
                    ) : (
                      <>
                        <Palette className="h-4 w-4 text-purple-400" />
                        تلوين الفصل بالكامل (AI)
                      </>
                    )}
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        const val = !autoColorize;
                        setAutoColorize(val);
                        localStorage.setItem("reader_auto_colorize", String(val));
                      }}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs"
                    >
                      <span>تلوين تلقائي</span>
                      {autoColorize && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                    </button>

                    <button
                      onClick={() => {
                        setHideColorizeButtons(prev => {
                          const newVal = !prev;
                          localStorage.setItem("reader_hide_colorize_buttons", String(newVal));
                          return newVal;
                        });
                      }}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs"
                    >
                      <span>إخفاء زر التلوين</span>
                      {hideColorizeButtons && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                    </button>
                  </div>
                </div>

                {/* 4. Work Context Card */}
                <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-2.5">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                    <Bookmark className="h-4 w-4" />
                    <span>نوع العمل وسياق الترجمة</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">التخصص الثقافي:</span>
                    <select
                      value={workType}
                      onChange={(e) => {
                        setWorkType(e.target.value);
                        localStorage.setItem("last_selected_work_type", e.target.value);
                      }}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-white focus:outline-none"
                    >
                      <option value="مانهوا كورية">🇰🇷 مانهوا كورية (Manhwa)</option>
                      <option value="مانجا يابانية">🇯🇵 مانجا يابانية (Manga)</option>
                      <option value="مانها صينية">🇨🇳 مانها صينية (Manhua)</option>
                      <option value="كوميكس غربي">🇺🇸 كوميكس غربي (Comics)</option>
                      <option value="ويب تون">🌐 ويب تون عالمي (Webtoon)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">اسم العمل (لسياق البرومبت):</span>
                    <input
                      type="text"
                      value={workName}
                      onChange={(e) => {
                        setWorkName(e.target.value);
                        localStorage.setItem("reader_work_name", e.target.value);
                      }}
                      placeholder="مثال: Solo Leveling..."
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs text-white focus:outline-none"
                    />
                    <label className="flex items-center gap-2 text-[11px] text-slate-400 mt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeWorkName}
                        onChange={(e) => {
                          setIncludeWorkName(e.target.checked);
                          localStorage.setItem("reader_include_work_name", String(e.target.checked));
                        }}
                        className="rounded border-slate-700 bg-slate-800 text-emerald-500"
                      />
                      <span>إضافة اسم العمل للبرومبت لتوجيه الذكاء الاصطناعي</span>
                    </label>
                  </div>
                </div>

                {/* 5. Display & Style Card */}
                <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-2.5">
                  <span className="text-slate-300 font-bold text-xs">العرض ونمط الخط:</span>

                  {/* Font Color */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">لون نصوص الترجمة:</span>
                    <div className="flex items-center gap-1.5">
                      {[
                        { color: "#000000", label: "أسود" },
                        { color: "#ffffff", label: "أبيض" },
                        { color: "#ef4444", label: "أحمر" },
                        { color: "#10b981", label: "أخضر" },
                        { color: "#3b82f6", label: "أزرق" },
                        { color: "#f59e0b", label: "ذهبي" },
                      ].map((c) => (
                        <button
                          key={c.color}
                          onClick={() => setFontColor(c.color)}
                          className={`h-5 w-5 rounded-full border transition active:scale-95 cursor-pointer ${
                            fontColor === c.color ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-900 scale-110" : "border-slate-700"
                          }`}
                          style={{ backgroundColor: c.color }}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Hide Background toggle */}
                  <button
                    onClick={() => setHideBackground(!hideBackground)}
                    className="flex items-center justify-between w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs hover:bg-slate-800/60 transition"
                  >
                    <span className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-amber-400" />
                      إخفاء الطبقة البيضاء (خلفية شفافة)
                    </span>
                    {hideBackground ? (
                      <span className="flex items-center gap-1 text-emerald-400 font-bold">
                        <Check className="h-3.5 w-3.5" />
                        مخفية
                      </span>
                    ) : (
                      <span className="text-slate-500">ظاهرة</span>
                    )}
                  </button>

                  {/* View Mode & Fullscreen */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-400">نمط العرض:</span>
                      <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                        <button
                          onClick={() => setViewMode("fit-width")}
                          className={`flex-1 rounded py-1.5 text-center font-bold text-[10px] transition ${
                            viewMode === "fit-width" ? "bg-slate-800 text-emerald-400" : "text-slate-400"
                          }`}
                        >
                          طولي
                        </button>
                        <button
                          onClick={() => setViewMode("fit-height")}
                          className={`flex-1 rounded py-1.5 text-center font-bold text-[10px] transition ${
                            viewMode === "fit-height" ? "bg-slate-800 text-emerald-400" : "text-slate-400"
                          }`}
                        >
                          كامل
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-400">الشاشة:</span>
                      <button
                        onClick={toggleFullscreen}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 py-1.5 px-2 text-xs font-bold text-slate-200 hover:bg-slate-800 transition active:scale-95"
                      >
                        {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        <span>{isFullscreen ? "خروج" : "ملء الشاشة"}</span>
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* Dynamic Interactive Stage */}
        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button, select, input, .text-overlay-bubble")) return;
            setShowTopBar((prev) => !prev);
          }}
          className="manga-page-container flex-1 min-h-0 w-full overflow-y-scroll overflow-x-hidden flex flex-col items-center bg-slate-950 select-none relative pb-16 border-0 m-0 p-0"
          dir="ltr"
          style={{
            direction: "ltr",
            WebkitOverflowScrolling: "touch",
            overscrollBehaviorY: "contain",
            touchAction: "pan-y",
          }}
        >
          
          {/* Prominent Translation Alert banner at the top of reading area */}
          {Object.keys(pageOcrData).length === 0 && !ocrLoading && (
            <div className="w-full max-w-xl sm:max-w-2xl md:max-w-3xl mt-4 px-4 mb-2 z-10" dir="rtl">
              <div className="bg-slate-900/90 backdrop-blur-md border border-emerald-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-lg shrink-0">
                    <Sparkles className="h-5 w-5 animate-pulse" />
                  </div>
                  <div className="text-right">
                    <h5 className="font-display font-bold text-slate-100 text-sm">هذا الفصل لم يترجم بعد</h5>
                    <p className="text-xs text-slate-400 mt-0.5">اضغط على زر الترجمة للتعرف على جميع نصوص صفحات الفصل وترجمتها بالذكاء الاصطناعي.</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 w-full sm:w-auto shrink-0">
                  <button
                    onClick={() => {
                        const val = !autoColorize;
                        setAutoColorize(val);
                        localStorage.setItem("reader_auto_colorize", String(val));
                    }}
                    className={`flex items-center justify-center gap-2 font-bold text-xs px-4 py-2 rounded-lg transition active:scale-95 cursor-pointer border ${
                      autoColorize
                        ? "bg-purple-500/10 border-purple-500/50 text-purple-400"
                        : "bg-slate-800 border-slate-700 text-slate-400"
                    }`}
                  >
                    <Palette className="h-4 w-4" />
                    <span>التلوين الذكي التلقائي</span>
                  </button>
                  <button
                    onClick={() => runOcrAndTranslate(true)}
                    className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs px-5 py-2.5 rounded-lg shadow-lg shadow-emerald-500/20 transition active:scale-95 cursor-pointer"
                  >
                    <Sparkles className="h-4 w-4 animate-spin-slow" />
                    <span>ترجمة الفصل بالكامل فوراً</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Floating CV Inspector Legend & HUD */}
          {showVisionInspector && (
            <div className="sticky top-2 z-30 mx-auto my-2 px-4 py-2 rounded-2xl bg-slate-950/95 border border-amber-500/50 shadow-2xl backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs text-slate-200" dir="rtl">
              <div className="flex items-center gap-2">
                <ScanEye className="h-4 w-4 text-amber-400 animate-pulse shrink-0" />
                <span className="font-bold text-amber-300">فاحص الرؤية الحاسوبية (CV Inspector):</span>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1.5 bg-cyan-950/40 px-2 py-0.5 rounded-full border border-cyan-500/40">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-cyan-500/40 border border-cyan-400" />
                  <span className="text-cyan-300 font-medium">Text Box</span>
                </span>
                <span className="flex items-center gap-1.5 bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/40">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/40 border border-emerald-400" />
                  <span className="text-emerald-300 font-medium">Bubble Mask</span>
                </span>
                <span className="flex items-center gap-1.5 bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-500/40">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-400 border-dashed" />
                  <span className="text-amber-300 font-medium">Safe Translation Area</span>
                </span>
              </div>
              <button
                onClick={() => setShowVisionInspector(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                title="إغلاق الفاحص"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Continuous Webtoon Strip Container with 0px Gap Guarantee and RTL centering */}
          <div 
            className={`manga-page-strip w-full flex flex-col items-center justify-center m-0 p-0 border-0 ${
              viewMode === "fit-width" 
                ? "max-w-full md:max-w-4xl lg:max-w-5xl" 
                : "max-w-full md:max-w-2xl lg:max-w-3xl"
            }`}
            dir="ltr"
            style={{ direction: "ltr", margin: "0 auto" }}
          >
            {(Array.isArray(pages) ? pages : []).map((url, i) => {
               if (!url || !url.trim()) return null;
               const isBase64 = url.startsWith("data:");
               const proxiedUrl = toProxiedUrl(url, chapter.isLocal || isBase64);
               if (!proxiedUrl || !proxiedUrl.trim()) return null;
               const currentBlocks = Array.isArray(pageOcrData[i]) ? pageOcrData[i] : [];
               const consolidatedBlocks = consolidateNearbyBlocks(currentBlocks);

               return (
                 <div 
                   key={i} 
                   data-page-index={i}
                   className="manga-page-wrapper relative block w-full leading-none group border-0 p-0 select-none"
                   dir="ltr"
                   onClick={(e) => handlePageContainerClick(e, i, consolidatedBlocks)}
                   style={{
                     marginTop: i > 0 ? "-2px" : "0px",
                     lineHeight: 0,
                     fontSize: 0,
                     direction: "ltr",
                     margin: "0 auto",
                   }}
                 >
                   <img
                     src={proxiedUrl.trim()}
                     alt={`Manga page ${i + 1}`}
                     referrerPolicy="no-referrer"
                     loading={i < 3 ? "eager" : "lazy"}
                     className="w-full h-auto block m-0 p-0 border-0 pointer-events-none transition-opacity duration-300"
                     style={{
                       display: "block",
                       width: "100%",
                       maxWidth: "100%",
                       height: "auto",
                       margin: "0 auto",
                       padding: 0,
                       border: "none",
                       outline: "none",
                       verticalAlign: "top",
                       imageRendering: "-webkit-optimize-contrast",
                       transform: "translateZ(0)",
                     }}
                     onLoad={() => {
                       window.dispatchEvent(new Event("resize"));
                     }}
                     onError={(e) => {
                       const el = e.currentTarget;
                       if (!el.dataset.retried) {
                         el.dataset.retried = "true";
                         el.src = `${proxiedUrl}&retry=1`;
                       }
                     }}
                   />
                   
                   {/* Floating helper button on the first page only */}
                   {i === 0 && Object.keys(pageOcrData).length === 0 && !ocrLoading && !translatingPages[i] && (
                     <div className="absolute top-6 left-6 z-20">
                       <button
                         onClick={() => runOcrAndTranslate(true)}
                         className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-emerald-500 hover:text-white backdrop-blur-md border border-slate-800/80 text-emerald-400 text-xs font-bold px-4 py-2 rounded-full shadow-2xl transition active:scale-95 cursor-pointer"
                       >
                         <Sparkles className="h-4 w-4 animate-pulse text-emerald-400" />
                         <span>اضغط هنا لترجمة الفصل</span>
                       </button>
                     </div>
                   )}

                   {/* Background Translation Loading Indicator for this specific page */}
                   {translatingPages[i] && (
                     <div className="absolute top-6 left-6 z-20 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-800/80 text-emerald-400 text-xs font-bold px-4 py-2 rounded-full shadow-2xl">
                       <Loader2 className="h-4 w-4 animate-spin" />
                       <span>جاري ترجمة الصفحة...</span>
                     </div>
                   )}

                   {/* Floating AI Colorize Button */}
                   {!hideColorizeButtons && (
                     <div className={`absolute top-6 right-6 z-20 flex items-center gap-2 transition-opacity duration-300 ${colorizingPages[i] ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}>
                       {colorizedPages[i] && (
                         <button
                           onClick={() => togglePageColor(i)}
                           className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-purple-600 text-purple-300 hover:text-white backdrop-blur-md border border-slate-800/80 text-xs font-bold px-3 py-2 rounded-full shadow-2xl transition active:scale-95 cursor-pointer"
                           title="التبديل بين النسخة الأصلية والملونة لهذه الصفحة"
                         >
                           <Palette className="h-3.5 w-3.5 text-purple-400" />
                           <span>{pages[i] === colorizedPages[i] ? "عرض الأصل" : "عرض الملونة"}</span>
                         </button>
                       )}
                       <button
                         onClick={() => colorizePage(i, url)}
                         disabled={colorizingPages[i]}
                         className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-emerald-500 hover:text-white backdrop-blur-md border border-slate-800/80 text-emerald-400 text-xs font-bold px-4 py-2 rounded-full shadow-2xl transition active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                         title="تلوين الصفحة بالذكاء الاصطناعي (مجاني)"
                       >
                         {colorizingPages[i] ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="hidden sm:inline">جاري التلوين...</span>
                            </>
                         ) : (
                            <>
                              <Palette className="h-4 w-4 text-emerald-400" />
                              <span className="hidden sm:inline">{colorizedPages[i] ? "إعادة التلوين" : "تلوين (AI)"}</span>
                            </>
                         )}
                       </button>
                     </div>
                   )}

                   {/* Computer Vision Inspector Layer (Displays Text Box, Bubble Mask, Safe Area & Confidence) */}
                   <ComicVisionInspectorOverlay
                     blocks={consolidatedBlocks}
                     visible={showVisionInspector}
                   />

                   {/* OCR Overlays layers */}
                   {showOverlays && consolidatedBlocks.map((block, index) => {
                     const cleanT = (block.translatedText || block.translated_text || block.originalText || block.original_text || "").trim();
                     if (!cleanT) return null;
                     const blockId = getStableBlockId(block, index);
                     const audioTaskId = `${i}_${blockId}`;
                     const speechText = (block.translatedText || block.translated_text || cleanT).trim();
                     const cacheKey = ReaderAudioCache.makeKey(
                       chapter.id,
                       i,
                       blockId,
                       selectedVoiceGroup,
                       selectedEdgeVoice,
                       speechText,
                       playbackSpeed
                     );
                     const isReady = Boolean(
                       bubbleAudioStatus[audioTaskId] === "ready" ||
                       preloadedAudio[audioTaskId] ||
                       preloadedAudio[cacheKey]
                     );

                     return (
                       <MangaBubble
                         key={`page_${i}_block_${blockId}`}
                         block={block}
                         index={index}
                         bubbleStyle={bubbleStyle}
                         fontColor={fontColor}
                         hideBackground={hideBackground}
                         speakingKey={speakingKey}
                         isTtsLoading={isTtsLoading}
                         speakBlock={speakBlock}
                         playRegionAudio={playRegionAudio}
                         currentPageIndex={i}
                         audioStatus={
                           bubbleAudioStatus[audioTaskId] ||
                           (isReady ? "ready" : "idle")
                         }
                         isAudioReady={isReady}
                         fontScale={fontScale}
                       />
                     );
                   })}
                 </div>
               );
            })}

            {/* End of Chapter Card (نهاية الفصل وحذف الترجمة التلقائي) */}
            {pages.length > 0 && !loading && (
              <div className="w-full max-w-lg mx-auto my-12 p-6 rounded-2xl bg-slate-950/90 border border-slate-800 text-center flex flex-col items-center gap-4 shadow-2xl backdrop-blur-xs">
                <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">انتهى الفصل {chapter.chapter}</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    تم الانتهاء من قراءة هذا الفصل. تم حذف بيانات الترجمة تلقائياً لتفريغ الذاكرة ولن يتم الاحتفاظ بها.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 w-full pt-2">
                  <button
                    onClick={handleExitReader}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition active:scale-95 cursor-pointer shadow-sm"
                  >
                    <ArrowLeft className="h-4 w-4 rotate-180" />
                    الخروج من الفصل والعودة للعمل
                  </button>
                  <button
                    onClick={() => runOcrAndTranslate(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition active:scale-95 cursor-pointer shadow-sm"
                  >
                    <RotateCcw className="h-4 w-4" />
                    إعادة ترجمة الفصل
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Chapter AI Analysis Modal & Google Lens Background Worker Tracking */}
          {ocrLoading && (
            <div 
              id="chapter-ai-analysis-modal"
              className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center gap-5 z-50 p-4 select-none animate-in fade-in duration-300"
              dir="rtl"
            >
              <div className="relative flex items-center justify-center">
                <div className="h-16 w-16 rounded-2xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center shadow-lg shadow-teal-500/10">
                  <Sparkles className="h-8 w-8 text-teal-400 animate-pulse" />
                </div>
                <div className="absolute -inset-2 rounded-2xl border-2 border-dashed border-teal-500/30 animate-spin" style={{ animationDuration: "10s" }} />
              </div>

              <div className="flex flex-col items-center text-center max-w-md w-full px-4">
                <h3 className="font-display text-lg sm:text-xl font-bold text-white tracking-wide">
                  {lensProgress ? lensProgress.message : "الذكاء الاصطناعي يحلل الفصل"}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed font-normal">
                  {lensProgress 
                    ? lensProgress.submessage 
                    : "يتعرف الذكاء الاصطناعي على النصوص والفقاعات في جميع الصفحات لترجمتها بدقة."}
                </p>

                {/* Progress Bar Container */}
                <div className="w-full mt-5 bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-inner text-right">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="flex items-center gap-1.5 font-medium text-teal-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {lensProgress?.phase === "ocr_scanning" && "جاري فحص Google Lens في الخلفية..."}
                      {lensProgress?.phase === "ocr_completed" && "تم تجهيز كافة نصوص الفصل"}
                      {lensProgress?.phase === "translating" && "جاري إرسال جميع نصوص الفصل إلى Gemini..."}
                      {!lensProgress && "جاري استخراج وترجمة النصوص..."}
                    </span>
                    <span className="font-mono text-teal-300 text-xs bg-teal-500/10 px-2.5 py-0.5 rounded-md border border-teal-500/20 font-bold">
                      {lensProgress?.phase === "ocr_scanning" 
                        ? `${lensProgress.analyzedPages} / ${lensProgress.totalPages} صفحة`
                        : lensProgress?.phase === "translating"
                        ? `${lensProgress.translatedTexts} / ${lensProgress.totalTexts} نص`
                        : `${lensProgress?.translatedTexts ?? translatedTextCount} / ${lensProgress?.totalTexts || Math.max(1, translatedTextCount)} نص`}
                    </span>
                  </div>

                  <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden relative">
                    <div 
                      className="h-full bg-gradient-to-r from-teal-500 via-emerald-400 to-cyan-400 transition-all duration-300 rounded-full"
                      style={{ 
                        width: `${
                          lensProgress?.phase === "ocr_scanning"
                            ? Math.min(100, Math.max(5, Math.round((lensProgress.analyzedPages / Math.max(1, lensProgress.totalPages)) * 100)))
                            : lensProgress?.phase === "translating"
                            ? Math.min(100, Math.max(5, Math.round(((lensProgress.translatedTexts > 0 ? lensProgress.translatedTexts : Math.max(1, Math.round(lensProgress.totalTexts * 0.4))) / Math.max(1, lensProgress.totalTexts)) * 100)))
                            : Math.min(100, Math.max(5, Math.round(((lensProgress?.translatedTexts ?? translatedTextCount) / Math.max(1, lensProgress?.totalTexts || Math.max(1, translatedTextCount))) * 100)))
                        }%` 
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2.5">
                    <span className="flex items-center gap-1 text-slate-400">
                      <ScanEye className="h-3.5 w-3.5 text-teal-400" />
                      {ocrEngine === "google_lens" ? "محرك Google Lens OCR" : "المحرك الهجين"}
                    </span>
                    <span className="text-slate-500">لا تتجمد واجهة المستخدم أثناء العمل</span>
                  </div>
                </div>

                {/* Background Continue / Cancel Actions */}
                <div className="flex items-center gap-2.5 w-full mt-4">
                  <button
                    type="button"
                    onClick={() => setOcrLoading(false)}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-bold transition active:scale-95 border border-slate-700"
                  >
                    المتابعة في الخلفية والبدء بالقراءة
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (lensOrchestratorRef.current) {
                        lensOrchestratorRef.current.stop();
                        lensOrchestratorRef.current = null;
                      }
                      if (activePipelineRef.current) {
                        activePipelineRef.current.stop();
                        activePipelineRef.current = null;
                      }
                      setOcrLoading(false);
                      setLensProgress(null);
                    }}
                    className="py-2 px-3 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-bold transition active:scale-95 border border-rose-800/50"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Non-intrusive Floating Background Progress Card */}
          {!ocrLoading && lensProgress && (lensProgress.phase === "ocr_scanning" || lensProgress.phase === "translating") && (
            <div 
              id="lens-floating-background-card"
              className="fixed bottom-20 left-4 z-40 bg-slate-900/95 border border-teal-500/40 rounded-2xl p-3 shadow-2xl backdrop-blur-md max-w-xs animate-in slide-in-from-bottom-4 duration-300 select-none text-right"
              dir="rtl"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                  </span>
                  <span className="text-[11px] font-bold text-teal-300">
                    {lensProgress.message}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOcrLoading(true)}
                  className="text-[10px] text-teal-400 hover:text-teal-200 underline font-medium cursor-pointer"
                >
                  عرض التفاصيل
                </button>
              </div>

              <p className="text-[10px] text-slate-300 leading-tight mb-2">
                {lensProgress.submessage}
              </p>

              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-teal-400 transition-all duration-300 rounded-full"
                  style={{ 
                    width: `${
                      lensProgress.phase === "ocr_scanning"
                        ? Math.min(100, Math.max(5, Math.round((lensProgress.analyzedPages / Math.max(1, lensProgress.totalPages)) * 100)))
                        : Math.min(100, Math.max(5, Math.round((lensProgress.translatedTexts / Math.max(1, lensProgress.totalTexts)) * 100)))
                    }%` 
                  }}
                />
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
