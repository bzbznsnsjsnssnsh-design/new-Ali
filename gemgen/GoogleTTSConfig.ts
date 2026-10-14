export type AudioEncoding = "MP3" | "LINEAR16" | "OGG_OPUS";

export const GOOGLE_TTS_CONFIG = {
  DEMO_URL: "https://cloud.google.com/text-to-speech",
  SYNTHESIZE_ENDPOINT: "https://texttospeech.googleapis.com/v1beta1/text:synthesize",
  DEFAULT_MODEL: "gemini-3.1-flash-tts-preview",
  DEFAULT_VOICE: "Achernar",
  DEFAULT_LANGUAGE: "ar-EG",
  TIMEOUT_MS: 60000,
};
