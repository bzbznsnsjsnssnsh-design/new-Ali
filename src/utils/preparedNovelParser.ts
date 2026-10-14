import type {
  LongNovelSegmentationReport,
  PageGenerationMode,
  ProductionElementType,
  StudioCheckpointState,
  StudioLocationItem,
  StudioProductionElement,
  StudioSceneItem,
} from "../types/novelToManga";
import {
  UniversalReferenceSheet,
  UniversalProductionJson,
  UniversalValidationReport,
  validateUniversalProductionJson,
  convertUniversalJsonToStudio,
} from "./universalProductionJson";

export type PreparedNovelStatus =
  | "EMPTY" // ⚪ لا توجد بيانات مجهزة
  | "DRAFT" // 🟡 مسودة غير معتمدة (Draft)
  | "VALID" // 🔵 تم التحقق وجاهز للاعتماد (Validated)
  | "ADOPTED" // 🟢 معتمد ونشط - المصدر الأساسي للاستوديو (Adopted)
  | "SAVED" // 🟢 تم تجهيز الرواية (توافق)
  | "UNSAVED" // 🟠 توجد بيانات جديدة غير محفوظة (توافق)
  | "INVALID"; // 🔴 بيانات التجهيز غير صالحة

/**
 * ⚡ البرومبت المخصص الموجه للذكاء الاصطناعي الخارجي (ترتيب الأحداث فقط)
 * يمكن للمستخدم نسخه بنقرة واحدة من بداية قسم تجهيز مسبق وإرساله لأي AI
 */
export const EVENT_ORDERING_PROMPT = `أنت خبير سينمائي ومخرج ستوري بورد متخصص في تفكيك وترتيب أحداث الروايات لتحويلها إلى مانهوا ومانجا.
مهمتك الأساسية: قراءة نص الرواية المرفق أدناه، واستخراج "ترتيب الأحداث فقط" بتسلسل زمني ودرامي صارم دون دمج الأحداث، لإنتاج هيكل أحداث متسلسل جاهز للاستخدام المباشر.

القواعد الإلزامية:
1. الترتيب الزمني والسببي الصارم: رتب الأحداث تسلسلياً من أول حدث حتى آخر حدث في الفصل (الحدث 1، الحدث 2، الحدث 3...).
2. فك الدمج: كل حدث يجب أن يمثل لقطة أو فعلاً درامياً أو انتقالاً بصرياً مستقلاً.
3. لكل حدث، استخرج وحدد بدقة:
   - رقم الحدث وعنوانه
   - الوصف الدقيق للأحداث وما يقع في المشهد
   - الشخصيات الحاضرة وحالتها
   - الموقع ومواصفات البيئة
   - الأسلحة أو الأدوات المستخدمة (إن وجدت)
   - الفعل الدرامي الرئيسي أو الحوار
   - الانتقال للحدث التالي

الصيغة المطلوبة (اختر صيغة JSON أو نص Markdown منظم):

صيغة JSON (المثالية للتجهيز المسبق):
\`\`\`json
{
  "novel_title": "عنوان الرواية أو الفصل",
  "chapter_identifier": "CHAPTER_01",
  "ordered_events": [
    {
      "event_number": 1,
      "event_title": "عنوان الحدث الأول",
      "description": "وصف دقيق لما يدور في الحدث وحركة الشخصيات",
      "characters": ["اسم الشخصية 1", "اسم الشخصية 2"],
      "location": "اسم الموقع ومواصفاته",
      "action_and_dialogue": "الفعل الدرامي الرئيسي أو الحوار الرئيسي",
      "key_objects": ["السلاح أو العنصر إن وجد"],
      "transition_to_next": "كيف ينتهي الحدث ويمهد للحدث التالي"
    }
  ],
  "characters": [
    {
      "name": "اسم الشخصية",
      "description": "المظهر والملابس والملامح",
      "weapons": ["السلاح إن وجد"]
    }
  ],
  "locations": [
    {
      "name": "اسم الموقع",
      "description": "وصف المكان والمعالم البصرية والإضاءة"
    }
  ]
}
\`\`\`

نص الرواية لتحليله وترتيب أحداثه:
[الصق نص روايتك هنا]`;

/**
 * نموذج تجريبي لترتيب الأحداث لاختبار التجهيز المسبق بنقرة واحدة
 */
export const SAMPLE_ORDERED_EVENTS_PAYLOAD = JSON.stringify(
  {
    novel_title: "معركة البوابة المزدوجة - الفصل الأول",
    chapter_identifier: "CHAPTER_01",
    ordered_events: [
      {
        event_number: 1,
        event_title: "دخول الزنزانة المزدوجة المجهولة",
        description: "يدخل جين وو وفريقه عبر بوابة حجرية عملاقة وسط كهف مظلم مضاء فقط بشعلات خافتة معلقة على الجدران الرطبة.",
        characters: ["جين وو", "سونغ تشيول"],
        location: "الكهف الحجري القديم",
        action_and_dialogue: "جين وو يتفحص الجدران بحذر: 'هذا المكان لا يشبه أي بوابة دخلناها من قبل.'",
        key_objects: ["خنجر حديدي قصير", "شعلة نارية"],
        transition_to_next: "يتقدم الفريق للأمام حتى يصلوا لقاعة دائرية عملاقة",
      },
      {
        event_number: 2,
        event_title: "إغلاق البوابة الحجرية وحبس الفريق",
        description: "تهتز الأرض فجأة وتتحرك الأبواب الحجرية الضخمة لتغلق المدخل بالكامل وتصدر دوياً مرعباً يحبس الجميع.",
        characters: ["جين وو", "سونغ تشيول", "جو هي"],
        location: "القاعة الحجرية الدائرية",
        action_and_dialogue: "صرخة ذعر من الفريق ومحاولة يائسة لدفع الباب المغلق.",
        key_objects: ["عصا المعالجة السحرية"],
        transition_to_next: "صمت مفاجئ يتبعه صوت احتكاك حجري من منصة العرش",
      },
      {
        event_number: 3,
        event_title: "استيقاظ تمثال الإله العملاق",
        description: "تتوهج عيون التمثال الملكي العملاق في صدر القاعة بلون قرمزي مشتعل ويبدأ بالتحرك ببطء قاتل نحو الفريق.",
        characters: ["جين وو", "سونغ تشيول"],
        location: "عرش الإله الحجري",
        action_and_dialogue: "جين وو يلاحظ وميض العيون أولاً ويصرخ: 'انحنوا جميعاً إلى الأرض فوراً!'",
        key_objects: ["سيف التمثال العملاق"],
        transition_to_next: "إطلاق شعاع مدمر يمزق الهواء فوق رؤوسهم",
      },
    ],
    characters: [
      {
        name: "جين وو",
        description: "شاب نحيل ذو شعر أسود مبعثر يرتدي هودي أزرق متواضع ويحمل خنجراً حديدياً عادياً، ملامحه متيقظة وذكية.",
        weapons: ["خنجر حديدي قصير"],
      },
      {
        name: "سونغ تشيول",
        description: "قائد الفريق ذو لحية خفيفة وملامح منهكة ودرع صدري جلدي متآكل.",
        weapons: ["سيف عريض"],
      },
      {
        name: "جو هي",
        description: "معالجة شابة ذات شعر بني وقلق واضح، ترتدي رداء معالجين أخضر وتحمل عصا سحرية.",
        weapons: ["عصا معالجة"],
      },
    ],
    locations: [
      {
        name: "الكهف الحجري القديم",
        description: "ممر حجري مهيب ورطب بجدران نقشت عليها طلاسم أثرية غامضة وإضاءة شعلات خافتة.",
      },
      {
        name: "القاعة الحجرية الدائرية",
        description: "غرفة ضخمة دائرية تحيط بها تماثيل حجرية شاهقة تتوسطها منصة عرش مهيبة.",
      },
      {
        name: "عرش الإله الحجري",
        description: "منصة حجرية مرتفعة يجلس عليها تمثال عملاق بهيئة ملك حجري ذو عيون متوهجة.",
      },
    ],
  },
  null,
  2
);

/**
 * Normalizes any category string into the canonical ProductionElementType.
 * Supports English and Arabic terms:
 * WEAPON / سلاح / أسلحة -> WEAPON
 * ITEM / عنصر / عناصر / أداة -> ITEM
 * CHARACTER / شخصية / شخصيات -> CHARACTER
 * CREATURE / مخلوق / وحش -> CREATURE
 * BUILDING / مبنى / أثر / تمثال -> BUILDING
 * VEHICLE / مركبة / دبابة -> VEHICLE
 */
export function normalizeProductionCategory(rawCat: any): ProductionElementType {
  if (!rawCat) return "ITEM";
  const s = String(rawCat).trim().toUpperCase();
  if (s === "WEAPON" || s === "سلاح" || s === "أسلحة" || s === "اسلحة" || /WEAPON/i.test(s)) return "WEAPON";
  if (
    s === "ITEM" ||
    s === "PROP" ||
    s === "عنصر" ||
    s === "عناصر" ||
    s === "غرض" ||
    s === "أغراض" ||
    s === "أداة" ||
    s === "أدوات" ||
    s === "TOOL" ||
    /ITEM|PROP/i.test(s)
  )
    return "ITEM";
  if (s === "CHARACTER" || s === "شخصية" || s === "شخصيات" || /CHARACTER/i.test(s)) return "CHARACTER";
  if (s === "CREATURE" || s === "مخلوق" || s === "مخلوقات" || s === "وحش" || s === "وحوش" || s === "ANIMAL" || /CREATURE/i.test(s)) return "CREATURE";
  if (s === "BUILDING" || s === "مبنى" || s === "مباني" || s === "أثر" || s === "آثار" || s === "تمثال" || s === "تماثيل" || /BUILDING/i.test(s)) return "BUILDING";
  if (s === "VEHICLE" || s === "مركبة" || s === "مركبات" || s === "دبابة" || s === "سيارة" || /VEHICLE/i.test(s)) return "VEHICLE";
  if (s === "LOCATION" || s === "موقع" || s === "مواقع" || s === "مكان" || /LOCATION/i.test(s)) return "LOCATION";
  return (s as ProductionElementType) || "ITEM";
}

export interface PreparedNovelData {
  prepared_novel_id: string;
  content_hash: string;
  created_at: string;
  updated_at?: string;
  adopted_at?: string;
  status?: "DRAFT" | "VALIDATED" | "ADOPTED" | "SAVED" | "UNSAVED" | "INVALID";
  active_source?: "PREPARED_NOVEL_DATA";
  source_type: "external_ai_analysis";
  schema_version: string;
  novel_title: string;
  chapter_identifier: string;
  raw_input: string;
  raw_payload?: Record<string, any>;

  // Normalized entities for direct consumption by all sections
  ordered_events: any[];
  characters: any[];
  locations: any[];
  events: any[];
  scenes: any[];
  weapons: any[];
  items: any[];
  creatures: any[];
  buildings: any[];
  vehicles: any[];
  production_elements: StudioProductionElement[];

  canon?: string | Record<string, any>;
  character_descriptions?: any[];
  character_relationships?: any[];
  world_information?: any;
  timeline?: any[];
  important_objects?: any[];
  abilities?: any[];
  dialogue?: any[];
  visual_descriptions?: any[];
  environment?: any;
  continuity_information?: any;
  scene_relationships?: any[];
  ids?: Record<string, any>;
  source_references?: any[];
  custom_fields?: Record<string, any>;

  reference_sheets?: UniversalReferenceSheet[];
  universal_json?: UniversalProductionJson;
  universal_validation_report?: UniversalValidationReport;
  project_name?: string;
  story?: any;
  style?: any;
  pipeline_settings?: any;
  page_plans?: any;

  // Converted studio items ready for immediate injection
  converted_studio_data?: {
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
    reference_sheets?: UniversalReferenceSheet[];
    universal_validation_report?: UniversalValidationReport;
    long_novel_report?: LongNovelSegmentationReport | null;
  };

  stats?: {
    scenes_count: number;
    characters_count: number;
    locations_count: number;
    events_count: number;
    weapons_count: number;
    items_count: number;
    creatures_count?: number;
  };
}

/**
 * ⚡ Active Prepared Dataset Interface
 * Represents the single authoritative adopted dataset in the project.
 */
export interface ActivePreparedNovelData extends PreparedNovelData {
  prepared_novel_id: string;
  content_hash: string;
  schema_version: string;
  source_type: "external_ai_analysis";
  novel_title: string;
  chapter_identifier: string;
  raw_input: string;
  ordered_events: any[];
  scenes: StudioSceneItem[];
  characters: any[];
  locations: StudioLocationItem[];
  weapons: any[];
  items: any[];
  creatures: any[];
  buildings: any[];
  vehicles: any[];
  production_elements: StudioProductionElement[];
  reference_sheets?: UniversalReferenceSheet[];
  universal_json?: UniversalProductionJson;
  universal_validation_report?: UniversalValidationReport;
  adopted_at: string;
  status: "ADOPTED";
}

export interface PreparedNovelValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  mismatchWarning?: string | null;
  detectedTitle?: string;
  detectedChapter?: string;
  universal_validation_report?: UniversalValidationReport;
  reference_sheets?: UniversalReferenceSheet[];
  stats: {
    scenes_count: number;
    characters_count: number;
    locations_count: number;
    events_count: number;
    weapons_count: number;
    items_count: number;
    creatures_count?: number;
  };
  parsedData?: PreparedNovelData;
}

/**
 * Deterministic hash computation for raw input
 */
export function computeContentHash(input: string): string {
  const clean = input.trim();
  let hash1 = 0xdeadbeef;
  let hash2 = 0x41c64e6d;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    hash1 = Math.imul(hash1 ^ ch, 2654435761);
    hash2 = Math.imul(hash2 ^ ch, 1597334677);
  }
  hash1 = Math.imul(hash1 ^ (hash1 >>> 16), 2246822507) ^ Math.imul(hash2 ^ (hash2 >>> 13), 3266489909);
  hash2 = Math.imul(hash2 ^ (hash2 >>> 16), 2246822507) ^ Math.imul(hash1 ^ (hash1 >>> 13), 3266489909);
  const hex = (4294967296 * (2097151 & hash2) + (hash1 >>> 0)).toString(16);
  return hex.padStart(16, "0");
}

/**
 * Clean & extract JSON from text (handles ```json fences, comments, minor trailing commas)
 */
function extractJsonCandidate(raw: string): string {
  let text = raw.trim();
  // Strip markdown code fences if present
  if (text.includes("```")) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  // If text starts with { or [
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let startIdx = -1;
  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  if (startIdx !== -1) {
    const isBrace = text[startIdx] === "{";
    const lastIdx = isBrace ? text.lastIndexOf("}") : text.lastIndexOf("]");
    if (lastIdx > startIdx) {
      return text.slice(startIdx, lastIdx + 1).trim();
    }
  }

  return text;
}

/**
 * Sanitize common JSON errors like trailing commas
 */
function safeJsonParse(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    // Attempt relaxed trailing comma cleanup
    try {
      const cleaned = jsonString
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

/**
 * Markdown or unstructured text parser fallback
 */
function parseStructuredText(raw: string): Record<string, any> {
  const result: Record<string, any> = {
    characters: [] as any[],
    locations: [] as any[],
    scenes: [] as any[],
    events: [] as any[],
    canon: "",
    weapons: [] as any[],
    custom_sections: {} as Record<string, string>,
  };

  const lines = raw.split("\n");
  let currentSection = "general";
  let sectionContent: string[] = [];

  const flushSection = (sec: string, linesArr: string[]) => {
    const text = linesArr.join("\n").trim();
    if (!text) return;
    const lowerSec = sec.toLowerCase();

    if (lowerSec.includes("character") || lowerSec.includes("شخصي")) {
      const entries = text.split(/(?:^|\n)(?:[-*•]|\d+\.)\s+/).filter(Boolean);
      entries.forEach((e, idx) => {
        const parts = e.split(/[:：-]\s+/);
        const name = parts[0]?.trim() || `شخصية ${idx + 1}`;
        const desc = parts.slice(1).join(" - ").trim() || e.trim();
        result.characters.push({
          id: `CHAR_${String(idx + 1).padStart(3, "0")}`,
          name,
          description: desc,
          visual_details: desc,
        });
      });
    } else if (
      lowerSec.includes("location") ||
      lowerSec.includes("place") ||
      lowerSec.includes("موقع") ||
      lowerSec.includes("مواقع") ||
      lowerSec.includes("أماكن") ||
      lowerSec.includes("اماكن") ||
      lowerSec.includes("مكان") ||
      lowerSec.includes("بيئة")
    ) {
      const entries = text.split(/(?:^|\n)(?:[-*•]|\d+\.)\s+/).filter(Boolean);
      entries.forEach((e, idx) => {
        const parts = e.split(/[:：-]\s+/);
        const name = parts[0]?.trim() || `موقع ${idx + 1}`;
        const desc = parts.slice(1).join(" - ").trim() || e.trim();
        result.locations.push({
          location_id: `LOC_${String(idx + 1).padStart(3, "0")}`,
          name,
          description: desc,
          environment: desc,
        });
      });
    } else if (lowerSec.includes("scene") || lowerSec.includes("مشهد") || lowerSec.includes("مشاهد")) {
      const entries = text.split(/(?:^|\n)(?:###|\*\*|Scene\s*\d+|المشهد\s*\d+)/i).filter(Boolean);
      entries.forEach((e, idx) => {
        const linesSub = e.split("\n").map((l) => l.trim()).filter(Boolean);
        const title = linesSub[0] || `مشهد ${idx + 1}`;
        const body = linesSub.slice(1).join(" ") || e.trim();
        result.scenes.push({
          scene_id: `SCENE_${String(idx + 1).padStart(3, "0")}`,
          scene_number: idx + 1,
          title,
          description: body,
          action: body,
          visual_prompt: body,
        });
      });
    } else if (
      lowerSec.includes("event") ||
      lowerSec.includes("حدث") ||
      lowerSec.includes("أحداث") ||
      lowerSec.includes("احداث") ||
      lowerSec.includes("ترتيب") ||
      lowerSec.includes("تسلسل")
    ) {
      const entries = text
        .split(/(?:^|\n)(?:[-*•]|\d+\.|\b(?:الحدث|Event)\s*\d+[:\-.]?|\[(?:الحدث|Event)\s*\d+\])\s*/i)
        .filter((e) => e.trim().length > 3);
      entries.forEach((ev, idx) => {
        const clean = ev.trim();
        result.events.push({
          event_id: `EV_${String(idx + 1).padStart(3, "0")}`,
          description: clean,
          title: clean.split("\n")[0]?.replace(/^[:\-*#\s]+/, "").slice(0, 50) || `الحدث ${idx + 1}`,
        });
      });
    } else if (lowerSec.includes("canon") || lowerSec.includes("lore") || lowerSec.includes("حقائق") || lowerSec.includes("عالم")) {
      result.canon = (result.canon ? result.canon + "\n\n" : "") + text;
    } else if (lowerSec.includes("weapon") || lowerSec.includes("سلاح") || lowerSec.includes("أسلحة") || lowerSec.includes("أدوات")) {
      const entries = text.split(/(?:^|\n)(?:[-*•]|\d+\.)\s+/).filter(Boolean);
      entries.forEach((w, idx) => {
        result.weapons.push({
          id: `WEAPON_${String(idx + 1).padStart(3, "0")}`,
          name: w.split(/[:：]/)[0]?.trim() || `سلاح ${idx + 1}`,
          description: w.trim(),
        });
      });
    } else {
      result.custom_sections[sec] = text;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("---") || /^[A-Za-z0-9\u0600-\u06FF\s]+:$/.test(trimmed)) {
      flushSection(currentSection, sectionContent);
      sectionContent = [];
      currentSection = trimmed.replace(/^[#\-*\s]+/, "").replace(/:$/, "").trim();
    } else {
      sectionContent.push(line);
    }
  }
  flushSection(currentSection, sectionContent);

  return result;
}

/**
 * Main parser and validator function for Prepared Novel Data
 */
export function parseAndValidatePreparedNovel(
  rawInput: string,
  currentNovelTitle?: string,
  currentNovelText?: string
): PreparedNovelValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let mismatchWarning: string | null = null;

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      isValid: false,
      errors: ["النص المدخل فارغ. يرجى لصق بيانات تحليل الرواية."],
      warnings: [],
      stats: {
        scenes_count: 0,
        characters_count: 0,
        locations_count: 0,
        events_count: 0,
        weapons_count: 0,
        items_count: 0,
        creatures_count: 0,
      },
    };
  }

  let payload: Record<string, any> = {};
  const jsonCandidate = extractJsonCandidate(trimmed);
  const parsedJson = safeJsonParse(jsonCandidate);

  if (parsedJson && typeof parsedJson === "object") {
    payload = Array.isArray(parsedJson) ? { items: parsedJson } : { ...parsedJson };
  } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return {
      isValid: false,
      errors: ["صيغة JSON غير صالحة (Invalid JSON syntax). يرجى التحقق من الأقواس والفواصل."],
      warnings: [],
      stats: {
        scenes_count: 0,
        characters_count: 0,
        locations_count: 0,
        events_count: 0,
        weapons_count: 0,
        items_count: 0,
        creatures_count: 0,
      },
    };
  } else {
    // Structured markdown / text fallback
    payload = parseStructuredText(trimmed);
    warnings.push("تم قراءة البيانات كـ Markdown / نص منظم واستخراج الكيانات المتاحة.");
  }

  // Preserve all unknown fields
  const customFields: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (
      ![
        "characters",
        "characters_list",
        "character_descriptions",
        "character_relationships",
        "locations",
        "places",
        "scenes",
        "scene_list",
        "events",
        "timeline",
        "canon",
        "lore",
        "world",
        "world_information",
        "weapons",
        "items",
        "important_objects",
        "abilities",
        "dialogue",
        "visual_descriptions",
        "environment",
        "continuity_information",
        "scene_relationships",
        "ids",
        "source_references",
        "title",
        "novel_title",
        "chapter",
        "chapter_identifier",
        "chapter_title",
      ].includes(k)
    ) {
      customFields[k] = v;
    }
  }

  // ⚡ Universal Production JSON (Schema 1.0) Integration:
  const isUniversalJson =
    Array.isArray(payload.entities) ||
    Array.isArray(payload.reference_sheets) ||
    payload.schema_version === "1.0";

  let universalReport: UniversalValidationReport | undefined;
  let universalConverted: ReturnType<typeof convertUniversalJsonToStudio> | undefined;
  let universalSheets: UniversalReferenceSheet[] = Array.isArray(payload.reference_sheets)
    ? payload.reference_sheets
    : [];

  if (isUniversalJson) {
    universalConverted = convertUniversalJsonToStudio(payload as any);
    universalReport = universalConverted.validation_report;
    universalSheets = universalConverted.reference_sheets;
    if (universalReport.errors.length > 0) {
      universalReport.errors.forEach((err) => {
        errors.push(`[${err.code}] ${err.message_ar}`);
      });
    }
  }

  // Extract raw collections
  const rawCharacters: any[] =
    payload.characters ||
    payload.elements?.characters ||
    payload.characters_list ||
    payload.الشخصيات ||
    payload.شخصيات ||
    payload.cast ||
    [];

  const rawLocations: any[] =
    payload.locations ||
    payload.elements?.locations ||
    payload.places ||
    payload.المواقع ||
    payload.أماكن ||
    payload.settings ||
    [];

  const rawScenes: any[] =
    universalConverted?.scenes ||
    payload.scenes ||
    payload.story?.scenes ||
    payload.scene_list ||
    payload.المشاهد ||
    payload.مشاهد ||
    (Array.isArray(payload.script) ? payload.script : undefined) ||
    [];

  const rawEvents: any[] =
    universalConverted?.events ||
    payload.ordered_events ||
    payload.events ||
    payload.story?.events ||
    payload.event_list ||
    payload.الأحداث ||
    payload.احداث ||
    payload.ترتيب_الأحداث ||
    payload.ترتيب_الاحداث ||
    payload.قائمة_الأحداث ||
    payload.تسلسل_الأحداث ||
    payload.timeline ||
    payload.chronology ||
    payload.story_events ||
    payload.events_order ||
    payload.event_order ||
    [];

  // ⚡ دعم التجهيز المسبق لـ "ترتيب الأحداث فقط":
  // إذا أدخل المستخدم قائمة أحداث مرتبة فقط دون مشاهد، نقوم بتحويل الأحداث تلقائياً إلى مشاهد استوديو متسلسلة!
  if (rawScenes.length === 0 && rawEvents.length > 0) {
    rawEvents.forEach((ev: any, idx: number) => {
      if (typeof ev === "string") {
        rawScenes.push({
          scene_id: `SCENE_${String(idx + 1).padStart(3, "0")}`,
          scene_number: idx + 1,
          title: `المشهد ${idx + 1}: الحدث ${idx + 1}`,
          description: ev,
          action: ev,
          visual_prompt: `${ev}. High-end manhwa visual composition, dynamic panel layout.`,
        });
      } else {
        const title =
          ev.event_title ||
          ev.title ||
          ev.name ||
          ev.العنوان ||
          `الحدث ${idx + 1}: ${String(ev.description || ev.summary || "").slice(0, 30)}`;
        const desc = ev.description || ev.summary || ev.details || ev.action || ev.الوصف || "حدث درامي مرتب";
        const loc = ev.location || ev.الموقع || "";
        const chars = ev.characters || ev.الشخصيات || [];
        const action = ev.action_and_dialogue || ev.action || ev.الفعل || desc;
        rawScenes.push({
          scene_id: ev.linked_scene_id || ev.scene_id || ev.id || `SCENE_${String(idx + 1).padStart(3, "0")}`,
          event_id: ev.event_id || ev.id || `EVENT_${String(idx + 1).padStart(3, "0")}`,
          scene_number: Number(ev.event_number || ev.order || ev.scene_number || idx + 1),
          title,
          description: desc,
          action,
          dialogue: ev.dialogue || ev.dialogues || "",
          location: loc,
          characters: Array.isArray(chars) ? chars : [chars].filter(Boolean),
          costumes_and_weapons: ev.key_objects || ev.weapons || [],
          visual_prompt:
            ev.visual_prompt || `${desc}. Highly detailed cinematic manhwa panel, dramatic lighting.`,
          event_source: ev,
        });
      }
    });
  }

  // إذا لم يتم تحديد قائمة شخصيات منفصلة، نستخرج الشخصيات الفريدة المذكورة داخل الأحداث المرتبة (فقط في حال لم تكن البيانات بصيغة Universal JSON)
  if (!isUniversalJson && rawCharacters.length === 0) {
    const foundCharNames = new Set<string>();
    rawScenes.forEach((s: any) => {
      if (Array.isArray(s.characters)) {
        s.characters.forEach((ch: any) => {
          const n = typeof ch === "string" ? ch.trim() : ch.name?.trim();
          if (n && n.length > 1) foundCharNames.add(n);
        });
      }
    });
    foundCharNames.forEach((name, idx) => {
      rawCharacters.push({
        id: `CHAR_${String(idx + 1).padStart(3, "0")}`,
        name,
        description: `شخصية رئيسية مستخرجة من ترتيب الأحداث: ${name}`,
      });
    });
  }

  // إذا لم يتم تحديد مواقع منفصلة، نستخرج المواقع المذكورة داخل الأحداث المرتبة (فقط في حال لم تكن البيانات بصيغة Universal JSON)
  if (!isUniversalJson && rawLocations.length === 0) {
    const foundLocNames = new Set<string>();
    rawScenes.forEach((s: any) => {
      const loc = typeof s.location === "string" ? s.location.trim() : s.location_name?.trim();
      if (loc && loc.length > 1 && loc !== "الموقع الرئيسي") foundLocNames.add(loc);
    });
    foundLocNames.forEach((rawLoc, idx) => {
      const parts = rawLoc.split(/[؛;:]/);
      const shortName = parts[0]?.trim() || rawLoc.slice(0, 45).trim();
      rawLocations.push({
        location_id: `LOC_${String(idx + 1).padStart(3, "0")}`,
        name: shortName,
        description: rawLoc,
        visual_description: rawLoc,
      });
    });
  }

  // 1. Raw Collections Extraction
  const rawProductionElements: any[] =
    payload.production_elements ||
    payload.converted_studio_data?.production_elements ||
    payload.all_elements ||
    payload.visual_bible ||
    [];

  // ⚡ Universal JSON: strictly partition entities by target_step ONLY (Rule 3)
  if (isUniversalJson && Array.isArray(payload.entities)) {
    payload.entities.forEach((ent: any) => {
      if (ent.target_step === "production_elements") {
        rawProductionElements.push({
          ...ent,
          category: ent.type || ent.category || "ITEM",
          target_step: "production_elements",
        });
      } else if (ent.target_step === "locations") {
        rawLocations.push({
          ...ent,
          location_id: ent.id,
          target_step: "locations",
        });
      }
      // If target_step is missing or invalid, do NOT add to either! Retained with validation error.
    });
  }

  const rawWeaponsList: any[] =
    payload.weapons ||
    payload.elements?.weapons ||
    payload.الأسلحة ||
    payload.أسلحة ||
    payload.weapons_list ||
    [];

  const rawItemsList: any[] =
    payload.items ||
    payload.elements?.items ||
    payload.العناصر ||
    payload.عناصر ||
    payload.الأدوات ||
    payload.أدوات ||
    payload.important_objects ||
    [];

  const rawCreaturesList: any[] =
    payload.creatures ||
    payload.elements?.creatures ||
    payload.المخلوقات ||
    payload.الوحوش ||
    payload.وحوش ||
    payload.animals ||
    [];

  const rawBuildingsList: any[] =
    payload.buildings ||
    payload.elements?.buildings ||
    payload.المباني ||
    payload.الآثار ||
    payload.التماثيل ||
    payload.monuments ||
    [];

  const rawVehiclesList: any[] =
    payload.vehicles ||
    payload.elements?.vehicles ||
    payload.المركبات ||
    payload.مركبات ||
    [];

  // إذا لم يتم تحديد أسلحة أو عناصر، نفحص الأحداث والشخصيات (فقط في حال لم تكن البيانات بصيغة Universal JSON)
  if (!isUniversalJson && rawWeaponsList.length === 0 && rawProductionElements.filter((e) => normalizeProductionCategory(e.category) === "WEAPON").length === 0) {
    const foundWeaponNames = new Set<string>();
    // افحص أسلحة الشخصيات
    rawCharacters.forEach((c: any) => {
      const wList = c.weapons || c.weapons_and_accessories || [];
      if (Array.isArray(wList)) {
        wList.forEach((w: any) => {
          const n = typeof w === "string" ? w.trim() : w.name?.trim();
          if (n && n.length > 1) foundWeaponNames.add(n);
        });
      } else if (typeof wList === "string" && wList.length > 2) {
        foundWeaponNames.add(wList.trim());
      }
    });
    // افحص أسلحة الأحداث
    rawEvents.forEach((ev: any) => {
      const objs = ev.weapons || ev.الأسلحة || ev.key_objects || [];
      if (Array.isArray(objs)) {
        objs.forEach((o: any) => {
          const n = typeof o === "string" ? o.trim() : o.name?.trim();
          if (n && /سيف|خنجر|رمح|قوس|نصل|شظية|سلاح|sword|spear|blade|dagger|bow|shard|weapon/i.test(n)) {
            foundWeaponNames.add(n);
          }
        });
      }
    });
    foundWeaponNames.forEach((name, idx) => {
      rawWeaponsList.push({
        id: `WEAPON_${String(idx + 1).padStart(3, "0")}`,
        name,
        category: "WEAPON",
        description: `سلاح مستخرج من النص والأحداث: ${name}`,
      });
    });
  }

  // استخراج العناصر المستقلة إذا كانت فارغة (فقط في حال لم تكن البيانات بصيغة Universal JSON)
  if (!isUniversalJson && rawItemsList.length === 0 && rawProductionElements.filter((e) => normalizeProductionCategory(e.category) === "ITEM").length === 0) {
    const foundItemNames = new Set<string>();
    rawEvents.forEach((ev: any) => {
      const objs = ev.key_objects || ev.objects || ev.العناصر || ev.الأدوات || [];
      if (Array.isArray(objs)) {
        objs.forEach((o: any) => {
          const n = typeof o === "string" ? o.trim() : o.name?.trim();
          if (n && n.length > 1 && !/سيف|خنجر|رمح|قوس|نصل|شظية|سلاح|sword|spear|blade|dagger|bow|shard|weapon/i.test(n)) {
            foundItemNames.add(n);
          }
        });
      }
    });
    foundItemNames.forEach((name, idx) => {
      rawItemsList.push({
        id: `ITEM_${String(idx + 1).padStart(3, "0")}`,
        name,
        category: "ITEM",
        description: `عنصر مهم مستخرج من الأحداث: ${name}`,
      });
    });
  }

  const rawCanon =
    payload.canon ||
    payload.story?.source_text ||
    payload.story?.novel_text ||
    payload.source_text ||
    payload.novel_text ||
    payload.lore ||
    payload.world_information ||
    payload.world ||
    payload.حقائق ||
    payload.العالم ||
    "";

  // Check detected title & chapter
  const detectedTitle =
    payload.novel_title ||
    payload.title ||
    payload.story?.title ||
    payload.project_name ||
    payload.chapter_title ||
    payload.project_title ||
    payload.عنوان_الرواية ||
    payload.عنوان ||
    "";

  const detectedChapter =
    payload.chapter_identifier ||
    payload.chapter ||
    payload.story?.chapter ||
    payload.الفصل ||
    payload.رقم_الفصل ||
    "CHAPTER_001";

  // Mismatch detection: check if detected title is present and noticeably differs from current title
  if (
    detectedTitle &&
    currentNovelTitle &&
    currentNovelTitle.trim().length > 3 &&
    !detectedTitle.toLowerCase().includes(currentNovelTitle.toLowerCase().trim()) &&
    !currentNovelTitle.toLowerCase().includes(detectedTitle.toLowerCase().trim())
  ) {
    mismatchWarning = `⚠️ بيانات التجهيز الحالية مرتبطة برواية مختلفة («${detectedTitle}» مقابل «${currentNovelTitle}»). هل تريد استبدالها؟`;
    warnings.push(mismatchWarning);
  }

  // Minimum validation criteria: must have either scenes, characters, locations, or events
  const totalEntities =
    rawScenes.length + rawCharacters.length + rawLocations.length + rawEvents.length + rawProductionElements.length;

  if (totalEntities === 0 && !rawCanon && Object.keys(customFields).length === 0) {
    errors.push("لم يتم العثور على أي مشاهد، شخصيات، مواقع، أحداث، أو معلومات Canon في البيانات المدخلة.");
  }

  // 2. Normalization into Unified Production Elements Encyclopedia
  const productionElements: StudioProductionElement[] = [];
  const registeredIds = new Set<string>();

  const registerElement = (el: any, fallbackCategory: ProductionElementType, prefix: string, idx: number) => {
    const rawCat = el.category || el.entity_type || el.type || fallbackCategory;
    const cat = normalizeProductionCategory(rawCat);
    const id = (el.id || el.entity_id || `${prefix}_${String(idx + 1).padStart(3, "0")}`).trim();
    if (registeredIds.has(id)) return;
    registeredIds.add(id);

    const name = el.name || el.canonical_name || el.item_name || el.character_name || el.الاسم || `${cat} ${idx + 1}`;
    const desc =
      el.description ||
      el.canonical_description ||
      el.visual_details ||
      el.visual_prompt ||
      el.الوصف ||
      (typeof el === "string" ? el : `عنصر ${cat}`);
    const visual = el.visual_details || el.visual_description || el.visual_prompt || el.appearance || desc;
    const visualPrompt = el.visual_prompt || el.reference_prompt || (typeof visual === "string" ? visual : JSON.stringify(visual));

    productionElements.push({
      status: el.status || "DRAFT",
      ...el,
      id,
      entity_id: id,
      type: el.type || cat.toLowerCase(),
      target_step: el.target_step || "production_elements",
      category: cat,
      name,
      description: typeof desc === "string" ? desc : JSON.stringify(desc),
      visual_details: typeof visual === "string" ? visual : JSON.stringify(visual),
      visual_prompt: visualPrompt,
      reference_prompt: el.reference_prompt || visualPrompt,
      canonical_description: typeof desc === "string" ? desc : JSON.stringify(desc),
      canonical_name: name,
    });
  };

  // أ. تفريغ عناصر الإنتاج الجاهزة إن وجدت (دعم البيانات القديمة والمجهزة)
  rawProductionElements.forEach((el: any, idx: number) => {
    const cat = normalizeProductionCategory(el.category || el.entity_type || el.type);
    const defaultPrefix =
      cat === "WEAPON"
        ? "WEAPON"
        : cat === "ITEM"
        ? "ITEM"
        : cat === "CHARACTER"
        ? "CHAR"
        : cat === "CREATURE"
        ? "CREATURE"
        : cat === "BUILDING"
        ? "BLDG"
        : cat === "VEHICLE"
        ? "VEHICLE"
        : cat;
    registerElement(el, cat, defaultPrefix, idx);
  });

  // ب. الشخصيات
  rawCharacters.forEach((c: any, idx: number) => {
    registerElement(c, "CHARACTER", "CHAR", idx);
  });

  // ج. الأسلحة المستقلة
  rawWeaponsList.forEach((w: any, idx: number) => {
    registerElement(w, "WEAPON", "WEAPON", idx);
  });

  // د. العناصر المستقلة
  rawItemsList.forEach((it: any, idx: number) => {
    registerElement(it, "ITEM", "ITEM", idx);
  });

  // هـ. المخلوقات المستقلة
  rawCreaturesList.forEach((cr: any, idx: number) => {
    registerElement(cr, "CREATURE", "CREATURE", idx);
  });

  // و. المباني والآثار المستقلة
  rawBuildingsList.forEach((b: any, idx: number) => {
    registerElement(b, "BUILDING", "BLDG", idx);
  });

  // ز. المركبات المستقلة
  rawVehiclesList.forEach((v: any, idx: number) => {
    registerElement(v, "VEHICLE", "VEHICLE", idx);
  });

  // 3. بناء القوائم المستقلة من موسوعة العناصر الإنتاجية (Normalized Lists)
  const weapons: any[] = productionElements
    .filter((e) => e.category === "WEAPON")
    .map((w) => ({
      ...w,
      id: w.id || w.entity_id,
      name: w.name,
      description: w.description || w.visual_details || "",
      source_element_id: w.id || w.entity_id,
      category: "WEAPON",
    }));

  const items: any[] = productionElements
    .filter((e) => e.category === "ITEM")
    .map((it) => ({
      ...it,
      id: it.id || it.entity_id,
      name: it.name,
      description: it.description || it.visual_details || "",
      source_element_id: it.id || it.entity_id,
      category: "ITEM",
    }));

  const characters: any[] = productionElements
    .filter((e) => e.category === "CHARACTER")
    .map((c) => ({
      ...c,
      id: c.id || c.entity_id,
      name: c.name,
      description: c.description || c.visual_details || "",
      source_element_id: c.id || c.entity_id,
      category: "CHARACTER",
    }));

  const creatures: any[] = productionElements
    .filter((e) => e.category === "CREATURE")
    .map((cr) => ({
      ...cr,
      id: cr.id || cr.entity_id,
      name: cr.name,
      description: cr.description || cr.visual_details || "",
      source_element_id: cr.id || cr.entity_id,
      category: "CREATURE",
    }));

  const buildings: any[] = productionElements
    .filter((e) => e.category === "BUILDING")
    .map((b) => ({
      ...b,
      id: b.id || b.entity_id,
      name: b.name,
      description: b.description || b.visual_details || "",
      source_element_id: b.id || b.entity_id,
      category: "BUILDING",
    }));

  const vehicles: any[] = productionElements
    .filter((e) => e.category === "VEHICLE")
    .map((v) => ({
      ...v,
      id: v.id || v.entity_id,
      name: v.name,
      description: v.description || v.visual_details || "",
      source_element_id: v.id || v.entity_id,
      category: "VEHICLE",
    }));

  // 4. Locations
  const locations: StudioLocationItem[] = rawLocations.map((l: any, idx: number) => {
    const location_id =
      typeof l.location_id === "string" && /^LOC_\d{3}$/.test(l.location_id)
        ? l.location_id
        : typeof l.id === "string" && /^LOC_\d{3}$/.test(l.id)
        ? l.id
        : `LOC_${String(idx + 1).padStart(3, "0")}`;
    const name = l.name || l.location_name || l.الموقع || `موقع ${idx + 1}`;
    const desc =
      l.description ||
      l.visual_description ||
      l.visual_prompt ||
      l.environment ||
      l.الوصف ||
      (typeof l === "string" ? l : "موقع أساسي في الرواية");
    const visualPrompt = l.visual_prompt || l.reference_prompt || l.visual_description || desc;
    return {
      ...l,
      id: location_id,
      location_id,
      entity_id: location_id,
      target_step: l.target_step || "locations",
      type: l.type || "EXTERIOR",
      name,
      description: typeof desc === "string" ? desc : JSON.stringify(desc),
      visual_description: l.visual_description || desc,
      visual_prompt: visualPrompt,
      reference_prompt: l.reference_prompt || visualPrompt,
      environment: l.environment || desc,
      architecture: l.architecture || "",
      ground: l.ground || "",
      sky: l.sky || "",
      weather: l.weather || "",
      lighting: l.lighting || l.lighting_and_atmosphere || "",
      status: l.status || "DRAFT",
    };
  });

  // 5. Events (أحداث درامية مستقلة - ممنوع اعتبار Event = Item)
  const events: any[] = (rawEvents.length > 0 ? rawEvents : rawScenes).map((ev: any, idx: number) => {
    if (typeof ev === "string") {
      return {
        event_id: `EVENT_${String(idx + 1).padStart(3, "0")}`,
        order: idx + 1,
        event_number: idx + 1,
        title: `الحدث ${idx + 1}`,
        event_title: `الحدث ${idx + 1}`,
        summary: ev,
        description: ev,
        linked_scene_id: `SCENE_${String(idx + 1).padStart(3, "0")}`,
      };
    }
    const order = Number(ev.order || ev.event_number || ev.scene_number || idx + 1);
    const event_id = ev.event_id || ev.id || `EVENT_${String(order).padStart(3, "0")}`;
    const title = ev.title || ev.event_title || ev.name || `الحدث ${order}`;
    const summary = ev.summary || ev.description || ev.action || ev.details || ev.dramatic_summary || "";
    const linked_scene_id = ev.linked_scene_id || ev.scene_id || `SCENE_${String(order).padStart(3, "0")}`;
    return {
      ...ev,
      event_id,
      order,
      event_number: order,
      title,
      event_title: title,
      summary,
      description: summary,
      linked_scene_id,
      location: ev.location || "",
      characters: ev.characters || [],
      key_objects: ev.key_objects || [],
      action_and_dialogue: ev.action_and_dialogue || ev.action || "",
    };
  });

  // 6. Scenes with Strict Independent Entity Linking
  const storyScriptArray: any[] = Array.isArray(payload.story?.script)
    ? payload.story.script
    : Array.isArray(payload.script)
    ? payload.script
    : [];
  const resolvedPagePlans: any[] = Array.isArray(payload.page_plans)
    ? payload.page_plans
    : Array.isArray(payload.pages)
    ? payload.pages
    : Array.isArray(payload.manhwa_pages)
    ? payload.manhwa_pages
    : Array.isArray(universalConverted?.pages)
    ? universalConverted.pages
    : [];
  const allPagePlanPanels: any[] = resolvedPagePlans.flatMap((pp: any) =>
    Array.isArray(pp?.panels) ? pp.panels : []
  );

  const scenes: StudioSceneItem[] = rawScenes.map((s: any, idx: number) => {
    const scene_id = s.scene_id || s.id || `SCENE_${String(idx + 1).padStart(3, "0")}`;
    const scene_number = Number(s.scene_number || s.order) || idx + 1;
    const title = s.title || s.name || s.العنوان || `مشهد ${idx + 1}`;
    const matchedScriptItem = storyScriptArray.find(
      ( item: any ) => item && (item.scene_id === scene_id || item.id === scene_id)
    );
    const matchedPanelItem = allPagePlanPanels.find(
      ( item: any ) => item && (item.scene_id === scene_id || item.source_scene_id === scene_id)
    );
    const desc =
      s.description ||
      s.action_summary ||
      s.dramatic_summary ||
      s.summary ||
      s.action ||
      matchedScriptItem?.narration ||
      s.الوصف ||
      (typeof s === "string" ? s : "مشهد درامي متسلسل");
    const rawLocStr = typeof s.location === "string" ? s.location.trim() : "";
    const matchedLoc =
      locations.find((l) => l.location_id === s.location_id) ||
      (rawLocStr ? locations.find((l) => l.description.includes(rawLocStr) || l.name === rawLocStr || rawLocStr.includes(l.name)) : null) ||
      locations[idx % Math.max(1, locations.length)] ||
      locations[0];

    const locId =
      s.location_id ||
      s.primary_location_id ||
      matchedLoc?.location_id ||
      (locations[0]?.location_id || "LOC_001");
    const locName =
      s.location_name ||
      matchedLoc?.name ||
      s.location ||
      "الموقع الرئيسي";

    const charactersInScene: string[] = Array.isArray(s.characters)
      ? s.characters.map((ch: any) => (typeof ch === "string" ? ch : ch.name || ch.id))
      : characters.map((c) => c.name).slice(0, 2);

    const actionText = s.action || s.action_summary || desc;
    const rawDialogueSource =
      s.dialogue ??
      s.dialogues ??
      matchedScriptItem?.dialogue ??
      (matchedPanelItem?.dialogue_text ? [matchedPanelItem.dialogue_text] : undefined);
    const dialogueArr = Array.isArray(rawDialogueSource) ? rawDialogueSource : [];
    const dialogueText =
      typeof rawDialogueSource === "string"
        ? rawDialogueSource
        : dialogueArr.length > 0
        ? dialogueArr
            .map((d: any) =>
              typeof d === "string" ? d : d.speaker ? `${d.speaker}: "${d.text || ""}"` : `${d.text || ""}`
            )
            .join(" | ")
        : matchedPanelItem?.dialogue_text || "";
    const visualPrompt =
      s.visual_prompt ||
      s.page_prompt ||
      s.scene_prompt ||
      s.prompt ||
      `${desc}. Highly detailed manhwa scene composition, dynamic cinematic lighting.`;

    const sceneCombinedText = `${title} ${desc} ${actionText} ${(s.costumes_and_weapons || []).join(" ")} ${(s.weapons || []).join(" ")} ${(s.items || []).join(" ")}`.toLowerCase();

    // Scene Entity Linking (Strict Category Separation)
    const hasExplicitWeaponIds = Array.isArray(s.weapon_ids);
    const hasExplicitItemIds = Array.isArray(s.item_ids);
    const hasExplicitCreatureIds = Array.isArray(s.creature_ids);
    const hasExplicitCharIds = Array.isArray(s.character_ids);

    // أ. الأسلحة في المشهد (weapon_ids) - ممنوع وضع الأسلحة في item_ids!
    const sceneWeaponIds = weapons
      .filter((w) => {
        if (hasExplicitWeaponIds) return s.weapon_ids.includes(w.id);
        if (Array.isArray(s.costumes_and_weapons) && s.costumes_and_weapons.some((cw: string) => cw.includes(w.name) || w.name.includes(cw))) return true;
        return sceneCombinedText.includes(w.name.toLowerCase());
      })
      .map((w) => w.id);

    // ب. العناصر في المشهد (item_ids) - حصرياً للعناصر، ممنوع وضع السلاح هنا!
    const sceneItemIds = items
      .filter((it) => {
        if (hasExplicitItemIds) return s.item_ids.includes(it.id);
        if (Array.isArray(s.costumes_and_weapons) && s.costumes_and_weapons.some((cw: string) => cw.includes(it.name) || it.name.includes(cw))) return true;
        return sceneCombinedText.includes(it.name.toLowerCase());
      })
      .map((it) => it.id);

    // ج. تنظيف وتجميع أسلحة المشهد (weapon_ids)
    const cleanWeaponIds = (hasExplicitWeaponIds ? [...s.weapon_ids] : []);
    if (!hasExplicitWeaponIds && Array.isArray(s.item_ids)) {
      for (const id of s.item_ids) {
        if (id.startsWith("WEAPON_") || id.startsWith("WEAP_") || weapons.some((w) => w.id === id)) {
          if (!cleanWeaponIds.includes(id)) cleanWeaponIds.push(id);
        }
      }
    }
    for (const wId of sceneWeaponIds) {
      if (!cleanWeaponIds.includes(wId)) cleanWeaponIds.push(wId);
    }

    // د. تنظيف وتجميع عناصر المشهد (item_ids) - ممنوع منعاً باتاً وجود أي سلاح هنا
    const cleanItemIds = (hasExplicitItemIds ? s.item_ids : [])
      .filter((id: string) => !id.startsWith("WEAPON_") && !id.startsWith("WEAP_") && !cleanWeaponIds.includes(id) && !weapons.some((w) => w.id === id));
    for (const itId of sceneItemIds) {
      if (!cleanItemIds.includes(itId) && !cleanWeaponIds.includes(itId) && !weapons.some((w) => w.id === itId)) {
        cleanItemIds.push(itId);
      }
    }

    // د. المخلوقات والمباني والمركبات والشخصيات
    const sceneCreatureIds = creatures
      .filter((cr) => (hasExplicitCreatureIds ? s.creature_ids.includes(cr.id) : sceneCombinedText.includes(cr.name.toLowerCase())))
      .map((cr) => cr.id);
    const finalCreatureIds = hasExplicitCreatureIds
      ? Array.from(new Set([...s.creature_ids, ...sceneCreatureIds]))
      : sceneCreatureIds;

    const sceneBuildingIds = buildings
      .filter((b) => (Array.isArray(s.building_ids) ? s.building_ids.includes(b.id) : sceneCombinedText.includes(b.name.toLowerCase())))
      .map((b) => b.id);
    const sceneVehicleIds = vehicles
      .filter((v) => (Array.isArray(s.vehicle_ids) ? s.vehicle_ids.includes(v.id) : sceneCombinedText.includes(v.name.toLowerCase())))
      .map((v) => v.id);
    const sceneCharIds = characters
      .filter((c) => (hasExplicitCharIds ? s.character_ids.includes(c.id) : charactersInScene.some((chName) => chName.includes(c.name) || c.name.includes(chName))))
      .map((c) => c.id);
    const finalCharIds = hasExplicitCharIds
      ? Array.from(new Set([...s.character_ids, ...sceneCharIds]))
      : sceneCharIds.length > 0
      ? sceneCharIds
      : characters.slice(0, 2).map((c) => c.id);

    const rawSfxSource = s.sfx ?? matchedScriptItem?.sfx ?? matchedPanelItem?.sfx_text;
    const sfxList = Array.isArray(rawSfxSource)
      ? rawSfxSource
      : typeof rawSfxSource === "string" && rawSfxSource
      ? [rawSfxSource]
      : [];
    const sfxText = Array.isArray(rawSfxSource) ? rawSfxSource.join(" / ") : rawSfxSource || "";
    const panelPlan = Array.isArray(s.panel_plan)
      ? s.panel_plan
      : Array.isArray(s.panels)
      ? s.panels
      : Array.isArray(s.shots_panels)
      ? s.shots_panels
      : [];
    const validShotPanelObjects = panelPlan.filter(
      (p: any) => p && typeof p === "object" && !Array.isArray(p)
    );
    const rawNarrationSource = s.narration ?? matchedScriptItem?.narration;

    return {
      approved: false,
      ...s,
      id: scene_id,
      scene_id,
      event_id: s.event_id || matchedScriptItem?.event_id || events[idx]?.event_id || `EVENT_${String(scene_number).padStart(3, "0")}`,
      scene_number,
      scene_order: scene_number,
      order: scene_number,
      title,
      camera_angle: s.camera_angle || s.camera || "Eye-Level",
      shot_type: s.shot_type || s.camera || "Medium Shot",
      lighting: s.lighting || "",
      summary: s.summary || s.action_summary || (typeof desc === "string" ? desc : JSON.stringify(desc)),
      description: typeof desc === "string" ? desc : JSON.stringify(desc),
      action: typeof actionText === "string" ? actionText : JSON.stringify(actionText),
      dialogue: typeof dialogueText === "string" ? dialogueText : JSON.stringify(dialogueText),
      dialogue_list: dialogueArr,
      narration: Array.isArray(rawNarrationSource)
        ? rawNarrationSource
        : rawNarrationSource
        ? [String(rawNarrationSource)]
        : [],
      sfx: sfxText,
      sfx_list: sfxList,
      visual_prompt: visualPrompt,
      page_prompt: s.page_prompt || visualPrompt,
      location_id: locId,
      location_ids: Array.isArray(s.location_ids) && s.location_ids.length > 0 ? s.location_ids : [locId],
      location_name: locName,
      characters: charactersInScene,
      character_ids: finalCharIds,
      weapon_ids: cleanWeaponIds,
      item_ids: cleanItemIds,
      creature_ids: finalCreatureIds,
      building_ids: sceneBuildingIds,
      vehicle_ids: sceneVehicleIds,
      costumes_and_weapons: s.costumes_and_weapons || [],
      panel_plan: panelPlan,
      panels: validShotPanelObjects,
      shots_panels: validShotPanelObjects,
    };
  });

  // Assembled Script Text (Acts as Source of Truth across the studio)
  const rawScriptCandidate =
    universalConverted?.story?.script ||
    payload.story?.script ||
    (typeof payload.script === "string" ? payload.script : "") ||
    payload.script_text ||
    "";
  let scriptText = "";
  if (typeof rawScriptCandidate === "string" && rawScriptCandidate.trim()) {
    scriptText = rawScriptCandidate.trim();
  } else if (Array.isArray(rawScriptCandidate) && rawScriptCandidate.length > 0) {
    scriptText = rawScriptCandidate
      .map((item: any, i: number) => {
        const scId = item.scene_id || `SCENE_${String(i + 1).padStart(3, "0")}`;
        const evId = item.event_id || `EVENT_${String(i + 1).padStart(3, "0")}`;
        const narr = item.narration ? `السرد: ${item.narration}` : "";
        const dial = Array.isArray(item.dialogue)
          ? item.dialogue.map((d: any) => `${d.speaker || "حوار"}: "${d.text || ""}"`).join(" | ")
          : item.dialogue || "";
        const sfxLine = Array.isArray(item.sfx) ? `مؤثرات صوتية: ${item.sfx.join(" / ")}` : item.sfx ? `مؤثرات صوتية: ${item.sfx}` : "";
        return [`=== [${scId} -> ${evId}] ===`, narr, dial ? `الحوار: ${dial}` : "", sfxLine]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }
  if (!scriptText) {
    if (scenes.length > 0) {
      scriptText = scenes
        .map((sc, i) => {
          const header = `=== المشهد ${sc.scene_number || i + 1}: ${sc.title} [${sc.location_name}] ===`;
          const chars = sc.characters.length > 0 ? `الشخصيات: ${sc.characters.join(", ")}` : "";
          const act = `الحدث / الحركة: ${sc.action || sc.description}`;
          const dial = sc.dialogue ? `الحوار:\n${sc.dialogue}` : "";
          const vis = sc.visual_prompt ? `التوجيه البصري: ${sc.visual_prompt}` : "";
          return [header, chars, act, dial, vis].filter(Boolean).join("\n");
        })
        .join("\n\n----------------------------------------\n\n");
    } else if (rawEvents.length > 0) {
      scriptText = rawEvents
        .map((ev: any, i: number) => `الحدث ${i + 1}: ${typeof ev === "string" ? ev : ev.description || JSON.stringify(ev)}`)
        .join("\n\n");
    } else {
      scriptText = trimmed;
    }
  }

  // Long novel report wrapper
  let longNovelReport: LongNovelSegmentationReport | null = null;
  if (scenes.length > 0 || rawEvents.length > 0) {
    longNovelReport = {
      chapter_id: detectedChapter,
      chapter_title: detectedTitle || currentNovelTitle || "الفصل المجهز",
      total_paragraphs: Math.max(1, scenes.length),
      total_words: trimmed.split(/\s+/).filter(Boolean).length,
      total_blocks: Math.max(1, Math.ceil(scenes.length / 2)),
      total_events: Math.max(scenes.length, rawEvents.length),
      total_scenes: scenes.length,
      total_shots_panels: scenes.reduce((acc, s) => acc + (s.shots_panels?.length || 2), 0),
      coverage_percentage: 100,
      unmapped_events_count: 0,
      de_merged_scenes_count: 0,
      pipeline_stages: [],
      blocks: [],
      generated_at: new Date().toISOString(),
      global_chapter_context: {
        chapter_id: detectedChapter,
        chapter_title: detectedTitle || currentNovelTitle || "الفصل المجهز",
        characters: productionElements
          .filter((e) => e.category === "CHARACTER")
          .map((ch) => ({
            character_id: ch.id,
            name: ch.name,
            clothing_and_armor: ch.clothing || ch.clothing_and_armor || "زي الشخصية المعتمد",
            weapons: ch.weapons_and_accessories ? [ch.weapons_and_accessories] : [],
            physical_state: "حالة جسدية متوازنة",
            emotional_state: "جاهزية واستعداد درامي",
            current_location: locations[0]?.name || "الموقع الرئيسي",
            movement_direction: "تسلسل متصل",
          })),
        clothing_states: [],
        weapons_states: [],
        physical_states: [],
        current_location: locations[0]?.name || "الموقع الرئيسي",
        visited_locations: locations.map((l) => l.name),
        movement_direction: "تسلسل درامي متصل بدون انقطاع",
        time_progression: "متسلسل زمنيًا",
        lighting_and_atmosphere:
          locations[0]?.lighting || "إضاءة سينمائية متسقة مستخرجة من التحليل المسبق",
        previous_events_summary: [],
        important_lore_and_revelations: Array.isArray(rawCanon)
          ? rawCanon
          : [String(rawCanon || "بيانات Canon محفوظة")],
        threats_and_future_hooks: [],
        character_relationships: payload.character_relationships || [
          "ترابط شخصيات محدد مسبقاً",
        ],
        updated_at: new Date().toISOString(),
      },
    };
  }

  const contentHash = computeContentHash(trimmed);
  const preparedNovelId = `prep_${Date.now()}_${contentHash.slice(0, 8)}`;

  const stats = {
    scenes_count: scenes.length,
    characters_count: characters.length,
    locations_count: locations.length,
    events_count: events.length,
    weapons_count: weapons.length,
    items_count: items.length,
    creatures_count: creatures.length,
  };

  const taggedScenes = scenes.map((s) => ({
    ...s,
    derived_from_prepared_novel_id: preparedNovelId,
    derived_from_content_hash: contentHash,
  }));

  const taggedLocations = locations.map((l) => ({
    ...l,
    derived_from_prepared_novel_id: preparedNovelId,
    derived_from_content_hash: contentHash,
  }));

  const taggedProductionElements = productionElements.map((el) => ({
    ...el,
    derived_from_prepared_novel_id: preparedNovelId,
    derived_from_content_hash: contentHash,
  }));

  const parsedData: PreparedNovelData = {
    prepared_novel_id: preparedNovelId,
    content_hash: contentHash,
    created_at: new Date().toISOString(),
    status: errors.length === 0 ? "VALIDATED" : "DRAFT",
    active_source: "PREPARED_NOVEL_DATA",
    source_type: "external_ai_analysis",
    schema_version: "1.0.0",
    novel_title: detectedTitle || currentNovelTitle || "رواية مجهزة مسبقاً",
    chapter_identifier: detectedChapter,
    raw_input: trimmed,
    raw_payload: payload,
    canon: rawCanon,
    ordered_events: events,
    characters,
    character_descriptions: payload.character_descriptions || [],
    character_relationships: payload.character_relationships || [],
    locations: taggedLocations,
    world_information: payload.world_information || payload.world,
    events,
    scenes: taggedScenes,
    timeline: payload.timeline || [],
    important_objects: payload.important_objects || [],
    weapons,
    items,
    creatures,
    buildings,
    vehicles,
    production_elements: taggedProductionElements,
    abilities: payload.abilities || [],
    dialogue: payload.dialogue || [],
    visual_descriptions: payload.visual_descriptions || [],
    environment: payload.environment,
    continuity_information: payload.continuity_information,
    scene_relationships: payload.scene_relationships || [],
    ids: payload.ids || {},
    source_references: payload.source_references || [],
    custom_fields: customFields,
    reference_sheets: universalSheets,
    universal_json: isUniversalJson ? (payload as any) : undefined,
    universal_validation_report: universalReport,
    project_name: payload.project_name || detectedTitle || undefined,
    story: payload.story || {
      title: detectedTitle,
      novel_text: rawCanon || currentNovelText || "",
      script: payload.story?.script || scriptText,
      events,
    },
    style: payload.style || undefined,
    pipeline_settings: payload.pipeline_settings || undefined,
    page_plans: resolvedPagePlans.length > 0 ? resolvedPagePlans : undefined,
    converted_studio_data: {
      script_text: scriptText,
      production_elements: taggedProductionElements,
      locations: taggedLocations,
      scenes: taggedScenes,
      characters,
      weapons,
      items,
      creatures,
      buildings,
      vehicles,
      events,
      reference_sheets: universalSheets,
      universal_validation_report: universalReport,
      long_novel_report: longNovelReport,
    },
    stats,
  };

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    mismatchWarning,
    detectedTitle: detectedTitle || undefined,
    detectedChapter,
    stats,
    parsedData,
    universal_validation_report: universalReport,
    reference_sheets: universalSheets,
  };
}

/**
 * Commits and adopts a prepared novel dataset as the single active source of truth.
 * Ensures full normalization and direct synchronization across all entities.
 */
export function adoptPreparedNovelDataset(
  data: PreparedNovelData
): ActivePreparedNovelData {
  const adoptedAt = new Date().toISOString();
  const orderedEvents =
    Array.isArray(data.ordered_events) && data.ordered_events.length > 0
      ? data.ordered_events
      : Array.isArray(data.events)
      ? data.events
      : [];

  const studioData = data.converted_studio_data;
  const scenes =
    Array.isArray(studioData?.scenes) && studioData.scenes.length > 0
      ? studioData.scenes
      : Array.isArray(data.scenes)
      ? data.scenes
      : [];

  const locations =
    Array.isArray(studioData?.locations) && studioData.locations.length > 0
      ? studioData.locations
      : Array.isArray(data.locations)
      ? data.locations
      : [];

  const production_elements =
    Array.isArray(studioData?.production_elements) && studioData.production_elements.length > 0
      ? studioData.production_elements
      : Array.isArray(data.production_elements)
      ? data.production_elements
      : [];

  const characters =
    Array.isArray(studioData?.characters) && studioData.characters.length > 0
      ? studioData.characters
      : Array.isArray(data.characters)
      ? data.characters
      : [];

  const weapons =
    Array.isArray(studioData?.weapons) && studioData.weapons.length > 0
      ? studioData.weapons
      : Array.isArray(data.weapons)
      ? data.weapons
      : [];

  const items =
    Array.isArray(studioData?.items) && studioData.items.length > 0
      ? studioData.items
      : Array.isArray(data.items)
      ? data.items
      : [];

  const creatures =
    Array.isArray(studioData?.creatures) && studioData.creatures.length > 0
      ? studioData.creatures
      : Array.isArray(data.creatures)
      ? data.creatures
      : [];

  const buildings =
    Array.isArray(studioData?.buildings) && studioData.buildings.length > 0
      ? studioData.buildings
      : Array.isArray(data.buildings)
      ? data.buildings
      : [];

  const vehicles =
    Array.isArray(studioData?.vehicles) && studioData.vehicles.length > 0
      ? studioData.vehicles
      : Array.isArray(data.vehicles)
      ? data.vehicles
      : [];

  const normalizedStudioData = {
    script_text: studioData?.script_text || data.raw_input || "",
    production_elements,
    locations,
    scenes,
    characters,
    weapons,
    items,
    creatures,
    buildings,
    vehicles,
    events: orderedEvents,
    reference_sheets: data.reference_sheets || studioData?.reference_sheets,
    universal_validation_report: data.universal_validation_report || studioData?.universal_validation_report,
    long_novel_report: studioData?.long_novel_report || null,
  };

  return {
    ...data,
    reference_sheets: data.reference_sheets || studioData?.reference_sheets,
    universal_json: data.universal_json,
    universal_validation_report: data.universal_validation_report || studioData?.universal_validation_report,
    project_name: (data as any).project_name || data.novel_title,
    story: (data as any).story || data.raw_payload?.story,
    style: (data as any).style || data.raw_payload?.style,
    pipeline_settings: (data as any).pipeline_settings || data.raw_payload?.pipeline_settings,
    page_plans: (data as any).page_plans || data.raw_payload?.page_plans,
    prepared_novel_id: data.prepared_novel_id || `prep_${Date.now()}`,
    content_hash: data.content_hash || `hash_${Date.now()}`,
    schema_version: data.schema_version || "1.0.0",
    source_type: "external_ai_analysis",
    novel_title: data.novel_title || "رواية مجهزة",
    chapter_identifier: data.chapter_identifier || "الفصل 01",
    raw_input: data.raw_input || JSON.stringify(data),
    status: "ADOPTED",
    adopted_at: adoptedAt,
    active_source: "PREPARED_NOVEL_DATA",
    ordered_events: orderedEvents,
    events: orderedEvents,
    scenes,
    locations,
    characters,
    weapons,
    items,
    creatures,
    buildings,
    vehicles,
    production_elements,
    converted_studio_data: normalizedStudioData,
    stats: {
      scenes_count: scenes.length,
      characters_count: characters.length,
      locations_count: locations.length,
      events_count: orderedEvents.length,
      weapons_count: weapons.length,
      items_count: items.length,
      creatures_count: creatures.length,
    },
  };
}

export function isDatasetAdopted(data?: PreparedNovelData | null): data is ActivePreparedNovelData {
  return Boolean(
    data &&
      (data.status === "ADOPTED" ||
        (data as any).active_source === "PREPARED_NOVEL_DATA" ||
        (data as any).active_source === "prepared_novel_data") &&
      Boolean(data.prepared_novel_id || data.content_hash)
  );
}

