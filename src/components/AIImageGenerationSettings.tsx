import React, { useState, useEffect } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type {
  FlowAuthStatus,
  FlowConnectionStatus,
  FlowDisplayModelName,
  FlowErrorEntry,
  FlowGenerationTaskType,
  FlowHistoryEntry,
  FlowSessionStatus,
  FlowTaskModelMap,
  GeminiCookieModelId,
  GeminiNovelTaskType,
  GeminiTaskModelMap,
  GoogleFlowModelDescriptor,
  GoogleFlowProject,
} from "../types/novelToManga";
import {
  GEMINI_TASK_DESCRIPTORS,
  MAX_GOOGLE_FLOW_PROJECTS,
} from "../types/novelToManga";
import {
  discoverGoogleFlowModels,
  fetchGoogleFlowStatus,
  loadFlowCookies,
  loadFlowProjects,
  loadFlowTaskModels,
  loadGeminiTaskModels,
  saveFlowCookies,
  saveFlowProjects,
  saveFlowTaskModels,
  saveGeminiTaskModels,
  testGoogleFlowConnection,
  testGoogleFlowGeneration,
  testGoogleFlowUpload,
} from "../services/novelToMangaClient";

export type SettingsSubSectionId =
  | "gemini_cookies"
  | "google_flow"
  | "flow_projects"
  | "image_models"
  | "advanced";

export const COMPACT_GEMINI_MODELS_LIST: Array<{
  id: GeminiCookieModelId;
  title: string;
  shortTag: string;
}> = [
  { id: "3.5-flash-lite", title: "3.5 Flash-Lite", shortTag: "⚡ سريع" },
  {
    id: "3.5-flash-lite-extended",
    title: "3.5 Flash-Lite Extended",
    shortTag: "🧠 تفكير موسع",
  },
  { id: "3.6-flash", title: "3.6 Flash", shortTag: "🌟 متوازن" },
  { id: "3.1-pro", title: "3.1 Pro", shortTag: "🧠 متقدم" },
];

interface AIImageGenerationSettingsProps {
  activeSubSection?: SettingsSubSectionId;
  geminiCookies: string;
  geminiStatus: string;
  selectedDefaultGeminiModel: string;
  onSelectDefaultGeminiModel: (modelId: string) => void;
  onTestGemini?: () => void;
  isTestingGemini?: boolean;
  onOpenGeminiCookieModal?: () => void;
}

export default function AIImageGenerationSettings({
  activeSubSection = "google_flow",
  geminiCookies,
  geminiStatus,
  selectedDefaultGeminiModel,
  onSelectDefaultGeminiModel,
  onTestGemini,
  isTestingGemini,
  onOpenGeminiCookieModal,
}: AIImageGenerationSettingsProps) {
  const [geminiTaskModels, setGeminiTaskModels] = useState<GeminiTaskModelMap>(() =>
    loadGeminiTaskModels()
  );

  const [flowCookies, setFlowCookies] = useState<string>(() => loadFlowCookies());
  const [connectionStatus, setConnectionStatus] =
    useState<FlowConnectionStatus>("Disconnected");
  const [authStatus, setAuthStatus] = useState<FlowAuthStatus>("Unauthenticated");
  const [sessionStatus, setSessionStatus] = useState<FlowSessionStatus>("Missing");
  const [projects, setProjects] = useState<GoogleFlowProject[]>(() =>
    loadFlowProjects()
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>("flow_project_1");

  const [discoveredModels, setDiscoveredModels] = useState<
    GoogleFlowModelDescriptor[]
  >([
    {
      display_name: "Nano Banana Pro",
      ui_key: "nano_banana_pro",
      internal_model_id: null,
      available: false,
      status_label: "Unavailable",
      description_ar: "أعلى دقة لتوليد المراجع البصرية.",
      resolution_support: "2K",
      recommended_for: "Reference Generation",
    },
    {
      display_name: "Nano Banana 2",
      ui_key: "nano_banana_2",
      internal_model_id: null,
      available: false,
      status_label: "Unavailable",
      description_ar: "متوازن لتوليد المشاهد وصفحات المانجا.",
      resolution_support: "1024x1536",
      recommended_for: "Scene Generation",
    },
    {
      display_name: "Nano Banana 2 Lite",
      ui_key: "nano_banana_2_lite",
      internal_model_id: null,
      available: false,
      status_label: "Unavailable",
      description_ar: "سريع للاختبارات المسبقة.",
      resolution_support: "1024x1024",
      recommended_for: "Fast Test",
    },
  ]);

  const [flowTaskModels, setFlowTaskModels] = useState<FlowTaskModelMap>(() =>
    loadFlowTaskModels()
  );
  const [history, setHistory] = useState<FlowHistoryEntry[]>([]);
  const [errors, setErrors] = useState<FlowErrorEntry[]>([]);

  // Loading states
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isTestingUpload, setIsTestingUpload] = useState(false);
  const [isTestingGen, setIsTestingGen] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  // Modals & Toggles
  const [showAdvancedModelIds, setShowAdvancedModelIds] = useState(false);
  const [projectDetailsModal, setProjectDetailsModal] =
    useState<GoogleFlowProject | null>(null);
  const [openErrorTechId, setOpenErrorTechId] = useState<string | null>(null);
  const [isFlowSessionModalOpen, setIsFlowSessionModalOpen] = useState(false);
  const [flowSessionDraft, setFlowSessionDraft] = useState("");
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    refreshFlowStatus();
  }, []);

  const refreshFlowStatus = async () => {
    try {
      const data = await fetchGoogleFlowStatus();
      if (data && data.success) {
        setConnectionStatus(data.connection_status || "Disconnected");
        setAuthStatus(data.authentication_status || "Unauthenticated");
        setSessionStatus(data.session_status || "Missing");
        if (Array.isArray(data.projects)) {
          setProjects(data.projects);
          saveFlowProjects(data.projects);
        }
        if (Array.isArray(data.models)) {
          setDiscoveredModels(data.models);
        }
        if (Array.isArray(data.history)) setHistory(data.history);
        if (Array.isArray(data.errors)) setErrors(data.errors);
      }
    } catch (_) {}
  };

  const handleGeminiTaskModelChange = (
    task: GeminiNovelTaskType,
    modelId: GeminiCookieModelId
  ) => {
    const updated = { ...geminiTaskModels, [task]: modelId };
    setGeminiTaskModels(updated);
    saveGeminiTaskModels(updated);
  };

  const handleFlowTaskModelChange = (
    task: FlowGenerationTaskType,
    modelName: FlowDisplayModelName
  ) => {
    const updated = { ...flowTaskModels, [task]: modelName };
    setFlowTaskModels(updated);
    saveFlowTaskModels(updated);
  };

  const handleTestConnection = async (targetProjId?: string) => {
    if (targetProjId) setBusyProjectId(targetProjId);
    else setIsTestingConnection(true);
    setNotice(null);

    try {
      const res = await testGoogleFlowConnection(
        flowCookies,
        targetProjId || selectedProjectId
      );
      setConnectionStatus(
        res.connection_status || (res.success ? "Connected" : "Disconnected")
      );
      setAuthStatus(
        res.authentication_status || (res.success ? "Authenticated" : "Expired")
      );
      setSessionStatus(
        res.session_status || (res.success ? "Connected" : "Expired")
      );
      if (Array.isArray(res.projects)) {
        setProjects(res.projects);
        saveFlowProjects(res.projects);
      }
      if (Array.isArray(res.models)) {
        setDiscoveredModels(res.models);
      }
      if (Array.isArray(res.history)) setHistory(res.history);
      if (Array.isArray(res.errors)) setErrors(res.errors);

      setNotice({
        type: res.success ? "success" : "error",
        text: res.message || res.error || "اكتمل فحص الاتصال.",
      });
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err?.message || "تعذر الاتصال بـ Google Flow.",
      });
    } finally {
      setIsTestingConnection(false);
      setBusyProjectId(null);
    }
  };

  const handleTestUpload = async () => {
    setIsTestingUpload(true);
    setNotice(null);
    try {
      const res = await testGoogleFlowUpload({
        flowCookies,
        projectId: selectedProjectId,
      });
      if (Array.isArray(res.history)) setHistory(res.history);
      if (Array.isArray(res.errors)) setErrors(res.errors);
      setNotice({
        type: res.success ? "success" : "error",
        text: res.message || res.error || "اكتمل فحص رفع الصورة.",
      });
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err?.message || "فشل فحص الرفع.",
      });
    } finally {
      setIsTestingUpload(false);
    }
  };

  const handleTestGeneration = async () => {
    setIsTestingGen(true);
    setNotice(null);
    try {
      const res = await testGoogleFlowGeneration({
        flowCookies,
        projectId: selectedProjectId,
        modelDisplayName: flowTaskModels.reference_generation,
      });
      if (Array.isArray(res.projects)) {
        setProjects(res.projects);
        saveFlowProjects(res.projects);
      }
      if (Array.isArray(res.history)) setHistory(res.history);
      if (Array.isArray(res.errors)) setErrors(res.errors);
      setNotice({
        type: res.success ? "success" : "error",
        text: res.message || res.error || "اكتمل فحص التوليد.",
      });
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err?.message || "فشل فحص التوليد.",
      });
    } finally {
      setIsTestingGen(false);
    }
  };

  const handleToggleProjectStatus = async (proj: GoogleFlowProject) => {
    const nextStatus = proj.status === "DISABLED" ? "ACTIVE" : "DISABLED";
    if (nextStatus === "DISABLED") {
      const activeCount = projects.filter((p) => p.status === "ACTIVE" && p.available).length;
      if (activeCount <= 1 && proj.status === "ACTIVE") {
        setNotice({
          type: "error",
          text: "FLOW_LAST_ACTIVE_PROJECT_PROTECTED: لا يمكن تعطيل آخر مشروع نشط في Google Flow لضمان استمرارية التوليد المتوازي.",
        });
        return;
      }
    }
    try {
      const resp = await fetch("/api/google-flow/projects/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: proj.project_id,
          status: nextStatus,
          rawSession: flowCookies,
        }),
      });
      const data = await resp.json();
      if (data.success && Array.isArray(data.projects)) {
        setProjects(data.projects);
        saveFlowProjects(data.projects);
      } else if (data.error) {
        setNotice({
          type: "error",
          text: data.error,
        });
      }
    } catch (_) {}
  };

  const handleRemoveProject = async (projectId: string) => {
    try {
      const resp = await fetch("/api/google-flow/projects/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await resp.json();
      if (data.success && Array.isArray(data.projects)) {
        setProjects(data.projects);
        saveFlowProjects(data.projects);
      }
    } catch (_) {}
  };

  const handleAddProject = async () => {
    if (projects.length >= MAX_GOOGLE_FLOW_PROJECTS) return;
    try {
      const resp = await fetch("/api/google-flow/projects/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Project ${projects.length + 1}`,
          rawSession: flowCookies,
          enabled: true,
        }),
      });
      const data = await resp.json();
      if (data.success && Array.isArray(data.projects)) {
        setProjects(data.projects);
        saveFlowProjects(data.projects);
      }
    } catch (_) {}
  };

  const isGeminiConnected =
    geminiStatus === "Connected" || Boolean(geminiCookies.includes("__Secure-1PSID"));

  const currentProjectObj =
    projects.find((p) => p.project_id === selectedProjectId) || projects[0];

  return (
    <div className="flex flex-col gap-6" dir="rtl">
      {notice && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            notice.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : "bg-rose-500/10 border-rose-500/30 text-rose-300"
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* 1. SETTINGS → GEMINI COOKIES (Requirements 6 & 14)                  */}
      {/* =================================================================== */}
      {activeSubSection === "gemini_cookies" && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-6 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Gemini Cookies</h2>
            {onOpenGeminiCookieModal && (
              <button
                type="button"
                onClick={onOpenGeminiCookieModal}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                تحديث الجلسة
              </button>
            )}
          </div>

          {/* Masked Connection & Session Summary (Never exposes raw cookie string — Requirement 14) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs font-mono">
            <div>
              <span className="text-slate-400 block font-sans mb-1">Connection</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-white">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isGeminiConnected ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                {isGeminiConnected ? "Connected" : "Disconnected"}
              </span>
            </div>

            <div>
              <span className="text-slate-400 block font-sans mb-1">Active Models</span>
              <strong className="text-white">4</strong>
            </div>

            <div>
              <span className="text-slate-400 block font-sans mb-1">Status</span>
              <strong className="text-emerald-400">
                {isGeminiConnected ? "Authenticated" : "Missing"}
              </strong>
            </div>

            <div>
              <span className="text-slate-400 block font-sans mb-1">Session</span>
              <strong className="text-slate-300">
                {geminiCookies.trim() ? "Session Valid · ••••••" : "Not Set"}
              </strong>
            </div>
          </div>

          {/* Compact 4 Gemini Model Cards (Requirement 6) */}
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-2.5">Gemini Model</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {COMPACT_GEMINI_MODELS_LIST.map((m) => {
                const isSelected = selectedDefaultGeminiModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelectDefaultGeminiModel(m.id)}
                    className={`p-3.5 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                      isSelected
                        ? "bg-emerald-500/10 border-emerald-500/50 text-white"
                        : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <div className="text-xs font-bold text-white">{m.title}</div>
                    <div className="text-[11px] text-slate-400">{m.shortTag}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary Task Selectors: Analysis, Review, Prompt (Requirement 6 & 14) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800/80">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Default Analysis Model
              </label>
              <select
                value={geminiTaskModels.novel_analysis}
                onChange={(e) =>
                  handleGeminiTaskModelChange(
                    "novel_analysis",
                    e.target.value as GeminiCookieModelId
                  )
                }
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white"
              >
                {COMPACT_GEMINI_MODELS_LIST.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Default Review Model
              </label>
              <select
                value={geminiTaskModels.page_review}
                onChange={(e) => {
                  const val = e.target.value as GeminiCookieModelId;
                  const updated = {
                    ...geminiTaskModels,
                    page_review: val,
                    reference_review: val,
                  };
                  setGeminiTaskModels(updated);
                  saveGeminiTaskModels(updated);
                }}
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white"
              >
                {COMPACT_GEMINI_MODELS_LIST.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Prompt Model</label>
              <select
                value={geminiTaskModels.prompt_generation}
                onChange={(e) =>
                  handleGeminiTaskModelChange(
                    "prompt_generation",
                    e.target.value as GeminiCookieModelId
                  )
                }
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white"
              >
                {COMPACT_GEMINI_MODELS_LIST.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {onTestGemini && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onTestGemini}
                disabled={isTestingGemini}
                className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
              >
                {isTestingGemini && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Test Gemini</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* 2. SETTINGS → GOOGLE FLOW (Requirement 15)                          */}
      {/* =================================================================== */}
      {activeSubSection === "google_flow" && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-6 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Google Flow</h2>
            <button
              type="button"
              onClick={() => {
                setFlowSessionDraft("");
                setIsFlowSessionModalOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
            >
              إعداد الجلسة
            </button>
          </div>

          {/* Connection / Authentication / Session */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs font-mono">
            <div>
              <span className="text-slate-400 block font-sans mb-1">Connection</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-white">
                <span
                  className={`h-2 w-2 rounded-full ${
                    connectionStatus === "Connected" ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                {connectionStatus}
              </span>
            </div>

            <div>
              <span className="text-slate-400 block font-sans mb-1">Authentication</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-white">
                <span
                  className={`h-2 w-2 rounded-full ${
                    authStatus === "Authenticated" ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                {authStatus}
              </span>
            </div>

            <div>
              <span className="text-slate-400 block font-sans mb-1">Session</span>
              <span className="inline-flex items-center gap-1.5 font-bold text-white">
                <span
                  className={`h-2 w-2 rounded-full ${
                    sessionStatus === "Connected" ? "bg-emerald-400" : "bg-amber-400"
                  }`}
                />
                {sessionStatus === "Connected" ? "Active · ••••••" : sessionStatus}
              </span>
            </div>
          </div>

          {/* 3 Test Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleTestConnection()}
              disabled={isTestingConnection}
              className="py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isTestingConnection && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Test Connection</span>
            </button>

            <button
              type="button"
              onClick={handleTestUpload}
              disabled={isTestingUpload}
              className="py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isTestingUpload && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Test Upload</span>
            </button>

            <button
              type="button"
              onClick={handleTestGeneration}
              disabled={isTestingGen}
              className="py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isTestingGen && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Test Generation</span>
            </button>
          </div>

          {/* Current Project & Image Model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-800/80">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Current Project
              </label>
              <select
                value={currentProjectObj?.project_id || "flow_project_1"}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white"
              >
                {projects.map((p) => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.name} ({p.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Image Model</label>
              <select
                value={flowTaskModels.reference_generation}
                onChange={(e) =>
                  handleFlowTaskModelChange(
                    "reference_generation",
                    e.target.value as FlowDisplayModelName
                  )
                }
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white"
              >
                <option value="Nano Banana Pro">Nano Banana Pro</option>
                <option value="Nano Banana 2">Nano Banana 2</option>
                <option value="Nano Banana 2 Lite">Nano Banana 2 Lite</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 3. SETTINGS → FLOW PROJECTS (Requirement 16)                        */}
      {/* =================================================================== */}
      {activeSubSection === "flow_projects" && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Flow Projects</h2>
              <span className="text-xs font-mono text-slate-400">
                {projects.length} / {MAX_GOOGLE_FLOW_PROJECTS} Projects
              </span>
            </div>

            {projects.length < MAX_GOOGLE_FLOW_PROJECTS && (
              <button
                type="button"
                onClick={handleAddProject}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Project</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {projects.map((proj) => {
              const isBusy = busyProjectId === proj.project_id;
              const lastGenTime = proj.last_generation
                ? new Date(proj.last_generation).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : null;

              return (
                <div
                  key={proj.project_id}
                  className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <strong className="text-sm text-white">{proj.name}</strong>
                      <span
                        className={`text-xs font-mono font-bold ${
                          proj.status === "ACTIVE"
                            ? "text-emerald-400"
                            : proj.status === "DISABLED"
                            ? "text-slate-500"
                            : "text-amber-400"
                        }`}
                      >
                        ● {proj.status}
                      </span>
                    </div>

                    {lastGenTime && (
                      <div className="text-xs font-mono text-slate-400">
                        Last generation: {lastGenTime}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => handleTestConnection(proj.project_id)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {isBusy ? "..." : "اختبار"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleProjectStatus(proj)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                    >
                      {proj.status === "DISABLED" ? "تفعيل" : "تعطيل"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setProjectDetailsModal(proj)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      عرض التفاصيل
                    </button>

                    {projects.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveProject(proj.project_id)}
                        className="px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-950/40 text-xs font-semibold mr-auto cursor-pointer"
                      >
                        حذف
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 4. SETTINGS → IMAGE MODELS (Requirement 18)                         */}
      {/* =================================================================== */}
      {activeSubSection === "image_models" && (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-6 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Image Models</h2>
            <button
              type="button"
              onClick={() => setShowAdvancedModelIds((v) => !v)}
              className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-mono cursor-pointer"
            >
              Advanced
            </button>
          </div>

          {/* 3 Model Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {discoveredModels.map((mdl) => (
              <div
                key={mdl.ui_key}
                className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-2"
              >
                <div>
                  <div className="text-sm font-bold text-white">{mdl.display_name}</div>
                  <div
                    className={`text-xs font-mono font-semibold mt-1 ${
                      mdl.available ? "text-emerald-400" : "text-slate-500"
                    }`}
                  >
                    {mdl.status_label}
                  </div>
                </div>

                {showAdvancedModelIds && (
                  <div className="pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-400" dir="ltr">
                    ID: {mdl.internal_model_id || "Unavailable"}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Task Model Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-800/80">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Reference Generation
              </label>
              <select
                value={flowTaskModels.reference_generation}
                onChange={(e) =>
                  handleFlowTaskModelChange(
                    "reference_generation",
                    e.target.value as FlowDisplayModelName
                  )
                }
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white"
              >
                <option value="Nano Banana Pro">Nano Banana Pro</option>
                <option value="Nano Banana 2">Nano Banana 2</option>
                <option value="Nano Banana 2 Lite">Nano Banana 2 Lite</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Scene Generation
              </label>
              <select
                value={flowTaskModels.scene_generation}
                onChange={(e) =>
                  handleFlowTaskModelChange(
                    "scene_generation",
                    e.target.value as FlowDisplayModelName
                  )
                }
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white"
              >
                <option value="Nano Banana Pro">Nano Banana Pro</option>
                <option value="Nano Banana 2">Nano Banana 2</option>
                <option value="Nano Banana 2 Lite">Nano Banana 2 Lite</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Fast Test</label>
              <select
                value={flowTaskModels.fast_generation}
                onChange={(e) =>
                  handleFlowTaskModelChange(
                    "fast_generation",
                    e.target.value as FlowDisplayModelName
                  )
                }
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-semibold text-white"
              >
                <option value="Nano Banana Pro">Nano Banana Pro</option>
                <option value="Nano Banana 2">Nano Banana 2</option>
                <option value="Nano Banana 2 Lite">Nano Banana 2 Lite</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 5. SETTINGS → ADVANCED / HISTORY & ERRORS (Requirement 17 & 30)     */}
      {/* =================================================================== */}
      {activeSubSection === "advanced" && (
        <div className="flex flex-col gap-6">
          {/* Flow Errors Section (Requirement 17) */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-white">Flow History & Errors</h2>

            {errors.length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد أخطاء مسجلة في Google Flow.</p>
            ) : (
              <div className="space-y-3">
                {errors.slice(0, 15).map((err) => {
                  const isTechOpen = openErrorTechId === err.id;
                  const timeStr = new Date(err.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <div
                      key={err.id}
                      className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between font-mono text-xs">
                        <strong className="text-rose-400">{err.error_code}</strong>
                        <span className="text-slate-400">
                          {err.project_id.replace("flow_project_", "Project ")} · {timeStr}
                        </span>
                      </div>

                      <p className="text-xs text-slate-300">{err.error_message}</p>

                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            setOpenErrorTechId(isTechOpen ? null : err.id)
                          }
                          className="px-2.5 py-1 rounded bg-slate-800 text-[11px] text-slate-200 font-semibold cursor-pointer"
                        >
                          التفاصيل (Technical Details)
                        </button>
                      </div>

                      {isTechOpen && (
                        <pre
                          dir="ltr"
                          className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400 overflow-x-auto"
                        >
                          {JSON.stringify(err, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent Flow History */}
            {history.length > 0 && (
              <div className="pt-4 border-t border-slate-800/80 space-y-2">
                <div className="text-xs font-semibold text-slate-400">Recent Events</div>
                {history.slice(0, 10).map((h) => (
                  <div
                    key={h.id}
                    className="py-2 flex items-center justify-between text-xs font-mono border-b border-slate-800/50 last:border-0"
                  >
                    <span className="text-slate-300">{h.action}</span>
                    <span className="text-slate-400">
                      {h.project_id.replace("flow_project_", "Project ")}
                    </span>
                    <span
                      className={
                        h.status === "SUCCESS" ? "text-emerald-400" : "text-rose-400"
                      }
                    >
                      {h.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Granular Task Model Mapping (Advanced) */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-6 flex flex-col gap-4">
            <h3 className="text-sm font-bold text-white">
              تخصيص نماذج المهام المتقدمة (Task Models)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {GEMINI_TASK_DESCRIPTORS.map((desc) => (
                <div
                  key={desc.task}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1.5"
                >
                  <label className="text-xs font-semibold text-slate-300">
                    {desc.labelEn}
                  </label>
                  <select
                    value={geminiTaskModels[desc.task]}
                    onChange={(e) =>
                      handleGeminiTaskModelChange(
                        desc.task,
                        e.target.value as GeminiCookieModelId
                      )
                    }
                    className="p-2 rounded bg-slate-900 border border-slate-800 text-xs text-white"
                  >
                    {COMPACT_GEMINI_MODELS_LIST.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Project Details Modal (Requirement 16) */}
      {projectDetailsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setProjectDetailsModal(null);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                {projectDetailsModal.name}
              </h3>
              <button
                type="button"
                onClick={() => setProjectDetailsModal(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Status:</span>
                <strong className="text-white">{projectDetailsModal.status}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Authentication:</span>
                <strong className="text-white">
                  {projectDetailsModal.authentication_status}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Session:</span>
                <strong className="text-white">
                  {projectDetailsModal.session_status} · ••••••
                </strong>
              </div>
              {projectDetailsModal.last_error && (
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-rose-300 mt-2">
                  {projectDetailsModal.last_error}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Secure Flow Session Update Modal (Never exposes existing cookies) */}
      {isFlowSessionModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsFlowSessionModalOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">تحديث جلسة Google Flow</h3>
              <button
                type="button"
                onClick={() => setIsFlowSessionModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              يتم تشفير وإخفاء الرموز السرية (••••••) فور الحفظ ولا تُعرض في الواجهة.
            </p>

            <textarea
              value={flowSessionDraft}
              onChange={(e) => setFlowSessionDraft(e.target.value)}
              rows={4}
              dir="ltr"
              placeholder="الصق بيانات الجلسة الجديدة هنا..."
              className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (flowSessionDraft.trim()) {
                    setFlowCookies(flowSessionDraft.trim());
                    saveFlowCookies(flowSessionDraft.trim());
                  }
                  setIsFlowSessionModalOpen(false);
                  await handleTestConnection();
                }}
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                حفظ وفحص الاتصال
              </button>

              {geminiCookies.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setFlowCookies(geminiCookies);
                    saveFlowCookies(geminiCookies);
                    setIsFlowSessionModalOpen(false);
                    setNotice({
                      type: "success",
                      text: "تم ربط جلسة Google الحالية بنجاح (••••••).",
                    });
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  ربط جلسة Gemini الحالية
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
