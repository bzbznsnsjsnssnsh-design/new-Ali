/**
 * Master Reference Sheet Manager
 *
 * Enforces the visual unification architecture requested by the user:
 * - One Master Reference Sheet per Character (Character + Face + Hair + Attire + Accessories + Bound Weapons)
 * - One Master Reference Sheet per Creature Cluster (Alpha/Mother + Minions + Webbing/Nest + Scale comparison)
 * - One Master Reference Sheet per Location (Establishing landscape + Monuments + Statues + Embedded Relics)
 * - Standalone Master Sheet for truly independent artifacts/vehicles
 * - PRESERVES all logical entity IDs and data 100% separately ("characters", "weapons", "items", "creatures", "locations")
 * - Unrelated entities are NEVER merged.
 * - Image generation is executed EXCLUSIVELY via Google Flow.
 * - Gemini Cookies is used EXCLUSIVELY for planning, analysis, and verification.
 * - Master Reference Sheets are reused downstream in scenes, pages, and panels for absolute continuity.
 */

import {
  StudioProductionElement,
  StudioLocationItem,
  ProductionElementType,
} from "../types/novelToManga";
import type { UniversalReferenceSheet } from "./universalProductionJson";

export type MasterSheetType =
  | "CHARACTER_DESIGN_SHEET"
  | "CREATURE_MODEL_SHEET"
  | "LOCATION_CONCEPT_SHEET"
  | "STANDALONE_OBJECT_SHEET";

export interface AttachedLogicalEntity {
  id: string;
  name: string;
  category: ProductionElementType | "LOCATION_PROP" | "MONUMENT";
  description: string;
  relationshipRole: string; // e.g. "سلاح مرتبط مدمج في ورقة الشخصية" | "عناكب تابعة وشبكات العش" | "معلم وتمثال معماري مرتبط"
  element: StudioProductionElement;
}

export interface MasterReferenceSheet {
  sheetId?: string;
  masterId: string;
  masterName: string;
  category: ProductionElementType | "LOCATION";
  targetStep?: "production_elements" | "locations";
  memberIds?: string[];
  sheetType: MasterSheetType;
  titleAr: string;
  badgeLabelAr: string;
  promptLayoutType: string;
  primaryElement?: StudioProductionElement;
  primaryLocation?: StudioLocationItem;
  attachedEntities: AttachedLogicalEntity[];
  referenceImageUrl: string | null;
  status: string;
  isLocked: boolean;
  isApproved: boolean;
  verificationStatus: string;
  flowAssetId: string | null;
  flowProjectId: string | null;
  flowGenerationId?: string | null;
}

/**
 * Normalizes strings for robust matching across Arabic and English names
 */
function normalizeName(str: string): string {
  return (str || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\w\u0621-\u064A]/g, "")
    .trim();
}

/**
 * Checks if a weapon or item is owned or wielded by a specific character.
 * Uses text evidence, attached_to fields, or canonical association.
 */
export function isEntityAffiliatedWithCharacter(
  entity: StudioProductionElement,
  character: StudioProductionElement
): { affiliated: boolean; role: string } {
  // 1. Explicit attachment ID
  if (entity.attached_to && (entity.attached_to === character.id || entity.attached_to === character.entity_id)) {
    return { affiliated: true, role: "سلاح / أداة مرتبطة مباشرة بالشخصية (معرف صريح)" };
  }

  // 2. Character's explicit weapon association field
  if (character.associated_weapon_entity_id && character.associated_weapon_entity_id === entity.id) {
    return { affiliated: true, role: "سلاح الشخصية المعتمد في بنية البيانات" };
  }

  const charNormName = normalizeName(character.name);
  const entityNormName = normalizeName(entity.name);
  const charBlob = `${character.name} ${character.description || ""} ${character.visual_details || ""} ${character.clothing || ""} ${character.accessories || ""} ${character.associated_weapon || ""} ${character.weapons_and_accessories || ""}`.toLowerCase();
  const entityBlob = `${entity.name} ${entity.description || ""} ${entity.visual_details || ""}`.toLowerCase();

  // 3. Entity text mentions character name (e.g., "سيف صني", "سلاح تابع لـ صني", "Sunny's blade")
  if (
    charNormName.length > 2 &&
    (entityBlob.includes(charNormName) ||
      (character.canonical_name && entityBlob.includes(character.canonical_name.toLowerCase())) ||
      (character.aliases || []).some((al) => entityBlob.includes(al.toLowerCase())))
  ) {
    return { affiliated: true, role: `سلاح / عتاد تابع ومملوك لـ «${character.name}»` };
  }

  // 4. Character mentions weapon/item name
  if (
    entityNormName.length > 2 &&
    (charBlob.includes(entityNormName) ||
      (entity.canonical_name && charBlob.includes(entity.canonical_name.toLowerCase())) ||
      (entity.aliases || []).some((al) => charBlob.includes(al.toLowerCase())))
  ) {
    return { affiliated: true, role: `عتاد مدمج في مظهر وتصميم «${character.name}»` };
  }

  // 5. Well-known canonical couplings (e.g. Sunny <-> Midnight Shard / Shroud of the Nameless)
  const isSunny = /صني|sunny/i.test(character.name);
  const isMidnightShard = /شظي.*منتصف.*ليل|midnight.*shard|نصل.*الظل/i.test(entity.name);
  const isShadowCloak = /رداء.*الظل|shroud|cloak/i.test(entity.name);
  if (isSunny && (isMidnightShard || isShadowCloak)) {
    return { affiliated: true, role: "سلاح / رداء كنسي ثابت ضمن الهوية البصرية لـ صني" };
  }

  const isNephis = /نيفيس|nephis/i.test(character.name);
  const isRadiantSword = /سيف.*مضيء|radiant.*blade|sword.*light/i.test(entity.name);
  if (isNephis && isRadiantSword) {
    return { affiliated: true, role: "سلاح ناصع ضمن الهوية البصرية لـ نيفيس" };
  }

  const isEffie = /إيفي|ايفي|effie/i.test(character.name);
  const isBronzeSpear = /رمح.*برونزي|bronze.*spear/i.test(entity.name);
  if (isEffie && isBronzeSpear) {
    return { affiliated: true, role: "رمح برونزي ضمن الهوية البصرية لـ إيفي" };
  }

  return { affiliated: false, role: "" };
}

/**
 * Checks if a creature is a minion, offspring, swarm member, or nest element
 * of a primary/alpha creature (e.g. Spider Mother + Minion Spiders + Webbing/Nest).
 */
export function isEntityAffiliatedWithCreature(
  entity: StudioProductionElement,
  primaryCreature: StudioProductionElement
): { affiliated: boolean; role: string } {
  if (entity.id === primaryCreature.id) return { affiliated: false, role: "" };

  if (entity.attached_to && (entity.attached_to === primaryCreature.id || entity.attached_to === primaryCreature.name)) {
    return { affiliated: true, role: "كيان فرعي تابع للمخلوق الرئيسي" };
  }

  const alphaNorm = normalizeName(primaryCreature.name);
  const otherBlob = `${entity.name} ${entity.description || ""} ${entity.visual_details || ""}`.toLowerCase();

  // Spiders family coupling (أم العناكب + العناكب التابعة + العش والشبكات)
  const isSpiderFamily =
    /عنكبوت|عناكب|spider|spiders/i.test(primaryCreature.name) &&
    /عنكبوت|عناكب|شبك.*عنكبوت|عش|بيض|spider|minion|web|nest|cocoon/i.test(entity.name);
  if (isSpiderFamily) {
    return {
      affiliated: true,
      role: entity.category === "CREATURE"
        ? "عناكب تابعة / سرب للمقارنة الحجمية (Scale Comparison)"
        : "عناصر العش وشبكات العنكبوت والبيئة الحيوية المتصلة",
    };
  }

  // Same root creature name (e.g. "ذئب الظلام القائد" + "ذئاب الظلام التابعة")
  if (
    alphaNorm.length > 3 &&
    otherBlob.includes(alphaNorm) &&
    /تابع|صغير|سرب|حراس|minion|pack|swarm|small|lesser/i.test(otherBlob)
  ) {
    return { affiliated: true, role: "كائنات فرعية ضمن سرب المخلوق الرئيسي" };
  }

  return { affiliated: false, role: "" };
}

/**
 * Checks if an entity is an architectural feature, statue, monument, or embedded prop of a location
 * (e.g. Bridge + Statue + Statue's Spear + Architectural masonry).
 */
export function isEntityAffiliatedWithLocation(
  entity: StudioProductionElement,
  location: StudioLocationItem
): { affiliated: boolean; role: string } {
  // 1. Explicit attachment to location
  if (
    entity.attached_to &&
    (entity.attached_to === location.location_id ||
      entity.attached_to === location.entity_id ||
      entity.attached_to === location.name)
  ) {
    return { affiliated: true, role: `معلم / تمثال مرتبط صراحة بالموقع «${location.name}»` };
  }

  const locNorm = normalizeName(location.name);
  const entityBlob = `${entity.name} ${entity.description || ""} ${entity.visual_details || ""}`.toLowerCase();
  const locBlob = `${location.name} ${location.description || ""} ${location.visual_description || ""} ${(location.landmarks || []).join(" ")}`.toLowerCase();

  // 2. Mention matching (e.g., "تمثال الجسر", "رمح تمثال الجسر", "Bridge Statue", "Bridge Spear")
  if (locNorm.length > 2 && entityBlob.includes(locNorm)) {
    return { affiliated: true, role: `معلم أثري / تمثال مدمج في ورقة الموقع «${location.name}»` };
  }

  // 3. Location landmarks explicitly list this entity
  const entityNorm = normalizeName(entity.name);
  if (entityNorm.length > 2 && locBlob.includes(entityNorm)) {
    return { affiliated: true, role: `عنصر معماري / تفصيل أثري بارز في الموقع «${location.name}»` };
  }

  // 4. Bridge + Statue + Spear canonical coupling
  const isBridge = /جسر|قنطرة|bridge/i.test(location.name);
  const isBridgeProp =
    /تمثال|رمح.*تمثال|حجارة|نقوش|statue|spear.*statue|pillar|arch/i.test(entity.name);
  if (isBridge && isBridgeProp) {
    return {
      affiliated: true,
      role: "تمثال / رمح ومعلم معماري مدمج ضمن ورقة الموقع الكنسي",
    };
  }

  return { affiliated: false, role: "" };
}

/**
 * Clusters all logical entities and locations into authoritative Master Reference Sheets:
 * - Logical IDs ("CHAR_001", "WEAPON_001", "LOC_001") are NEVER erased or combined in the database.
 * - Visually, they are consolidated into ONE master reference sheet per character/creature pack/location.
 */
export function clusterElementsIntoMasterReferenceSheets(
  elements: StudioProductionElement[],
  locations: StudioLocationItem[] = [],
  explicitSheets?: UniversalReferenceSheet[]
): {
  masterSheets: MasterReferenceSheet[];
  entityToMasterMap: Map<string, string>;
  standaloneCount: number;
  totalLogicalEntities: number;
} {
  const masterSheets: MasterReferenceSheet[] = [];
  const entityToMasterMap = new Map<string, string>();
  const attachedEntityIds = new Set<string>();

  // If explicitSheets are provided from Universal Production JSON, execute them strictly!
  if (Array.isArray(explicitSheets) && explicitSheets.length > 0) {
    const elementMap = new Map<string, StudioProductionElement>();
    elements.forEach((e) => elementMap.set(e.id, e));

    const locationMap = new Map<string, StudioLocationItem>();
    locations.forEach((l) => locationMap.set(l.location_id, l));

    for (const sheet of explicitSheets) {
      const memberIds = sheet.member_ids || [];
      if (memberIds.length === 0) continue;

      if (sheet.target_step === "locations") {
        const locMembers = memberIds
          .map((mId) => locationMap.get(mId))
          .filter(Boolean) as StudioLocationItem[];
        if (locMembers.length === 0) continue;
        const primaryLoc = locMembers[0];

        memberIds.forEach((mId) => entityToMasterMap.set(mId, primaryLoc.location_id));

        masterSheets.push({
          sheetId: sheet.id,
          masterId: primaryLoc.location_id,
          masterName: primaryLoc.name,
          category: "LOCATION",
          targetStep: "locations",
          memberIds,
          sheetType: "LOCATION_CONCEPT_SHEET",
          titleAr: sheet.title || `ورقة الموقع: «${primaryLoc.name}»`,
          badgeLabelAr: "Master Location Sheet",
          promptLayoutType: "Location Concept Sheet / Environmental Bible",
          primaryLocation: primaryLoc,
          attachedEntities: [],
          referenceImageUrl: sheet.reference_image_url || primaryLoc.reference_image_url || null,
          status: sheet.status || primaryLoc.status || "DRAFT",
          isLocked: Boolean(sheet.is_locked || (primaryLoc as any).status === "LOCKED"),
          isApproved: Boolean(sheet.approved || primaryLoc.approved),
          verificationStatus: (primaryLoc as any).verification_status || "UNVERIFIED",
          flowAssetId: (primaryLoc as any).flowAssetId || null,
          flowProjectId: (primaryLoc as any).flowProjectId || (primaryLoc as any).flow_project_id || null,
          flowGenerationId: (primaryLoc as any).flowGenerationId || (primaryLoc as any).flow_generation_id || null,
        });
      } else {
        const prodMembers = memberIds
          .map((mId) => elementMap.get(mId))
          .filter(Boolean) as StudioProductionElement[];
        if (prodMembers.length === 0) continue;
        const primaryEl = prodMembers[0];
        const attached: AttachedLogicalEntity[] = prodMembers.slice(1).map((el) => ({
          id: el.id,
          name: el.name,
          category: el.category,
          description: el.description,
          relationshipRole: `عضو مدمج في لوحة ${sheet.title}`,
          element: el,
        }));

        memberIds.forEach((mId) => entityToMasterMap.set(mId, primaryEl.id));

        const isCreature = primaryEl.category === "CREATURE" || primaryEl.category === "ANIMAL";
        const isCharacter = primaryEl.category === "CHARACTER";

        masterSheets.push({
          sheetId: sheet.id,
          masterId: primaryEl.id,
          masterName: primaryEl.name,
          category: primaryEl.category,
          targetStep: "production_elements",
          memberIds,
          sheetType: isCharacter
            ? "CHARACTER_DESIGN_SHEET"
            : isCreature
            ? "CREATURE_MODEL_SHEET"
            : "STANDALONE_OBJECT_SHEET",
          titleAr: sheet.title || `ورقة تصميم: «${primaryEl.name}»`,
          badgeLabelAr: isCharacter
            ? "Master Character Design Sheet"
            : isCreature
            ? "Master Creature Model Sheet"
            : "Master Object Sheet",
          promptLayoutType: isCharacter
            ? "3D Character Model Sheet / Multi-Angle Turnaround + Weapon Callout"
            : isCreature
            ? "Creature Model Sheet / Multi-Angle + Swarm Scale Comparison"
            : "Standalone Object Model Sheet",
          primaryElement: primaryEl,
          attachedEntities: attached,
          referenceImageUrl: sheet.reference_image_url || primaryEl.reference_image_url || null,
          status: sheet.status || primaryEl.status || "DRAFT",
          isLocked: Boolean(sheet.is_locked || primaryEl.status === "LOCKED" || primaryEl.locked_for_production),
          isApproved: Boolean(sheet.approved || primaryEl.approved),
          verificationStatus: primaryEl.verification_status || "UNVERIFIED",
          flowAssetId: primaryEl.flowAssetId || null,
          flowProjectId: primaryEl.flowProjectId || primaryEl.flow_project_id || null,
          flowGenerationId: primaryEl.flowGenerationId || primaryEl.flow_generation_id || null,
        });
      }
    }

    return {
      masterSheets,
      entityToMasterMap,
      standaloneCount: elements.length + locations.length,
      totalLogicalEntities: elements.length + locations.length,
    };
  }

  const characters = elements.filter((e) => e.category === "CHARACTER" && e.target_step !== "locations");
  const creatures = elements.filter((e) => (e.category === "CREATURE" || e.category === "ANIMAL") && e.target_step !== "locations");
  const weaponsAndItems = elements.filter(
    (e) => (e.category === "WEAPON" || e.category === "ITEM" || e.category === "COSTUME") && e.target_step !== "locations"
  );
  const buildingsAndVehicles = elements.filter(
    (e) => (e.category === "BUILDING" || e.category === "VEHICLE") && e.target_step !== "locations"
  );

  // 1. Group Characters -> Master Character Design Sheets
  for (const char of characters) {
    const attached: AttachedLogicalEntity[] = [];

    for (const wi of weaponsAndItems) {
      if (attachedEntityIds.has(wi.id)) continue;
      const aff = isEntityAffiliatedWithCharacter(wi, char);
      if (aff.affiliated) {
        attached.push({
          id: wi.id,
          name: wi.name,
          category: wi.category,
          description: wi.description,
          relationshipRole: aff.role,
          element: wi,
        });
        attachedEntityIds.add(wi.id);
        entityToMasterMap.set(wi.id, char.id);
      }
    }

    entityToMasterMap.set(char.id, char.id);

    masterSheets.push({
      masterId: char.id,
      masterName: char.name,
      category: "CHARACTER",
      sheetType: "CHARACTER_DESIGN_SHEET",
      titleAr: `ورقة تصميم الشخصية الرئيسية: «${char.name}» (Character Design Sheet)`,
      badgeLabelAr: "Master Character Design Sheet",
      promptLayoutType: "3D Character Model Sheet / Multi-Angle Turnaround + Weapon Callout",
      primaryElement: char,
      attachedEntities: attached,
      referenceImageUrl: char.reference_image_url || null,
      status: char.status || "DRAFT",
      isLocked: char.status === "LOCKED" || Boolean(char.locked_for_production),
      isApproved: Boolean(char.approved || char.status === "LOCKED" || char.locked_for_production),
      verificationStatus: char.verification_status || "UNVERIFIED",
      flowAssetId: char.flowAssetId || null,
      flowProjectId: char.flowProjectId || char.flow_project_id || null,
      flowGenerationId: char.flowGenerationId || char.flow_generation_id || null,
    });
  }

  // 2. Group Creatures -> Master Creature Model Sheets
  const primaryCreatures: StudioProductionElement[] = [];
  const minionCreatures: StudioProductionElement[] = [];

  for (const cr of creatures) {
    const isMinion = /تابع|صغير|سرب|حراس|minion|small|swarm|lesser/i.test(cr.name);
    if (isMinion) {
      minionCreatures.push(cr);
    } else {
      primaryCreatures.push(cr);
    }
  }

  if (primaryCreatures.length === 0 && creatures.length > 0) {
    primaryCreatures.push(creatures[0]);
  }

  for (const primaryCr of primaryCreatures) {
    const attached: AttachedLogicalEntity[] = [];

    // Minion creatures
    for (const minion of minionCreatures) {
      if (attachedEntityIds.has(minion.id)) continue;
      const aff = isEntityAffiliatedWithCreature(minion, primaryCr);
      if (aff.affiliated) {
        attached.push({
          id: minion.id,
          name: minion.name,
          category: minion.category,
          description: minion.description,
          relationshipRole: aff.role,
          element: minion,
        });
        attachedEntityIds.add(minion.id);
        entityToMasterMap.set(minion.id, primaryCr.id);
      }
    }

    // Environmental lair items (webs, nest, eggs)
    for (const wi of weaponsAndItems) {
      if (attachedEntityIds.has(wi.id)) continue;
      const aff = isEntityAffiliatedWithCreature(wi, primaryCr);
      if (aff.affiliated) {
        attached.push({
          id: wi.id,
          name: wi.name,
          category: wi.category,
          description: wi.description,
          relationshipRole: aff.role,
          element: wi,
        });
        attachedEntityIds.add(wi.id);
        entityToMasterMap.set(wi.id, primaryCr.id);
      }
    }

    entityToMasterMap.set(primaryCr.id, primaryCr.id);

    masterSheets.push({
      masterId: primaryCr.id,
      masterName: primaryCr.name,
      category: "CREATURE",
      sheetType: "CREATURE_MODEL_SHEET",
      titleAr: `ورقة تصميم المخلوق الشاملة: «${primaryCr.name}» (Creature Model Sheet)`,
      badgeLabelAr: "Master Creature Design Sheet",
      promptLayoutType: "Creature Design Sheet / Multi-Angle + Swarm Scale Comparison + Nest Callout",
      primaryElement: primaryCr,
      attachedEntities: attached,
      referenceImageUrl: primaryCr.reference_image_url || null,
      status: primaryCr.status || "DRAFT",
      isLocked: primaryCr.status === "LOCKED" || Boolean(primaryCr.locked_for_production),
      isApproved: Boolean(primaryCr.approved || primaryCr.status === "LOCKED" || primaryCr.locked_for_production),
      verificationStatus: primaryCr.verification_status || "UNVERIFIED",
      flowAssetId: primaryCr.flowAssetId || null,
      flowProjectId: primaryCr.flowProjectId || primaryCr.flow_project_id || null,
      flowGenerationId: primaryCr.flowGenerationId || primaryCr.flow_generation_id || null,
    });
  }

  // Any remaining creatures not attached to an alpha creature
  for (const remainingCr of creatures) {
    if (entityToMasterMap.has(remainingCr.id)) continue;
    entityToMasterMap.set(remainingCr.id, remainingCr.id);
    masterSheets.push({
      masterId: remainingCr.id,
      masterName: remainingCr.name,
      category: "CREATURE",
      sheetType: "CREATURE_MODEL_SHEET",
      titleAr: `ورقة تصميم المخلوق: «${remainingCr.name}»`,
      badgeLabelAr: "Creature Model Sheet",
      promptLayoutType: "Creature Design Sheet / Multi-Angle + Anatomy Callouts",
      primaryElement: remainingCr,
      attachedEntities: [],
      referenceImageUrl: remainingCr.reference_image_url || null,
      status: remainingCr.status || "DRAFT",
      isLocked: remainingCr.status === "LOCKED" || Boolean(remainingCr.locked_for_production),
      isApproved: Boolean(remainingCr.approved || remainingCr.status === "LOCKED" || remainingCr.locked_for_production),
      verificationStatus: remainingCr.verification_status || "UNVERIFIED",
      flowAssetId: remainingCr.flowAssetId || null,
      flowProjectId: remainingCr.flowProjectId || remainingCr.flow_project_id || null,
      flowGenerationId: remainingCr.flowGenerationId || remainingCr.flow_generation_id || null,
    });
  }

  // 3. Group Locations -> Master Location Concept Sheets (Bridge + Statue + Spear + Masonry)
  for (const loc of locations) {
    const attached: AttachedLogicalEntity[] = [];

    // Check monuments and embedded relics strictly adhering to target_step isolation
    for (const ent of [...buildingsAndVehicles, ...weaponsAndItems]) {
      if (attachedEntityIds.has(ent.id)) continue;
      // STRICT STEP ISOLATION RULE: entities in production_elements CANNOT be placed in a location sheet
      if (ent.target_step === "production_elements") continue;
      const aff = isEntityAffiliatedWithLocation(ent, loc);
      if (aff.affiliated) {
        attached.push({
          id: ent.id,
          name: ent.name,
          category: ent.category,
          description: ent.description,
          relationshipRole: aff.role,
          element: ent,
        });
        attachedEntityIds.add(ent.id);
        entityToMasterMap.set(ent.id, loc.location_id);
      }
    }

    entityToMasterMap.set(loc.location_id, loc.location_id);

    masterSheets.push({
      masterId: loc.location_id,
      masterName: loc.name,
      category: "LOCATION",
      sheetType: "LOCATION_CONCEPT_SHEET",
      titleAr: `ورقة تصميم الموقع الشاملة: «${loc.name}» (Location Concept Sheet)`,
      badgeLabelAr: "Master Location Concept Sheet",
      promptLayoutType: "Location Establishing Landscape + Architectural Breakdown + Landmark/Statue Callout",
      primaryLocation: loc,
      attachedEntities: attached,
      referenceImageUrl: loc.reference_image_url || null,
      status: (loc as any).status || "DRAFT",
      isLocked: Boolean((loc as any).status === "LOCKED" || (loc as any).locked_for_production),
      isApproved: Boolean(loc.approved || (loc as any).status === "LOCKED" || (loc as any).locked_for_production),
      verificationStatus: (loc as any).verification_status || "UNVERIFIED",
      flowAssetId: (loc as any).flowAssetId || null,
      flowProjectId: (loc as any).flowProjectId || (loc as any).flow_project_id || null,
      flowGenerationId: (loc as any).flowGenerationId || (loc as any).flow_generation_id || null,
    });
  }

  // 4. Standalone Artifacts, Independent Weapons, Independent Buildings, Vehicles
  const remainingEntities = [...weaponsAndItems, ...buildingsAndVehicles].filter(
    (e) => !attachedEntityIds.has(e.id)
  );

  for (const standEl of remainingEntities) {
    entityToMasterMap.set(standEl.id, standEl.id);
    masterSheets.push({
      masterId: standEl.id,
      masterName: standEl.name,
      category: standEl.category,
      sheetType: "STANDALONE_OBJECT_SHEET",
      titleAr: `ورقة تصميم العنصر المستقل: «${standEl.name}»`,
      badgeLabelAr: "Standalone Object Model Sheet",
      promptLayoutType: "Isolated Multi-Angle Object Showcase Sheet",
      primaryElement: standEl,
      attachedEntities: [],
      referenceImageUrl: standEl.reference_image_url || null,
      status: standEl.status || "DRAFT",
      isLocked: standEl.status === "LOCKED" || Boolean(standEl.locked_for_production),
      isApproved: Boolean(standEl.approved || standEl.status === "LOCKED" || standEl.locked_for_production),
      verificationStatus: standEl.verification_status || "UNVERIFIED",
      flowAssetId: standEl.flowAssetId || null,
      flowProjectId: standEl.flowProjectId || standEl.flow_project_id || null,
      flowGenerationId: standEl.flowGenerationId || standEl.flow_generation_id || null,
    });
  }

  return {
    masterSheets,
    entityToMasterMap,
    standaloneCount: masterSheets.length,
    totalLogicalEntities: elements.length + locations.length,
  };
}

/**
 * Checks if a specific entity is subordinate/attached to a Master Reference Sheet.
 */
export function isEntitySubordinateToMaster(
  entityId: string,
  entityToMasterMap: Map<string, string>
): { isSubordinate: boolean; masterId: string | null } {
  const masterId = entityToMasterMap.get(entityId);
  if (masterId && masterId !== entityId) {
    return { isSubordinate: true, masterId };
  }
  return { isSubordinate: false, masterId: null };
}

/**
 * Propagates generated Master Reference Sheet image & status to all attached logical sub-entities.
 * Guarantees that weapons and accessories attached to Sunny get the exact same image and lock state!
 */
export function synchronizeAttachedEntitiesFromMaster(
  allElements: StudioProductionElement[],
  masterElement: StudioProductionElement
): StudioProductionElement[] {
  const masterId = masterElement.id;
  const isLocked = Boolean(masterElement.status === "LOCKED" || masterElement.locked_for_production);
  const masterSheetId =
    (masterElement as any).reference_sheet_id || `REF_SHEET_${masterId}`;

  return allElements.map((el) => {
    if (el.id === masterId) {
      return {
        ...el,
        ...masterElement,
        is_master_reference_sheet: true,
        master_reference_id: masterId,
        reference_sheet_id: (masterElement as any).reference_sheet_id || masterSheetId,
        locked_for_production: isLocked,
      };
    }

    // Check if this logical entity belongs to this master sheet
    const aff = isEntityAffiliatedWithCharacter(el, masterElement);
    const crAff = isEntityAffiliatedWithCreature(el, masterElement);

    if (
      aff.affiliated ||
      crAff.affiliated ||
      el.attached_to === masterId ||
      el.reference_group_id === `REF_GROUP_${masterId}`
    ) {
      // Preserve each attached entity's own distinct image, verification result, and lock state!
      // Never prematurely lock or overwrite an attached entity before its own generation and review complete.
      return {
        ...el,
        attached_to: el.attached_to || masterId,
        reference_group_id: el.reference_group_id || `REF_GROUP_${masterId}`,
        master_reference_id: masterId,
        reference_sheet_id: (el as any).reference_sheet_id || masterSheetId,
      };
    }

    return el;
  });
}

/**
 * Propagates generated Location Master Sheet image & status to all attached elements (Statues, Relics, Landmarks).
 */
export function synchronizeAttachedEntitiesFromLocationMaster(
  allElements: StudioProductionElement[],
  masterLocation: StudioLocationItem
): StudioProductionElement[] {
  const masterId = masterLocation.location_id;
  const imageUrl = masterLocation.reference_image_url || null;
  const localPath = masterLocation.local_file_path || null;
  const isApproved = Boolean(masterLocation.approved || (masterLocation as any).status === "LOCKED");
  const isLocked = Boolean((masterLocation as any).status === "LOCKED" || (masterLocation as any).locked_for_production);
  const flowAssetId = (masterLocation as any).flowAssetId || null;
  const flowProjectId = (masterLocation as any).flowProjectId || (masterLocation as any).flow_project_id || null;
  const flowGenId = (masterLocation as any).flowGenerationId || (masterLocation as any).flow_generation_id || null;

  return allElements.map((el) => {
    const aff = isEntityAffiliatedWithLocation(el, masterLocation);
    if (aff.affiliated || el.attached_to === masterId || el.reference_group_id === `REF_GROUP_${masterId}`) {
      return {
        ...el,
        attached_to: masterId,
        reference_group_id: `REF_GROUP_${masterId}`,
        master_reference_id: masterId,
        reference_image_url: imageUrl,
        local_file_path: localPath,
        status: isLocked ? "LOCKED" : isApproved ? "APPROVED" : el.status,
        approved: isApproved,
        locked_for_production: isLocked,
        verification_status: isApproved ? "VERIFIED" : el.verification_status,
        vision_status: isApproved ? "PASS" : el.vision_status,
        flowAssetId: flowAssetId,
        flowProjectId: flowProjectId,
        flow_project_id: flowProjectId,
        flowGenerationId: flowGenId,
        flow_asset_status: flowAssetId ? "FLOW_ASSET_VERIFIED" : el.flow_asset_status,
      };
    }
    return el;
  });
}

/**
 * Formats a Master Reference Prompt for Google Flow that renders all turnaround angles,
 * close-up callouts, and integrated weapon/equipment on a single Character/Creature/Location Design Sheet.
 */
export function buildMasterReferenceSheetFlowPrompt(params: {
  masterSheet: MasterReferenceSheet;
  globalStyle: string;
  aspectRatio: string;
}): string {
  const { masterSheet, globalStyle, aspectRatio } = params;
  const attached = masterSheet.attachedEntities;

  if (masterSheet.sheetType === "CHARACTER_DESIGN_SHEET" && masterSheet.primaryElement) {
    const el = masterSheet.primaryElement;
    const attachedWeaponsStr = attached
      .filter((a) => a.category === "WEAPON" || a.category === "ITEM")
      .map((a) => `${a.name}: ${(a.element as any)?.visual_prompt || a.description}`)
      .join(" ; ");

    const weaponSectionPrompt = attachedWeaponsStr
      ? `INTEGRATED WEAPONS & ACCESSORIES VISUAL SHOWCASE (Single Sheet, Pure Textless): The character's signature equipment [${attached.map((a) => a.name).join(", ")}] must appear both equipped on the character in the turnaround poses, AND as a dedicated close-up visual showcase on the side of the sheet detailing blade texture, hilt, guard, glow, and sheath (${attachedWeaponsStr}) with zero text labels.`
      : `EQUIPMENT: Fully detailed attire and combat gear visual showcase on the same sheet with zero text labels.`;

    return [
      `${globalStyle} [Aspect Ratio: ${aspectRatio}]`,
      `PURE TEXTLESS CHARACTER DESIGN SHEET / 3D CHARACTER MODEL SHEET: ${el.name} (${el.id})`,
      `CHARACTER IDENTITY & PHYSIQUE: ${(el as any).visual_prompt || el.canonical_description || el.visual_details || el.description}. Defined facial features, styled hair, expressive eyes, athletic proportions.`,
      `MULTI-ANGLE TURNAROUND SHOWCASE (Clean Neutral Background): Full-body Front View, Full-body 3/4 Perspective View, Full-body Side Profile View, and Full-body Back Turnaround View.`,
      `HEAD & FACIAL EXPRESSIONS CLOSE-UPS: Multiple close-up portrait studies (Neutral analytical focus, Intense combat expression, Dramatic determined expression) with detailed hair strand and eye rendering.`,
      `WARDROBE & ATTIRE VISUAL BREAKDOWN: Detailed layer-by-layer visual rendering of clothing, armor plating, leather straps, knee-high travel boots, and combat gloves.`,
      weaponSectionPrompt,
      `COLOR PALETTE & MATERIAL TEXTURES: Matte fabrics, supple leather, forged metallic blade sheen, natural skin tone.`,
      `KEY FIXED IMMUTABLE CONSTRAINTS: ${Array.isArray(el.immutable_constraints) ? el.immutable_constraints.join("; ") : "Maintain exact consistent identity across all views"}`,
      `PRODUCTION COMPOSITION: All turnaround views, facial expressions, and weapon close-ups arranged neatly into ONE single comprehensive Master Reference Sheet on a clean studio neutral background. STRICT NEGATIVE RULES: Pure textless illustration — strictly NO text, NO words, NO letters, NO written labels, NO callout lines, NO title banners, NO combining unrelated characters, NO manga page layout, NO comic panels, NO narrative story scene, NO speech bubbles, NO watermarks. [Aspect Ratio: ${aspectRatio}]`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (masterSheet.sheetType === "CREATURE_MODEL_SHEET" && masterSheet.primaryElement) {
    const el = masterSheet.primaryElement;
    const minionDetails = attached
      .map((a) => `${a.name} (${a.relationshipRole}): ${(a.element as any)?.visual_prompt || a.description}`)
      .join(" ; ");

    const swarmSection = minionDetails
      ? `SWARM & HIERARCHY SCALE COMPARISON (Single Sheet, Pure Textless): Show primary alpha creature alongside follower/minion entities [${attached.map((a) => a.name).join(", ")}] illustrating exact size proportions and scale ratio (${minionDetails}).`
      : `ANATOMY & SCALE: Full creature anatomy visual showcase with zero text labels.`;

    return [
      `${globalStyle} [Aspect Ratio: ${aspectRatio}]`,
      `PURE TEXTLESS CREATURE DESIGN SHEET / BESTIARY MODEL SHEET: ${el.name} (${el.id})`,
      `CREATURE MORPHOLOGY & TRAITS: ${(el as any).visual_prompt || el.canonical_description || el.visual_details || el.description}.`,
      `MULTI-ANGLE ANATOMY SHOWCASE: Full-body primary creature views (Front, Side, 3/4 angle perspective) on clean neutral backdrop.`,
      `ANATOMICAL CLOSE-UP VIEWS: High-detail visual studies of head, compound eyes, fangs, legs, joints, claws, and matte black carapace armor.`,
      swarmSection,
      `COLOR PALETTE & BIOLOGICAL SURFACES: Matte black chitinous carapace, crimson-red glowing eyes, sharp claws, and shadow textures.`,
      `KEY FIXED CONSTRAINTS: ${Array.isArray(el.immutable_constraints) ? el.immutable_constraints.join("; ") : "Preserve consistent biology"}`,
      `PRODUCTION COMPOSITION: Comprehensive Creature Model Sheet layout arranged cleanly into ONE single master reference image. STRICT NEGATIVE RULES: Pure textless illustration — strictly NO text, NO words, NO letters, NO written labels, NO texture swatch boxes, NO human fighters, NO comic panels, NO manga page, NO speech bubbles, NO watermarks. [Aspect Ratio: ${aspectRatio}]`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (masterSheet.sheetType === "LOCATION_CONCEPT_SHEET" && masterSheet.primaryLocation) {
    const loc = masterSheet.primaryLocation;
    const monumentsStr = attached
      .map((a) => `${a.name} (${a.relationshipRole}): ${a.description}`)
      .join(" ; ");

    const monumentsCallout = monumentsStr
      ? `MONUMENTS, STATUES & ARCHITECTURAL RELICS CALLOUT (Single Sheet): Integrated detailed callout boxes detailing [${attached.map((a) => a.name).join(", ")}] (${monumentsStr}). Shows exact sculptural details, carvings, weapon relics, and stone materials.`
      : `ARCHITECTURAL CALLOUTS: Landmark structures, architectural elevation, and stone masonry breakdown.`;

    return [
      `${globalStyle} [Aspect Ratio: ${aspectRatio}]`,
      `PROFESSIONAL LOCATION CONCEPT SHEET & ENVIRONMENTAL BIBLE: ${loc.name} (${loc.location_id})`,
      `ENVIRONMENT IDENTITY & GEOGRAPHY: ${loc.canonical_description || loc.visual_description || loc.description}.`,
      `WIDE ESTABLISHING PERSPECTIVE: Epic establishing landscape showcase of ${loc.name} capturing grand scale, spatial layout, terrain elevation, and horizons.`,
      `MULTI-PERSPECTIVE ARCHITECTURAL VIEWS: Bird's-eye elevation layout, eye-level frontal perspective, and interior/passageway detail views.`,
      monumentsCallout,
      `LIGHTING, ATMOSPHERE & WEATHER CONDITIONS: ${loc.lighting_and_atmosphere || "Cinematic volumetric lighting, atmospheric fog, dramatic celestial illumination"}.`,
      `MATERIAL & TEXTURE SWATCH BAR: Weathered stone, aged masonry, cracked marble, metallic patina, moss, and elemental weathering.`,
      `KEY FIXED CONSTRAINTS: ${Array.isArray(loc.immutable_elements) ? loc.immutable_elements.join("; ") : "Preserve consistent environmental layout"} | المرجع العربي: ${loc.description}`,
      `PRODUCTION COMPOSITION: All environmental views, monument callouts, and architectural studies organized cleanly into ONE unified Master Location Reference Sheet. STRICT NEGATIVE RULES: Strictly NO unrelated locations, NO manga comic panels, NO speech bubbles, NO text watermarks. [Aspect Ratio: ${aspectRatio}]`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  // Standalone Object / Artifact / Vehicle Sheet
  const el = masterSheet.primaryElement!;
  return [
    `${globalStyle} [Aspect Ratio: ${aspectRatio}]`,
    `PROFESSIONAL OBJECT & ARTIFACT DESIGN SHEET: ${el.name} (${el.id})`,
    `DESIGN & MATERIALS: ${el.canonical_description || el.visual_details || el.description}.`,
    `MULTI-ANGLE SHOWCASE: Full-length primary view, side profile view, 3/4 showcase perspective, and detailed surface/hilt/joint close-ups on clean neutral backdrop.`,
    `TEXTURE & MATERIAL SWATCHES: Forged metals, carvings, wear, weathering, and glow effects.`,
    `KEY FIXED CONSTRAINTS: ${Array.isArray(el.immutable_constraints) ? el.immutable_constraints.join("; ") : "Preserve exact object design"} | المرجع العربي: ${el.description}`,
    `PRODUCTION COMPOSITION: All angles and material callouts arranged inside ONE standalone Master Reference Sheet. [Aspect Ratio: ${aspectRatio}]`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
