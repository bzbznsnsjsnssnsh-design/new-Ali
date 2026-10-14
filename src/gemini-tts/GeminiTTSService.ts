import type {
  GeminiTTSRequest,
  GeminiTTSResponse,
  GeminiTTSLiveStatus,
} from "./GeminiTTSTypes";
import { GeminiTTSCache } from "./GeminiTTSCache";
import { GeminiTTSError } from "./GeminiTTSErrors";

export class GeminiTTSService {
  /**
   * Main synthesis caller with Cache & Typed Error management
   * Strictly enforces Voice Lock: no fallback voices, speech_config explicitly declared
   */
  public static async synthesize(
    request: GeminiTTSRequest,
    options?: { bypassCache?: boolean }
  ): Promise<GeminiTTSResponse> {
    const rawVoice = request.voiceName || "Achernar";
    const cleanVoice = (rawVoice === "Google Demo" || rawVoice.toLowerCase().includes("demo"))
      ? "Achernar"
      : rawVoice.replace(/^gemini-/, "").trim();

    // Prepare immutable request payload with explicit speech_config
    const lockedRequest: GeminiTTSRequest = {
      ...request,
      voiceName: cleanVoice,
      allowFallback: false,
      speech_config: {
        voice_config: {
          prebuilt_voice_config: {
            voice_name: cleanVoice,
          },
        },
      },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: cleanVoice,
          },
        },
      },
    };

    // 1. Check Audio Cache unless explicitly bypassed
    if (!options?.bypassCache) {
      try {
        const cached = await GeminiTTSCache.get(lockedRequest);
        if (cached) {
          return cached;
        }
      } catch (_) {}
    }

    // 2. Fetch from backend endpoint with strict voice locking
    try {
      const response = await fetch("/api/gemini-tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lockedRequest),
      });

      const data = await response.json();

      if (data.status === "waiting_verification" || data.needsVerification || data.needsCaptcha) {
        const verErr: any = new Error(data.message || data.error?.message || "VERIFICATION_REQUIRED: يتطلب Google Cloud Text-to-Speech إكمال خطوة التحقق للاستمرار.");
        verErr.isVerification = true;
        verErr.code = "VERIFICATION_REQUIRED";
        throw verErr;
      }

      if (!response.ok || data.error) {
        const errorDetail = data.error?.message || data.error || `HTTP ${response.status}`;
        throw new Error(errorDetail);
      }

      if (!data.audioBase64) {
        throw new Error(data.error?.message || data.error || "لم يتم استلام أي بيانات صوتية من الخادم.");
      }

      const receivedVoice = (data.voiceName || "").replace(/^gemini-/, "").trim();
      if (receivedVoice && receivedVoice !== cleanVoice && cleanVoice !== "Achernar") {
        console.warn(`[GeminiTTSService] Voice mismatch warning: requested ${cleanVoice}, received ${receivedVoice}`);
      }

      const result: GeminiTTSResponse = {
        audioBase64: data.audioBase64,
        mimeType: data.mimeType || "audio/mp3",
        voiceName: cleanVoice,
        modelName: data.modelName || "gemini-3.1-flash-tts-preview",
        languageCode: data.languageCode || lockedRequest.languageCode || "ar-EG",
        byteLength: data.byteLength || 0,
        cached: false,
        fallbackUsed: false,
        generationId: lockedRequest.generationId,
        segmentId: lockedRequest.segmentId,
      };

      // 3. Cache result for future instant playback only under the genuine locked voice
      try {
        await GeminiTTSCache.set(lockedRequest, result);
      } catch (_) {}

      return result;
    } catch (err: any) {
      throw GeminiTTSError.fromError(err);
    }
  }

  /**
   * Fetches the current live status of Gemini TTS, Browser session, Buster, and CAPTCHA
   */
  public static async getLiveStatus(): Promise<GeminiTTSLiveStatus> {
    try {
      const res = await fetch("/api/gemini-tts/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e: any) {
      return {
        isProcessing: false,
        isBrowserReady: false,
        pageReady: false,
        buster: {
          verifiedAvailable: false,
          status: "BUSTER_UNAVAILABLE",
          isLoadedInBrowser: false,
          serviceWorkerUrl: null,
          details: "تعذر الاتصال بالخادم لجلب حالة إضافة Buster.",
        },
        captcha: {
          status: "NONE",
          needsCaptcha: false,
          hasCaptchaToken: false,
          hasRecaptchaFrames: false,
          busterDetected: false,
          message: "الخادم غير متصل.",
        },
        model: "gemini-3.1-flash-tts-preview",
      };
    }
  }

  /**
   * Retrieves interactive screenshot of the Google Cloud page
   */
  public static async getInteractiveView(): Promise<{ base64: string; width: number; height: number }> {
    const res = await fetch("/api/gemini-tts/interactive-view");
    if (!res.ok) throw new Error("Failed to load interactive screenshot");
    return await res.json();
  }

  /**
   * Dispatches click interaction to the Google Cloud page
   */
  public static async sendInteraction(x: number, y: number): Promise<void> {
    await fetch("/api/gemini-tts/interact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    });
  }

  /**
   * Scrolls browser page to demo or by delta
   */
  public static async scrollBrowser(action: "demo" | "up" | "down", delta?: number): Promise<{ base64: string; width: number; height: number } | null> {
    try {
      const res = await fetch("/api/gemini-tts/scroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, delta }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.screenshot || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Triggers automated Free AI ReCaptcha Solver by Raptor on the active CAPTCHA
   */
  public static async solveCaptchaWithRaptor(): Promise<{
    success: boolean;
    message: string;
    screenshot?: { base64: string; width: number; height: number };
  }> {
    try {
      const res = await fetch("/api/gemini-tts/solve-captcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Backwards compatible alias for Raptor solver
   */
  public static async solveCaptchaWithBuster(): Promise<{
    success: boolean;
    message: string;
    screenshot?: { base64: string; width: number; height: number };
  }> {
    return this.solveCaptchaWithRaptor();
  }

  /**
   * Resets or reloads the active CAPTCHA challenge (recovers from 'Try again later' / DOS block)
   */
  public static async resetCaptcha(): Promise<{
    success: boolean;
    message: string;
    screenshot?: { base64: string; width: number; height: number };
  }> {
    try {
      const res = await fetch("/api/gemini-tts/reset-captcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Automatically initializes and pre-warms the browser session to load Google Cloud TTS Demo
   */
  public static async initSession(): Promise<{
    success?: boolean;
    screenshot?: { base64: string; width: number; height: number };
  }> {
    try {
      const res = await fetch("/api/gemini-tts/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return {};
      return await res.json();
    } catch (_) {
      return {};
    }
  }

  /**
   * Opens the official Google Cloud Text-to-Speech page directly
   */
  public static async openCloudTtsPage(): Promise<{
    success: boolean;
    message: string;
    screenshot?: { base64: string; width: number; height: number };
  }> {
    try {
      const res = await fetch("/api/gemini-tts/open-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Reloads specifically the official Google Cloud Text-to-Speech page without reloading the AI Manga Reader app
   */
  public static async reloadCloudTtsPage(): Promise<{
    success: boolean;
    message: string;
    screenshot?: { base64: string; width: number; height: number };
  }> {
    try {
      const res = await fetch("/api/gemini-tts/reload-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Reloads Google Cloud TTS page and automatically initiates CAPTCHA resolution
   */
  public static async reloadAndSolveCaptcha(): Promise<{
    success: boolean;
    message: string;
    screenshot?: { base64: string; width: number; height: number };
  }> {
    try {
      const res = await fetch("/api/gemini-tts/reload-and-solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Resets browser session
   */
  public static async resetSession(): Promise<void> {
    await fetch("/api/gemini-tts/reset", { method: "POST" });
  }
}
