import type { GeminiCookieModelId } from "../../server/geminiCookiesService";

export type { GeminiCookieModelId };

export interface PreferredGeminiModelOption {
  id: GeminiCookieModelId;
  name: string;
  badge: string;
  description: string;
}

export const PREFERRED_GEMINI_MODELS: PreferredGeminiModelOption[] = [
  {
    id: "3.5-flash-lite",
    name: "3.5 Flash-Lite",
    badge: "⚡ سريع",
    description: "سرعة قصوى واستجابة فورية.",
  },
  {
    id: "3.5-flash-lite-extended",
    name: "3.5 Flash-Lite (Extended)",
    badge: "🧠 تفكير موسع",
    description: "تفكير موسع للمهام الدقيقة والتحليل الأكثر عمقًا.",
  },
  {
    id: "3.6-flash",
    name: "3.6 Flash",
    badge: "🌟 متوازن",
    description: "متوازن للسياق الطويل والحوارات والتحليل العام.",
  },
  {
    id: "3.1-pro",
    name: "3.1 Pro",
    badge: "🧠 متقدم",
    description: "للمهام المعقدة، والتحليل العميق، والاستمرارية الدقيقة.",
  },
];

// ============================================================================
// 1. GEMINI COOKIES TASK MODEL SELECTION
// ============================================================================

export type GeminiNovelTaskType =
  | "novel_analysis"
  | "scene_analysis"
  | "page_planning"
  | "prompt_generation"
  | "complex_analysis"
  | "fast_analysis"
  | "deep_analysis"
  | "reference_analysis"
  | "reference_review"
  | "page_review"
  | "consistency_check";

export type GeminiTaskModelMap = Record<GeminiNovelTaskType, GeminiCookieModelId>;

export const DEFAULT_GEMINI_TASK_MODELS: GeminiTaskModelMap = {
  novel_analysis: "3.6-flash",
  scene_analysis: "3.6-flash",
  page_planning: "3.6-flash",
  prompt_generation: "3.6-flash",
  complex_analysis: "3.1-pro",
  fast_analysis: "3.5-flash-lite",
  deep_analysis: "3.5-flash-lite-extended",
  reference_analysis: "3.6-flash",
  reference_review: "3.1-pro",
  page_review: "3.1-pro",
  consistency_check: "3.1-pro",
};

export interface GeminiTaskModelDescriptor {
  task: GeminiNovelTaskType;
  labelEn: string;
  labelAr: string;
  descriptionAr: string;
  defaultModel: GeminiCookieModelId;
}

export const GEMINI_TASK_DESCRIPTORS: GeminiTaskModelDescriptor[] = [
  {
    task: "novel_analysis",
    labelEn: "Novel Analysis",
    labelAr: "تحليل الرواية والفصول",
    descriptionAr: "استخراج الفصول والعالم والشخصيات والأماكن من نص الرواية.",
    defaultModel: "3.6-flash",
  },
  {
    task: "scene_analysis",
    labelEn: "Scene Analysis",
    labelAr: "تحليل المشاهد",
    descriptionAr: "تفكيك أحداث الفصل إلى مشاهد درامية مترابطة زمنيًا ومكانيًا.",
    defaultModel: "3.6-flash",
  },
  {
    task: "page_planning",
    labelEn: "Page Planning",
    labelAr: "تخطيط الصفحات والبانلز",
    descriptionAr: "توزيع المشاهد على صفحات مانجا/مانهوا وتحديد الكادرات والزوايا.",
    defaultModel: "3.6-flash",
  },
  {
    task: "prompt_generation",
    labelEn: "Prompt Generation",
    labelAr: "هندسة أوامر الرسم (Prompts)",
    descriptionAr: "صياغة أوامر توليد المراجع والمشاهد متعددة المراجع بدقة صارمة.",
    defaultModel: "3.6-flash",
  },
  {
    task: "complex_analysis",
    labelEn: "Complex Analysis",
    labelAr: "التحليل المعقد",
    descriptionAr: "حل تداخلات الأحداث، الحبكات المتشابكة، واستمرارية العالم.",
    defaultModel: "3.1-pro",
  },
  {
    task: "fast_analysis",
    labelEn: "Fast Analysis",
    labelAr: "التحليل السريع",
    descriptionAr: "الاستخراج اللحظي السريع للملخصات والعناصر المباشرة.",
    defaultModel: "3.5-flash-lite",
  },
  {
    task: "deep_analysis",
    labelEn: "Deep Analysis",
    labelAr: "التحليل العميق (Extended)",
    descriptionAr: "تحليل بالتفكير الموسع لاستنباط التفاصيل البصرية الدقيقة.",
    defaultModel: "3.5-flash-lite-extended",
  },
  {
    task: "reference_analysis",
    labelEn: "Reference Analysis",
    labelAr: "تحليل البطاقات المرجعية",
    descriptionAr: "تحليل سمات العناصر والشخصيات لبناء Visual Bible متكامل.",
    defaultModel: "3.6-flash",
  },
  {
    task: "reference_review",
    labelEn: "Reference Review",
    labelAr: "مراجعة الصور المرجعية",
    descriptionAr: "فحص الصور المرجعية المولدة بصريًا قبل اعتمادها وإغلاقها (LOCK).",
    defaultModel: "3.1-pro",
  },
  {
    task: "page_review",
    labelEn: "Page Review",
    labelAr: "مراجعة صفحات المانجا",
    descriptionAr: "فحص صفحات المانجا المولدة ومطابقتها مع المراجع المقفلة والمشهد.",
    defaultModel: "3.1-pro",
  },
  {
    task: "consistency_check",
    labelEn: "Consistency Check",
    labelAr: "فحص الاستمرارية البصرية",
    descriptionAr: "التحقق من ثبات الهوية، الملابس، الإضاءة، الطريق، والبيئة بين الصفحات.",
    defaultModel: "3.1-pro",
  },
];

// ============================================================================
// 2. GOOGLE FLOW SETTINGS, SESSION, PROJECTS & MODELS
// ============================================================================

export type FlowProjectStatus =
  | "ACTIVE"
  | "COOLDOWN"
  | "EXPIRED"
  | "ERROR"
  | "UNAVAILABLE"
  | "DISABLED";

export type FlowSessionStatus = "Connected" | "Missing" | "Expired";
export type FlowAuthStatus = "Authenticated" | "Expired" | "Unauthenticated";
export type FlowConnectionStatus = "Connected" | "Disconnected" | "CONNECTED" | "NOT CONNECTED";

export type FlowRealGenerationStatus =
  | "FLOW_GENERATION_SUCCESS"
  | "FLOW_GENERATION_INCOMPLETE"
  | "FLOW_GENERATION_FAILED"
  | "GOOGLE_FLOW_LIMIT_REACHED"
  | "FLOW_PROJECT_NOT_FOUND"
  | "FLOW_ASSET_NOT_CREATED"
  | "FLOW_ASSET_NOT_VERIFIED"
  | "GOOGLE_FLOW_ACTION_REQUIRED"
  | "FLOW_AUTH_EXPIRED"
  | "FLOW_COOKIES_EXPIRED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "IDLE";

export type FlowRealAssetStatus =
  | "FLOW_ASSET_VERIFIED"
  | "FLOW_ASSET_CREATED"
  | "FLOW_ASSET_NOT_VERIFIED"
  | "FLOW_ASSET_NOT_CREATED"
  | "VERIFIED"
  | "CREATED"
  | "NOT CREATED";

/**
 * Strictly rejects fake internal IDs like "flow_project_1", "flow_project_2", etc.
 * Only returns true for real Google Flow project identifiers verified from flow.google.com.
 */
export function isRealVerifiedFlowProjectId(projectId?: string | null): boolean {
  if (!projectId || typeof projectId !== "string") return false;
  const trimmed = projectId.trim();
  if (!trimmed) return false;
  if (
    /^flow_project_/i.test(trimmed) ||
    /^local_/i.test(trimmed) ||
    /^mock_/i.test(trimmed) ||
    trimmed === "none" ||
    trimmed === "unknown"
  ) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) || trimmed.length >= 16;
}

export function buildRealFlowProjectUrl(flowProjectId?: string | null, flowAssetId?: string | null): string | null {
  if (!isRealVerifiedFlowProjectId(flowProjectId)) return null;
  const base = `https://flow.google.com/project/${encodeURIComponent(flowProjectId!.trim())}`;
  if (flowAssetId && flowAssetId.trim()) {
    return `${base}?asset=${encodeURIComponent(flowAssetId.trim())}`;
  }
  return base;
}

export interface GoogleFlowProject {
  project_id: string;
  /** Real verified Google Flow Project ID from flow.google.com (never flow_project_1) */
  flowProjectId?: string | null;
  /** Direct URL to open this project in Google Flow */
  flowProjectUrl?: string | null;
  /** True only when verified against the user's real Google Flow account */
  real_flow_project_verified?: boolean;
  flow_account_email?: string | null;
  name: string;
  status: FlowProjectStatus;
  session_status: FlowSessionStatus;
  authentication_status: FlowAuthStatus;
  available: boolean;
  /** Explicit multi-stage readiness flags */
  authenticated?: boolean;
  discoverable?: boolean;
  active?: boolean;
  generation_ready?: boolean;
  cooldown_until: string | null;
  last_error: string | null;
  last_generation: string | null;
  created_at: string;
  updated_at: string;
  /** Masked session summary (never exposes raw cookies/tokens) */
  masked_session?: string;
  /** Transport mode used by this project */
  transport_mode?: "batchexecute" | "aisandbox" | "browser_session" | "hybrid";
  /** Action required URL if Google Flow requested CAPTCHA / human verification */
  action_required?: boolean;
  action_url?: string | null;
}

export interface FlowDetailedDiagnostics {
  FLOW_AUTH_OK: boolean;
  FLOW_PROJECT_DISCOVERY_OK: boolean;
  FLOW_PROJECT_VALIDATED?: boolean;
  FLOW_ACTIVE_PROJECT_SELECTED?: boolean;
  FLOW_DISCOVERED_PROJECTS_COUNT?: number;
  FLOW_ACTIVE_PROJECTS_COUNT?: number;
  FLOW_GENERATION_READY: boolean;
  FLOW_ACTION_REQUIRED?: boolean;
  flow_action_url?: string | null;
  flow_account_email?: string | null;
  active_project_id?: string | null;
  selected_active_project_id?: string | null;
  selected_active_project_name?: string | null;
  selected_active_project_url?: string | null;
  real_flow_project_verified?: boolean;
  discovered_project_ids?: string[];
  validated_project_ids?: string[];
  ready_project_ids?: string[];
  diagnostic_reason_ar?: string;
  projects_summary?: Array<{
    project_id: string;
    name: string;
    authenticated: boolean;
    discoverable: boolean;
    active: boolean;
    generation_ready: boolean;
    status: FlowProjectStatus;
    last_error: string | null;
  }>;
  checked_at?: string;
}

export const MAX_GOOGLE_FLOW_PROJECTS = 5;

export type FlowDisplayModelName =
  | "Nano Banana Pro"
  | "Nano Banana 2"
  | "Nano Banana 2 Lite";

export interface GoogleFlowModelDescriptor {
  display_name: FlowDisplayModelName;
  ui_key: "nano_banana_pro" | "nano_banana_2" | "nano_banana_2_lite";
  internal_model_id: string | null;
  available: boolean;
  status_label: "Available" | "Unavailable";
  description_ar: string;
  resolution_support: string;
  recommended_for: string;
}

export type FlowGenerationTaskType =
  | "reference_generation"
  | "scene_generation"
  | "page_generation"
  | "fast_generation";

export type FlowTaskModelMap = Record<FlowGenerationTaskType, FlowDisplayModelName>;

export const DEFAULT_FLOW_TASK_MODELS: FlowTaskModelMap = {
  reference_generation: "Nano Banana Pro",
  scene_generation: "Nano Banana 2",
  page_generation: "Nano Banana 2",
  fast_generation: "Nano Banana 2 Lite",
};

export interface FlowHistoryEntry {
  id: string;
  timestamp: string;
  action:
    | "CONNECTION_TEST"
    | "SESSION_TEST"
    | "MODEL_DISCOVERY"
    | "IMAGE_UPLOAD"
    | "REFERENCE_GENERATION"
    | "SCENE_GENERATION"
    | "PAGE_GENERATION"
    | "PROJECT_FAILOVER"
    | "PREFLIGHT_TEST"
    | "FLOW_REQUEST_CREATED"
    | "FLOW_AUTH_OK"
    | "FLOW_PROJECT_SELECTED"
    | "FLOW_GENERATION_STARTED"
    | "FLOW_GENERATION_RESULT_RECEIVED"
    | "FLOW_IMAGE_DETECTED"
    | "FLOW_IMAGE_DOWNLOADED"
    | "FLOW_IMAGE_VALIDATED"
    | "FLOW_IMAGE_SAVED"
    | "FLOW_GENERATION_COMPLETED";
  project_id: string;
  model_display_name?: string;
  internal_model_id?: string;
  status: "SUCCESS" | "ERROR" | "SKIPPED";
  message: string;
  duration_ms?: number;
  error_code?: string;
}

export interface FlowErrorEntry {
  id: string;
  timestamp: string;
  project_id: string;
  operation: "Connection" | "Session" | "Upload" | "Generation" | "Review" | "Save";
  attempt: number;
  error_code: string;
  error_message: string;
}

// ============================================================================
// 3. VISUAL BIBLE & REFERENCE LOCK SYSTEM
// ============================================================================

export type VisualBibleCategory =
  | "WORLD"
  | "ENVIRONMENT"
  | "LOCATION"
  | "ARCHITECTURE"
  | "CITY"
  | "ROAD"
  | "FOREST"
  | "MOUNTAIN"
  | "BUILDING"
  | "CHARACTER"
  | "FACE"
  | "HAIR"
  | "BODY"
  | "COSTUME"
  | "WEAPON"
  | "ITEM"
  | "CREATURE"
  | "VEHICLE"
  | "LIGHTING"
  | "COLOR PALETTE"
  | "ART STYLE"
  | "CAMERA STYLE"
  | "PANEL STYLE";

export const ALL_VISUAL_BIBLE_CATEGORIES: VisualBibleCategory[] = [
  "WORLD",
  "ENVIRONMENT",
  "LOCATION",
  "ARCHITECTURE",
  "CITY",
  "ROAD",
  "FOREST",
  "MOUNTAIN",
  "BUILDING",
  "CHARACTER",
  "FACE",
  "HAIR",
  "BODY",
  "COSTUME",
  "WEAPON",
  "ITEM",
  "CREATURE",
  "VEHICLE",
  "LIGHTING",
  "COLOR PALETTE",
  "ART STYLE",
  "CAMERA STYLE",
  "PANEL STYLE",
];

export type ReferenceLifecycleStatus =
  | "DRAFT"
  | "GENERATING"
  | "REVIEWING"
  | "APPROVED"
  | "LOCKED";

export interface ReferenceReviewConsistency {
  identity: boolean;
  environment: boolean;
  style: boolean;
  objects: boolean;
  lighting: boolean;
}

export interface ReferenceReviewResult {
  approved: boolean;
  issues: string[];
  consistency: ReferenceReviewConsistency;
  corrective_prompt?: string;
  reviewed_by_model?: string;
  reviewed_at?: string;
}

export interface ReferenceVersionSnapshot {
  version: number;
  prompt: string;
  image_url: string;
  file_name: string;
  status: ReferenceLifecycleStatus;
  review_result: ReferenceReviewResult | null;
  flowProjectId?: string | null;
  flowProjectUrl?: string | null;
  flowAssetId?: string | null;
  flowGenerationId?: string | null;
  promptHash?: string | null;
  created_at: string;
  locked_at: string | null;
}

export interface VisualBibleReference {
  reference_id: string; // e.g., "WORLD_001", "LOCATION_001", "CHARACTER_001", "STYLE_001"
  file_name: string; // e.g., "WORLD_001.png"
  category: VisualBibleCategory;
  name: string;
  description: string;
  visual_traits: string[];
  immutable_constraints: string[];
  prompt: string;
  corrective_prompt?: string;
  image_url: string | null;
  upload_handle?: string | null;
  status: ReferenceLifecycleStatus;
  version: number;
  versions: ReferenceVersionSnapshot[];
  review_result: ReferenceReviewResult | null;
  flow_project_id?: string;
  flowProjectId?: string | null;
  flowProjectUrl?: string | null;
  flowAssetId?: string | null;
  flowAssetUrl?: string | null;
  flowGenerationId?: string | null;
  runId?: string | null;
  generationId?: string | null;
  promptHash?: string | null;
  flow_generation_status?: FlowRealGenerationStatus;
  flow_asset_status?: FlowRealAssetStatus;
  real_flow_project_verified?: boolean;
  real_flow_asset_verified?: boolean;
  generated_by_google_flow?: boolean;
  flow_model?: FlowDisplayModelName;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
}

// ============================================================================
// 4. NOVEL ANALYSIS, SCENE ANALYSIS, PAGE & PANEL PLANNING
// ============================================================================

export interface NovelPanelPlan {
  panel_id: string; // e.g., "PANEL_S001_P001_01" (never array index)
  panel_number: number;
  camera_angle: string;
  composition: string;
  action_description: string;
  dialogue_ar: string;
  sfx_ar?: string;
  character_ids: string[];
  location_id: string;
  world_id: string;
  object_ids: string[];
  weapon_ids: string[];
  costume_ids: string[];
  style_id: string;
}

export interface NovelPagePlan {
  page_id: string; // e.g., "PAGE_001"
  scene_id: string; // e.g., "SCENE_001"
  page_number: number;
  title: string;
  summary: string;
  world_id: string;
  location_id: string;
  character_ids: string[];
  object_ids: string[];
  weapon_ids: string[];
  costume_ids: string[];
  style_id: string;
  lighting_note: string;
  continuity_from_previous_page: boolean;
  panels: NovelPanelPlan[];
  generated_scene_prompt?: string;
  generated_page_prompt?: string;
}

export interface NovelSceneAnalysis {
  scene_id: string; // e.g., "SCENE_001"
  chapter_id: string; // e.g., "CHAPTER_001"
  title: string;
  dramatic_summary: string;
  world_id: string;
  location_id: string;
  character_ids: string[];
  object_ids: string[];
  weapon_ids: string[];
  costume_ids: string[];
  style_id: string;
  time_of_day: string;
  lighting_atmosphere: string;
  immutable_continuity_rules: string[];
}

export interface NovelAnalysisResult {
  novel_id: string;
  title: string;
  format: "Manga" | "Manhwa" | "Webtoon";
  analyzed_at: string;
  gemini_model_used: string;
  visual_bible: VisualBibleReference[];
  scenes: NovelSceneAnalysis[];
  pages: NovelPagePlan[];
}

// ============================================================================
// 5. PAGE GENERATION QUEUE, REVIEW & BOUNDED RETRY
// ============================================================================

export type PageQueueStatus =
  | "WAITING"
  | "GENERATING"
  | "REVIEWING"
  | "APPROVED"
  | "REGENERATING"
  | "FAILED";

export type RetryOperationType = "Upload" | "Generation" | "Review" | "Save";

export interface RetryAttemptRecord {
  operation: RetryOperationType;
  attempt: number;
  error_code: string;
  error_message: string;
  project_id: string;
  timestamp: string;
}

export interface PageReviewResult {
  decision: "APPROVED" | "REGENERATE";
  approved: boolean;
  score: number;
  checks: {
    character_consistency: boolean;
    world_consistency: boolean;
    location_consistency: boolean;
    object_consistency: boolean;
    style_consistency: boolean;
    lighting_consistency: boolean;
    scene_accuracy: boolean;
  };
  issues: string[];
  corrective_prompt?: string;
  reviewed_by_model: string;
  reviewed_at: string;
}

export interface PageQueueItem {
  page_id: string;
  scene_id: string;
  page_number: number;
  prompt: string;
  preservation_rules: string[];
  reference_ids: string[];
  previous_page_id?: string | null;
  previous_page_image_path?: string | null;
  flow_project_id: string | null;
  flow_model: FlowDisplayModelName;
  generation_id: string | null;
  image_path: string | null;
  review_result: PageReviewResult | null;
  version: number;
  status: PageQueueStatus;
  retries: RetryAttemptRecord[];
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// 6. PREFLIGHT TEST PIPELINE
// ============================================================================

export type PreflightStepStatus = "PASS" | "FAIL" | "SKIPPED";

export type PreflightStepId =
  | "gemini_test"
  | "flow_session_test"
  | "flow_upload_test"
  | "reference_test"
  | "generation_test"
  | "result_download_test"
  | "gemini_review_test";

export interface PreflightStepResult {
  step_id: PreflightStepId;
  label: string;
  status: PreflightStepStatus;
  message: string;
  duration_ms: number;
  details?: Record<string, any>;
}

export interface PreflightTestReport {
  ready: boolean;
  executed_at: string;
  steps: PreflightStepResult[];
  blocking_reason?: string;
}

// ============================================================================
// 7. 6-STEP NOVEL -> MANGA / STORY STUDIO TYPES
// ============================================================================

export type StudioStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type StudioStylePreset =
  | "Korean Manhwa"
  | "Japanese Manga"
  | "Dark Fantasy Comic"
  | "مانجا ملونة"
  | "مانجا أبيض وأسود"
  | "3D Animation"
  | "Pixar"
  | "Studio Ghibli"
  | "واقعي سينمائي"
  | "Cyberpunk"
  | "Fantasy"
  | "Comic"
  | "Watercolor"
  | "ستايل مخصص";

export type StudioAspectRatio = "1:1" | "9:16" | "16:9";

export interface StudioStyleSettings {
  style_id: StudioStylePreset | string;
  style_name: StudioStylePreset | string;
  style_description: string;
  aspect_ratio: StudioAspectRatio;
  model_id: FlowDisplayModelName;
  custom_style: string;
  style_version: number;
  styleHash?: string;
  style_hash?: string;
  updated_at?: string;
}

export function computeStudioStyleHash(params: {
  stylePreset?: StudioStylePreset | string;
  style_id?: StudioStylePreset | string;
  style_name?: StudioStylePreset | string;
  customStyle?: string;
  custom_style?: string;
  aspectRatio?: StudioAspectRatio | string;
  aspect_ratio?: StudioAspectRatio | string;
  flowModel?: FlowDisplayModelName | string;
  model_id?: FlowDisplayModelName | string;
  styleVersion?: number;
  style_version?: number;
}): string {
  const styleId = params.style_id || params.style_name || params.stylePreset || "Korean Manhwa";
  const custom = (params.custom_style ?? params.customStyle ?? "").trim();
  const ratio = params.aspect_ratio || params.aspectRatio || "9:16";
  const model = params.model_id || params.flowModel || "Nano Banana 2 Lite";
  const ver = params.style_version ?? params.styleVersion ?? 1;
  const raw = `${styleId}|${custom}|${ratio}|${model}|v${ver}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `STYLE_${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

export interface StudioCorrectionHistoryEntry {
  version: number;
  label: string;
  type:
    | "BASE_PROMPT"
    | "MANUAL_CORRECTION"
    | "VISION_CORRECTION"
    | "MANUAL_USER_CORRECTION"
    | "GEMINI_VISION_CORRECTION";
  correction_text: string;
  resulting_prompt: string;
  created_at: string;
}

export type ProductionElementType =
  | "CHARACTER"
  | "FACE"
  | "HAIR"
  | "COSTUME"
  | "WEAPON"
  | "CREATURE"
  | "ANIMAL"
  | "VEHICLE"
  | "TOOL"
  | "BUILDING"
  | "LOCATION"
  | "ENVIRONMENT"
  | "FURNITURE"
  | "ITEM"
  | "LIGHTING"
  | "COLOR_PALETTE"
  | "ART_STYLE"
  | "VISUAL_DETAIL"
  | "KEY_EVENT";

export interface StudioElementVerificationChecks {
  element_identity_match: boolean;
  visual_details_match: boolean;
  immutable_constraints_match: boolean;
  style_consistency: boolean;
  lighting_and_color_match: boolean;
  no_text_or_watermarks: boolean;
  identity_consistency?: boolean;
  pose_and_expression?: boolean;
  weapons_and_accessories?: boolean;
}

export type GeminiVisionConnectionStatus =
  | "GEMINI_VISION_VERIFIED"
  | "GEMINI_VISION_NEEDS_CORRECTION"
  | "GEMINI_VISION_FAILED"
  | "PASS"
  | "NEEDS_CORRECTION"
  | "VISION_FAILED"
  | "UNVERIFIED";

export interface CanonicalFactEvidence {
  field: string;
  value: string;
  source_text: string;
  source_excerpt?: string;
  source_span?: string;
  confidence: number | null;
  canonical: boolean;
  claim_status?: "CANONICAL_VERIFIED" | "UNSUPPORTED_CLAIM" | "UNKNOWN" | "NOT_SPECIFIED";
}

export interface LocationTransitionRecord {
  previous_location_id: string | null;
  current_location_id: string;
  transition_detected: boolean;
  transition_occurred?: boolean;
  transition_verified?: boolean;
  transition_evidence: string;
}

export interface SceneCharacterBinding {
  character_id: string;
  character_name: string;
  appearance_reference_id?: string;
  locked_reference_version?: string;
  static_character_identity?: {
    face?: string;
    hair?: string;
    eye_color?: string;
    skin?: string;
    body_build?: string;
  };
  scene_specific_appearance?: {
    active_weapon_in_scene?: string;
    combat_pose_or_stance?: string;
    costume_state?: string;
  };
  source_evidence?: string;
}

export interface SceneWeaponBinding {
  weapon_id: string;
  weapon_name: string;
  locked_reference_version?: string;
  present_in_scene_text: boolean;
  source_evidence: string;
}

export interface SceneCanonicalPack {
  scene_id: string;
  ready_for_generation: boolean;
  blocking_reasons?: string[];
  location_id: string;
  location_name: string;
  location_uncertain: boolean;
  character_ids: string[];
  weapon_ids: string[];
  extracted_at: string;
}

export interface CanonicalAnalysisStage {
  stage: "CANONICAL_ANALYSIS";
  entity_or_scene_id: string;
  canonical_verified: boolean;
  has_unsupported_claims: boolean;
  unsupported_claims_removed: string[];
  unsupported_claims_rejected?: string[];
  speculative_phrases_removed: string[];
  extracted_facts: CanonicalFactEvidence[];
  analyzed_at: string;
}

export interface GenerationPlanStage {
  stage: "GENERATION_PLAN";
  target_id: string;
  canonical_description_used: string;
  reference_ids_used: string[];
  style_id: string;
  style_name: string;
  style_preset?: string;
  custom_style: string;
  style_version: number;
  styleHash: string;
  style_hash?: string;
  aspect_ratio: StudioAspectRatio | string;
  exact_aspect_ratio?: StudioAspectRatio | string;
  model_id: FlowDisplayModelName | string;
  exact_model?: FlowDisplayModelName | string;
  selected_model?: FlowDisplayModelName | string;
  exact_location?: {
    location_id: string;
    location_name: string;
    locked_version: string;
  };
  exact_style?: {
    style_name: string;
    style_hash: string;
  };
  built_strictly_from_canonical_pack?: boolean;
  additive_corrections: string[];
  continuity_corrections?: string[];
  previous_scene_continuity_context?: PreviousSceneContinuityContext | null;
  assembled_master_prompt: string;
  prompt_version: number;
  planned_at: string;
}

export interface ActualImageObservation {
  observed_subject_count?: number;
  observed_characters?: string[];
  observed_weapons?: string[];
  observed_environment?: string;
  observed_location?: string;
  observed_lighting_and_colors?: string;
  observed_style_and_layout?: string;
  observed_style_and_aspect_ratio?: string;
  observed_text_or_watermarks?: string;
  is_standalone_reference_sheet?: boolean;
  is_narrative_comic_page?: boolean;
}

export interface StructuredImageComparisonItem {
  category: string;
  expected: string;
  observed: string;
  match: boolean;
  severity: "CRITICAL" | "MAJOR" | "MINOR" | "NONE";
}

export interface ActualImageVerificationStage {
  stage: "ACTUAL_IMAGE_VERIFICATION";
  target_id: string;
  image_inspected: string | null;
  actual_vision_request_completed: boolean;
  inspected_actual_image_pixels?: boolean;
  observed_in_image: ActualImageObservation;
  step1_actual_observation?: ActualImageObservation;
  step2_structured_comparisons?: StructuredImageComparisonItem[];
  continuity_analysis?: SceneContinuityAnalysisResult | null;
  canonical_comparison_passed: boolean;
  approved: boolean;
  overall_status: "PASS" | "NEEDS_CORRECTION" | "VISION_FAILED" | "UNVERIFIED";
  overall_verdict?: "PASS" | "NEEDS_CORRECTION" | "VISION_FAILED" | "UNVERIFIED";
  failed_checks: string[];
  what_is_correct: string[];
  what_is_missing: string[];
  what_is_different: string[];
  additive_correction?: string;
  continuity_additive_correction?: string;
  verified_at: string;
}

export interface PreFlowProtectionGateReport {
  passed: boolean;
  auto_repaired: boolean;
  minimum_detail_gate_passed?: boolean;
  no_generic_placeholders?: boolean;
  has_identity: boolean;
  has_core_details: boolean;
  has_immutable_constraints: boolean;
  has_associated_weapon: boolean;
  has_colors: boolean;
  has_expressions_and_poses: boolean;
  has_previous_corrections: boolean;
  no_source_data_lost: boolean;
  missing_sections_repaired: string[];
  generic_placeholders_removed?: string[];
  aggregated_sources_used?: string[];
  detected_source_conflicts: string[];
  checked_at: string;
}

export interface StudioElementVerificationResult {
  approved: boolean;
  verification_complete: boolean;
  all_required_checks_passed: boolean;
  vision_status?: GeminiVisionConnectionStatus;
  overall_status?: "PASS" | "NEEDS_CORRECTION" | "VISION_FAILED" | "UNVERIFIED";
  confidence?: number | null;
  score?: number;
  actual_vision_request_completed?: boolean;
  identity_match?: boolean;
  style_match?: boolean;
  composition_match?: boolean;
  location_match?: boolean;
  weapon_match?: boolean;
  character_match?: boolean;
  failed_checks: string[];
  checks: StudioElementVerificationChecks;
  what_is_correct?: string[];
  what_is_missing?: string[];
  what_is_different?: string[];
  additive_correction?: string;
  critical_corrections?: string[];
  issues: string[];
  detected_issues: string[];
  corrected_prompt?: string;
  reviewed_by_model: string;
  reviewed_at: string;
}

export interface StudioProductionElement {
  id: string;
  entity_id?: string;
  entity_type?: ProductionElementType | string;
  canonical_name?: string;
  aliases?: string[];
  source_evidence?: string;
  source_references?: string[];
  descriptionArabic?: string;
  ownership?: "PRIMARY" | "ATTACHED" | "SELF_OWNED" | "ATTACHED_AND_INDEPENDENT" | string;
  independent_visual_identity?: boolean;
  attached_to?: string | null;
  reference_group_id?: string | null;
  target_step?: "production_elements" | "locations";
  reference_sheet_id?: string;
  locked_for_production?: boolean;
  is_master_reference_sheet?: boolean;
  master_reference_id?: string | null;
  master_sheet_type?: string | null;
  attached_sub_entities?: Array<{ id: string; name: string; category: string; relationshipRole: string }>;
  associated_weapon_entity_id?: string;
  /** Master Reference Prompt Identifier (e.g. EFFIE_REFERENCE_PROMPT, SUNNY_REFERENCE_PROMPT) */
  master_prompt_key?: string;
  category: ProductionElementType;
  name: string;
  description: string;
  visual_details: string;
  /** Layer 1: Canonical Reference Description (pure identity, no general style phrases) */
  canonical_description?: string;
  /** Stage A: Canonical Analysis based strictly on text evidence */
  canonical_analysis?: CanonicalAnalysisStage;
  /** Stage B: Generation Plan combining Canonical Analysis + References + Active Style */
  generation_plan?: GenerationPlanStage;
  /** Stage C: Actual Image Verification from real Gemini Vision inspection */
  actual_image_verification?: ActualImageVerificationStage | null;
  /** Layer 2: Global Visual Style (taken from Project Style Settings) */
  generation_style?: string;
  style_version?: number;
  styleHash?: string;
  aspect_ratio?: StudioAspectRatio | string;
  selected_model?: FlowDisplayModelName | string;
  applied_style_settings?: Record<string, any>;
  /** Layer 3: Cumulative Generation Corrections (from Gemini Vision or user) */
  generation_corrections?: string[];
  /** Cumulative CRITICAL CORRECTIONS list */
  critical_corrections?: string[];
  /** Final assembled 19-point Master Reference Prompt sent to Google Flow */
  assembled_flow_prompt?: string;
  base_prompt?: string;
  current_prompt?: string;
  manual_correction?: string;
  correction_history?: StudioCorrectionHistoryEntry[];
  /** Pre-Flow Internal Protection Gate validation & auto-repair report */
  pre_flow_protection_report?: PreFlowProtectionGateReport;
  /** Any conflicts detected between Source 1 (Arabic description) and Source 2 (Unified Entity Visual Details) */
  detected_source_conflicts?: string[];
  /** Style phrases stripped by the validator if Gemini tried to inject style into canonical description */
  extracted_style_warnings?: string[];
  appearance?: string;
  clothing?: string;
  clothing_and_armor?: string;
  accessories?: string;
  associated_weapon?: string;
  weapons_and_accessories?: string;
  colors?: string;
  colors_and_lighting?: string;
  expressions?: string;
  poses?: string;
  expressions_and_poses?: string;
  shape_and_material?: string;
  energy_and_glow?: string;
  dimensions_and_carry?: string;
  size_and_scale?: string;
  anatomy_and_armor?: string;
  architecture_and_stone?: string;
  damage_and_weathering?: string;
  entity_classification?: "STANDALONE_ENTITY" | "MERGED_ATTRIBUTE";
  merged_attributes?: string[];
  base_reference_prompt?: string;
  reference_prompt?: string;
  additive_corrections?: string[];
  added_corrections?: string[];
  immutable_constraints?: string[];
  reference_image_url?: string | null;
  local_file_path?: string | null;
  version?: number;
  versions?: any[];
  approved?: boolean;
  status?: ReferenceLifecycleStatus | "NOT_GENERATED" | "GENERATED" | "NEEDS_CORRECTION" | "VISION_FAILED" | "REGENERATING";
  generation_status?: StudioLocationGenerationStatus;
  verification_status?: StudioVerificationStatus | "VISION_FAILED";
  vision_status?: GeminiVisionConnectionStatus;
  verification_result?: StudioElementVerificationResult | null;
  current_attempt?: number;
  max_attempts?: number;
  attempts_log?: any[];
  locked_at?: string | null;
  source_scene_ids?: string[];
  last_error?: string | null;
  flow_provider?: "Google Flow Cookies" | "Google Flow";
  flow_project_id?: string | null;
  flowProjectId?: string | null;
  flowProjectUrl?: string | null;
  flowAssetId?: string | null;
  flowAssetUrl?: string | null;
  flowGenerationId?: string | null;
  runId?: string | null;
  generationId?: string | null;
  promptHash?: string | null;
  flow_generation_status?: FlowRealGenerationStatus;
  flow_asset_status?: FlowRealAssetStatus;
  real_flow_project_verified?: boolean;
  real_flow_asset_created?: boolean;
  real_flow_asset_verified?: boolean;
  generated_by_google_flow?: boolean;
  flow_action_required?: boolean;
  flow_action_url?: string | null;
  flow_model?: FlowDisplayModelName | null;
  flow_generation_id?: string | null;
  flow_metadata?: FlowGenerationMetadata;
  derived_from_prepared_novel_id?: string;
  derived_from_content_hash?: string;
}

export type StudioLocationType =
  | "ROAD"
  | "FOREST"
  | "MOUNTAIN"
  | "CITY"
  | "VILLAGE"
  | "BUILDING"
  | "GATE"
  | "TEMPLE"
  | "ROOM"
  | "CORRIDOR"
  | "PLAZA"
  | "TUNNEL"
  | "CAVE"
  | "VALLEY"
  | "EXTERIOR"
  | "INTERIOR"
  | "REGION"
  | "OTHER";

export type StudioLocationGenerationStatus =
  | "NOT_GENERATED"
  | "QUEUED"
  | "GENERATING"
  | "GENERATED"
  | "FAILED"
  | "NEEDS_REGENERATION"
  | "NEEDS_MANUAL_REVIEW";

export type StudioVerificationStatus =
  | "UNVERIFIED"
  | "QUEUED"
  | "VERIFYING"
  | "VERIFIED"
  | "REJECTED"
  | "VISION_FAILED"
  | "NEEDS_MANUAL_REVIEW"
  | "MANUAL_REVIEW_REQUIRED";

export interface StudioLocationVerificationChecks {
  // 11 Mandatory Strict Checks
  location_type_match: boolean;
  architectural_elements_match: boolean;
  environment_details_match: boolean;
  lighting_time_of_day_match: boolean;
  atmosphere_mood_match: boolean;
  style_consistency: boolean;
  no_unwanted_characters: boolean;
  no_extra_unrelated_objects: boolean;
  no_text_or_watermarks: boolean;
  composition_suitable_as_reference: boolean;
  continuity_with_script_description: boolean;
  // Backward-compatible aliases
  location_identity?: boolean;
  architecture?: boolean;
  environment?: boolean;
  required_elements?: boolean;
  lighting?: boolean;
  perspective?: boolean;
  style?: boolean;
  color_palette?: boolean;
  composition?: boolean;
  visual_reference_match?: boolean;
  description_match?: boolean;
  architecture_and_environment: boolean;
  lighting_and_atmosphere: boolean;
  visual_reference_accuracy: boolean;
  no_unwanted_artifacts: boolean;
  architecture_and_terrain?: boolean;
  perspective_and_scale?: boolean;
}

export interface StudioLocationVerificationResult {
  approved: boolean;
  verification_complete: boolean;
  all_required_checks_passed: boolean;
  vision_status?: GeminiVisionConnectionStatus;
  overall_status?: "PASS" | "NEEDS_CORRECTION" | "VISION_FAILED" | "UNVERIFIED";
  confidence?: number | null;
  score?: number;
  actual_vision_request_completed?: boolean;
  identity_match?: boolean;
  style_match?: boolean;
  composition_match?: boolean;
  location_match?: boolean;
  weapon_match?: boolean;
  character_match?: boolean;
  failed_checks: string[];
  checks: StudioLocationVerificationChecks;
  what_is_correct?: string[];
  what_is_missing?: string[];
  what_is_different?: string[];
  additive_correction?: string;
  critical_corrections?: string[];
  issues: string[];
  detected_issues: string[];
  corrected_prompt?: string;
  reviewed_by_model: string;
  reviewed_at: string;
}

export interface StudioLocationAttemptLog {
  attempt: number;
  prompt_used: string;
  image_url: string | null;
  approved: boolean;
  all_required_checks_passed?: boolean;
  vision_status?: GeminiVisionConnectionStatus;
  score?: number;
  failed_checks: string[];
  what_is_correct?: string[];
  what_is_missing?: string[];
  what_is_different?: string[];
  additive_correction?: string;
  critical_corrections?: string[];
  issues?: string[];
  detected_issues?: string[];
  corrected_prompt?: string;
  timestamp: string;
  flow_metadata?: FlowGenerationMetadata;
}

export interface StudioLocationVersionSnapshot {
  version: number;
  prompt_used: string;
  image_url: string;
  status?: string;
  verification_result?: StudioLocationVerificationResult | null;
  created_at: string;
  locked_at?: string | null;
}

export interface StudioLocationItem {
  location_id: string;
  entity_id?: string;
  entity_type?: string;
  canonical_name?: string;
  aliases?: string[];
  source_evidence?: string;
  descriptionArabic?: string;
  environment_components?: string[];
  ownership?: string;
  independent_visual_identity?: boolean;
  attached_to?: string | null;
  reference_group_id?: string | null;
  /** Master Reference Prompt Identifier (e.g. DEEP_VALLEY_REFERENCE_PROMPT) */
  master_prompt_key?: string;
  target_step?: "production_elements" | "locations";
  reference_sheet_id?: string;
  type: StudioLocationType;
  name: string;
  description: string;
  visual_description?: string;
  environment?: string;
  architecture?: string;
  ground?: string;
  sky?: string;
  weather?: string;
  lighting?: string;
  materials?: string;
  colors?: string;
  landmarks?: string[];
  reference_prompt?: string;
  /** Layer 1: Canonical Reference Description (pure location identity, no general style phrases) */
  canonical_description?: string;
  /** Stage A: Canonical Analysis based strictly on text evidence */
  canonical_analysis?: CanonicalAnalysisStage;
  /** Stage B: Generation Plan combining Canonical Analysis + References + Active Style */
  generation_plan?: GenerationPlanStage;
  /** Stage C: Actual Image Verification from real Gemini Vision inspection */
  actual_image_verification?: ActualImageVerificationStage | null;
  /** Layer 2: Global Visual Style (taken from Project Style Settings) */
  generation_style?: string;
  style_version?: number;
  styleHash?: string;
  style_hash?: string;
  aspect_ratio?: StudioAspectRatio | string;
  selected_model?: FlowDisplayModelName | string;
  applied_style_settings?: Record<string, any>;
  /** Layer 3: Cumulative Generation Corrections */
  generation_corrections?: string[];
  /** Cumulative CRITICAL CORRECTIONS list */
  critical_corrections?: string[];
  /** Final assembled prompt sent to Google Flow */
  assembled_flow_prompt?: string;
  base_prompt?: string;
  current_prompt?: string;
  manual_correction?: string;
  correction_history?: StudioCorrectionHistoryEntry[];
  /** Pre-Flow Internal Protection Gate validation & auto-repair report */
  pre_flow_protection_report?: PreFlowProtectionGateReport;
  /** Any conflicts detected between Source 1 (Arabic description) and Source 2 (Visual Description) */
  detected_source_conflicts?: string[];
  /** Style phrases stripped by the validator if Gemini tried to inject style into canonical description */
  extracted_style_warnings?: string[];
  base_reference_prompt?: string;
  visual_reference_prompt: string;
  additive_corrections?: string[];
  added_corrections?: string[];
  color_palette?: string;
  lighting_and_atmosphere: string;
  atmosphere?: string;
  textures_and_materials?: string;
  textures?: string;
  immutable_elements: string[];
  key_components?: string[];
  source_scene_ids?: string[];
  reference_image_url?: string | null;
  local_file_path?: string | null;
  approved?: boolean;
  status?: ReferenceLifecycleStatus | "NOT_GENERATED" | "GENERATED" | "NEEDS_CORRECTION" | "VISION_FAILED";
  locked_at?: string | null;
  generation_status?: StudioLocationGenerationStatus;
  verification_status?: StudioVerificationStatus;
  vision_status?: GeminiVisionConnectionStatus;
  verification_result?: StudioLocationVerificationResult | null;
  version?: number;
  versions?: StudioLocationVersionSnapshot[];
  current_attempt?: number;
  max_attempts?: number;
  attempts_log?: StudioLocationAttemptLog[];
  used_in_scenes_count?: number;
  last_error?: string | null;
  flow_provider?: "Google Flow Cookies" | "Google Flow";
  flow_project_id?: string | null;
  flowProjectId?: string | null;
  flowProjectUrl?: string | null;
  flowAssetId?: string | null;
  flowAssetUrl?: string | null;
  flowGenerationId?: string | null;
  runId?: string | null;
  generationId?: string | null;
  promptHash?: string | null;
  flow_generation_status?: FlowRealGenerationStatus;
  flow_asset_status?: FlowRealAssetStatus;
  real_flow_project_verified?: boolean;
  real_flow_asset_created?: boolean;
  real_flow_asset_verified?: boolean;
  generated_by_google_flow?: boolean;
  flow_action_required?: boolean;
  flow_action_url?: string | null;
  flow_model?: FlowDisplayModelName | null;
  flow_generation_id?: string | null;
  flow_trace?: string[];
  flow_metadata?: FlowGenerationMetadata;
  derived_from_prepared_novel_id?: string;
  derived_from_content_hash?: string;
}

export interface StudioSceneVerificationChecks {
  character_consistency: boolean;
  costume_and_weapon_accuracy: boolean;
  location_reference_match: boolean;
  action_and_composition_accuracy: boolean;
  style_and_lighting_consistency: boolean;
  no_text_or_watermarks: boolean;
  action_and_composition: boolean;
  style_and_lighting: boolean;
  previous_scene_continuity?: boolean;
}

export type SceneContinuityMode =
  | "FIRST_SCENE_NO_PREVIOUS"
  | "SAME_LOCATION_CONTINUITY_MODE"
  | "LOCATION_TRANSITION_MODE";

export type SceneContinuityStatus =
  | "PASS"
  | "NEEDS_CORRECTION"
  | "FAIL"
  | "NEEDS_MANUAL_CONTINUITY_REVIEW"
  | "FIRST_SCENE_ANCHOR"
  | "CONTINUITY_PASS"
  | "INITIAL_SCENE_ANCHOR"
  | "CONTINUITY_NEEDS_CORRECTION"
  | "CONTINUITY_FAILED"
  | "MANUAL_CONTINUITY_REVIEW_REQUIRED"
  | "UNVERIFIED";

export interface ContinuityDimensionCheck {
  match: boolean;
  issues: string[];
}

export interface FixedLandmarkContinuityItem {
  landmark: string;
  previous_image: string;
  current_image: string;
  visibility_status?: "VISIBLE_AND_CONSISTENT" | "NOT_VISIBLE_OUT_OF_FRAME" | "INCONSISTENT";
  consistency?: "MATCH" | "NOT_VISIBLE" | "CONTINUITY_ERROR" | string;
  match?: boolean;
  notes?: string;
}

export interface SceneContinuityAnalysisResult {
  previous_scene_id: string | null;
  current_scene_id: string;
  same_location: boolean;
  continuity_mode: SceneContinuityMode;
  anchor_scene_id?: string | null;
  location_reference_id?: string | null;
  actual_images_compared: string[];
  location_continuity: ContinuityDimensionCheck;
  character_continuity: ContinuityDimensionCheck;
  weapon_continuity: ContinuityDimensionCheck;
  costume_continuity: ContinuityDimensionCheck;
  environment_continuity: ContinuityDimensionCheck;
  lighting_continuity: ContinuityDimensionCheck;
  style_continuity: ContinuityDimensionCheck;
  temporal_continuity: ContinuityDimensionCheck;
  camera_composition_continuity: ContinuityDimensionCheck;
  fixed_landmarks_analysis: FixedLandmarkContinuityItem[];
  camera_variation_note?: string;
  location_transition_check?: {
    transition_logical: boolean;
    matches_new_location_reference: boolean;
    no_leftover_old_location_elements: boolean;
    issues: string[];
  };
  critical_errors: string[];
  additive_corrections: string[];
  overall_status: "PASS" | "NEEDS_CORRECTION" | "FAIL";
  reviewed_by_model?: string;
  reviewed_at: string;
}

export interface PreviousSceneContinuityContext {
  previous_scene_id: string;
  previous_scene_number: number;
  previous_scene_title: string;
  previous_scene_image_url: string | null;
  previous_scene_local_path?: string | null;
  previous_location_id: string;
  previous_location_name: string;
  same_location_as_previous: boolean;
  continuity_mode: SceneContinuityMode;
  anchor_scene_id?: string | null;
  anchor_scene_image_url?: string | null;
  anchor_scene_local_path?: string | null;
  previous_visible_landmarks: string[];
  previous_lighting: string;
  previous_character_states: string[];
  previous_weapon_states: string[];
  previous_environment_state: string;
  previous_approved_continuity_findings: string[];
}

export interface LocationContinuityAnchor {
  location_id: string;
  location_name: string;
  canonical_location_reference_url: string | null;
  canonical_location_local_path?: string | null;
  first_approved_scene_id: string;
  first_approved_scene_image_url: string | null;
  first_approved_scene_local_path?: string | null;
  latest_approved_scene_id: string;
  latest_approved_scene_image_url: string | null;
  latest_approved_scene_local_path?: string | null;
  established_landmarks: string[];
  established_lighting: string;
  updated_at: string;
}

export type LocationContinuityAnchorMap = Record<string, LocationContinuityAnchor>;

export const MAX_SCENE_CONTINUITY_ATTEMPTS = 3;

export interface StudioSceneVerificationResult {
  approved: boolean;
  verification_complete: boolean;
  all_required_checks_passed: boolean;
  vision_status?: GeminiVisionConnectionStatus;
  overall_status?: "PASS" | "NEEDS_CORRECTION" | "VISION_FAILED" | "UNVERIFIED";
  confidence?: number | null;
  score?: number;
  actual_vision_request_completed?: boolean;
  identity_match?: boolean;
  style_match?: boolean;
  composition_match?: boolean;
  location_match?: boolean;
  weapon_match?: boolean;
  character_match?: boolean;
  what_is_correct?: string[];
  what_is_missing?: string[];
  what_is_different?: string[];
  observed_in_image?: ActualImageObservation;
  continuity_analysis?: SceneContinuityAnalysisResult | null;
  additive_correction?: string;
  continuity_additive_correction?: string;
  critical_corrections?: string[];
  failed_checks: string[];
  checks: StudioSceneVerificationChecks;
  detected_issues: string[];
  corrected_prompt?: string;
  triple_verification?: TripleSceneVerificationReport | null;
  error_diagnosis_and_replan?: SceneErrorDiagnosisAndReplan | null;
  reviewed_by_model: string;
  reviewed_at: string;
}

export interface StudioSceneAttemptLog {
  attempt?: number;
  attempt_number?: number;
  version?: number;
  prompt_used: string;
  image_url: string | null;
  local_file_path?: string | null;
  flow_project_id?: string | null;
  flowProjectId?: string | null;
  flowProjectUrl?: string | null;
  flowAssetId?: string | null;
  flowGenerationId?: string | null;
  promptHash?: string | null;
  real_flow_asset_verified?: boolean;
  flow_model?: FlowDisplayModelName | string | null;
  approved: boolean;
  all_required_checks_passed?: boolean;
  continuity_status?: SceneContinuityStatus;
  continuity_analysis?: SceneContinuityAnalysisResult | null;
  score?: number;
  additive_correction?: string;
  continuity_additive_correction?: string;
  failed_checks?: string[];
  checks?: StudioSceneVerificationChecks;
  detected_issues: string[];
  corrected_prompt?: string;
  timestamp: string;
  flow_metadata?: FlowGenerationMetadata;
}

export interface FlowPerformanceTimingSummary {
  record_id?: string;
  model_id: string;
  internal_model_id: string;
  generation_id: string;
  project_id: string;
  asset_id: string;
  prompt_hash: string;
  style_hash: string;
  reference_hash: string;
  requested_aspect_ratio: string;
  actual_aspect_ratio: string;
  stage_status: string;
  preparation_time: number;
  reference_upload_time?: number;
  flow_generation_time: number;
  asset_time: number;
  vision_time: number;
  checkpoint_time: number;
  application_overhead: number;
  image_ready_total_time: number;
  total_time: number;
  warm_session_reused: boolean;
  verified_project_reused: boolean;
  prompt_cache_hit: boolean;
  reference_assets_reused_count: number;
  vision_non_blocking: boolean;
  checkpoint_non_blocking: boolean;
  performance_regression: boolean;
  regression_reason?: string | null;
  failure_category?: "NONE" | "GENERATION_FAILURE" | "POST_PROCESSING_FAILURE";
}

export interface FlowGenerationMetadata {
  generation_id: string;
  generationId?: string;
  flowGenerationId?: string;
  run_id: string;
  runId?: string;
  freshness_token: string;
  promptHash?: string;
  promptVersion?: number;
  prompt_version?: number;
  styleHash?: string;
  referenceHash?: string;
  requested_aspect_ratio?: string;
  actual_aspect_ratio?: string;
  project_id: string;
  flowProjectId?: string;
  flowProjectUrl?: string;
  flowAssetId?: string;
  flowAssetUrl?: string;
  project_name?: string;
  model_display_name: FlowDisplayModelName;
  internal_model_id: string;
  created_at: string;
  timestamp: number;
  result_source: "google_flow" | "google_flow_cookies" | "google_flow_real_project_asset";
  flow_generation_status?: FlowRealGenerationStatus;
  flow_asset_status?: FlowRealAssetStatus;
  real_flow_project_verified?: boolean;
  real_flow_asset_created?: boolean;
  real_flow_asset_verified?: boolean;
  generated_by_google_flow?: boolean;
  attempt: number;
  scene_id?: string;
  element_id?: string;
  location_id?: string;
  references_used: string[];
  reference_files_attached?: string[];
  output_file: string;
  width: number;
  height: number;
  bytes: number;
  content_type: string;
  verified_magic_header?: boolean;
  performance_timing?: FlowPerformanceTimingSummary;
}

export type StudioScenePipelineStage =
  | "IDLE"
  | "QUEUED"
  | "ANALYZING_SCENE"
  | "BUILDING_PROMPT"
  | "REQUEST_CREATING"
  | "FLOW_GENERATING"
  | "GENERATING_FLOW"
  | "GENERATING_IMAGE"
  | "RESULT_RECEIVED"
  | "IMAGE_DETECTED"
  | "IMAGE_EXTRACTING"
  | "IMAGE_DOWNLOADING"
  | "IMAGE_VALIDATING"
  | "IMAGE_CONVERTING"
  | "IMAGE_SAVED"
  | "SCENE_ATTACHED"
  | "GEMINI_INSPECTING"
  | "REFINING_PROMPT"
  | "APPROVED"
  | "COMPLETED"
  | "FAILED"
  | "NEEDS_ATTENTION"
  | "NEEDS_MANUAL_REVIEW"
  | "MANUAL_REVIEW_REQUIRED"
  | "ERROR";

export const MAX_VERIFICATION_RETRIES = 5;
export const DEFAULT_MAX_FLOW_CONCURRENCY = 3;

export interface StudioSceneLocationBinding {
  primary_location: string;
  secondary_locations: string[];
  location_evidence: string;
  location_source_text: string;
  location_entity_id: string;
  location_version: number;
  location_confidence: number;
}

export interface StudioSceneItem {
  scene_id: string;
  scene_number: number;
  scene_order?: number;
  title: string;
  description: string;
  scene_text?: string;
  scene_summary?: string;
  characters: string[];
  weapons?: string[];
  creatures?: string[];
  items?: string[];
  costumes_and_weapons: string[];
  location?: string;
  events?: string[];
  visual_requirements?: string[];
  source_text?: string;
  location_id: string;
  primary_location_id?: string;
  primary_location_name?: string;
  location_entity_id?: string;
  secondary_location_ids?: string[];
  location_name: string;
  primary_location?: string;
  secondary_locations?: string[];
  location_version?: number;
  location_confidence?: number | null;
  location_evidence?: string;
  location_source_text?: string;
  location_source_excerpt?: string;
  location_uncertain?: boolean;
  location_transition?: LocationTransitionRecord;
  source_evidence?: string;
  location_binding?: StudioSceneLocationBinding;
  /** Stage A: Canonical Analysis based strictly on text evidence */
  canonical_analysis?: CanonicalAnalysisStage;
  scene_canonical_pack?: SceneCanonicalPack;
  character_bindings?: SceneCharacterBinding[];
  weapon_bindings?: SceneWeaponBinding[];
  /** Stage B: Generation Plan combining Canonical Analysis + References + Active Style */
  generation_plan?: GenerationPlanStage;
  /** Stage C: Actual Image Verification from real Gemini Vision inspection */
  actual_image_verification?: ActualImageVerificationStage | null;
  /** Mandatory ID-based links to Script entities */
  location_ids?: string[];
  character_ids?: string[];
  weapon_ids?: string[];
  creature_ids?: string[];
  item_ids?: string[];
  building_ids?: string[];
  vehicle_ids?: string[];
  visual_bible_ids?: string[];
  locked_reference_ids_used?: string[];
  style_reference_id?: string;
  /** Sequential Scene Continuity Engine fields */
  previous_scene_id?: string | null;
  same_location_as_previous?: boolean;
  continuity_mode?: SceneContinuityMode;
  continuity_status?: SceneContinuityStatus;
  continuity_analysis?: SceneContinuityAnalysisResult | null;
  continuity_corrections?: string[];
  continuity_version?: number;
  continuity_checked_at?: string | null;
  previous_scene_continuity_context?: PreviousSceneContinuityContext | null;
  anchor_scene_id?: string | null;
  manual_continuity_correction?: string;
  action: string;
  dialogue: string;
  sfx: string;
  visual_prompt: string;
  scene_prompt?: string;
  base_prompt?: string;
  current_prompt?: string;
  manual_correction?: string;
  added_corrections?: string[];
  additive_corrections?: string[];
  correction_history?: StudioCorrectionHistoryEntry[];
  style_version?: number;
  styleHash?: string;
  style_hash?: string;
  aspect_ratio?: StudioAspectRatio | string;
  selected_model?: FlowDisplayModelName | string;
  applied_style_settings?: Record<string, any>;
  image_url: string | null;
  local_file_path?: string | null;
  approved: boolean;
  generation_status?:
    | "WAITING"
    | "QUEUED"
    | "GENERATING"
    | "GENERATED"
    | "COMPLETED"
    | "FAILED"
    | "NEEDS_REGENERATION"
    | "NEEDS_MANUAL_REVIEW";
  verification_status?: StudioVerificationStatus;
  vision_status?: GeminiVisionConnectionStatus;
  verification_result?: StudioSceneVerificationResult | null;
  version?: number;
  pipeline_stage: StudioScenePipelineStage;
  current_attempt: number;
  max_attempts: number;
  attempts_log: StudioSceneAttemptLog[];
  last_error?: string | null;
  flow_provider?: "Google Flow Cookies" | "Google Flow";
  flow_project_id?: string | null;
  flowProjectId?: string | null;
  flowProjectUrl?: string | null;
  flowAssetId?: string | null;
  flowAssetUrl?: string | null;
  flowGenerationId?: string | null;
  runId?: string | null;
  generationId?: string | null;
  promptHash?: string | null;
  flow_generation_status?: FlowRealGenerationStatus;
  flow_asset_status?: FlowRealAssetStatus;
  real_flow_project_verified?: boolean;
  real_flow_asset_created?: boolean;
  real_flow_asset_verified?: boolean;
  generated_by_google_flow?: boolean;
  flow_action_required?: boolean;
  flow_action_url?: string | null;
  flow_model?: FlowDisplayModelName | null;
  flow_generation_id?: string | null;
  flow_trace?: string[];
  flow_metadata?: FlowGenerationMetadata;
  /** Long Novel Intelligent Segmentation & Hierarchy fields */
  chapter_id?: string;
  scene_group_id?: string;
  block_id?: string;
  block_ids?: string[];
  event_ids?: string[];
  semantic_event_types?: string[];
  why_grouped_together?: string;
  why_new_scene_started_here?: string;
  coherence_score?: SceneCoherenceScore;
  emotional_state?: string;
  internal_thoughts?: string;
  important_lore?: string[];
  threats_and_foreshadowing?: string[];
  physical_state?: string;
  movement_direction?: string;
  time_of_day?: string;
  lighting_atmosphere?: string;
  character_relationships?: string[];
  camera_angle?: string;
  shot_type?: string;
  camera_rationale?: string;
  camera_plan?: StudioCameraPlan;
  shots_panels?: StudioShotPanelPlan[];
  triple_verification?: TripleSceneVerificationReport | null;
  error_diagnosis_and_replan?: SceneErrorDiagnosisAndReplan | null;
  location_continuity_anchor?: LocationContinuityAnchor | null;
  continuity_attempts?: number;
  derived_from_prepared_novel_id?: string;
  derived_from_content_hash?: string;
}

export interface StudioCameraPlan {
  shot_type: string;
  camera_angle: string;
  camera_distance: string;
  perspective: string;
  subject: string;
  character_position: string;
  environment_position: string;
  motion_direction: string;
  composition: string;
  camera_rationale?: string;
}

export interface EventCoverageMatrixRow {
  event_id: string;
  source_block: string;
  scene_id: string;
  shot_id?: string;
  panel_shot_id: string;
  panel_id?: string;
  panel_shot_ids?: string[];
  represented: "YES" | "NO";
  important: "YES" | "NO";
  event_title: string;
  event_summary?: string;
  event_type: string;
  classification_verified?: boolean;
  source_excerpt?: string;
  auto_recovered?: boolean;
  auto_replanned?: boolean;
}

export interface SceneCoherenceScore {
  location_continuity: number;
  character_continuity: number;
  time_continuity: number;
  action_continuity: number;
  narrative_continuity: number;
  visual_continuity: number;
  camera_compatibility: number;
  overall_score: number;
  total_score?: number;
  decision: "MERGE" | "SPLIT";
  rationale_ar: string;
}

export interface VisualSceneGroup {
  group_id?: string; // e.g. "GROUP_001"
  scene_id: string; // e.g. "SCENE_001"
  scene_title?: string;
  group_number?: number;
  title?: string;
  dominant_activity?: string;
  location_id?: string;
  location_name?: string;
  time_context?: string;
  characters?: string[];
  weapons_and_objects?: string[];
  block_ids?: string[];
  event_ids?: string[];
  grouped_event_ids?: string[];
  grouped_event_types?: string[];
  shot_ids?: string[];
  why_grouped_together?: string;
  why_grouped?: string;
  why_new_scene_started_here?: string;
  why_split_from_previous?: string;
  why_split_from_next?: string;
  panel_count?: number;
  coherence_score: SceneCoherenceScore;
  was_merged_from_over_segmentation?: boolean;
  was_split_from_under_segmentation?: boolean;
}

export interface EventClassificationCorrectionItem {
  event_id: string;
  block_id: string;
  source_excerpt: string;
  previous_type: string;
  corrected_type: string;
  reason_ar: string;
}

export interface EventClassificationVerificationReport {
  total_events_inspected: number;
  verified_events_count?: number;
  misclassified_events_detected: number;
  misclassified_events_corrected: number;
  corrected_events_count?: number;
  remaining_classification_errors: number;
  classification_accuracy_percentage: number;
  accuracy_After_Verification?: number;
  corrections_log: EventClassificationCorrectionItem[];
  verified_at: string;
}

export interface SegmentationBalanceFinding {
  check_type?: "OVER_SEGMENTATION_MERGE" | "UNDER_SEGMENTATION_SPLIT" | "OPTIMAL_GROUPING";
  finding_type?: "OVER_SEGMENTATION_FIXED" | "UNDER_SEGMENTATION_FIXED" | "OPTIMAL_GROUPING";
  target_ids?: string[];
  affected_scene_ids?: string[];
  affected_event_ids?: string[];
  result_scene_id?: string;
  reason_ar?: string;
  reason?: string;
  action_taken?: string;
  coherence_score?: number;
}

export interface SegmentationBalanceAudit {
  status?: "BALANCED" | "REBALANCED";
  over_segmentation_detected?: boolean;
  under_segmentation_detected?: boolean;
  over_segmentation_findings_count?: number;
  under_segmentation_findings_count?: number;
  merged_scenes_count?: number;
  micro_events_merged_count?: number;
  split_scenes_count?: number;
  compound_scenes_split_count?: number;
  average_events_per_scene?: number;
  average_panels_per_scene?: number;
  average_coherence_score?: number;
  findings: SegmentationBalanceFinding[];
  scene_completeness_passed?: boolean;
  summary_ar?: string;
}

export interface HierarchicalNovelContext {
  global_story_context?: {
    story_title: string;
    world_state: string;
    canonical_characters: string[];
    canonical_weapons: string[];
    canonical_locations: string[];
    core_lore_rules: string[];
  };
  arc_context?: {
    arc_name: string;
    current_objective: string;
    active_threats: string[];
    group_dynamics: string[];
  };
  chapter_context?: GlobalChapterContext;
  level_1_global_story?: {
    novel_title: string;
    world_rules_and_lore: string[];
    canonical_characters: Array<{
      id: string;
      name: string;
      role: string;
      locked_identity_summary: string;
      associated_weapons: string[];
    }>;
    canonical_weapons: Array<{
      id: string;
      name: string;
      owner_name: string;
      locked_visual_summary: string;
    }>;
    canonical_locations: Array<{
      id: string;
      name: string;
      locked_architecture_and_lighting: string;
    }>;
  };
  level_2_arc_volume?: {
    arc_id: string;
    arc_title: string;
    active_plotlines: string[];
    arc_threats_and_mysteries: string[];
    character_relationships_state: string[];
  };
  level_3_chapter?: {
    chapter_id: string;
    chapter_number: number;
    chapter_title: string;
    starting_location: string;
    ending_location: string;
    time_and_weather_progression: string;
    chapter_narrative_blocks_count: number;
    chapter_events_count: number;
    chapter_scenes_count: number;
    key_chapter_developments: string[];
  };
  level_4_local_scene_states?: Array<{
    scene_id: string;
    block_id: string;
    event_ids: string[];
    active_characters: string[];
    location_id: string;
    location_name: string;
    emotional_and_physical_state: string;
    camera_angle_and_shot: string;
    continuity_bridge_from_previous: string;
  }>;
}

export interface TripleSceneVerificationReport {
  pass_1_semantic: {
    pass_name: "SEMANTIC_VERIFICATION";
    passed: boolean;
    checks: {
      event_coverage_match: boolean;
      character_presence_match: boolean;
      weapon_and_costume_match: boolean;
      location_binding_match: boolean;
      camera_plan_valid: boolean;
    };
    issues: string[];
  };
  pass_2_visual: {
    pass_name: "VISUAL_VERIFICATION";
    passed: boolean;
    checks: {
      character_consistency: boolean;
      costume_and_weapon_accuracy: boolean;
      location_reference_match: boolean;
      action_and_composition: boolean;
      style_and_lighting: boolean;
      no_text_or_watermarks: boolean;
    };
    issues: string[];
  };
  pass_3_continuity_cinematic: {
    pass_name: "CONTINUITY_CINEMATIC_VERIFICATION";
    passed: boolean;
    checks: {
      previous_scene_continuity: boolean;
      character_locks_enforced: boolean;
      location_locks_enforced: boolean;
      motion_and_camera_coherence: boolean;
    };
    issues: string[];
  };
  all_three_passed: boolean;
  all_three_passes_succeeded?: boolean;
  approved: boolean;
  final_verdict?: "APPROVED" | "REJECTED";
  evaluated_at: string;
}

export interface GlobalChapterContext {
  chapter_id: string;
  chapter_title: string;
  characters: Array<{
    character_id: string;
    name: string;
    clothing_and_armor: string;
    weapons: string[];
    physical_state: string;
    emotional_state: string;
    current_location: string;
    movement_direction: string;
  }>;
  clothing_states: string[];
  weapons_states: string[];
  physical_states: string[];
  current_location: string;
  visited_locations: string[];
  movement_direction: string;
  time_progression: string;
  lighting_and_atmosphere: string;
  previous_events_summary: string[];
  important_lore_and_revelations: string[];
  threats_and_future_hooks: string[];
  character_relationships: string[];
  updated_at: string;
}

export type SemanticEventType =
  | "ENVIRONMENT_ESTABLISHING"
  | "SPATIAL_TRANSITION"
  | "ACTION_MOVEMENT"
  | "COMBAT_STRIKE"
  | "DIALOGUE_EXCHANGE"
  | "INFORMATION_REVEAL"
  | "MEMORY_FLASHBACK"
  | "INTERNAL_MONOLOGUE"
  | "EMOTIONAL_SHIFT"
  | "THREAT_EMERGENCE"
  | "CLIMAX_MOMENT";

export interface NovelSemanticEvent {
  event_id: string; // e.g., "EVENT_001"
  block_id: string; // e.g., "BLOCK_001"
  event_number: number;
  event_type: SemanticEventType | string;
  title: string;
  summary: string;
  source_text?: string;
  source_excerpt: string;
  characters: string[];
  actions?: string[];
  character_actions: string[];
  objects?: string[];
  physical_state: string;
  location: string;
  movement_direction: string;
  environment_details: string;
  lighting_and_time: string;
  dialogue: string;
  internal_thoughts: string;
  emotional_state: string;
  importance?: "HIGH" | "MEDIUM" | "LOW";
  visual_relevance?: "HIGH" | "MEDIUM" | "LOW";
  temporal_position?: string;
  classification_verified?: boolean;
  original_event_type_if_corrected?: string;
  classification_correction_reason?: string;
  important_lore: string[];
  threats_or_foreshadowing: string[];
  recommended_camera_angle: string;
  recommended_shot_type: string;
  requires_independent_scene: boolean;
  mapped_scene_group_id?: string;
  mapped_scene_id?: string;
  mapped_shot_id?: string;
  mapped_shot_ids?: string[];
}

export interface NovelChapterBlock {
  block_id: string; // e.g., "BLOCK_001"
  chapter_id: string; // e.g., "CHAPTER_221" or "CHAPTER_001"
  block_number: number;
  title: string;
  source_text: string;
  start_offset?: number;
  end_offset?: number;
  previous_block_id?: string | null;
  next_block_id?: string | null;
  paragraph_range: string;
  word_count: number;
  dominant_location: string;
  characters_present: string[];
  events: NovelSemanticEvent[];
  mapped_scene_ids: string[];
  context_snapshot: {
    location: string;
    movement_direction: string;
    time_and_lighting: string;
    emotional_tone: string;
    active_threats: string[];
    key_lore_extracted: string[];
  };
}

export interface StudioShotPanelPlan {
  shot_id: string; // e.g., "SHOT_S001_01"
  panel_id: string; // e.g., "PANEL_S001_01"
  scene_id: string; // e.g., "SCENE_001"
  event_id: string; // e.g., "EVENT_001"
  shot_number: number;
  shot_type: string; // e.g., "Extreme Wide Establishing Shot", "Low-Angle Threat Shot", "Medium Two-Shot", "Close-Up Reaction"
  camera_angle: string; // e.g., "High-Angle Bird's-Eye", "Low-Angle Worm's-Eye", "Eye-Level Over-the-Shoulder", "Dutch Angle Dynamic"
  camera_distance?: string;
  perspective?: string;
  subject?: string;
  character_position?: string;
  environment_position?: string;
  motion_direction?: string;
  composition?: string;
  camera_rationale: string;
  focal_point: string;
  blocking_and_composition: string;
  action_description: string;
  dialogue: string;
  internal_thought_or_narration: string;
  emotional_state: string;
  sfx: string;
  lighting_note: string;
  visual_prompt: string;
}

export type LongNovelPipelineStageId =
  | "NOVEL_INPUT"
  | "CHAPTER_PARSER"
  | "EVENT_EXTRACTION"
  | "EVENT_CLASSIFICATION_VERIFICATION"
  | "CHARACTER_ACTION_EXTRACTION"
  | "LOCATION_ENVIRONMENT_EXTRACTION"
  | "DIALOGUE_EXTRACTION"
  | "EMOTIONAL_STATE_EXTRACTION"
  | "IMPORTANT_LORE_EXTRACTION"
  | "VISUAL_SCENE_GROUPING"
  | "OVER_UNDER_SEGMENTATION_CHECK"
  | "VISUAL_EVENT_SEGMENTATION"
  | "SCENE_PLANNING"
  | "PANEL_SHOT_PLANNING"
  | "FINAL_SCENE_LIST";

export interface LongNovelPipelineStageResult {
  stage_id: LongNovelPipelineStageId;
  stage_number: number;
  label_ar: string;
  label_en: string;
  status: "COMPLETED" | "RUNNING" | "PENDING";
  items_extracted_count: number;
  summary_ar: string;
  retained_from_previous: boolean;
}

export interface LongNovelSegmentationReport {
  chapter_id: string;
  chapter_title: string;
  total_characters?: number;
  total_paragraphs: number;
  total_words: number;
  total_blocks: number;
  total_events: number;
  total_scene_groups?: number;
  important_events_count?: number;
  covered_events_count?: number;
  missing_events_count?: number;
  scenes_replanned_count?: number;
  total_scenes: number;
  total_shots_panels: number;
  coverage_percentage: number;
  important_coverage_percentage?: number;
  unmapped_events_count: number;
  de_merged_scenes_count: number;
  merged_scenes_count?: number;
  split_scenes_count?: number;
  event_classification_verification?: EventClassificationVerificationReport;
  scene_groups?: VisualSceneGroup[];
  visual_scene_groups?: VisualSceneGroup[];
  scene_coherence_scores?: SceneCoherenceScore[];
  segmentation_balance_audit?: SegmentationBalanceAudit;
  hierarchical_context?: HierarchicalNovelContext;
  coverage_matrix?: EventCoverageMatrixRow[];
  pipeline_stages: LongNovelPipelineStageResult[];
  global_chapter_context: GlobalChapterContext;
  blocks: NovelChapterBlock[];
  generated_at: string;
}

export type SceneFailureRootCauseCategory =
  | "CHARACTER_IDENTITY_DRIFT"
  | "WRONG_CLOTHING"
  | "WRONG_ARMOR"
  | "WRONG_WEAPON"
  | "WRONG_WEAPON_HOLDER"
  | "WRONG_LOCATION"
  | "MISSING_CHARACTER"
  | "EXTRA_CHARACTER"
  | "WRONG_ACTION"
  | "WRONG_POSE"
  | "WRONG_CAMERA_ANGLE"
  | "WRONG_SHOT_TYPE"
  | "WRONG_ENVIRONMENT"
  | "WRONG_EMOTION"
  | "WRONG_EMOTIONAL_EXPRESSION"
  | "MERGED_EVENTS_ERROR"
  | "MERGED_EVENTS_IN_ONE_IMAGE"
  | "CONTINUITY_BREAK"
  | "CONTINUITY_BREAK_WITH_PREVIOUS_SCENE"
  | "CONTINUITY_ERROR"
  | "MISSING_ELEMENT"
  | "EXTRA_ELEMENT"
  | "LIGHTING_ERROR"
  | "COMPOSITION_ERROR"
  | "TIMELINE_ERROR"
  | "EVENT_CLASSIFICATION_ERROR"
  | "CAMERA_ANGLE_INAPPROPRIATE"
  | "CHARACTER_IDENTITY_MISMATCH"
  | "WEAPON_MISSING_OR_WRONG"
  | "LOCATION_ENVIRONMENT_MISMATCH"
  | "SCALE_PROPORTION_MISMATCH"
  | "ACTION_POSE_MISMATCH"
  | "EMOTIONAL_EXPRESSION_MISMATCH"
  | "CONTINUITY_VIOLATION"
  | "UNWANTED_ARTIFACTS_OR_TEXT";

export type SceneFailureRootCause = SceneFailureRootCauseCategory;

export interface SceneErrorDiagnosisAndReplan {
  diagnosed_at: string;
  root_cause_categories: SceneFailureRootCauseCategory[];
  camera_angle_appropriate: boolean;
  previous_camera_angle: string;
  recommended_camera_angle: string;
  recommended_shot_type: string;
  recommended_camera_plan?: StudioCameraPlan;
  re_planned_blocking_and_composition: string;
  actionable_fixes: string[];
  required_changes?: string[];
  forbidden_changes?: string[];
  prompt_v1?: string;
  re_planned_prompt: string;
  prompt_changed?: boolean;
  replan_summary_ar: string;
}

export type StudioCheckpointStage =
  | "SCRIPT_READY"
  | "ELEMENTS_READY"
  | "LOCATIONS_READY"
  | "LOCATION_GENERATION"
  | "LOCATION_VERIFICATION"
  | "SCENE_PLAN_READY"
  | "SCENE_GENERATION"
  | "SCENE_VERIFICATION";

export interface StudioCheckpointState {
  checkpoint_id?: string;
  saved_at?: string;
  project_title?: string;
  current_step?: number;
  script_saved: boolean;
  blocks_saved_count?: number;
  events_saved_count?: number;
  shots_saved_count?: number;
  coverage_matrix_saved?: boolean;
  camera_plans_saved?: boolean;
  triple_verifications_saved?: boolean;
  elements_saved?: boolean;
  elements_locked_count?: number;
  elements_total_count?: number;
  characters_saved_count?: number;
  weapons_saved_count?: number;
  items_saved_count?: number;
  locations_saved?: boolean;
  locations_locked_count?: number;
  locations_total_count?: number;
  location_images_saved?: boolean;
  verified_locations_saved?: boolean;
  references_locked_saved?: boolean;
  scenes_saved?: boolean;
  scenes_completed_count?: number;
  scenes_total_count?: number;
  generated_scene_images_saved?: boolean;
  verified_scenes_saved?: boolean;
  manhwa_pages_saved?: boolean;
  manhwa_pages_count?: number;
  manhwa_panels_count?: number;
  manhwa_verified_pages_count?: number;
  page_generation_mode?: PageGenerationMode;
  active_source?: string;
  prepared_novel_id?: string;
  content_hash?: string;
  status?: string;
  prepared_novel_data?: import("../utils/preparedNovelParser").PreparedNovelData | null;
  active_prepared_novel_data?: import("../utils/preparedNovelParser").PreparedNovelData | null;
  events?: any[];
  ordered_events?: any[];
  resumable?: boolean;
  last_saved_at?: string;
}

export interface StudioPipelineTelemetry {
  gemini_requests_count: number;
  gemini_cache_hits: number;
  flow_requests_count: number;
  regeneration_attempts_count?: number;
  flow_regenerations_count?: number;
  script_duration_ms?: number;
  script_analysis_ms?: number;
  references_duration_ms?: number;
  references_generation_ms?: number;
  scenes_duration_ms?: number;
  scenes_generation_ms?: number;
  total_duration_ms?: number;
  locked_elements_count?: number;
  approved_scenes_count?: number;
  total_scenes_count?: number;
  warm_session_active: boolean;
  updated_at?: string;
  timestamp?: string;
  [key: string]: any;
}

export interface StudioAnalysisValidationReport {
  response_received: boolean;
  non_empty: boolean;
  json_parsed: boolean;
  required_fields_valid: boolean;
  saved: boolean;
  step_complete: boolean;
  scenes_count: number;
  locations_count: number;
  elements_count: number;
  characters_count?: number;
  weapons_count?: number;
  items_count?: number;
  creatures_count?: number;
  blocks_count?: number;
  events_count?: number;
  shots_panels_count?: number;
  coverage_percentage?: number;
  validated_at: string;
  duration_ms?: number;
  cached?: boolean;
}

// ============================================================================
// 14. KOREAN MANHWA PAGE LAYOUT SYSTEM (Chapter -> Scenes -> Pages -> Panels -> Frames)
// ============================================================================

export type PageGenerationMode = "SCENE_PER_PAGE" | "KOREAN_MANHWA_PAGES";

export type ManhwaPageStatus =
  | "WAITING"
  | "PLANNING"
  | "GENERATING"
  | "ASSEMBLING"
  | "VERIFYING"
  | "APPROVED"
  | "REGENERATING"
  | "FAILED";

export type ManhwaPanelStatus =
  | "WAITING"
  | "GENERATING"
  | "VERIFYING"
  | "APPROVED"
  | "REGENERATING"
  | "FAILED";

export type ManhwaPanelFrameType =
  | "RECTANGULAR"
  | "TALL_VERTICAL"
  | "WIDE_HORIZONTAL"
  | "FULL_BLEED"
  | "HERO_PANEL"
  | "SPLIT_LEFT"
  | "SPLIT_RIGHT"
  | "IRREGULAR_DRAMATIC"
  | "BORDERLESS_AMBIENT";

export type ManhwaPanelSize =
  | "SMALL"
  | "MEDIUM"
  | "LARGE"
  | "EXTRA_LARGE"
  | "FULL_WIDTH"
  | "TALL_VERTICAL"
  | "HERO";

export type ManhwaPanelType =
  | "ESTABLISHING"
  | "CHARACTER_INTRO"
  | "ACTION"
  | "REACTION"
  | "DIALOGUE"
  | "CLOSE_UP"
  | "WIDE_REVEAL"
  | "TRANSITION"
  | "CLIFFHANGER"
  | "DRAMATIC_EMPHASIS";

export type ManhwaPageLayoutType =
  | "VERTICAL_SCROLL_DYNAMIC"
  | "HERO_ESTABLISHING_SPLIT"
  | "ACTION_RHYTHM_QUAD"
  | "DIALOGUE_INTERACTION_MULTI"
  | "TALL_MONUMENTAL_REVEAL"
  | "DRAMATIC_CLIFFHANGER_FINALE"
  | "SCENE_PER_PAGE_FULL_IMAGE"
  | "CUSTOM_DYNAMIC";

export interface ScenePerPagePlan {
  page_id: string; // e.g. "PAGE_001"
  chapter_id: string; // e.g. "CHAPTER_221"
  page_number: number;
  scene_id: string; // Direct 1-to-1 link (SCENE_001)
  scene_number: number;
  title: string;
  description: string;
  action: string;
  dialogue?: string;
  sfx?: string;
  image_url: string | null;
  local_file_path?: string | null;
  aspect_ratio: string;
  camera_angle: string;
  shot_type: string;
  camera_plan?: StudioCameraPlan;
  visual_prompt: string;
  characters: string[];
  character_ids?: string[];
  weapon_ids?: string[];
  location_id: string;
  location_name: string;
  approved: boolean;
  status: ManhwaPageStatus;
  verification_result?: StudioSceneVerificationResult | null;
  page_mode: "SCENE_PER_PAGE";
  image_count: 1;
  has_frames: false;
  has_panels: false;
  panel_count: 0;
  created_at: string;
  updated_at: string;
}

export interface ChapterScenePerPageLayoutPlan {
  chapter_id: string;
  chapter_title: string;
  page_mode: "SCENE_PER_PAGE";
  total_scenes: number;
  total_pages: number;
  total_images: number;
  total_panels: 0;
  total_frames: 0;
  pages: ScenePerPagePlan[];
  traceability_matrix: Array<{
    event_id: string;
    source_block: string;
    scene_id: string;
    page_id: string;
    panel_id: string;
    shot_id: string;
    represented: "YES" | "NO";
    important: "YES" | "NO";
  }>;
  status: ManhwaPageStatus;
  planned_at: string;
  updated_at: string;
}

export interface ManhwaPanelPlan {
  panel_id: string; // e.g. "PANEL_P001_01"
  page_id: string; // e.g. "PAGE_001"
  scene_id: string; // e.g. "SCENE_001"
  event_ids: string[];
  shot_id: string; // e.g. "SHOT_SCENE_001_01"
  panel_order: number; // 1, 2, 3..
  reading_order: number; // Top -> Bottom sequence (1..N)
  panel_type: ManhwaPanelType;
  frame_type: ManhwaPanelFrameType;
  panel_size: ManhwaPanelSize;
  relative_height_weight: number; // 1.0 = standard, 1.5 = tall, 2.0 = large hero
  grid_column_span: "full" | "half_left" | "half_right" | "third";
  shot_type: string;
  camera_angle: string;
  camera_distance?: string;
  subject: string;
  action: string;
  emotion?: string;
  dialogue?: string;
  speaker_name?: string;
  sfx?: string;
  internal_narration?: string;
  character_ids: string[];
  character_names: string[];
  weapon_ids: string[];
  location_id: string;
  location_name: string;
  composition: string;
  visual_prompt: string;
  assembled_flow_prompt?: string;
  image_url?: string | null;
  local_file_path?: string | null;
  status: ManhwaPanelStatus;
  triple_verification?: TripleSceneVerificationReport | null;
  error_diagnosis?: SceneErrorDiagnosisAndReplan | null;
  last_error?: string | null;
  version: number;
  flow_project_id?: string | null;
  flow_asset_id?: string | null;
}

export interface ManhwaPageVerificationReport {
  page_id: string;
  reading_order_valid: boolean;
  panels_count_valid: boolean;
  frames_and_gutters_valid: boolean;
  no_panel_overlap: boolean;
  rhythm_and_composition_score: number; // 0..100
  event_coverage_complete: boolean;
  all_panels_approved: boolean;
  overall_page_approved: boolean;
  detected_issues: string[];
  actionable_fixes: string[];
  verified_at: string;
}

export interface ManhwaPagePlan {
  page_id: string; // e.g. "PAGE_001"
  chapter_id: string; // e.g. "CHAPTER_221"
  page_number: number;
  page_order: number;
  scene_ids: string[];
  event_ids: string[];
  layout_type: ManhwaPageLayoutType;
  page_goal: string;
  dramatic_beat: string;
  visual_rhythm: string; // e.g. "Wide Establishing → Character Reaction → Large Hero Action"
  panel_count: number;
  panels: ManhwaPanelPlan[];
  gutter_size_px: number; // e.g. 16px
  border_width_px: number; // e.g. 3px
  border_color: string; // e.g. "#0f172a"
  aspect_ratio: string; // e.g. "Webtoon Vertical Strip (9:24)" or "9:16"
  assembled_page_image_url?: string | null;
  assembled_page_local_path?: string | null;
  has_cliffhanger_ending: boolean;
  cliffhanger_description?: string;
  reading_direction: "TOP_TO_BOTTOM";
  page_mode?: PageGenerationMode;
  status: ManhwaPageStatus;
  page_verification_report?: ManhwaPageVerificationReport | null;
  created_at: string;
  updated_at: string;
}

export interface ChapterManhwaLayoutPlan {
  chapter_id: string;
  chapter_title: string;
  page_mode?: PageGenerationMode;
  total_scenes: number;
  total_pages: number;
  total_panels: number;
  average_panels_per_page: number;
  pages: ManhwaPagePlan[];
  traceability_matrix: Array<{
    event_id: string;
    source_block: string;
    scene_id: string;
    page_id: string;
    panel_id: string;
    shot_id: string;
    represented: "YES" | "NO";
    important: "YES" | "NO";
  }>;
  status: ManhwaPageStatus;
  planned_at: string;
  updated_at: string;
}

export interface NormalizedStoryAnalysis {
  characters: any[];
  locations: any[];
  events: any[];
  scenes: any[];
  weapons: any[];
  items: any[];
  creatures: any[];
  buildings: any[];
  vehicles: any[];
  production_elements: any[];
}

export interface StudioScriptAnalysisResult {
  project_title: string;
  script_text: string;
  production_elements: StudioProductionElement[];
  locations: StudioLocationItem[];
  scenes: StudioSceneItem[];
  characters?: any[];
  weapons?: any[];
  items?: any[];
  creatures?: any[];
  buildings?: any[];
  vehicles?: any[];
  events?: any[];
  gemini_model_used: string;
  validation_report?: StudioAnalysisValidationReport;
  telemetry?: StudioPipelineTelemetry;
  long_novel_pipeline?: LongNovelSegmentationReport;
  long_novel_segmentation_report?: LongNovelSegmentationReport;
  manhwa_layout_plan?: ChapterManhwaLayoutPlan;
  global_chapter_context?: GlobalChapterContext;
  blocks?: NovelChapterBlock[];
}

export const NOVEL_STUDIO_ANALYSIS_PROVIDER = "gemini_cookies" as const;
export const NOVEL_STUDIO_IMAGE_PROVIDER = "google_flow" as const;

export type {
  ActivePreparedNovelData,
  PreparedNovelData,
  PreparedNovelStatus,
  PreparedNovelValidationResult,
} from "../utils/preparedNovelParser";

export {
  adoptPreparedNovelDataset,
  isDatasetAdopted,
} from "../utils/preparedNovelParser";

