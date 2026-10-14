import React, { useState } from "react";

export type TimelineCategory =
  | "All"
  | "Generation"
  | "Reference"
  | "Review"
  | "Error"
  | "Retry";

export interface ProjectTimelineEntry {
  id: string;
  timeLabel: string;
  category: Exclude<TimelineCategory, "All">;
  title: string;
  passed: boolean;
  technicalDetails?: string;
}

interface HistoryTabProps {
  timeline: ProjectTimelineEntry[];
  activeErrorCount: number;
  onOpenErrorCenter: () => void;
}

const HISTORY_FILTERS: TimelineCategory[] = [
  "All",
  "Generation",
  "Reference",
  "Review",
  "Error",
  "Retry",
];

export default function HistoryTab({
  timeline,
  activeErrorCount,
  onOpenErrorCenter,
}: HistoryTabProps) {
  const [selectedFilter, setSelectedFilter] = useState<TimelineCategory>("All");
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);

  const filteredEntries =
    selectedFilter === "All"
      ? timeline
      : timeline.filter((item) => item.category === selectedFilter);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-bold text-white">History</h2>

          {activeErrorCount > 0 && (
            <button
              type="button"
              onClick={onOpenErrorCenter}
              className="px-3.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold cursor-pointer"
            >
              Error Center ({activeErrorCount})
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {HISTORY_FILTERS.map((flt) => {
            const active = selectedFilter === flt;
            return (
              <button
                key={flt}
                type="button"
                onClick={() => setSelectedFilter(flt)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  active
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
                }`}
              >
                {flt}
              </button>
            );
          })}
        </div>

        {/* Timeline */}
        <div className="divide-y divide-slate-800/70 pt-2">
          {filteredEntries.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              لا توجد أحداث مسجلة ضمن هذا التصنيف بعد.
            </p>
          ) : (
            filteredEntries.map((entry) => {
              const isOpen = expandedDetailId === entry.id;
              return (
                <div key={entry.id} className="py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-slate-400 tabular-nums shrink-0">
                        {entry.timeLabel}
                      </span>
                      <span className="text-slate-200 font-medium">{entry.title}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {entry.technicalDetails && (
                        <button
                          type="button"
                          onClick={() => setExpandedDetailId(isOpen ? null : entry.id)}
                          className="px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300 cursor-pointer"
                        >
                          Details
                        </button>
                      )}
                      <span
                        className={`font-mono font-bold ${
                          entry.passed ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {entry.passed ? "✓" : "✗"}
                      </span>
                    </div>
                  </div>

                  {isOpen && entry.technicalDetails && (
                    <pre
                      dir="ltr"
                      className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400 overflow-x-auto"
                    >
                      {entry.technicalDetails}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
