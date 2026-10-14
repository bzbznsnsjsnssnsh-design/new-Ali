import React, { useState } from "react";
import { 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Clock, 
  RotateCcw, 
  Volume2, 
  MessageSquare, 
  ListOrdered,
  ChevronDown,
  ChevronUp,
  Ban,
  Link as LinkIcon,
  AlignLeft
} from "lucide-react";
import { DubbingSegment, SpeechItem } from "../../types/videoDubbing";

interface DubbingTimelineProps {
  segments: DubbingSegment[];
  videoDuration: number;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onRetrySegment: (segmentIndex: number) => void;
  onCancelQueue: () => void;
  allSpeechItems?: SpeechItem[];
}

export const DubbingTimeline: React.FC<DubbingTimelineProps> = ({
  segments,
  videoDuration,
  currentTime,
  onSeek,
  onRetrySegment,
  onCancelQueue,
  allSpeechItems = []
}) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'segments' | 'unified'>('segments');

  const totalSegmentsCount = Math.max(1, Math.ceil((videoDuration || 60) / 60));
  const currentSegmentIndex = Math.floor(currentTime / 60);

  // Group segments by index for fast lookup
  const segmentMap = new Map<number, DubbingSegment>();
  for (const s of segments) {
    segmentMap.set(s.segmentIndex, s);
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const getSegmentStateColor = (state?: string, isCurrent?: boolean) => {
    if (isCurrent) return "ring-2 ring-emerald-400 bg-emerald-950/50 border-emerald-500";
    switch (state) {
      case "READY":
        return "bg-emerald-900/60 border-emerald-600/80 text-emerald-300";
      case "PROCESSING":
      case "ANALYZING":
      case "TRANSLATING":
      case "TTS":
      case "SYNCING":
        return "bg-amber-900/50 border-amber-500 text-amber-300 animate-pulse";
      case "FAILED":
        return "bg-red-950/60 border-red-700 text-red-300";
      case "PENDING":
        return "bg-neutral-800/60 border-neutral-700 text-neutral-400";
      default:
        return "bg-neutral-900/40 border-neutral-800 text-neutral-500";
    }
  };

  // Helper to check if a speech item crosses any 60-second boundary
  const isCrossingBoundary = (item: SpeechItem) => {
    const startBoundary = Math.floor(item.absoluteStart / 60);
    const endBoundary = Math.floor(item.absoluteEnd / 60);
    return startBoundary !== endBoundary;
  };

  // Get items for expanded segment: either from unified list or segment items
  const getExpandedItems = (): SpeechItem[] => {
    if (expandedIndex === null) return [];
    const segStart = expandedIndex * 60;
    const segEnd = (expandedIndex + 1) * 60;

    if (allSpeechItems && allSpeechItems.length > 0) {
      // Find all speech items that overlap this segment
      const overlapping = allSpeechItems.filter(
        item => item.absoluteStart < segEnd && item.absoluteEnd > segStart
      );
      if (overlapping.length > 0) return overlapping;
    }

    return segmentMap.get(expandedIndex)?.items || [];
  };

  const expandedItems = getExpandedItems();

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4 text-right font-sans">
      <div className="flex flex-col sm:flex-row-reverse sm:items-center justify-between gap-3 border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-2.5 flex-row-reverse">
          <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-emerald-400">
            <ListOrdered className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 flex-row-reverse">
              شريط مقاطع الدبلجة المتواصلة
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-mono">
                {segments.filter(s => s.state === 'READY').length} / {totalSegmentsCount} جاهز
              </span>
            </h3>
            <p className="text-xs text-neutral-400">
              تقسيم الفيديو إلى مقاطع ذكية بطول 60 ثانية متزامنة بدقة مع الوقت المطلق وبلا انقطاع كلامي
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-row-reverse">
          {/* Toggle between segments view and full unified dialogue transcript */}
          <div className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800 text-xs">
            <button
              onClick={() => setViewMode('segments')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'segments'
                  ? "bg-emerald-600 text-white font-bold"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>المقاطع (60s)</span>
            </button>
            <button
              onClick={() => setViewMode('unified')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === 'unified'
                  ? "bg-emerald-600 text-white font-bold"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <AlignLeft className="w-3.5 h-3.5" />
              <span>المسار المتصل ({allSpeechItems.length})</span>
            </button>
          </div>

          <button
            onClick={onCancelQueue}
            className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5 flex-row-reverse"
            title="إيقاف طابور المعالجة"
          >
            <Ban className="w-3.5 h-3.5 text-neutral-400" />
            <span>إيقاف المعالجة</span>
          </button>
        </div>
      </div>

      {viewMode === 'segments' ? (
        <>
          {/* Visual Timeline Segments Bar */}
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-10 gap-2">
            {Array.from({ length: totalSegmentsCount }).map((_, idx) => {
              const seg = segmentMap.get(idx);
              const isCurrent = currentSegmentIndex === idx;
              const state = seg?.state || "UNLOADED";

              return (
                <button
                  key={idx}
                  onClick={() => {
                    onSeek(idx * 60);
                    setExpandedIndex(expandedIndex === idx ? null : idx);
                  }}
                  className={`p-2 rounded-xl border text-center transition-all relative flex flex-col items-center justify-center min-h-[58px] ${getSegmentStateColor(
                    state,
                    isCurrent
                  )}`}
                >
                  <div className="text-[10px] font-mono font-bold">
                    {formatTime(idx * 60)}
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-[10px]">
                    {state === "READY" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : state === "PROCESSING" || state === "TTS" ? (
                      <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                    ) : state === "FAILED" ? (
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-neutral-600" />
                    )}
                    <span className="font-mono">#{idx + 1}</span>
                  </div>

                  {isCurrent && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-md shadow-emerald-500/50" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Expanded Segment Details & Dialogue Transcript */}
          {expandedIndex !== null && (
            <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between flex-row-reverse border-b border-neutral-850 pb-2">
                <div className="flex items-center gap-2 flex-row-reverse">
                  <span className="text-xs font-bold text-white">
                    تفاصيل المقطع #{expandedIndex + 1} ({formatTime(expandedIndex * 60)} - {formatTime((expandedIndex + 1) * 60)})
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-mono">
                    {segmentMap.get(expandedIndex)?.state || "غير معالج"}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-row-reverse">
                  {segmentMap.get(expandedIndex)?.state === "FAILED" && (
                    <button
                      onClick={() => onRetrySegment(expandedIndex)}
                      className="px-2.5 py-1 rounded-lg bg-red-900/60 hover:bg-red-800 text-red-200 text-xs font-medium flex items-center gap-1 flex-row-reverse"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>إعادة المحاولة</span>
                    </button>
                  )}

                  <button
                    onClick={() => setExpandedIndex(null)}
                    className="p-1 text-neutral-400 hover:text-white"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Dialogue Items List */}
              {expandedItems.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {expandedItems.map((item) => {
                    const crossesBoundary = isCrossingBoundary(item);
                    return (
                      <div
                        key={item.id}
                        className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800 flex flex-col sm:flex-row-reverse sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-row-reverse flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800/60 text-emerald-400 font-mono">
                              {item.speaker}
                            </span>
                            <span className="text-[10px] text-neutral-500 font-mono dir-ltr">
                              {formatTime(item.absoluteStart)} - {formatTime(item.absoluteEnd)}
                            </span>
                            {crossesBoundary && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800/60 font-medium flex items-center gap-1">
                                <LinkIcon className="w-3 h-3" />
                                <span>متواصل عبر الدقيقة (60s)</span>
                              </span>
                            )}
                            {item.status === 'ready' && (
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            )}
                          </div>
                          <p className="text-neutral-100 font-medium text-sm leading-relaxed">{item.arabic_text}</p>
                          {item.source_text && (
                            <p className="text-neutral-400 text-xs dir-ltr text-left font-mono">{item.source_text}</p>
                          )}
                        </div>

                        <button
                          onClick={() => onSeek(item.absoluteStart)}
                          className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] self-end sm:self-center shrink-0 flex items-center gap-1"
                        >
                          <span>انتقال</span>
                          <Clock className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-4 text-xs text-neutral-500">
                  {segmentMap.get(expandedIndex)?.state === "READY"
                    ? "لا يوجد حوار منطوق في هذا المقطع (موسيقى أو صمت)"
                    : "لم تتم معالجة هذا المقطع بعد"}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* Unified Continuous Transcript View */
        <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-row-reverse border-b border-neutral-800 pb-2">
            <span className="text-xs font-bold text-white flex items-center gap-1.5 flex-row-reverse">
              <AlignLeft className="w-4 h-4 text-emerald-400" />
              <span>المسار الحواري المتصل الكامل (Unified Timeline)</span>
            </span>
            <span className="text-[11px] font-mono text-neutral-400">
              إجمالي الجمل: {allSpeechItems.length}
            </span>
          </div>

          {allSpeechItems.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {allSpeechItems.map((item) => {
                const crossesBoundary = isCrossingBoundary(item);
                const isCurrent = currentTime >= item.absoluteStart && currentTime <= item.absoluteEnd;
                return (
                  <div
                    key={item.id}
                    className={`p-2.5 rounded-lg border transition-all flex flex-col sm:flex-row-reverse sm:items-center justify-between gap-2 text-xs ${
                      isCurrent
                        ? "bg-emerald-950/60 border-emerald-500"
                        : "bg-neutral-900 border-neutral-800"
                    }`}
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-row-reverse flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800/60 text-emerald-400 font-mono font-bold">
                          {item.speaker}
                        </span>
                        <span className="text-[10px] text-neutral-400 font-mono dir-ltr">
                          {formatTime(item.absoluteStart)} - {formatTime(item.absoluteEnd)}
                        </span>
                        {crossesBoundary && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800/60 font-medium flex items-center gap-1">
                            <LinkIcon className="w-3 h-3" />
                            <span>متواصل عبر حد الدقيقة (60s)</span>
                          </span>
                        )}
                        {item.status === 'ready' && (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        )}
                      </div>
                      <p className="text-neutral-100 font-medium text-sm leading-relaxed">{item.arabic_text}</p>
                      {item.source_text && (
                        <p className="text-neutral-400 text-xs dir-ltr text-left font-mono">{item.source_text}</p>
                      )}
                    </div>

                    <button
                      onClick={() => onSeek(item.absoluteStart)}
                      className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] self-end sm:self-center shrink-0 flex items-center gap-1"
                    >
                      <span>انتقال</span>
                      <Clock className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-xs text-neutral-500">
              لم يتم استخراج أي جمل حوارية بعد. تبدأ الدبلجة فور تشغيل الفيديو.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
