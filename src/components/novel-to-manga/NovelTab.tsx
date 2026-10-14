import React, { useState, useEffect } from "react";
import { Loader2, X, Zap } from "lucide-react";
import type {
  GeminiCookieModelId,
  NovelPagePlan,
  NovelSceneAnalysis,
  VisualBibleReference,
} from "../../types/novelToManga";
import PreparedNovelSection from "./PreparedNovelSection";
import type { PreparedNovelData } from "../../utils/preparedNovelParser";

export const COMPACT_GEMINI_MODELS: Array<{
  id: GeminiCookieModelId;
  name: string;
  tag: string;
  desc: string;
}> = [
  { id: "3.5-flash-lite", name: "3.5 Flash-Lite", tag: "⚡ سريع", desc: "سرعة قصوى واستجابة فورية." },
  {
    id: "3.5-flash-lite-extended",
    name: "3.5 Flash-Lite (Extended)",
    tag: "🧠 تفكير موسع",
    desc: "تفكير موسع للمهام الدقيقة والتحليل الأكثر عمقًا.",
  },
  {
    id: "3.6-flash",
    name: "3.6 Flash",
    tag: "🌟 متوازن",
    desc: "متوازن للسياق الطويل والحوارات والتحليل العام.",
  },
  {
    id: "3.1-pro",
    name: "3.1 Pro",
    tag: "🧠 متقدم",
    desc: "للمهام المعقدة، والتحليل العميق، والاستمرارية الدقيقة.",
  },
];

interface NovelTabProps {
  novelTitle: string;
  onChangeTitle: (val: string) => void;
  novelFormat: "Manga" | "Manhwa" | "Webtoon";
  onChangeFormat: (fmt: "Manga" | "Manhwa" | "Webtoon") => void;
  novelText: string;
  onChangeText: (val: string) => void;
  analysisModel: GeminiCookieModelId;
  onChangeAnalysisModel: (model: GeminiCookieModelId) => void;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  scenes: NovelSceneAnalysis[];
  pagesPlan: NovelPagePlan[];
  visualBible: VisualBibleReference[];
}

export default function NovelTab({
  novelTitle,
  onChangeTitle,
  novelFormat,
  onChangeFormat,
  novelText,
  onChangeText,
  analysisModel,
  onChangeAnalysisModel,
  isAnalyzing,
  onAnalyze,
  scenes,
  pagesPlan,
  visualBible,
}: NovelTabProps) {
  const [showAnalysisDetails, setShowAnalysisDetails] = useState(false);
  const [preparedData, setPreparedData] = useState<PreparedNovelData | null>(() => {
    try {
      const raw = localStorage.getItem("studio_prepared_novel_data");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  });

  const handleSavePreparedData = (data: PreparedNovelData) => {
    setPreparedData(data);
    try {
      localStorage.setItem("studio_prepared_novel_data", JSON.stringify(data));
    } catch (_) {}
    if (data.novel_title) onChangeTitle(data.novel_title);
    if (data.converted_studio_data?.script_text) {
      onChangeText(data.converted_studio_data.script_text);
    }
  };

  const handleClearPreparedData = () => {
    setPreparedData(null);
    try {
      localStorage.removeItem("studio_prepared_novel_data");
    } catch (_) {}
  };

  const [scenePrepMode, setScenePrepMode] = useState<"PREPARED" | "LIVE_EVENTS">(() => {
    try {
      const saved = localStorage.getItem("novel_manga_scene_prep_mode");
      if (saved === "PREPARED" || saved === "LIVE_EVENTS") return saved;
      if (localStorage.getItem("studio_prepared_novel_data")) return "PREPARED";
    } catch (_) {}
    return "PREPARED";
  });

  const handleSelectMode = (mode: "PREPARED" | "LIVE_EVENTS") => {
    setScenePrepMode(mode);
    try {
      localStorage.setItem("novel_manga_scene_prep_mode", mode);
    } catch (_) {}
  };

  const totalPanels = pagesPlan.reduce((acc, p) => acc + p.panels.length, 0);
  const charactersCount = visualBible.filter((r) => r.category === "CHARACTER").length;
  const locationsCount = visualBible.filter(
    (r) => r.category === "LOCATION" || r.category === "WORLD" || r.category === "ENVIRONMENT"
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {/* 🔀 زر الفصل التام بين [تجهيز مسبق] و [بدء تجهيز حدث] */}
      <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">مسار المشاهد:</span>
          <span className="text-xs text-slate-400">
            {scenePrepMode === "PREPARED"
              ? "⚡ تم تفعيل وضع [تجهيز مسبق] وإخفاء خانة البدء المباشر"
              : "🎬 تم تفعيل وضع [بدء تجهيز حدث] وإخفاء خانة التجهيز المسبق"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSelectMode("PREPARED")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              scenePrepMode === "PREPARED"
                ? "bg-emerald-600 text-white shadow"
                : "bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>تجهيز مسبق (Prepared Data)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectMode("LIVE_EVENTS")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
              scenePrepMode === "LIVE_EVENTS"
                ? "bg-sky-600 text-white shadow"
                : "bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            <span>🎬 بدء تجهيز حدث (Live Setup)</span>
          </button>
        </div>
      </div>

      {/* الخانة الأولى: ⚡ تجهيز مسبق (تظهر فقط عند تفعيل التجهيز المسبق) */}
      {scenePrepMode === "PREPARED" && (
        <PreparedNovelSection
          currentNovelTitle={novelTitle}
          currentNovelText={novelText}
          preparedData={preparedData}
          onSavePreparedData={handleSavePreparedData}
          onClearPreparedData={handleClearPreparedData}
          onApplyDirectlyToStudio={handleSavePreparedData}
        />
      )}

      {/* الخانة الثانية: 🎬 بدء تجهيز حدث (تظهر فقط عند تفعيل بدء تجهيز حدث وتختفي في التجهيز المسبق) */}
      {scenePrepMode === "LIVE_EVENTS" && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 sm:p-6 flex flex-col gap-5">
          <h2 className="text-lg font-bold text-white">Novel</h2>

        {/* Chapter Title */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-400">Chapter Title</label>
          <input
            type="text"
            value={novelTitle}
            onChange={(e) => onChangeTitle(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* Output Format */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-400">Output Format</label>
          <div className="grid grid-cols-3 gap-2 max-w-md">
            {(["Manhwa", "Manga", "Webtoon"] as const).map((fmt) => {
              const active = novelFormat === fmt;
              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onChangeFormat(fmt)}
                  className={`py-2 px-4 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    active
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-950 text-slate-400 border border-slate-800 hover:text-white"
                  }`}
                >
                  {fmt}
                </button>
              );
            })}
          </div>
        </div>

        {/* Novel Text */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-400">Novel Text</label>
          <textarea
            value={novelText}
            onChange={(e) => onChangeText(e.target.value)}
            rows={9}
            className="w-full p-4 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-200 leading-relaxed focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* Gemini Model Selector + Analyze Action */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-2 border-t border-slate-800/80">
          <div className="flex flex-col gap-1.5 sm:w-64">
            <label className="text-xs font-semibold text-slate-400">Gemini Model</label>
            <select
              value={analysisModel}
              onChange={(e) => onChangeAnalysisModel(e.target.value as GeminiCookieModelId)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
            >
              {COMPACT_GEMINI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.tag}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onAnalyze}
            disabled={isAnalyzing || !novelText.trim()}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50"
          >
            {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>تحليل الرواية</span>
          </button>
        </div>
      </div>
      )}

      {/* Compact Post-Analysis Summary Card */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono tabular-nums">
          <div>
            <span className="text-slate-400 font-sans">Scenes: </span>
            <strong className="text-white">{scenes.length}</strong>
          </div>
          <div>
            <span className="text-slate-400 font-sans">Pages: </span>
            <strong className="text-white">{pagesPlan.length}</strong>
          </div>
          <div>
            <span className="text-slate-400 font-sans">Panels: </span>
            <strong className="text-white">{totalPanels}</strong>
          </div>
          <div>
            <span className="text-slate-400 font-sans">Characters: </span>
            <strong className="text-white">{charactersCount}</strong>
          </div>
          <div>
            <span className="text-slate-400 font-sans">Locations: </span>
            <strong className="text-white">{locationsCount}</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAnalysisDetails(true)}
          className="w-full sm:w-auto px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
        >
          عرض التحليل
        </button>
      </div>

      {/* Analysis Details Drawer/Modal */}
      {showAnalysisDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAnalysisDetails(false);
          }}
        >
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">تفاصيل تحليل الرواية</h3>
              <button
                type="button"
                onClick={() => setShowAnalysisDetails(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {scenes.map((scene) => (
                <div
                  key={scene.scene_id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-emerald-400 font-bold">{scene.scene_id}</span>
                    <span className="text-slate-400">{scene.time_of_day}</span>
                  </div>
                  <div className="text-sm font-bold text-white">{scene.title}</div>
                  <p className="text-xs text-slate-300 leading-relaxed">{scene.dramatic_summary}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
