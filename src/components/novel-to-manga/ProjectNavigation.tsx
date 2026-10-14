import React, { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Eye,
  FileText,
  History,
  Home,
  Image as ImageIcon,
  Layers,
  MoreHorizontal,
  Play,
  Settings,
  X,
} from "lucide-react";

export type NovelMangaTabId =
  | "overview"
  | "novel"
  | "visual_bible"
  | "references"
  | "pages"
  | "queue"
  | "review"
  | "history";

interface ProjectNavigationProps {
  activeTab: NovelMangaTabId;
  onSelectTab: (tab: NovelMangaTabId) => void;
  onNavigateToSettings?: () => void;
}

export const NOVEL_MANGA_TABS: Array<{
  id: NovelMangaTabId;
  label: string;
  icon: React.ElementType;
}> = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "novel", label: "Novel", icon: BookOpen },
  { id: "visual_bible", label: "Visual Bible", icon: Layers },
  { id: "references", label: "References", icon: ImageIcon },
  { id: "pages", label: "Pages", icon: FileText },
  { id: "queue", label: "Queue", icon: Play },
  { id: "review", label: "Review", icon: Eye },
  { id: "history", label: "History", icon: History },
];

export function DesktopSidebarNavigation({
  activeTab,
  onSelectTab,
  onNavigateToSettings,
}: ProjectNavigationProps) {
  return (
    <aside className="hidden lg:flex lg:w-56 shrink-0 flex-col justify-between rounded-xl bg-slate-900/50 border border-slate-800/80 p-3 self-start sticky top-20">
      <nav className="flex flex-col gap-1" aria-label="Novel to Manga Navigation">
        {NOVEL_MANGA_TABS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition cursor-pointer text-right ${
                active
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {onNavigateToSettings && (
        <div className="pt-3 mt-4 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onNavigateToSettings}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-white transition cursor-pointer"
          >
            <Settings className="h-4 w-4 shrink-0 text-slate-400" />
            <span>Settings</span>
          </button>
        </div>
      )}
    </aside>
  );
}

export function HorizontalAndMobileNavigation({
  activeTab,
  onSelectTab,
  onNavigateToSettings,
}: ProjectNavigationProps) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  return (
    <>
      {/* Horizontal Scrollable Bar for Tablet / Small Desktop */}
      <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-2 mb-4 border-b border-slate-800/80">
        {NOVEL_MANGA_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                active
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "text-slate-400 hover:bg-slate-900 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}

        {onNavigateToSettings && (
          <button
            type="button"
            onClick={onNavigateToSettings}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap text-slate-400 hover:bg-slate-900 hover:text-white transition cursor-pointer mr-auto"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Settings</span>
          </button>
        )}
      </div>

      {/* Mobile Dedicated Bottom Navigation (Home, Novel, References, Pages, More) */}
      <div className="fixed bottom-14 left-3 right-3 z-30 sm:hidden rounded-xl bg-slate-900/95 border border-slate-800 backdrop-blur-md px-2 py-1.5 shadow-xl">
        <div className="grid grid-cols-5 gap-1">
          <button
            type="button"
            onClick={() => {
              onSelectTab("overview");
              setIsMoreOpen(false);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
              activeTab === "overview" ? "text-emerald-400 bg-emerald-500/10" : "text-slate-400"
            }`}
          >
            <Home className="h-4 w-4 mb-0.5" />
            <span>Home</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectTab("novel");
              setIsMoreOpen(false);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
              activeTab === "novel" ? "text-emerald-400 bg-emerald-500/10" : "text-slate-400"
            }`}
          >
            <BookOpen className="h-4 w-4 mb-0.5" />
            <span>Novel</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectTab("references");
              setIsMoreOpen(false);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
              activeTab === "references" || activeTab === "visual_bible"
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-slate-400"
            }`}
          >
            <ImageIcon className="h-4 w-4 mb-0.5" />
            <span>References</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectTab("pages");
              setIsMoreOpen(false);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
              activeTab === "pages" ? "text-emerald-400 bg-emerald-500/10" : "text-slate-400"
            }`}
          >
            <FileText className="h-4 w-4 mb-0.5" />
            <span>Pages</span>
          </button>

          <button
            type="button"
            onClick={() => setIsMoreOpen((v) => !v)}
            className={`flex flex-col items-center justify-center py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer ${
              isMoreOpen || ["queue", "review", "history"].includes(activeTab)
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-slate-400"
            }`}
          >
            <MoreHorizontal className="h-4 w-4 mb-0.5" />
            <span>More</span>
          </button>
        </div>

        {/* More Sheet */}
        {isMoreOpen && (
          <div className="mt-2 pt-2 border-t border-slate-800 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => {
                onSelectTab("visual_bible");
                setIsMoreOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 text-xs text-slate-200 font-semibold"
            >
              <Layers className="h-3.5 w-3.5 text-emerald-400" />
              <span>Visual Bible</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectTab("queue");
                setIsMoreOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 text-xs text-slate-200 font-semibold"
            >
              <Play className="h-3.5 w-3.5 text-emerald-400" />
              <span>Queue</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectTab("review");
                setIsMoreOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 text-xs text-slate-200 font-semibold"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Review</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onSelectTab("history");
                setIsMoreOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-950 text-xs text-slate-200 font-semibold"
            >
              <History className="h-3.5 w-3.5 text-emerald-400" />
              <span>History</span>
            </button>

            {onNavigateToSettings && (
              <button
                type="button"
                onClick={() => {
                  setIsMoreOpen(false);
                  onNavigateToSettings();
                }}
                className="col-span-2 flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950 text-xs text-slate-200 font-semibold"
              >
                <span className="flex items-center gap-2">
                  <Settings className="h-3.5 w-3.5 text-slate-400" />
                  <span>Settings</span>
                </span>
                <X className="h-3.5 w-3.5 text-slate-500" />
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
