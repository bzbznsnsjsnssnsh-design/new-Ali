import React, { useState, useEffect } from "react";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { collection, getDocs, setDoc, doc, query, where, orderBy, limit as fsLimit } from "firebase/firestore";
import { Search, Filter, RefreshCw, BookOpen, Loader2, Globe, Database } from "lucide-react";

interface AggregatorProps {
  onSelectManga: (mangaId: string, sourceId: string) => void;
}

export default function Aggregator({ onSelectManga }: AggregatorProps) {
  const [mangas, setMangas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<string>("all");

  const loadMangas = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, "aggregated_mangas"),
        where("source", "==", "MangaDex"),
        fsLimit(100)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMangas(data);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, "aggregated_mangas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMangas();
  }, []);

  const syncFromMangaDex = async () => {
    setSyncing(true);
    try {
      // Fetch popular from our backend proxy
      const response = await fetch("/api/manga/popular?limit=24");
      const data = await response.json();
      
      if (data.results && data.results.length > 0) {
        for (const manga of data.results) {
          const typeMap: Record<string, string> = {
            'ja': 'manga',
            'ko': 'manhwa',
            'zh': 'manhua'
          };
          
          const type = typeMap[manga.originalLanguage] || 'manga';
          
          const languages = ['en', 'ar']; 
          if (manga.originalLanguage && !languages.includes(manga.originalLanguage)) {
             languages.push(manga.originalLanguage);
          }

          const mangaDoc = {
            title: manga.title,
            description: manga.description?.substring(0, 4999) || "No description",
            coverUrl: manga.coverUrl || "",
            type: type,
            source: "MangaDex",
            sourceId: manga.id,
            author: manga.author?.substring(0, 199) || "Unknown",
            languages: languages
          };

          await setDoc(doc(db, "aggregated_mangas", manga.id), mangaDoc);
        }
        await loadMangas();
      }
    } catch (error) {
      console.error("Sync error:", error);
      alert("فشل المزامنة من الخادم الخارجي.");
    } finally {
      setSyncing(false);
    }
  };

  const filteredMangas = mangas.filter(manga => {
    const matchesSearch = manga.title?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || manga.type === typeFilter;
    const matchesLang = langFilter === "all" || manga.languages?.includes(langFilter);
    return matchesSearch && matchesType && matchesLang;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
      
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-900 pb-6 mb-8">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Database className="h-6 w-6 text-emerald-400" />
            المكتبة المجمعة (Aggregator)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            قاعدة بيانات المانجا المجلوبة من المصادر الخارجية والمخزنة في Firestore.
          </p>
        </div>

        <button
          onClick={syncFromMangaDex}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/20 active:scale-95 border border-emerald-500/20 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span>مزامنة أحدث الأعمال (MangaDex)</span>
        </button>
      </div>

      <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="relative">
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
            <Search className="h-4 w-4 text-slate-500" />
          </div>
          <input
            type="text"
            className="w-full bg-slate-900 border border-slate-800 text-white text-sm rounded-xl focus:ring-emerald-500 focus:border-emerald-500 block pr-10 p-2.5"
            placeholder="ابحث عن مانجا..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="relative">
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
            <Filter className="h-4 w-4 text-slate-500" />
          </div>
          <select
            className="w-full bg-slate-900 border border-slate-800 text-white text-sm rounded-xl focus:ring-emerald-500 focus:border-emerald-500 block pr-10 p-2.5 appearance-none"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">كل الأنواع</option>
            <option value="manga">مانجا (يابانية)</option>
            <option value="manhwa">مانهوا (كورية)</option>
            <option value="manhua">مانها (صينية)</option>
          </select>
        </div>

        <div className="relative">
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
            <Globe className="h-4 w-4 text-slate-500" />
          </div>
          <select
            className="w-full bg-slate-900 border border-slate-800 text-white text-sm rounded-xl focus:ring-emerald-500 focus:border-emerald-500 block pr-10 p-2.5 appearance-none"
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
          >
            <option value="all">كل اللغات</option>
            <option value="ar">العربية</option>
            <option value="en">الإنجليزية</option>
            <option value="ja">اليابانية</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
        </div>
      ) : filteredMangas.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {filteredMangas.map((manga) => {
            const imageUrl = manga.coverUrl
              ? `/api/proxy-image?url=${encodeURIComponent(manga.coverUrl)}`
              : "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&q=80";

            return (
              <div
                key={manga.id}
                onClick={() => onSelectManga(manga.id, manga.sourceId)}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-slate-900/60 border border-slate-850 transition hover:-translate-y-1 hover:border-emerald-500/50"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                  <img
                    src={imageUrl}
                    alt={manga.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />
                  
                  <span className="absolute top-2 right-2 bg-slate-950/80 text-[9px] font-bold px-2 py-0.5 rounded-full border border-slate-800 text-emerald-400 backdrop-blur-sm uppercase">
                    {manga.type === 'manhwa' ? 'مانهوا' : manga.type === 'manhua' ? 'مانها' : 'مانجا'}
                  </span>
                </div>

                <div className="p-3 text-right">
                  <span className="font-mono text-[9px] text-emerald-400 line-clamp-1">{manga.author}</span>
                  <h3 className="line-clamp-2 font-display text-xs font-bold text-white group-hover:text-emerald-400 transition-colors mt-0.5">
                    {manga.title}
                  </h3>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {manga.languages?.map((lang: string) => (
                      <span key={lang} className="text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
                        {lang.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-900 p-16 text-center text-slate-600">
          <Database className="mx-auto h-12 w-12 text-slate-700 mb-4" />
          <h3 className="font-display text-base font-bold text-slate-500">لا توجد أعمال في القاعدة</h3>
          <p className="mt-2 text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
            قاعدة بيانات المانجا فارغة أو لا توجد نتائج للبحث. جرب النقر على مزامنة أحدث الأعمال.
          </p>
        </div>
      )}
    </div>
  );
}
