import React, { useState } from "react";
import { Loader2, Play, RefreshCw, Save } from "lucide-react";
import type { PageQueueItem, PreflightStepResult, PreflightTestReport } from "../../types/novelToManga";

const DEFAULT_PREFLIGHT_STEPS: Array<{ id: string; shortLabel: string }> = [
  { id: "gemini_test", shortLabel: "1 Gemini" },
  { id: "flow_session_test", shortLabel: "2 Flow Session" },
  { id: "flow_upload_test", shortLabel: "3 Upload" },
  { id: "reference_test", shortLabel: "4 Reference" },
  { id: "generation_test", shortLabel: "5 Generation" },
  { id: "result_download_test", shortLabel: "6 Download" },
  { id: "gemini_review_test", shortLabel: "7 Review" },
];

interface QueueTabProps {
  queue: PageQueueItem[];
  busyPageId: string | null;
  isRunningFullQueue: boolean;
  preflightReport: PreflightTestReport | null;
  isRunningPreflight: boolean;
  onRunPreflight: () => void;
  onGenerateSinglePage: (pageId: string) => void;
  onRunAllQueue: () => void;
  onSaveApprovedToLibrary: () => void;
}

export default function QueueTab({
  queue,
  busyPageId,
  isRunningFullQueue,
  preflightReport,
  isRunningPreflight,
  onRunPreflight,
  onGenerateSinglePage,
  onRunAllQueue,
  onSaveApprovedToLibrary,
}: QueueTabProps) {
  const [showPreflightStepper, setShowPreflightStepper] = useState<boolean>(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const runningCount = queue.filter(
    (q) => q.status === "GENERATING" || q.status === "REVIEWING" || q.status === "REGENERATING"
  ).length;
  const waitingCount = queue.filter((q) => q.status === "WAITING").length;
  const approvedCount = queue.filter((q) => q.status === "APPROVED").length;
  const failedCount = queue.filter((q) => q.status === "FAILED").length;

  const isPreflightReady = Boolean(preflightReport?.ready);

  const selectedStepObj: PreflightStepResult | undefined = preflightReport?.steps.find(
    (s) => s.step_id === selectedStepId
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Compact Preflight Bar / Stepper (Requirements 19 & 36) */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            <span className="font-bold text-white">Preflight</span>
            {isPreflightReady ? (
              <span className="text-emerald-400 font-mono font-bold">✓ Ready</span>
            ) : preflightReport ? (
              <span className="text-rose-400 font-mono font-bold">✕ Action Needed</span>
            ) : (
              <span className="text-slate-400 font-mono">Not Run Yet</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreflightStepper((v) => !v)}
              className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold cursor-pointer"
            >
              {showPreflightStepper ? "إخفاء الخطوات" : "الخطوات"}
            </button>

            <button
              type="button"
              onClick={onRunPreflight}
              disabled={isRunningPreflight}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {isRunningPreflight ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>{isPreflightReady ? "Run Again" : "Run Preflight"}</span>
            </button>
          </div>
        </div>

        {/* Stepper (Shown on demand or if preflight failed) */}
        {(showPreflightStepper || (preflightReport && !preflightReport.ready)) && (
          <div className="pt-3 border-t border-slate-800/80 flex flex-col gap-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {DEFAULT_PREFLIGHT_STEPS.map((st) => {
                const match = preflightReport?.steps.find((s) => s.step_id === st.id);
                const status = match?.status || "SKIPPED";
                const isSelected = selectedStepId === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setSelectedStepId(isSelected ? null : st.id)}
                    className={`px-3 py-2 rounded-lg text-xs font-mono whitespace-nowrap border transition cursor-pointer flex items-center gap-2 ${
                      isSelected
                        ? "bg-slate-800 border-emerald-500/50 text-white"
                        : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <span>{st.shortLabel}</span>
                    <span
                      className={
                        status === "PASS"
                          ? "text-emerald-400 font-bold"
                          : status === "FAIL"
                          ? "text-rose-400 font-bold"
                          : "text-slate-500"
                      }
                    >
                      {status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "—"}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedStepObj && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs flex items-center justify-between gap-2">
                <span className="text-slate-300">{selectedStepObj.message}</span>
                <span className="font-mono text-slate-500">{selectedStepObj.duration_ms}ms</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Generation Queue Header & Summary (Requirement 22) */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Generation Queue</h2>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-mono tabular-nums mt-1.5">
              <span>
                <span className="text-slate-400 font-sans">Running: </span>
                <strong className="text-amber-400">{runningCount}</strong>
              </span>
              <span>
                <span className="text-slate-400 font-sans">Waiting: </span>
                <strong className="text-slate-200">{waitingCount}</strong>
              </span>
              <span>
                <span className="text-slate-400 font-sans">Approved: </span>
                <strong className="text-emerald-400">{approvedCount}</strong>
              </span>
              <span>
                <span className="text-slate-400 font-sans">Failed: </span>
                <strong className="text-rose-400">{failedCount}</strong>
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              type="button"
              onClick={onRunAllQueue}
              disabled={isRunningFullQueue}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {isRunningFullQueue ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span>تشغيل الطابور</span>
            </button>

            <button
              type="button"
              onClick={onSaveApprovedToLibrary}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              <span>حفظ في المكتبة</span>
            </button>
          </div>
        </div>

        {/* Clean Page Queue List (No full prompts — Requirement 22) */}
        <div className="divide-y divide-slate-800/80 border-t border-slate-800/80 pt-2">
          {queue.map((item) => {
            const isBusy = busyPageId === item.page_id;
            const projLabel = item.flow_project_id
              ? item.flow_project_id.replace("flow_project_", "Project ")
              : "1";

            return (
              <div
                key={item.page_id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs font-mono tabular-nums">
                  <strong className="text-white text-sm">{item.page_id}</strong>

                  <span
                    className={
                      item.status === "APPROVED"
                        ? "text-emerald-400 font-bold"
                        : item.status === "FAILED"
                        ? "text-rose-400 font-bold"
                        : item.status === "WAITING"
                        ? "text-slate-400"
                        : "text-amber-400 font-bold"
                    }
                  >
                    {isBusy ? "GENERATING" : item.status}
                  </span>

                  <span className="text-slate-400">
                    Project: <strong className="text-slate-200">{projLabel}</strong>
                  </span>

                  <span className="text-slate-400">
                    Model: <strong className="text-slate-200">{item.flow_model}</strong>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onGenerateSinglePage(item.page_id)}
                  disabled={isBusy}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                >
                  {isBusy
                    ? "Generating..."
                    : item.status === "APPROVED"
                    ? "Regenerate"
                    : "Generate"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
