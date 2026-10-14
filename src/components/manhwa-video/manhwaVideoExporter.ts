import { VideoScene, VideoAspectRatio, VideoResolution } from "./types";
import { renderSceneFrameToCanvas } from "./manhwaVideoRenderer";

export async function exportVideoMP4(
  scenes: VideoScene[],
  aspectRatio: VideoAspectRatio,
  resolution: VideoResolution,
  showCaptions: boolean,
  onProgress?: (percent: number, label: string) => void
): Promise<{ blob: Blob; url: string }> {
  const baseHeight = resolution === "1080p" ? 1080 : 720;
  let width = baseHeight;
  let height = baseHeight;

  if (aspectRatio === "9:16") {
    width = baseHeight;
    height = Math.round((baseHeight * 16) / 9);
  } else if (aspectRatio === "16:9") {
    width = Math.round((baseHeight * 16) / 9);
    height = baseHeight;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm",
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (onProgress) {
      onProgress(
        Math.round(((i + 1) / Math.max(1, scenes.length)) * 95),
        `تصدير المشهد ${i + 1} من ${scenes.length}...`
      );
    }

    const img = await new Promise<HTMLImageElement>((resolve) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = () => resolve(el);
      el.src = scene.imageUrl;
    });

    renderSceneFrameToCanvas(ctx, img, scene, 0.5, width, height, showCaptions);
    await new Promise((r) => setTimeout(r, 80));
  }

  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    recorder.stop();
  });

  if (onProgress) onProgress(100, "اكتمل تصدير الفيديو!");
  const blob = new Blob(chunks, { type: "video/mp4" });
  return { blob, url: URL.createObjectURL(blob) };
}

export function triggerVideoDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
