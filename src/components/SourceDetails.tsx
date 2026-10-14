import React, { useState, useEffect } from "react";
import { mangaEngine, MangaDetails, MangaChapter } from "../lib/mangaMegaEngine";
import { Loader2, ArrowLeft, BookOpen, Layers, Info, Calendar } from "lucide-react";
import { DEFAULT_MANGA_COVER } from "../types";

interface SourceDetailsProps {
  sourceId: string;
  mangaId: string;
  onBack: () => void;
  onReadChapter: (chapter: MangaChapter, sourceId: string, mangaId: string) => void;
}

export default function SourceDetails({ sourceId, mangaId, onBack, onReadChapter }: SourceDetailsProps) {
  const [details, setDetails] = useState<MangaDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadDetails();
  }, [sourceId, mangaId]);

  const loadDetails = async () => {
    setLoading(true);
    setError("");
    const res = await mangaEngine.fetchMangaDetails(sourceId, mangaId);
    if (res) {
      setDetails(res);
    } else {
      setError("فشل جلب تفاصيل المانجا من هذا المصدر.");
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
        <p className="text-slate-500 font-mono text-sm">جلب البيانات من المحرك...</p>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4 text-center">
        <p className="text-red-400">{error}</p>
        <button onClick={onBack} className="text-teal-400 hover:underline">العودة للبحث</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
      
      {/* Top Nav */}
      <button 
        onClick={onBack}
        className="mb-8 flex items-center gap-2 text-sm font-bold text-slate-400 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        العودة لنتائج البحث
      </button>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-12">
        {/* Cover */}
        <div className="md:col-span-3 lg:col-span-3">
          <div className="overflow-hidden rounded-2xl border border-slate-800 shadow-2xl">
            <img 
              src={details.coverUrl || DEFAULT_MANGA_COVER} 
              alt={details.title} 
              className="w-full object-cover aspect-[2/3]"
              onError={(e) => {
                (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
              }}
            />
          </div>
        </div>

        {/* Info */}
        <div className="md:col-span-9 lg:col-span-9 flex flex-col gap-6">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-white mb-2">
              {details.title}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-3 py-1 text-xs font-mono font-medium text-teal-400 border border-teal-500/20">
              {details.status?.toUpperCase() || 'UNKNOWN'}
            </span>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-slate-300 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-slate-500" />
              <span className="font-bold text-slate-400">المؤلف:</span>
              <span>{details.author}</span>
            </div>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-slate-500" />
              <span className="font-bold text-slate-400">عدد الفصول:</span>
              <span>{details.chapters.length}</span>
            </div>
          </div>

          <div>
            <h3 className="font-bold text-slate-400 mb-2 flex items-center gap-2">
              <BookOpen className="h-4 w-4" /> القصة
            </h3>
            <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap bg-slate-950 p-5 rounded-2xl border border-slate-900">
              {details.description || "لا توجد قصة متاحة."}
            </p>
          </div>
        </div>
      </div>

      {/* Chapters List */}
      <div>
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="h-6 w-6 text-teal-400" />
            الفصول
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
          {(Array.isArray(details?.chapters) ? details.chapters : []).map((chapter) => (
            <button
              key={chapter.id}
              onClick={() => onReadChapter(chapter, sourceId, mangaId)}
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition hover:border-teal-500/50 hover:bg-slate-900 text-right group"
            >
              <div className="flex flex-col gap-1">
                <span className="font-bold text-sm text-slate-200 group-hover:text-teal-400 transition">
                  {chapter.title}
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  الفصل {chapter.chapterNumber}
                </span>
              </div>
              <ArrowLeft className="h-4 w-4 text-slate-600 group-hover:text-teal-400 transition transform group-hover:-translate-x-1" />
            </button>
          ))}
          
          {(!details?.chapters || details.chapters.length === 0) && (
            <div className="col-span-full py-10 text-center text-slate-500">
              لا توجد فصول متاحة في هذا المصدر.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
