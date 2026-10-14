import React, { useState, useRef } from "react";
import { 
  Film, 
  Upload, 
  Link as LinkIcon, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  Sparkles, 
  Play, 
  FileVideo, 
  Loader2,
  X
} from "lucide-react";
import { VideoAnalysisResult, VideoSourceType } from "../../types/videoDubbing";

interface VideoSourceInputProps {
  onSourceSelected: (source: { url?: string; file?: File; analysis?: VideoAnalysisResult }) => void;
  isLoading: boolean;
  currentSource?: { url?: string; file?: File; analysis?: VideoAnalysisResult } | null;
}

const SAMPLE_VIDEOS = [
  {
    title: "مسلسل / أنمي سينمانا HD (بث Cinemana HLS)",
    url: "https://stream.cinemana.cc/cinema-stream?url=https%3A%2F%2Fr467--8katnn5p.c.scdns.io%2Fstream%2Fv1%2Fhls%2Fi0bWyfbUaWl9a5ixztg6cg%2F1789877123%2Fwww.fasel-hd.co%2Fall%2F185.244.36.179%2Fyes%2FNL%2F0%2F08-02%2F3%2F25d13ffc116b035215a1eb3fed512e7c%2F160_hd1080b_playlist.m3u8",
    type: "HLS"
  },
  {
    title: "Pixeldrain Video (Direct Stream)",
    url: "https://pixeldrain.com/api/file/xVVupQjq",
    type: "DIRECT_VIDEO"
  },
  {
    title: "Tears of Steel (Sci-Fi Dialogue)",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
    type: "DIRECT_VIDEO"
  },
  {
    title: "HLS Test Stream (Multi-bitrate)",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    type: "HLS"
  }
];

export const VideoSourceInput: React.FC<VideoSourceInputProps> = ({
  onSourceSelected,
  isLoading,
  currentSource
}) => {
  const [urlInput, setUrlInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAnalyzeUrl = async (urlToAnalyze?: string) => {
    const targetUrl = (urlToAnalyze || urlInput).trim();
    if (!targetUrl) return;

    setAnalyzing(true);
    setAnalysisError(null);

    try {
      const res = await fetch("/api/video/source/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "فشل تحليل مسار الفيديو");
      }

      onSourceSelected({
        url: targetUrl,
        analysis: data
      });
    } catch (err: any) {
      setAnalysisError(err.message || "حدث خطأ أثناء فحص الفيديو");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|webm|mkv|mov|avi|ogv)$/i)) {
      setAnalysisError("يرجى اختيار ملف فيديو صالح (MP4, WebM, MKV, MOV, إلخ)");
      return;
    }

    setAnalysisError(null);
    onSourceSelected({
      file,
      analysis: {
        sourceType: "LOCAL_FILE",
        streamUrl: URL.createObjectURL(file),
        title: file.name,
        isDrm: false,
        requiresAuth: false
      }
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5 text-right font-sans">
      <div className="flex flex-col sm:flex-row-reverse sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-row-reverse">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-900/30 text-white">
            <Film className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 flex-row-reverse">
              تحديد مصدر الفيديو
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">
                Universal Player
              </span>
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              يدعم روابط الفيديو المباشرة، البث المباشر HLS (.m3u8)، والملفات المحلية من جهازك
            </p>
          </div>
        </div>

        {currentSource?.analysis && (
          <div className="flex items-center gap-2 flex-row-reverse text-xs bg-neutral-800/80 px-3 py-1.5 rounded-lg border border-neutral-700">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-neutral-300 font-mono">
              {currentSource.analysis.sourceType}
            </span>
            {currentSource.file ? (
              <span className="text-neutral-400 truncate max-w-[140px]">{currentSource.file.name}</span>
            ) : null}
          </div>
        )}
      </div>

      {/* URL Input Form */}
      <div className="space-y-2">
        <div className="relative flex items-center">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAnalyzeUrl()}
            placeholder="أدخل رابط فيديو مباشر (MP4, WebM) أو ملف بث HLS (.m3u8)..."
            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl py-3 pl-28 pr-11 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-left dir-ltr"
            disabled={analyzing || isLoading}
          />
          <LinkIcon className="absolute right-3.5 w-5 h-5 text-neutral-500 pointer-events-none" />
          
          {urlInput && (
            <button
              onClick={() => setUrlInput("")}
              className="absolute left-24 p-1 text-neutral-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => handleAnalyzeUrl()}
            disabled={!urlInput.trim() || analyzing || isLoading}
            className="absolute left-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-xs font-medium transition-all shadow-md flex items-center gap-1.5"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>فحص...</span>
              </>
            ) : (
              <span>تشغيل</span>
            )}
          </button>
        </div>

        {/* Error Alert */}
        {analysisError && (
          <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-xl flex items-start gap-2.5 flex-row-reverse text-xs text-red-300">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-right">
              <span>{analysisError}</span>
            </div>
          </div>
        )}
      </div>

      {/* Drag & Drop File Upload */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-4 sm:p-5 text-center cursor-pointer transition-all ${
          dragActive
            ? "border-emerald-500 bg-emerald-950/20"
            : "border-neutral-800 hover:border-neutral-700 bg-neutral-950/50 hover:bg-neutral-950"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mkv,.mp4,.webm,.mov,.avi"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="w-10 h-10 rounded-full bg-neutral-900 flex items-center justify-center text-neutral-400 group-hover:text-emerald-400">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-neutral-200">
              اسحب وأفلت ملف فيديو هنا، أو <span className="text-emerald-400 underline decoration-emerald-500/50">تصفح من جهازك</span>
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              يدعم MP4, MKV, WebM, MOV بدون حدود لحجم الملف (يتم تقطيع الصوت محلياً)
            </p>
          </div>
        </div>
      </div>

      {/* Quick Sample Links */}
      <div className="pt-2 border-t border-neutral-800/80">
        <div className="flex items-center gap-2 flex-row-reverse text-xs text-neutral-400 mb-2.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>نماذج سريعة للتجربة الفورية:</span>
        </div>
        <div className="flex flex-wrap gap-2 flex-row-reverse">
          {SAMPLE_VIDEOS.map((sample, idx) => (
            <button
              key={idx}
              onClick={() => {
                setUrlInput(sample.url);
                handleAnalyzeUrl(sample.url);
              }}
              className="px-3 py-1.5 rounded-lg bg-neutral-800/60 hover:bg-neutral-800 border border-neutral-700/60 hover:border-neutral-600 text-xs text-neutral-300 transition-all flex items-center gap-2 flex-row-reverse"
            >
              <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
              <span>{sample.title}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-900 text-neutral-400 font-mono">
                {sample.type}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
