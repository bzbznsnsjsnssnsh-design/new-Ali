// Types for Gemini TTS Frontend & Service layers

export type AudioEncoding = "MP3" | "OGG_OPUS" | "LINEAR16" | "PCM" | "ALAW" | "MULAW";

export interface GeminiAudioConfig {
  audioEncoding: AudioEncoding;
  speakingRate: number; // 0.25 to 4.0 (default 1.0)
  pitch: number; // -20.0 to 20.0 (default 0.0)
  volumeGainDb: number; // -96.0 to 16.0 (default 0.0)
  sampleRateHertz?: number;
}

export interface GeminiSpeakerConfig {
  alias: string;
  voiceName: string;
}

export interface GeminiSpeakerTurn {
  speaker: string;
  text: string;
}

export interface GeminiTTSRequest {
  text: string;
  voiceName?: string;
  languageCode?: string;
  modelName?: string;
  voiceDirection?: string;
  generationId?: string;
  segmentId?: string;
  speech_config?: {
    voice_config: {
      prebuilt_voice_config: {
        voice_name: string;
      };
    };
  };
  speechConfig?: {
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: string;
      };
    };
  };
  audioConfig?: Partial<GeminiAudioConfig>;
  multiSpeakerMarkup?: {
    turns: GeminiSpeakerTurn[];
  };
  speakers?: GeminiSpeakerConfig[];
  useDirectFallback?: boolean;
  allowFallback?: boolean;
}

export interface GeminiTTSResponse {
  audioBase64: string;
  mimeType: string;
  voiceName: string;
  modelName: string;
  languageCode: string;
  byteLength: number;
  cached?: boolean;
  fallbackUsed?: boolean;
  generationId?: string;
  segmentId?: string;
}

export interface GeminiVoiceInfo {
  name: string;
  gender: "Male" | "Female" | "Neutral";
  description: string;
  traits: string[];
  recommendedFor: string[];
}

export interface GeminiLanguageInfo {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export type GeminiTTSSegmentStatus =
  | "idle"
  | "pending"
  | "queued"
  | "generating"
  | "processing"
  | "retrying"
  | "ready"
  | "completed"
  | "paused_captcha"
  | "failed";

export interface GeminiTTSJobSnapshot {
  jobId: string;
  generationId: string;
  segmentId: string;
  voiceName: string;
  modelName: string;
  languageCode: string;
  voiceDirection?: string;
  text: string;
  audioConfig?: Partial<GeminiAudioConfig>;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
}

export interface GeminiTTSBatchItem {
  id: string;
  title?: string;
  text: string;
  voiceDirection?: string;
  voiceName: string; // Strictly locked to chosen voice
  generationId?: string;
  segmentId?: string;
  status: GeminiTTSSegmentStatus;
  retryCount?: number;
  maxRetries?: number;
  progress?: number;
  result?: GeminiTTSResponse;
  error?: string;
  audioUrl?: string;
}

export interface GeminiTTSLiveStatus {
  isProcessing: boolean;
  isBrowserReady: boolean;
  pageReady: boolean;
  raptor?: {
    verifiedAvailable: boolean;
    status: "RAPTOR_AVAILABLE" | "RAPTOR_UNAVAILABLE";
    isLoadedInBrowser: boolean;
    serviceWorkerUrl: string | null;
    version?: string;
    author?: string;
    name?: string;
    details: string;
  };
  buster?: {
    verifiedAvailable: boolean;
    status: "BUSTER_AVAILABLE" | "BUSTER_UNAVAILABLE" | "RAPTOR_AVAILABLE" | "RAPTOR_UNAVAILABLE";
    isLoadedInBrowser: boolean;
    serviceWorkerUrl: string | null;
    version?: string;
    author?: string;
    details: string;
  };
  captcha: {
    status: "NONE" | "REQUIRED" | "PENDING" | "COMPLETED" | "TIMEOUT";
    needsCaptcha: boolean;
    hasCaptchaToken: boolean;
    hasRecaptchaFrames: boolean;
    raptorDetected?: boolean;
    busterDetected: boolean;
    isDosBlocked?: boolean;
    message: string;
  };
  model: string;
}
