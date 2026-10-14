// Service to generate TTS narration audio for each video scene using the existing TTS system
import { VideoScene, VideoCreatorSettings } from "./types";

/**
 * Accurately measures audio duration from an ArrayBuffer / Blob using AudioContext
 */
export async function getExactAudioDuration(blob: Blob): Promise<number> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const duration = audioBuffer.duration;
    await audioCtx.close();
    return Math.max(1.5, Math.round(duration * 100) / 100);
  } catch (err) {
    // Fallback using HTMLAudioElement
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onloadedmetadata = () => {
        const d = audio.duration;
        URL.revokeObjectURL(url);
        resolve(isNaN(d) || d <= 0 ? 3.0 : Math.round(d * 100) / 100);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(3.0);
      };
    });
  }
}

/**
 * Synthesizes audio for a single scene using the existing TTS backend endpoint
 */
export async function synthesizeSceneAudio(
  text: string,
  settings: VideoCreatorSettings
): Promise<{ audioBlob: Blob; audioUrl: string; duration: number }> {
  const cleanText = text.trim();
  if (!cleanText) {
    // Generate 2 seconds of silence
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const sampleRate = audioCtx.sampleRate || 44100;
    const silentBuffer = audioCtx.createBuffer(1, sampleRate * 2, sampleRate);
    // Convert to wav blob or simple fallback
    await audioCtx.close();
  }

  const endpoint = "/api/manga/tts";
  const bodyPayload: any = {
    text: cleanText,
    voiceGroup: settings.voiceGroup,
    voiceName: settings.voiceName,
    playbackSpeed: settings.playbackSpeed || 1.0,
    voiceDirection: settings.voiceDirection || "نبرة سردية حماسية ومؤثرة لمانهاوا",
    gptCookies: localStorage.getItem("chatgpt_cookies") || "",
    hfToken: localStorage.getItem("reader_hf_token") || ""
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPayload)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `فشل توليد الصوت عبر خدمة TTS (${response.status})`);
  }

  const data = await response.json();
  if (!data.audio) {
    throw new Error(data.error || "لم يتم استلام بيانات الصوت من خادم TTS");
  }

  // Convert base64 audio to Blob
  const byteCharacters = atob(data.audio);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const mimeType = data.mimeType || "audio/mp3";
  const audioBlob = new Blob([byteArray], { type: mimeType });
  const audioUrl = URL.createObjectURL(audioBlob);

  const duration = await getExactAudioDuration(audioBlob);

  return { audioBlob, audioUrl, duration };
}

/**
 * Generates audio for all scenes sequentially, updating progress and synchronizing durations
 */
export async function generateAllScenesAudio(
  scenes: VideoScene[],
  settings: VideoCreatorSettings,
  onProgress?: (progress: number, label: string) => void
): Promise<VideoScene[]> {
  const updatedScenes: VideoScene[] = [];
  let currentTime = 0;
  const total = scenes.length;

  for (let i = 0; i < total; i++) {
    const scene = scenes[i];
    const textToSpeak = (scene.narrationText || scene.dialogueText || "").trim();

    if (onProgress) {
      const pct = Math.round(((i + 1) / total) * 100);
      onProgress(pct, `توليد الصوت للمشهد ${i + 1} من ${total}...`);
    }

    try {
      if (textToSpeak) {
        const { audioBlob, audioUrl, duration } = await synthesizeSceneAudio(textToSpeak, settings);
        
        // Strictly synchronize scene duration with audio duration (+ 0.25s breathing space)
        const sceneDuration = Math.max(2.0, Math.round((duration + 0.25) * 100) / 100);

        updatedScenes.push({
          ...scene,
          audioBlob,
          audioUrl,
          duration: sceneDuration,
          startTime: Math.round(currentTime * 100) / 100,
          endTime: Math.round((currentTime + sceneDuration) * 100) / 100
        });

        currentTime += sceneDuration;
      } else {
        const silentDuration = 3.0;
        updatedScenes.push({
          ...scene,
          duration: silentDuration,
          startTime: Math.round(currentTime * 100) / 100,
          endTime: Math.round((currentTime + silentDuration) * 100) / 100
        });
        currentTime += silentDuration;
      }
    } catch (err: any) {
      console.error(`[Audio Service] Error generating audio for scene ${i + 1}:`, err);
      throw new Error(`خطأ في توليد صوت المشهد ${i + 1}: ${err.message || err}`);
    }
  }

  return updatedScenes;
}
