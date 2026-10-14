import { OCRBlock } from "../../types";
import { VideoScene, VideoAnimationType } from "./types";

const ANIMATIONS: VideoAnimationType[] = ["pan_down", "zoom_in", "pan_up", "zoom_out"];

export async function extractScenesFromPages(
  pageUrls: string[],
  ocrByPage: Record<number, OCRBlock[]>,
  onProgress?: (percent: number, label: string) => void
): Promise<VideoScene[]> {
  const scenes: VideoScene[] = [];
  let runningTime = 0;

  for (let pIdx = 0; pIdx < pageUrls.length; pIdx++) {
    if (onProgress) {
      const pct = Math.round(((pIdx + 1) / Math.max(1, pageUrls.length)) * 100);
      onProgress(pct, `تحليل الصفحة ${pIdx + 1} من ${pageUrls.length}...`);
    }

    const blocks = ocrByPage[pIdx] || [];
    const dialogueTexts = blocks
      .map((b) => (b.translated || b.original || "").trim())
      .filter(Boolean);

    const narrationText =
      dialogueTexts.join(" — ") || `مشهد سينمائي من الصفحة ${pIdx + 1}`;
    const duration = Math.max(4, Math.min(12, Math.ceil(narrationText.split(/\s+/).length * 0.45)));
    const anim = ANIMATIONS[pIdx % ANIMATIONS.length];

    scenes.push({
      id: `scene_p${pIdx + 1}_1`,
      sceneIndex: scenes.length,
      pageIndex: pIdx,
      imageUrl: pageUrls[pIdx],
      cropBox: [0, 0, 1000, 1000],
      isTallImage: true,
      aspectRatio: 9 / 16,
      regionIds: blocks.map((b, idx) => b.region_id || b.id || `p${pIdx}_reg_${idx + 1}`),
      narrationText,
      dialogueText: dialogueTexts[0] || "",
      duration,
      animation: anim,
      startTime: runningTime,
      endTime: runningTime + duration,
    });

    runningTime += duration;
  }

  return scenes;
}
