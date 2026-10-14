import React, { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Settings,
  Sparkles,
  Headphones,
  Sliders,
  Tv,
  Subtitles,
  AudioLines,
  Gauge,
  Loader2,
  ShieldCheck,
  RefreshCw,
  Radio,
  Check
} from "lucide-react";
import { VideoDubbingEngine } from "../../services/videoDubbingEngine";
import { SpeechItem, VideoMetadata, VideoSourceType } from "../../types/videoDubbing";

interface UniversalVideoPlayerProps {
  src: string;
  proxyUrl?: string;
  directUrl?: string;
  sourceType: VideoSourceType;
  metadata?: VideoMetadata;
  dubbingEngine: VideoDubbingEngine;
  onOpenSettings: () => void;
  onStartDubbing: () => void;
  isDubbingActive: boolean;
  activeSpeechItem: SpeechItem | null;
  onTimeChange?: (currentTime: number, duration: number) => void;
}

export const UniversalVideoPlayer: React.FC<UniversalVideoPlayerProps> = ({
  src,
  proxyUrl,
  directUrl,
  sourceType,
  metadata,
  dubbingEngine,
  onOpenSettings,
  onStartDubbing,
  isDubbingActive,
  activeSpeechItem,
  onTimeChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Active playing stream URL (allows switching between direct and proxy)
  const [activeStreamUrl, setActiveStreamUrl] = useState<string>(src);
  const [isUsingProxy, setIsUsingProxy] = useState<boolean>(
    src.includes("/api/video/stream-proxy") || (directUrl ? directUrl.includes("pixeldrain.com") : false)
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showSubtitles, setShowSubtitles] = useState(true);

  // Volume state
  const [originalVol, setOriginalVol] = useState(dubbingEngine.config.originalVolume);
  const [dubbingVol, setDubbingVol] = useState(dubbingEngine.config.dubbingVolume);
  const [originalMuted, setOriginalMuted] = useState(dubbingEngine.config.originalMuted);
  const [dubbingMuted, setDubbingMuted] = useState(dubbingEngine.config.dubbingMuted);
  const [ttsSpeed, setTtsSpeed] = useState(dubbingEngine.config.ttsSpeed || 1.0);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const controlsTimeoutRef = useRef<any>(null);

  // Sync with prop change
  useEffect(() => {
    setActiveStreamUrl(src);
    setIsUsingProxy(src.includes("/api/video/stream-proxy"));
    setErrorMsg(null);
  }, [src]);

  // Handle Fullscreen state change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Initialize Video element and HLS.js
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeStreamUrl) return;

    let hls: Hls | null = null;
    setErrorMsg(null);
    setIsBuffering(true);

    const isHlsStream =
      sourceType === "HLS" ||
      activeStreamUrl.includes(".m3u8") ||
      (activeStreamUrl.includes("stream-proxy") && activeStreamUrl.includes(".m3u8"));

    if (isHlsStream) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90
        });
        hls.loadSource(activeStreamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.warn("[HLS Fatal Error]", data.type, data.details);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && proxyUrl && !isUsingProxy) {
              console.log("[HLS] Attempting fallback to stream proxy...");
              setIsUsingProxy(true);
              setActiveStreamUrl(proxyUrl);
            } else {
              setErrorMsg(`خطأ في تشغيل بث HLS: ${data.details}`);
            }
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = activeStreamUrl;
      }
    } else {
      video.src = activeStreamUrl;
    }

    const cleanupEngine = dubbingEngine.attachVideo(video);

    const onPlay = () => {
      setIsPlaying(true);
      setIsBuffering(false);
    };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);

    const onTimeUpdate = () => {
      const cur = video.currentTime;
      setCurrentTime(cur);
      if (video.buffered.length > 0) {
        setBufferedEnd(video.buffered.end(video.buffered.length - 1));
      }
      if (onTimeChange && video.duration) {
        onTimeChange(cur, video.duration);
      }
    };

    const onDurationChange = () => {
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
        setDuration(video.duration);
        dubbingEngine.videoDuration = video.duration;
        if (onTimeChange) {
          onTimeChange(video.currentTime, video.duration);
        }
      }
    };

    const onError = () => {
      setIsBuffering(false);
      const mediaErr = video.error;
      console.warn("[Video Tag Error]", mediaErr?.code, mediaErr?.message);

      // Auto fallback to CORS Proxy if direct playback failed
      if (proxyUrl && !isUsingProxy) {
        console.log("[Video Player] Direct stream failed, switching automatically to CORS byte-range proxy...");
        setIsUsingProxy(true);
        setActiveStreamUrl(proxyUrl);
      } else {
        setErrorMsg(
          mediaErr?.code === 4
            ? "تعذر فك تشفير الفيديو أو أن المصدر غير مدعوم مباشرة."
            : "حدث خطأ في تحميل تدفق الفيديو، يرجى فحص الرابط أو استخدام البروكسي."
        );
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("error", onError);
      cleanupEngine();
      if (hls) hls.destroy();
    };
  }, [activeStreamUrl, sourceType]);

  // Show/hide controls overlay in Fullscreen
  const handleUserActivity = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3500);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  };

  const handleSeekRelative = (delta: number) => {
    if (!videoRef.current) return;
    const target = Math.max(0, Math.min(duration || 999999, videoRef.current.currentTime + delta));
    videoRef.current.currentTime = target;
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !videoRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = pos * duration;
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (_) {}
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs)) return "00:00";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const changePlaybackRate = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  // Audio Presets
  const applyAudioPreset = (dVol: number, oVol: number) => {
    setDubbingVol(dVol);
    setOriginalVol(oVol);
    dubbingEngine.setDubbingVolume(dVol);
    dubbingEngine.setOriginalVolume(oVol);
    if (dubbingMuted) {
      dubbingEngine.toggleDubbingMute();
      setDubbingMuted(false);
    }
    if (originalMuted) {
      dubbingEngine.toggleOriginalMute();
      setOriginalMuted(false);
    }
  };

  const toggleStreamRoute = () => {
    if (isUsingProxy) {
      if (directUrl) {
        setIsUsingProxy(false);
        setActiveStreamUrl(directUrl);
      }
    } else {
      if (proxyUrl) {
        setIsUsingProxy(true);
        setActiveStreamUrl(proxyUrl);
      }
    }
  };

  return (
    <div className="space-y-4 font-sans text-right dir-rtl">
      {/* =========================================================================
          SECTION 2: VIDEO PLAYER
      ========================================================================= */}
      <div
        ref={containerRef}
        onMouseMove={handleUserActivity}
        onTouchStart={handleUserActivity}
        className="relative w-full aspect-video bg-neutral-950 rounded-2xl overflow-hidden shadow-2xl border border-neutral-800 group select-none flex items-center justify-center"
      >
        {/* Native HTML5 Video Element */}
        <video
          ref={videoRef}
          playsInline
          crossOrigin="anonymous"
          onClick={togglePlay}
          className="w-full h-full object-contain cursor-pointer"
        />

        {/* Buffering Indicator */}
        {isBuffering && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center pointer-events-none z-20">
            <div className="p-3.5 rounded-2xl bg-neutral-900/90 border border-neutral-700/80 shadow-2xl flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
              <span className="text-xs font-bold text-white">جاري تحميل تدفق الفيديو...</span>
            </div>
          </div>
        )}

        {/* Double-tap zones for Mobile Seek (-10s / +10s) */}
        <div
          onDoubleClick={() => handleSeekRelative(-10)}
          className="absolute left-0 top-0 w-1/4 h-full z-10 cursor-pointer"
          title="انقر مرتين للرجوع 10 ثوانٍ"
        />
        <div
          onDoubleClick={() => handleSeekRelative(10)}
          className="absolute right-0 top-0 w-1/4 h-full z-10 cursor-pointer"
          title="انقر مرتين للتقديم 10 ثوانٍ"
        />

        {/* Play/Pause Overlay Icon on Hover/Pause in Video */}
        {!isPlaying && !isBuffering && (
          <button
            onClick={togglePlay}
            className="absolute z-20 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-neutral-900/85 hover:bg-emerald-600 text-white border border-neutral-700 hover:border-emerald-400 flex items-center justify-center transition-all transform hover:scale-105 shadow-2xl backdrop-blur-md"
            title="تشغيل"
          >
            <Play className="w-8 h-8 sm:w-9 sm:h-9 fill-white translate-x-0.5" />
          </button>
        )}

        {/* Live Arabic Subtitles Overlay (Floating above video bottom) */}
        {showSubtitles && activeSpeechItem && (
          <div className="absolute bottom-6 sm:bottom-8 left-4 right-4 z-20 pointer-events-none flex flex-col items-center text-center animate-in fade-in duration-150">
            <div className="bg-black/90 backdrop-blur-md border border-emerald-500/50 rounded-2xl px-5 py-2.5 max-w-2xl shadow-2xl shadow-black">
              <p className="text-white text-sm sm:text-base md:text-lg font-bold leading-relaxed text-right dir-rtl">
                {activeSpeechItem.arabic_text}
              </p>
              {activeSpeechItem.speaker && (
                <div className="flex items-center justify-center gap-1.5 mt-1 text-[11px] text-emerald-400 font-mono">
                  <span>🎙️</span>
                  <span>{activeSpeechItem.speaker}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Playback Error Banner */}
        {errorMsg && (
          <div className="absolute inset-x-4 top-4 z-30 p-3 bg-red-950/90 border border-red-800 rounded-xl text-xs text-red-200 flex items-center justify-between shadow-2xl">
            <span>{errorMsg}</span>
            {proxyUrl && (
              <button
                onClick={toggleStreamRoute}
                className="px-3 py-1 rounded-lg bg-red-800 hover:bg-red-700 text-white font-bold text-xs"
              >
                تفعيل وضع البروكسي
              </button>
            )}
          </div>
        )}

        {/* Fullscreen Floating Controls Overlay (Visible only when in Fullscreen) */}
        {isFullscreen && (
          <div
            className={`absolute inset-x-0 bottom-0 z-40 p-4 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 ${
              showControls ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            {/* Scrubber in Fullscreen */}
            <div
              onClick={handleProgressBarClick}
              className="relative h-2 bg-neutral-800 rounded-full cursor-pointer mb-3"
            >
              {duration > 0 && (
                <div
                  style={{ width: `${(bufferedEnd / duration) * 100}%` }}
                  className="absolute top-0 bottom-0 left-0 bg-neutral-600 rounded-full"
                />
              )}
              {duration > 0 && (
                <div
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                  className="absolute top-0 bottom-0 left-0 bg-emerald-500 rounded-full"
                />
              )}
            </div>

            <div className="flex items-center justify-between flex-row-reverse text-white text-xs">
              <div className="flex items-center gap-2 flex-row-reverse">
                <button onClick={togglePlay} className="p-2 hover:bg-white/10 rounded-lg">
                  {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
                </button>
                <div className="font-mono dir-ltr">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-row-reverse">
                <button onClick={toggleFullscreen} className="p-2 hover:bg-white/10 rounded-lg">
                  <Minimize className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          SECTION 3: PLAYER CONTROLS CARD
      ========================================================================= */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        {/* Header of Section 3: Status & Route */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-neutral-800/80 pb-3">
          <div className="flex items-center gap-2 flex-row-reverse">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-white">التحكم في تشغيل الفيديو</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
              {sourceType}
            </span>
          </div>

          {/* Stream Route Toggle (Direct vs Proxy CORS) */}
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={toggleStreamRoute}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all flex items-center gap-1.5 flex-row-reverse ${
                isUsingProxy
                  ? "bg-emerald-950/60 border-emerald-600/80 text-emerald-300"
                  : "bg-neutral-800/80 border-neutral-700 text-neutral-300 hover:text-white"
              }`}
              title="التبديل بين تشغيل الفيديو المباشر أو تمريره عبر خادم البروكسي الداخلي لتجاوز قيود CORS"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isUsingProxy ? "مسار البروكسي (CORS Bypass)" : "مسار البث المباشر"}</span>
              <RefreshCw className="w-3 h-3 text-neutral-400" />
            </button>
          </div>
        </div>

        {/* Scrubber Progress Bar */}
        <div className="space-y-1">
          <div
            ref={progressBarRef}
            onClick={handleProgressBarClick}
            className="relative h-2.5 hover:h-3.5 bg-neutral-800 rounded-full cursor-pointer transition-all group/progress"
          >
            {/* Buffered Progress */}
            {duration > 0 && (
              <div
                style={{ width: `${(bufferedEnd / duration) * 100}%` }}
                className="absolute top-0 bottom-0 left-0 bg-neutral-700/70 rounded-full pointer-events-none"
              />
            )}
            {/* Play Progress */}
            {duration > 0 && (
              <div
                style={{ width: `${(currentTime / duration) * 100}%` }}
                className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full pointer-events-none relative"
              >
                <span className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md scale-0 group-hover/progress:scale-100 transition-transform" />
              </div>
            )}
          </div>
        </div>

        {/* Primary Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Actions: Play/Pause, Seek buttons, Time */}
          <div className="flex items-center gap-2 flex-row-reverse">
            {/* Big Play/Pause Button */}
            <button
              onClick={togglePlay}
              className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all min-w-[44px] min-h-[44px] flex items-center justify-center shadow-lg shadow-emerald-950/50"
              title={isPlaying ? "إيقاف مؤقت" : "تشغيل"}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white translate-x-0.5" />}
            </button>

            {/* Jump -10s */}
            <button
              onClick={() => handleSeekRelative(-10)}
              className="p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-all min-w-[44px] min-h-[44px] flex items-center justify-center border border-neutral-700/60"
              title="تراجع 10 ثوانٍ"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Jump +10s */}
            <button
              onClick={() => handleSeekRelative(10)}
              className="p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-all min-w-[44px] min-h-[44px] flex items-center justify-center border border-neutral-700/60"
              title="تقديم 10 ثوانٍ"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Time Stamp */}
            <div className="text-xs font-mono font-bold text-neutral-300 px-2 dir-ltr bg-neutral-950/60 py-2 rounded-xl border border-neutral-800">
              <span>{formatTime(currentTime)}</span>
              <span className="text-neutral-500 mx-1.5">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right Actions: Speed Chips, PiP, Fullscreen */}
          <div className="flex items-center gap-1.5 flex-row-reverse">
            {/* Playback Speed Chips */}
            <div className="flex items-center gap-1 bg-neutral-950 border border-neutral-800 p-1 rounded-xl">
              {[0.75, 1.0, 1.25, 1.5].map((rate) => (
                <button
                  key={rate}
                  onClick={() => changePlaybackRate(rate)}
                  className={`px-2 py-1 rounded-lg text-xs font-mono transition-all ${
                    playbackRate === rate
                      ? "bg-emerald-600 text-white font-bold shadow-sm"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* PiP Button */}
            <button
              onClick={togglePiP}
              className="p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-all min-w-[44px] min-h-[44px] flex items-center justify-center border border-neutral-700/60"
              title="صورة داخل صورة (PiP)"
            >
              <Tv className="w-4 h-4" />
            </button>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition-all min-w-[44px] min-h-[44px] flex items-center justify-center border border-neutral-700/60"
              title={isFullscreen ? "تصغير الشاشة" : "ملء الشاشة"}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SECTION 4: AUDIO & SUBTITLE CONTROLS CARD
      ========================================================================= */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between flex-row-reverse border-b border-neutral-800/80 pb-3">
          <div className="flex items-center gap-2 flex-row-reverse">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-white">التحكم في الصوت المزدوج والترجمة</h3>
          </div>

          {/* Subtitle Visibility Toggle */}
          <button
            onClick={() => setShowSubtitles(!showSubtitles)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 flex-row-reverse ${
              showSubtitles
                ? "bg-emerald-950/60 border-emerald-500/80 text-emerald-300"
                : "bg-neutral-800/80 border-neutral-700 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <Subtitles className="w-3.5 h-3.5" />
            <span>{showSubtitles ? "الترجمة المكتوبة: ظاهرة" : "الترجمة المكتوبة: مخفية"}</span>
          </button>
        </div>

        {/* Audio & Speed Sliders Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1. Arabic Dubbing Volume */}
          <div className="p-3.5 bg-neutral-950/70 border border-neutral-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between flex-row-reverse text-xs">
              <span className="font-bold text-emerald-400 flex items-center gap-1.5 flex-row-reverse">
                <Headphones className="w-4 h-4" />
                <span>صوت الدبلجة (Web Audio)</span>
              </span>
              <span className="font-mono text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60 font-bold">
                {dubbingMuted ? "مكتوم (0%)" : `${Math.round(dubbingVol * 100)}%`}
              </span>
            </div>

            <div className="flex items-center gap-3 flex-row-reverse">
              <button
                onClick={() => {
                  dubbingEngine.toggleDubbingMute();
                  setDubbingMuted(dubbingEngine.config.dubbingMuted);
                }}
                className={`p-2 rounded-lg transition-all ${
                  dubbingMuted ? "bg-red-950/80 text-red-400" : "bg-neutral-800 text-neutral-300 hover:text-white"
                }`}
                title="كتم / إلغاء كتم الدبلجة"
              >
                {dubbingMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={dubbingMuted ? 0 : dubbingVol}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setDubbingVol(val);
                  dubbingEngine.setDubbingVolume(val);
                  if (dubbingMuted) {
                    dubbingEngine.toggleDubbingMute();
                    setDubbingMuted(false);
                  }
                }}
                className="w-full accent-emerald-500 h-2 bg-neutral-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* 2. Original Video Volume */}
          <div className="p-3.5 bg-neutral-950/70 border border-neutral-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between flex-row-reverse text-xs">
              <span className="font-medium text-neutral-300 flex items-center gap-1.5 flex-row-reverse">
                <AudioLines className="w-4 h-4 text-neutral-400" />
                <span>صوت الفيديو الأصلي</span>
              </span>
              <span className="font-mono text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
                {originalMuted ? "مكتوم (0%)" : `${Math.round(originalVol * 100)}%`}
              </span>
            </div>

            <div className="flex items-center gap-3 flex-row-reverse">
              <button
                onClick={() => {
                  dubbingEngine.toggleOriginalMute();
                  setOriginalMuted(dubbingEngine.config.originalMuted);
                }}
                className={`p-2 rounded-lg transition-all ${
                  originalMuted ? "bg-red-950/80 text-red-400" : "bg-neutral-800 text-neutral-300 hover:text-white"
                }`}
                title="كتم / إلغاء كتم الصوت الأصلي"
              >
                {originalMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={originalMuted ? 0 : originalVol}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setOriginalVol(val);
                  dubbingEngine.setOriginalVolume(val);
                  if (originalMuted) {
                    dubbingEngine.toggleOriginalMute();
                    setOriginalMuted(false);
                  }
                }}
                className="w-full accent-neutral-400 h-2 bg-neutral-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* 3. TTS Speech Speed Slider (1.0x - 2.0x) */}
          <div className="p-3.5 bg-neutral-950/70 border border-neutral-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between flex-row-reverse text-xs">
              <span className="font-bold text-teal-400 flex items-center gap-1.5 flex-row-reverse">
                <Gauge className="w-4 h-4" />
                <span>سرعة الإلقاء (TTS Speed)</span>
              </span>
              <span className="font-mono text-teal-300 bg-teal-950/80 px-2 py-0.5 rounded border border-teal-800/60 font-bold">
                {Number(ttsSpeed || 1.0).toFixed(2)}x
              </span>
            </div>

            <div className="flex items-center gap-3 flex-row-reverse">
              <button
                onClick={() => {
                  const nextSpeed = ttsSpeed === 1.0 ? 1.25 : ttsSpeed === 1.25 ? 1.5 : 1.0;
                  setTtsSpeed(nextSpeed);
                  dubbingEngine.setTtsSpeed(nextSpeed);
                }}
                className="p-2 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white text-xs font-mono font-bold"
                title="التبديل السريع لسرعة الإلقاء"
              >
                ⚡
              </button>

              <input
                type="range"
                min="1.0"
                max="2.0"
                step="0.05"
                value={ttsSpeed}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setTtsSpeed(val);
                  dubbingEngine.setTtsSpeed(val);
                }}
                className="w-full accent-teal-500 h-2 bg-neutral-800 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Audio Mixing Quick Presets */}
        <div className="flex flex-wrap items-center gap-2 flex-row-reverse pt-1">
          <span className="text-[11px] text-neutral-500 font-medium ml-1">توليفات صوتية جاهزة:</span>
          
          <button
            onClick={() => applyAudioPreset(1.0, 0.15)}
            className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/80 text-[11px] text-neutral-300 hover:text-white transition-all"
          >
            🎙️ تركيز الدبلجة (100% / 15%)
          </button>

          <button
            onClick={() => applyAudioPreset(0.9, 0.4)}
            className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/80 text-[11px] text-neutral-300 hover:text-white transition-all"
          >
            ⚖️ متوازن سينمائي (90% / 40%)
          </button>

          <button
            onClick={() => applyAudioPreset(1.0, 0)}
            className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/80 text-[11px] text-neutral-300 hover:text-white transition-all"
          >
            🎧 دبلجة فقط (100% / 0%)
          </button>

          <button
            onClick={() => applyAudioPreset(0, 1.0)}
            className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/80 text-[11px] text-neutral-300 hover:text-white transition-all"
          >
            🔊 الأصل فقط (0% / 100%)
          </button>
        </div>
      </div>
    </div>
  );
};
