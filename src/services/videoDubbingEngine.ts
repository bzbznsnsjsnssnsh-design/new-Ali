import { DubbingConfig, DubbingSegment, SpeechItem } from "../types/videoDubbing";

export class VideoDubbingEngine {
  public config: DubbingConfig = {
    provider: "gemini_cookies",
    geminiModel: "3.6-flash",
    ttsVoice: "ar-SA-HamedNeural",
    ttsSpeed: 1.0,
    originalVolume: 0.25,
    dubbingVolume: 1.0,
    originalMuted: false,
    dubbingMuted: false,
    speakerVoices: {},
    targetLanguage: "ar",
  };

  public videoDuration: number = 0;
  public segments: DubbingSegment[] = [];
  private videoElement: HTMLVideoElement | null = null;

  constructor(initialConfig?: Partial<DubbingConfig>) {
    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }
  }

  public attachVideo(video: HTMLVideoElement): () => void {
    this.videoElement = video;
    video.volume = this.config.originalMuted ? 0 : this.config.originalVolume;
    return () => {
      if (this.videoElement === video) {
        this.videoElement = null;
      }
    };
  }

  public setOriginalVolume(vol: number): void {
    this.config.originalVolume = Math.max(0, Math.min(1, vol));
    if (this.videoElement && !this.config.originalMuted) {
      this.videoElement.volume = this.config.originalVolume;
    }
  }

  public setDubbingVolume(vol: number): void {
    this.config.dubbingVolume = Math.max(0, Math.min(1, vol));
  }

  public toggleOriginalMute(): void {
    this.config.originalMuted = !this.config.originalMuted;
    if (this.videoElement) {
      this.videoElement.volume = this.config.originalMuted ? 0 : this.config.originalVolume;
    }
  }

  public toggleDubbingMute(): void {
    this.config.dubbingMuted = !this.config.dubbingMuted;
  }

  public setTtsSpeed(speed: number): void {
    this.config.ttsSpeed = speed;
  }

  public getActiveSpeechItem(currentTime: number): SpeechItem | null {
    for (const seg of this.segments) {
      for (const item of seg.items) {
        if (currentTime >= item.absoluteStart && currentTime <= item.absoluteEnd) {
          return item;
        }
      }
    }
    return null;
  }
}
