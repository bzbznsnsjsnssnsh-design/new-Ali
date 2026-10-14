// Complete Studio Page for "🎬 إنشاء فيديوهات المانهاوا"
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Chapter, Manga, OCRBlock } from "../../types";
import { 
  Film, Sparkles, Volume2, Sliders, Play, Pause, RotateCcw, 
  Download, ArrowLeft, Loader2, AlertCircle, CheckCircle2, 
  Layers, Clock, RefreshCw, Bookmark, Heart, Image as ImageIcon,
  Cpu, Music, ChevronRight, Video, FileVideo, ListFilter
} from "lucide-react";
import { 
  VideoProject, VideoScene, VideoCreatorSettings, 
  VIDEO_GEMINI_MODELS, VideoAnimationType 
} from "./types";
import { extractScenesFromPages } from "./manhwaPanelExtractor";
import { generateCinematicScript } from "./manhwaVideoScriptService";
import { generateAllScenesAudio } from "./manhwaVideoAudioService";
import { exportVideoMP4, triggerVideoDownload } from "./manhwaVideoExporter";
import { saveVideoProject, getVideoProjectForChapter } from "./videoProjectStorage";
import { ReaderTranslationCache } from "../../utils/readerTranslationCache";
import { GoogleLensChapterOrchestrator } from "../../utils/googleLensChapterOrchestrator";
import { isVideoFavorite, toggleVideoFavorite } from "../../lib/videoFavorites";
import { isFavorite, toggleFavorite } from "../../lib/favorites";
import ManhwaVideoPlayer from "./ManhwaVideoPlayer";
import ManhwaVideoTimeline from "./ManhwaVideoTimeline";
import ManhwaVideoSettingsModal from "./ManhwaVideoSettingsModal";

interface ManhwaVideoPageProps {
  initialManga?: Manga | null;
  initialChapter?: Chapter | null;
  onBack: () => void;
  onNavigateToSources?: () => void;
  onNavigateToFavorites?: () => void;
}

const DEFAULT_SETTINGS: VideoCreatorSettings = {
  geminiModel: "3.6-flash",
  voiceGroup: "gemini",
  voiceName: "Aoede",
  playbackSpeed: 1.0,
  voiceDirection: "إلقاء ناطق ملحمي مشوق لأحداث المانهاوا",
  aspectRatio: "9:16",
  resolution: "720p",
  defaultAnimation: "auto",
  includeNarrationCaptions: true,
  includeSoundEffects: false
};

export default function ManhwaVideoPage({
  initialManga,
  initialChapter,
  onBack,
  onNavigateToSources,
  onNavigateToFavorites
}: ManhwaVideoPageProps) {
  const [manga, setManga] = useState<Manga | null>(initialManga || null);
  const [chapter, setChapter] = useState<Chapter | null>(initialChapter || null);
  const [pages, setPages] = useState<string[]>([]);
  const [loadingPages, setLoadingPages] = useState<boolean>(false);
  const [pageFetchError, setPageFetchError] = useState<string | null>(null);

  // Settings
  const [settings, setSettings] = useState<VideoCreatorSettings>(() => {
    try {
      const saved = localStorage.getItem("manhwa_video_settings");
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SETTINGS;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Video scenes & Project State
  const [scenes, setScenes] = useState<VideoScene[]>([]);
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStep, setProgressStep] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [exportedVideoBlob, setExportedVideoBlob] = useState<Blob | null>(null);

  // Background Google Lens Orchestrator reference
  const lensOrchestratorRef = useRef<GoogleLensChapterOrchestrator | null>(null);

  // Clean up orchestrator on unmount
  useEffect(() => {
    return () => {
      if (lensOrchestratorRef.current) {
        lensOrchestratorRef.current.stop();
        lensOrchestratorRef.current = null;
      }
    };
  }, []);

  // Favorites state for both hearts
  const [isRedFav, setIsRedFav] = useState<boolean>(false);
  const [isBlackFav, setIsBlackFav] = useState<boolean>(false);

  // Update favorites status
  useEffect(() => {
    if (manga?.id) {
      setIsRedFav(isFavorite(manga.id, manga.title, (manga as any).sourceId));
      setIsBlackFav(isVideoFavorite(manga.id, manga.title, (manga as any).sourceId));
    }
  }, [manga?.id, manga?.title]);

  const handleToggleRedFav = () => {
    if (!manga) return;
    const newState = toggleFavorite({
      id: manga.id,
      title: manga.title,
      coverUrl: manga.coverUrl,
      sourceId: (manga as any).sourceId
    });
    setIsRedFav(newState);
  };

  const handleToggleBlackFav = () => {
    if (!manga) return;
    const newState = toggleVideoFavorite({
      id: manga.id,
      title: manga.title,
      coverUrl: manga.coverUrl,
      sourceId: (manga as any).sourceId
    });
    setIsBlackFav(newState);
  };

  // Save settings
  const handleUpdateSettings = (newSettings: Partial<VideoCreatorSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem("manhwa_video_settings", JSON.stringify(updated));
      return updated;
    });
  };

  // Fetch chapter pages if not present
  useEffect(() => {
    let active = true;

    async function loadPages() {
      if (!chapter) return;
      if (Array.isArray(chapter.pages) && chapter.pages.length > 0) {
        setPages(chapter.pages);
        return;
      }

      setLoadingPages(true);
      setPageFetchError(null);

      try {
        const queryParams = new URLSearchParams();
        const sourceId = (chapter as any).sourceId || (manga as any)?.sourceId;
        if (sourceId) queryParams.set("sourceId", sourceId);

        const res = await fetch(`/api/manga/chapter-pages/${encodeURIComponent(chapter.id)}?${queryParams.toString()}`);
        if (!res.ok) throw new Error(`تعذر جلب صفحات الفصل (${res.status})`);

        const data = await res.json();
        if (active && Array.isArray(data.pages) && data.pages.length > 0) {
          const proxied = data.pages.map((u: string) => {
            if (u.startsWith("/api/") || u.startsWith("data:") || u.startsWith("blob:")) return u;
            return `/api/proxy-image?url=${encodeURIComponent(u)}`;
          });
          setPages(proxied);
        } else {
          throw new Error("لم يتم العثور على صفحات في هذا الفصل");
        }
      } catch (err: any) {
        if (active) setPageFetchError(err.message || "فشل تحميل صفحات الفصل");
      } finally {
        if (active) setLoadingPages(false);
      }
    }

    loadPages();
    return () => { active = false; };
  }, [chapter, manga]);

  // Read cached OCR translations for the chapter
  const loadCachedTranslations = async (totalPages: number): Promise<Record<number, OCRBlock[]>> => {
    if (!chapter?.id) return {};
    try {
      const allTrans = await ReaderTranslationCache.getChapterTranslations(chapter.id, "gemini_cookies", "ar");
      if (allTrans && Object.keys(allTrans).length > 0) {
        return allTrans;
      }
    } catch {}

    const map: Record<number, OCRBlock[]> = {};
    for (let p = 0; p < totalPages; p++) {
      try {
        const blocks = await ReaderTranslationCache.getPageTranslation(chapter.id, p, "gemini_cookies", "ar");
        if (blocks && blocks.length > 0) {
          map[p] = blocks;
        }
      } catch {}
    }
    return map;
  };

  // Build / Re-generate Video Story Pipeline
  const handleGenerateVideoProject = async () => {
    if (pages.length === 0 || !chapter || !manga) return;

    setIsProcessing(true);
    setErrorMessage(null);
    setProgressPercent(5);
    setProgressStep("فحص تحليلات الفصل و Google Lens OCR...");

    try {
      // Step 1: Check existing cached OCR translations
      let cachedByPage = await loadCachedTranslations(pages.length);
      const cachedCount = Object.keys(cachedByPage).length;

      // If chapter pages are not yet analyzed with Google Lens OCR, run the unified chapter orchestrator in ONE BATCH
      if (cachedCount < pages.length) {
        setProgressStep("تحليل أبعاد ومشاهد الفصل بواسطة Google Lens OCR (طبقة متصفح في الخلفية - دقة فائقة)...");
        
        await new Promise<void>((resolve) => {
          const orchestrator = new GoogleLensChapterOrchestrator({
            chapterId: chapter.id,
            pages: pages,
            targetLang: "ar",
            translatorEngine: "gemini_cookies",
            geminiCookieModel: settings.geminiModel,
            mangaTitle: manga.title,
            workType: (manga as any)?.type || "مانهوا كورية",
            readingDirection: ((manga as any)?.type && (manga as any).type.includes("مانجا يابانية")) ? "rtl" : "ltr",
            forceRefresh: false,
            onProgress: (prog) => {
              if (prog.phase === "ocr_scanning") {
                const pct = Math.min(25, Math.round((prog.analyzedPages / Math.max(1, prog.totalPages)) * 25));
                setProgressPercent(5 + pct);
                setProgressStep(`تحليل Google Lens في الخلفية بدقة فائقة: ${prog.analyzedPages} / ${prog.totalPages} صفحة`);
              } else if (prog.phase === "ocr_completed") {
                setProgressPercent(30);
                setProgressStep(`اكتمل فحص Google Lens (${prog.totalTexts} نص). جاري تجميع المشاهد...`);
              } else if (prog.phase === "translating") {
                setProgressPercent(32);
                setProgressStep(`ترجمة سيناريو الفصل بواسطة Gemini Cookies (${prog.translatedTexts}/${prog.totalTexts})...`);
              }
            },
            onPageOcrReady: (pageIdx, blocks) => {
              cachedByPage[pageIdx] = blocks;
            },
            onPageTranslationReady: (pageIdx, blocks) => {
              cachedByPage[pageIdx] = blocks;
            },
            onError: (err) => {
              console.warn("[ManhwaVideo] Google Lens notice:", err);
              resolve();
            },
            onCompleted: (allPageBlocks) => {
              cachedByPage = allPageBlocks;
              resolve();
            }
          });

          lensOrchestratorRef.current = orchestrator;
          orchestrator.execute().catch((e) => {
            console.warn("[ManhwaVideo] Orchestrator execution notice:", e);
            resolve();
          });
        });
      }

      // Step 2: BATCH Dimension analysis and Smart Panel Extraction
      setProgressPercent(35);
      setProgressStep("تحليل أبعاد جميع الصفحات دفعة واحدة واستخراج المشاهد السينمائية...");

      const initialScenes = await extractScenesFromPages(pages, cachedByPage, (pct, label) => {
        setProgressPercent(35 + Math.round(pct * 0.15));
        setProgressStep(label);
      });

      if (initialScenes.length === 0) {
        throw new Error("تعذر استخراج مشاهد من صفحات المانهاوا");
      }

      // Step 3: Dramatic script generation with Gemini Cookies
      setProgressPercent(50);
      setProgressStep(`صياغة السرد السينمائي بواسطة Gemini Cookies (${settings.geminiModel})...`);

      const scriptedScenes = await generateCinematicScript(
        manga.title,
        chapter.chapter || chapter.title || `الفصل ${chapter.id}`,
        initialScenes,
        settings.geminiModel,
        (pct, label) => {
          setProgressPercent(50 + Math.round(pct * 0.2));
          setProgressStep(label);
        }
      );

      // Step 4: Synthesize TTS Audio and synchronize durations
      setProgressPercent(70);
      setProgressStep("توليد أصوات الإلقاء الصوتي ومزامنة التوقيت مع المشاهد...");

      const audioScenes = await generateAllScenesAudio(
        scriptedScenes,
        settings,
        (pct, label) => {
          setProgressPercent(70 + Math.round(pct * 0.28));
          setProgressStep(label);
        }
      );

      setScenes(audioScenes);
      setCurrentSceneIndex(0);

      // Compute total duration
      let totalDur = 0;
      for (const s of audioScenes) totalDur += s.duration;

      // Save project
      const project: VideoProject = {
        id: `proj_${chapter.id}`,
        mangaId: manga.id,
        mangaTitle: manga.title,
        coverUrl: manga.coverUrl,
        sourceId: (manga as any).sourceId,
        chapterId: chapter.id,
        chapterTitle: chapter.title || `الفصل ${chapter.chapter || chapter.id}`,
        chapterNumber: String(chapter.chapter || chapter.id),
        pageUrls: pages,
        settings,
        scenes: audioScenes,
        totalDuration: totalDur,
        status: "ready_preview",
        progressPercent: 100,
        progressStep: "جاهز للمعاينة والتصدير",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveVideoProject(project);

      setProgressPercent(100);
      setProgressStep("تم إعداد الفيديو بنجاح! يمكنك الآن المعاينة والتصدير.");
    } catch (err: any) {
      console.error("[Video Pipeline Error]:", err);
      setErrorMessage(err.message || "حدث خطأ غير متوقع أثناء معالجة الفيديو");
    } finally {
      setIsProcessing(false);
    }
  };

  // Update single scene animation
  const handleUpdateSceneAnimation = (index: number, animation: VideoAnimationType) => {
    setScenes(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], animation };
      }
      return updated;
    });
  };

  // Export Final MP4 Video
  const handleExportMP4 = async () => {
    if (scenes.length === 0) return;
    setIsExporting(true);
    setErrorMessage(null);
    setProgressPercent(0);
    setProgressStep("بدء عملية تصدير فيديو MP4 عالي الجودة...");

    try {
      const result = await exportVideoMP4(
        scenes,
        settings.aspectRatio,
        settings.resolution,
        settings.includeNarrationCaptions,
        (pct, label) => {
          setProgressPercent(pct);
          setProgressStep(label);
        }
      );

      setExportedVideoBlob(result.blob);
      setExportedVideoUrl(result.url);

      // Trigger automatic download
      const safeTitle = (manga?.title || "manhwa").replace(/[^a-zA-Z0-9_\-\u0600-\u06FF]/g, "_");
      const safeCh = (chapter?.chapter || chapter?.id || "1").replace(/[^a-zA-Z0-9_\-]/g, "_");
      triggerVideoDownload(result.blob, `${safeTitle}_Ch${safeCh}_video.mp4`);
    } catch (err: any) {
      console.error("[Export Error]:", err);
      setErrorMessage(`فشل تصدير الفيديو: ${err.message || err}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Total Duration
  const totalDuration = scenes.reduce((acc, s) => acc + (s.duration || 0), 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col" dir="rtl">
      {/* Top Studio Bar */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="رجوع"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Film className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-white tracking-tight">
                  🎬 إنشاء فيديوهات المانهاوا
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                  استوديو متقدم
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate max-w-[280px] sm:max-w-md">
                {manga?.title ? `${manga.title} • ` : ""}
                {chapter ? `الفصل ${chapter.chapter || chapter.id}` : "اختر فصلاً للبدء"}
              </p>
            </div>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm border border-slate-700/60"
          >
            <Sliders className="h-4 w-4 text-emerald-400" />
            <span className="hidden sm:inline">الإعدادات والنموذج</span>
          </button>

          {/* Export MP4 Button */}
          <button
            onClick={handleExportMP4}
            disabled={scenes.length === 0 || isProcessing || isExporting}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-black transition flex items-center gap-1.5 shadow-md shadow-emerald-500/20 active:scale-95 cursor-pointer"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>جاري التصدير...</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>تصدير MP4</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Studio Body */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Manga & Chapter Context Card */}
        {manga && (
          <div className="relative rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl backdrop-blur-sm">
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <div className="relative w-16 h-22 sm:w-18 sm:h-24 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex-shrink-0 shadow-md">
                <img
                  src={manga.coverUrl}
                  alt={manga.title}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-base sm:text-lg font-bold text-white truncate">{manga.title}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="bg-slate-800 px-2 py-0.5 rounded-md font-mono text-emerald-400">
                    الفصل {chapter?.chapter || chapter?.id}
                  </span>
                  <span>•</span>
                  <span>{pages.length} صفحة</span>
                  <span>•</span>
                  <span>النموذج: <strong className="text-slate-200">{settings.geminiModel}</strong></span>
                  <span>•</span>
                  <span>الصوت: <strong className="text-slate-200">{settings.voiceName}</strong></span>
                </div>
              </div>
            </div>

            {/* Hearts (❤️ Red for Pages, 🖤 Black for Video) */}
            <div className="flex items-center gap-2 self-end sm:self-center">
              {/* Red Heart: Translation Favorites */}
              <button
                onClick={handleToggleRedFav}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold ${
                  isRedFav
                    ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                    : "bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-white"
                }`}
                title="مفضلة ترجمة الصفحات"
              >
                <Heart className={`h-4 w-4 ${isRedFav ? "fill-rose-500" : ""}`} />
                <span className="hidden md:inline">ترجمة</span>
              </button>

              {/* Black Heart: Video Favorites */}
              <button
                onClick={handleToggleBlackFav}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold ${
                  isBlackFav
                    ? "bg-slate-950 text-emerald-400 border-emerald-500/60 shadow-md"
                    : "bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-white"
                }`}
                title="مفضلة إنشاء الفيديوهات"
              >
                <span className="text-base leading-none">🖤</span>
                <span className="hidden md:inline">فيديوهات</span>
              </button>

              {/* Re-generate Button */}
              <button
                onClick={handleGenerateVideoProject}
                disabled={isProcessing || isExporting || pages.length === 0}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-bold transition flex items-center gap-1.5 border border-slate-700/60 cursor-pointer shadow-sm active:scale-95"
              >
                <RefreshCw className={`h-4 w-4 text-emerald-400 ${isProcessing ? "animate-spin" : ""}`} />
                <span>{scenes.length > 0 ? "إعادة بناء الفيديو" : "إنشاء الفيديو الآن"}</span>
              </button>
            </div>
          </div>
        )}

        {/* Progress Bar (Visible during processing or export) */}
        {(isProcessing || isExporting) && (
          <div className="p-5 rounded-2xl bg-slate-900 border border-emerald-500/30 shadow-xl space-y-3 animate-pulse">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-emerald-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                {progressStep}
              </span>
              <span className="font-mono font-bold text-white text-sm">{progressPercent}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300 shadow-sm"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Notice */}
        {errorMessage && (
          <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-200 flex items-center gap-3 text-xs">
            <AlertCircle className="h-5 w-5 text-rose-400 flex-shrink-0" />
            <p className="flex-1 font-medium">{errorMessage}</p>
          </div>
        )}

        {/* Pages loading / error state */}
        {loadingPages && (
          <div className="p-12 rounded-3xl bg-slate-900/60 border border-slate-800 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            <p className="text-sm font-medium">جاري جلب صفحات الفصل وتحضيرها...</p>
          </div>
        )}

        {pageFetchError && (
          <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800 flex flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-rose-400" />
            <p className="text-sm text-slate-200 font-bold">{pageFetchError}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Video Player & Live Preview Section */}
        {scenes.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Live Canvas Player (Left / Center) */}
            <div className="lg:col-span-7 flex flex-col gap-4">
              <ManhwaVideoPlayer
                scenes={scenes}
                aspectRatio={settings.aspectRatio}
                totalDuration={totalDuration}
                currentSceneIndex={currentSceneIndex}
                onSceneChange={setCurrentSceneIndex}
                showCaptions={settings.includeNarrationCaptions}
              />
            </div>

            {/* Scene Info & Narration Editor (Right) */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800/80 shadow-xl flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-white">تفاصيل المشهد الحالي</h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-800/50">
                    المشهد {currentSceneIndex + 1} / {scenes.length}
                  </span>
                </div>

                {/* Current Scene Image Thumbnail */}
                {scenes[currentSceneIndex] && (
                  <div className="relative w-full h-44 rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                    <img
                      src={scenes[currentSceneIndex].imageUrl}
                      alt={`المشهد ${currentSceneIndex + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-slate-950/90 backdrop-blur-sm px-2.5 py-1 rounded-lg text-[10px] text-slate-300 font-mono border border-slate-800">
                      <span>الصفحة {scenes[currentSceneIndex].pageIndex + 1}</span>
                      <span>•</span>
                      <span>المدة: {scenes[currentSceneIndex].duration.toFixed(1)} ثانية</span>
                    </div>
                  </div>
                )}

                {/* Narration Text in Arabic */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 block">نص السرد الصوتي للمشهد:</label>
                  <p className="text-xs text-slate-200 leading-relaxed bg-slate-950 p-3 rounded-xl border border-slate-800/80 min-h-[70px]">
                    {scenes[currentSceneIndex]?.narrationText || "لا يوجد نص سردي"}
                  </p>
                </div>

                {/* Animation Selector */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                  <span className="text-slate-400">حركة الكاميرا (Animation):</span>
                  <select
                    value={scenes[currentSceneIndex]?.animation || "zoom_in"}
                    onChange={(e) => handleUpdateSceneAnimation(currentSceneIndex, e.target.value as VideoAnimationType)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-emerald-400 font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="pan_down">Pan Down (حركة رأسية - Webtoon)</option>
                    <option value="zoom_in">Zoom In (تقريب)</option>
                    <option value="zoom_out">Zoom Out (إبعاد)</option>
                    <option value="pan_left">Pan Left (أفقي يسار)</option>
                    <option value="pan_right">Pan Right (أفقي يمين)</option>
                    <option value="static">ثابت (Static)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Bottom Timeline Section (Full Width) */}
            <div className="lg:col-span-12">
              <ManhwaVideoTimeline
                scenes={scenes}
                currentSceneIndex={currentSceneIndex}
                onSelectScene={setCurrentSceneIndex}
                onUpdateSceneAnimation={handleUpdateSceneAnimation}
              />
            </div>
          </div>
        ) : !loadingPages && pages.length > 0 && !isProcessing ? (
          /* Empty State: Ready to create video */
          <div className="p-12 rounded-3xl bg-slate-900/60 border border-slate-800/80 flex flex-col items-center justify-center text-center gap-5 max-w-xl mx-auto shadow-2xl">
            <div className="p-5 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-inner">
              <Film className="h-12 w-12" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">جاهز لتحويل الفصل إلى فيديو سينمائي</h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md">
                سيتم استخراج المشاهد واللوحات الذكية، التعامل مع صور الويبتون الطويلة عبر الحركة الرأسية (Pan Down)، وصياغة سرد مشوق بصوتك المفضل.
              </p>
            </div>

            <button
              onClick={handleGenerateVideoProject}
              className="px-6 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm transition shadow-lg shadow-emerald-500/25 active:scale-95 cursor-pointer flex items-center gap-2"
            >
              <Sparkles className="h-5 w-5" />
              <span>بدء إنشاء الفيديو الآن</span>
            </button>
          </div>
        ) : null}
      </main>

      {/* Settings Modal */}
      <ManhwaVideoSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />
    </div>
  );
}
