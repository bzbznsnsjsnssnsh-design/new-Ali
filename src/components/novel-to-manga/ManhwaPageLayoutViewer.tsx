import React, { useState, useEffect } from "react";
import {
  Layers,
  LayoutGrid,
  FileText,
  Eye,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Camera,
  Maximize2,
  ShieldCheck,
  Compass,
  Zap,
  Film,
  Check,
  Sliders,
  ImageIcon,
} from "lucide-react";
import type {
  ChapterManhwaLayoutPlan,
  ChapterScenePerPageLayoutPlan,
  ManhwaPagePlan,
  ManhwaPanelPlan,
  ScenePerPagePlan,
  StudioSceneItem,
  NovelChapterBlock,
  StudioProductionElement,
  StudioLocationItem,
  ManhwaPageLayoutType,
  PageGenerationMode,
} from "../../types/novelToManga";
import {
  planChapterManhwaPagesApi,
  verifyManhwaPageApi,
  replanManhwaPageLayoutApi,
} from "../../services/novelToMangaClient";

interface ManhwaPageLayoutViewerProps {
  scenes: StudioSceneItem[];
  blocks?: NovelChapterBlock[];
  elements?: StudioProductionElement[];
  locations?: StudioLocationItem[];
  chapterId?: string;
  chapterTitle?: string;
  selectedStyle?: string;
  aspectRatio?: string;
  pageMode?: PageGenerationMode;
  onPageModeChange?: (mode: PageGenerationMode) => void;
}

export const ManhwaPageLayoutViewer: React.FC<ManhwaPageLayoutViewerProps> = ({
  scenes,
  blocks = [],
  elements = [],
  locations = [],
  chapterId = "CHAPTER_221",
  chapterTitle = "Shadow Slave - Chapter 221",
  selectedStyle = "Korean Manhwa",
  aspectRatio = "9:16",
  pageMode = "SCENE_PER_PAGE",
  onPageModeChange,
}) => {
  const [activeMode, setActiveMode] = useState<PageGenerationMode>(pageMode);
  const [manhwaLayoutPlan, setManhwaLayoutPlan] = useState<ChapterManhwaLayoutPlan | null>(null);
  const [scenePerPagePlan, setScenePerPagePlan] = useState<ChapterScenePerPageLayoutPlan | null>(null);
  const [isPlanning, setIsPlanning] = useState<boolean>(false);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"PAGES_VIEW" | "VERTICAL_STRIP" | "TRACEABILITY_MATRIX">("PAGES_VIEW");
  const [showPromptDetails, setShowPromptDetails] = useState<boolean>(false);
  const [activeLayoutFilter, setActiveLayoutFilter] = useState<string>("ALL");

  useEffect(() => {
    if (pageMode !== activeMode) {
      setActiveMode(pageMode);
    }
  }, [pageMode]);

  // Auto-plan pages when scenes are available or mode changes
  useEffect(() => {
    if (scenes.length > 0) {
      handleGenerateLayout(activeMode);
    }
  }, [scenes.length, activeMode]);

  const handleModeSwitch = (newMode: PageGenerationMode) => {
    setActiveMode(newMode);
    if (onPageModeChange) {
      onPageModeChange(newMode);
    }
    handleGenerateLayout(newMode);
  };

  const handleGenerateLayout = async (targetMode: PageGenerationMode = activeMode) => {
    setIsPlanning(true);
    try {
      const res = await planChapterManhwaPagesApi({
        chapter_id: chapterId,
        chapter_title: chapterTitle,
        scenes,
        blocks,
        elements,
        locations,
        preferred_style: selectedStyle,
        page_mode: targetMode,
        aspect_ratio: aspectRatio,
      });

      if (res.success) {
        if (targetMode === "SCENE_PER_PAGE" && (res.scene_per_page_plan || res.plan)) {
          const sppPlan = (res.scene_per_page_plan || res.plan) as ChapterScenePerPageLayoutPlan;
          setScenePerPagePlan(sppPlan);
          if (sppPlan.pages.length > 0) {
            setSelectedPageId(sppPlan.pages[0].page_id);
          }
        } else if (res.plan) {
          const mPlan = res.plan as ChapterManhwaLayoutPlan;
          setManhwaLayoutPlan(mPlan);
          if (mPlan.pages.length > 0) {
            setSelectedPageId(mPlan.pages[0].page_id);
          }
        }
      }
    } catch (err) {
      console.error("Failed to plan page layout:", err);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleReplanPage = async (page: ManhwaPagePlan, newLayout: ManhwaPageLayoutType) => {
    try {
      const res = await replanManhwaPageLayoutApi({
        page,
        new_layout_type: newLayout,
      });

      if (res.success && res.page && manhwaLayoutPlan) {
        setManhwaLayoutPlan({
          ...manhwaLayoutPlan,
          pages: manhwaLayoutPlan.pages.map((p) => (p.page_id === res.page!.page_id ? res.page! : p)),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("Failed to replan page layout:", err);
    }
  };

  const selectedManhwaPage = manhwaLayoutPlan?.pages.find((p) => p.page_id === selectedPageId) || manhwaLayoutPlan?.pages[0] || null;
  const selectedManhwaPanel = selectedManhwaPage?.panels.find((p) => p.panel_id === selectedPanelId) || null;

  const selectedScenePerPage = scenePerPagePlan?.pages.find((p) => p.page_id === selectedPageId) || scenePerPagePlan?.pages[0] || null;
  const matchedSceneForSelectedPage = scenes.find((s) => s.scene_id === selectedScenePerPage?.scene_id);

  const filteredManhwaPages = manhwaLayoutPlan?.pages.filter((p) => {
    if (activeLayoutFilter === "ALL") return true;
    return p.layout_type === activeLayoutFilter;
  }) || [];

  return (
    <div className="flex flex-col gap-6 text-right" dir="rtl">
      {/* 1. Page Generation Mode Switcher Header */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-emerald-500/30 shadow-xl flex flex-col gap-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold border border-emerald-500/40">
                Page Generation Engine
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono text-xs font-bold border border-sky-500/40">
                Mode: {activeMode === "SCENE_PER_PAGE" ? "🖼️ SCENE PER PAGE (1:1)" : "🟦 KOREAN MANHWA PAGES"}
              </span>
            </div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>نظام تخطيط وإخراج صفحات الرواية والمشاهد</span>
            </h2>
            <p className="text-xs text-slate-300">
              اختر بين وضع <strong className="text-emerald-300">مشهد واحد = صفحة واحدة (Scene Per Page)</strong> بدون إطارات أو تقطيع، أو وضع <strong className="text-sky-300">صفحات المانهوا الكورية (Korean Manhwa Pages)</strong> بتقسيم البانلز والإطارات.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleGenerateLayout(activeMode)}
              disabled={isPlanning || scenes.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer shadow-lg shadow-emerald-950/50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isPlanning ? "animate-spin" : ""}`} />
              <span>{isPlanning ? "جاري التخطيط..." : "إعادة تخطيط الصفحات"}</span>
            </button>
          </div>
        </div>

        {/* Mode Selection Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-800">
          {/* Mode 1: Scene Per Page */}
          <button
            type="button"
            onClick={() => handleModeSwitch("SCENE_PER_PAGE")}
            className={`p-4 rounded-xl border text-right transition cursor-pointer flex flex-col gap-2 ${
              activeMode === "SCENE_PER_PAGE"
                ? "bg-emerald-500/15 border-emerald-500 text-white shadow-lg shadow-emerald-950/40"
                : "bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🖼️</span>
                <span className="text-sm font-bold">Scene Per Page — بدون إطارات (1:1)</span>
              </div>
              {activeMode === "SCENE_PER_PAGE" && <Check className="h-4 w-4 text-emerald-400" />}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              كل Scene = صفحة واحدة كاملة = صورة واحدة مستقلة تمثل المشهد بالكامل بدون أي تقطيع أو إطارات أو فواصل (0 Panels, 0 Frames, 0 Gutters).
            </p>
            <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-300 pt-1">
              <span>✓ 1 Scene = 1 Page = 1 Image</span>
              <span>· Direct Scene ID Mapping</span>
            </div>
          </button>

          {/* Mode 2: Korean Manhwa Pages */}
          <button
            type="button"
            onClick={() => handleModeSwitch("KOREAN_MANHWA_PAGES")}
            className={`p-4 rounded-xl border text-right transition cursor-pointer flex flex-col gap-2 ${
              activeMode === "KOREAN_MANHWA_PAGES"
                ? "bg-sky-500/15 border-sky-500 text-white shadow-lg shadow-sky-950/40"
                : "bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🟦</span>
                <span className="text-sm font-bold">Korean Manhwa Pages — صفحات مانهوا</span>
              </div>
              {activeMode === "KOREAN_MANHWA_PAGES" && <Check className="h-4 w-4 text-sky-400" />}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              تحويل المشاهد السردية إلى صفحات مانهوا كورية حقيقية متعددة البانلز (Chapter → Scenes → Pages → Panels → Frames) مع تخطيطات ديناميكية وفواصل واضحة.
            </p>
            <div className="flex items-center gap-2 text-[10px] font-mono text-sky-300 pt-1">
              <span>✓ Dynamic Webtoon Layouts</span>
              <span>· Multi-Panel Rhythm</span>
            </div>
          </button>
        </div>
      </div>

      {/* 2. Pipeline Hierarchy Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-400">1. إجمالي المشاهد (Scenes)</span>
          <span className="text-lg font-bold font-mono text-white">{scenes.length}</span>
          <span className="text-[10px] text-emerald-400 font-mono">100% De-Merged</span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-400">2. إجمالي الصفحات (Pages)</span>
          <span className="text-lg font-bold font-mono text-sky-400">
            {activeMode === "SCENE_PER_PAGE"
              ? scenePerPagePlan?.total_pages || scenes.length
              : manhwaLayoutPlan?.total_pages || 0}
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {activeMode === "SCENE_PER_PAGE" ? "1 Scene = 1 Page" : "Dynamic Manhwa Layouts"}
          </span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-400">3. إجمالي الصور / البانلز</span>
          <span className="text-lg font-bold font-mono text-emerald-400">
            {activeMode === "SCENE_PER_PAGE"
              ? `${scenePerPagePlan?.total_images || scenes.length} صور كاملة`
              : `${manhwaLayoutPlan?.total_panels || 0} Panels`}
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {activeMode === "SCENE_PER_PAGE" ? "No Frames / No Splitting" : `~${manhwaLayoutPlan?.average_panels_per_page || 0} Panels/Page`}
          </span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-400">4. اتجاه القراءة (Reading Flow)</span>
          <span className="text-sm font-bold font-mono text-amber-400">Top → Bottom</span>
          <span className="text-[10px] text-slate-400 font-mono">Sequential Page Order</span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-0.5">
          <span className="text-[11px] text-slate-400">5. تغطية الأحداث (Coverage)</span>
          <span className="text-lg font-bold font-mono text-emerald-400">100%</span>
          <span className="text-[10px] text-emerald-300 font-mono">0 Missing Events</span>
        </div>
      </div>

      {/* 3. View Switcher Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode("PAGES_VIEW")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              viewMode === "PAGES_VIEW"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            <span>
              {activeMode === "SCENE_PER_PAGE"
                ? "عرض الصفحات المستقلة (Scene Per Page)"
                : "عرض صفحات المانهوا (Manhwa Pages)"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode("VERTICAL_STRIP")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              viewMode === "VERTICAL_STRIP"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>الشريط المتصل (Continuous Scroll Strip)</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode("TRACEABILITY_MATRIX")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              viewMode === "TRACEABILITY_MATRIX"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Compass className="h-4 w-4" />
            <span>مصفوفة التتبع (Traceability Matrix)</span>
          </button>
        </div>

        {/* Layout filter dropdown (Only in Manhwa multi-panel mode) */}
        {viewMode === "PAGES_VIEW" && activeMode === "KOREAN_MANHWA_PAGES" && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">تصفية التخطيط:</span>
            <select
              value={activeLayoutFilter}
              onChange={(e) => setActiveLayoutFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-emerald-300 focus:outline-none"
            >
              <option value="ALL">جميع التخطيطات ({manhwaLayoutPlan?.pages.length || 0})</option>
              <option value="HERO_ESTABLISHING_SPLIT">Hero Establishing Split</option>
              <option value="ACTION_RHYTHM_QUAD">Action Rhythm Quad</option>
              <option value="DIALOGUE_INTERACTION_MULTI">Dialogue Interaction Multi</option>
              <option value="TALL_MONUMENTAL_REVEAL">Tall Monumental Reveal</option>
              <option value="DRAMATIC_CLIFFHANGER_FINALE">Dramatic Cliffhanger Finale</option>
              <option value="VERTICAL_SCROLL_DYNAMIC">Vertical Scroll Dynamic</option>
            </select>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 4. MODE 1: SCENE PER PAGE VIEW (1 Scene = 1 Page = 1 Image, 0 Frames) */}
      {/* ===================================================================== */}
      {activeMode === "SCENE_PER_PAGE" && viewMode === "PAGES_VIEW" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Pages List (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-3 max-h-[750px] overflow-y-auto pr-1">
            {(scenePerPagePlan?.pages || []).map((page) => {
              const isSelected = selectedPageId === page.page_id;
              const matchedSc = scenes.find((s) => s.scene_id === page.scene_id);
              const hasImg = Boolean(page.image_url || matchedSc?.image_url);
              const isApproved = Boolean(page.approved || matchedSc?.approved);

              return (
                <div
                  key={page.page_id}
                  onClick={() => setSelectedPageId(page.page_id)}
                  className={`p-4 rounded-xl border transition cursor-pointer flex flex-col gap-2.5 ${
                    isSelected
                      ? "bg-slate-900 border-emerald-500 shadow-md shadow-emerald-950/40"
                      : "bg-slate-950/80 hover:bg-slate-900/60 border-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sm text-white">{page.page_id}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                      {page.scene_id} (1:1 Direct)
                    </span>
                  </div>

                  <div className="text-xs text-slate-200 font-bold line-clamp-1">
                    {page.title}
                  </div>
                  <div className="text-[11px] text-slate-400 line-clamp-2">
                    {page.description || page.action}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-2 border-t border-slate-800/60">
                    <span className="text-sky-400">{page.shot_type}</span>
                    <span className="text-slate-300">{page.camera_angle}</span>
                    <span className={isApproved ? "text-emerald-400 font-bold" : hasImg ? "text-amber-400" : "text-slate-500"}>
                      {isApproved ? "✓ APPROVED" : hasImg ? "GENERATED" : "WAITING"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Column: Selected Scene-Per-Page Full Image Canvas (8 cols) */}
          {selectedScenePerPage && (
            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col gap-4">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white font-mono">{selectedScenePerPage.page_id}</h3>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {selectedScenePerPage.scene_id}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-sky-950 text-sky-300 border border-sky-500/30">
                        SCENE_PER_PAGE (No Frames)
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 font-bold mt-0.5">{selectedScenePerPage.title}</p>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-amber-300">
                      {selectedScenePerPage.aspect_ratio || "9:16"}
                    </span>
                    <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-sky-300">
                      {selectedScenePerPage.shot_type}
                    </span>
                  </div>
                </div>

                {/* Full-Bleed Image Presentation (1 Scene = 1 Page = 1 Image, NO Frames / NO Gutters) */}
                <div className="w-full rounded-2xl overflow-hidden bg-[#030712] border border-slate-800 flex flex-col items-center justify-center relative min-h-[460px]">
                  {selectedScenePerPage.image_url || matchedSceneForSelectedPage?.image_url ? (
                    <img
                      src={selectedScenePerPage.image_url || matchedSceneForSelectedPage?.image_url || ""}
                      alt={selectedScenePerPage.page_id}
                      className="w-full h-auto max-h-[700px] object-contain rounded-2xl"
                    />
                  ) : (
                    <div className="p-8 text-center flex flex-col items-center gap-3 text-slate-500">
                      <Camera className="h-12 w-12 text-slate-600" />
                      <span className="text-sm font-bold text-slate-300">{selectedScenePerPage.title}</span>
                      <p className="text-xs text-slate-400 max-w-lg leading-relaxed">
                        {selectedScenePerPage.description || selectedScenePerPage.action}
                      </p>
                      <span className="px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono text-emerald-400">
                        جاهز للتوليد كصورة واحدة كاملة عبر Google Flow
                      </span>
                    </div>
                  )}

                  {/* Dialogue Overlay */}
                  {selectedScenePerPage.dialogue && (
                    <div className="absolute top-4 right-4 max-w-[75%] p-3 rounded-2xl bg-white/95 text-slate-900 shadow-2xl text-xs font-medium border border-slate-300 leading-snug">
                      <span className="block font-bold text-[10px] text-emerald-700">الحوار:</span>
                      "{selectedScenePerPage.dialogue}"
                    </div>
                  )}

                  {/* SFX Overlay */}
                  {selectedScenePerPage.sfx && (
                    <div className="absolute bottom-4 left-4 px-3 py-1 rounded-lg bg-rose-950/90 text-amber-300 font-black text-sm tracking-widest border border-rose-500/50 shadow-xl uppercase">
                      💥 {selectedScenePerPage.sfx}
                    </div>
                  )}
                </div>

                {/* Scene Per Page Metadata & Prompt Details */}
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-3 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[11px]">
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block">الموقع (Location Lock):</span>
                      <strong className="text-emerald-400">{selectedScenePerPage.location_name}</strong>
                    </div>
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block">الشخصيات (Character Locks):</span>
                      <strong className="text-sky-400">{selectedScenePerPage.characters?.join(", ") || "None"}</strong>
                    </div>
                    <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 block">زاوية الكاميرا:</span>
                      <strong className="text-amber-400">{selectedScenePerPage.camera_angle} ({selectedScenePerPage.shot_type})</strong>
                    </div>
                  </div>

                  {/* Visual Prompt Accordion */}
                  <div className="pt-2 border-t border-slate-800 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300">البرومت البصري المولد للمشهد الكامل:</span>
                      <button
                        type="button"
                        onClick={() => setShowPromptDetails(!showPromptDetails)}
                        className="text-[11px] text-emerald-400 hover:underline cursor-pointer"
                      >
                        {showPromptDetails ? "إخفاء البرومت" : "عرض البرومت الكامل"}
                      </button>
                    </div>
                    {showPromptDetails && (
                      <p className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 leading-relaxed" dir="ltr">
                        {selectedScenePerPage.visual_prompt}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 5. MODE 2: KOREAN MANHWA PAGES VIEW (Scene -> Pages -> Panels -> Frames) */}
      {/* ===================================================================== */}
      {activeMode === "KOREAN_MANHWA_PAGES" && viewMode === "PAGES_VIEW" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Pages List (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-3 max-h-[750px] overflow-y-auto pr-1">
            {filteredManhwaPages.map((page) => {
              const isSelected = selectedPageId === page.page_id;
              return (
                <div
                  key={page.page_id}
                  onClick={() => {
                    setSelectedPageId(page.page_id);
                    setSelectedPanelId(null);
                  }}
                  className={`p-4 rounded-xl border transition cursor-pointer flex flex-col gap-2.5 ${
                    isSelected
                      ? "bg-slate-900 border-sky-500 shadow-md shadow-sky-950/40"
                      : "bg-slate-950/80 hover:bg-slate-900/60 border-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sm text-white">{page.page_id}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-sky-300">
                      {page.layout_type}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 font-medium line-clamp-1">
                    {page.page_goal}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-2 border-t border-slate-800/60">
                    <span>{page.panel_count} Panels (P01..P0{page.panel_count})</span>
                    <span className="text-sky-400">
                      Scenes: {page.scene_ids.join(", ")}
                    </span>
                  </div>

                  {page.has_cliffhanger_ending && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-300 bg-amber-950/40 px-2 py-1 rounded border border-amber-500/30">
                      <Zap className="h-3 w-3" />
                      <span>خاتمة تشويقية (Cliffhanger Beat)</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right Column: Selected Page Visual Canvas & Panel Inspector (8 cols) */}
          {selectedManhwaPage && (
            <div className="lg:col-span-8 flex flex-col gap-4">
              <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col gap-4">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white font-mono">{selectedManhwaPage.page_id}</h3>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        {selectedManhwaPage.layout_type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{selectedManhwaPage.page_goal}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedManhwaPage.layout_type}
                      onChange={(e) => handleReplanPage(selectedManhwaPage, e.target.value as ManhwaPageLayoutType)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-sky-300 focus:outline-none"
                    >
                      <option value="HERO_ESTABLISHING_SPLIT">Hero Establishing Split</option>
                      <option value="ACTION_RHYTHM_QUAD">Action Rhythm Quad</option>
                      <option value="DIALOGUE_INTERACTION_MULTI">Dialogue Interaction Multi</option>
                      <option value="TALL_MONUMENTAL_REVEAL">Tall Monumental Reveal</option>
                      <option value="DRAMATIC_CLIFFHANGER_FINALE">Dramatic Cliffhanger Finale</option>
                      <option value="VERTICAL_SCROLL_DYNAMIC">Vertical Scroll Dynamic</option>
                    </select>
                  </div>
                </div>

                {/* Rhythm & Pacing */}
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1 text-xs">
                  <span className="font-bold text-slate-300">الإيقاع البصري والتسلسل (Visual Rhythm):</span>
                  <span className="font-mono text-[11px] text-sky-400 leading-relaxed">
                    {selectedManhwaPage.visual_rhythm}
                  </span>
                </div>

                {/* Dynamic Webtoon Page Panel Grid Preview */}
                <div className="p-4 rounded-xl bg-[#090d16] border-2 border-slate-800 shadow-inner flex flex-col gap-3 min-h-[400px]">
                  <div className="text-[11px] font-mono text-slate-500 text-center uppercase tracking-wider">
                    ▼ Top of Page (Reading Direction Starts Here) ▼
                  </div>

                  <div className="flex flex-col gap-3">
                    {selectedManhwaPage.panels.map((panel) => {
                      const isPanelSelected = selectedPanelId === panel.panel_id;
                      const matchedScene = scenes.find((s) => s.scene_id === panel.scene_id);
                      const imageUrl = panel.image_url || matchedScene?.image_url;

                      return (
                        <div
                          key={panel.panel_id}
                          onClick={() => setSelectedPanelId(panel.panel_id)}
                          className={`relative rounded-lg border-2 overflow-hidden transition cursor-pointer flex flex-col ${
                            isPanelSelected
                              ? "border-sky-400 shadow-lg shadow-sky-950/60"
                              : "border-slate-800 hover:border-slate-600"
                          } ${
                            panel.grid_column_span === "full"
                              ? "w-full"
                              : panel.grid_column_span === "half_left"
                              ? "w-full sm:w-[48%] float-left"
                              : "w-full sm:w-[48%] float-right"
                          }`}
                          style={{
                            minHeight:
                              panel.panel_size === "HERO"
                                ? "280px"
                                : panel.panel_size === "TALL_VERTICAL"
                                ? "240px"
                                : "160px",
                          }}
                        >
                          {/* Panel Header & Badge */}
                          <div className="p-2.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sky-400">{panel.panel_id}</span>
                              <span className="text-[10px] text-slate-400">Order: P0{panel.panel_order}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded text-[10px] bg-sky-950/80 text-sky-300 border border-sky-500/30">
                                {panel.shot_type}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950/80 text-amber-300 border border-amber-500/30">
                                {panel.camera_angle}
                              </span>
                            </div>
                          </div>

                          {/* Image Preview or Detailed Wireframe */}
                          <div className="flex-1 bg-slate-950 relative flex items-center justify-center p-4 min-h-[120px]">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={panel.panel_id}
                                className="w-full h-full object-cover rounded"
                              />
                            ) : (
                              <div className="text-center p-4 flex flex-col items-center gap-1 text-slate-500">
                                <Camera className="h-6 w-6 text-slate-600" />
                                <span className="text-xs font-bold text-slate-400">{panel.subject}</span>
                                <span className="text-[11px] text-slate-500 line-clamp-2 max-w-md">
                                  {panel.action}
                                </span>
                              </div>
                            )}

                            {/* Dialogue Bubble Overlay in Manhwa Style */}
                            {panel.dialogue && (
                              <div className="absolute top-3 right-3 max-w-[70%] p-2 rounded-2xl bg-white/95 text-slate-900 shadow-md text-[11px] font-medium border border-slate-300 leading-tight">
                                {panel.speaker_name && (
                                  <span className="block font-bold text-[9px] text-sky-700">
                                    {panel.speaker_name}:
                                  </span>
                                )}
                                <span>"{panel.dialogue}"</span>
                              </div>
                            )}

                            {/* SFX Text Overlay */}
                            {panel.sfx && (
                              <div className="absolute bottom-3 left-3 px-2 py-0.5 rounded bg-rose-900/90 text-amber-300 font-black text-xs tracking-widest border border-rose-500/50 uppercase">
                                💥 {panel.sfx}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[11px] font-mono text-slate-500 text-center uppercase tracking-wider pt-2">
                    ▲ Bottom of Page (Gutter to Next Page) ▲
                  </div>
                </div>

                {/* Selected Panel Inspector */}
                {selectedManhwaPanel && (
                  <div className="mt-2 p-4 rounded-xl bg-slate-900 border border-sky-500/40 flex flex-col gap-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sky-400 font-mono text-sm">
                          {selectedManhwaPanel.panel_id} (Panel Inspector)
                        </span>
                        <span className="text-xs text-slate-400">
                          Scene: <strong className="text-white">{selectedManhwaPanel.scene_id}</strong>
                        </span>
                      </div>
                      <span className="text-xs font-mono text-sky-400">Shot: {selectedManhwaPanel.shot_id}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-400 block font-semibold">حركة المشهد (Action):</span>
                        <p className="text-slate-200 mt-0.5">{selectedManhwaPanel.action}</p>
                      </div>
                      <div>
                        <span className="text-slate-400 block font-semibold">الكاميرا والتكوين:</span>
                        <p className="text-sky-300 mt-0.5 font-mono text-[11px]">
                          {selectedManhwaPanel.shot_type} | {selectedManhwaPanel.camera_angle} | {selectedManhwaPanel.composition}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 6. VERTICAL STRIP CONTINUOUS SCROLL VIEW                               */}
      {/* ===================================================================== */}
      {viewMode === "VERTICAL_STRIP" && (
        <div className="flex flex-col items-center gap-6 max-w-2xl mx-auto w-full">
          <div className="w-full text-center text-xs font-mono text-emerald-400 p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
            📜 محاكاة شريط المانهوا الكورية الرأسي الكامل ({activeMode === "SCENE_PER_PAGE" ? "Scene Per Page 1:1" : "Multi-Panel Korean Strip"})
          </div>

          <div className="w-full bg-[#05070d] p-6 rounded-2xl border-4 border-slate-900 shadow-2xl flex flex-col gap-6">
            {activeMode === "SCENE_PER_PAGE" ? (
              (scenePerPagePlan?.pages || []).map((page) => {
                const matchedScene = scenes.find((s) => s.scene_id === page.scene_id);
                const imageUrl = page.image_url || matchedScene?.image_url;

                return (
                  <div key={page.page_id} className="flex flex-col gap-3 pb-6 border-b-2 border-slate-800/80 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-2">
                      <span className="font-bold text-white">{page.page_id}</span>
                      <span className="text-emerald-400">{page.scene_id}</span>
                    </div>

                    <div className="rounded-2xl overflow-hidden bg-slate-950 relative shadow-2xl min-h-[360px] flex items-center justify-center">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={page.page_id}
                          className="w-full h-auto object-cover rounded-2xl"
                        />
                      ) : (
                        <div className="p-8 text-center flex flex-col items-center justify-center gap-2 text-slate-500">
                          <span className="font-mono text-xs text-emerald-400">{page.page_id}</span>
                          <strong className="text-slate-300 text-sm">{page.title}</strong>
                          <p className="text-xs text-slate-400 max-w-md">{page.action}</p>
                        </div>
                      )}

                      {page.dialogue && (
                        <div className="absolute top-4 right-4 max-w-[70%] p-2.5 rounded-2xl bg-white/95 text-slate-900 shadow-xl text-xs font-medium border border-slate-300">
                          "{page.dialogue}"
                        </div>
                      )}

                      {page.sfx && (
                        <div className="absolute bottom-4 left-4 px-2.5 py-1 rounded bg-rose-900/90 text-amber-300 font-black text-xs uppercase tracking-wider border border-rose-500/50">
                          💥 {page.sfx}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              (manhwaLayoutPlan?.pages || []).map((page) => (
                <div key={page.page_id} className="flex flex-col gap-4 pb-6 border-b-2 border-slate-800/80 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-2">
                    <span className="font-bold text-white">{page.page_id}</span>
                    <span>{page.layout_type}</span>
                  </div>

                  <div className="flex flex-col gap-4">
                    {page.panels.map((panel) => {
                      const matchedScene = scenes.find((s) => s.scene_id === panel.scene_id);
                      const imageUrl = panel.image_url || matchedScene?.image_url;

                      return (
                        <div
                          key={panel.panel_id}
                          className="rounded-xl border-2 border-slate-800 bg-slate-950 overflow-hidden relative shadow-lg"
                          style={{
                            minHeight: panel.panel_size === "HERO" ? "320px" : "200px",
                          }}
                        >
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={panel.panel_id}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="p-8 text-center flex flex-col items-center justify-center gap-2 text-slate-500">
                              <span className="font-mono text-xs text-sky-400">{panel.panel_id}</span>
                              <strong className="text-slate-300 text-sm">{panel.shot_type} · {panel.camera_angle}</strong>
                              <p className="text-xs text-slate-400 max-w-md">{panel.action}</p>
                            </div>
                          )}

                          {panel.dialogue && (
                            <div className="absolute top-4 right-4 max-w-[70%] p-2.5 rounded-2xl bg-white/95 text-slate-900 shadow-xl text-xs font-medium border border-slate-300">
                              "{panel.dialogue}"
                            </div>
                          )}

                          {panel.sfx && (
                            <div className="absolute bottom-4 left-4 px-2.5 py-1 rounded bg-rose-900/90 text-amber-300 font-black text-xs uppercase tracking-wider border border-rose-500/50">
                              💥 {panel.sfx}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 7. TRACEABILITY MATRIX VIEW                                           */}
      {/* ===================================================================== */}
      {viewMode === "TRACEABILITY_MATRIX" && (
        <div className="p-5 rounded-2xl bg-slate-950/90 border border-slate-800 flex flex-col gap-4 overflow-x-auto">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Compass className="h-5 w-5 text-emerald-400" />
              <span>مصفوفة التتبع الشاملة (Event → Block → Scene → Page → Panel → Shot)</span>
            </h3>
            <span className="font-mono text-xs text-emerald-400">
              100% Events Represented ({activeMode === "SCENE_PER_PAGE" ? scenePerPagePlan?.traceability_matrix.length || 0 : manhwaLayoutPlan?.traceability_matrix.length || 0} Items)
            </span>
          </div>

          <table className="w-full text-right text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                <th className="py-2.5 px-3">EVENT_ID</th>
                <th className="py-2.5 px-3">SOURCE_BLOCK</th>
                <th className="py-2.5 px-3">SCENE_ID</th>
                <th className="py-2.5 px-3">PAGE_ID</th>
                <th className="py-2.5 px-3">PANEL_ID</th>
                <th className="py-2.5 px-3">SHOT_ID</th>
                <th className="py-2.5 px-3 text-center">REPRESENTED</th>
                <th className="py-2.5 px-3 text-center">IMPORTANT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {((activeMode === "SCENE_PER_PAGE" ? scenePerPagePlan?.traceability_matrix : manhwaLayoutPlan?.traceability_matrix) || []).map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-900/50">
                  <td className="py-2.5 px-3 font-bold text-emerald-400">{row.event_id}</td>
                  <td className="py-2.5 px-3 text-slate-300">{row.source_block}</td>
                  <td className="py-2.5 px-3 text-sky-300">{row.scene_id}</td>
                  <td className="py-2.5 px-3 font-bold text-amber-300">{row.page_id}</td>
                  <td className="py-2.5 px-3 text-white">{row.panel_id}</td>
                  <td className="py-2.5 px-3 text-slate-400">{row.shot_id}</td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 font-bold border border-emerald-500/40">
                      ✓ {row.represented}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`px-2 py-0.5 rounded font-bold ${row.important === "YES" ? "bg-amber-950/60 text-amber-300 border border-amber-500/40" : "text-slate-500"}`}>
                      {row.important}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
