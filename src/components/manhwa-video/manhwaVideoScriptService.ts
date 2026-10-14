// Service to analyze manhwa scenes and generate cinematic Arabic narration using Gemini Cookies
import { VideoScene } from "./types";

interface GeminiStoryScriptRequest {
  mangaTitle: string;
  chapterTitle: string;
  model: string;
  scenes: Array<{
    sceneIndex: number;
    pageIndex: number;
    rawText: string;
    dialogueText?: string;
  }>;
}

export async function generateCinematicScript(
  mangaTitle: string,
  chapterTitle: string,
  scenes: VideoScene[],
  model: string = "3.6-flash",
  onProgress?: (progress: number, label: string) => void
): Promise<VideoScene[]> {
  const geminiCookies = localStorage.getItem("gemini_cookies") || "";

  // Prepare input scenes with their existing text
  const payloadScenes = scenes.map((s, idx) => ({
    sceneIndex: idx,
    pageIndex: s.pageIndex,
    rawText: s.dialogueText || s.narrationText || "",
    dialogueText: s.dialogueText || ""
  }));

  // If scenes already have full Arabic translations from Reader, we can refine them into narrative script
  const hasExistingTranslations = payloadScenes.some(s => s.rawText.length > 5 && /[\u0600-\u06FF]/.test(s.rawText));

  if (onProgress) {
    onProgress(30, `إرسال سياق الفصل إلى Gemini Cookies (${model})...`);
  }

  try {
    const res = await fetch("/api/manga/video-story-gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookies: geminiCookies,
        model,
        mangaTitle,
        chapterTitle,
        scenes: payloadScenes
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `فشل الاتصال بنموذج Gemini (${res.status})`);
    }

    const data = await res.json();
    if (!data.success && data.error) {
      throw new Error(data.error);
    }

    const narrationMap: Record<number, string> = {};
    if (Array.isArray(data.narrations)) {
      for (const item of data.narrations) {
        if (typeof item.sceneIndex === "number" && item.narration) {
          narrationMap[item.sceneIndex] = item.narration;
        }
      }
    }

    // Apply narrations to scenes
    return scenes.map((scene, idx) => {
      const refined = narrationMap[idx];
      return {
        ...scene,
        narrationText: refined && refined.trim() ? refined.trim() : scene.narrationText
      };
    });
  } catch (err: any) {
    console.warn("[Script Service] Gemini Cookies call note:", err.message || err);
    // If user has existing translations or fallback is needed, provide graceful Arabic fallback
    if (hasExistingTranslations) {
      console.log("[Script Service] Using existing cached Arabic translations for scenes");
      return scenes;
    }
    throw err;
  }
}
