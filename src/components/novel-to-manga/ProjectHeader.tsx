import React from "react";
import { AlertTriangle, FolderOpen, Plus } from "lucide-react";

export interface SavedNovelProjectMeta {
  id: string;
  title: string;
  chapterLabel: string;
  updatedAt: string;
}

interface ProjectHeaderProps {
  projectTitle: string;
  chapterLabel: string;
  geminiConnected: boolean;
  flowConnected: boolean;
  activeErrorCount: number;
  onNewProject: () => void;
  onOpenProjectModal: () => void;
  onOpenErrorCenter: () => void;
}

export default function ProjectHeader({
  projectTitle,
  chapterLabel,
  geminiConnected,
  flowConnected,
  activeErrorCount,
  onNewProject,
  onOpenProjectModal,
  onOpenErrorCenter,
}: ProjectHeaderProps) {
  return (
    <div className="border-b border-slate-800/80 pb-4 mb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-medium text-slate-400">AI Manga Reader</div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
            Novel → Manga Pages 1.1
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 mt-1.5">
            <span className="font-semibold text-white">Project: {projectTitle}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">{chapterLabel}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="inline-flex items-center gap-1 text-slate-300">
              <span
                className={`h-2 w-2 rounded-full ${
                  geminiConnected ? "bg-emerald-400" : "bg-slate-500"
                }`}
              />
              Gemini
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="inline-flex items-center gap-1 text-slate-300">
              <span
                className={`h-2 w-2 rounded-full ${
                  flowConnected ? "bg-emerald-400" : "bg-slate-500"
                }`}
              />
              Flow
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {activeErrorCount > 0 && (
            <button
              type="button"
              onClick={onOpenErrorCenter}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition cursor-pointer"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
              <span>⚠ {activeErrorCount} Errors</span>
            </button>
          )}

          <button
            type="button"
            onClick={onNewProject}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>مشروع جديد</span>
          </button>

          <button
            type="button"
            onClick={onOpenProjectModal}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition cursor-pointer"
          >
            <FolderOpen className="h-3.5 w-3.5 text-slate-400" />
            <span>فتح مشروع</span>
          </button>
        </div>
      </div>
    </div>
  );
}
