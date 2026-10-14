import React, { useState, useEffect, useMemo } from "react";
import { globalEngine, MangaSource, Manga, MangaChapter } from "../lib/mangaGlobalEngine";
import { DEFAULT_MANGA_COVER } from "../types";
import { 
  Search, 
  Loader2, 
  ChevronRight, 
  ChevronDown, 
  Globe, 
  Layers, 
  Info, 
  Filter, 
  Sparkles, 
  RefreshCw, 
  Compass,
  ArrowLeft,
  Heart,
  BookOpen,
  ExternalLink,
  X,
  Puzzle,
  Server,
  Zap
} from "lucide-react";
import { isFavorite, addFavorite, removeFavorite } from "../lib/favorites";

interface MangaGlobalUIProps {
  onReadChapter: (chapter: any, sourceId: string, mangaId: string) => void;
  onOpenExtensions?: () => void;
}

// Meta mapping for known language codes
const LANGUAGE_META: Record<string, { name: string; native: string; flag: string }> = {
  ar: { name: 'العربية', native: 'العربية', flag: '🇸🇦' },
  en: { name: 'الإنجليزية', native: 'English', flag: '🇬🇧' },
  ja: { name: 'اليابانية', native: '日本語', flag: '🇯🇵' },
  ko: { name: 'الكورية', native: '한국어', flag: '🇰🇷' },
  zh: { name: 'الصينية', native: '中文', flag: '🇨🇳' },
  'zh-hk': { name: 'الصينية (هونغ كونغ)', native: '中文 (HK)', flag: '🇭🇰' },
  fr: { name: 'الفرنسية', native: 'Français', flag: '🇫🇷' },
  es: { name: 'الإسبانية', native: 'Español', flag: '🇪🇸' },
  'es-la': { name: 'الإسبانية (أمريكا اللاتينية)', native: 'Español (LATAM)', flag: '🇲🇽' },
  de: { name: 'الألمانية', native: 'Deutsch', flag: '🇩🇪' },
  pt: { name: 'البرتغالية', native: 'Português', flag: '🇵🇹' },
  'pt-br': { name: 'البرتغالية (البرازيل)', native: 'Português (BR)', flag: '🇧🇷' },
  it: { name: 'الإيطالية', native: 'Italiano', flag: '🇮🇹' },
  tr: { name: 'التركية', native: 'Türkçe', flag: '🇹🇷' },
  ru: { name: 'الروسية', native: 'Русский', flag: '🇷🇺' },
  hi: { name: 'الهندية', native: 'हिन्दी', flag: '🇮🇳' },
  id: { name: 'الإندونيسية', native: 'Bahasa Indonesia', flag: '🇮🇩' },
  th: { name: 'التايلاندية', native: 'ไทย', flag: '🇹🇭' },
  vi: { name: 'الفيتنامية', native: 'Tiếng Việt', flag: '🇻🇳' },
  pl: { name: 'البولندية', native: 'Polski', flag: '🇵🇱' },
  uk: { name: 'الأوكرانية', native: 'Українська', flag: '🇺🇦' },
  cs: { name: 'التشيكية', native: 'Čeština', flag: '🇨🇿' },
  hu: { name: 'المجرية', native: 'Magyar', flag: '🇭🇺' },
  ms: { name: 'الملايوية', native: 'Bahasa Melayu', flag: '🇲🇾' },
  nl: { name: 'الهولندية', native: 'Nederlands', flag: '🇳🇱' },
  sv: { name: 'السويدية', native: 'Svenska', flag: '🇸🇪' },
  fa: { name: 'الفارسية', native: 'فارسی', flag: '🇮🇷' },
  he: { name: 'العبرية', native: 'עברית', flag: '🇮🇱' },
  el: { name: 'اليونانية', native: 'Ελληνικά', flag: '🇬🇷' },
  ro: { name: 'الرومانية', native: 'Română', flag: '🇷🇴' },
  bg: { name: 'البلغارية', native: 'Български', flag: '🇧🇬' },
  fil: { name: 'الفلبينية', native: 'Filipino', flag: '🇵🇭' },
  bn: { name: 'البنغالية', native: 'বাংলা', flag: '🇧🇩' },
  all: { name: 'متعدد اللغات', native: 'Global / Multi', flag: '🌐' }
};

function getLanguageMeta(langCode: string) {
  const clean = (langCode || 'all').toLowerCase().trim();
  if (LANGUAGE_META[clean]) return LANGUAGE_META[clean];
  return {
    name: clean.toUpperCase(),
    native: clean.toUpperCase(),
    flag: '🌐'
  };
}

export default function MangaGlobalUI({ onReadChapter, onOpenExtensions }: MangaGlobalUIProps) {
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Dynamic Language Selection (Default to Arabic or All)
  const [selectedLanguageGroup, setSelectedLanguageGroup] = useState<string>("all");
  
  // Source filtering search inside sources list
  const [sourceSearch, setSourceSearch] = useState("");
  const [visibleSourcesLimit, setVisibleSourcesLimit] = useState(48);

  const [selectedSource, setSelectedSource] = useState<MangaSource | null>(null);
  
  // Search & Directory States within a selected source
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Manga[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  
  // Details States
  const [selectedManga, setSelectedManga] = useState<Manga | null>(null);
  const [mangaChapters, setMangaChapters] = useState<MangaChapter[]>([]);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);

  // Cross-Platform Omni Search States
  const [crossSearchQuery, setCrossSearchQuery] = useState("");
  const [omniResults, setOmniResults] = useState<any[]>([]);
  const [isOmniSearching, setIsOmniSearching] = useState(false);
  const [hasOmniSearched, setHasOmniSearched] = useState(false);
  const [, setFavoritesTick] = useState(0);

  useEffect(() => {
    const handleFavUpdate = () => setFavoritesTick(t => t + 1);
    window.addEventListener("manga_favorites_updated", handleFavUpdate);
    return () => window.removeEventListener("manga_favorites_updated", handleFavUpdate);
  }, []);

  const handleCrossSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = crossSearchQuery.trim();
    if (!q) return;

    setIsOmniSearching(true);
    setHasOmniSearched(true);
    try {
      // 1. Parallel search across all active sources via Suwayomi
      const allResults = await globalEngine.searchAllSources(q);
      if (allResults && allResults.length > 0) {
        setOmniResults(allResults);
      } else {
        // Fallback to currently selected or primary source
        const targetSource = selectedSource || sources.find(s => s.id.includes("6247824327199706550")) || sources[0];
        const targetSourceId = targetSource ? targetSource.id : "suwayomi_6247824327199706550";
        const results = await globalEngine.searchMangaInSource(targetSourceId, q, 1);
        
        const mapped = results.map(m => ({
          id: m.id,
          displayTitle: m.title,
          title: m.title,
          coverUrl: m.coverUrl,
          author: m.author || "Unknown",
          sources: [{
            sourceId: m.sourceId || targetSourceId,
            sourceName: targetSource ? ((targetSource as any).displayName || targetSource.name) : "Suwayomi",
            mangaId: m.id,
            language: targetSource?.language || "en"
          }]
        }));
        setOmniResults(mapped);
      }
    } catch (err) {
      console.error("Suwayomi omni search error:", err);
      setOmniResults([]);
    } finally {
      setIsOmniSearching(false);
    }
  };

  const handleOpenFromSource = async (sourceId: string, mangaId: string) => {
    let src = sources.find(s => s.id === sourceId);
    if (!src) {
      src = {
        id: sourceId,
        name: "Suwayomi Source",
        language: "all",
        status: "live",
        provider: "suwayomi"
      };
    }
    setSelectedSource(src);
    setIsFetchingDetails(true);
    const data = await globalEngine.fetchMangaDetails(sourceId, mangaId);
    if (data) {
      setSelectedManga(data.details);
      setMangaChapters(data.chapters || []);
      try {
        localStorage.setItem(`manga_cached_${data.details.id}`, JSON.stringify({
          manga: data.details,
          chapters: data.chapters || [],
          sourceId
        }));
      } catch {}
    }
    setIsFetchingDetails(false);
  };

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    setLoading(true);
    const fetchedSources = await globalEngine.fetchSources();
    setSources(fetchedSources);
    setLoading(false);
  };

  // 1. استخراج اللغات وإحصائياتها ديناميكياً من كافة المصادر المجلوبة
  const languageStats = useMemo(() => {
    const counts: Record<string, number> = {};
    sources.forEach(s => {
      const lang = (s.language || 'all').toLowerCase().trim();
      counts[lang] = (counts[lang] || 0) + 1;
    });
    return counts;
  }, [sources]);

  // قائمة اللغات الفريدة المرتبة بدقة
  const availableLanguages = useMemo(() => {
    const langs = Object.keys(languageStats);
    
    // Priority order for top common manga languages
    const priorityOrder = ['ar', 'en', 'ja', 'ko', 'zh', 'fr', 'es', 'de', 'pt-br', 'pt', 'it', 'tr', 'ru', 'id', 'th', 'vi', 'pl', 'hi'];
    
    return langs.sort((a, b) => {
      const pA = priorityOrder.indexOf(a);
      const pB = priorityOrder.indexOf(b);
      if (pA !== -1 && pB !== -1) return pA - pB;
      if (pA !== -1) return -1;
      if (pB !== -1) return 1;
      return (languageStats[b] || 0) - (languageStats[a] || 0);
    });
  }, [languageStats]);

  // 2. تصفية المصادر ديناميكياً بناءً على اللغة والبحث النصي
  const filteredSources = useMemo(() => {
    let list = sources;
    if (selectedLanguageGroup !== "all") {
      list = list.filter(s => (s.language || '').toLowerCase() === selectedLanguageGroup.toLowerCase());
    }
    if (sourceSearch.trim()) {
      const q = sourceSearch.toLowerCase().trim();
      list = list.filter(s => 
        s.name.toLowerCase().includes(q) || 
        s.id.toLowerCase().includes(q) ||
        (s.language || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [sources, selectedLanguageGroup, sourceSearch]);

  const displayedSources = useMemo(() => {
    return filteredSources.slice(0, visibleSourcesLimit);
  }, [filteredSources, visibleSourcesLimit]);

  // 3. جلب الأرشيف الكامل والدليل الشامل للمصدر المختار مع دعم الصفحات المباشرة
  const loadSourceDirectory = async (sourceId: string, pageToLoad: number, query: string = "", isAppend: boolean = false) => {
    if (isAppend) {
      setIsLoadingMore(true);
    } else {
      setIsSearching(true);
    }

    try {
      const results = await globalEngine.fetchCatalogDirectory(sourceId, pageToLoad, query);
      
      if (isAppend) {
        setSearchResults(prev => {
          const seen = new Set(prev.map(m => m.id));
          const fresh = results.filter(m => !seen.has(m.id));
          return [...prev, ...fresh];
        });
      } else {
        setSearchResults(results);
      }

      setPage(pageToLoad);
      // إذا كان عدد النتائج المجلوبة صفر أو قليل جداً، فقد نكون وصلنا لنهاية الكتالوج
      setHasMore(results.length >= 6);
    } catch (error) {
      console.error("Error loading source directory:", error);
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  };

  // جلب أول صفحة من الدليل الشامل عند فتح أي مصدر لأول مرة
  useEffect(() => {
    if (selectedSource) {
      setPage(1);
      setHasMore(true);
      loadSourceDirectory(selectedSource.id, 1, searchQuery);
    }
  }, [selectedSource]);

  // تفعيل التصفح والتمرير اللانهائي (Infinite Scroll via IntersectionObserver)
  useEffect(() => {
    if (!selectedSource || isSearching || isLoadingMore || !hasMore) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isSearching) {
          loadSourceDirectory(selectedSource.id, page + 1, searchQuery, true);
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );

    const currentSentinel = sentinelRef.current;
    if (currentSentinel) {
      observer.observe(currentSentinel);
    }

    return () => {
      if (currentSentinel) {
        observer.unobserve(currentSentinel);
      }
    };
  }, [selectedSource, page, hasMore, isLoadingMore, isSearching, searchQuery]);

  // 4. تفعيل شريط البحث والاتصال بدليل المصدر
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource) return;
    
    setPage(1);
    setHasMore(true);
    setSelectedManga(null);
    loadSourceDirectory(selectedSource.id, 1, searchQuery, false);
  };

  const handleMangaClick = async (manga: Manga) => {
    if (!selectedSource) return;
    setIsFetchingDetails(true);
    const data = await globalEngine.fetchMangaDetails(selectedSource.id, manga.id);
    if (data) {
      setSelectedManga(data.details);
      setMangaChapters(data.chapters || []);
      try {
        localStorage.setItem(`manga_cached_${data.details.id}`, JSON.stringify({
          manga: data.details,
          chapters: data.chapters || [],
          sourceId: selectedSource.id
        }));
      } catch {}
    }
    setIsFetchingDetails(false);
  };

  const handleReadClick = async (chapter: MangaChapter) => {
    if (!selectedManga || !selectedSource) return;
    onReadChapter(chapter, selectedSource.id, selectedManga.id);
  };

  if (loading) {
    return (
      <div className="flex flex-col h-96 items-center justify-center gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-teal-400" />
        <p className="text-slate-300 font-mono text-sm animate-pulse">
          جلب الكتالوج السحابي العالمي ومصادر جميع لغات العالم...
        </p>
      </div>
    );
  }

  // --- Manga Details View ---
  if (selectedManga) {
    const isMangaFav = isFavorite(selectedManga.id, selectedManga.title, selectedSource?.id);

    const toggleFavCurrent = () => {
      const payload = {
        id: selectedManga.id,
        title: selectedManga.title,
        cover: selectedManga.coverUrl,
        coverUrl: selectedManga.coverUrl,
        author: selectedManga.author,
        status: selectedManga.status,
        description: selectedManga.description,
        type: "manga",
        sourceId: selectedSource?.id || "consumet_comick",
        chapters: mangaChapters
      };
      if (isMangaFav) {
        removeFavorite(selectedManga.id);
      } else {
        addFavorite(payload);
      }
      try {
        localStorage.setItem(`manga_cached_${selectedManga.id}`, JSON.stringify({
          manga: selectedManga,
          chapters: mangaChapters,
          sourceId: selectedSource?.id
        }));
      } catch {}
      setFavoritesTick(t => t + 1);
    };

    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={() => setSelectedManga(null)}
            className="flex items-center gap-2 text-sm font-bold text-teal-400 bg-teal-500/10 hover:bg-teal-500/20 px-4 py-2 rounded-xl border border-teal-500/30 transition shadow-sm cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" /> العودة لقائمة الأعمال
          </button>

          {/* Action Heart button in header */}
          <button
            onClick={toggleFavCurrent}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition active:scale-95 cursor-pointer ${
              isMangaFav
                ? "bg-teal-500/20 border-teal-400 text-teal-300 shadow-md shadow-teal-500/20"
                : "bg-slate-900 border-slate-800 text-slate-300 hover:border-teal-500/40 hover:text-teal-300"
            }`}
          >
            <Heart className={`h-4 w-4 ${isMangaFav ? "fill-teal-400 text-teal-400" : "text-teal-400"}`} />
            <span>{isMangaFav ? "محفوظ في المفضلة" : "إضافة للمفضلة"}</span>
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-12">
          <div className="md:col-span-3 lg:col-span-3">
            <div className="overflow-hidden rounded-2xl border border-teal-500/30 shadow-2xl shadow-teal-500/10 bg-slate-900 relative group">
              <img 
                src={selectedManga.coverUrl || DEFAULT_MANGA_COVER} 
                alt={selectedManga.title} 
                className="w-full object-cover aspect-[2/3]" 
                onError={(e) => {
                  (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
                }}
              />
              {/* Distinct Turquoise Heart Icon Button right over the cover */}
              <button
                onClick={toggleFavCurrent}
                className={`absolute top-3 left-3 p-2.5 rounded-full backdrop-blur-md transition active:scale-90 cursor-pointer shadow-2xl z-20 border ${
                  isMangaFav
                    ? "bg-teal-500/30 border-teal-400 text-teal-300 shadow-teal-500/50 ring-2 ring-teal-400/40"
                    : "bg-slate-950/80 hover:bg-slate-900 border-slate-700 text-slate-400 hover:text-teal-300 hover:border-teal-400/80"
                }`}
                title={isMangaFav ? "إزالة من المفضلة" : "إضافة للمفضلة (حفظ فوري)"}
              >
                <Heart className={`h-5 w-5 transition duration-200 ${isMangaFav ? "fill-teal-400 text-teal-400 scale-110" : "text-teal-400"}`} />
              </button>
            </div>
          </div>
          <div className="md:col-span-9 lg:col-span-9 flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-mono text-teal-400 bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20 w-fit">
                {selectedSource?.name}
              </span>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-white">{selectedManga.title}</h1>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-slate-300 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center gap-2"><Info className="h-4 w-4 text-teal-400" /><span className="font-bold text-slate-400">المؤلف:</span><span>{selectedManga.author || 'غير معروف'}</span></div>
              <div className="flex items-center gap-2"><Layers className="h-4 w-4 text-teal-400" /><span className="font-bold text-slate-400">الفصول المتوفرة:</span><span className="font-bold text-teal-300">{mangaChapters.length}</span></div>
            </div>
            
            <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800/80">
              <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{selectedManga.description || "لا يوجد وصف متاح لهذا العمل."}</p>
            </div>
          </div>
        </div>

        <div className="border-b border-teal-500/20 pb-4 mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="text-teal-400 h-6 w-6" /> فصول العمل
          </h2>
          <span className="text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
            انقر على أي فصل لفتحه في القارئ الذكي المزود بالـ OCR
          </span>
        </div>

        {(!mangaChapters || mangaChapters.length === 0) ? (
          <div className="py-16 text-center text-slate-400 bg-slate-900/30 rounded-2xl border border-slate-800">
            <p>لا توجد فصول متوفرة حالياً لهذا العمل في هذا المصدر.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {(Array.isArray(mangaChapters) ? mangaChapters : []).map((ch) => (
              <button 
                key={ch.id} 
                onClick={() => handleReadClick(ch)} 
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-teal-500/60 hover:bg-slate-900 text-right group cursor-pointer shadow-sm hover:shadow-teal-500/10"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-bold text-sm text-slate-200 group-hover:text-teal-400 transition">{ch.title}</span>
                  <span className="text-[11px] font-mono text-teal-400/80">الفصل {ch.chapterNumber}</span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-teal-400 transition transform group-hover:translate-x-1" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Source Details & Manga List View ---
  if (selectedSource) {
    const meta = getLanguageMeta(selectedSource.language);
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setSelectedSource(null); setSearchResults([]); setSearchQuery(""); }}
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-teal-300 border border-teal-500/30 hover:bg-teal-500/10 hover:text-white transition cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" /> رجوع لقائمة المصادر
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">{meta.flag}</span>
                <h1 className="text-2xl font-display font-bold text-white flex items-center gap-2">
                  {selectedSource.name}
                </h1>
                <span className="text-xs font-mono text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">
                  {meta.name} ({(selectedSource.language || "all").toUpperCase()})
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              setPage(1);
              setHasMore(true);
              loadSourceDirectory(selectedSource.id, 1, searchQuery, false);
            }}
            disabled={isSearching || isLoadingMore}
            className="flex items-center gap-1.5 self-start sm:self-auto rounded-xl bg-slate-900/80 px-3 py-1.5 text-xs font-mono text-slate-300 border border-slate-800 hover:border-teal-500/40 hover:text-teal-400 transition cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSearching ? "animate-spin text-teal-400" : ""}`} />
            تحديث أرشيف المصدر
          </button>
        </div>

        {/* Search inside this specific source */}
        <form onSubmit={handleSearch} className="mb-10">
          <div className="relative max-w-2xl mx-auto flex gap-2">
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                <Search className="h-5 w-5 text-teal-500/60" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`ابحث داخل الدليل الكامل لـ ${selectedSource.name}...`}
                className="w-full rounded-2xl border border-teal-500/30 bg-slate-900/80 py-3.5 pl-4 pr-12 text-slate-100 placeholder-slate-500 outline-none transition focus:border-teal-400 focus:bg-slate-900 focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="rounded-2xl bg-teal-500 px-8 font-bold text-white transition hover:bg-teal-600 disabled:opacity-50 flex items-center justify-center min-w-[100px] cursor-pointer shadow-lg shadow-teal-500/20"
            >
              {isSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : "بحث"}
            </button>
          </div>
        </form>

        {isFetchingDetails && (
          <div className="py-16 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-teal-400" />
            <p className="text-slate-300 text-sm font-mono">جلب تفاصيل المانجا وقائمة الفصول الحقيقية...</p>
          </div>
        )}

        {!isFetchingDetails && (
          <div className="mb-6 border-b border-teal-500/20 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="font-display text-xl font-bold text-white flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-teal-400" />
                {searchQuery.trim() ? `نتائج البحث في الأرشيف عن "${searchQuery}"` : "الدليل والأرشيف الكامل الشامل"}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                استعلام حي ومباشر من السيرفر السحابي لجميع الأعمال التابعة لهذا المصدر
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-teal-300 bg-teal-500/10 px-3.5 py-1.5 rounded-full border border-teal-500/20 shadow-sm">
                يحتوي هذا المصدر على {searchResults.length} عمل حقيقي مستقل {page > 1 ? `(الصفحة ${page})` : ""}
              </span>
            </div>
          </div>
        )}

        {isSearching && (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
            <p className="text-slate-400 text-sm font-mono">جلب الأرشيف الكامل من المصدر عبر نفق البروكسي المباشر...</p>
          </div>
        )}
        
        {!isSearching && !isFetchingDetails && Array.isArray(searchResults) && searchResults.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {(searchResults || []).map((manga) => (
                <div 
                  key={manga.id} 
                  onClick={() => handleMangaClick(manga)} 
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 transition hover:-translate-y-1 hover:border-teal-500/50 hover:shadow-lg hover:shadow-teal-500/10"
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-950">
                    <img 
                      src={manga.coverUrl || DEFAULT_MANGA_COVER} 
                      alt={manga.title} 
                      loading="lazy" 
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105" 
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60" />
                  </div>
                  <div className="p-3">
                    <h3 className="line-clamp-2 font-display text-sm font-bold text-slate-200 group-hover:text-teal-400 transition">
                      {manga.title}
                    </h3>
                  </div>
                </div>
              ))}
            </div>

            {/* Infinite Scroll Sentinel & Load More Controls */}
            <div ref={sentinelRef} className="h-8 w-full" />

            {isLoadingMore && (
              <div className="py-8 flex flex-col items-center justify-center gap-2">
                <Loader2 className="h-7 w-7 animate-spin text-teal-400" />
                <p className="text-xs text-slate-400 font-mono">
                  جاري تدفق المزيد من أعمال الأرشيف (الصفحة {page + 1})...
                </p>
              </div>
            )}

            {hasMore && !isLoadingMore && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={() => loadSourceDirectory(selectedSource.id, page + 1, searchQuery, true)}
                  className="flex items-center gap-2 rounded-2xl bg-slate-900 border border-teal-500/40 px-8 py-3 text-sm font-bold text-teal-300 hover:bg-teal-500/20 hover:border-teal-400 hover:text-white transition shadow-lg shadow-teal-500/10 cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  تحميل المزيد من الأعمال (الصفحة {page + 1})
                </button>
              </div>
            )}

            {!hasMore && (
              <div className="mt-8 text-center py-4 text-xs font-mono text-slate-500 border-t border-slate-900">
                ✓ تم استعراض كامل الأرشيف المتاح لهذا المصدر ({searchResults.length} عمل حقيقي)
              </div>
            )}
          </>
        )}

        {!isSearching && !isFetchingDetails && searchResults.length === 0 && (
          <div className="py-20 text-center text-slate-400 bg-slate-900/20 rounded-2xl border border-slate-800/50">
            <p className="text-base font-medium">لم يتم العثور على أعمال في هذا المصدر حالياً.</p>
            <p className="text-xs text-slate-500 mt-1">جرّب كتابة كلمة بحث أخرى أو النقر على "تحديث أرشيف المصدر".</p>
          </div>
        )}
      </div>
    );
  }

  // --- Main Global Sources View (with Dynamic Omni-Language Dropdown) ---
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
      
      {/* Top Header & Overview */}
      <div className="mb-8 border-b border-teal-500/20 pb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center gap-1.5 text-xs font-bold text-teal-400 font-mono uppercase bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20">
                <Compass className="h-3.5 w-3.5" />
                المنظومة العالمية الشاملة (Omni-Language Support)
              </span>
              <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded-full border border-slate-800">
                {sources.length} مصدر عالمي نشط
              </span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              كتالوج المصادر <span className="bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">لكافة لغات العالم</span>
            </h1>
            <p className="mt-2 text-sm text-slate-400 max-w-2xl">
              تصفح وجلب المانجا والمانهوا والمانها عبر أكثر من {sources.length} موقع ومصدر حقيقي يغطي كافة اللغات العالمية بدون أي حظر أو قيود.
            </p>
          </div>

          {/* 2. قائمة التصفية المنسدلة التركوازية الديناميكية (Dynamic Omni-Language Dropdown) */}
          <div className="bg-slate-900/90 p-4 rounded-2xl border border-teal-500/40 shadow-xl shadow-teal-500/5 min-w-[300px]">
            <label htmlFor="omni-language-select" className="text-xs font-mono font-bold text-teal-400 flex items-center gap-1.5 mb-2">
              <Globe className="h-4 w-4 text-teal-400" />
              قائمة التصفية المنسدلة لجميع لغات العالم:
            </label>
            <div className="relative">
              <select
                id="omni-language-select"
                value={selectedLanguageGroup}
                onChange={(e) => setSelectedLanguageGroup(e.target.value)}
                className="w-full appearance-none rounded-xl border border-teal-500/40 bg-slate-950 py-3 pl-10 pr-4 text-sm font-bold text-white shadow-inner outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
              >
                <option value="all" className="bg-slate-950 text-teal-300 font-bold">
                  🌐 جميع لغات العالم ({sources.length} مصدر وموقع)
                </option>
                {availableLanguages.map((lang) => {
                  const meta = getLanguageMeta(lang);
                  const count = languageStats[lang] || 0;
                  return (
                    <option key={lang} value={lang} className="bg-slate-950 text-slate-200">
                      {meta.flag} {meta.name} - {meta.native} ({count} مصدر)
                    </option>
                  );
                })}
              </select>
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-teal-400">
                <ChevronDown className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Filter Language Chips - Smooth horizontal scroll on mobile */}
        <div className="mt-4 sm:mt-6 flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar sm:flex-wrap">
          <span className="text-xs font-mono text-slate-400 flex items-center gap-1 shrink-0 ml-1">
            <Filter className="h-3 w-3 text-teal-400" />
            اختيار سريع:
          </span>
          <button
            onClick={() => { setSelectedLanguageGroup("all"); setVisibleSourcesLimit(48); }}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer border shrink-0 ${
              selectedLanguageGroup === "all"
                ? "bg-teal-500 text-white border-teal-400 shadow-md shadow-teal-500/20"
                : "bg-slate-900/80 text-slate-300 border-slate-800 hover:border-teal-500/40 hover:text-white"
            }`}
          >
            🌐 جميع اللغات ({sources.length})
          </button>
          {availableLanguages.slice(0, 12).map((lang) => {
            const meta = getLanguageMeta(lang);
            const isSelected = selectedLanguageGroup === lang;
            return (
              <button
                key={lang}
                onClick={() => { setSelectedLanguageGroup(lang); setVisibleSourcesLimit(48); }}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition cursor-pointer border shrink-0 ${
                  isSelected
                    ? "bg-teal-500 text-white border-teal-400 shadow-md shadow-teal-500/20"
                    : "bg-slate-900/80 text-slate-300 border-slate-800 hover:border-teal-500/40 hover:text-white"
                }`}
              >
                {meta.flag} {meta.name} ({languageStats[lang]})
              </button>
            );
          })}
        </div>
      </div>

      {/* Suwayomi & Mihon Extension Engine Banner */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900/80 to-teal-950/30 p-4 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Puzzle className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">
                دعم إضافات Mihon / Tachiyomi وخادم Suwayomi
              </h3>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30">
                Keiyoushi Repository
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              استكشف وثبّت مئات الإضافات المباشرة دون الحاجة لتشغيل APK في المتصفح.
            </p>
          </div>
        </div>

        {onOpenExtensions && (
          <button
            onClick={onOpenExtensions}
            className="flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-bold text-slate-950 transition shadow-md shadow-emerald-500/10 cursor-pointer shrink-0"
          >
            <Puzzle className="h-4 w-4" />
            <span>فتح مركز الإضافات والمستودعات ←</span>
          </button>
        )}
      </div>

      {/* Suwayomi Unified Engine Active Status */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 border border-emerald-500/30 rounded-xl px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold text-emerald-300">
            خادم Suwayomi نشط (المصدر الحصري والوحيد لكافة بيانات المانجا والفصول)
          </span>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
            Mihon / Keiyoushi Core
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span>{sources.length} مصدر معتمد متصل بالسيرفر</span>
        </div>
      </div>

      {/* 1. شريط البحث المخصص لتصفية مواقع المصادر (Search for Source Website) */}
      <div className="mb-4 rounded-2xl border border-teal-500/30 bg-slate-900/60 p-4 shadow-lg backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
          <label className="text-xs font-mono font-bold text-teal-400 flex items-center gap-1.5">
            <Globe className="h-4 w-4 text-teal-400" />
            <span>البحث عن موقع المصدر وتصفيته (من بين {sources.length} موقعاً نشطاً):</span>
          </label>
          <span className="text-[11px] font-mono text-slate-400">
            المصادر المطابقة: <strong className="text-teal-300">{filteredSources.length}</strong> من أصل {sources.length}
          </span>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5">
            <Search className="h-4 w-4 text-teal-400" />
          </div>
          <input
            type="text"
            value={sourceSearch}
            onChange={(e) => setSourceSearch(e.target.value)}
            placeholder="ابحث عن اسم موقع المصدر بالاسم أو اللغة (مثال: Azora, MangaDex, Asura, Despair)..."
            className="w-full rounded-xl border border-slate-800 bg-slate-950 py-3 pl-10 pr-10 text-xs sm:text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20"
          />
          {sourceSearch && (
            <button
              onClick={() => setSourceSearch("")}
              className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. شريط البحث العملاق للأعمال الشامل (Cross-Platform Manga Search) */}
      <div className="mb-8 rounded-2xl border-2 border-teal-500/50 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-teal-950/30 p-5 shadow-2xl shadow-teal-500/10 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
          <label className="text-sm font-bold text-teal-300 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-teal-400 animate-pulse" />
            <span>شريط البحث العملاق للأعمال (Cross-Platform Manga Search)</span>
            <span className="rounded bg-teal-500/20 px-2 py-0.5 text-[10px] font-mono text-teal-300 border border-teal-500/30">
              بحث متزامن في كافة المواقع
            </span>
          </label>
          <span className="text-[11px] text-slate-400">
            يكتشف تواجد العمل ويجمعه عبر جميع المواقع المتاحة للقراءة الفورية بـ Gemini OCR
          </span>
        </div>
        <form onSubmit={handleCrossSearch} className="flex gap-2">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5">
              <Search className="h-5 w-5 text-teal-400" />
            </div>
            <input
              type="text"
              value={crossSearchQuery}
              onChange={(e) => setCrossSearchQuery(e.target.value)}
              placeholder="اكتب اسم المانجا أو المانهوا للبحث في كافة المواقع دفعة واحدة (مثال: Solo Leveling، One Piece، Omniscient Reader)..."
              className="w-full rounded-xl border border-teal-500/40 bg-slate-950 py-3.5 pl-10 pr-11 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-500/30 font-medium"
            />
            {crossSearchQuery && (
              <button
                type="button"
                onClick={() => {
                  setCrossSearchQuery("");
                  setOmniResults([]);
                  setHasOmniSearched(false);
                }}
                className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={isOmniSearching || !crossSearchQuery.trim()}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-6 py-3.5 font-display text-sm font-bold text-white shadow-lg shadow-teal-500/25 transition hover:opacity-95 disabled:opacity-50 active:scale-98 shrink-0 cursor-pointer"
          >
            {isOmniSearching ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>جاري البحث...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>بحث شامل</span>
              </>
            )}
          </button>
        </form>

        {/* Search Results Area */}
        {isOmniSearching && (
          <div className="mt-6 flex flex-col items-center justify-center p-8 text-center bg-slate-950/60 rounded-xl border border-teal-500/20">
            <Loader2 className="h-8 w-8 animate-spin text-teal-400 mb-3" />
            <p className="text-sm font-bold text-teal-300">
              جاري البحث المتوازي في كافة المواقع النشطة دفعة واحدة وتجميع النتائج...
            </p>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              البحث في كافة مصادر Suwayomi النشطة (أزورا، ديسبير مانجا، MangaDex، Asura Scans، والمزيد...)
            </p>
          </div>
        )}

        {hasOmniSearched && !isOmniSearching && (
          <div className="mt-6">
            <div className="flex items-center justify-between border-b border-teal-500/20 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="font-display text-base font-bold text-white">
                  نتائج البحث الشامل المجمعة
                </span>
                <span className="rounded-full bg-teal-500/20 px-2.5 py-0.5 text-xs font-mono font-bold text-teal-300 border border-teal-500/30">
                  {omniResults.length} عمل مقسم حسب المواقع
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOmniResults([]);
                  setHasOmniSearched(false);
                }}
                className="text-xs font-mono text-slate-400 hover:text-teal-300 flex items-center gap-1 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                إغلاق نتائج البحث الشامل
              </button>
            </div>

            {(!omniResults || omniResults.length === 0) ? (
              <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800 text-slate-400">
                <p className="text-sm font-medium">لم يتم العثور على أي عمل يطابق "{crossSearchQuery}" عبر المواقع المفحوصة.</p>
                <p className="text-xs text-slate-500 mt-1">تأكد من كتابة الاسم بالإنجليزية أو الحروف الأصلية للحصول على أفضل النتائج.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(Array.isArray(omniResults) ? omniResults : []).map((work) => {
                  if (!work) return null;
                  const sourcesList = Array.isArray(work.sources) ? work.sources : [];
                  const fav = isFavorite(work.id, work.title || work.displayTitle, work.sourceId || (sourcesList[0]?.sourceId));
                  return (
                    <div
                      key={work.id}
                      className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-800 bg-slate-950/80 hover:border-teal-500/40 transition duration-200 shadow-md"
                    >
                      {/* Cover with quick Favorite toggle */}
                      <div className="relative w-28 sm:w-24 aspect-[2/3] shrink-0 rounded-lg overflow-hidden bg-slate-900 border border-slate-800 self-center sm:self-start">
                        <img
                          src={work.coverUrl ? globalEngine.getProxiedUrl(work.coverUrl) : DEFAULT_MANGA_COVER}
                          alt={work.displayTitle}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
                          }}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (fav) {
                              removeFavorite(work.id);
                            } else {
                              addFavorite({
                                id: work.id,
                                title: work.displayTitle,
                                coverUrl: work.coverUrl || "",
                                author: work.author,
                                status: "Ongoing",
                                sourceId: work.sources?.[0]?.sourceId || "global"
                              });
                            }
                          }}
                          title={fav ? "إزالة من المفضلة" : "إضافة للمفضلة"}
                          className={`absolute top-1.5 left-1.5 p-1.5 rounded-full backdrop-blur-md transition ${
                            fav
                              ? "bg-rose-500/90 text-white shadow-lg"
                              : "bg-slate-950/60 text-slate-300 hover:text-rose-400 hover:bg-slate-950/90"
                          }`}
                        >
                          <Heart className={`h-3.5 w-3.5 ${fav ? "fill-current" : ""}`} />
                        </button>
                      </div>

                      {/* Info & Grouped Sources */}
                      <div className="flex-1 flex flex-col justify-between text-right">
                        <div>
                          <h4 className="font-display text-sm font-bold text-white line-clamp-1">
                            {work.displayTitle}
                          </h4>
                          {work.author && (
                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                              المؤلف: {work.author}
                            </p>
                          )}
                          {work.description && (
                            <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                              {work.description}
                            </p>
                          )}
                        </div>

                        {/* Available Sources Grouping */}
                        <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                          <div className="flex items-center justify-between text-[11px] font-mono mb-2">
                            <span className="text-teal-400 font-bold flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              متوفر في {sourcesList.length} موقع:
                            </span>
                            <span className="text-slate-500 text-[10px]">
                              انقر للقراءة الفورية بـ OCR
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            {sourcesList.map((src: any, idx: number) => {
                              const meta = getLanguageMeta(src.sourceLanguage);
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => handleOpenFromSource(src.sourceId, src.mangaId)}
                                  className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 hover:bg-teal-500/20 hover:border-teal-400 px-2.5 py-1 text-xs font-semibold text-teal-200 transition active:scale-95 cursor-pointer shadow-sm"
                                >
                                  <span>{meta.flag}</span>
                                  <span>{src.sourceName}</span>
                                  <ExternalLink className="h-3 w-3 text-teal-400" />
                                </button>
                              );
                            })}
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sources Grid */}
      {filteredSources.length === 0 ? (
        <div className="py-20 text-center text-slate-400 bg-slate-900/20 rounded-2xl border border-slate-800/50">
          <p className="text-base font-medium">لم يتم العثور على مصادر تطابق الفلترة المحددة.</p>
          <button
            onClick={() => { setSelectedLanguageGroup("all"); setSourceSearch(""); }}
            className="mt-3 text-xs font-bold text-teal-400 underline cursor-pointer"
          >
            إعادة تعيين الفلترة وعرض كافة المصادر
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayedSources.map(source => {
              const meta = getLanguageMeta(source.language);
              return (
                <div 
                  key={source.id} 
                  onClick={() => setSelectedSource(source)} 
                  className="group flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-slate-900/50 p-4 sm:p-5 transition cursor-pointer hover:border-teal-500/50 hover:bg-slate-900 hover:shadow-xl hover:shadow-teal-500/5 active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-xl bg-slate-950 border border-slate-800 text-teal-400 group-hover:scale-105 transition duration-300 text-lg sm:text-xl shadow-inner">
                        {meta.flag}
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-sm sm:text-base group-hover:text-teal-300 transition line-clamp-1">
                          {source.name}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <span className="text-[10px] sm:text-[11px] font-mono text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">
                            {meta.name}
                          </span>
                          <span className="text-[9px] sm:text-[10px] font-mono text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                            <Zap className="h-2.5 w-2.5" />
                            Suwayomi
                          </span>
                          <span className="flex items-center gap-1 text-[10px] sm:text-[11px] font-mono text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            نشط
                          </span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-teal-400 transition transform group-hover:translate-x-1 shrink-0 mt-2" />
                  </div>

                  <div className="mt-3.5 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400 font-mono">
                    <span>تصفح الأعمال والفصول</span>
                    <span className="text-teal-400 group-hover:underline">فتح المصدر ←</span>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredSources.length > visibleSourcesLimit && (
            <div className="mt-8 flex flex-col items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setVisibleSourcesLimit(prev => prev + 60)}
                className="flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-teal-500/50 hover:bg-slate-850 text-teal-300 font-bold px-7 py-3 text-xs sm:text-sm transition active:scale-95 shadow-lg shadow-black/40 cursor-pointer"
              >
                <span>عرض المزيد من المصادر (+60 مصدر)</span>
              </button>
              <span className="text-[11px] font-mono text-slate-500">
                يتم عرض {Math.min(visibleSourcesLimit, filteredSources.length)} من أصل {filteredSources.length} مصدراً
              </span>
            </div>
          )}
        </>
      )}

    </div>
  );
}
