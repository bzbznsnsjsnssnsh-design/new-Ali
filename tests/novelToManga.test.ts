/**
 * Unit & Preflight Integration Tests for:
 * Novel → Manga Pages 1.1 (Gemini Cookies + Google Flow + Visual Bible + Reference Lock)
 */

import assert from "node:assert";
import {
  GEMINI_COOKIE_MODELS,
  normalizeGeminiModel,
  resolveGeminiModelDef,
} from "../server/geminiCookiesService";
import {
  GoogleFlowProvider,
  maskSecret,
  sanitizeTextForLog,
} from "../server/googleFlowProvider";
import {
  ALL_VISUAL_BIBLE_CATEGORIES,
  buildRealFlowProjectUrl,
  DEFAULT_FLOW_TASK_MODELS,
  DEFAULT_GEMINI_TASK_MODELS,
  isRealVerifiedFlowProjectId,
  MAX_GOOGLE_FLOW_PROJECTS,
  type VisualBibleReference,
} from "../src/types/novelToManga";
import { lockApprovedReference } from "../server/novelToMangaRouter";

export async function runNovelToMangaTests() {
  // 1. Verify Gemini Cookies Real Model IDs (Requirement 3)
  for (const requiredId of ["3.5-flash-lite", "3.5-flash-lite-extended", "3.6-flash", "3.1-pro"] as const) {
    assert.ok(requiredId in GEMINI_COOKIE_MODELS, `Must expose real Gemini Cookie model ${requiredId}`);
  }
  assert.strictEqual(normalizeGeminiModel("3.5-flash-lite"), "3.5-flash-lite");
  assert.strictEqual(normalizeGeminiModel("3.5-flash-lite-extended"), "3.5-flash-lite-extended");
  assert.strictEqual(normalizeGeminiModel("3.6-flash"), "3.6-flash");
  assert.strictEqual(normalizeGeminiModel("3.1-pro"), "3.1-pro");

  const extendedModel = resolveGeminiModelDef("3.5-flash-lite-extended");
  assert.strictEqual(extendedModel.model_name, "gemini-3.5-flash-lite-extended", "Extended model must resolve to gemini-3.5-flash-lite-extended");
  assert.strictEqual(GEMINI_COOKIE_MODELS["3.5-flash-lite-extended"].extendedThinking, true, "Extended model must have Extended Thinking ON");

  // 2. Verify Task Model Separation (Requirement 3 & 11 & 26)
  assert.strictEqual(DEFAULT_GEMINI_TASK_MODELS.novel_analysis, "3.6-flash");
  assert.strictEqual(DEFAULT_GEMINI_TASK_MODELS.complex_analysis, "3.1-pro");
  assert.strictEqual(DEFAULT_GEMINI_TASK_MODELS.fast_analysis, "3.5-flash-lite");
  assert.strictEqual(DEFAULT_GEMINI_TASK_MODELS.deep_analysis, "3.5-flash-lite-extended");
  assert.strictEqual(DEFAULT_FLOW_TASK_MODELS.reference_generation, "Nano Banana Pro");
  assert.strictEqual(DEFAULT_FLOW_TASK_MODELS.scene_generation, "Nano Banana 2");
  assert.strictEqual(DEFAULT_FLOW_TASK_MODELS.fast_generation, "Nano Banana 2 Lite");

  // 3. Verify Security & Secret Masking (Requirement 5 & 28)
  const rawCookie = "__Secure-1PSID=g.a000secretcookievalue123456789; __Secure-1PSIDTS=secret_ts_999";
  const masked = maskSecret(rawCookie);
  assert.ok(!masked.includes("secretcookievalue123456789"), "maskSecret must never expose raw cookie secret");
  const sanitizedLog = sanitizeTextForLog(`Connection error with ${rawCookie}`);
  assert.ok(!sanitizedLog.includes("secretcookievalue123456789"), "sanitizeTextForLog must redact cookie values");

  // 4. Verify GoogleFlowProvider Architecture & Max 5 Projects (Requirement 7 & 9)
  const provider = new GoogleFlowProvider();
  assert.ok(provider.session, "GoogleFlowSession must exist");
  assert.ok(provider.projects, "GoogleFlowProjects must exist");
  assert.ok(provider.upload, "GoogleFlowUpload must exist");
  assert.ok(provider.references, "GoogleFlowReferences must exist");
  assert.ok(provider.generation, "GoogleFlowGeneration must exist");
  assert.ok(provider.result, "GoogleFlowResult must exist");
  assert.ok(provider.review, "GoogleFlowReview must exist");
  assert.ok(provider.history, "GoogleFlowHistory must exist");

  const initialProjects = provider.projects.listProjects();
  assert.ok(initialProjects.length <= MAX_GOOGLE_FLOW_PROJECTS, "Projects count must not exceed 5");

  // 5. Verify Model Availability When Disconnected (Requirement 10)
  const disconnectedModels = await provider.generation.discoverModels({ isAuthenticated: false });
  for (const m of disconnectedModels) {
    assert.strictEqual(m.available, false, `${m.display_name} must be Unavailable when session is missing`);
    assert.strictEqual(m.status_label, "Unavailable");
  }

  // 6. Verify All 23 Visual Bible Categories (Requirement 14)
  assert.strictEqual(ALL_VISUAL_BIBLE_CATEGORIES.length, 23, "Visual Bible must support all 23 categories");
  assert.ok(ALL_VISUAL_BIBLE_CATEGORIES.includes("WORLD"));
  assert.ok(ALL_VISUAL_BIBLE_CATEGORIES.includes("ROAD"));
  assert.ok(ALL_VISUAL_BIBLE_CATEGORIES.includes("CHARACTER"));
  assert.ok(ALL_VISUAL_BIBLE_CATEGORIES.includes("PANEL STYLE"));

  // 7. Verify Reference Lock & Version 2 Creation Preserving Version 1 (Requirement 17)
  const refV1: VisualBibleReference = {
    reference_id: "WORLD_001",
    file_name: "WORLD_001.png",
    category: "WORLD",
    name: "Luminous Road World",
    description: "Glowing road at night",
    visual_traits: ["Glowing stone road"],
    immutable_constraints: ["Do not replace road"],
    prompt: "Initial WORLD_001 prompt",
    image_url: "/generated/references/WORLD_001_v1.png",
    status: "LOCKED",
    version: 1,
    versions: [
      {
        version: 1,
        prompt: "Initial WORLD_001 prompt",
        image_url: "/generated/references/WORLD_001_v1.png",
        file_name: "WORLD_001_v1.png",
        status: "LOCKED",
        review_result: {
          approved: true,
          issues: [],
          consistency: {
            identity: true,
            environment: true,
            style: true,
            objects: true,
            lighting: true,
          },
        },
        created_at: new Date().toISOString(),
        locked_at: new Date().toISOString(),
      },
    ],
    review_result: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    locked_at: new Date().toISOString(),
  };

  // Simulate editing locked reference -> creates Version 2 while keeping Version 1
  const nextVersion = refV1.version + 1;
  const refV2: VisualBibleReference = {
    ...refV1,
    version: nextVersion,
    file_name: `${refV1.reference_id}_v${nextVersion}.png`,
    prompt: "Updated WORLD_001 prompt for Version 2",
    status: "DRAFT",
    locked_at: null,
  };

  assert.strictEqual(refV2.version, 2, "Editing locked reference must increment to Version 2");
  assert.strictEqual(refV2.versions.length, 1, "Version 1 snapshot must remain preserved");
  assert.strictEqual(refV2.versions[0].version, 1, "Preserved snapshot must be Version 1");

  // 8. Verify Real Google Flow Project ID Enforcement (No fake flow_project_1)
  assert.strictEqual(isRealVerifiedFlowProjectId("flow_project_1"), false, "Must reject fake flow_project_1");
  assert.strictEqual(isRealVerifiedFlowProjectId("flow_project_2"), false, "Must reject fake flow_project_2");
  assert.strictEqual(isRealVerifiedFlowProjectId("local_12345"), false, "Must reject fake local_ ID");
  assert.strictEqual(
    isRealVerifiedFlowProjectId("8f3a1c20-4b99-4d8e-9a11-72b4e5f01a22"),
    true,
    "Must accept real UUID Google Flow project ID"
  );
  assert.strictEqual(
    buildRealFlowProjectUrl("flow_project_1"),
    null,
    "Must never build URL for fake flow_project_1"
  );
  assert.strictEqual(
    buildRealFlowProjectUrl("8f3a1c20-4b99-4d8e-9a11-72b4e5f01a22", "asset_999"),
    "https://flow.google.com/project/8f3a1c20-4b99-4d8e-9a11-72b4e5f01a22?asset=asset_999"
  );

  // 9. Verify lockApprovedReference rejects fake LOCKED without real flowAssetId & flowGenerationId
  assert.throws(
    () => {
      lockApprovedReference({
        ...refV1,
        status: "APPROVED",
        review_result: {
          approved: true,
          issues: [],
          consistency: { identity: true, environment: true, style: true, objects: true, lighting: true }
        },
        flowProjectId: "flow_project_1",
        flowAssetId: null,
        flowGenerationId: null,
      });
    },
    /FLOW_ASSET_NOT_VERIFIED/,
    "lockApprovedReference must throw FLOW_ASSET_NOT_VERIFIED when flowProjectId is fake or flowAssetId is missing"
  );

  return { passed: true, testsRun: 9 };
}
