import React from "react";
import { BookOpen, Bookmark, Settings, Heart, Puzzle, History, UploadCloud, Sparkles, Film } from "lucide-react";

interface MobileBottomNavProps {
  currentView: "catalogue" | "studio" | "favorites" | "library" | "details" | "reader" | "settings" | "extensions" | "history" | "gemini-tts" | "video-dubbing" | "manhwa-video" | "novel-to-manga";
  onViewChange: (view: "catalogue" | "studio" | "favorites" | "library" | "settings" | "extensions" | "history" | "gemini-tts" | "video-dubbing" | "manhwa-video" | "novel-to-manga") => void;
}

export default function MobileBottomNav({ currentView, onViewChange }: MobileBottomNavProps) {
  // Hide bottom bar completely in reader view for maximum screen immersion
  if (currentView === "reader") return null;

  const navItems = [
    {
      id: "catalogue" as const,
      label: "المصادر",
      icon: BookOpen,
      badge: "2.2K+",
    },
    {
      id: "novel-to-manga" as const,
      label: "Novel→Manga",
      icon: Sparkles,
      badge: "1.1",
    },
    {
      id: "manhwa-video" as const,
      label: "فيديو المانهاوا",
      icon: Film,
      badge: "جديد",
    },
    {
      id: "video-dubbing" as const,
      label: "دبلجة الفيديو",
      icon: Film,
    },
    {
      id: "studio" as const,
      label: "رفع ملفات",
      icon: UploadCloud,
    },
    {
      id: "favorites" as const,
      label: "المفضلة",
      icon: Heart,
    },
    {
      id: "library" as const,
      label: "مكتبتي",
      icon: Bookmark,
    },
    {
      id: "history" as const,
      label: "السجل",
      icon: History,
    },
    {
      id: "gemini-tts" as const,
      label: "Gemini TTS",
      icon: Sparkles,
      badge: "جديد",
    },
    {
      id: "extensions" as const,
      label: "الإضافات",
      icon: Puzzle,
    },
    {
      id: "settings" as const,
      label: "الإعدادات",
      icon: Settings,
    },
  ];

  return (
    <nav
      id="mobile-bottom-navigation"
      aria-label="التنقل الرئيسي للهواتف"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800/80 bg-slate-950/92 backdrop-blur-lg sm:hidden pb-[max(env(safe-area-inset-bottom),8px)] pt-1 px-2 shadow-2xl shadow-black/80"
    >
      <div className="flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id || (item.id === "catalogue" && currentView === "details");

          return (
            <button
              key={item.id}
              id={`nav-tab-${item.id}`}
              type="button"
              onClick={() => onViewChange(item.id)}
              className={`relative flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-center transition-all duration-200 active:scale-90 ${
                isActive
                  ? "text-emerald-400 font-bold"
                  : "text-slate-400 hover:text-slate-200 font-medium"
              }`}
            >
              {/* Active pill glow */}
              {isActive && (
                <span className="absolute -top-1 h-0.5 w-7 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              )}

              <div className="relative">
                <Icon
                  className={`h-5 w-5 transition-transform duration-200 ${
                    isActive ? "scale-110 stroke-[2.4]" : "stroke-[1.8]"
                  } ${item.id === "favorites" && isActive ? "fill-emerald-400" : ""}`}
                />
                {item.badge && (
                  <span className="absolute -top-1 -right-2.5 rounded-full bg-emerald-500/20 px-1 py-0.2 text-[8px] font-mono font-bold text-emerald-300 border border-emerald-500/40 leading-none">
                    {item.badge}
                  </span>
                )}
              </div>

              <span className="text-[10px] tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
