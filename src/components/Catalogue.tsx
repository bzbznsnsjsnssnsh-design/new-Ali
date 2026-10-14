import React, { useState, useEffect } from "react";
import { mangaEngine, MangaSource, Manga, MangaDetails } from "../lib/mangaMegaEngine";
import { Search, Loader2, BookOpen, ChevronRight, Hash, Users, Activity, ExternalLink } from "lucide-react";
import { DEFAULT_MANGA_COVER } from "../types";

interface CatalogueProps {
  onMangaSelect: (sourceId: string, mangaId: string) => void;
}

export default function Catalogue({ onMangaSelect }: CatalogueProps) {
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [filteredSources, setFilteredSources] = useState<MangaSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [langFilter, setLangFilter] = useState<string>("all");
  
  const [selectedSource, setSelectedSource] = useState<MangaSource | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Manga[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    loadSources();
  }, []);

  useEffect(() => {
    if (langFilter === "all") {
      setFilteredSources(sources);
    } else {
      setFilteredSources(sources.filter(s => s.language === langFilter));
    }
  }, [langFilter, sources]);

  const loadSources = async () => {
    setLoading(true);
    const fetchedSources = await mangaEngine.fetchSources();
    setSources(fetchedSources);
    setFilteredSources(fetchedSources);
    setLoading(false);
  };

  const loadSourceCatalog = async (sourceId: string, q = "") => {
    setIsSearching(true);
    const results = await mangaEngine.searchManga(sourceId, q);
    setSearchResults(results);
    setIsSearching(false);
  };

  useEffect(() => {
    if (selectedSource) {
      setSearchQuery("");
      loadSourceCatalog(selectedSource.id, "");
    }
  }, [selectedSource]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource) return;
    loadSourceCatalog(selectedSource.id, searchQuery);
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
      </div>
    );
  }

  // Source Details & Search UI
  if (selectedSource) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => {
              setSelectedSource(null);
              setSearchResults([]);
              setSearchQuery("");
            }}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition"
          >
            <ChevronRight className="h-4 w-4" />
            رجوع للمصادر
          </button>
          <div>
            <h1 className="text-2xl font-display font-bold text-white flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-teal-400" />
              {selectedSource.name}
            </h1>
            <span className="text-xs text-teal-400/80 font-mono">
              {(mangaEngine.getMode() || "suwayomi").toUpperCase()} ENGINE - {(selectedSource.language || "all").toUpperCase()}
            </span>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="mb-10">
          <div className="relative max-w-2xl mx-auto">
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
              <Search className="h-5 w-5 text-slate-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`ابحث عن مانجا في ${selectedSource.name}...`}
              className="w-full rounded-2xl border border-slate-800 bg-slate-900/50 py-4 pl-4 pr-12 text-slate-100 placeholder-slate-500 outline-none transition focus:border-teal-500 focus:bg-slate-900"
            />
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="absolute left-2 top-2 bottom-2 rounded-xl bg-teal-500 px-6 font-bold text-white transition hover:bg-teal-600 disabled:opacity-50 flex items-center gap-2"
            >
              {isSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : "بحث"}
            </button>
          </div>
        </form>

        {/* Loading Indicator */}
        {isSearching && (
          <div className="flex h-64 items-center justify-center flex-col gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
            <span className="text-sm text-slate-400">جاري تحميل الأعمال بأمان عبر نفق البروكسي...</span>
          </div>
        )}

        {/* Search Results */}
        {!isSearching && Array.isArray(searchResults) && searchResults.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {searchResults.map((manga) => (
              <div
                key={manga.id}
                onClick={() => onMangaSelect(selectedSource.id, manga.id)}
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
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-80" />
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-2 font-display text-sm font-bold text-slate-200 group-hover:text-teal-400 transition">
                    {manga.title}
                  </h3>
                </div>
              </div>
            ))}
          </div>
        )}

        {searchResults.length === 0 && !isSearching && searchQuery && (
          <div className="text-center py-20 text-slate-500">
            لا توجد نتائج بحث مطابقة.
          </div>
        )}
      </div>
    );
  }

  // Catalogue UI
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-10">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            دليل المصادر <span className="text-teal-400">والامتدادات</span>
          </h1>
          <p className="mt-2 text-sm text-slate-400 max-w-xl">
            تصفح مكتبات المانجا من مصادر متعددة. يتم جلب البيانات مباشرة من خلال محرك 
            <strong className="text-teal-400 ml-1">MangaMegaEngine</strong>.
          </p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-xl border border-slate-800">
          <select 
             value={langFilter} 
             onChange={(e) => setLangFilter(e.target.value as any)}
             className="bg-transparent text-slate-300 text-sm font-bold outline-none px-2 py-1 appearance-none cursor-pointer"
          >
             <option value="all">كل اللغات (All)</option>
             <option value="ar">العربية (Arabic)</option>
             <option value="en">الإنجليزية (English)</option>
             <option value="fr">الفرنسية (French)</option>
             <option value="es">الإسبانية (Spanish)</option>
             <option value="ja">اليابانية (Japanese)</option>
             <option value="ko">الكورية (Korean)</option>
             <option value="zh">الصينية (Chinese)</option>
             <option value="ru">الروسية (Russian)</option>
             <option value="pt">البرتغالية (Portuguese)</option>
             <option value="de">الألمانية (German)</option>
             <option value="it">الإيطالية (Italian)</option>
             <option value="tr">التركية (Turkish)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredSources.map(source => (
          <div
            key={source.id}
            onClick={() => setSelectedSource(source)}
            className="group flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 transition cursor-pointer hover:border-teal-500/50 hover:bg-slate-900 hover:shadow-xl hover:shadow-teal-500/5"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 text-teal-400 group-hover:scale-110 transition duration-300">
                  <BookOpen className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-white text-lg">{source.name}</h3>
                  <span className="text-xs font-mono text-teal-400/80 bg-teal-500/10 px-2 py-0.5 rounded-full border border-teal-500/20">
                    {(source.type || source.language || "suwayomi").toUpperCase()}
                  </span>
                </div>
              </div>
              <ExternalLink className="h-5 w-5 text-slate-600 group-hover:text-teal-400 transition" />
            </div>
            
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                <Hash className="h-3.5 w-3.5" />
                {source.language === 'ar' ? 'العربية' : 'English'}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      {filteredSources.length === 0 && (
        <div className="text-center py-20">
          <p className="text-slate-500">لا توجد مصادر متاحة للغة المحددة في هذا المحرك.</p>
        </div>
      )}
    </div>
  );
}
