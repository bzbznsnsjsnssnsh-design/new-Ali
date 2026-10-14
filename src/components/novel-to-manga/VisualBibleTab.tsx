import React, { useState } from "react";
import { Image as ImageIcon, Loader2, Lock, Plus, X } from "lucide-react";
import type {
  NovelPagePlan,
  VisualBibleCategory,
  VisualBibleReference,
} from "../../types/novelToManga";
import { ALL_VISUAL_BIBLE_CATEGORIES } from "../../types/novelToManga";

const PRIMARY_FILTER_CHIPS: Array<{ label: string; value: string }> = [
  { label: "All", value: "ALL" },
  { label: "World", value: "WORLD" },
  { label: "Environment", value: "ENVIRONMENT" },
  { label: "Location", value: "LOCATION" },
  { label: "Character", value: "CHARACTER" },
  { label: "Costume", value: "COSTUME" },
  { label: "Weapon", value: "WEAPON" },
  { label: "Object", value: "ITEM" },
  { label: "Creature", value: "CREATURE" },
  { label: "Lighting", value: "LIGHTING" },
  { label: "Style", value: "ART STYLE" },
];

interface VisualBibleTabProps {
  visualBible: VisualBibleReference[];
  pagesPlan: NovelPagePlan[];
  busyRefId: string | null;
  onGenerateReference: (ref: VisualBibleReference) => void;
  onLockReference: (ref: VisualBibleReference) => void;
  onEditLockedReference: (ref: VisualBibleReference) => void;
  onAddReference: (entry: {
    category: VisualBibleCategory;
    name: string;
    description: string;
    prompt: string;
  }) => void;
}

export default function VisualBibleTab({
  visualBible,
  pagesPlan,
  busyRefId,
  onGenerateReference,
  onLockReference,
  onEditLockedReference,
  onAddReference,
}: VisualBibleTabProps) {
  const [selectedFilter, setSelectedFilter] = useState<string>("ALL");
  const [detailsRef, setDetailsRef] = useState<VisualBibleReference | null>(null);
  const [showPromptInModal, setShowPromptInModal] = useState<boolean>(false);
  const [showVersionHistoryInModal, setShowVersionHistoryInModal] = useState<boolean>(false);

  // Add new reference modal
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [newCategory, setNewCategory] = useState<VisualBibleCategory>("WORLD");
  const [newName, setNewName] = useState<string>("");
  const [newDesc, setNewDesc] = useState<string>("");
  const [newPrompt, setNewPrompt] = useState<string>("");

  const lockedCount = visualBible.filter((r) => r.status === "LOCKED").length;

  const filteredReferences =
    selectedFilter === "ALL"
      ? visualBible
      : visualBible.filter((r) => r.category === selectedFilter);

  const getPagesUsingReference = (refId: string): string[] => {
    return pagesPlan
      .filter(
        (p) =>
          p.world_id === refId ||
          p.location_id === refId ||
          p.style_id === refId ||
          p.character_ids.includes(refId) ||
          p.object_ids.includes(refId) ||
          p.weapon_ids.includes(refId) ||
          p.costume_ids.includes(refId)
      )
      .map((p) => `Page ${String(p.page_number).padStart(3, "0")}`);
  };

  // Keep modal reference synced with latest visualBible state
  const activeModalRef = detailsRef
    ? visualBible.find((r) => r.reference_id === detailsRef.reference_id) || detailsRef
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header & Compact Stats */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Visual Bible</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1 font-mono tabular-nums">
              <span>23 Reference Categories</span>
              <span aria-hidden="true">·</span>
              <span>{visualBible.length} Created</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">{lockedCount} Locked</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Compact Category Select for all 23 categories */}
            <select
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">All ({visualBible.length})</option>
              {ALL_VISUAL_BIBLE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إضافة</span>
            </button>
          </div>
        </div>

        {/* Horizontal Scrollable Filter Chips (Requirement 7) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {PRIMARY_FILTER_CHIPS.map((chip) => {
            const active = selectedFilter === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => setSelectedFilter(chip.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  active
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reference Cards Grid (1 column on mobile, 2-3 columns on desktop — Requirement 8 & 27) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredReferences.map((ref) => {
          const isBusy = busyRefId === ref.reference_id;
          return (
            <div
              key={ref.reference_id}
              className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="text-xs font-mono font-bold text-slate-300 mb-2">
                  {ref.reference_id}
                </div>

                {/* Aspect-Ratio Reference Image Preview */}
                <div className="w-full aspect-[4/3] rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-center overflow-hidden mb-3">
                  {ref.image_url ? (
                    <img
                      src={ref.image_url}
                      alt={ref.reference_id}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center text-slate-500 p-4">
                      <ImageIcon className="h-7 w-7 mx-auto mb-1 opacity-40" />
                      <span className="text-xs">صورة المرجع</span>
                    </div>
                  )}
                </div>

                <h3 className="text-sm font-bold text-white line-clamp-1">{ref.name}</h3>

                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-1">
                  <span>{ref.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>v{ref.version}</span>
                </div>

                {/* Single Status Indicator (Requirement 38 & 39) */}
                <div className="mt-2.5 flex items-center gap-1.5 text-xs font-mono font-semibold">
                  {ref.status === "LOCKED" ? (
                    <span className="text-emerald-400">🔒 LOCKED</span>
                  ) : ref.status === "APPROVED" ? (
                    <span className="text-sky-400">✓ APPROVED</span>
                  ) : isBusy || ref.status === "GENERATING" ? (
                    <span className="text-amber-400">● GENERATING</span>
                  ) : ref.status === "REVIEWING" ? (
                    <span className="text-amber-400">● REVIEWING</span>
                  ) : (
                    <span className="text-slate-400">● DRAFT</span>
                  )}
                </div>
              </div>

              {/* Card Buttons (Full-width friendly on mobile, no prompt text inside card) */}
              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-800/80">
                {ref.status === "LOCKED" ? (
                  <button
                    type="button"
                    onClick={() => onEditLockedReference(ref)}
                    className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                  >
                    Version {ref.version + 1}
                  </button>
                ) : ref.status === "APPROVED" ? (
                  <button
                    type="button"
                    onClick={() => onLockReference(ref)}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span>Lock</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onGenerateReference(ref)}
                    disabled={isBusy}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>{isBusy ? "Generating..." : "توليد"}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setDetailsRef(ref);
                    setShowPromptInModal(false);
                    setShowVersionHistoryInModal(false);
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition cursor-pointer"
                >
                  تفاصيل
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reference Details Drawer / Modal (Requirements 9 & 10) */}
      {activeModalRef && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailsRef(null);
          }}
        >
          <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="text-sm font-mono font-bold text-white">
                  {activeModalRef.reference_id}
                </div>
                <div className="text-xs text-slate-400">{activeModalRef.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setDetailsRef(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Preview */}
            <div>
              <div className="text-xs text-slate-400 mb-1.5">Preview</div>
              <div className="w-full aspect-[4/3] rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden">
                {activeModalRef.image_url ? (
                  <img
                    src={activeModalRef.image_url}
                    alt={activeModalRef.reference_id}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-slate-500">لا توجد صورة مولدة بعد</span>
                )}
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/80 p-4 rounded-xl border border-slate-800/80 font-mono">
              <div>
                <span className="text-slate-400 block font-sans">Status</span>
                <strong className="text-white">
                  {activeModalRef.status === "LOCKED" ? "🔒 LOCKED" : activeModalRef.status}
                </strong>
              </div>
              <div>
                <span className="text-slate-400 block font-sans">Version</span>
                <strong className="text-white">v{activeModalRef.version}</strong>
              </div>
              <div>
                <span className="text-slate-400 block font-sans">Category</span>
                <strong className="text-white">{activeModalRef.category}</strong>
              </div>
              <div>
                <span className="text-slate-400 block font-sans">Gemini Review</span>
                <strong
                  className={
                    activeModalRef.review_result?.approved ? "text-emerald-400" : "text-slate-400"
                  }
                >
                  {activeModalRef.review_result?.approved ? "✓ Approved" : "Pending"}
                </strong>
              </div>
            </div>

            {/* Hidden-by-default Prompt (Requirement 10) */}
            <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Reference Prompt</span>
                <button
                  type="button"
                  onClick={() => setShowPromptInModal((v) => !v)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-semibold cursor-pointer"
                >
                  {showPromptInModal ? "إخفاء" : "إظهار"}
                </button>
              </div>
              {showPromptInModal && (
                <p className="mt-2.5 text-xs font-mono text-slate-300 leading-relaxed" dir="ltr">
                  {activeModalRef.prompt}
                </p>
              )}
            </div>

            {/* Used In Pages */}
            <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80">
              <div className="text-xs font-semibold text-slate-300 mb-2">Used In</div>
              <div className="flex flex-wrap gap-2 text-xs font-mono text-slate-300">
                {getPagesUsingReference(activeModalRef.reference_id).length > 0 ? (
                  getPagesUsingReference(activeModalRef.reference_id).map((pageLabel) => (
                    <span key={pageLabel}>{pageLabel}</span>
                  ))
                ) : (
                  <span className="text-slate-500">لم يُربط بصفحة بعد</span>
                )}
              </div>
            </div>

            {/* Optional Version History */}
            {showVersionHistoryInModal && (
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80 text-xs font-mono space-y-1.5">
                <div className="font-sans font-semibold text-slate-300 mb-1">سجل الإصدارات</div>
                {!activeModalRef.versions || activeModalRef.versions.length === 0 ? (
                  <div className="text-slate-500">الإصدار الحالي v{activeModalRef.version}</div>
                ) : (
                  activeModalRef.versions.map((ver) => (
                    <div key={ver.version} className="flex items-center justify-between text-slate-300">
                      <span>v{ver.version} ({ver.file_name})</span>
                      <span>{ver.status}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Modal Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setDetailsRef(null);
                  onEditLockedReference(activeModalRef);
                }}
                className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                توليد Version جديدة
              </button>

              <button
                type="button"
                onClick={() => onGenerateReference(activeModalRef)}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                إعادة المراجعة
              </button>

              <button
                type="button"
                onClick={() => setShowVersionHistoryInModal((v) => !v)}
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                عرض السجل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Reference Modal */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsAddModalOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">إضافة عنصر إلى Visual Bible</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">الفئة (Category)</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as VisualBibleCategory)}
                  className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  {ALL_VISUAL_BIBLE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">الاسم</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: عالم الطريق المضيء"
                  className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">الوصف المختصر</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="السمات البصرية الثابتة..."
                  className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Prompt (اختياري)</label>
                <textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  rows={3}
                  dir="ltr"
                  className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!newName.trim()) return;
                  onAddReference({
                    category: newCategory,
                    name: newName,
                    description: newDesc,
                    prompt: newPrompt,
                  });
                  setNewName("");
                  setNewDesc("");
                  setNewPrompt("");
                  setIsAddModalOpen(false);
                }}
                className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                حفظ العنصر
              </button>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
