// Modal displayed when user clicks a chapter: Choose between Reading/Translating or Video Creation
import React from "react";
import { Chapter } from "../../types";
import { BookOpen, Film, Heart, X, Sparkles, ArrowLeft } from "lucide-react";

interface ChapterActionModalProps {
  isOpen: boolean;
  chapter: Chapter | null;
  mangaTitle?: string;
  onClose: () => void;
  onSelectTranslate: (chapter: Chapter) => void;
  onSelectVideo: (chapter: Chapter) => void;
}

export default function ChapterActionModal({
  isOpen,
  chapter,
  mangaTitle,
  onClose,
  onSelectTranslate,
  onSelectVideo
}: ChapterActionModalProps) {
  if (!isOpen || !chapter) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in" dir="rtl">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl flex flex-col gap-6 text-right">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title & Info */}
        <div className="space-y-1.5 pr-1">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" />
            <span>خيارات الفصل</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-white">ماذا تريد أن تفعل بهذا الفصل؟</h2>
          <p className="text-xs text-slate-400">
            {mangaTitle ? `${mangaTitle} - ` : ""}الفصل {chapter.chapter || chapter.title || chapter.id}
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 gap-3.5">
          {/* Option 1: Translate / Read Pages */}
          <button
            onClick={() => {
              onClose();
              onSelectTranslate(chapter);
            }}
            className="group relative flex items-center gap-4 p-4 rounded-2xl bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 hover:border-rose-500/50 transition-all text-right cursor-pointer shadow-sm hover:shadow-lg hover:shadow-rose-500/5 active:scale-[0.98]"
          >
            <div className="p-3.5 rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20 group-hover:scale-105 transition-transform flex-shrink-0">
              <Heart className="h-6 w-6 fill-current" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm sm:text-base text-white group-hover:text-rose-400 transition-colors">
                  ❤️ ترجمة الصفحات
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                  القارئ الذكي
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                فتح نظام القراءة الذكي والترجمة الفورية للصفحات وOCR مع تشغيل الأصوات.
              </p>
            </div>

            <ArrowLeft className="h-4 w-4 text-slate-500 group-hover:text-rose-400 group-hover:-translate-x-1 transition-all flex-shrink-0" />
          </button>

          {/* Option 2: Create Video */}
          <button
            onClick={() => {
              onClose();
              onSelectVideo(chapter);
            }}
            className="group relative flex items-center gap-4 p-4 rounded-2xl bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/50 transition-all text-right cursor-pointer shadow-sm hover:shadow-lg hover:shadow-emerald-500/5 active:scale-[0.98]"
          >
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover:scale-105 transition-transform flex-shrink-0">
              <Film className="h-6 w-6" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm sm:text-base text-white group-hover:text-emerald-400 transition-colors">
                  🎬 إنشاء فيديوهات
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
                  جديد
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                تحويل صفحات الفصل لفيلم مانهاوا قصصي ناطق مع حركة الكاميرا والتعليق الصوتي.
              </p>
            </div>

            <ArrowLeft className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 group-hover:-translate-x-1 transition-all flex-shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}
