import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  FavoriteManga, 
  getFavorites, 
  removeFavorite, 
  removeFavoriteItem,
  addFavorite,
  clearAllFavorites,
  exportFavoritesJson,
  importFavoritesJson,
  syncFavoritesFromCloud 
} from "../lib/favorites";
import { 
  getVideoFavorites, 
  removeVideoFavoriteItem, 
  clearAllVideoFavorites 
} from "../lib/videoFavorites";
import { toProxiedUrl } from "../utils/imageProxy";
import { DEFAULT_MANGA_COVER } from "../types";
import { 
  Heart, 
  Trash2, 
  Search, 
  BookOpen, 
  Clock, 
  Sparkles, 
  Compass, 
  ArrowRight,
  RefreshCw,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Bookmark,
  Filter,
  SlidersHorizontal,
  FolderSync,
  X,
  ExternalLink,
  Layers,
  Play
} from "lucide-react";

interface FavoritesProps {
  onSelectManga: (mangaId: string, sourceId?: string, title?: string, mangaObj?: any) => void;
  onExploreSources: () => void;
  onDirectRead?: (mangaId: string, chapterId: string, chapterNumber: string, mangaTitle: string, sourceId?: string) => void;
}

interface ReadingProgressInfo {
  chapterId: string;
  chapterNumber: string;
  timestamp: number;
}

export default function Favorites({ onSelectManga, onExploreSources, onDirectRead }: FavoritesProps) {
  const [favCategory, setFavCategory] = useState<"translation" | "video">("translation");
  const [favorites, setFavorites] = useState<FavoriteManga[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "title" | "source">("newest");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // History tracking for direct reading
  const [historyMap, setHistoryMap] = useState<Record<string, ReadingProgressInfo>>({});

  // Undo Toast state
  const [undoItem, setUndoItem] = useState<FavoriteManga | null>(null);
  const undoTimeoutRef = useRef<any>(null);

  // Clear all confirmation modal
  const [showClearModal, setShowClearModal] = useState<boolean>(false);

  // Quick Chapters Preview Modal state
  const [previewManga, setPreviewManga] = useState<FavoriteManga | null>(null);
  const [previewChapters, setPreviewChapters] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewChapterSearch, setPreviewChapterSearch] = useState<string>("");
  const [previewError, setPreviewError] = useState<string | null>(null);

  // File input ref for import
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openPreviewModal = async (e: React.MouseEvent, manga: FavoriteManga) => {
    e.stopPropagation();
    e.preventDefault();
    setPreviewManga(manga);
    setPreviewLoading(true);
    setPreviewChapters([]);
    setPreviewError(null);
    setPreviewChapterSearch("");

    try {
      const cleanId = String(manga.id).replace(/^suwayomi_/, "").trim();
      const queryParams = new URLSearchParams();
      if (manga.sourceId) {
        queryParams.set("sourceId", manga.sourceId);
        queryParams.set("provider", manga.sourceId);
      }
      const srcQuery = queryParams.toString() ? `?${queryParams.toString()}` : "";
      let chs: any[] = [];

      // 1. Try Suwayomi works chapters FIRST (instant 10ms for library and favorites)
      try {
        const suwRes = await fetch(`/api/suwayomi/works/${encodeURIComponent(cleanId)}/chapters${srcQuery}`);
        if (suwRes.ok) {
          const suwData = await suwRes.json();
          if (Array.isArray(suwData.chapters) && suwData.chapters.length > 0) {
            chs = suwData.chapters;
          }
        }
      } catch (e) {
        console.warn("Suwayomi works chapters notice:", e);
      }

      // 2. If empty, try standard chapters endpoint
      if (chs.length === 0) {
        try {
          const res = await fetch(`/api/manga/chapters/${encodeURIComponent(manga.id)}${srcQuery}`);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.chapters) && data.chapters.length > 0) {
              chs = data.chapters;
            }
          }
        } catch (e) {
          console.warn("Standard chapters notice:", e);
        }
      }

      // 3. If still empty, try Suwayomi works with onlineFetch=true
      if (chs.length === 0) {
        try {
          const onlineQuery = srcQuery ? `${srcQuery}&onlineFetch=true` : "?onlineFetch=true";
          const suwOnlineRes = await fetch(`/api/suwayomi/works/${encodeURIComponent(cleanId)}/chapters${onlineQuery}`);
          if (suwOnlineRes.ok) {
            const suwOnlineData = await suwOnlineRes.json();
            if (Array.isArray(suwOnlineData.chapters) && suwOnlineData.chapters.length > 0) {
              chs = suwOnlineData.chapters;
            }
          }
        } catch (e) {
          console.warn("Suwayomi online chapters notice:", e);
        }
      }

      setPreviewChapters(chs);
      if (chs.length === 0) {
        setPreviewError("لم يتم العثور على فصول مسجلة لهذا العمل حالياً");
      }
    } catch (err: any) {
      setPreviewError(err.message || "تعذر جلب قائمة الفصول");
    } finally {
      setPreviewLoading(false);
    }
  };

  const loadHistory = () => {
    try {
      const raw = localStorage.getItem("manga_history");
      if (raw) {
        setHistoryMap(JSON.parse(raw));
      }
    } catch {}
  };

  const loadFavs = () => {
    if (favCategory === "video") {
      setFavorites(getVideoFavorites());
    } else {
      setFavorites(getFavorites());
    }
    loadHistory();
  };

  useEffect(() => {
    loadFavs();

    if (favCategory === "translation") {
      // Trigger cloud sync in background for translation favorites
      setIsSyncing(true);
      syncFavoritesFromCloud()
        .then((merged) => {
          setFavorites(merged);
          setSyncNotice("تمت المزامنة بنجاح");
          setTimeout(() => setSyncNotice(null), 3000);
        })
        .catch(() => {})
        .finally(() => setIsSyncing(false));
    }

    const handleUpdate = () => {
      loadFavs();
    };

    window.addEventListener("manga_favorites_updated", handleUpdate);
    window.addEventListener("manga_video_favorites_updated", handleUpdate);
    window.addEventListener("manga_history_updated", loadHistory);
    return () => {
      window.removeEventListener("manga_favorites_updated", handleUpdate);
      window.removeEventListener("manga_video_favorites_updated", handleUpdate);
      window.removeEventListener("manga_history_updated", loadHistory);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, [favCategory]);

  const handleManualSync = async () => {
    if (favCategory === "video") {
      setFavorites(getVideoFavorites());
      setSyncNotice("تم تحديث مفضلة الفيديوهات محلياً");
      setTimeout(() => setSyncNotice(null), 3000);
      return;
    }
    setIsSyncing(true);
    try {
      const merged = await syncFavoritesFromCloud();
      setFavorites(merged);
      setSyncNotice("تم تحديث المفضلة سحابياً ومحلياً");
      setTimeout(() => setSyncNotice(null), 3000);
    } catch (e: any) {
      setSyncNotice("تعذرت المزامنة السحابية مؤقتاً");
      setTimeout(() => setSyncNotice(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRemove = (e: React.MouseEvent, item: FavoriteManga) => {
    e.stopPropagation();
    e.preventDefault();

    // Store for undo
    setUndoItem(item);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = setTimeout(() => {
      setUndoItem(null);
    }, 6000);

    if (favCategory === "video") {
      const updated = removeVideoFavoriteItem(item);
      setFavorites(updated);
    } else {
      const updated = removeFavoriteItem(item);
      setFavorites(updated);
    }
  };

  const handleUndo = () => {
    if (undoItem) {
      addFavorite(undoItem);
      setUndoItem(null);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    }
  };

  const handleExport = () => {
    const jsonStr = exportFavoritesJson();
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `manga_favorites_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const count = importFavoritesJson(text);
        setSyncNotice(`تم استيراد ${count} أعمال بنجاح`);
        setTimeout(() => setSyncNotice(null), 3500);
      } catch (err: any) {
        setSyncNotice(`خطأ في الاستيراد: ${err.message || "حدث خطأ أثناء قراءة الملف"}`);
        setTimeout(() => setSyncNotice(null), 4000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleConfirmClear = () => {
    clearAllFavorites();
    setFavorites([]);
    setShowClearModal(false);
  };

  // Extract unique available sources for the source filter
  const availableSources = useMemo(() => {
    const sources = new Set<string>();
    favorites.forEach((m) => {
      if (m.sourceName) sources.add(m.sourceName);
      else if (m.sourceId) sources.add(m.sourceId);
    });
    return Array.from(sources);
  }, [favorites]);

  // Helper to categorize manga type flexibly across Arabic & English inputs
  const isTypeMatch = (m: FavoriteManga, targetType: string): boolean => {
    if (targetType === "all") return true;
    const rawType = (m.type || "").toLowerCase();
    const rawTitle = (m.title || "").toLowerCase();

    if (targetType === "manhwa") {
      return rawType.includes("manhwa") || rawType.includes("كورية") || rawType.includes("webtoon") || rawTitle.includes("مانهوا");
    }
    if (targetType === "manga") {
      return (rawType.includes("manga") && !rawType.includes("man")) || rawType.includes("يابانية") || rawTitle.includes("مانجا");
    }
    if (targetType === "manhua") {
      return rawType.includes("manhua") || rawType.includes("صينية") || rawTitle.includes("مانها");
    }
    return true;
  };

  // Filter and Sort
  const processedFavorites = useMemo(() => {
    let result = (Array.isArray(favorites) ? favorites : []).filter((item) => {
      if (!item) return false;
      const title = item.title || "";
      const author = item.author || "";
      const source = item.sourceName || item.sourceId || "";

      const matchesSearch = 
        title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        author.toLowerCase().includes(searchQuery.toLowerCase()) ||
        source.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesType = isTypeMatch(item, filterType);

      const matchesSource = 
        filterSource === "all" || 
        item.sourceName === filterSource || 
        item.sourceId === filterSource;

      return matchesSearch && matchesType && matchesSource;
    });

    // Sorting
    result.sort((a, b) => {
      if (sortBy === "newest") return (b.addedAt || 0) - (a.addedAt || 0);
      if (sortBy === "oldest") return (a.addedAt || 0) - (b.addedAt || 0);
      if (sortBy === "title") return (a.title || "").localeCompare(b.title || "", "ar");
      if (sortBy === "source") return (a.sourceName || a.sourceId || "").localeCompare(b.sourceName || b.sourceId || "", "ar");
      return 0;
    });

    return result;
  }, [favorites, searchQuery, filterType, filterSource, sortBy]);

  // Reading stats calculation
  const stats = useMemo(() => {
    let readingCount = 0;
    favorites.forEach((m) => {
      const rawId = m.id.replace(/^suwayomi_/, "");
      if (historyMap[m.id] || historyMap[rawId]) {
        readingCount++;
      }
    });
    return {
      total: favorites.length,
      inProgress: readingCount,
      unread: Math.max(0, favorites.length - readingCount)
    };
  }, [favorites, historyMap]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 animate-in fade-in duration-300" dir="rtl">
      
      {/* Hidden file input for import */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept=".json" 
        className="hidden" 
      />

      {/* Top Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 border-b border-teal-500/20 pb-6 mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-400 font-mono bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20 shadow-sm">
              <Heart className="h-3.5 w-3.5 fill-teal-400 text-teal-400" />
              مكتبة المفضلة المتزامنة
            </span>

            <span className="text-xs font-mono text-slate-300 bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
              {stats.total} أعمال محفوظة
            </span>

            {stats.inProgress > 0 && (
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-800/40">
                {stats.inProgress} قيد القراءة
              </span>
            )}

            {/* Sync status button */}
            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              title="مزامنة المفضلة سحابياً ومحلياً"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-teal-300 bg-slate-900 hover:bg-slate-850 px-2.5 py-1 rounded-full border border-slate-800 transition cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin text-teal-400" : ""}`} />
              <span>{isSyncing ? "جاري المزامنة..." : "مزامنة سحابية"}</span>
            </button>

            {syncNotice && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-500/30 animate-pulse">
                <CheckCircle2 className="h-3 w-3" />
                {syncNotice}
              </span>
            )}
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            الأعمال المفضلة <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">(Favorites)</span>
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
            جميع أعمال المانجا والمانهوا المفضلة لديك محفوظة بأمان وفورية التصفح مع دعم المزامنة واستئناف القراءة أو إنشاء الفيديوهات.
          </p>

          {/* Category Tabs: Translation (❤️) vs Video Creation (🖤) */}
          <div className="flex flex-wrap items-center gap-3 mt-4 pt-2">
            <button
              onClick={() => setFavCategory("translation")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                favCategory === "translation"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/60 shadow-md shadow-rose-500/10"
                  : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-white"
              }`}
            >
              <Heart className={`h-4 w-4 ${favCategory === "translation" ? "fill-rose-500 text-rose-500" : "text-rose-400"}`} />
              <span>❤️ مفضلة الترجمة</span>
            </button>

            <button
              onClick={() => setFavCategory("video")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                favCategory === "video"
                  ? "bg-slate-950 text-emerald-400 border border-emerald-500 shadow-md shadow-emerald-500/10 ring-1 ring-emerald-500/50"
                  : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">🖤</span>
              <span>مفضلة إنشاء الفيديوهات</span>
            </button>
          </div>
        </div>

        {/* Action Controls Header */}
        <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto">
          {favorites.length > 0 && (
            <>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 px-3.5 py-2 text-xs font-semibold border border-slate-800 hover:border-slate-700 transition cursor-pointer shadow-sm"
                title="تصدير نسخة احتياطية من المفضلة بتنسيق JSON"
              >
                <Download className="h-3.5 w-3.5 text-teal-400" />
                <span>تصدير</span>
              </button>

              <button
                onClick={handleImportClick}
                className="flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 px-3.5 py-2 text-xs font-semibold border border-slate-800 hover:border-slate-700 transition cursor-pointer shadow-sm"
                title="استيراد مفضلة محفوظة مسبقاً"
              >
                <Upload className="h-3.5 w-3.5 text-teal-400" />
                <span>استيراد</span>
              </button>

              <button
                onClick={() => setShowClearModal(true)}
                className="flex items-center gap-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 px-3.5 py-2 text-xs font-semibold border border-rose-500/30 transition cursor-pointer shadow-sm"
                title="مسح كافة أعمال المفضلة"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>مسح الكل</span>
              </button>
            </>
          )}

          <button
            onClick={onExploreSources}
            className="flex items-center gap-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 text-xs font-bold transition shadow-lg shadow-teal-500/20 active:scale-95 cursor-pointer"
          >
            <Compass className="h-4 w-4" />
            <span>استكشاف المصادر</span>
          </button>
        </div>
      </div>

      {/* Undo Banner if an item was recently removed */}
      {undoItem && (
        <div className="mb-6 flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-900 border border-teal-500/40 shadow-lg animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 text-xs text-slate-200">
            <Trash2 className="h-4 w-4 text-rose-400" />
            <span>تمت إزالة <strong>{undoItem.title}</strong> من المفضلة</span>
          </div>
          <button
            onClick={handleUndo}
            className="px-3 py-1 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-bold transition cursor-pointer shadow"
          >
            تراجع عن الحذف
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      {favorites.length > 0 && (
        <div className="mb-8 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            {/* Search Input */}
            <div className="sm:col-span-6 relative">
              <div className="absolute inset-y-0 right-0 flex items-center pr-3.5 pointer-events-none">
                <Search className="h-4 w-4 text-teal-400/70" />
              </div>
              <input
                type="text"
                className="w-full bg-slate-900 border border-slate-800 focus:border-teal-400 text-white text-xs sm:text-sm rounded-xl block pr-10 p-2.5 outline-none transition placeholder-slate-500"
                placeholder="ابحث بالعنوان، المؤلف، أو المصدر..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 hover:text-slate-300 text-xs"
                >
                  مسح
                </button>
              )}
            </div>

            {/* Type Filter */}
            <div className="sm:col-span-2">
              <select
                className="w-full bg-slate-900 border border-slate-800 focus:border-teal-400 text-slate-200 text-xs sm:text-sm rounded-xl block p-2.5 outline-none transition cursor-pointer"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="all">كل التصنيفات</option>
                <option value="manhwa">مانهوا كورية</option>
                <option value="manga">مانجا يابانية</option>
                <option value="manhua">مانها صينية</option>
              </select>
            </div>

            {/* Source Filter */}
            <div className="sm:col-span-2">
              <select
                className="w-full bg-slate-900 border border-slate-800 focus:border-teal-400 text-slate-200 text-xs sm:text-sm rounded-xl block p-2.5 outline-none transition cursor-pointer"
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
              >
                <option value="all">جميع المصادر</option>
                {availableSources.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Sort Options */}
            <div className="sm:col-span-2">
              <select
                className="w-full bg-slate-900 border border-slate-800 focus:border-teal-400 text-slate-200 text-xs sm:text-sm rounded-xl block p-2.5 outline-none transition cursor-pointer"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="newest">الأحدث إضافة</option>
                <option value="oldest">الأقدم إضافة</option>
                <option value="title">أبجدياً (أ - ي)</option>
                <option value="source">حسب المصدر</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Favorites Grid */}
      {processedFavorites.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {processedFavorites.map((manga) => {
            const rawCover = manga.coverUrl || (manga as any).cover || (manga as any).image;
            const cover = (rawCover && typeof rawCover === "string" && rawCover.trim())
              ? toProxiedUrl(rawCover.trim())
              : DEFAULT_MANGA_COVER;

            // Check reading history for this specific manga
            const rawId = manga.id.replace(/^suwayomi_/, "");
            const history = historyMap[manga.id] || historyMap[rawId];

            return (
              <div
                key={`${manga.sourceId || 'src'}_${manga.id}`}
                onClick={() => onSelectManga(manga.id, manga.sourceId, manga.title, manga)}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-slate-900/60 border border-slate-800 transition duration-200 hover:-translate-y-1 hover:border-teal-500/50 hover:shadow-xl hover:shadow-teal-500/10"
              >
                {/* Cover Image Container */}
                <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-950">
                  <img
                    src={cover}
                    alt={manga.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-85" />

                  {/* Top Heart Badge */}
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md px-2 py-1 rounded-full border border-slate-700 text-[10px] font-bold shadow-md">
                    {favCategory === "video" ? (
                      <>
                        <span className="text-xs leading-none">🖤</span>
                        <span className="text-emerald-400">فيديو</span>
                      </>
                    ) : (
                      <>
                        <Heart className="h-3 w-3 fill-rose-500 text-rose-500" />
                        <span className="text-rose-300">ترجمة</span>
                      </>
                    )}
                  </div>

                  {/* Quick Remove Button */}
                  <button
                    onClick={(e) => handleRemove(e, manga)}
                    className="absolute top-2 left-2 p-1.5 rounded-full bg-slate-950/85 hover:bg-rose-500 text-slate-400 hover:text-white border border-slate-800 hover:border-rose-400 backdrop-blur-md transition active:scale-90 cursor-pointer shadow-md"
                    title="إزالة من المفضلة"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>

                  {/* Badges on Cover bottom */}
                  <div className="absolute bottom-2 right-2 left-2 flex flex-wrap items-center gap-1.5 justify-between pointer-events-none">
                    {/* Source Badge */}
                    {(manga.sourceName || manga.sourceId) && (
                      <span className="bg-slate-900/90 text-teal-300 text-[9px] font-bold px-2 py-0.5 rounded-md border border-teal-500/20 truncate max-w-[120px] backdrop-blur-sm">
                        {manga.sourceName || manga.sourceId}
                      </span>
                    )}

                    {/* Type Badge */}
                    {manga.type && (
                      <span className="bg-slate-950/90 text-slate-300 text-[9px] font-mono px-1.5 py-0.5 rounded-md border border-slate-800 backdrop-blur-sm">
                        {manga.type.includes("manhwa") ? "مانهوا" : manga.type.includes("manhua") ? "مانها" : "مانجا"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Details Footer */}
                <div className="p-3 text-right flex flex-col justify-between flex-1">
                  <div>
                    {manga.author && (
                      <span className="font-mono text-[10px] text-teal-400/90 line-clamp-1">
                        {manga.author}
                      </span>
                    )}
                    <h3 className="line-clamp-2 font-display text-xs font-bold text-white group-hover:text-teal-300 transition-colors mt-0.5">
                      {manga.title}
                    </h3>
                  </div>

                  {/* Reading Status & Action */}
                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-1">
                      {history ? (
                        <span className="flex items-center gap-1 text-emerald-400 font-semibold truncate text-[10px]">
                          <Bookmark className="h-3 w-3 shrink-0 fill-emerald-500/20" />
                          <span>وصلت: الفصل {history.chapterNumber || "1"}</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 font-mono text-slate-500 text-[10px]">
                          <Clock className="h-3 w-3" />
                          {new Date(manga.addedAt || Date.now()).toLocaleDateString("ar-SA", { month: "numeric", day: "numeric" })}
                        </span>
                      )}

                      {/* Quick Chapters Button */}
                      <button
                        onClick={(e) => openPreviewModal(e, manga)}
                        className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-300 text-[10px] font-bold transition cursor-pointer flex items-center gap-1 border border-slate-700"
                        title="عرض الفصول السريعة"
                      >
                        <Layers className="h-3 w-3" />
                        <span>الفصول</span>
                      </button>
                    </div>

                    {/* Direct Action Row */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/40">
                      {history && onDirectRead ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDirectRead(manga.id, history.chapterId, history.chapterNumber, manga.title, manga.sourceId);
                          }}
                          className="w-full py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500 hover:text-slate-950 text-emerald-300 text-[10px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer border border-emerald-500/30"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          <span>متابعة القراءة</span>
                        </button>
                      ) : (
                        <span className="text-teal-400 group-hover:underline font-bold text-[10px] flex items-center justify-end w-full gap-1">
                          <span>عرض التفاصيل</span>
                          <ArrowRight className="h-3 w-3 rotate-180" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : favorites.length > 0 ? (
        /* No search results within favorites */
        <div className="rounded-2xl border border-dashed border-slate-800 p-16 text-center text-slate-500">
          <Search className="mx-auto h-12 w-12 text-slate-700 mb-3" />
          <h3 className="font-display text-base font-bold text-slate-300">لا توجد نتائج مطابقة لبحثك في المفضلة</h3>
          <p className="mt-1.5 text-xs text-slate-500">
            جرّب تغيير كلمات البحث أو اختر "كل التصنيفات" و"جميع المصادر".
          </p>
          <button
            onClick={() => {
              setSearchQuery("");
              setFilterType("all");
              setFilterSource("all");
            }}
            className="mt-4 px-4 py-2 rounded-xl bg-slate-850 hover:bg-slate-800 text-teal-400 text-xs font-bold transition cursor-pointer border border-slate-750"
          >
            إعادة تعيين الفلاتر
          </button>
        </div>
      ) : (
        /* Empty favorites state */
        <div className="rounded-2xl border border-dashed border-teal-500/20 bg-slate-900/20 p-16 text-center text-slate-500">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-400 mb-4">
            <Heart className="h-8 w-8 fill-teal-500/20" />
          </div>
          <h3 className="font-display text-lg font-bold text-slate-200">قائمتك المفضلة فارغة حالياً</h3>
          <p className="mt-2 text-xs sm:text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
            عند تصفح أي مانجا أو مانهوا في المصادر أو البحث أو صفحة التفاصيل، اضغط على أيقونة "القلب" لحفظها هنا فوراً واستئناف قراءتها في أي وقت.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onExploreSources}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-500 hover:bg-teal-600 px-6 py-3 text-xs sm:text-sm font-bold text-white transition active:scale-95 cursor-pointer shadow-lg shadow-teal-500/20"
            >
              <Compass className="h-4 w-4" />
              <span>تصفح المصادر وابدأ بتفضيل الأعمال</span>
            </button>
            <button
              onClick={handleImportClick}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 px-5 py-3 text-xs sm:text-sm font-bold text-slate-300 transition cursor-pointer border border-slate-800"
            >
              <Upload className="h-4 w-4 text-teal-400" />
              <span>استيراد ملف مفضلة سابق</span>
            </button>
          </div>
        </div>
      )}

      {/* Quick Chapters Preview Modal */}
      {previewManga && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-750 bg-slate-900 shadow-2xl overflow-hidden animate-in zoom-in-95">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/40">
              <div className="flex items-center gap-3 overflow-hidden">
                <img
                  src={toProxiedUrl(previewManga.coverUrl || (previewManga as any).cover || (previewManga as any).image) || DEFAULT_MANGA_COVER}
                  alt={previewManga.title}
                  className="h-12 w-9 rounded object-cover border border-slate-800 shrink-0 bg-slate-950"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
                  }}
                />
                <div className="overflow-hidden">
                  <h3 className="text-sm font-bold text-white truncate">{previewManga.title}</h3>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                    {previewManga.sourceName && (
                      <span className="text-teal-400 font-mono text-[11px]">{previewManga.sourceName}</span>
                    )}
                    <span>•</span>
                    <span className="font-mono text-[11px]">{previewChapters.length} فصل</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    const m = previewManga;
                    setPreviewManga(null);
                    onSelectManga(m.id, m.sourceId, m.title, m);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 text-xs font-bold transition flex items-center gap-1 border border-teal-500/20 cursor-pointer"
                  title="فتح صفحة المانجا الكاملة"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">التفاصيل الكاملة</span>
                </button>
                <button
                  onClick={() => setPreviewManga(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Search and Filters inside modal */}
            <div className="p-3 border-b border-slate-800 bg-slate-900/80 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="ابحث عن رقم الفصل..."
                  value={previewChapterSearch}
                  onChange={(e) => setPreviewChapterSearch(e.target.value)}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 pr-9 pl-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-[220px]">
              {previewLoading ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-400">
                  <RefreshCw className="h-6 w-6 animate-spin text-teal-400" />
                  <span className="text-xs font-mono">جاري جلب الفصول المتاحة...</span>
                </div>
              ) : previewError ? (
                <div className="flex flex-col items-center justify-center h-48 text-center p-4">
                  <AlertTriangle className="h-8 w-8 text-amber-500 mb-2" />
                  <p className="text-xs text-slate-300 mb-3">{previewError}</p>
                  <button
                    onClick={() => {
                      const m = previewManga;
                      setPreviewManga(null);
                      onSelectManga(m.id, m.sourceId, m.title, m);
                    }}
                    className="px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition cursor-pointer"
                  >
                    فتح صفحة المانجا وجلب الفصول
                  </button>
                </div>
              ) : previewChapters.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  لا توجد فصول متطابقة
                </div>
              ) : (
                previewChapters
                  .filter((ch) => {
                    if (!previewChapterSearch.trim()) return true;
                    const q = previewChapterSearch.toLowerCase();
                    const num = String(ch.chapter || ch.chapterNumber || "");
                    const title = String(ch.title || ch.name || "");
                    return num.includes(q) || title.toLowerCase().includes(q);
                  })
                  .map((ch, idx) => {
                    const chNum = ch.chapter || ch.chapterNumber || `${idx + 1}`;
                    const chTitle = ch.title || ch.name || `الفصل ${chNum}`;
                    const history = historyMap[previewManga.id] || historyMap[previewManga.id.replace(/^suwayomi_/, "")];
                    const isRead = history && (String(history.chapterNumber) === String(chNum) || history.chapterId === ch.id);

                    return (
                      <div
                        key={ch.id || idx}
                        onClick={() => {
                          const m = previewManga;
                          setPreviewManga(null);
                          if (onDirectRead) {
                            onDirectRead(m.id, ch.id, chNum, m.title, m.sourceId);
                          } else {
                            onSelectManga(m.id, m.sourceId, m.title, m);
                          }
                        }}
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition cursor-pointer ${
                          isRead
                            ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300 hover:bg-emerald-950/30"
                            : "bg-slate-950/40 border-slate-800 hover:border-teal-500/40 hover:bg-slate-800/60 text-slate-200"
                        }`}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <BookOpen className={`h-4 w-4 shrink-0 ${isRead ? "text-emerald-400" : "text-teal-400"}`} />
                          <span className="text-xs font-medium truncate">{chTitle}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isRead && (
                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-900/40 px-2 py-0.5 rounded-md">
                              آخر قراءة
                            </span>
                          )}
                          <span className="text-xs text-teal-400 hover:underline font-bold flex items-center gap-1">
                            <span>قراءة</span>
                            <ArrowRight className="h-3 w-3 rotate-180" />
                          </span>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Clear All */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-slate-900 p-6 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-400 mb-3">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h3 className="font-display text-base font-bold text-white">تأكيد مسح قائمة المفضلة بالكامل</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف جميع الأعمال المفضلة ({favorites.length} أعمال)؟ سيتم مسحها من هذا الجهاز ومن السحابة. يمكنك تصدير نسخة احتياطية أولاً قبل المسح.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmClear}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition cursor-pointer shadow-lg shadow-rose-500/20"
              >
                تأكيد المسح النهائي
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
