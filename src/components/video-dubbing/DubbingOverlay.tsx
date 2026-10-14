import React, { useEffect, useState } from "react";
import { Loader2, CheckCircle2, Circle, AlertCircle, X, Sparkles, Headphones, Clock, Activity, Music2 } from "lucide-react";

interface DubbingOverlayProps {
  step: 'EXTRACTING' | 'ANALYZING' | 'TRANSLATING' | 'TTS' | 'READY';
  message: string;
  meta?: any;
  error?: string | null;
  onCancel: () => void;
  onRetry?: () => void;
}

const STEPS = [
  { key: 'EXTRACTING', label: 'استخراج المقطع الصوتي (Audio Slicing via FFmpeg)' },
  { key: 'ANALYZING', label: 'تحليل الحوار وتحديد المتحدثين عبر Gemini AI' },
  { key: 'TRANSLATING', label: 'الصياغة والترجمة السينمائية إلى العربية الطبيعية' },
  { key: 'TTS', label: 'توليد الصوت العربي النقي (Arabic Neural TTS)' },
  { key: 'READY', label: 'مزامنة الصوت والبدء الفوري' },
];

export const DubbingOverlay: React.FC<DubbingOverlayProps> = ({
  step,
  message,
  meta,
  error,
  onCancel,
  onRetry
}) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const currentStepIndex = STEPS.findIndex(s => s.key === step);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none font-sans text-right animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-neutral-900/95 border border-neutral-700/80 rounded-2xl p-6 shadow-2xl shadow-black/80 space-y-5">
        
        {/* Header */}
        <div className="flex items-center justify-between flex-row-reverse border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5 flex-row-reverse">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Headphones className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-1.5 flex-row-reverse">
                تجهيز الدبلجة العربية الفورية
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              </h3>
              <p className="text-xs text-neutral-400">معالجة حقيقية حية للمقطع الصوتي ومزامنة الترجمة والصوت</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-300 text-[11px] font-mono">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>{formatElapsed(elapsed)}</span>
            </div>
            <button
              onClick={onCancel}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-all"
              title="إلغاء"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dynamic Status Message with Live Indicators */}
        <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
          <div className="flex items-center gap-3 flex-row-reverse">
            {!error ? (
              <Loader2 className="w-5 h-5 text-emerald-400 animate-spin shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <div className="flex-1 text-right">
              <p className="text-sm font-medium text-white">{error || message}</p>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                {!error ? "معالجة مباشرة على الخادم مع الذكاء الاصطناعي..." : "تعذر إكمال المعالجة، يمكنك إعادة المحاولة"}
              </p>
            </div>
          </div>

          {/* Live Progress Metadata Badges */}
          {meta && (
            <div className="flex flex-wrap items-center gap-2 flex-row-reverse pt-2 border-t border-neutral-800/80 text-[11px]">
              {meta.audioSizeKb && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">
                  حجم الصوت: {meta.audioSizeKb} KB
                </span>
              )}
              {meta.itemsCount !== undefined && (
                <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                  {meta.itemsCount > 0 ? `${meta.itemsCount} حوارات منطوقة` : "مؤثرات وموسيقى فقط"}
                </span>
              )}
              {meta.current && meta.total && (
                <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                  توليد الصوت: {meta.current} من {meta.total}
                </span>
              )}
            </div>
          )}

          {/* If currentText is present in TTS progress */}
          {meta?.currentText && (
            <div className="text-[11px] text-neutral-300 bg-neutral-900/90 rounded-lg p-2 border border-neutral-800 italic">
              "{meta.currentText}"
            </div>
          )}

          {/* If zero speech in music intro */}
          {meta?.itemsCount === 0 && (
            <div className="flex items-center gap-2 flex-row-reverse p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs">
              <Music2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>هذه الثواني خالية من الحوارات (موسيقى ومؤثرات)، الدبلجة جاهزة وستنطلق الأصوات مع بدء كلام الشخصيات.</span>
            </div>
          )}
        </div>

        {/* Step Progress Checklist */}
        <div className="space-y-2.5 py-1">
          {STEPS.map((s, idx) => {
            const isDone = currentStepIndex > idx;
            const isCurrent = currentStepIndex === idx;

            return (
              <div
                key={s.key}
                className={`flex items-center justify-between flex-row-reverse px-3 py-2 rounded-lg text-xs transition-all ${
                  isCurrent
                    ? "bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 font-medium"
                    : isDone
                    ? "bg-neutral-950/40 text-neutral-300"
                    : "text-neutral-500"
                }`}
              >
                <div className="flex items-center gap-2.5 flex-row-reverse">
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-neutral-600 shrink-0" />
                  )}
                  <span>{s.label}</span>
                </div>

                {isDone && (
                  <span className="text-[10px] text-emerald-400 font-mono">اكتمل</span>
                )}
                {isCurrent && (
                  <span className="text-[10px] text-emerald-400 animate-pulse font-mono">جاري الآن</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 flex-row-reverse pt-2 border-t border-neutral-800">
          {error && onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-950/50"
            >
              إعادة المحاولة
            </button>
          )}

          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-all"
          >
            إلغاء وإيقاف الدبلجة
          </button>
        </div>
      </div>
    </div>
  );
};
