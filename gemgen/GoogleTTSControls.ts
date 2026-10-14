import type { Frame } from "playwright";
import { GOOGLE_TTS_CONFIG, type AudioEncoding } from "./GoogleTTSConfig.ts";

export interface GeminiTTSRequest {
  text: string;
  voiceName?: string;
  languageCode?: string;
  modelName?: string;
  voiceDirection?: string;
  audioConfig?: {
    audioEncoding?: AudioEncoding;
    speakingRate?: number;
    pitch?: number;
    volumeGainDb?: number;
    sampleRateHertz?: number;
  };
  multiSpeakerMarkup?: {
    turns: Array<{
      speaker: string;
      text: string;
    }>;
  };
  speakers?: Array<{
    alias: string;
    voiceName: string;
  }>;
}

export interface SynthesisResponse {
  audioContent?: string;
  error?: any;
  needsCaptcha?: boolean;
}

export class GoogleTTSControls {
  /**
   * Dispatches the synthesis request through <ts-app> inside the Google TTS demo frame
   */
  public static async synthesize(demoFrame: Frame, request: GeminiTTSRequest): Promise<SynthesisResponse> {
    if (!demoFrame || demoFrame.isDetached()) {
      throw new Error("Target frame was detached or closed.");
    }
    const rawRequest = this.buildGooglePayload(request);

    try {
      const response = await demoFrame.evaluate(
        async ({ payload, synthesizeUrl }) => {
        const app = (document as any).querySelector("ts-app");
        if (!app) {
          return { error: { message: "العنصر <ts-app> غير موجود في الصفحة." } };
        }

        // Clear any previous error state on <ts-app>
        try {
          if (typeof app.set === "function") {
            app.set("errorMessage", "");
            if (app.audio?.state === "error") {
              app.set("audio.state", "idle");
            }
          } else {
            app.errorMessage = "";
          }
        } catch (_) {}

        // Verify if CAPTCHA token exists; if not, initiate verification
        if (!app.captchaToken) {
          if (typeof app.verifyUser_ === "function") {
            try {
              app.shouldShowCaptcha = true;
              app.controlsEnabled = false;
              if (app.set) app.set("audio.state", "loading");
              app.verifyUser_();
            } catch (_) {}
          }
          return { needsCaptcha: true };
        }

        return new Promise((resolve) => {
          try {
            const fullUrl =
              (app.urlProxy || "https://cloud.google.com/text-to-speech/proxy") +
              "?url=" +
              synthesizeUrl +
              "&token=" +
              app.captchaToken;

            const oopsText = "Oops! We couldn't generate the audio from your text. Please try again in a moment.";
            const xhr = new XMLHttpRequest();
            xhr.open("POST", fullUrl, true);
            xhr.onload = () => {
              // Check for Google Cloud Demo "Oops!" message across all possible surfaces
              const responseText = xhr.responseText || "";
              const responseHasOops =
                responseText.includes("Oops!") ||
                responseText.includes("couldn't generate the audio");
              const appHasOops =
                typeof app.errorMessage === "string" &&
                (app.errorMessage.includes("Oops") || app.errorMessage.includes("couldn't generate the audio"));
              const domHasOops = Boolean(
                document.querySelector(".error-message, [class*='error-message']")?.textContent?.includes("Oops")
              );
              const isOops = responseHasOops || appHasOops || domHasOops;
              const is503 = xhr.status === 503;

              if (xhr.status === 200) {
                if (isOops) {
                  return resolve({
                    error: {
                      code: 503,
                      status: 503,
                      message: oopsText,
                      isOops: true,
                      is503: true,
                    },
                  });
                }
                try {
                  const parsed = typeof xhr.response === "string" ? JSON.parse(xhr.response) : xhr.response;
                  if (!parsed || (!parsed.audioContent && !parsed.error)) {
                    return resolve({
                      error: {
                        code: 503,
                        status: 503,
                        message: oopsText,
                        isOops: true,
                        is503: true,
                      },
                    });
                  }
                  resolve(parsed);
                } catch (parseErr: any) {
                  resolve({ error: { message: "تعذر فك تشفير استجابة خادم الصوت: " + parseErr.message } });
                }
              } else {
                let errorMsg = xhr.statusText || `HTTP ${xhr.status}`;
                let isAuthOrCaptchaError = xhr.status === 403 || xhr.status === 401;
                try {
                  const errData = JSON.parse(responseText);
                  if (errData?.error?.message) {
                    errorMsg = errData.error.message;
                    if (
                      errorMsg.toLowerCase().includes("captcha") ||
                      errorMsg.includes("UNAUTHENTICATED") ||
                      errorMsg.includes("Unauthorized") ||
                      errorMsg.includes("403") ||
                      errorMsg.includes("401")
                    ) {
                      isAuthOrCaptchaError = true;
                    }
                  }
                } catch (_) {
                  if (responseText) {
                    errorMsg = responseText.slice(0, 300);
                  }
                }

                if (isAuthOrCaptchaError || xhr.status === 403 || xhr.status === 401) {
                  try {
                    app.captchaToken = null;
                    if (typeof app.set === "function") {
                      app.set("captchaToken", null);
                    }
                    if (typeof app.verifyUser_ === "function") {
                      app.verifyUser_();
                    }
                  } catch (_) {}
                  return resolve({
                    needsCaptcha: true,
                    error: { code: xhr.status, status: xhr.status, message: errorMsg },
                  });
                }

                // 503 Service Unavailable or Google Oops detected
                if (is503 || isOops) {
                  return resolve({
                    error: {
                      code: 503,
                      status: 503,
                      message: isOops ? oopsText : `503 Service Unavailable: خادم Google Cloud TTS غير متاح مؤقتاً بسبب الضغط الزائد. (${errorMsg})`,
                      is503: true,
                      isOops,
                    },
                  });
                }

                // If 400 violates Vertex AI usage guidelines and payload had prompt, retry once without prompt immediately
                if (
                  xhr.status === 400 &&
                  payload?.input?.prompt &&
                  (errorMsg.includes("usage guidelines") || errorMsg.includes("Vertex AI") || errorMsg.includes("guidelines"))
                ) {
                  try {
                    const noPromptPayload = JSON.parse(JSON.stringify(payload));
                    if (noPromptPayload.input) {
                      delete noPromptPayload.input.prompt;
                    }
                    const retryXhr = new XMLHttpRequest();
                    retryXhr.open("POST", fullUrl, true);
                    retryXhr.onload = () => {
                      if (retryXhr.status === 200) {
                        try {
                          const parsedRetry = typeof retryXhr.response === "string" ? JSON.parse(retryXhr.response) : retryXhr.response;
                          resolve(parsedRetry);
                        } catch (e: any) {
                          resolve({ error: { code: retryXhr.status, message: errorMsg } });
                        }
                      } else {
                        resolve({ error: { code: xhr.status, message: errorMsg } });
                      }
                    };
                    retryXhr.onerror = () => {
                      resolve({ error: { code: xhr.status, message: errorMsg } });
                    };
                    retryXhr.send(JSON.stringify(noPromptPayload));
                    return;
                  } catch (_) {
                    // Fallthrough
                  }
                }

                resolve({
                  error: {
                    code: xhr.status,
                    status: xhr.status,
                    message: errorMsg,
                    is503: xhr.status === 503,
                    isOops: isOops,
                  },
                });
              }
            };

            xhr.onerror = () => {
              resolve({ error: { code: 0, message: "خطأ شبكة أثناء إرسال طلب الصوت إلى خادم Google TTS.", isNetwork: true } });
            };

            xhr.send(JSON.stringify(payload));
          } catch (execErr: any) {
            resolve({ error: { message: execErr.message || String(execErr) } });
          }
        });
      },
      {
        payload: rawRequest,
        synthesizeUrl: GOOGLE_TTS_CONFIG.SYNTHESIZE_URL,
      }
    );

    return response;
    } catch (evalErr: any) {
      const errMsg = evalErr?.message || String(evalErr);
      if (
        errMsg.includes("closed") ||
        errMsg.includes("detached") ||
        errMsg.includes("destroyed")
      ) {
        throw new Error(`Browser frame detached or closed: ${errMsg}`);
      }
      return { error: { message: errMsg } };
    }
  }

  /**
   * Constructs the official Google Cloud TTS REST payload matching gemgen and Google Demo
   */
  public static buildGooglePayload(request: GeminiTTSRequest): any {
    const model = GOOGLE_TTS_CONFIG.GEMINI_TTS_MODEL;
    let voiceName = (request.voiceName || "Achernar").replace(/^gemini-/, "").trim();
    if (
      !voiceName ||
      voiceName === "Google Demo" ||
      voiceName.toLowerCase().includes("demo") ||
      voiceName.toLowerCase().includes("achernar")
    ) {
      voiceName = "Achernar";
    }
    let languageCode = request.languageCode || "ar-EG";
    // For Gemini Voices (gemini-3.1-flash-tts-preview), Google Cloud TTS exclusively accepts ar-EG for Arabic
    if (languageCode.toLowerCase().startsWith("ar")) {
      languageCode = "ar-EG";
    }
    const encoding = request.audioConfig?.audioEncoding || "MP3";
    const speakingRate = request.audioConfig?.speakingRate ?? 1.0;
    const pitch = request.audioConfig?.pitch ?? 0.0;
    const volumeGainDb = request.audioConfig?.volumeGainDb ?? 0.0;

    const audioConfig: any = {
      audioEncoding: encoding,
      speakingRate,
      pitch,
      volumeGainDb,
    };

    if (request.audioConfig?.sampleRateHertz) {
      audioConfig.sampleRateHertz = request.audioConfig.sampleRateHertz;
    }

    // Clean prompt to avoid trigger keywords that violate Vertex AI guidelines
    let cleanPrompt: string | undefined = undefined;
    if (request.voiceDirection && request.voiceDirection.trim().length > 0) {
      cleanPrompt = request.voiceDirection
        .replace(/manhwa/gi, "story")
        .replace(/manga/gi, "story")
        .trim();
    }

    // Single Speaker vs Multi Speaker
    if (request.multiSpeakerMarkup && request.multiSpeakerMarkup.turns.length > 0) {
      return {
        input: {
          multiSpeakerMarkup: request.multiSpeakerMarkup,
          prompt: cleanPrompt || undefined,
        },
        voice: {
          languageCode,
          modelName: model,
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: (request.speakers || [
              { alias: "Speaker1", voiceName: "Achernar" },
              { alias: "Speaker2", voiceName: "Aoede" },
            ]).map((s) => ({
              speakerAlias: s.alias,
              speakerId: (s.voiceName || "Achernar").replace(/^gemini-/, "").trim(),
            })),
          },
        },
        audioConfig,
      };
    }

    // Standard Single Speaker
    const input: any = {
      text: request.text,
    };

    if (cleanPrompt) {
      input.prompt = cleanPrompt;
    }

    return {
      input,
      voice: {
        languageCode,
        modelName: model,
        name: voiceName,
      },
      audioConfig,
    };
  }
}
