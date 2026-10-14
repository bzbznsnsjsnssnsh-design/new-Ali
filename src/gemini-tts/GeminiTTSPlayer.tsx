import React, { useState, useRef, useEffect } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Download,
  Sparkles,
  Gauge,
} from "lucide-react";

interface GeminiTTSPlayerProps {
  audioBase64: string;
  mimeType?: string;
  title?: string;
  voiceName?: string;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

export const GeminiTTSPlayer: React.FC<GeminiTTSPlayerProps> = ({
  audioBase64,
  mimeType = "audio/mp3",
  title = "المقطع الصوتي",
  voiceName = "Achernar",
  onRegenerate,
  isRegenerating = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const audioSrc = audioBase64 ? `data:${mimeType};base64,${audioBase64}` : undefined;

  useEffect(() => {
    if (audioBase64) {
      setIsPlaying(false);
      setCurrentTime(0);
      if (audioRef.current) {
        audioRef.current.load();
      }
    }
  }, [audioBase64, mimeType]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch((e) => {
        console.error("Audio playback error:", e);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    audioRef.current.muted = nextMuted;
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      if (val === 0) setIsMuted(true);
      else setIsMuted(false);
    }
  };

  const handleDownload = () => {
    if (!audioBase64 || !audioSrc) return;
    const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("ogg") ? "ogg" : "mp3";
    const link = document.createElement("a");
    link.href = audioSrc;
    link.download = `gemini-tts-${voiceName}-${Date.now()}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (!audioBase64 || !audioSrc) return null;

  return (
    <div
      id="gemini-tts-player"
      dir="rtl"
      className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950 p-4 sm:p-5 shadow-2xl backdrop-blur-md"
    >
      <audio
        ref={audioRef}
        src={audioSrc}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      {/* Header Info */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="truncate">
            <h4 className="text-sm font-bold text-white truncate">{title}</h4>
            <span className="text-[11px] text-emerald-400 font-mono">الصوت: {voiceName}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={isRegenerating}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition disabled:opacity-50"
              title="إعادة توليد وتجاوز التخزين المؤقت (Cache)"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${isRegenerating ? "animate-spin text-emerald-400" : ""}`} />
              <span className="hidden sm:inline">إعادة التوليد</span>
            </button>
          )}

          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-emerald-500 hover:text-white transition"
            title="تحميل الملف الصوتي"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">تحميل</span>
          </button>
        </div>
      </div>

      {/* Progress Bar & Timers */}
      <div className="space-y-1.5 mb-3">
        <div className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-500 transition focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Playback Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {/* Play / Pause */}
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-slate-950 font-bold shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition"
            title={isPlaying ? "إيقاف مؤقت" : "تشغيل"}
          >
            {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
          </button>

          {/* Speed Presets */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900/80 p-1 text-xs">
            <Gauge className="h-3.5 w-3.5 text-slate-500 mr-1.5 ml-1" />
            {[0.75, 1, 1.25, 1.5].map((rate) => (
              <button
                key={rate}
                onClick={() => handleSpeedChange(rate)}
                className={`rounded-lg px-2 py-1 font-mono transition ${
                  playbackRate === rate
                    ? "bg-emerald-500/20 text-emerald-400 font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>

        {/* Volume Control */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="text-slate-400 hover:text-white transition"
            title={isMuted ? "إلغاء كتم الصوت" : "كتم الصوت"}
          >
            {isMuted || volume === 0 ? <VolumeX className="h-4 w-4 text-red-400" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="h-1.5 w-20 cursor-pointer appearance-none rounded-lg bg-slate-800 accent-emerald-500"
          />
        </div>
      </div>
    </div>
  );
};
