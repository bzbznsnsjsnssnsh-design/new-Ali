import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { createRequire } from "module";
import { GoogleGenAI } from "@google/genai";
import { Gemini } from "gemini-reverse";
import { resolveGeminiModelDef } from "./geminiCookiesService.ts";

const require = typeof __filename !== "undefined" && __filename !== "[eval]"
  ? createRequire(__filename) 
  : createRequire(import.meta.url);

const TEMP_DIR = path.join(os.tmpdir(), "video-dubbing");
if (!fs.existsSync(TEMP_DIR)) {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  } catch (_) {}
}

// Clean up stale files older than 2 hours on startup
try {
  const now = Date.now();
  const files = fs.readdirSync(TEMP_DIR);
  for (const f of files) {
    const fp = path.join(TEMP_DIR, f);
    const stats = fs.statSync(fp);
    if (now - stats.mtimeMs > 2 * 3600 * 1000) {
      fs.unlinkSync(fp);
    }
  }
} catch (_) {}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
  fps?: number;
  bitrate?: number;
  audioTracks: Array<{ id: number; label: string; language?: string; codec?: string }>;
  subtitleTracks: Array<{ id: number; label: string; language?: string; codec?: string }>;
}

export interface SpeechItemRaw {
  id: string;
  start: number;
  end: number;
  speaker: string;
  source_text: string;
  arabic_text: string;
}

export interface SegmentAnalysisResult {
  segment_start: number;
  segment_duration: number;
  actual_start: number;
  actual_end: number;
  items: Array<SpeechItemRaw & {
    absoluteStart: number;
    absoluteEnd: number;
    targetDuration: number;
  }>;
}

/**
 * Execute ffprobe to get exact duration in seconds
 */
export async function getMediaDuration(inputUrlOrPath: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputUrlOrPath],
      { timeout: 15000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(0);
        const val = parseFloat(stdout.trim());
        resolve(isNaN(val) ? 0 : val);
      }
    );
  });
}

/**
 * Execute ffprobe to retrieve container and stream metadata
 */
export async function probeVideo(inputUrlOrPath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      inputUrlOrPath
    ];

    execFile("ffprobe", args, { timeout: 20000 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`ffprobe failed: ${stderr || error.message}`));
      }

      try {
        const data = JSON.parse(stdout);
        const format = data.format || {};
        const streams = data.streams || [];

        const videoStream = streams.find((s: any) => s.codec_type === "video");
        const audioStreams = streams.filter((s: any) => s.codec_type === "audio");
        const subtitleStreams = streams.filter((s: any) => s.codec_type === "subtitle");

        let fps = 0;
        if (videoStream?.r_frame_rate) {
          const parts = String(videoStream.r_frame_rate).split("/");
          if (parts.length === 2 && Number(parts[1]) > 0) {
            fps = Math.round(Number(parts[0]) / Number(parts[1]));
          } else {
            fps = Number(parts[0]) || 0;
          }
        }

        const duration = parseFloat(format.duration || videoStream?.duration || audioStreams[0]?.duration || "0");
        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;
        const videoCodec = videoStream?.codec_name || undefined;
        const audioCodec = audioStreams[0]?.codec_name || undefined;
        const container = format.format_name || undefined;
        const bitrate = format.bit_rate ? Math.round(Number(format.bit_rate) / 1000) : undefined;

        const audioTracks = audioStreams.map((s: any, idx: number) => ({
          id: s.index ?? idx,
          label: s.tags?.title || s.tags?.handler_name || `Audio Track ${idx + 1}`,
          language: s.tags?.language || "und",
          codec: s.codec_name,
        }));

        const subtitleTracks = subtitleStreams.map((s: any, idx: number) => ({
          id: s.index ?? idx,
          label: s.tags?.title || s.tags?.handler_name || `Subtitle ${idx + 1}`,
          language: s.tags?.language || "und",
          codec: s.codec_name,
        }));

        resolve({
          duration,
          width,
          height,
          videoCodec,
          audioCodec,
          container,
          fps,
          bitrate,
          audioTracks,
          subtitleTracks
        });
      } catch (e: any) {
        reject(new Error(`Failed to parse ffprobe json: ${e.message}`));
      }
    });
  });
}

export interface ExtractAudioSliceInput {
  videoUrl?: string;
  filePath?: string;
  audioBase64?: string;
  startTime: number;
  duration: number;
  overlapSeconds?: number;
  sourceDuration?: number;
}

export interface ExtractAudioSliceResult {
  filePath: string;
  buffer: Buffer;
  requestedStart: number;
  requestedEnd: number;
  actualStart: number;
  actualEnd: number;
  actualDuration: number;
  sourceDuration?: number;
}

/**
 * Extract an audio slice (e.g. 60 seconds with lookahead overlap) from video URL or uploaded audio buffer
 */
export async function extractAudioSlice(
  input: ExtractAudioSliceInput
): Promise<ExtractAudioSliceResult> {
  const { videoUrl, filePath, audioBase64, startTime, duration } = input;
  const tempId = crypto.randomBytes(8).toString("hex");
  const outputPath = path.join(TEMP_DIR, `slice_${tempId}.mp3`);

  const requestedStart = Math.max(0, Number(startTime) || 0);
  const requestedDuration = Math.max(1, Number(duration) || 60);
  const requestedEnd = Number((requestedStart + requestedDuration).toFixed(2));

  // Overlapping analysis window: add 8 seconds lookahead to capture dialogue crossing 60s boundary
  const overlap = typeof input.overlapSeconds === "number" ? input.overlapSeconds : 8;
  const actualStart = requestedStart;
  let targetExtractDuration = requestedDuration + overlap;

  let sourceDuration = input.sourceDuration;
  const source = filePath || videoUrl;

  // Probe source media duration if unknown
  if ((!sourceDuration || sourceDuration <= 0) && source && (source.startsWith("http") || fs.existsSync(source))) {
    try {
      sourceDuration = await getMediaDuration(source);
    } catch (_) {}
  }

  if (sourceDuration && sourceDuration > 0) {
    if (actualStart >= sourceDuration) {
      targetExtractDuration = 1;
    } else {
      targetExtractDuration = Math.min(targetExtractDuration, sourceDuration - actualStart);
    }
  }

  if (audioBase64) {
    // If base64 audio slice was already extracted on the client
    const inBuffer = Buffer.from(audioBase64.replace(/^data:audio\/[a-zA-Z0-9]+;base64,/, ""), "base64");
    const inputPath = path.join(TEMP_DIR, `in_${tempId}.tmp`);
    fs.writeFileSync(inputPath, inBuffer);

    return new Promise((resolve, reject) => {
      // Re-encode to clean standardized 16kHz mono MP3
      const args = [
        "-y",
        "-i", inputPath,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "libmp3lame",
        "-q:a", "4",
        outputPath
      ];

      execFile("ffmpeg", args, { timeout: 30000 }, async (err) => {
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
        if (err) {
          return reject(new Error(`FFmpeg re-encoding failed: ${err.message}`));
        }
        try {
          const outBuffer = fs.readFileSync(outputPath);
          const realDuration = await getMediaDuration(outputPath);
          const actualDuration = realDuration > 0 ? Number(realDuration.toFixed(2)) : Number(targetExtractDuration.toFixed(2));
          const actualEnd = Number((actualStart + actualDuration).toFixed(2));

          console.log(
            `[Dubbing Debug] requestedStart=${requestedStart.toFixed(2)}, requestedEnd=${requestedEnd.toFixed(2)}, actualStart=${actualStart.toFixed(2)}, actualEnd=${actualEnd.toFixed(2)}, actualDuration=${actualDuration.toFixed(2)}, sourceDuration=${sourceDuration && sourceDuration > 0 ? sourceDuration.toFixed(2) : "unknown"}`
          );

          resolve({
            filePath: outputPath,
            buffer: outBuffer,
            requestedStart,
            requestedEnd,
            actualStart,
            actualEnd,
            actualDuration,
            sourceDuration
          });
        } catch (e: any) {
          reject(e);
        }
      });
    });
  }

  if (!source) {
    throw new Error("No source URL, file path, or audio buffer provided for extraction");
  }

  return new Promise((resolve, reject) => {
    // Extract slice with fast seek (-ss before -i) and target duration
    const args = [
      "-y",
      "-analyzeduration", "1000000",
      "-probesize", "1000000",
      "-ss", String(actualStart),
      "-t", String(targetExtractDuration),
      "-i", source,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "libmp3lame",
      "-q:a", "4",
      outputPath
    ];

    execFile("ffmpeg", args, { timeout: 45000 }, async (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`FFmpeg audio slice extraction failed: ${stderr || err.message}`));
      }

      try {
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
          return reject(new Error("Audio extraction resulted in an empty file."));
        }
        const outBuffer = fs.readFileSync(outputPath);
        const realDuration = await getMediaDuration(outputPath);
        const actualDuration = realDuration > 0 ? Number(realDuration.toFixed(2)) : Number(targetExtractDuration.toFixed(2));
        const actualEnd = Number((actualStart + actualDuration).toFixed(2));

        console.log(
          `[Dubbing Debug] requestedStart=${requestedStart.toFixed(2)}, requestedEnd=${requestedEnd.toFixed(2)}, actualStart=${actualStart.toFixed(2)}, actualEnd=${actualEnd.toFixed(2)}, actualDuration=${actualDuration.toFixed(2)}, sourceDuration=${sourceDuration && sourceDuration > 0 ? sourceDuration.toFixed(2) : "unknown"}`
        );

        resolve({
          filePath: outputPath,
          buffer: outBuffer,
          requestedStart,
          requestedEnd,
          actualStart,
          actualEnd,
          actualDuration,
          sourceDuration
        });
      } catch (e: any) {
        reject(e);
      }
    });
  });
}

/**
 * Filter and clean JSON returned by Gemini
 */
export function extractStructuredJson(rawText: string): any {
  let text = rawText.trim();

  // Strip markdown ```json ... ``` blocks
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) {
    text = jsonMatch[1].trim();
  }

  // Attempt standard JSON parse
  try {
    return JSON.parse(text);
  } catch (_) {}

  // Attempt to find opening { and closing }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  throw new Error(`Failed to extract structured JSON from Gemini output: ${rawText.slice(0, 300)}`);
}

/**
 * Speech analysis and Arabic translation prompt with actual video timestamps
 */
const SPEECH_ANALYSIS_PROMPT = (actualStart: number, actualDuration: number) => `
You are an expert audio transcription and Arabic dubbing director.
The provided audio is a slice from a video, starting at video timestamp ${actualStart.toFixed(2)}s and lasting exactly ${actualDuration.toFixed(2)}s (from ${actualStart.toFixed(2)}s to ${(actualStart + actualDuration).toFixed(2)}s on the absolute video timeline).

Perform two critical tasks:
1. AUDIO TRANSCRIPTION & TIMESTAMPS:
   - Accurately transcribe every spoken sentence or dialogue block.
   - Detect speech boundaries: "start" and "end" in seconds RELATIVE to the start of this audio clip (0.0 to ${actualDuration.toFixed(2)}).
   - If a sentence begins or continues across chunk boundaries, capture the entire spoken sentence.
   - Identify the speaker ("speaker_1", "speaker_2", etc.).
   - If there is background music or silence with no speech, return an empty "items" list.

2. PROFESSIONAL ARABIC DUBBING TRANSLATION:
   - Translate each dialogue block into modern, natural, spoken Arabic dialogue suitable for voice actors (دبلجة عربية معاصرة وسلسة).
   - The Arabic text MUST sound natural when spoken aloud, matching the character's emotion and pacing.
   - Preserve original meaning and context faithfully.
   - Avoid archaic, overly formal, or robotic literal translations.
   - Do NOT include vocal diacritics (تسكين وحركات غير ضرورية) unless required to avoid confusion.
   - "arabic_text" MUST contain ONLY the Arabic dialogue to be spoken by TTS.

CRITICAL FORMAT REQUIREMENT:
Return ONLY a valid JSON object matching this exact schema:
{
  "segment_start": ${actualStart.toFixed(2)},
  "segment_duration": ${actualDuration.toFixed(2)},
  "items": [
    {
      "id": "speech_001",
      "start": 0.42,
      "end": 2.84,
      "speaker": "speaker_1",
      "source_text": "Original speech here",
      "arabic_text": "الحوار باللغة العربية هنا"
    }
  ]
}
`;

/**
 * Transcribe and translate speech using Gemini Cookies or Gemini API
 */
export async function analyzeAndTranslateAudio(
  audioFilePath: string,
  audioBuffer: Buffer,
  actualStart: number,
  actualDuration: number,
  options: {
    provider: 'gemini_cookies' | 'gemini_api';
    cookies?: Record<string, string>;
    modelChoice?: string;
    geminiApiKey?: string;
    createResilientGeminiChat?: (cookies: Record<string, string>, model?: string) => Promise<any>;
    runWithGeminiCookieLock?: <T>(task: () => Promise<T>) => Promise<T>;
    onProgress?: (stage: 'EXTRACTING' | 'ANALYZING' | 'TRANSLATING' | 'TTS' | 'READY', message: string, meta?: any) => void;
  }
): Promise<SegmentAnalysisResult> {
  const prompt = SPEECH_ANALYSIS_PROMPT(actualStart, actualDuration);

  // Helper to run direct Gemini API with modern gemini-3.6-flash
  const runDirectGeminiApi = async () => {
    const apiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "dummy-key-to-prevent-crash-if-missing") {
      throw new Error("GEMINI_API_KEY is missing for Gemini dubbing analysis.");
    }

    if (options.onProgress) {
      options.onProgress('ANALYZING', 'جاري التعرف على الصوت وتحليل الحوارات عبر Gemini AI (gemini-3.6-flash)...');
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: audioBuffer.toString("base64"),
                mimeType: "audio/mp3",
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawOutput = response.text || "";
    const parsed = extractStructuredJson(rawOutput);
    return normalizeAnalysisResult(parsed, actualStart, actualDuration);
  };

  // 1. Direct Gemini API
  if (options.provider === 'gemini_api' || (!options.cookies && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "dummy-key-to-prevent-crash-if-missing")) {
    return await runDirectGeminiApi();
  }

  // 2. Gemini Cookies session (with graceful fallback if cookies missing or reverse upload fails)
  if (options.provider === 'gemini_cookies') {
    const cookiesObj = options.cookies;
    if (!cookiesObj || !cookiesObj['__Secure-1PSID']) {
      console.warn("[Video Dubbing] Cookies missing or invalid __Secure-1PSID, falling back to server Gemini API");
      return await runDirectGeminiApi();
    }

    if (!options.createResilientGeminiChat || !options.runWithGeminiCookieLock) {
      console.warn("[Video Dubbing] Cookie chat runner not available, falling back to server Gemini API");
      return await runDirectGeminiApi();
    }

    try {
      if (options.onProgress) {
        options.onProgress('ANALYZING', 'جاري تحليل الحوار عبر جلسة Gemini الرسمية (Cookies)...');
      }

      const chat = await options.createResilientGeminiChat(cookiesObj, options.modelChoice || "3.6-flash");

      const result = await options.runWithGeminiCookieLock(async () => {
        let outputText = "";
        try {
          const res = await chat.generateContent({
            prompt: prompt,
            files: [audioFilePath],
          });
          outputText = res?.text || "";
        } catch (directErr) {
          console.warn("[Video Dubbing] Direct file upload failed, attempting upload helper:", directErr);
          const uploadMod = require("gemini-reverse/src/utils/upload");
          const uploadRes = await uploadMod.uploadFile(
            audioFilePath,
            null,
            chat.client?.pushId || 'feeds/mcudyrk2a4khkz',
            cookiesObj
          );
          const res = await chat.generateContent({
            prompt: prompt,
            files: [uploadRes],
          });
          outputText = res?.text || "";
        }
        return outputText;
      });

      const parsed = extractStructuredJson(result);
      return normalizeAnalysisResult(parsed, actualStart, actualDuration);
    } catch (cookieErr: any) {
      console.warn("[Video Dubbing] Gemini Cookies session failed, falling back to server Gemini API:", cookieErr.message);
      return await runDirectGeminiApi();
    }
  }

  return await runDirectGeminiApi();
}

/**
 * Normalizes speech items and computes absolute timestamps with canonical logging
 */
function normalizeAnalysisResult(parsed: any, actualStart: number, actualDuration: number): SegmentAnalysisResult {
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
  const items: SegmentAnalysisResult["items"] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item) continue;

    const startRel = Math.max(0, parseFloat(item.start) || 0);
    const endRel = Math.min(actualDuration + 2, Math.max(startRel + 0.3, parseFloat(item.end) || startRel + 2.0));
    const targetDuration = Math.max(0.3, Number((endRel - startRel).toFixed(2)));

    const absoluteStart = Number((actualStart + startRel).toFixed(2));
    const absoluteEnd = Number((actualStart + endRel).toFixed(2));

    const source_text = String(item.source_text || "").trim();
    const arabic_text = String(item.arabic_text || "").trim();

    if (!arabic_text && !source_text) continue;

    const canonicalArabic = arabic_text || source_text;
    const itemId = item.id || `speech_${String(i + 1).padStart(3, "0")}`;

    // Canonical Text Consistency Verification Log (Requirement 4)
    console.log(`[Dubbing Sync Check] item=${itemId}`);
    console.log(`SOURCE: ${source_text}`);
    console.log(`ARABIC: ${canonicalArabic}`);
    console.log(`TTS INPUT: ${canonicalArabic}`);

    items.push({
      id: itemId,
      start: Number(startRel.toFixed(2)),
      end: Number(endRel.toFixed(2)),
      absoluteStart,
      absoluteEnd,
      targetDuration,
      speaker: String(item.speaker || "speaker_1").trim(),
      source_text,
      arabic_text: canonicalArabic,
    });
  }

  // Sort items sequentially by absoluteStart
  items.sort((a, b) => a.absoluteStart - b.absoluteStart);

  return {
    segment_start: actualStart,
    segment_duration: actualDuration,
    actual_start: actualStart,
    actual_end: Number((actualStart + actualDuration).toFixed(2)),
    items,
  };
}

/**
 * Merges speech items across overlapping segment boundaries to eliminate duplicates
 * and preserve unbroken continuous speech events (e.g. crossing 60-second boundary).
 */
export function mergeSpeechItems<T extends {
  id: string;
  absoluteStart: number;
  absoluteEnd: number;
  speaker?: string;
  source_text: string;
  arabic_text: string;
  audioBase64?: string;
}>(existingItems: T[], incomingItems: T[]): T[] {
  const result = [...existingItems];

  for (const incoming of incomingItems) {
    let matchedIdx = -1;

    for (let i = 0; i < result.length; i++) {
      const exist = result[i];

      // Exact ID match
      if (exist.id === incoming.id) {
        matchedIdx = i;
        break;
      }

      // Calculate temporal overlap
      const overlapStart = Math.max(exist.absoluteStart, incoming.absoluteStart);
      const overlapEnd = Math.min(exist.absoluteEnd, incoming.absoluteEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      const existDur = Math.max(0.1, exist.absoluteEnd - exist.absoluteStart);
      const incomingDur = Math.max(0.1, incoming.absoluteEnd - incoming.absoluteStart);
      const minDur = Math.min(existDur, incomingDur);

      // Condition for same speech event crossing or captured in overlapping window:
      // 1. Overlap is significant (> 35% of either event duration)
      // 2. Or start times are very close (|start1 - start2| <= 1.8s) with same speaker
      const hasTimingOverlap = overlap > 0.35 * minDur || Math.abs(exist.absoluteStart - incoming.absoluteStart) <= 1.8;
      const isSameSpeaker = !exist.speaker || !incoming.speaker || exist.speaker === incoming.speaker;

      if (hasTimingOverlap && isSameSpeaker) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx >= 0) {
      // Merge into ONE continuous speech event
      const exist = result[matchedIdx];
      const mergedStart = Math.min(exist.absoluteStart, incoming.absoluteStart);
      const mergedEnd = Math.max(exist.absoluteEnd, incoming.absoluteEnd);

      // Choose the more complete/longer Arabic text
      const chooseIncomingText = incoming.arabic_text.length > exist.arabic_text.length;
      const arabic_text = chooseIncomingText ? incoming.arabic_text : exist.arabic_text;
      const source_text = incoming.source_text.length > exist.source_text.length ? incoming.source_text : exist.source_text;

      // Retain audio if one of them has it
      const audioBase64 = incoming.audioBase64 || exist.audioBase64;

      result[matchedIdx] = {
        ...exist,
        ...incoming,
        absoluteStart: Number(mergedStart.toFixed(2)),
        absoluteEnd: Number(mergedEnd.toFixed(2)),
        source_text,
        arabic_text,
        audioBase64
      };
    } else {
      result.push(incoming);
    }
  }

  // Sort sequentially by absoluteStart
  result.sort((a, b) => a.absoluteStart - b.absoluteStart);
  return result;
}

/**
 * Safely delete a temporary file if it exists
 */
export function safeDeleteTemp(filePath?: string) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {}
}
