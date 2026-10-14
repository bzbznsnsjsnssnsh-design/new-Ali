import React, { useRef, useEffect } from "react";
import {
  VideoScene,
  VideoAnimationType
} from "./types";
import {
  Film,
  Volume2,
  Clock,
  Sparkles,
  MoveDown,
  MoveUp,
  ZoomIn,
  ZoomOut,
  MoveLeft,
  MoveRight,
  Maximize2
} from "lucide-react";

interface ManhwaVideoTimelineProps {
  scenes: VideoScene[];
  currentSceneIndex: number;
  onSelectScene: (index: number) => void;
  onUpdateSceneAnimation?: (sceneIndex: number, animation: VideoAnimationType) => void;
}

export default function ManhwaVideoTimeline({
  scenes,
  currentSceneIndex,
  onSelectScene,
  onUpdateSceneAnimation
}: ManhwaVideoTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);

  // Auto-scroll timeline when currentSceneIndex changes
  useEffect(() => {
    if (activeItemRef.current && containerRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center"
      });
    }
  }, [currentSceneIndex]);

  const totalDuration = scenes.reduce((acc, s) => acc + (s.duration || 0), 0);

  const getAnimationIcon = (anim: VideoAnimationType) => {
    switch (anim) {
      case "pan_down":
        return <MoveDown className="h-3 w-3 text-emerald-400" />;
      case "pan_up":
        return <MoveUp className="h-3 w-3 text-cyan-400" />;
      case "zoom_in":
        return <ZoomIn className="h-3 w-3 text-amber-400" />;
      case "zoom_out":
        return <ZoomOut className="h-3 w-3 text-indigo-400" />;
      case "pan_left":
        return <MoveLeft className="h-3 w-3 text-purple-400" />;
      case "pan_right":
        return <MoveRight className="h-3 w-3 text-pink-400" />;
      default:
        return <Maximize2 className="h-3 w-3 text-slate-400" />;
    }
  };

  const getAnimationLabel = (anim: VideoAnimationType) => {
    switch (anim) {
      case "pan_down":
        return "Pan Down";
      case "pan_up":
        return "Pan Up";
      case "zoom_in":
        return "Zoom In";
      case "zoom_out":
        return "Zoom Out";
      case "pan_left":
        return "Pan Left";
      case "pan_right":
        return "Pan Right";
      default:
        return "ثابت";
    }
  };

  return (
    <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-xl" dir="rtl">
      {/* Timeline Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">الخط الزمني للمشاهد (Timeline)</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
            {scenes.length} مشهد
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-1 font-mono">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span>إجمالي المدة: {totalDuration.toFixed(1)} ثانية</span>
          </div>
        </div>
      </div>

      {/* Horizontal Strip */}
      <div
        ref={containerRef}
        className="flex items-stretch gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700 select-none"
      >
        {scenes.map((scene, idx) => {
          const isActive = idx === currentSceneIndex;

          return (
            <div
              key={scene.id || idx}
              ref={isActive ? activeItemRef : null}
              onClick={() => onSelectScene(idx)}
              className={`group relative flex-shrink-0 w-36 rounded-xl border p-2 flex flex-col justify-between cursor-pointer transition-all ${
                isActive
                  ? "bg-slate-800/90 border-emerald-500 shadow-lg shadow-emerald-500/10 ring-2 ring-emerald-500/30"
                  : "bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60"
              }`}
            >
              {/* Scene Number + Duration Badge */}
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span
                  className={`px-1.5 py-0.5 rounded font-bold font-mono text-[10px] ${
                    isActive ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-300"
                  }`}
                >
                  #{idx + 1}
                </span>

                <span className="text-slate-400 font-mono text-[10px] flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {scene.duration ? `${scene.duration.toFixed(1)}s` : "0s"}
                </span>
              </div>

              {/* Thumbnail Image */}
              <div className="relative w-full h-24 rounded-lg bg-slate-900 border border-slate-800/80 overflow-hidden mb-2">
                {scene.imageUrl ? (
                  <img
                    src={scene.imageUrl}
                    alt={`Scene ${idx + 1}`}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">
                    بدون صورة
                  </div>
                )}

                {/* Audio Status Icon */}
                {scene.audioUrl && (
                  <div className="absolute top-1 left-1 p-1 rounded-md bg-slate-950/80 text-emerald-400">
                    <Volume2 className="h-2.5 w-2.5" />
                  </div>
                )}
              </div>

              {/* Text Snippet */}
              <p
                className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed mb-2 font-normal"
                title={scene.narrationText || scene.dialogueText}
              >
                {scene.narrationText || scene.dialogueText || "لا يوجد نص سردي"}
              </p>

              {/* Animation Selector */}
              <div
                className="mt-auto pt-1.5 border-t border-slate-800/80 flex items-center justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  {getAnimationIcon(scene.animation)}
                  <span className="truncate max-w-[55px]">{getAnimationLabel(scene.animation)}</span>
                </div>

                {onUpdateSceneAnimation && (
                  <select
                    value={scene.animation}
                    onChange={(e) =>
                      onUpdateSceneAnimation(idx, e.target.value as VideoAnimationType)
                    }
                    className="bg-slate-900 border border-slate-700/60 rounded px-1 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="pan_down">Pan Down</option>
                    <option value="pan_up">Pan Up</option>
                    <option value="zoom_in">Zoom In</option>
                    <option value="zoom_out">Zoom Out</option>
                    <option value="pan_left">Pan Left</option>
                    <option value="pan_right">Pan Right</option>
                    <option value="static">Static</option>
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
