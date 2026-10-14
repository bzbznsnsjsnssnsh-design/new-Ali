import React, { useState, useRef } from "react";
import { Tv, ArrowLeft, Sparkles } from "lucide-react";
import { UniversalVideoPlayer } from "./UniversalVideoPlayer";
import { VideoSourceInput } from "./VideoSourceInput";
import { DubbingTimeline } from "./DubbingTimeline";
import { VideoDubbingEngine } from "../../services/videoDubbingEngine";
import { VideoAnalysisResult, SpeechItem } from "../../types/videoDubbing";

interface VideoDubbingPageProps {
  onBack?: () => void;
  onNavigateToSettings?: () => void;
}

export const VideoDubbingPage: React.FC<VideoDubbingPageProps> = ({ onBack, onNavigateToSettings }) => {
  const engineRef = useRef<VideoDubbingEngine>(new VideoDubbingEngine());
  const [analysis, setAnalysis] = useState<VideoAnalysisResult | null>(null);
  const [isDubbingActive, setIsDubbingActive] = useState(false);
  const [activeSpeechItem, setActiveSpeechItem] = useState<SpeechItem | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 text-white" dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-xl border border-white/10 bg-white/5 p-2 text-neutral-300 hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400">
            <Tv className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">استوديو دبلجة الفيديو الذكي</h1>
            <p className="text-xs text-neutral-400">
              ترجمة ودبلجة صوتية متزامنة للفيديوهات والأنمي
            </p>
          </div>
        </div>
      </div>

      {!analysis ? (
        <VideoSourceInput
          onSourceSelected={(source) => {
            if (source.analysis) {
              setAnalysis(source.analysis);
            }
          }}
          isLoading={false}
          currentSource={null}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              <span>{analysis.title || "فيديو قيد التشغيل"}</span>
            </div>
            <button
              onClick={() => setAnalysis(null)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10"
            >
              تغيير مصدر الفيديو
            </button>
          </div>

          <UniversalVideoPlayer
            src={analysis.streamUrl}
            proxyUrl={analysis.proxyUrl}
            directUrl={analysis.directUrl}
            sourceType={analysis.sourceType}
            metadata={analysis.metadata}
            dubbingEngine={engineRef.current}
            onOpenSettings={() => {}}
            onStartDubbing={() => setIsDubbingActive((prev) => !prev)}
            isDubbingActive={isDubbingActive}
            activeSpeechItem={activeSpeechItem}
            onTimeChange={(time) => {
              setCurrentTime(time);
              setActiveSpeechItem(engineRef.current.getActiveSpeechItem(time));
            }}
          />

          <DubbingTimeline
            segments={engineRef.current.segments}
            currentTime={currentTime}
            videoDuration={engineRef.current.videoDuration || analysis.metadata?.duration || 0}
            onSeek={() => {}}
            onRetrySegment={() => {}}
            onCancelQueue={() => {}}
          />
        </div>
      )}
    </div>
  );
};

export default VideoDubbingPage;
