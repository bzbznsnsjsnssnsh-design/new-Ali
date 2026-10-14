// Data types for Manhwa Video Creator (🎬 إنشاء فيديوهات المانهاوا)

export type VideoAnimationType = 
  | "pan_down"      // Vertical pan down (essential for tall webtoons)
  | "pan_up"        // Vertical pan up
  | "zoom_in"       // Slow gentle zoom in
  | "zoom_out"      // Slow gentle zoom out
  | "pan_left"      // Horizontal pan to left
  | "pan_right"     // Horizontal pan to right
  | "static";       // Centered static frame

export type VideoAspectRatio = "9:16" | "16:9" | "1:1";
export type VideoResolution = "720p" | "1080p";

export interface GeminiModelOption {
  id: "3.5-flash-lite" | "3.5-flash-lite-extended" | "3.6-flash" | "3.1-pro";
  name: string;
  badge: string;
  description: string;
  features: string;
}

export const VIDEO_GEMINI_MODELS: GeminiModelOption[] = [
  {
    id: "3.5-flash-lite",
    name: "Flash-Lite 3.5",
    badge: "فائق السرعة",
    description: "سرعة قصوى واستجابة فورية بدون أي تأخير، مثالي للتقليب السريع والترجمة الفورية.",
    features: "بدون تفكير موسع (Extended Thinking معطل) • استجابة فائقة"
  },
  {
    id: "3.5-flash-lite-extended",
    name: "Flash-Lite 3.5",
    badge: "تفكير موسع",
    description: "محرك سريع مع تفعيل التفكير الموسع لحل المشاكل المعقدة والصعبة أثناء الترجمة.",
    features: "تفكير موسع (Extended Thinking مفعّل) • استجابة مركزة"
  },
  {
    id: "3.6-flash",
    name: "Flash 3.6",
    badge: "الموصى به",
    description: "المحرك المتوازن الأكثر كفاءة، سرعة عالية جدًا مع فهم ممتاز لسياق المانجا وفقاعات الحوار.",
    features: "بدون تفكير موسع (Extended Thinking معطل) • استيعاب ذكي لسياق المانجا"
  },
  {
    id: "3.1-pro",
    name: "Pro 3.1",
    badge: "للمشاكل المعقدة",
    description: "أعلى قدرة على حل المشاكل المعقدة، السياقات الصعبة والمؤثرات الصوتية والفقاعات المتداخلة.",
    features: "بدون تفكير موسع (Extended Thinking معطل) • دقة متناهية للمشاكل المعقدة"
  }
];

export interface VideoScene {
  id: string;
  sceneIndex: number;
  pageIndex: number;
  imageUrl: string;
  // Normalized crop region for tall webtoons: [ymin, xmin, ymax, xmax] (0..1000 scale)
  cropBox?: [number, number, number, number];
  isTallImage: boolean;
  aspectRatio: number;
  
  // OCR and region binding
  regionIds: string[];
  speechUnitId?: string;
  
  // Narration and Dialogue in Arabic
  narrationText: string;
  dialogueText?: string;
  
  // Audio
  audioUrl?: string;
  audioBlob?: Blob;
  duration: number; // in seconds, strictly matched to TTS audio duration
  
  // Animation
  animation: VideoAnimationType;
  
  // Timeline positions (in seconds)
  startTime: number;
  endTime: number;
}

export interface VideoCreatorSettings {
  geminiModel: "3.5-flash-lite" | "3.5-flash-lite-extended" | "3.6-flash" | "3.1-pro";
  voiceGroup: "all" | "gemini" | "capcut" | "current" | "chatgpt" | "huggingface";
  voiceName: string;
  playbackSpeed: number;
  voiceDirection: string;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  defaultAnimation: "auto" | VideoAnimationType;
  includeNarrationCaptions: boolean;
  includeSoundEffects: boolean;
}

export interface VideoProject {
  id: string;
  mangaId: string;
  mangaTitle: string;
  coverUrl: string;
  sourceId?: string;
  chapterId: string;
  chapterTitle: string;
  chapterNumber: string;
  pageUrls: string[];
  
  // Settings
  settings: VideoCreatorSettings;
  
  // Timeline & Scenes
  scenes: VideoScene[];
  totalDuration: number;
  
  // Generation & Pipeline state
  status: "idle" | "extracting_panels" | "analyzing_gemini" | "generating_tts" | "ready_preview" | "rendering_mp4" | "completed" | "error";
  progressPercent: number;
  progressStep: string;
  errorMessage?: string;
  
  // Result
  videoBlobUrl?: string;
  createdAt: number;
  updatedAt: number;
}
