import React, { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { NovelPagePlan, PageQueueItem } from "../../types/novelToManga";

interface PagesTabProps {
  pagesPlan: NovelPagePlan[];
  queue: PageQueueItem[];
  busyPageId: string | null;
  onGeneratePage: (pageId: string) => void;
  onNavigateToReview: () => void;
}

export default function PagesTab({
  pagesPlan,
  queue,
  busyPageId,
  onGeneratePage,
  onNavigateToReview,
}: PagesTabProps) {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState<boolean>(false);
  const [showPreviewImage, setShowPreviewImage] = useState<boolean>(false);

  const getPageRefsList = (page: NovelPagePlan): string[] => {
    return Array.from(
      new Set(
        [
          page.world_id,
          page.location_id,
          ...page.character_ids,
          ...page.object_ids,
          ...page.weapon_ids,
          ...page.costume_ids,
          page.style_id,
        ].filter(Boolean)
      )
    );
  };

  const activePage = selectedPageId
    ? pagesPlan.find((p) => p.page_id === selectedPageId) || null
    : null;

  const activeQueueItem = selectedPageId
    ? queue.find((q) => q.page_id === selectedPageId) || null
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Pages</h2>
        <span className="text-xs font-mono text-slate-400">
          {pagesPlan.length} Planned Pages
        </span>
      </div>

      {/* Page Cards Grid (1 column on mobile, 2-3 columns on desktop — Requirement 20 & 27) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {pagesPlan.map((page) => {
          const qItem = queue.find((q) => q.page_id === page.page_id);
          const status = qItem?.status || "WAITING";
          const refsList = getPageRefsList(page);

          return (
            <div
              key={page.page_id}
              onClick={() => {
                setSelectedPageId(page.page_id);
                setShowPrompt(false);
                setShowPreviewImage(false);
              }}
              className="bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-5 flex flex-col justify-between gap-4 transition cursor-pointer"
            >
              <div>
                <div className="flex items-center justify-between font-mono text-xs mb-2">
                  <strong className="text-white text-sm">{page.page_id}</strong>
                  <span className="text-slate-400">{page.scene_id}</span>
                </div>

                <h3 className="text-sm font-bold text-slate-200 line-clamp-1">{page.title}</h3>

                <div className="mt-3 space-y-1 text-xs font-mono text-slate-400 tabular-nums">
                  <div>{page.panels?.length ?? 0} Panels</div>
                  <div>References: {refsList.length}</div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400 font-sans">Status:</span>
                <span
                  className={
                    status === "APPROVED"
                      ? "text-emerald-400 font-bold"
                      : status === "FAILED"
                      ? "text-rose-400 font-bold"
                      : status === "WAITING"
                      ? "text-slate-400"
                      : "text-amber-400 font-bold"
                  }
                >
                  {status}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Page Details Modal/Drawer (Requirement 21) */}
      {activePage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedPageId(null);
          }}
        >
          <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="text-base font-mono font-bold text-white">
                  {activePage.page_id}
                </div>
                <div className="text-xs text-slate-400">{activePage.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPageId(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Structured Page Info */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs font-mono">
              <div>
                <span className="text-slate-400 block font-sans">Scene</span>
                <strong className="text-white">{activePage.scene_id}</strong>
              </div>
              <div>
                <span className="text-slate-400 block font-sans">Panels</span>
                <strong className="text-white">{activePage.panels?.length ?? 0}</strong>
              </div>
              <div>
                <span className="text-slate-400 block font-sans">Continuity</span>
                <strong className="text-emerald-400">
                  {activePage.continuity_from_previous_page ? "✓ Previous Page" : "— First Page"}
                </strong>
              </div>
              <div>
                <span className="text-slate-400 block font-sans">Status</span>
                <strong className="text-white">{activeQueueItem?.status || "WAITING"}</strong>
              </div>
            </div>

            {/* References List */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80">
              <div className="text-xs font-semibold text-slate-400 mb-2">References</div>
              <div className="flex flex-wrap gap-2 text-xs font-mono text-slate-200">
                {getPageRefsList(activePage).map((refId) => (
                  <span key={refId}>{refId}</span>
                ))}
              </div>
            </div>

            {/* Panels Summary */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2">
              <div className="text-xs font-semibold text-slate-400">Panels ({activePage.panels?.length ?? 0})</div>
              {Array.isArray(activePage.panels) && activePage.panels.map((pan) => (
                <div key={pan.panel_id} className="text-xs border-b border-slate-800/60 pb-2 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between font-mono text-[11px] text-slate-400">
                    <span>{pan.panel_id}</span>
                    <span>{pan.camera_angle}</span>
                  </div>
                  <div className="text-slate-200 mt-0.5">{pan.composition}</div>
                </div>
              ))}
            </div>

            {/* Hidden-by-default Prompt (Requirement 10) */}
            {activeQueueItem?.prompt && (
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">Prompt</span>
                  <button
                    type="button"
                    onClick={() => setShowPrompt((v) => !v)}
                    className="px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-200 font-semibold cursor-pointer"
                  >
                    {showPrompt ? "إخفاء" : "إظهار"}
                  </button>
                </div>
                {showPrompt && (
                  <p className="mt-2 text-xs font-mono text-slate-300 leading-relaxed" dir="ltr">
                    {activeQueueItem.prompt}
                  </p>
                )}
              </div>
            )}

            {/* Preview Image if toggled */}
            {showPreviewImage && activeQueueItem?.image_path && (
              <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-[3/4]">
                <img
                  src={activeQueueItem.image_path}
                  alt={activePage.page_id}
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            {/* Action Buttons (Requirement 21) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
              {!activeQueueItem?.image_path ? (
                <button
                  type="button"
                  onClick={() => onGeneratePage(activePage.page_id)}
                  disabled={busyPageId === activePage.page_id}
                  className="sm:col-span-3 w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {busyPageId === activePage.page_id && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  <span>Generate</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowPreviewImage((v) => !v)}
                    className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPageId(null);
                      onNavigateToReview();
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    onClick={() => onGeneratePage(activePage.page_id)}
                    disabled={busyPageId === activePage.page_id}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    Regenerate
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
