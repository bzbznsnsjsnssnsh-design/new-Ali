import React from "react";
import { Loader2, Lock } from "lucide-react";
import type { NovelPagePlan, VisualBibleReference } from "../../types/novelToManga";

interface ReferencesTabProps {
  visualBible: VisualBibleReference[];
  pagesPlan: NovelPagePlan[];
  busyRefId: string | null;
  onGenerateReference: (ref: VisualBibleReference) => void;
  onLockReference: (ref: VisualBibleReference) => void;
  onEditLockedReference: (ref: VisualBibleReference) => void;
}

export default function ReferencesTab({
  visualBible,
  pagesPlan,
  busyRefId,
  onGenerateReference,
  onLockReference,
  onEditLockedReference,
}: ReferencesTabProps) {
  const countUsedInPages = (refId: string): number => {
    return pagesPlan.filter(
      (p) =>
        p.world_id === refId ||
        p.location_id === refId ||
        p.style_id === refId ||
        p.character_ids.includes(refId) ||
        p.object_ids.includes(refId) ||
        p.weapon_ids.includes(refId) ||
        p.costume_ids.includes(refId)
    ).length;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">References</h2>
          <span className="text-xs font-mono text-slate-400">
            {visualBible.filter((r) => r.status === "LOCKED").length} / {visualBible.length} Locked
          </span>
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-right text-xs border-collapse font-mono tabular-nums">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-sans">
                <th className="py-3 px-3">Reference</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3">Version</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Review</th>
                <th className="py-3 px-3">Used By</th>
                <th className="py-3 px-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {visualBible.map((ref) => {
                const usedCount = countUsedInPages(ref.reference_id);
                const isBusy = busyRefId === ref.reference_id;
                return (
                  <tr key={ref.reference_id} className="hover:bg-slate-950/40">
                    <td className="py-3 px-3 font-bold text-white">{ref.reference_id}</td>
                    <td className="py-3 px-3 text-slate-300">{ref.category}</td>
                    <td className="py-3 px-3 text-slate-300">v{ref.version}</td>
                    <td className="py-3 px-3">
                      <span
                        className={
                          ref.status === "LOCKED"
                            ? "text-emerald-400 font-bold"
                            : ref.status === "APPROVED"
                            ? "text-sky-400 font-bold"
                            : "text-slate-400"
                        }
                      >
                        {ref.status === "LOCKED" ? "🔒 LOCKED" : ref.status}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {ref.review_result?.approved ? (
                        <span className="text-emerald-400">✓ Gemini</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-300">{usedCount} pages</td>
                    <td className="py-3 px-3 font-sans">
                      {ref.status === "LOCKED" ? (
                        <button
                          type="button"
                          onClick={() => onEditLockedReference(ref)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
                        >
                          Version {ref.version + 1}
                        </button>
                      ) : ref.status === "APPROVED" ? (
                        <button
                          type="button"
                          onClick={() => onLockReference(ref)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer inline-flex items-center gap-1"
                        >
                          <Lock className="h-3 w-3" />
                          <span>Lock</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onGenerateReference(ref)}
                          disabled={isBusy}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {isBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                          <span>Generate</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile 1-Column Cards (Requirement 27) */}
        <div className="grid grid-cols-1 gap-3 sm:hidden">
          {visualBible.map((ref) => {
            const usedCount = countUsedInPages(ref.reference_id);
            const isBusy = busyRefId === ref.reference_id;
            return (
              <div
                key={ref.reference_id}
                className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <strong className="text-white">{ref.reference_id}</strong>
                  <span
                    className={
                      ref.status === "LOCKED"
                        ? "text-emerald-400 font-bold"
                        : ref.status === "APPROVED"
                        ? "text-sky-400 font-bold"
                        : "text-slate-400"
                    }
                  >
                    {ref.status === "LOCKED" ? "🔒 LOCKED" : ref.status}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                  <span>{ref.category}</span>
                  <span>·</span>
                  <span>v{ref.version}</span>
                  <span>·</span>
                  <span>{ref.review_result?.approved ? "✓ Gemini" : "Pending"}</span>
                  <span>·</span>
                  <span>{usedCount} pages</span>
                </div>

                {ref.status === "LOCKED" ? (
                  <button
                    type="button"
                    onClick={() => onEditLockedReference(ref)}
                    className="w-full py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-semibold"
                  >
                    Version {ref.version + 1}
                  </button>
                ) : ref.status === "APPROVED" ? (
                  <button
                    type="button"
                    onClick={() => onLockReference(ref)}
                    className="w-full py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                  >
                    Lock
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onGenerateReference(ref)}
                    disabled={isBusy}
                    className="w-full py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {isBusy ? "Generating..." : "Generate"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
