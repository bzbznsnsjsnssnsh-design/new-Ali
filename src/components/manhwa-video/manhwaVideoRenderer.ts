import { VideoScene } from "./types";

export function renderSceneFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  scene: VideoScene,
  progress: number,
  canvasWidth: number,
  canvasHeight: number,
  showCaptions: boolean = true
): void {
  ctx.save();
  ctx.fillStyle = "#090d16";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const clamped = Math.max(0, Math.min(1, progress));
  let scale = 1.05;
  let offsetX = 0;
  let offsetY = 0;

  if (scene.animation === "zoom_in") {
    scale = 1.0 + clamped * 0.15;
  } else if (scene.animation === "zoom_out") {
    scale = 1.15 - clamped * 0.15;
  } else if (scene.animation === "pan_down") {
    scale = 1.12;
    offsetY = (0.5 - clamped) * canvasHeight * 0.12;
  } else if (scene.animation === "pan_up") {
    scale = 1.12;
    offsetY = (clamped - 0.5) * canvasHeight * 0.12;
  }

  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const canvasRatio = canvasWidth / Math.max(1, canvasHeight);

  let drawW = canvasWidth;
  let drawH = canvasHeight;

  if (imgRatio > canvasRatio) {
    drawW = canvasWidth;
    drawH = canvasWidth / imgRatio;
  } else {
    drawH = canvasHeight;
    drawW = canvasHeight * imgRatio;
  }

  drawW *= scale;
  drawH *= scale;

  const dx = (canvasWidth - drawW) / 2 + offsetX;
  const dy = (canvasHeight - drawH) / 2 + offsetY;

  ctx.drawImage(img, dx, dy, drawW, drawH);

  if (showCaptions && scene.narrationText) {
    const pad = 20;
    const boxH = Math.min(120, canvasHeight * 0.22);
    const boxY = canvasHeight - boxH - pad;

    ctx.fillStyle = "rgba(9, 13, 22, 0.82)";
    ctx.fillRect(pad, boxY, canvasWidth - pad * 2, boxH);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      scene.narrationText.slice(0, 95),
      canvasWidth / 2,
      boxY + boxH / 2,
      canvasWidth - pad * 4
    );
  }

  ctx.restore();
}
