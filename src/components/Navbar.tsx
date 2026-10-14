import React from "react";
import {
  BookOpen,
  Sparkles,
  Globe,
  Search,
  UploadCloud,
  Heart,
  Bookmark,
  Puzzle,
  Settings,
  Film,
  Tv,
  BookMarked,
  History,
} from "lucide-react";
import { TARGET_LANGUAGES, Language } from "../types";

export type AppViewId =
  | "catalogue"
  | "studio"
  | "favorites"
  | "library"
  | "details"
  | "source_details"
  | "reader"
  | "settings"
  | "extensions"
  | "history"
  | "gemini-tts"
  | "video-dubbing"
  | "manhwa-video"
  | "novel-to-manga";

interface NavbarProps {
  currentView?: AppViewId | string;
  onViewChange?: (view: any) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onSearchSubmit?: (e: React.FormEvent) => void;
  // Legacy optional props for backwards compatibility
  activeTab?: string;
  setActiveTab?: (tab: any) => void;
  targetLang?: Language;
  setTargetLang?: (lang: Language) => void;
  setSearchQuery?: (q: string) => void;
  onSearch?: (e: React.FormEvent) => void;
}

export default function Navbar({
  currentView,
  onViewChange,
  searchQuery = "",
  onSearchChange,
  onSearchSubmit,
  activeTab,
  setActiveTab,
  targetLang,
  setTargetLang,
  setSearchQuery,
  onSearch,
}: NavbarProps) {
  const activeView = currentView || activeTab || "catalogue";

  // Hide top navbar in full-screen reader view
  if (activeView === "reader") return null;

  const handleSelectView = (view: AppViewId) => {
    if (onViewChange) {
      onViewChange(view);
    } else if (setActiveTab) {
      setActiveTab(view);
    }
  };

  const handleQueryChange = (value: string) => {
    if (onSearchChange) {
      onSearchChange(value);
    } else if (setSearchQuery) {
      setSearchQuery(value);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    if (onSearchSubmit) {
      onSearchSubmit(e);
    } else if (onSearch) {
      onSearch(e);
    } else {
      e.preventDefault();
    }
  };

  const navItems: Array<{
    id: AppViewId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    accent?: string;
    badge?: string;
  }> = [
    { id: "catalogue", label: "المصادر", icon: Globe, accent: "text-emerald-400" },
    { id: "novel-to-manga", label: "الرواية ⬅ مانجا 1.1", icon: BookMarked, accent: "text-emerald-400", badge: "1.1" },
    { id: "manhwa-video", label: "فيديو المانهاوا", icon: Film, accent: "text-amber-400" },
    { id: "video-dubbing", label: "دبلجة الفيديو", icon: Tv, accent: "text-cyan-400" },
    { id: "studio", label: "رفع وترجمة", icon: UploadCloud },
    { id: "favorites", label: "المفضلة", icon: Heart, accent: "text-rose-400" },
    { id: "library", label: "مكتبتي", icon: Bookmark },
    { id: "history", label: "السجل", icon: History },
    { id: "gemini-tts", label: "Gemini TTS", icon: Sparkles, accent: "text-teal-400" },
    { id: "extensions", label: "الإضافات", icon: Puzzle },
    { id: "settings", label: "الإعدادات", icon: Settings },
  ];

  const effectiveLang = targetLang || TARGET_LANGUAGES[0];

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md" dir="rtl">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-3">
          {/* Brand + Desktop Navigation */}
          <div className="flex items-center gap-3 lg:gap-5 overflow-x-auto no-scrollbar">
            <div
              onClick={() => handleSelectView("catalogue")}
              className="flex cursor-pointer items-center gap-2.5 shrink-0"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-slate-950 shadow-lg shadow-emerald-500/20">
                <BookOpen className="h-5 w-5" />
              </div>
              <span className="text-base sm:text-lg font-extrabold tracking-tight text-white">
                AI Manga <span className="text-emerald-400">Reader</span>
              </span>
            </div>

            <div className="hidden md:flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  activeView === item.id ||
                  (item.id === "catalogue" && (activeView === "details" || activeView === "source_details"));

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectView(item.id)}
                    className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                      isActive
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm"
                        : "text-slate-400 hover:bg-slate-900 hover:text-white border border-transparent"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isActive ? "text-emerald-400" : item.accent || "text-slate-400"}`} />
                    <span>{item.label}</span>
                    {item.badge && (
                      <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-mono font-bold text-emerald-300 border border-emerald-500/30">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search Bar & Optional Language Selector */}
          <div className="flex items-center gap-2 shrink-0">
            <form onSubmit={handleFormSubmit} className="relative">
              <Search className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="ابحث في جميع المصادر..."
                value={searchQuery}
                onChange={(e) => handleQueryChange(e.target.value)}
                className="h-9 w-40 sm:w-56 rounded-xl border border-slate-800 bg-slate-900/90 pr-9 pl-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500/60 focus:outline-none transition-all"
              />
            </form>

            {setTargetLang && (
              <div className="hidden lg:flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/80 px-2.5 py-1.5">
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                <select
                  value={effectiveLang.code}
                  onChange={(e) => {
                    const lang = TARGET_LANGUAGES.find((l) => l.code === e.target.value);
                    if (lang) setTargetLang(lang);
                  }}
                  className="bg-transparent text-xs font-medium text-white focus:outline-none cursor-pointer"
                >
                  {TARGET_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code} className="bg-slate-900 text-white">
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
