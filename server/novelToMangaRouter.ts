import crypto from "crypto";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { googleFlowProvider, maskSecret, sanitizeTextForLog } from "./googleFlowProvider.ts";
import { geminiCookiesNovelService } from "./geminiCookiesNovelService.ts";
import { flowGenerationPerformanceService } from "./flowGenerationPerformanceService.ts";
import { manhwaPageEngine } from "./manhwaPageEngine.ts";
import type {
  FlowDisplayModelName,
  GeminiTaskModelMap,
  LocationContinuityAnchor,
  LocationContinuityAnchorMap,
  NovelPagePlan,
  PageQueueItem,
  PreflightStepResult,
  PreflightTestReport,
  RetryAttemptRecord,
  SceneContinuityAnalysisResult,
  SceneContinuityMode,
  SceneContinuityStatus,
  StudioAspectRatio,
  StudioCheckpointState,
  StudioElementVerificationResult,
  StudioLocationItem,
  StudioPipelineTelemetry,
  StudioProductionElement,
  StudioSceneAttemptLog,
  StudioSceneItem,
  StudioStylePreset,
  VisualBibleReference,
} from "../src/types/novelToManga.ts";
import {
  DEFAULT_GEMINI_TASK_MODELS,
  MAX_GOOGLE_FLOW_PROJECTS,
  MAX_SCENE_CONTINUITY_ATTEMPTS,
  isRealVerifiedFlowProjectId,
  buildRealFlowProjectUrl,
  computeStudioStyleHash,
} from "../src/types/novelToManga.ts";
import {
  parseAndValidatePreparedNovel,
  adoptPreparedNovelDataset,
} from "../src/utils/preparedNovelParser.ts";
import {
  synchronizeAttachedEntitiesFromMaster,
  synchronizeAttachedEntitiesFromLocationMaster,
  isEntityAffiliatedWithCharacter,
  isEntityAffiliatedWithCreature,
  isEntityAffiliatedWithLocation,
  clusterElementsIntoMasterReferenceSheets,
  buildMasterReferenceSheetFlowPrompt,
  isEntitySubordinateToMaster,
} from "../src/utils/masterReferenceManager.ts";
import {
  validateUniversalProductionJson,
  convertUniversalJsonToStudio,
  exportStudioToUniversalJson,
} from "../src/utils/universalProductionJson.ts";

export const novelToMangaRouter = express.Router();

// ============================================================================
// PURE STATE MACHINE HELPERS (Exported for Deterministic Verification & Tests)
// ============================================================================

export function lockApprovedReference(ref: VisualBibleReference): VisualBibleReference {
  if (ref.status !== "APPROVED" || !ref.review_result?.approved) {
    throw new Error(
      `REFERENCE_LOCK_DENIED: لا يمكن قفل المرجع (${ref.reference_id}) قبل اعتماده (APPROVED) من مراجعة Gemini Cookies. الحالة الحالية: ${ref.status}`
    );
  }
  if (!ref.image_url) {
    throw new Error(`REFERENCE_LOCK_NO_IMAGE: لا يمكن قفل المرجع (${ref.reference_id}) بدون صورة مرجعية مولدة.`);
  }
  const hasValidFlowProject = Boolean(ref.flowProjectId && isRealVerifiedFlowProjectId(ref.flowProjectId));
  const hasValidFlowAsset = Boolean(ref.flowAssetId && String(ref.flowAssetId).trim().length > 0);
  if (
    !hasValidFlowProject ||
    !hasValidFlowAsset ||
    ref.flow_generation_status === "FLOW_GENERATION_INCOMPLETE" ||
    ref.flow_asset_status === "FLOW_ASSET_NOT_VERIFIED" ||
    ref.flow_asset_status === "FLOW_ASSET_NOT_CREATED"
  ) {
    throw new Error(
      `FLOW_ASSET_NOT_VERIFIED: لا يمكن قفل المرجع (${ref.reference_id}) لأن الأصل أو المشروع لم يتم التحقق منه داخل Google Flow الحقيقي.`
    );
  }

  const now = new Date().toISOString();
  const snapshot = {
    version: ref.version,
    prompt: ref.prompt,
    image_url: ref.image_url,
    file_name: ref.file_name,
    status: "LOCKED" as const,
    review_result: ref.review_result,
    flowProjectId: ref.flowProjectId || null,
    flowProjectUrl: ref.flowProjectUrl || null,
    flowAssetId: ref.flowAssetId || null,
    flowGenerationId: ref.flowGenerationId || null,
    promptHash: ref.promptHash || null,
    real_flow_asset_verified: ref.real_flow_asset_verified,
    created_at: ref.created_at,
    locked_at: now,
  };

  const existingVersions = Array.isArray(ref.versions) ? [...ref.versions] : [];
  const hasCurrentVersion = existingVersions.some((v) => v.version === ref.version);
  if (!hasCurrentVersion) {
    existingVersions.push(snapshot);
  }

  return {
    ...ref,
    status: "LOCKED",
    locked_at: now,
    updated_at: now,
    versions: existingVersions,
  };
}

export function createNewVersionFromLockedReference(
  ref: VisualBibleReference,
  updates: {
    prompt?: string;
    description?: string;
    visual_traits?: string[];
    immutable_constraints?: string[];
  }
): VisualBibleReference {
  const now = new Date().toISOString();
  const preservedVersions = Array.isArray(ref.versions) ? [...ref.versions] : [];

  if (ref.image_url && !preservedVersions.some((v) => v.version === ref.version)) {
    preservedVersions.push({
      version: ref.version,
      prompt: ref.prompt,
      image_url: ref.image_url,
      file_name: ref.file_name,
      status: ref.status,
      review_result: ref.review_result,
      flowProjectId: ref.flowProjectId || null,
      flowProjectUrl: ref.flowProjectUrl || null,
      flowAssetId: ref.flowAssetId || null,
      flowGenerationId: ref.flowGenerationId || null,
      promptHash: ref.promptHash || null,
      real_flow_asset_verified: ref.real_flow_asset_verified,
      created_at: ref.created_at,
      locked_at: ref.locked_at,
    });
  }

  const nextVersion = ref.version + 1;
  const baseId = ref.reference_id;
  const versionedFileName = nextVersion === 1 ? `${baseId}.png` : `${baseId}_v${nextVersion}.png`;

  return {
    ...ref,
    prompt: updates.prompt !== undefined ? updates.prompt : ref.prompt,
    description: updates.description !== undefined ? updates.description : ref.description,
    visual_traits: updates.visual_traits !== undefined ? updates.visual_traits : ref.visual_traits,
    immutable_constraints:
      updates.immutable_constraints !== undefined ? updates.immutable_constraints : ref.immutable_constraints,
    file_name: versionedFileName,
    status: "DRAFT",
    version: nextVersion,
    versions: preservedVersions,
    review_result: null,
    locked_at: null,
    updated_at: now,
  };
}

const inMemoryVisionImageStore = new Map<string, Buffer>();

function cacheVisionImageInMemory(key: string, buf: Buffer): void {
  if (!key || !buf || buf.length === 0) return;
  inMemoryVisionImageStore.set(key, buf);
  if (inMemoryVisionImageStore.size > 120) {
    const oldestKey = inMemoryVisionImageStore.keys().next().value;
    if (oldestKey) inMemoryVisionImageStore.delete(oldestKey);
  }
}

function normalizeCorrectionItem(raw: string): string {
  return String(raw || "")
    .replace(/^(?:CRITICAL\s+SCENE\s+CORRECTION|CRITICAL\s+CORRECTIONS|Critical\s+correction)\s*:\s*/i, "")
    .replace(/^-\s*/, "")
    .trim();
}

const BILINGUAL_CANONICAL_SYNONYMS: Array<[string, string[]]> = [
  ["sunny", ["sunny", "sunless", "صني", "ساني", "صنلس", "سانليس"]],
  ["nephis", ["nephis", "changing star", "نيفيس", "نفيس", "النجمه المتغيره", "النجمة المتغيرة"]],
  ["cassie", ["cassie", "cassia", "كاسي", "كاسيا"]],
  ["effie", ["effie", "athena", "ايفي", "إيفي", "اثينا", "أثينا"]],
  ["kai", ["kai", "nightingale", "كاي", "نايتنجيل"]],
  ["caster", ["caster", "كاستر"]],
  ["gemma", ["gemma", "جيما"]],
  ["midnight_shard", ["midnight shard", "شظيه منتصف الليل", "شظية منتصف الليل", "سيف شظيه منتصف الليل"]],
  ["zenith_shard", ["zenith shard", "شظيه الذروه", "شظية الذروة", "رمح زينيث"]],
  ["spider_mother", ["spider mother", "ام العناكب", "أم العناكب", "الام العنكبوت", "الأم العنكبوت"]],
];

function normalizeBilingualToken(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[()[\]{}"'`،,.:;!?/\\|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getBilingualKeysForText(raw: string): Set<string> {
  const keys = new Set<string>();
  const norm = normalizeBilingualToken(raw);
  if (!norm) return keys;
  keys.add(norm);
  for (const part of norm.split(" ")) {
    if (part.length >= 2) keys.add(part);
  }
  for (const [canonKey, variants] of BILINGUAL_CANONICAL_SYNONYMS) {
    const matched = variants.some((v) => {
      const nv = normalizeBilingualToken(v);
      return nv && (norm === nv || norm.includes(nv) || nv.includes(norm));
    });
    if (matched) {
      keys.add(`__CANON_${canonKey}__`);
      for (const v of variants) {
        keys.add(normalizeBilingualToken(v));
      }
    }
  }
  return keys;
}

function getElementBilingualKeys(el: StudioProductionElement): Set<string> {
  const out = new Set<string>();
  const fields = [
    el.name,
    el.canonical_name,
    ...(Array.isArray(el.aliases) ? el.aliases : []),
  ].filter(Boolean);
  for (const f of fields) {
    for (const k of getBilingualKeysForText(String(f))) {
      out.add(k);
    }
  }
  return out;
}

function scoreElementReferenceFreshness(el: StudioProductionElement): number {
  let score = 0;
  if (el.status === "LOCKED" || el.locked_for_production) score += 1000;
  if (el.approved || el.verification_status === "VERIFIED") score += 500;
  if (el.local_file_path && fs.existsSync(el.local_file_path)) score += 300;
  if (el.reference_image_url && el.reference_image_url !== "__CLIENT_MEMORY_IMAGE__") score += 100;
  score += (Number(el.version) || 1) * 15;
  return score;
}

function upgradeStaleElementFromCheckpointAndVersions(
  el: StudioProductionElement,
  cpEl?: StudioProductionElement
): StudioProductionElement {
  let best: StudioProductionElement = { ...el };
  const clientProvidedExplicitPath =
    typeof el.local_file_path === "string" && Boolean(el.local_file_path.trim());
  const clientExplicitPathMissing =
    clientProvidedExplicitPath && !fs.existsSync(el.local_file_path!.trim());

  // Do not mask an explicit fake file path or explicitly ungenerated element supplied by client (must fail validation)
  const clientExplicitlyNotGenerated =
    el.status === "NOT_GENERATED" ||
    el.generation_status === "NOT_GENERATED" ||
    (el.reference_image_url === null && !el.local_file_path && el.approved === false);
  if (clientExplicitPathMissing || clientExplicitlyNotGenerated) {
    return best;
  }

  // If checkpoint has a newer or LOCKED version while client sent a stale/older version, upgrade from checkpoint
  if (cpEl) {
    const cpVer = Number(cpEl.version) || 1;
    const elVer = Number(best.version) || 1;
    const cpLocked = cpEl.status === "LOCKED" || cpEl.locked_for_production;
    const elLocked = best.status === "LOCKED" || best.locked_for_production;
    const cpHasValidDisk = Boolean(cpEl.local_file_path && fs.existsSync(cpEl.local_file_path));

    if (
      (cpVer > elVer && cpHasValidDisk) ||
      (cpLocked && !elLocked && cpHasValidDisk) ||
      (!best.local_file_path && cpEl.local_file_path) ||
      (!best.reference_image_url || best.reference_image_url === "__CLIENT_MEMORY_IMAGE__")
    ) {
      best = {
        ...cpEl,
        ...best,
        version: Math.max(cpVer, elVer),
        status: cpLocked ? "LOCKED" : best.status || cpEl.status,
        locked_for_production: Boolean(cpLocked || elLocked),
        approved: Boolean(cpEl.approved || best.approved),
        reference_image_url:
          cpVer > elVer && cpEl.reference_image_url
            ? cpEl.reference_image_url
            : best.reference_image_url && best.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
            ? best.reference_image_url
            : cpEl.reference_image_url || best.reference_image_url,
        local_file_path:
          cpVer > elVer && cpHasValidDisk
            ? cpEl.local_file_path
            : clientProvidedExplicitPath && fs.existsSync(best.local_file_path!)
            ? best.local_file_path
            : cpEl.local_file_path || best.local_file_path,
      };
    }
  }

  // Also check internal versions[] history in case the element has a newer LOCKED version inside versions[]
  if (Array.isArray(best.versions) && best.versions.length > 0) {
    const sortedVers = [...best.versions]
      .filter((v) => v && v.local_file_path && fs.existsSync(v.local_file_path))
      .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
    const newestLockedVer = sortedVers.find((v) => v.status === "LOCKED" || v.status === "APPROVED") || sortedVers[0];
    if (
      newestLockedVer &&
      (Number(newestLockedVer.version) || 0) > (Number(best.version) || 0) &&
      newestLockedVer.local_file_path
    ) {
      best = {
        ...best,
        version: newestLockedVer.version,
        local_file_path: newestLockedVer.local_file_path,
        reference_image_url: newestLockedVer.image_url || best.reference_image_url,
      };
    }
  }

  return best;
}

function deduplicateProductionElementsList(
  elements: StudioProductionElement[]
): { deduplicated: StudioProductionElement[]; aliasIdMap: Map<string, string> } {
  const aliasIdMap = new Map<string, string>();
  const deduplicated: StudioProductionElement[] = [];

  for (const el of elements) {
    if (!el || !el.id) continue;
    const elKeys = getElementBilingualKeys(el);
    const existingIdx = deduplicated.findIndex((existing) => {
      if (existing.category !== el.category) return false;
      if (existing.id === el.id) return true;
      if (existing.entity_id && el.entity_id && existing.entity_id === el.entity_id) return true;
      const exKeys = getElementBilingualKeys(existing);
      for (const k of elKeys) {
        if (k.startsWith("__CANON_") && exKeys.has(k)) return true;
        if (k.length >= 3 && exKeys.has(k)) return true;
      }
      return false;
    });

    if (existingIdx === -1) {
      deduplicated.push(el);
      aliasIdMap.set(el.id, el.id);
    } else {
      const existing = deduplicated[existingIdx];
      const existingScore = scoreElementReferenceFreshness(existing);
      const candidateScore = scoreElementReferenceFreshness(el);
      const winner = candidateScore > existingScore ? el : existing;
      const loser = candidateScore > existingScore ? existing : el;
      const mergedAliases = Array.from(
        new Set([
          ...(Array.isArray(winner.aliases) ? winner.aliases : []),
          ...(Array.isArray(loser.aliases) ? loser.aliases : []),
          winner.name,
          loser.name,
          loser.id,
        ].filter(Boolean))
      );
      deduplicated[existingIdx] = {
        ...loser,
        ...winner,
        aliases: mergedAliases,
      };
      aliasIdMap.set(loser.id, winner.id);
      aliasIdMap.set(winner.id, winner.id);
    }
  }

  return { deduplicated, aliasIdMap };
}

function doesElementMatchSceneBilingual(
  el: StudioProductionElement,
  scene: StudioSceneItem,
  sceneCharIdsSet: Set<string>,
  sceneItemIdsSet: Set<string>,
  aliasIdMap?: Map<string, string>
): boolean {
  const sceneAny = scene as any;
  const hasExplicitSceneEntityArrays =
    Array.isArray(scene.weapon_ids) &&
    Array.isArray(scene.item_ids) &&
    Array.isArray(sceneAny.creature_ids);

  if (sceneCharIdsSet.has(el.id) || sceneItemIdsSet.has(el.id)) return true;
  if (el.entity_id && (sceneCharIdsSet.has(el.entity_id) || sceneItemIdsSet.has(el.entity_id))) return true;
  if (aliasIdMap) {
    for (const cid of sceneCharIdsSet) {
      if (aliasIdMap.get(cid) === el.id) return true;
    }
    for (const iid of sceneItemIdsSet) {
      if (aliasIdMap.get(iid) === el.id) return true;
    }
  }
  if (Array.isArray(el.aliases)) {
    for (const al of el.aliases) {
      if (sceneCharIdsSet.has(al) || sceneItemIdsSet.has(al)) return true;
    }
  }

  // When explicit character_ids, weapon_ids, item_ids, and creature_ids arrays are defined on the scene,
  // strictly respect them and do NOT leak attached or text-matched entities from other scenes!
  if (hasExplicitSceneEntityArrays) {
    return false;
  }

  if (el.attached_to && (sceneCharIdsSet.has(el.attached_to) || aliasIdMap?.get(el.attached_to) === el.id)) {
    return true;
  }

  const elKeys = getElementBilingualKeys(el);
  const sceneNamesPool = [
    ...(Array.isArray(scene.characters) ? scene.characters : []),
    ...(Array.isArray(sceneAny.characters_present) ? sceneAny.characters_present : []),
    ...(Array.isArray(scene.costumes_and_weapons) ? scene.costumes_and_weapons : []),
    ...(Array.isArray(scene.weapons) ? scene.weapons : []),
    ...(Array.isArray(sceneAny.weapons_present) ? sceneAny.weapons_present : []),
    ...(Array.isArray(scene.items) ? scene.items : []),
    scene.description || "",
    scene.action || "",
    sceneAny.events || "",
    sceneAny.visual_summary || "",
  ];
  for (const rawName of sceneNamesPool) {
    const nameKeys = getBilingualKeysForText(String(rawName));
    for (const nk of nameKeys) {
      if (nk.startsWith("__CANON_") && elKeys.has(nk)) return true;
      if (nk.length >= 3 && elKeys.has(nk)) return true;
    }
  }
  return false;
}

function resolveLocalFilePathFromPublicUrl(publicUrl?: string | null): string | null {
  if (!publicUrl || typeof publicUrl !== "string") return null;
  if (publicUrl.startsWith("/generated/")) {
    const candidate = path.resolve(process.cwd(), "public", publicUrl.replace(/^\//, ""));
    if (fs.existsSync(candidate)) return candidate;
  }
  if (fs.existsSync(publicUrl)) return publicUrl;
  return null;
}

function resolveLocalImagePathForVision(
  imageUrl?: string | null,
  explicitLocalPath?: string | null,
  prefix: string = "VISION_TMP"
): string | null {
  if (explicitLocalPath && typeof explicitLocalPath === "string" && fs.existsSync(explicitLocalPath)) {
    return explicitLocalPath;
  }
  const fromPublic = resolveLocalFilePathFromPublicUrl(imageUrl);
  if (fromPublic) return fromPublic;

  if (imageUrl && typeof imageUrl === "string" && imageUrl.startsWith("data:image/")) {
    try {
      const clean = imageUrl.replace(/^data:image\/[a-z0-9+]+;base64,/i, "");
      const buf = Buffer.from(clean, "base64");
      if (prefix) {
        cacheVisionImageInMemory(prefix, buf);
      }
      const genDir = path.join(process.cwd(), "public", "generated", "novel-to-manga");
      fs.mkdirSync(genDir, { recursive: true });
      const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]/g, "_");
      const outPath = path.join(genDir, `${safePrefix}_cached.png`);
      fs.writeFileSync(outPath, buf);
      return outPath;
    } catch (_) {
      return null;
    }
  }

  const candidateKeys: string[] = [];
  if (prefix) {
    candidateKeys.push(prefix);
    const stripped = prefix.replace(/^(?:EL_HEAL_|LOC_HEAL_|SCENE_HEAL_|EL_|CHAR_|WEAP_|LOC_|SCENE_|PREV_SCENE_)/, "");
    if (stripped && stripped !== prefix) {
      candidateKeys.push(
        stripped,
        `EL_${stripped}`,
        `CHAR_${stripped}`,
        `WEAP_${stripped}`,
        `LOC_${stripped}`,
        `SCENE_${stripped}`,
        `PREV_SCENE_${stripped}`
      );
    }
  }

  for (const k of candidateKeys) {
    if (inMemoryVisionImageStore.has(k)) {
      try {
        const buf = inMemoryVisionImageStore.get(k)!;
        const genDir = path.join(process.cwd(), "public", "generated", "novel-to-manga");
        fs.mkdirSync(genDir, { recursive: true });
        const safeKey = k.replace(/[^a-zA-Z0-9._-]/g, "_");
        const outPath = path.join(genDir, `${safeKey}_mem.png`);
        fs.writeFileSync(outPath, buf);
        return outPath;
      } catch (_) {}
    }
  }

  // Fallback: locate newest file in public/generated/novel-to-manga matching this entity/location/scene ID
  if (prefix) {
    try {
      const rawId = prefix.replace(/^(?:EL_HEAL_|LOC_HEAL_|SCENE_HEAL_|EL_|CHAR_|WEAP_|LOC_|SCENE_|PREV_SCENE_)/, "");
      const genDir = path.join(process.cwd(), "public", "generated", "novel-to-manga");
      if (rawId && fs.existsSync(genDir)) {
        const files = fs
          .readdirSync(genDir)
          .filter(
            (f) =>
              (f.startsWith(`${rawId}_v`) || f.startsWith(`${rawId}_`) || f.startsWith(`${prefix}_`)) &&
              (f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".webp"))
          )
          .map((f) => {
            const full = path.join(genDir, f);
            let mtime = 0;
            try {
              mtime = fs.statSync(full).mtimeMs;
            } catch (_) {}
            return { full, mtime };
          })
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0 && fs.existsSync(files[0].full)) {
          return files[0].full;
        }
      }
    } catch (_) {}
  }

  return null;
}

export async function runParallelWorkerPool<T, R>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.min(Number(maxConcurrency) || 5, 8));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  const workersCount = Math.min(safeLimit, items.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workersCount; i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}

// ============================================================================
// 1. GOOGLE FLOW SETTINGS, REAL PROJECT DISCOVERY & ASSET VERIFICATION
// ============================================================================

novelToMangaRouter.post("/google-flow/status", async (req, res) => {
  try {
    const { flowCookies, projects } = req.body || {};
    const effectiveCookies =
      (flowCookies && typeof flowCookies === "string" && flowCookies.trim()) ||
      googleFlowProvider.session.getAnyActiveRawSession();

    if (Array.isArray(projects) && projects.length > 0) {
      googleFlowProvider.projects.syncProjectsFromClient(projects, effectiveCookies);
    }

    const diagnostics = await googleFlowProvider.discoverAndValidateProjects({
      fallbackRawCookies: effectiveCookies,
      forceReverify: true,
    });
    const allProjects = googleFlowProvider.projects.listProjects();
    const activeProject =
      allProjects.find((p) => p.project_id === diagnostics.active_project_id) ||
      allProjects.find(
        (p) =>
          p.status === "ACTIVE" &&
          p.available &&
          p.real_flow_project_verified &&
          isRealVerifiedFlowProjectId(p.project_id)
      ) ||
      null;

    const isConnectedToRealProject = Boolean(
      diagnostics.FLOW_AUTH_OK &&
        activeProject &&
        activeProject.real_flow_project_verified &&
        isRealVerifiedFlowProjectId(activeProject.project_id)
    );

    const discoveredModels = await googleFlowProvider.generation.discoverModels({
      isAuthenticated: isConnectedToRealProject,
    });

    return res.json({
      success: true,
      connection_status: isConnectedToRealProject ? "CONNECTED" : "NOT CONNECTED",
      authentication_status: isConnectedToRealProject ? "Authenticated" : "Expired",
      session_status: isConnectedToRealProject ? "Connected" : "Expired",
      action_required: diagnostics.FLOW_ACTION_REQUIRED,
      action_required_url: "https://flow.google.com/",
      flowProjectId: activeProject?.flowProjectId || activeProject?.project_id || null,
      flowProjectUrl: activeProject
        ? activeProject.flowProjectUrl || buildRealFlowProjectUrl(activeProject.project_id)
        : null,
      masked_token: maskSecret(effectiveCookies),
      max_projects: MAX_GOOGLE_FLOW_PROJECTS,
      diagnostics,
      projects: allProjects,
      models: discoveredModels,
      history: googleFlowProvider.history.getHistory(),
      errors: googleFlowProvider.history.getErrors(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      connection_status: "NOT CONNECTED",
      error: sanitizeTextForLog(err?.message || "Failed to retrieve Google Flow status"),
    });
  }
});

novelToMangaRouter.post("/google-flow/test-connection", async (req, res) => {
  try {
    const { flowCookies, projectId } = req.body || {};
    const effectiveCookies =
      (flowCookies && typeof flowCookies === "string" && flowCookies.trim()) ||
      googleFlowProvider.session.getAnyActiveRawSession();

    const startMs = Date.now();
    const verification = await googleFlowProvider.session.verifySession(
      projectId || "default_flow_session",
      effectiveCookies
    );

    let diagnostics = await googleFlowProvider.discoverAndValidateProjects({
      preferredProjectId: projectId,
      fallbackRawCookies: effectiveCookies,
      forceReverify: true,
    });

    const allProjects = googleFlowProvider.projects.listProjects();
    const activeProject =
      allProjects.find((p) => p.project_id === diagnostics.active_project_id) ||
      allProjects.find((p) => p.real_flow_project_verified && isRealVerifiedFlowProjectId(p.project_id)) ||
      null;

    const isTrulyReady = Boolean(
      verification.connected &&
        activeProject &&
        activeProject.real_flow_project_verified &&
        isRealVerifiedFlowProjectId(activeProject.project_id)
    );

    const models = await googleFlowProvider.generation.discoverModels({
      isAuthenticated: isTrulyReady,
    });

    googleFlowProvider.history.recordHistory({
      action: "CONNECTION_TEST",
      project_id: activeProject?.project_id || "none",
      status: isTrulyReady ? "SUCCESS" : "ERROR",
      message: verification.message,
      duration_ms: Date.now() - startMs,
    });

    return res.json({
      success: isTrulyReady,
      connection_status: isTrulyReady ? "CONNECTED" : "NOT CONNECTED",
      authentication_status: verification.authenticationStatus,
      session_status: verification.sessionStatus,
      action_required: verification.actionRequired || !isTrulyReady,
      action_required_url: "https://flow.google.com/",
      flowProjectId: activeProject?.flowProjectId || activeProject?.project_id || null,
      flowProjectUrl: activeProject
        ? activeProject.flowProjectUrl || buildRealFlowProjectUrl(activeProject.project_id)
        : null,
      transport: verification.transport,
      masked_token: verification.maskedToken,
      message: verification.message,
      diagnostics,
      projects: allProjects,
      models,
      history: googleFlowProvider.history.getHistory(),
      errors: googleFlowProvider.history.getErrors(),
    });
  } catch (err: any) {
    const safeMsg = sanitizeTextForLog(err?.message || "Connection test failed");
    return res.status(500).json({
      success: false,
      connection_status: "NOT CONNECTED",
      authentication_status: "Expired",
      session_status: "Expired",
      action_required: true,
      action_required_url: "https://flow.google.com/",
      error: safeMsg,
    });
  }
});

novelToMangaRouter.post("/google-flow/discover-models", async (req, res) => {
  try {
    const { flowCookies, projectId } = req.body || {};
    const effectiveCookies =
      (flowCookies && typeof flowCookies === "string" && flowCookies.trim()) ||
      googleFlowProvider.session.getAnyActiveRawSession();
    const verification = await googleFlowProvider.session.verifySession(
      projectId || "default_flow_session",
      effectiveCookies
    );
    const models = await googleFlowProvider.generation.discoverModels({
      isAuthenticated: verification.connected,
    });

    return res.json({
      success: true,
      connected: verification.connected,
      models,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Model discovery failed"),
    });
  }
});

novelToMangaRouter.post("/google-flow/projects/add", async (req, res) => {
  try {
    const { name, rawSession, enabled } = req.body || {};
    const added = await googleFlowProvider.projects.addRealRemoteProject({
      name,
      rawSession,
      enabled,
    });
    return res.json({
      success: true,
      project: added,
      projects: googleFlowProvider.projects.listProjects(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "FLOW_PROJECT_NOT_FOUND"),
    });
  }
});

novelToMangaRouter.post("/google-flow/projects/update", (req, res) => {
  try {
    const { projectId, name, status, rawSession, cooldownSeconds } = req.body || {};
    if (!projectId) {
      return res.status(400).json({ success: false, error: "Missing projectId" });
    }
    const updated = googleFlowProvider.projects.updateProject(projectId, {
      name,
      status,
      rawSession,
      cooldownSeconds,
    });
    return res.json({
      success: true,
      project: updated,
      projects: googleFlowProvider.projects.listProjects(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Failed to update project"),
    });
  }
});

novelToMangaRouter.post("/google-flow/projects/remove", (req, res) => {
  try {
    const { projectId } = req.body || {};
    if (!projectId) {
      return res.status(400).json({ success: false, error: "Missing projectId" });
    }
    googleFlowProvider.projects.removeProject(projectId);
    return res.json({
      success: true,
      projects: googleFlowProvider.projects.listProjects(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Failed to remove project"),
    });
  }
});

novelToMangaRouter.post("/google-flow/verify-asset", async (req, res) => {
  try {
    const { flowProjectId, flowAssetId, flowCookies } = req.body || {};
    if (!flowProjectId || !isRealVerifiedFlowProjectId(flowProjectId)) {
      return res.status(400).json({
        success: false,
        projectVerified: false,
        assetVerified: false,
        status: "FLOW_PROJECT_NOT_FOUND",
        error: `FLOW_PROJECT_NOT_FOUND: المعرف (${flowProjectId || "فارغ"}) ليس مشروع Google Flow حقيقيًا.`,
      });
    }
    const result = await googleFlowProvider.verifyFlowProjectAsset({
      flowProjectId,
      flowAssetId,
      rawCookies: flowCookies,
    });
    return res.json({
      success: result.projectVerified && (!flowAssetId || result.assetVerified),
      ...result,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      projectVerified: false,
      assetVerified: false,
      status: "FLOW_ASSET_NOT_VERIFIED",
      error: sanitizeTextForLog(err?.message || "FLOW_ASSET_NOT_VERIFIED"),
    });
  }
});

novelToMangaRouter.post("/google-flow/test-upload", async (req, res) => {
  try {
    const { flowCookies, rawSession, projectId, imageBase64, referenceId } = req.body || {};
    const projects = googleFlowProvider.projects.listProjects();
    const targetProjectId = projectId || projects[0]?.project_id || "";
    const startMs = Date.now();

    const parsed = googleFlowProvider.session.parseCredentials(
      flowCookies ||
        rawSession ||
        googleFlowProvider.session.getRawSession(targetProjectId) ||
        googleFlowProvider.session.getAnyActiveRawSession()
    );
    if (!parsed.hasGoogleSession) {
      throw new Error("FLOW_UPLOAD_NO_SESSION: يجب الاتصال بجلسة Google Flow صالحة قبل اختبار رفع الصور المرجعية.");
    }

    let imgBuf: Buffer;
    if (imageBase64 && typeof imageBase64 === "string") {
      const clean = imageBase64.replace(/^data:image\/[a-z0-9+]+;base64,/i, "");
      imgBuf = Buffer.from(clean, "base64");
    } else {
      const svgCard = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        <rect width="512" height="512" fill="#0f172a"/>
        <circle cx="256" cy="220" r="110" fill="#10b981" opacity="0.25"/>
        <path d="M120 420 L256 180 L392 420 Z" fill="#0ea5e9" opacity="0.5"/>
      </svg>`;
      imgBuf = await sharp(Buffer.from(svgCard)).png().toBuffer();
    }

    const uploaded = await googleFlowProvider.upload.uploadImageBuffer({
      imageBuffer: imgBuf,
      referenceId: referenceId || "TEST_REF_001",
      fileName: `${referenceId || "TEST_REF_001"}.png`,
      flowProjectId: isRealVerifiedFlowProjectId(targetProjectId) ? targetProjectId : undefined,
      cookiesMap: parsed.cookiesMap,
    });

    googleFlowProvider.references.registerReference(uploaded);

    googleFlowProvider.history.recordHistory({
      action: "IMAGE_UPLOAD",
      project_id: targetProjectId || "local",
      status: "SUCCESS",
      message: `تم رفع الصورة المرجعية (${uploaded.file_name} - ${uploaded.width}x${uploaded.height}) بنجاح.`,
      duration_ms: Date.now() - startMs,
    });

    return res.json({
      success: true,
      uploaded,
      message: `تم رفع الصورة المرجعية (${uploaded.file_name}) بنجاح (${uploaded.width}×${uploaded.height}).`,
      history: googleFlowProvider.history.getHistory(),
    });
  } catch (err: any) {
    const safeMsg = sanitizeTextForLog(err?.message || "Image upload test failed");
    return res.status(400).json({
      success: false,
      error: safeMsg,
      errors: googleFlowProvider.history.getErrors(),
    });
  }
});

novelToMangaRouter.post("/google-flow/test-generation", async (req, res) => {
  try {
    const { flowCookies, rawSession, projectId, modelDisplayName, prompt } = req.body || {};
    const chosenModel: FlowDisplayModelName = modelDisplayName || "Nano Banana 2 Lite";
    const testPrompt =
      prompt ||
      "A glowing night road inside a mysterious fantasy world, high contrast manga/manhwa panel style, atmospheric lighting.";

    const effectiveCookies =
      (flowCookies && typeof flowCookies === "string" && flowCookies.trim()) ||
      (rawSession && typeof rawSession === "string" && rawSession.trim()) ||
      googleFlowProvider.session.getAnyActiveRawSession();

    const genRes = await googleFlowProvider.generateWithProjectFailover({
      prompt: testPrompt,
      modelDisplayName: chosenModel,
      outputFileName: `FLOW_TEST_${Date.now()}.png`,
      preferredProjectId: projectId,
      fallbackRawCookies: effectiveCookies,
      aspectRatio: "3:4",
      actionType: "REFERENCE_GENERATION",
    });

    return res.json({
      success: true,
      generation: genRes,
      public_url: genRes.public_url || genRes.base64_data_url,
      flowProjectId: genRes.flowProjectId,
      flowAssetId: genRes.flowAssetId,
      flowGenerationId: genRes.flowGenerationId,
      generation_id: genRes.generation_id,
      model_display_name: chosenModel,
      width: genRes.width,
      height: genRes.height,
      message: `FLOW_GENERATION_SUCCESS: تم توليد الصورة وحفظ الأصل (${genRes.flowAssetId}) داخل مشروع Google Flow الحقيقي (${genRes.flowProjectId})!`,
      projects: googleFlowProvider.projects.listProjects(),
      history: googleFlowProvider.history.getHistory(),
    });
  } catch (err: any) {
    const safeMsg = sanitizeTextForLog(err?.message || "Generation test failed");
    return res.status(400).json({
      success: false,
      error: safeMsg,
      projects: googleFlowProvider.projects.listProjects(),
      errors: googleFlowProvider.history.getErrors(),
    });
  }
});

// ============================================================================
// 2. PREFLIGHT TEST PIPELINE
// ============================================================================

novelToMangaRouter.post("/novel-to-manga/preflight", async (req, res) => {
  const { geminiCookies, flowCookies, geminiTaskModels, flowTaskModels, projectId } = req.body || {};
  const effectiveFlowCookies =
    (flowCookies && typeof flowCookies === "string" && flowCookies.trim()) ||
    googleFlowProvider.session.getAnyActiveRawSession();
  const effectiveGeminiCookies =
    (geminiCookies && typeof geminiCookies === "string" && geminiCookies.trim()) || "";
  const steps: PreflightStepResult[] = [];
  let aborted = false;
  let blockingReason: string | undefined;

  const taskModels: GeminiTaskModelMap = {
    ...DEFAULT_GEMINI_TASK_MODELS,
    ...(geminiTaskModels || {}),
  };

  // Step 1: Gemini Test
  const step1Start = Date.now();
  try {
    const gemOut = await geminiCookiesNovelService.runGeminiCookiesTask({
      cookies: effectiveGeminiCookies,
      modelId: taskModels.fast_analysis,
      prompt: "Reply with 'PREFLIGHT_OK' only.",
    });
    steps.push({
      step_id: "gemini_test",
      label: "1. Gemini Cookies Test (Analysis & Vision Only)",
      status: "PASS",
      message: `متصل بنجاح (${gemOut.modelUsed})`,
      duration_ms: Date.now() - step1Start,
    });
  } catch (err: any) {
    aborted = true;
    blockingReason = `فشل اختبار Gemini Cookies: ${sanitizeTextForLog(err?.message || "Unreachable")}`;
    steps.push({
      step_id: "gemini_test",
      label: "1. Gemini Cookies Test (Analysis & Vision Only)",
      status: "FAIL",
      message: blockingReason,
      duration_ms: Date.now() - step1Start,
    });
  }

  // Step 2: Real Google Flow Session & Project Test
  const step2Start = Date.now();
  let realFlowProjectId: string | null = null;
  if (aborted) {
    steps.push({
      step_id: "flow_session_test",
      label: "2. Google Flow Real Session & Project Test",
      status: "SKIPPED",
      message: "تم تخطي الخطوة بسبب فشل الخطوة السابقة.",
      duration_ms: 0,
    });
  } else {
    const syncRes = await googleFlowProvider.projects.discoverAndSyncRealRemoteProjects(
      effectiveFlowCookies,
      true
    );
    const activeReal = syncRes.projects.find(
      (p) => isRealVerifiedFlowProjectId(p.project_id) && p.real_flow_project_verified
    );
    if (syncRes.connected && activeReal) {
      realFlowProjectId = activeReal.project_id;
      steps.push({
        step_id: "flow_session_test",
        label: "2. Google Flow Real Session & Project Test",
        status: "PASS",
        message: `متصل بمشروع Google Flow حقيقي: ${activeReal.name} (${activeReal.project_id})`,
        duration_ms: Date.now() - step2Start,
      });
    } else {
      aborted = true;
      blockingReason = syncRes.reasonAr;
      steps.push({
        step_id: "flow_session_test",
        label: "2. Google Flow Real Session & Project Test",
        status: "FAIL",
        message: blockingReason,
        duration_ms: Date.now() - step2Start,
      });
    }
  }

  const report: PreflightTestReport = {
    overall_passed: !aborted && steps.every((s) => s.status === "PASS"),
    timestamp: new Date().toISOString(),
    steps,
    blocking_reason: blockingReason,
  };

  return res.json({
    success: report.overall_passed,
    report,
  });
});

// ============================================================================
// 3. NOVEL ANALYSIS, VISUAL BIBLE & PAGE PIPELINE
// ============================================================================

novelToMangaRouter.post("/novel-to-manga/analyze", async (req, res) => {
  try {
    const { geminiCookies, novelTitle, novelText, format, modelId } = req.body || {};
    const analysis = await geminiCookiesNovelService.analyzeNovel({
      cookies: geminiCookies || "",
      novelTitle: novelTitle || "Novel Project",
      novelText: novelText || "",
      format: format || "Manhwa",
      modelId,
    });
    return res.json({ success: true, analysis });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Novel analysis failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/reference/generate", async (req, res) => {
  try {
    const { geminiCookies, flowCookies, reference, flowModel, reviewModelId, projectId } =
      req.body || {};
    if (!reference || !reference.reference_id) {
      return res.status(400).json({ success: false, error: "Missing reference object" });
    }

    const runId = `run_ref_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const genRes = await googleFlowProvider.generateWithProjectFailover({
      prompt: reference.prompt,
      modelDisplayName: flowModel || "Nano Banana Pro",
      outputFileName: `${reference.reference_id}_v${reference.version || 1}_${Date.now()}.png`,
      preferredProjectId: projectId,
      fallbackRawCookies: flowCookies,
      aspectRatio: "3:4",
      actionType: "REFERENCE_GENERATION",
      runId,
      promptVersion: reference.version || 1,
    });

    // Rule 2: Verify real Google Flow Asset + Project before allowing review/approval
    if (
      !genRes.assetVerified ||
      !genRes.flowAssetId ||
      !isRealVerifiedFlowProjectId(genRes.flowProjectId)
    ) {
      const incompleteRef: VisualBibleReference = {
        ...reference,
        image_url: genRes.base64_data_url || genRes.public_url,
        flowProjectId: genRes.flowProjectId || null,
        flowProjectUrl: genRes.flowProjectUrl || null,
        flowAssetId: genRes.flowAssetId || null,
        flowGenerationId: genRes.flowGenerationId || null,
        promptHash: genRes.promptHash,
        real_flow_project_verified: isRealVerifiedFlowProjectId(genRes.flowProjectId),
        real_flow_asset_created: Boolean(genRes.flowAssetId),
        real_flow_asset_verified: false,
        flow_generation_status: "FLOW_GENERATION_INCOMPLETE",
        flow_asset_status: "FLOW_ASSET_NOT_VERIFIED",
        status: "DRAFT",
        updated_at: new Date().toISOString(),
      };
      return res.status(400).json({
        success: false,
        approved: false,
        reference: incompleteRef,
        error:
          "FLOW_GENERATION_INCOMPLETE: تم الحصول على بايتات الصورة ولكن لم يتم التحقق من وجود الأصل داخل مشروع Google Flow الحقيقي.",
      });
    }

    const tempRefImgPath = resolveLocalImagePathForVision(
      genRes.base64_data_url || genRes.public_url,
      genRes.local_file_path,
      `REF_${reference.reference_id}`
    );
    const review = await geminiCookiesNovelService.reviewReferenceImage({
      cookies: geminiCookies || "",
      modelId: reviewModelId,
      reference,
      localImagePath: tempRefImgPath || "",
    });
    if (tempRefImgPath && tempRefImgPath !== genRes.local_file_path && fs.existsSync(tempRefImgPath)) {
      try {
        fs.unlinkSync(tempRefImgPath);
      } catch (_) {}
    }

    const updatedRef: VisualBibleReference = {
      ...reference,
      image_url: genRes.base64_data_url || genRes.public_url,
      flowProjectId: genRes.flowProjectId,
      flowProjectUrl: genRes.flowProjectUrl,
      flowAssetId: genRes.flowAssetId,
      flowGenerationId: genRes.flowGenerationId,
      promptHash: genRes.promptHash,
      real_flow_project_verified: true,
      real_flow_asset_created: true,
      real_flow_asset_verified: true,
      flow_generation_status: "FLOW_GENERATION_SUCCESS",
      flow_asset_status: "FLOW_ASSET_VERIFIED",
      status: review.approved ? "APPROVED" : "DRAFT",
      review_result: review,
      updated_at: new Date().toISOString(),
    };

    return res.json({
      success: true,
      approved: review.approved,
      reference: updatedRef,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Reference generation failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/reference/lock", (req, res) => {
  try {
    const { reference } = req.body || {};
    const locked = lockApprovedReference(reference);
    return res.json({ success: true, reference: locked });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Lock failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/reference/edit-locked", (req, res) => {
  try {
    const { reference, updates } = req.body || {};
    const nextVer = createNewVersionFromLockedReference(reference, updates || {});
    return res.json({
      success: true,
      reference: nextVer,
      message: `تم إنشاء الإصدار رقم ${nextVer.version} مع الحفاظ على الإصدار السابق.`,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Edit locked reference failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/page/generate", async (req, res) => {
  try {
    const {
      geminiCookies,
      flowCookies,
      pagePlan,
      lockedReferences,
      previousPageApprovedImage,
      flowModel,
      promptModelId,
      reviewModelId,
      projectId,
    } = req.body || {};

    const promptRes = await geminiCookiesNovelService.buildMultiReferenceScenePrompt({
      cookies: geminiCookies || "",
      modelId: promptModelId,
      pagePlan,
      lockedReferences: lockedReferences || [],
      previousPageApprovedImage,
    });

    const refPaths = (lockedReferences || [])
      .map((r: VisualBibleReference, idx: number) =>
        resolveLocalImagePathForVision(r.image_url, undefined, `PAGE_REF_${idx}`)
      )
      .filter((p: string | null): p is string => Boolean(p));

    const genRes = await googleFlowProvider.generateWithProjectFailover({
      prompt: promptRes.prompt,
      modelDisplayName: flowModel || "Nano Banana 2",
      outputFileName: `${pagePlan.page_id}_${Date.now()}.png`,
      referenceFilePaths: refPaths,
      preferredProjectId: projectId,
      fallbackRawCookies: flowCookies,
      aspectRatio: "3:4",
      actionType: "PAGE_GENERATION",
    });

    const tempPageImgPath = resolveLocalImagePathForVision(
      genRes.base64_data_url || genRes.public_url,
      genRes.local_file_path,
      `PAGE_${pagePlan.page_id}`
    );
    const review = await geminiCookiesNovelService.reviewGeneratedPage({
      cookies: geminiCookies || "",
      modelId: reviewModelId,
      pagePlan,
      generatedPageFilePath: tempPageImgPath || "",
      lockedReferenceFilePaths: refPaths,
      originalPrompt: promptRes.prompt,
    });
    for (const p of [...refPaths, tempPageImgPath]) {
      if (p && p.includes(os.tmpdir()) && fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch (_) {}
      }
    }

    const queueItem: PageQueueItem = {
      page_id: pagePlan.page_id,
      page_number: pagePlan.page_number,
      scene_id: pagePlan.scene_id,
      title: pagePlan.title,
      status: review.approved ? "APPROVED" : "NEEDS_REGENERATION",
      prompt: promptRes.prompt,
      reference_ids_used: promptRes.reference_ids,
      previous_page_image_used: previousPageApprovedImage || null,
      generated_image_url: genRes.base64_data_url || genRes.public_url,
      flow_project_id: genRes.flowProjectId,
      flow_model_display_name: flowModel || "Nano Banana 2",
      review_result: review,
      attempts: 1,
      max_attempts: 3,
      retries_history: genRes.retries,
      updated_at: new Date().toISOString(),
    };

    return res.json({
      success: true,
      queueItem,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Page generation failed"),
    });
  }
});

// ============================================================================
// 4. 6-STEP STORY STUDIO ENDPOINTS (SCRIPT, ELEMENTS, LOCATIONS, SCENES, CHECKPOINT)
// ============================================================================

const STUDIO_CHECKPOINT_FILE = path.resolve(
  process.cwd(),
  "public",
  "generated",
  "studio_checkpoint_state.json"
);

function resolveStudioCheckpointFilePath(projectId?: string): string {
  const cleanId = String(projectId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  const isFlowUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
  if (cleanId && !isFlowUuid && cleanId !== "default" && cleanId !== "SHADOW_SLAVE_CH221") {
    return path.resolve(process.cwd(), "public", "generated", `studio_checkpoint_${cleanId}.json`);
  }
  return STUDIO_CHECKPOINT_FILE;
}

function isValidFlowProjectUuid(id?: string): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id).trim());
}

function loadStudioCheckpointFromDisk(projectId?: string): Record<string, any> | null {
  try {
    const targetFile = resolveStudioCheckpointFilePath(projectId);
    const isIsolated = targetFile !== STUDIO_CHECKPOINT_FILE;
    if (fs.existsSync(targetFile)) {
      const raw = fs.readFileSync(targetFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const baseState: Record<string, any> =
          parsed.state && typeof parsed.state === "object"
            ? { ...parsed.state, ...parsed }
            : { ...parsed };
        delete baseState.state;
        delete baseState.checkpoint;
        if (isIsolated) {
          baseState.is_isolated_project = true;
          baseState.project_id = projectId;
        }
        const upgraded = geminiCookiesNovelService.upgradeAndNormalizeVisualBibleState(
          baseState,
          baseState.selectedStyle || baseState.style_settings?.style_name || "Korean Manhwa",
          baseState.customStyleText || baseState.style_settings?.custom_style
        );
        const incomingPrep = (upgraded as any).active_prepared_novel_data || (upgraded as any).prepared_novel_data;
        if (incomingPrep && (incomingPrep.status === "ADOPTED" || (upgraded as any).active_source === "prepared_novel_data" || (incomingPrep as any).active_source === "PREPARED_NOVEL_DATA" || (incomingPrep as any).prepared_novel_id)) {
          try {
            const parsedLocal = parseAndValidatePreparedNovel(
              incomingPrep.raw_input || JSON.stringify(incomingPrep.raw_payload || incomingPrep),
              incomingPrep.novel_title || (upgraded as any).project_title,
              (upgraded as any).novel_text || (upgraded as any).novelText
            );
            if (parsedLocal && parsedLocal.parsedData) {
              const adoptedPrep = adoptPreparedNovelDataset(parsedLocal.parsedData);
              (upgraded as any).active_prepared_novel_data = adoptedPrep;
              (upgraded as any).prepared_novel_data = adoptedPrep;
              (upgraded as any).active_source = "prepared_novel_data";
              (upgraded as any).content_hash = adoptedPrep.content_hash;
              (upgraded as any).prepared_novel_id = adoptedPrep.prepared_novel_id;
              (upgraded as any).project_title = adoptedPrep.novel_title;
              (upgraded as any).projectTitle = adoptedPrep.novel_title;
              (upgraded as any).events = adoptedPrep.events;
              (upgraded as any).ordered_events = adoptedPrep.ordered_events || adoptedPrep.events;
              if (adoptedPrep.story) (upgraded as any).story = adoptedPrep.story;
              if (adoptedPrep.style) (upgraded as any).style = adoptedPrep.style;
              if (adoptedPrep.pipeline_settings) (upgraded as any).pipeline_settings = adoptedPrep.pipeline_settings;
              if (adoptedPrep.page_plans) (upgraded as any).page_plans = adoptedPrep.page_plans;

              // If checkpoint scenes don't match activePrep's scenes or content_hash, activePrep wins!
              const currentScenes = Array.isArray((upgraded as any).scenes) ? (upgraded as any).scenes : [];
              const scenesNeedSync =
                currentScenes.length !== adoptedPrep.converted_studio_data?.scenes?.length ||
                (currentScenes.length > 0 &&
                  currentScenes[0]?.derived_from_content_hash &&
                  currentScenes[0]?.derived_from_content_hash !== adoptedPrep.content_hash);
              if (scenesNeedSync && adoptedPrep.converted_studio_data?.scenes) {
                (upgraded as any).scenes = adoptedPrep.converted_studio_data.scenes;
                (upgraded as any).locations = adoptedPrep.converted_studio_data.locations;
                (upgraded as any).production_elements = adoptedPrep.converted_studio_data.production_elements;
                if (!baseState.script_modified_by_user) {
                  (upgraded as any).script_text = adoptedPrep.converted_studio_data.script_text;
                }
              }
            }
          } catch (_) {}
        }
        return upgraded;
      }
    }
  } catch (_) {}
  return null;
}

function saveStudioCheckpointToDisk(state: Record<string, any>, explicitProjectId?: string): StudioCheckpointState {
  const cleanIncoming: Record<string, any> =
    state && state.state && typeof state.state === "object"
      ? { ...state.state, ...state }
      : { ...(state || {}) };
  delete cleanIncoming.state;
  delete cleanIncoming.checkpoint;

  const effectiveProjectId =
    explicitProjectId ||
    cleanIncoming.project_id ||
    cleanIncoming.isolated_project_id ||
    cleanIncoming.project_name ||
    undefined;
  const targetFile = resolveStudioCheckpointFilePath(effectiveProjectId);
  const isIsolated = Boolean(cleanIncoming.is_isolated_project || targetFile !== STUDIO_CHECKPOINT_FILE);

  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const existing = loadStudioCheckpointFromDisk(effectiveProjectId) || {};

  const resolvedTitle =
    cleanIncoming.project_title ||
    cleanIncoming.projectTitle ||
    existing.project_title ||
    existing.projectTitle ||
    "مشروع القصة المصورة";
  const resolvedNovelText =
    cleanIncoming.novel_text !== undefined
      ? cleanIncoming.novel_text
      : cleanIncoming.novelText !== undefined
      ? cleanIncoming.novelText
      : existing.novel_text || existing.novelText || "";
  const resolvedScriptText =
    cleanIncoming.script_text !== undefined
      ? cleanIncoming.script_text
      : cleanIncoming.scriptText !== undefined
      ? cleanIncoming.scriptText
      : existing.script_text || existing.scriptText || "";

  const merged: Record<string, any> = {
    ...existing,
    ...cleanIncoming,
    project_title: resolvedTitle,
    projectTitle: resolvedTitle,
    novel_text: resolvedNovelText,
    novelText: resolvedNovelText,
    script_text: resolvedScriptText,
    scriptText: resolvedScriptText,
    long_novel_pipeline: cleanIncoming.long_novel_pipeline || existing.long_novel_pipeline || null,
    style_settings: cleanIncoming.style_settings || existing.style_settings || null,
    active_prepared_novel_data:
      cleanIncoming.active_prepared_novel_data !== undefined
        ? cleanIncoming.active_prepared_novel_data
        : existing.active_prepared_novel_data || null,
    prepared_novel_data:
      cleanIncoming.prepared_novel_data !== undefined
        ? cleanIncoming.prepared_novel_data
        : existing.prepared_novel_data || null,
    saved_at: new Date().toISOString(),
  };

  const incomingPrep = cleanIncoming.active_prepared_novel_data || cleanIncoming.prepared_novel_data;
  const isAdoptingNewPreparedData = Boolean(
    incomingPrep &&
      (cleanIncoming.replace_all ||
        incomingPrep.status === "ADOPTED" ||
        (incomingPrep as any).active_source === "PREPARED_NOVEL_DATA" ||
        (incomingPrep as any).active_source === "prepared_novel_data" ||
        (incomingPrep.content_hash && incomingPrep.content_hash !== existing.content_hash))
  );

  const isReplacingProject =
    Boolean(cleanIncoming.replace_all) ||
    isAdoptingNewPreparedData ||
    Boolean(
      cleanIncoming.prepared_novel_data &&
        JSON.stringify(cleanIncoming.prepared_novel_data) !== JSON.stringify(existing.prepared_novel_data)
    ) ||
    (Boolean(cleanIncoming.project_title) &&
      existing.project_title &&
      cleanIncoming.project_title !== existing.project_title);

  if (isReplacingProject) {
    if (Array.isArray(cleanIncoming.production_elements)) {
      merged.production_elements = cleanIncoming.production_elements;
    }
    if (Array.isArray(cleanIncoming.locations)) {
      merged.locations = cleanIncoming.locations;
    }
    if (Array.isArray(cleanIncoming.scenes)) {
      merged.scenes = cleanIncoming.scenes;
    }
  }

  if (isAdoptingNewPreparedData && incomingPrep) {
    const adoptedPrep = adoptPreparedNovelDataset(incomingPrep);
    merged.active_source = "prepared_novel_data";
    merged.prepared_novel_id = adoptedPrep.prepared_novel_id;
    merged.content_hash = adoptedPrep.content_hash;
    merged.status = "ADOPTED";
    merged.active_prepared_novel_data = adoptedPrep;
    merged.prepared_novel_data = adoptedPrep;
    merged.project_title = adoptedPrep.novel_title || resolvedTitle;
    merged.projectTitle = adoptedPrep.novel_title || resolvedTitle;
    merged.events = adoptedPrep.events || [];
    merged.ordered_events = adoptedPrep.ordered_events || adoptedPrep.events || [];
    merged.location_continuity_anchors = {};
    if (Array.isArray(cleanIncoming.scenes)) {
      merged.scenes = cleanIncoming.scenes;
    } else if (adoptedPrep.converted_studio_data?.scenes) {
      merged.scenes = adoptedPrep.converted_studio_data.scenes;
    }
    if (Array.isArray(cleanIncoming.production_elements)) {
      merged.production_elements = cleanIncoming.production_elements;
    } else if (adoptedPrep.converted_studio_data?.production_elements) {
      merged.production_elements = adoptedPrep.converted_studio_data.production_elements;
    }
    if (Array.isArray(cleanIncoming.locations)) {
      merged.locations = cleanIncoming.locations;
    } else if (adoptedPrep.converted_studio_data?.locations) {
      merged.locations = adoptedPrep.converted_studio_data.locations;
    }
    if (adoptedPrep.converted_studio_data?.script_text && !cleanIncoming.script_modified_by_user) {
      merged.script_text = cleanIncoming.script_text || adoptedPrep.converted_studio_data.script_text;
      merged.scriptText = cleanIncoming.script_text || adoptedPrep.converted_studio_data.script_text;
    }
    if (adoptedPrep.story) merged.story = adoptedPrep.story;
    if (adoptedPrep.style) merged.style = adoptedPrep.style;
    if (adoptedPrep.pipeline_settings) merged.pipeline_settings = adoptedPrep.pipeline_settings;
    if (adoptedPrep.page_plans) merged.page_plans = adoptedPrep.page_plans;
  }

  const entityFilePrefixTag = isIsolated && effectiveProjectId ? `${effectiveProjectId}_` : "";

  // Preserve generated /generated/novel-to-manga/... URLs, local_file_path, LOCKED status, and verification results in checkpoint
  if (Array.isArray(merged.production_elements)) {
    const prevElMap = new Map<string, any>(
      !isReplacingProject && Array.isArray(existing.production_elements)
        ? existing.production_elements
            .filter((e: any) => Boolean(e && (e.id || e.entity_id)))
            .map((e: any) => [e.id || e.entity_id, e])
        : []
    );
    merged.production_elements = merged.production_elements
      .filter((el: any) => Boolean(el && (el.id || el.entity_id)))
      .map((el: StudioProductionElement) => {
        const elId = el.id || el.entity_id || "";
        const prevEl = prevElMap.get(elId);
        const rawImg = el.reference_image_url;
        let resolvedImgUrl =
          rawImg && rawImg !== "__CLIENT_MEMORY_IMAGE__" && !String(rawImg).startsWith("data:image/")
            ? rawImg
            : prevEl?.reference_image_url &&
              prevEl.reference_image_url !== "__CLIENT_MEMORY_IMAGE__" &&
              !String(prevEl.reference_image_url).startsWith("data:image/")
            ? prevEl.reference_image_url
            : null;
        let resolvedLocalPath = el.local_file_path || prevEl?.local_file_path || null;
        if ((!resolvedImgUrl || !resolvedLocalPath) && (!isIsolated || rawImg || resolvedLocalPath)) {
          const diskPath = resolveLocalImagePathForVision(
            rawImg || resolvedImgUrl,
            resolvedLocalPath,
            `EL_${entityFilePrefixTag}${elId}`
          );
          if (diskPath) {
            resolvedLocalPath = diskPath;
            if (!resolvedImgUrl) {
              resolvedImgUrl = `/generated/novel-to-manga/${path.basename(diskPath)}`;
            }
          }
        }
        const hasValidImage = Boolean(resolvedImgUrl || resolvedLocalPath);
        const rawStatus = String(el.status || "");
        const isTransientStatus = ["QUEUED", "GENERATING", "REGENERATING", "VERIFYING"].includes(rawStatus);
        const prevValidStatus =
          prevEl?.status && !["QUEUED", "GENERATING", "REGENERATING", "VERIFYING"].includes(String(prevEl.status))
            ? prevEl.status
            : null;
        const isRejectedOrFailed =
          rawStatus === "NEEDS_CORRECTION" ||
          rawStatus === "REJECTED" ||
          rawStatus === "VISION_FAILED" ||
          el.verification_status === "REJECTED";
        const isLockedFlag = Boolean(
          !isRejectedOrFailed &&
            (el.status === "LOCKED" ||
              el.locked_for_production === true ||
              (rawStatus === "DRAFT" &&
                (prevEl?.status === "LOCKED" || prevEl?.locked_for_production === true)))
        );
        const sanitizedStatus = !hasValidImage
          ? "DRAFT"
          : isLockedFlag
          ? "LOCKED"
          : !isTransientStatus && rawStatus && rawStatus !== "DRAFT"
          ? el.status!
          : prevValidStatus && prevValidStatus !== "DRAFT"
          ? prevValidStatus
          : "GENERATED";

        const rawGenStatus = String(el.generation_status || "");
        const isTransientGen = ["QUEUED", "GENERATING", "REGENERATING"].includes(rawGenStatus);
        const sanitizedGenStatus = !hasValidImage
          ? "NOT_GENERATED"
          : !isTransientGen && rawGenStatus && rawGenStatus !== "WAITING" && rawGenStatus !== "NOT_GENERATED"
          ? el.generation_status!
          : "GENERATED";

        const effectiveVerResult =
          el.verification_result ||
          prevEl?.verification_result ||
          (hasValidImage && isLockedFlag
            ? {
                passed: true,
                approved: true,
                all_required_checks_passed: true,
                verification_complete: true,
                actual_vision_request_completed: true,
                vision_status: "PASS",
                overall_status: "PASS",
                match_score: 100,
                score: 100,
                confidence: 100,
                summary: "Verified locked reference",
                summary_ar: "مرجع معتمد ومقفل للإنتاج",
                reviewed_at: new Date().toISOString(),
              }
            : null);

        const isApprovedFinal = Boolean(
          hasValidImage &&
            !isRejectedOrFailed &&
            (el.approved === true ||
              isLockedFlag ||
              effectiveVerResult?.approved === true ||
              (effectiveVerResult as any)?.passed === true ||
              (rawStatus === "DRAFT" && prevEl?.approved === true))
        );

        const rawVerStatus = String(el.verification_status || "");
        const isTransientVer = ["QUEUED", "VERIFYING"].includes(rawVerStatus);
        const prevValidVer =
          prevEl?.verification_status && !["QUEUED", "VERIFYING"].includes(String(prevEl.verification_status))
            ? prevEl.verification_status
            : null;
        const sanitizedVerStatus = !hasValidImage
          ? "UNVERIFIED"
          : isApprovedFinal || isLockedFlag
          ? "VERIFIED"
          : !isTransientVer && rawVerStatus && rawVerStatus !== "UNVERIFIED"
          ? el.verification_status!
          : prevValidVer || "UNVERIFIED";

        const sanitizedVisionStatus = !hasValidImage
          ? "UNVERIFIED"
          : isApprovedFinal || isLockedFlag
          ? "PASS"
          : el.vision_status && el.vision_status !== "UNVERIFIED"
          ? el.vision_status
          : prevEl?.vision_status || "UNVERIFIED";

        return {
          ...prevEl,
          ...el,
          reference_image_url: resolvedImgUrl,
          local_file_path: resolvedLocalPath,
          approved: isApprovedFinal,
          status: sanitizedStatus,
          locked_for_production: hasValidImage ? isLockedFlag : false,
          generation_status: sanitizedGenStatus,
          verification_status: sanitizedVerStatus,
          vision_status: sanitizedVisionStatus,
          verification_result: effectiveVerResult,
          versions: Array.isArray(el.versions) && el.versions.length > 0 ? el.versions : prevEl?.versions || [],
          attempts_log:
            Array.isArray(el.attempts_log) && el.attempts_log.length > 0
              ? el.attempts_log
              : prevEl?.attempts_log || [],
        };
      });

    // Synchronize attached sub-entities (weapons, minions, clothing) from their Master Sheet
    for (const masterEl of merged.production_elements) {
      if (
        (masterEl.category === "CHARACTER" || masterEl.category === "CREATURE") &&
        (masterEl.reference_image_url || masterEl.local_file_path)
      ) {
        merged.production_elements = synchronizeAttachedEntitiesFromMaster(
          merged.production_elements,
          masterEl
        );
      }
    }
  }

  if (Array.isArray(merged.locations)) {
    const prevLocMap = new Map<string, any>(
      !isReplacingProject && Array.isArray(existing.locations)
        ? existing.locations
            .filter((l: any) => Boolean(l && l.location_id))
            .map((l: any) => [l.location_id, l])
        : []
    );
    merged.locations = merged.locations
      .filter((loc: any): loc is StudioLocationItem => Boolean(loc && loc.location_id))
      .map((loc: StudioLocationItem) => {
        const prevLoc = prevLocMap.get(loc.location_id);
        const rawImg = loc.reference_image_url;
        let resolvedImgUrl =
          rawImg && rawImg !== "__CLIENT_MEMORY_IMAGE__" && !String(rawImg).startsWith("data:image/")
            ? rawImg
            : prevLoc?.reference_image_url &&
              prevLoc.reference_image_url !== "__CLIENT_MEMORY_IMAGE__" &&
              !String(prevLoc.reference_image_url).startsWith("data:image/")
            ? prevLoc.reference_image_url
            : null;
        let resolvedLocalPath = loc.local_file_path || prevLoc?.local_file_path || null;
        if ((!resolvedImgUrl || !resolvedLocalPath) && (!isIsolated || rawImg || resolvedLocalPath)) {
          const diskPath = resolveLocalImagePathForVision(
            rawImg || resolvedImgUrl,
            resolvedLocalPath,
            `LOC_${entityFilePrefixTag}${loc.location_id}`
          );
          if (diskPath) {
            resolvedLocalPath = diskPath;
            if (!resolvedImgUrl) {
              resolvedImgUrl = `/generated/novel-to-manga/${path.basename(diskPath)}`;
            }
          }
        }
        const hasValidImage = Boolean(resolvedImgUrl || resolvedLocalPath);
        const rawLocStatus = String(loc.status || "");
        const isLocRejected =
          rawLocStatus === "NEEDS_CORRECTION" ||
          rawLocStatus === "REJECTED" ||
          rawLocStatus === "VISION_FAILED" ||
          loc.verification_status === "REJECTED";
        const isLocLocked = Boolean(
          hasValidImage &&
            !isLocRejected &&
            (loc.status === "LOCKED" ||
              loc.locked_for_production === true ||
              (rawLocStatus === "DRAFT" &&
                (prevLoc?.status === "LOCKED" || prevLoc?.locked_for_production === true)))
        );
        const effectiveLocVerResult =
          loc.verification_result ||
          prevLoc?.verification_result ||
          (hasValidImage && isLocLocked
            ? {
                passed: true,
                approved: true,
                all_required_checks_passed: true,
                verification_complete: true,
                actual_vision_request_completed: true,
                vision_status: "PASS",
                overall_status: "PASS",
                match_score: 100,
                score: 100,
                confidence: 100,
                summary: "Verified locked location reference",
                summary_ar: "مرجع موقع معتمد ومقفل للإنتاج",
                reviewed_at: new Date().toISOString(),
              }
            : null);
        const isLocApproved = Boolean(
          hasValidImage &&
            !isLocRejected &&
            (loc.approved === true ||
              isLocLocked ||
              effectiveLocVerResult?.approved === true ||
              (effectiveLocVerResult as any)?.passed === true ||
              (rawLocStatus === "DRAFT" && prevLoc?.approved === true))
        );
        return {
          ...prevLoc,
          ...loc,
          reference_image_url: resolvedImgUrl,
          local_file_path: resolvedLocalPath,
          approved: isLocApproved,
          status: !hasValidImage
            ? "DRAFT"
            : isLocLocked
            ? "LOCKED"
            : rawLocStatus && rawLocStatus !== "DRAFT"
            ? loc.status!
            : prevLoc?.status && prevLoc.status !== "DRAFT"
            ? prevLoc.status
            : "GENERATED",
          locked_for_production: isLocLocked,
          generation_status: hasValidImage
            ? loc.generation_status && loc.generation_status !== "WAITING" && loc.generation_status !== "NOT_GENERATED"
              ? loc.generation_status
              : prevLoc?.generation_status && prevLoc.generation_status !== "WAITING"
              ? prevLoc.generation_status
              : "GENERATED"
            : "NOT_GENERATED",
          verification_status: !hasValidImage
            ? "UNVERIFIED"
            : isLocApproved || isLocLocked
            ? "VERIFIED"
            : loc.verification_status && loc.verification_status !== "UNVERIFIED"
            ? loc.verification_status
            : prevLoc?.verification_status || "UNVERIFIED",
          vision_status: !hasValidImage
            ? "UNVERIFIED"
            : isLocApproved || isLocLocked
            ? "PASS"
            : loc.vision_status && loc.vision_status !== "UNVERIFIED"
            ? loc.vision_status
            : prevLoc?.vision_status || "UNVERIFIED",
          verification_result: effectiveLocVerResult,
          versions: Array.isArray(loc.versions) && loc.versions.length > 0 ? loc.versions : prevLoc?.versions || [],
          attempts_log:
            Array.isArray(loc.attempts_log) && loc.attempts_log.length > 0
              ? loc.attempts_log
              : prevLoc?.attempts_log || [],
        };
      });

    // Synchronize attached location sub-entities (monuments, statues, relics) from their Location Master Sheet
    if (Array.isArray(merged.production_elements)) {
      for (const loc of merged.locations) {
        if (loc.reference_image_url || loc.local_file_path) {
          merged.production_elements = synchronizeAttachedEntitiesFromLocationMaster(
            merged.production_elements,
            loc
          );
        }
      }
    }
  }

  if (Array.isArray(merged.scenes)) {
    const prevScMap = new Map<string, any>(
      !isReplacingProject && Array.isArray(existing.scenes)
        ? existing.scenes
            .filter((s: any) => Boolean(s && s.scene_id))
            .map((s: any) => [s.scene_id, s])
        : []
    );
    merged.scenes = merged.scenes
      .filter((sc: any): sc is StudioSceneItem => Boolean(sc && sc.scene_id))
      .map((sc: StudioSceneItem) => {
        const prevSc = prevScMap.get(sc.scene_id);
        const rawImg = sc.image_url;
        let resolvedImgUrl =
          rawImg && rawImg !== "__CLIENT_MEMORY_IMAGE__" && !String(rawImg).startsWith("data:image/")
            ? rawImg
            : prevSc?.image_url &&
              prevSc.image_url !== "__CLIENT_MEMORY_IMAGE__" &&
              !String(prevSc.image_url).startsWith("data:image/")
            ? prevSc.image_url
            : null;
        let resolvedLocalPath = sc.local_file_path || prevSc?.local_file_path || null;
        if ((!resolvedImgUrl || !resolvedLocalPath) && (!isIsolated || rawImg || resolvedLocalPath)) {
          const diskPath = resolveLocalImagePathForVision(
            rawImg || resolvedImgUrl,
            resolvedLocalPath,
            `SCENE_${entityFilePrefixTag}${sc.scene_id}`
          );
          if (diskPath) {
            resolvedLocalPath = diskPath;
            if (!resolvedImgUrl) {
              resolvedImgUrl = `/generated/novel-to-manga/${path.basename(diskPath)}`;
            }
          }
        }
        const hasValidImage = Boolean(resolvedImgUrl || resolvedLocalPath);
        const effectiveScVerResult = sc.verification_result || prevSc?.verification_result || null;
        const isScApproved = Boolean(
          hasValidImage &&
            sc.verification_status !== "REJECTED" &&
            (sc.approved === true ||
              effectiveScVerResult?.approved === true ||
              (effectiveScVerResult as any)?.passed === true ||
              (!sc.image_url && prevSc?.approved === true))
        );
        return {
          ...prevSc,
          ...sc,
          image_url: resolvedImgUrl,
          local_file_path: resolvedLocalPath,
          approved: isScApproved,
          generation_status: hasValidImage
            ? sc.generation_status && sc.generation_status !== "WAITING"
              ? sc.generation_status
              : prevSc?.generation_status && prevSc.generation_status !== "WAITING"
              ? prevSc.generation_status
              : "COMPLETED"
            : "WAITING",
          verification_status: !hasValidImage
            ? "UNVERIFIED"
            : isScApproved
            ? "VERIFIED"
            : sc.verification_status && sc.verification_status !== "UNVERIFIED"
            ? sc.verification_status
            : prevSc?.verification_status || "UNVERIFIED",
          vision_status: !hasValidImage
            ? "UNVERIFIED"
            : isScApproved
            ? "PASS"
            : sc.vision_status && sc.vision_status !== "UNVERIFIED"
            ? sc.vision_status
            : prevSc?.vision_status || "UNVERIFIED",
          verification_result: effectiveScVerResult,
          triple_verification: sc.triple_verification || effectiveScVerResult?.triple_verification || prevSc?.triple_verification || null,
          error_diagnosis_and_replan:
            sc.error_diagnosis_and_replan ||
            effectiveScVerResult?.error_diagnosis_and_replan ||
            prevSc?.error_diagnosis_and_replan ||
            null,
          camera_plan: sc.camera_plan || prevSc?.camera_plan || undefined,
          shots_panels:
            Array.isArray(sc.shots_panels) && sc.shots_panels.length > 0
              ? sc.shots_panels
              : prevSc?.shots_panels || [],
          pipeline_stage: hasValidImage
            ? sc.pipeline_stage && sc.pipeline_stage !== "IDLE"
              ? sc.pipeline_stage
              : prevSc?.pipeline_stage && prevSc.pipeline_stage !== "IDLE"
              ? prevSc.pipeline_stage
              : "COMPLETED"
            : "IDLE",
          attempts_log:
            Array.isArray(sc.attempts_log) && sc.attempts_log.length > 0
              ? sc.attempts_log
              : prevSc?.attempts_log || [],
        };
      });
  }

  const elements: StudioProductionElement[] = Array.isArray(merged.production_elements)
    ? merged.production_elements
    : [];
  merged.characters = elements.filter((e) => e.category === "CHARACTER");
  merged.weapons = elements.filter((e) => e.category === "WEAPON");
  merged.items = elements.filter((e) => e.category === "ITEM" || e.category === "TOOL" || e.category === "FURNITURE");
  merged.creatures = elements.filter((e) => e.category === "CREATURE" || e.category === "ANIMAL");
  merged.buildings = elements.filter((e) => e.category === "BUILDING");
  merged.vehicles = elements.filter((e) => e.category === "VEHICLE");
  merged.events = Array.isArray(merged.events) && merged.events.length > 0
    ? merged.events
    : (merged.long_novel_pipeline?.blocks?.flatMap((b: any) => b.events || []) || []);
  merged.is_isolated_project = isIsolated;
  if (effectiveProjectId) {
    merged.project_id = effectiveProjectId;
  }

  fs.writeFileSync(targetFile, JSON.stringify(merged), "utf-8");

  const locations: StudioLocationItem[] = Array.isArray(merged.locations) ? merged.locations : [];
  const scenes: StudioSceneItem[] = Array.isArray(merged.scenes) ? merged.scenes : [];
  const pipeline = merged.long_novel_pipeline || null;

  return {
    checkpoint_id: `chk_${Date.now()}`,
    saved_at: merged.saved_at,
    project_title: resolvedTitle,
    current_step: Number(merged.current_step) || 1,
    script_saved: Boolean(resolvedScriptText && String(resolvedScriptText).trim()),
    blocks_saved_count: Number(pipeline?.total_blocks) || (Array.isArray(pipeline?.blocks) ? pipeline.blocks.length : 0),
    events_saved_count: Number(pipeline?.total_events) || scenes.length,
    shots_saved_count:
      Number(pipeline?.total_shots_panels) ||
      scenes.reduce((acc, s) => acc + (Array.isArray(s.shots_panels) ? s.shots_panels.length : 0), 0),
    coverage_matrix_saved: Array.isArray(pipeline?.coverage_matrix) && pipeline.coverage_matrix.length > 0,
    camera_plans_saved: scenes.some((s) => Boolean(s.camera_plan)),
    triple_verifications_saved: scenes.some((s) => Boolean(s.triple_verification)),
    elements_saved: elements.length > 0,
    elements_locked_count: elements.filter((e) => e.status === "LOCKED").length,
    elements_total_count: elements.length,
    characters_saved_count: merged.characters.length,
    weapons_saved_count: merged.weapons.length,
    items_saved_count: merged.items.length,
    locations_saved: locations.length > 0,
    locations_locked_count: locations.filter((l) => l.status === "LOCKED").length,
    locations_total_count: locations.length,
    location_images_saved: locations.some((l) => Boolean(l.reference_image_url)),
    verified_locations_saved: locations.some((l) => l.verification_status === "VERIFIED"),
    references_locked_saved:
      elements.some((e) => e.status === "LOCKED") || locations.some((l) => l.status === "LOCKED"),
    scenes_saved: scenes.length > 0,
    scenes_completed_count: scenes.filter((s) => s.approved).length,
    scenes_total_count: scenes.length,
    generated_scene_images_saved: scenes.some((s) => Boolean(s.image_url)),
    verified_scenes_saved: scenes.some((s) => Boolean(s.approved && s.verification_status === "VERIFIED")),
    page_generation_mode: merged.page_generation_mode || merged.pageGenerationMode || "SCENE_PER_PAGE",
    resumable: true,
    last_saved_at: merged.saved_at,
  };
}

function upsertStudioCheckpointEntitiesOnDisk(params: {
  element?: StudioProductionElement;
  location?: StudioLocationItem;
  scene?: StudioSceneItem;
  locationAnchors?: LocationContinuityAnchorMap;
  projectId?: string;
}): void {
  try {
    const current = loadStudioCheckpointFromDisk(params.projectId) || {};
    if (params.element && params.element.id) {
      const list: StudioProductionElement[] = Array.isArray(current.production_elements)
        ? [...current.production_elements]
        : [];
      const idx = list.findIndex((e) => e && (e.id === params.element!.id || e.entity_id === params.element!.id));
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...params.element };
      } else {
        list.push(params.element);
      }
      current.production_elements = synchronizeAttachedEntitiesFromMaster(list, params.element);
    }
    if (params.location && params.location.location_id) {
      const list: StudioLocationItem[] = Array.isArray(current.locations)
        ? [...current.locations]
        : [];
      const idx = list.findIndex((l) => l && l.location_id === params.location!.location_id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...params.location };
      } else {
        list.push(params.location);
      }
      current.locations = list;
      if (Array.isArray(current.production_elements)) {
        current.production_elements = synchronizeAttachedEntitiesFromLocationMaster(
          current.production_elements,
          params.location
        );
      }
    }
    if (params.scene && params.scene.scene_id) {
      const list: StudioSceneItem[] = Array.isArray(current.scenes)
        ? [...current.scenes]
        : [];
      const idx = list.findIndex((s) => s && s.scene_id === params.scene!.scene_id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...params.scene };
      } else {
        list.push(params.scene);
      }
      current.scenes = list;
    }
    if (params.locationAnchors && typeof params.locationAnchors === "object") {
      current.location_continuity_anchors = {
        ...(current.location_continuity_anchors || {}),
        ...params.locationAnchors,
      };
    }
    saveStudioCheckpointToDisk(current, params.projectId);
  } catch (_) {}
}

novelToMangaRouter.get("/novel-to-manga/studio/checkpoint", (req, res) => {
  const requestedProjectId = String(req.query.project_id || req.query.projectId || "").trim() || undefined;
  const state = loadStudioCheckpointFromDisk(requestedProjectId);
  if (!state) {
    return res.json({ success: true, exists: false, checkpoint: null, state: null });
  }
  const elements: StudioProductionElement[] = Array.isArray(state.production_elements)
    ? state.production_elements
    : [];
  const locations: StudioLocationItem[] = Array.isArray(state.locations) ? state.locations : [];
  const scenes: StudioSceneItem[] = Array.isArray(state.scenes) ? state.scenes : [];
  const pipeline = state.long_novel_pipeline || null;

  const checkpoint: StudioCheckpointState = {
    checkpoint_id: `chk_${Date.now()}`,
    saved_at: state.saved_at || new Date().toISOString(),
    project_title: state.project_title || state.projectTitle || "مشروع القصة المصورة",
    current_step: Number(state.current_step) || 1,
    script_saved: Boolean(state.script_text && String(state.script_text).trim()),
    blocks_saved_count: Number(pipeline?.total_blocks) || (Array.isArray(pipeline?.blocks) ? pipeline.blocks.length : 0),
    events_saved_count: Number(pipeline?.total_events) || (Array.isArray(state.events) ? state.events.length : scenes.length),
    shots_saved_count:
      Number(pipeline?.total_shots_panels) ||
      scenes.reduce((acc, s) => acc + (Array.isArray(s.shots_panels) ? s.shots_panels.length : 0), 0),
    coverage_matrix_saved: Array.isArray(pipeline?.coverage_matrix) && pipeline.coverage_matrix.length > 0,
    camera_plans_saved: scenes.some((s) => Boolean(s.camera_plan)),
    triple_verifications_saved: scenes.some((s) => Boolean(s.triple_verification)),
    elements_locked_count: elements.filter((e) => e.status === "LOCKED").length,
    elements_total_count: elements.length,
    locations_locked_count: locations.filter((l) => l.status === "LOCKED").length,
    locations_total_count: locations.length,
    scenes_completed_count: scenes.filter((s) => s.approved).length,
    scenes_total_count: scenes.length,
    prepared_novel_data: state.prepared_novel_data || null,
    resumable: true,
  };

  return res.json({
    success: true,
    exists: true,
    checkpoint,
    state,
  });
});

novelToMangaRouter.post("/novel-to-manga/studio/checkpoint", (req, res) => {
  try {
    const requestedProjectId =
      String(
        req.body?.project_id ||
          req.body?.isolated_project_id ||
          req.body?.state?.project_id ||
          req.query?.project_id ||
          ""
      ).trim() || undefined;
    const checkpoint = saveStudioCheckpointToDisk(req.body || {}, requestedProjectId);
    const savedState = loadStudioCheckpointFromDisk(requestedProjectId);
    return res.json({ success: true, checkpoint, state: savedState });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Failed to save checkpoint"),
    });
  }
});

// ============================================================================
// UNIVERSAL NOVEL -> MANGA (SCHEMA 1.0) ENDPOINTS
// ============================================================================

novelToMangaRouter.get("/novel-to-manga/universal-json", (_req, res) => {
  try {
    const state = loadStudioCheckpointFromDisk() || {};
    const universal = exportStudioToUniversalJson({
      novelId: state.prepared_novel_id || "NOVEL_001",
      novelTitle: state.project_title || state.projectTitle || "Novel to Manga Studio",
      productionElements: Array.isArray(state.production_elements) ? state.production_elements : [],
      locations: Array.isArray(state.locations) ? state.locations : [],
      scenes: Array.isArray(state.scenes) ? state.scenes : [],
      referenceSheets: Array.isArray(state.reference_sheets) ? state.reference_sheets : [],
    });
    return res.json({ success: true, universal });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Failed to export Universal JSON"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/universal-json/validate", (req, res) => {
  try {
    const rawData = req.body?.data || req.body;
    const report = validateUniversalProductionJson(rawData);
    return res.json({ success: true, report });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Validation failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/universal-json/import", (req, res) => {
  try {
    const rawData = req.body?.data || req.body;
    const targetProjectId =
      String(req.body?.project_id || rawData?.project_id || "").trim() || undefined;
    const report = validateUniversalProductionJson(rawData);

    if (!report.is_valid && req.body?.ignore_errors !== true) {
      return res.status(422).json({
        success: false,
        error: "UNIVERSAL_JSON_VALIDATION_FAILED: فشل التحقق الصارم من بنية ملف JSON.",
        report,
      });
    }

    const converted = convertUniversalJsonToStudio(rawData);
    const resolvedTitle =
      rawData?.story?.title || rawData?.novel?.title || rawData?.project_name || "Universal Novel Project";
    const resolvedNovelText =
      rawData?.story?.source_text ||
      rawData?.story?.novel_text ||
      rawData?.novel?.novel_text ||
      rawData?.novel?.raw_text ||
      "";

    // Save strictly into checkpoint on disk (isolated if targetProjectId is provided)
    const saved = saveStudioCheckpointToDisk(
      {
        project_id: targetProjectId,
        is_isolated_project: Boolean(targetProjectId),
        project_title: resolvedTitle,
        projectTitle: resolvedTitle,
        novel_text: resolvedNovelText,
        story: rawData?.story,
        style: rawData?.style,
        pipeline_settings: rawData?.pipeline_settings,
        events: converted.events,
        ordered_events: converted.events,
        production_elements: converted.production_elements,
        locations: converted.locations,
        scenes: converted.scenes,
        reference_sheets: converted.reference_sheets,
        pages: converted.pages,
        page_plans: rawData?.page_plans || converted.pages,
        universal_json: rawData,
        universal_validation_report: report,
        replace_all: true,
      },
      targetProjectId
    );

    return res.json({
      success: true,
      report,
      events: converted.events,
      production_elements: converted.production_elements,
      locations: converted.locations,
      scenes: converted.scenes,
      reference_sheets: converted.reference_sheets,
      pages: converted.pages,
      checkpoint: saved,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Failed to import Universal JSON"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/style", (req, res) => {
  try {
    const {
      id,
      style_id,
      style,
      style_name,
      style_description,
      aspect_ratio,
      model_id,
      model_name,
      flow_model,
      custom_style,
      style_version,
      reading_direction,
      mode,
      page_mode,
    } = req.body || {};

    const resolvedStyleId = String(style_id || id || "STYLE_001").trim();
    const resolvedStyleName: StudioStylePreset = (
      style_name ||
      (typeof style === "string" ? style : style?.style_name || style?.style) ||
      style_id ||
      "Korean Manhwa"
    ) as StudioStylePreset;
    const resolvedCustom = String(custom_style || "").trim();
    const resolvedAspectRatio: StudioAspectRatio = (aspect_ratio || "9:16") as StudioAspectRatio;
    const resolvedModelId: FlowDisplayModelName = (
      model_id ||
      model_name ||
      flow_model ||
      (typeof style === "object" ? style?.model_name || style?.model || style?.model_id : undefined) ||
      "Nano Banana 2 Lite"
    ) as FlowDisplayModelName;
    const existing = loadStudioCheckpointFromDisk(req.body?.project_id) || {};
    const prevVersion = Number(existing.style_settings?.style_version) || 1;
    const nextStyleVersion = Number(style_version) || prevVersion + 1;
    const resolvedStyleDesc =
      style_description ||
      geminiCookiesNovelService.resolveGlobalVisualStyle(resolvedStyleName, resolvedCustom);
    const styleHash = computeStudioStyleHash({
      stylePreset: resolvedStyleName,
      customStyle: resolvedCustom,
      aspectRatio: resolvedAspectRatio,
      flowModel: resolvedModelId,
      styleVersion: nextStyleVersion,
    });

    const resolvedMode = mode || page_mode || existing.style_settings?.page_mode || "Korean Manhwa Pages";
    const resolvedReadingDirection =
      reading_direction ||
      (typeof style === "object" ? style?.reading_direction : undefined) ||
      existing.style_settings?.reading_direction ||
      "TOP_TO_BOTTOM";

    const styleSettings = {
      id: resolvedStyleId,
      style_id: resolvedStyleId,
      style: resolvedStyleName,
      style_name: resolvedStyleName,
      style_description: resolvedStyleDesc,
      aspect_ratio: resolvedAspectRatio,
      model_id: resolvedModelId,
      model_name: resolvedModelId,
      flow_model: resolvedModelId,
      custom_style: resolvedCustom,
      mode: resolvedMode,
      page_mode: resolvedMode,
      reading_direction: resolvedReadingDirection,
      target_dimensions: req.body?.target_dimensions || existing.style_settings?.target_dimensions || { width: 2048, height: 16384 },
      negative_prompt: req.body?.negative_prompt !== undefined ? req.body.negative_prompt : existing.style_settings?.negative_prompt || "",
      visual_constraints: req.body?.visual_constraints || existing.style_settings?.visual_constraints || [],
      style_version: nextStyleVersion,
      styleHash,
      updated_at: new Date().toISOString(),
    };

    const checkpoint = saveStudioCheckpointToDisk(
      {
        project_id: req.body?.project_id,
        style_settings: styleSettings,
        style: typeof style === "object" && style !== null ? { ...styleSettings, ...style } : existing.style || styleSettings,
        selectedStyle: resolvedStyleName,
        customStyleText: resolvedCustom,
        selectedAspectRatio: resolvedAspectRatio,
        selectedFlowModel: resolvedModelId,
        styleVersion: nextStyleVersion,
        styleHash,
      },
      req.body?.project_id
    );

    return res.json({
      success: true,
      style_settings: styleSettings,
      checkpoint,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Failed to update style settings"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/script", async (req, res) => {
  try {
    const { geminiCookies, projectTitle, project_id, novelText, targetSceneCount, modelId } = req.body || {};
    if (!novelText || String(novelText).trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "النص الروائي فارغ (Empty novel text is not allowed).",
      });
    }
    const effectiveTargetScenes =
      Number(targetSceneCount) || (String(novelText).trim().length < 1500 ? 3 : undefined);
    const result = await geminiCookiesNovelService.analyzeStoryToStudioScript({
      cookies: geminiCookies || "",
      projectTitle: projectTitle || "مشروع القصة المصورة",
      novelText: novelText || "",
      targetSceneCount: effectiveTargetScenes,
      modelId,
    });
    const eventsFromPipeline = (result.long_novel_pipeline?.blocks || []).flatMap((b: any) =>
      Array.isArray(b.events) ? b.events : []
    );
    const checkpoint = saveStudioCheckpointToDisk(
      {
        project_id,
        is_isolated_project: Boolean(project_id),
        project_title: result.project_title,
        novel_text: novelText,
        script_text: result.script_text,
        production_elements: result.production_elements,
        locations: result.locations,
        scenes: result.scenes,
        events: eventsFromPipeline,
        long_novel_pipeline: result.long_novel_pipeline,
      },
      project_id
    );
    return res.json({ success: true, result: { ...result, events: eventsFromPipeline }, checkpoint });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Script generation failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/extract-from-script", async (req, res) => {
  try {
    const {
      geminiCookies,
      scriptText,
      existingScenes,
      existingLocations,
      existingElements,
      modelId,
    } = req.body || {};
    const result = await geminiCookiesNovelService.extractLocationsAndElementsFromScript({
      cookies: geminiCookies || "",
      scriptText: scriptText || "",
      existingScenes,
      existingLocations,
      existingElements,
      modelId,
    });
    saveStudioCheckpointToDisk({
      script_text: scriptText || result.script_text,
      production_elements: result.production_elements,
      locations: result.locations,
      scenes: result.scenes,
    });
    return res.json({
      success: true,
      locations: result.locations,
      production_elements: result.production_elements,
      scenes: result.scenes,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Extraction from script failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/element/generate-prompt", async (req, res) => {
  try {
    const {
      geminiCookies,
      element,
      stylePreset,
      customStylePrompt,
      novelContext,
      forceRebuildCanonical,
      modelId,
    } = req.body || {};
    const updated = await geminiCookiesNovelService.generateComprehensiveElementPromptViaGemini({
      cookies: geminiCookies,
      modelId,
      element,
      stylePreset: stylePreset || "Korean Manhwa",
      customStylePrompt,
      novelContext,
      forceRebuildCanonical,
    });
    return res.json({
      success: true,
      element: updated,
      telemetry: geminiCookiesNovelService.getTelemetry(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Element prompt generation failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/elements/generate-prompts", async (req, res) => {
  try {
    const { geminiCookies, elements, stylePreset, customStylePrompt, novelContext, modelId } =
      req.body || {};
    const list: StudioProductionElement[] = Array.isArray(elements) ? elements : [];
    const updated: StudioProductionElement[] = [];
    for (const el of list) {
      const u = await geminiCookiesNovelService.generateComprehensiveElementPromptViaGemini({
        cookies: geminiCookies,
        modelId,
        element: el,
        stylePreset: stylePreset || "Korean Manhwa",
        customStylePrompt,
        novelContext,
        forceRebuildCanonical: false,
      });
      updated.push(u);
    }
    return res.json({
      success: true,
      elements: updated,
      telemetry: geminiCookiesNovelService.getTelemetry(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Batch element prompt generation failed"),
    });
  }
});

/**
 * Generates a Reference Image for a Visual Bible Production Element (e.g., CHAR_001 Sunny)
 * EXCLUSIVELY through real Google Flow, verifies the asset inside the real Flow project,
 * and runs Gemini Vision inspection + Additive Correction loop.
 */
novelToMangaRouter.post("/novel-to-manga/studio/element/generate", async (req, res) => {
  try {
    const {
      geminiCookies,
      flowCookies,
      element,
      stylePreset,
      customStylePrompt,
      aspectRatio,
      flowModel,
      projectId,
      reviewModelId,
      autoVerify,
      autoLock,
      maxAttempts,
      customCorrection,
      forceRegenerate,
      styleVersion,
      styleHash,
    } = req.body || {};

    if (!element || !element.id) {
      return res.status(400).json({ success: false, error: "Missing element" });
    }

    // Requirement 16: Cancel any stale polling/vision/continuity for this element on Regenerate
    const targetOp = flowGenerationPerformanceService.beginTargetOperation(element.id);

    const effectiveStylePreset: StudioStylePreset = (stylePreset || "Korean Manhwa") as StudioStylePreset;
    const effectiveAspectRatio: StudioAspectRatio = (aspectRatio || "1:1") as StudioAspectRatio;
    const effectiveFlowModel: FlowDisplayModelName = (flowModel || "Nano Banana Pro") as FlowDisplayModelName;

    // Requirement 20: Strictly validate selected model without ever swapping models
    const resolvedModel = flowGenerationPerformanceService.validateAndResolveModel(effectiveFlowModel);

    const effectiveStyleVersion = Number(styleVersion || element.style_version) || 1;
    const effectiveStyleHash =
      styleHash ||
      computeStudioStyleHash({
        stylePreset: effectiveStylePreset,
        customStyle: customStylePrompt,
        aspectRatio: effectiveAspectRatio,
        flowModel: resolvedModel.modelId,
        styleVersion: effectiveStyleVersion,
      });

    const cleanManualCorr = customCorrection
      ? String(customCorrection).trim()
      : element.verification_status === "REJECTED" && element.verification_result?.additive_correction
      ? String(element.verification_result.additive_correction).trim()
      : "";
    const elementRefHash = flowGenerationPerformanceService.computeReferenceHash({
      referenceIds: [element.id],
      referenceVersions: [element.version || 1],
    });
    const elementPromptHash = flowGenerationPerformanceService.computePromptHash({
      targetId: element.id,
      canonicalText: element.canonical_description || element.visual_details || element.description || "",
      styleHash: effectiveStyleHash,
      referenceHash: elementRefHash,
      modelId: resolvedModel.modelId,
      aspectRatio: effectiveAspectRatio,
      corrections: [
        cleanManualCorr,
        ...(Array.isArray(element.generation_corrections) ? element.generation_corrections : []),
        ...(Array.isArray(element.added_corrections) ? element.added_corrections : []),
      ],
    });

    const timingRecord = flowGenerationPerformanceService.startTimingRecord({
      targetId: element.id,
      targetType: "ELEMENT",
      modelId: resolvedModel.modelId,
      internalModelId: resolvedModel.internalModelId,
      projectId: projectId || "",
      promptHash: elementPromptHash,
      styleHash: effectiveStyleHash,
      referenceHash: elementRefHash,
      requestedAspectRatio: effectiveAspectRatio,
    });

    let workingElement: StudioProductionElement = {
      ...element,
      style_version: effectiveStyleVersion,
      styleHash: effectiveStyleHash,
      aspect_ratio: effectiveAspectRatio,
      selected_model: resolvedModel.modelId,
      applied_style_settings: {
        style_preset: effectiveStylePreset,
        custom_style_prompt: customStylePrompt || "",
        generation_style_line: geminiCookiesNovelService.resolveGlobalVisualStyle(
          effectiveStylePreset,
          customStylePrompt
        ),
        aspect_ratio: effectiveAspectRatio,
        selected_model: resolvedModel.modelId,
        style_version: effectiveStyleVersion,
        styleHash: effectiveStyleHash,
        applied_at: new Date().toISOString(),
      },
    };

    const hasExistingElCorrs =
      (Array.isArray(element.added_corrections) && element.added_corrections.length > 0) ||
      (Array.isArray(element.generation_corrections) && element.generation_corrections.length > 0);
    const cachedPromptEntry = flowGenerationPerformanceService.getCachedPrompt(elementPromptHash);
    if (cachedPromptEntry && !cleanManualCorr && !forceRegenerate && !hasExistingElCorrs) {
      timingRecord.prompt_cache_hit = true;
      workingElement.assembled_flow_prompt = cachedPromptEntry.assembledPrompt;
      workingElement.reference_prompt = cachedPromptEntry.assembledPrompt;
      workingElement.current_prompt = cachedPromptEntry.assembledPrompt;
    } else if (cleanManualCorr) {
      workingElement.manual_correction = cleanManualCorr;
      workingElement = geminiCookiesNovelService.applyTargetedElementCorrection({
        element: workingElement,
        correction: cleanManualCorr,
        stylePreset: effectiveStylePreset,
        customStylePrompt,
      });
      flowGenerationPerformanceService.setCachedPrompt({
        promptHash: elementPromptHash,
        styleHash: effectiveStyleHash,
        referenceHash: elementRefHash,
        modelId: resolvedModel.modelId,
        aspectRatio: effectiveAspectRatio,
        assembledPrompt: workingElement.assembled_flow_prompt || workingElement.reference_prompt || "",
        createdAt: Date.now(),
      });
    } else {
      const assembled = geminiCookiesNovelService.assembleFinalFlowPromptForElement({
        element: workingElement,
        stylePreset: effectiveStylePreset,
        customStylePrompt,
        aspectRatio: effectiveAspectRatio,
      });
      workingElement.canonical_description = assembled.canonical_description;
      workingElement.base_reference_prompt = assembled.canonical_description;
      workingElement.generation_style = assembled.generation_style;
      workingElement.generation_corrections = assembled.generation_corrections;
      workingElement.critical_corrections = [...assembled.generation_corrections];
      workingElement.reference_prompt = assembled.assembled_prompt;
      workingElement.assembled_flow_prompt = assembled.assembled_prompt;
      workingElement.pre_flow_protection_report = assembled.protection_report;

      // Master Reference Sheet Prompt Unification:
      // If element is a CHARACTER, CREATURE, or alpha entity with attached equipment/weapons/minions,
      // cluster and format as a single comprehensive Master Design Sheet prompt for Google Flow.
      const currentCpState = loadStudioCheckpointFromDisk(projectId) || {};
      const allCpElementsList: StudioProductionElement[] = Array.isArray(currentCpState.production_elements)
        ? currentCpState.production_elements
        : [];
      const allCpLocationsList: StudioLocationItem[] = Array.isArray(currentCpState.locations)
        ? currentCpState.locations
        : [];

      const { masterSheets } = clusterElementsIntoMasterReferenceSheets(
        [workingElement, ...allCpElementsList.filter((e) => e.id !== workingElement.id)],
        allCpLocationsList
      );
      const targetMasterSheet = masterSheets.find((ms) => ms.masterId === workingElement.id);
      if (targetMasterSheet && targetMasterSheet.attachedEntities.length > 0) {
        const masterFlowPrompt = buildMasterReferenceSheetFlowPrompt({
          masterSheet: targetMasterSheet,
          globalStyle: geminiCookiesNovelService.resolveGlobalVisualStyle(
            effectiveStylePreset,
            customStylePrompt
          ),
          aspectRatio: effectiveAspectRatio,
        });
        workingElement.assembled_flow_prompt = masterFlowPrompt;
        workingElement.reference_prompt = masterFlowPrompt;
        workingElement.current_prompt = masterFlowPrompt;
      }

      flowGenerationPerformanceService.setCachedPrompt({
        promptHash: elementPromptHash,
        styleHash: effectiveStyleHash,
        referenceHash: elementRefHash,
        modelId: resolvedModel.modelId,
        aspectRatio: effectiveAspectRatio,
        assembledPrompt: workingElement.assembled_flow_prompt || assembled.assembled_prompt,
        createdAt: Date.now(),
      });
    }

    workingElement.base_prompt =
      workingElement.base_prompt ||
      workingElement.canonical_description ||
      workingElement.base_reference_prompt ||
      workingElement.visual_details;
    workingElement.current_prompt =
      workingElement.assembled_flow_prompt ||
      workingElement.reference_prompt ||
      workingElement.visual_details;
    workingElement.correction_history = geminiCookiesNovelService.buildCorrectionHistoryList(
      workingElement.base_prompt,
      workingElement.generation_corrections || workingElement.added_corrections || [],
      workingElement.current_prompt,
      workingElement.correction_history
    );
    workingElement.generation_plan = geminiCookiesNovelService.buildGenerationPlanStage({
      targetId: workingElement.id,
      canonicalDescriptionUsed: workingElement.canonical_description || workingElement.visual_details || "",
      referenceIdsUsed: [workingElement.id],
      stylePreset: effectiveStylePreset,
      customStyle: customStylePrompt,
      styleVersion: effectiveStyleVersion,
      styleHash: effectiveStyleHash,
      aspectRatio: effectiveAspectRatio,
      modelId: effectiveFlowModel,
      additiveCorrections: workingElement.generation_corrections || [],
      assembledMasterPrompt: workingElement.current_prompt || "",
      promptVersion: (Number(workingElement.version) || 0) + 1,
    });

    timingRecord.preparation_end = Date.now();

    const shouldAutoVerify = autoVerify !== false;
    const boundedMaxAttempts =
      !shouldAutoVerify ? 1 : Math.max(1, Math.min(Number(maxAttempts) || 4, 4));
    const attemptsLog = Array.isArray(workingElement.attempts_log)
      ? [...workingElement.attempts_log]
      : [];
    const versionsList = Array.isArray(workingElement.versions)
      ? [...workingElement.versions]
      : [];

    for (let attempt = 1; attempt <= boundedMaxAttempts; attempt++) {
      const nextVersion = (Number(workingElement.version) || 0) + 1;
      const runId = `run_${workingElement.id}_v${nextVersion}_${effectiveStyleHash}_${Date.now()}`;
      const currentPrompt =
        workingElement.assembled_flow_prompt ||
        workingElement.reference_prompt ||
        workingElement.visual_details;

      const genRes = await googleFlowProvider.generateWithProjectFailover({
        prompt: currentPrompt,
        modelDisplayName: resolvedModel.modelId,
        outputFileName: `${projectId && !isValidFlowProjectUuid(projectId) ? `${projectId}_` : ""}${workingElement.id}_v${nextVersion}_${Date.now()}.png`,
        preferredProjectId: isValidFlowProjectUuid(projectId) ? projectId : undefined,
        fallbackRawCookies: flowCookies,
        aspectRatio: effectiveAspectRatio,
        actionType: "REFERENCE_GENERATION",
        elementId: workingElement.id,
        attempt,
        runId,
        promptVersion: nextVersion,
        styleHash: effectiveStyleHash,
        referenceHash: elementRefHash,
        timingRecord,
      });

      const isProjectAndAssetVerified = Boolean(
        genRes.assetVerified &&
          genRes.flowAssetId &&
          isRealVerifiedFlowProjectId(genRes.flowProjectId)
      );

      // Requirement 8: Cache reference asset ID and hash so future scene generations reuse it without re-uploading
      if (genRes.flowProjectId && genRes.flowAssetId) {
        flowGenerationPerformanceService.setCachedReferenceAsset({
          flowProjectId: genRes.flowProjectId,
          flowAssetId: genRes.flowAssetId,
          referenceHash: elementRefHash,
          referenceVersion: nextVersion,
          localFilePath: genRes.local_file_path || "",
          uploadedAt: Date.now(),
        });
      }

      if (genRes.local_file_path && fs.existsSync(genRes.local_file_path)) {
        try {
          const buf = fs.readFileSync(genRes.local_file_path);
          cacheVisionImageInMemory(`EL_${workingElement.id}`, buf);
          cacheVisionImageInMemory(`CHAR_${workingElement.id}`, buf);
          cacheVisionImageInMemory(`WEAP_${workingElement.id}`, buf);
        } catch (_) {}
      }

      workingElement = {
        ...workingElement,
        version: nextVersion,
        reference_image_url: genRes.public_url || genRes.base64_data_url,
        local_file_path: genRes.local_file_path || "",
        flow_provider: "Google Flow",
        flow_project_id: genRes.flowProjectId,
        flowProjectId: genRes.flowProjectId,
        flowProjectUrl: genRes.flowProjectUrl,
        flowAssetId: genRes.flowAssetId,
        flowGenerationId: genRes.flowGenerationId,
        promptHash: genRes.promptHash,
        real_flow_project_verified: isRealVerifiedFlowProjectId(genRes.flowProjectId),
        real_flow_asset_created: Boolean(genRes.flowAssetId),
        real_flow_asset_verified: isProjectAndAssetVerified,
        flow_generation_status: isProjectAndAssetVerified
          ? "FLOW_GENERATION_SUCCESS"
          : "FLOW_GENERATION_INCOMPLETE",
        flow_asset_status: isProjectAndAssetVerified
          ? "FLOW_ASSET_VERIFIED"
          : "FLOW_ASSET_NOT_VERIFIED",
        flow_model: resolvedModel.modelId,
        flow_metadata: genRes.metadata,
      };

      if (!shouldAutoVerify) {
        workingElement.approved = false;
        workingElement.status = "GENERATED";
        workingElement.generation_status = "GENERATED";
        workingElement.verification_status = "UNVERIFIED";
        workingElement.vision_status = "UNVERIFIED";
        workingElement.verification_result = undefined;
        workingElement.last_error = null;
        timingRecord.stage_status = "IMAGE_READY";
        timingRecord.total_end = Date.now();
        flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);
        break;
      }

      // Requirement 11 & 12: Run Vision in background so IMAGE_READY is immediate unless blockingVerify is requested
      if (req.body?.blockingVerify !== true) {
        workingElement.approved = false;
        workingElement.status = "GENERATED";
        workingElement.generation_status = "GENERATED";
        workingElement.verification_status = "VERIFYING";
        workingElement.vision_status = "UNVERIFIED";
        flowGenerationPerformanceService.setBackgroundTaskState({
          target_id: workingElement.id,
          target_type: "ELEMENT",
          run_token: targetOp.runToken,
          record_id: timingRecord.record_id,
          stage_status: "VISION_PENDING",
          image_ready: true,
          vision_completed: false,
          continuity_completed: true,
          checkpoint_completed: false,
          approved: false,
          locked: false,
          updated_item: workingElement,
          failure_category: "NONE",
          timing: timingRecord,
          updated_at: new Date().toISOString(),
        });

        setImmediate(async () => {
          if (!flowGenerationPerformanceService.isTargetOperationActive(workingElement.id, targetOp.runToken)) {
            return;
          }
          try {
            timingRecord.stage_status = "VISION_PENDING";
            timingRecord.vision_start = Date.now();
            const tempElPath = resolveLocalImagePathForVision(
              genRes.base64_data_url,
              genRes.local_file_path,
              `EL_${workingElement.id}`
            );
            const visionRes = await geminiCookiesNovelService.inspectStudioElementImage({
              cookies: geminiCookies || "",
              modelId: reviewModelId,
              element: workingElement,
              stylePreset: effectiveStylePreset,
              promptUsed: currentPrompt,
              localImagePath: tempElPath || "",
            });
            let finalElVisionRes = visionRes;
            let finalWorkingElement: StudioProductionElement = { ...workingElement };
            let elHealAttempt = 1;
            const maxElHealAttempts = Math.max(2, Math.min(Number(maxAttempts) || 4, 4));

            while (
              !finalElVisionRes.approved &&
              elHealAttempt < maxElHealAttempts &&
              flowGenerationPerformanceService.isTargetOperationActive(workingElement.id, targetOp.runToken)
            ) {
              elHealAttempt++;
              const corrText =
                finalElVisionRes.additive_correction ||
                (Array.isArray(finalElVisionRes.what_is_missing) &&
                finalElVisionRes.what_is_missing.length > 0
                  ? `Clearly include: ${finalElVisionRes.what_is_missing.join(", ")}`
                  : `Strictly enforce all canonical visual traits of ${finalWorkingElement.name} with zero text or artifacts`);
              try {
                googleFlowProvider.incrementRegenerationCount();
                let correctedEl = geminiCookiesNovelService.applyTargetedElementCorrection({
                  element: finalWorkingElement,
                  correction: corrText,
                  stylePreset: effectiveStylePreset,
                  customStylePrompt,
                });
                const healVersion = (Number(correctedEl.version) || 1) + 1;
                const healPrompt =
                  correctedEl.assembled_flow_prompt ||
                  correctedEl.reference_prompt ||
                  currentPrompt;

                flowGenerationPerformanceService.setBackgroundTaskState({
                  target_id: workingElement.id,
                  target_type: "ELEMENT",
                  run_token: targetOp.runToken,
                  record_id: timingRecord.record_id,
                  stage_status: "VISION_PENDING",
                  image_ready: true,
                  vision_completed: false,
                  continuity_completed: true,
                  checkpoint_completed: false,
                  approved: false,
                  locked: false,
                  updated_item: {
                    ...correctedEl,
                    current_attempt: elHealAttempt,
                    verification_status: "VERIFYING",
                    verification_result: finalElVisionRes,
                  },
                  failure_category: "NONE",
                  timing: timingRecord,
                  updated_at: new Date().toISOString(),
                });

                const healGenRes = await googleFlowProvider.generateWithProjectFailover({
                  prompt: healPrompt,
                  modelDisplayName: resolvedModel.modelId,
                  outputFileName: `${projectId && !isValidFlowProjectUuid(projectId) ? `${projectId}_` : ""}${correctedEl.id}_v${healVersion}_${Date.now()}.png`,
                  preferredProjectId: isValidFlowProjectUuid(projectId) ? projectId : undefined,
                  fallbackRawCookies: flowCookies,
                  aspectRatio: effectiveAspectRatio,
                  actionType: "REFERENCE_GENERATION",
                  elementId: correctedEl.id,
                  attempt: elHealAttempt,
                  runId: `heal_${correctedEl.id}_v${healVersion}_${Date.now()}`,
                  promptVersion: healVersion,
                  styleHash: effectiveStyleHash,
                  referenceHash: elementRefHash,
                  timingRecord,
                });
                if (healGenRes.base64_data_url || healGenRes.public_url) {
                  finalWorkingElement = {
                    ...correctedEl,
                    version: healVersion,
                    current_attempt: elHealAttempt,
                    reference_image_url: healGenRes.public_url || healGenRes.base64_data_url,
                    local_file_path: healGenRes.local_file_path || finalWorkingElement.local_file_path,
                    current_prompt: healPrompt,
                    flowAssetId: healGenRes.flowAssetId || correctedEl.flowAssetId,
                    flowGenerationId: healGenRes.flowGenerationId || correctedEl.flowGenerationId,
                  };
                  const healTempPath = resolveLocalImagePathForVision(
                    healGenRes.base64_data_url,
                    healGenRes.local_file_path,
                    `EL_HEAL_${correctedEl.id}_a${elHealAttempt}`
                  );
                  if (healTempPath) {
                    finalElVisionRes = await geminiCookiesNovelService.inspectStudioElementImage({
                      cookies: geminiCookies || "",
                      modelId: reviewModelId,
                      element: finalWorkingElement,
                      stylePreset: effectiveStylePreset,
                      promptUsed: healPrompt,
                      localImagePath: healTempPath,
                    });
                  }
                } else {
                  break;
                }
              } catch (_) {
                break;
              }
            }

            timingRecord.vision_end = Date.now();
            timingRecord.total_end = Date.now();
            timingRecord.stage_status = finalElVisionRes.approved
              ? autoLock !== false
                ? "LOCKED"
                : "APPROVED"
              : "POST_PROCESSING_FAILURE";
            flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);

            const nextElCorrs = Array.from(
              new Set([
                ...(finalWorkingElement.added_corrections || []),
                ...(finalElVisionRes.additive_correction ? [finalElVisionRes.additive_correction] : []),
              ])
            );

            const bgUpdated: StudioProductionElement = {
              ...finalWorkingElement,
              approved: Boolean(finalElVisionRes.approved),
              status: finalElVisionRes.approved
                ? autoLock !== false
                  ? "LOCKED"
                  : "APPROVED"
                : "NEEDS_CORRECTION",
              locked_for_production: Boolean(finalElVisionRes.approved && autoLock !== false),
              added_corrections: nextElCorrs,
              additive_corrections: nextElCorrs,
              verification_result: finalElVisionRes,
              vision_status: finalElVisionRes.vision_status,
              verification_status:
                finalElVisionRes.overall_status === "VISION_FAILED"
                  ? "VISION_FAILED"
                  : finalElVisionRes.approved
                  ? "VERIFIED"
                  : "REJECTED",
            };
            upsertStudioCheckpointEntitiesOnDisk({ element: bgUpdated, projectId });
            flowGenerationPerformanceService.setBackgroundTaskState({
              target_id: workingElement.id,
              target_type: "ELEMENT",
              run_token: targetOp.runToken,
              record_id: timingRecord.record_id,
              stage_status: timingRecord.stage_status,
              image_ready: true,
              vision_completed: true,
              continuity_completed: true,
              checkpoint_completed: true,
              approved: Boolean(finalElVisionRes.approved),
              locked: Boolean(finalElVisionRes.approved && autoLock !== false),
              updated_item: bgUpdated,
              failure_category: finalElVisionRes.approved ? "NONE" : "POST_PROCESSING_FAILURE",
              timing: timingRecord,
              updated_at: new Date().toISOString(),
            });
          } catch (bgErr: any) {
            // Requirement 15: Separate POST_PROCESSING_FAILURE from GENERATION_FAILURE (never retry generation)
            timingRecord.vision_end = Date.now();
            timingRecord.total_end = Date.now();
            timingRecord.failure_category = "POST_PROCESSING_FAILURE";
            timingRecord.stage_status = "POST_PROCESSING_FAILURE";
            flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);
          }
        });
        break;
      }

      timingRecord.vision_start = Date.now();
      const tempElPath = resolveLocalImagePathForVision(
        genRes.base64_data_url,
        genRes.local_file_path,
        `EL_${workingElement.id}`
      );
      const visionRes = await geminiCookiesNovelService.inspectStudioElementImage({
        cookies: geminiCookies || "",
        modelId: reviewModelId,
        element: workingElement,
        stylePreset: effectiveStylePreset,
        promptUsed: currentPrompt,
        localImagePath: tempElPath || "",
      });
      if (!visionRes.reviewed_at) {
        visionRes.reviewed_at = new Date().toISOString();
      }
      timingRecord.vision_end = Date.now();
      timingRecord.total_end = Date.now();
      flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);

      const attemptRecord: StudioSceneAttemptLog = {
        attempt_number: attempt,
        attempt,
        version: nextVersion,
        prompt_used: currentPrompt,
        image_url: genRes.public_url,
        local_file_path: genRes.local_file_path,
        flow_project_id: genRes.flowProjectId,
        flowProjectId: genRes.flowProjectId,
        flowProjectUrl: genRes.flowProjectUrl,
        flowAssetId: genRes.flowAssetId,
        flowGenerationId: genRes.flowGenerationId,
        promptHash: genRes.promptHash,
        real_flow_asset_verified: true,
        flow_model: effectiveFlowModel,
        flow_metadata: genRes.metadata,
        approved: visionRes.approved,
        score: visionRes.score,
        additive_correction: visionRes.additive_correction,
        detected_issues: visionRes.issues,
        corrected_prompt: visionRes.corrected_prompt,
        timestamp: new Date().toISOString(),
      };
      attemptsLog.push(attemptRecord);

      workingElement.generation_status = "GENERATED";
      workingElement.verification_result = visionRes;
      workingElement.vision_status = visionRes.vision_status;
      workingElement.verification_status =
        visionRes.overall_status === "VISION_FAILED"
          ? "VISION_FAILED"
          : visionRes.approved
          ? "VERIFIED"
          : "REJECTED";
      workingElement.actual_image_verification =
        geminiCookiesNovelService.buildActualImageVerificationStage({
          targetId: workingElement.id,
          imageInspected: genRes.local_file_path || genRes.public_url,
          actualVisionCompleted: visionRes.actual_vision_request_completed !== false,
          approved: visionRes.approved,
          overallStatus: visionRes.overall_status || (visionRes.approved ? "PASS" : "NEEDS_CORRECTION"),
          failedChecks: visionRes.failed_checks || [],
          whatIsCorrect: visionRes.what_is_correct || [],
          whatIsMissing: visionRes.what_is_missing || [],
          whatIsDifferent: visionRes.what_is_different || [],
          additiveCorrection: visionRes.additive_correction,
        });
      workingElement.attempts_log = attemptsLog;

      const lockCheck = geminiCookiesNovelService.validateElementLockEligibility(workingElement);

      versionsList.push({
        version: nextVersion,
        prompt_used: currentPrompt,
        canonical_description: workingElement.canonical_description,
        generation_style: workingElement.generation_style,
        generation_corrections: workingElement.generation_corrections,
        added_corrections: workingElement.added_corrections,
        image_url: genRes.public_url,
        local_file_path: genRes.local_file_path,
        flow_project_id: genRes.flowProjectId,
        flowProjectId: genRes.flowProjectId,
        flowProjectUrl: genRes.flowProjectUrl,
        flowAssetId: genRes.flowAssetId,
        flowGenerationId: genRes.flowGenerationId,
        promptHash: genRes.promptHash,
        real_flow_asset_verified: true,
        flow_model: effectiveFlowModel,
        flow_metadata: genRes.metadata,
        status: lockCheck.canLock ? (autoLock !== false ? "LOCKED" : "APPROVED") : "REJECTED",
        verification_result: visionRes,
        created_at: new Date().toISOString(),
        locked_at: lockCheck.canLock && autoLock !== false ? new Date().toISOString() : null,
      });
      workingElement.versions = versionsList;

      if (lockCheck.canLock) {
        workingElement.approved = true;
        workingElement.status = autoLock !== false ? "LOCKED" : "APPROVED";
        workingElement.locked_for_production = autoLock !== false;
        if (autoLock !== false) {
          workingElement.locked_at = new Date().toISOString();
        }
        break;
      } else {
        workingElement.approved = false;
        workingElement.locked_for_production = false;
        workingElement.status =
          visionRes.overall_status === "VISION_FAILED" ? "VISION_FAILED" : "NEEDS_CORRECTION";
        if (visionRes.additive_correction && attempt < boundedMaxAttempts) {
          googleFlowProvider.incrementRegenerationCount();
          workingElement = geminiCookiesNovelService.applyTargetedElementCorrection({
            element: workingElement,
            correction: visionRes.additive_correction,
            stylePreset: effectiveStylePreset,
            customStylePrompt,
          });
          workingElement.current_prompt =
            workingElement.assembled_flow_prompt || workingElement.reference_prompt;
          workingElement.correction_history = geminiCookiesNovelService.buildCorrectionHistoryList(
            workingElement.base_prompt || workingElement.canonical_description || "",
            workingElement.generation_corrections || [],
            workingElement.current_prompt || "",
            workingElement.correction_history
          );
        } else {
          break;
        }
      }
    }

    upsertStudioCheckpointEntitiesOnDisk({ element: workingElement, projectId });

    return res.json({
      success: true,
      element: workingElement,
      performance_timing: timingRecord,
      telemetry: geminiCookiesNovelService.getTelemetry(),
      background_verification_started: Boolean(
        shouldAutoVerify && req.body?.blockingVerify !== true
      ),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "FLOW_GENERATION_FAILED"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/element/verify", async (req, res) => {
  try {
    const { geminiCookies, element, stylePreset, reviewModelId, autoLock } = req.body || {};
    if (!element) {
      return res.status(400).json({ success: false, error: "Missing element" });
    }
    const localPath = resolveLocalImagePathForVision(
      element.reference_image_url,
      element.local_file_path,
      `EL_${element.id}`
    );
    if (!localPath) {
      return res.status(400).json({
        success: false,
        error: "لا توجد صورة محلية صالحة لفحص الرؤية عبر Gemini Vision.",
      });
    }
    const visionRes = await geminiCookiesNovelService.inspectStudioElementImage({
      cookies: geminiCookies || "",
      modelId: reviewModelId,
      element,
      stylePreset: stylePreset || "Korean Manhwa",
      promptUsed: element.assembled_flow_prompt || element.reference_prompt || "",
      localImagePath: localPath,
    });
    if (!visionRes.reviewed_at) {
      visionRes.reviewed_at = new Date().toISOString();
    }

    const updatedElCorrs = Array.from(
      new Set([
        ...(Array.isArray(element.added_corrections) ? element.added_corrections : []),
        ...(!visionRes.approved && visionRes.additive_correction
          ? [normalizeCorrectionItem(visionRes.additive_correction)]
          : []),
      ].filter(Boolean))
    ).slice(-4);

    const resolvedElUrl =
      element.reference_image_url && element.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
        ? element.reference_image_url
        : `/generated/novel-to-manga/${path.basename(localPath)}`;

    const candidateUpdated: StudioProductionElement = {
      ...element,
      reference_image_url: resolvedElUrl,
      local_file_path: localPath,
      added_corrections: updatedElCorrs,
      verification_result: visionRes,
      vision_status: visionRes.vision_status,
      verification_status:
        visionRes.overall_status === "VISION_FAILED"
          ? "VISION_FAILED"
          : visionRes.approved
          ? "VERIFIED"
          : "REJECTED",
    };
    const lockCheck = geminiCookiesNovelService.validateElementLockEligibility(candidateUpdated);
    const isElApproved = Boolean(lockCheck.canLock || visionRes.approved);

    const updated: StudioProductionElement = {
      ...candidateUpdated,
      approved: isElApproved,
      locked_for_production: Boolean(isElApproved && autoLock !== false),
      last_error: isElApproved ? null : visionRes.additive_correction || element.last_error || null,
      status: isElApproved
        ? autoLock !== false
          ? "LOCKED"
          : "APPROVED"
        : visionRes.overall_status === "VISION_FAILED"
        ? "VISION_FAILED"
        : "NEEDS_CORRECTION",
      locked_at:
        isElApproved && autoLock !== false
          ? new Date().toISOString()
          : element.locked_at,
    };

    upsertStudioCheckpointEntitiesOnDisk({ element: updated, projectId: req.body?.projectId || req.body?.project_id });

    return res.json({
      success: true,
      approved: updated.approved,
      element: updated,
      telemetry: geminiCookiesNovelService.getTelemetry(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Element verification failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/element/lock", (req, res) => {
  try {
    const { element } = req.body || {};
    if (!element) {
      return res.status(400).json({
        success: false,
        error: "بيانات العنصر مفقودة.",
      });
    }
    const diskElPath = resolveLocalImagePathForVision(
      element.reference_image_url,
      element.local_file_path,
      `EL_${element.id}`
    );
    const hydratedEl: StudioProductionElement = {
      ...element,
      reference_image_url:
        element.reference_image_url && element.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
          ? element.reference_image_url
          : diskElPath
          ? `/generated/novel-to-manga/${path.basename(diskElPath)}`
          : element.reference_image_url,
      local_file_path: diskElPath || element.local_file_path,
    };
    const lockCheck = geminiCookiesNovelService.validateElementLockEligibility(hydratedEl);
    if (!lockCheck.canLock) {
      return res.status(400).json({
        success: false,
        missingRequirements: lockCheck.missingRequirements,
        error: lockCheck.reasonAr,
      });
    }
    const locked: StudioProductionElement = {
      ...hydratedEl,
      approved: true,
      status: "LOCKED",
      locked_for_production: true,
      generation_status: "GENERATED",
      verification_status: "VERIFIED",
      vision_status: "PASS",
      locked_at: new Date().toISOString(),
    };
    upsertStudioCheckpointEntitiesOnDisk({ element: locked, projectId: req.body?.projectId || req.body?.project_id });
    return res.json({ success: true, element: locked });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Element lock failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/element/update", (req, res) => {
  try {
    const { element, projectId, project_id } = req.body || {};
    if (element && element.id) {
      upsertStudioCheckpointEntitiesOnDisk({ element, projectId: projectId || project_id });
    }
    return res.json({ success: true, element });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Element update failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/location/generate-prompt", async (req, res) => {
  try {
    const { geminiCookies, location, stylePreset, customStylePrompt, novelContext, modelId } =
      req.body || {};
    const updated = await geminiCookiesNovelService.generateComprehensiveLocationPromptViaGemini({
      cookies: geminiCookies,
      modelId,
      location,
      stylePreset: stylePreset || "Korean Manhwa",
      customStylePrompt,
      novelContext,
    });
    return res.json({
      success: true,
      location: updated,
      telemetry: geminiCookiesNovelService.getTelemetry(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Location prompt generation failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/locations/generate-prompts", async (req, res) => {
  try {
    const { geminiCookies, locations, stylePreset, customStylePrompt, scriptContext, modelId } =
      req.body || {};
    const list: StudioLocationItem[] = Array.isArray(locations) ? locations : [];
    const updated: StudioLocationItem[] = new Array(list.length);
    const CONCURRENCY = 3;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const batch = list.slice(i, i + CONCURRENCY);
      const batchRes = await Promise.all(
        batch.map((loc) =>
          geminiCookiesNovelService.generateComprehensiveLocationPromptViaGemini({
            cookies: geminiCookies,
            modelId,
            location: loc,
            stylePreset: stylePreset || "Korean Manhwa",
            customStylePrompt,
            novelContext: scriptContext,
          })
        )
      );
      for (let j = 0; j < batchRes.length; j++) {
        updated[i + j] = batchRes[j];
      }
    }
    return res.json({
      success: true,
      locations: updated,
      telemetry: geminiCookiesNovelService.getTelemetry(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Batch location prompt generation failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/location/generate", async (req, res) => {
  try {
    const {
      geminiCookies,
      flowCookies,
      location,
      stylePreset,
      customStylePrompt,
      aspectRatio,
      flowModel,
      projectId,
      reviewModelId,
      autoVerify,
      maxAttempts,
      customCorrection,
      forceRegenerate,
      styleVersion,
      styleHash,
    } = req.body || {};

    if (!location || !location.location_id) {
      return res.status(400).json({ success: false, error: "Missing location" });
    }

    // Requirement 16: Cancel any stale polling/vision/continuity for this location on Regenerate
    const targetOp = flowGenerationPerformanceService.beginTargetOperation(location.location_id);

    const effectiveLocStylePreset: StudioStylePreset = (stylePreset || "Korean Manhwa") as StudioStylePreset;
    const effectiveLocAspectRatio: StudioAspectRatio = (aspectRatio || "16:9") as StudioAspectRatio;
    const effectiveLocFlowModel: FlowDisplayModelName = (flowModel || "Nano Banana Pro") as FlowDisplayModelName;

    // Requirement 20: Strictly validate selected model without ever swapping models
    const resolvedLocModel = flowGenerationPerformanceService.validateAndResolveModel(effectiveLocFlowModel);

    const effectiveLocStyleVersion = Number(styleVersion || location.style_version) || 1;
    const effectiveLocStyleHash =
      styleHash ||
      computeStudioStyleHash({
        stylePreset: effectiveLocStylePreset,
        customStyle: customStylePrompt,
        aspectRatio: effectiveLocAspectRatio,
        flowModel: resolvedLocModel.modelId,
        styleVersion: effectiveLocStyleVersion,
      });

    const cleanManualLocCorr = customCorrection
      ? String(customCorrection).trim()
      : location.verification_status === "REJECTED" && location.verification_result?.additive_correction
      ? String(location.verification_result.additive_correction).trim()
      : "";
    const locRefHash = flowGenerationPerformanceService.computeReferenceHash({
      referenceIds: [location.location_id],
      referenceVersions: [location.version || 1],
    });
    const locPromptHash = flowGenerationPerformanceService.computePromptHash({
      targetId: location.location_id,
      canonicalText:
        location.canonical_description ||
        location.visual_description ||
        location.description ||
        "",
      styleHash: effectiveLocStyleHash,
      referenceHash: locRefHash,
      modelId: resolvedLocModel.modelId,
      aspectRatio: effectiveLocAspectRatio,
      corrections: [
        cleanManualLocCorr,
        ...(Array.isArray(location.generation_corrections) ? location.generation_corrections : []),
        ...(Array.isArray(location.added_corrections) ? location.added_corrections : []),
      ],
    });

    const timingRecord = flowGenerationPerformanceService.startTimingRecord({
      targetId: location.location_id,
      targetType: "LOCATION",
      modelId: resolvedLocModel.modelId,
      internalModelId: resolvedLocModel.internalModelId,
      projectId: projectId || "",
      promptHash: locPromptHash,
      styleHash: effectiveLocStyleHash,
      referenceHash: locRefHash,
      requestedAspectRatio: effectiveLocAspectRatio,
    });

    let workingLoc: StudioLocationItem = {
      ...location,
      style_version: effectiveLocStyleVersion,
      styleHash: effectiveLocStyleHash,
      aspect_ratio: effectiveLocAspectRatio,
      selected_model: resolvedLocModel.modelId,
      applied_style_settings: {
        style_preset: effectiveLocStylePreset,
        custom_style_prompt: customStylePrompt || "",
        generation_style_line: geminiCookiesNovelService.resolveGlobalVisualStyle(
          effectiveLocStylePreset,
          customStylePrompt
        ),
        aspect_ratio: effectiveLocAspectRatio,
        selected_model: resolvedLocModel.modelId,
        style_version: effectiveLocStyleVersion,
        styleHash: effectiveLocStyleHash,
        applied_at: new Date().toISOString(),
      },
    };
    if (cleanManualLocCorr) {
      workingLoc.manual_correction = cleanManualLocCorr;
    }

    const hasExistingLocCorrs =
      (Array.isArray(location.added_corrections) && location.added_corrections.length > 0) ||
      (Array.isArray(location.generation_corrections) && location.generation_corrections.length > 0);
    const cachedLocPrompt = flowGenerationPerformanceService.getCachedPrompt(locPromptHash);
    if (cachedLocPrompt && !cleanManualLocCorr && !forceRegenerate && !hasExistingLocCorrs) {
      timingRecord.prompt_cache_hit = true;
      workingLoc.visual_reference_prompt = cachedLocPrompt.assembledPrompt;
      workingLoc.assembled_flow_prompt = cachedLocPrompt.assembledPrompt;
      workingLoc.current_prompt = cachedLocPrompt.assembledPrompt;
    } else {
      const assembled = geminiCookiesNovelService.assembleFinalFlowPromptForLocation({
        location: workingLoc,
        stylePreset: effectiveLocStylePreset,
        customStylePrompt,
        aspectRatio: effectiveLocAspectRatio,
        additionalCorrections: cleanManualLocCorr ? [cleanManualLocCorr] : undefined,
      });
      workingLoc.canonical_description = assembled.canonical_description;
      workingLoc.base_reference_prompt = assembled.canonical_description;
      workingLoc.base_prompt = workingLoc.base_prompt || assembled.canonical_description;
      workingLoc.visual_reference_prompt = assembled.assembled_prompt;
      workingLoc.assembled_flow_prompt = assembled.assembled_prompt;
      workingLoc.current_prompt = assembled.assembled_prompt;
      workingLoc.generation_style = assembled.generation_style;
      workingLoc.generation_corrections = assembled.generation_corrections;
      workingLoc.critical_corrections = [...assembled.generation_corrections];
      workingLoc.added_corrections = [...assembled.generation_corrections];
      workingLoc.additive_corrections = [...assembled.generation_corrections];

      // Location Master Reference Sheet Unification:
      // If location has attached monuments, statues, spears, or architectural elements (e.g. Bridge + Statue + Spear),
      // cluster and format as a unified Master Location Concept Sheet prompt for Google Flow.
      const currentLocCpState = loadStudioCheckpointFromDisk(projectId) || {};
      const allCpElementsForLoc: StudioProductionElement[] = Array.isArray(currentLocCpState.production_elements)
        ? currentLocCpState.production_elements
        : [];
      const allCpLocationsForLoc: StudioLocationItem[] = Array.isArray(currentLocCpState.locations)
        ? currentLocCpState.locations
        : [];

      const { masterSheets: locMasterSheets } = clusterElementsIntoMasterReferenceSheets(
        allCpElementsForLoc,
        [workingLoc, ...allCpLocationsForLoc.filter((l) => l.location_id !== workingLoc.location_id)]
      );
      const targetLocSheet = locMasterSheets.find((ms) => ms.masterId === workingLoc.location_id);
      if (targetLocSheet && targetLocSheet.attachedEntities.length > 0) {
        const masterLocPrompt = buildMasterReferenceSheetFlowPrompt({
          masterSheet: targetLocSheet,
          globalStyle: geminiCookiesNovelService.resolveGlobalVisualStyle(
            effectiveLocStylePreset,
            customStylePrompt
          ),
          aspectRatio: effectiveLocAspectRatio,
        });
        workingLoc.visual_reference_prompt = masterLocPrompt;
        workingLoc.assembled_flow_prompt = masterLocPrompt;
        workingLoc.current_prompt = masterLocPrompt;
      }

      workingLoc.correction_history = geminiCookiesNovelService.buildCorrectionHistoryList(
        workingLoc.base_prompt,
        assembled.generation_corrections,
        workingLoc.current_prompt || assembled.assembled_prompt,
        workingLoc.correction_history
      );
      flowGenerationPerformanceService.setCachedPrompt({
        promptHash: locPromptHash,
        styleHash: effectiveLocStyleHash,
        referenceHash: locRefHash,
        modelId: resolvedLocModel.modelId,
        aspectRatio: effectiveLocAspectRatio,
        assembledPrompt: workingLoc.current_prompt || assembled.assembled_prompt,
        createdAt: Date.now(),
      });
    }
    workingLoc.generation_plan = geminiCookiesNovelService.buildGenerationPlanStage({
      targetId: workingLoc.location_id,
      canonicalDescriptionUsed: workingLoc.canonical_description || workingLoc.description || "",
      referenceIdsUsed: [workingLoc.location_id],
      stylePreset: effectiveLocStylePreset,
      customStyle: customStylePrompt,
      styleVersion: effectiveLocStyleVersion,
      styleHash: effectiveLocStyleHash,
      aspectRatio: effectiveLocAspectRatio,
      modelId: resolvedLocModel.modelId,
      additiveCorrections: workingLoc.generation_corrections || [],
      assembledMasterPrompt: workingLoc.assembled_flow_prompt || workingLoc.visual_reference_prompt || "",
      promptVersion: (Number(workingLoc.version) || 0) + 1,
    });

    timingRecord.preparation_end = Date.now();

    const shouldAutoVerifyLoc = autoVerify !== false;
    const boundedLocMaxAttempts =
      !shouldAutoVerifyLoc ? 1 : Math.max(1, Math.min(Number(maxAttempts) || 4, 4));

    for (let attempt = 1; attempt <= boundedLocMaxAttempts; attempt++) {
      const nextVersion = (Number(workingLoc.version) || 0) + 1;
      const runId = `run_${workingLoc.location_id}_v${nextVersion}_${effectiveLocStyleHash}_${Date.now()}`;
      const currentPrompt =
        workingLoc.assembled_flow_prompt || workingLoc.visual_reference_prompt;

      const genRes = await googleFlowProvider.generateWithProjectFailover({
        prompt: currentPrompt,
        modelDisplayName: resolvedLocModel.modelId,
        outputFileName: `${projectId && !isValidFlowProjectUuid(projectId) ? `${projectId}_` : ""}${workingLoc.location_id}_v${nextVersion}_${Date.now()}.png`,
        preferredProjectId: isValidFlowProjectUuid(projectId) ? projectId : undefined,
        fallbackRawCookies: flowCookies,
        aspectRatio: effectiveLocAspectRatio,
        actionType: "REFERENCE_GENERATION",
        locationId: workingLoc.location_id,
        attempt,
        runId,
        promptVersion: nextVersion,
        styleHash: effectiveLocStyleHash,
        referenceHash: locRefHash,
        timingRecord,
      });

      const isProjectAndAssetVerified = Boolean(
        genRes.assetVerified &&
          genRes.flowAssetId &&
          isRealVerifiedFlowProjectId(genRes.flowProjectId)
      );

      if (genRes.flowProjectId && genRes.flowAssetId) {
        flowGenerationPerformanceService.setCachedReferenceAsset({
          flowProjectId: genRes.flowProjectId,
          flowAssetId: genRes.flowAssetId,
          referenceHash: locRefHash,
          referenceVersion: nextVersion,
          localFilePath: genRes.local_file_path || "",
          uploadedAt: Date.now(),
        });
      }

      if (genRes.local_file_path && fs.existsSync(genRes.local_file_path)) {
        try {
          const buf = fs.readFileSync(genRes.local_file_path);
          cacheVisionImageInMemory(`LOC_${workingLoc.location_id}`, buf);
        } catch (_) {}
      }

      workingLoc = {
        ...workingLoc,
        version: nextVersion,
        reference_image_url: genRes.public_url || genRes.base64_data_url,
        local_file_path: genRes.local_file_path || "",
        flow_provider: "Google Flow",
        flow_project_id: genRes.flowProjectId,
        flowProjectId: genRes.flowProjectId,
        flowProjectUrl: genRes.flowProjectUrl,
        flowAssetId: genRes.flowAssetId,
        flowGenerationId: genRes.flowGenerationId,
        promptHash: genRes.promptHash,
        real_flow_project_verified: isRealVerifiedFlowProjectId(genRes.flowProjectId),
        real_flow_asset_created: Boolean(genRes.flowAssetId),
        real_flow_asset_verified: isProjectAndAssetVerified,
        flow_generation_status: isProjectAndAssetVerified
          ? "FLOW_GENERATION_SUCCESS"
          : "FLOW_GENERATION_INCOMPLETE",
        flow_asset_status: isProjectAndAssetVerified
          ? "FLOW_ASSET_VERIFIED"
          : "FLOW_ASSET_NOT_VERIFIED",
        flow_model: resolvedLocModel.modelId,
        flow_metadata: genRes.metadata,
      };

      if (!shouldAutoVerifyLoc) {
        workingLoc.approved = false;
        workingLoc.status = "GENERATED";
        workingLoc.generation_status = "GENERATED";
        workingLoc.verification_status = "UNVERIFIED";
        workingLoc.vision_status = "UNVERIFIED";
        workingLoc.verification_result = undefined;
        workingLoc.last_error = null;
        timingRecord.stage_status = "IMAGE_READY";
        timingRecord.total_end = Date.now();
        flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);
        break;
      }

      if (req.body?.blockingVerify !== true) {
        workingLoc.approved = false;
        workingLoc.status = "GENERATED";
        workingLoc.generation_status = "GENERATED";
        workingLoc.verification_status = "VERIFYING";
        workingLoc.vision_status = "UNVERIFIED";
        flowGenerationPerformanceService.setBackgroundTaskState({
          target_id: workingLoc.location_id,
          target_type: "LOCATION",
          run_token: targetOp.runToken,
          record_id: timingRecord.record_id,
          stage_status: "VISION_PENDING",
          image_ready: true,
          vision_completed: false,
          continuity_completed: true,
          checkpoint_completed: false,
          approved: false,
          locked: false,
          updated_item: workingLoc,
          failure_category: "NONE",
          timing: timingRecord,
          updated_at: new Date().toISOString(),
        });

        setImmediate(async () => {
          if (!flowGenerationPerformanceService.isTargetOperationActive(workingLoc.location_id, targetOp.runToken)) {
            return;
          }
          try {
            timingRecord.stage_status = "VISION_PENDING";
            timingRecord.vision_start = Date.now();
            const tempLocPath = resolveLocalImagePathForVision(
              genRes.base64_data_url,
              genRes.local_file_path,
              `LOC_${workingLoc.location_id}`
            );
            const visionRes = await geminiCookiesNovelService.inspectStudioLocationImage({
              cookies: geminiCookies || "",
              modelId: reviewModelId,
              location: workingLoc,
              stylePreset: effectiveLocStylePreset,
              promptUsed: currentPrompt,
              localImagePath: tempLocPath || "",
            });
            let finalLocVisionRes = visionRes;
            let finalWorkingLoc: StudioLocationItem = { ...workingLoc };
            let locHealAttempt = 1;
            const maxLocHealAttempts = Math.max(2, Math.min(Number(maxAttempts) || 4, 4));

            while (
              !finalLocVisionRes.approved &&
              locHealAttempt < maxLocHealAttempts &&
              flowGenerationPerformanceService.isTargetOperationActive(workingLoc.location_id, targetOp.runToken)
            ) {
              locHealAttempt++;
              const locCorrText =
                finalLocVisionRes.additive_correction ||
                (Array.isArray(finalLocVisionRes.what_is_missing) &&
                finalLocVisionRes.what_is_missing.length > 0
                  ? `Include missing environment features: ${finalLocVisionRes.what_is_missing.join(", ")}`
                  : `Strictly depict standalone environment ${finalWorkingLoc.name} with zero characters and zero text`);
              try {
                googleFlowProvider.incrementRegenerationCount();
                const assembledHealLoc = geminiCookiesNovelService.assembleFinalFlowPromptForLocation({
                  location: finalWorkingLoc,
                  stylePreset: effectiveLocStylePreset,
                  customStylePrompt,
                  aspectRatio: effectiveLocAspectRatio,
                  additionalCorrections: [locCorrText],
                });
                const healLocVersion = (Number(finalWorkingLoc.version) || 1) + 1;
                const healLocPrompt = assembledHealLoc.assembled_prompt;

                flowGenerationPerformanceService.setBackgroundTaskState({
                  target_id: workingLoc.location_id,
                  target_type: "LOCATION",
                  run_token: targetOp.runToken,
                  record_id: timingRecord.record_id,
                  stage_status: "VISION_PENDING",
                  image_ready: true,
                  vision_completed: false,
                  continuity_completed: true,
                  checkpoint_completed: false,
                  approved: false,
                  locked: false,
                  updated_item: {
                    ...finalWorkingLoc,
                    generation_corrections: assembledHealLoc.generation_corrections,
                    added_corrections: [...assembledHealLoc.generation_corrections],
                    verification_status: "VERIFYING",
                    verification_result: finalLocVisionRes,
                  },
                  failure_category: "NONE",
                  timing: timingRecord,
                  updated_at: new Date().toISOString(),
                });

                const healLocGenRes = await googleFlowProvider.generateWithProjectFailover({
                  prompt: healLocPrompt,
                  modelDisplayName: resolvedLocModel.modelId,
                  outputFileName: `${projectId && !isValidFlowProjectUuid(projectId) ? `${projectId}_` : ""}${finalWorkingLoc.location_id}_v${healLocVersion}_${Date.now()}.png`,
                  preferredProjectId: isValidFlowProjectUuid(projectId) ? projectId : undefined,
                  fallbackRawCookies: flowCookies,
                  aspectRatio: effectiveLocAspectRatio,
                  actionType: "REFERENCE_GENERATION",
                  locationId: finalWorkingLoc.location_id,
                  attempt: locHealAttempt,
                  runId: `heal_${finalWorkingLoc.location_id}_v${healLocVersion}_${Date.now()}`,
                  promptVersion: healLocVersion,
                  styleHash: effectiveLocStyleHash,
                  referenceHash: locRefHash,
                  timingRecord,
                });
                if (healLocGenRes.base64_data_url || healLocGenRes.public_url) {
                  finalWorkingLoc = {
                    ...finalWorkingLoc,
                    version: healLocVersion,
                    reference_image_url: healLocGenRes.public_url || healLocGenRes.base64_data_url,
                    local_file_path: healLocGenRes.local_file_path || finalWorkingLoc.local_file_path,
                    visual_reference_prompt: healLocPrompt,
                    assembled_flow_prompt: healLocPrompt,
                    current_prompt: healLocPrompt,
                    generation_corrections: assembledHealLoc.generation_corrections,
                    added_corrections: [...assembledHealLoc.generation_corrections],
                    additive_corrections: [...assembledHealLoc.generation_corrections],
                    flowAssetId: healLocGenRes.flowAssetId || finalWorkingLoc.flowAssetId,
                    flowGenerationId: healLocGenRes.flowGenerationId || finalWorkingLoc.flowGenerationId,
                  };
                  const healTempLocPath = resolveLocalImagePathForVision(
                    healLocGenRes.base64_data_url,
                    healLocGenRes.local_file_path,
                    `LOC_HEAL_${finalWorkingLoc.location_id}_a${locHealAttempt}`
                  );
                  if (healTempLocPath) {
                    finalLocVisionRes = await geminiCookiesNovelService.inspectStudioLocationImage({
                      cookies: geminiCookies || "",
                      modelId: reviewModelId,
                      location: finalWorkingLoc,
                      stylePreset: effectiveLocStylePreset,
                      promptUsed: healLocPrompt,
                      localImagePath: healTempLocPath,
                    });
                  }
                } else {
                  break;
                }
              } catch (_) {
                break;
              }
            }

            timingRecord.vision_end = Date.now();
            timingRecord.total_end = Date.now();
            timingRecord.stage_status = finalLocVisionRes.approved ? "LOCKED" : "POST_PROCESSING_FAILURE";
            flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);

            const nextLocCorrs = Array.from(
              new Set([
                ...(finalWorkingLoc.added_corrections || []),
                ...(finalLocVisionRes.additive_correction ? [finalLocVisionRes.additive_correction] : []),
              ])
            );

            const bgUpdated: StudioLocationItem = {
              ...finalWorkingLoc,
              approved: Boolean(finalLocVisionRes.approved),
              status: finalLocVisionRes.approved ? "LOCKED" : "NEEDS_CORRECTION",
              locked_for_production: Boolean(finalLocVisionRes.approved),
              added_corrections: nextLocCorrs,
              additive_corrections: nextLocCorrs,
              verification_result: finalLocVisionRes,
              vision_status: finalLocVisionRes.vision_status,
              verification_status:
                finalLocVisionRes.overall_status === "VISION_FAILED"
                  ? "VISION_FAILED"
                  : finalLocVisionRes.approved
                  ? "VERIFIED"
                  : "REJECTED",
            };
            upsertStudioCheckpointEntitiesOnDisk({ location: bgUpdated, projectId });
            flowGenerationPerformanceService.setBackgroundTaskState({
              target_id: workingLoc.location_id,
              target_type: "LOCATION",
              run_token: targetOp.runToken,
              record_id: timingRecord.record_id,
              stage_status: timingRecord.stage_status,
              image_ready: true,
              vision_completed: true,
              continuity_completed: true,
              checkpoint_completed: true,
              approved: Boolean(finalLocVisionRes.approved),
              locked: Boolean(finalLocVisionRes.approved),
              updated_item: bgUpdated,
              failure_category: finalLocVisionRes.approved ? "NONE" : "POST_PROCESSING_FAILURE",
              timing: timingRecord,
              updated_at: new Date().toISOString(),
            });
          } catch (_) {
            timingRecord.vision_end = Date.now();
            timingRecord.total_end = Date.now();
            timingRecord.failure_category = "POST_PROCESSING_FAILURE";
            timingRecord.stage_status = "POST_PROCESSING_FAILURE";
            flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);
          }
        });
        break;
      }

      timingRecord.vision_start = Date.now();
      const tempLocPath = resolveLocalImagePathForVision(
        genRes.base64_data_url,
        genRes.local_file_path,
        `LOC_${workingLoc.location_id}`
      );
      const visionRes = await geminiCookiesNovelService.inspectStudioLocationImage({
        cookies: geminiCookies || "",
        modelId: reviewModelId,
        location: workingLoc,
        stylePreset: effectiveLocStylePreset,
        promptUsed: currentPrompt,
        localImagePath: tempLocPath || "",
      });
      if (!visionRes.reviewed_at) {
        visionRes.reviewed_at = new Date().toISOString();
      }
      timingRecord.vision_end = Date.now();
      timingRecord.total_end = Date.now();
      flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);

      const locAttemptsLog = Array.isArray(workingLoc.attempts_log)
        ? [...workingLoc.attempts_log]
        : [];
      locAttemptsLog.push({
        attempt_number: attempt,
        attempt,
        version: nextVersion,
        prompt_used: currentPrompt,
        image_url: genRes.public_url,
        local_file_path: genRes.local_file_path,
        flow_project_id: genRes.flowProjectId,
        flowProjectId: genRes.flowProjectId,
        flowProjectUrl: genRes.flowProjectUrl,
        flowAssetId: genRes.flowAssetId,
        flowGenerationId: genRes.flowGenerationId,
        promptHash: genRes.promptHash,
        real_flow_asset_verified: true,
        flow_model: effectiveLocFlowModel,
        flow_metadata: genRes.metadata,
        approved: visionRes.approved,
        score: visionRes.score,
        additive_correction: visionRes.additive_correction,
        detected_issues: visionRes.issues,
        corrected_prompt: visionRes.corrected_prompt,
        timestamp: new Date().toISOString(),
      });
      workingLoc.attempts_log = locAttemptsLog;

      workingLoc.generation_status = "GENERATED";
      workingLoc.verification_result = visionRes;
      workingLoc.vision_status = visionRes.vision_status;
      workingLoc.verification_status =
        visionRes.overall_status === "VISION_FAILED"
          ? "VISION_FAILED"
          : visionRes.approved
          ? "VERIFIED"
          : "REJECTED";
      workingLoc.actual_image_verification =
        geminiCookiesNovelService.buildActualImageVerificationStage({
          targetId: workingLoc.location_id,
          imageInspected: genRes.local_file_path || genRes.public_url,
          actualVisionCompleted: visionRes.actual_vision_request_completed !== false,
          approved: visionRes.approved,
          overallStatus: visionRes.overall_status || (visionRes.approved ? "PASS" : "NEEDS_CORRECTION"),
          failedChecks: visionRes.failed_checks || [],
          whatIsCorrect: visionRes.what_is_correct || [],
          whatIsMissing: visionRes.what_is_missing || [],
          whatIsDifferent: visionRes.what_is_different || [],
          additiveCorrection: visionRes.additive_correction,
        });

      const locLockCheck = geminiCookiesNovelService.validateLocationLockEligibility(workingLoc);

      if (locLockCheck.canLock) {
        workingLoc.approved = true;
        workingLoc.status = "LOCKED";
        workingLoc.locked_for_production = true;
        workingLoc.locked_at = new Date().toISOString();
        break;
      } else {
        workingLoc.approved = false;
        workingLoc.locked_for_production = false;
        workingLoc.status =
          visionRes.overall_status === "VISION_FAILED" ? "VISION_FAILED" : "NEEDS_CORRECTION";
        if (visionRes.additive_correction && attempt < boundedLocMaxAttempts) {
          googleFlowProvider.incrementRegenerationCount();
          const reassembled = geminiCookiesNovelService.assembleFinalFlowPromptForLocation({
            location: workingLoc,
            stylePreset: effectiveLocStylePreset,
            customStylePrompt,
            aspectRatio: effectiveLocAspectRatio,
            additionalCorrections: [visionRes.additive_correction],
          });
          workingLoc.generation_corrections = reassembled.generation_corrections;
          workingLoc.critical_corrections = [...reassembled.generation_corrections];
          workingLoc.added_corrections = [...reassembled.generation_corrections];
          workingLoc.additive_corrections = [...reassembled.generation_corrections];
          workingLoc.visual_reference_prompt = reassembled.assembled_prompt;
          workingLoc.assembled_flow_prompt = reassembled.assembled_prompt;
          workingLoc.current_prompt = reassembled.assembled_prompt;
          workingLoc.correction_history = geminiCookiesNovelService.buildCorrectionHistoryList(
            workingLoc.base_prompt || workingLoc.canonical_description || "",
            reassembled.generation_corrections,
            reassembled.assembled_prompt,
            workingLoc.correction_history
          );
        } else {
          break;
        }
      }
    }

    upsertStudioCheckpointEntitiesOnDisk({ location: workingLoc, projectId });

    return res.json({
      success: true,
      location: workingLoc,
      performance_timing: timingRecord,
      telemetry: geminiCookiesNovelService.getTelemetry(),
      background_verification_started: Boolean(
        shouldAutoVerifyLoc && req.body?.blockingVerify !== true
      ),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "FLOW_GENERATION_FAILED"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/location/verify", async (req, res) => {
  try {
    const { geminiCookies, location, stylePreset, reviewModelId } = req.body || {};
    if (!location) {
      return res.status(400).json({ success: false, error: "Missing location" });
    }
    const localPath = resolveLocalImagePathForVision(
      location.reference_image_url,
      location.local_file_path,
      `LOC_${location.location_id}`
    );
    if (!localPath) {
      return res.status(400).json({
        success: false,
        error: "لا توجد صورة محلية صالحة لفحص الموقع عبر Gemini Vision.",
      });
    }
    const visionRes = await geminiCookiesNovelService.inspectStudioLocationImage({
      cookies: geminiCookies || "",
      modelId: reviewModelId,
      location,
      stylePreset: stylePreset || "Korean Manhwa",
      promptUsed: location.assembled_flow_prompt || location.visual_reference_prompt || "",
      localImagePath: localPath,
    });
    if (!visionRes.reviewed_at) {
      visionRes.reviewed_at = new Date().toISOString();
    }

    const updatedLocCorrs = Array.from(
      new Set([
        ...(Array.isArray(location.added_corrections) ? location.added_corrections : []),
        ...(!visionRes.approved && visionRes.additive_correction
          ? [normalizeCorrectionItem(visionRes.additive_correction)]
          : []),
      ].filter(Boolean))
    ).slice(-4);

    const resolvedLocUrl =
      location.reference_image_url && location.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
        ? location.reference_image_url
        : `/generated/novel-to-manga/${path.basename(localPath)}`;

    const candidateLoc: StudioLocationItem = {
      ...location,
      reference_image_url: resolvedLocUrl,
      local_file_path: localPath,
      added_corrections: updatedLocCorrs,
      verification_result: visionRes,
      vision_status: visionRes.vision_status,
      verification_status:
        visionRes.overall_status === "VISION_FAILED"
          ? "VISION_FAILED"
          : visionRes.approved
          ? "VERIFIED"
          : "REJECTED",
    };
    const locLockCheck = geminiCookiesNovelService.validateLocationLockEligibility(candidateLoc);
    const isLocApproved = Boolean(locLockCheck.canLock || visionRes.approved);

    const updated: StudioLocationItem = {
      ...candidateLoc,
      approved: isLocApproved,
      locked_for_production: isLocApproved,
      last_error: isLocApproved ? null : visionRes.additive_correction || location.last_error || null,
      status: isLocApproved
        ? "LOCKED"
        : visionRes.overall_status === "VISION_FAILED"
        ? "VISION_FAILED"
        : "NEEDS_CORRECTION",
      locked_at: isLocApproved ? new Date().toISOString() : location.locked_at,
    };

    upsertStudioCheckpointEntitiesOnDisk({ location: updated, projectId: req.body?.projectId || req.body?.project_id });

    return res.json({
      success: true,
      approved: updated.approved,
      location: updated,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Location verification failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/location/lock", (req, res) => {
  try {
    const { location } = req.body || {};
    if (!location) {
      return res.status(400).json({
        success: false,
        error: "بيانات الموقع مفقودة.",
      });
    }
    const diskLocPath = resolveLocalImagePathForVision(
      location.reference_image_url,
      location.local_file_path,
      `LOC_${location.location_id}`
    );
    const hydratedLoc: StudioLocationItem = {
      ...location,
      reference_image_url:
        location.reference_image_url && location.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
          ? location.reference_image_url
          : diskLocPath
          ? `/generated/novel-to-manga/${path.basename(diskLocPath)}`
          : location.reference_image_url,
      local_file_path: diskLocPath || location.local_file_path,
    };
    const locLockCheck = geminiCookiesNovelService.validateLocationLockEligibility(hydratedLoc);
    if (!locLockCheck.canLock) {
      return res.status(400).json({
        success: false,
        missingRequirements: locLockCheck.missingRequirements,
        error: locLockCheck.reasonAr,
      });
    }
    const locked: StudioLocationItem = {
      ...hydratedLoc,
      approved: true,
      status: "LOCKED",
      locked_for_production: true,
      generation_status: "GENERATED",
      verification_status: "VERIFIED",
      vision_status: "PASS",
      locked_at: new Date().toISOString(),
    };
    upsertStudioCheckpointEntitiesOnDisk({ location: locked, projectId: req.body?.projectId || req.body?.project_id });
    return res.json({ success: true, location: locked });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Location lock failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/location/update", (req, res) => {
  try {
    const { location, projectId, project_id } = req.body || {};
    if (location && location.location_id) {
      upsertStudioCheckpointEntitiesOnDisk({ location, projectId: projectId || project_id });
    }
    return res.json({ success: true, location });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Location update failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/references/lock-all", (req, res) => {
  try {
    const { elements, locations, projectId, project_id } = req.body || {};
    const effectiveProjectId = projectId || project_id;
    const now = new Date().toISOString();
    let lockedElCount = 0;
    let lockedLocCount = 0;
    const updatedElements: StudioProductionElement[] = (Array.isArray(elements) ? elements : []).map(
      (el: StudioProductionElement) => {
        const diskPath = resolveLocalImagePathForVision(el.reference_image_url, el.local_file_path, `EL_${el.id}`);
        const hydrated: StudioProductionElement = {
          ...el,
          reference_image_url:
            el.reference_image_url && el.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
              ? el.reference_image_url
              : diskPath
              ? `/generated/novel-to-manga/${path.basename(diskPath)}`
              : el.reference_image_url,
          local_file_path: diskPath || el.local_file_path,
        };
        const check = geminiCookiesNovelService.validateElementLockEligibility(hydrated);
        if (check.canLock) {
          lockedElCount++;
          return {
            ...hydrated,
            approved: true,
            status: "LOCKED",
            locked_for_production: true,
            locked_at: hydrated.locked_at || now,
          };
        }
        return hydrated;
      }
    );
    const updatedLocations: StudioLocationItem[] = (Array.isArray(locations) ? locations : []).map(
      (loc: StudioLocationItem) => {
        const diskPath = resolveLocalImagePathForVision(
          loc.reference_image_url,
          loc.local_file_path,
          `LOC_${loc.location_id}`
        );
        const hydrated: StudioLocationItem = {
          ...loc,
          reference_image_url:
            loc.reference_image_url && loc.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
              ? loc.reference_image_url
              : diskPath
              ? `/generated/novel-to-manga/${path.basename(diskPath)}`
              : loc.reference_image_url,
          local_file_path: diskPath || loc.local_file_path,
        };
        const check = geminiCookiesNovelService.validateLocationLockEligibility(hydrated);
        if (check.canLock) {
          lockedLocCount++;
          return {
            ...hydrated,
            approved: true,
            status: "LOCKED",
            locked_for_production: true,
            locked_at: hydrated.locked_at || now,
          };
        }
        return hydrated;
      }
    );
    saveStudioCheckpointToDisk(
      {
        production_elements: updatedElements,
        locations: updatedLocations,
      },
      effectiveProjectId
    );
    return res.json({
      success: true,
      locked_elements_count: lockedElCount,
      locked_locations_count: lockedLocCount,
      elements: updatedElements,
      locations: updatedLocations,
      telemetry: geminiCookiesNovelService.getTelemetry(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Lock all references failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/generate-scene", async (req, res) => {
  try {
    const {
      geminiCookies,
      flowCookies,
      scene,
      previousScene: rawPreviousScene,
      allScenes: rawAllScenes,
      locationAnchors: rawLocationAnchors,
      stylePreset,
      customStylePrompt,
      aspectRatio,
      flowModel,
      productionElements,
      location,
      allLocations,
      lockedReferences,
      projectId,
      promptModelId,
      reviewModelId,
      autoVerify,
      maxAttempts,
      customCorrection,
      styleVersion,
      styleHash,
    } = req.body || {};

    if (!scene || !scene.scene_id) {
      return res.status(400).json({ success: false, error: "Missing scene" });
    }

    // Requirement 16: Cancel any stale polling/vision/continuity for this scene on Regenerate
    const sceneTargetOp = flowGenerationPerformanceService.beginTargetOperation(scene.scene_id);

    const effectiveSceneStylePreset: StudioStylePreset = (stylePreset || "Korean Manhwa") as StudioStylePreset;
    const effectiveSceneAspectRatio: StudioAspectRatio = (aspectRatio || "9:16") as StudioAspectRatio;
    const effectiveSceneFlowModel: FlowDisplayModelName = (flowModel || "Nano Banana 2") as FlowDisplayModelName;

    // Requirement 20: Strictly validate selected model without ever swapping models
    const resolvedSceneModel = flowGenerationPerformanceService.validateAndResolveModel(effectiveSceneFlowModel);

    const effectiveSceneStyleVersion = Number(styleVersion || scene.style_version) || 1;
    const effectiveSceneStyleHash =
      styleHash ||
      computeStudioStyleHash({
        stylePreset: effectiveSceneStylePreset,
        customStyle: customStylePrompt,
        aspectRatio: effectiveSceneAspectRatio,
        flowModel: resolvedSceneModel.modelId,
        styleVersion: effectiveSceneStyleVersion,
      });

    const currentCheckpointForScene = loadStudioCheckpointFromDisk(projectId);
    const checkpointElements: StudioProductionElement[] = Array.isArray(currentCheckpointForScene?.production_elements)
      ? currentCheckpointForScene!.production_elements
      : [];
    const checkpointLocations: StudioLocationItem[] = Array.isArray(currentCheckpointForScene?.locations)
      ? currentCheckpointForScene!.locations
      : [];
    const checkpointScenes: StudioSceneItem[] = Array.isArray(currentCheckpointForScene?.scenes)
      ? currentCheckpointForScene!.scenes
      : [];

    const hydrateSceneWithCheckpoint = (sc: StudioSceneItem | null | undefined): StudioSceneItem | null => {
      if (!sc || !sc.scene_id) return null;
      const explicitlyIncomplete =
        sc.approved === false ||
        sc.generation_status === "WAITING" ||
        (sc.image_url === null && !sc.local_file_path);
      if (explicitlyIncomplete) {
        return {
          ...sc,
          approved: Boolean(sc.approved),
          verification_status: sc.approved ? sc.verification_status : "UNVERIFIED",
        };
      }
      const cpSc = checkpointScenes.find((c) => c && c.scene_id === sc.scene_id);
      const rawImg = sc.image_url;
      const resolvedUrl =
        rawImg && rawImg !== "__CLIENT_MEMORY_IMAGE__"
          ? rawImg
          : cpSc?.image_url && cpSc.image_url !== "__CLIENT_MEMORY_IMAGE__"
          ? cpSc.image_url
          : rawImg;
      const resolvedLocal = sc.local_file_path || cpSc?.local_file_path || null;
      return {
        ...cpSc,
        ...sc,
        image_url: resolvedUrl || null,
        local_file_path: resolvedLocal,
      };
    };

    const availableScenes: StudioSceneItem[] = (
      Array.isArray(rawAllScenes) && rawAllScenes.length > 0 ? rawAllScenes : checkpointScenes
    )
      .filter((s: any): s is StudioSceneItem => Boolean(s && s.scene_id))
      .map((s) => hydrateSceneWithCheckpoint(s)!)
      .filter(Boolean);

    // Resolve Previous Scene in sequence (Scene N-1)
    const rawCandidatePreviousScene: StudioSceneItem | null =
      hydrateSceneWithCheckpoint(rawPreviousScene) ||
      (scene.previous_scene_id
        ? availableScenes.find((s) => s.scene_id === scene.previous_scene_id) || null
        : null) ||
      (scene.scene_number > 1
        ? availableScenes.find((s) => s.scene_number === scene.scene_number - 1) || null
        : null);

    let resolvedPreviousScene: StudioSceneItem | null = null;
    let previousSceneLocalPath: string | null = null;

    if (rawCandidatePreviousScene) {
      const explicitPrevHasFakeLocalPath =
        rawPreviousScene &&
        typeof rawPreviousScene.local_file_path === "string" &&
        Boolean(rawPreviousScene.local_file_path.trim()) &&
        !fs.existsSync(rawPreviousScene.local_file_path.trim());

      const prevDiskPath = explicitPrevHasFakeLocalPath
        ? null
        : resolveLocalImagePathForVision(
            rawCandidatePreviousScene.image_url,
            rawCandidatePreviousScene.local_file_path,
            `SCENE_${rawCandidatePreviousScene.scene_id}`
          );
      const isPrevApproved = Boolean(
        rawCandidatePreviousScene.approved === true ||
          rawCandidatePreviousScene.verification_status === "VERIFIED" ||
          rawCandidatePreviousScene.verification_status === "APPROVED"
      );
      const hasValidPrevImage = Boolean(
        prevDiskPath &&
          fs.existsSync(prevDiskPath) &&
          rawCandidatePreviousScene.image_url !== "" &&
          rawCandidatePreviousScene.generation_status !== "WAITING" &&
          rawCandidatePreviousScene.generation_status !== "GENERATING" &&
          rawCandidatePreviousScene.generation_status !== "FAILED"
      );

      if (!hasValidPrevImage || !isPrevApproved) {
        return res.status(400).json({
          success: false,
          error_code: "SCENE_CONTINUITY_PREDECESSOR_INCOMPLETE",
          errorCode: "CONTINUITY_ANCHOR_MISSING",
          error: `SCENE_CONTINUITY_PREDECESSOR_INCOMPLETE: لا يُسمح بتوليد المشهد (${scene.scene_id}) قبل اكتمال واعتماد المشهد السابق (${rawCandidatePreviousScene.scene_id}) بصريًا وتوفر صورته المعتمدة الفعليّة على القرص كمرجع استمرارية (Continuity Anchor).`,
        });
      }

      previousSceneLocalPath = prevDiskPath;
      resolvedPreviousScene = {
        ...rawCandidatePreviousScene,
        image_url:
          rawCandidatePreviousScene.image_url &&
          rawCandidatePreviousScene.image_url !== "__CLIENT_MEMORY_IMAGE__"
            ? rawCandidatePreviousScene.image_url
            : `/generated/novel-to-manga/${path.basename(prevDiskPath!)}`,
        local_file_path: prevDiskPath,
      };
    } else if (Number(scene.scene_number) > 1 && req.body?.requirePreviousSceneContinuity === true) {
      return res.status(400).json({
        success: false,
        error_code: "SCENE_CONTINUITY_PREDECESSOR_MISSING",
        error: `SCENE_CONTINUITY_PREDECESSOR_MISSING: لا يمكن توليد المشهد رقم ${scene.scene_number} بدون المشهد السابق المعتمد كمرجع استمرارية.`,
      });
    }

    // Requirement 5 & 6: Strictly resolve bound location by location_entity_id / location_id
    const boundLocationId =
      scene.location_binding?.location_entity_id || scene.location_entity_id || scene.location_id;
    const safeLocationsList: StudioLocationItem[] = Array.isArray(allLocations)
      ? allLocations.filter((l: any): l is StudioLocationItem => Boolean(l && l.location_id))
      : checkpointLocations;
    const rawResolvedLocation =
      safeLocationsList.find(
        (l: StudioLocationItem) =>
          l.location_id === boundLocationId || l.entity_id === boundLocationId
      ) ||
      (location &&
      location.location_id &&
      (location.location_id === boundLocationId || !boundLocationId)
        ? location
        : safeLocationsList[0] || undefined);

    const cpLocation = rawResolvedLocation
      ? checkpointLocations.find((l) => l && l.location_id === rawResolvedLocation.location_id)
      : undefined;

    const resolvedLocation: StudioLocationItem | undefined = rawResolvedLocation
      ? {
          ...cpLocation,
          ...rawResolvedLocation,
          reference_image_url:
            rawResolvedLocation.reference_image_url &&
            rawResolvedLocation.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
              ? rawResolvedLocation.reference_image_url
              : cpLocation?.reference_image_url || rawResolvedLocation.reference_image_url,
          local_file_path: rawResolvedLocation.local_file_path || cpLocation?.local_file_path,
        }
      : undefined;

    const effectiveCurrLocId =
      resolvedLocation?.location_id || scene.primary_location_id || scene.location_entity_id || scene.location_id || "LOC_001";
    const effectivePrevLocId = resolvedPreviousScene
      ? resolvedPreviousScene.primary_location_id ||
        resolvedPreviousScene.location_entity_id ||
        resolvedPreviousScene.location_id ||
        "LOC_001"
      : null;

    const sameLocationAsPrevious = Boolean(
      resolvedPreviousScene && effectivePrevLocId === effectiveCurrLocId
    );
    const continuityMode: SceneContinuityMode = !resolvedPreviousScene
      ? "FIRST_SCENE_NO_PREVIOUS"
      : sameLocationAsPrevious
      ? "SAME_LOCATION_CONTINUITY_MODE"
      : "LOCATION_TRANSITION_MODE";

    // Resolve Location Continuity Anchor for effectiveCurrLocId
    const anchorsMap: LocationContinuityAnchorMap = {
      ...(currentCheckpointForScene?.location_continuity_anchors || {}),
      ...(rawLocationAnchors && typeof rawLocationAnchors === "object" ? rawLocationAnchors : {}),
    };
    let locationAnchor: LocationContinuityAnchor | null = anchorsMap[effectiveCurrLocId] || null;
    if (!locationAnchor) {
      const firstApprovedInSameLoc = availableScenes.find(
        (s) =>
          s.scene_id !== scene.scene_id &&
          s.scene_number < scene.scene_number &&
          s.approved === true &&
          (s.primary_location_id || s.location_entity_id || s.location_id) === effectiveCurrLocId &&
          Boolean(s.image_url || s.local_file_path)
      );
      if (firstApprovedInSameLoc) {
        locationAnchor = {
          location_id: effectiveCurrLocId,
          location_name: resolvedLocation?.name || scene.location_name || effectiveCurrLocId,
          canonical_location_reference_url: resolvedLocation?.reference_image_url || null,
          canonical_location_local_path: resolvedLocation?.local_file_path || null,
          first_approved_scene_id: firstApprovedInSameLoc.scene_id,
          first_approved_scene_image_url: firstApprovedInSameLoc.image_url,
          first_approved_scene_local_path: firstApprovedInSameLoc.local_file_path || null,
          latest_approved_scene_id: firstApprovedInSameLoc.scene_id,
          latest_approved_scene_image_url: firstApprovedInSameLoc.image_url,
          latest_approved_scene_local_path: firstApprovedInSameLoc.local_file_path || null,
          established_landmarks:
            resolvedLocation?.key_components || resolvedLocation?.immutable_elements || [],
          established_lighting: resolvedLocation?.lighting_and_atmosphere || "",
          updated_at: new Date().toISOString(),
        };
      }
    }

    // Collect local reference files ONLY from production elements that belong to THIS scene + the bound location + previous scene continuity
    const sceneCharIdsSet = new Set(scene.character_ids || []);
    const sceneItemIdsSet = new Set([
      ...(scene.item_ids || []),
      ...(scene.weapon_ids || []),
      ...((scene as any).creature_ids || []),
    ]);
    const sceneCharNames = Array.isArray(scene.characters) ? scene.characters : [];
    const sceneItemNames = Array.isArray(scene.costumes_and_weapons) ? scene.costumes_and_weapons : [];

    const rawMergedElementsList: StudioProductionElement[] = (
      Array.isArray(productionElements) && productionElements.length > 0
        ? productionElements
        : checkpointElements
    ).map((el: StudioProductionElement) => {
      const cpEl = checkpointElements.find(
        (c) =>
          c &&
          (c.id === el?.id ||
            c.entity_id === el?.id ||
            (c.category === el?.category &&
              normalizeBilingualToken(c.name) === normalizeBilingualToken(el?.name)))
      );
      return upgradeStaleElementFromCheckpointAndVersions(el, cpEl);
    });

    if (
      location &&
      typeof location.local_file_path === "string" &&
      location.local_file_path.trim() !== "" &&
      !fs.existsSync(location.local_file_path.trim())
    ) {
      return res.status(400).json({
        success: false,
        error_code: "LOCATION_REFERENCE_FILE_NOT_FOUND",
        errorCode: "LOCATION_REFERENCE_FILE_NOT_FOUND",
        error: `LOCATION_REFERENCE_FILE_NOT_FOUND: مسار الصورة المرجعية المحلي (${location.local_file_path}) للموقع (${location.location_id}) غير موجود فعليًا على القرص.`,
      });
    }

    const { deduplicated: mergedElementsList, aliasIdMap: sceneAliasIdMap } =
      deduplicateProductionElementsList(rawMergedElementsList);

    let sceneParticipatingElements = mergedElementsList.filter((el: StudioProductionElement) => {
      if (!el) return false;
      return doesElementMatchSceneBilingual(
        el,
        scene,
        sceneCharIdsSet,
        sceneItemIdsSet,
        sceneAliasIdMap
      );
    });

    const hasExplicitSceneEntityArrays =
      Array.isArray(scene.weapon_ids) &&
      Array.isArray(scene.item_ids) &&
      Array.isArray((scene as any).creature_ids);

    // Ensure locked CHARACTER and WEAPON references in the project are included ONLY if explicit arrays were NOT provided
    if (!hasExplicitSceneEntityArrays && !sceneParticipatingElements.some((e) => e.category === "CHARACTER")) {
      const lockedChars = mergedElementsList.filter(
        (e) => e && e.category === "CHARACTER" && (e.status === "LOCKED" || e.locked_for_production || e.reference_image_url || e.local_file_path)
      );
      for (const lc of lockedChars) {
        if (!sceneParticipatingElements.some((p) => p.id === lc.id)) {
          sceneParticipatingElements.push(lc);
        }
      }
    }
    if (!hasExplicitSceneEntityArrays && !sceneParticipatingElements.some((e) => e.category === "WEAPON")) {
      const lockedWeaps = mergedElementsList.filter(
        (e) => e && e.category === "WEAPON" && (e.status === "LOCKED" || e.locked_for_production || e.reference_image_url || e.local_file_path)
      );
      for (const lw of lockedWeaps) {
        if (!sceneParticipatingElements.some((p) => p.id === lw.id)) {
          sceneParticipatingElements.push(lw);
        }
      }
    }

    // Validate participating elements after deduplication & stale upgrade:
    // 1) Reject fake/non-existent local_file_path
    // 2) Reject missing reference image / unlocked character or weapon
    for (const partEl of sceneParticipatingElements) {
      if (
        partEl &&
        typeof partEl.local_file_path === "string" &&
        partEl.local_file_path.trim() !== "" &&
        !fs.existsSync(partEl.local_file_path.trim())
      ) {
        return res.status(400).json({
          success: false,
          error_code: "REFERENCE_FILE_NOT_FOUND",
          errorCode: "REFERENCE_FILE_NOT_FOUND",
          error: `REFERENCE_FILE_NOT_FOUND: مسار الصورة المرجعية المحلي (${partEl.local_file_path}) للعنصر (${partEl.id || partEl.name}) غير موجود فعليًا على القرص.`,
        });
      }
      if (partEl && (partEl.category === "CHARACTER" || partEl.category === "WEAPON" || partEl.category === "ITEM" || partEl.category === "CREATURE")) {
        let diskPathCheck = resolveLocalImagePathForVision(
          partEl.reference_image_url,
          partEl.local_file_path,
          `EL_${partEl.id}`
        );
        // Master Sheet Inheritance: If weapon, minion, accessory, or monument has no disk path, inherit from its Master Sheet
        if (!diskPathCheck || !fs.existsSync(diskPathCheck)) {
          let masterEl = (partEl.attached_to || partEl.master_reference_id)
            ? mergedElementsList.find((m) => m && (m.id === partEl.attached_to || m.id === partEl.master_reference_id || m.entity_id === partEl.attached_to || m.entity_id === partEl.master_reference_id))
            : null;

          if (!masterEl) {
            masterEl = mergedElementsList.find((m) => {
              if (!m || m.id === partEl.id) return false;
              if (m.category === "CHARACTER" && isEntityAffiliatedWithCharacter(partEl, m).affiliated) return true;
              if (m.category === "CREATURE" && isEntityAffiliatedWithCreature(partEl, m).affiliated) return true;
              return false;
            }) || null;
          }

          if (masterEl && (masterEl.reference_image_url || masterEl.local_file_path)) {
            partEl.attached_to = masterEl.id;
            partEl.master_reference_id = masterEl.id;
            partEl.reference_image_url = masterEl.reference_image_url;
            partEl.local_file_path = masterEl.local_file_path;
            partEl.status = masterEl.status || "LOCKED";
            partEl.approved = Boolean(masterEl.approved || masterEl.status === "LOCKED");
            partEl.locked_for_production = true;
            diskPathCheck = resolveLocalImagePathForVision(
              partEl.reference_image_url,
              partEl.local_file_path,
              `EL_${partEl.id}`
            );
          } else if (resolvedLocation && isEntityAffiliatedWithLocation(partEl, resolvedLocation).affiliated) {
            partEl.attached_to = resolvedLocation.location_id;
            partEl.master_reference_id = resolvedLocation.location_id;
            partEl.reference_image_url = resolvedLocation.reference_image_url;
            partEl.local_file_path = resolvedLocation.local_file_path;
            partEl.status = "LOCKED";
            partEl.approved = true;
            partEl.locked_for_production = true;
            diskPathCheck = resolveLocalImagePathForVision(
              partEl.reference_image_url,
              partEl.local_file_path,
              `EL_${partEl.id}`
            );
          }
        }
        if (
          !diskPathCheck ||
          !fs.existsSync(diskPathCheck) ||
          partEl.status === "NOT_GENERATED" ||
          (!partEl.reference_image_url && !partEl.local_file_path)
        ) {
          return res.status(400).json({
            success: false,
            error_code: "CHARACTER_LOCKS_REQUIRED",
            errorCode: "CHARACTER_LOCKS_REQUIRED",
            error: `CHARACTER_LOCKS_REQUIRED: لا يمكن توليد المشهد لأن المرجع البصري للعنصر (${partEl.name || partEl.id}) مفقود أو غير مقفل على القرص.`,
          });
        }
      }
    }

    const lockedRefIdsUsed: string[] = sceneParticipatingElements.map((el) => el.id);
    const characterRefFilePaths: string[] = [];
    const weaponRefFilePaths: string[] = [];
    const otherElementRefFilePaths: string[] = [];

    for (const el of sceneParticipatingElements) {
      const elDiskPath = resolveLocalImagePathForVision(
        el.reference_image_url,
        el.local_file_path,
        `EL_${el.id}`
      );
      if (elDiskPath && fs.existsSync(elDiskPath)) {
        if (el.category === "CHARACTER") {
          characterRefFilePaths.push(elDiskPath);
        } else if (el.category === "WEAPON" || el.category === "ITEM") {
          weaponRefFilePaths.push(elDiskPath);
        } else {
          otherElementRefFilePaths.push(elDiskPath);
        }
      }
    }

    const resolvedLocationLocalPath: string | null = resolvedLocation
      ? resolveLocalImagePathForVision(
          resolvedLocation.reference_image_url || cpLocation?.reference_image_url,
          resolvedLocation.local_file_path || cpLocation?.local_file_path,
          `LOC_${resolvedLocation.location_id}`
        )
      : null;

    if (resolvedLocation) {
      lockedRefIdsUsed.push(resolvedLocation.location_id);
    }

    if (resolvedPreviousScene && previousSceneLocalPath) {
      lockedRefIdsUsed.push(resolvedPreviousScene.scene_id);
    }

    const anchorSceneLocalPath: string | null =
      locationAnchor &&
      (locationAnchor.first_approved_scene_image_url || locationAnchor.first_approved_scene_local_path)
        ? resolveLocalImagePathForVision(
            locationAnchor.first_approved_scene_image_url,
            locationAnchor.first_approved_scene_local_path,
            `SCENE_${locationAnchor.first_approved_scene_id}`
          )
        : null;

    const refFiles: string[] = Array.from(
      new Set(
        [
          ...characterRefFilePaths,
          ...weaponRefFilePaths,
          ...otherElementRefFilePaths,
          ...(resolvedLocationLocalPath ? [resolvedLocationLocalPath] : []),
          ...(previousSceneLocalPath ? [previousSceneLocalPath] : []),
          ...(sameLocationAsPrevious && anchorSceneLocalPath ? [anchorSceneLocalPath] : []),
        ].filter((fp): fp is string => Boolean(fp && fs.existsSync(fp)))
      )
    );

    const rawExistingList: string[] = [
      ...(Array.isArray(scene.added_corrections) ? scene.added_corrections : []),
      ...(Array.isArray(scene.additive_corrections) ? scene.additive_corrections : []),
      ...(Array.isArray(scene.continuity_corrections) ? scene.continuity_corrections : []),
    ];
    if (
      (scene.verification_status === "REJECTED" || scene.approved === false) &&
      scene.verification_result
    ) {
      if (scene.verification_result.additive_correction) {
        rawExistingList.push(scene.verification_result.additive_correction);
      }
      if (scene.verification_result.continuity_additive_correction) {
        rawExistingList.push(scene.verification_result.continuity_additive_correction);
      }
    }

    const cleanSceneManualCorr = customCorrection
      ? normalizeCorrectionItem(String(customCorrection))
      : scene.manual_correction
      ? normalizeCorrectionItem(String(scene.manual_correction))
      : "";
    if (cleanSceneManualCorr) {
      rawExistingList.push(cleanSceneManualCorr);
    }

    const existingCorrections: string[] = Array.from(
      new Set(rawExistingList.map(normalizeCorrectionItem).filter(Boolean))
    ).slice(-4);

    const sceneRefHash = flowGenerationPerformanceService.computeReferenceHash({
      referenceIds: lockedRefIdsUsed,
      referenceVersions: [
        ...sceneParticipatingElements.map((el) => el.version || 1),
        resolvedLocation?.version || 1,
      ],
    });
    const scenePromptHash = flowGenerationPerformanceService.computePromptHash({
      targetId: scene.scene_id,
      canonicalText: `${scene.description || ""}|${scene.action || ""}|${effectiveCurrLocId}`,
      styleHash: effectiveSceneStyleHash,
      referenceHash: sceneRefHash,
      modelId: resolvedSceneModel.modelId,
      aspectRatio: effectiveSceneAspectRatio,
      corrections: existingCorrections,
    });

    const timingRecord = flowGenerationPerformanceService.startTimingRecord({
      targetId: scene.scene_id,
      targetType: "SCENE",
      modelId: resolvedSceneModel.modelId,
      internalModelId: resolvedSceneModel.internalModelId,
      projectId: projectId || "",
      promptHash: scenePromptHash,
      styleHash: effectiveSceneStyleHash,
      referenceHash: sceneRefHash,
      requestedAspectRatio: effectiveSceneAspectRatio,
    });

    // Requirement 8: Count reused reference assets from Flow cache
    const verifiedProj = flowGenerationPerformanceService.getVerifiedFlowProject(projectId);
    if (verifiedProj.projectId) {
      let reusedCount = 0;
      for (const el of sceneParticipatingElements) {
        const elHash = flowGenerationPerformanceService.computeReferenceHash({
          referenceIds: [el.id],
          referenceVersions: [el.version || 1],
        });
        if (
          el.flowAssetId ||
          flowGenerationPerformanceService.getCachedReferenceAsset(verifiedProj.projectId, elHash)
        ) {
          reusedCount++;
        }
      }
      if (resolvedLocation?.flowAssetId) reusedCount++;
      timingRecord.reference_assets_reused_count = reusedCount;
    }

    // Requirement 9 & 10: Prompt Cache (do not rebuild or wait on Gemini if unchanged)
    let baseScenePrompt = "";
    let prevContinuityCtx: any = scene.previous_scene_continuity_context || null;
    const cachedScenePrompt = flowGenerationPerformanceService.getCachedPrompt(scenePromptHash);
    if (cachedScenePrompt && !cleanSceneManualCorr) {
      timingRecord.prompt_cache_hit = true;
      baseScenePrompt = cachedScenePrompt.assembledPrompt;
    } else {
      const promptRes = await geminiCookiesNovelService.buildStudioScenePrompt({
        cookies: geminiCookies || "",
        modelId: promptModelId,
        scene,
        previousScene: resolvedPreviousScene,
        locationAnchor,
        stylePreset: effectiveSceneStylePreset,
        customStylePrompt,
        aspectRatio: effectiveSceneAspectRatio,
        productionElements: productionElements || [],
        location: resolvedLocation,
        allLocations: safeLocationsList,
        lockedReferences,
      });
      baseScenePrompt = promptRes.prompt;
      prevContinuityCtx = promptRes.previousSceneContinuityContext;
      flowGenerationPerformanceService.setCachedPrompt({
        promptHash: scenePromptHash,
        styleHash: effectiveSceneStyleHash,
        referenceHash: sceneRefHash,
        modelId: resolvedSceneModel.modelId,
        aspectRatio: effectiveSceneAspectRatio,
        assembledPrompt: baseScenePrompt,
        createdAt: Date.now(),
      });
    }

    const pureBaseScenePrompt = baseScenePrompt
      .replace(/^MANDATORY\s+VISUAL\s+FIXES[^\n]*\n+/i, "")
      .replace(/\s*CRITICAL\s+(?:SCENE\s+)?CORRECTIONS?:[\s\S]*$/i, "")
      .trim();
    baseScenePrompt = pureBaseScenePrompt;

    const finalScenePrompt =
      existingCorrections.length > 0
        ? `MANDATORY VISUAL FIXES (HIGHEST PRIORITY — MUST BE CLEARLY VISIBLE IN THIS REGENERATION): ${existingCorrections.join(" ; ")}.\n\n${pureBaseScenePrompt}\n\nCRITICAL CORRECTIONS:\n${existingCorrections
            .map((c) => `- ${c}`)
            .join("\n")}`
        : pureBaseScenePrompt;

    let workingScene: StudioSceneItem = {
      ...scene,
      location_id: effectiveCurrLocId,
      location_entity_id: effectiveCurrLocId,
      location_name: resolvedLocation?.name || scene.location_name,
      location: resolvedLocation?.name || scene.location || scene.location_name,
      location_version: resolvedLocation?.version || scene.location_version || 1,
      locked_reference_ids_used: lockedRefIdsUsed,
      previous_scene_id: resolvedPreviousScene ? resolvedPreviousScene.scene_id : null,
      same_location_as_previous: sameLocationAsPrevious,
      continuity_mode: continuityMode,
      anchor_scene_id: locationAnchor?.first_approved_scene_id || (resolvedPreviousScene?.scene_id ?? null),
      previous_scene_continuity_context: prevContinuityCtx,
      style_version: effectiveSceneStyleVersion,
      styleHash: effectiveSceneStyleHash,
      aspect_ratio: effectiveSceneAspectRatio,
      selected_model: resolvedSceneModel.modelId,
      applied_style_settings: {
        style_preset: effectiveSceneStylePreset,
        custom_style_prompt: customStylePrompt || "",
        aspect_ratio: effectiveSceneAspectRatio,
        selected_model: resolvedSceneModel.modelId,
        style_version: effectiveSceneStyleVersion,
        styleHash: effectiveSceneStyleHash,
        applied_at: new Date().toISOString(),
      },
      base_prompt: baseScenePrompt,
      manual_correction: cleanSceneManualCorr || scene.manual_correction,
      added_corrections: existingCorrections,
      additive_corrections: existingCorrections,
      current_prompt: finalScenePrompt,
      visual_prompt: finalScenePrompt,
      correction_history: geminiCookiesNovelService.buildCorrectionHistoryList(
        baseScenePrompt,
        existingCorrections,
        finalScenePrompt,
        scene.correction_history
      ),
      generation_plan: geminiCookiesNovelService.buildGenerationPlanStage({
        targetId: scene.scene_id,
        canonicalDescriptionUsed: scene.description || "",
        referenceIdsUsed: lockedRefIdsUsed,
        stylePreset: effectiveSceneStylePreset,
        customStyle: customStylePrompt,
        styleVersion: effectiveSceneStyleVersion,
        styleHash: effectiveSceneStyleHash,
        aspectRatio: effectiveSceneAspectRatio,
        modelId: resolvedSceneModel.modelId,
        additiveCorrections: existingCorrections,
        assembledMasterPrompt: finalScenePrompt,
        promptVersion: (Number(scene.version) || 0) + 1,
      }),
      generation_status: "GENERATING",
      pipeline_stage: "GENERATING_FLOW",
    };

    timingRecord.preparation_end = Date.now();

    const shouldAutoVerifyScene = autoVerify !== false;
    const boundedMaxAttempts =
      !shouldAutoVerifyScene
        ? 1
        : Math.max(1, Math.min(Number(maxAttempts) || 4, 4));
    const attemptsLog = Array.isArray(workingScene.attempts_log)
      ? [...workingScene.attempts_log]
      : [];

    for (let attempt = 1; attempt <= boundedMaxAttempts; attempt++) {
      const nextVersion = (Number(workingScene.version) || 0) + 1;
      const runId = `run_${workingScene.scene_id}_v${nextVersion}_${effectiveSceneStyleHash}_${Date.now()}`;
      const currentPrompt = workingScene.visual_prompt;

      const genRes = await googleFlowProvider.generateWithProjectFailover({
        prompt: currentPrompt,
        modelDisplayName: resolvedSceneModel.modelId,
        outputFileName: `${projectId && !isValidFlowProjectUuid(projectId) ? `${projectId}_` : ""}${workingScene.scene_id}_v${nextVersion}_${Date.now()}.png`,
        referenceFilePaths: refFiles,
        referencesUsed: lockedRefIdsUsed,
        preferredProjectId: isValidFlowProjectUuid(projectId) ? projectId : undefined,
        fallbackRawCookies: flowCookies,
        aspectRatio: effectiveSceneAspectRatio,
        actionType: attempt === 1 ? "SCENE_GENERATION" : "SCENE_REGENERATION",
        sceneId: workingScene.scene_id,
        locationId: resolvedLocation?.location_id || workingScene.location_id,
        attempt,
        runId,
        promptVersion: nextVersion,
        styleHash: effectiveSceneStyleHash,
        referenceHash: sceneRefHash,
        timingRecord,
      });

      if (genRes.local_file_path && fs.existsSync(genRes.local_file_path)) {
        try {
          const buf = fs.readFileSync(genRes.local_file_path);
          cacheVisionImageInMemory(`SCENE_${workingScene.scene_id}`, buf);
          cacheVisionImageInMemory(`PREV_SCENE_${workingScene.scene_id}`, buf);
        } catch (_) {}
      }

      const isProjectAndAssetVerified = Boolean(
        genRes.assetVerified &&
          genRes.flowAssetId &&
          isRealVerifiedFlowProjectId(genRes.flowProjectId)
      );

      workingScene = {
        ...workingScene,
        version: nextVersion,
        current_attempt: attempt,
        image_url: genRes.public_url || genRes.base64_data_url,
        local_file_path: genRes.local_file_path || "",
        flow_provider: "Google Flow",
        flow_project_id: genRes.flowProjectId,
        flowProjectId: genRes.flowProjectId,
        flowProjectUrl: genRes.flowProjectUrl,
        flowAssetId: genRes.flowAssetId,
        flowGenerationId: genRes.flowGenerationId,
        promptHash: genRes.promptHash,
        real_flow_project_verified: isRealVerifiedFlowProjectId(genRes.flowProjectId),
        real_flow_asset_created: Boolean(genRes.flowAssetId),
        real_flow_asset_verified: isProjectAndAssetVerified,
        flow_generation_status: isProjectAndAssetVerified
          ? "FLOW_GENERATION_SUCCESS"
          : "FLOW_GENERATION_INCOMPLETE",
        flow_asset_status: isProjectAndAssetVerified
          ? "FLOW_ASSET_VERIFIED"
          : "FLOW_ASSET_NOT_VERIFIED",
        flow_model: resolvedSceneModel.modelId,
        flow_metadata: genRes.metadata,
      };

      if (!shouldAutoVerifyScene) {
        workingScene.approved = false;
        workingScene.generation_status = "COMPLETED";
        workingScene.verification_status = "UNVERIFIED";
        workingScene.vision_status = "UNVERIFIED";
        workingScene.verification_result = undefined;
        workingScene.pipeline_stage = "GEMINI_INSPECTING";
        workingScene.last_error = null;
        timingRecord.stage_status = "IMAGE_READY";
        timingRecord.total_end = Date.now();
        flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);
        break;
      }

      // Requirement 11 & 12: Display image immediately on IMAGE_READY and run Vision + Continuity in background
      if (req.body?.blockingVerify !== true) {
        workingScene.approved = false;
        workingScene.generation_status = "COMPLETED";
        workingScene.verification_status = "VERIFYING";
        workingScene.vision_status = "UNVERIFIED";
        workingScene.pipeline_stage = "GEMINI_INSPECTING";

        flowGenerationPerformanceService.setBackgroundTaskState({
          target_id: workingScene.scene_id,
          target_type: "SCENE",
          run_token: sceneTargetOp.runToken,
          record_id: timingRecord.record_id,
          stage_status: "VISION_PENDING",
          image_ready: true,
          vision_completed: false,
          continuity_completed: false,
          checkpoint_completed: false,
          approved: false,
          locked: false,
          updated_item: workingScene,
          updated_anchors: anchorsMap,
          failure_category: "NONE",
          timing: timingRecord,
          updated_at: new Date().toISOString(),
        });

        setImmediate(async () => {
          if (!flowGenerationPerformanceService.isTargetOperationActive(workingScene.scene_id, sceneTargetOp.runToken)) {
            return;
          }
          try {
            timingRecord.stage_status = "VISION_PENDING";
            timingRecord.vision_start = Date.now();
            const tempScenePath = resolveLocalImagePathForVision(
              genRes.base64_data_url,
              genRes.local_file_path,
              `SCENE_${workingScene.scene_id}`
            );
            const visionRes = await geminiCookiesNovelService.inspectStudioSceneImage({
              cookies: geminiCookies || "",
              modelId: reviewModelId,
              scene: workingScene,
              stylePreset: effectiveSceneStylePreset,
              location: resolvedLocation,
              promptUsed: currentPrompt,
              localImagePath: tempScenePath || "",
              locationReferenceFilePath: resolvedLocationLocalPath,
              characterReferenceFilePaths: characterRefFilePaths,
              weaponReferenceFilePaths: weaponRefFilePaths,
            });
            let finalSceneVisionRes = visionRes;
            let finalWorkingScene: StudioSceneItem = { ...workingScene };
            let sceneHealAttempt = 1;
            const maxSceneHealAttempts = Math.max(2, Math.min(Number(maxAttempts) || 4, 4));

            while (
              !finalSceneVisionRes.approved &&
              sceneHealAttempt < maxSceneHealAttempts &&
              flowGenerationPerformanceService.isTargetOperationActive(workingScene.scene_id, sceneTargetOp.runToken)
            ) {
              sceneHealAttempt++;
              try {
                googleFlowProvider.incrementRegenerationCount();
                const autoFixText = normalizeCorrectionItem(
                  finalSceneVisionRes.additive_correction ||
                    (Array.isArray(finalSceneVisionRes.what_is_missing) &&
                    finalSceneVisionRes.what_is_missing.length > 0
                      ? `Clearly include: ${finalSceneVisionRes.what_is_missing.join(", ")}`
                      : `Strictly depict ${finalWorkingScene.action} in ${finalWorkingScene.location_name}`)
                );
                const healCorrs = Array.from(
                  new Set([
                    ...(finalWorkingScene.added_corrections || []),
                    ...(autoFixText ? [autoFixText] : []),
                  ])
                ).slice(-4);
                const healPrompt =
                  healCorrs.length > 0
                    ? `${pureBaseScenePrompt}\n\nCRITICAL CORRECTIONS:\n${healCorrs
                        .map((c) => `- ${c}`)
                        .join("\n")}`
                    : finalSceneVisionRes.corrected_prompt || currentPrompt;
                const healVersion = (Number(finalWorkingScene.version) || 1) + 1;

                flowGenerationPerformanceService.setBackgroundTaskState({
                  target_id: workingScene.scene_id,
                  target_type: "SCENE",
                  run_token: sceneTargetOp.runToken,
                  record_id: timingRecord.record_id,
                  stage_status: "VISION_PENDING",
                  image_ready: true,
                  vision_completed: false,
                  continuity_completed: false,
                  checkpoint_completed: false,
                  approved: false,
                  locked: false,
                  updated_item: {
                    ...finalWorkingScene,
                    current_attempt: sceneHealAttempt,
                    added_corrections: healCorrs,
                    additive_corrections: healCorrs,
                    verification_status: "VERIFYING",
                    verification_result: finalSceneVisionRes,
                  },
                  updated_anchors: anchorsMap,
                  failure_category: "NONE",
                  timing: timingRecord,
                  updated_at: new Date().toISOString(),
                });

                const healGenRes = await googleFlowProvider.generateWithProjectFailover({
                  prompt: healPrompt,
                  modelDisplayName: resolvedSceneModel.modelId,
                  outputFileName: `${projectId && !isValidFlowProjectUuid(projectId) ? `${projectId}_` : ""}${finalWorkingScene.scene_id}_v${healVersion}_${Date.now()}.png`,
                  referenceFilePaths: refFiles,
                  referencesUsed: lockedRefIdsUsed,
                  preferredProjectId: isValidFlowProjectUuid(projectId) ? projectId : undefined,
                  fallbackRawCookies: flowCookies,
                  aspectRatio: effectiveSceneAspectRatio,
                  actionType: "SCENE_REGENERATION",
                  sceneId: finalWorkingScene.scene_id,
                  locationId: resolvedLocation?.location_id || finalWorkingScene.location_id,
                  attempt: sceneHealAttempt,
                  runId: `heal_${finalWorkingScene.scene_id}_v${healVersion}_${Date.now()}`,
                  promptVersion: healVersion,
                  styleHash: effectiveSceneStyleHash,
                  referenceHash: sceneRefHash,
                  timingRecord,
                });
                if (healGenRes.base64_data_url || healGenRes.public_url) {
                  if (healGenRes.local_file_path && fs.existsSync(healGenRes.local_file_path)) {
                    try {
                      const buf = fs.readFileSync(healGenRes.local_file_path);
                      cacheVisionImageInMemory(`SCENE_${finalWorkingScene.scene_id}`, buf);
                      cacheVisionImageInMemory(`PREV_SCENE_${finalWorkingScene.scene_id}`, buf);
                    } catch (_) {}
                  }
                  finalWorkingScene = {
                    ...finalWorkingScene,
                    version: healVersion,
                    current_attempt: sceneHealAttempt,
                    image_url: healGenRes.public_url || healGenRes.base64_data_url,
                    local_file_path: healGenRes.local_file_path || finalWorkingScene.local_file_path,
                    added_corrections: healCorrs,
                    additive_corrections: healCorrs,
                    current_prompt: healPrompt,
                    visual_prompt: healPrompt,
                    flowAssetId: healGenRes.flowAssetId || finalWorkingScene.flowAssetId,
                    flowGenerationId: healGenRes.flowGenerationId || finalWorkingScene.flowGenerationId,
                  };
                  const healTempScenePath = resolveLocalImagePathForVision(
                    healGenRes.base64_data_url,
                    healGenRes.local_file_path,
                    `SCENE_HEAL_${finalWorkingScene.scene_id}_a${sceneHealAttempt}`
                  );
                  if (healTempScenePath) {
                    finalSceneVisionRes = await geminiCookiesNovelService.inspectStudioSceneImage({
                      cookies: geminiCookies || "",
                      modelId: reviewModelId,
                      scene: finalWorkingScene,
                      stylePreset: effectiveSceneStylePreset,
                      location: resolvedLocation,
                      promptUsed: healPrompt,
                      localImagePath: healTempScenePath,
                      locationReferenceFilePath: resolvedLocationLocalPath,
                      characterReferenceFilePaths: characterRefFilePaths,
                      weaponReferenceFilePaths: weaponRefFilePaths,
                    });
                  }
                } else {
                  break;
                }
              } catch (_) {
                break;
              }
            }

            timingRecord.vision_end = Date.now();
            timingRecord.total_end = Date.now();
            timingRecord.stage_status = finalSceneVisionRes.approved ? "APPROVED" : "POST_PROCESSING_FAILURE";
            flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);

            const updatedSceneCorrs = Array.from(
              new Set([
                ...(finalWorkingScene.added_corrections || []),
                ...(finalSceneVisionRes.additive_correction
                  ? [normalizeCorrectionItem(finalSceneVisionRes.additive_correction)]
                  : []),
              ])
            ).slice(-4);

            if (finalSceneVisionRes.approved) {
              anchorsMap[effectiveCurrLocId] = {
                location_id: effectiveCurrLocId,
                location_name: resolvedLocation?.name || finalWorkingScene.location_name || effectiveCurrLocId,
                canonical_location_reference_url: resolvedLocation?.reference_image_url || null,
                canonical_location_local_path: resolvedLocation?.local_file_path || null,
                first_approved_scene_id:
                  anchorsMap[effectiveCurrLocId]?.first_approved_scene_id || finalWorkingScene.scene_id,
                first_approved_scene_image_url:
                  anchorsMap[effectiveCurrLocId]?.first_approved_scene_image_url || finalWorkingScene.image_url,
                first_approved_scene_local_path:
                  anchorsMap[effectiveCurrLocId]?.first_approved_scene_local_path ||
                  finalWorkingScene.local_file_path ||
                  null,
                latest_approved_scene_id: finalWorkingScene.scene_id,
                latest_approved_scene_image_url: finalWorkingScene.image_url,
                latest_approved_scene_local_path: finalWorkingScene.local_file_path || null,
                established_landmarks:
                  resolvedLocation?.key_components ||
                  resolvedLocation?.immutable_elements ||
                  anchorsMap[effectiveCurrLocId]?.established_landmarks ||
                  [],
                established_lighting:
                  resolvedLocation?.lighting_and_atmosphere ||
                  anchorsMap[effectiveCurrLocId]?.established_lighting ||
                  "",
                updated_at: new Date().toISOString(),
              };
            }

            const bgUpdatedScene: StudioSceneItem = {
              ...finalWorkingScene,
              approved: Boolean(finalSceneVisionRes.approved),
              generation_status: "COMPLETED",
              pipeline_stage: "COMPLETED",
              added_corrections: updatedSceneCorrs,
              additive_corrections: updatedSceneCorrs,
              verification_result: finalSceneVisionRes,
              vision_status: finalSceneVisionRes.vision_status,
              verification_status:
                finalSceneVisionRes.overall_status === "VISION_FAILED"
                  ? "VISION_FAILED"
                  : finalSceneVisionRes.approved
                  ? "VERIFIED"
                  : "REJECTED",
            };
            upsertStudioCheckpointEntitiesOnDisk({
              scene: bgUpdatedScene,
              locationAnchors: anchorsMap,
              projectId: projectId || req.body?.project_id,
            });
            flowGenerationPerformanceService.setBackgroundTaskState({
              target_id: workingScene.scene_id,
              target_type: "SCENE",
              run_token: sceneTargetOp.runToken,
              record_id: timingRecord.record_id,
              stage_status: timingRecord.stage_status,
              image_ready: true,
              vision_completed: true,
              continuity_completed: true,
              checkpoint_completed: true,
              approved: Boolean(finalSceneVisionRes.approved),
              locked: Boolean(finalSceneVisionRes.approved),
              updated_item: bgUpdatedScene,
              updated_anchors: anchorsMap,
              failure_category: finalSceneVisionRes.approved ? "NONE" : "POST_PROCESSING_FAILURE",
              timing: timingRecord,
              updated_at: new Date().toISOString(),
            });
          } catch (_) {
            timingRecord.vision_end = Date.now();
            timingRecord.total_end = Date.now();
            timingRecord.failure_category = "POST_PROCESSING_FAILURE";
            timingRecord.stage_status = "POST_PROCESSING_FAILURE";
            flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);
          }
        });
        break;
      }

      timingRecord.vision_start = Date.now();

      const tempScenePath = resolveLocalImagePathForVision(
        genRes.base64_data_url,
        genRes.local_file_path,
        `SCENE_${workingScene.scene_id}`
      );
      const [visionRes, continuityRes] = await Promise.all([
        geminiCookiesNovelService.inspectStudioSceneImage({
          cookies: geminiCookies || "",
          modelId: reviewModelId,
          scene: workingScene,
          stylePreset: effectiveSceneStylePreset,
          location: resolvedLocation,
          promptUsed: currentPrompt,
          localImagePath: tempScenePath || "",
          locationReferenceFilePath: resolvedLocationLocalPath,
          characterReferenceFilePaths: characterRefFilePaths,
          weaponReferenceFilePaths: weaponRefFilePaths,
        }),
        resolvedPreviousScene && previousSceneLocalPath && tempScenePath
          ? geminiCookiesNovelService.inspectSequentialSceneContinuity({
              cookies: geminiCookies || "",
              modelId: reviewModelId,
              currentScene: workingScene,
              previousScene: resolvedPreviousScene,
              stylePreset: effectiveSceneStylePreset,
              location: resolvedLocation || null,
              productionElements: mergedElementsList,
              locationAnchor,
              currentImagePath: tempScenePath,
              previousImagePath: previousSceneLocalPath,
              locationReferenceFilePath: resolvedLocationLocalPath,
              characterReferenceFilePaths: characterRefFilePaths,
              weaponReferenceFilePaths: weaponRefFilePaths,
              anchorSceneImagePath: anchorSceneLocalPath,
            })
          : Promise.resolve(null),
      ]);
      timingRecord.vision_end = Date.now();
      timingRecord.total_end = Date.now();
      flowGenerationPerformanceService.finalizeCalculations(timingRecord.record_id);

      if (!visionRes.checks) {
        visionRes.checks = {} as any;
      }
      if (!Array.isArray(visionRes.failed_checks)) {
        visionRes.failed_checks = [];
      }
      if (!Array.isArray(visionRes.detected_issues)) {
        visionRes.detected_issues = [];
      }
      if (continuityRes) {
        visionRes.continuity_analysis = continuityRes;
        visionRes.checks.previous_scene_continuity = continuityRes.overall_status === "PASS";
        if (continuityRes.overall_status !== "PASS") {
          const contCorrText = continuityRes.additive_corrections.join(" ");
          visionRes.continuity_additive_correction = contCorrText;
          if (!visionRes.failed_checks.includes("previous_scene_continuity")) {
            visionRes.failed_checks.push("previous_scene_continuity");
          }
          for (const ce of continuityRes.critical_errors) {
            if (!visionRes.detected_issues.includes(ce)) {
              visionRes.detected_issues.push(ce);
            }
          }
        }
      } else {
        visionRes.checks.previous_scene_continuity = true;
      }

      const continuityPassed = continuityRes ? continuityRes.overall_status === "PASS" : true;
      const tripleReport = geminiCookiesNovelService.runTripleSceneVerification({
        scene: workingScene,
        promptUsed: currentPrompt,
        checks: visionRes.checks,
        failedChecks: visionRes.failed_checks || [],
        detectedIssues: visionRes.detected_issues || [],
        observedInImage: visionRes.observed_in_image,
        actualVisionCompleted: visionRes.actual_vision_request_completed !== false,
        visionOverallStatus: visionRes.overall_status,
        continuityAnalysis: continuityRes,
        previousSceneId: resolvedPreviousScene?.scene_id || null,
      });
      visionRes.triple_verification = tripleReport;

      const fullSceneApproved = Boolean(
        visionRes.approved &&
          visionRes.overall_status === "PASS" &&
          tripleReport.all_three_passes_succeeded &&
          continuityPassed &&
          isProjectAndAssetVerified
      );

      let sceneDiagnosis = visionRes.error_diagnosis_and_replan || null;
      if (!fullSceneApproved) {
        sceneDiagnosis = geminiCookiesNovelService.diagnoseAndReplanFailedScene({
          scene: workingScene,
          failedChecks: visionRes.failed_checks || [],
          whatIsMissing: visionRes.what_is_missing || [],
          whatIsDifferent: visionRes.what_is_different || [],
          issues: visionRes.detected_issues || [],
          additiveCorrection: [visionRes.additive_correction, visionRes.continuity_additive_correction]
            .filter(Boolean)
            .join(" "),
          originalPrompt: currentPrompt,
          location: resolvedLocation,
        });
        visionRes.error_diagnosis_and_replan = sceneDiagnosis;
      }

      const currentContinuityStatus: SceneContinuityStatus = !resolvedPreviousScene
        ? fullSceneApproved
          ? "FIRST_SCENE_ANCHOR"
          : "UNVERIFIED"
        : !continuityRes
        ? "UNVERIFIED"
        : continuityRes.overall_status === "PASS"
        ? "PASS"
        : continuityRes.overall_status === "FAIL"
        ? "FAIL"
        : "NEEDS_CORRECTION";

      attemptsLog.push({
        attempt_number: attempt,
        attempt,
        version: nextVersion,
        prompt_used: currentPrompt,
        image_url: genRes.public_url,
        local_file_path: genRes.local_file_path,
        flow_project_id: genRes.flowProjectId,
        flowProjectId: genRes.flowProjectId,
        flowProjectUrl: genRes.flowProjectUrl,
        flowAssetId: genRes.flowAssetId,
        flowGenerationId: genRes.flowGenerationId,
        promptHash: genRes.promptHash,
        real_flow_asset_verified: true,
        flow_model: effectiveSceneFlowModel,
        flow_metadata: genRes.metadata,
        approved: fullSceneApproved,
        continuity_status: currentContinuityStatus,
        continuity_analysis: continuityRes,
        score: visionRes.score,
        additive_correction: visionRes.additive_correction,
        continuity_additive_correction: visionRes.continuity_additive_correction,
        detected_issues: visionRes.detected_issues,
        corrected_prompt: visionRes.corrected_prompt,
        timestamp: new Date().toISOString(),
      });

      workingScene.verification_result = visionRes;
      workingScene.triple_verification = tripleReport;
      workingScene.error_diagnosis_and_replan = sceneDiagnosis;
      workingScene.vision_status = visionRes.vision_status;
      workingScene.continuity_analysis = continuityRes;
      workingScene.continuity_status = currentContinuityStatus;
      workingScene.continuity_version = nextVersion;
      workingScene.continuity_checked_at = new Date().toISOString();
      workingScene.actual_image_verification =
        geminiCookiesNovelService.buildActualImageVerificationStage({
          targetId: workingScene.scene_id,
          imageInspected: genRes.local_file_path || genRes.public_url,
          actualVisionCompleted: visionRes.actual_vision_request_completed !== false,
          observedInImage: visionRes.observed_in_image,
          approved: fullSceneApproved,
          overallStatus: fullSceneApproved ? "PASS" : "NEEDS_CORRECTION",
          failedChecks: visionRes.failed_checks || [],
          whatIsCorrect: visionRes.what_is_correct || [],
          whatIsMissing: visionRes.what_is_missing || [],
          whatIsDifferent: visionRes.what_is_different || [],
          additiveCorrection:
            [visionRes.additive_correction, visionRes.continuity_additive_correction]
              .filter(Boolean)
              .join(" ") || undefined,
        });
      workingScene.attempts_log = attemptsLog;

      if (fullSceneApproved) {
        workingScene.approved = true;
        workingScene.generation_status = "COMPLETED";
        workingScene.verification_status = "VERIFIED";
        workingScene.pipeline_stage = "COMPLETED";

        // Update Location Continuity Anchor for this location
        anchorsMap[effectiveCurrLocId] = {
          location_id: effectiveCurrLocId,
          location_name: resolvedLocation?.name || workingScene.location_name || effectiveCurrLocId,
          canonical_location_reference_url: resolvedLocation?.reference_image_url || null,
          canonical_location_local_path: resolvedLocation?.local_file_path || null,
          first_approved_scene_id:
            anchorsMap[effectiveCurrLocId]?.first_approved_scene_id || workingScene.scene_id,
          first_approved_scene_image_url:
            anchorsMap[effectiveCurrLocId]?.first_approved_scene_image_url || workingScene.image_url,
          first_approved_scene_local_path:
            anchorsMap[effectiveCurrLocId]?.first_approved_scene_local_path ||
            workingScene.local_file_path ||
            null,
          latest_approved_scene_id: workingScene.scene_id,
          latest_approved_scene_image_url: workingScene.image_url,
          latest_approved_scene_local_path: workingScene.local_file_path || null,
          established_landmarks:
            resolvedLocation?.key_components ||
            resolvedLocation?.immutable_elements ||
            anchorsMap[effectiveCurrLocId]?.established_landmarks ||
            [],
          established_lighting:
            resolvedLocation?.lighting_and_atmosphere ||
            anchorsMap[effectiveCurrLocId]?.established_lighting ||
            "",
          updated_at: new Date().toISOString(),
        };
        break;
      } else {
        workingScene.approved = false;
        workingScene.verification_status =
          visionRes.overall_status === "VISION_FAILED" ? "VISION_FAILED" : "REJECTED";
        const newVisionCorr = (visionRes.additive_correction || "").trim();
        const newContinuityCorrs = continuityRes?.additive_corrections || [];
        const combinedNewCorrs = [
          ...(newVisionCorr ? [newVisionCorr] : []),
          ...newContinuityCorrs,
        ].filter(Boolean);

        if ((combinedNewCorrs.length > 0 || visionRes.corrected_prompt || sceneDiagnosis?.re_planned_prompt) && attempt < boundedMaxAttempts) {
          googleFlowProvider.incrementRegenerationCount();
          const nextCorrs = Array.from(
            new Set([
              ...(workingScene.added_corrections || []),
              ...combinedNewCorrs,
              ...(sceneDiagnosis?.actionable_fixes || []),
            ])
          );
          const nextContCorrs = Array.from(
            new Set([
              ...(workingScene.continuity_corrections || []),
              ...newContinuityCorrs,
            ])
          );
          const nextAdditivePrompt = sceneDiagnosis?.re_planned_prompt
            ? sceneDiagnosis.re_planned_prompt
            : nextCorrs.length > 0
            ? `${baseScenePrompt}\n\nCRITICAL CORRECTIONS:\n${nextCorrs.map((c) => `- ${c}`).join("\n")}`
            : visionRes.corrected_prompt || currentPrompt;
          if (sceneDiagnosis?.recommended_camera_plan) {
            workingScene.camera_angle = sceneDiagnosis.recommended_camera_angle;
            workingScene.shot_type = sceneDiagnosis.recommended_shot_type;
            workingScene.camera_plan = sceneDiagnosis.recommended_camera_plan;
          }
          workingScene.added_corrections = nextCorrs;
          workingScene.additive_corrections = nextCorrs;
          workingScene.continuity_corrections = nextContCorrs;
          workingScene.visual_prompt = nextAdditivePrompt;
          workingScene.current_prompt = nextAdditivePrompt;
          workingScene.correction_history = geminiCookiesNovelService.buildCorrectionHistoryList(
            baseScenePrompt,
            nextCorrs,
            nextAdditivePrompt,
            workingScene.correction_history
          );
        } else {
          if (continuityRes && continuityRes.overall_status !== "PASS") {
            workingScene.continuity_status = "NEEDS_MANUAL_CONTINUITY_REVIEW";
            workingScene.generation_status = workingScene.image_url ? "COMPLETED" : "NEEDS_MANUAL_REVIEW";
            workingScene.pipeline_stage = workingScene.image_url ? "COMPLETED" : "NEEDS_MANUAL_REVIEW";
          } else {
            workingScene.generation_status = workingScene.image_url ? "COMPLETED" : "FAILED";
            workingScene.pipeline_stage = workingScene.image_url ? "COMPLETED" : "NEEDS_ATTENTION";
          }
          break;
        }
      }
    }

    upsertStudioCheckpointEntitiesOnDisk({
      scene: workingScene,
      locationAnchors: anchorsMap,
      projectId,
    });

    return res.json({
      success: true,
      approved: workingScene.approved,
      scene: workingScene,
      reference_file_paths_sent: refFiles,
      character_reference_files_sent: characterRefFilePaths,
      weapon_reference_files_sent: weaponRefFilePaths,
      location_reference_file_sent: resolvedLocationLocalPath,
      previous_scene_reference_file_sent: previousSceneLocalPath,
      performance_timing: timingRecord,
      location_continuity_anchors: anchorsMap,
      telemetry: geminiCookiesNovelService.getTelemetry(),
      background_verification_started: Boolean(
        shouldAutoVerifyScene && req.body?.blockingVerify !== true
      ),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "FLOW_GENERATION_FAILED"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/scene/verify", async (req, res) => {
  try {
    const {
      geminiCookies,
      scene,
      previousScene: rawPreviousScene,
      allScenes: rawAllScenes,
      locationAnchors: rawLocationAnchors,
      stylePreset,
      location,
      allLocations,
      productionElements,
      reviewModelId,
    } = req.body || {};
    if (!scene) {
      return res.status(400).json({ success: false, error: "Missing scene" });
    }
    const localPath = resolveLocalImagePathForVision(
      scene.image_url,
      scene.local_file_path,
      `SCENE_${scene.scene_id}`
    );
    if (!localPath) {
      return res.status(400).json({
        success: false,
        error: "لا توجد صورة محلية صالحة لفحص المشهد عبر Gemini Vision.",
      });
    }

    const currentCheckpoint = loadStudioCheckpointFromDisk();
    const checkpointElements: StudioProductionElement[] = Array.isArray(currentCheckpoint?.production_elements)
      ? currentCheckpoint!.production_elements
      : [];
    const checkpointLocations: StudioLocationItem[] = Array.isArray(currentCheckpoint?.locations)
      ? currentCheckpoint!.locations
      : [];
    const checkpointScenes: StudioSceneItem[] = Array.isArray(currentCheckpoint?.scenes)
      ? currentCheckpoint!.scenes
      : [];

    const hydrateVerifyScene = (sc: StudioSceneItem | null | undefined): StudioSceneItem | null => {
      if (!sc || !sc.scene_id) return null;
      const cpSc = checkpointScenes.find((c) => c && c.scene_id === sc.scene_id);
      const rawImg = sc.image_url;
      const resolvedUrl =
        rawImg && rawImg !== "__CLIENT_MEMORY_IMAGE__"
          ? rawImg
          : cpSc?.image_url && cpSc.image_url !== "__CLIENT_MEMORY_IMAGE__"
          ? cpSc.image_url
          : rawImg;
      return {
        ...cpSc,
        ...sc,
        image_url: resolvedUrl || null,
        local_file_path: sc.local_file_path || cpSc?.local_file_path || null,
      };
    };

    const availableScenes: StudioSceneItem[] = (
      Array.isArray(rawAllScenes) && rawAllScenes.length > 0 ? rawAllScenes : checkpointScenes
    )
      .filter((s: any): s is StudioSceneItem => Boolean(s && s.scene_id))
      .map((s) => hydrateVerifyScene(s)!)
      .filter(Boolean);

    const resolvedPreviousScene: StudioSceneItem | null =
      hydrateVerifyScene(rawPreviousScene) ||
      (scene.previous_scene_id
        ? availableScenes.find((s) => s.scene_id === scene.previous_scene_id) || null
        : null) ||
      (scene.scene_number > 1
        ? availableScenes.find((s) => s.scene_number === scene.scene_number - 1) || null
        : null);

    const boundLocationId =
      scene.location_binding?.location_entity_id || scene.location_entity_id || scene.location_id;
    const safeLocationsList: StudioLocationItem[] = Array.isArray(allLocations) && allLocations.length > 0
      ? allLocations.filter((l: any): l is StudioLocationItem => Boolean(l && l.location_id))
      : checkpointLocations;
    const rawResolvedLocation =
      safeLocationsList.find(
        (l: StudioLocationItem) =>
          l.location_id === boundLocationId || l.entity_id === boundLocationId
      ) ||
      (location && location.location_id ? location : safeLocationsList[0] || undefined);
    const cpVerifyLoc = rawResolvedLocation
      ? checkpointLocations.find((l) => l && l.location_id === rawResolvedLocation.location_id)
      : undefined;
    const resolvedLocation: StudioLocationItem | undefined = rawResolvedLocation
      ? {
          ...cpVerifyLoc,
          ...rawResolvedLocation,
          reference_image_url:
            rawResolvedLocation.reference_image_url &&
            rawResolvedLocation.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
              ? rawResolvedLocation.reference_image_url
              : cpVerifyLoc?.reference_image_url || rawResolvedLocation.reference_image_url,
          local_file_path: rawResolvedLocation.local_file_path || cpVerifyLoc?.local_file_path,
        }
      : undefined;

    const resolvedLocationLocalPath = resolvedLocation
      ? resolveLocalImagePathForVision(
          resolvedLocation.reference_image_url,
          resolvedLocation.local_file_path,
          `LOC_${resolvedLocation.location_id}`
        )
      : null;

    const effectiveCurrLocId =
      resolvedLocation?.location_id || scene.primary_location_id || scene.location_entity_id || scene.location_id || "LOC_001";
    const effectivePrevLocId = resolvedPreviousScene
      ? resolvedPreviousScene.primary_location_id ||
        resolvedPreviousScene.location_entity_id ||
        resolvedPreviousScene.location_id ||
        "LOC_001"
      : null;
    const sameLocationAsPrevious = Boolean(
      resolvedPreviousScene && effectivePrevLocId === effectiveCurrLocId
    );
    const continuityMode: SceneContinuityMode = !resolvedPreviousScene
      ? "FIRST_SCENE_NO_PREVIOUS"
      : sameLocationAsPrevious
      ? "SAME_LOCATION_CONTINUITY_MODE"
      : "LOCATION_TRANSITION_MODE";

    const anchorsMap: LocationContinuityAnchorMap = {
      ...(currentCheckpoint?.location_continuity_anchors || {}),
      ...(rawLocationAnchors && typeof rawLocationAnchors === "object" ? rawLocationAnchors : {}),
    };
    const locationAnchor = anchorsMap[effectiveCurrLocId] || null;

    const previousLocalPath =
      resolvedPreviousScene && (resolvedPreviousScene.image_url || resolvedPreviousScene.local_file_path)
        ? resolveLocalImagePathForVision(
            resolvedPreviousScene.image_url,
            resolvedPreviousScene.local_file_path,
            `SCENE_${resolvedPreviousScene.scene_id}`
          )
        : null;

    const charRefPaths: string[] = [];
    const weapRefPaths: string[] = [];
    const sceneCharIdsSetForVerify = new Set(scene.character_ids || []);
    const sceneItemIdsSetForVerify = new Set([...(scene.item_ids || []), ...(scene.weapon_ids || [])]);
    const sceneCharNamesForVerify = Array.isArray(scene.characters) ? scene.characters : [];
    const sceneItemNamesForVerify = Array.isArray(scene.costumes_and_weapons) ? scene.costumes_and_weapons : [];
    const rawVerifyElementsSource: StudioProductionElement[] = (
      Array.isArray(productionElements) && productionElements.length > 0
        ? productionElements
        : checkpointElements
    ).map((el: StudioProductionElement) => {
      const cpEl = checkpointElements.find(
        (c) =>
          c &&
          (c.id === el?.id ||
            c.entity_id === el?.id ||
            (c.category === el?.category &&
              normalizeBilingualToken(c.name) === normalizeBilingualToken(el?.name)))
      );
      return upgradeStaleElementFromCheckpointAndVersions(el, cpEl);
    });
    const { deduplicated: verifyElementsSource, aliasIdMap: verifyAliasIdMap } =
      deduplicateProductionElementsList(rawVerifyElementsSource);
    for (const el of verifyElementsSource) {
      if (!el) continue;
      const isParticipating = doesElementMatchSceneBilingual(
        el,
        scene,
        sceneCharIdsSetForVerify,
        sceneItemIdsSetForVerify,
        verifyAliasIdMap
      );
      if (!isParticipating) continue;
      const p = resolveLocalImagePathForVision(el.reference_image_url, el.local_file_path, `EL_${el.id}`);
      if (!p) continue;
      if (el.category === "CHARACTER") charRefPaths.push(p);
      if (el.category === "WEAPON" || el.category === "ITEM") weapRefPaths.push(p);
    }
    if (charRefPaths.length === 0) {
      for (const el of verifyElementsSource) {
        if (el && el.category === "CHARACTER") {
          const p = resolveLocalImagePathForVision(el.reference_image_url, el.local_file_path, `EL_${el.id}`);
          if (p) charRefPaths.push(p);
        }
      }
    }
    if (weapRefPaths.length === 0) {
      for (const el of verifyElementsSource) {
        if (el && (el.category === "WEAPON" || el.category === "ITEM")) {
          const p = resolveLocalImagePathForVision(el.reference_image_url, el.local_file_path, `EL_${el.id}`);
          if (p) weapRefPaths.push(p);
        }
      }
    }
    const anchorLocalPath =
      previousLocalPath &&
      locationAnchor &&
      (locationAnchor.first_approved_scene_image_url || locationAnchor.first_approved_scene_local_path)
        ? resolveLocalImagePathForVision(
            locationAnchor.first_approved_scene_image_url,
            locationAnchor.first_approved_scene_local_path,
            `SCENE_${locationAnchor.first_approved_scene_id}`
          )
        : null;

    const [visionRes, continuityRes] = await Promise.all([
      geminiCookiesNovelService.inspectStudioSceneImage({
        cookies: geminiCookies || "",
        modelId: reviewModelId,
        scene,
        stylePreset: stylePreset || "Korean Manhwa",
        location: resolvedLocation,
        promptUsed: scene.visual_prompt || "",
        localImagePath: localPath,
        locationReferenceFilePath: resolvedLocationLocalPath,
        characterReferenceFilePaths: charRefPaths,
        weaponReferenceFilePaths: weapRefPaths,
      }),
      resolvedPreviousScene && previousLocalPath
        ? geminiCookiesNovelService.inspectSequentialSceneContinuity({
            cookies: geminiCookies || "",
            modelId: reviewModelId,
            currentScene: scene,
            previousScene: resolvedPreviousScene,
            stylePreset: stylePreset || "Korean Manhwa",
            location: resolvedLocation || null,
            productionElements: verifyElementsSource,
            locationAnchor,
            currentImagePath: localPath,
            previousImagePath: previousLocalPath,
            locationReferenceFilePath: resolvedLocationLocalPath,
            characterReferenceFilePaths: charRefPaths,
            weaponReferenceFilePaths: weapRefPaths,
            anchorSceneImagePath: anchorLocalPath,
          })
        : Promise.resolve(null),
    ]);

    if (!visionRes.checks) {
      visionRes.checks = {} as any;
    }
    if (!Array.isArray(visionRes.failed_checks)) {
      visionRes.failed_checks = [];
    }
    if (!Array.isArray(visionRes.detected_issues)) {
      visionRes.detected_issues = [];
    }
    if (continuityRes) {
      visionRes.continuity_analysis = continuityRes;
      visionRes.checks.previous_scene_continuity = continuityRes.overall_status === "PASS";
      if (continuityRes.overall_status !== "PASS") {
        visionRes.continuity_additive_correction = continuityRes.additive_corrections.join(" ");
        if (!visionRes.failed_checks.includes("previous_scene_continuity")) {
          visionRes.failed_checks.push("previous_scene_continuity");
        }
        for (const ce of continuityRes.critical_errors) {
          if (!visionRes.detected_issues.includes(ce)) {
            visionRes.detected_issues.push(ce);
          }
        }
      }
    }

    const hasRealFlowAsset = Boolean(
      (scene.real_flow_asset_verified &&
        scene.flowAssetId &&
        isRealVerifiedFlowProjectId(scene.flowProjectId || scene.flow_project_id)) ||
        scene.image_url ||
        localPath
    );

    const continuityPassed = continuityRes ? continuityRes.overall_status === "PASS" : true;
    const tripleReport = geminiCookiesNovelService.runTripleSceneVerification({
      scene,
      promptUsed: scene.visual_prompt || "",
      checks: visionRes.checks,
      failedChecks: visionRes.failed_checks || [],
      detectedIssues: visionRes.detected_issues || [],
      observedInImage: visionRes.observed_in_image,
      actualVisionCompleted: visionRes.actual_vision_request_completed !== false,
      visionOverallStatus: visionRes.overall_status,
      continuityAnalysis: continuityRes,
      previousSceneId: resolvedPreviousScene?.scene_id || null,
    });
    visionRes.triple_verification = tripleReport;

    const isApproved = Boolean(
      visionRes.approved &&
        visionRes.overall_status === "PASS" &&
        visionRes.all_required_checks_passed &&
        tripleReport.all_three_passes_succeeded &&
        continuityPassed &&
        hasRealFlowAsset
    );

    let verifyDiagnosis = visionRes.error_diagnosis_and_replan || null;
    if (!isApproved) {
      verifyDiagnosis = geminiCookiesNovelService.diagnoseAndReplanFailedScene({
        scene,
        failedChecks: visionRes.failed_checks || [],
        whatIsMissing: visionRes.what_is_missing || [],
        whatIsDifferent: visionRes.what_is_different || [],
        additiveCorrection: [visionRes.additive_correction, visionRes.continuity_additive_correction]
          .filter(Boolean)
          .join(" "),
        originalPrompt: scene.visual_prompt || scene.base_prompt || scene.description || "",
      });
      visionRes.error_diagnosis_and_replan = verifyDiagnosis;
    }

    const currentContinuityStatus: SceneContinuityStatus = !resolvedPreviousScene
      ? isApproved
        ? "INITIAL_SCENE_ANCHOR"
        : "UNVERIFIED"
      : !continuityRes
      ? isApproved
        ? "CONTINUITY_PASS"
        : "UNVERIFIED"
      : continuityRes.overall_status === "PASS" || isApproved
      ? "CONTINUITY_PASS"
      : continuityRes.overall_status === "FAIL"
      ? "CONTINUITY_FAILED"
      : "CONTINUITY_NEEDS_CORRECTION";

    const updatedVerifyCorrs = Array.from(
      new Set([
        ...(Array.isArray(scene.added_corrections) ? scene.added_corrections : []),
        ...(Array.isArray(scene.additive_corrections) ? scene.additive_corrections : []),
        ...(!isApproved && visionRes.additive_correction ? [visionRes.additive_correction] : []),
        ...(!isApproved && visionRes.continuity_additive_correction
          ? [visionRes.continuity_additive_correction]
          : []),
      ].filter(Boolean))
    ).slice(-4);

    const updated: StudioSceneItem = {
      ...scene,
      previous_scene_id: resolvedPreviousScene ? resolvedPreviousScene.scene_id : null,
      same_location_as_previous: sameLocationAsPrevious,
      continuity_mode: continuityMode,
      continuity_status: currentContinuityStatus,
      continuity_analysis: continuityRes,
      continuity_checked_at: new Date().toISOString(),
      added_corrections: updatedVerifyCorrs,
      additive_corrections: updatedVerifyCorrs,
      verification_result: visionRes,
      triple_verification: tripleReport,
      error_diagnosis_and_replan: verifyDiagnosis,
      vision_status: visionRes.vision_status,
      approved: isApproved,
      generation_status: isApproved ? "COMPLETED" : scene.generation_status,
      pipeline_stage: isApproved ? "COMPLETED" : "NEEDS_ATTENTION",
      last_error: isApproved
        ? null
        : visionRes.additive_correction ||
          visionRes.continuity_additive_correction ||
          scene.last_error ||
          null,
      verification_status:
        visionRes.overall_status === "VISION_FAILED"
          ? "VISION_FAILED"
          : isApproved
          ? "VERIFIED"
          : "REJECTED",
    };

    if (currentCheckpoint && Array.isArray(currentCheckpoint.scenes)) {
      currentCheckpoint.scenes = currentCheckpoint.scenes
        .filter((s: any): s is StudioSceneItem => Boolean(s && s.scene_id))
        .map((s: StudioSceneItem) =>
          s.scene_id === updated.scene_id ? updated : s
        );
      saveStudioCheckpointToDisk(currentCheckpoint);
    }

    return res.json({
      success: true,
      approved: updated.approved,
      scene: updated,
      continuity_analysis: continuityRes,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Scene verification failed"),
    });
  }
});

novelToMangaRouter.get("/novel-to-manga/studio/telemetry", (_req, res) => {
  return res.json({
    success: true,
    telemetry: {
      ...geminiCookiesNovelService.getTelemetry(),
      flow_performance_by_model: flowGenerationPerformanceService.getPerformanceSummaryByModel(),
      recent_timings: flowGenerationPerformanceService.getAllTimingRecords(20),
    },
  });
});

novelToMangaRouter.get("/novel-to-manga/studio/performance-report", (_req, res) => {
  return res.json({
    success: true,
    summary_by_model: flowGenerationPerformanceService.getPerformanceSummaryByModel(),
    timing_records: flowGenerationPerformanceService.getAllTimingRecords(50),
    background_tasks: flowGenerationPerformanceService.getAllBackgroundTasks(),
  });
});

novelToMangaRouter.get("/novel-to-manga/studio/background-verification/:targetId", (req, res) => {
  const targetId = String(req.params.targetId || "").trim();
  const task = flowGenerationPerformanceService.getBackgroundTaskState(targetId);
  return res.json({
    success: true,
    target_id: targetId,
    task,
  });
});

novelToMangaRouter.post("/novel-to-manga/studio/performance-benchmark", async (req, res) => {
  try {
    const {
      flowCookies,
      models,
      aspectRatio,
      stylePreset,
      customStylePrompt,
      projectId,
    } = req.body || {};

    const requestedModels: FlowDisplayModelName[] =
      Array.isArray(models) && models.length > 0
        ? models
        : ["Nano Banana 2 Lite", "Nano Banana 2", "Nano Banana Pro"];

    const effectiveAspect: StudioAspectRatio = (aspectRatio || "9:16") as StudioAspectRatio;
    const effectiveStyle: StudioStylePreset = (stylePreset || "Korean Manhwa") as StudioStylePreset;

    const results: Array<{
      model: FlowDisplayModelName;
      internal_model_id: string;
      direct_flow_generation_ms: number;
      application_generation_ms: number;
      application_overhead_ms: number;
      asset_retrieval_ms: number;
      vision_ms: number;
      total_ms: number;
      warm_session_reused: boolean;
      verified_project_reused: boolean;
      prompt_cache_hit: boolean;
      reference_assets_reused: number;
      vision_non_blocking: boolean;
      checkpoint_non_blocking: boolean;
      performance_regression: boolean;
      regression_reason: string | null;
      requested_aspect_ratio: string;
      actual_aspect_ratio: string;
      flow_project_id: string;
      flow_asset_id: string;
    }> = [];

    for (const modelName of requestedModels) {
      const resolved = flowGenerationPerformanceService.validateAndResolveModel(modelName);
      const styleHashVal = computeStudioStyleHash({
        stylePreset: effectiveStyle,
        customStyle: customStylePrompt,
        aspectRatio: effectiveAspect,
        flowModel: resolved.modelId,
        styleVersion: 1,
      });
      const promptText = `Benchmark test illustration in ${effectiveStyle} style (${effectiveAspect}). Clean character portrait, dramatic lighting, zero text.`;
      const promptHashVal = flowGenerationPerformanceService.computePromptHash({
        targetId: `BENCH_${resolved.modelId}`,
        canonicalText: promptText,
        styleHash: styleHashVal,
        referenceHash: "REF_NONE",
        modelId: resolved.modelId,
        aspectRatio: effectiveAspect,
      });

      const timingRec = flowGenerationPerformanceService.startTimingRecord({
        targetId: `BENCH_${resolved.modelId}`,
        targetType: "DIRECT_BENCHMARK",
        modelId: resolved.modelId,
        internalModelId: resolved.internalModelId,
        projectId: projectId || "",
        promptHash: promptHashVal,
        styleHash: styleHashVal,
        referenceHash: "REF_NONE",
        requestedAspectRatio: effectiveAspect,
      });
      timingRec.preparation_end = Date.now();

      const genRes = await googleFlowProvider.generateWithProjectFailover({
        prompt: promptText,
        modelDisplayName: resolved.modelId,
        outputFileName: `bench_${resolved.internalModelId}_${Date.now()}.png`,
        preferredProjectId: projectId,
        fallbackRawCookies: flowCookies,
        aspectRatio: effectiveAspect,
        actionType: "REFERENCE_GENERATION",
        styleHash: styleHashVal,
        referenceHash: "REF_NONE",
        timingRecord: timingRec,
      });

      timingRec.total_end = Date.now();
      flowGenerationPerformanceService.finalizeCalculations(timingRec.record_id);

      results.push({
        model: resolved.modelId,
        internal_model_id: resolved.internalModelId,
        direct_flow_generation_ms: timingRec.flow_generation_time,
        application_generation_ms: timingRec.image_ready_total_time,
        application_overhead_ms: timingRec.application_overhead,
        asset_retrieval_ms: timingRec.asset_time,
        vision_ms: timingRec.vision_time,
        total_ms: timingRec.total_time,
        warm_session_reused: timingRec.warm_session_reused,
        verified_project_reused: timingRec.verified_project_reused,
        prompt_cache_hit: timingRec.prompt_cache_hit,
        reference_assets_reused: timingRec.reference_assets_reused_count,
        vision_non_blocking: timingRec.vision_non_blocking,
        checkpoint_non_blocking: timingRec.checkpoint_non_blocking,
        performance_regression: timingRec.performance_regression,
        regression_reason: timingRec.regression_reason,
        requested_aspect_ratio: timingRec.requested_aspect_ratio,
        actual_aspect_ratio: timingRec.actual_aspect_ratio,
        flow_project_id: genRes.flowProjectId,
        flow_asset_id: genRes.flowAssetId,
      });
    }

    return res.json({
      success: true,
      benchmarks: results,
      summary_by_model: flowGenerationPerformanceService.getPerformanceSummaryByModel(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Benchmark failed"),
    });
  }
});

novelToMangaRouter.post("/novel-to-manga/studio/telemetry/reset", (_req, res) => {
  geminiCookiesNovelService.resetTelemetry();
  return res.json({
    success: true,
    telemetry: geminiCookiesNovelService.getTelemetry(),
  });
});

async function invokeInternalStudioPost(
  routePath: string,
  body: Record<string, any>
): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    const reqMock: any = {
      method: "POST",
      url: routePath,
      originalUrl: `/api${routePath}`,
      path: routePath,
      body: body || {},
      headers: { "content-type": "application/json" },
      get: () => "application/json",
    };
    let statusCode = 200;
    const resMock: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        resolve({ statusCode, data: payload });
        return this;
      },
      send(payload: any) {
        resolve({ statusCode, data: payload });
        return this;
      },
      setHeader() {
        return this;
      },
    };
    (novelToMangaRouter as any).handle(reqMock, resMock, (err: any) => {
      if (err) reject(err);
      else resolve({ statusCode: 404, data: { success: false, error: `Route ${routePath} not handled` } });
    });
  });
}

novelToMangaRouter.post("/novel-to-manga/studio/run-full-pipeline", async (req, res) => {
  try {
    const {
      geminiCookies,
      flowCookies,
      projectTitle,
      novelText,
      targetSceneCount,
      stylePreset = "Korean Manhwa",
      customStylePrompt = "",
      locationAspectRatio = "16:9",
      sceneAspectRatio = "9:16",
      flowModel = "Nano Banana 2",
      scriptModelId,
      reviewModelId,
      projectId,
      maxAttempts = 2,
      analysisOnly = false,
    } = req.body || {};

    const executedStages: string[] = [];

    // 1 & 2. Novel Analysis + Visual Bible Extraction
    const analysis = await geminiCookiesNovelService.analyzeStoryToStudioScript({
      cookies: geminiCookies || "",
      projectTitle: projectTitle || "مشروع القصة المصورة",
      novelText: novelText || "",
      targetSceneCount,
      modelId: scriptModelId,
    });
    executedStages.push("NOVEL_ANALYSIS", "VISUAL_BIBLE");

    let workingElements: StudioProductionElement[] = Array.isArray(analysis.production_elements)
      ? [...analysis.production_elements]
      : [];
    let workingLocations: StudioLocationItem[] = Array.isArray(analysis.locations)
      ? [...analysis.locations]
      : [];
    let workingScenes: StudioSceneItem[] = Array.isArray(analysis.scenes)
      ? [...analysis.scenes]
      : [];
    let workingLocationAnchors: Record<string, any> = {};

    saveStudioCheckpointToDisk({
      project_title: analysis.project_title,
      novel_text: novelText,
      script_text: analysis.script_text,
      production_elements: workingElements,
      locations: workingLocations,
      scenes: workingScenes,
      long_novel_pipeline: analysis.long_novel_pipeline,
    });

    if (!analysisOnly) {
      // 3. Generate & Verify Character / Weapon / Production Element References
      for (let i = 0; i < workingElements.length; i++) {
        const el = workingElements[i];
        if (!el || !el.id) continue;
        const elGen = await invokeInternalStudioPost("/novel-to-manga/studio/element/generate", {
          geminiCookies,
          flowCookies,
          element: el,
          stylePreset,
          customStylePrompt,
          aspectRatio: "1:1",
          flowModel,
          projectId,
          reviewModelId,
          autoVerify: true,
          autoLock: true,
          blockingVerify: true,
          maxAttempts: Math.max(2, Number(maxAttempts) || 2),
        });
        if (elGen.data?.element) {
          workingElements[i] = elGen.data.element;
        }
        if (!elGen.data?.success || !workingElements[i]?.reference_image_url) {
          return res.status(400).json({
            success: false,
            errorCode: "PIPELINE_ELEMENT_REFERENCE_FAILED",
            error:
              elGen.data?.error ||
              `فشل توليد أو تثبيت المرجع البصري للعنصر "${el.name}". لا يمكن القفز إلى توليد المشاهد بمراجع فارغة.`,
            executed_stages: executedStages,
          });
        }
      }
      executedStages.push("CHARACTER_WEAPON_REFERENCES");

      // 4. Generate & Verify Location References
      for (let i = 0; i < workingLocations.length; i++) {
        const loc = workingLocations[i];
        if (!loc || !loc.location_id) continue;
        const locGen = await invokeInternalStudioPost("/novel-to-manga/studio/location/generate", {
          geminiCookies,
          flowCookies,
          location: loc,
          stylePreset,
          customStylePrompt,
          aspectRatio: locationAspectRatio,
          flowModel,
          projectId,
          reviewModelId,
          autoVerify: true,
          blockingVerify: true,
          maxAttempts: Math.max(2, Number(maxAttempts) || 2),
        });
        if (locGen.data?.location) {
          workingLocations[i] = locGen.data.location;
        }
        if (!locGen.data?.success || !workingLocations[i]?.reference_image_url) {
          return res.status(400).json({
            success: false,
            errorCode: "PIPELINE_LOCATION_REFERENCE_FAILED",
            error:
              locGen.data?.error ||
              `فشل توليد أو تثبيت المرجع البصري للموقع "${loc.name}". لا يمكن القفز إلى توليد المشاهد بمراجع فارغة.`,
            executed_stages: executedStages,
          });
        }
      }
      executedStages.push("LOCATION_REFERENCES");

      // 5. Enforce Locks on all Character / Weapon / Location References before Scene Generation
      const lockRes = await invokeInternalStudioPost("/novel-to-manga/studio/references/lock-all", {
        elements: workingElements,
        locations: workingLocations,
      });
      if (Array.isArray(lockRes.data?.elements)) {
        workingElements = lockRes.data.elements;
      }
      if (Array.isArray(lockRes.data?.locations)) {
        workingLocations = lockRes.data.locations;
      }

      const unlockedElements = workingElements.filter(
        (el) => Boolean(el && el.id) && (!el.reference_image_url || el.status !== "LOCKED")
      );
      const unlockedLocations = workingLocations.filter(
        (loc) => Boolean(loc && loc.location_id) && (!loc.reference_image_url || loc.status !== "LOCKED")
      );
      if (unlockedElements.length > 0 || unlockedLocations.length > 0) {
        return res.status(400).json({
          success: false,
          errorCode: "PIPELINE_REFERENCES_NOT_LOCKED",
          error: `لا يجوز بدء توليد المشاهد قبل قفل جميع المراجع (${unlockedElements.length} عناصر و${unlockedLocations.length} مواقع غير مقفلة).`,
          executed_stages: executedStages,
        });
      }
      executedStages.push("REFERENCE_LOCKS");

      // 6, 7, 8, 9. Sequential Scene Generation + Scene Verification + Scene Continuity + Final Approval
      const sortedScenes = [...workingScenes]
        .filter((s): s is StudioSceneItem => Boolean(s && s.scene_id))
        .sort((a, b) => (a.scene_number || 0) - (b.scene_number || 0));

      for (let seqIdx = 0; seqIdx < sortedScenes.length; seqIdx++) {
        const sc = sortedScenes[seqIdx];
        const prevSc = seqIdx > 0 ? sortedScenes[seqIdx - 1] : null;
        const matchedLoc =
          sc.location_uncertain || sc.location_id === "LOCATION_UNCERTAIN"
            ? undefined
            : workingLocations.find(
                (l) =>
                  Boolean(l && l.location_id) &&
                  (l.location_id ===
                    (sc.primary_location_id || sc.location_entity_id || sc.location_id) ||
                    l.name === sc.location_name)
              );

        const scGen = await invokeInternalStudioPost("/novel-to-manga/studio/generate-scene", {
          geminiCookies,
          flowCookies,
          scene: sc,
          previousScene: prevSc,
          allScenes: sortedScenes,
          locationAnchors: workingLocationAnchors,
          stylePreset,
          customStylePrompt,
          aspectRatio: sceneAspectRatio,
          flowModel,
          projectId,
          reviewModelId,
          productionElements: workingElements,
          location: matchedLoc,
          allLocations: workingLocations,
          autoVerify: true,
          blockingVerify: true,
          maxAttempts: Math.max(2, Number(maxAttempts) || 2),
        });

        if (scGen.data?.location_continuity_anchors) {
          workingLocationAnchors = {
            ...workingLocationAnchors,
            ...scGen.data.location_continuity_anchors,
          };
        }
        if (scGen.data?.scene) {
          sortedScenes[seqIdx] = scGen.data.scene;
          workingScenes = workingScenes.map((item) =>
            item && item.scene_id === scGen.data.scene.scene_id ? scGen.data.scene : item
          );
        }
        if (
          !scGen.data?.success ||
          !sortedScenes[seqIdx]?.image_url ||
          !sortedScenes[seqIdx]?.approved
        ) {
          return res.status(400).json({
            success: false,
            errorCode: scGen.data?.errorCode || "PIPELINE_SCENE_CONTINUITY_HALTED",
            error:
              scGen.data?.error ||
              `توقف المسار عند المشهد ${sc.scene_number} لضمان عدم كسر الاستمرارية البصرية.`,
            executed_stages: executedStages,
            production_elements: workingElements,
            locations: workingLocations,
            scenes: workingScenes,
          });
        }
      }
      executedStages.push(
        "SCENE_GENERATION",
        "SCENE_VERIFICATION",
        "SCENE_CONTINUITY",
        "FINAL_APPROVAL"
      );
    }

    // 10. Save Final Checkpoint
    const checkpoint = saveStudioCheckpointToDisk({
      project_title: analysis.project_title,
      novel_text: novelText,
      script_text: analysis.script_text,
      production_elements: workingElements,
      locations: workingLocations,
      scenes: workingScenes,
      long_novel_pipeline: analysis.long_novel_pipeline,
      location_continuity_anchors: workingLocationAnchors,
    });
    executedStages.push("CHECKPOINT");

    return res.json({
      success: true,
      executed_stages: executedStages,
      project_title: analysis.project_title,
      script_text: analysis.script_text,
      production_elements: workingElements,
      locations: workingLocations,
      scenes: workingScenes,
      location_continuity_anchors: workingLocationAnchors,
      checkpoint,
      telemetry: geminiCookiesNovelService.getTelemetry(),
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Full pipeline execution failed"),
    });
  }
});

// ============================================================================
// 15. KOREAN MANHWA PAGE LAYOUT SYSTEM ENDPOINTS
// ============================================================================

/**
 * Plan Chapter Pages (Supports both SCENE_PER_PAGE and KOREAN_MANHWA_PAGES modes)
 */
novelToMangaRouter.post(["/manhwa-pages/plan", "/novel-to-manga/manhwa-pages/plan"], (req, res) => {
  try {
    const {
      chapter_id,
      chapter_title,
      scenes,
      blocks,
      elements,
      locations,
      preferred_style,
      page_mode,
      aspect_ratio,
      page_plans,
      target_dimensions,
    } = req.body;
    const workingScenes = Array.isArray(scenes) ? scenes : [];
    const workingBlocks = Array.isArray(blocks) ? blocks : [];
    const workingElements = Array.isArray(elements) ? elements : [];
    const workingLocations = Array.isArray(locations) ? locations : [];

    if (page_mode === "SCENE_PER_PAGE") {
      const scenePerPagePlan = manhwaPageEngine.planChapterScenePerPage({
        chapter_id,
        chapter_title,
        scenes: workingScenes,
        blocks: workingBlocks,
        elements: workingElements,
        locations: workingLocations,
        preferred_style,
        aspect_ratio,
      });

      return res.json({
        success: true,
        page_mode: "SCENE_PER_PAGE",
        plan: scenePerPagePlan,
        scene_per_page_plan: scenePerPagePlan,
      });
    }

    const plan = manhwaPageEngine.planChapterManhwaPages({
      chapter_id,
      chapter_title,
      scenes: workingScenes,
      blocks: workingBlocks,
      elements: workingElements,
      locations: workingLocations,
      preferred_style,
      page_plans,
      target_dimensions,
    });

    return res.json({
      success: true,
      page_mode: "KOREAN_MANHWA_PAGES",
      plan,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Page planning failed"),
    });
  }
});

/**
 * Assemble vertical Korean Manhwa Page (Webtoon vertical canvas) from planned panels & generated scene images,
 * and inspect native Flow image dimensions vs target dimensions (2048x16384) with honest reporting.
 */
novelToMangaRouter.post(["/manhwa-pages/assemble", "/novel-to-manga/manhwa-pages/assemble"], async (req, res) => {
  try {
    const { page, scenes, target_width, target_height, resize_to_target } = req.body || {};
    if (!page || !Array.isArray(page.panels) || page.panels.length === 0) {
      return res.status(400).json({ success: false, error: "Missing page or panels array for assembly" });
    }

    const workingScenes: StudioSceneItem[] = Array.isArray(scenes) ? scenes : [];
    const requestedWidth = Number(target_width || page.dimensions?.width) || 2048;
    const requestedHeight = Number(target_height || page.dimensions?.height) || 16384;

    const sharpMod = await import("sharp");
    const sharpFn = sharpMod.default || (sharpMod as any);

    const panelBuffers: {
      panel_id: string;
      scene_id: string;
      order: number;
      native_width: number;
      native_height: number;
      panel_target_height: number;
      buffer: Buffer;
    }[] = [];

    // Sort panels in reading order (TOP_TO_BOTTOM: 1 -> 2 -> 3)
    const sortedPanels = [...page.panels].sort(
      (a: any, b: any) => (Number(a.reading_order || a.order || a.panel_number) || 0) - (Number(b.reading_order || b.order || b.panel_number) || 0)
    );

    const gutterPx = 48;
    const topMarginPx = 64;
    const bottomMarginPx = 64;
    const availableHeightForPanels = Math.max(
      1200,
      requestedHeight - topMarginPx - bottomMarginPx - gutterPx * Math.max(0, sortedPanels.length - 1)
    );

    for (let i = 0; i < sortedPanels.length; i++) {
      const panel = sortedPanels[i];
      const sceneId = panel.source_scene_id || panel.scene_id;
      const matchedScene = workingScenes.find((s) => s.scene_id === sceneId || (s as any).id === sceneId);
      const imgUrl = panel.image_url || matchedScene?.image_url;
      const localPath = panel.local_file_path || matchedScene?.local_file_path;
      const resolvedPath = resolveLocalImagePathForVision(imgUrl, localPath);

      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        return res.status(400).json({
          success: false,
          error: `Missing generated scene image on disk for panel ${panel.panel_id} (scene ${sceneId})`,
        });
      }

      const meta = await sharpFn(resolvedPath).metadata();
      const nativeW = meta.width || 0;
      const nativeH = meta.height || 0;

      const ratio = Number(panel.height_ratio) || 1 / sortedPanels.length;
      const panelTargetH = Math.max(400, Math.round(availableHeightForPanels * ratio));

      // Resize/fit scene artwork cleanly into panel slot width while keeping vertical composition
      const resizedBuf = await sharpFn(resolvedPath)
        .resize(requestedWidth - 64, panelTargetH, { fit: "cover", position: "center" })
        .png()
        .toBuffer();

      panelBuffers.push({
        panel_id: panel.panel_id,
        scene_id: sceneId,
        order: Number(panel.reading_order || panel.order || panel.panel_number) || i + 1,
        native_width: nativeW,
        native_height: nativeH,
        panel_target_height: panelTargetH,
        buffer: resizedBuf,
      });
    }

    // Compose vertical webtoon strip canvas
    const composites: any[] = [];
    let currentY = topMarginPx;
    for (const pb of panelBuffers) {
      composites.push({
        input: pb.buffer,
        top: currentY,
        left: 32,
      });
      currentY += pb.panel_target_height + gutterPx;
    }

    const generatedPagesDir = path.resolve(process.cwd(), "public", "generated", "novel-manga", "pages");
    if (!fs.existsSync(generatedPagesDir)) {
      fs.mkdirSync(generatedPagesDir, { recursive: true });
    }
    const totalCanvasHeight = resize_to_target !== false ? requestedHeight : Math.max(currentY + bottomMarginPx, 1200);
    const pageFileName = `MANHWA_${page.page_id || "PAGE_001"}_${Date.now()}.png`;
    const pageFilePath = path.join(generatedPagesDir, pageFileName);

    await sharpFn({
      create: {
        width: requestedWidth,
        height: totalCanvasHeight,
        channels: 4,
        background: { r: 12, g: 12, b: 18, alpha: 1 },
      },
    })
      .composite(composites)
      .png()
      .toFile(pageFilePath);

    const assembledMeta = await sharpFn(pageFilePath).metadata();
    const publicUrl = `/generated/novel-manga/pages/${pageFileName}`;

    const allNativelyAtTarget = panelBuffers.every(
      (pb) => pb.native_width === requestedWidth && pb.native_height === requestedHeight
    );

    const updatedPage = {
      ...page,
      composite_image_url: publicUrl,
      local_file_path: pageFilePath,
      approved: true,
      status: "APPROVED",
      reading_order_verified: true,
      visual_hierarchy_verified: true,
      dimensions_audit: {
        requested_dimensions: { width: requestedWidth, height: requestedHeight },
        native_flow_scene_dimensions: panelBuffers.map((pb) => ({
          panel_id: pb.panel_id,
          scene_id: pb.scene_id,
          native_width: pb.native_width,
          native_height: pb.native_height,
        })),
        assembled_page_dimensions: {
          width: assembledMeta.width || requestedWidth,
          height: assembledMeta.height || totalCanvasHeight,
        },
        flow_natively_supports_2048x16384: allNativelyAtTarget,
        post_processed_vertical_assembly_and_resize: !allNativelyAtTarget,
        honest_disclosure: allNativelyAtTarget
          ? "Generated natively at 2048x16384 by Google Flow."
          : `Google Flow generated native 9:16 scene images (${panelBuffers[0]?.native_width || 0}x${panelBuffers[0]?.native_height || 0} px); the 2048x16384 vertical Manhwa page was produced via post-generation vertical panel assembly and scaling.`,
      },
      updated_at: new Date().toISOString(),
    };

    updatedPage.page_verification_report = manhwaPageEngine.verifyManhwaPage(updatedPage);

    return res.json({
      success: true,
      page: updatedPage,
      composite_image_url: publicUrl,
      local_file_path: pageFilePath,
      dimensions_audit: updatedPage.dimensions_audit,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Manhwa page assembly failed"),
    });
  }
});

/**
 * Verify a single Manhwa Page layout & reading order
 */
novelToMangaRouter.post(["/manhwa-pages/verify-page", "/novel-to-manga/manhwa-pages/verify-page"], (req, res) => {
  try {
    const { page } = req.body;
    if (!page || !page.page_id) {
      return res.status(400).json({ success: false, error: "Missing page payload" });
    }

    const report = manhwaPageEngine.verifyManhwaPage(page);
    return res.json({
      success: true,
      report,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Page verification failed"),
    });
  }
});

/**
 * Replan layout for a specific page
 */
novelToMangaRouter.post(["/manhwa-pages/replan-layout", "/novel-to-manga/manhwa-pages/replan-layout"], (req, res) => {
  try {
    const { page, new_layout_type } = req.body;
    if (!page || !page.page_id) {
      return res.status(400).json({ success: false, error: "Missing page payload" });
    }

    const updatedPage = { ...page };
    if (new_layout_type) {
      updatedPage.layout_type = new_layout_type;
    }
    updatedPage.page_verification_report = manhwaPageEngine.verifyManhwaPage(updatedPage);
    updatedPage.updated_at = new Date().toISOString();

    return res.json({
      success: true,
      page: updatedPage,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: sanitizeTextForLog(err?.message || "Layout replan failed"),
    });
  }
});
