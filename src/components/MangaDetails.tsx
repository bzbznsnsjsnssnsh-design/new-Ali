import React, { useState, useEffect } from "react";
import { Manga, Chapter, DEFAULT_MANGA_COVER } from "../types";
import { 
  ArrowLeft, Bookmark, BookmarkCheck, Star, Clock, ListOrdered, 
  Search, Calendar, Globe, BookOpen, AlertCircle, Loader2, RefreshCw,
  Heart, CheckCircle2
} from "lucide-react";
import { isFavorite, toggleFavorite } from "../lib/favorites";
import { isVideoFavorite, toggleVideoFavorite } from "../lib/videoFavorites";
import ChapterActionModal from "./manhwa-video/ChapterActionModal";
import { getAllChapterProgress, ChapterProgress } from "../lib/readingProgress";
import { ReaderTranslationCache } from "../utils/readerTranslationCache";
import { ReaderAudioCache } from "../utils/readerAudioCache";
import { toProxiedUrl } from "../utils/imageProxy";

interface MangaDetailsProps {
  mangaId: string;
  sourceId?: string;
  initialManga?: any;
  onBack: () => void;
  onReadChapter: (chapter: Chapter) => void;
  onCreateVideo?: (chapter: Chapter, manga?: Manga | null) => void;
}

export default function MangaDetails({ mangaId, sourceId, initialManga, onBack, onReadChapter, onCreateVideo }: MangaDetailsProps) {
  // Initialize manga immediately from initialManga or cache so cover and info NEVER disappear
  const [manga, setManga] = useState<Manga | null>(() => {
    if (initialManga) {
      return {
        id: initialManga.id || mangaId,
        title: initialManga.title || "",
        coverUrl: initialManga.coverUrl || initialManga.cover || initialManga.image || "",
        author: initialManga.author || "Unknown",
        status: initialManga.status || "Ongoing",
        description: initialManga.description || "",
        tags: initialManga.tags || initialManga.genres || [],
        contentRating: initialManga.contentRating || "safe",
        originalLanguage: initialManga.originalLanguage || "ja"
      };
    }
    try {
      const cleanMId = String(mangaId).replace(/^suwayomi_/, "");
      const cachedRaw = localStorage.getItem(`manga_cached_${mangaId}`) || localStorage.getItem(`manga_cached_${cleanMId}`);
      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw);
        if (parsed?.manga) return parsed.manga;
      }
      const favs = JSON.parse(localStorage.getItem("manga_favorites") || "[]");
      const found = favs.find((f: any) => {
        const fClean = String(f.id || "").replace(/^suwayomi_/, "");
        return f.id === mangaId || (cleanMId && fClean === cleanMId);
      });
      if (found) {
        return {
          id: found.id,
          title: found.title,
          coverUrl: found.coverUrl || found.cover || found.image || "",
          author: found.author || "Unknown",
          status: found.status || "Ongoing",
          description: found.description || "",
          tags: found.tags || found.genres || [],
          contentRating: found.contentRating || "safe",
          originalLanguage: found.originalLanguage || "ja"
        };
      }
    } catch {}
    return null;
  });

  const [chapters, setChapters] = useState<Chapter[]>(() => {
    try {
      const cleanMId = String(mangaId).replace(/^suwayomi_/, "");
      const cachedRaw = localStorage.getItem(`manga_cached_${mangaId}`) || localStorage.getItem(`manga_cached_${cleanMId}`);
      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw);
        if (Array.isArray(parsed?.chapters) && parsed.chapters.length > 0) return parsed.chapters;
      }
      if (initialManga?.chapters && Array.isArray(initialManga.chapters)) {
        return initialManga.chapters;
      }
    } catch {}
    return [];
  });

  const [loading, setLoading] = useState<boolean>(() => !manga);
  const [loadingChapters, setLoadingChapters] = useState<boolean>(() => chapters.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [isBookmarked, setIsBookmarked] = useState<boolean>(false);
  const [isFav, setIsFav] = useState<boolean>(false);
  const [isVideoFav, setIsVideoFav] = useState<boolean>(() => isVideoFavorite(mangaId, manga?.title, sourceId));
  const [selectedChapterForModal, setSelectedChapterForModal] = useState<Chapter | null>(null);
  const [isActionModalOpen, setIsActionModalOpen] = useState<boolean>(false);
  const [progressMap, setProgressMap] = useState<Record<string, ChapterProgress>>({});
  const [chapterSearch, setChapterSearch] = useState<string>("");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("all");
  const [lastReadChapterId, setLastReadChapterId] = useState<string | null>(null);

  // Navigate back without wiping persistent chapter translation contexts
  const handleBack = () => {
    onBack();
  };

  // Load reading progress
  const loadProgress = () => {
    setProgressMap(getAllChapterProgress());
  };

  // Fetch manga details and chapters
  useEffect(() => {
    let active = true;

    async function fetchDetails() {
      try {
        setError(null);
        setLoadingChapters(true);

        const cleanMangaId = String(mangaId).replace(/^suwayomi_/, "").trim();
        const queryParams = new URLSearchParams();
        if (sourceId) {
          queryParams.set("sourceId", sourceId);
          queryParams.set("provider", sourceId);
        }
        const srcQuery = queryParams.toString() ? `?${queryParams.toString()}` : "";

        let loadedChapters: any[] = chapters.length > 0 ? chapters : [];

        // 1. Ultra-fast Suwayomi works check (10ms for library/favorites manga)
        try {
          const suwRes = await fetch(`/api/suwayomi/works/${encodeURIComponent(cleanMangaId)}/chapters${srcQuery}`);
          if (suwRes.ok) {
            const suwData = await suwRes.json();
            if (active && suwData) {
              if (Array.isArray(suwData.chapters) && suwData.chapters.length > 0) {
                loadedChapters = suwData.chapters;
                setChapters(suwData.chapters);
                setLoadingChapters(false);
              }
              if (suwData.manga) {
                setManga((prev: any) => ({
                  ...(prev || {}),
                  ...suwData.manga,
                  coverUrl: prev?.coverUrl || (prev as any)?.cover || (prev as any)?.image || suwData.manga.coverUrl || (suwData.manga as any).cover || "",
                  title: prev?.title || suwData.manga.title || "",
                }));
                setLoading(false);
              }
            }
          }
        } catch (e) {
          console.warn("Suwayomi chapters check:", e);
        }

        // 2. Fetch full metadata details
        let detailsData: any = null;
        try {
          const detailsRes = await fetch(`/api/manga/details/${encodeURIComponent(mangaId)}${srcQuery}`);
          if (detailsRes.ok) {
            detailsData = await detailsRes.json();
            if (active && detailsData?.manga) {
              setManga((prev: any) => ({
                ...(prev || {}),
                ...detailsData.manga,
                coverUrl: prev?.coverUrl || (prev as any)?.cover || (prev as any)?.image || detailsData.manga.coverUrl || (detailsData.manga as any).cover || "",
                title: prev?.title || detailsData.manga.title || "",
              }));
              setLoading(false);
            }
            if (Array.isArray(detailsData?.chapters) && detailsData.chapters.length > 0 && loadedChapters.length === 0) {
              loadedChapters = detailsData.chapters;
              setChapters(loadedChapters);
              setLoadingChapters(false);
            }
          }
        } catch (dErr) {
          console.warn("Details fetch notice:", dErr);
        }

        // 3. Fallback to standard chapters endpoint if still empty
        if (loadedChapters.length === 0) {
          try {
            const chaptersRes = await fetch(`/api/manga/chapters/${encodeURIComponent(mangaId)}${srcQuery}`);
            if (chaptersRes.ok) {
              const chaptersData = await chaptersRes.json();
              if (Array.isArray(chaptersData.chapters) && chaptersData.chapters.length > 0) {
                loadedChapters = chaptersData.chapters;
                setChapters(loadedChapters);
                setLoadingChapters(false);
              }
            }
          } catch (cErr) {
            console.warn("Chapters primary fetch notice:", cErr);
          }
        }

        // 4. Fallback to Suwayomi works chapters with onlineFetch=true if still empty
        if (loadedChapters.length === 0) {
          try {
            const onlineQuery = srcQuery ? `${srcQuery}&onlineFetch=true` : "?onlineFetch=true";
            const suwOnlineRes = await fetch(`/api/suwayomi/works/${encodeURIComponent(cleanMangaId)}/chapters${onlineQuery}`);
            if (suwOnlineRes.ok) {
              const suwOnlineData = await suwOnlineRes.json();
              if (Array.isArray(suwOnlineData.chapters) && suwOnlineData.chapters.length > 0) {
                loadedChapters = suwOnlineData.chapters;
                setChapters(loadedChapters);
                setLoadingChapters(false);
                if (suwOnlineData.manga) {
                  setManga((prev: any) => ({
                    ...(prev || {}),
                    ...suwOnlineData.manga,
                    coverUrl: prev?.coverUrl || (prev as any)?.cover || (prev as any)?.image || suwOnlineData.manga.coverUrl || "",
                    title: prev?.title || suwOnlineData.manga.title || "",
                  }));
                }
              }
            }
          } catch (e) {
            console.warn("Suwayomi online chapters notice:", e);
          }
        }

        if (!active) return;
        if (loadedChapters.length > 0) {
          setChapters(loadedChapters);
        }
        setLoadingChapters(false);

        // Cache full payload for instant subsequent loads
        try {
          if (manga || loadedChapters.length > 0) {
            const cacheItem = JSON.stringify({
              manga: manga || detailsData?.manga,
              chapters: loadedChapters,
              sourceId: sourceId || undefined
            });
            localStorage.setItem(`manga_cached_${mangaId}`, cacheItem);
            if (cleanMangaId) {
              localStorage.setItem(`manga_cached_${cleanMangaId}`, cacheItem);
            }
          }
        } catch {}

        // Check if bookmarked
        const bookmarks = JSON.parse(localStorage.getItem("manga_bookmarks") || "[]");
        setIsBookmarked(bookmarks.some((b: any) => b.id === mangaId || b.id === cleanMangaId));
        
        // Check if favorite
        setIsFav(isFavorite(mangaId, manga?.title || detailsData?.manga?.title, sourceId));

        // Get last read chapter
        const readHistory = JSON.parse(localStorage.getItem("manga_history") || "{}");
        if (readHistory[mangaId] || readHistory[cleanMangaId]) {
          setLastReadChapterId((readHistory[mangaId] || readHistory[cleanMangaId]).chapterId);
        }

        loadProgress();

      } catch (err: any) {
        if (active) {
          setManga((prev: any) => {
            if (!prev) {
              setError(err.message || "حدث خطأ في جلب بيانات المانجا");
            }
            return prev;
          });
        }
      } finally {
        if (active) {
          setLoading(false);
          setLoadingChapters(false);
        }
      }
    }

    fetchDetails();

    const handleProgressUpdate = () => {
      loadProgress();
    };
    const handleFavUpdate = () => {
      setIsFav(isFavorite(mangaId, manga?.title, sourceId));
    };
    const handleVideoFavUpdate = () => {
      setIsVideoFav(isVideoFavorite(mangaId, manga?.title, sourceId));
    };
    window.addEventListener("manga_progress_updated", handleProgressUpdate);
    window.addEventListener("manga_favorites_updated", handleFavUpdate);
    window.addEventListener("manga_video_favorites_updated", handleVideoFavUpdate);

    return () => {
      active = false;
      window.removeEventListener("manga_progress_updated", handleProgressUpdate);
      window.removeEventListener("manga_favorites_updated", handleFavUpdate);
      window.removeEventListener("manga_video_favorites_updated", handleVideoFavUpdate);
    };
  }, [mangaId, sourceId]);

  // Handle video favorite toggle (🖤 القلب الأسود)
  const handleVideoFavoriteToggle = () => {
    if (!manga) return;
    const fullPayload = {
      id: manga.id,
      title: manga.title,
      cover: manga.coverUrl,
      coverUrl: manga.coverUrl,
      author: manga.author,
      status: manga.status,
      description: manga.description,
      type: "manga",
      sourceId: sourceId || undefined,
    };
    const newStatus = toggleVideoFavorite(fullPayload);
    setIsVideoFav(newStatus);
  };

  // Open Chapter Action Modal
  const handleChapterClick = (ch: Chapter) => {
    const fullCh = {
      ...ch,
      mangaTitle: manga?.title || "",
      sourceId: sourceId || "",
      language: ch.language || manga?.originalLanguage || "all"
    } as Chapter;
    setSelectedChapterForModal(fullCh);
    setIsActionModalOpen(true);
  };

  // Handle favorite toggle saving complete object
  const handleFavoriteToggle = () => {
    if (!manga) return;
    const fullPayload = {
      id: manga.id,
      title: manga.title,
      cover: manga.coverUrl,
      coverUrl: manga.coverUrl,
      author: manga.author,
      status: manga.status,
      description: manga.description,
      type: "manga",
      sourceId: sourceId || undefined,
      chapters: chapters
    };
    const newStatus = toggleFavorite(fullPayload);
    try {
      localStorage.setItem(`manga_cached_${manga.id}`, JSON.stringify({
        manga: manga,
        chapters: chapters,
        sourceId: sourceId || undefined
      }));
    } catch {}
    setIsFav(newStatus);
  };

  // Handle bookmark toggle
  const toggleBookmark = () => {
    if (!manga) return;
    const bookmarks = JSON.parse(localStorage.getItem("manga_bookmarks") || "[]");
    let updated;
    if (isBookmarked) {
      updated = bookmarks.filter((b: any) => b.id !== manga.id);
      setIsBookmarked(false);
    } else {
      updated = [...bookmarks, manga];
      setIsBookmarked(true);
    }
    localStorage.setItem("manga_bookmarks", JSON.stringify(updated));
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-slate-400">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
        <p className="font-mono text-sm">جاري تحميل المانجا والقصة والفصول...</p>
      </div>
    );
  }

  if (!manga) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-red-900/30 bg-red-950/10 p-6 text-center text-slate-200">
        <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
        <h3 className="mt-4 font-display text-lg font-bold">خطأ في التحميل</h3>
        <p className="mt-2 text-sm text-slate-400">{error || "تعذر العثور على المانجا المطلوبة."}</p>
        <button
          onClick={handleBack}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium hover:bg-slate-800 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          العودة للرئيسية
        </button>
      </div>
    );
  }

  // Filter Chapters
  const safeChapters = Array.isArray(chapters) ? chapters : [];
  const filteredChapters = safeChapters.filter((ch) => {
    if (!ch) return false;
    const title = String(ch.title || "");
    const chNum = String(ch.chapter || "");
    const matchesSearch = 
      title.toLowerCase().includes(chapterSearch.toLowerCase()) ||
      chNum.includes(chapterSearch);
    
    const matchesLang = selectedLanguage === "all" || ch.language === selectedLanguage;

    return matchesSearch && matchesLang;
  });

  // Unique Languages in Chapters
  const languages = Array.from(new Set(safeChapters.map((ch) => ch?.language || "all"))).filter(Boolean) as string[];

  const firstChapter = safeChapters[0];
  const lastReadChapter = safeChapters.find((ch) => ch?.id === lastReadChapterId);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
      
      {/* Back Button */}
      <button
        onClick={handleBack}
        className="mb-8 inline-flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800/80 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:border-slate-700 transition active:scale-95"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>العودة للرئيسية</span>
      </button>

      {/* Hero Section */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-4 lg:gap-12">
        
        {/* Cover Art Image */}
        <div className="md:col-span-1">
          <div className="sticky top-24 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl relative group">
            <img
              src={toProxiedUrl(manga.coverUrl || (manga as any).cover || (manga as any).image) || DEFAULT_MANGA_COVER}
              alt={manga.title}
              referrerPolicy="no-referrer"
              className="aspect-[3/4] w-full object-cover bg-slate-950"
              onError={(e) => {
                (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
              }}
            />
            {/* Favorite Hearts on Cover (Red for Translation, Black for Video) */}
            <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
              {/* Red Heart: Translation Favorites */}
              <button
                onClick={handleFavoriteToggle}
                className={`p-2.5 rounded-full backdrop-blur-md shadow-2xl transition active:scale-90 cursor-pointer border ${
                  isFav 
                    ? "bg-rose-500/25 border-rose-400 text-rose-300 shadow-rose-500/40" 
                    : "bg-slate-950/85 hover:bg-slate-900 border-slate-700/80 text-slate-300 hover:text-rose-400 hover:border-rose-500/60"
                }`}
                title={isFav ? "إزالة من مفضلة الترجمة" : "إضافة إلى مفضلة ترجمة الصفحات"}
              >
                <Heart className={`h-4.5 w-4.5 transition duration-200 ${isFav ? "fill-rose-500 text-rose-500 scale-110" : "text-rose-400"}`} />
              </button>

              {/* Black Heart: Video Favorites */}
              <button
                onClick={handleVideoFavoriteToggle}
                className={`p-2 rounded-full backdrop-blur-md shadow-2xl transition active:scale-90 cursor-pointer border ${
                  isVideoFav
                    ? "bg-slate-950 border-emerald-500 text-emerald-400 shadow-emerald-500/30 ring-1 ring-emerald-500/50"
                    : "bg-slate-950/85 hover:bg-slate-900 border-slate-700/80 text-slate-300 hover:border-slate-500"
                }`}
                title={isVideoFav ? "إزالة من مفضلة الفيديو" : "إضافة إلى مفضلة إنشاء الفيديوهات"}
              >
                <span className="text-sm leading-none select-none">🖤</span>
              </button>
            </div>
          </div>
        </div>

        {/* Info Column */}
        <div className="md:col-span-3 flex flex-col justify-between">
          <div>
            {/* Title / Meta */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="font-mono text-xs font-semibold text-teal-400">
                  {manga.author}
                </span>
                <h1 className="mt-1 font-display text-2xl font-extrabold text-white sm:text-3.5xl tracking-tight">
                  {manga.title}
                </h1>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Red Heart: Translation Favorite */}
                <button
                  onClick={handleFavoriteToggle}
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm font-bold transition duration-200 active:scale-95 cursor-pointer ${
                    isFav
                      ? "bg-rose-500/20 border-rose-500/60 text-rose-300 hover:bg-rose-500/30 shadow-lg shadow-rose-500/10"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-rose-500/40 hover:text-rose-300"
                  }`}
                  title="مفضلة ترجمة الصفحات"
                >
                  <Heart className={`h-4 w-4 ${isFav ? "fill-rose-500 text-rose-500" : "text-rose-400"}`} />
                  <span>{isFav ? "مفضلة الترجمة" : "تفضيل للترجمة"}</span>
                </button>

                {/* Black Heart: Video Favorite */}
                <button
                  onClick={handleVideoFavoriteToggle}
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs sm:text-sm font-bold transition duration-200 active:scale-95 cursor-pointer ${
                    isVideoFav
                      ? "bg-slate-950 border-emerald-500/80 text-emerald-400 hover:bg-slate-900 shadow-lg shadow-emerald-500/10"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white"
                  }`}
                  title="مفضلة إنشاء الفيديوهات"
                >
                  <span className="text-base leading-none">🖤</span>
                  <span>{isVideoFav ? "مفضلة الفيديو" : "تفضيل للفيديو"}</span>
                </button>

                {/* Bookmark Toggle */}
                <button
                  onClick={toggleBookmark}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition duration-200 active:scale-95 ${
                    isBookmarked
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white"
                  }`}
                >
                  {isBookmarked ? (
                    <>
                      <BookmarkCheck className="h-4.5 w-4.5" />
                      <span>مضاف للمكتبة</span>
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-4.5 w-4.5" />
                      <span>إضافة للمكتبة</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Specs */}
            <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5">
                <Clock className="h-4 w-4 text-slate-500" />
                <span className="text-slate-300">الحالة:</span>
                <span className="font-bold text-white">
                  {manga.status === "ongoing" ? "مستمر" : manga.status === "completed" ? "مكتمل" : manga.status}
                </span>
              </span>

              {manga.year && (
                <span className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  <span className="text-slate-300">سنة الإنتاج:</span>
                  <span className="font-bold text-white">{manga.year}</span>
                </span>
              )}

              {manga.originalLanguage && (
                <span className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5">
                  <Globe className="h-4 w-4 text-slate-500" />
                  <span className="text-slate-300">اللغة الأصلية:</span>
                  <span className="font-bold text-white uppercase">{manga.originalLanguage}</span>
                </span>
              )}
            </div>

            {/* Tags */}
            {Array.isArray(manga.tags) && manga.tags.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {manga.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-slate-900 border border-slate-850 px-3 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 transition"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Description */}
            <div className="mt-8">
              <h3 className="font-display text-base font-bold text-slate-200">القصة والنبذة</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-400 whitespace-pre-line max-w-3xl">
                {manga.description}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-10 flex flex-wrap gap-4 border-t border-slate-900 pt-6">
            {lastReadChapter ? (
              <button
                onClick={() => handleChapterClick(lastReadChapter)}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 hover:opacity-90 transition active:scale-95 cursor-pointer"
              >
                <BookOpen className="h-5 w-5" />
                <span>متابعة القراءة: الفصل {lastReadChapter.chapter}</span>
              </button>
            ) : firstChapter ? (
              <button
                onClick={() => handleChapterClick(firstChapter)}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 hover:opacity-90 transition active:scale-95 cursor-pointer"
              >
                <BookOpen className="h-5 w-5" />
                <span>قراءة الفصل الأول</span>
              </button>
            ) : null}
          </div>

        </div>
      </div>

      {/* Chapters Feed Section */}
      <div className="mt-16 border-t border-slate-900 pt-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 border border-slate-850">
              <ListOrdered className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-white">الفصول المتاحة</h2>
              <p className="font-mono text-xs text-slate-500">{chapters.length} فصول منشورة</p>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Lang Filter */}
            {languages.length > 1 && (
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 outline-none focus:border-emerald-500"
              >
                <option value="all">كل اللغات ({languages.length})</option>
                {languages.map((lang) => (
                  <option key={lang} value={lang}>
                    {(lang || "").toUpperCase() === "EN" ? "English" : (lang || "").toUpperCase() === "AR" ? "العربية" : (lang || "all")}
                  </option>
                ))}
              </select>
            )}

            {/* Search Input */}
            <div className="relative flex-1 sm:w-64 sm:flex-initial">
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                <Search className="h-4 w-4 text-slate-500" />
              </div>
              <input
                type="text"
                placeholder="رقم الفصل أو الاسم..."
                value={chapterSearch}
                onChange={(e) => setChapterSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pr-9 pl-4 text-xs text-slate-200 outline-none transition focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Chapters list layout */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loadingChapters && safeChapters.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-slate-800 bg-slate-900/30 p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
              <p className="text-sm font-medium">جاري فحص وجلب فصول العمل...</p>
            </div>
          ) : filteredChapters.length > 0 ? (
            filteredChapters.map((ch) => {
              const prog = progressMap[ch.id];
              const isRead = ch.id === lastReadChapterId || prog?.completed;
              return (
                <div
                  key={ch.id}
                  onClick={() => handleChapterClick(ch)}
                  className={`flex cursor-pointer items-start justify-between rounded-xl border p-4 transition duration-200 hover:-translate-y-0.5 active:scale-98 ${
                    prog?.completed
                      ? "bg-slate-950/60 border-teal-500/30 hover:border-teal-500/50"
                      : isRead
                      ? "bg-slate-950/40 border-emerald-500/20 hover:border-emerald-500/40"
                      : "bg-slate-900/60 border-slate-850 hover:border-slate-700 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex flex-col gap-1.5 text-right flex-1 min-w-0 pr-3">
                    <span className={`font-display text-sm font-bold line-clamp-1 transition-colors ${prog?.completed ? "text-teal-300" : isRead ? "text-emerald-300" : "text-slate-100"}`}>
                      الفصل {ch.chapter}: {ch.title}
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
                      <span>بواسطة: {ch.groupName}</span>
                    </span>

                    {/* Textual Progress Indicator */}
                    {prog && (
                      <div className="w-full mt-1.5 pt-1">
                        <span className={prog.completed ? "text-teal-400 font-bold flex items-center gap-1 text-[11px]" : "text-teal-400/90 font-medium text-[11px]"}>
                          {prog.completed ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 inline text-teal-400" />
                              <span>تمت المشاهدة بالكامل</span>
                            </>
                          ) : (
                            <span>تمت مشاهدة {prog.currentPage} من أصل {prog.totalPages} صفحة</span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="rounded bg-slate-800/80 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      {(ch.language || "all").toUpperCase()}
                    </span>
                    {prog?.completed ? (
                      <span className="rounded bg-teal-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-teal-400 flex items-center gap-0.5">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        <span>مكتمل</span>
                      </span>
                    ) : isRead ? (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-400">
                        مفتوح
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
              <p className="text-sm">لم يتم العثور على أي فصول مسجلة حالياً لهذا العمل.</p>
              <button
                onClick={async () => {
                  setLoadingChapters(true);
                  try {
                    const cleanMId = String(mangaId).replace(/^suwayomi_/, "").trim();
                    const srcParam = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}&provider=${encodeURIComponent(sourceId)}&onlineFetch=true` : "?onlineFetch=true";
                    const res = await fetch(`/api/suwayomi/works/${encodeURIComponent(cleanMId)}/chapters${srcParam}`);
                    if (res.ok) {
                      const data = await res.json();
                      if (Array.isArray(data.chapters) && data.chapters.length > 0) {
                        setChapters(data.chapters);
                      }
                    }
                  } catch {} finally {
                    setLoadingChapters(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/30 text-xs font-bold transition flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>إعادة محاولة جلب الفصول المحدثة</span>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Chapter Action Modal (❤️ ترجمة الصفحات vs 🎬 إنشاء فيديوهات) */}
      <ChapterActionModal
        isOpen={isActionModalOpen}
        chapter={selectedChapterForModal}
        mangaTitle={manga?.title}
        onClose={() => setIsActionModalOpen(false)}
        onSelectTranslate={(ch) => onReadChapter(ch)}
        onSelectVideo={(ch) => {
          if (onCreateVideo) {
            onCreateVideo(ch, manga);
          } else {
            onReadChapter(ch);
          }
        }}
      />
    </div>
  );
}
