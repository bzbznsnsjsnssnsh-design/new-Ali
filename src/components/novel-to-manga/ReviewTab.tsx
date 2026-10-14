import React, { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { PageQueueItem } from "../../types/novelToManga";

interface ReviewTabProps {
  queue: PageQueueItem[];
  onRegeneratePage: (pageId: string) => void;
}

export default function ReviewTab({ queue, onRegeneratePage }: ReviewTabProps) {
  const [openTechnicalJsonPageId, setOpenTechnicalJsonPageId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Review</h2>
        <span className="text-xs font-mono text-slate-400">
          {queue.filter((q) => q.review_result?.decision === "APPROVED").length} / {queue.length} Approved
        </span>
      </div>

      {/* 1-Column on Mobile, 2-Column on Desktop (Requirement 23 & 27) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {queue.map((item) => {
          const rev = item.review_result;
          const isJsonOpen = openTechnicalJsonPageId === item.page_id;

          const checklist = [
            { label: "Character", passed: rev?.checks?.character_consistency },
            { label: "World", passed: rev?.checks?.world_consistency },
            { label: "Location", passed: rev?.checks?.location_consistency },
            { label: "Objects", passed: rev?.checks?.object_consistency },
            { label: "Style", passed: rev?.checks?.style_consistency },
            { label: "Lighting", passed: rev?.checks?.lighting_consistency },
            { label: "Scene Accuracy", passed: rev?.checks?.scene_accuracy },
          ];

          return (
            <div
              key={item.page_id}
              className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 flex flex-col gap-4"
            >
              <div className="flex items-center justify-between font-mono text-xs">
                <strong className="text-white text-sm">{item.page_id}</strong>
                <span
                  className={
                    rev?.decision === "APPROVED"
                      ? "text-emerald-400 font-bold"
                      : rev?.decision === "REGENERATE"
                      ? "text-rose-400 font-bold"
                      : "text-slate-400"
                  }
                >
                  {rev?.decision || "WAITING"}
                </span>
              </div>

              {/* 1. Show Page Image First (Requirement 23) */}
              <div className="w-full aspect-[3/4] rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden">
                {item.image_path ? (
                  <img
                    src={item.image_path}
                    alt={item.page_id}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center text-slate-500 p-4">
                    <ImageIcon className="h-8 w-8 mx-auto mb-1.5 opacity-40" />
                    <span className="text-xs font-mono">{item.page_id}</span>
                  </div>
                )}
              </div>

              {/* 2. Clean 7-Point Checklist */}
              <div className="divide-y divide-slate-800/70 text-xs font-mono bg-slate-950/70 rounded-lg p-3 border border-slate-800/80">
                {checklist.map((chk) => (
                  <div key={chk.label} className="py-1.5 flex items-center justify-between">
                    <span className="text-slate-300">{chk.label}</span>
                    <span
                      className={
                        chk.passed === true
                          ? "text-emerald-400 font-bold"
                          : chk.passed === false
                          ? "text-rose-400 font-bold"
                          : "text-slate-500"
                      }
                    >
                      {chk.passed === true ? "✓" : chk.passed === false ? "✗" : "—"}
                    </span>
                  </div>
                ))}
              </div>

              {/* 3. Decision & Advanced Technical JSON Toggle */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() =>
                    setOpenTechnicalJsonPageId(isJsonOpen ? null : item.page_id)
                  }
                  className="px-3 py-2 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-mono cursor-pointer"
                >
                  Technical Review JSON
                </button>

                {rev?.decision === "REGENERATE" && (
                  <button
                    type="button"
                    onClick={() => onRegeneratePage(item.page_id)}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    Regenerate
                  </button>
                )}
              </div>

              {isJsonOpen && (
                <pre
                  dir="ltr"
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto"
                >
                  {JSON.stringify(rev || { status: "NOT_REVIEWED_YET" }, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
