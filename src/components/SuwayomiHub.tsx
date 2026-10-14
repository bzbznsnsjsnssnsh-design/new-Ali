import React, { useState, useEffect, useRef } from "react";
import FederatedSearch from "./FederatedSearch";
import {
  Globe,
  History,
  Compass,
  BookMarked,
  Sparkles,
  RefreshCw,
  Maximize2,
  Minimize2,
  ExternalLink,
  Radio,
  Layers,
  ArrowRight,
  BookOpen,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileText,
  SlidersHorizontal,
  LayoutGrid,
  Zap,
  Check,
  X,
  Play,
  ArrowUpDown,
  Heart,
  UploadCloud,
  Plus,
  Database,
  ShieldCheck
} from "lucide-react";
import AddCustomSourceModal from "./AddCustomSourceModal";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import { isChapterViewed, markChapterAsViewed } from "../lib/viewedChapters";

export type SuwayomiTab = "sources" | "history" | "browse" | "updates" | "library";

export interface PulledChapterInfo {
  id: string;
  title: string;
  chapterNumber: string;
  mangaTitle?: string;
  mangaId?: string;
  pageCount?: number;
}

interface SuwayomiHubProps {
  initialTab?: SuwayomiTab;
  initialSearchQuery?: string;
  onOpenStudio?: () => void;
  onPullChapter?: (
    pages: string[],
    chapterInfo: PulledChapterInfo,
    target: "reader" | "studio"
  ) => void;
}

const TABS: { id: SuwayomiTab; label: string; icon: React.ComponentType<{ className?: string }>; path: string; desc: string }[] = [
  {
    id: "sources",
    label: "المصادر المباشرة",
    icon: Globe,
    path: "/sources",
    desc: "تصفح جميع مصادر المانجا والمانهوا العربية والعالمية والبحث فيها مباشرة"
  },
  {
    id: "history",
    label: "سجل القراءة",
    icon: History,
    path: "/history",
    desc: "سجل الفصول المقروءة ومواعيدها مع إمكانية متابعة القراءة فوراً"
  },
  {
    id: "library",
    label: "المكتبة السحابية",
    icon: BookMarked,
    path: "/library",
    desc: "الأعمال والمانجا المحفوظة على خادم Suwayomi الخاص بك"
  },
  {
    id: "browse",
    label: "التصفح والإضافات",
    icon: Compass,
    path: "/browse",
    desc: "تصفح واستعراض الإضافات والمصادر المتوفرة على الخادم"
  },
  {
    id: "updates",
    label: "التحديثات",
    icon: Sparkles,
    path: "/updates",
    desc: "آخر الفصول المحدثة والجديدة من مصادر المانجا"
  }
];

export default function SuwayomiHub({ 
  initialTab = "sources", 
  initialSearchQuery = "",
  onOpenStudio, 
  onPullChapter 
}: SuwayomiHubProps) {
  // Main view mode: "sources" (2,200+ sources) vs "works" (library & recent) vs "web-embed" (interactive Suwayomi Web UI) vs "federated-search" (comprehensive search)
  const [hubMode, setHubMode] = useState<"sources" | "works" | "web-embed" | "federated-search">(
    initialSearchQuery ? "federated-search" : initialTab === "sources" ? "sources" : initialTab === "library" ? "works" : "sources"
  );
  const [activeTab, setActiveTab] = useState<SuwayomiTab>(initialTab);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [iframeKey, setIframeKey] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Auto-intercept notification
  const [autoInterceptToast, setAutoInterceptToast] = useState<{ chapterId: string; mangaTitle?: string } | null>(null);

  // Sources Directory state (2,211 sources from Suwayomi)
  const [sources, setSources] = useState<any[]>([]);
  const [filteredSources, setFilteredSources] = useState<any[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState<boolean>(false);
  const [langFilter, setLangFilter] = useState<string>("all");
  const [sourceSearchQuery, setSourceSearchQuery] = useState<string>("");
  const [selectedSource, setSelectedSource] = useState<any | null>(null);
  const [sourceMangas, setSourceMangas] = useState<any[]>([]);
  const [isLoadingSourceCatalog, setIsLoadingSourceCatalog] = useState<boolean>(false);
  const [sourceCatalogSearch, setSourceCatalogSearch] = useState<string>("");

  // Cross-source Work Search (Requirement 1)
  const [globalWorkSearchQuery, setGlobalWorkSearchQuery] = useState<string>(initialSearchQuery || "");
  const [globalSearchResults, setGlobalSearchResults] = useState<any[]>([]);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState<boolean>(false);
  const [hasSearchedGlobal, setHasSearchedGlobal] = useState<boolean>(Boolean(initialSearchQuery));

  useEffect(() => {
    if (initialSearchQuery) {
      setGlobalWorkSearchQuery(initialSearchQuery);
      setHubMode("federated-search");
    }
  }, [initialSearchQuery]);

  // Progressive loading for all sources (Requirement 3)
  const [visibleSourcesCount, setVisibleSourcesCount] = useState<number>(80);
  const sourcesDirectorySentinelRef = useRef<HTMLDivElement>(null);

  // Source catalog pagination & infinite scroll (Requirement 5)
  const [sourcePage, setSourcePage] = useState<number>(1);
  const [sourceHasNextPage, setSourceHasNextPage] = useState<boolean>(true);
  const [isLoadingMoreSource, setIsLoadingMoreSource] = useState<boolean>(false);
  const sourceCatalogSentinelRef = useRef<HTMLDivElement>(null);

  // Reactive keys for Favorites and Viewed Chapters (Requirement 2 & 4)
  const [favoritesUpdatedKey, setFavoritesUpdatedKey] = useState<number>(0);
  const [viewedUpdatedKey, setViewedUpdatedKey] = useState<number>(0);

  // Visual Works & Chapters state
  const [works, setWorks] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isLoadingWorks, setIsLoadingWorks] = useState<boolean>(false);
  const [selectedMangaModal, setSelectedMangaModal] = useState<any | null>(null);
  const [isLoadingChapters, setIsLoadingChapters] = useState<boolean>(false);
  const [mangaChapters, setMangaChapters] = useState<any[]>([]);
  const [mangaChaptersError, setMangaChaptersError] = useState<string | null>(null);
  const [mangaSourcesChecked, setMangaSourcesChecked] = useState<any[]>([]);
  const [isAggregatingAllSources, setIsAggregatingAllSources] = useState<boolean>(false);
  const [showAddCustomSourceModal, setShowAddCustomSourceModal] = useState<boolean>(false);
  const [chapterFilterQuery, setChapterFilterQuery] = useState<string>("");
  const [chapterSortAsc, setChapterSortAsc] = useState<boolean>(false);

  // Recent History from Suwayomi
  const [recentChapters, setRecentChapters] = useState<any[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState<boolean>(false);

  // Pulling target loading indicator
  const [isPullingTarget, setIsPullingTarget] = useState<string | null>(null);

  // Optional manual input (kept collapsed for power users)
  const [showManualInput, setShowManualInput] = useState<boolean>(false);
  const [manualInputVal, setManualInputVal] = useState<string>("");
  const [isResolvingManual, setIsResolvingManual] = useState<boolean>(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Listen to favorite and viewed chapter updates across the entire app
  useEffect(() => {
    const handleFavUpdate = () => setFavoritesUpdatedKey((k) => k + 1);
    const handleViewUpdate = () => setViewedUpdatedKey((k) => k + 1);
    window.addEventListener("manga_favorites_updated", handleFavUpdate);
    window.addEventListener("manga_chapter_viewed_update", handleViewUpdate);
    return () => {
      window.removeEventListener("manga_favorites_updated", handleFavUpdate);
      window.removeEventListener("manga_chapter_viewed_update", handleViewUpdate);
    };
  }, []);

  // Sync initialTab
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
      setIsLoading(true);
      if (initialTab === "sources") {
        setHubMode("sources");
      } else if (initialTab === "library") {
        setHubMode("works");
      }
    }
  }, [initialTab]);

  // Load sources, works and recent history on mount
  useEffect(() => {
    fetchSources();
    fetchWorks();
    fetchRecentChapters();
  }, []);

  const fetchSources = async () => {
    try {
      setIsLoadingSources(true);
      const res = await fetch("/api/suwayomi/sources");
      if (res.ok) {
        const data = await res.json();
        if (data.online && Array.isArray(data.sources)) {
          setSources(data.sources);
        }
      }
    } catch (e) {
      console.warn("Could not fetch sources:", e);
    } finally {
      setIsLoadingSources(false);
    }
  };

  useEffect(() => {
    let list = sources;
    if (langFilter !== "all") {
      list = list.filter((s) => {
        const l = (s.language || s.lang || "").toLowerCase();
        if (langFilter === "ar") return l === "ar" || l === "arabic" || (s.name || "").includes("(AR)");
        if (langFilter === "en") return l === "en" || l === "english" || (s.name || "").includes("(EN)");
        return l === langFilter.toLowerCase();
      });
    }
    if (sourceSearchQuery.trim()) {
      const q = sourceSearchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          (s.name || "").toLowerCase().includes(q) ||
          (s.displayName || "").toLowerCase().includes(q)
      );
    }
    setFilteredSources(list);
  }, [sources, langFilter, sourceSearchQuery]);

  const loadSourceCatalog = async (source: any, query: string = "") => {
    setSelectedSource(source);
    setIsLoadingSourceCatalog(true);
    setSourceMangas([]);
    setSourcePage(1);
    setSourceHasNextPage(true);
    try {
      const rawId = source.rawId || String(source.id).replace(/^suwayomi_/, "");
      const qParam = encodeURIComponent(query.trim());
      const url = query.trim()
        ? `/api/suwayomi/source/${encodeURIComponent(rawId)}/search?query=${qParam}&page=1`
        : `/api/suwayomi/source/${encodeURIComponent(rawId)}/popular?page=1`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const results = data.results || [];
        setSourceMangas(results);
        setSourceHasNextPage(data.hasNextPage ?? (results.length >= 10));
      }
    } catch (err) {
      console.warn("Could not load source catalog:", err);
      setSourceMangas([]);
    } finally {
      setIsLoadingSourceCatalog(false);
    }
  };

  const loadMoreSourceMangas = async () => {
    if (!selectedSource || isLoadingMoreSource || isLoadingSourceCatalog || !sourceHasNextPage) {
      return;
    }
    const nextPage = sourcePage + 1;
    setIsLoadingMoreSource(true);
    try {
      const rawId = selectedSource.rawId || String(selectedSource.id).replace(/^suwayomi_/, "");
      const qParam = encodeURIComponent(sourceCatalogSearch.trim());
      const url = sourceCatalogSearch.trim()
        ? `/api/suwayomi/source/${encodeURIComponent(rawId)}/search?query=${qParam}&page=${nextPage}`
        : `/api/suwayomi/source/${encodeURIComponent(rawId)}/popular?page=${nextPage}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const fresh = data.results || [];
        if (fresh.length === 0) {
          setSourceHasNextPage(false);
        } else {
          setSourceMangas((prev) => {
            const existingIds = new Set(prev.map((m) => String(m.rawId || m.id)));
            const deduplicated = fresh.filter((m: any) => !existingIds.has(String(m.rawId || m.id)));
            return [...prev, ...deduplicated];
          });
          setSourcePage(nextPage);
          setSourceHasNextPage(data.hasNextPage ?? (fresh.length >= 10));
        }
      } else {
        setSourceHasNextPage(false);
      }
    } catch (err) {
      console.warn("Could not load more source mangas:", err);
    } finally {
      setIsLoadingMoreSource(false);
    }
  };

  // Cross-source search across all connected Suwayomi sources (Requirement 1)
  const handleSearchGlobalWorks = (queryText?: string) => {
    const q = (queryText !== undefined ? queryText : globalWorkSearchQuery).trim();
    if (!q) return;
    setGlobalWorkSearchQuery(q);
    setHubMode("federated-search");
  };

  // Infinite scroll observer for source catalog (Requirement 5)
  useEffect(() => {
    if (!selectedSource || !sourceHasNextPage || isLoadingMoreSource || isLoadingSourceCatalog) return;
    const sentinel = sourceCatalogSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreSourceMangas();
        }
      },
      { rootMargin: "350px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [selectedSource, sourceHasNextPage, isLoadingMoreSource, isLoadingSourceCatalog, sourcePage, sourceCatalogSearch]);

  // Progressive loading observer for sources directory (Requirement 3: show all sources)
  useEffect(() => {
    if (visibleSourcesCount >= filteredSources.length) return;
    const sentinel = sourcesDirectorySentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleSourcesCount((prev) => Math.min(prev + 60, filteredSources.length));
        }
      },
      { rootMargin: "250px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleSourcesCount, filteredSources.length]);

  // Listen for auto-intercepted chapter clicks from the proxied embedded Suwayomi iframe!
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === "SUWAYOMI_AUTO_OPEN_CHAPTER") {
        const { chapterId, mangaId } = event.data;
        if (!chapterId) return;

        console.log("[SuwayomiHub] Auto chapter interception caught:", chapterId, mangaId);
        setAutoInterceptToast({
          chapterId: String(chapterId),
          mangaTitle: mangaId ? `عمل #${mangaId}` : "الفصل المختار"
        });

        // Automatically open the chapter in the reader!
        await handleExecutePullChapter(
          String(chapterId),
          `الفصل ${chapterId}`,
          String(chapterId),
          "عمل مانجا",
          String(mangaId || ""),
          "reader"
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const fetchWorks = async (query?: string) => {
    try {
      setIsLoadingWorks(true);
      const url = query ? `/api/suwayomi/works?q=${encodeURIComponent(query)}` : "/api/suwayomi/works";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.works)) {
          setWorks(data.works);
        }
      }
    } catch (err) {
      console.warn("Could not fetch works:", err);
    } finally {
      setIsLoadingWorks(false);
    }
  };

  const fetchRecentChapters = async () => {
    try {
      setIsLoadingRecent(true);
      const res = await fetch("/api/suwayomi/recent-chapters");
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.chapters)) {
          setRecentChapters(data.chapters);
        }
      }
    } catch (e) {
      console.warn("Could not load recent chapters:", e);
    } finally {
      setIsLoadingRecent(false);
    }
  };

  // Open Manga Details & Chapter list with deep multi-source verification and deduplication
  const handleOpenManga = async (manga: any, forceOnline: boolean = true, forceAggregate: boolean = false) => {
    const sourceInfo = selectedSource || sources.find((s) => s.id === manga.sourceId || s.rawId === manga.sourceId);
    const enrichedManga = {
      ...manga,
      sourceName: manga.sourceName || sourceInfo?.displayName || sourceInfo?.name || "المصدر المحدد",
      sourceId: manga.sourceId || sourceInfo?.id || "",
    };
    setSelectedMangaModal(enrichedManga);
    setMangaChapters([]);
    setMangaChaptersError(null);
    setMangaSourcesChecked([]);
    setChapterFilterQuery("");
    setIsLoadingChapters(true);

    const shouldAggregate = forceAggregate || manga.aggregateAll || (manga.siblingSources && manga.siblingSources.length > 1);

    try {
      if (shouldAggregate) {
        setIsAggregatingAllSources(true);
        const aggRes = await fetch("/api/suwayomi/aggregate-chapters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: manga.title,
            mangas: manga.siblingSources || [{
              id: manga.id,
              rawId: manga.rawId || manga.id,
              sourceId: manga.sourceId,
              sourceName: manga.sourceName,
              sourceLanguage: manga.sourceLanguage || manga.language
            }]
          })
        });

        if (aggRes.ok) {
          const data = await aggRes.json();
          if (data.success && Array.isArray(data.chapters)) {
            // Keep only real chapters verified from source
            const valid = data.chapters.filter((c: any) => c && (c.chapterNumber !== undefined || c.title));
            setMangaChapters(valid);
            setMangaSourcesChecked(data.sourcesChecked || []);
            if (valid.length === 0) {
              setMangaChaptersError("لم يتم العثور على فصول متوفرة فعلياً في المصادر المفحوصة.");
            }
          } else {
            setMangaChaptersError(data.error || "تعذر فحص الفصول من المصادر.");
          }
        } else {
          const errJson = await aggRes.json().catch(() => ({}));
          setMangaChaptersError(errJson.error || "فشل الاتصال بالخادم لفحص فصول المصادر.");
        }
      } else {
        const srcParam = enrichedManga.sourceId ? `&sourceId=${encodeURIComponent(enrichedManga.sourceId)}` : "";
        const onlineParam = forceOnline ? `&onlineFetch=true` : "";
        const res = await fetch(`/api/suwayomi/works/${encodeURIComponent(manga.id)}/chapters?t=${Date.now()}${onlineParam}${srcParam}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.chapters)) {
            // Filter strictly: ONLY real chapters actually returned from source
            const valid = data.chapters.filter((c: any) => c && (c.chapterNumber !== undefined || c.title));
            setMangaChapters(valid);
            setMangaSourcesChecked([{
              sourceId: enrichedManga.sourceId,
              sourceName: enrichedManga.sourceName,
              chaptersFound: valid.length,
              status: valid.length > 0 ? "ok" : "empty"
            }]);
            if (valid.length === 0) {
              setMangaChaptersError("لم يتم العثور على فصول متوفرة فعلياً في هذا المصدر حالياً.");
            }
          } else {
            setMangaChaptersError(data.error || "تعذر قراءة قائمة الفصول من المصدر.");
          }
        } else {
          const errJson = await res.json().catch(() => ({}));
          setMangaChaptersError(errJson.error || `خطأ (${res.status}) أثناء جلب فصول هذا العمل من المصدر`);
        }
      }
    } catch (err: any) {
      console.warn("Could not load manga chapters:", err);
      setMangaChaptersError(err.message || "فشل الاتصال بالخادم لجلب الفصول");
    } finally {
      setIsLoadingChapters(false);
      setIsAggregatingAllSources(false);
    }
  };

  // Pull chapter pages and trigger action (Reader or Studio)
  const handleExecutePullChapter = async (
    chapterId: string,
    chapterTitle: string,
    chapterNumber: string,
    mangaTitle: string,
    mangaId: string,
    target: "reader" | "studio",
    existingPages?: string[]
  ) => {
    const actionKey = `${chapterId}-${target}`;
    setIsPullingTarget(actionKey);

    // Record chapter as viewed
    markChapterAsViewed(mangaId, chapterId, chapterNumber, mangaTitle);
    setViewedUpdatedKey((k) => k + 1);

    try {
      let pages = existingPages;
      if (!pages || pages.length === 0) {
        const res = await fetch(`/api/suwayomi/chapter/${encodeURIComponent(chapterId)}/pages`);
        if (!res.ok) {
          throw new Error("تعذر جلب صفحات هذا الفصل من الخادم.");
        }
        const pData = await res.json();
        pages = pData.pages || [];
      }

      if (!pages || pages.length === 0) {
        throw new Error("لم يتم العثور على أي صفحات صور لهذا الفصل.");
      }

      const info: PulledChapterInfo = {
        id: chapterId,
        title: chapterTitle,
        chapterNumber,
        mangaTitle,
        mangaId,
        pageCount: pages.length
      };

      if (onPullChapter) {
        onPullChapter(pages, info, target);
      }
    } catch (err: any) {
      alert(`تنبيه: ${err.message || "فشل فتح صفحات الفصل"}`);
    } finally {
      setIsPullingTarget(null);
    }
  };

  const handleResolveManual = async () => {
    const q = manualInputVal.trim();
    if (!q) return;
    setIsResolvingManual(true);
    setManualError(null);
    try {
      const res = await fetch(`/api/suwayomi/resolve-work?input=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "تعذر العثور على العمل أو الفصل.");
      }
      if (data.type === "chapter") {
        await handleExecutePullChapter(
          data.chapter.id,
          data.chapter.title,
          data.chapter.chapterNumber,
          data.chapter.mangaTitle,
          data.chapter.mangaId,
          "reader",
          data.pages
        );
      } else if (data.type === "manga") {
        handleOpenManga(data.manga);
      } else if (data.type === "search" && data.results?.length > 0) {
        setWorks(data.results);
        setHubMode("works");
      }
    } catch (e: any) {
      setManualError(e.message || "حدث خطأ أثناء الفحص");
    } finally {
      setIsResolvingManual(false);
    }
  };

  const currentTabConfig = TABS.find((t) => t.id === activeTab) || TABS[0];
  // Use locally proxied suwayomi-embed so clicks are automatically intercepted!
  const proxiedEmbedUrl = `/suwayomi-embed${currentTabConfig.path}`;

  const handleSelectTab = (tab: SuwayomiTab) => {
    if (tab !== activeTab) {
      setActiveTab(tab);
      setIsLoading(true);
      setIframeKey((k) => k + 1);
    }
  };

  const handleRefresh = () => {
    setIsLoading(true);
    setIframeKey((k) => k + 1);
    fetchWorks(searchQuery);
    fetchRecentChapters();
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div
      id="suwayomi-hub-container"
      className={`flex flex-col transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-50 bg-slate-950 p-2 sm:p-4"
          : "w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-3"
      }`}
      dir="rtl"
    >
      {/* Floating Auto-Intercept Toast */}
      {autoInterceptToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl border border-teal-500 bg-slate-900/95 px-5 py-3 shadow-2xl shadow-teal-500/30 backdrop-blur-md animate-bounce">
          <Zap className="h-5 w-5 text-teal-400 animate-pulse" />
          <div>
            <p className="text-xs font-bold text-white">تم رصد نقرك على الفصل مباشرة!</p>
            <p className="text-[11px] text-teal-300">جاري نقلك فوراً إلى القارئ الذكي...</p>
          </div>
          <button
            type="button"
            onClick={() => setAutoInterceptToast(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Mode Switcher: Sources Directory vs Works Library vs Live Suwayomi Web */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal-500/30 bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-950 p-3 sm:p-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-slate-950 shadow-lg shadow-teal-500/20 font-bold">
            <Zap className="h-6 w-6 text-slate-950" />
          </div>
          <div>
            <h2 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
              <span>مركز المصادر والمانجا (Suwayomi Engine)</span>
              <span className="rounded-md bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold text-teal-300 border border-teal-500/40">
                {sources.length > 0 ? `${sources.length} مصدر متاح` : "2,211 مصدر"}
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              تصفح أي مصدر عالمي أو عربي، أو افتح الموقع المباشر مع ميزة التحويل التلقائي للقارئ الذكي
            </p>
          </div>
        </div>

        {/* View Switcher Buttons */}
        <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-1 flex-wrap">
          <button
            type="button"
            onClick={() => setHubMode("sources")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
              hubMode === "sources"
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>دليل المصادر ({sources.length > 0 ? sources.length : "2,200+"})</span>
          </button>

          <button
            type="button"
            onClick={() => setHubMode("federated-search")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
              hubMode === "federated-search"
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            <span>البحث الشامل في كل المصادر</span>
          </button>

          <button
            type="button"
            onClick={() => setHubMode("works")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
              hubMode === "works"
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>الأعمال المحفوظة والمكتبة</span>
          </button>

          <button
            type="button"
            onClick={() => setHubMode("web-embed")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
              hubMode === "web-embed"
                ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>موقع Suwayomi المباشر</span>
          </button>

          <button
            type="button"
            onClick={onOpenStudio}
            className="flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition cursor-pointer text-slate-300 hover:text-emerald-300 hover:bg-emerald-950/40 border border-transparent hover:border-emerald-500/30"
            title="فتح قسم رفع ملفات المانغا (ZIP, PDF, صور)"
          >
            <UploadCloud className="h-3.5 w-3.5 text-emerald-400" />
            <span>قسم رفع الملفات</span>
          </button>
        </div>
      </div>

      {/* ================= MODE 1: SOURCES DIRECTORY (2,200+ SOURCES) ================= */}
      {hubMode === "sources" && (
        <div className="flex flex-col gap-4">
          {!selectedSource ? (
            /* Sources List View */
            <div className="flex flex-col gap-4">
              {/* 1. Global Cross-Source Manga Search Bar (Requirement 1) */}
              <div className="rounded-2xl border border-teal-500/40 bg-gradient-to-r from-teal-950/40 via-slate-900 to-indigo-950/40 p-4 shadow-xl">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/30">
                      <Search className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-display text-xs sm:text-sm font-bold text-white">
                        البحث الشامل عن عمل في كافة المصادر المتاحة
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        اكتب اسم أي مانجا أو مانهوا وسيقوم النظام بفحص جميع المصادر المتصلة دفعة واحدة وعرض نتائجها
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={globalWorkSearchQuery}
                      onChange={(e) => setGlobalWorkSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearchGlobalWorks()}
                      placeholder="ابحث عن اسم مانجا أو مانهوا في كل المصادر (مثال: Solo Leveling, ون بيس, Berserk, Return of Mount Hua)..."
                      className="w-full rounded-xl border border-teal-500/30 bg-slate-950 px-4 py-2.5 pl-10 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    />
                    {globalWorkSearchQuery ? (
                      <button
                        type="button"
                        onClick={() => {
                          setGlobalWorkSearchQuery("");
                          setGlobalSearchResults([]);
                          setHasSearchedGlobal(false);
                        }}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : (
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSearchGlobalWorks()}
                    disabled={isSearchingGlobal || !globalWorkSearchQuery.trim()}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold px-4 py-2.5 text-xs transition cursor-pointer disabled:opacity-50 shadow-md shadow-teal-500/20 shrink-0"
                  >
                    {isSearchingGlobal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    <span>بحث في كل المصادر</span>
                  </button>
                </div>
              </div>

              {/* Cross-source Results View if active */}
              {hasSearchedGlobal && (
                <div className="rounded-2xl border border-teal-500/30 bg-slate-900/90 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2.5 w-2.5 rounded-full bg-teal-400 animate-ping" />
                      <h4 className="font-display text-sm font-bold text-white">
                        نتائج البحث الشامل عن: &quot;{globalWorkSearchQuery}&quot;
                      </h4>
                      <span className="rounded-md bg-teal-500/20 px-2 py-0.5 text-xs font-mono text-teal-300">
                        {globalSearchResults.length} نتيجة
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setHasSearchedGlobal(false);
                        setGlobalWorkSearchQuery("");
                        setGlobalSearchResults([]);
                      }}
                      className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                    >
                      إغلاق النتائج والعودة لدليل المصادر
                    </button>
                  </div>

                  {isSearchingGlobal ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <Loader2 className="h-8 w-8 animate-spin text-teal-400 mb-2" />
                      <p className="text-xs font-semibold text-white">جاري فحص جميع المصادر والبحث عن &quot;{globalWorkSearchQuery}&quot;...</p>
                    </div>
                  ) : globalSearchResults.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-8 text-center text-slate-400">
                      <AlertCircle className="mx-auto h-7 w-7 text-amber-400 mb-2" />
                      <p className="text-xs font-bold text-white">لم يتم العثور على أعمال مطابقة في المصادر</p>
                      <p className="text-[11px] text-slate-500 mt-1">جرب البحث بكلمة باللغة الإنجليزية أو اسم بديل للعمل</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                      {globalSearchResults.map((m) => {
                        const isFav = isFavorite(m.id, m.title, m.sourceId);
                        return (
                          <div
                            key={m.id || `${m.sourceId}-${m.title}`}
                            onClick={() => handleOpenManga(m)}
                            className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-md transition-all duration-200 hover:-translate-y-1 hover:border-teal-500/50 hover:shadow-xl cursor-pointer"
                          >
                            {/* Favorite Heart Button (Requirement 2) */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite({
                                  id: m.id,
                                  sourceId: m.sourceId,
                                  sourceName: m.sourceName,
                                  title: m.title,
                                  coverUrl: m.coverUrl,
                                  author: m.author,
                                  status: m.status,
                                  description: m.description,
                                });
                                setFavoritesUpdatedKey((k) => k + 1);
                              }}
                              title={isFav ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
                              className={`absolute top-2 left-2 z-20 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition shadow-md cursor-pointer ${
                                isFav
                                  ? "bg-rose-600 text-white shadow-rose-600/50 scale-105"
                                  : "bg-slate-950/70 text-slate-300 hover:text-rose-400 hover:bg-slate-900 border border-slate-750"
                              }`}
                            >
                              <Heart className={`h-3.5 w-3.5 ${isFav ? "fill-white text-white" : ""}`} />
                            </button>

                            <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                              <img
                                src={m.coverUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600"}
                                alt={m.title}
                                loading="lazy"
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src =
                                    "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600";
                                }}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-85" />
                              <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-0.5">
                                {m.sourceName && (
                                  <span className="inline-block self-start rounded bg-teal-500/20 px-1.5 py-0.5 text-[9px] font-bold text-teal-300 border border-teal-500/30">
                                    {m.sourceName}
                                  </span>
                                )}
                                <h4 className="font-display text-xs font-bold text-white line-clamp-2 leading-tight">
                                  {m.title}
                                </h4>
                              </div>
                            </div>

                            <div className="p-2 bg-slate-950/80 border-t border-slate-800">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenManga(m);
                                }}
                                className="w-full flex items-center justify-center gap-1 rounded-xl bg-teal-500/15 hover:bg-teal-500 text-teal-300 hover:text-slate-950 py-1.5 px-2 text-[11px] font-bold transition duration-200 border border-teal-500/30 cursor-pointer shadow-xs"
                              >
                                <BookOpen className="h-3 w-3" />
                                <span>عرض جميع الفصول</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Search & Language Filters */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 sm:p-4">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={sourceSearchQuery}
                    onChange={(e) => setSourceSearchQuery(e.target.value)}
                    placeholder="ابحث في أكثر من 2,200 مصدر (مثل MangaDex, 3asq, Asura, العاشق)..."
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 pl-10 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                </div>

                {/* Language Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none shrink-0">
                  {[
                    { id: "all", label: "كل اللغات" },
                    { id: "ar", label: "العربية (AR)" },
                    { id: "en", label: "الإنجليزية (EN)" },
                    { id: "ja", label: "اليابانية (JA)" },
                    { id: "ko", label: "الكورية (KO)" },
                    { id: "zh", label: "الصينية (ZH)" },
                    { id: "fr", label: "الفرنسية (FR)" },
                    { id: "es", label: "الإسبانية (ES)" }
                  ].map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLangFilter(l.id)}
                      className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                        langFilter === l.id
                          ? "bg-teal-500 text-slate-950 shadow-sm shadow-teal-500/30"
                          : "bg-slate-800/80 text-slate-300 hover:bg-slate-750 hover:text-white"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={fetchSources}
                    title="تحديث المصادر"
                    className="rounded-xl border border-slate-750 bg-slate-800 p-2 text-slate-300 hover:text-white transition cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingSources ? "animate-spin text-teal-400" : ""}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddCustomSourceModal(true)}
                    className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 px-3 py-1.5 text-xs font-bold transition cursor-pointer shadow-sm"
                    title="إضافة مصدر غير رسمي أو غير مدرج تلقائياً"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>إضافة مصدر يدوي</span>
                  </button>
                </div>
              </div>

              {/* Status Header */}
              <div className="flex items-center justify-between px-2 text-xs text-slate-400">
                <span>
                  عرض {filteredSources.length} من أصل {sources.length} مصدر مثبت ومفعل على خادم Suwayomi
                </span>
                <button
                  type="button"
                  onClick={() => setHubMode("web-embed")}
                  className="flex items-center gap-1 text-teal-400 hover:text-teal-300 transition cursor-pointer font-semibold"
                >
                  <Globe className="h-3 w-3" />
                  <span>تصفح واجهة Suwayomi المباشرة</span>
                </button>
              </div>

              {/* Sources Grid */}
              {isLoadingSources ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Loader2 className="h-8 w-8 animate-spin text-teal-400 mb-2" />
                  <p className="text-sm font-semibold text-white">جاري تحميل دليل المصادر من الخادم...</p>
                </div>
              ) : filteredSources.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center text-slate-400">
                  <AlertCircle className="mx-auto h-8 w-8 text-amber-400 mb-2" />
                  <p className="text-sm font-bold text-white">لم يتم العثور على مصادر تطابق هذا البحث</p>
                  <p className="text-xs text-slate-500 mt-1">جرب تغيير فلتر اللغة أو مسح نص البحث</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredSources.slice(0, visibleSourcesCount).map((s) => (
                    <div
                      key={s.id}
                      onClick={() => loadSourceCatalog(s)}
                      className="group relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-4 transition-all duration-200 hover:border-teal-500/50 hover:bg-slate-850 hover:shadow-lg hover:shadow-teal-500/10 cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 border border-slate-700 text-teal-400 group-hover:scale-105 transition-transform overflow-hidden">
                          {s.iconUrl ? (
                            <img
                              src={s.iconUrl}
                              alt={s.name}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <Globe className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-display text-xs sm:text-sm font-bold text-white truncate group-hover:text-teal-300 transition-colors">
                            {s.displayName || s.name}
                          </h4>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300 uppercase">
                              {s.language || s.lang || "all"}
                            </span>
                            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              متصل
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px]">
                        <span className="text-teal-400 font-bold group-hover:underline flex items-center gap-1">
                          <span>تصفح المانجا</span>
                          <ArrowRight className="h-3 w-3 rotate-180" />
                        </span>
                        {s.baseUrl && (
                          <a
                            href={s.baseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="زيارة الموقع الأصلي للمصدر"
                            className="text-slate-500 hover:text-slate-300 p-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Progressive loading for all sources (Requirement 3) */}
              {!isLoadingSources && filteredSources.length > visibleSourcesCount && (
                <div className="flex flex-col items-center justify-center py-4 gap-2">
                  <div ref={sourcesDirectorySentinelRef} className="h-4 w-full" />
                  <button
                    type="button"
                    onClick={() => setVisibleSourcesCount((prev) => Math.min(prev + 80, filteredSources.length))}
                    className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-teal-300 border border-teal-500/30 px-6 py-2.5 text-xs font-bold transition shadow-sm cursor-pointer"
                  >
                    <ChevronDown className="h-4 w-4" />
                    <span>عرض المزيد من المصادر ({filteredSources.length - visibleSourcesCount} متبقية)</span>
                  </button>
                  <p className="text-[11px] text-slate-500">يتم تحميل المصادر تلقائياً أيضاً عند التمرير لأسفل الصفحة</p>
                </div>
              )}
            </div>
          ) : (
            /* Selected Source Manga Catalog View */
            <div className="flex flex-col gap-4">
              {/* Back breadcrumb & Source Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-teal-500/30 bg-slate-900/90 p-4 shadow-lg">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedSource(null)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-750 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    <span>العودة لكافة المصادر</span>
                  </button>
                  <div>
                    <h3 className="font-display text-sm sm:text-base font-bold text-white flex items-center gap-2">
                      <span>{selectedSource.displayName || selectedSource.name}</span>
                      <span className="rounded-md bg-teal-500/20 px-2 py-0.5 text-[10px] font-mono text-teal-300 border border-teal-500/40 uppercase">
                        {selectedSource.language || "all"}
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      تصفح الأعمال والفصول المتوفرة في هذا المصدر مباشرة
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedSource.baseUrl && (
                    <a
                      href={selectedSource.baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-xl border border-slate-750 bg-slate-800/80 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                      <span>الموقع الأصلي</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => loadSourceCatalog(selectedSource, sourceCatalogSearch)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-750 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:text-white transition cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingSourceCatalog ? "animate-spin text-teal-400" : ""}`} />
                    <span>تحديث</span>
                  </button>
                </div>
              </div>

              {/* Source Internal Search Bar */}
              <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={sourceCatalogSearch}
                    onChange={(e) => setSourceCatalogSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadSourceCatalog(selectedSource, sourceCatalogSearch)}
                    placeholder={`ابحث عن عمل مانجا داخل ${selectedSource.name}...`}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 pl-10 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
                  />
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                </div>
                <button
                  type="button"
                  onClick={() => loadSourceCatalog(selectedSource, sourceCatalogSearch)}
                  disabled={isLoadingSourceCatalog}
                  className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-teal-400 transition cursor-pointer disabled:opacity-50"
                >
                  {isLoadingSourceCatalog ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span>بحث</span>
                </button>
              </div>

              {/* Manga Grid for Selected Source */}
              {isLoadingSourceCatalog ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <Loader2 className="h-8 w-8 animate-spin text-teal-400 mb-2" />
                  <p className="text-sm font-semibold text-white">جاري سحب الأعمال من المصدر...</p>
                </div>
              ) : sourceMangas.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center text-slate-400">
                  <AlertCircle className="mx-auto h-8 w-8 text-amber-400 mb-2" />
                  <p className="text-sm font-bold text-white">لم يتم العثور على أعمال في هذا المصدر</p>
                  <p className="text-xs text-slate-500 mt-1">جرب كتابة اسم مانجا في خانة البحث أعلاه أو اختيار مصدر آخر</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                    {sourceMangas.map((m) => {
                      const isFav = isFavorite(m.id, m.title, m.sourceId);
                      return (
                        <div
                          key={m.id}
                          onClick={() => handleOpenManga(m)}
                          className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-md transition-all duration-200 hover:-translate-y-1 hover:border-teal-500/50 hover:shadow-xl hover:shadow-teal-500/10 cursor-pointer"
                        >
                          {/* Heart Favorite Button (Requirement 2) */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite({
                                id: m.id,
                                sourceId: m.sourceId || selectedSource?.id,
                                sourceName: selectedSource?.displayName || selectedSource?.name,
                                title: m.title,
                                coverUrl: m.coverUrl,
                                author: m.author,
                                status: m.status,
                                description: m.description,
                              });
                              setFavoritesUpdatedKey((k) => k + 1);
                            }}
                            title={isFav ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
                            className={`absolute top-2 left-2 z-20 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition-all duration-200 cursor-pointer shadow-md ${
                              isFav
                                ? "bg-rose-600 text-white shadow-rose-600/50 scale-105"
                                : "bg-slate-950/70 text-slate-300 hover:text-rose-400 hover:bg-slate-900 border border-slate-750"
                            }`}
                          >
                            <Heart className={`h-3.5 w-3.5 ${isFav ? "fill-white text-white" : ""}`} />
                          </button>

                          <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                            <img
                              src={m.coverUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600"}
                              alt={m.title}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src =
                                  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600";
                              }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />
                            <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-0.5">
                              <h4 className="font-display text-xs font-bold text-white line-clamp-2 leading-tight drop-shadow-sm group-hover:text-teal-300 transition-colors">
                                {m.title}
                              </h4>
                              <span className="text-[10px] text-slate-300 line-clamp-1">
                                {m.author || "مؤلف غير محدد"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-center p-2.5 bg-slate-950/80 border-t border-slate-800">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenManga(m);
                              }}
                              className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-teal-500/15 hover:bg-teal-500 text-teal-300 hover:text-slate-950 py-1.5 px-3 text-xs font-bold transition duration-200 border border-teal-500/30 cursor-pointer shadow-xs"
                            >
                              <BookOpen className="h-3.5 w-3.5" />
                              <span>عرض جميع الفصول</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Infinite scroll sentinel and controls (Requirement 5) */}
                  <div ref={sourceCatalogSentinelRef} className="h-4 w-full" />
                  {isLoadingMoreSource && (
                    <div className="flex items-center justify-center py-6 text-slate-400 gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-teal-400" />
                      <span className="text-xs font-semibold text-white">جاري تحميل المزيد من أعمال المصدر تلقائياً...</span>
                    </div>
                  )}
                  {sourceHasNextPage && !isLoadingMoreSource && sourceMangas.length > 0 && (
                    <div className="flex justify-center py-3">
                      <button
                        type="button"
                        onClick={loadMoreSourceMangas}
                        className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-teal-300 border border-teal-500/30 px-6 py-2.5 text-xs font-bold transition shadow-sm cursor-pointer"
                      >
                        <ChevronDown className="h-4 w-4" />
                        <span>تحميل المزيد من الأعمال</span>
                      </button>
                    </div>
                  )}
                  {!sourceHasNextPage && sourceMangas.length > 0 && (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 py-3 text-center text-xs font-semibold text-slate-400">
                      ✅ تم استعراض جميع الأعمال المتاحة في هذا المصدر ({sourceMangas.length} عمل)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================= MODE: FEDERATED CROSS-SOURCE SEARCH ================= */}
      {hubMode === "federated-search" && (
        <FederatedSearch
          initialQuery={globalWorkSearchQuery}
          onOpenManga={handleOpenManga}
          isFavorite={isFavorite}
          toggleFavorite={(m) => {
            toggleFavorite(m);
            setFavoritesUpdatedKey((k) => k + 1);
          }}
          onBackToSources={() => setHubMode("sources")}
        />
      )}

      {/* ================= MODE 2: WORKS & LIBRARY BROWSER ================= */}
      {hubMode === "works" && (
        <div className="flex flex-col gap-4">
          
          {/* Quick Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
            <div className="relative flex-1 w-full">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  fetchWorks(e.target.value);
                }}
                placeholder="ابحث عن أي عمل أو مانجا أو مانهوا في خادمك (مثال: Magic Emperor)..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 pl-10 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <button
                type="button"
                onClick={() => fetchWorks(searchQuery)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-slate-750 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:text-white transition cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingWorks ? "animate-spin text-teal-400" : ""}`} />
                <span>تحديث الأعمال</span>
              </button>

              <button
                type="button"
                onClick={() => setHubMode("web-embed")}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-950/60 px-3.5 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-900/60 transition cursor-pointer"
              >
                <Globe className="h-3.5 w-3.5" />
                <span>فتح مصادر Suwayomi</span>
              </button>
            </div>
          </div>

          {/* Quick Recent Chapters Bar (Instant Read 1-Click) */}
          {recentChapters.length > 0 && (
            <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/70 p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-indigo-400" />
                  <h3 className="font-display text-xs sm:text-sm font-bold text-white">
                    أحدث الفصول المقروءة على الخادم (اضغط للقراءة الفورية)
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  {recentChapters.length} فصل جاهز
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {recentChapters.slice(0, 6).map((ch) => (
                  <div
                    key={ch.id}
                    onClick={() =>
                      handleExecutePullChapter(
                        ch.id,
                        ch.name,
                        ch.chapterNumber,
                        ch.mangaTitle,
                        ch.mangaId,
                        "reader"
                      )
                    }
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 hover:border-teal-500/40 hover:bg-slate-900 transition cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {ch.coverUrl && ch.coverUrl.trim() ? (
                        <img
                          src={ch.coverUrl.trim()}
                          alt={ch.mangaTitle}
                          className="h-12 w-9 rounded-lg object-cover border border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="h-12 w-9 rounded-lg bg-slate-800 flex items-center justify-center text-teal-400 shrink-0">
                          <BookOpen className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-white truncate group-hover:text-teal-300 transition">
                          {ch.mangaTitle}
                        </p>
                        <p className="text-[11px] text-teal-400 truncate">
                          {ch.name}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 pr-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300 group-hover:bg-teal-500 group-hover:text-slate-950 transition shadow-inner">
                        {isPullingTarget === `${ch.id}-reader` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Works Grid */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-white flex items-center gap-2">
                <BookMarked className="h-4 w-4 text-teal-400" />
                <span>أعمال المانجا والمانهوا المتاحة (اضغط على أي عمل لعرض فصوله)</span>
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {works.length} عمل
              </span>
            </div>

            {isLoadingWorks ? (
              <div className="flex flex-col items-center justify-center py-16 rounded-2xl border border-slate-800 bg-slate-900/40">
                <Loader2 className="h-8 w-8 animate-spin text-teal-400 mb-2" />
                <p className="text-xs text-slate-400">جاري تحميل قائمة الأعمال المباشرة...</p>
              </div>
            ) : works.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 text-center p-4">
                <BookOpen className="h-10 w-10 text-slate-600 mb-2" />
                <p className="text-xs text-slate-400 font-medium">
                  لم يتم العثور على أعمال مطابقة في الخادم.
                </p>
                <button
                  type="button"
                  onClick={() => setHubMode("web-embed")}
                  className="mt-3 flex items-center gap-1.5 rounded-xl bg-teal-500/20 text-teal-300 border border-teal-500/30 px-4 py-2 text-xs font-bold hover:bg-teal-500/30 transition cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span>تصفح المصادر في موقع Suwayomi لإضافة أعمال</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {works.map((manga) => (
                  <div
                    key={manga.id}
                    onClick={() => handleOpenManga(manga)}
                    className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 hover:border-teal-500/50 hover:shadow-xl hover:shadow-teal-500/10 transition duration-200 cursor-pointer"
                  >
                    <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                      {manga.coverUrl && manga.coverUrl.trim() ? (
                        <img
                          src={manga.coverUrl.trim()}
                          alt={manga.title}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-teal-500/40">
                          <BookOpen className="h-10 w-10" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
                      
                      {manga.chaptersCount > 0 && (
                        <span className="absolute top-2 right-2 rounded-md bg-slate-950/80 px-2 py-0.5 text-[10px] font-mono font-bold text-teal-300 border border-slate-700 backdrop-blur-xs">
                          {manga.chaptersCount} فصل
                        </span>
                      )}
                    </div>

                    <div className="p-3">
                      <h4 className="font-display text-xs font-bold text-white line-clamp-2 group-hover:text-teal-300 transition">
                        {manga.title}
                      </h4>
                      <p className="mt-1 text-[10px] text-slate-400 line-clamp-1">
                        {manga.author || manga.artist || "اضغط لاختيار الفصل والقراءة"}
                      </p>
                    </div>

                    <div className="flex items-center justify-center p-2 bg-slate-950/80 border-t border-slate-850">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenManga(manga);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-teal-500/15 hover:bg-teal-500 text-teal-300 hover:text-slate-950 py-1 text-[11px] font-bold transition border border-teal-500/30 cursor-pointer"
                      >
                        <BookOpen className="h-3 w-3" />
                        <span>عرض جميع الفصول</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ================= MODE 2: INTERACTIVE EMBEDDED SUWAYOMI WEB WITH AUTO INTERCEPT ================= */}
      {hubMode === "web-embed" && (
        <div className="flex flex-col gap-3">
          
          {/* Active Auto-Interceptor Notification Banner */}
          <div className="flex items-center justify-between rounded-2xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-300 shadow-lg">
            <div className="flex items-center gap-2.5">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <p className="font-medium">
                <span className="font-bold">ميزة التحويل التلقائي المباشر مفعلة:</span> ادخل إلى أي عمل أو انقر على أي فصل داخل الموقع أدناه، وسيتم نقلك مباشرة إلى قارئ التطبيق الفوري دون أي حاجة لمعرّف ID أو نسخ روابط!
              </p>
            </div>

            <button
              type="button"
              onClick={() => setHubMode("sources")}
              className="hidden sm:flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition cursor-pointer"
            >
              <span>العودة لدليل المصادر</span>
            </button>
          </div>

          {/* Controls Bar & Tab navigation */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-800 bg-slate-900/90 p-3 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500/20 text-teal-400 border border-teal-500/30">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-bold text-white">
                    {currentTabConfig.label}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {currentTabConfig.desc}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={proxiedEmbedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-xl border border-teal-500/40 bg-teal-500/10 px-3 py-1.5 text-xs font-bold text-teal-300 hover:bg-teal-500/20 transition cursor-pointer"
                  title="فتح موقع Suwayomi في نافذة تبويب جديدة بالمتصفح"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>فتح في نافذة كاملة</span>
                </a>

                <button
                  type="button"
                  onClick={handleRefresh}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-750 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-teal-400" : ""}`} />
                  <span>تحديث</span>
                </button>

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-750 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition cursor-pointer"
                >
                  {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  <span>{isFullscreen ? "تصغير" : "ملء الشاشة"}</span>
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 scrollbar-none border-t border-slate-800/80">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isCurrent = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleSelectTab(tab.id)}
                    className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                      isCurrent
                        ? "bg-gradient-to-r from-teal-500/20 to-indigo-500/20 text-teal-300 border border-teal-500/40 shadow-sm"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isCurrent ? "text-teal-400" : "text-slate-500"}`} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Embedded Web Frame with Auto-Interceptor Injected */}
          <div
            className={`relative w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl ${
              isFullscreen ? "flex-1 h-[calc(100vh-140px)]" : "h-[70vh] sm:h-[78vh]"
            }`}
          >
            {isLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-xs">
                <RefreshCw className="h-8 w-8 animate-spin text-teal-400 mb-2" />
                <p className="font-display text-sm font-semibold text-white">
                  جاري تحميل {currentTabConfig.label}...
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  يمكنك النقر على أي فصل مباشرة ليتم فتحه في القارئ الفوري
                </p>
              </div>
            )}

            <iframe
              ref={iframeRef}
              key={iframeKey}
              id="suwayomi-proxied-frame"
              title={`Suwayomi Proxied - ${currentTabConfig.label}`}
              src={proxiedEmbedUrl}
              className="h-full w-full border-0 bg-slate-950"
              allow="fullscreen; clipboard-read; clipboard-write; autoplay"
              onLoad={() => setIsLoading(false)}
              onError={() => setIsLoading(false)}
            />
          </div>

        </div>
      )}

      {/* ================= OPTIONAL COLLAPSED MANUAL PULL FOR POWER USERS ================= */}
      <div className="mt-4 border-t border-slate-850 pt-3">
        <button
          type="button"
          onClick={() => setShowManualInput(!showManualInput)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition cursor-pointer"
        >
          <SlidersHorizontal className="h-3 w-3 text-slate-400" />
          <span>خيارات متقدمة: إدخال رابط أو معرّف يدوي (اختياري)</span>
          {showManualInput ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {showManualInput && (
          <div className="mt-2 flex flex-col sm:flex-row items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <input
              type="text"
              value={manualInputVal}
              onChange={(e) => setManualInputVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleResolveManual()}
              placeholder="ضع رابط أو ID العمل أو الفصل إذا رغبت بالسحب اليدوي..."
              className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleResolveManual}
              disabled={isResolvingManual}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/30 px-4 py-2 text-xs font-bold hover:bg-teal-500/30 transition shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isResolvingManual ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              <span>سحب يدوي</span>
            </button>
            {manualError && <span className="text-xs text-rose-400">{manualError}</span>}
          </div>
        )}
      </div>

      {/* Universal Modal for Selected Manga Chapters (Works in Sources, Works, Embed, and History) */}
      {selectedMangaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-5 backdrop-blur-md animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedMangaModal(null);
          }}
        >
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-teal-500/40 bg-slate-900 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-800 p-4 sm:p-5 bg-slate-950/80">
              <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                {selectedMangaModal.coverUrl && selectedMangaModal.coverUrl.trim() ? (
                  <img
                    src={selectedMangaModal.coverUrl.trim()}
                    alt={selectedMangaModal.title}
                    className="h-20 w-14 rounded-xl object-cover border border-slate-700 shadow-md shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600";
                    }}
                  />
                ) : (
                  <div className="h-20 w-14 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-teal-400 shrink-0">
                    <BookOpen className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="rounded-full bg-teal-500/20 px-2.5 py-0.5 text-[10px] font-bold text-teal-300 border border-teal-500/30">
                      قائمة الفصول المباشرة
                    </span>
                    {selectedMangaModal.sourceName && (
                      <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-medium text-slate-300 border border-slate-700">
                        المصدر: {selectedMangaModal.sourceName}
                      </span>
                    )}
                    {!isLoadingChapters && mangaChapters.length > 0 && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-mono text-emerald-400 border border-emerald-500/30">
                        {mangaChapters.length} فصلاً
                      </span>
                    )}
                  </div>
                  <h3 className="font-display text-base sm:text-lg font-bold text-white leading-snug line-clamp-2">
                    {selectedMangaModal.title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                    اختر أي فصل لبدء القراءة فوراً في القارئ أو التحرير والترجمة
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-2">
                {/* Modal Favorite Button */}
                {(() => {
                  const isMangaFav = isFavorite(selectedMangaModal.id, selectedMangaModal.title, selectedMangaModal.sourceId);
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        toggleFavorite({
                          id: selectedMangaModal.id,
                          sourceId: selectedMangaModal.sourceId,
                          sourceName: selectedMangaModal.sourceName,
                          title: selectedMangaModal.title,
                          coverUrl: selectedMangaModal.coverUrl,
                          author: selectedMangaModal.author,
                          status: selectedMangaModal.status,
                          description: selectedMangaModal.description,
                        });
                        setFavoritesUpdatedKey((k) => k + 1);
                      }}
                      title={isMangaFav ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
                      className={`rounded-xl border p-2 transition cursor-pointer ${
                        isMangaFav
                          ? "border-rose-500 bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                          : "border-slate-800 bg-slate-800/80 text-slate-400 hover:text-rose-400 hover:bg-slate-700"
                      }`}
                    >
                      <Heart className={`h-5 w-5 ${isMangaFav ? "fill-rose-400 text-rose-400" : ""}`} />
                    </button>
                  );
                })()}

                <button
                  type="button"
                  onClick={() => setSelectedMangaModal(null)}
                  className="rounded-xl border border-slate-800 bg-slate-800/80 p-2 text-slate-400 hover:text-white hover:bg-slate-700 transition cursor-pointer"
                  title="إغلاق النافذة"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Live In-Source Inspection & Multi-Source Status Banner */}
            <div className="border-b border-slate-800 bg-slate-950/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="flex items-center gap-1 font-bold text-teal-300">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>فحص مباشر من المصدر:</span>
                </span>
                {mangaSourcesChecked.length > 0 ? (
                  mangaSourcesChecked.map((sc, idx) => (
                    <span 
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 border border-slate-750 px-2.5 py-1 text-[11px] text-slate-300 font-medium shadow-xs"
                    >
                      <strong className="text-white">{sc.sourceName || sc.sourceId}</strong>
                      <span className="text-emerald-400 font-bold">({sc.chaptersFound} فصل فعلي)</span>
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 text-xs">
                    المصدر: {selectedMangaModal.sourceName}
                  </span>
                )}
              </div>

              {/* Multi-Source Deep Aggregation Button */}
              <button
                type="button"
                disabled={isLoadingChapters || isAggregatingAllSources}
                onClick={() => handleOpenManga(selectedMangaModal, true, true)}
                className="flex items-center gap-1.5 rounded-xl border border-teal-500/40 bg-teal-500/15 hover:bg-teal-500 text-teal-300 hover:text-slate-950 px-3 py-1.5 text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-50"
                title="فحص فصول هذا العمل في جميع المصادر ودمجها بدون تكرار"
              >
                {isAggregatingAllSources ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>جاري فحص جميع المصادر...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>فحص وتجميع الفصول من جميع المصادر</span>
                  </>
                )}
              </button>
            </div>

            {/* Filter and Controls Toolbar (when chapters are loaded) */}
            {!isLoadingChapters && mangaChapters.length > 0 && (
              <div className="flex items-center gap-2 border-b border-slate-800/80 bg-slate-950/40 p-3">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={chapterFilterQuery}
                    onChange={(e) => setChapterFilterQuery(e.target.value)}
                    placeholder="ابحث برقم الفصل أو اسمه (مثال: 10 أو 1)..."
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/90 pr-9 pl-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
                  />
                  {chapterFilterQuery && (
                    <button
                      type="button"
                      onClick={() => setChapterFilterQuery("")}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setChapterSortAsc(!chapterSortAsc)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-teal-300 hover:border-teal-500/40 transition shrink-0 cursor-pointer"
                  title="تغيير الترتيب"
                >
                  <ArrowUpDown className="h-3 w-3 text-teal-400" />
                  <span>{chapterSortAsc ? "الأقدم أولاً" : "الأحدث أولاً"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenManga(selectedMangaModal)}
                  className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:text-teal-300 hover:border-teal-500/40 transition shrink-0 cursor-pointer"
                  title="تحديث قائمة الفصول"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Chapter list content */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 scrollbar-thin max-h-[55vh]">
              {isLoadingChapters ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <Loader2 className="h-9 w-9 animate-spin text-teal-400 mb-3" />
                  <p className="text-sm font-bold text-white">جاري جلب قائمة الفصول من المصدر...</p>
                  <p className="text-xs text-slate-400 mt-1">يتم التواصل المباشر مع محرك المصادر لجلب أحدث الفصول</p>
                </div>
              ) : mangaChaptersError ? (
                <div className="flex flex-col items-center justify-center p-8 bg-red-950/30 border border-red-500/30 rounded-2xl text-center my-4">
                  <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
                  <p className="text-sm font-bold text-red-200">{mangaChaptersError}</p>
                  <p className="text-xs text-slate-400 mt-1">قد يكون المصدر يواجه حماية أو بطئاً في الاستجابة حالياً</p>
                  <button
                    type="button"
                    onClick={() => handleOpenManga(selectedMangaModal)}
                    className="mt-3.5 flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-bold transition cursor-pointer shadow-md"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>إعادة المحاولة الآن</span>
                  </button>
                </div>
              ) : (
                (Array.isArray(mangaChapters) ? mangaChapters : [])
                  .filter((ch) => {
                    if (!chapterFilterQuery.trim()) return true;
                    const q = chapterFilterQuery.toLowerCase().trim();
                    const titleMatch = (ch.title || "").toLowerCase().includes(q);
                    const numMatch = String(ch.chapterNumber || "").includes(q);
                    return titleMatch || numMatch;
                  })
                  .sort((a, b) => {
                    const numA = parseFloat(a.chapterNumber) || 0;
                    const numB = parseFloat(b.chapterNumber) || 0;
                    return chapterSortAsc ? numA - numB : numB - numA;
                  })
                  .length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-4 text-center bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 my-2">
                    <BookOpen className="h-9 w-9 text-slate-600 mb-2.5" />
                    <p className="text-xs text-slate-300 font-medium">
                      {chapterFilterQuery
                        ? "لا توجد فصول تطابق بحثك الحالي."
                        : "لم تظهر فصول مسجلة بعد في الذاكرة المؤقتة لهذا العمل."}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-sm">
                      {chapterFilterQuery
                        ? "جرب إزالة كلمات البحث لعرض كافة الفصول المتوفرة."
                        : "يمكنك سحب وتحديث قائمة الفصول الحية مباشرة من المصدر عبر الزر أدناه:"}
                    </p>
                    {chapterFilterQuery ? (
                      <button
                        type="button"
                        onClick={() => setChapterFilterQuery("")}
                        className="mt-3 text-xs text-teal-400 hover:text-teal-300 underline cursor-pointer"
                      >
                        مسح فلتر البحث
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenManga(selectedMangaModal, true)}
                        className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-black shadow-lg transition-all cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>مزامنة الفصول الحية من المصدر الآن (Live Sync)</span>
                      </button>
                    )}
                  </div>
                ) : (
                  (Array.isArray(mangaChapters) ? mangaChapters : [])
                    .filter((ch) => {
                      if (!chapterFilterQuery.trim()) return true;
                      const q = chapterFilterQuery.toLowerCase().trim();
                      const titleMatch = (ch.title || "").toLowerCase().includes(q);
                      const numMatch = String(ch.chapterNumber || "").includes(q);
                      return titleMatch || numMatch;
                    })
                    .sort((a, b) => {
                      const numA = parseFloat(a.chapterNumber) || 0;
                      const numB = parseFloat(b.chapterNumber) || 0;
                      return chapterSortAsc ? numA - numB : numB - numA;
                    })
                    .map((ch) => {
                      const isRead = isChapterViewed(selectedMangaModal.id, ch.id || ch.rawId, ch.chapterNumber);
                      return (
                        <div
                          key={ch.id || ch.rawId}
                          className={`flex items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 transition ${
                            isRead
                              ? "border-emerald-500/30 bg-emerald-950/20 hover:border-emerald-500/50 hover:bg-emerald-950/30"
                              : "border-slate-800 bg-slate-950/80 hover:border-teal-500/40 hover:bg-slate-900"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <FileText className={`h-4 w-4 shrink-0 ${isRead ? "text-emerald-400" : "text-teal-400"}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className={`text-xs font-bold truncate ${isRead ? "text-emerald-200" : "text-white"}`}>
                                  {ch.title}
                                </p>
                                {isRead && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/40 shrink-0">
                                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                    <span>تمت المشاهدة</span>
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {ch.chapterNumber && (
                                  <span className={`text-[10px] font-mono font-semibold ${isRead ? "text-emerald-400/80" : "text-teal-400/90"}`}>
                                    رقم الفصل: {ch.chapterNumber}
                                  </span>
                                )}
                                {ch.availableSources && ch.availableSources.length > 1 ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-teal-500/15 border border-teal-500/30 px-1.5 py-0.5 text-[9px] font-bold text-teal-300">
                                    <Globe className="h-2.5 w-2.5" />
                                    <span>متوفر في {ch.availableSources.length} مصادر ({ch.availableSources.map((s: any) => s.sourceName).join("، ")})</span>
                                  </span>
                                ) : ch.sourceName ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-slate-300">
                                    <span>{ch.sourceName}</span>
                                  </span>
                                ) : null}
                                {ch.pageCount > 0 && (
                                  <span className="text-[10px] font-mono text-slate-400">
                                    • {ch.pageCount} صفحة
                                  </span>
                                )}
                                {ch.uploadDate && (
                                  <span className="text-[10px] text-slate-500 hidden sm:inline">
                                    • {new Date(Number(ch.uploadDate)).toLocaleDateString("ar-EG")}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* 1-Click Instant Read */}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedMangaModal(null);
                                handleExecutePullChapter(
                                  ch.id,
                                  ch.title,
                                  ch.chapterNumber,
                                  selectedMangaModal.title,
                                  selectedMangaModal.id,
                                  "reader"
                                );
                              }}
                              disabled={isPullingTarget !== null}
                              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition shadow-md active:scale-95 cursor-pointer disabled:opacity-50 ${
                                isRead
                                  ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20"
                                  : "bg-teal-500 hover:bg-teal-400 text-slate-950 shadow-teal-500/20"
                              }`}
                            >
                              {isPullingTarget === `${ch.id}-reader` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <BookOpen className="h-3.5 w-3.5" />
                              )}
                              <span>{isRead ? "إعادة القراءة" : "قراءة فورية"}</span>
                            </button>

                            {/* AI Translation Studio */}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedMangaModal(null);
                                handleExecutePullChapter(
                                  ch.id,
                                  ch.title,
                                  ch.chapterNumber,
                                  selectedMangaModal.title,
                                  selectedMangaModal.id,
                                  "studio"
                                );
                              }}
                              disabled={isPullingTarget !== null}
                              className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-950/60 hover:bg-indigo-900/80 px-3 py-1.5 text-xs font-bold text-indigo-300 transition cursor-pointer disabled:opacity-50"
                              title="ترجمة الفصل في استوديو الترجمة والذكاء الاصطناعي"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">ترجمة</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                )
              )}
            </div>

            {/* Footer info */}
            <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/70 px-4 py-2.5 text-[11px] text-slate-400">
              <span>
                {mangaChapters.length > 0 ? `إجمالي الفصول المتاحة: ${mangaChapters.length} فصلاً` : "بوابة الفصول الحية"}
              </span>
              <button
                type="button"
                onClick={() => setSelectedMangaModal(null)}
                className="text-xs text-slate-400 hover:text-white transition cursor-pointer"
              >
                إغلاق
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Add Custom Source Modal */}
      <AddCustomSourceModal
        isOpen={showAddCustomSourceModal}
        onClose={() => setShowAddCustomSourceModal(false)}
        onSourceAdded={() => {
          fetchSources();
        }}
      />
    </div>
  );
}
