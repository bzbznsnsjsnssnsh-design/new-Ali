import React, { useState, useEffect, useRef } from "react";
import { History, RefreshCw, ExternalLink, Maximize2, Minimize2, Radio, AlertCircle } from "lucide-react";

interface SuwayomiHistoryProps {
  onExploreCatalogue?: () => void;
}

export default function SuwayomiHistory({ onExploreCatalogue }: SuwayomiHistoryProps) {
  const [suwayomiUrl, setSuwayomiUrl] = useState<string>("https://f212af09-ae8a-4d6f-be1a-59fbca80573e-00-3ctaa6lqfzq7d.sisko.replit.dev");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [iframeKey, setIframeKey] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("suwayomi_server_url");
      if (saved && saved.trim()) {
        setSuwayomiUrl(saved.trim().replace(/\/+$/, ""));
      }
    } catch {}
  }, []);

  const historyUrl = `${suwayomiUrl}/history`;

  const handleRefresh = () => {
    setIsLoading(true);
    setIframeKey((prev) => prev + 1);
  };

  const handleOpenExternal = () => {
    window.open(historyUrl, "_blank", "noopener,noreferrer");
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div
      id="suwayomi-history-container"
      className={`flex flex-col transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-50 bg-slate-950 p-2 sm:p-4"
          : "w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-4"
      }`}
    >
      {/* Top Header & Controls Bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-3 sm:p-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-700 text-white shadow-lg shadow-indigo-500/20">
            <History className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm sm:text-base font-bold text-white">
                سجل القراءة (Suwayomi History)
              </h2>
              <span className="flex items-center gap-1 rounded-full bg-emerald-950/80 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-800/50">
                <Radio className="h-2.5 w-2.5 animate-pulse text-emerald-400" />
                متصل بالخادم
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate max-w-xs sm:max-w-md" dir="ltr">
              {historyUrl}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-1.5 rounded-xl border border-slate-750 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition active:scale-95 cursor-pointer"
            title="إعادة تحميل الصفحة"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-indigo-400" : ""}`} />
            <span className="hidden sm:inline">تحديث</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 rounded-xl border border-slate-750 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition active:scale-95 cursor-pointer"
            title={isFullscreen ? "تصغير الشاشة" : "ملء الشاشة"}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5 text-indigo-400" />
                <span className="hidden sm:inline">تصغير</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5 text-indigo-400" />
                <span className="hidden sm:inline">ملء الشاشة</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleOpenExternal}
            className="flex items-center gap-1.5 rounded-xl border border-indigo-700/50 bg-indigo-950/60 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-900/80 hover:text-white transition active:scale-95 cursor-pointer"
            title="فتح الرابط في نافذة جديدة"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">نافذة خارجية</span>
          </button>
        </div>
      </div>

      {/* Embedded History Frame */}
      <div
        className={`relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl ${
          isFullscreen ? "flex-1 h-[calc(100vh-85px)]" : "h-[75vh] sm:h-[82vh]"
        }`}
      >
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-950/80 border border-indigo-800/50 mb-4 shadow-xl shadow-indigo-500/10">
              <RefreshCw className="h-7 w-7 animate-spin text-indigo-400" />
            </div>
            <p className="font-display text-sm font-semibold text-white">
              جاري تحميل سجل القراءة من خادم Suwayomi...
            </p>
            <p className="mt-1 text-xs text-slate-400 text-center max-w-sm" dir="rtl">
              يتم جلب فصول المانجا ومواعيد القراءة والتقدم من الخادم مباشرة
            </p>
          </div>
        )}

        <iframe
          ref={iframeRef}
          key={iframeKey}
          id="suwayomi-history-iframe"
          title="Suwayomi History"
          src={historyUrl}
          className="h-full w-full border-0 bg-slate-950"
          allow="fullscreen; clipboard-read; clipboard-write; autoplay"
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />
      </div>

      {/* Info note */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 px-1">
        <span className="flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 text-slate-400" />
          يتم تسجيل الفصول وتاريخ ووقت قراءتها تلقائياً داخل خادم Suwayomi ومزامنتها لحظياً.
        </span>
        {onExploreCatalogue && (
          <button
            type="button"
            onClick={onExploreCatalogue}
            className="text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
          >
            تصفح المصادر لمتابعة القراءة &larr;
          </button>
        )}
      </div>
    </div>
  );
}
