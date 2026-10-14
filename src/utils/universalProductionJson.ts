/**
 * Universal Production JSON Engine (Schema 1.0)
 *
 * Strict JSON-Driven Architecture for Universal Novel -> Manga Production.
 * Source of Truth: JSON file dictates exact target step and reference sheet membership.
 *
 * Rules:
 * 1. Target Step Partition: Every entity must have "target_step": "production_elements" | "locations".
 *    - "production_elements" appears EXCLUSIVELY in Production Elements step.
 *    - "locations" appears EXCLUSIVELY in Locations step.
 *    - Never guess, merge, or cross-pollinate. If invalid/missing, retain entity and report error.
 * 2. Reference Sheet Membership:
 *    - Every entity must have reference_sheet_id matching a valid reference sheet.
 *    - Every reference sheet must explicitly list member_ids.
 *    - Every member in member_ids must point back to that sheet.
 *    - STRICT STEP ISOLATION: A single reference sheet CANNOT mix "production_elements" and "locations" members.
 *      Sheet target_step must strictly match all its members' target_step.
 */

import {
  StudioProductionElement,
  StudioLocationItem,
  StudioSceneItem,
  ProductionElementType,
} from "../types/novelToManga";

export type UniversalTargetStep = "production_elements" | "locations";

export interface UniversalNovelEntity {
  id: string; // e.g. "CHAR_001", "WEAPON_001", "CREATURE_001", "ITEM_001", "LOC_001"
  type: "character" | "weapon" | "creature" | "prop" | "item" | "location" | "building" | "vehicle" | string;
  name: string;
  description?: string;
  visual_details?: string;
  visual_description?: string;
  visual_prompt?: string;
  reference_prompt?: string;
  base_reference_prompt?: string;
  visual_reference_prompt?: string;
  negative_prompt?: string;
  visual_constraints?: string[];
  immutable_constraints?: string[];
  visual_facts?: string[];
  target_step: UniversalTargetStep;
  reference_sheet_id: string;
  canonical_name?: string;
  owner_id?: string | null;
  attached_to?: string | null;
  location_type?: string;
  lighting_and_atmosphere?: string;
  color_palette?: string;
  textures?: string;
  key_components?: string[];
  confirmed_relationships?: Array<{ target_entity_id: string; relation: string }>;
  source_evidence?: string;
  unknown_or_conflicting_info?: string[];
  reference_image_url?: string | null;
  local_file_path?: string | null;
  status?: string;
  approved?: boolean;
  locked_for_production?: boolean;
}

export interface UniversalReferenceSheet {
  id: string; // e.g. "SHEET_001"
  target_step: UniversalTargetStep;
  title: string;
  name?: string;
  member_ids: string[];
  description?: string;
  visual_prompt?: string;
  reference_prompt?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  layout_type?: string;
  reference_image_url?: string | null;
  local_file_path?: string | null;
  status?: string;
  approved?: boolean;
  is_locked?: boolean;
}

export interface UniversalNovelMetadata {
  id: string;
  title: string;
  author?: string;
  summary?: string;
  genre?: string;
  chapter_id?: string;
  chapter_number?: number;
  chapter_title?: string;
  novel_text?: string;
  raw_text?: string;
  script_text?: string;
}

export interface UniversalStyleSettings {
  style_id?: string;
  style_name?: string;
  style_preset?: string;
  mode?: string;
  page_generation_mode?: "SCENE_PER_PAGE" | "KOREAN_MANHWA_PAGES" | string;
  aspect_ratio?: string;
  target_dimensions?: { width: number; height: number } | string;
  width?: number;
  height?: number;
  model_id?: string;
  flow_model?: string;
  custom_style?: string;
  negative_prompt?: string;
  visual_constraints?: string[];
  style_version?: number;
  styleHash?: string;
}

export interface UniversalEventItem {
  id?: string;
  event_id: string;
  event_number: number;
  title: string;
  event_title?: string;
  description: string;
  summary?: string;
  scene_id?: string;
  mapped_scene_id?: string;
  location_id?: string;
  character_ids?: string[];
  weapon_ids?: string[];
  creature_ids?: string[];
  item_ids?: string[];
  source_excerpt?: string;
}

export interface UniversalChapterItem {
  id: string;
  chapter_number: number;
  title: string;
  summary?: string;
}

export interface UniversalSceneItem {
  id: string;
  scene_id?: string;
  scene_number: number;
  title: string;
  description: string;
  event_id?: string;
  event_ids?: string[];
  location_id?: string;
  location_name?: string;
  location_ids?: string[];
  character_ids?: string[];
  weapon_ids?: string[];
  creature_ids?: string[];
  item_ids?: string[];
  action?: string;
  dialogue?: string;
  narration?: string;
  sfx?: string;
  camera_angle?: string;
  shot_type?: string;
  visual_prompt?: string;
  negative_prompt?: string;
  previous_scene_id?: string | null;
  continuity_notes?: string;
  panels?: any[];
  shots_panels?: any[];
}

export interface UniversalProductionJson {
  schema_version: "1.0" | string;
  project_id?: string;
  project_name?: string;
  novel: UniversalNovelMetadata;
  story?: Record<string, any>;
  style?: UniversalStyleSettings;
  pipeline_settings?: Record<string, any>;
  entities: UniversalNovelEntity[];
  reference_sheets: UniversalReferenceSheet[];
  events?: UniversalEventItem[];
  chapters?: UniversalChapterItem[];
  scenes?: UniversalSceneItem[];
  pages?: any[];
  manhwa_pages?: any[];
  validation_report?: UniversalValidationReport;
}

export interface UniversalValidationError {
  code:
    | "MISSING_TARGET_STEP"
    | "INVALID_TARGET_STEP"
    | "MISSING_REFERENCE_SHEET_ID"
    | "UNKNOWN_REFERENCE_SHEET"
    | "SHEET_MEMBER_NOT_FOUND"
    | "RECIPROCAL_MISMATCH"
    | "CROSS_STEP_POLLUTION"
    | "DUPLICATE_ENTITY_ID"
    | "DUPLICATE_SHEET_ID"
    | "EMPTY_MEMBER_IDS";
  entity_id?: string;
  sheet_id?: string;
  message_ar: string;
  message_en: string;
  severity: "ERROR" | "WARNING";
}

export interface UniversalValidationReport {
  is_valid: boolean;
  checked_at: string;
  total_entities: number;
  production_elements_count: number;
  locations_count: number;
  uncategorized_entities_count: number;
  total_reference_sheets: number;
  production_sheets_count: number;
  location_sheets_count: number;
  errors: UniversalValidationError[];
  warnings: UniversalValidationError[];
}

/**
 * Validates a Universal Production JSON payload against all strict architectural rules.
 */
export function validateUniversalProductionJson(data: any): UniversalValidationReport {
  const errors: UniversalValidationError[] = [];
  const warnings: UniversalValidationError[] = [];

  const rawEntities: any[] = Array.isArray(data?.entities) ? data.entities : [];
  const rawSheets: any[] = Array.isArray(data?.reference_sheets) ? data.reference_sheets : [];

  const entityMap = new Map<string, any>();
  const sheetMap = new Map<string, any>();

  let prodElemCount = 0;
  let locCount = 0;
  let uncatCount = 0;

  let prodSheetCount = 0;
  let locSheetCount = 0;

  // 1. Audit Sheets
  rawSheets.forEach((sheet: any, sIdx: number) => {
    const sId = typeof sheet?.id === "string" ? sheet.id.trim() : `SHEET_${sIdx + 1}`;
    if (!sheet?.id) {
      errors.push({
        code: "INVALID_TARGET_STEP",
        sheet_id: sId,
        message_ar: `لوحة التصميم رقم ${sIdx + 1} تفتقر لمعرف صريح (id).`,
        message_en: `Reference sheet at index ${sIdx + 1} is missing an explicit id.`,
        severity: "ERROR",
      });
    }

    if (sheetMap.has(sId)) {
      errors.push({
        code: "DUPLICATE_SHEET_ID",
        sheet_id: sId,
        message_ar: `تكرار معرف لوحة التصميم: «${sId}». يجب أن يكون لكل لوحة معرف فريد.`,
        message_en: `Duplicate reference sheet id: "${sId}". Each sheet must be unique.`,
        severity: "ERROR",
      });
    }
    sheetMap.set(sId, sheet);

    const sTarget = sheet?.target_step;
    if (sTarget === "production_elements") {
      prodSheetCount++;
    } else if (sTarget === "locations") {
      locSheetCount++;
    } else {
      errors.push({
        code: "INVALID_TARGET_STEP",
        sheet_id: sId,
        message_ar: `لوحة التصميم «${sId}» تحتوي على target_step غير صالح: «${sTarget || "مفقود"}». القيمة المسموحة: production_elements أو locations.`,
        message_en: `Sheet "${sId}" has invalid target_step: "${sTarget || "missing"}". Allowed: production_elements or locations.`,
        severity: "ERROR",
      });
    }

    const members = Array.isArray(sheet?.member_ids) ? sheet.member_ids : [];
    if (members.length === 0) {
      warnings.push({
        code: "EMPTY_MEMBER_IDS",
        sheet_id: sId,
        message_ar: `لوحة التصميم «${sId}» لا تحتوي على أي أعضاء مسجلين في member_ids.`,
        message_en: `Reference sheet "${sId}" has an empty member_ids list.`,
        severity: "WARNING",
      });
    }
  });

  // 2. Audit Entities
  rawEntities.forEach((ent: any, eIdx: number) => {
    const eId = typeof ent?.id === "string" ? ent.id.trim() : `ENTITY_${eIdx + 1}`;
    if (!ent?.id) {
      errors.push({
        code: "INVALID_TARGET_STEP",
        entity_id: eId,
        message_ar: `الكيان رقم ${eIdx + 1} يفتقر لمعرف فريد صريح (id).`,
        message_en: `Entity at index ${eIdx + 1} is missing an explicit id.`,
        severity: "ERROR",
      });
    }

    if (entityMap.has(eId)) {
      errors.push({
        code: "DUPLICATE_ENTITY_ID",
        entity_id: eId,
        message_ar: `تكرار معرف الكيان: «${eId}». يُمنع تكرار الكيانات في JSON.`,
        message_en: `Duplicate entity id: "${eId}". Entities must have unique IDs.`,
        severity: "ERROR",
      });
    }
    entityMap.set(eId, ent);

    // Rule 1: Target Step check
    const targetStep = ent?.target_step;
    if (targetStep === "production_elements") {
      prodElemCount++;
    } else if (targetStep === "locations") {
      locCount++;
    } else {
      uncatCount++;
      errors.push({
        code: !targetStep ? "MISSING_TARGET_STEP" : "INVALID_TARGET_STEP",
        entity_id: eId,
        message_ar: `الكيان «${ent?.name || eId}» (${eId}) يحتوي على target_step مفقود أو غير صحيح («${targetStep || "فارغ"}»). يُمنع التخمين ويجب تحديد production_elements أو locations صراحة.`,
        message_en: `Entity "${ent?.name || eId}" (${eId}) has missing or invalid target_step: "${targetStep || "empty"}". Guessing is strictly prohibited.`,
        severity: "ERROR",
      });
    }

    // Rule 2: Reference Sheet ID check
    const refSheetId = ent?.reference_sheet_id;
    if (!refSheetId || typeof refSheetId !== "string" || !refSheetId.trim()) {
      errors.push({
        code: "MISSING_REFERENCE_SHEET_ID",
        entity_id: eId,
        message_ar: `الكيان «${ent?.name || eId}» (${eId}) لا يحتوي على reference_sheet_id. يجب ربط كل كيان بلوحة تصميم محددة.`,
        message_en: `Entity "${ent?.name || eId}" (${eId}) is missing reference_sheet_id.`,
        severity: "ERROR",
      });
    } else {
      const targetSheet = sheetMap.get(refSheetId.trim());
      if (!targetSheet) {
        errors.push({
          code: "UNKNOWN_REFERENCE_SHEET",
          entity_id: eId,
          sheet_id: refSheetId,
          message_ar: `الكيان «${ent?.name || eId}» (${eId}) يشير إلى لوحة تصميم غير موجودة: «${refSheetId}».`,
          message_en: `Entity "${ent?.name || eId}" points to non-existent sheet "${refSheetId}".`,
          severity: "ERROR",
        });
      } else {
        const members: string[] = Array.isArray(targetSheet.member_ids) ? targetSheet.member_ids : [];
        if (!members.includes(eId)) {
          errors.push({
            code: "RECIPROCAL_MISMATCH",
            entity_id: eId,
            sheet_id: refSheetId,
            message_ar: `تعارض العضوية: الكيان «${eId}» يحدد لوحة «${refSheetId}»، لكنه غير مدرج داخل member_ids التابعة للوحة!`,
            message_en: `Membership mismatch: Entity "${eId}" specifies sheet "${refSheetId}", but is not in sheet's member_ids.`,
            severity: "ERROR",
          });
        }
      }
    }
  });

  // 3. Audit Sheets Member IDs & Strict Isolation
  sheetMap.forEach((sheet, sheetId) => {
    const sheetTarget = sheet?.target_step;
    const members: string[] = Array.isArray(sheet?.member_ids) ? sheet.member_ids : [];

    members.forEach((mId) => {
      const ent = entityMap.get(mId);
      if (!ent) {
        errors.push({
          code: "SHEET_MEMBER_NOT_FOUND",
          sheet_id: sheetId,
          entity_id: mId,
          message_ar: `لوحة التصميم «${sheetId}» تدرج العضو «${mId}» في member_ids لكنه غير موجود في قائمة entities!`,
          message_en: `Sheet "${sheetId}" lists member "${mId}" which does not exist in entities!`,
          severity: "ERROR",
        });
        return;
      }

      // Check reciprocal reference_sheet_id
      if (ent.reference_sheet_id !== sheetId) {
        errors.push({
          code: "RECIPROCAL_MISMATCH",
          sheet_id: sheetId,
          entity_id: mId,
          message_ar: `تعارض التبعية: اللوحة «${sheetId}» تدرج الكيان «${mId}»، بينما reference_sheet_id للكيان هو «${ent.reference_sheet_id}»!`,
          message_en: `Mismatch: Sheet "${sheetId}" lists "${mId}", but entity's reference_sheet_id is "${ent.reference_sheet_id}".`,
          severity: "ERROR",
        });
      }

      // Strict Step Isolation Rule:
      // A sheet cannot mix production_elements and locations.
      // Sheet target_step must strictly match member target_step.
      if (sheetTarget && ent.target_step && ent.target_step !== sheetTarget) {
        errors.push({
          code: "CROSS_STEP_POLLUTION",
          sheet_id: sheetId,
          entity_id: mId,
          message_ar: `خرق قاعدة الفصل الصارم (Cross-Step Pollution): اللوحة «${sheetId}» تابعة لخطوة «${sheetTarget}»، لكن العضو «${mId}» تابع لخطوة «${ent.target_step}»! يُمنع دمج عناصر الإنتاج والمواقع في لوحة واحدة إطلاقاً.`,
          message_en: `Strict Isolation Breach: Sheet "${sheetId}" belongs to "${sheetTarget}", but member "${mId}" belongs to "${ent.target_step}". Cross-step sheet mixing is strictly forbidden.`,
          severity: "ERROR",
        });
      }
    });
  });

  return {
    is_valid: errors.length === 0,
    checked_at: new Date().toISOString(),
    total_entities: rawEntities.length,
    production_elements_count: prodElemCount,
    locations_count: locCount,
    uncategorized_entities_count: uncatCount,
    total_reference_sheets: rawSheets.length,
    production_sheets_count: prodSheetCount,
    location_sheets_count: locSheetCount,
    errors,
    warnings,
  };
}

/**
 * Normalizes an entity category to standard Studio ProductionElementType
 */
export function normalizeUniversalCategory(cat: string): ProductionElementType {
  const c = (cat || "").toLowerCase().trim();
  if (c.includes("char") || c.includes("شخص")) return "CHARACTER";
  if (c.includes("weap") || c.includes("سلاح") || c.includes("sword") || c.includes("blade") || c.includes("shard")) return "WEAPON";
  if (c.includes("creat") || c.includes("وحش") || c.includes("مخلوق") || c.includes("spider") || c.includes("beast")) return "CREATURE";
  if (c.includes("item") || c.includes("prop") || c.includes("أداة") || c.includes("غرض") || c.includes("عنصر") || c.includes("web") || c.includes("nest")) return "ITEM";
  if (c.includes("build") || c.includes("monum") || c.includes("مبنى") || c.includes("تمثال") || c.includes("قصر") || c.includes("قلعة")) return "BUILDING";
  if (c.includes("vehic") || c.includes("مركبة") || c.includes("عربة") || c.includes("سفينة")) return "VEHICLE";
  if (c.includes("cost") || c.includes("ملابس") || c.includes("درع")) return "COSTUME";
  if (c.includes("anim") || c.includes("حيوان")) return "ANIMAL";
  return "ITEM";
}

/**
 * Converts a Universal Production JSON into Studio Production Elements, Locations, and Scenes
 * STRICTLY applying target_step distribution:
 * - "production_elements" -> production_elements
 * - "locations" -> locations
 * - invalid/missing -> held in unassigned error state without guessing!
 */
export function convertUniversalJsonToStudio(universal: UniversalProductionJson): {
  production_elements: StudioProductionElement[];
  locations: StudioLocationItem[];
  scenes: StudioSceneItem[];
  events: UniversalEventItem[];
  reference_sheets: UniversalReferenceSheet[];
  validation_report: UniversalValidationReport;
  story?: Record<string, any>;
  style?: UniversalStyleSettings;
  pipeline_settings?: Record<string, any>;
  pages?: any[];
} {
  const report = validateUniversalProductionJson(universal);
  const production_elements: StudioProductionElement[] = [];
  const locations: StudioLocationItem[] = [];

  const entities = Array.isArray(universal.entities) ? universal.entities : [];
  const rawSheets = Array.isArray(universal.reference_sheets) ? universal.reference_sheets : [];
  const sheets: UniversalReferenceSheet[] = rawSheets.map((s) => ({
    ...s,
    title: s.title || s.name || `لوحة ${s.id}`,
    name: s.name || s.title || `لوحة ${s.id}`,
  }));

  // Map sheets by ID for fast lookup
  const sheetMap = new Map<string, UniversalReferenceSheet>();
  sheets.forEach((s) => sheetMap.set(s.id, s));

  entities.forEach((ent) => {
    const parentSheet = sheetMap.get(ent.reference_sheet_id);

    if (ent.target_step === "production_elements") {
      const cat = normalizeUniversalCategory(ent.type);
      const resolvedVisualPrompt =
        ent.visual_prompt ||
        ent.reference_prompt ||
        ent.base_reference_prompt ||
        ent.visual_details ||
        ent.description ||
        parentSheet?.visual_prompt ||
        parentSheet?.reference_prompt ||
        "";
      const resolvedDetails =
        ent.visual_details ||
        ent.visual_description ||
        ent.description ||
        ent.visual_prompt ||
        "";
      production_elements.push({
        ...(ent as any),
        id: ent.id,
        entity_id: ent.id,
        name: ent.name,
        category: cat,
        description: ent.description || resolvedDetails || `عنصر إنتاج ${ent.name}`,
        visual_details: resolvedDetails || resolvedVisualPrompt,
        canonical_description: resolvedDetails || resolvedVisualPrompt,
        visual_prompt: resolvedVisualPrompt,
        base_reference_prompt: ent.base_reference_prompt || resolvedVisualPrompt,
        reference_prompt: ent.reference_prompt || resolvedVisualPrompt,
        assembled_flow_prompt: resolvedVisualPrompt,
        current_prompt: resolvedVisualPrompt,
        immutable_constraints:
          ent.immutable_constraints || ent.visual_constraints || [ent.name],
        canonical_name: ent.canonical_name || ent.name,
        target_step: "production_elements",
        reference_sheet_id: ent.reference_sheet_id,
        attached_to:
          ent.attached_to !== undefined
            ? ent.attached_to
            : ent.owner_id !== undefined
            ? ent.owner_id
            : parentSheet && parentSheet.member_ids[0] !== ent.id
            ? parentSheet.member_ids[0]
            : null,
        reference_image_url: ent.reference_image_url || parentSheet?.reference_image_url || null,
        local_file_path: ent.local_file_path || parentSheet?.local_file_path || null,
        status: (ent.status || parentSheet?.status || "DRAFT") as any,
        approved: Boolean(ent.approved || parentSheet?.approved),
        locked_for_production: Boolean(ent.locked_for_production || parentSheet?.is_locked),
      });
    } else if (ent.target_step === "locations") {
      const resolvedLocPrompt =
        ent.visual_prompt ||
        ent.visual_reference_prompt ||
        ent.reference_prompt ||
        ent.base_reference_prompt ||
        ent.visual_details ||
        ent.visual_description ||
        ent.description ||
        parentSheet?.visual_prompt ||
        parentSheet?.reference_prompt ||
        `${ent.name} environment`;
      const resolvedLocDesc =
        ent.visual_description ||
        ent.visual_details ||
        ent.description ||
        resolvedLocPrompt;
      locations.push({
        ...(ent as any),
        location_id: ent.id,
        entity_id: ent.id,
        name: ent.name,
        type: (ent.location_type as any) || "EXTERIOR",
        description: ent.description || resolvedLocDesc || `موقع ${ent.name}`,
        visual_description: resolvedLocDesc,
        canonical_description: resolvedLocDesc,
        visual_prompt: resolvedLocPrompt,
        reference_prompt: ent.reference_prompt || resolvedLocPrompt,
        base_reference_prompt: ent.base_reference_prompt || resolvedLocPrompt,
        visual_reference_prompt: resolvedLocPrompt,
        assembled_flow_prompt: resolvedLocPrompt,
        current_prompt: resolvedLocPrompt,
        lighting_and_atmosphere: ent.lighting_and_atmosphere || "Natural atmospheric lighting",
        color_palette: ent.color_palette,
        textures: ent.textures,
        key_components: ent.key_components,
        immutable_elements:
          ent.immutable_constraints || ent.visual_constraints || [ent.name],
        target_step: "locations",
        reference_sheet_id: ent.reference_sheet_id,
        reference_image_url: ent.reference_image_url || parentSheet?.reference_image_url || null,
        local_file_path: ent.local_file_path || parentSheet?.local_file_path || null,
        status: (ent.status || parentSheet?.status || "DRAFT") as any,
        approved: Boolean(ent.approved || parentSheet?.approved),
        locked_for_production: Boolean(ent.locked_for_production || parentSheet?.is_locked),
      });
    }
    // If target_step is missing or invalid, do NOT guess or add to either list! It will be reported in report.errors!
  });

  const locMap = new Map<string, StudioLocationItem>();
  locations.forEach((l) => locMap.set(l.location_id, l));
  const elemMap = new Map<string, StudioProductionElement>();
  production_elements.forEach((e) => elemMap.set(e.id, e));

  const rawEvents: any[] = Array.isArray(universal.events)
    ? universal.events
    : Array.isArray((universal.story as any)?.events)
    ? (universal.story as any).events
    : [];

  const events: UniversalEventItem[] = rawEvents.map((ev: any, idx: number) => ({
    ...ev,
    id: ev.id || ev.event_id || `EVENT_${String(idx + 1).padStart(3, "0")}`,
    event_id: ev.event_id || ev.id || `EVENT_${String(idx + 1).padStart(3, "0")}`,
    event_number: Number(ev.event_number || ev.order || idx + 1),
    title: ev.title || ev.event_title || `الحدث ${idx + 1}`,
    event_title: ev.event_title || ev.title || `الحدث ${idx + 1}`,
    description: ev.description || ev.summary || "",
    summary: ev.summary || ev.description || "",
    scene_id: ev.scene_id || ev.mapped_scene_id,
    mapped_scene_id: ev.mapped_scene_id || ev.scene_id,
    location_id: ev.location_id,
    character_ids: ev.character_ids || [],
    weapon_ids: ev.weapon_ids || [],
    creature_ids: ev.creature_ids || [],
    item_ids: ev.item_ids || [],
  }));

  // Convert scenes
  const rawScenes = Array.isArray(universal.scenes)
    ? universal.scenes
    : Array.isArray((universal.story as any)?.scenes)
    ? (universal.story as any).scenes
    : [];

  const scenes: StudioSceneItem[] = rawScenes.map((s: any, idx: number) => {
    const sceneId = s.scene_id || s.id || `SCENE_${String(idx + 1).padStart(3, "0")}`;
    const resolvedLocId =
      s.location_id || (Array.isArray(s.location_ids) && s.location_ids[0]) || locations[0]?.location_id || "";
    const matchedLoc = locMap.get(resolvedLocId);
    const resolvedLocName = s.location_name || matchedLoc?.name || resolvedLocId || "الموقع المحدد";

    const charIds: string[] = Array.isArray(s.character_ids) ? s.character_ids : [];
    const weaponIds: string[] = Array.isArray(s.weapon_ids)
      ? [...s.weapon_ids]
      : (Array.isArray(s.item_ids) ? s.item_ids : []).filter(
          (id: string) => id.startsWith("WEAPON_") || elemMap.get(id)?.category === "WEAPON"
        );
    const creatureIds: string[] = Array.isArray(s.creature_ids)
      ? [...s.creature_ids]
      : (Array.isArray(s.item_ids) ? s.item_ids : []).filter(
          (id: string) => id.startsWith("CREATURE_") || elemMap.get(id)?.category === "CREATURE"
        );
    const itemIds: string[] = (Array.isArray(s.item_ids) ? s.item_ids : []).filter(
      (id: string) => !weaponIds.includes(id) && !creatureIds.includes(id)
    );

    const charNames = charIds.map((cid) => elemMap.get(cid)?.name || cid);
    const weaponNames = weaponIds.map((wid) => elemMap.get(wid)?.name || wid);
    const creatureNames = creatureIds.map((crid) => elemMap.get(crid)?.name || crid);
    const itemNames = itemIds.map((iid) => elemMap.get(iid)?.name || iid);

    const eventIds: string[] = Array.isArray(s.event_ids)
      ? s.event_ids
      : s.event_id
      ? [s.event_id]
      : events.filter((e) => e.scene_id === sceneId || e.mapped_scene_id === sceneId).map((e) => e.event_id);

    return {
      ...s,
      scene_id: sceneId,
      scene_number: s.scene_number || idx + 1,
      scene_order: s.scene_number || idx + 1,
      title: s.title || `المشهد ${idx + 1}`,
      description: s.description || "",
      event_ids: eventIds,
      characters: Array.isArray(s.characters) && s.characters.length > 0 ? s.characters : charNames,
      weapons: weaponNames,
      creatures: creatureNames,
      items: itemNames,
      costumes_and_weapons: [...weaponNames, ...creatureNames, ...itemNames],
      location: resolvedLocName,
      location_id: resolvedLocId,
      primary_location_id: resolvedLocId,
      location_entity_id: resolvedLocId,
      location_name: resolvedLocName,
      location_ids: Array.isArray(s.location_ids) && s.location_ids.length > 0 ? s.location_ids : resolvedLocId ? [resolvedLocId] : [],
      character_ids: charIds,
      weapon_ids: weaponIds,
      creature_ids: creatureIds,
      item_ids: itemIds,
      visual_bible_ids: Array.from(new Set([...charIds, ...weaponIds, ...creatureIds, ...itemIds, ...(resolvedLocId ? [resolvedLocId] : [])])),
      action: s.action || s.description || "",
      dialogue: s.dialogue || "",
      sfx: s.sfx || "",
      camera_angle: (s.camera_angle as any) || "EYE_LEVEL",
      shot_type: (s.shot_type as any) || "MEDIUM",
      visual_prompt: s.visual_prompt || `${s.description}. High quality cinematic manhwa style.`,
      previous_scene_id: s.previous_scene_id !== undefined ? s.previous_scene_id : idx > 0 ? `SCENE_${String(idx).padStart(3, "0")}` : null,
      shots_panels: s.shots_panels || s.panels || [],
      image_url: s.image_url || null,
      local_file_path: s.local_file_path || null,
      approved: Boolean(s.approved),
    };
  });

  return {
    production_elements,
    locations,
    scenes,
    events,
    reference_sheets: sheets,
    validation_report: report,
    story: universal.story,
    style: universal.style,
    pipeline_settings: universal.pipeline_settings,
    pages: universal.pages || universal.manhwa_pages || (universal as any).page_plans,
  };
}

/**
 * Exports current Studio state into a compliant Universal Production JSON (Schema 1.0)
 */
export function exportStudioToUniversalJson(studioState: {
  projectId?: string;
  project_id?: string;
  novelId?: string;
  novel_id?: string;
  novelTitle?: string;
  novel_title?: string;
  novelText?: string;
  novel_text?: string;
  scriptText?: string;
  script_text?: string;
  story?: Record<string, any>;
  style?: UniversalStyleSettings;
  pipelineSettings?: Record<string, any>;
  pipeline_settings?: Record<string, any>;
  productionElements?: StudioProductionElement[];
  production_elements?: StudioProductionElement[];
  locations?: StudioLocationItem[];
  scenes?: StudioSceneItem[];
  events?: any[];
  pages?: any[];
  referenceSheets?: UniversalReferenceSheet[];
  reference_sheets?: UniversalReferenceSheet[];
}): UniversalProductionJson {
  const elements = studioState.productionElements || studioState.production_elements || [];
  const locations = studioState.locations || [];
  const scenes = studioState.scenes || [];
  const events = studioState.events || [];
  const pages = studioState.pages || [];
  const explicitSheets = studioState.referenceSheets || studioState.reference_sheets || [];

  const entities: UniversalNovelEntity[] = [];
  const generatedSheets: UniversalReferenceSheet[] = explicitSheets.map((s) => ({
    ...s,
    title: s.title || s.name || `لوحة ${s.id}`,
    name: s.name || s.title || `لوحة ${s.id}`,
    member_ids: Array.isArray(s.member_ids) ? [...s.member_ids] : [],
  }));
  const sheetIds = new Set(generatedSheets.map((s) => s.id));

  // Export production elements
  elements.forEach((el) => {
    let sheetId = el.reference_sheet_id;
    if (!sheetId) {
      sheetId = el.attached_to ? `SHEET_${el.attached_to}` : `SHEET_${el.id}`;
    }

    if (!sheetIds.has(sheetId)) {
      generatedSheets.push({
        id: sheetId,
        target_step: "production_elements",
        title: `لوحة تصميم: ${el.name}`,
        name: `لوحة تصميم: ${el.name}`,
        member_ids: [el.id],
        visual_prompt: el.assembled_flow_prompt || el.reference_prompt || el.visual_details,
        reference_prompt: el.reference_prompt || el.assembled_flow_prompt || el.visual_details,
        reference_image_url: el.reference_image_url,
        local_file_path: el.local_file_path,
        status: el.status,
        approved: el.approved,
        is_locked: el.locked_for_production,
      });
      sheetIds.add(sheetId);
    } else {
      const existingSheet = generatedSheets.find((s) => s.id === sheetId);
      if (existingSheet && !existingSheet.member_ids.includes(el.id)) {
        existingSheet.member_ids.push(el.id);
      }
    }

    entities.push({
      id: el.id,
      type: (el.category || "item").toLowerCase(),
      name: el.name,
      description: el.description,
      visual_details: el.visual_details || el.canonical_description,
      visual_prompt: el.assembled_flow_prompt || el.reference_prompt || el.base_reference_prompt || el.visual_details || el.description,
      reference_prompt: el.reference_prompt || el.assembled_flow_prompt,
      base_reference_prompt: el.base_reference_prompt || el.canonical_description,
      immutable_constraints: el.immutable_constraints,
      attached_to: el.attached_to,
      target_step: "production_elements",
      reference_sheet_id: sheetId,
      reference_image_url: el.reference_image_url,
      local_file_path: el.local_file_path,
      status: el.status,
      approved: el.approved,
      locked_for_production: el.locked_for_production,
    });
  });

  // Export locations
  locations.forEach((loc) => {
    let sheetId = loc.reference_sheet_id;
    if (!sheetId) {
      sheetId = `SHEET_${loc.location_id}`;
    }

    if (!sheetIds.has(sheetId)) {
      generatedSheets.push({
        id: sheetId,
        target_step: "locations",
        title: `لوحة موقع: ${loc.name}`,
        name: `لوحة موقع: ${loc.name}`,
        member_ids: [loc.location_id],
        visual_prompt: loc.assembled_flow_prompt || loc.visual_reference_prompt || loc.visual_description,
        reference_prompt: loc.visual_reference_prompt || loc.assembled_flow_prompt,
        reference_image_url: loc.reference_image_url,
        local_file_path: loc.local_file_path,
        status: loc.status,
        approved: loc.approved,
        is_locked: loc.status === "LOCKED" || Boolean((loc as any).locked_for_production),
      });
      sheetIds.add(sheetId);
    } else {
      const existingSheet = generatedSheets.find((s) => s.id === sheetId);
      if (existingSheet && !existingSheet.member_ids.includes(loc.location_id)) {
        existingSheet.member_ids.push(loc.location_id);
      }
    }

    entities.push({
      id: loc.location_id,
      type: "location",
      location_type: loc.type,
      name: loc.name,
      description: loc.description,
      visual_details: loc.visual_description || loc.description,
      visual_description: loc.visual_description || loc.description,
      visual_prompt: loc.visual_reference_prompt || loc.assembled_flow_prompt || loc.visual_description || loc.description,
      visual_reference_prompt: loc.visual_reference_prompt || loc.assembled_flow_prompt,
      lighting_and_atmosphere: loc.lighting_and_atmosphere,
      color_palette: loc.color_palette,
      textures: loc.textures,
      key_components: loc.key_components,
      immutable_constraints: loc.immutable_elements,
      target_step: "locations",
      reference_sheet_id: sheetId,
      reference_image_url: loc.reference_image_url,
      local_file_path: loc.local_file_path,
      status: loc.status,
      approved: loc.approved,
      locked_for_production: loc.status === "LOCKED" || Boolean((loc as any).locked_for_production),
    });
  });

  const universalJson: UniversalProductionJson = {
    schema_version: "1.0",
    project_id: studioState.projectId || studioState.project_id,
    novel: {
      id: studioState.novelId || studioState.novel_id || "NOVEL_001",
      title: studioState.novelTitle || studioState.novel_title || "Untitled Novel",
      novel_text: studioState.novelText || studioState.novel_text,
      script_text: studioState.scriptText || studioState.script_text,
    },
    ...(studioState.story ? { story: studioState.story } : {}),
    ...(studioState.style ? { style: studioState.style } : {}),
    ...(studioState.pipelineSettings || studioState.pipeline_settings
      ? { pipeline_settings: studioState.pipelineSettings || studioState.pipeline_settings }
      : {}),
    entities,
    reference_sheets: generatedSheets,
    ...(events.length > 0 ? { events } : {}),
    scenes: scenes.map((s, idx) => ({
      id: s.scene_id || `SCENE_${String(idx + 1).padStart(3, "0")}`,
      scene_id: s.scene_id || `SCENE_${String(idx + 1).padStart(3, "0")}`,
      scene_number: s.scene_number || idx + 1,
      title: s.title || `المشهد ${idx + 1}`,
      description: s.description || "",
      event_ids: s.event_ids,
      location_id: s.location_id,
      location_name: s.location_name,
      location_ids: s.location_ids,
      character_ids: s.character_ids,
      weapon_ids: s.weapon_ids,
      creature_ids: s.creature_ids,
      item_ids: s.item_ids,
      action: s.action,
      dialogue: s.dialogue,
      sfx: s.sfx,
      camera_angle: s.camera_angle,
      shot_type: s.shot_type,
      visual_prompt: s.visual_prompt,
      previous_scene_id: s.previous_scene_id,
      shots_panels: s.shots_panels,
    })),
    ...(pages.length > 0 ? { pages } : {}),
  };

  universalJson.validation_report = validateUniversalProductionJson(universalJson);
  return universalJson;
}

export const convertUniversalJsonToStudioState = convertUniversalJsonToStudio;
export const exportStudioStateToUniversalJson = exportStudioToUniversalJson;
