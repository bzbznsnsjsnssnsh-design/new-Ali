// Real-Time Canvas & Audio Live Preview Player for Manhwa Video Creator
import React, { useRef, useEffect, useState, useCallback } from "react";
import { 
  Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2, 
  Minimize2, ChevronLeft, ChevronRight, Eye, Film 
} from "lucide-react";
import { VideoScene, VideoAspectRatio } from "./types";
import { renderSceneFrameToCanvas } from "./manhwaVideoRenderer";

interface ManhwaVideoPlayerProps {
  scenes: VideoScene[];
  aspectRatio: VideoAspectRatio;
  totalDuration: number;
  currentSceneIndex: number;
  onSceneChange: (sceneIndex: number) => void;
  showCaptions?: boolean;
}

export default function ManhwaVideoPlayer({
  scenes,
  aspectRatio,
  totalDuration,
  currentSceneIndex,
  onSceneChange,
  showCaptions = true
}: ManhwaVideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Cached image elements for fast instant frame drawing
  const imagesCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const rafIdRef = useRef<number | null>(null);
  const playStartTimeRef = useRef<number>(0);
  const playbackTimeOffsetRef = useRef<number>(0);

  // Format time (mm:ss)
  const formatTime = (secs: number) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`;
  };

  // Preload current, previous and next scene images into cache
  useEffect(() => {
    scenes.forEach((sc) => {
      if (!imagesCacheRef.current.has(sc.imageUrl)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = sc.imageUrl;
        img.onload = () => {
          imagesCacheRef.current.set(sc.imageUrl, img);
          drawCurrentFrame();
        };
      }
    });
  }, [scenes]);

  // Determine active scene based on time
  const getSceneForTime = useCallback((time: number): { scene: VideoScene; index: number; localTime: number; progress: number } => {
    if (scenes.length === 0) {
      return { scene: {} as VideoScene, index: 0, localTime: 0, progress: 0 };
    }
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      if (time >= sc.startTime && time < sc.endTime) {
        const localTime = time - sc.startTime;
        const progress = sc.duration > 0 ? localTime / sc.duration : 0;
        return { scene: sc, index: i, localTime, progress };
      }
    }
    const last = scenes[scenes.length - 1];
    return { scene: last, index: scenes.length - 1, localTime: last.duration, progress: 1 };
  }, [scenes]);

  // Draw current frame to canvas
  const drawCurrentFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || scenes.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { scene, index, progress } = getSceneForTime(playbackTimeOffsetRef.current);
    if (!scene || !scene.imageUrl) return;

    const cachedImg = imagesCacheRef.current.get(scene.imageUrl);
    if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
      renderSceneFrameToCanvas(ctx, cachedImg, scene, progress, canvas.width, canvas.height, showCaptions);
    } else {
      // Draw placeholder while image loads
      ctx.fillStyle = "#090d16";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#64748b";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(`جاري تحميل المشهد ${index + 1}...`, canvas.width / 2, canvas.height / 2);
    }
  }, [scenes, getSceneForTime, showCaptions]);

  // Animation frame loop
  const loop = useCallback(() => {
    if (!isPlaying) return;

    const now = performance.now();
    const elapsed = (now - playStartTimeRef.current) / 1000;
    const newTime = playbackTimeOffsetRef.current + elapsed;

    if (newTime >= totalDuration) {
      // Reached the end
      setIsPlaying(false);
      playbackTimeOffsetRef.current = totalDuration;
      setCurrentTime(totalDuration);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      drawCurrentFrame();
      return;
    }

    setCurrentTime(newTime);
    const { index, scene, localTime } = getSceneForTime(newTime);
    if (index !== currentSceneIndex) {
      onSceneChange(index);
      // Play scene audio if available
      if (audioRef.current && scene.audioUrl) {
        audioRef.current.src = scene.audioUrl;
        audioRef.current.currentTime = localTime;
        audioRef.current.play().catch(() => {});
      }
    }

    drawCurrentFrame();
    rafIdRef.current = requestAnimationFrame(loop);
  }, [isPlaying, totalDuration, currentSceneIndex, onSceneChange, getSceneForTime, drawCurrentFrame]);

  // Control playback start/pause
  useEffect(() => {
    if (isPlaying) {
      playStartTimeRef.current = performance.now();
      const { scene, localTime } = getSceneForTime(playbackTimeOffsetRef.current);
      if (audioRef.current && scene?.audioUrl) {
        audioRef.current.src = scene.audioUrl;
        audioRef.current.currentTime = localTime;
        audioRef.current.play().catch(() => {});
      }
      rafIdRef.current = requestAnimationFrame(loop);
    } else {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (audioRef.current) audioRef.current.pause();
    }
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPlaying, loop, getSceneForTime]);

  // Handle manual seek
  const handleSeek = (newTime: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, newTime));
    playbackTimeOffsetRef.current = clamped;
    setCurrentTime(clamped);
    if (isPlaying) {
      playStartTimeRef.current = performance.now();
    }
    const { scene, index, localTime } = getSceneForTime(clamped);
    onSceneChange(index);
    if (audioRef.current && scene?.audioUrl) {
      audioRef.current.src = scene.audioUrl;
      audioRef.current.currentTime = localTime;
      if (isPlaying) audioRef.current.play().catch(() => {});
    }
    drawCurrentFrame();
  };

  const togglePlay = () => {
    if (currentTime >= totalDuration) {
      handleSeek(0);
    }
    setIsPlaying(prev => !prev);
  };

  const handleRestart = () => {
    handleSeek(0);
    setIsPlaying(true);
  };

  // Jump to specific scene
  const jumpToScene = (idx: number) => {
    if (idx >= 0 && idx < scenes.length) {
      handleSeek(scenes[idx].startTime);
    }
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Re-draw when scene index or aspect ratio changes
  useEffect(() => {
    drawCurrentFrame();
  }, [currentSceneIndex, aspectRatio, drawCurrentFrame]);

  // Compute container dimensions based on aspect ratio
  const aspectClass = 
    aspectRatio === "9:16" ? "aspect-[9/16] max-h-[580px]" :
    aspectRatio === "16:9" ? "aspect-[16/9] max-h-[460px]" : "aspect-square max-h-[520px]";

  const activeScene = scenes[currentSceneIndex] || scenes[0];

  return (
    <div 
      ref={containerRef} 
      className="relative flex flex-col items-center bg-slate-950 border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl"
    >
      {/* Hidden audio element for synchronous playback */}
      <audio 
        ref={audioRef} 
        muted={isMuted} 
        onEnded={() => {
          // If isPlaying, continue loop
        }}
      />

      {/* Top Overlay Badge Info */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 bg-slate-900/85 backdrop-blur-md border border-slate-700/60 px-3 py-1 rounded-full text-xs font-bold text-slate-200 shadow-md">
          <Film className="h-3.5 w-3.5 text-emerald-400" />
          <span>المشهد {currentSceneIndex + 1} من {scenes.length}</span>
          <span className="text-slate-500">|</span>
          <span className="text-emerald-400 font-mono">{activeScene?.animation || "zoom_in"}</span>
        </div>

        <div className="bg-slate-900/85 backdrop-blur-md border border-slate-700/60 px-3 py-1 rounded-full text-xs font-mono font-bold text-slate-300 shadow-md">
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </div>
      </div>

      {/* Video Viewport Canvas */}
      <div className={`relative w-full ${aspectClass} flex items-center justify-center bg-slate-950 cursor-pointer overflow-hidden`} onClick={togglePlay}>
        <canvas
          ref={canvasRef}
          width={aspectRatio === "9:16" ? 720 : aspectRatio === "16:9" ? 1280 : 720}
          height={aspectRatio === "9:16" ? 1280 : aspectRatio === "16:9" ? 720 : 720}
          className="w-full h-full object-contain"
        />

        {/* Big play button overlay when paused */}
        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] transition-all">
            <div className="p-4 sm:p-5 rounded-full bg-emerald-500/90 text-slate-950 shadow-2xl hover:scale-105 transition-transform active:scale-95 cursor-pointer">
              <Play className="h-8 w-8 sm:h-10 sm:w-10 fill-current translate-x-0.5" />
            </div>
          </div>
        )}
      </div>

      {/* Controls & Scrubber Toolbar */}
      <div className="w-full p-3 sm:p-4 bg-slate-900/95 border-t border-slate-800/80 backdrop-blur-md flex flex-col gap-2.5 z-20">
        {/* Timeline Scrubber */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-semibold text-slate-400 select-none min-w-[38px]">
            {formatTime(currentTime)}
          </span>

          <div className="relative flex-1 group py-1.5 cursor-pointer">
            <input
              type="range"
              min={0}
              max={Math.max(1, totalDuration)}
              step={0.05}
              value={currentTime}
              onChange={(e) => handleSeek(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>

          <span className="text-xs font-mono font-semibold text-slate-400 select-none min-w-[38px]">
            {formatTime(totalDuration)}
          </span>
        </div>

        {/* Buttons Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-2 sm:px-4 sm:py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
              title={isPlaying ? "إيقاف مؤقت" : "تشغيل"}
            >
              {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
              <span className="hidden sm:inline">{isPlaying ? "إيقاف" : "تشغيل المعاينة"}</span>
            </button>

            <button
              onClick={handleRestart}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="إعادة التشغيل من البداية"
            >
              <RotateCcw className="h-4 w-4" />
            </button>

            <button
              onClick={() => jumpToScene(currentSceneIndex - 1)}
              disabled={currentSceneIndex <= 0}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              title="المشهد السابق"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <button
              onClick={() => jumpToScene(currentSceneIndex + 1)}
              disabled={currentSceneIndex >= scenes.length - 1}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
              title="المشهد التالي"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMuted(prev => !prev)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title={isMuted ? "إلغاء كتم الصوت" : "كتم الصوت"}
            >
              {isMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="شاشة كاملة"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
