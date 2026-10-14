import type {
  FlowAuthStatus,
  FlowConnectionStatus,
  FlowDisplayModelName,
  FlowErrorEntry,
  FlowHistoryEntry,
  FlowSessionStatus,
  FlowTaskModelMap,
  GeminiCookieModelId,
  GeminiNovelTaskType,
  GeminiTaskModelMap,
  GoogleFlowModelDescriptor,
  GoogleFlowProject,
  NovelChapterBlock,
  PageGenerationMode,
  ProductionElementType,
  StudioAspectRatio,
  StudioCheckpointState,
  StudioElementVerificationResult,
  StudioLocationItem,
  StudioLocationType,
  StudioPipelineTelemetry,
  StudioProductionElement,
  StudioSceneItem,
  StudioStylePreset,
  StudioStyleSettings,
  ManhwaPagePlan,
  ManhwaPageLayoutType,
  ChapterManhwaLayoutPlan,
  ChapterScenePerPageLayoutPlan,
} from "../types/novelToManga";
import {
  DEFAULT_FLOW_TASK_MODELS,
  DEFAULT_GEMINI_TASK_MODELS,
} from "../types/novelToManga";

export const DEFAULT_USER_FLOW_COOKIES = "";

function getStoredGeminiCookies(): string {
  try {
    return localStorage.getItem("gemini_cookies") || "";
  } catch {
    return "";
  }
}

export function loadFlowCookies(): string {
  try {
    return (
      localStorage.getItem("google_flow_cookies") ||
      localStorage.getItem("flow_cookies") ||
      ""
    );
  } catch {
    return "";
  }
}

export function saveFlowCookies(cookies: string): void {
  try {
    localStorage.setItem("google_flow_cookies", cookies);
    localStorage.setItem("flow_cookies", cookies);
  } catch {}
}

export function loadFlowProjects(): GoogleFlowProject[] {
  try {
    const raw =
      localStorage.getItem("google_flow_projects") ||
      localStorage.getItem("flow_projects");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveFlowProjects(projects: GoogleFlowProject[]): void {
  try {
    localStorage.setItem("google_flow_projects", JSON.stringify(projects));
    localStorage.setItem("flow_projects", JSON.stringify(projects));
  } catch {}
}

export function loadFlowTaskModels(): FlowTaskModelMap {
  try {
    const raw = localStorage.getItem("flow_task_models");
    return raw
      ? { ...DEFAULT_FLOW_TASK_MODELS, ...JSON.parse(raw) }
      : { ...DEFAULT_FLOW_TASK_MODELS };
  } catch {
    return { ...DEFAULT_FLOW_TASK_MODELS };
  }
}

export function saveFlowTaskModels(models: FlowTaskModelMap): void {
  try {
    localStorage.setItem("flow_task_models", JSON.stringify(models));
  } catch {}
}

export function loadGeminiTaskModels(): GeminiTaskModelMap {
  try {
    const raw = localStorage.getItem("gemini_task_models");
    return raw
      ? { ...DEFAULT_GEMINI_TASK_MODELS, ...JSON.parse(raw) }
      : { ...DEFAULT_GEMINI_TASK_MODELS };
  } catch {
    return { ...DEFAULT_GEMINI_TASK_MODELS };
  }
}

export function saveGeminiTaskModels(models: GeminiTaskModelMap): void {
  try {
    localStorage.setItem("gemini_task_models", JSON.stringify(models));
  } catch {}
}

export function loadPreferredGeminiModel(): GeminiCookieModelId {
  try {
    return (
      (localStorage.getItem("preferred_gemini_model") as GeminiCookieModelId) ||
      (localStorage.getItem("gemini_cookie_model") as GeminiCookieModelId) ||
      "3.6-flash"
    );
  } catch {
    return "3.6-flash";
  }
}

export function savePreferredGeminiModel(model: GeminiCookieModelId): void {
  try {
    localStorage.setItem("preferred_gemini_model", model);
    localStorage.setItem("gemini_cookie_model", model);
  } catch {}
}

// ============================================================================
// CONCURRENCY QUEUE RUNNER
// ============================================================================

export async function runParallelQueueWithLimit<T, R>(
  items: T[],
  limit: number,
  taskFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items || items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const executing: Promise<void>[] = [];

  const worker = async (): Promise<void> => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await taskFn(items[idx], idx);
    }
  };

  const poolSize = Math.max(1, Math.min(limit || 2, items.length));
  for (let i = 0; i < poolSize; i++) {
    executing.push(worker());
  }

  await Promise.all(executing);
  return results;
}

// ============================================================================
// GOOGLE FLOW SESSION & PROJECT APIS
// ============================================================================

export async function fetchGoogleFlowStatus(rawSession?: string) {
  const session = rawSession ?? loadFlowCookies();
  const res = await fetch("/api/google-flow/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawSession: session, flowCookies: session }),
  });
  return await res.json();
}

export async function testGoogleFlowConnection(rawSession?: string, projectId?: string) {
  const session = rawSession ?? loadFlowCookies();
  const res = await fetch("/api/google-flow/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawSession: session, flowCookies: session, projectId }),
  });
  return await res.json();
}

export async function testGoogleFlowUpload(payload: {
  flowCookies?: string;
  rawSession?: string;
  projectId?: string;
}) {
  const session = payload.flowCookies || payload.rawSession || loadFlowCookies();
  const res = await fetch("/api/google-flow/test-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawSession: session, flowCookies: session, projectId: payload.projectId }),
  });
  return await res.json();
}

export async function testGoogleFlowGeneration(payload: {
  flowCookies?: string;
  rawSession?: string;
  projectId?: string;
  modelDisplayName?: string;
}) {
  const session = payload.flowCookies || payload.rawSession || loadFlowCookies();
  const res = await fetch("/api/google-flow/test-generation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession: session,
      flowCookies: session,
      projectId: payload.projectId,
      modelDisplayName: payload.modelDisplayName,
    }),
  });
  return await res.json();
}

export async function discoverGoogleFlowModels(rawSession?: string) {
  const session = rawSession ?? loadFlowCookies();
  const res = await fetch("/api/google-flow/discover-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawSession: session, flowCookies: session }),
  });
  return await res.json();
}

export async function addGoogleFlowProject(payload: {
  name?: string;
  rawSession?: string;
  enabled?: boolean;
}) {
  const session = payload.rawSession ?? loadFlowCookies();
  const res = await fetch("/api/google-flow/projects/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      rawSession: session,
      enabled: payload.enabled,
    }),
  });
  return await res.json();
}

export async function verifyAssetInGoogleFlowApi(payload: any) {
  const session = payload.rawSession || payload.flowCookies || loadFlowCookies();
  const res = await fetch("/api/google-flow/verify-asset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession: session,
      ...payload,
    }),
  });
  return await res.json();
}

// ============================================================================
// NOVEL TO MANGA STUDIO APIS
// ============================================================================

export async function generateStudioScriptApi(payload: {
  projectTitle: string;
  novelText: string;
  targetSceneCount?: number;
  modelId?: string;
  geminiCookies?: string;
  [key: string]: any;
}) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function extractLocationsAndElementsFromScriptApi(payload: {
  scriptText: string;
  existingScenes?: StudioSceneItem[];
  existingLocations?: StudioLocationItem[];
  existingElements?: StudioProductionElement[];
  modelId?: string;
  geminiCookies?: string;
  [key: string]: any;
}) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/extract-from-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

// Production Elements
export async function generateStudioElementPromptApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/element/generate-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function generateStudioElementsPromptsBatchApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/elements/generate-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function generateStudioElementImageApi(payload: any) {
  const rawSession = payload.rawSession || payload.flowCookies || loadFlowCookies();
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/element/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession,
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function verifyStudioElementImageApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/element/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function lockStudioElementApi(payload: any) {
  const res = await fetch("/api/novel-to-manga/studio/element/lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

// Locations
export async function generateStudioLocationPromptApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/location/generate-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function generateStudioLocationsPromptsBatchApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/locations/generate-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function generateStudioLocationImageApi(payload: any) {
  const rawSession = payload.rawSession || payload.flowCookies || loadFlowCookies();
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/location/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession,
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function verifyStudioLocationImageApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/location/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function lockStudioLocationApi(payload: any) {
  const res = await fetch("/api/novel-to-manga/studio/location/lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

export async function lockAllStudioReferencesApi(payload?: any) {
  const res = await fetch("/api/novel-to-manga/studio/references/lock-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  return await res.json();
}

// Scenes
export async function generateAndVerifyStudioSceneApi(payload: any) {
  const rawSession = payload.rawSession || payload.flowCookies || loadFlowCookies();
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/generate-scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession,
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function verifyStudioSceneImageApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/scene/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

// Studio Checkpoints & Telemetry
export async function loadStudioCheckpointApi() {
  const res = await fetch("/api/novel-to-manga/studio/checkpoint", {
    headers: { Accept: "application/json" },
  });
  return await res.json();
}

export async function saveStudioCheckpointApi(state: any) {
  const res = await fetch("/api/novel-to-manga/studio/checkpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state || {}),
  });
  return await res.json();
}

export async function getStudioTelemetryApi(): Promise<StudioPipelineTelemetry> {
  const res = await fetch("/api/novel-to-manga/studio/telemetry", {
    headers: { Accept: "application/json" },
  });
  const data = await res.json();
  return data.telemetry || data;
}

export async function getStudioPerformanceReportApi() {
  const res = await fetch("/api/novel-to-manga/studio/performance-report", {
    headers: { Accept: "application/json" },
  });
  return await res.json();
}

export async function runStudioPerformanceBenchmarkApi(payload?: any) {
  const rawSession = payload?.rawSession || loadFlowCookies();
  const res = await fetch("/api/novel-to-manga/studio/performance-benchmark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession,
      ...payload,
    }),
  });
  return await res.json();
}

export async function getBackgroundVerificationStatusApi(targetId: string) {
  const res = await fetch(
    `/api/novel-to-manga/studio/background-verification/${encodeURIComponent(targetId)}`,
    {
      headers: { Accept: "application/json" },
    }
  );
  return await res.json();
}

export async function runStudioFullPipelineApi(payload: any) {
  const rawSession = payload.rawSession || payload.flowCookies || loadFlowCookies();
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/novel-to-manga/studio/run-full-pipeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawSession,
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

// Manhwa Pages Layout Engine APIs
export async function planChapterManhwaPagesApi(payload: {
  chapter_id?: string;
  chapter_title?: string;
  scenes?: StudioSceneItem[];
  blocks?: NovelChapterBlock[];
  elements?: StudioProductionElement[];
  locations?: StudioLocationItem[];
  preferred_style?: string;
  page_mode?: PageGenerationMode;
  aspect_ratio?: string;
  [key: string]: any;
}) {
  const res = await fetch("/api/manhwa-pages/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

export async function verifyManhwaPageApi(payload: any) {
  const geminiCookies = payload.geminiCookies || getStoredGeminiCookies();
  const res = await fetch("/api/manhwa-pages/verify-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geminiCookies,
      ...payload,
    }),
  });
  return await res.json();
}

export async function replanManhwaPageLayoutApi(payload: {
  page: ManhwaPagePlan;
  new_layout_type: ManhwaPageLayoutType;
  [key: string]: any;
}) {
  const res = await fetch("/api/manhwa-pages/replan-layout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return await res.json();
}
