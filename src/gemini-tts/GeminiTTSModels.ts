// Gemini TTS Model definitions

export const GEMINI_TTS_MODELS = {
  DEFAULT_MODEL: "gemini-3.1-flash-tts-preview",
  MODELS: [
    {
      id: "gemini-3.1-flash-tts-preview",
      displayName: "Gemini 3.1 Flash TTS Preview",
      version: "3.1-preview",
      description: "الجيل الأحدث والأقوى من نماذج Gemini لتحويل النص إلى كلام فائق الطبيعية مع توجيه النبرة والمشاعر ودعم الحوار متعدد الشخصيات.",
      supportsVoiceDirection: true,
      supportsMultiSpeaker: true,
      supportsArabic: true,
      maxTextLength: 4000,
      maxPromptLength: 4000,
    },
  ],
} as const;
