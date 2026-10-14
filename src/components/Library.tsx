import React, { useState, useEffect } from "react";
import { getAllSavedChapters, deleteSavedChapter, SavedChapter } from "../lib/storage";
import { Trash2, BookOpen, Clock, Globe, Layers, Loader2 } from "lucide-react";
import { TARGET_LANGUAGES, Language } from "../types";

interface LibraryProps {
  onOpenChapter: (chapter: SavedChapter) => void;
}

export default function Library({ onOpenChapter }: LibraryProps) {
  const [chapters, setChapters] = useState<SavedChapter[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLibrary = async () => {
    setLoading(true);
    try {
      const saved = await getAllSavedChapters();
      saved.sort((a, b) => b.timestamp - a.timestamp);
      setChapters(saved);
    } catch (error) {
      console.error("Failed to load library:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLibrary();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteSavedChapter(id);
      setChapters((prev) => prev.filter((c) => c.id !== id));
    } catch (error) {
      console.error("Failed to delete chapter:", error);
    }
  };

  const getLanguageName = (code: string) => {
    return TARGET_LANGUAGES.find((l: Language) => l.code === code)?.name || code;
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">المكتبة المحفوظة</h1>
        <p className="mt-2 text-neutral-400">
          الفصول التي قمت بترجمتها وحفظها للقراءة دون اتصال بالإنترنت.
        </p>
      </div>

      {chapters.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-neutral-900/30 py-20 text-center">
          <BookOpen className="mb-4 h-12 w-12 text-neutral-600" />
          <h3 className="text-lg font-medium text-white">المكتبة فارغة</h3>
          <p className="mt-1 max-w-sm text-sm text-neutral-500">
            لم تقم بحفظ أي فصول بعد. يمكنك حفظ الفصول من قسم "رفع وترجمة" للعودة إليها لاحقاً.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {chapters.map((chapter) => (
            <div
              key={chapter.id}
              onClick={() => onOpenChapter(chapter)}
              className="group relative flex flex-col justify-between cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/50 p-6 transition-all hover:border-emerald-500/50 hover:bg-neutral-900"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-bold text-lg text-white group-hover:text-emerald-400 transition-colors line-clamp-2">
                    {chapter.title}
                  </h3>
                  <button
                    onClick={(e) => handleDelete(chapter.id, e)}
                    className="rounded-lg p-2 text-neutral-500 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                    title="حذف الفصل"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-3 text-xs text-neutral-400">
                  <div className="flex items-center gap-1 bg-white/5 px-2.5 py-1 rounded-md">
                    <Layers className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{chapter.pages.length} صفحات</span>
                  </div>
                  <div className="flex items-center gap-1 bg-white/5 px-2.5 py-1 rounded-md">
                    <Globe className="h-3.5 w-3.5 text-blue-400" />
                    <span>{getLanguageName(chapter.targetLang)}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-white/5 px-2.5 py-1 rounded-md">
                    <Clock className="h-3.5 w-3.5 text-purple-400" />
                    <span>{new Date(chapter.timestamp).toLocaleDateString("ar-EG")}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-2 overflow-hidden rounded-lg bg-black/40 p-2">
                {chapter.pages.slice(0, 4).map((page, idx) => (
                  <img
                    key={idx}
                    src={page.imageUrl}
                    alt={`Page ${idx + 1}`}
                    className="h-16 w-12 rounded object-cover border border-white/5"
                  />
                ))}
                {chapter.pages.length > 4 && (
                  <div className="flex h-16 w-12 items-center justify-center rounded bg-white/5 text-xs font-medium text-neutral-400">
                    +{chapter.pages.length - 4}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
