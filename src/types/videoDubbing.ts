export type VideoSourceType =
  | 'DIRECT_VIDEO'
  | 'HLS'
  | 'DASH'
  | 'HTML_PAGE'
  | 'LOCAL_FILE'
  | 'AUTHENTICATED_SOURCE'
  | 'DRM_PROTECTED'
  | 'UNSUPPORTED';

export interface VideoTrackInfo {
  id: string | number;
  label: string;
  language?: string;
  kind?: string;
  codec?: string;
  channels?: number;
  selected?: boolean;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
  fps?: number;
  bitrate?: number;
  audioTracks: VideoTrackInfo[];
  subtitleTracks: VideoTrackInfo[];
}

export type DubbingSegmentState =
  | 'PENDING'
  | 'PROCESSING'
  | 'ANALYZING'
  | 'TRANSLATING'
  | 'TTS'
  | 'SYNCING'
  | 'READY'
  | 'PLAYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface SpeechItem {
  id: string;
  start: number; // Seconds relative to segment
  end: number; // Seconds relative to segment
  absoluteStart: number; // Absolute video timeline seconds
  absoluteEnd: number; // Absolute video timeline seconds
  speaker: string; // e.g. "speaker_1", "speaker_2"
  source_text: string;
  arabic_text: string;
  audioBase64?: string;
  audioMimeType?: string;
  audioDuration?: number;
  targetDuration?: number;
  status: 'pending' | 'synthesizing' | 'ready' | 'failed';
  error?: string;
}

export interface DubbingSegment {
  id: string;
  segmentIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  actualStart?: number;
  actualEnd?: number;
  actualDuration?: number;
  state: DubbingSegmentState;
  items: SpeechItem[];
  error?: string;
  retryCount: number;
  processedAt?: number;
}

export interface DubbingConfig {
  provider: 'gemini_cookies' | 'gemini_api';
  geminiModel: string;
  ttsVoice: string;
  ttsSpeed: number; // 0.75, 0.85, 1.0, 1.1, 1.25, 1.5
  originalVolume: number; // 0.0 - 1.0
  dubbingVolume: number; // 0.0 - 1.0
  originalMuted: boolean;
  dubbingMuted: boolean;
  speakerVoices: Record<string, string>; // Map speaker_1 -> voice
  targetLanguage: string;
}

export interface VideoAnalysisResult {
  sourceType: VideoSourceType;
  streamUrl: string;
  directUrl?: string;
  proxyUrl?: string;
  title: string;
  metadata?: VideoMetadata;
  isDrm: boolean;
  requiresAuth: boolean;
  errorMessage?: string;
  rangeSupport?: boolean;
  contentLength?: number;
  contentType?: string;
}
