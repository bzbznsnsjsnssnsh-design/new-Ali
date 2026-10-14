import React from "react";
import { Manga, DEFAULT_MANGA_COVER } from "../types";
import { Star, Flame, Calendar, Tag } from "lucide-react";

interface MangaCardProps {
  key?: string;
  manga: Manga;
  onSelect: (mangaId: string) => void;
}

export default function MangaCard({ manga, onSelect }: MangaCardProps) {
  // Use our proxy-image route for guaranteed loading
  const imageUrl = (manga.coverUrl && manga.coverUrl.trim()) 
    ? `/api/proxy-image?url=${encodeURIComponent(manga.coverUrl.trim())}`
    : DEFAULT_MANGA_COVER;

  return (
    <div
      onClick={() => onSelect(manga.id)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-slate-900 border border-slate-800/80 transition-all duration-300 hover:-translate-y-1.5 hover:border-slate-700 hover:shadow-xl hover:shadow-emerald-950/20"
    >
      {/* Aspect Ratio container for cover */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
        <img
          src={imageUrl}
          alt={manga.title}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* Glossy gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />

        {/* Language & Status Badges */}
        <div className="absolute top-2.5 right-2.5 flex flex-wrap gap-1.5">
          {manga.status && (
            <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm ${
              manga.status === "ongoing"
                ? "bg-emerald-500/80 backdrop-blur-md"
                : manga.status === "completed"
                ? "bg-blue-500/80 backdrop-blur-md"
                : "bg-amber-500/80 backdrop-blur-md"
            }`}>
              {manga.status === "ongoing" ? "مستمر" : manga.status === "completed" ? "مكتمل" : manga.status}
            </span>
          )}
          
          {manga.originalLanguage && typeof manga.originalLanguage === "string" && (
            <span className="rounded-md bg-slate-900/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-200 backdrop-blur-md border border-slate-700/50">
              {manga.originalLanguage.toUpperCase()}
            </span>
          )}
        </div>

        {/* Overlay with tags/details on hover */}
        <div className="absolute bottom-0 left-0 right-0 p-3 text-right" dir="rtl">
          <p className="font-mono text-[10px] font-semibold text-emerald-400 mb-0.5">
            {manga.author}
          </p>
          <h3 className="line-clamp-2 font-display text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">
            {manga.title}
          </h3>
        </div>
      </div>

      {/* Information row */}
      <div className="flex items-center justify-between border-t border-slate-800/40 p-2.5 bg-slate-900/40 text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5 text-slate-500" />
          {manga.year || "N/A"}
        </span>
        <span className="flex items-center gap-1 rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
          <Tag className="h-3 w-3 text-slate-400" />
          {manga.contentRating || "safe"}
        </span>
      </div>
    </div>
  );
}
