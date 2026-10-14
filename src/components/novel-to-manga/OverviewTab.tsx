import React from "react";
import type { NovelMangaTabId } from "./ProjectNavigation";

interface OverviewTabProps {
  projectTitle: string;
  chapterLabel: string;
  geminiConnected: boolean;
  flowConnected: boolean;
  hasAnalysis: boolean;
  visualBibleReadyCount: number;
  visualBibleTotalCount: number;
  referencesLockedCount: number;
  referencesTotalCount: number;
  pagesGeneratedCount: number;
  pagesTotalCount: number;
  pagesReviewedCount: number;
  onNavigateTab: (tab: NovelMangaTabId) => void;
}

export default function OverviewTab({
  projectTitle,
  chapterLabel,
  geminiConnected,
  flowConnected,
  hasAnalysis,
  visualBibleReadyCount,
  visualBibleTotalCount,
  referencesLockedCount,
  referencesTotalCount,
  pagesGeneratedCount,
  pagesTotalCount,
  pagesReviewedCount,
  onNavigateTab,
}: OverviewTabProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Single concise description ONLY in Overview (Requirement 3) */}
      <p className="text-sm text-slate-300">
        حوّل الرواية إلى صفحات Manga/Manhwa باستخدام Gemini للتحليل وGoogle Flow للتوليد.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Project & Connection Status Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between gap-5">
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-1">Project</div>
            <h2 className="text-lg font-bold text-white">{projectTitle}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{chapterLabel}</p>
          </div>

          <div className="pt-4 border-t border-slate-800/80">
            <div className="text-xs font-semibold text-slate-400 mb-3">Status</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-400">Gemini</div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-white mt-1">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      geminiConnected ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  <span>{geminiConnected ? "Connected" : "Not Connected"}</span>
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-400">Google Flow</div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-white mt-1">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      flowConnected ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  <span>{flowConnected ? "Connected" : "Disconnected"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Checklist Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-3">Progress</div>
            <div className="divide-y divide-slate-800/70 text-xs font-mono tabular-nums">
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-300 font-sans">Analysis</span>
                <span className={hasAnalysis ? "text-emerald-400 font-bold" : "text-slate-500"}>
                  {hasAnalysis ? "✓" : "—"}
                </span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-300 font-sans">Visual Bible</span>
                <span className="text-white">
                  {visualBibleReadyCount} / {visualBibleTotalCount}
                </span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-300 font-sans">References</span>
                <span className="text-white">
                  {referencesLockedCount} / {referencesTotalCount}
                </span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-300 font-sans">Pages</span>
                <span className="text-white">
                  {pagesGeneratedCount} / {pagesTotalCount}
                </span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-300 font-sans">Review</span>
                <span className="text-white">
                  {pagesReviewedCount} / {pagesTotalCount}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5">
        <div className="text-xs font-semibold text-slate-400 mb-3">Quick Actions</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab("novel")}
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer"
          >
            تحليل الرواية
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("visual_bible")}
            className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition cursor-pointer"
          >
            إنشاء Visual Bible
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("references")}
            className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition cursor-pointer"
          >
            إنشاء المراجع
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab("pages")}
            className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition cursor-pointer"
          >
            إنشاء الصفحات
          </button>
        </div>
      </div>
    </div>
  );
}
