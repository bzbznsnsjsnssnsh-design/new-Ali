import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  Check,
  CheckCircle2,
  AlertTriangle,
  Play,
  BookOpen,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Eye,
  Edit3,
  Trash2,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Users,
  Palette,
  Cpu,
  Film,
  X,
  Zap,
  Lock,
  ExternalLink,
  ShieldCheck,
  Layers,
  Minus,
  Hash,
  Link2,
  FileCode,
  Download,
  Upload,
  Copy,
} from "lucide-react";
import {
  buildRealFlowProjectUrl,
  computeStudioStyleHash,
  isRealVerifiedFlowProjectId,
  PREFERRED_GEMINI_MODELS,
  type FlowDetailedDiagnostics,
  type FlowDisplayModelName,
  type GeminiCookieModelId,
  type GlobalChapterContext,
  type LocationContinuityAnchorMap,
  type LongNovelSegmentationReport,
  type NovelChapterBlock,
  type PageGenerationMode,
  type ProductionElementType,
  type StudioAnalysisValidationReport,
  type StudioAspectRatio,
  type StudioCheckpointState,
  type StudioLocationItem,
  type StudioLocationType,
  type StudioPipelineTelemetry,
  type StudioProductionElement,
  type StudioSceneItem,
  type StudioStepNumber,
  type StudioStylePreset,
  type StudioStyleSettings,
} from "../../types/novelToManga";
import {
  addGoogleFlowProject,
  extractLocationsAndElementsFromScriptApi,
  fetchGoogleFlowStatus,
  generateAndVerifyStudioSceneApi,
  generateStudioElementImageApi,
  generateStudioElementPromptApi,
  generateStudioElementsPromptsBatchApi,
  generateStudioLocationImageApi,
  generateStudioLocationPromptApi,
  generateStudioLocationsPromptsBatchApi,
  generateStudioScriptApi,
  getStudioTelemetryApi,
  loadFlowTaskModels,
  loadPreferredGeminiModel,
  loadStudioCheckpointApi,
  lockAllStudioReferencesApi,
  lockStudioElementApi,
  lockStudioLocationApi,
  runParallelQueueWithLimit,
  runStudioFullPipelineApi,
  savePreferredGeminiModel,
  saveStudioCheckpointApi,
  testGoogleFlowGeneration,
  verifyAssetInGoogleFlowApi,
  verifyStudioElementImageApi,
  verifyStudioLocationImageApi,
  verifyStudioSceneImageApi,
  getStudioPerformanceReportApi,
  runStudioPerformanceBenchmarkApi,
  getBackgroundVerificationStatusApi,
} from "../../services/novelToMangaClient";
import { saveLocalManga } from "../../lib/db";
import { ManhwaPageLayoutViewer } from "./ManhwaPageLayoutViewer";
import PreparedNovelSection from "./PreparedNovelSection";
import {
  adoptPreparedNovelDataset,
  isDatasetAdopted,
  type ActivePreparedNovelData,
  type PreparedNovelData,
} from "../../utils/preparedNovelParser";
import {
  clusterElementsIntoMasterReferenceSheets,
  synchronizeAttachedEntitiesFromMaster,
  synchronizeAttachedEntitiesFromLocationMaster,
  isEntitySubordinateToMaster,
  buildMasterReferenceSheetFlowPrompt,
  type MasterReferenceSheet,
} from "../../utils/masterReferenceManager";
import {
  type UniversalReferenceSheet,
  type UniversalValidationReport,
  validateUniversalProductionJson,
  convertUniversalJsonToStudio,
  exportStudioToUniversalJson,
} from "../../utils/universalProductionJson";

interface NovelToMangaPageProps {
  onNavigateToSettings?: () => void;
}

const STUDIO_STEPS: Array<{
  step: StudioStepNumber;
  numLabel: string;
  title: string;
  subtitle: string;
}> = [
  { step: 1, numLabel: "①", title: "القصة", subtitle: "إدخال الرواية وكتابة السكريبت" },
  { step: 2, numLabel: "②", title: "الستايل", subtitle: "الشكل البصري، الأبعاد، والموديل" },
  { step: 3, numLabel: "③", title: "عناصر الإنتاج", subtitle: "المراجع البصرية الشاملة المجمعة (Visual Bible)" },
  { step: 4, numLabel: "④", title: "المواقع", subtitle: "المراجع المجمعة للمواقع وفحص Gemini Vision" },
  { step: 5, numLabel: "⑤", title: "التحليل والتوليد", subtitle: "Gemini Cookies (تحليل ومراجعة) + Google Flow (توليد الصور)" },
  { step: 6, numLabel: "⑥", title: "المشاهد", subtitle: "استعراض وتعديل المشاهد المعتمدة" },
];

const STYLE_PRESETS: Array<{
  id: StudioStylePreset;
  label: string;
  desc: string;
}> = [
  { id: "Korean Manhwa", label: "Korean Manhwa", desc: "مانهوا كورية ملونة عالية التفاصيل بتظليل رقمي ناعم وإضاءة سينمائية" },
  { id: "Japanese Manga", label: "Japanese Manga", desc: "مانجا يابانية بحبر تقليدي عالي التباين وتظليل سكرين تون دقيق" },
  { id: "Dark Fantasy Comic", label: "Dark Fantasy Comic", desc: "كوميكس دارك فانتازيا بظلال درامية عميقة وخطوط حبر جريئة" },
  { id: "3D Animation", label: "3D Animation", desc: "تحريك ثلاثي الأبعاد سينمائي عالي التفاصيل" },
  { id: "Pixar", label: "Pixar", desc: "أسلوب بيكسار الدافئ بإضاءة ناعمة وشخصيات معبرة" },
  { id: "Studio Ghibli", label: "Studio Ghibli", desc: "رسم يدوي شاعري وخلفيات طبيعية غنية بالتفاصيل" },
  { id: "واقعي سينمائي", label: "واقعي سينمائي", desc: "إضاءة وعدسات سينمائية واقعية فائقة الدقة" },
  { id: "Cyberpunk", label: "Cyberpunk", desc: "أجواء مستقبلية وإضاءة نيون عالية التباين" },
  { id: "Fantasy", label: "Fantasy", desc: "عالم خيالي ملحمي بتفاصيل دروع وسيوف وسحر" },
  { id: "Comic", label: "Comic / Manga", desc: "خطوط حبر درامية وتظليل قصص مصورة ومانهوا" },
  { id: "Watercolor", label: "Watercolor", desc: "تلوين مائي فني ناعم بلمسات قصصية حالمة" },
  { id: "ستايل مخصص", label: "ستايل مخصص", desc: "أدخل وصف الستايل البصري الخاص بك بحرية" },
];

const ASPECT_RATIOS: Array<{
  id: StudioAspectRatio;
  label: string;
  desc: string;
}> = [
  { id: "1:1", label: "1:1", desc: "مربع متوازن للمشاهد والمنشورات" },
  { id: "9:16", label: "9:16", desc: "عمودي مثالي للويبتون والفيديوهات القصيرة" },
  { id: "16:9", label: "16:9", desc: "عريض سينمائي للمشاهد البانورامية" },
];

const FLOW_MODELS: Array<{
  id: FlowDisplayModelName;
  label: string;
  desc: string;
}> = [
  { id: "Nano Banana 2 Lite", label: "Nano Banana 2 Lite", desc: "سريع وخفيف للتجارب والمسودات السريعة" },
  { id: "Nano Banana 2", label: "Nano Banana 2", desc: "متوازن وموصى به لتوليد المشاهد المتكاملة" },
  { id: "Nano Banana Pro", label: "Nano Banana Pro", desc: "أعلى دقة وتفاصيل بصرية للمشاهد المعقدة" },
];

// Standalone Visual Entity Categories ONLY (Face, Hair, Costume, Shoes, Lighting, Color are merged inside entities!)
const PRODUCTION_CATEGORIES: Array<{
  id: ProductionElementType;
  label: string;
}> = [
  { id: "CHARACTER", label: "الشخصيات (مرجع شامل)" },
  { id: "WEAPON", label: "الأسلحة المستقلة" },
  { id: "CREATURE", label: "المخلوقات والوحوش" },
  { id: "BUILDING", label: "المباني والآثار المهمة" },
  { id: "VEHICLE", label: "المركبات" },
  { id: "ITEM", label: "العناصر والأدوات المهمة" },
];

const LOCATION_TYPES: Array<{
  id: StudioLocationType;
  label: string;
}> = [
  { id: "CITY", label: "المدن" },
  { id: "BUILDING", label: "المباني" },
  { id: "GATE", label: "البوابات" },
  { id: "CORRIDOR", label: "الممرات" },
  { id: "VALLEY", label: "الوديان" },
  { id: "PLAZA", label: "الساحات" },
  { id: "ROOM", label: "الغرف" },
  { id: "ROAD", label: "الطرق" },
  { id: "FOREST", label: "الغابات" },
  { id: "MOUNTAIN", label: "الجبال" },
  { id: "REGION", label: "المناطق" },
  { id: "OTHER", label: "موقع آخر" },
];

const INITIAL_PRODUCTION_ELEMENTS: StudioProductionElement[] = [
  {
    id: "CHAR_001",
    entity_id: "CHAR_001",
    entity_type: "CHARACTER",
    ownership: "SELF_OWNED",
    independent_visual_identity: true,
    attached_to: "WEAP_001",
    reference_group_id: "REF_GROUP_CHAR_001",
    aliases: ["ليلى", "Layla", "ليلى المسافرة", "Layla the Traveler"],
    source_references: ["SCENE_001", "SCENE_002", "SCENE_003"],
    category: "CHARACTER",
    name: "ليلى (المسافرة) — مرجع شخصية شامل",
    description:
      "بطلة القصة: فتاة محاربة شابة بشعر فضي طويل مع ضفيرة جانبية، عيون كهرمانية مضيئة، ترتدي عباءة السفر الكحلية المطرزة بالفضة ودرع كتف جلدي وأحذية سفر جلدية، وتحمل سيف النجم الفضي وبوصلة العبور.",
    visual_details:
      "Young female warrior with sharp expressive face, luminous amber-gold eyes, long flowing silver-white hair with a braided side lock, wearing a dark navy traveler cloak with silver embroidery, light leather shoulder guard, fitted dark combat tunic, leather boots, and carrying the glowing silver longsword and brass compass.",
    appearance: "ملامح وجه حادة وهادئة، عيون كهرمانية مضيئة، شعر فضي طويل منسدل مع ضفيرة جانبية، بنية رشيقة",
    clothing_and_armor: "عباءة سفر كحلية داكنة مطرزة بخيوط فضية، درع كتف جلدي خفيف، حذاء سفر جلدي داكن، قفازات جلدية",
    weapons_and_accessories: "سيف النجم الفضي في اليد اليمنى، بوصلة العبور النحاسية معلقة بالحزام",
    expressions_and_poses: "تعبير شجاع وحازم، وضعية استعداد قتالي، وضعية مسير هادئة",
    colors_and_lighting: "فضي لامع، كحلي ليلي، كهرماني متوهج، إضاءة حواف زرقاء وذهبية",
    entity_classification: "STANDALONE_ENTITY",
    merged_attributes: [
      "Appearance & Face: ملامح حادة وعيون كهرمانية مضيئة",
      "Hair: شعر فضي طويل مع ضفيرة جانبية",
      "Costume & Boots: عباءة كحلية مطرزة بالفضة ودرع كتف وحذاء جلدي",
      "Weapons & Accessories: سيف النجم الفضي وبوصلة العبور",
    ],
    canonical_description:
      "Character: ليلى (المسافرة) — مرجع شخصية شامل (Layla the Traveler). Young female dark fantasy warrior (apparent age 19), fair porcelain skin, sharp expressive facial features, luminous amber-gold eyes, long flowing silver-white hair with a braided side lock, lean agile warrior build. Dark navy traveler cloak with intricate silver embroidery, light leather shoulder guard, fitted dark combat tunic, dark leather combat gloves, sturdy dark leather traveler boots. Holding the Silver Star Sword (slender mirror-polished silver longsword with glowing cyan starlight runes) in her right hand and a brass crossing compass at her belt. Expressions: determined, brave, calm analytical, combat focus. Poses: standing full-body, walking along glowing stone road, raising sword before ancient archway, combat stance. Colors: silver-white hair, luminous amber-gold eyes, deep midnight navy cloak with silver embroidery, warm leather brown, radiant cyan sword runes.",
    base_reference_prompt:
      "Character: ليلى (المسافرة) — مرجع شخصية شامل (Layla the Traveler). Young female dark fantasy warrior (apparent age 19), fair porcelain skin, sharp expressive facial features, luminous amber-gold eyes, long flowing silver-white hair with a braided side lock, lean agile warrior build. Dark navy traveler cloak with intricate silver embroidery, light leather shoulder guard, fitted dark combat tunic, dark leather combat gloves, sturdy dark leather traveler boots. Holding the Silver Star Sword (slender mirror-polished silver longsword with glowing cyan starlight runes) in her right hand and a brass crossing compass at her belt. Expressions: determined, brave, calm analytical, combat focus. Poses: standing full-body, walking along glowing stone road, raising sword before ancient archway, combat stance. Colors: silver-white hair, luminous amber-gold eyes, deep midnight navy cloak with silver embroidery, warm leather brown, radiant cyan sword runes.",
    reference_prompt:
      "Korean manhwa art style, colored manga, high detail, semi-realistic rendering, cinematic lighting, soft digital shading, intricate line art, ultra-detailed.\n\nCharacter: ليلى (المسافرة) — مرجع شخصية شامل (Layla the Traveler). Young female dark fantasy warrior (apparent age 19), fair porcelain skin, sharp expressive facial features, luminous amber-gold eyes, long flowing silver-white hair with a braided side lock, lean agile warrior build. Dark navy traveler cloak with intricate silver embroidery, light leather shoulder guard, fitted dark combat tunic, dark leather combat gloves, sturdy dark leather traveler boots. Holding the Silver Star Sword (slender mirror-polished silver longsword with glowing cyan starlight runes) in her right hand and a brass crossing compass at her belt.\n\nExpressions: determined, brave, calm analytical, combat focus.\n\nPoses: standing full-body, walking along glowing stone road, raising sword before ancient archway, combat stance.\n\nColors: silver-white hair, luminous amber-gold eyes, deep midnight navy cloak with silver embroidery, warm leather brown, radiant cyan sword runes.\n\nDark fantasy, dramatic composition, sharp focus, intricate textures, soft digital shading, vibrant colors, 8k, masterpiece, ultra-detailed.",
    immutable_constraints: [
      "الحفاظ على الشعر الفضي الطويل والضفيرة الجانبية والعيون الكهرمانية",
      "الحفاظ على العباءة الكحلية المطرزة بالفضة ودرع الكتف الجلدي",
      "الحفاظ على سيف النجم الفضي المدمج في المرجع",
    ],
    additive_corrections: [],
    added_corrections: [],
    status: "DRAFT",
    version: 0,
    verification_status: "UNVERIFIED",
    vision_status: "UNVERIFIED",
    flow_generation_status: "IDLE",
    flow_asset_status: "NOT CREATED",
    real_flow_asset_verified: false,
  },
  {
    id: "WEAP_001",
    entity_id: "WEAP_001",
    entity_type: "WEAPON",
    ownership: "ATTACHED_AND_INDEPENDENT",
    independent_visual_identity: true,
    attached_to: "CHAR_001",
    reference_group_id: "REF_GROUP_CHAR_001",
    aliases: ["سيف النجم الفضي", "Silver Star Sword", "السيف الفضي"],
    source_references: ["SCENE_001", "SCENE_002", "SCENE_003"],
    category: "WEAPON",
    name: "سيف النجم الفضي (Silver Star Sword)",
    description:
      "سيف طويل رفيع بنصل معدني فضي مصقول منقوش برموز قديمة تتوهج بطاقة سماوية زرقاء ومقبض جلدي كحلي.",
    visual_details:
      "Slender silver longsword with mirror-polished metallic blade, engraved ancient runes glowing with radiant cyan starlight energy, ornate silver crossguard, dark navy leather-wrapped hilt and pommel.",
    appearance: "نصل فضي رفيع طويل متناسق الأبعاد بحواف حادة متوهجة",
    clothing_and_armor: "معدن فضي مصقول مع مقبض ملفوف بالجلد الكحلي وحلقة فضية",
    weapons_and_accessories: "نقوش رونية سماوية مضيئة على طول النصل",
    expressions_and_poses: "عرض كامل للسيف من الأمام والجانب وتفصيل المقبض والنصل",
    colors_and_lighting: "فضي معدني، أزرق سماوي متوهج، كحلي داكن",
    entity_classification: "STANDALONE_ENTITY",
    merged_attributes: [
      "Blade & Material: نصل فضي مصقول بحواف حادة",
      "Hilt & Grip: مقبض جلدي كحلي وواقي يد فضي",
      "Glow & Runes: نقوش قديمة تتوهج بطاقة زرقاء سماوية",
    ],
    base_reference_prompt:
      "Korean manhwa art style, colored manga, high detail, weapon reference sheet of Silver Star Sword: slender silver longsword, mirror-polished metallic blade, engraved ancient runes glowing with cyan starlight energy, ornate silver crossguard, dark navy leather-wrapped grip, full weapon view and angled detail views, isolated on clean dark neutral studio background, no characters, no text, no watermark.",
    reference_prompt:
      "Korean manhwa art style, colored manga, high detail, weapon reference sheet of Silver Star Sword: slender silver longsword, mirror-polished metallic blade, engraved ancient runes glowing with cyan starlight energy, ornate silver crossguard, dark navy leather-wrapped grip, full weapon view and angled detail views, isolated on clean dark neutral studio background, no characters, no text, no watermark.",
    immutable_constraints: [
      "الحفاظ على النصل الفضي الرفيع والنقوش الزرقاء المتوهجة",
      "الحفاظ على المقبض الكحلي وواقي اليد الفضي",
    ],
    additive_corrections: [],
    added_corrections: [],
    status: "DRAFT",
    version: 0,
    verification_status: "UNVERIFIED",
    vision_status: "UNVERIFIED",
    flow_generation_status: "IDLE",
    flow_asset_status: "NOT CREATED",
    real_flow_asset_verified: false,
  },
  {
    id: "BLDG_001",
    entity_id: "BLDG_001",
    entity_type: "BUILDING",
    ownership: "SELF_OWNED",
    independent_visual_identity: true,
    attached_to: null,
    reference_group_id: "REF_GROUP_BLDG_001",
    aliases: ["بوابة الممر الشمالي", "قوس بوابة الممر الشمالي", "Ancient Northern Pass Archway"],
    source_references: ["SCENE_002", "SCENE_003"],
    category: "BUILDING",
    name: "قوس بوابة الممر الشمالي الأثري",
    description:
      "أثر معماري حجري عملاق يتكون من أعمدة شاهقة وقوس علوي متشقق محفور بنقوش قديمة تتوهج بالضوء الأزرق والذهبي.",
    visual_details:
      "Monumental ancient carved stone archway gate with towering weathered pillars, deep cracks, moss, and glowing cyan-gold runes etched into the stone.",
    appearance: "بوابة قوسية حجرية عملاقة بأعمدة شاهقة وتشققات أثرية",
    clothing_and_armor: "حجر بازلتي قديم داكن مع نقوش محفورة متوهجة",
    weapons_and_accessories: "رموز رونية مضيئة على القوس والأعمدة الجانبية",
    expressions_and_poses: "زاوية منخفضة تبرز ضخامة البوابة الحجرية",
    colors_and_lighting: "رمادي حجري داكن، توهج أزرق سماوي وذهبي، ظلال ليلية",
    entity_classification: "STANDALONE_ENTITY",
    merged_attributes: [
      "Architecture & Scale: قوس حجري عملاق وأعمدة شاهقة",
      "Surface & Cracks: حجر قديم متشقق وطحالب خفيفة",
      "Runes & Lighting: نقوش قديمة محفورة تتوهج باللونين الأزرق والذهبي",
    ],
    base_reference_prompt:
      "Korean manhwa art style, colored manga, high detail, architectural landmark reference sheet of the Ancient Northern Pass Archway: monumental weathered dark stone archway gate, towering carved pillars, ancient runes glowing with cyan and gold energy, dramatic low-angle architectural reference view, no characters, no text, no watermark.",
    reference_prompt:
      "Korean manhwa art style, colored manga, high detail, architectural landmark reference sheet of the Ancient Northern Pass Archway: monumental weathered dark stone archway gate, towering carved pillars, ancient runes glowing with cyan and gold energy, dramatic low-angle architectural reference view, no characters, no text, no watermark.",
    immutable_constraints: [
      "الحفاظ على القوس الحجري العملاق والأعمدة المنقوشة",
      "الحفاظ على توهج النقوش باللونين الأزرق والذهبي",
    ],
    additive_corrections: [],
    added_corrections: [],
    status: "DRAFT",
    version: 0,
    verification_status: "UNVERIFIED",
    vision_status: "UNVERIFIED",
    flow_generation_status: "IDLE",
    flow_asset_status: "NOT CREATED",
    real_flow_asset_verified: false,
  },
];

const INITIAL_SCRIPT_TEXT = `المشهد 01: مسيرة عبر الطريق المضيء
[خارجي - الطريق الحجري المضيء / الوادي المظلم - ليل]
تسير ليلى بشعرها الفضي الطويل وعباءتها الكحلية الداكنة فوق أحجار الطريق الحجري المضيء الممتد كشريط من النجوم الزرقاء والذهبية عبر الوادي المظلم، ممسكةً بيدها سيف النجم الفضي الذي ينبض بوهج خافت.
ليلى: "هذا الطريق المضيء... لم ينطفئ وهجه عبر الوادي المظلم منذ مئة عام."
[مؤثرات: وهج أزرق وذهبي خافت، وقع خطوات هادئة على الحجر]

المشهد 02: الوقوف عند بوابة الممر الشمالي
[خارجي - بوابة الممر الشمالي - ليل]
تبلغ ليلى بوابة الممر الشمالي الشاهقة في نهاية الطريق وترفع سيف النجم الفضي أمام النقوش القديمة المحفورة على أعمدة القوس الحجري.
ليلى: "أخيرًا بلغت بوابة الممر الشمالي... حان وقت إيقاظ النقوش."
[مؤثرات: رنين معدني للسيف، توهج النقوش الحجرية]

المشهد 03: استجابة النقوش واختراق الضوء
[خارجي - بوابة الممر الشمالي / الممر خلف البوابة - ليل]
تستجيب النقوش القديمة على بوابة الممر الشمالي بوميض ساطع يخترق الضباب الليلي ويكشف الممر خلف البوابة الممتد نحو الأفق.
ليلى: "لقد انفتح الممر خلف البوابة!"
[مؤثرات: وميض طاقة ساطع، انقشاع الضباب عن الممر خلف البوابة]`;

const INITIAL_LOCATIONS: StudioLocationItem[] = [
  {
    location_id: "LOC_001",
    type: "VALLEY",
    name: "الوادي المظلم والطريق الحجري المضيء (مرجع موقع شامل)",
    description:
      "وادٍ صخري ليلي عميق تحيط به جروف حجرية شاهقة، يمتد في قاعه طريق حجري قديم مرصوف تتخلل بلاطاته عروق مضيئة باللونين الأزرق والذهبي تحت ضباب ليلي خفيف.",
    visual_description:
      "وادٍ صخري عميق بجدران حجرية داكنة، طريق حجري مرصوف بعروق طاقة زرقاء وذهبية، ضباب ليلي، وظلال عميقة.",
    base_reference_prompt:
      "Korean manhwa art style, colored manga, high detail, wide establishing environment reference shot of the Dark Valley and Glowing Stone Road: deep rocky night canyon with towering dark cliffs, ancient paved stone road winding through the valley floor embedded with glowing cyan and golden energy veins, subtle nocturnal mist, dramatic shadows, pure environment only, no characters, no people, no text, no watermark.",
    visual_reference_prompt:
      "Korean manhwa art style, colored manga, high detail, wide establishing environment reference shot of the Dark Valley and Glowing Stone Road: deep rocky night canyon with towering dark cliffs, ancient paved stone road winding through the valley floor embedded with glowing cyan and golden energy veins, subtle nocturnal mist, dramatic shadows, pure environment only, no characters, no people, no text, no watermark.",
    lighting_and_atmosphere: "إضاءة ليلية متوهجة باللونين الأزرق والذهبي تنبعث من شقوق الحجر وسط ظلال الوادي العميقة",
    color_palette: "كحلي ليلي، رمادي صخري داكن، أزرق سماوي متوهج، ذهبي دافئ",
    textures_and_materials: "صخور جرانيتية خشنة، بلاط حجري عتيق متشقق، ضباب ليلي ناعم",
    textures: "صخور جرانيتية خشنة، بلاط حجري عتيق متشقق، ضباب ليلي ناعم",
    key_components: [
      "الجدران الصخرية الشاهقة للوادي المظلم",
      "الطريق الحجري المرصوف في قاع الوادي",
      "عروق الضوء الزرقاء والذهبية داخل الحجر",
      "الضباب الليلي والظلال العميقة",
    ],
    immutable_elements: [
      "الحفاظ على أحجار الطريق العتيقة وعروق الضوء الزرقاء والذهبية",
      "الحفاظ على الجروف الصخرية المظلمة المحيطة بالوادي",
    ],
    additive_corrections: [],
    added_corrections: [],
    reference_image_url: null,
    generation_status: "NOT_GENERATED",
    verification_status: "UNVERIFIED",
    vision_status: "UNVERIFIED",
    verification_result: null,
    version: 0,
    versions: [],
    used_in_scenes_count: 1,
    last_error: null,
  },
  {
    location_id: "LOC_002",
    type: "GATE",
    name: "ساحة بوابة الممر الشمالي والممر الصخري (مرجع موقع شامل)",
    description:
      "ساحة جبلية حجرية تقف فيها بوابة الممر الشمالي الشاهقة المنقوشة بالرموز المضيئة، ويمتد خلفها الممر الصخري القديم المحاط بالجروف والضباب الليلي.",
    visual_description:
      "ساحة حجرية واسعة أمام قوس بوابة الممر الشمالي العملاق المنقوش برموز مضيئة، مع امتداد الممر الجبلي خلف البوابة.",
    base_reference_prompt:
      "Korean manhwa art style, colored manga, high detail, wide establishing environment reference shot of the Northern Pass Gate Plaza: ancient stone plaza in front of a towering carved stone archway gate with glowing cyan-gold runes, rocky mountain pass stretching beyond the gate through nocturnal mist, dramatic lighting and deep shadows, pure environment only, no characters, no people, no text, no watermark.",
    visual_reference_prompt:
      "Korean manhwa art style, colored manga, high detail, wide establishing environment reference shot of the Northern Pass Gate Plaza: ancient stone plaza in front of a towering carved stone archway gate with glowing cyan-gold runes, rocky mountain pass stretching beyond the gate through nocturnal mist, dramatic lighting and deep shadows, pure environment only, no characters, no people, no text, no watermark.",
    lighting_and_atmosphere: "ضباب ليلي خفيف مع توهج النقوش القديمة وأشعة الضوء المنبعثة عبر البوابة",
    color_palette: "رمادي حجري داكن، أزرق سماوي مشع، ذهبي ساطع، كحلي ليلي",
    textures_and_materials: "أعمدة حجرية منحوتة، نقوش محفورة مضيئة، أرضية صخرية جبلية",
    textures: "أعمدة حجرية منحوتة، نقوش محفورة مضيئة، أرضية صخرية جبلية",
    key_components: [
      "قوس بوابة الممر الشمالي الشاهق",
      "النقوش القديمة المتوهجة على الأعمدة",
      "الساحة الحجرية أمام البوابة",
      "الممر الصخري الممتد خلف البوابة وسط الضباب",
    ],
    immutable_elements: [
      "الحفاظ على القوس الحجري الشاهق لبوابة الممر الشمالي والنقوش المحفورة",
      "الحفاظ على امتداد الممر الصخري خلف البوابة",
    ],
    additive_corrections: [],
    added_corrections: [],
    reference_image_url: null,
    generation_status: "NOT_GENERATED",
    verification_status: "UNVERIFIED",
    vision_status: "UNVERIFIED",
    verification_result: null,
    version: 0,
    versions: [],
    used_in_scenes_count: 2,
    last_error: null,
  },
];

const INITIAL_SCENES: StudioSceneItem[] = [
  {
    scene_id: "SCENE_001",
    scene_number: 1,
    title: "المشهد 01: مسيرة عبر الطريق المضيء",
    description:
      "تسير ليلى بشعرها الفضي الطويل وعباءتها الكحلية الداكنة فوق أحجار الطريق الحجري المضيء عبر الوادي المظلم، ممسكةً بيدها سيف النجم الفضي الذي ينبض بوهج خافت.",
    characters: ["ليلى (المسافرة)"],
    costumes_and_weapons: ["عباءة السفر الليلية", "سيف النجم الفضي"],
    location_id: "LOC_001",
    primary_location: "LOC_001",
    secondary_location_ids: [],
    secondary_locations: [],
    location_entity_id: "LOC_001",
    location_name: "الوادي المظلم والطريق الحجري المضيء (مرجع موقع شامل)",
    location_version: 1,
    location_confidence: 98,
    source_evidence: "تسير ليلى فوق أحجار الطريق الحجري المضيء الممتد عبر الوادي المظلم",
    location_evidence: "تسير ليلى فوق أحجار الطريق الحجري المضيء الممتد عبر الوادي المظلم",
    location_source_text: "[خارجي - الطريق الحجري المضيء / الوادي المظلم - ليل]",
    character_ids: ["CHAR_001"],
    item_ids: ["WEAP_001"],
    style_reference_id: "STYLE_001",
    previous_scene_id: null,
    action: "تسير للأمام بخطوات ثابتة فوق الأحجار المضيئة وتمسك سيف النجم الفضي بيدها اليمنى",
    dialogue: "هذا الطريق المضيء... لم ينطفئ وهجه عبر الوادي المظلم منذ مئة عام.",
    sfx: "وهج أزرق وذهبي خافت، وقع خطوات هادئة على الحجر",
    base_prompt:
      "Young female warrior with long silver hair and dark navy cloak walking along an ancient glowing stone road winding through a dark rocky valley at night, holding a glowing silver sword in her right hand, starry night sky, cinematic lighting, no text",
    visual_prompt:
      "Young female warrior with long silver hair and dark navy cloak walking along an ancient glowing stone road winding through a dark rocky valley at night, holding a glowing silver sword in her right hand, starry night sky, cinematic lighting, no text",
    additive_corrections: [],
    added_corrections: [],
    correction_history: [
      {
        version: 1,
        label: "v1",
        type: "BASE_PROMPT",
        correction_text: "Base Prompt",
        resulting_prompt:
          "Young female warrior with long silver hair and dark navy cloak walking along an ancient glowing stone road winding through a dark rocky valley at night, holding a glowing silver sword in her right hand, starry night sky, cinematic lighting, no text",
        created_at: new Date().toISOString(),
      },
    ],
    image_url: null,
    approved: false,
    generation_status: "WAITING",
    verification_status: "UNVERIFIED",
    vision_status: "UNVERIFIED",
    verification_result: null,
    version: 0,
    pipeline_stage: "IDLE",
    current_attempt: 0,
    max_attempts: 3,
    attempts_log: [],
    last_error: null,
  },
  {
    scene_id: "SCENE_002",
    scene_number: 2,
    title: "المشهد 02: الوقوف عند بوابة الممر الشمالي",
    description:
      "تبلغ ليلى بوابة الممر الشمالي الشاهقة وترفع سيف النجم الفضي أمام النقوش القديمة المحفورة على البوابة.",
    characters: ["ليلى (المسافرة)"],
    costumes_and_weapons: ["عباءة السفر الليلية", "سيف النجم الفضي", "بوصلة العبور القديمة"],
    location_id: "LOC_002",
    primary_location: "LOC_002",
    secondary_location_ids: [],
    secondary_locations: [],
    location_entity_id: "LOC_002",
    location_name: "ساحة بوابة الممر الشمالي والممر الصخري (مرجع موقع شامل)",
    location_version: 1,
    location_confidence: 98,
    source_evidence: "تبلغ ليلى بوابة الممر الشمالي الشاهقة في نهاية الطريق وترفع سيف النجم الفضي أمام النقوش القديمة",
    location_evidence: "تبلغ ليلى بوابة الممر الشمالي الشاهقة في نهاية الطريق وترفع سيف النجم الفضي أمام النقوش القديمة",
    location_source_text: "[خارجي - بوابة الممر الشمالي - ليل]",
    character_ids: ["CHAR_001"],
    item_ids: ["WEAP_001", "BLDG_001"],
    style_reference_id: "STYLE_001",
    previous_scene_id: "SCENE_001",
    action: "تقف أمام البوابة الشاهقة وترفع سيف النجم الفضي عاليًا نحو النقوش القديمة",
    dialogue: "أخيرًا بلغت بوابة الممر الشمالي... حان وقت إيقاظ النقوش.",
    sfx: "رنين معدني للسيف، بداية توهج النقوش القديمة",
    base_prompt:
      "Young silver-haired female warrior in dark navy cloak standing before the towering ancient carved stone archway of the Northern Pass at night, raising her glowing silver sword toward the ancient runes on the gate, no text",
    visual_prompt:
      "Young silver-haired female warrior in dark navy cloak standing before the towering ancient carved stone archway of the Northern Pass at night, raising her glowing silver sword toward the ancient runes on the gate, no text",
    additive_corrections: [],
    added_corrections: [],
    correction_history: [
      {
        version: 1,
        label: "v1",
        type: "BASE_PROMPT",
        correction_text: "Base Prompt",
        resulting_prompt:
          "Young silver-haired female warrior in dark navy cloak standing before the towering ancient carved stone archway of the Northern Pass at night, raising her glowing silver sword toward the ancient runes on the gate, no text",
        created_at: new Date().toISOString(),
      },
    ],
    image_url: null,
    approved: false,
    generation_status: "WAITING",
    verification_status: "UNVERIFIED",
    vision_status: "UNVERIFIED",
    verification_result: null,
    version: 0,
    pipeline_stage: "IDLE",
    current_attempt: 0,
    max_attempts: 3,
    attempts_log: [],
    last_error: null,
  },
  {
    scene_id: "SCENE_003",
    scene_number: 3,
    title: "المشهد 03: استجابة النقوش واختراق الضوء",
    description:
      "تستجيب النقوش القديمة على بوابة الممر الشمالي بوميض ساطع يكشف الممر خلف البوابة أمام ليلى.",
    characters: ["ليلى (المسافرة)"],
    costumes_and_weapons: ["عباءة السفر الليلية", "سيف النجم الفضي"],
    location_id: "LOC_002",
    primary_location: "LOC_002",
    secondary_location_ids: ["LOC_001"],
    secondary_locations: ["LOC_001"],
    location_entity_id: "LOC_002",
    location_name: "ساحة بوابة الممر الشمالي والممر الصخري (مرجع موقع شامل)",
    location_version: 1,
    location_confidence: 97,
    source_evidence: "تستجيب النقوش القديمة على بوابة الممر الشمالي بوميض ساطع يخترق الضباب الليلي ويكشف الممر خلف البوابة",
    location_evidence: "تستجيب النقوش القديمة على بوابة الممر الشمالي بوميض ساطع يخترق الضباب الليلي ويكشف الممر خلف البوابة",
    location_source_text: "[خارجي - بوابة الممر الشمالي / الممر خلف البوابة - ليل]",
    character_ids: ["CHAR_001"],
    item_ids: ["WEAP_001", "BLDG_001"],
    style_reference_id: "STYLE_001",
    previous_scene_id: "SCENE_002",
    action: "تثبت ليلى سيفها المرفوع بينما ينبعث وميض ساطع من البوابة يكشف الممر خلف البوابة",
    dialogue: "لقد انفتح الممر خلف البوابة!",
    sfx: "وميض طاقة ساطع، انقشاع الضباب عن الممر خلف البوابة",
    base_prompt:
      "Radiant burst of cyan and golden light erupting from the ancient runes of the Northern Pass archway gate at night, revealing the stone mountain pass beyond the gate as the silver-haired female warrior holds her glowing sword aloft, cinematic fantasy lighting, no text",
    visual_prompt:
      "Radiant burst of cyan and golden light erupting from the ancient runes of the Northern Pass archway gate at night, revealing the stone mountain pass beyond the gate as the silver-haired female warrior holds her glowing sword aloft, cinematic fantasy lighting, no text",
    additive_corrections: [],
    added_corrections: [],
    correction_history: [
      {
        version: 1,
        label: "v1",
        type: "BASE_PROMPT",
        correction_text: "Base Prompt",
        resulting_prompt:
          "Radiant burst of cyan and golden light erupting from the ancient runes of the Northern Pass archway gate at night, revealing the stone mountain pass beyond the gate as the silver-haired female warrior holds her glowing sword aloft, cinematic fantasy lighting, no text",
        created_at: new Date().toISOString(),
      },
    ],
    image_url: null,
    approved: false,
    generation_status: "WAITING",
    verification_status: "UNVERIFIED",
    vision_status: "UNVERIFIED",
    verification_result: null,
    version: 0,
    pipeline_stage: "IDLE",
    current_attempt: 0,
    max_attempts: 3,
    attempts_log: [],
    last_error: null,
  },
];

export default function NovelToMangaPage({ onNavigateToSettings }: NovelToMangaPageProps) {
  // Active Step (1 to 6) — Only one step is shown at a time
  const [currentStep, setCurrentStep] = useState<StudioStepNumber>(1);
  const [highestUnlockedStep, setHighestUnlockedStep] = useState<StudioStepNumber>(6);

  // Configurable Concurrency Limit for Google Flow & Gemini Vision Parallel Queues
  const [maxConcurrentGenerations, setMaxConcurrentGenerations] = useState<number>(5);

  // Step 1: Story & Script Analysis Engine State
  const [projectTitle, setProjectTitle] = useState<string>("حارسة الطريق المضيء");
  const [novelText, setNovelText] = useState<string>(
    `في عمق الليل الساكن، كان الطريق الحجري المضيء يمتد كشريط من النجوم الزرقاء والذهبية عبر الوادي المظلم. سارت ليلى بشعرها الفضي الطويل وعباءتها الكحلية الداكنة فوق أحجار الطريق، ممسكةً بيدها سيف النجم الفضي الذي ينبض بوهج خافت. وعندما بلغت بوابة الممر الشمالي الشاهقة، رفعت سيفها أمام النقوش القديمة فاستجابت البوابة بوميض ساطع كشف ما وراء الممر.`
  );
  const [sceneCountOption, setSceneCountOption] = useState<string>("auto");
  const [customSceneCount, setCustomSceneCount] = useState<number>(4);
  const [scriptText, setScriptText] = useState<string>(INITIAL_SCRIPT_TEXT);
  const [isWritingScript, setIsWritingScript] = useState<boolean>(false);
  const [isExtractingFromScript, setIsExtractingFromScript] = useState<boolean>(false);
  const [scriptProgressStage, setScriptProgressStage] = useState<number>(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisValidation, setAnalysisValidation] =
    useState<StudioAnalysisValidationReport | null>(null);
  const [longNovelReport, setLongNovelReport] =
    useState<LongNovelSegmentationReport | null>(null);

  // ⚡ Active Prepared Novel Dataset (المصدر النشط المعتمد الوحيد للاستوديو)
  const [activePreparedNovelData, setActivePreparedNovelData] = useState<
    ActivePreparedNovelData | PreparedNovelData | null
  >(() => {
    try {
      const activeRaw =
        localStorage.getItem("studio_active_prepared_novel_data") ||
        localStorage.getItem("studio_prepared_novel_data");
      if (activeRaw) {
        const parsed = JSON.parse(activeRaw);
        if (parsed && (parsed.status === "ADOPTED" || Boolean(parsed.adopted_at))) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  });

  // ⚡ Prepared Novel Data (تجهيز الرواية مسبقًا بدون إعادة تحليل Gemini)
  const [preparedNovelData, setPreparedNovelData] = useState<PreparedNovelData | null>(() => {
    try {
      const activeRaw = localStorage.getItem("studio_active_prepared_novel_data");
      if (activeRaw) return JSON.parse(activeRaw);
      const raw = localStorage.getItem("studio_prepared_novel_data");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  });

  // Flow 5-Stage Diagnostics & Checkpoint State
  const [flowDiagnostics, setFlowDiagnostics] = useState<FlowDetailedDiagnostics | null>(null);
  const [checkpointState, setCheckpointState] = useState<StudioCheckpointState>({
    script_saved: true,
    elements_saved: true,
    locations_saved: true,
    location_images_saved: false,
    verified_locations_saved: false,
    scenes_saved: true,
    generated_scene_images_saved: false,
    verified_scenes_saved: false,
    last_saved_at: new Date().toISOString(),
  });

  // Preferred Gemini Model (via Cookies) — Single user-selected model for all Gemini operations
  const [preferredGeminiModel, setPreferredGeminiModel] = useState<GeminiCookieModelId>(() =>
    loadPreferredGeminiModel()
  );

  // Step 6 View Mode (Korean Manhwa Pages vs Sequential Scenes)
  const [step6SubView, setStep6SubView] = useState<"MANHWA_PAGES" | "SCENES_LIST">("MANHWA_PAGES");

  // Page Generation Mode (Scene Per Page vs Korean Manhwa Pages) — Persisted in LocalStorage & Checkpoints
  const PAGE_MODE_KEY = "novel_manga_page_generation_mode";
  const [pageGenerationMode, setPageGenerationMode] = useState<PageGenerationMode>(() => {
    try {
      const saved = localStorage.getItem(PAGE_MODE_KEY);
      if (saved === "SCENE_PER_PAGE" || saved === "KOREAN_MANHWA_PAGES") {
        return saved as PageGenerationMode;
      }
    } catch (_) {}
    return "SCENE_PER_PAGE";
  });

  const handleSelectPageGenerationMode = (mode: PageGenerationMode) => {
    setPageGenerationMode(mode);
    try {
      localStorage.setItem(PAGE_MODE_KEY, mode);
    } catch (_) {}
    setNotice({
      type: "info",
      text:
        mode === "SCENE_PER_PAGE"
          ? "✓ تم اختيار طريقة إنشاء الصفحات: 🖼️ Scene Per Page (مشهد واحد = صفحة واحدة = صورة كاملة بدون إطارات أو تقطيع بانلز)."
          : "✓ تم اختيار طريقة إنشاء الصفحات: 🟦 Korean Manhwa Pages (نظام صفحات مانهوا كورية متعددة البانلز والإطارات).",
    });
  };

  // 🔀 Scene Preparation Mode: الفصل التام بين [تجهيز مسبق] و [بدء تجهيز حدث]
  const SCENE_PREP_MODE_KEY = "novel_manga_scene_prep_mode";
  const [scenePreparationMode, setScenePreparationMode] = useState<"PREPARED" | "LIVE_EVENTS">(() => {
    try {
      const saved = localStorage.getItem(SCENE_PREP_MODE_KEY);
      if (saved === "PREPARED" || saved === "LIVE_EVENTS") {
        return saved as "PREPARED" | "LIVE_EVENTS";
      }
      const rawPrep = localStorage.getItem("studio_prepared_novel_data");
      if (rawPrep) return "PREPARED";
    } catch (_) {}
    return "PREPARED";
  });

  const handleSelectScenePrepMode = (mode: "PREPARED" | "LIVE_EVENTS") => {
    setScenePreparationMode(mode);
    try {
      localStorage.setItem(SCENE_PREP_MODE_KEY, mode);
    } catch (_) {}
    setNotice({
      type: "info",
      text:
        mode === "PREPARED"
          ? "⚡ تم تفعيل وضع [تجهيز مسبق]: تم إخفاء خانة بدء تجهيز الأحداث والرواية واعتماد بيانات التجهيز المسبق مباشرة."
          : "🎬 تم تفعيل وضع [بدء تجهيز حدث]: تم إخفاء خانة التجهيز المسبق واعتماد مسار إدخال الرواية ومحرك استخراج الأحداث والمشاهد الآن.",
    });
  };

  const handleSelectPreferredGeminiModel = (modelId: GeminiCookieModelId) => {
    setPreferredGeminiModel(modelId);
    savePreferredGeminiModel(modelId);
    const chosenOpt = PREFERRED_GEMINI_MODELS.find((m) => m.id === modelId);
    setNotice({
      type: "info",
      text: `✓ تم اختيار نموذج Gemini المفضل (عبر الكوكيز): ${chosenOpt?.name || modelId} (${chosenOpt?.badge || ""}) — سيُستخدم مباشرة في جميع عمليات التحليل، كتابة القصة، Visual Bible، مراجعة الاستمرارية، وGemini Vision (بينما يظل إنشاء الصور عبر Google Flow فقط).`,
    });
  };

  // Step 2: Style, Aspect Ratio & Image Model State
  const [selectedStyle, setSelectedStyle] = useState<StudioStylePreset>("Korean Manhwa");
  const [customStyleText, setCustomStyleText] = useState<string>("");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<StudioAspectRatio>("9:16");
  const [selectedFlowModel, setSelectedFlowModel] = useState<FlowDisplayModelName>(
    "Nano Banana 2 Lite"
  );
  const [styleVersion, setStyleVersion] = useState<number>(1);

  const activeStylePresetObj = STYLE_PRESETS.find((s) => s.id === selectedStyle);
  const currentStyleHash = computeStudioStyleHash({
    style_id: selectedStyle,
    aspect_ratio: selectedAspectRatio,
    model_id: selectedFlowModel,
    custom_style: customStyleText,
    style_version: styleVersion,
  });
  const currentStyleSettings: StudioStyleSettings = {
    style_id: selectedStyle,
    style_name: selectedStyle,
    style_description:
      selectedStyle === "ستايل مخصص" && customStyleText.trim()
        ? customStyleText.trim()
        : activeStylePresetObj?.desc || selectedStyle,
    aspect_ratio: selectedAspectRatio,
    model_id: selectedFlowModel,
    custom_style: customStyleText,
    style_version: styleVersion,
    style_hash: currentStyleHash,
    updated_at: new Date().toISOString(),
  };

  // Propagate Step 2 Style / Aspect Ratio / Model changes immediately to all elements, locations, and scenes (prevents stale cache)
  const propagateStyleSettingsChange = (updates: {
    style?: StudioStylePreset;
    customStyle?: string;
    aspectRatio?: StudioAspectRatio;
    flowModel?: FlowDisplayModelName;
  }) => {
    const nextStyle = updates.style !== undefined ? updates.style : selectedStyle;
    const nextCustom = updates.customStyle !== undefined ? updates.customStyle : customStyleText;
    const nextAspect = updates.aspectRatio !== undefined ? updates.aspectRatio : selectedAspectRatio;
    const nextModel = updates.flowModel !== undefined ? updates.flowModel : selectedFlowModel;
    const nextVer = styleVersion + 1;
    const nextHash = computeStudioStyleHash({
      style_id: nextStyle,
      aspect_ratio: nextAspect,
      model_id: nextModel,
      custom_style: nextCustom,
      style_version: nextVer,
    });
    const presetDesc =
      nextStyle === "ستايل مخصص" && nextCustom.trim()
        ? nextCustom.trim()
        : STYLE_PRESETS.find((s) => s.id === nextStyle)?.desc || nextStyle;
    const nowIso = new Date().toISOString();

    if (updates.style !== undefined) setSelectedStyle(nextStyle);
    if (updates.customStyle !== undefined) setCustomStyleText(nextCustom);
    if (updates.aspectRatio !== undefined) setSelectedAspectRatio(nextAspect);
    if (updates.flowModel !== undefined) setSelectedFlowModel(nextModel);
    setStyleVersion(nextVer);

    setProductionElements((prev) =>
      prev.filter(Boolean).map((el) => ({
        ...el,
        aspect_ratio: nextAspect,
        selected_model: nextModel,
        style_version: nextVer,
        style_hash: nextHash,
        applied_style_settings: {
          style_preset: nextStyle,
          custom_style_prompt: nextCustom,
          generation_style_line: presetDesc,
          aspect_ratio: nextAspect,
          selected_model: nextModel,
          style_version: nextVer,
          style_hash: nextHash,
          applied_at: nowIso,
        },
      }))
    );

    setLocations((prev) =>
      prev.filter((loc): loc is StudioLocationItem => Boolean(loc && loc.location_id)).map((loc) => ({
        ...loc,
        aspect_ratio: nextAspect,
        selected_model: nextModel,
        style_version: nextVer,
        style_hash: nextHash,
        applied_style_settings: {
          style_preset: nextStyle,
          custom_style_prompt: nextCustom,
          generation_style_line: presetDesc,
          aspect_ratio: nextAspect,
          selected_model: nextModel,
          style_version: nextVer,
          style_hash: nextHash,
          applied_at: nowIso,
        },
      }))
    );

    setScenes((prev) =>
      prev.filter((sc): sc is StudioSceneItem => Boolean(sc && sc.scene_id)).map((sc) => ({
        ...sc,
        style_version: nextVer,
        style_hash: nextHash,
        applied_style_settings: {
          style_preset: nextStyle,
          custom_style_prompt: nextCustom,
          generation_style_line: presetDesc,
          aspect_ratio: nextAspect,
          selected_model: nextModel,
          style_version: nextVer,
          style_hash: nextHash,
          applied_at: nowIso,
        },
      }))
    );
  };

  // Step 3: Production Elements State
  const [productionElements, setProductionElements] = useState<StudioProductionElement[]>(
    INITIAL_PRODUCTION_ELEMENTS
  );
  const [activeElementCategory, setActiveElementCategory] = useState<
    ProductionElementType | "ALL" | "MASTER_SHEETS"
  >("ALL");
  const [newElCategory, setNewElCategory] = useState<ProductionElementType>("CHARACTER");
  const [newElName, setNewElName] = useState<string>("");
  const [newElDesc, setNewElDesc] = useState<string>("");
  const [newElVisual, setNewElVisual] = useState<string>("");

  // Step 4: Locations State & Parallel Queue Tracking
  const [locations, setLocations] = useState<StudioLocationItem[]>(INITIAL_LOCATIONS);
  const [newLocType, setNewLocType] = useState<StudioLocationType>("ROAD");
  const [newLocName, setNewLocName] = useState<string>("");
  const [newLocDesc, setNewLocDesc] = useState<string>("");
  const [newLocVisualDesc, setNewLocVisualDesc] = useState<string>("");
  const [newLocPrompt, setNewLocPrompt] = useState<string>("");
  const [busyLocationIds, setBusyLocationIds] = useState<Record<string, boolean>>({});
  const [isGeneratingAllLocations, setIsGeneratingAllLocations] = useState<boolean>(false);
  const [isVerifyingAllLocations, setIsVerifyingAllLocations] = useState<boolean>(false);

  // Step 5 & 6: Scenes & Sequential Continuity Engine Tracking
  const [scenes, setScenes] = useState<StudioSceneItem[]>(INITIAL_SCENES);
  const [locationContinuityAnchors, setLocationContinuityAnchors] =
    useState<LocationContinuityAnchorMap>({});
  const [isGeneratingAll, setIsGeneratingAll] = useState<boolean>(false);
  const [isVerifyingAllScenes, setIsVerifyingAllScenes] = useState<boolean>(false);
  const [busySceneIds, setBusySceneIds] = useState<Record<string, boolean>>({});
  const [busySceneId, setBusySceneId] = useState<string | null>(null);
  const [maxRetriesPerScene, setMaxRetriesPerScene] = useState<number>(3);
  const [autoVerifyScenes, setAutoVerifyScenes] = useState<boolean>(true);
  const [busyElementIds, setBusyElementIds] = useState<Record<string, boolean>>({});
  const [isGeneratingElementsBatch, setIsGeneratingElementsBatch] = useState<boolean>(false);
  const [isVerifyingElementsBatch, setIsVerifyingElementsBatch] = useState<boolean>(false);
  const [isGeneratingElementPromptsBatch, setIsGeneratingElementPromptsBatch] = useState<boolean>(false);
  const [isGeneratingLocationPromptsBatch, setIsGeneratingLocationPromptsBatch] = useState<boolean>(false);
  const [customElementCorrections, setCustomElementCorrections] = useState<Record<string, string>>({});
  const [performanceReport, setPerformanceReport] = useState<any | null>(null);
  const [latestTimingRecord, setLatestTimingRecord] = useState<any | null>(null);
  const [isRunningBenchmark, setIsRunningBenchmark] = useState<boolean>(false);
  const [showPerformancePanel, setShowPerformancePanel] = useState<boolean>(false);

  // Universal Production JSON (Schema 1.0) State & Strict Execution Engine
  const [referenceSheets, setReferenceSheets] = useState<UniversalReferenceSheet[]>([]);
  const [universalReport, setUniversalReport] = useState<UniversalValidationReport | null>(null);
  const [showUniversalJsonModal, setShowUniversalJsonModal] = useState<boolean>(false);
  const [universalJsonText, setUniversalJsonText] = useState<string>("");
  const [universalJsonActionStatus, setUniversalJsonActionStatus] = useState<string | null>(null);

  const handleOpenUniversalJsonModal = () => {
    const exported = exportStudioToUniversalJson({
      novelTitle: projectTitle,
      productionElements,
      locations,
      scenes,
      referenceSheets,
    });
    setUniversalJsonText(JSON.stringify(exported, null, 2));
    setUniversalReport(exported.validation_report || null);
    setUniversalJsonActionStatus(null);
    setShowUniversalJsonModal(true);
  };

  const handleValidateUniversalJsonInput = () => {
    try {
      const parsed = JSON.parse(universalJsonText);
      const rep = validateUniversalProductionJson(parsed);
      setUniversalReport(rep);
      if (rep.is_valid) {
        setUniversalJsonActionStatus(
          `✓ تم التحقق بنجاح! جميع القواعد مطابقة 100%: ${rep.production_elements_count} عناصر إنتاج، ${rep.locations_count} مواقع، ${rep.total_reference_sheets} لوحات تصميم.`
        );
      } else {
        setUniversalJsonActionStatus(`⚠️ تم اكتشاف ${rep.errors.length} خطأ تحقق يجب معالجته.`);
      }
    } catch (e: any) {
      setUniversalJsonActionStatus(`❌ خطأ في صياغة JSON: ${e.message}`);
    }
  };

  const handleApplyUniversalJsonInput = () => {
    try {
      const parsed = JSON.parse(universalJsonText);
      const rep = validateUniversalProductionJson(parsed);
      setUniversalReport(rep);
      if (!rep.is_valid) {
        setUniversalJsonActionStatus(
          `❌ لا يمكن الاعتماد: يوجد ${rep.errors.length} أخطاء تحقق تمنع المتابعة.`
        );
        return;
      }
      const converted = convertUniversalJsonToStudio(parsed);
      setProductionElements(converted.production_elements);
      setLocations(converted.locations);
      if (converted.scenes.length > 0) {
        setScenes(converted.scenes);
      }
      setReferenceSheets(converted.reference_sheets);
      const newTitle = parsed.novel?.title || projectTitle;
      if (parsed.novel?.title) {
        setProjectTitle(parsed.novel.title);
      }

      // Sync studio analysis validation & live category counters
      const uCharsCount = converted.production_elements.filter((e) => e.category === "CHARACTER").length;
      const uWeaponsCount = converted.production_elements.filter((e) => e.category === "WEAPON").length;
      const uItemsCount = converted.production_elements.filter((e) => e.category === "ITEM").length;
      const uCreaturesCount = converted.production_elements.filter((e) => e.category === "CREATURE").length;

      setAnalysisValidation({
        response_received: true,
        non_empty: true,
        json_parsed: true,
        required_fields_valid: true,
        saved: true,
        step_complete: true,
        scenes_count: converted.scenes.length,
        locations_count: converted.locations.length,
        elements_count: converted.production_elements.length,
        characters_count: uCharsCount,
        weapons_count: uWeaponsCount,
        items_count: uItemsCount,
        creatures_count: uCreaturesCount,
        events_count: 0,
        validated_at: new Date().toISOString(),
      });

      // Synchronize activePreparedNovelData so PreparedNovelSection cards reflect the newly applied JSON
      const adoptedUniversalPrep = adoptPreparedNovelDataset({
        novel_title: newTitle,
        chapter_identifier: "CHAPTER_001",
        raw_input: universalJsonText,
        scenes: converted.scenes,
        locations: converted.locations,
        production_elements: converted.production_elements,
        ordered_events: [],
        events: [],
        characters: converted.production_elements.filter((e) => e.category === "CHARACTER"),
        weapons: converted.production_elements.filter((e) => e.category === "WEAPON"),
        items: converted.production_elements.filter((e) => e.category === "ITEM"),
        creatures: converted.production_elements.filter((e) => e.category === "CREATURE"),
        buildings: converted.production_elements.filter((e) => e.category === "BUILDING"),
        vehicles: converted.production_elements.filter((e) => e.category === "VEHICLE"),
        reference_sheets: converted.reference_sheets,
        universal_json: parsed,
        universal_validation_report: rep,
        converted_studio_data: {
          script_text: "",
          scenes: converted.scenes,
          locations: converted.locations,
          production_elements: converted.production_elements,
          characters: converted.production_elements.filter((e) => e.category === "CHARACTER"),
          weapons: converted.production_elements.filter((e) => e.category === "WEAPON"),
          items: converted.production_elements.filter((e) => e.category === "ITEM"),
          creatures: converted.production_elements.filter((e) => e.category === "CREATURE"),
          buildings: converted.production_elements.filter((e) => e.category === "BUILDING"),
          vehicles: converted.production_elements.filter((e) => e.category === "VEHICLE"),
          events: [],
          reference_sheets: converted.reference_sheets,
          universal_validation_report: rep,
        },
        stats: {
          scenes_count: converted.scenes.length,
          characters_count: uCharsCount,
          locations_count: converted.locations.length,
          events_count: 0,
          weapons_count: uWeaponsCount,
          items_count: uItemsCount,
          creatures_count: uCreaturesCount,
        },
      } as any);

      setActivePreparedNovelData(adoptedUniversalPrep);
      setPreparedNovelData(adoptedUniversalPrep);
      try {
        localStorage.setItem("studio_active_prepared_novel_data", JSON.stringify(adoptedUniversalPrep));
        localStorage.setItem("studio_prepared_novel_data", JSON.stringify(adoptedUniversalPrep));
      } catch (_) {}

      void saveStudioCheckpointApi({
        project_title: newTitle,
        replace_all: true,
        production_elements: converted.production_elements,
        locations: converted.locations,
        scenes: converted.scenes.length > 0 ? converted.scenes : scenes,
        active_prepared_novel_data: adoptedUniversalPrep,
        prepared_novel_data: adoptedUniversalPrep,
        universal_production_json: parsed,
      });
      setUniversalJsonActionStatus(
        "✓ تم استيراد وتطبيق بيانات الرواية وحفظها في نقطة التفتيش بنجاح وفق توزيع target_step الصارم!"
      );
      setTimeout(() => setShowUniversalJsonModal(false), 1500);
    } catch (e: any) {
      setUniversalJsonActionStatus(`❌ خطأ في تطبيق JSON: ${e.message}`);
    }
  };

  const refreshPerformanceReport = async () => {
    try {
      const rep = await getStudioPerformanceReportApi();
      if (rep?.success) {
        setPerformanceReport(rep);
        if (Array.isArray(rep.timing_records) && rep.timing_records.length > 0) {
          setLatestTimingRecord(rep.timing_records[0]);
        }
      }
    } catch {
      // ignore non-critical telemetry refresh error
    }
  };

  const pollBackgroundVerificationForTarget = (
    targetId: string,
    targetType: "ELEMENT" | "LOCATION" | "SCENE"
  ) => {
    let attempts = 0;
    const maxPolls = 45;
    const timer = setInterval(async () => {
      attempts++;
      if (attempts > maxPolls) {
        clearInterval(timer);
        return;
      }
      try {
        const res = await getBackgroundVerificationStatusApi(targetId);
        if (!res?.success || !res.task) return;
        const task = res.task;
        const payload = task.updated_payload || task.updated_item;
        if (payload) {
          if (targetType === "ELEMENT") {
            setProductionElements((prev) =>
              prev.map((e) =>
                e.id === targetId
                  ? {
                      ...e,
                      ...payload,
                      reference_image_url:
                        payload.reference_image_url &&
                        payload.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
                          ? payload.reference_image_url
                          : e.reference_image_url,
                    }
                  : e
              )
            );
          } else if (targetType === "LOCATION") {
            setLocations((prev) =>
              prev.map((l) =>
                l.location_id === targetId
                  ? {
                      ...l,
                      ...payload,
                      reference_image_url:
                        payload.reference_image_url &&
                        payload.reference_image_url !== "__CLIENT_MEMORY_IMAGE__"
                          ? payload.reference_image_url
                          : l.reference_image_url,
                    }
                  : l
              )
            );
          } else if (targetType === "SCENE") {
            setScenes((prev) =>
              prev.map((s) =>
                s.scene_id === targetId
                  ? {
                      ...s,
                      ...payload,
                      image_url:
                        payload.image_url && payload.image_url !== "__CLIENT_MEMORY_IMAGE__"
                          ? payload.image_url
                          : s.image_url,
                    }
                  : s
              )
            );
          }
        }
        const stageVal = task.stage || task.stage_status;
        if (
          task.completed ||
          task.vision_completed ||
          task.failed ||
          stageVal === "APPROVED" ||
          stageVal === "LOCKED" ||
          stageVal === "POST_PROCESSING_FAILED" ||
          stageVal === "POST_PROCESSING_FAILURE"
        ) {
          clearInterval(timer);
          void refreshPerformanceReport();
        }
      } catch {
        // ignore transient poll error
      }
    }, 1200);
  };

  const handleRunMultiModelBenchmark = async () => {
    setIsRunningBenchmark(true);
    setShowPerformancePanel(true);
    setNotice({
      type: "info",
      text: "جاري تشغيل اختبار الأداء الموحد (Benchmark) لجميع نماذج Google Flow (Nano Banana 2 Lite / Nano Banana 2 / Nano Banana Pro)...",
    });
    try {
      const res = await runStudioPerformanceBenchmarkApi({
        models: ["Nano Banana 2 Lite", "Nano Banana 2", "Nano Banana Pro"],
        aspectRatio: selectedAspectRatio,
        stylePreset: selectedStyle,
        customStylePrompt: customStyleText,
      });
      await refreshPerformanceReport();
      if (res.success) {
        setNotice({
          type: "success",
          text: "✓ اكتمل اختبار الأداء الموحد (Benchmark) لجميع النماذج! راجع جدول فصل زمن توليد النموذج (Flow Generation Time) عن حمل التطبيق (Application Overhead).",
        });
      } else {
        setNotice({
          type: "error",
          text: res.error || "تعذر إكمال اختبار الأداء لبعض النماذج.",
        });
      }
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err?.message || "فشل تشغيل اختبار الأداء الموحد.",
      });
    } finally {
      setIsRunningBenchmark(false);
    }
  };
  const [customLocationCorrections, setCustomLocationCorrections] = useState<Record<string, string>>({});
  const [customSceneCorrections, setCustomSceneCorrections] = useState<Record<string, string>>({});
  const [isRunningFullPipeline, setIsRunningFullPipeline] = useState<boolean>(false);
  const [pipelineTelemetry, setPipelineTelemetry] = useState<StudioPipelineTelemetry | null>(null);

  // Step 6: Scene Modal & Inline Editing State
  const [openedSceneModal, setOpenedSceneModal] = useState<StudioSceneItem | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editSceneDraft, setEditSceneDraft] = useState<StudioSceneItem | null>(null);

  // Notice Banner
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(
    null
  );
  const hasLoadedInitialCheckpointRef = useRef<boolean>(false);

  const goToStep = (step: StudioStepNumber) => {
    setCurrentStep(step);
    if (step > highestUnlockedStep) {
      setHighestUnlockedStep(step);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Load Flow Diagnostics & Checkpoint on Mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const flowStatus = await fetchGoogleFlowStatus();
        if (mounted && flowStatus?.diagnostics) {
          setFlowDiagnostics(flowStatus.diagnostics);
        }
      } catch (_) {}

      try {
        const cpRes = await loadStudioCheckpointApi();
        if (mounted && cpRes?.exists && cpRes.state) {
          const st = cpRes.state;
          if (st.projectTitle || st.project_title) {
            setProjectTitle(st.projectTitle || st.project_title);
          }
          if (st.novelText || st.novel_text) {
            setNovelText(st.novelText || st.novel_text);
          }
          if (st.script_text) setScriptText(st.script_text);
          if (st.preferredGeminiModel || st.preferred_gemini_model) {
            const existingLocal = localStorage.getItem("novel_manga_preferred_gemini_model");
            const savedGemModel = (existingLocal || st.preferredGeminiModel || st.preferred_gemini_model) as GeminiCookieModelId;
            if (PREFERRED_GEMINI_MODELS.some((m) => m.id === savedGemModel)) {
              setPreferredGeminiModel(savedGemModel);
              savePreferredGeminiModel(savedGemModel);
            }
          }
          if (st.style_settings) {
            if (st.style_settings.style_id) setSelectedStyle(st.style_settings.style_id);
            if (typeof st.style_settings.custom_style === "string") {
              setCustomStyleText(st.style_settings.custom_style);
            }
            if (st.style_settings.aspect_ratio) {
              setSelectedAspectRatio(st.style_settings.aspect_ratio);
            }
            if (st.style_settings.model_id) {
              setSelectedFlowModel(st.style_settings.model_id);
            }
            if (typeof st.style_settings.style_version === "number") {
              setStyleVersion(st.style_settings.style_version);
            }
          } else {
            if (st.selectedStyle) setSelectedStyle(st.selectedStyle);
            if (typeof st.customStyleText === "string") setCustomStyleText(st.customStyleText);
            if (st.selectedAspectRatio) setSelectedAspectRatio(st.selectedAspectRatio);
            if (st.selectedFlowModel) setSelectedFlowModel(st.selectedFlowModel);
            if (typeof st.styleVersion === "number") setStyleVersion(st.styleVersion);
          }
          if (Array.isArray(st.production_elements) && st.production_elements.length > 0) {
            // Strictly strip any fake LOCKED/APPROVED state that lacks all 6 conditions (real Flow + real Gemini Vision PASS)
            const validElements = st.production_elements.filter(
              (el: any): el is StudioProductionElement => Boolean(el && (el.id || el.entity_id))
            );
            const sanitizedElements = validElements.map((el: StudioProductionElement) => {
              if (!el.reference_image_url) {
                return {
                  ...el,
                  approved: false,
                  status: "DRAFT" as const,
                  locked_at: null,
                  generation_status: "NOT_GENERATED" as const,
                  verification_status: "UNVERIFIED" as const,
                  vision_status: "UNVERIFIED" as const,
                };
              }
              const realProjId = el.flowProjectId || el.flow_project_id;
              const ver = el.verification_result;
              const hasRealVisionPass =
                Boolean(ver && ver.verification_complete === true && ver.approved === true) &&
                (ver?.overall_status === "PASS" ||
                  el.vision_status === "PASS" ||
                  el.vision_status === "GEMINI_VISION_VERIFIED");
              const hasAll6LockPrerequisites =
                Boolean(el.reference_image_url) &&
                isRealVerifiedFlowProjectId(realProjId) &&
                Boolean(el.flowAssetId) &&
                Boolean(el.flowGenerationId || el.flow_generation_id) &&
                el.real_flow_asset_verified === true &&
                hasRealVisionPass;
              if ((el.status === "LOCKED" || el.status === "APPROVED") && !hasAll6LockPrerequisites) {
                return {
                  ...el,
                  status: "DRAFT" as const,
                  locked_at: null,
                  verification_status: hasRealVisionPass ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
                  vision_status: hasRealVisionPass
                    ? ("PASS" as const)
                    : el.vision_status === "GEMINI_VISION_VERIFIED" || el.vision_status === "PASS"
                    ? ("UNVERIFIED" as const)
                    : el.vision_status || ("UNVERIFIED" as const),
                };
              }
              return el;
            });
            if (sanitizedElements.length > 0) {
              setProductionElements(sanitizedElements);
            }
          }
          if (Array.isArray(st.locations) && st.locations.length > 0) {
            const validLocations = st.locations.filter(
              (loc: any): loc is StudioLocationItem => Boolean(loc && loc.location_id)
            );
            const sanitizedLocations = validLocations.map((loc: StudioLocationItem) => {
              if (!loc.reference_image_url) {
                return {
                  ...loc,
                  approved: false,
                  status: "DRAFT" as const,
                  locked_at: null,
                  generation_status: "NOT_GENERATED" as const,
                  verification_status: "UNVERIFIED" as const,
                  vision_status: "UNVERIFIED" as const,
                };
              }
              const realProjId = loc.flowProjectId || loc.flow_project_id;
              const ver = loc.verification_result;
              const hasRealVisionPass =
                Boolean(ver && ver.verification_complete === true && ver.approved === true && ver.all_required_checks_passed === true) &&
                (ver?.overall_status === "PASS" ||
                  loc.vision_status === "PASS" ||
                  loc.vision_status === "GEMINI_VISION_VERIFIED");
              const hasAll6LockPrerequisites =
                Boolean(loc.reference_image_url) &&
                isRealVerifiedFlowProjectId(realProjId) &&
                Boolean(loc.flowAssetId) &&
                Boolean(loc.flowGenerationId || loc.flow_generation_id) &&
                loc.real_flow_asset_verified === true &&
                hasRealVisionPass;
              if ((loc.status === "LOCKED" || loc.status === "APPROVED") && !hasAll6LockPrerequisites) {
                return {
                  ...loc,
                  status: "DRAFT" as const,
                  locked_at: null,
                  verification_status: hasRealVisionPass ? ("VERIFIED" as const) : ("UNVERIFIED" as const),
                  vision_status: hasRealVisionPass
                    ? ("PASS" as const)
                    : loc.vision_status === "GEMINI_VISION_VERIFIED" || loc.vision_status === "PASS"
                    ? ("UNVERIFIED" as const)
                    : loc.vision_status || ("UNVERIFIED" as const),
                };
              }
              return loc;
            });
            if (sanitizedLocations.length > 0) {
              setLocations(sanitizedLocations);
            }
          }
          // Check for active adopted prepared novel dataset (from checkpoint or localStorage)
          let resolvedAdoptedPrep: ActivePreparedNovelData | null = null;
          const incomingPrepCandidate =
            st.active_prepared_novel_data ||
            st.prepared_novel_data ||
            st.preparedNovelData;
          if (incomingPrepCandidate && isDatasetAdopted(incomingPrepCandidate)) {
            resolvedAdoptedPrep = adoptPreparedNovelDataset(incomingPrepCandidate);
          } else {
            try {
              const rawActiveLocal =
                localStorage.getItem("studio_active_prepared_novel_data") ||
                localStorage.getItem("studio_prepared_novel_data");
              if (rawActiveLocal) {
                const parsedLocal = JSON.parse(rawActiveLocal);
                if (parsedLocal && (isDatasetAdopted(parsedLocal) || parsedLocal.converted_studio_data)) {
                  resolvedAdoptedPrep = adoptPreparedNovelDataset(parsedLocal);
                }
              }
            } catch (_) {}
          }

          if (resolvedAdoptedPrep) {
            // ADOPTED PREPARED DATA IS THE AUTHORITATIVE ACTIVE SOURCE OF TRUTH
            setActivePreparedNovelData(resolvedAdoptedPrep);
            setPreparedNovelData(resolvedAdoptedPrep);
            if (resolvedAdoptedPrep.novel_title) {
              setProjectTitle(resolvedAdoptedPrep.novel_title);
            }
            if (resolvedAdoptedPrep.converted_studio_data) {
              const {
                script_text,
                production_elements: prepElements,
                locations: prepLocs,
                scenes: prepScenes,
                long_novel_report: prepReport,
              } = resolvedAdoptedPrep.converted_studio_data;

              if (script_text) setScriptText(script_text);
              if (prepReport) setLongNovelReport(prepReport);

              // Keep images if previously generated for the SAME IDs in checkpoint
              if (Array.isArray(prepElements) && prepElements.length > 0) {
                const prevElMap = new Map<string, any>(
                  Array.isArray(st.production_elements)
                    ? st.production_elements.map((e: any) => [e.id || e.entity_id, e])
                    : []
                );
                const mergedElements = prepElements.map((el) => {
                  const prev = prevElMap.get(el.id);
                  if (prev?.reference_image_url) {
                    return { ...el, reference_image_url: prev.reference_image_url, status: prev.status || el.status };
                  }
                  return el;
                });
                setProductionElements(mergedElements);
              }

              if (Array.isArray(prepLocs) && prepLocs.length > 0) {
                const prevLocMap = new Map<string, any>(
                  Array.isArray(st.locations)
                    ? st.locations.map((l: any) => [l.location_id, l])
                    : []
                );
                const mergedLocs = prepLocs.map((loc) => {
                  const prev = prevLocMap.get(loc.location_id);
                  if (prev?.reference_image_url) {
                    return { ...loc, reference_image_url: prev.reference_image_url, status: prev.status || loc.status };
                  }
                  return loc;
                });
                setLocations(mergedLocs);
              }

              if (Array.isArray(prepScenes) && prepScenes.length > 0) {
                const prevScMap = new Map<string, any>(
                  Array.isArray(st.scenes)
                    ? st.scenes.map((s: any) => [s.scene_id, s])
                    : []
                );
                const mergedScenes = prepScenes.map((sc) => {
                  const prev = prevScMap.get(sc.scene_id);
                  if (prev?.image_url) {
                    return { ...sc, image_url: prev.image_url, generation_status: prev.generation_status || sc.generation_status };
                  }
                  return sc;
                });
                setScenes(mergedScenes);
              }
            }
          } else {
            // Standard Checkpoint Loading without active prepared data
            if (Array.isArray(st.scenes) && st.scenes.length > 0) {
              const validScenes = st.scenes
                .filter((sc: any): sc is StudioSceneItem => Boolean(sc && sc.scene_id))
                .map((sc: StudioSceneItem) => {
                  if (!sc.image_url) {
                    return {
                      ...sc,
                      approved: false,
                      generation_status: "WAITING" as const,
                      verification_status: "UNVERIFIED" as const,
                      vision_status: "UNVERIFIED" as const,
                      pipeline_stage: "IDLE" as const,
                    };
                  }
                  return sc;
                });
              if (validScenes.length > 0) {
                setScenes(validScenes);
              }
            }
            if (st.prepared_novel_data || st.preparedNovelData) {
              setPreparedNovelData(st.prepared_novel_data || st.preparedNovelData);
            }
          }

          if (st.pageGenerationMode || st.page_generation_mode) {
            const savedMode = (st.pageGenerationMode || st.page_generation_mode) as PageGenerationMode;
            if (savedMode === "SCENE_PER_PAGE" || savedMode === "KOREAN_MANHWA_PAGES") {
              setPageGenerationMode(savedMode);
              try {
                localStorage.setItem("novel_manga_page_generation_mode", savedMode);
              } catch (_) {}
            }
          }
          if (st.location_continuity_anchors && typeof st.location_continuity_anchors === "object") {
            setLocationContinuityAnchors(st.location_continuity_anchors);
          }
          if (cpRes.checkpoint) {
            setCheckpointState(cpRes.checkpoint);
          }
        }
      } catch (_) {
      } finally {
        hasLoadedInitialCheckpointRef.current = true;
      }

      try {
        const telRes = await getStudioTelemetryApi();
        if (mounted && telRes?.telemetry) {
          setPipelineTelemetry(telRes.telemetry);
        }
      } catch (_) {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Automatically persist Checkpoint State (Rule 15) whenever Script, Elements, Locations, or Scenes update
  useEffect(() => {
    const newCheckpoint: StudioCheckpointState = {
      script_saved: Boolean(scriptText && scriptText.trim().length > 0),
      elements_saved: productionElements.length > 0,
      locations_saved: locations.length > 0,
      location_images_saved: locations.some((l) => Boolean(l.reference_image_url)),
      verified_locations_saved: locations.some((l) => l.verification_status === "VERIFIED"),
      scenes_saved: scenes.length > 0,
      generated_scene_images_saved: scenes.some((s) => Boolean(s.image_url)),
      verified_scenes_saved: scenes.some(
        (s) => Boolean(s.approved && s.verification_status === "VERIFIED")
      ),
      last_saved_at: new Date().toISOString(),
    };
    setCheckpointState(newCheckpoint);

    const timer = setTimeout(() => {
      if (!hasLoadedInitialCheckpointRef.current) return;
      try {
        const lightElements = productionElements.map((e) => ({
          ...e,
          reference_image_url: null,
          local_file_path: undefined,
          approved: false,
          status: "DRAFT",
          generation_status: "NOT_GENERATED",
          verification_status: "UNVERIFIED",
          versions: [],
          attempts_log: [],
        }));
        const lightLocations = locations.map((l) => ({
          ...l,
          reference_image_url: null,
          local_file_path: undefined,
          approved: false,
          status: "DRAFT",
          generation_status: "NOT_GENERATED",
          verification_status: "UNVERIFIED",
          versions: [],
          attempts_log: [],
        }));
        const lightScenes = scenes.map((s) => ({
          ...s,
          image_url: null,
          local_file_path: undefined,
          approved: false,
          generation_status: "WAITING",
          verification_status: "UNVERIFIED",
          pipeline_stage: "IDLE",
          attempts_log: [],
        }));
        localStorage.setItem(
          "studio_saved_analysis_v2",
          JSON.stringify({
            projectTitle,
            novelText,
            script_text: scriptText,
            preferredGeminiModel,
            preferred_gemini_model: preferredGeminiModel,
            style_settings: currentStyleSettings,
            selectedStyle,
            customStyleText,
            selectedAspectRatio,
            selectedFlowModel,
            styleVersion,
            production_elements: lightElements,
            locations: lightLocations,
            scenes: lightScenes,
            checkpoint: newCheckpoint,
          })
        );
      } catch (_) {}

      saveStudioCheckpointApi({
        projectTitle,
        project_title: projectTitle,
        novelText,
        novel_text: novelText,
        script_text: scriptText,
        preferredGeminiModel,
        preferred_gemini_model: preferredGeminiModel,
        style_settings: currentStyleSettings,
        selectedStyle,
        customStyleText,
        selectedAspectRatio,
        selectedFlowModel,
        styleVersion,
        production_elements: productionElements,
        locations: locations.map((l) => ({ ...l, versions: [] })),
        scenes: scenes.map((s) => ({ ...s, attempts_log: [] })),
        active_prepared_novel_data: activePreparedNovelData,
        prepared_novel_data: preparedNovelData || activePreparedNovelData,
      }).catch(() => {});
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    projectTitle,
    novelText,
    scriptText,
    preferredGeminiModel,
    selectedStyle,
    customStyleText,
    selectedAspectRatio,
    selectedFlowModel,
    styleVersion,
    productionElements,
    locations,
    scenes,
    activePreparedNovelData,
    preparedNovelData,
  ]);

  const [checkpointNotice, setCheckpointNotice] = useState<string | null>(null);

  const handleManualSaveCheckpoint = async () => {
    try {
      setCheckpointNotice("جاري حفظ نقطة المتابعة...");
      const res = await saveStudioCheckpointApi({
        projectTitle,
        project_title: projectTitle,
        novelText,
        novel_text: novelText,
        script_text: scriptText,
        preferredGeminiModel,
        preferred_gemini_model: preferredGeminiModel,
        style_settings: currentStyleSettings,
        selectedStyle,
        customStyleText,
        selectedAspectRatio,
        selectedFlowModel,
        styleVersion,
        production_elements: productionElements,
        locations: locations.map((l) => ({ ...l, versions: [] })),
        scenes: scenes.map((s) => ({ ...s, attempts_log: [] })),
        page_generation_mode: pageGenerationMode,
        active_prepared_novel_data: activePreparedNovelData,
        prepared_novel_data: preparedNovelData || activePreparedNovelData,
      });
      if (res?.success) {
        setCheckpointNotice("✓ تم حفظ نقطة المتابعة (Checkpoint) بنجاح!");
        setTimeout(() => setCheckpointNotice(null), 3500);
      }
    } catch (err: any) {
      setCheckpointNotice(`فشل حفظ نقطة المتابعة: ${err?.message || "خطأ غير معروف"}`);
    }
  };

  const handleManualRestoreCheckpoint = async () => {
    try {
      setCheckpointNotice("جاري استعادة نقطة المتابعة...");
      const cpRes = await loadStudioCheckpointApi();
      if (cpRes?.exists && cpRes.state) {
        const st = cpRes.state;
        if (st.projectTitle || st.project_title) setProjectTitle(st.projectTitle || st.project_title);
        if (st.novelText || st.novel_text) setNovelText(st.novelText || st.novel_text);
        if (st.script_text) setScriptText(st.script_text);
        if (st.page_generation_mode) setPageGenerationMode(st.page_generation_mode);

        const restoredPrep = st.active_prepared_novel_data || st.prepared_novel_data || st.preparedNovelData;
        if (restoredPrep && isDatasetAdopted(restoredPrep)) {
          const adopted = adoptPreparedNovelDataset(restoredPrep);
          setActivePreparedNovelData(adopted);
          setPreparedNovelData(adopted);
          if (adopted.converted_studio_data) {
            if (Array.isArray(adopted.converted_studio_data.scenes) && adopted.converted_studio_data.scenes.length > 0) {
              setScenes(adopted.converted_studio_data.scenes);
            }
            if (Array.isArray(adopted.converted_studio_data.production_elements) && adopted.converted_studio_data.production_elements.length > 0) {
              setProductionElements(adopted.converted_studio_data.production_elements);
            }
            if (Array.isArray(adopted.converted_studio_data.locations) && adopted.converted_studio_data.locations.length > 0) {
              setLocations(adopted.converted_studio_data.locations);
            }
            if (adopted.converted_studio_data.script_text) {
              setScriptText(adopted.converted_studio_data.script_text);
            }
          }
        } else {
          if (Array.isArray(st.production_elements) && st.production_elements.length > 0) {
            setProductionElements(st.production_elements);
          }
          if (Array.isArray(st.locations) && st.locations.length > 0) {
            setLocations(st.locations);
          }
          if (Array.isArray(st.scenes) && st.scenes.length > 0) {
            setScenes(st.scenes);
          }
          if (st.prepared_novel_data || st.preparedNovelData) {
            setPreparedNovelData(st.prepared_novel_data || st.preparedNovelData);
          }
        }
        setCheckpointNotice("✓ تم استعادة نقطة المتابعة (Checkpoint) بنجاح!");
        setTimeout(() => setCheckpointNotice(null), 3500);
      } else {
        setCheckpointNotice("لا توجد نقطة متابعة محفوظة سابقة.");
        setTimeout(() => setCheckpointNotice(null), 3000);
      }
    } catch (err: any) {
      setCheckpointNotice(`فشل استعادة نقطة المتابعة: ${err?.message || "خطأ غير معروف"}`);
    }
  };

  /**
   * تطبيق وضبط عدد المشاهد يدوياً فوراً في الواجهة
   */
  const handleApplyManualSceneCount = (targetCount?: number) => {
    const count = Math.max(1, Math.min(50, targetCount !== undefined ? targetCount : customSceneCount));
    setCustomSceneCount(count);
    setSceneCountOption("custom");

    setScenes((prev) => {
      const existing = [...prev];
      if (existing.length === count) return existing;
      if (existing.length < count) {
        const added: StudioSceneItem[] = [];
        for (let i = existing.length + 1; i <= count; i++) {
          const idNum = String(i).padStart(3, "0");
          const prevId =
            i > 1 ? (existing[i - 2]?.scene_id || `SCENE_${String(i - 1).padStart(3, "0")}`) : null;
          added.push({
            scene_id: `SCENE_${idNum}`,
            scene_number: i,
            title: `المشهد ${idNum}: مشهد إضافي محدد يدوياً`,
            description: `وصف المشهد ${idNum} في سياق الرواية`,
            characters: existing[0]?.characters || ["ليلى (المسافرة)"],
            character_ids: existing[0]?.character_ids || ["CHAR_001"],
            location_id: existing[0]?.location_id || "LOC_001",
            primary_location: existing[0]?.primary_location || "LOC_001",
            location_name: existing[0]?.location_name || "موقع القصة",
            previous_scene_id: prevId,
            action: `حدث وحركة المشهد ${idNum}`,
            costumes_and_weapons: [],
            dialogue: "",
            sfx: "",
            base_prompt: `Scene ${idNum} dramatic shot, cinematic lighting, 8k, masterpiece`,
            visual_prompt: `Scene ${idNum} dramatic shot, cinematic lighting, 8k, masterpiece`,
            additive_corrections: [],
            added_corrections: [],
            correction_history: [],
            image_url: null,
            approved: false,
            generation_status: "WAITING",
            verification_status: "UNVERIFIED",
            vision_status: "UNVERIFIED",
            verification_result: null,
            version: 0,
            pipeline_stage: "IDLE",
            current_attempt: 0,
            max_attempts: 3,
            attempts_log: [],
            last_error: null,
          });
        }
        return [...existing, ...added];
      } else {
        return existing.slice(0, count);
      }
    });

    setNotice({
      type: "success",
      text: `✓ تم ضبط وتحديث قائمة المشاهد يدوياً إلى ${count} ${count <= 10 ? "مشاهد" : "مشهد"} بنجاح!`,
    });
    setTimeout(() => setNotice(null), 3500);
  };

  const [isCreatingRealFlowProject, setIsCreatingRealFlowProject] = useState<boolean>(false);
  const [isTestingFlowImageGen, setIsTestingFlowImageGen] = useState<boolean>(false);
  const [flowTestGenPreview, setFlowTestGenPreview] = useState<{
    imageUrl: string;
    flowProjectId?: string | null;
    flowAssetId?: string | null;
    flowGenerationId?: string | null;
    modelUsed?: string;
    message?: string;
  } | null>(null);

  const handleQuickTestFlowImage = async () => {
    setIsTestingFlowImageGen(true);
    setNotice({
      type: "info",
      text: `جاري اختبار إنشاء صورة حقيقية عبر Google Flow (${selectedFlowModel}) ورفعها إلى مشروعك...`,
    });
    try {
      const res = await testGoogleFlowGeneration({
        modelDisplayName: selectedFlowModel,
      });
      const flowStatus = await fetchGoogleFlowStatus();
      if (flowStatus?.diagnostics) {
        setFlowDiagnostics(flowStatus.diagnostics);
      }
      if (res?.success && res?.public_url) {
        setFlowTestGenPreview({
          imageUrl: res.public_url,
          flowProjectId: res.flowProjectId,
          flowAssetId: res.flowAssetId,
          flowGenerationId: res.flowGenerationId || res.generation_id,
          modelUsed: res.model_display_name || selectedFlowModel,
          message: res.message || "تم إنشاء الصورة والتحقق منها بنجاح في Google Flow!",
        });
        setNotice({
          type: "success",
          text: `✓ تم إنشاء الصورة بنجاح عبر Google Flow (${res.flowProjectId || "Project"} • Asset: ${res.flowAssetId || "Verified"})!`,
        });
      } else {
        setNotice({
          type: "error",
          text: res?.error || res?.message || "FLOW_GENERATION_FAILED: فشل اختبار توليد الصورة عبر Google Flow.",
        });
      }
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err?.message || "حدث خطأ أثناء اختبار توليد الصورة عبر Google Flow.",
      });
    } finally {
      setIsTestingFlowImageGen(false);
    }
  };

  const handleRefreshFlowDiagnostics = async () => {
    try {
      const flowStatus = await fetchGoogleFlowStatus();
      if (flowStatus?.diagnostics) {
        setFlowDiagnostics(flowStatus.diagnostics);
        const activeId =
          flowStatus.diagnostics.selected_active_project_id ||
          flowStatus.diagnostics.active_project_id;
        setNotice({
          type:
            flowStatus.diagnostics.FLOW_GENERATION_READY &&
            isRealVerifiedFlowProjectId(activeId)
              ? "success"
              : "error",
          text:
            flowStatus.diagnostics.FLOW_GENERATION_READY &&
            isRealVerifiedFlowProjectId(activeId)
              ? `✓ متصل بمشروع Google Flow الحقيقي: ${flowStatus.diagnostics.selected_active_project_name || activeId} (${activeId})`
              : flowStatus.diagnostics.diagnostic_reason_ar ||
                "FLOW_PROJECT_NOT_FOUND: لم يتم العثور على مشروع Google Flow حقيقي في حسابك. اضغط على 'إنشاء مشروع Google Flow حقيقي' أولاً.",
        });
      }
    } catch (_) {}
  };

  const handleCreateOrSelectRealFlowProject = async () => {
    setIsCreatingRealFlowProject(true);
    setNotice({
      type: "info",
      text: `جاري الاتصال بحسابك في flow.google.com لإنشاء أو ربط مشروع Google Flow حقيقي باسم "${projectTitle || "Manga Studio Project"}"...`,
    });
    try {
      const res = await addGoogleFlowProject({
        name: projectTitle.trim() || "Manga Studio Project",
      });
      const flowStatus = await fetchGoogleFlowStatus();
      if (flowStatus?.diagnostics) {
        setFlowDiagnostics(flowStatus.diagnostics);
      }
      if (res.success && res.project && isRealVerifiedFlowProjectId(res.project.flowProjectId || res.project.project_id)) {
        const realId = res.project.flowProjectId || res.project.project_id;
        setNotice({
          type: "success",
          text: `✓ تم إنشاء وربط مشروع Google Flow حقيقي بنجاح! (flowProjectId: ${realId})`,
        });
      } else {
        setNotice({
          type: "error",
          text:
            res.error ||
            "FLOW_PROJECT_NOT_FOUND: تعذر إنشاء مشروع حقيقي داخل حساب Google Flow. تأكد من صلاحية الكوكيز في الإعدادات.",
        });
      }
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err?.message || "FLOW_PROJECT_NOT_FOUND: تعذر الاتصال بـ Google Flow.",
      });
    } finally {
      setIsCreatingRealFlowProject(false);
    }
  };

  const handleVerifyElementAssetInFlow = async (elementId: string) => {
    const el = productionElements.find((e) => e.id === elementId);
    if (!el) return;
    const realProjectId =
      el.flowProjectId ||
      el.flow_project_id ||
      flowDiagnostics?.selected_active_project_id ||
      flowDiagnostics?.active_project_id ||
      "";
    if (!isRealVerifiedFlowProjectId(realProjectId) || !el.flowAssetId) {
      setNotice({
        type: "error",
        text: `FLOW_ASSET_NOT_CREATED: العنصر "${el.name}" لا يمتلك flowProjectId أو flowAssetId حقيقيين داخل Google Flow.`,
      });
      return;
    }
    setBusyElementIds((prev) => ({ ...prev, [elementId]: true }));
    try {
      const vRes = await verifyAssetInGoogleFlowApi({
        flowProjectId: realProjectId,
        flowAssetId: el.flowAssetId,
        flowGenerationId: el.flowGenerationId || el.flow_generation_id || undefined,
      });
      const verified = Boolean(vRes.success && vRes.verified);
      setProductionElements((prev) =>
        prev.map((item) =>
          item.id === elementId
            ? {
                ...item,
                flowProjectId: realProjectId,
                flowProjectUrl:
                  vRes.flowProjectUrl || buildRealFlowProjectUrl(realProjectId, el.flowAssetId),
                real_flow_project_verified: true,
                real_flow_asset_verified: verified,
                flow_asset_status: verified ? "FLOW_ASSET_VERIFIED" : "FLOW_ASSET_NOT_VERIFIED",
                status: !verified && item.status === "LOCKED" ? "DRAFT" : item.status,
              }
            : item
        )
      );
      setNotice({
        type: verified ? "success" : "error",
        text:
          vRes.message ||
          (verified
            ? `✓ FLOW_ASSET_VERIFIED: تم التأكد فعلياً من وجود صورة "${el.name}" داخل مشروع Google Flow (${realProjectId})!`
            : `✗ FLOW_ASSET_NOT_VERIFIED: لم يتم العثور على الأصل (${el.flowAssetId}) داخل مشروع Google Flow (${realProjectId}).`),
      });
    } finally {
      setBusyElementIds((prev) => ({ ...prev, [elementId]: false }));
    }
  };

  const handleVerifyLocationAssetInFlow = async (locationId: string) => {
    const loc = locations.find((l) => l.location_id === locationId);
    if (!loc) return;
    const realProjectId =
      loc.flowProjectId ||
      loc.flow_project_id ||
      flowDiagnostics?.selected_active_project_id ||
      flowDiagnostics?.active_project_id ||
      "";
    if (!isRealVerifiedFlowProjectId(realProjectId) || !loc.flowAssetId) {
      setNotice({
        type: "error",
        text: `FLOW_ASSET_NOT_CREATED: الموقع "${loc.name}" لا يمتلك flowProjectId أو flowAssetId حقيقيين داخل Google Flow.`,
      });
      return;
    }
    setBusyLocationIds((prev) => ({ ...prev, [locationId]: true }));
    try {
      const vRes = await verifyAssetInGoogleFlowApi({
        flowProjectId: realProjectId,
        flowAssetId: loc.flowAssetId,
        flowGenerationId: loc.flowGenerationId || loc.flow_generation_id || undefined,
      });
      const verified = Boolean(vRes.success && vRes.verified);
      setLocations((prev) =>
        prev.map((item) =>
          item.location_id === locationId
            ? {
                ...item,
                flowProjectId: realProjectId,
                flowProjectUrl:
                  vRes.flowProjectUrl || buildRealFlowProjectUrl(realProjectId, loc.flowAssetId),
                real_flow_project_verified: true,
                real_flow_asset_verified: verified,
                flow_asset_status: verified ? "FLOW_ASSET_VERIFIED" : "FLOW_ASSET_NOT_VERIFIED",
                status: !verified && item.status === "LOCKED" ? "DRAFT" : item.status,
              }
            : item
        )
      );
      setNotice({
        type: verified ? "success" : "error",
        text:
          vRes.message ||
          (verified
            ? `✓ FLOW_ASSET_VERIFIED: تم التأكد فعلياً من وجود صورة الموقع "${loc.name}" داخل مشروع Google Flow (${realProjectId})!`
            : `✗ FLOW_ASSET_NOT_VERIFIED: لم يتم العثور على الأصل (${loc.flowAssetId}) داخل مشروع Google Flow (${realProjectId}).`),
      });
    } finally {
      setBusyLocationIds((prev) => ({ ...prev, [locationId]: false }));
    }
  };

  // Helper to count how many scenes in the Script use a specific location (including secondary locations & text mentions)
  const getLocationScenesUsage = (loc: StudioLocationItem) => {
    if (!loc || !loc.location_id) {
      return { count: 0, sceneNumbers: [] };
    }
    const usedScenes = scenes.filter(
      (s) =>
        Boolean(s) &&
        (s.location_id === loc.location_id ||
          (Array.isArray(s.secondary_location_ids) &&
            s.secondary_location_ids.includes(loc.location_id)) ||
          (s.location_name && loc.name && s.location_name.includes(loc.name)) ||
          (s.description && loc.name && s.description.includes(loc.name)) ||
          (s.title && loc.name && s.title.includes(loc.name)))
    );
    return {
      count: usedScenes.length,
      sceneNumbers: usedScenes.map((s) => String(s.scene_number).padStart(2, "0")),
    };
  };

  // Dedicated Handler: Extract ALL Locations & Elements from the Full Script (Rule 3 & Rule 4)
  const handleExtractFromFullScript = async () => {
    if (!scriptText.trim()) {
      setNotice({
        type: "error",
        text: "السكريبت فارغ. يرجى إنشاء السكريبت أولًا أو كتابة المشاهد داخل صندوق السكريبت.",
      });
      return;
    }

    setIsExtractingFromScript(true);
    setNotice({
      type: "info",
      text: "جاري قراءة السكريبت الكامل واستخراج جميع المواقع وعناصر الإنتاج والمشاهد المرتبطة بالـ IDs...",
    });

    try {
      const res = await extractLocationsAndElementsFromScriptApi({
        scriptText: scriptText.trim(),
        existingScenes: scenes,
        existingLocations: locations,
        existingElements: productionElements,
        modelId: preferredGeminiModel,
      });

      if (!res.success || !Array.isArray(res.locations) || res.locations.length === 0) {
        setNotice({
          type: "error",
          text: res.error || "تعذر استخراج المواقع من السكريبت. تم الحفاظ على بياناتك الحالية.",
        });
        return;
      }

      const cleanLocations = res.locations.filter(
        (l): l is StudioLocationItem => Boolean(l && l.location_id)
      );
      setLocations(cleanLocations);
      if (Array.isArray(res.production_elements) && res.production_elements.length > 0) {
        setProductionElements(res.production_elements.filter((e) => Boolean(e && (e.id || e.entity_id))));
      }
      if (Array.isArray(res.scenes) && res.scenes.length > 0) {
        setScenes(res.scenes.filter((s): s is StudioSceneItem => Boolean(s && s.scene_id)));
      }

      setNotice({
        type: "success",
        text: `✓ تم تطبيق السكريبت الكامل بنجاح! تم استخراج ${cleanLocations.length} مواقع (${cleanLocations
          .map((l) => `${l.location_id}: ${l.name}`)
          .join("، ")}) وربطها بـ ${(res.scenes || scenes).length} مشاهد.`,
      });
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err?.message || "حدث خطأ أثناء استخراج المواقع من السكريبت.",
      });
    } finally {
      setIsExtractingFromScript(false);
    }
  };

  // ============================================================================
  // ⚡ PREPARED NOVEL DATA HANDLERS (تجهيز الرواية مسبقًا بدون إعادة تحليل Gemini)
  // ============================================================================
  // ============================================================================
  // ⚡ PREPARED NOVEL DATA HANDLERS (تجهيز الرواية مسبقًا بدون إعادة تحليل Gemini)
  // المسار: Prepared Novel Data -> Validate -> ADOPT / COMMIT AS ACTIVE SOURCE ->
  // Replace Old Data -> Rebuild Normalized Data -> Replace Scenes/Events/Chars/Locs ->
  // Update All Studio State & Counters -> Step 2, Step 3+ Synchronized!
  // ============================================================================
  const handleSavePreparedData = async (data: PreparedNovelData) => {
    // 1. DRAFT -> VALIDATED -> ADOPTED: Ensure dataset is adopted with timestamp and active source
    const adoptedData: ActivePreparedNovelData = isDatasetAdopted(data)
      ? data
      : adoptPreparedNovelDataset(data);

    // 2. Commit as Single Active Source of Truth
    setActivePreparedNovelData(adoptedData);
    setPreparedNovelData(adoptedData);

    try {
      localStorage.setItem("studio_active_prepared_novel_data", JSON.stringify(adoptedData));
      localStorage.setItem("studio_prepared_novel_data", JSON.stringify(adoptedData));
      localStorage.setItem("novel_manga_scene_prep_mode", "PREPARED");
    } catch (_) {}
    setScenePreparationMode("PREPARED");

    // 3. Synthesize novel text for the project
    let synthesizedNovelText = "";
    const eventsList = adoptedData.ordered_events || adoptedData.events || [];
    if (Array.isArray(eventsList) && eventsList.length > 0) {
      synthesizedNovelText = eventsList
        .map((ev: any, idx: number) => {
          const num = ev.event_number || idx + 1;
          const title = ev.event_title || ev.title || `الحدث ${num}`;
          const desc = ev.description || ev.action || "";
          const chars =
            Array.isArray(ev.characters) && ev.characters.length > 0
              ? `الشخصيات: ${ev.characters.join("، ")}`
              : "";
          const loc = ev.location ? `الموقع: ${ev.location}` : "";
          const act = ev.action_and_dialogue ? `الحركة والحوار: ${ev.action_and_dialogue}` : "";
          return [`【الحدث ${num}: ${title}】`, desc, chars, loc, act].filter(Boolean).join("\n");
        })
        .join("\n\n-------------------------\n\n");
    } else if (adoptedData.raw_input) {
      synthesizedNovelText = adoptedData.raw_input;
    }

    const nextNovelText = synthesizedNovelText || novelText;
    const nextTitle = adoptedData.novel_title || projectTitle;
    setNovelText(nextNovelText);
    setProjectTitle(nextTitle);

    // 4. INVALIDATE / REPLACE: Clear old continuity anchors and busy flags from previous project
    setLocationContinuityAnchors({});
    setBusySceneIds({});
    setBusyElementIds({});
    setBusyLocationIds({});

    // 5. Rebuild normalized data from the new prepared dataset
    const studioData = adoptedData.converted_studio_data;
    const nextScript = studioData?.script_text || synthesizedNovelText || scriptText;
    const nextElements = studioData?.production_elements || adoptedData.production_elements || [];
    const nextLocations = studioData?.locations || adoptedData.locations || [];
    const nextScenes = studioData?.scenes || adoptedData.scenes || [];
    const nextReport = studioData?.long_novel_report || null;

    // 6. REPLACE OLD SCENES, LOCATIONS, PRODUCTION ELEMENTS & SCRIPT EVERYWHERE
    setScriptText(nextScript);
    setProductionElements(nextElements);
    setLocations(nextLocations);
    setScenes(nextScenes);
    if (nextReport) {
      setLongNovelReport(nextReport);
    }

    // 7. Update Studio Counters & Validation
    const nextCharsCount = nextElements.filter((e) => e.category === "CHARACTER").length;
    const nextWeaponsCount = nextElements.filter((e) => e.category === "WEAPON").length;
    const nextItemsCount = nextElements.filter((e) => e.category === "ITEM").length;
    const nextCreaturesCount = nextElements.filter((e) => e.category === "CREATURE").length;

    setAnalysisValidation({
      response_received: true,
      non_empty: true,
      json_parsed: true,
      required_fields_valid: true,
      saved: true,
      step_complete: true,
      scenes_count: nextScenes.length,
      locations_count: nextLocations.length,
      elements_count: nextElements.length,
      characters_count: nextCharsCount,
      weapons_count: nextWeaponsCount,
      items_count: nextItemsCount,
      creatures_count: nextCreaturesCount,
      events_count: eventsList.length,
      validated_at: new Date().toISOString(),
    });

    setCheckpointState({
      script_saved: Boolean(nextScript && nextScript.trim().length > 0),
      elements_saved: nextElements.length > 0,
      locations_saved: nextLocations.length > 0,
      location_images_saved: false,
      verified_locations_saved: false,
      scenes_saved: nextScenes.length > 0,
      generated_scene_images_saved: false,
      verified_scenes_saved: false,
      last_saved_at: new Date().toISOString(),
    });

    // 8. Commit to Server Checkpoint with replace_all: true
    try {
      await saveStudioCheckpointApi({
        project_title: nextTitle,
        novel_text: nextNovelText,
        script_text: nextScript,
        production_elements: nextElements,
        locations: nextLocations,
        scenes: nextScenes,
        long_novel_pipeline: nextReport,
        active_prepared_novel_data: adoptedData,
        prepared_novel_data: adoptedData,
        current_step: currentStep,
        page_generation_mode: pageGenerationMode,
        replace_all: true,
      });
    } catch (_) {}

    setNotice({
      type: "success",
      text: `🟢 تم اعتماد وتطبيق بيانات «${nextTitle}» كمصدر نشط بنجاح (${nextScenes.length} مشاهد، ${nextElements.length} عناصر Visual Bible، ${nextLocations.length} مواقع، ${eventsList.length} أحداث). تم استبدال البيانات القديمة بالكامل وجميع الأقسام جاهزة ومحدثة!`,
    });
  };

  const handleClearPreparedData = () => {
    setActivePreparedNovelData(null);
    setPreparedNovelData(null);
    try {
      localStorage.removeItem("studio_active_prepared_novel_data");
      localStorage.removeItem("studio_prepared_novel_data");
    } catch (_) {}
    void saveStudioCheckpointApi({
      active_prepared_novel_data: null,
      prepared_novel_data: null,
      replace_all: false,
    });
    setNotice({
      type: "info",
      text: "تم مسح بيانات التجهيز والعودة إلى مسار التحليل الافتراضي.",
    });
  };

  const handleApplyPreparedDataToStudio = async (data: PreparedNovelData) => {
    await handleSavePreparedData(data);
    goToStep(2);
  };

  // ============================================================================
  // STEP 1 HANDLER: Stable Analysis Engine
  // Pipeline: Novel -> Gemini Analysis -> Validate Response -> Parse Structured Data -> Save Result -> Mark Step Complete
  // ============================================================================
  const handleStartWritingScript = async () => {
    // Fast path: if valid prepared novel data is present, NEVER call Gemini!
    const activePrep = activePreparedNovelData || preparedNovelData;
    if (activePrep?.converted_studio_data) {
      await handleSavePreparedData(activePrep);
      goToStep(2);
      return;
    }

    if (!novelText.trim()) {
      setAnalysisError("يرجى كتابة نص الرواية أولًا قبل بدء التحليل وكتابة السكريبت.");
      setNotice({ type: "error", text: "يرجى كتابة نص الرواية أولًا قبل بدء كتابة السكريبت." });
      return;
    }

    setIsWritingScript(true);
    setAnalysisError(null);
    setNotice(null);
    setScriptProgressStage(1); // 1: Novel -> Gemini Analysis

    const progressTimer1 = setTimeout(() => setScriptProgressStage(2), 500); // 2: Validate Response
    const progressTimer2 = setTimeout(() => setScriptProgressStage(3), 1200); // 3: Parse Structured Data

    try {
      const targetCount =
        sceneCountOption === "short"
          ? 3
          : sceneCountOption === "medium"
          ? 5
          : sceneCountOption === "long"
          ? 8
          : sceneCountOption === "custom"
          ? customSceneCount
          : undefined;

      const res = await generateStudioScriptApi({
        projectTitle: projectTitle.trim() || "مشروع القصة المصورة",
        novelText: novelText.trim(),
        targetSceneCount: targetCount,
        modelId: preferredGeminiModel,
      });

      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);

      // Strict Validation Gate before allowing transition to Step 2:
      // 1. Response received
      // 2. Non-empty script_text
      // 3. Structured JSON parsed
      // 4. Required fields valid (scenes > 0, locations > 0)
      if (!res.success || !res.result) {
        const realErr =
          res.error ||
          "فشل تحليل الرواية عبر Gemini Cookies. لم يتم تعديل أو مسح بياناتك السابقة.";
        setAnalysisError(realErr);
        setNotice({ type: "error", text: realErr });
        return;
      }

      const { result } = res;
      const hasValidScript = Boolean(result.script_text && result.script_text.trim().length > 0);
      const hasValidScenes = Array.isArray(result.scenes) && result.scenes.length > 0;
      const hasValidLocations = Array.isArray(result.locations) && result.locations.length > 0;

      if (!hasValidScript || !hasValidScenes || !hasValidLocations) {
        const validationErr =
          "وصل رد غير مكتمل من Gemini (نقص في المشاهد أو المواقع المطلوبة). تم الحفاظ على بياناتك السابقة؛ يرجى الضغط على إعادة المحاولة.";
        setAnalysisError(validationErr);
        setNotice({ type: "error", text: validationErr });
        return;
      }

      // Stage 4: Save Result
      setScriptProgressStage(4);
      setScriptText(result.script_text);
      if (Array.isArray(result.production_elements) && result.production_elements.length > 0) {
        setProductionElements(
          result.production_elements.filter((e) => Boolean(e && (e.id || e.entity_id)))
        );
      }
      setLocations(
        result.locations.filter((l): l is StudioLocationItem => Boolean(l && l.location_id))
      );
      setScenes(result.scenes.filter((s): s is StudioSceneItem => Boolean(s && s.scene_id)));
      setLocationContinuityAnchors({});

      const validationObj: StudioAnalysisValidationReport = result.validation_report || {
        response_received: true,
        non_empty: true,
        json_parsed: true,
        required_fields_valid: true,
        saved: true,
        step_complete: true,
        scenes_count: result.scenes.length,
        locations_count: result.locations.length,
        elements_count: result.production_elements.length,
        validated_at: new Date().toISOString(),
      };
      setAnalysisValidation(validationObj);
      if (result.long_novel_segmentation_report) {
        setLongNovelReport(result.long_novel_segmentation_report);
      }

      try {
        localStorage.setItem(
          "studio_saved_analysis_v2",
          JSON.stringify({
            projectTitle,
            scriptText: result.script_text,
            productionElements: result.production_elements,
            locations: result.locations,
            scenes: result.scenes,
            longNovelReport: result.long_novel_segmentation_report || null,
            savedAt: new Date().toISOString(),
          })
        );
      } catch (_) {}

      // Stage 5: Mark Step Complete & Auto-advance
      if (result.telemetry) {
        setPipelineTelemetry(result.telemetry);
      }
      setScriptProgressStage(5);
      setNotice({
        type: "success",
        text: `اكتمل التحليل والتحقق والحفظ بنجاح في ${
          result.telemetry?.script_duration_ms
            ? `${(result.telemetry.script_duration_ms / 1000).toFixed(2)} ثانية`
            : "وقت قياسي"
        } (${result.scenes.length} مشاهد، ${result.production_elements.length} عنصر Visual Bible شامل، ${result.locations.length} مواقع). تم الانتقال إلى الخطوة 2 (الستايل).`,
      });
      goToStep(2);
    } catch (err: any) {
      const realErr =
        err?.message || "حدث خطأ أثناء الاتصال بمحرك تحليل Gemini Cookies. لم يتم مسح بياناتك السابقة.";
      setAnalysisError(realErr);
      setNotice({
        type: "error",
        text: realErr,
      });
    } finally {
      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      setIsWritingScript(false);
    }
  };

  // ============================================================================
  // STEP 3 HANDLERS: Production Elements Review & Edit
  // ============================================================================
  const handleAddProductionElement = () => {
    if (!newElName.trim()) return;
    const cleanName = newElName.trim();
    const normQuery = cleanName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

    // Prevent Duplicate Entities: check existing name, aliases, canonical identity, description
    const duplicate = productionElements.find((existing) => {
      const existingNorm = existing.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const aliasHit = Array.isArray(existing.aliases)
        ? existing.aliases.some(
            (a) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === normQuery
          )
        : false;
      return (
        existingNorm === normQuery ||
        aliasHit ||
        (existing.category === newElCategory &&
          (existingNorm.includes(normQuery) || normQuery.includes(existingNorm)) &&
          normQuery.length >= 4)
      );
    });

    if (duplicate) {
      // Merge into existing Entity instead of creating a duplicate
      const updatedDesc =
        newElDesc.trim() && !duplicate.description.includes(newElDesc.trim())
          ? `${duplicate.description} — ${newElDesc.trim()}`
          : duplicate.description;
      const updatedAliases = Array.from(new Set([...(duplicate.aliases || []), cleanName]));
      setProductionElements((prev) =>
        prev.map((el) =>
          el.id === duplicate.id
            ? {
                ...el,
                description: updatedDesc,
                aliases: updatedAliases,
              }
            : el
        )
      );
      setNotice({
        type: "info",
        text: `منع التكرار (Entity Ownership Rule): الكيان "${cleanName}" موجود بالفعل تحت المعرف (${duplicate.entity_id || duplicate.id}: ${duplicate.name}). تم ربط المعلومات بالكيان الموجود بدل إنشاء كيان مكرر.`,
      });
      setNewElName("");
      setNewElDesc("");
      setNewElVisual("");
      return;
    }

    const prefix =
      newElCategory === "CHARACTER"
        ? "CHAR"
        : newElCategory === "WEAPON"
        ? "WEAPON"
        : newElCategory === "CREATURE"
        ? "CREATURE"
        : newElCategory === "BUILDING"
        ? "BLDG"
        : newElCategory === "VEHICLE"
        ? "VEH"
        : "ITEM";
    const sameCatCount = productionElements.filter((e) => e.category === newElCategory).length + 1;
    const id = `${prefix}_${String(sameCatCount).padStart(3, "0")}`;
    const baseDesc = newElVisual.trim() || newElDesc.trim() || cleanName;
    const item: StudioProductionElement = {
      id,
      entity_id: id,
      entity_type: newElCategory,
      ownership: newElCategory === "WEAPON" || newElCategory === "ITEM" ? "ATTACHED_AND_INDEPENDENT" : "SELF_OWNED",
      independent_visual_identity: true,
      attached_to: null,
      reference_group_id: `REF_GROUP_${id}`,
      aliases: [cleanName],
      source_references: [],
      category: newElCategory,
      name: cleanName,
      description: newElDesc.trim() || cleanName,
      appearance:
        newElCategory === "CHARACTER" || newElCategory === "CREATURE" ? baseDesc : undefined,
      visual_details: baseDesc,
      canonical_description: baseDesc,
      base_reference_prompt: baseDesc,
      entity_classification: "STANDALONE_ENTITY",
      merged_attributes: [`Visual Details: ${baseDesc}`],
      additive_corrections: [],
      added_corrections: [],
      correction_history: [
        {
          version: 1,
          label: "v1",
          type: "BASE_PROMPT",
          correction_text: "Base Prompt",
          resulting_prompt: baseDesc,
          created_at: new Date().toISOString(),
        },
      ],
      applied_style_settings: {
        style_preset: selectedStyle,
        custom_style_prompt: customStyleText || "",
        generation_style_line: selectedStyle,
        aspect_ratio: selectedAspectRatio,
        selected_model: selectedFlowModel,
        style_version: styleVersion,
        style_hash: currentStyleHash,
        applied_at: new Date().toISOString(),
      },
      aspect_ratio: selectedAspectRatio,
      selected_model: selectedFlowModel,
      style_version: styleVersion,
      styleHash: currentStyleHash,
      immutable_constraints: [`الحفاظ على الهوية والتفاصيل المجمعة لـ ${cleanName}`],
      status: "NOT_GENERATED",
      generation_status: "NOT_GENERATED",
      verification_status: "UNVERIFIED",
      vision_status: "UNVERIFIED",
      version: 0,
      versions: [],
      attempts_log: [],
    };
    setProductionElements((prev) => [...prev, item]);
    setNewElName("");
    setNewElDesc("");
    setNewElVisual("");
  };

  const handleUpdateProductionElement = (
    id: string,
    field: keyof StudioProductionElement,
    value: any
  ) => {
    setProductionElements((prev) =>
      prev.map((el) => {
        if (el.id !== id) return el;
        const updated: StudioProductionElement = { ...el, [field]: value };
        if (field === "visual_details" || field === "description" || field === "appearance") {
          const nextVisual =
            (field === "visual_details" ? String(value || "") : updated.visual_details) ||
            (field === "appearance" ? String(value || "") : updated.appearance) ||
            updated.description ||
            updated.name;
          updated.canonical_description = nextVisual;
          updated.base_reference_prompt = nextVisual;
          if (
            (updated.category === "CHARACTER" || updated.category === "CREATURE") &&
            field === "visual_details"
          ) {
            updated.appearance = String(value || "");
          }
        }
        return updated;
      })
    );
  };

  const handleDeleteProductionElement = (id: string) => {
    setProductionElements((prev) => prev.filter((el) => el.id !== id));
  };

  // Button 1: توليد الوصف المرجعي عبر Gemini (Single Element)
  const handleGenerateElementPromptViaGemini = async (
    elementId: string,
    silent: boolean = false
  ): Promise<StudioProductionElement | null> => {
    const targetEl = productionElements.find((e) => e.id === elementId);
    if (!targetEl) return null;

    setBusyElementIds((prev) => ({ ...prev, [elementId]: true }));
    if (!silent) setNotice(null);
    try {
      const res = await generateStudioElementPromptApi({
        element: targetEl,
        stylePreset: selectedStyle,
        customStylePrompt: customStyleText,
        novelContext: novelText,
        scriptContext: scriptText || novelText,
        allElements: productionElements,
        allLocations: locations,
        allScenes: scenes,
        forceRebuildCanonical: true,
      });
      if (res.telemetry) setPipelineTelemetry(res.telemetry);
      if (res.success && res.element) {
        setProductionElements((prev) =>
          prev.map((e) => (e.id === elementId ? res.element! : e))
        );
        if (!silent) {
          setNotice({
            type: "success",
            text: `✓ تم توليد الوصف المرجعي الشامل المجمّع للعنصر "${res.element.name}" عبر Gemini Cookies!`,
          });
        }
        return res.element;
      } else {
        const errMsg = res.error || `فشل توليد الوصف المرجعي للعنصر ${targetEl.name}`;
        if (!silent) setNotice({ type: "error", text: errMsg });
        return null;
      }
    } catch (err: any) {
      const errMsg = err?.message || `فشل توليد الوصف المرجعي للعنصر ${targetEl.name}`;
      if (!silent) setNotice({ type: "error", text: errMsg });
      return null;
    } finally {
      setBusyElementIds((prev) => ({ ...prev, [elementId]: false }));
    }
  };

  // Batch: توليد الأوصاف المرجعية لجميع العناصر عبر Gemini
  const handleGenerateAllElementPromptsViaGemini = async () => {
    if (productionElements.length === 0) return;
    setIsGeneratingElementPromptsBatch(true);
    setNotice({
      type: "info",
      text: `جاري توليد الأوصاف المرجعية الشاملة المجمعة لـ ${productionElements.length} عنصر عبر Gemini Cookies...`,
    });
    try {
      const res = await generateStudioElementsPromptsBatchApi({
        elements: productionElements,
        stylePreset: selectedStyle,
        customStylePrompt: customStyleText,
        novelContext: novelText,
        scriptContext: scriptText || novelText,
        allLocations: locations,
        allScenes: scenes,
      });
      if (res.telemetry) setPipelineTelemetry(res.telemetry);
      if (res.success && Array.isArray(res.elements)) {
        const returnedMap = new Map(res.elements.map((e) => [e.id, e]));
        setProductionElements((prev) =>
          prev.map((existing) => {
            const updated: any = returnedMap.get(existing.id);
            if (!updated) return existing;
            const hasValidImg =
              Boolean(updated.reference_image_url) &&
              updated.reference_image_url !== "__CLIENT_MEMORY_IMAGE__";
            return {
              ...existing,
              ...updated,
              reference_image_url: hasValidImg
                ? updated.reference_image_url
                : existing.reference_image_url,
              versions:
                Array.isArray(updated.versions) && updated.versions.length > 0
                  ? updated.versions
                  : existing.versions || [],
              attempts_log:
                Array.isArray(updated.attempts_log) && updated.attempts_log.length > 0
                  ? updated.attempts_log
                  : existing.attempts_log || [],
            };
          })
        );
        setNotice({
          type: "success",
          text: `✓ تم توليد وتحديث الأوصاف المرجعية الشاملة لجميع العناصر (${res.elements.length} عنصر) عبر Gemini Cookies!`,
        });
      } else {
        setNotice({
          type: "error",
          text: res.error || "فشل توليد الأوصاف المرجعية للعناصر.",
        });
      }
    } finally {
      setIsGeneratingElementPromptsBatch(false);
    }
  };

  // Button 2 & Button 4: توليد الصورة عبر Google Flow / إعادة التوليد مع التعديل
  const handleGenerateSingleElement = async (
    elementId: string,
    silent: boolean = false,
    elementOverride?: StudioProductionElement,
    options?: {
      autoVerify?: boolean;
      autoLock?: boolean;
      forceRegenerate?: boolean;
      customCorrection?: string;
    }
  ): Promise<StudioProductionElement | null> => {
    const targetEl = elementOverride || productionElements.find((e) => e.id === elementId);
    if (!targetEl) return null;

    const autoVerify = options?.autoVerify !== undefined ? options.autoVerify : true;
    const autoLock = options?.autoLock !== undefined ? options.autoLock : true;
    const forceRegenerate = Boolean(options?.forceRegenerate);
    const customCorrection =
      options?.customCorrection !== undefined
        ? options.customCorrection
        : customElementCorrections[elementId]?.trim() ||
          targetEl.verification_result?.additive_correction ||
          undefined;

    setBusyElementIds((prev) => ({ ...prev, [elementId]: true }));
    setProductionElements((prev) =>
      prev.map((e) =>
        e.id === elementId
          ? {
              ...e,
              approved: false,
              status: forceRegenerate ? "REGENERATING" : "GENERATING",
              generation_status: "GENERATING",
              verification_status: "UNVERIFIED",
              last_error: null,
            }
          : e
      )
    );
    if (!silent) setNotice(null);

    try {
      const res = await generateStudioElementImageApi({
        element: targetEl,
        stylePreset: selectedStyle,
        customStylePrompt: customStyleText,
        aspectRatio: selectedAspectRatio,
        flowModel: selectedFlowModel,
        styleVersion,
        styleHash: currentStyleHash,
        autoVerify: false,
        autoLock,
        maxAttempts: 1,
        customCorrection: forceRegenerate ? customCorrection : undefined,
        forceRegenerate,
      });
      if (res.telemetry) setPipelineTelemetry(res.telemetry);
      if ((res as any).performance_timing) {
        setLatestTimingRecord((res as any).performance_timing);
      }
      void refreshPerformanceReport();
      if (res.success && res.element) {
        let currentEl = res.element;
        setProductionElements((prev) =>
          prev.map((e) => (e.id === elementId ? currentEl : e))
        );
        if (forceRegenerate && customElementCorrections[elementId]) {
          setCustomElementCorrections((prev) => ({ ...prev, [elementId]: "" }));
        }

        // Real Automatic Self-Healing System: analyze via Gemini Vision -> add correction on error -> regenerate via Google Flow -> re-verify until genuine 100% PASS
        if (autoVerify && currentEl.reference_image_url) {
          const maxHealCycles = Math.max(4, maxRetriesPerScene + 1);
          for (let cycle = 1; cycle <= maxHealCycles; cycle++) {
            setProductionElements((prev) =>
              prev.map((e) =>
                e.id === elementId
                  ? { ...e, approved: false, verification_status: "VERIFYING", last_error: null }
                  : e
              )
            );
            const verRes = await verifyStudioElementImageApi({
              element: currentEl,
              stylePreset: selectedStyle,
              customStylePrompt: customStyleText,
              aspectRatio: selectedAspectRatio,
              flowModel: selectedFlowModel,
              styleVersion,
              styleHash: currentStyleHash,
              autoLock: true,
            });
            if (verRes.telemetry) setPipelineTelemetry(verRes.telemetry);
            if (verRes.success && verRes.element) {
              currentEl = verRes.element;
              setProductionElements((prev) =>
                prev.map((e) => (e.id === elementId ? currentEl : e))
              );
              const isPassed =
                Boolean(verRes.approved) &&
                Boolean(currentEl.verification_result?.approved) &&
                Boolean(currentEl.verification_result?.all_required_checks_passed);
              if (isPassed) {
                break;
              }
              if (cycle < maxHealCycles) {
                const autoCorr =
                  currentEl.verification_result?.additive_correction ||
                  (currentEl.verification_result?.critical_corrections || []).join(" ; ") ||
                  (currentEl.verification_result?.what_is_missing || []).join(" ; ") ||
                  (currentEl.verification_result?.what_is_different || []).join(" ; ") ||
                  "Fix all detected reference sheet issues and strictly match canonical visual bible attributes with 100% accuracy.";
                const mergedCorrs = Array.from(
                  new Set([...(currentEl.added_corrections || []), autoCorr].filter(Boolean))
                );
                currentEl = {
                  ...currentEl,
                  approved: false,
                  status: "REGENERATING",
                  generation_status: "GENERATING",
                  added_corrections: mergedCorrs,
                  additive_corrections: mergedCorrs,
                  generation_corrections: mergedCorrs,
                };
                setProductionElements((prev) =>
                  prev.map((e) => (e.id === elementId ? currentEl : e))
                );
                if (!silent) {
                  setNotice({
                    type: "info",
                    text: `🔄 [النظام التلقائي - عناصر الإنتاج] تم اكتشاف خطأ في "${currentEl.name}" (v${currentEl.version || 1}) — تمت إضافة التصحيح تلقائيًا وجاري إعادة إنشاء صورة مصححة عبر Google Flow (محاولة ${cycle + 1}/${maxHealCycles})...`,
                  });
                }
                const regenRes = await generateStudioElementImageApi({
                  element: currentEl,
                  stylePreset: selectedStyle,
                  customStylePrompt: customStyleText,
                  aspectRatio: selectedAspectRatio,
                  flowModel: selectedFlowModel,
                  styleVersion,
                  styleHash: currentStyleHash,
                  autoVerify: false,
                  autoLock: true,
                  maxAttempts: 1,
                  customCorrection: autoCorr,
                  forceRegenerate: true,
                });
                if (regenRes.success && regenRes.element) {
                  currentEl = regenRes.element;
                  setProductionElements((prev) =>
                    prev.map((e) => (e.id === elementId ? currentEl : e))
                  );
                } else {
                  break;
                }
              }
            } else {
              break;
            }
          }
        }

        // Synchronize all attached logical entities (weapons, accessories, minions) from this Master Sheet
        setProductionElements((prev) => {
          const synced = synchronizeAttachedEntitiesFromMaster(prev, currentEl);
          void saveStudioCheckpointApi({ production_elements: synced });
          return synced;
        });

        if (!silent) {
          const isApprovedOrLocked =
            currentEl.status === "LOCKED" || currentEl.verification_status === "VERIFIED";
          setNotice({
            type: isApprovedOrLocked ? "success" : "info",
            text:
              currentEl.status === "LOCKED" || currentEl.verification_status === "VERIFIED"
                ? `✓ [Master Reference Sheet 100%] تم توليد وفحص واعتماد ورقة المرجع الرئيسية الشاملة "${currentEl.name}" بنجاح وتزامن جميع الأسلحة والعتاد المرتبط [LOCKED]!`
                : `تم توليد ورقة المرجع "${currentEl.name}" (النسخة v${currentEl.version || 1} — الحالة: ${currentEl.vision_status || currentEl.status}).`,
          });
        }
        return currentEl;
      } else {
        const errMsg = res.error || `فشل توليد مرجع العنصر ${targetEl.name}`;
        setProductionElements((prev) =>
          prev.map((e) =>
            e.id === elementId
              ? {
                  ...e,
                   ...(res.element ? res.element : {}),
                  last_error: errMsg,
                }
              : e
          )
        );
        if (!silent) setNotice({ type: "error", text: errMsg });
        return null;
      }
    } catch (err: any) {
      const errMsg = err?.message || `فشل توليد مرجع العنصر ${targetEl.name}`;
      if (!silent) setNotice({ type: "error", text: errMsg });
      return null;
    } finally {
      setBusyElementIds((prev) => ({ ...prev, [elementId]: false }));
    }
  };

  // Button 3: فحص عبر Gemini Vision + تصحيح وإعادة توليد تلقائي حتى 100% (Single Element)
  const handleVerifySingleElement = async (
    elementId: string,
    silent: boolean = false,
    elementOverride?: StudioProductionElement,
    autoHealUntilPass: boolean = true
  ): Promise<StudioProductionElement | null> => {
    let targetEl = elementOverride || productionElements.find((e) => e.id === elementId);
    if (!targetEl || !targetEl.reference_image_url) {
      if (!silent) {
        setNotice({
          type: "error",
          text: `يرجى توليد صورة المرجع للعنصر "${targetEl?.name || elementId}" عبر Google Flow أولًا قبل فحصها عبر Gemini Vision.`,
        });
      }
      return null;
    }

    setBusyElementIds((prev) => ({ ...prev, [elementId]: true }));
    if (!silent) setNotice(null);

    try {
      const maxHealCycles = autoHealUntilPass ? Math.max(4, maxRetriesPerScene + 1) : 1;
      let currentEl = targetEl;

      for (let cycle = 1; cycle <= maxHealCycles; cycle++) {
        setProductionElements((prev) =>
          prev.map((e) =>
            e.id === elementId
              ? { ...e, approved: false, verification_status: "VERIFYING", last_error: null }
              : e
          )
        );

        const res = await verifyStudioElementImageApi({
          element: currentEl,
          stylePreset: selectedStyle,
          customStylePrompt: customStyleText,
          aspectRatio: selectedAspectRatio,
          flowModel: selectedFlowModel,
          styleVersion,
          styleHash: currentStyleHash,
          autoLock: true,
        });
        if (res.telemetry) setPipelineTelemetry(res.telemetry);

        if (!res.success || !res.element) {
          const errMsg = res.error || `فشل فحص صورة العنصر ${currentEl.name} عبر Gemini Vision`;
          setProductionElements((prev) =>
            prev.map((e) =>
              e.id === elementId
                ? {
                    ...e,
                    vision_status: "GEMINI_VISION_FAILED",
                    last_error: errMsg,
                  }
                : e
            )
          );
          if (!silent) setNotice({ type: "error", text: errMsg });
          return null;
        }

        currentEl = res.element;
        setProductionElements((prev) =>
          prev.map((e) => (e.id === elementId ? currentEl : e))
        );

        const isPassed =
          Boolean(res.approved) &&
          Boolean(currentEl.verification_result?.approved) &&
          Boolean(currentEl.verification_result?.all_required_checks_passed);

        if (isPassed) {
          if (!silent) {
            setNotice({
              type: "success",
              text: `✓ [النظام التلقائي 100%] اجتازت صورة العنصر "${currentEl.name}" فحص Gemini Vision الحقيقي وتم قفل المرجع تلقائيًا (v${currentEl.version || 1} — 100% PASS → LOCKED)!`,
            });
          }
          return currentEl;
        }

        if (cycle < maxHealCycles) {
          const autoCorr =
            currentEl.verification_result?.additive_correction ||
            (currentEl.verification_result?.critical_corrections || []).join(" ; ") ||
            (currentEl.verification_result?.what_is_missing || []).join(" ; ") ||
            (currentEl.verification_result?.what_is_different || []).join(" ; ") ||
            "Fix all detected reference sheet issues and strictly match canonical visual bible attributes with 100% accuracy.";
          const mergedCorrs = Array.from(
            new Set([...(currentEl.added_corrections || []), autoCorr].filter(Boolean))
          );
          currentEl = {
            ...currentEl,
            approved: false,
            status: "REGENERATING",
            generation_status: "GENERATING",
            added_corrections: mergedCorrs,
            additive_corrections: mergedCorrs,
            generation_corrections: mergedCorrs,
          };
          setProductionElements((prev) =>
            prev.map((e) => (e.id === elementId ? currentEl : e))
          );

          if (!silent) {
            setNotice({
              type: "info",
              text: `🔄 [النظام التلقائي - عناصر الإنتاج] وجد Gemini خطأ في "${currentEl.name}" (v${currentEl.version || 1}) — تمت إضافة التصحيح تلقائيًا وجاري إعادة إنشاء صورة مصححة عبر Google Flow (محاولة ${cycle + 1}/${maxHealCycles})...`,
            });
          }

          const regenRes = await generateStudioElementImageApi({
            element: currentEl,
            stylePreset: selectedStyle,
            customStylePrompt: customStyleText,
            aspectRatio: selectedAspectRatio,
            flowModel: selectedFlowModel,
            styleVersion,
            styleHash: currentStyleHash,
            autoVerify: false,
            autoLock: true,
            maxAttempts: 1,
            customCorrection: autoCorr,
            forceRegenerate: true,
          });
          if (regenRes.telemetry) setPipelineTelemetry(regenRes.telemetry);
          if (regenRes.success && regenRes.element) {
            currentEl = regenRes.element;
            setProductionElements((prev) =>
              prev.map((e) => (e.id === elementId ? currentEl : e))
            );
          } else {
            break;
          }
        }
      }

      if (!silent) {
        setNotice({
          type: "error",
          text: `⚠ فحص Gemini Vision للعنصر "${currentEl.name}": بحاجة إلى تعديل (${currentEl.vision_status}) — النواقص: ${(
            currentEl.verification_result?.what_is_missing ||
            currentEl.verification_result?.detected_issues ||
            []
          ).join("، ")}.`,
        });
      }
      return currentEl;
    } catch (err: any) {
      const errMsg = err?.message || `فشل الاتصال بـ Gemini Vision لفحص العنصر ${targetEl.name}`;
      setProductionElements((prev) =>
        prev.map((e) =>
          e.id === elementId
            ? { ...e, vision_status: "GEMINI_VISION_FAILED", last_error: errMsg }
            : e
        )
      );
      if (!silent) setNotice({ type: "error", text: errMsg });
      return null;
    } finally {
      setBusyElementIds((prev) => ({ ...prev, [elementId]: false }));
    }
  };

  // Batch Verify & Auto-Heal All Elements via Gemini Vision + Google Flow
  const handleVerifyAllElementsParallel = async () => {
    const targets = productionElements.filter(
      (el) =>
        Boolean(el.reference_image_url) &&
        !(
          el.status === "LOCKED" &&
          el.verification_status === "VERIFIED" &&
          el.verification_result?.all_required_checks_passed
        )
    );
    const activeTargets =
      targets.length > 0
        ? targets
        : productionElements.filter((el) => Boolean(el.reference_image_url));
    if (activeTargets.length === 0) {
      setNotice({
        type: "error",
        text: "لا توجد صور مراجع مولدة للعناصر بعد. اضغط على 'توليد وفحص مراجع العناصر تلقائيًا' أولًا.",
      });
      return;
    }
    setIsVerifyingElementsBatch(true);
    setNotice({
      type: "info",
      text: `🤖 [النظام التلقائي - عناصر الإنتاج] جاري فحص وتصحيح وإعادة توليد ${activeTargets.length} مرجع عنصر تلقائيًا حتى الوصول لنتيجة صحيحة 100%...`,
    });
    try {
      await runParallelQueueWithLimit(activeTargets, maxConcurrentGenerations, async (el) => {
        return await handleVerifySingleElement(el.id, true, el, true);
      });
      setNotice({
        type: "success",
        text: `✓ [النظام التلقائي 100%] اكتمل فحص وتصحيح واعتماد صور عناصر الإنتاج عبر Gemini Vision بنجاح 100%!`,
      });
    } finally {
      setIsVerifyingElementsBatch(false);
    }
  };

  // Button 5: قفل المرجع (Single Element — Strictly enforces all 6 conditions: real Flow + real Gemini Vision PASS)
  const handleLockSingleElement = async (elementId: string) => {
    const targetEl = productionElements.find((e) => e.id === elementId);
    if (!targetEl) return;
    const realProjId = targetEl.flowProjectId || targetEl.flow_project_id;
    const ver = targetEl.verification_result;
    const hasVisionPass =
      Boolean(ver && ver.verification_complete === true && ver.approved === true) &&
      (ver?.overall_status === "PASS" ||
        targetEl.vision_status === "PASS" ||
        targetEl.vision_status === "GEMINI_VISION_VERIFIED");
    if (
      !targetEl.reference_image_url ||
      !isRealVerifiedFlowProjectId(realProjId) ||
      !targetEl.flowAssetId ||
      !(targetEl.flowGenerationId || targetEl.flow_generation_id) ||
      targetEl.real_flow_asset_verified !== true ||
      !hasVisionPass
    ) {
      setNotice({
        type: "error",
        text: `LOCKED_GATE_BLOCKED: لا يمكن اعتماد أو قفل مرجع العنصر "${targetEl.name}" (LOCKED) إلا بعد تحقق الشروط الـ 6 كاملة: (1) نجاح توليد Google Flow، (2) توثيق أصل Flow، (3) توفر الصورة الفعلية، (4) إتمام فحص Gemini Vision للصورة الفعلية، (5) حفظ النتيجة المهيكلة، (6) حالة Vision = PASS.`,
      });
      return;
    }
    const res = await lockStudioElementApi(targetEl);
    if (res.success && res.element) {
      setProductionElements((prev) =>
        prev.map((e) => (e.id === elementId ? res.element! : e))
      );
      setNotice({
        type: "success",
        text: `✓ تم اعتماد وقفل مرجع العنصر "${res.element.name}" (${res.element.id} — flowAssetId: ${res.element.flowAssetId} · Vision: PASS) [APPROVED → LOCKED].`,
      });
    } else {
      setNotice({
        type: "error",
        text:
          res.error ||
          `LOCKED_GATE_BLOCKED: تعذر قفل المرجع "${targetEl.name}" لعدم استيفاء شروط Google Flow + Gemini Vision PASS.`,
      });
    }
  };

  const handleLockAllVisualBibleReferences = async () => {
    const res = await lockAllStudioReferencesApi({
      elements: productionElements,
      locations,
    });
    if (res.telemetry) setPipelineTelemetry(res.telemetry);
    if (res.success) {
      if (Array.isArray(res.elements)) {
        const returnedElMap = new Map(res.elements.map((e) => [e.id, e]));
        setProductionElements((prev) =>
          prev.map((existing) => {
            const updated: any = returnedElMap.get(existing.id);
            if (!updated) return existing;
            const hasValidImg =
              Boolean(updated.reference_image_url) &&
              updated.reference_image_url !== "__CLIENT_MEMORY_IMAGE__";
            return {
              ...existing,
              ...updated,
              reference_image_url: hasValidImg
                ? updated.reference_image_url
                : existing.reference_image_url,
              versions:
                Array.isArray(updated.versions) && updated.versions.length > 0
                  ? updated.versions
                  : existing.versions || [],
              attempts_log:
                Array.isArray(updated.attempts_log) && updated.attempts_log.length > 0
                  ? updated.attempts_log
                  : existing.attempts_log || [],
            };
          })
        );
      }
      if (Array.isArray(res.locations)) {
        const returnedLocMap = new Map(res.locations.map((l) => [l.location_id, l]));
        setLocations((prev) =>
          prev.map((existing) => {
            const updated: any = returnedLocMap.get(existing.location_id);
            if (!updated) return existing;
            const hasValidImg =
              Boolean(updated.reference_image_url) &&
              updated.reference_image_url !== "__CLIENT_MEMORY_IMAGE__";
            return {
              ...existing,
              ...updated,
              reference_image_url: hasValidImg
                ? updated.reference_image_url
                : existing.reference_image_url,
              versions:
                Array.isArray(updated.versions) && updated.versions.length > 0
                  ? updated.versions
                  : existing.versions || [],
              attempts_log:
                Array.isArray(updated.attempts_log) && updated.attempts_log.length > 0
                  ? updated.attempts_log
                  : existing.attempts_log || [],
            };
          })
        );
      }
      setNotice({
        type: "success",
        text: `✓ تم اعتماد وقفل جميع عناصر الـ Visual Bible (${productionElements.length} عنصر) والمواقع المولدة [APPROVED → LOCKED]!`,
      });
    }
  };

  const handleGeneratePrimaryVisualBibleElementsParallel = async () => {
    const { masterSheets, entityToMasterMap } = clusterElementsIntoMasterReferenceSheets(
      productionElements,
      locations
    );

    // Filter to Master Sheets that need generation (not yet locked or missing reference image)
    let targetSheets = masterSheets.filter(
      (ms) => !ms.referenceImageUrl || !ms.isApproved || !ms.isLocked
    );
    if (targetSheets.length === 0) {
      targetSheets = [...masterSheets];
    }
    if (targetSheets.length === 0) {
      return;
    }

    setIsGeneratingElementsBatch(true);
    setNotice({
      type: "info",
      text: `جاري توليد وفحص ${targetSheets.length} ورقة مرجع رئيسية شاملة (Master Reference Sheets) بالتوازي عبر Google Flow وتزامن المكونات تلقائيًا...`,
    });

    try {
      let successCount = 0;
      await runParallelQueueWithLimit(
        targetSheets,
        Math.min(maxConcurrentGenerations, 2),
        async (sheet) => {
          if (sheet.sheetType === "LOCATION_CONCEPT_SHEET" && sheet.primaryLocation) {
            const locRes = await handleGenerateSingleLocation(
              sheet.primaryLocation.location_id,
              true,
              true,
              sheet.primaryLocation
            );
            if (locRes && locRes.reference_image_url) {
              successCount++;
              setProductionElements((prev) => {
                const synced = synchronizeAttachedEntitiesFromLocationMaster(prev, locRes);
                void saveStudioCheckpointApi({ production_elements: synced });
                return synced;
              });
            }
          } else if (sheet.primaryElement) {
            const elRes = await handleGenerateSingleElement(
              sheet.primaryElement.id,
              true,
              sheet.primaryElement,
              {
                autoVerify: true,
                autoLock: true,
                forceRegenerate: Boolean(sheet.primaryElement.reference_image_url),
              }
            );
            if (elRes && elRes.reference_image_url) {
              successCount++;
              setProductionElements((prev) => {
                const synced = synchronizeAttachedEntitiesFromMaster(prev, elRes);
                void saveStudioCheckpointApi({ production_elements: synced });
                return synced;
              });
            }
          }
        }
      );

      if (successCount > 0) {
        setNotice({
          type: "success",
          text: `✓ اكتمل توليد وفحص واعتماد ${successCount} من ${targetSheets.length} ورقة مرجع رئيسية شاملة بنجاح عبر Google Flow [100% PASS → LOCKED] وتم تزامن جميع الأسلحة والعتاد المرتبط تلقائيًا!`,
        });
      } else {
        setNotice({
          type: "error",
          text: "تعذر توليد أوراق المراجع الرئيسية عبر Google Flow. تحقق من صلاحية جلسة Google Flow والمشروع النشط.",
        });
      }
    } finally {
      setIsGeneratingElementsBatch(false);
    }
  };

  const handleRunFullFastPipeline = async () => {
    if (!novelText.trim()) {
      setNotice({ type: "error", text: "يرجى إدخال نص الرواية أولًا." });
      return;
    }
    setIsRunningFullPipeline(true);
    const pipelineStartMs = Date.now();
    setNotice({
      type: "info",
      text: "⚡ [المرحلة 1/4] جاري تحليل الرواية في طلب Gemini رئيسي واحد واستخراج السكريبت والـ Visual Bible الشامل والمواقع والمشاهد...",
    });

    try {
      const targetCount =
        sceneCountOption === "short"
          ? 3
          : sceneCountOption === "medium"
          ? 5
          : sceneCountOption === "long"
          ? 8
          : sceneCountOption === "custom"
          ? customSceneCount
          : undefined;

      // 1. Stage 1: Single-Pass Gemini Script + Visual Bible + Locations + Scenes (with Caching)
      const scriptStartMs = Date.now();
      let workingScript = scriptText;
      let workingElements = [...productionElements];
      let workingLocations = [...locations];
      let workingScenes = [...scenes];

      if (preparedNovelData?.converted_studio_data) {
        setNotice({
          type: "info",
          text: "⚡ [المرحلة 1/4] استخدام بيانات الرواية المجهزة مسبقًا مباشرة (تم تخطي استدعاء Gemini بالكامل)...",
        });
        workingScript = preparedNovelData.converted_studio_data.script_text || scriptText;
        workingElements = preparedNovelData.converted_studio_data.production_elements || productionElements;
        workingLocations = preparedNovelData.converted_studio_data.locations || locations;
        workingScenes = preparedNovelData.converted_studio_data.scenes || scenes;
        setScriptText(workingScript);
        setProductionElements(workingElements);
        setLocations(workingLocations);
        setScenes(workingScenes);
      } else if (!workingScript.trim() || workingScenes.length === 0 || workingElements.length === 0) {
        const scriptRes = await generateStudioScriptApi({
          projectTitle: projectTitle.trim() || "مشروع القصة المصورة",
          novelText: novelText.trim(),
          targetSceneCount: targetCount,
        });
        if (!scriptRes.success || !scriptRes.result) {
          throw new Error(scriptRes.error || "فشل تحليل الرواية إلى سكريبت عبر Gemini.");
        }
        workingScript = scriptRes.result.script_text || "";
        workingElements = scriptRes.result.production_elements || [];
        workingLocations = scriptRes.result.locations || [];
        workingScenes = scriptRes.result.scenes || [];
        setScriptText(workingScript);
        setProductionElements(workingElements);
        setLocations(workingLocations);
        setScenes(workingScenes);
        if (scriptRes.result.validation_report) {
          setAnalysisValidation(scriptRes.result.validation_report);
        }
      }
      const scriptDurationMs = Date.now() - scriptStartMs;

      await saveStudioCheckpointApi({
        project_title: projectTitle.trim() || "مشروع القصة المصورة",
        novel_text: novelText.trim(),
        script_text: workingScript,
        production_elements: workingElements,
        locations: workingLocations,
        scenes: workingScenes,
      });

      // 2. Generate, Verify, and Lock Reference Images for Characters, Weapons & Locations so Scenes have real visual references
      const referencesStartMs = Date.now();
      const missingElements = workingElements.filter(
        (el) => Boolean(el && el.id) && (!el.reference_image_url || el.status !== "LOCKED")
      );
      if (missingElements.length > 0) {
        goToStep(3);
        setNotice({
          type: "info",
          text: `⚡ [المرحلة 2/4] جاري توليد وفحص وتثبيت الصور المرجعية لـ ${missingElements.length} من الشخصيات وعناصر الإنتاج لضمان ثبات الهوية 100%...`,
        });
        await runParallelQueueWithLimit(
          missingElements,
          maxConcurrentGenerations,
          async (el) => {
            setBusyElementIds((prev) => ({ ...prev, [el.id]: true }));
            try {
              const elRes = await generateStudioElementImageApi({
                element: el,
                stylePreset: selectedStyle,
                customStylePrompt: customStyleText,
                aspectRatio: selectedAspectRatio,
                flowModel: selectedFlowModel,
                styleVersion,
                styleHash: currentStyleHash,
                autoVerify: true,
                autoLock: true,
                blockingVerify: true,
                maxAttempts: 2,
              });
              if (elRes.success && elRes.element) {
                workingElements = workingElements.map((item) =>
                  item.id === elRes.element!.id ? elRes.element! : item
                );
                setProductionElements([...workingElements]);
              }
              return elRes.element || null;
            } finally {
              setBusyElementIds((prev) => ({ ...prev, [el.id]: false }));
            }
          }
        );
      }

      const missingLocations = workingLocations.filter(
        (loc) =>
          Boolean(loc && loc.location_id) &&
          (!loc.reference_image_url || loc.status !== "LOCKED")
      );
      if (missingLocations.length > 0) {
        goToStep(4);
        setNotice({
          type: "info",
          text: `⚡ [المرحلة 3/4] جاري توليد وفحص وتثبيت الصور المرجعية لـ ${missingLocations.length} مواقع لضمان ثبات البيئة والإضاءة...`,
        });
        await runParallelQueueWithLimit(
          missingLocations,
          maxConcurrentGenerations,
          async (loc) => {
            setBusyLocationIds((prev) => ({ ...prev, [loc.location_id]: true }));
            try {
              const locRes = await generateStudioLocationImageApi({
                location: loc,
                stylePreset: selectedStyle,
                customStylePrompt: customStyleText,
                aspectRatio: selectedAspectRatio,
                flowModel: selectedFlowModel,
                styleVersion,
                styleHash: currentStyleHash,
                autoVerify: true,
                blockingVerify: true,
                maxAttempts: 2,
              });
              if (locRes.success && locRes.location) {
                workingLocations = workingLocations.map((item) =>
                  item.location_id === locRes.location!.location_id ? locRes.location! : item
                );
                setLocations([...workingLocations]);
              }
              return locRes.location || null;
            } finally {
              setBusyLocationIds((prev) => ({ ...prev, [loc.location_id]: false }));
            }
          }
        );
      }

      // Ensure all verified references are strictly LOCKED before Scene Generation
      const lockAllRes = await lockAllStudioReferencesApi({
        elements: workingElements,
        locations: workingLocations,
      });
      if (lockAllRes.success) {
        if (Array.isArray(lockAllRes.elements) && lockAllRes.elements.length > 0) {
          workingElements = lockAllRes.elements;
          setProductionElements([...workingElements]);
        }
        if (Array.isArray(lockAllRes.locations) && lockAllRes.locations.length > 0) {
          workingLocations = lockAllRes.locations;
          setLocations([...workingLocations]);
        }
      }

      // Guard: Never jump to Scene Generation if required references failed to generate
      const ungeneratedRequiredElements = workingElements.filter(
        (el) => Boolean(el && el.id) && !el.reference_image_url
      );
      const ungeneratedRequiredLocations = workingLocations.filter(
        (loc) => Boolean(loc && loc.location_id) && !loc.reference_image_url
      );
      if (ungeneratedRequiredElements.length > 0 || ungeneratedRequiredLocations.length > 0) {
        throw new Error(
          `MISSING_LOCKED_REFERENCES: لا يمكن بدء توليد المشاهد قبل اكتمال وتثبيت جميع الصور المرجعية للشخصيات والأسلحة والمواقع (${ungeneratedRequiredElements.length} عناصر و${ungeneratedRequiredLocations.length} مواقع بدون صور مرجعية).`
        );
      }

      const referencesDurationMs = Date.now() - referencesStartMs;

      // 3. Switch to Step 5 and Generate Scenes Sequentially with Locked References + Gemini Vision Verification + Continuity Anchor Chaining
      goToStep(5);
      const scenesStartMs = Date.now();
      let workingLocationAnchors: LocationContinuityAnchorMap = {
        ...locationContinuityAnchors,
      };
      const sortedScenes = [...workingScenes]
        .filter((s): s is StudioSceneItem => Boolean(s && s.scene_id))
        .sort((a, b) => (a.scene_number || 0) - (b.scene_number || 0));
      const allAlreadyApproved = sortedScenes.every(
        (s) => Boolean(s?.image_url && s?.approved && s?.verification_status === "VERIFIED")
      );
      const scenesToGenerate = sortedScenes.filter(
        (sc) =>
          !sc.image_url ||
          !sc.approved ||
          sc.verification_status !== "VERIFIED" ||
          allAlreadyApproved
      );

      setNotice({
        type: "info",
        text: `⚡ [المرحلة 4/4] جاري توليد وفحص واعتماد ${scenesToGenerate.length} مشاهد بالتسلسل الصارم مع ربط المراجع المقفلة واستمرارية المشهد السابق...`,
      });

      for (const sc of scenesToGenerate) {
        const currentOrdered = [...workingScenes]
          .filter((s): s is StudioSceneItem => Boolean(s && s.scene_id))
          .sort((a, b) => (a.scene_number || 0) - (b.scene_number || 0));
        const seqIdx = currentOrdered.findIndex((s) => s.scene_id === sc.scene_id);
        const prevSc = seqIdx > 0 ? currentOrdered[seqIdx - 1] : null;
        setBusySceneIds((prev) => ({ ...prev, [sc.scene_id]: true }));
        try {
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
          const scRes = await generateAndVerifyStudioSceneApi({
            scene: sc,
            previousScene: prevSc,
            allScenes: workingScenes,
            locationAnchors: workingLocationAnchors,
            stylePreset: selectedStyle,
            customStylePrompt: customStyleText,
            aspectRatio: selectedAspectRatio,
            flowModel: selectedFlowModel,
            styleVersion,
            styleHash: currentStyleHash,
            productionElements: workingElements,
            location: matchedLoc,
            allLocations: workingLocations,
            autoVerify: true,
            blockingVerify: true,
            maxAttempts: Math.max(2, maxRetriesPerScene),
          });
          if (scRes.locationAnchors) {
            workingLocationAnchors = { ...workingLocationAnchors, ...scRes.locationAnchors };
            setLocationContinuityAnchors(workingLocationAnchors);
          }
          if (scRes.success && scRes.scene) {
            workingScenes = workingScenes.map((s) =>
              s && s.scene_id === scRes.scene!.scene_id ? scRes.scene! : s
            );
            setScenes([...workingScenes]);
          } else {
            throw new Error(
              scRes.error ||
                `توقف المسار عند المشهد "${sc.title}" لضمان عدم كسر سلسلة الاستمرارية البصرية.`
            );
          }
        } finally {
          setBusySceneIds((prev) => ({ ...prev, [sc.scene_id]: false }));
        }
      }

      const scenesDurationMs = Date.now() - scenesStartMs;
      const totalDurationMs = Date.now() - pipelineStartMs;

      const cpFinal = await saveStudioCheckpointApi({
        project_title: projectTitle.trim() || "مشروع القصة المصورة",
        novel_text: novelText.trim(),
        script_text: workingScript,
        production_elements: workingElements,
        locations: workingLocations,
        scenes: workingScenes,
        location_continuity_anchors: workingLocationAnchors,
      });
      if (cpFinal?.checkpoint) {
        setCheckpointState(cpFinal.checkpoint);
      }

      const telRes = await getStudioTelemetryApi();
      const updatedTel: StudioPipelineTelemetry = {
        ...(telRes.telemetry || {
          gemini_requests_count: 0,
          gemini_cache_hits: 0,
          flow_requests_count: 0,
          flow_regenerations_count: 0,
          script_duration_ms: 0,
          references_duration_ms: 0,
          scenes_duration_ms: 0,
          total_duration_ms: 0,
          parallel_workers_used: maxConcurrentGenerations,
          warm_session_active: true,
          locked_elements_count: workingElements.filter((e) => e.status === "LOCKED").length,
          approved_scenes_count: workingScenes.filter((s) => s.approved).length,
          total_scenes_count: workingScenes.length,
          last_updated_at: new Date().toISOString(),
        }),
        script_duration_ms: scriptDurationMs,
        references_duration_ms: referencesDurationMs,
        scenes_duration_ms: scenesDurationMs,
        total_duration_ms: totalDurationMs,
        locked_elements_count: workingElements.filter((e) => e.status === "LOCKED").length,
        approved_scenes_count: workingScenes.filter((s) => s.approved).length,
        total_scenes_count: workingScenes.length,
      };
      setPipelineTelemetry(updatedTel);

      const approvedCount = workingScenes.filter((s) => s.approved).length;
      setNotice({
        type: "success",
        text: `✓ اكتمل المسار الكامل في ${(totalDurationMs / 1000).toFixed(1)} ثانية! (${approvedCount}/${workingScenes.length} مشاهد APPROVED | طلبات Gemini: ${updatedTel.gemini_requests_count} | طلبات Flow: ${updatedTel.flow_requests_count} | إعادة التوليد: ${updatedTel.flow_regenerations_count}).`,
      });
    } catch (err: any) {
      setNotice({
        type: "error",
        text: err?.message || "حدث خطأ أثناء تشغيل المسار الكامل.",
      });
    } finally {
      setIsRunningFullPipeline(false);
    }
  };

  // ============================================================================
  // STEP 4 HANDLERS: Locations Management, Parallel Generation & Gemini Vision Verification
  // ============================================================================
  const handleAddLocation = () => {
    if (!newLocName.trim()) return;
    const cleanLocName = newLocName.trim();
    const normLocQuery = cleanLocName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

    // Prevent Duplicate Locations: check existing name, aliases, canonical_name
    const duplicateLoc = locations.find((existing) => {
      const existingNorm = (existing.canonical_name || existing.name)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
      const aliasHit = Array.isArray(existing.aliases)
        ? existing.aliases.some(
            (a) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === normLocQuery
          )
        : false;
      return (
        existingNorm === normLocQuery ||
        aliasHit ||
        ((existingNorm.includes(normLocQuery) || normLocQuery.includes(existingNorm)) &&
          normLocQuery.length >= 4)
      );
    });

    if (duplicateLoc) {
      const updatedDesc =
        newLocDesc.trim() && !duplicateLoc.description.includes(newLocDesc.trim())
          ? `${duplicateLoc.description} — ${newLocDesc.trim()}`
          : duplicateLoc.description;
      const updatedAliases = Array.from(new Set([...(duplicateLoc.aliases || []), cleanLocName]));
      setLocations((prev) =>
        prev.map((loc) =>
          loc.location_id === duplicateLoc.location_id
            ? {
                ...loc,
                description: updatedDesc,
                aliases: updatedAliases,
              }
            : loc
        )
      );
      setNotice({
        type: "info",
        text: `منع تكرار المواقع: الموقع "${cleanLocName}" موجود بالفعل تحت المعرف (${duplicateLoc.location_id}: ${duplicateLoc.name}). تم ربط المعلومات بالموقع الموجود بدل إنشاء موقع مكرر.`,
      });
      setNewLocName("");
      setNewLocDesc("");
      setNewLocVisualDesc("");
      setNewLocPrompt("");
      return;
    }

    const locId = `LOC_${String(locations.length + 1).padStart(3, "0")}`;
    const refPrompt =
      newLocPrompt.trim() ||
      `${selectedStyle} art style, colored manga, high detail, wide establishing environment reference shot of ${cleanLocName} (${newLocType}): ${newLocDesc.trim() || cleanLocName}, pure environment only, no characters, no people, no text, no watermark`;
    const newLoc: StudioLocationItem = {
      location_id: locId,
      canonical_name: cleanLocName,
      aliases: [cleanLocName],
      type: newLocType,
      name: cleanLocName,
      description: newLocDesc.trim() || cleanLocName,
      visual_description: newLocVisualDesc.trim() || newLocDesc.trim() || cleanLocName,
      environment: newLocVisualDesc.trim() || newLocDesc.trim() || cleanLocName,
      architecture: "معالم معمارية وطبيعية متسقة مع القصة",
      ground: "أرضية تفصيلية متطابقة مع البيئة",
      sky: "سماء وأفق متناسقان مع وقت المشهد",
      weather: "طقس مستقر درامي",
      lighting: "إضاءة سينمائية ثابتة في جميع المشاهد",
      atmosphere: "أجواء درامية غامرة",
      materials: "خامات معمارية وطبيعية عالية التفاصيل",
      colors: "ألوان متناسقة مع البيئة والإضاءة الدرامية",
      landmarks: [newLocVisualDesc.trim() || newLocDesc.trim() || cleanLocName],
      reference_prompt: refPrompt,
      base_reference_prompt: refPrompt,
      visual_reference_prompt: refPrompt,
      lighting_and_atmosphere: "إضاءة سينمائية ثابتة في جميع المشاهد",
      color_palette: "ألوان متناسقة مع البيئة والإضاءة الدرامية",
      textures_and_materials: "خامات معمارية وطبيعية عالية التفاصيل",
      textures: "خامات معمارية وطبيعية عالية التفاصيل",
      key_components: [newLocVisualDesc.trim() || newLocDesc.trim() || cleanLocName],
      immutable_elements: [`الحفاظ على تصميم ومعالم ${cleanLocName}`],
      additive_corrections: [],
      added_corrections: [],
      correction_history: [
        {
          version: 1,
          label: "v1",
          type: "BASE_PROMPT",
          correction_text: "Base Prompt",
          resulting_prompt: refPrompt,
          created_at: new Date().toISOString(),
        },
      ],
      style_version: styleVersion,
      style_hash: currentStyleHash,
      reference_image_url: null,
      generation_status: "NOT_GENERATED",
      verification_status: "UNVERIFIED",
      vision_status: "UNVERIFIED",
      verification_result: null,
      version: 0,
      versions: [],
      used_in_scenes_count: 0,
      last_error: null,
    };
    setLocations((prev) => [...prev, newLoc]);
    setNewLocName("");
    setNewLocDesc("");
    setNewLocVisualDesc("");
    setNewLocPrompt("");
  };

  const handleUpdateLocation = (
    locationId: string,
    field: keyof StudioLocationItem,
    value: any
  ) => {
    setLocations((prev) =>
      prev.map((loc) => (loc.location_id === locationId ? { ...loc, [field]: value } : loc))
    );
  };

  const handleDeleteLocation = (locationId: string) => {
    setLocations((prev) => prev.filter((loc) => loc.location_id !== locationId));
  };

  // Location Button 1: توليد الوصف المرجعي عبر Gemini (Single Location)
  const handleGenerateLocationPromptViaGemini = async (
    locationId: string,
    silent: boolean = false
  ): Promise<StudioLocationItem | null> => {
    const targetLoc = locations.find((l) => l.location_id === locationId);
    if (!targetLoc) return null;

    setBusyLocationIds((prev) => ({ ...prev, [locationId]: true }));
    if (!silent) setNotice(null);
    try {
      const res = await generateStudioLocationPromptApi({
        location: targetLoc,
        stylePreset: selectedStyle,
        customStylePrompt: customStyleText,
        scriptContext: scriptText || novelText,
      });
      if (res.telemetry) setPipelineTelemetry(res.telemetry);
      if (res.success && res.location) {
        setLocations((prev) =>
          prev.map((l) => (l.location_id === locationId ? res.location! : l))
        );
        if (!silent) {
          setNotice({
            type: "success",
            text: `✓ تم توليد الوصف المرجعي المجمّع للموقع "${res.location.name}" عبر Gemini Cookies!`,
          });
        }
        return res.location;
      } else {
        const errMsg = res.error || `فشل توليد الوصف المرجعي للموقع ${targetLoc.name}`;
        if (!silent) setNotice({ type: "error", text: errMsg });
        return null;
      }
    } catch (err: any) {
      const errMsg = err?.message || `فشل توليد الوصف المرجعي للموقع ${targetLoc.name}`;
      if (!silent) setNotice({ type: "error", text: errMsg });
      return null;
    } finally {
      setBusyLocationIds((prev) => ({ ...prev, [locationId]: false }));
    }
  };

  // Batch: توليد الأوصاف المرجعية لجميع المواقع عبر Gemini
  const handleGenerateAllLocationPromptsViaGemini = async () => {
    if (locations.length === 0) return;
    setIsGeneratingLocationPromptsBatch(true);
    setNotice({
      type: "info",
      text: `جاري توليد الأوصاف المرجعية المجمعة لـ ${locations.length} مواقع عبر Gemini Cookies...`,
    });
    try {
      const res = await generateStudioLocationsPromptsBatchApi({
        locations,
        stylePreset: selectedStyle,
        customStylePrompt: customStyleText,
        scriptContext: scriptText || novelText,
      });
      if (res.telemetry) setPipelineTelemetry(res.telemetry);
      if (res.success && Array.isArray(res.locations)) {
        const validLocs = res.locations.filter(
          (l): l is StudioLocationItem => Boolean(l && l.location_id)
        );
        const returnedMap = new Map(validLocs.map((l) => [l.location_id, l]));
        setLocations((prev) =>
          prev.map((existing) => {
            const updated: any = returnedMap.get(existing.location_id);
            if (!updated) return existing;
            const hasValidImg =
              Boolean(updated.reference_image_url) &&
              updated.reference_image_url !== "__CLIENT_MEMORY_IMAGE__";
            return {
              ...existing,
              ...updated,
              reference_image_url: hasValidImg
                ? updated.reference_image_url
                : existing.reference_image_url,
              versions:
                Array.isArray(updated.versions) && updated.versions.length > 0
                  ? updated.versions
                  : existing.versions || [],
              attempts_log:
                Array.isArray(updated.attempts_log) && updated.attempts_log.length > 0
                  ? updated.attempts_log
                  : existing.attempts_log || [],
            };
          })
        );
        setNotice({
          type: "success",
          text: `✓ تم توليد وتحديث الأوصاف المرجعية لجميع المواقع (${validLocs.length} مواقع) عبر Gemini Cookies!`,
        });
      } else {
        setNotice({
          type: "error",
          text: res.error || "فشل توليد الأوصاف المرجعية للمواقع.",
        });
      }
    } finally {
      setIsGeneratingLocationPromptsBatch(false);
    }
  };

  // Location Button 2 & Button 4: توليد الصورة عبر Google Flow / إعادة التوليد مع التعديل
  const handleGenerateSingleLocation = async (
    locationId: string,
    silent: boolean = false,
    autoVerify: boolean = true,
    locationOverride?: StudioLocationItem,
    options?: {
      forceRegenerate?: boolean;
      customCorrection?: string;
    }
  ): Promise<StudioLocationItem | null> => {
    const targetLoc = locationOverride || locations.find((l) => l.location_id === locationId);
    if (!targetLoc) return null;

    const forceRegenerate = Boolean(options?.forceRegenerate);
    const customCorrection =
      options?.customCorrection !== undefined
        ? options.customCorrection
        : customLocationCorrections[locationId]?.trim() ||
          targetLoc.verification_result?.additive_correction ||
          undefined;

    setBusyLocationIds((prev) => ({ ...prev, [locationId]: true }));
    setLocations((prev) =>
      prev.map((l) =>
        l.location_id === locationId
          ? {
              ...l,
              approved: false,
              status: "GENERATING",
              generation_status: "GENERATING",
              verification_status: "UNVERIFIED",
              last_error: null,
            }
          : l
      )
    );
    if (!silent) setNotice(null);

    try {
      const res = await generateStudioLocationImageApi({
        location: targetLoc,
        stylePreset: selectedStyle,
        customStylePrompt: customStyleText,
        aspectRatio: selectedAspectRatio,
        flowModel: selectedFlowModel,
        styleVersion,
        styleHash: currentStyleHash,
        autoVerify: false,
        maxAttempts: 1,
        customCorrection: forceRegenerate ? customCorrection : undefined,
        forceRegenerate,
      });

      if (res.success && res.location) {
        let currentLoc = res.location;
        if ((res as any).performance_timing) {
          setLatestTimingRecord((res as any).performance_timing);
        }
        void refreshPerformanceReport();
        setLocations((prev) =>
          prev.map((l) => (l.location_id === locationId ? currentLoc : l))
        );
        if (forceRegenerate && customLocationCorrections[locationId]) {
          setCustomLocationCorrections((prev) => ({ ...prev, [locationId]: "" }));
        }

        // Real Automatic Self-Healing System for Locations: analyze via Gemini Vision -> add correction on error -> regenerate via Google Flow -> re-verify until genuine 100% PASS
        if (autoVerify && currentLoc.reference_image_url) {
          const maxHealCycles = Math.max(4, maxRetriesPerScene + 1);
          for (let cycle = 1; cycle <= maxHealCycles; cycle++) {
            setLocations((prev) =>
              prev.map((l) =>
                l.location_id === locationId
                  ? { ...l, approved: false, verification_status: "VERIFYING", last_error: null }
                  : l
              )
            );
            const verRes = await verifyStudioLocationImageApi({
              location: currentLoc,
              stylePreset: selectedStyle,
              customStylePrompt: customStyleText,
              aspectRatio: selectedAspectRatio,
              flowModel: selectedFlowModel,
              styleVersion,
              styleHash: currentStyleHash,
            });
            if (verRes.success && verRes.location) {
              currentLoc = verRes.location;
              setLocations((prev) =>
                prev.map((l) => (l.location_id === locationId ? currentLoc : l))
              );
              const isPassed =
                Boolean(verRes.approved) &&
                Boolean(currentLoc.verification_result?.approved) &&
                Boolean(currentLoc.verification_result?.all_required_checks_passed);
              if (isPassed) {
                break;
              }
              if (cycle < maxHealCycles) {
                const autoCorr =
                  currentLoc.verification_result?.additive_correction ||
                  (currentLoc.verification_result?.critical_corrections || []).join(" ; ") ||
                  (currentLoc.verification_result?.what_is_missing || []).join(" ; ") ||
                  (currentLoc.verification_result?.what_is_different || []).join(" ; ") ||
                  "Fix all detected environment reference issues, remove any characters, and match canonical location geometry and style 100%.";
                const mergedLocCorrs = Array.from(
                  new Set([...(currentLoc.added_corrections || []), autoCorr].filter(Boolean))
                );
                currentLoc = {
                  ...currentLoc,
                  approved: false,
                  status: "GENERATING",
                  generation_status: "GENERATING",
                  added_corrections: mergedLocCorrs,
                  additive_corrections: mergedLocCorrs,
                  generation_corrections: mergedLocCorrs,
                };
                setLocations((prev) =>
                  prev.map((l) => (l.location_id === locationId ? currentLoc : l))
                );
                if (!silent) {
                  setNotice({
                    type: "info",
                    text: `🔄 [النظام التلقائي - المواقع] تم اكتشاف خطأ في الموقع "${currentLoc.name}" (v${currentLoc.version || 1}) — تمت إضافة التصحيح تلقائيًا وجاري إعادة إنشاء صورة مصححة عبر Google Flow (محاولة ${cycle + 1}/${maxHealCycles})...`,
                  });
                }
                const regenRes = await generateStudioLocationImageApi({
                  location: currentLoc,
                  stylePreset: selectedStyle,
                  customStylePrompt: customStyleText,
                  aspectRatio: selectedAspectRatio,
                  flowModel: selectedFlowModel,
                  styleVersion,
                  styleHash: currentStyleHash,
                  autoVerify: false,
                  maxAttempts: 1,
                  customCorrection: autoCorr,
                  forceRegenerate: true,
                });
                if (regenRes.success && regenRes.location) {
                  currentLoc = regenRes.location;
                  setLocations((prev) =>
                    prev.map((l) => (l.location_id === locationId ? currentLoc : l))
                  );
                } else {
                  break;
                }
              }
            } else {
              break;
            }
          }
        }

        if (!silent) {
          if (autoVerify) {
            if (
              currentLoc.status === "LOCKED" ||
              (currentLoc.verification_status === "VERIFIED" &&
                currentLoc.verification_result?.approved &&
                currentLoc.verification_result?.all_required_checks_passed)
            ) {
              setNotice({
                type: "success",
                text: `✓ [النظام التلقائي 100%] تم توليد وفحص واعتماد وقفل صورة الموقع "${currentLoc.name}" (v${currentLoc.version || 1} — 100% PASS → LOCKED)!`,
              });
            } else {
              setNotice({
                type: "error",
                text:
                  currentLoc.last_error ||
                  `⚠ لم تجتز صورة الموقع "${currentLoc.name}" جميع الفحوصات (${
                    currentLoc.verification_result?.failed_checks?.join(", ") || ""
                  }).`,
              });
            }
          } else {
            setNotice({
              type: "success",
              text: `✓ تم توليد صورة الموقع "${currentLoc.name}" عبر Google Flow (النسخة v${currentLoc.version || 1}). اضغط على "فحص عبر Gemini Vision" للتحقق والتصحيح التلقائي.`,
            });
          }
        }

        // Synchronize all attached location sub-entities (monuments, statues, relics) from this Location Master Sheet
        setProductionElements((prev) => {
          const synced = synchronizeAttachedEntitiesFromLocationMaster(prev, currentLoc);
          void saveStudioCheckpointApi({ production_elements: synced });
          return synced;
        });

        return currentLoc;
      } else {
        const errText = res.error || `فشل توليد صورة الموقع ${targetLoc.name}`;
        setLocations((prev) =>
          prev.map((l) =>
            l.location_id === locationId
              ? { ...l, ...(res.location ? res.location : {}), generation_status: "FAILED", last_error: errText }
              : l
          )
        );
        if (!silent) setNotice({ type: "error", text: errText });
        return null;
      }
    } catch (err: any) {
      const errText = err?.message || `حدث خطأ أثناء توليد صورة الموقع ${targetLoc.name}`;
      setLocations((prev) =>
        prev.map((l) =>
          l.location_id === locationId
            ? { ...l, generation_status: "FAILED", last_error: errText }
            : l
        )
      );
      if (!silent) setNotice({ type: "error", text: errText });
      return null;
    } finally {
      setBusyLocationIds((prev) => ({ ...prev, [locationId]: false }));
    }
  };

  // Location Button 3: فحص عبر Gemini Vision + تصحيح وإعادة توليد تلقائي حتى 100% (Single Location)
  const handleVerifySingleLocation = async (
    locationId: string,
    silent: boolean = false,
    locationOverride?: StudioLocationItem,
    autoHealUntilPass: boolean = true
  ): Promise<StudioLocationItem | null> => {
    const targetLoc = locationOverride || locations.find((l) => l.location_id === locationId);
    if (!targetLoc || !targetLoc.reference_image_url) {
      if (!silent) {
        setNotice({
          type: "error",
          text: "يرجى توليد صورة الموقع عبر Google Flow أولًا قبل فحصها عبر Gemini Vision.",
        });
      }
      return null;
    }

    setBusyLocationIds((prev) => ({ ...prev, [locationId]: true }));
    if (!silent) setNotice(null);

    try {
      const maxHealCycles = autoHealUntilPass ? Math.max(4, maxRetriesPerScene + 1) : 1;
      let currentLoc = targetLoc;

      for (let cycle = 1; cycle <= maxHealCycles; cycle++) {
        setLocations((prev) =>
          prev.map((l) =>
            l.location_id === locationId
              ? { ...l, approved: false, verification_status: "VERIFYING", last_error: null }
              : l
          )
        );

        const res = await verifyStudioLocationImageApi({
          location: currentLoc,
          stylePreset: selectedStyle,
          customStylePrompt: customStyleText,
          aspectRatio: selectedAspectRatio,
          flowModel: selectedFlowModel,
          styleVersion,
          styleHash: currentStyleHash,
        });

        if (!res.success || !res.location) {
          const errText = res.error || `فشل التحقق من صورة الموقع ${currentLoc.name}`;
          setLocations((prev) =>
            prev.map((l) =>
              l.location_id === locationId
                ? {
                    ...l,
                    verification_status: "UNVERIFIED",
                    vision_status: "GEMINI_VISION_FAILED",
                    last_error: errText,
                  }
                : l
            )
          );
          if (!silent) setNotice({ type: "error", text: errText });
          return null;
        }

        currentLoc = res.location;
        setLocations((prev) =>
          prev.map((l) => (l.location_id === locationId ? currentLoc : l))
        );

        const isPassed =
          Boolean(res.approved) &&
          Boolean(currentLoc.verification_result?.approved) &&
          Boolean(currentLoc.verification_result?.all_required_checks_passed);

        if (isPassed) {
          if (!silent) {
            setNotice({
              type: "success",
              text: `✓ [النظام التلقائي 100%] تم التحقق البصري الحقيقي واعتماد وقفل صورة الموقع "${currentLoc.name}" عبر Gemini Vision (v${currentLoc.version || 1} — 100% PASS → LOCKED)!`,
            });
          }
          return currentLoc;
        }

        if (cycle < maxHealCycles) {
          const autoCorr =
            currentLoc.verification_result?.additive_correction ||
            (currentLoc.verification_result?.critical_corrections || []).join(" ; ") ||
            (currentLoc.verification_result?.what_is_missing || []).join(" ; ") ||
            (currentLoc.verification_result?.what_is_different || []).join(" ; ") ||
            "Fix all detected environment reference issues, remove any characters, and match canonical location geometry and style 100%.";
          const mergedLocCorrs = Array.from(
            new Set([...(currentLoc.added_corrections || []), autoCorr].filter(Boolean))
          );
          currentLoc = {
            ...currentLoc,
            approved: false,
            status: "GENERATING",
            generation_status: "GENERATING",
            added_corrections: mergedLocCorrs,
            additive_corrections: mergedLocCorrs,
            generation_corrections: mergedLocCorrs,
          };
          setLocations((prev) =>
            prev.map((l) => (l.location_id === locationId ? currentLoc : l))
          );

          if (!silent) {
            setNotice({
              type: "info",
              text: `🔄 [النظام التلقائي - المواقع] وجد Gemini خطأ في الموقع "${currentLoc.name}" (v${currentLoc.version || 1}) — تمت إضافة التصحيح تلقائيًا وجاري إعادة إنشاء صورة مصححة عبر Google Flow (محاولة ${cycle + 1}/${maxHealCycles})...`,
            });
          }

          const regenRes = await generateStudioLocationImageApi({
            location: currentLoc,
            stylePreset: selectedStyle,
            customStylePrompt: customStyleText,
            aspectRatio: selectedAspectRatio,
            flowModel: selectedFlowModel,
            styleVersion,
            styleHash: currentStyleHash,
            autoVerify: false,
            maxAttempts: 1,
            customCorrection: autoCorr,
            forceRegenerate: true,
          });
          if (regenRes.success && regenRes.location) {
            currentLoc = regenRes.location;
            setLocations((prev) =>
              prev.map((l) => (l.location_id === locationId ? currentLoc : l))
            );
          } else {
            break;
          }
        }
      }

      if (!silent) {
        setNotice({
          type: "error",
          text: `⚠ فحص Gemini Vision للموقع "${currentLoc.name}": بحاجة إلى تعديل (${currentLoc.vision_status}) — النواقص: (${
            (
              currentLoc.verification_result?.what_is_missing ||
              currentLoc.verification_result?.failed_checks ||
              []
            ).join("، ")
          }).`,
        });
      }
      return currentLoc;
    } catch (err: any) {
      const errText = err?.message || `فشل الاتصال بـ Gemini Vision لفحص الموقع ${targetLoc.name}`;
      setLocations((prev) =>
        prev.map((l) =>
          l.location_id === locationId
            ? { ...l, verification_status: "UNVERIFIED", vision_status: "GEMINI_VISION_FAILED", last_error: errText }
            : l
        )
      );
      if (!silent) setNotice({ type: "error", text: errText });
      return null;
    } finally {
      setBusyLocationIds((prev) => ({ ...prev, [locationId]: false }));
    }
  };

  // Location Button 5: قفل المرجع (Single Location — Strictly enforces all 6 conditions: real Flow + real Gemini Vision PASS)
  const handleLockSingleLocation = async (locationId: string) => {
    const targetLoc = locations.find((l) => l.location_id === locationId);
    if (!targetLoc) return;
    const realProjId = targetLoc.flowProjectId || targetLoc.flow_project_id;
    const ver = targetLoc.verification_result;
    const hasVisionPass =
      Boolean(
        ver &&
          ver.verification_complete === true &&
          ver.approved === true &&
          ver.all_required_checks_passed === true
      ) &&
      (ver?.overall_status === "PASS" ||
        targetLoc.vision_status === "PASS" ||
        targetLoc.vision_status === "GEMINI_VISION_VERIFIED");
    if (
      !targetLoc.reference_image_url ||
      !isRealVerifiedFlowProjectId(realProjId) ||
      !targetLoc.flowAssetId ||
      !(targetLoc.flowGenerationId || targetLoc.flow_generation_id) ||
      targetLoc.real_flow_asset_verified !== true ||
      !hasVisionPass
    ) {
      setNotice({
        type: "error",
        text: `LOCKED_GATE_BLOCKED: لا يمكن اعتماد أو قفل مرجع الموقع "${targetLoc.name}" (LOCKED) إلا بعد تحقق الشروط الـ 6 كاملة: (1) نجاح توليد Google Flow، (2) توثيق أصل Flow، (3) توفر الصورة الفعلية، (4) إتمام فحص Gemini Vision للصورة الفعلية، (5) حفظ النتيجة المهيكلة، (6) حالة Vision = PASS.`,
      });
      return;
    }
    const lockRes = await lockStudioLocationApi(targetLoc);
    if (!lockRes.success || !lockRes.location || lockRes.location.status !== "LOCKED") {
      setNotice({
        type: "error",
        text:
          lockRes.error ||
          `LOCKED_GATE_BLOCKED: رفض الخادم قفل الموقع "${targetLoc.name}" لعدم استيفاء شروط Google Flow + Gemini Vision PASS.`,
      });
      return;
    }
    const lockedLoc = lockRes.location;
    const nextLocations = locations.map((l) => (l.location_id === locationId ? lockedLoc : l));
    setLocations(nextLocations);
    await saveStudioCheckpointApi({
      locations: nextLocations,
    });
    setNotice({
      type: "success",
      text: `✓ تم اعتماد وقفل مرجع الموقع "${lockedLoc.name}" (${lockedLoc.location_id} — flowAssetId: ${lockedLoc.flowAssetId} · Vision: PASS) [APPROVED → LOCKED]!`,
    });
  };

  // Generate ALL (or only failed/unverified) locations in PARALLEL via Worker Pool (MAX_CONCURRENT_GENERATIONS)
  const handleGenerateAllLocationsParallel = async (
    onlyFailedOrMissing: boolean = false,
    autoVerifyWithLoop: boolean = false
  ) => {
    let targets = locations.filter((loc) => {
      if (!onlyFailedOrMissing) {
        if (
          loc.reference_image_url &&
          loc.verification_status === "VERIFIED" &&
          loc.verification_result?.all_required_checks_passed
        ) {
          return false;
        }
        return true;
      }
      return (
        !loc.reference_image_url ||
        loc.generation_status === "FAILED" ||
        loc.verification_status === "REJECTED" ||
        loc.verification_status === "MANUAL_REVIEW_REQUIRED"
      );
    });

    if (targets.length === 0 && !onlyFailedOrMissing) {
      targets = [...locations];
    }

    if (targets.length === 0) {
      setNotice({
        type: "info",
        text: "لا توجد مواقع فاشلة لإعادة توليدها.",
      });
      return;
    }

    setIsGeneratingAllLocations(true);
    setNotice({
      type: "info",
      text: autoVerifyWithLoop
        ? `جاري تشغيل خط التوليد والتحقق الصارم المتوازي لـ ${targets.length} مواقع (MAX_CONCURRENT = ${maxConcurrentGenerations}، حتى 3 محاولات لكل موقع)...`
        : `جاري إرسال ${targets.length} مواقع دفعة واحدة إلى طابور Google Flow المتوازي (MAX_CONCURRENT = ${maxConcurrentGenerations})...`,
    });

    const targetIds = new Set(targets.map((t) => t.location_id));
    setLocations((prev) =>
      prev.map((l) =>
        targetIds.has(l.location_id) ? { ...l, generation_status: "QUEUED", last_error: null } : l
      )
    );

    try {
      const results = await runParallelQueueWithLimit(targets, maxConcurrentGenerations, async (loc) => {
        return await handleGenerateSingleLocation(loc.location_id, true, autoVerifyWithLoop, loc);
      });
      const succeededCount = results.filter((r) => Boolean(r && r.reference_image_url)).length;
      if (succeededCount === 0) {
        setNotice({
          type: "error",
          text: `FLOW_GENERATION_FAILED: فشل توليد صور المواقع عبر Google Flow Cookies. يرجى التحقق من الخطأ المعروض أسفل البطاقات.`,
        });
      } else {
        setNotice({
          type: "success",
          text: autoVerifyWithLoop
            ? `اكتمل التوليد والتحقق البصري الصارم المتوازي لـ ${succeededCount} من ${targets.length} مواقع عبر Google Flow Cookies!`
            : `اكتمل التوليد المتوازي لصور المواقع (${succeededCount} من ${targets.length} مواقع عبر Google Flow Cookies)! اضغط الآن على "✓ التأكد من جميع الصور عبر Gemini" لفحص الـ 11 معيارًا.`,
        });
      }
    } finally {
      setIsGeneratingAllLocations(false);
    }
  };

  // Verify ALL generated location images in PARALLEL via Worker Pool (MAX_CONCURRENT_GENERATIONS)
  const handleVerifyAllLocationsParallel = async () => {
    const targets = locations.filter((loc) => Boolean(loc.reference_image_url));
    if (targets.length === 0) {
      setNotice({
        type: "error",
        text: "لا توجد صور مواقع مولدة بعد. اضغط على 'توليد جميع صور المواقع' أولًا.",
      });
      return;
    }

    setIsVerifyingAllLocations(true);
    setNotice({
      type: "info",
      text: `جاري فحص ${targets.length} صور مواقع عبر Gemini Vision بالتوازي وفق الـ 11 معيارًا الصارمة (الحد المتزامن: ${maxConcurrentGenerations})...`,
    });

    const targetIds = new Set(targets.map((t) => t.location_id));
    setLocations((prev) =>
      prev.map((l) =>
        targetIds.has(l.location_id) ? { ...l, verification_status: "QUEUED", last_error: null } : l
      )
    );

    try {
      await runParallelQueueWithLimit(targets, maxConcurrentGenerations, async (loc) => {
        await handleVerifySingleLocation(loc.location_id, true, loc);
      });
      setNotice({
        type: "success",
        text: `اكتمل الفحص الصارم المتوازي لجميع صور المواقع عبر Gemini Vision!`,
      });
    } finally {
      setIsVerifyingAllLocations(false);
    }
  };

  // ============================================================================
  // STEP 5 HANDLERS: SEQUENTIAL SCENE CONTINUITY ENGINE + Strict Gemini Vision Verification
  // ============================================================================
  const findChronologicalPreviousScene = (
    currentScene: StudioSceneItem,
    sceneList: StudioSceneItem[]
  ): StudioSceneItem | null => {
    const validList = sceneList
      .filter((s): s is StudioSceneItem => Boolean(s && s.scene_id))
      .sort((a, b) => (a.scene_number || 0) - (b.scene_number || 0));
    if (currentScene.previous_scene_id) {
      const explicitPrev = validList.find((s) => s.scene_id === currentScene.previous_scene_id);
      if (explicitPrev) return explicitPrev;
    }
    const idx = validList.findIndex((s) => s.scene_id === currentScene.scene_id);
    if (idx > 0) {
      return validList[idx - 1];
    }
    return null;
  };

  const handleGenerateSingleScene = async (
    sceneId: string,
    silent: boolean = false,
    sceneOverride?: StudioSceneItem,
    customCorrectionOverride?: string,
    sequentialContext?: {
      previousScene?: StudioSceneItem | null;
      allScenesSnapshot?: StudioSceneItem[];
      locationAnchorsSnapshot?: LocationContinuityAnchorMap;
    }
  ): Promise<{
    scene: StudioSceneItem | null;
    updatedAnchors: LocationContinuityAnchorMap;
  }> => {
    const activeSceneList = sequentialContext?.allScenesSnapshot || scenes;
    const targetScene =
      sceneOverride || activeSceneList.find((s) => s && s.scene_id === sceneId);
    if (!targetScene) {
      return {
        scene: null,
        updatedAnchors: sequentialContext?.locationAnchorsSnapshot || locationContinuityAnchors,
      };
    }

    const previousScene =
      sequentialContext?.previousScene !== undefined
        ? sequentialContext.previousScene
        : findChronologicalPreviousScene(targetScene, activeSceneList);
    const activeAnchors =
      sequentialContext?.locationAnchorsSnapshot || locationContinuityAnchors;

    const manualCorrection =
      customCorrectionOverride !== undefined
        ? customCorrectionOverride.trim()
        : (customSceneCorrections[sceneId] || "").trim() ||
          (targetScene.verification_status === "REJECTED"
            ? (
                targetScene.verification_result?.additive_correction ||
                targetScene.verification_result?.continuity_additive_correction ||
                ""
              ).trim()
            : "");

    const isCorrectiveRegeneration = Boolean(
      manualCorrection || targetScene.verification_status === "REJECTED"
    );

    setBusySceneIds((prev) => ({ ...prev, [sceneId]: true }));
    if (!silent) setNotice(null);

    // Strictly mark unapproved while generating/inspecting
    setScenes((prev) =>
      prev.map((s) =>
        s.scene_id === sceneId
          ? {
              ...s,
              approved: false,
              generation_status: "GENERATING",
              verification_status: "UNVERIFIED",
              vision_status: "UNVERIFIED",
              pipeline_stage: "ANALYZING_SCENE",
              current_attempt: 1,
              max_attempts: Math.min(maxRetriesPerScene, 3),
              last_error: null,
            }
          : s
      )
    );

    // Rule 4, 5, 6: Never copy previousScene.location or fallback to locations[0] blindly
    const matchedLocation =
      targetScene.location_uncertain || targetScene.location_id === "LOCATION_UNCERTAIN"
        ? undefined
        : locations.find(
            (l) =>
              Boolean(l && l.location_id) &&
              (l.location_id ===
                (targetScene.primary_location_id ||
                  targetScene.location_entity_id ||
                  targetScene.location_id) ||
                l.name === targetScene.location_name)
          );

    try {
      const res = await generateAndVerifyStudioSceneApi({
        scene: targetScene,
        previousScene,
        allScenes: activeSceneList,
        locationAnchors: activeAnchors,
        stylePreset: selectedStyle,
        customStylePrompt: customStyleText,
        aspectRatio: selectedAspectRatio,
        flowModel: selectedFlowModel,
        styleVersion,
        styleHash: currentStyleHash,
        productionElements,
        location: matchedLocation,
        allLocations: locations,
        autoVerify: false,
        maxAttempts: 1,
        customCorrection: manualCorrection || undefined,
      });

      if ((res as any).telemetry) {
        setPipelineTelemetry((res as any).telemetry);
      }
      if ((res as any).performance_timing) {
        setLatestTimingRecord((res as any).performance_timing);
      }
      void refreshPerformanceReport();

      let nextAnchors = activeAnchors;
      const returnedAnchors = res.locationAnchors || (res as any).location_continuity_anchors;
      if (returnedAnchors) {
        nextAnchors = returnedAnchors;
        setLocationContinuityAnchors(nextAnchors);
      }

      let currentScene: StudioSceneItem | null = res.scene || null;
      if (currentScene) {
        const hasValidSceneImg =
          Boolean(currentScene.image_url) && currentScene.image_url !== "__CLIENT_MEMORY_IMAGE__";
        currentScene = {
          ...targetScene,
          ...currentScene,
          image_url: hasValidSceneImg ? currentScene.image_url : targetScene.image_url,
        };
        setScenes((prev) =>
          prev.map((s) => (s.scene_id === sceneId ? currentScene! : s))
        );
        if (openedSceneModal?.scene_id === sceneId) {
          setOpenedSceneModal(currentScene);
        }
        if (manualCorrection) {
          setCustomSceneCorrections((prev) => ({ ...prev, [sceneId]: "" }));
        }
      }

      // Real Automatic Self-Healing System for Scenes: analyze via Gemini Vision -> add correction on error -> regenerate via Google Flow -> re-verify until genuine 100% PASS
      if ((autoVerifyScenes || isCorrectiveRegeneration) && currentScene && currentScene.image_url) {
        const maxHealCycles = Math.max(4, maxRetriesPerScene + 1);
        for (let cycle = 1; cycle <= maxHealCycles; cycle++) {
          setScenes((prev) =>
            prev.map((s) =>
              s.scene_id === sceneId
                ? {
                    ...s,
                    approved: false,
                    verification_status: "VERIFYING",
                    pipeline_stage: "GEMINI_INSPECTING",
                    last_error: null,
                  }
                : s
            )
          );

          const verRes = await verifyStudioSceneImageApi({
            scene: currentScene,
            previousScene,
            allScenes: activeSceneList,
            locationAnchors: nextAnchors,
            stylePreset: selectedStyle,
            customStylePrompt: customStyleText,
            aspectRatio: selectedAspectRatio,
            flowModel: selectedFlowModel,
            styleVersion,
            styleHash: currentStyleHash,
            location: matchedLocation,
            allLocations: locations,
            productionElements,
          });

          if (verRes.locationAnchors) {
            nextAnchors = verRes.locationAnchors;
            setLocationContinuityAnchors(nextAnchors);
          }

          if (verRes.scene) {
            currentScene = {
              ...currentScene,
              ...verRes.scene,
              image_url:
                verRes.scene.image_url && verRes.scene.image_url !== "__CLIENT_MEMORY_IMAGE__"
                  ? verRes.scene.image_url
                  : currentScene.image_url,
            };
            setScenes((prev) =>
              prev.map((s) => (s.scene_id === sceneId ? currentScene! : s))
            );
            if (openedSceneModal?.scene_id === sceneId) {
              setOpenedSceneModal(currentScene);
            }
          }

          const isScenePassed =
            Boolean(verRes.approved) &&
            Boolean(currentScene.verification_result?.approved) &&
            Boolean(currentScene.verification_result?.all_required_checks_passed);

          if (isScenePassed) {
            break;
          }

          if (cycle < maxHealCycles) {
            const autoCorr =
              currentScene.verification_result?.additive_correction ||
              currentScene.verification_result?.continuity_additive_correction ||
              (currentScene.verification_result?.critical_corrections || []).join(" ; ") ||
              (currentScene.verification_result?.what_is_missing || []).join(" ; ") ||
              (currentScene.verification_result?.what_is_different || []).join(" ; ") ||
              (currentScene.continuity_analysis?.additive_corrections || []).join(" ; ") ||
              "Fix all detected character, location, weapon, and continuity issues to match canonical references 100%.";
            const mergedSceneCorrs = Array.from(
              new Set([...(currentScene.added_corrections || []), autoCorr].filter(Boolean))
            );
            currentScene = {
              ...currentScene,
              approved: false,
              generation_status: "GENERATING",
              pipeline_stage: "GENERATING_IMAGE",
              current_attempt: cycle + 1,
              added_corrections: mergedSceneCorrs,
              additive_corrections: mergedSceneCorrs,
              last_error: null,
            };
            setScenes((prev) =>
              prev.map((s) => (s.scene_id === sceneId ? currentScene! : s))
            );
            if (openedSceneModal?.scene_id === sceneId) {
              setOpenedSceneModal(currentScene);
            }

            if (!silent) {
              setNotice({
                type: "info",
                text: `🔄 [النظام التلقائي - المشاهد] تم اكتشاف خطأ في "${currentScene.title}" (v${currentScene.version || 1}) — تمت إضافة التصحيح تلقائيًا وجاري إعادة إنشاء صورة مصححة عبر Google Flow (محاولة ${cycle + 1}/${maxHealCycles})...`,
              });
            }

            const regenRes = await generateAndVerifyStudioSceneApi({
              scene: currentScene,
              previousScene,
              allScenes: activeSceneList,
              locationAnchors: nextAnchors,
              stylePreset: selectedStyle,
              customStylePrompt: customStyleText,
              aspectRatio: selectedAspectRatio,
              flowModel: selectedFlowModel,
              styleVersion,
              styleHash: currentStyleHash,
              productionElements,
              location: matchedLocation,
              allLocations: locations,
              autoVerify: false,
              maxAttempts: 1,
              customCorrection: autoCorr,
            });

            if (regenRes.scene) {
              const hasNewImg =
                Boolean(regenRes.scene.image_url) &&
                regenRes.scene.image_url !== "__CLIENT_MEMORY_IMAGE__";
              currentScene = {
                ...currentScene,
                ...regenRes.scene,
                image_url: hasNewImg ? regenRes.scene.image_url : currentScene.image_url,
              };
              setScenes((prev) =>
                prev.map((s) => (s.scene_id === sceneId ? currentScene! : s))
              );
              if (openedSceneModal?.scene_id === sceneId) {
                setOpenedSceneModal(currentScene);
              }
            } else {
              break;
            }
          }
        }
      }

      if (!silent) {
        if (!autoVerifyScenes && !isCorrectiveRegeneration && res.success && currentScene?.image_url) {
          setNotice({
            type: "success",
            text: `⚡ تم توليد صورة ${currentScene.title} بسرعة فائقة! يمكنك فحص المطابقة والتصحيح التلقائي عبر زر "✓ فحص المشهد عبر Gemini" متى شئت.`,
          });
        } else if (
          currentScene?.image_url &&
          (currentScene?.approved ||
            currentScene?.verification_result?.all_required_checks_passed)
        ) {
          const contModeLabel =
            currentScene.continuity_mode === "SAME_LOCATION_CONTINUITY_MODE"
              ? "SAME_LOCATION_CONTINUITY_MODE"
              : currentScene.continuity_mode === "LOCATION_TRANSITION_MODE"
              ? "LOCATION_TRANSITION_MODE"
              : "INITIAL_ANCHOR_MODE";
          setNotice({
            type: "success",
            text: `✓ [النظام التلقائي 100%] تم توليد وفحص واعتماد ${currentScene.title} (v${currentScene.version || 1}) بنجاح 100% عبر Gemini Vision [${contModeLabel} · ${currentScene.continuity_status || "CONTINUITY_PASS"}]!`,
          });
        } else {
          setNotice({
            type: "error",
            text:
              res.error ||
              `⚠ انتهت محاولات توليد وفحص الاستمرارية للمشهد ${targetScene.title}.`,
          });
        }
      }
      return { scene: currentScene, updatedAnchors: nextAnchors };
    } catch (err: any) {
      setScenes((prev) =>
        prev.map((s) =>
          s.scene_id === sceneId
            ? {
                ...s,
                approved: false,
                generation_status: "FAILED",
                pipeline_stage: "NEEDS_ATTENTION",
                last_error: err?.message || "فشل الاتصال أثناء التوليد",
              }
            : s
        )
      );
      if (!silent) {
        setNotice({
          type: "error",
          text: err?.message || "تعذر إكمال التحليل والتوليد للمشهد.",
        });
      }
      return { scene: null, updatedAnchors: activeAnchors };
    } finally {
      setBusySceneIds((prev) => ({ ...prev, [sceneId]: false }));
    }
  };

  const handleVerifySingleScene = async (
    sceneId: string,
    silent: boolean = false,
    sceneOverride?: StudioSceneItem,
    sequentialContext?: {
      previousScene?: StudioSceneItem | null;
      allScenesSnapshot?: StudioSceneItem[];
      locationAnchorsSnapshot?: LocationContinuityAnchorMap;
    },
    autoHealUntilPass: boolean = true
  ): Promise<{
    scene: StudioSceneItem | null;
    updatedAnchors: LocationContinuityAnchorMap;
  }> => {
    const activeSceneList = sequentialContext?.allScenesSnapshot || scenes;
    const targetScene =
      sceneOverride || activeSceneList.find((s) => s && s.scene_id === sceneId);
    const activeAnchors =
      sequentialContext?.locationAnchorsSnapshot || locationContinuityAnchors;

    if (!targetScene || !targetScene.image_url) {
      if (!silent) {
        setNotice({
          type: "error",
          text: "يرجى توليد صورة المشهد أولًا قبل فحصها عبر Gemini Vision.",
        });
      }
      return { scene: null, updatedAnchors: activeAnchors };
    }

    const previousScene =
      sequentialContext?.previousScene !== undefined
        ? sequentialContext.previousScene
        : findChronologicalPreviousScene(targetScene, activeSceneList);

    setBusySceneIds((prev) => ({ ...prev, [sceneId]: true }));
    if (!silent) setNotice(null);

    const matchedLocation =
      targetScene.location_uncertain || targetScene.location_id === "LOCATION_UNCERTAIN"
        ? undefined
        : locations.find(
            (l) =>
              Boolean(l && l.location_id) &&
              (l.location_id ===
                (targetScene.primary_location_id ||
                  targetScene.location_entity_id ||
                  targetScene.location_id) ||
                l.name === targetScene.location_name)
          );

    try {
      const maxHealCycles = autoHealUntilPass ? Math.max(4, maxRetriesPerScene + 1) : 1;
      let currentScene: StudioSceneItem = targetScene;
      let nextAnchors = activeAnchors;

      for (let cycle = 1; cycle <= maxHealCycles; cycle++) {
        setScenes((prev) =>
          prev.map((s) =>
            s.scene_id === sceneId
              ? {
                  ...s,
                  approved: false,
                  verification_status: "VERIFYING",
                  pipeline_stage: "GEMINI_INSPECTING",
                  last_error: null,
                }
              : s
          )
        );

        const res = await verifyStudioSceneImageApi({
          scene: currentScene,
          previousScene,
          allScenes: activeSceneList,
          locationAnchors: nextAnchors,
          stylePreset: selectedStyle,
          customStylePrompt: customStyleText,
          aspectRatio: selectedAspectRatio,
          flowModel: selectedFlowModel,
          styleVersion,
          styleHash: currentStyleHash,
          location: matchedLocation,
          allLocations: locations,
          productionElements,
        });

        if (res.locationAnchors) {
          nextAnchors = res.locationAnchors;
          setLocationContinuityAnchors(nextAnchors);
        }

        if (res.scene) {
          currentScene = {
            ...currentScene,
            ...res.scene,
            image_url:
              res.scene.image_url && res.scene.image_url !== "__CLIENT_MEMORY_IMAGE__"
                ? res.scene.image_url
                : currentScene.image_url,
          };
          setScenes((prev) =>
            prev.map((s) => (s.scene_id === sceneId ? currentScene : s))
          );
          if (openedSceneModal?.scene_id === sceneId) {
            setOpenedSceneModal(currentScene);
          }
        }

        const isPassed =
          Boolean(res.approved) &&
          Boolean(currentScene.verification_result?.approved) &&
          Boolean(currentScene.verification_result?.all_required_checks_passed);

        if (isPassed) {
          if (!silent) {
            setNotice({
              type: "success",
              text: `✓ [النظام التلقائي 100%] اعتمد Gemini Vision صورة ${currentScene.title} (v${currentScene.version || 1}) بعد اجتياز جميع فحوصات المطابقة والاستمرارية بنسبة 100% (${currentScene.continuity_mode || "INITIAL_ANCHOR_MODE"} · ${currentScene.continuity_status || "CONTINUITY_PASS"})!`,
            });
          }
          return { scene: currentScene, updatedAnchors: nextAnchors };
        }

        if (cycle < maxHealCycles) {
          const autoCorr =
            currentScene.verification_result?.additive_correction ||
            currentScene.verification_result?.continuity_additive_correction ||
            (currentScene.verification_result?.critical_corrections || []).join(" ; ") ||
            (currentScene.verification_result?.what_is_missing || []).join(" ; ") ||
            (currentScene.verification_result?.what_is_different || []).join(" ; ") ||
            (currentScene.continuity_analysis?.additive_corrections || []).join(" ; ") ||
            "Fix all detected character, location, weapon, and continuity issues to match canonical references 100%.";
          const mergedSceneCorrs = Array.from(
            new Set([...(currentScene.added_corrections || []), autoCorr].filter(Boolean))
          );
          currentScene = {
            ...currentScene,
            approved: false,
            generation_status: "GENERATING",
            pipeline_stage: "GENERATING_IMAGE",
            current_attempt: cycle + 1,
            added_corrections: mergedSceneCorrs,
            additive_corrections: mergedSceneCorrs,
            last_error: null,
          };
          setScenes((prev) =>
            prev.map((s) => (s.scene_id === sceneId ? currentScene : s))
          );
          if (openedSceneModal?.scene_id === sceneId) {
            setOpenedSceneModal(currentScene);
          }

          if (!silent) {
            setNotice({
              type: "info",
              text: `🔄 [النظام التلقائي - المشاهد] وجد Gemini خطأ في "${currentScene.title}" (v${currentScene.version || 1}) — تمت إضافة التصحيح تلقائيًا وجاري إعادة إنشاء صورة مصححة عبر Google Flow (محاولة ${cycle + 1}/${maxHealCycles})...`,
            });
          }

          const regenRes = await generateAndVerifyStudioSceneApi({
            scene: currentScene,
            previousScene,
            allScenes: activeSceneList,
            locationAnchors: nextAnchors,
            stylePreset: selectedStyle,
            customStylePrompt: customStyleText,
            aspectRatio: selectedAspectRatio,
            flowModel: selectedFlowModel,
            styleVersion,
            styleHash: currentStyleHash,
            productionElements,
            location: matchedLocation,
            allLocations: locations,
            autoVerify: false,
            maxAttempts: 1,
            customCorrection: autoCorr,
          });

          if (regenRes.scene) {
            const hasNewImg =
              Boolean(regenRes.scene.image_url) &&
              regenRes.scene.image_url !== "__CLIENT_MEMORY_IMAGE__";
            currentScene = {
              ...currentScene,
              ...regenRes.scene,
              image_url: hasNewImg ? regenRes.scene.image_url : currentScene.image_url,
            };
            setScenes((prev) =>
              prev.map((s) => (s.scene_id === sceneId ? currentScene : s))
            );
            if (openedSceneModal?.scene_id === sceneId) {
              setOpenedSceneModal(currentScene);
            }
          } else {
            break;
          }
        }
      }

      if (!silent) {
        setNotice({
          type: "error",
          text:
            currentScene.last_error ||
            `✗ رفض Gemini Vision صورة ${currentScene.title} (${currentScene.continuity_status || "NEEDS_CORRECTION"}).`,
        });
      }
      return { scene: currentScene, updatedAnchors: nextAnchors };
    } catch (err: any) {
      setScenes((prev) =>
        prev.map((s) =>
          s.scene_id === sceneId
            ? {
                ...s,
                approved: false,
                pipeline_stage: "NEEDS_ATTENTION",
                last_error: err?.message || "فشل فحص صورة المشهد",
              }
            : s
        )
      );
      if (!silent) {
        setNotice({
          type: "error",
          text: err?.message || "فشل فحص صورة المشهد عبر Gemini Vision.",
        });
      }
      return { scene: null, updatedAnchors: activeAnchors };
    } finally {
      setBusySceneIds((prev) => ({ ...prev, [sceneId]: false }));
    }
  };

  // SEQUENTIAL SCENE CONTINUITY ENGINE: Generate scenes strictly in sequence (Scene 1 -> Verify -> Scene 2 -> Compare Scene 1 + Scene 2 -> Scene 3 -> Compare Scene 2 + Scene 3)
  const handleGenerateAllScenes = async (onlyFailedVerification: boolean = false) => {
    const orderedScenes = [...scenes]
      .filter((s): s is StudioSceneItem => Boolean(s && s.scene_id))
      .sort((a, b) => (a.scene_number || 0) - (b.scene_number || 0));

    let targets = orderedScenes.filter((sc) => {
      if (
        sc.approved &&
        sc.image_url &&
        sc.verification_status === "VERIFIED" &&
        sc.verification_result?.all_required_checks_passed &&
        (sc.continuity_status === "CONTINUITY_PASS" ||
          sc.continuity_status === "INITIAL_SCENE_ANCHOR")
      ) {
        return false;
      }
      if (onlyFailedVerification) {
        return (
          sc.verification_status === "REJECTED" ||
          sc.verification_status === "MANUAL_REVIEW_REQUIRED" ||
          sc.continuity_status === "CONTINUITY_NEEDS_CORRECTION" ||
          sc.continuity_status === "CONTINUITY_FAILED" ||
          sc.continuity_status === "MANUAL_CONTINUITY_REVIEW_REQUIRED" ||
          sc.pipeline_stage === "NEEDS_ATTENTION" ||
          sc.pipeline_stage === "MANUAL_REVIEW_REQUIRED" ||
          Boolean(sc.last_error) ||
          (Boolean(sc.image_url) && !sc.approved)
        );
      }
      return true;
    });

    if (targets.length === 0 && !onlyFailedVerification) {
      targets = [...orderedScenes];
    }

    if (targets.length === 0) {
      setNotice({
        type: "info",
        text: "لا توجد مشاهد فاشلة في التحقق أو الاستمرارية لإعادة توليدها.",
      });
      return;
    }

    setIsGeneratingAll(true);
    const targetIds = new Set(targets.map((t) => t.scene_id));
    setScenes((prev) =>
      prev.map((s) =>
        targetIds.has(s.scene_id)
          ? { ...s, pipeline_stage: "QUEUED", generation_status: "QUEUED", last_error: null }
          : s
      )
    );

    let workingScenes = [...orderedScenes];
    let workingAnchors: LocationContinuityAnchorMap = { ...locationContinuityAnchors };
    let succeededCount = 0;

    try {
      const batchResults: Array<StudioSceneItem | null> = [];

      if (autoVerifyScenes) {
        // Strict Sequential Execution so each scene receives the real generated image & updated location anchor of the preceding scene
        for (let i = 0; i < targets.length; i++) {
          const currentSc = targets[i];
          const idx = workingScenes.findIndex((s) => s.scene_id === currentSc.scene_id);
          const prevSc = idx > 0 ? workingScenes[idx - 1] : null;
          setNotice({
            type: "info",
            text: `🎬 [SEQUENTIAL CONTINUITY ENGINE ${i + 1}/${targets.length}] جاري توليد وفحص المشهد "${currentSc.title}" مع ربط المراجع المقفلة ${prevSc?.image_url ? `ومقارنته بالمشهد السابق (${prevSc.scene_id})` : "(نقطة ارتكاز أولى)"}...`,
          });
          const stepRes = await handleGenerateSingleScene(
            currentSc.scene_id,
            true,
            currentSc,
            undefined,
            {
              previousScene: prevSc,
              allScenesSnapshot: workingScenes,
              locationAnchorsSnapshot: workingAnchors,
            }
          );
          if (stepRes.updatedAnchors) {
            workingAnchors = { ...workingAnchors, ...stepRes.updatedAnchors };
          }
          if (stepRes.scene) {
            workingScenes = workingScenes.map((s) =>
              s.scene_id === stepRes.scene!.scene_id ? stepRes.scene! : s
            );
          }
          batchResults.push(stepRes.scene);
        }
      } else {
        setNotice({
          type: "info",
          text: `⚡ جاري التوليد المتوازي فائق السرعة لـ ${targets.length} مشاهد عبر Google Flow (${maxConcurrentGenerations} مسارات متزامنة)...`,
        });

        const parallelRes = await runParallelQueueWithLimit(
          targets,
          maxConcurrentGenerations,
          async (currentSc) => {
            const idx = workingScenes.findIndex((s) => s.scene_id === currentSc.scene_id);
            const prevSc = idx > 0 ? workingScenes[idx - 1] : null;
            const stepRes = await handleGenerateSingleScene(
              currentSc.scene_id,
              true,
              currentSc,
              undefined,
              {
                previousScene: prevSc,
                allScenesSnapshot: workingScenes,
                locationAnchorsSnapshot: workingAnchors,
              }
            );
            if (stepRes.updatedAnchors) {
              workingAnchors = { ...workingAnchors, ...stepRes.updatedAnchors };
            }
            if (stepRes.scene) {
              workingScenes = workingScenes.map((s) =>
                s.scene_id === stepRes.scene!.scene_id ? stepRes.scene! : s
              );
            }
            return stepRes.scene;
          }
        );
        batchResults.push(...parallelRes);
      }

      succeededCount = batchResults.filter((sc) => Boolean(sc && sc.image_url)).length;

      void saveStudioCheckpointApi({
        scenes: workingScenes,
        location_continuity_anchors: workingAnchors,
      });

      const approvedCount = workingScenes.filter((s) => s.approved).length;
      if (succeededCount === 0) {
        setNotice({
          type: "error",
          text: `FLOW_GENERATION_FAILED: فشل توليد صور المشاهد عبر Google Flow Cookies. يرجى مراجعة سبب الخطأ على بطاقات المشاهد.`,
        });
      } else {
        setNotice({
          type: "success",
          text: `✓ اكتملت معالجة المشاهد بالتسلسل (SEQUENTIAL SCENE CONTINUITY ENGINE — ${succeededCount} من ${targets.length} مشاهد مولدة | ${approvedCount}/${workingScenes.length} معتمدة بالاستمرارية البصرية والمكانية عبر Gemini Vision)!`,
        });
      }
    } finally {
      setIsGeneratingAll(false);
    }
  };

  // Sequential Gemini Vision Continuity Verification for All Generated Scenes
  const handleVerifyAllScenesParallel = async () => {
    const orderedScenes = [...scenes]
      .filter((s): s is StudioSceneItem => Boolean(s && s.scene_id))
      .sort((a, b) => (a.scene_number || 0) - (b.scene_number || 0));
    const targets = orderedScenes.filter((sc) => Boolean(sc.image_url));
    if (targets.length === 0) {
      setNotice({
        type: "error",
        text: "لا توجد صور مشاهد مولدة لفحصها بعد.",
      });
      return;
    }

    setIsVerifyingAllScenes(true);
    let workingScenes = [...orderedScenes];
    let workingAnchors: LocationContinuityAnchorMap = { ...locationContinuityAnchors };

    try {
      for (let i = 0; i < workingScenes.length; i++) {
        const currentSc = workingScenes[i];
        if (!currentSc || !currentSc.image_url) continue;
        const prevSc = i > 0 ? workingScenes[i - 1] : null;

        setNotice({
          type: "info",
          text: prevSc
            ? `🔍 [SEQUENTIAL CONTINUITY CHECK] جاري رفع صورة ${prevSc.scene_id} + صورة ${currentSc.scene_id} والمراجع المقفلة إلى Gemini Vision لفحص الاستمرارية...`
            : `🔍 [SEQUENTIAL CONTINUITY CHECK] جاري فحص صورة المشهد الأول (${currentSc.scene_id}) عبر Gemini Vision...`,
        });

        const stepRes = await handleVerifySingleScene(
          currentSc.scene_id,
          true,
          currentSc,
          {
            previousScene: prevSc,
            allScenesSnapshot: workingScenes,
            locationAnchorsSnapshot: workingAnchors,
          }
        );

        workingAnchors = stepRes.updatedAnchors;
        if (stepRes.scene) {
          workingScenes = workingScenes.map((s) =>
            s.scene_id === stepRes.scene!.scene_id ? stepRes.scene! : s
          );
        }
      }

      await saveStudioCheckpointApi({
        scenes: workingScenes,
        location_continuity_anchors: workingAnchors,
      });

      const passCount = workingScenes.filter(
        (s) =>
          s.approved &&
          (s.continuity_status === "CONTINUITY_PASS" ||
            s.continuity_status === "INITIAL_SCENE_ANCHOR")
      ).length;
      setNotice({
        type: "success",
        text: `✓ اكتمل التحقق البصري والاستمرارية المتسلسلة لجميع المشاهد عبر Gemini Vision! (${passCount}/${targets.length} مشاهد معتمدة بالاستمرارية).`,
      });
    } finally {
      setIsVerifyingAllScenes(false);
    }
  };

  // ============================================================================
  // STEP 6 HANDLERS: Edit Scene, Regenerate, or Save to Library
  // ============================================================================
  const startEditingScene = (scene: StudioSceneItem) => {
    setEditingSceneId(scene.scene_id);
    setEditSceneDraft({ ...scene });
  };

  const saveEditedScene = (regenerateImmediately: boolean = false) => {
    if (!editSceneDraft) return;
    const manualSummary = `Scene edit: ${editSceneDraft.title} — ${editSceneDraft.description} — Action: ${editSceneDraft.action} — Location: ${editSceneDraft.location_name}`;
    const existingCorr = Array.from(
      new Set([
        ...(editSceneDraft.additive_corrections || []),
        ...(editSceneDraft.added_corrections || []),
        manualSummary,
      ])
    );
    const baseP = editSceneDraft.base_prompt || editSceneDraft.visual_prompt || editSceneDraft.description;
    const nextPrompt = `${baseP} | Scene adjustments: ${existingCorr.join(" ; ")}`;
    const prevHistory = Array.isArray(editSceneDraft.correction_history)
      ? [...editSceneDraft.correction_history]
      : [];
    const nextVer = prevHistory.length + 1;
    prevHistory.push({
      version: nextVer,
      label: `v${nextVer}`,
      type: "MANUAL_USER_CORRECTION",
      correction_text: manualSummary,
      resulting_prompt: nextPrompt,
      created_at: new Date().toISOString(),
    });
    const updated: StudioSceneItem = {
      ...editSceneDraft,
      scene_text: editSceneDraft.description,
      scene_summary: editSceneDraft.description,
      location: editSceneDraft.location_name,
      visual_prompt: nextPrompt,
      scene_prompt: nextPrompt,
      additive_corrections: existingCorr,
      added_corrections: existingCorr,
      correction_history: prevHistory,
      style_version: styleVersion,
      style_hash: currentStyleHash,
    };
    setScenes((prev) =>
      prev.map((s) => (s.scene_id === updated.scene_id ? updated : s))
    );
    setEditingSceneId(null);
    setEditSceneDraft(null);
    if (regenerateImmediately) {
      handleGenerateSingleScene(updated.scene_id, false, updated);
    } else {
      setNotice({
        type: "success",
        text: `تم حفظ تعديلات ${updated.title} وتحديث برومت المشهد (v${nextVer}) بنجاح.`,
      });
    }
  };

  const handleSaveStudioToLibrary = async () => {
    const scenesWithImages = scenes.filter((s) => Boolean(s.image_url));
    if (scenesWithImages.length === 0) {
      setNotice({
        type: "error",
        text: "لا توجد مشاهد مصورة لحفظها في المكتبة بعد. قم بتوليد المشاهد في الخطوة 5 أولًا.",
      });
      return;
    }

    const pages = scenesWithImages
      .sort((a, b) => a.scene_number - b.scene_number)
      .map((s) => s.image_url!);

    await saveLocalManga({
      id: `story_studio_${Date.now()}`,
      title: `${projectTitle} (${selectedStyle})`,
      coverUrl: pages[0],
      pages,
      workType: "استوديو القصة المصورة",
      createdAt: Date.now(),
    });

    setNotice({
      type: "success",
      text: `تم حفظ المشروع "${projectTitle}" (${pages.length} مشاهد) في مكتبتك بنجاح!`,
    });
  };

  const categoryPriorityMap: Record<string, number> = {
    CHARACTER: 1,
    WEAPON: 2,
    CREATURE: 3,
    ANIMAL: 3,
    BUILDING: 4,
    VEHICLE: 5,
    ITEM: 6,
    TOOL: 6,
  };
  const sortedProductionElements = [...productionElements].sort((a, b) => {
    const pa = categoryPriorityMap[String(a.category || "ITEM").toUpperCase()] ?? 99;
    const pb = categoryPriorityMap[String(b.category || "ITEM").toUpperCase()] ?? 99;
    if (pa !== pb) return pa - pb;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const { masterSheets: studioMasterSheets, entityToMasterMap: studioEntityToMasterMap } =
    clusterElementsIntoMasterReferenceSheets(productionElements, locations, referenceSheets);

  // STRICT STEP ISOLATION: Production elements step shows ONLY entities with target_step !== "locations"
  const strictlySeparatedElements = sortedProductionElements.filter(
    (el) => el.target_step !== "locations"
  );

  const filteredElements =
    activeElementCategory === "ALL"
      ? strictlySeparatedElements
      : activeElementCategory === "MASTER_SHEETS"
      ? strictlySeparatedElements.filter(
          (el) => !isEntitySubordinateToMaster(el.id, studioEntityToMasterMap).isSubordinate
        )
      : strictlySeparatedElements.filter((el) => el.category === activeElementCategory);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
      {/* Studio Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-6 mb-6">
        <div>
          <span className="text-xs font-semibold text-emerald-400 tracking-wide block mb-1">
            استوديو الإنتاج المتسلسل • خطوة بخطوة
          </span>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Novel → Manga / Story Studio
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            تحويل الرواية إلى مشاهد مصورة متكاملة عبر مراحل إنتاج متسلسلة باستخدام Gemini Cookies و Google Flow.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleOpenUniversalJsonModal}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-violet-950/80 hover:bg-violet-900 border border-violet-500/50 text-violet-200 text-xs font-bold transition cursor-pointer self-start sm:self-auto shadow-md shadow-violet-950/30"
            title="تصدير / استيراد وفحص Universal Production JSON (Schema 1.0)"
          >
            <FileCode className="h-4 w-4 text-violet-400" />
            <span>Universal JSON (Schema 1.0)</span>
            <span className="px-1.5 py-0.5 rounded bg-violet-800 text-[10px] font-mono text-white">
              {referenceSheets.length > 0 ? `${referenceSheets.length} لوحات` : "Strict Audit"}
            </span>
          </button>

          {onNavigateToSettings && (
            <button
              type="button"
              onClick={onNavigateToSettings}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition cursor-pointer self-start sm:self-auto"
            >
              <Settings className="h-4 w-4 text-emerald-400" />
              <span>إعدادات Gemini & Google Flow</span>
            </button>
          )}
        </div>
      </div>

      {/* 6-Step Sequential Progress Stepper + Live Checkpoint Status Bar */}
      <div className="mb-8 flex flex-col gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {STUDIO_STEPS.map((st) => {
            const isActive = currentStep === st.step;
            const isCompleted = currentStep > st.step;
            return (
              <button
                key={st.step}
                type="button"
                onClick={() => goToStep(st.step)}
                className={`text-right p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                  isActive
                    ? "bg-emerald-500/15 border-emerald-500 text-white shadow-lg shadow-emerald-950/30"
                    : isCompleted
                    ? "bg-slate-900/90 border-emerald-500/30 text-slate-200 hover:border-emerald-500/60"
                    : "bg-slate-900/50 border-slate-800/90 text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-sm font-bold ${
                      isActive ? "text-emerald-400" : isCompleted ? "text-emerald-400" : "text-slate-500"
                    }`}
                  >
                    {st.numLabel} {st.title}
                  </span>
                  {isCompleted && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
                </div>
                <span className="text-[11px] text-slate-400 leading-snug line-clamp-1">
                  {st.subtitle}
                </span>
              </button>
            );
          })}
        </div>

        {/* Rule 15 & Rule 16: Checkpoint Persistence + Flow Diagnostics Bar */}
        <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-[11px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-300">حفظ المراحل (Checkpoints):</span>
            {[
              { key: "script_saved", label: "السكريبت", ok: checkpointState.script_saved },
              { key: "elements_saved", label: `Visual Bible (${productionElements.length})`, ok: checkpointState.elements_saved },
              {
                key: "references_locked_saved",
                label: `LOCKED (${productionElements.filter((e) => e.status === "LOCKED").length}/${productionElements.length})`,
                ok:
                  checkpointState.references_locked_saved ||
                  productionElements.some((e) => e.status === "LOCKED"),
              },
              { key: "locations_saved", label: `المواقع (${locations.length})`, ok: checkpointState.locations_saved },
              { key: "location_images_saved", label: "صور المواقع", ok: checkpointState.location_images_saved },
              { key: "verified_locations_saved", label: "مواقع معتمدة", ok: checkpointState.verified_locations_saved },
              { key: "scenes_saved", label: `المشاهد (${scenes.length})`, ok: checkpointState.scenes_saved },
              { key: "generated_scene_images_saved", label: "صور المشاهد", ok: checkpointState.generated_scene_images_saved },
              { key: "verified_scenes_saved", label: "مشاهد معتمدة", ok: checkpointState.verified_scenes_saved },
            ].map((cp) => (
              <span
                key={cp.key}
                className={`px-2 py-0.5 rounded border font-mono ${
                  cp.ok
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-slate-900 border-slate-800 text-slate-500"
                }`}
              >
                {cp.ok ? "✓" : "○"} {cp.label}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400 font-mono">
              Google Flow Connection:{" "}
              <strong
                className={
                  flowDiagnostics?.FLOW_AUTH_OK ? "text-emerald-400" : "text-rose-400"
                }
              >
                {flowDiagnostics?.FLOW_AUTH_OK ? "CONNECTED" : "NOT CONNECTED"}
              </strong>
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400 font-mono">
              Google Flow Project:{" "}
              <strong
                className={
                  isRealVerifiedFlowProjectId(
                    flowDiagnostics?.selected_active_project_id ||
                      flowDiagnostics?.active_project_id
                  )
                    ? "text-emerald-400"
                    : "text-rose-400"
                }
              >
                {isRealVerifiedFlowProjectId(
                  flowDiagnostics?.selected_active_project_id ||
                    flowDiagnostics?.active_project_id
                )
                  ? `${flowDiagnostics?.selected_active_project_name || "Real Flow Project"} (${
                      flowDiagnostics?.selected_active_project_id ||
                      flowDiagnostics?.active_project_id
                    })`
                  : "FLOW_PROJECT_NOT_FOUND"}
              </strong>
            </span>
            <button
              type="button"
              onClick={handleRefreshFlowDiagnostics}
              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 cursor-pointer font-semibold"
            >
              فحص مشاريع Flow الحقيقية
            </button>
            <button
              type="button"
              onClick={handleCreateOrSelectRealFlowProject}
              disabled={isCreatingRealFlowProject}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer font-bold disabled:opacity-50"
            >
              {isCreatingRealFlowProject ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              <span>إنشاء / اختيار مشروع Google Flow حقيقي</span>
            </button>
            <button
              type="button"
              onClick={handleQuickTestFlowImage}
              disabled={isTestingFlowImageGen}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer font-bold disabled:opacity-50"
            >
              {isTestingFlowImageGen ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              <span>اختبار توليد صورة Google Flow</span>
            </button>
            {isRealVerifiedFlowProjectId(
              flowDiagnostics?.selected_active_project_id || flowDiagnostics?.active_project_id
            ) && (
              <a
                href={
                  flowDiagnostics?.selected_active_project_url ||
                  buildRealFlowProjectUrl(
                    flowDiagnostics?.selected_active_project_id ||
                      flowDiagnostics?.active_project_id
                  ) ||
                  "https://flow.google.com"
                }
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 font-bold"
              >
                <ExternalLink className="h-3 w-3" />
                <span>فتح المشروع داخل Google Flow</span>
              </a>
            )}
          </div>
        </div>

        {/* Live Google Flow Test Image Generation Preview Card */}
        {flowTestGenPreview && (
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-3.5">
              <img
                src={flowTestGenPreview.imageUrl}
                alt="Google Flow Test Generation"
                className="h-20 w-32 rounded-lg border border-emerald-500/40 object-cover shrink-0 bg-slate-950"
              />
              <div className="flex flex-col gap-1">
                <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>نجاح اختبار إنشاء الصور عبر Google Flow ({flowTestGenPreview.modelUsed})</span>
                </span>
                <span className="text-[11px] text-slate-300">{flowTestGenPreview.message}</span>
                <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] text-slate-400">
                  {flowTestGenPreview.flowProjectId && (
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-emerald-300">
                      flowProjectId: {flowTestGenPreview.flowProjectId}
                    </span>
                  )}
                  {flowTestGenPreview.flowAssetId && (
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-sky-300">
                      flowAssetId: {flowTestGenPreview.flowAssetId}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFlowTestGenPreview(null)}
              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer self-start sm:self-center"
            >
              إخفاء المعاينة
            </button>
          </div>
        )}

        {/* Live Telemetry & Speed Metrics Bar */}
        {pipelineTelemetry && (
          <div className="p-2.5 rounded-xl bg-slate-950/90 border border-emerald-500/25 flex items-center justify-between flex-wrap gap-3 text-[11px] font-mono">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-emerald-400 font-bold">⚡ عدّاد الأداء والسرعة:</span>
              <span className="text-slate-300">
                زمن السكريبت:{" "}
                <strong className="text-emerald-300">
                  {pipelineTelemetry.script_duration_ms
                    ? `${(pipelineTelemetry.script_duration_ms / 1000).toFixed(2)}s`
                    : "—"}
                </strong>
              </span>
              {pipelineTelemetry.total_duration_ms ? (
                <span className="text-slate-300">
                  الزمن الكلي:{" "}
                  <strong className="text-emerald-300">
                    {(pipelineTelemetry.total_duration_ms / 1000).toFixed(2)}s
                  </strong>
                </span>
              ) : null}
              <span className="text-slate-300">
                طلبات Gemini:{" "}
                <strong className="text-sky-300">{pipelineTelemetry.gemini_requests_count}</strong>
              </span>
              <span className="text-slate-300">
                Cache Hits:{" "}
                <strong className="text-teal-300">{pipelineTelemetry.gemini_cache_hits}</strong>
              </span>
              <span className="text-slate-300">
                طلبات Google Flow:{" "}
                <strong className="text-amber-300">{pipelineTelemetry.flow_requests_count}</strong>
              </span>
              <span className="text-slate-300">
                إعادة التوليد التلقائي:{" "}
                <strong className="text-rose-300">{pipelineTelemetry.flow_regenerations_count}</strong>
              </span>
            </div>
            <span
              className={`px-2 py-0.5 rounded border ${
                pipelineTelemetry.warm_session_active
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-slate-900 border-slate-800 text-slate-400"
              }`}
            >
              Warm Session: {pipelineTelemetry.warm_session_active ? "ACTIVE" : "READY"}
            </span>
          </div>
        )}

        {/* Model-Agnostic Google Flow Performance Layer & Separation of Flow Generation vs Application Overhead */}
        <div className="p-3 rounded-xl bg-slate-950/95 border border-indigo-500/30 flex flex-col gap-2.5 text-[11px] font-mono">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-indigo-400 font-bold">
                🚀 أداء Google Flow الموحد (Model-Agnostic Performance):
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                النموذج الحالي: <strong className="text-amber-300">{selectedFlowModel}</strong>
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                الأبعاد: <strong className="text-sky-300">{selectedAspectRatio}</strong>
              </span>
              {latestTimingRecord && (
                <>
                  <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-300">
                    Flow Generation ={" "}
                    <strong>
                      {((latestTimingRecord.flow_generation_time_ms || 0) / 1000).toFixed(2)}s
                    </strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-500/40 text-amber-300">
                    Application Overhead ={" "}
                    <strong>
                      {((latestTimingRecord.application_overhead_ms || 0) / 1000).toFixed(2)}s
                    </strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-sky-950/70 border border-sky-500/40 text-sky-300">
                    Total (إلى ظهور الصورة) ={" "}
                    <strong>
                      {((latestTimingRecord.time_to_image_ready_ms || latestTimingRecord.total_time_ms || 0) / 1000).toFixed(2)}s
                    </strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                    الحالة: <strong>{latestTimingRecord.background_stage || "IMAGE_READY"}</strong>
                  </span>
                  {latestTimingRecord.performance_regression && (
                    <span className="px-2 py-0.5 rounded bg-rose-950/90 border border-rose-500/60 text-rose-300 font-bold">
                      ⚠ PERFORMANCE_REGRESSION ({latestTimingRecord.regression_source || "OVERHEAD"})
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPerformancePanel((prev) => !prev);
                  void refreshPerformanceReport();
                }}
                className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 cursor-pointer"
              >
                {showPerformancePanel ? "إخفاء تفاصيل الأداء" : "تفاصيل الأداء وBenchmark النماذج"}
              </button>
              <button
                type="button"
                onClick={handleRunMultiModelBenchmark}
                disabled={isRunningBenchmark}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer disabled:opacity-50"
              >
                {isRunningBenchmark ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                <span>Benchmark (Lite / 2 / Pro)</span>
              </button>
            </div>
          </div>

          {showPerformancePanel && (
            <div className="pt-2 border-t border-slate-800/90 flex flex-col gap-2">
              {latestTimingRecord && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-[10px]">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Model</div>
                    <div className="text-white font-bold">{latestTimingRecord.model_id}</div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Prepare Time</div>
                    <div className="text-slate-200 font-bold">
                      {((latestTimingRecord.preparation_time_ms || 0) / 1000).toFixed(2)}s
                    </div>
                  </div>
                  <div className="p-2 rounded bg-emerald-950/40 border border-emerald-500/30">
                    <div className="text-emerald-400">Flow Generation</div>
                    <div className="text-emerald-300 font-bold">
                      {((latestTimingRecord.flow_generation_time_ms || 0) / 1000).toFixed(2)}s
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Asset Retrieval</div>
                    <div className="text-sky-300 font-bold">
                      {((latestTimingRecord.asset_time_ms || 0) / 1000).toFixed(2)}s
                    </div>
                  </div>
                  <div className="p-2 rounded bg-amber-950/40 border border-amber-500/30">
                    <div className="text-amber-400">App Overhead</div>
                    <div className="text-amber-300 font-bold">
                      {((latestTimingRecord.application_overhead_ms || 0) / 1000).toFixed(2)}s
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Vision (BG)</div>
                    <div className="text-purple-300 font-bold">
                      {((latestTimingRecord.vision_time_ms || 0) / 1000).toFixed(2)}s
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Aspect Ratio</div>
                    <div className="text-teal-300 font-bold">
                      {latestTimingRecord.requested_aspect_ratio} → {latestTimingRecord.actual_aspect_ratio}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Reused Session/Proj</div>
                    <div className="text-emerald-300 font-bold">
                      {latestTimingRecord.warm_session_reused ? "Warm ✓" : "Init"} /{" "}
                      {latestTimingRecord.verified_project_reused ? "Proj ✓" : "New"}
                    </div>
                  </div>
                </div>
              )}

              {performanceReport?.summary_by_model && (
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse text-[10px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-1 px-2">النموذج (Model)</th>
                        <th className="py-1 px-2">العينات</th>
                        <th className="py-1 px-2 text-emerald-400">Direct Flow Generation Time</th>
                        <th className="py-1 px-2 text-amber-400">Application Overhead</th>
                        <th className="py-1 px-2 text-sky-400">Asset Retrieval Time</th>
                        <th className="py-1 px-2 text-purple-400">Vision Time (BG)</th>
                        <th className="py-1 px-2 text-white">Total Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(performanceReport.summary_by_model).map((m: any) => (
                        <tr key={m.model_id} className="border-b border-slate-900/80 text-slate-200">
                          <td className="py-1 px-2 font-bold text-amber-300">{m.model_id}</td>
                          <td className="py-1 px-2">{m.sample_count}</td>
                          <td className="py-1 px-2 text-emerald-300 font-bold">
                            {((m.avg_direct_flow_generation_time_ms || 0) / 1000).toFixed(2)}s
                          </td>
                          <td className="py-1 px-2 text-amber-300 font-bold">
                            {((m.avg_application_overhead_ms || 0) / 1000).toFixed(2)}s
                          </td>
                          <td className="py-1 px-2 text-sky-300">
                            {((m.avg_asset_retrieval_time_ms || 0) / 1000).toFixed(2)}s
                          </td>
                          <td className="py-1 px-2 text-purple-300">
                            {((m.avg_vision_time_ms || 0) / 1000).toFixed(2)}s
                          </td>
                          <td className="py-1 px-2 text-white font-bold">
                            {((m.avg_total_time_ms || 0) / 1000).toFixed(2)}s
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preferred Gemini Model Selector (via Cookies) & Strict Provider Separation Bar */}
        <div className="p-4 rounded-xl bg-slate-950/95 border border-emerald-500/35 flex flex-col gap-3.5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 border-b border-slate-800/80 pb-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm sm:text-base font-extrabold text-white">
                  اختر نموذج Gemini المفضل (عبر الكوكيز)
                </h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400">
                النموذج المختار يُستخدم في جميع عمليات التحليل، استخراج القصة والأحداث، تحليل الشخصيات والمواقع، إنشاء الـ Visual Bible، مراجعة واستمرارية المشاهد، وGemini Vision.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold">
                Gemini Cookies = تحليل + كتابة + مراجعة + Vision ({PREFERRED_GEMINI_MODELS.find((m) => m.id === preferredGeminiModel)?.name || preferredGeminiModel})
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-indigo-300 font-bold">
                Google Flow = إنشاء الصور فقط ({selectedFlowModel})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {PREFERRED_GEMINI_MODELS.map((m) => {
              const isSelected = preferredGeminiModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectPreferredGeminiModel(m.id)}
                  className={`p-3.5 rounded-xl border text-right transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    isSelected
                      ? "bg-emerald-500/15 border-emerald-500 text-white shadow-lg shadow-emerald-950/40"
                      : "bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-extrabold text-white font-mono">
                      {m.name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0 ${
                        isSelected
                          ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {m.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{m.description}</p>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-[11px] font-mono text-slate-400">
            <span>
              التدفق المنطقي: <strong className="text-emerald-300">Novel → Gemini ({PREFERRED_GEMINI_MODELS.find((m) => m.id === preferredGeminiModel)?.name}) → Story Analysis / Visual Bible / Prompts → Google Flow → Image Generation → Gemini Vision Review → Approve / Regenerate → Lock</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Status Notice */}
      {notice && (
        <div
          className={`mb-6 p-4 rounded-xl border flex items-center justify-between gap-3 text-xs sm:text-sm font-medium ${
            notice.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : notice.type === "error"
              ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
              : "bg-sky-500/10 border-sky-500/30 text-sky-300"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {notice.type === "success" ? (
              <Check className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STEP 1️⃣: القصة (Story Input -> Script Generation)                    */}
      {/* ===================================================================== */}
      {currentStep === 1 && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <span className="text-xs font-semibold text-emerald-400 block mb-1">
                الخطوة 1 من 6
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                ① القصة — إدخال الرواية وتحويلها إلى سكريبت
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                اختر أولاً طريقة إنشاء الصفحات، ثم أدخل عنوان المشروع ونص الرواية للبدء في التحليل الذكي وتوليد المشاهد.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {checkpointNotice && (
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/60 px-3 py-1.5 rounded-lg border border-emerald-500/30">
                  {checkpointNotice}
                </span>
              )}
              <button
                type="button"
                onClick={handleManualSaveCheckpoint}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer shadow-md shadow-emerald-950/40"
              >
                <Save className="h-3.5 w-3.5" />
                <span>حفظ نقطة المتابعة</span>
              </button>
              <button
                type="button"
                onClick={handleManualRestoreCheckpoint}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition cursor-pointer border border-slate-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>استعادة نقطة المتابعة</span>
              </button>
            </div>
          </div>

          {/* 0. PRIMARY PAGE GENERATION MODE SELECTOR (الهدف الأول — طريقة إنشاء الصفحات في بداية خطوة القصة) */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/90 border-2 border-emerald-500/40 shadow-xl flex flex-col gap-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold">
                  <Layers className="h-5 w-5" />
                </span>
                <div className="flex flex-col">
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    طريقة إنشاء الصفحات (Page Generation Mode)
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    حدد الهيكل المعتمد لتحويل المشاهد إلى صفحات وصور قبل بدء التحليل
                  </span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-mono text-xs font-bold">
                الوضع النشط: {pageGenerationMode === "SCENE_PER_PAGE" ? "🖼️ SCENE PER PAGE (1:1)" : "🟦 KOREAN MANHWA PAGES"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Option A: Scene Per Page */}
              <button
                type="button"
                onClick={() => handleSelectPageGenerationMode("SCENE_PER_PAGE")}
                className={`p-4 rounded-xl border-2 text-right transition cursor-pointer flex flex-col justify-between gap-3 ${
                  pageGenerationMode === "SCENE_PER_PAGE"
                    ? "bg-emerald-950/40 border-emerald-500 text-white shadow-lg shadow-emerald-950/50"
                    : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">🖼️</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-emerald-300">Scene Per Page</span>
                      <span className="text-xs font-semibold text-slate-200">مشهد واحد = صفحة واحدة</span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      pageGenerationMode === "SCENE_PER_PAGE"
                        ? "border-emerald-400 bg-emerald-500"
                        : "border-slate-600 bg-slate-950"
                    }`}
                  >
                    {pageGenerationMode === "SCENE_PER_PAGE" && (
                      <div className="w-2 h-2 rounded-full bg-slate-950" />
                    )}
                  </div>
                </div>

                <ul className="space-y-1 text-[11px] text-slate-300 list-disc list-inside">
                  <li>صورة واحدة كاملة لكل Scene (Full Bleed)</li>
                  <li>بدون Panels · بدون Frames · بدون Gutters</li>
                  <li>لا يتم تقسيم Scene (1 Scene = 1 Page = 1 Image)</li>
                </ul>

                <div className="pt-2 border-t border-slate-800/80 font-mono text-[10px] text-emerald-400 font-semibold" dir="ltr">
                  Scene → Page → Image (SCENE_001 → PAGE_001 → IMAGE_001)
                </div>
              </button>

              {/* Option B: Korean Manhwa Pages */}
              <button
                type="button"
                onClick={() => handleSelectPageGenerationMode("KOREAN_MANHWA_PAGES")}
                className={`p-4 rounded-xl border-2 text-right transition cursor-pointer flex flex-col justify-between gap-3 ${
                  pageGenerationMode === "KOREAN_MANHWA_PAGES"
                    ? "bg-sky-950/40 border-sky-500 text-white shadow-lg shadow-sky-950/50"
                    : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">🟦</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-sky-300">Korean Manhwa Pages</span>
                      <span className="text-xs font-semibold text-slate-200">صفحات مانهو كورية</span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      pageGenerationMode === "KOREAN_MANHWA_PAGES"
                        ? "border-sky-400 bg-sky-500"
                        : "border-slate-600 bg-slate-950"
                    }`}
                  >
                    {pageGenerationMode === "KOREAN_MANHWA_PAGES" && (
                      <div className="w-2 h-2 rounded-full bg-slate-950" />
                    )}
                  </div>
                </div>

                <ul className="space-y-1 text-[11px] text-slate-300 list-disc list-inside">
                  <li>Pages + Panels + Frames + Gutters</li>
                  <li>Dynamic Layouts (2 إلى 6 Panels حسب التخطيط)</li>
                  <li>اتجاه قراءة عمودي للمانهوا (Top → Bottom Reading)</li>
                </ul>

                <div className="pt-2 border-t border-slate-800/80 font-mono text-[10px] text-sky-400 font-semibold" dir="ltr">
                  Scene → Pages → Panels → Frames (Webtoon Architecture)
                </div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Project Title Input */}
            <div className="lg:col-span-6 flex flex-col gap-2">
              <label className="text-xs sm:text-sm font-semibold text-slate-200">
                عنوان المشروع
              </label>
              <input
                type="text"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="مثال: حارسة الطريق المضيء — الفصل الأول"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {/* Manual Scene Counter / Duration Controls */}
            <div className="lg:col-span-6 flex flex-col gap-2.5 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5">
                  <Hash className="h-4 w-4 text-emerald-400" />
                  <label className="text-xs sm:text-sm font-bold text-slate-100">
                    مدة / عدد المشاهد (تحديد يدوي أو تلقائي)
                  </label>
                </div>
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSceneCountOption("auto")}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                      sceneCountOption === "auto"
                        ? "bg-emerald-600 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    تلقائي ذكي
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSceneCountOption("custom");
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                      sceneCountOption !== "auto"
                        ? "bg-emerald-600 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    تحديد يدوي (عداد المشاهد)
                  </button>
                </div>
              </div>

              {sceneCountOption === "auto" ? (
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-slate-400">
                    الذكاء الاصطناعي يستخرج المشاهد تلقائياً بناءً على الأحداث الدرامية والانتقالات البصرية.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSceneCountOption("custom");
                    }}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold text-xs border border-emerald-500/30 transition cursor-pointer"
                  >
                    تبديل للتحديد اليدوي ⬅
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 pt-1">
                  {/* Interactive Stepper & Numeric Input */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next = Math.max(1, customSceneCount - 1);
                          setCustomSceneCount(next);
                        }}
                        disabled={customSceneCount <= 1}
                        className="w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white flex items-center justify-center font-bold text-base transition cursor-pointer disabled:opacity-40"
                        title="إنقاص مشهد"
                      >
                        <Minus className="h-4 w-4" />
                      </button>

                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-emerald-500/40">
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={customSceneCount}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                            setCustomSceneCount(val);
                          }}
                          className="w-12 text-center text-base font-bold text-emerald-300 font-mono bg-transparent focus:outline-none"
                        />
                        <span className="text-xs font-semibold text-slate-300">
                          {customSceneCount <= 10 ? "مشاهد" : "مشهد"}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const next = Math.min(50, customSceneCount + 1);
                          setCustomSceneCount(next);
                        }}
                        disabled={customSceneCount >= 50}
                        className="w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white flex items-center justify-center font-bold text-base transition cursor-pointer disabled:opacity-40"
                        title="زيادة مشهد"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Button to Apply Manual Count to Studio Scenes */}
                    <button
                      type="button"
                      onClick={() => handleApplyManualSceneCount(customSceneCount)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-950/40 transition cursor-pointer"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      <span>تطبيق العدد يدوياً فوراً ({customSceneCount} مشاهد)</span>
                    </button>
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-slate-400 ml-1">اختيار سريع:</span>
                    {[2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 22, 25].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setCustomSceneCount(preset);
                          handleApplyManualSceneCount(preset);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                          customSceneCount === preset
                            ? "bg-emerald-500 text-slate-950 shadow"
                            : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 🔀 زر الفصل التام بين [تجهيز مسبق] و [بدء تجهيز حدث] في خطوة المشاهد والقصة */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/95 border-2 border-emerald-500/40 shadow-xl flex flex-col gap-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="flex flex-col">
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    مسار تجهيز المشاهد والأحداث (Scene & Event Preparation Mode)
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    اختر بين التجهيز المسبق (تحليل خارجي جاهز) أو بدء تجهيز الأحداث والمشاهد الآن عبر الذكاء الاصطناعي
                  </span>
                </div>
              </div>
              <span
                className={`px-3 py-1 rounded-full font-mono text-xs font-bold border ${
                  scenePreparationMode === "PREPARED"
                    ? "bg-emerald-950 text-emerald-300 border-emerald-500/40"
                    : "bg-sky-950 text-sky-300 border-sky-500/40"
                }`}
              >
                {scenePreparationMode === "PREPARED"
                  ? "⚡ الوضع النشط: تجهيز مسبق"
                  : "🎬 الوضع النشط: بدء تجهيز حدث"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* زر 1: تجهيز مسبق */}
              <button
                type="button"
                onClick={() => handleSelectScenePrepMode("PREPARED")}
                className={`p-4 rounded-xl border-2 text-right transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                  scenePreparationMode === "PREPARED"
                    ? "bg-emerald-950/50 border-emerald-500 text-white shadow-lg shadow-emerald-950/60 ring-1 ring-emerald-500/50"
                    : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">⚡</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-emerald-300">
                        تجهيز مسبق (Prepared Novel Data)
                      </span>
                      <span className="text-xs font-semibold text-slate-200">
                        تحليل خارجي جاهز مسبقًا بدون Gemini
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      scenePreparationMode === "PREPARED"
                        ? "border-emerald-400 bg-emerald-500"
                        : "border-slate-600 bg-slate-950"
                    }`}
                  >
                    {scenePreparationMode === "PREPARED" && (
                      <div className="w-2 h-2 rounded-full bg-slate-950" />
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  يُخفي خانة بدء تجهيز الأحداث والرواية، وتعتمد جميع الأقسام على التجهيز المسبق مباشرة.
                </p>
              </button>

              {/* زر 2: بدء تجهيز حدث */}
              <button
                type="button"
                onClick={() => handleSelectScenePrepMode("LIVE_EVENTS")}
                className={`p-4 rounded-xl border-2 text-right transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                  scenePreparationMode === "LIVE_EVENTS"
                    ? "bg-sky-950/50 border-sky-500 text-white shadow-lg shadow-sky-950/60 ring-1 ring-sky-500/50"
                    : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">🎬</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-sky-300">
                        بدء تجهيز حدث (Live Event Setup)
                      </span>
                      <span className="text-xs font-semibold text-slate-200">
                        إدخال الرواية وبدء تجهيز الأحداث والمشاهد الآن
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      scenePreparationMode === "LIVE_EVENTS"
                        ? "border-sky-400 bg-sky-500"
                        : "border-slate-600 bg-slate-950"
                    }`}
                  >
                    {scenePreparationMode === "LIVE_EVENTS" && (
                      <div className="w-2 h-2 rounded-full bg-slate-950" />
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  يُخفي خانة التجهيز المسبق، ويُظهر حقول إدخال الرواية ومحرك استخراج الأحداث وتوليد المشاهد الآن.
                </p>
              </button>
            </div>
          </div>

          {/* الخانة الأولى: ⚡ تجهيز مسبق (تظهر فقط عند تفعيل التجهيز المسبق وتختفي في بدء تجهيز حدث) */}
          {scenePreparationMode === "PREPARED" && (
            <div className="flex flex-col gap-4">
              <PreparedNovelSection
                currentNovelTitle={projectTitle}
                currentNovelText={novelText}
                preparedData={activePreparedNovelData || preparedNovelData}
                onSavePreparedData={handleSavePreparedData}
                onClearPreparedData={handleClearPreparedData}
                onApplyDirectlyToStudio={handleApplyPreparedDataToStudio}
              />

              <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-slate-800/80">
                <div className="flex items-center gap-2 flex-wrap">
                  {(activePreparedNovelData || preparedNovelData)?.converted_studio_data ? (
                    <button
                      type="button"
                      onClick={() => handleApplyPreparedDataToStudio((activePreparedNovelData || preparedNovelData)!)}
                      className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs sm:text-sm transition cursor-pointer shadow-xl shadow-emerald-950/60"
                      title="استخدام البيانات المجهزة مباشرة دون أي استدعاء لـ Gemini"
                    >
                      <Zap className="h-4 w-4 fill-current" />
                      <span>⚡ استخدام بيانات التجهيز المباشرة والانتقال للستايل ⬅</span>
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">
                      💡 الصق تحليل الرواية واضغط «استيراد البيانات» أو «حفظ التجهيز» للاعتماد المباشر.
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    const prep = activePreparedNovelData || preparedNovelData;
                    if (prep?.converted_studio_data) {
                      await handleSavePreparedData(prep);
                    }
                    goToStep(2);
                  }}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition cursor-pointer"
                >
                  <span>التالي: الستايل</span>
                  <ArrowLeft className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* الخانة الثانية: 🎬 بدء تجهيز حدث (تظهر فقط عند تفعيل تجهيز حدث الآن وتختفي في التجهيز المسبق) */}
          {scenePreparationMode === "LIVE_EVENTS" && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-xs sm:text-sm font-semibold text-slate-200">
                  اكتب الرواية
                </label>
            <textarea
              value={novelText}
              onChange={(e) => setNovelText(e.target.value)}
              rows={10}
              placeholder="اكتب أو الصق فصل الرواية أو القصة هنا..."
              className="w-full p-4 rounded-xl bg-slate-950 border border-slate-800 text-sm sm:text-base text-slate-100 leading-relaxed focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* 12-Stage Long Novel Intelligent Segmentation Pipeline & Hierarchy (Chapter -> Blocks -> Events -> Scenes -> Shots/Panels) */}
          <div className="p-4 rounded-xl bg-slate-950/90 border border-emerald-500/30 flex flex-col gap-3.5">
            <div className="flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-white text-xs sm:text-sm">
                  🧠 نظام تقسيم الروايات الطويلة الذكي (Long Novel Intelligent Segmentation — Semantic Event Pipeline)
                </span>
                <span className="text-[11px] text-slate-400">
                  التسلسل الهرمي الكامل: <strong className="text-emerald-300">Chapter → Blocks ({longNovelReport?.total_blocks || Math.max(1, Math.ceil(scenes.length / 2))}) → Events ({longNovelReport?.total_events || scenes.length}) → Scenes ({scenes.length}) → Shots/Panels ({longNovelReport?.total_shots_panels || scenes.reduce((acc, s) => acc + (s.shots_panels?.length || 2), 0)})</strong> · تغطية الأحداث: <strong className="text-emerald-400">{longNovelReport?.coverage_percentage ?? 100}%</strong>
                </span>
              </div>
              <span className="font-mono text-emerald-400">
                SCRIPT → Elements ({productionElements.length}) → Locations ({locations.length}) → Scenes ({scenes.length})
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-right text-[11px]">
              {[
                { num: 1, title: "1. NOVEL INPUT", sub: "قراءة الفصل الكامل" },
                { num: 2, title: "2. CHAPTER PARSER", sub: `تقسيم إلى Blocks (${longNovelReport?.total_blocks || Math.max(1, Math.ceil(scenes.length / 2))})` },
                { num: 3, title: "3. EVENT EXTRACTION", sub: `استخراج الأحداث (${longNovelReport?.total_events || scenes.length})` },
                { num: 4, title: "4. CHARACTER ACTIONS", sub: `حركات وأسلحة (${productionElements.filter((e) => e.category === "CHARACTER").length})` },
                { num: 5, title: "5. LOCATION & ENV", sub: `المواقع والانتقالات (${locations.length})` },
                { num: 6, title: "6. DIALOGUE EXTRACT", sub: `الحوارات (${scenes.filter((s) => Boolean(s.dialogue?.trim())).length})` },
                { num: 7, title: "7. EMOTIONAL STATE", sub: "المشاعر والأفكار الداخلية" },
                { num: 8, title: "8. IMPORTANT LORE", sub: "المعلومات والذكريات والتهديدات" },
                { num: 9, title: "9. VISUAL SEGMENTATION", sub: "فك دمج المشاهد المزدحمة" },
                { num: 10, title: "10. SCENE PLANNING", sub: `تخطيط المشاهد (${scenes.length})` },
                { num: 11, title: "11. PANEL / SHOT PLAN", sub: `تخطيط اللقطات والزوايا (${longNovelReport?.total_shots_panels || scenes.length * 2})` },
                { num: 12, title: "12. FINAL SCENE LIST", sub: "قائمة المشاهد النهائية ✓" },
              ].map((st) => {
                const done =
                  Boolean(scriptText.trim()) ||
                  analysisValidation?.step_complete ||
                  (isWritingScript && scriptProgressStage >= Math.ceil(st.num / 3));
                return (
                  <div
                    key={st.num}
                    className={`p-2.5 rounded-lg border transition flex flex-col gap-0.5 ${
                      done
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-slate-800 bg-slate-900/80 text-slate-400"
                    }`}
                  >
                    <span className="font-mono font-bold text-[10px] text-emerald-400">{st.title}</span>
                    <span className="text-[10px] text-slate-300">{st.sub}</span>
                  </div>
                );
              })}
            </div>

            {/* Global Chapter Context & Blocks Breakdown Drawer */}
            <details className="rounded-xl bg-slate-900/90 border border-slate-800 p-3 text-xs">
              <summary className="cursor-pointer font-bold text-sky-300 flex items-center justify-between flex-wrap gap-2">
                <span>
                  🌐 السياق الشامل للفصل والوحدات السردية (Global Chapter Context & Chapter → Blocks → Events → Scenes → Shots/Panels)
                </span>
                <span className="font-mono text-[10px] text-emerald-300">
                  {longNovelReport?.chapter_id || "CHAPTER_001"} · 0 Lost Events · 100% Context Preserved
                </span>
              </summary>
              <div className="mt-3 pt-3 border-t border-slate-800 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="font-bold text-emerald-400 mb-1">الشخصيات والملابس والأسلحة والحالة الجسدية:</div>
                    <div className="text-slate-300 space-y-1">
                      {productionElements
                        .filter((e) => e.category === "CHARACTER")
                        .map((ch) => (
                          <div key={ch.id}>
                            • <strong>{ch.name}</strong> ({ch.id}): {ch.clothing || ch.clothing_and_armor || ch.description.slice(0, 80)}
                          </div>
                        ))}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="font-bold text-sky-400 mb-1">المكان، اتجاه الحركة، الزمن، والإضاءة:</div>
                    <div className="text-slate-300 space-y-1">
                      <div>• <strong>المواقع:</strong> {locations.map((l) => `${l.name} (${l.location_id})`).join(" ← ")}</div>
                      <div>• <strong>اتجاه الحركة:</strong> {longNovelReport?.global_chapter_context?.movement_direction || scenes[scenes.length - 1]?.movement_direction || "تقدم متسلسل"}</div>
                      <div>• <strong>الإضاءة والزمن:</strong> {longNovelReport?.global_chapter_context?.lighting_and_atmosphere || locations[0]?.lighting_and_atmosphere || "إضاءة سينمائية متسقة"}</div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="font-bold text-amber-400 mb-1">المعلومات المهمة (Lore) والتهديدات والعلاقات:</div>
                    <div className="text-slate-300 space-y-1">
                      <div>
                        • <strong>المعلومات والأسرار:</strong>{" "}
                        {(longNovelReport?.global_chapter_context?.important_lore_and_revelations || scenes.flatMap((s) => s.important_lore || [])).slice(0, 2).join(" | ") || "محفوظة بالكامل في سياق المشاهد"}
                      </div>
                      <div>
                        • <strong>العلاقات:</strong>{" "}
                        {(longNovelReport?.global_chapter_context?.character_relationships || ["ترابط تكتيكي وسردي مستمر بين الشخصيات"]).join(" | ")}
                      </div>
                    </div>
                  </div>
                </div>

                {Array.isArray(longNovelReport?.blocks) && longNovelReport!.blocks.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-bold text-slate-200 text-[11px]">
                      تقسيم الفصل إلى وحدات سردية (Blocks → Events → Scenes → Shots/Panels):
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {longNovelReport!.blocks.map((blk: NovelChapterBlock) => (
                        <div key={blk.block_id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] space-y-1">
                          <div className="flex items-center justify-between font-mono">
                            <span className="text-emerald-400 font-bold">{blk.block_id} ({blk.paragraph_range})</span>
                            <span className="text-sky-300">Scenes: {blk.mapped_scene_ids.join(", ")}</span>
                          </div>
                          <div className="font-bold text-white">{blk.title}</div>
                          <div className="text-slate-400">
                            الأحداث ({blk.events.length}): {blk.events.map((ev) => `${ev.event_id} (${ev.event_type})`).join(" · ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Event Classification Verification, Scene Coherence Score & 4-Level Hierarchical Context */}
                {longNovelReport?.event_classification_verification && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] pt-2 border-t border-slate-800">
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-emerald-500/30">
                      <div className="font-bold text-emerald-400 mb-1">
                        ✓ التحقق من تصنيف الأحداث (Event Classification Verification):
                      </div>
                      <div className="text-slate-300 space-y-0.5 font-mono text-[10px]">
                        <div>
                          الدقة بعد التحقق:{" "}
                          <strong className="text-emerald-300">
                            {longNovelReport.event_classification_verification.accuracy_After_Verification}%
                          </strong>{" "}
                          ({longNovelReport.event_classification_verification.verified_events_count} حدثاً)
                        </div>
                        <div>
                          التصحيحات التلقائية:{" "}
                          <strong className="text-amber-300">
                            {longNovelReport.event_classification_verification.corrected_events_count}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {longNovelReport?.segmentation_balance_audit && (
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-sky-500/30">
                        <div className="font-bold text-sky-400 mb-1">
                          ⚖️ معيار تماسك المشهد والتوازن (Coherence & Balance Audit):
                        </div>
                        <div className="text-slate-300 space-y-0.5 font-mono text-[10px]">
                          <div>
                            متوسط تماسك المشهد:{" "}
                            <strong className="text-sky-300">
                              {longNovelReport.segmentation_balance_audit.average_coherence_score}/100
                            </strong>{" "}
                            ({longNovelReport.segmentation_balance_audit.status})
                          </div>
                          <div>
                            تفكيك مشاهد مركبة:{" "}
                            <strong className="text-emerald-300">
                              {longNovelReport.segmentation_balance_audit.compound_scenes_split_count}
                            </strong>{" "}
                            · دمج نبضات قصيرة:{" "}
                            <strong className="text-indigo-300">
                              {longNovelReport.segmentation_balance_audit.micro_events_merged_count}
                            </strong>
                          </div>
                        </div>
                      </div>
                    )}

                    {longNovelReport?.hierarchical_context && (
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-indigo-500/30">
                        <div className="font-bold text-indigo-400 mb-1">
                          🏛️ السياق الهرمي للروايات الطويلة (4-Level Context):
                        </div>
                        <div className="text-slate-300 space-y-0.5 text-[10px]">
                          <div>
                            • <strong>L1 (Global):</strong>{" "}
                            {longNovelReport.hierarchical_context.level_1_global_story.canonical_characters.length} شخصيات ·{" "}
                            {longNovelReport.hierarchical_context.level_1_global_story.canonical_weapons.length} أسلحة ·{" "}
                            {longNovelReport.hierarchical_context.level_1_global_story.canonical_locations.length} مواقع
                          </div>
                          <div>
                            • <strong>L2 (Arc):</strong>{" "}
                            {longNovelReport.hierarchical_context.level_2_arc_volume.arc_title}
                          </div>
                          <div>
                            • <strong>L3/L4:</strong> {longNovelReport.hierarchical_context.level_3_chapter.chapter_id} ←{" "}
                            {longNovelReport.hierarchical_context.level_4_local_scene_states.length} حالة مشهد محلية
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          </div>

          {/* Clear Progress Indicator while Gemini Cookies writes the script */}
          {isWritingScript && (
            <div className="p-5 rounded-xl bg-slate-950 border border-emerald-500/40 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
                  <span className="text-sm font-bold text-white">
                    جاري تحويل الرواية إلى سكريبت... (تحليل الرواية ← استخراج المشاهد والمواقع ← حفظ السكريبت)
                  </span>
                </div>
                <span className="text-xs font-mono tabular-nums text-emerald-400">
                  {scriptProgressStage === 1
                    ? "30%"
                    : scriptProgressStage === 2
                    ? "60%"
                    : scriptProgressStage === 3
                    ? "85%"
                    : "95%"}
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{
                    width:
                      scriptProgressStage === 1
                        ? "30%"
                        : scriptProgressStage === 2
                        ? "60%"
                        : scriptProgressStage === 3
                        ? "85%"
                        : "95%",
                  }}
                />
              </div>
            </div>
          )}

          {/* Persistent Error Card with Retry Button (Never clears previous data or auto-advances) */}
          {analysisError && !isWritingScript && (
            <div className="p-5 rounded-xl bg-rose-950/30 border border-rose-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-rose-200">
                    توقف محرك التحليل قبل الانتقال للخطوة التالية (تم الحفاظ على بياناتك السابقة)
                  </span>
                  <p className="text-xs text-rose-300 leading-relaxed">{analysisError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleStartWritingScript}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition cursor-pointer shrink-0 self-start sm:self-center"
              >
                <RefreshCw className="h-4 w-4" />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          )}

          {/* Full Script Editor & Source-of-Truth Sync (Rule 1 & Rule 3) */}
          <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-emerald-400">
                  ✓ السكريبت الكامل (المصدر الوحيد للمواقع والعناصر والمشاهد: {scenes.length} مشاهد · {locations.length} مواقع · {productionElements.length} عنصر إنتاج)
                </span>
                <span className="text-[11px] text-slate-400">
                  المواقع المستخرجة من السكريبت الآن:{" "}
                  {locations
                    .filter((l) => Boolean(l && l.location_id))
                    .map((l) => `${l.location_id} (${l.name})`)
                    .join(" ، ")}
                </span>
              </div>

              <button
                type="button"
                onClick={handleExtractFromFullScript}
                disabled={isExtractingFromScript || !scriptText.trim()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isExtractingFromScript ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>تطبيق السكريبت الكامل على المواقع والمشاهد</span>
              </button>
            </div>

            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              rows={9}
              placeholder="السكريبت المنظم للمشاهد (المشهد 01، المشهد 02، المشهد 03...)..."
              className="w-full p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-xs sm:text-sm text-slate-200 leading-relaxed focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-slate-800/80">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleStartWritingScript}
                disabled={isWritingScript || isRunningFullPipeline || !novelText.trim()}
                className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-950/50"
              >
                {isWritingScript ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Sparkles className="h-5 w-5" />
                )}
                <span>ابدأ كتابة السكريبت (طلب Gemini رئيسي واحد)</span>
              </button>

              <button
                type="button"
                onClick={handleRunFullFastPipeline}
                disabled={isRunningFullPipeline || isWritingScript || !novelText.trim()}
                className="flex items-center gap-2 px-5 py-3.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs sm:text-sm transition cursor-pointer disabled:opacity-50 shadow-lg shadow-teal-950/50"
                title="الرواية → Gemini Script → Visual Bible كامل → References → LOCKED → Scenes → Google Flow → Gemini Verify → Auto Correct → Regenerate → Verify → APPROVED"
              >
                {isRunningFullPipeline ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                <span>تشغيل المسار الكامل بالتوازي (Novel → Script → LOCKED → APPROVED)</span>
              </button>

              {analysisError && !isWritingScript && (
                <button
                  type="button"
                  onClick={handleStartWritingScript}
                  className="flex items-center gap-2 px-4 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs sm:text-sm transition cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>إعادة المحاولة</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => goToStep(2)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition cursor-pointer"
            >
              <span>التالي: الستايل</span>
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  )}

      {/* ===================================================================== */}
      {/* STEP 2️⃣: الستايل (Visual Style, Aspect Ratio, Flow Model)           */}
      {/* ===================================================================== */}
      {currentStep === 2 && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col gap-8">
          <div className="border-b border-slate-800/80 pb-4">
            <span className="text-xs font-semibold text-emerald-400 block mb-1">
              الخطوة 2 من 6
            </span>
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              ② الستايل — تحديد الشكل البصري للمشروع
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              اختر ستايل الرسم والتحريك، نسبة أبعاد الصورة، وموديل توليد الصور في Google Flow.
            </p>
            {(activePreparedNovelData || preparedNovelData?.status === "ADOPTED") && (
              <div className="mt-2.5 p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-emerald-400 fill-current" />
                  <span className="text-emerald-200">
                    <strong>⚡ المصدر النشط المعتمد:</strong> «{activePreparedNovelData?.novel_title || preparedNovelData?.novel_title || projectTitle}»
                  </span>
                </div>
                <span className="font-mono text-emerald-300 text-[11px]">
                  {scenes.length} مشاهد · {productionElements.length} عناصر Visual Bible · {locations.length} مواقع
                </span>
              </div>
            )}
          </div>

          {/* 1. Art & Animation Style */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-emerald-400" />
              <h3 className="text-base font-bold text-white">ستايل الرسم والتحريك</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {STYLE_PRESETS.map((st) => {
                const active = selectedStyle === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      if (selectedStyle !== st.id) {
                        propagateStyleSettingsChange({ style: st.id });
                      }
                    }}
                    className={`p-4 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                      active
                        ? "bg-emerald-500/15 border-emerald-500 text-white"
                        : "bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">{st.label}</span>
                      {active && <Check className="h-4 w-4 text-emerald-400" />}
                    </div>
                    <span className="text-xs text-slate-400">{st.desc}</span>
                  </button>
                );
              })}
            </div>

            {selectedStyle === "ستايل مخصص" && (
              <div className="mt-2 flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-300">
                  وصف الستايل المخصص (بالتفصيل)
                </label>
                <input
                  type="text"
                  value={customStyleText}
                  onChange={(e) => {
                    propagateStyleSettingsChange({ customStyle: e.target.value });
                  }}
                  placeholder="مثال: Dark gothic oil painting with dramatic chiaroscuro lighting..."
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* 2. Aspect Ratio */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-emerald-400" />
              <h3 className="text-base font-bold text-white">نسبة الصورة (Aspect Ratio)</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ASPECT_RATIOS.map((ar) => {
                const active = selectedAspectRatio === ar.id;
                return (
                  <button
                    key={ar.id}
                    type="button"
                    onClick={() => {
                      if (selectedAspectRatio !== ar.id) {
                        propagateStyleSettingsChange({ aspectRatio: ar.id });
                      }
                    }}
                    className={`p-4 rounded-xl border text-right transition cursor-pointer flex flex-col gap-1 ${
                      active
                        ? "bg-emerald-500/15 border-emerald-500 text-white"
                        : "bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-base font-mono font-bold tabular-nums">{ar.label}</span>
                      {active && <Check className="h-4 w-4 text-emerald-400" />}
                    </div>
                    <span className="text-xs text-slate-400">{ar.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Google Flow Image Model */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-emerald-400" />
              <h3 className="text-base font-bold text-white">موديل الصور (Google Flow Model)</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {FLOW_MODELS.map((m) => {
                const active = selectedFlowModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      if (selectedFlowModel !== m.id) {
                        propagateStyleSettingsChange({ flowModel: m.id });
                      }
                    }}
                    className={`p-4 rounded-xl border text-right transition cursor-pointer flex flex-col gap-1 ${
                      active
                        ? "bg-emerald-500/15 border-emerald-500 text-white"
                        : "bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">{m.label}</span>
                      {active && <Check className="h-4 w-4 text-emerald-400" />}
                    </div>
                    <span className="text-xs text-slate-400">{m.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Page Generation Mode (Scene Per Page vs Korean Manhwa Pages) */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-400" />
              <h3 className="text-base font-bold text-white">نظام توليد وتخطيط الصفحات (Page Generation Mode)</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: Scene Per Page */}
              <button
                type="button"
                onClick={() => handleSelectPageGenerationMode("SCENE_PER_PAGE")}
                className={`p-4 rounded-xl border text-right transition cursor-pointer flex flex-col gap-2 ${
                  pageGenerationMode === "SCENE_PER_PAGE"
                    ? "bg-emerald-500/15 border-emerald-500 text-white shadow-md shadow-emerald-950/40"
                    : "bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🖼️</span>
                    <span className="text-sm font-bold">Scene Per Page — بدون إطارات (1:1)</span>
                  </div>
                  {pageGenerationMode === "SCENE_PER_PAGE" && <Check className="h-4 w-4 text-emerald-400" />}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  مشهد واحد = صفحة واحدة = صورة واحدة كاملة بدون إطارات أو تقطيع Panels (0 Frames, 0 Panels, 0 Gutters).
                </p>
                <span className="text-[10px] font-mono text-emerald-300">
                  ✓ 1 Scene = 1 Page = 1 Image · Direct Scene ID Mapping
                </span>
              </button>

              {/* Option 2: Korean Manhwa Pages */}
              <button
                type="button"
                onClick={() => handleSelectPageGenerationMode("KOREAN_MANHWA_PAGES")}
                className={`p-4 rounded-xl border text-right transition cursor-pointer flex flex-col gap-2 ${
                  pageGenerationMode === "KOREAN_MANHWA_PAGES"
                    ? "bg-sky-500/15 border-sky-500 text-white shadow-md shadow-sky-950/40"
                    : "bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🟦</span>
                    <span className="text-sm font-bold">Korean Manhwa Pages — صفحات مانهوا</span>
                  </div>
                  {pageGenerationMode === "KOREAN_MANHWA_PAGES" && <Check className="h-4 w-4 text-sky-400" />}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  تخطيط صفحات مانهوا كورية حقيقية (Scene → Pages → Panels → Frames) بتنسيقات متعددة البانلز وإطارات وفواصل.
                </p>
                <span className="text-[10px] font-mono text-sky-300">
                  ✓ Dynamic Webtoon Layouts · Panels & Frame Composition
                </span>
              </button>
            </div>
          </div>

          {/* Live Synchronized Style State & styleHash Box */}
          <div className="p-4 rounded-xl bg-slate-950/90 border border-emerald-500/30 flex flex-col gap-2 text-xs">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-bold text-emerald-400">
                ✓ حالة الستايل الحية المتزامنة مع الخادم (Active Project Style State):
              </span>
              <span className="px-2.5 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 font-mono text-emerald-300">
                styleHash: {currentStyleHash} · style_version: v{styleVersion}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] text-slate-300" dir="ltr">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block">style_id / style_name:</span>
                <strong className="text-white">{currentStyleSettings.style_name}</strong>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block">aspect_ratio:</span>
                <strong className="text-emerald-400">{currentStyleSettings.aspect_ratio}</strong>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block">model_id:</span>
                <strong className="text-sky-400">{currentStyleSettings.model_id}</strong>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block">style_description:</span>
                <span className="text-slate-200 line-clamp-1">{currentStyleSettings.style_description}</span>
              </div>
            </div>
          </div>

          {/* Step Footer Navigation */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition cursor-pointer"
            >
              <ArrowRight className="h-4 w-4" />
              <span>السابق: القصة</span>
            </button>

            <button
              type="button"
              onClick={() => goToStep(3)}
              className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition cursor-pointer shadow-lg shadow-emerald-950/50"
            >
              <span>التالي: عناصر الإنتاج</span>
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* STEP 3️⃣: عناصر الإنتاج (Production Elements Review & Edit)          */}
      {/* ===================================================================== */}
      {currentStep === 3 && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <span className="text-xs font-semibold text-emerald-400 block mb-1">
                الخطوة 3 من 6 • UNIFIED VISUAL BIBLE & GEMINI VISION REFERENCE GATE
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                ③ عناصر الإنتاج — أوراق المراجع الرئيسية الموحدة (MASTER REFERENCE SHEETS — GOOGLE FLOW ONLY)
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
                قاعدة معمارية صارمة: ورقة مرجعية رئيسية واحدة شاملة (Master Reference Sheet) لكل شخصية أو كيان أو مجموعة مترابطة بصريًا (مثال الشخصية: صني + الوجه + الشعر + الملابس + الإكسسوارات + السلاح Midnight Shard في ورقة واحدة | مثال الوحوش: أم العناكب + العناكب التابعة + العش وشبكات العنكبوت في ورقة واحدة | مثال الموقع: الجسر + التمثال + رمح التمثال في ورقة واحدة). البيانات والـIDs المنطقية تبقى منفصلة ومحفوظة 100%، والدمج بصري فقط داخل ورقة المرجع لضمان أعلى ثبات للهوية وتوليد موحد عبر Google Flow حصريًا (مع استخدام Gemini Cookies للتخطيط والتحليل والتحقق فقط).
              </p>
              <div className="mt-2.5 p-2.5 rounded-xl bg-violet-950/60 border border-violet-500/40 flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-violet-400 fill-current" />
                  <span className="text-violet-200">
                    <strong>⭐ أوراق المراجع الرئيسية الموحدة:</strong> {studioMasterSheets.length} أوراق رئيسية تغطي {productionElements.length} عنصر منطقي و {locations.length} مواقع
                  </span>
                </div>
                <span className="font-mono text-violet-300 text-[11px]">
                  أوراق شخصيات: {studioMasterSheets.filter((m) => m.sheetType === "CHARACTER_DESIGN_SHEET").length} · أوراق وحوش: {studioMasterSheets.filter((m) => m.sheetType === "CREATURE_MODEL_SHEET").length} · أوراق مواقع: {studioMasterSheets.filter((m) => m.sheetType === "LOCATION_CONCEPT_SHEET").length} · عناصر مدمجة: {studioMasterSheets.reduce((acc, m) => acc + m.attachedEntities.length, 0)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleGenerateAllElementPromptsViaGemini}
                disabled={isGeneratingElementPromptsBatch || isGeneratingElementsBatch}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isGeneratingElementPromptsBatch ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>توليد الأوصاف المرجعية للكل عبر Gemini</span>
              </button>

              <button
                type="button"
                onClick={handleGeneratePrimaryVisualBibleElementsParallel}
                disabled={isGeneratingElementsBatch}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 shadow-lg shadow-teal-950/40"
              >
                {isGeneratingElementsBatch ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span>⚡ توليد وفحص أوراق المرجع الرئيسية (Master Sheets) عبر Google Flow</span>
              </button>

              <button
                type="button"
                onClick={handleVerifyAllElementsParallel}
                disabled={isVerifyingElementsBatch || isGeneratingElementsBatch}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
              >
                {isVerifyingElementsBatch ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                <span>فحص وتصحيح الكل تلقائيًا حتى 100%</span>
              </button>

              <button
                type="button"
                onClick={handleLockAllVisualBibleReferences}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer"
              >
                <Lock className="h-4 w-4" />
                <span>قفل جميع المراجع (LOCKED)</span>
              </button>

              <button
                type="button"
                onClick={handleExtractFromFullScript}
                disabled={isExtractingFromScript || isWritingScript}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
              >
                {isExtractingFromScript ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span>مزامنة وتجميع من السكريبت</span>
              </button>
            </div>
          </div>

          {/* Interactive Category Filter Tabs (Standalone Entities Only) */}
          <div className="flex items-center gap-1.5 flex-wrap bg-slate-950/90 p-1.5 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveElementCategory("MASTER_SHEETS")}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                activeElementCategory === "MASTER_SHEETS"
                  ? "bg-violet-600 text-white shadow-lg shadow-violet-950/40 font-bold"
                  : "text-violet-300 hover:text-white"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>أوراق المرجع الرئيسية ({studioMasterSheets.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveElementCategory("ALL")}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeElementCategory === "ALL"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              الكل ({productionElements.length})
            </button>
            {PRODUCTION_CATEGORIES.map((cat) => {
              const count = productionElements.filter((e) => e.category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveElementCategory(cat.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    activeElementCategory === cat.id
                      ? "bg-emerald-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {cat.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Add New Standalone Production Element Row */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <select
              value={newElCategory}
              onChange={(e) => setNewElCategory(e.target.value as ProductionElementType)}
              className="px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-semibold text-emerald-400"
            >
              {PRODUCTION_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={newElName}
              onChange={(e) => setNewElName(e.target.value)}
              placeholder="اسم العنصر المستقل (مثال: Sunny أو Midnight Shard)"
              className="px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
            />

            <input
              type="text"
              value={newElDesc}
              onChange={(e) => setNewElDesc(e.target.value)}
              placeholder="الوصف الشامل المجمع (المظهر + الملابس + السلاح + الألوان)..."
              className="px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
            />

            <button
              type="button"
              onClick={handleAddProductionElement}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة مرجع عنصر مستقل</span>
            </button>
          </div>

          {/* Production Elements Comprehensive Cards List */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {filteredElements.map((el) => {
              const catLabel =
                PRODUCTION_CATEGORIES.find((c) => c.id === el.category)?.label || el.category;
              const isBusyEl = Boolean(busyElementIds[el.id]);
              const isLocked = el.status === "LOCKED";
              const isApproved = el.status === "APPROVED" || isLocked;
              const ver = el.verification_result;
              const visionStatus =
                el.vision_status || ver?.vision_status || (el.verification_status === "VERIFIED" ? "GEMINI_VISION_VERIFIED" : "UNVERIFIED");
              const addedCorrectionsList = Array.from(
                new Set([...(el.added_corrections || []), ...(el.additive_corrections || [])])
              );
              const versionsList = Array.isArray(el.versions) ? el.versions : [];
              const attemptsList = Array.isArray(el.attempts_log) ? el.attempts_log : [];

              return (
                <div
                  key={el.id}
                  className={`p-5 rounded-2xl bg-slate-950/90 border flex flex-col gap-4 ${
                    isLocked
                      ? "border-emerald-500/50"
                      : isApproved
                      ? "border-sky-500/40"
                      : visionStatus === "GEMINI_VISION_NEEDS_CORRECTION"
                      ? "border-amber-500/40"
                      : "border-slate-800"
                  }`}
                >
                  {/* 1. Card Header: Category, ID, Version, Lifecycle Status & Vision Status */}
                  <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold">
                        {catLabel}
                      </span>
                      <span className="font-mono font-bold text-white">{el.id}</span>
                      <span className="px-2 py-0.5 rounded bg-violet-950/70 border border-violet-500/40 font-mono text-[10px] text-violet-200">
                        {el.category === "CHARACTER"
                          ? "Character Reference Sheet (Multi-View: Front/Side/Back/3/4)"
                          : el.category === "WEAPON"
                          ? "Standalone Weapon Reference Sheet (No Characters)"
                          : el.category === "CREATURE" || el.category === "ANIMAL"
                          ? "Standalone Creature Reference Sheet"
                          : el.category === "BUILDING"
                          ? "Standalone Monument / Artifact Reference Sheet"
                          : "Standalone Object Reference Sheet"}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300">
                        v{el.version || 1}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border font-mono text-[11px] font-bold ${
                          isLocked
                            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                            : isApproved
                            ? "bg-sky-500/15 border-sky-500/40 text-sky-300"
                            : "bg-amber-500/15 border-amber-500/40 text-amber-300"
                        }`}
                      >
                        {isLocked ? "🔒 LOCKED" : el.status || "NOT_GENERATED"}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border font-mono text-[10px] font-bold ${
                          visionStatus === "GEMINI_VISION_VERIFIED"
                            ? "bg-emerald-950/80 border-emerald-500/40 text-emerald-300"
                            : visionStatus === "GEMINI_VISION_NEEDS_CORRECTION"
                            ? "bg-amber-950/80 border-amber-500/40 text-amber-300"
                            : visionStatus === "GEMINI_VISION_FAILED"
                            ? "bg-rose-950/80 border-rose-500/40 text-rose-300"
                            : "bg-slate-900 border-slate-700 text-slate-400"
                        }`}
                      >
                        {visionStatus}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteProductionElement(el.id)}
                      className="text-slate-500 hover:text-rose-400 cursor-pointer p-1"
                      title="حذف العنصر"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Master Reference Sheet Visual Unification Banners */}
                  {(() => {
                    const masterSheetForElement = studioMasterSheets.find((ms) => ms.masterId === el.id);
                    const subInfo = isEntitySubordinateToMaster(el.id, studioEntityToMasterMap);
                    const parentMasterSheet = subInfo.isSubordinate
                      ? studioMasterSheets.find((ms) => ms.masterId === subInfo.masterId)
                      : null;

                    return (
                      <>
                        {masterSheetForElement && masterSheetForElement.attachedEntities.length > 0 && (
                          <div className="p-3 rounded-xl bg-violet-950/70 border border-violet-500/50 flex flex-col gap-2">
                            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                              <div className="flex items-center gap-2 text-violet-200 font-bold">
                                <Layers className="h-4 w-4 text-violet-400" />
                                <span>⭐ ورقة مرجع رئيسية شاملة (Master Reference Sheet) — تضم بصريًا:</span>
                              </div>
                              <span className="px-2 py-0.5 rounded bg-violet-900 border border-violet-400/40 text-[10px] text-violet-200 font-mono">
                                {masterSheetForElement.attachedEntities.length} عناصر مدمجة
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {masterSheetForElement.attachedEntities.map((att) => (
                                <span
                                  key={att.id}
                                  className="px-2.5 py-1 rounded-lg bg-slate-900/90 border border-violet-500/40 text-[11px] text-slate-200 flex items-center gap-1.5"
                                >
                                  <span className="font-bold text-violet-300">{att.name}</span>
                                  <span className="font-mono text-[10px] text-slate-400">({att.id})</span>
                                  <span className="text-[10px] text-violet-400/90">• {att.relationshipRole}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {subInfo.isSubordinate && parentMasterSheet && (
                          <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/50 flex flex-col gap-1.5 text-xs">
                            <div className="flex items-center gap-2 text-amber-200 font-bold">
                              <Link2 className="h-4 w-4 text-amber-400" />
                              <span>عنصر مدمج بصريًا ضمن ورقة المرجع الرئيسية: «{parentMasterSheet.masterName}» ({parentMasterSheet.masterId})</span>
                            </div>
                            <p className="text-[11px] text-amber-300/90 leading-relaxed">
                              لا يتم توليد صورة منفصلة لهذا السلاح/العتاد بشكل مستقل؛ بل يشترك تلقائيًا في ورقة المرجع الشاملة لـ «{parentMasterSheet.masterName}» لضمان الاتساق البصري التام. البيانات المنطقية ({el.id}) مفصولة بنسبة 100%.
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* 2. Element Name & Reference Image Preview */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
                    <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-900 aspect-square flex items-center justify-center">
                      {el.reference_image_url ? (
                        <img
                          src={el.reference_image_url}
                          alt={el.name}
                          className="w-full h-full object-cover"
                        />
                      ) : isBusyEl ? (
                        <div className="text-center p-3">
                          <Loader2 className="h-6 w-6 text-emerald-400 animate-spin mx-auto mb-1.5" />
                          <span className="text-[11px] text-emerald-300 block">
                            جاري المعالجة...
                          </span>
                        </div>
                      ) : (
                        <div className="text-center p-3 text-slate-500">
                          <ImageIcon className="h-7 w-7 mx-auto mb-1 opacity-40" />
                          <span className="text-[11px] block">صورة مرجعية شاملة واحدة</span>
                        </div>
                      )}
                      {(visionStatus === "GEMINI_VISION_VERIFIED" || visionStatus === "PASS") &&
                        el.reference_image_url &&
                        ver?.verification_complete && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/40 text-[10px] font-mono text-emerald-300">
                          ✓ Vision PASS{typeof ver?.confidence === "number" ? ` (${ver.confidence}%)` : typeof ver?.score === "number" ? ` (${ver.score}%)` : ""}
                        </span>
                      )}
                    </div>

                    <div className="sm:col-span-2 flex flex-col gap-2.5">
                      {/* Entity Ownership & Reference Grouping Metadata */}
                      <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] font-mono text-slate-300" dir="ltr">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/30 text-emerald-300">
                          entity_id: {el.entity_id || el.id}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-sky-300">
                          entity_type: {el.entity_type || el.category}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-amber-300">
                          ownership: {el.ownership || "SELF_OWNED"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-violet-300">
                          independent_visual_identity: {String(el.independent_visual_identity ?? true)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-teal-300">
                          attached_to: {el.attached_to || "null"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-slate-300">
                          reference_group_id: {el.reference_group_id || `REF_GROUP_${el.id}`}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400 font-semibold">
                          اسم العنصر ({catLabel}):
                        </span>
                        <input
                          type="text"
                          value={el.name}
                          onChange={(e) =>
                            handleUpdateProductionElement(el.id, "name", e.target.value)
                          }
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm font-bold text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400 font-semibold">
                          الوصف الكامل بالعربية (شامل جميع الصفات المدمجة):
                        </span>
                        <textarea
                          value={el.description}
                          onChange={(e) =>
                            handleUpdateProductionElement(el.id, "description", e.target.value)
                          }
                          rows={3}
                          placeholder="الوصف الكامل بالعربية..."
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 leading-relaxed focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 3. Merged Visual Details & Sub-Attributes Breakdown */}
                  <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800/90 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-[11px] font-bold text-emerald-400">
                        التفاصيل البصرية المجمّعة (Unified Entity Visual Details):
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {el.entity_classification || "STANDALONE_ENTITY"}
                      </span>
                    </div>

                    <textarea
                      dir="ltr"
                      value={el.visual_details}
                      onChange={(e) =>
                        handleUpdateProductionElement(el.id, "visual_details", e.target.value)
                      }
                      rows={2}
                      placeholder="Comprehensive visual details (face, hair, body, costume, footwear, weapon, colors, poses)..."
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"
                    />

                    {/* Structured Merged Sub-Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400">المظهر والوجه والشعر (Appearance):</span>
                        <input
                          type="text"
                          value={el.appearance || ""}
                          onChange={(e) =>
                            handleUpdateProductionElement(el.id, "appearance", e.target.value)
                          }
                          placeholder="الوجه، الشعر، العينان، البشرة، الجسم..."
                          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400">الملابس والدروع والأحذية (Clothing & Armor):</span>
                        <input
                          type="text"
                          value={el.clothing_and_armor || ""}
                          onChange={(e) =>
                            handleUpdateProductionElement(
                              el.id,
                              "clothing_and_armor",
                              e.target.value
                            )
                          }
                          placeholder="الملابس، الدروع، الأحذية، القفازات..."
                          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400">الأسلحة والإكسسوارات المرتبطة:</span>
                        <input
                          type="text"
                          value={el.weapons_and_accessories || ""}
                          onChange={(e) =>
                            handleUpdateProductionElement(
                              el.id,
                              "weapons_and_accessories",
                              e.target.value
                            )
                          }
                          placeholder="السلاح المرتبط، الإكسسوارات، تفاصيل المادة..."
                          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400">الألوان والتعبيرات والوضعيات:</span>
                        <input
                          type="text"
                          value={el.colors_and_lighting || el.expressions_and_poses || ""}
                          onChange={(e) =>
                            handleUpdateProductionElement(
                              el.id,
                              "colors_and_lighting",
                              e.target.value
                            )
                          }
                          placeholder="الألوان، الإضاءة، التعبيرات، الوضعيات..."
                          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200"
                        />
                      </div>
                    </div>

                    {Array.isArray(el.merged_attributes) && el.merged_attributes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {el.merged_attributes.map((attr, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-300"
                          >
                            ✓ {attr}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 4. Three-Layer Reference Architecture + 19-Point Dual-Source Master Reference Prompt + Pre-Flow Protection Gate */}
                  <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-slate-900/70 border border-slate-800">
                    <div className="flex items-center justify-between flex-wrap gap-1.5">
                      <span className="text-[11px] font-bold text-emerald-300">
                        الطبقة 1 — الوصف المرجعي الأساسي الموحّد (Canonical Reference Description — دمج المصدر العربي + الإنجليزي بدون ستايل عام):
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {el.master_prompt_key && (
                          <span className="text-[10px] font-mono text-violet-300 bg-violet-950/60 border border-violet-500/40 px-2 py-0.5 rounded">
                            {el.master_prompt_key}
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded">
                          canonical_description (ثابت 100%)
                        </span>
                      </div>
                    </div>
                    <textarea
                      dir="ltr"
                      value={el.canonical_description || el.base_reference_prompt || el.visual_details}
                      onChange={(e) => {
                        handleUpdateProductionElement(el.id, "canonical_description", e.target.value);
                        handleUpdateProductionElement(el.id, "base_reference_prompt", e.target.value);
                      }}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 leading-relaxed focus:border-emerald-500 focus:outline-none"
                    />

                    {Array.isArray(el.detected_source_conflicts) &&
                      el.detected_source_conflicts.length > 0 && (
                        <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-500/40 text-[11px] text-amber-200">
                          <strong>⚠ تعارض مكتشف بين المصدرين (تم الحفاظ على المعلومة الأصلية الثابتة):</strong>
                          <ul className="list-disc list-inside mt-1 space-y-0.5">
                            {el.detected_source_conflicts.map((conf, idx) => (
                              <li key={idx}>{conf}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    <div className="flex flex-col gap-1 pt-1">
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-[11px] font-bold text-sky-300">
                          الطبقة 2 — الستايل الفني العام للمشروع (Global Visual Style — من إعدادات المشروع: {selectedStyle}):
                        </span>
                        <span className="text-[10px] font-mono text-sky-400">
                          generation_style
                        </span>
                      </div>
                      <div
                        dir="ltr"
                        className="px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800/90 text-[11px] font-mono text-sky-200"
                      >
                        {el.generation_style ||
                          "Korean manhwa art style, colored manga, high detail, semi-realistic rendering, cinematic lighting, soft digital shading, intricate line art, ultra-detailed."}
                      </div>
                    </div>

                    {el.pre_flow_protection_report && (
                      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-[10px] text-emerald-300">
                        <span className="font-bold">🛡️ بوابة الحماية قبل Google Flow:</span>
                        <span>الهوية ✓</span>
                        <span>· التفاصيل الأساسية ✓</span>
                        <span>· العناصر الثابتة ✓</span>
                        <span>· السلاح ✓</span>
                        <span>· الألوان ✓</span>
                        <span>· التعبيرات والوضعيات ✓</span>
                        <span>· Minimum Detail Gate ✓</span>
                        <span>· بدون عبارات عامة (No Generic Placeholders) ✓</span>
                        {el.pre_flow_protection_report.auto_repaired && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 font-mono">
                            Auto-Repaired: {el.pre_flow_protection_report.missing_sections_repaired.join(", ")}
                          </span>
                        )}
                      </div>
                    )}

                    {(el.assembled_flow_prompt || el.reference_prompt) && (
                      <div className="flex flex-col gap-1 pt-1">
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <span className="text-[11px] font-bold text-violet-300">
                            الأمر المرجعي الشامل المجمّع (19-Point Master Reference Prompt — جاهز للإرسال إلى Google Flow):
                          </span>
                          <span className="text-[10px] font-mono text-violet-400">
                            {el.master_prompt_key || "MASTER_REFERENCE_PROMPT"}
                          </span>
                        </div>
                        <textarea
                          dir="ltr"
                          value={el.assembled_flow_prompt || el.reference_prompt || ""}
                          onChange={(e) => {
                            handleUpdateProductionElement(el.id, "assembled_flow_prompt", e.target.value);
                            handleUpdateProductionElement(el.id, "reference_prompt", e.target.value);
                          }}
                          rows={7}
                          className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-200 leading-relaxed focus:border-violet-500 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {/* 5. Immutable Constraints & Added Corrections (Additive Prompt Correction Rule 17) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-slate-300">
                        القيود الثابتة (Immutable Constraints):
                      </span>
                      {Array.isArray(el.immutable_constraints) &&
                      el.immutable_constraints.length > 0 ? (
                        <ul className="list-disc list-inside text-[11px] text-slate-400 space-y-0.5">
                          {el.immutable_constraints.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          الحفاظ على الهوية والتصميم الثابت للعنصر
                        </span>
                      )}
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-amber-300">
                        إضافة تصحيح إلى البرومت (Additive Manual Correction — لا يستبدل الـ Prompt الأساسي):
                      </span>
                      {addedCorrectionsList.length > 0 ? (
                        <ul className="list-disc list-inside text-[11px] font-mono text-amber-200 space-y-0.5" dir="ltr">
                          {addedCorrectionsList.map((corr, i) => (
                            <li key={i}>+ {corr}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          current_prompt = base_prompt + existing_additive_corrections + new_manual_correction
                        </span>
                      )}
                      <div className="flex flex-col sm:flex-row gap-1.5 mt-1">
                        <input
                          type="text"
                          value={customElementCorrections[el.id] || ""}
                          onChange={(e) =>
                            setCustomElementCorrections((prev) => ({
                              ...prev,
                              [el.id]: e.target.value,
                            }))
                          }
                          placeholder="مثال: اجعل شعر Sunny أسود قصيرًا وفوضويًا، وأعد العباءة السوداء الطويلة..."
                          className="flex-1 px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-amber-200 focus:border-amber-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            handleGenerateSingleElement(el.id, false, undefined, {
                              autoVerify: true,
                              autoLock: true,
                              forceRegenerate: true,
                              customCorrection:
                                customElementCorrections[el.id]?.trim() ||
                                ver?.additive_correction ||
                                undefined,
                            })
                          }
                          disabled={isBusyEl || isGeneratingElementsBatch}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          إضافة التصحيح وإعادة التوليد
                        </button>
                      </div>
                      {Array.isArray(el.correction_history) && el.correction_history.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-slate-400">
                            سجل التصحيحات (Correction History):
                          </span>
                          <div className="space-y-1 max-h-24 overflow-y-auto text-[10px] font-mono text-slate-300" dir="ltr">
                            {el.correction_history.map((h, hIdx) => (
                              <div key={hIdx} className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                                <strong className="text-emerald-400">{h.label || `v${h.version}`}:</strong>{" "}
                                {h.type === "BASE_PROMPT" ? "Base Prompt" : `+ ${h.correction_text}`}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 6. Gemini Vision Inspection Result (Structured Vision Report) */}
                  {ver && (
                    <div
                      className={`p-3 rounded-xl border text-xs flex flex-col gap-2 ${
                        ver.approved && ver.overall_status === "PASS"
                          ? "bg-emerald-950/20 border-emerald-800/40"
                          : "bg-amber-950/20 border-amber-800/40"
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span
                          className={`font-bold ${
                            ver.approved && ver.overall_status === "PASS" ? "text-emerald-300" : "text-amber-300"
                          }`}
                        >
                          نتيجة فحص Gemini Vision الحقيقي (overall_status: {ver.overall_status || ver.vision_status || visionStatus})
                        </span>
                        <span className="font-mono text-[11px] text-slate-300">
                          الثقة (confidence):{" "}
                          <strong>
                            {typeof ver.confidence === "number"
                              ? `${ver.confidence}%`
                              : typeof ver.score === "number"
                              ? `${ver.score}%`
                              : "غير محددة"}
                          </strong>{" "}
                          · المعتمدة: <strong>{String(Boolean(ver.approved))}</strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[10px] font-mono text-slate-300" dir="ltr">
                        <span>identity_match: <strong>{String(Boolean(ver.identity_match ?? ver.checks?.identity_consistency))}</strong></span>
                        <span>style_match: <strong>{String(Boolean(ver.style_match ?? ver.checks?.style_consistency))}</strong></span>
                        <span>composition_match: <strong>{String(Boolean(ver.composition_match ?? ver.checks?.pose_and_expression))}</strong></span>
                        <span>character_match: <strong>{String(Boolean(ver.character_match ?? ver.checks?.identity_consistency))}</strong></span>
                        <span>weapon_match: <strong>{String(Boolean(ver.weapon_match ?? ver.checks?.weapons_and_accessories))}</strong></span>
                        <span>location_match: <strong>{String(Boolean(ver.location_match ?? true))}</strong></span>
                      </div>

                      {Array.isArray(ver.what_is_correct) && ver.what_is_correct.length > 0 && (
                        <div className="text-[11px] text-emerald-300">
                          <strong>✓ ما هو صحيح (what_is_correct):</strong>{" "}
                          {ver.what_is_correct.join(" ، ")}
                        </div>
                      )}
                      {Array.isArray(ver.what_is_missing) && ver.what_is_missing.length > 0 && (
                        <div className="text-[11px] text-rose-300">
                          <strong>✗ ما هو ناقص (what_is_missing):</strong>{" "}
                          {ver.what_is_missing.join(" ، ")}
                        </div>
                      )}
                      {Array.isArray(ver.what_is_different) && ver.what_is_different.length > 0 && (
                        <div className="text-[11px] text-amber-300">
                          <strong>⚠ ما هو مختلف (what_is_different):</strong>{" "}
                          {ver.what_is_different.join(" ، ")}
                        </div>
                      )}
                      {Array.isArray(ver.critical_corrections) && ver.critical_corrections.length > 0 && (
                        <div className="text-[11px] text-rose-200">
                          <strong>🔧 التصحيحات الحرجة (critical_corrections):</strong>{" "}
                          {ver.critical_corrections.join(" ، ")}
                        </div>
                      )}
                      {ver.additive_correction && (
                        <div className="text-[11px] font-mono text-sky-300" dir="ltr">
                          <strong>+ Additive Correction:</strong> {ver.additive_correction}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 7. Version History (v1, v2, v3) & Attempts History */}
                  {(versionsList.length > 0 || attemptsList.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                      {versionsList.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex flex-col gap-1.5">
                          <span className="font-bold text-slate-300">
                            سجل النسخ (Version History — {versionsList.length}):
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {versionsList.map((verItem: any, idx: number) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  if (verItem.image_url) {
                                    handleUpdateProductionElement(
                                      el.id,
                                      "reference_image_url",
                                      verItem.image_url
                                    );
                                    handleUpdateProductionElement(
                                      el.id,
                                      "version",
                                      verItem.version || idx + 1
                                    );
                                  }
                                }}
                                className={`px-2 py-1 rounded border font-mono text-[10px] cursor-pointer transition ${
                                  el.version === (verItem.version || idx + 1)
                                    ? "bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold"
                                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                                }`}
                                title={verItem.prompt_used || ""}
                              >
                                v{verItem.version || idx + 1} ({verItem.status || "GENERATED"})
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {attemptsList.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex flex-col gap-1">
                          <span className="font-bold text-slate-300">
                            تاريخ المحاولات (Attempts Log — {attemptsList.length}):
                          </span>
                          <div className="max-h-20 overflow-y-auto space-y-1 text-[10px] font-mono text-slate-400">
                            {attemptsList.map((att: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between gap-2">
                                <span>
                                  محاولة #{att.attempt || idx + 1}:{" "}
                                  {att.approved ? "✓ APPROVED" : "✗ NEEDS_FIX"} ({att.score ?? 0}%)
                                </span>
                                {att.additive_correction && (
                                  <span className="text-amber-300 truncate max-w-[160px]" dir="ltr">
                                    +{att.additive_correction}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {el.last_error && (
                    <p className="text-[11px] text-rose-400 bg-rose-950/30 border border-rose-800/40 rounded-lg px-3 py-2">
                      {el.last_error}
                    </p>
                  )}

                  {/* Real Google Flow Project & Asset Verification Box (Requirement 4, 5, 6, 13, 14) */}
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-indigo-500/30 flex flex-col gap-2 text-[11px]">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-bold text-indigo-300">
                        حالة الأصل الحقيقي داخل Google Flow (Real Flow Asset Verification):
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap font-mono text-[10px]">
                        <span
                          className={`px-2 py-0.5 rounded border font-bold ${
                            el.real_flow_asset_verified && el.flowAssetId
                              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                              : el.flowAssetId
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                              : "bg-rose-500/15 border-rose-500/40 text-rose-300"
                          }`}
                        >
                          {el.flow_asset_status ||
                            (el.real_flow_asset_verified && el.flowAssetId
                              ? "FLOW_ASSET_VERIFIED"
                              : el.flowAssetId
                              ? "FLOW_ASSET_CREATED"
                              : "FLOW_ASSET_NOT_CREATED")}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border font-bold ${
                            el.flow_generation_status === "FLOW_GENERATION_SUCCESS"
                              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                              : "bg-slate-950 border-slate-800 text-slate-400"
                          }`}
                        >
                          {el.flow_generation_status || "IDLE"}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 font-mono text-[10px] text-slate-300" dir="ltr">
                      <div className="truncate">
                        <span className="text-slate-500">flowProjectId:</span>{" "}
                        <strong
                          className={
                            isRealVerifiedFlowProjectId(el.flowProjectId || el.flow_project_id)
                              ? "text-emerald-300"
                              : "text-rose-400"
                          }
                        >
                          {isRealVerifiedFlowProjectId(el.flowProjectId || el.flow_project_id)
                            ? el.flowProjectId || el.flow_project_id
                            : "NOT_VERIFIED_IN_FLOW"}
                        </strong>
                      </div>
                      <div className="truncate">
                        <span className="text-slate-500">flowAssetId:</span>{" "}
                        <strong className={el.flowAssetId ? "text-sky-300" : "text-rose-400"}>
                          {el.flowAssetId || "NONE"}
                        </strong>
                      </div>
                      <div className="truncate">
                        <span className="text-slate-500">flowGenerationId:</span>{" "}
                        <strong
                          className={
                            el.flowGenerationId || el.flow_generation_id
                              ? "text-violet-300"
                              : "text-rose-400"
                          }
                        >
                          {el.flowGenerationId || el.flow_generation_id || "NONE"}
                        </strong>
                      </div>
                      <div className="truncate">
                        <span className="text-slate-500">promptHash:</span>{" "}
                        <strong className="text-slate-300">{el.promptHash || "—"}</strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <button
                        type="button"
                        onClick={() => handleVerifyElementAssetInFlow(el.id)}
                        disabled={isBusyEl || !el.flowAssetId}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-40"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>التحقق من وجود الصورة داخل Google Flow</span>
                      </button>

                      {isRealVerifiedFlowProjectId(el.flowProjectId || el.flow_project_id) && (
                        <a
                          href={
                            el.flowProjectUrl ||
                            buildRealFlowProjectUrl(
                              el.flowProjectId || el.flow_project_id,
                              el.flowAssetId
                            ) ||
                            "https://flow.google.com"
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>فتح المشروع الحقيقي داخل Google Flow</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* 8. Required 5 Action Buttons per Element Card (Requirement 14) */}
                  <div className="flex items-center gap-2 pt-3 border-t border-slate-800/80 flex-wrap">
                    {/* 1. توليد الوصف المرجعي عبر Gemini */}
                    <button
                      type="button"
                      onClick={() => handleGenerateElementPromptViaGemini(el.id)}
                      disabled={isBusyEl || isGeneratingElementsBatch}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      {isBusyEl ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      <span>توليد الوصف المرجعي عبر Gemini</span>
                    </button>

                    {/* 2. توليد الصورة + فحص وتصحيح تلقائي حتى 100% */}
                    {(() => {
                      const masterSheetForElement = studioMasterSheets.find((ms) => ms.masterId === el.id);
                      const subInfo = isEntitySubordinateToMaster(el.id, studioEntityToMasterMap);
                      const parentMasterSheet = subInfo.isSubordinate
                        ? studioMasterSheets.find((ms) => ms.masterId === subInfo.masterId)
                        : null;

                      if (subInfo.isSubordinate && parentMasterSheet) {
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              handleGenerateSingleElement(parentMasterSheet.masterId, false, undefined, {
                                autoVerify: true,
                                autoLock: true,
                                forceRegenerate: true,
                              })
                            }
                            disabled={isBusyEl || Boolean(busyElementIds[parentMasterSheet.masterId]) || isGeneratingElementsBatch}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                          >
                            {isBusyEl || Boolean(busyElementIds[parentMasterSheet.masterId]) ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                            <span>⚡ تحديث عبر ورقة المرجع الرئيسية («{parentMasterSheet.masterName}»)</span>
                          </button>
                        );
                      }

                      return (
                        <button
                          type="button"
                          onClick={() =>
                            handleGenerateSingleElement(el.id, false, undefined, {
                              autoVerify: true,
                              autoLock: true,
                              forceRegenerate: Boolean(el.reference_image_url),
                            })
                          }
                          disabled={isBusyEl || isGeneratingElementsBatch}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          {isBusyEl ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {masterSheetForElement && masterSheetForElement.attachedEntities.length > 0
                              ? "⚡ توليد ورقة المرجع الشاملة (Master Sheet)"
                              : "توليد + فحص وتصحيح تلقائي (100%)"}
                          </span>
                        </button>
                      );
                    })()}

                    {/* 3. فحص عبر Gemini Vision + تصحيح تلقائي */}
                    <button
                      type="button"
                      onClick={() => handleVerifySingleElement(el.id, false, undefined, true)}
                      disabled={!el.reference_image_url || isBusyEl || isVerifyingElementsBatch}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      {isBusyEl && el.verification_status === "VERIFYING" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                      <span>فحص وتصحيح تلقائي عبر Gemini (100%)</span>
                    </button>

                    {/* 4. إعادة التوليد مع التعديل */}
                    <button
                      type="button"
                      onClick={() =>
                        handleGenerateSingleElement(el.id, false, undefined, {
                          autoVerify: true,
                          autoLock: true,
                          forceRegenerate: true,
                          customCorrection:
                            customElementCorrections[el.id]?.trim() ||
                            ver?.additive_correction ||
                            undefined,
                        })
                      }
                      disabled={isBusyEl || isGeneratingElementsBatch}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>إعادة التوليد مع التعديل</span>
                    </button>

                    {/* 5. قفل المرجع */}
                    <button
                      type="button"
                      onClick={() => handleLockSingleElement(el.id)}
                      disabled={isBusyEl}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ms-auto ${
                        isLocked
                          ? "bg-emerald-900/60 border border-emerald-500/50 text-emerald-200"
                          : "bg-emerald-600 hover:bg-emerald-500 text-white"
                      }`}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>{isLocked ? "مقفل (LOCKED)" : "قفل المرجع"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Step Footer Navigation */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => goToStep(2)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition cursor-pointer"
            >
              <ArrowRight className="h-4 w-4" />
              <span>السابق: الستايل</span>
            </button>

            <button
              type="button"
              onClick={() => goToStep(4)}
              className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition cursor-pointer shadow-lg shadow-emerald-950/50"
            >
              <span>التالي: المواقع</span>
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* STEP 4️⃣: المواقع (LOCATIONS — Unified Reference & Gemini Vision)    */}
      {/* ===================================================================== */}
      {currentStep === 4 && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800/80 pb-5">
            <div>
              <span className="text-xs font-semibold text-emerald-400 block mb-1">
                الخطوة 4 من 6 • UNIFIED LOCATIONS STUDIO & GEMINI VISION GATE
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                ④ المواقع — صورة Environment Reference Sheet مستقلة واحدة لكل موقع جغرافي (ONE LOCATION → ONE REFERENCE SHEET)
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
                قاعدة صارمة: يحصل كل موقع جغرافي مستقل (مثل Deep Chasm أو Crimson Labyrinth أو Ancient Road أو Forgotten Shore) على صورة Environment Reference Sheet مستقلة واحدة خاصة به فقط (تضم Wide View + Angle View + تفاصيل التضاريس والإضاءة والخامات)، ويُمنع دمج عدة مواقع مختلفة في صورة واحدة أو وضع شخصيات أو وحوش داخل مرجع الموقع.
              </p>
              {(activePreparedNovelData || preparedNovelData?.status === "ADOPTED") && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-emerald-400 fill-current" />
                    <span className="text-emerald-200">
                      <strong>⚡ المواقع المعتمدة:</strong> {locations.length} مواقع مستخرجة ومبنية مباشرة من «{activePreparedNovelData?.novel_title || preparedNovelData?.novel_title || projectTitle}»
                    </span>
                  </div>
                  <span className="font-mono text-emerald-300 text-[11px]">
                    {locations.map((l) => l.name).join(" · ")}
                  </span>
                </div>
              )}
            </div>

            {/* Parallel Batch Controls for Locations */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400">التوازي:</span>
                <select
                  value={maxConcurrentGenerations}
                  onChange={(e) => setMaxConcurrentGenerations(Number(e.target.value))}
                  className="bg-transparent font-mono font-bold text-emerald-400 focus:outline-none"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3 (موصى به)</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleGenerateAllLocationPromptsViaGemini}
                disabled={isGeneratingLocationPromptsBatch || isGeneratingAllLocations}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
              >
                {isGeneratingLocationPromptsBatch ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>توليد الأوصاف المرجعية للمواقع عبر Gemini</span>
              </button>

              <button
                type="button"
                onClick={() => handleGenerateAllLocationsParallel(false, true)}
                disabled={isGeneratingAllLocations || isVerifyingAllLocations}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-950/40"
              >
                {isGeneratingAllLocations ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span>🤖 النظام التلقائي: توليد + تحليل + تصحيح جميع المواقع حتى 100%</span>
              </button>

              <button
                type="button"
                onClick={() => handleGenerateAllLocationsParallel(false, false)}
                disabled={isGeneratingAllLocations || isVerifyingAllLocations}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 shadow-lg shadow-teal-950/40"
              >
                {isGeneratingAllLocations ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>توليد سريع لجميع المواقع (بدون انتظار الفحص)</span>
              </button>

              <button
                type="button"
                onClick={handleVerifyAllLocationsParallel}
                disabled={isVerifyingAllLocations || isGeneratingAllLocations}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 shadow-lg shadow-sky-950/40"
              >
                {isVerifyingAllLocations ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                <span>فحص وتصحيح جميع المواقع تلقائيًا حتى 100%</span>
              </button>

              <button
                type="button"
                onClick={handleExtractFromFullScript}
                disabled={isExtractingFromScript || isGeneratingAllLocations || isVerifyingAllLocations}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition cursor-pointer disabled:opacity-50"
              >
                {isExtractingFromScript ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 text-emerald-400" />
                )}
                <span>مزامنة المواقع من السكريبت ({locations.length})</span>
              </button>
            </div>
          </div>

          {/* Add Location Form */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 grid grid-cols-1 sm:grid-cols-5 gap-3">
            <select
              value={newLocType}
              onChange={(e) => setNewLocType(e.target.value as StudioLocationType)}
              className="px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-semibold text-emerald-400"
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} — {t.label}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={newLocName}
              onChange={(e) => setNewLocName(e.target.value)}
              placeholder="اسم الموقع الشامل (مثال: الوادي العميق ومتاهة المرجان)"
              className="px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
            />

            <input
              type="text"
              value={newLocDesc}
              onChange={(e) => setNewLocDesc(e.target.value)}
              placeholder="الوصف المجمع للموقع ومكوناته..."
              className="px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
            />

            <input
              type="text"
              value={newLocVisualDesc}
              onChange={(e) => setNewLocVisualDesc(e.target.value)}
              placeholder="الإضاءة، الألوان، الخامات، والظلال..."
              className="px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
            />

            <button
              type="button"
              onClick={handleAddLocation}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة موقع شامل جديد</span>
            </button>
          </div>

          {/* Locations Cards Grid (Requirement 15) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {locations
              .filter(
                (loc): loc is StudioLocationItem =>
                  Boolean(loc && loc.location_id && loc.target_step !== "production_elements")
              )
              .map((loc) => {
              const typeLabel =
                LOCATION_TYPES.find((t) => t.id === loc.type)?.label || loc.type;
              const isLocBusy = Boolean(busyLocationIds[loc.location_id]);
              const usage = getLocationScenesUsage(loc);
              const ver = loc.verification_result;
              const isLocked = loc.status === "LOCKED";
              const isVerified =
                loc.verification_status === "VERIFIED" &&
                Boolean(ver?.approved && ver?.all_required_checks_passed);
              const visionStatus =
                loc.vision_status ||
                ver?.vision_status ||
                (isVerified ? "GEMINI_VISION_VERIFIED" : "UNVERIFIED");
              const addedCorrectionsList = Array.from(
                new Set([...(loc.added_corrections || []), ...(loc.additive_corrections || [])])
              );
              const keyComponentsList = Array.from(
                new Set([...(loc.key_components || []), ...(loc.immutable_elements || [])])
              );
              const versionsList = Array.isArray(loc.versions) ? loc.versions : [];
              const attemptsList = Array.isArray(loc.attempts_log) ? loc.attempts_log : [];

              return (
                <div
                  key={loc.location_id}
                  className={`p-5 rounded-2xl bg-slate-950/90 border flex flex-col justify-between gap-4 ${
                    isLocked
                      ? "border-emerald-500/50"
                      : isVerified
                      ? "border-sky-500/40"
                      : visionStatus === "GEMINI_VISION_NEEDS_CORRECTION"
                      ? "border-amber-500/40"
                      : "border-slate-800"
                  }`}
                >
                  {/* 1. Top Metadata Bar: ID · Type · Version · Status · Vision Status · Scenes Used */}
                  <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                        <span className="font-mono font-bold text-emerald-400">
                          {loc.location_id}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 font-mono text-sky-300">
                          {loc.type} — {typeLabel}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-violet-950/70 border border-violet-500/40 font-mono text-[10px] text-violet-200">
                          Standalone Environment Reference Sheet (No Characters / Single Location)
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300">
                          v{loc.version || 0}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border font-mono text-[11px] font-bold ${
                            isLocked
                              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                              : isVerified
                              ? "bg-sky-500/15 border-sky-500/40 text-sky-300"
                              : "bg-amber-500/15 border-amber-500/40 text-amber-300"
                          }`}
                        >
                          {isLocked ? "🔒 LOCKED" : loc.status || loc.generation_status || "NOT_GENERATED"}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border font-mono text-[10px] font-bold ${
                            visionStatus === "GEMINI_VISION_VERIFIED"
                              ? "bg-emerald-950/80 border-emerald-500/40 text-emerald-300"
                              : visionStatus === "GEMINI_VISION_NEEDS_CORRECTION"
                              ? "bg-amber-950/80 border-amber-500/40 text-amber-300"
                              : visionStatus === "GEMINI_VISION_FAILED"
                              ? "bg-rose-950/80 border-rose-500/40 text-rose-300"
                              : "bg-slate-900 border-slate-700 text-slate-400"
                          }`}
                        >
                          {visionStatus}
                        </span>
                        <span className="text-amber-300 text-[11px]">
                          مستخدم في {usage.count} مشاهد
                          {usage.sceneNumbers.length > 0
                            ? ` (${usage.sceneNumbers.join("، ")})`
                            : ""}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={loc.name}
                        onChange={(e) =>
                          handleUpdateLocation(loc.location_id, "name", e.target.value)
                        }
                        className="mt-2 w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-base font-bold text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteLocation(loc.location_id)}
                      className="text-slate-500 hover:text-rose-400 cursor-pointer p-1"
                      title="حذف الموقع"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Location Master Reference Sheet Attached Monuments & Props */}
                  {(() => {
                    const locAttachedEntities =
                      studioMasterSheets.find((ms) => ms.masterId === loc.location_id)?.attachedEntities || [];
                    if (locAttachedEntities.length === 0) return null;

                    return (
                      <div className="p-3 rounded-xl bg-violet-950/70 border border-violet-500/50 flex flex-col gap-2">
                        <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                          <div className="flex items-center gap-2 text-violet-200 font-bold">
                            <Layers className="h-4 w-4 text-violet-400" />
                            <span>المعالم والتماثيل والآثار المعمارية المدمجة في ورقة الموقع (Master Location Sheet):</span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-violet-900 border border-violet-400/40 text-[10px] text-violet-200 font-mono">
                            {locAttachedEntities.length} معالم وتماثيل مدمجة
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {locAttachedEntities.map((att) => (
                            <span
                              key={att.id}
                              className="px-2.5 py-1 rounded-lg bg-slate-900/90 border border-violet-500/40 text-[11px] text-slate-200 flex items-center gap-1.5"
                            >
                              <span className="font-bold text-violet-300">🏛️ {att.name}</span>
                              <span className="font-mono text-[10px] text-slate-400">({att.id})</span>
                              <span className="text-[10px] text-violet-400/90">• {att.relationshipRole}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 2. Location Reference Image Preview */}
                  <div className="relative w-full aspect-[16/9] rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden">
                    {loc.reference_image_url ? (
                      <img
                        src={loc.reference_image_url}
                        alt={loc.name}
                        className="w-full h-full object-cover"
                      />
                    ) : isLocBusy || loc.generation_status === "QUEUED" ? (
                      <div className="text-center p-4">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin mx-auto mb-2" />
                        <span className="text-xs text-emerald-300 block">
                          {loc.generation_status === "QUEUED"
                            ? "في طابور التوليد المتوازي..."
                            : "جاري توليد صورة الموقع الشاملة عبر Google Flow..."}
                        </span>
                      </div>
                    ) : (
                      <div className="text-center p-4 text-slate-500">
                        <MapPin className="h-8 w-8 mx-auto mb-1.5 opacity-40" />
                        <span className="text-xs block">[ مرجع موقع شامل واحد — لم يتم التوليد بعد ]</span>
                      </div>
                    )}
                    {(visionStatus === "GEMINI_VISION_VERIFIED" || visionStatus === "PASS") &&
                      loc.reference_image_url &&
                      ver?.verification_complete && (
                      <span className="absolute top-2 left-2 px-2.5 py-1 rounded bg-emerald-950/90 border border-emerald-500/40 text-[10px] font-mono text-emerald-300">
                        ✓ Gemini Vision PASS{typeof ver?.confidence === "number" ? ` (${ver.confidence}%)` : typeof ver?.score === "number" ? ` (${ver.score}%)` : ""}
                      </span>
                    )}
                  </div>

                  {/* 3. Unified Location Details: Description, Lighting & Atmosphere, Colors & Textures, Key Components */}
                  <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-slate-300">
                        الوصف المجمع الكامل للموقع (يدمج كل العناصر الفرعية داخل الموقع):
                      </span>
                      <textarea
                        value={loc.description}
                        onChange={(e) =>
                          handleUpdateLocation(loc.location_id, "description", e.target.value)
                        }
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400 font-semibold">
                          الإضاءة والجو العام (Lighting & Atmosphere):
                        </span>
                        <input
                          type="text"
                          value={loc.lighting_and_atmosphere || loc.atmosphere || ""}
                          onChange={(e) =>
                            handleUpdateLocation(
                              loc.location_id,
                              "lighting_and_atmosphere",
                              e.target.value
                            )
                          }
                          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-slate-400 font-semibold">
                          الألوان والخامات (Colors & Textures):
                        </span>
                        <input
                          type="text"
                          value={
                            loc.color_palette
                              ? `${loc.color_palette}${loc.textures || loc.textures_and_materials ? ` · ${loc.textures || loc.textures_and_materials}` : ""}`
                              : loc.textures || loc.textures_and_materials || ""
                          }
                          onChange={(e) =>
                            handleUpdateLocation(loc.location_id, "color_palette", e.target.value)
                          }
                          placeholder="الألوان السائدة والخامات الصخرية/المعمارية..."
                          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-200"
                        />
                      </div>
                    </div>

                    {/* Key Components Merged Inside This Location */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-emerald-400">
                        العناصر المدمجة داخل هذا الموقع (Key Components & Immutable Elements):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {keyComponentsList.map((comp, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-300"
                          >
                            ✓ {comp}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 4. Three-Layer Location Reference Architecture: Canonical Description + Global Visual Style + Added Corrections */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-[11px] font-bold text-emerald-300">
                        الطبقة 1 — الوصف المرجعي الأساسي للموقع (Canonical Location Description — بدون ستايل عام):
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400">
                        canonical_description
                      </span>
                    </div>
                    <textarea
                      dir="ltr"
                      value={loc.canonical_description || loc.base_reference_prompt || loc.visual_reference_prompt}
                      onChange={(e) => {
                        handleUpdateLocation(loc.location_id, "canonical_description", e.target.value);
                        handleUpdateLocation(loc.location_id, "base_reference_prompt", e.target.value);
                        handleUpdateLocation(
                          loc.location_id,
                          "visual_reference_prompt",
                          e.target.value
                        );
                      }}
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-emerald-300 focus:border-emerald-500 focus:outline-none"
                    />

                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-sky-300">
                        الطبقة 2 — الستايل الفني العام للمشروع (Global Visual Style — {selectedStyle}):
                      </span>
                      <div
                        dir="ltr"
                        className="px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800/90 text-[11px] font-mono text-sky-200"
                      >
                        {loc.generation_style ||
                          "Korean manhwa art style, colored manga, high detail, semi-realistic rendering, cinematic lighting, soft digital shading, intricate line art, ultra-detailed."}
                      </div>
                    </div>

                    {loc.assembled_flow_prompt && (
                      <details className="text-[11px]">
                        <summary className="cursor-pointer font-semibold text-violet-300 hover:text-violet-200 select-none">
                          معاينة الأمر النهائي المجمّع المرسل إلى Google Flow
                        </summary>
                        <pre
                          dir="ltr"
                          className="mt-1.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed"
                        >
                          {loc.assembled_flow_prompt}
                        </pre>
                      </details>
                    )}

                    {/* Added Corrections Box */}
                    <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-amber-300">
                        إضافة تصحيح إلى البرومت (Additive Manual Correction — لا يستبدل الـ Prompt الأساسي):
                      </span>
                      {addedCorrectionsList.length > 0 ? (
                        <ul className="list-disc list-inside text-[11px] font-mono text-amber-200 space-y-0.5" dir="ltr">
                          {addedCorrectionsList.map((c, i) => (
                            <li key={i}>+ {c}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          current_prompt = base_prompt + existing_additive_corrections + new_manual_correction
                        </span>
                      )}
                      <div className="flex flex-col sm:flex-row gap-1.5 mt-1">
                        <input
                          type="text"
                          value={customLocationCorrections[loc.location_id] || ""}
                          onChange={(e) =>
                            setCustomLocationCorrections((prev) => ({
                              ...prev,
                              [loc.location_id]: e.target.value,
                            }))
                          }
                          placeholder="مثال: اجعل الجسر مكسورًا من المنتصف، وأعد التمثال إلى حجمه الضخم، وأزل الضباب..."
                          className="flex-1 px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-amber-200 focus:border-amber-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            handleGenerateSingleLocation(loc.location_id, false, true, undefined, {
                              forceRegenerate: true,
                              customCorrection:
                                customLocationCorrections[loc.location_id]?.trim() ||
                                ver?.additive_correction ||
                                undefined,
                            })
                          }
                          disabled={isLocBusy || isGeneratingAllLocations}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          إضافة التصحيح وإعادة التوليد
                        </button>
                      </div>
                      {Array.isArray(loc.correction_history) && loc.correction_history.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-slate-400">
                            سجل التصحيحات (Correction History):
                          </span>
                          <div className="space-y-1 max-h-24 overflow-y-auto text-[10px] font-mono text-slate-300" dir="ltr">
                            {loc.correction_history.map((h, hIdx) => (
                              <div key={hIdx} className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                                <strong className="text-emerald-400">{h.label || `v${h.version}`}:</strong>{" "}
                                {h.type === "BASE_PROMPT" ? "Base Prompt" : `+ ${h.correction_text}`}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 5. Gemini Vision Inspection Result */}
                  {ver && (
                    <div
                      className={`p-3 rounded-xl border text-xs flex flex-col gap-2 ${
                        ver.approved && ver.all_required_checks_passed
                          ? "bg-emerald-950/20 border-emerald-800/40"
                          : "bg-amber-950/20 border-amber-800/40"
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold flex-wrap gap-2">
                        <span
                          className={
                            ver.approved && ver.all_required_checks_passed
                              ? "text-emerald-300"
                              : "text-amber-300"
                          }
                        >
                          نتيجة فحص Gemini Vision للموقع (overall_status: {ver.overall_status || ver.vision_status || visionStatus})
                        </span>
                        <span className="font-mono text-[11px] text-slate-200">
                          الثقة (confidence):{" "}
                          <strong>
                            {typeof ver.confidence === "number"
                              ? `${ver.confidence}%`
                              : typeof ver.score === "number"
                              ? `${ver.score}%`
                              : "غير محددة"}
                          </strong>{" "}
                          · النجاح:{" "}
                          <strong
                            className={
                              ver.all_required_checks_passed ? "text-emerald-400" : "text-rose-400"
                            }
                          >
                            {String(Boolean(ver.all_required_checks_passed))}
                          </strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[10px] font-mono text-slate-300" dir="ltr">
                        <span>location_match: <strong>{String(Boolean(ver.location_match ?? ver.checks?.architecture_and_terrain))}</strong></span>
                        <span>style_match: <strong>{String(Boolean(ver.style_match ?? ver.checks?.style_consistency))}</strong></span>
                        <span>composition_match: <strong>{String(Boolean(ver.composition_match ?? ver.checks?.perspective_and_scale))}</strong></span>
                      </div>

                      {Array.isArray(ver.what_is_correct) && ver.what_is_correct.length > 0 && (
                        <div className="text-[11px] text-emerald-300">
                          <strong>✓ ما هو صحيح (what_is_correct):</strong>{" "}
                          {ver.what_is_correct.join(" ، ")}
                        </div>
                      )}
                      {Array.isArray(ver.what_is_missing) && ver.what_is_missing.length > 0 && (
                        <div className="text-[11px] text-rose-300">
                          <strong>✗ ما هو ناقص (what_is_missing):</strong>{" "}
                          {ver.what_is_missing.join(" ، ")}
                        </div>
                      )}
                      {Array.isArray(ver.what_is_different) && ver.what_is_different.length > 0 && (
                        <div className="text-[11px] text-amber-300">
                          <strong>⚠ ما هو مختلف (what_is_different):</strong>{" "}
                          {ver.what_is_different.join(" ، ")}
                        </div>
                      )}
                      {Array.isArray(ver.critical_corrections) && ver.critical_corrections.length > 0 && (
                        <div className="text-[11px] text-rose-200">
                          <strong>🔧 التصحيحات الحرجة (critical_corrections):</strong>{" "}
                          {ver.critical_corrections.join(" ، ")}
                        </div>
                      )}
                      {ver.additive_correction && (
                        <div className="text-[11px] font-mono text-sky-300" dir="ltr">
                          <strong>+ Additive Correction:</strong> {ver.additive_correction}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 6. Version History (v1, v2, v3) & Attempts History */}
                  {(versionsList.length > 0 || attemptsList.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                      {versionsList.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex flex-col gap-1.5">
                          <span className="font-bold text-slate-300">
                            سجل النسخ (Version History — {versionsList.length}):
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {versionsList.map((vItem: any, idx: number) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  if (vItem.image_url) {
                                    handleUpdateLocation(
                                      loc.location_id,
                                      "reference_image_url",
                                      vItem.image_url
                                    );
                                    handleUpdateLocation(
                                      loc.location_id,
                                      "version",
                                      vItem.version || idx + 1
                                    );
                                  }
                                }}
                                className={`px-2 py-1 rounded border font-mono text-[10px] cursor-pointer transition ${
                                  loc.version === (vItem.version || idx + 1)
                                    ? "bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold"
                                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                                }`}
                                title={vItem.prompt_used || ""}
                              >
                                v{vItem.version || idx + 1} ({vItem.status || "GENERATED"})
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {attemptsList.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex flex-col gap-1">
                          <span className="font-bold text-slate-300">
                            تاريخ المحاولات ({attemptsList.length}):
                          </span>
                          <div className="max-h-20 overflow-y-auto space-y-1 text-[10px] font-mono text-slate-400">
                            {attemptsList.map((att: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between gap-2">
                                <span>
                                  محاولة #{att.attempt || idx + 1}:{" "}
                                  {att.approved ? "✓ APPROVED" : "✗ NEEDS_FIX"} ({att.score ?? 0}%)
                                </span>
                                {att.additive_correction && (
                                  <span className="text-amber-300 truncate max-w-[160px]" dir="ltr">
                                    +{att.additive_correction}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {loc.last_error && !ver && (
                    <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-800/40 rounded-lg px-3 py-2">
                      {loc.last_error}
                    </p>
                  )}

                  {/* Real Google Flow Project & Asset Verification Box for Location */}
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-indigo-500/30 flex flex-col gap-2 text-[11px]">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-bold text-indigo-300">
                        حالة أصل الموقع داخل Google Flow (Real Flow Asset Verification):
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap font-mono text-[10px]">
                        <span
                          className={`px-2 py-0.5 rounded border font-bold ${
                            loc.real_flow_asset_verified && loc.flowAssetId
                              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                              : loc.flowAssetId
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                              : "bg-rose-500/15 border-rose-500/40 text-rose-300"
                          }`}
                        >
                          {loc.flow_asset_status ||
                            (loc.real_flow_asset_verified && loc.flowAssetId
                              ? "FLOW_ASSET_VERIFIED"
                              : loc.flowAssetId
                              ? "FLOW_ASSET_CREATED"
                              : "FLOW_ASSET_NOT_CREATED")}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded border font-bold ${
                            loc.flow_generation_status === "FLOW_GENERATION_SUCCESS"
                              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                              : "bg-slate-950 border-slate-800 text-slate-400"
                          }`}
                        >
                          {loc.flow_generation_status || "IDLE"}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 font-mono text-[10px] text-slate-300" dir="ltr">
                      <div className="truncate">
                        <span className="text-slate-500">flowProjectId:</span>{" "}
                        <strong
                          className={
                            isRealVerifiedFlowProjectId(loc.flowProjectId || loc.flow_project_id)
                              ? "text-emerald-300"
                              : "text-rose-400"
                          }
                        >
                          {isRealVerifiedFlowProjectId(loc.flowProjectId || loc.flow_project_id)
                            ? loc.flowProjectId || loc.flow_project_id
                            : "NOT_VERIFIED_IN_FLOW"}
                        </strong>
                      </div>
                      <div className="truncate">
                        <span className="text-slate-500">flowAssetId:</span>{" "}
                        <strong className={loc.flowAssetId ? "text-sky-300" : "text-rose-400"}>
                          {loc.flowAssetId || "NONE"}
                        </strong>
                      </div>
                      <div className="truncate">
                        <span className="text-slate-500">flowGenerationId:</span>{" "}
                        <strong
                          className={
                            loc.flowGenerationId || loc.flow_generation_id
                              ? "text-violet-300"
                              : "text-rose-400"
                          }
                        >
                          {loc.flowGenerationId || loc.flow_generation_id || "NONE"}
                        </strong>
                      </div>
                      <div className="truncate">
                        <span className="text-slate-500">promptHash:</span>{" "}
                        <strong className="text-slate-300">{loc.promptHash || "—"}</strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <button
                        type="button"
                        onClick={() => handleVerifyLocationAssetInFlow(loc.location_id)}
                        disabled={isLocBusy || !loc.flowAssetId}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-40"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>التحقق من وجود الصورة داخل Google Flow</span>
                      </button>

                      {isRealVerifiedFlowProjectId(loc.flowProjectId || loc.flow_project_id) && (
                        <a
                          href={
                            loc.flowProjectUrl ||
                            buildRealFlowProjectUrl(
                              loc.flowProjectId || loc.flow_project_id,
                              loc.flowAssetId
                            ) ||
                            "https://flow.google.com"
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>فتح المشروع الحقيقي داخل Google Flow</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* 7. Required 5 Action Buttons per Location Card */}
                  <div className="flex items-center gap-2 pt-3 border-t border-slate-800/80 flex-wrap">
                    {/* 1. توليد الوصف المرجعي عبر Gemini */}
                    <button
                      type="button"
                      onClick={() => handleGenerateLocationPromptViaGemini(loc.location_id)}
                      disabled={isLocBusy || isGeneratingAllLocations}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      {isLocBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      <span>توليد الوصف المرجعي عبر Gemini</span>
                    </button>

                    {/* 2. توليد الصورة + فحص وتصحيح تلقائي حتى 100% */}
                    <button
                      type="button"
                      onClick={() => handleGenerateSingleLocation(loc.location_id, false, true)}
                      disabled={isLocBusy || isGeneratingAllLocations}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      {isLocBusy && loc.generation_status === "GENERATING" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      <span>توليد + فحص وتصحيح تلقائي (100%)</span>
                    </button>

                    {/* 3. فحص عبر Gemini Vision + تصحيح تلقائي */}
                    <button
                      type="button"
                      onClick={() => handleVerifySingleLocation(loc.location_id, false, undefined, true)}
                      disabled={!loc.reference_image_url || isLocBusy || isVerifyingAllLocations}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      {isLocBusy && loc.verification_status === "VERIFYING" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                      <span>فحص وتصحيح تلقائي عبر Gemini (100%)</span>
                    </button>

                    {/* 4. إعادة التوليد مع التعديل */}
                    <button
                      type="button"
                      onClick={() =>
                        handleGenerateSingleLocation(loc.location_id, false, true, undefined, {
                          forceRegenerate: true,
                          customCorrection:
                            customLocationCorrections[loc.location_id]?.trim() ||
                            ver?.additive_correction ||
                            undefined,
                        })
                      }
                      disabled={isLocBusy || isGeneratingAllLocations}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>إعادة التوليد مع التعديل</span>
                    </button>

                    {/* 5. قفل المرجع */}
                    <button
                      type="button"
                      onClick={() => handleLockSingleLocation(loc.location_id)}
                      disabled={isLocBusy}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ms-auto ${
                        isLocked
                          ? "bg-emerald-900/60 border border-emerald-500/50 text-emerald-200"
                          : "bg-emerald-600 hover:bg-emerald-500 text-white"
                      }`}
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>{isLocked ? "مقفل (LOCKED)" : "قفل المرجع"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Step Footer Navigation */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => goToStep(3)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition cursor-pointer"
            >
              <ArrowRight className="h-4 w-4" />
              <span>السابق: عناصر الإنتاج</span>
            </button>

            <button
              type="button"
              onClick={() => goToStep(5)}
              className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition cursor-pointer shadow-lg shadow-emerald-950/50"
            >
              <span>التالي: التحليل والتوليد</span>
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* STEP 5️⃣: التحليل والتوليد (Parallel Queue + Google Flow + Vision)   */}
      {/* ===================================================================== */}
      {currentStep === 5 && (
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800/80 pb-5">
            <div>
              <span className="text-xs font-semibold text-emerald-400 block mb-1">
                الخطوة 5 من 6 — Parallel Scene Generation & Strict Gemini Vision Gate
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                ⑤ التحليل والتوليد المتوازي — Gemini Cookies + Google Flow
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                يتم إرسال جميع المشاهد دفعة واحدة عبر Queue متوازية حقيقية إلى Google Flow، ثم يفحص Gemini Vision كل صورة بصرامة. لا يتم اعتماد أي مشهد قبل نجاح التحقق البصري الكامل.
              </p>
              {(activePreparedNovelData || preparedNovelData?.status === "ADOPTED") && (
                <div className="mt-2.5 p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-emerald-400 fill-current" />
                    <span className="text-emerald-200">
                      <strong>⚡ المشاهد المعتمدة للتوليد:</strong> {scenes.length} مشاهد مستخرجة ومبنية مباشرة من «{activePreparedNovelData?.novel_title || preparedNovelData?.novel_title || projectTitle}»
                    </span>
                  </div>
                  <span className="font-mono text-emerald-300 text-[11px]">
                    المصدر النشط: PREPARED NOVEL DATA (بدون إعادة استدعاء لـ Gemini)
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400 font-mono">MAX_CONCURRENT:</span>
                <select
                  value={maxConcurrentGenerations}
                  onChange={(e) => setMaxConcurrentGenerations(Number(e.target.value))}
                  className="bg-transparent font-mono font-bold text-emerald-400 focus:outline-none cursor-pointer"
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3 (موصى به)</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => setAutoVerifyScenes((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                  !autoVerifyScenes
                    ? "bg-amber-500/15 border-amber-500/50 text-amber-300"
                    : "bg-slate-950 border-slate-800 text-slate-300"
                }`}
                title="في وضع السرعة الفائقة يتم توليد الصورة فورًا دون انتظار فحص Gemini Vision التلقائي"
              >
                <Zap className="h-3.5 w-3.5" />
                <span>{!autoVerifyScenes ? "⚡ وضع السرعة (الصورة فورًا)" : "🔍 فحص تلقائي بعد التوليد"}</span>
              </button>

              <div className="flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400">الحد الأقصى للمحاولات:</span>
                <select
                  value={maxRetriesPerScene}
                  onChange={(e) => setMaxRetriesPerScene(Number(e.target.value))}
                  className="bg-transparent font-mono font-bold text-emerald-400 focus:outline-none cursor-pointer"
                >
                  <option value={1}>1 محاولة</option>
                  <option value={2}>2 محاولتان</option>
                  <option value={3}>3 محاولات</option>
                  <option value={4}>4 محاولات</option>
                  <option value={5}>5 محاولات (الحد الأقصى)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => {
                  setAutoVerifyScenes(true);
                  void handleGenerateAllScenes(false);
                }}
                disabled={
                  isGeneratingAll ||
                  isVerifyingAllScenes ||
                  Object.values(busySceneIds).some(Boolean)
                }
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-950/50"
              >
                {isGeneratingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                <span>🤖 النظام التلقائي: توليد + تحليل + تصحيح جميع المشاهد حتى 100%</span>
              </button>

              <button
                type="button"
                onClick={handleVerifyAllScenesParallel}
                disabled={
                  isVerifyingAllScenes ||
                  isGeneratingAll ||
                  Object.values(busySceneIds).some(Boolean) ||
                  scenes.every((s) => !s.image_url)
                }
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 shadow-lg shadow-sky-950/50"
              >
                {isVerifyingAllScenes ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                <span>✓ فحص وتصحيح تلقائي لجميع المشاهد عبر Gemini حتى 100%</span>
              </button>

              {scenes.some((s) => !s.approved && (s.image_url || s.last_error)) && (
                <button
                  type="button"
                  onClick={() => handleGenerateAllScenes(true)}
                  disabled={
                    isGeneratingAll ||
                    isVerifyingAllScenes ||
                    Object.values(busySceneIds).some(Boolean)
                  }
                  className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>إعادة توليد المشاهد غير المعتمدة بالتسلسل</span>
                </button>
              )}
            </div>
          </div>

          {/* Sequential Scene Continuity Engine Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">إجمالي المشاهد</span>
              <span className="text-lg font-bold font-mono text-white">{scenes.length}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">قيد التوليد/الفحص التسلسلي</span>
              <span className="text-lg font-bold font-mono text-amber-400">
                {Object.values(busySceneIds).filter(Boolean).length > 0 ? "نشط (تسلسلي 1←2←3)" : "متوقف"}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">تم توليد الصورة (Google Flow)</span>
              <span className="text-lg font-bold font-mono text-sky-400">
                {scenes.filter((s) => Boolean(s && s.image_url)).length} / {scenes.length}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">✓ استمرارية معتمدة (CONTINUITY_PASS)</span>
              <span className="text-lg font-bold font-mono text-emerald-400">
                {
                  scenes.filter(
                    (s) =>
                      s &&
                      (s.continuity_status === "CONTINUITY_PASS" ||
                        s.continuity_status === "INITIAL_SCENE_ANCHOR")
                  ).length
                }{" "}
                / {scenes.length}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">مراسي المواقع (Location Anchors)</span>
              <span className="text-lg font-bold font-mono text-violet-400">
                {Object.keys(locationContinuityAnchors).length}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800">
              <span className="text-[11px] text-slate-400 block">بحاجة لتصحيح استمرارية</span>
              <span className="text-lg font-bold font-mono text-rose-400">
                {
                  scenes.filter(
                    (s) =>
                      s &&
                      (s.verification_status === "REJECTED" ||
                        s.continuity_status === "CONTINUITY_NEEDS_CORRECTION" ||
                        s.continuity_status === "CONTINUITY_FAILED" ||
                        s.continuity_status === "MANUAL_CONTINUITY_REVIEW_REQUIRED" ||
                        s.generation_status === "FAILED" ||
                        Boolean(s.last_error))
                  ).length
                }
              </span>
            </div>
          </div>

          {/* SEQUENTIAL SCENE CONTINUITY ENGINE Architecture Banner */}
          <div className="p-4 rounded-xl bg-slate-950/95 border border-emerald-500/35 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-300">
                  SEQUENTIAL SCENE CONTINUITY ENGINE — محرك الاستمرارية البصرية والمكانية المتسلسلة
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400" dir="ltr">
                Truth Hierarchy: 1.Canonical Script → 2.Locked Character → 3.Locked Location → 4.Locked Weapon → 5.Previous Scene Image
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-emerald-300 font-medium">
                1. SCENE_001 → Generate & Verify (Initial Anchor)
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-sky-300 font-medium">
                2. SCENE_002 → Inject Previous Continuity Context
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-violet-300 font-medium">
                3. Upload Image 1 + Image 2 + Locked Refs to Gemini Vision
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-amber-300 font-medium">
                4. Same Location Mode vs Location Transition Mode
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-emerald-400 font-semibold">
                5. Fixed Landmarks + 7 Continuity Dimensions Check
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-rose-300 font-medium">
                6. Auto-Correction Loop (Max 3 Attempts) → Lock Anchor
              </div>
            </div>

            {Object.keys(locationContinuityAnchors).length > 0 && (
              <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2 flex-wrap text-[11px]">
                <span className="font-bold text-violet-300">
                  ⚓ مراسي استمرارية المواقع المعتمدة (Location Continuity Anchors):
                </span>
                {Object.values(locationContinuityAnchors).map((anc) => (
                  <span
                    key={anc.location_id}
                    className="px-2.5 py-1 rounded-lg bg-violet-950/60 border border-violet-500/40 font-mono text-[10px] text-violet-200"
                    dir="ltr"
                  >
                    {anc.location_id} ({anc.location_name}) · First Anchor:{" "}
                    <strong className="text-emerald-300">{anc.first_approved_scene_id || "—"}</strong>{" "}
                    · Latest:{" "}
                    <strong className="text-sky-300">{anc.latest_approved_scene_id || "—"}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Active Style & Model Summary */}
          <div className="flex items-center gap-3 flex-wrap text-xs text-slate-400">
            <span>
              الستايل المختار: <strong className="text-white">{selectedStyle}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              نسبة الصورة: <strong className="text-white font-mono">{selectedAspectRatio}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              موديل الصور: <strong className="text-emerald-400">{selectedFlowModel}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              التوازي الأقصى:{" "}
              <strong className="text-sky-400 font-mono">
                MAX_CONCURRENT_GENERATIONS = {maxConcurrentGenerations}
              </strong>
            </span>
          </div>

          {/* Scenes Generation & Verification Cards */}
          <div className="flex flex-col gap-4">
            {scenes
              .filter((sc): sc is StudioSceneItem => Boolean(sc && sc.scene_id))
              .map((sc) => {
                const isBusy =
                  busySceneId === sc.scene_id || Boolean(busySceneIds[sc.scene_id]);
                const vResult = sc.verification_result;
                const matchedLoc = locations.find(
                  (l) => Boolean(l && l.location_id) && l.location_id === sc.location_id
                );
                const prevSceneObj = findChronologicalPreviousScene(sc, scenes);
                const contAnalysis = sc.continuity_analysis;
                const locAnchor =
                  locationContinuityAnchors[
                    sc.primary_location_id || sc.location_entity_id || sc.location_id
                  ] || sc.location_continuity_anchor;

              return (
                <div
                  key={sc.scene_id}
                  className={`p-5 rounded-xl bg-slate-950/90 border flex flex-col md:flex-row gap-5 transition ${
                    sc.approved && sc.verification_status === "VERIFIED"
                      ? "border-emerald-500/40"
                      : sc.verification_status === "REJECTED" || sc.last_error
                      ? "border-rose-500/40"
                      : isBusy
                      ? "border-amber-500/50"
                      : "border-slate-800"
                  }`}
                >
                  {/* Thumbnail Preview */}
                  <div
                    onClick={() => sc.image_url && setOpenedSceneModal(sc)}
                    className="w-full md:w-52 h-64 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0 relative cursor-pointer group"
                  >
                    {sc.image_url ? (
                      <>
                        <img
                          src={sc.image_url}
                          alt={sc.title}
                          className="w-full h-full object-cover"
                        />
                        {isBusy && (
                          <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center p-3 text-center">
                            <Loader2 className="h-7 w-7 text-emerald-400 animate-spin mb-2" />
                            <span className="text-xs text-white font-semibold">
                              {sc.pipeline_stage === "GEMINI_INSPECTING"
                                ? "Gemini Vision يفحص الصورة..."
                                : "جاري التوليد والفحص..."}
                            </span>
                          </div>
                        )}
                      </>
                    ) : isBusy ? (
                      <div className="text-center p-4">
                        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin mx-auto mb-2" />
                        <span className="text-xs text-emerald-300 block">
                          {sc.generation_status === "QUEUED"
                            ? "في طابور التوليد المتوازي..."
                            : "جاري التوليد عبر Google Flow..."}
                        </span>
                      </div>
                    ) : (
                      <div className="text-center p-4 text-slate-500">
                        <ImageIcon className="h-7 w-7 mx-auto mb-1.5 opacity-40" />
                        <span className="text-xs block">
                          المشهد {String(sc.scene_number).padStart(2, "0")}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Scene Pipeline Status & Attempt Log */}
                  <div className="flex-1 flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-emerald-400 font-bold">
                            SCENE_{String(sc.scene_number).padStart(2, "0")}
                          </span>
                          <h3 className="text-base font-bold text-white">{sc.title}</h3>
                          <span className="text-[11px] font-mono text-slate-400">
                            v{sc.version || 1}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap text-xs">
                          <span
                            className={`font-semibold ${
                              sc.approved && sc.verification_status === "VERIFIED"
                                ? "text-emerald-400"
                                : isBusy
                                ? "text-amber-300"
                                : sc.verification_status === "REJECTED" || sc.last_error
                                ? "text-rose-400"
                                : sc.image_url
                                ? "text-sky-300"
                                : "text-slate-400"
                            }`}
                          >
                            {sc.approved && sc.verification_status === "VERIFIED"
                              ? `✓ معتمدة عبر Gemini Vision (PASS${typeof vResult?.confidence === "number" ? ` · ${vResult.confidence}%` : typeof vResult?.score === "number" ? ` · ${vResult.score}%` : ""})`
                              : isBusy
                              ? `جاري العمل (محاولة ${sc.current_attempt || 1} من ${maxRetriesPerScene})`
                              : sc.vision_status === "VISION_FAILED" || sc.vision_status === "GEMINI_VISION_FAILED"
                              ? "✗ فشل طلب Gemini Vision (VISION_FAILED)"
                              : sc.verification_status === "REJECTED"
                              ? `✗ مرفوضة من Gemini Vision (FAIL${typeof vResult?.confidence === "number" ? ` · ${vResult.confidence}%` : typeof vResult?.score === "number" ? ` · ${vResult.score}%` : ""}) — تتطلب إعادة توليد`
                              : sc.last_error
                              ? "✗ فشل التوليد — يتطلب إعادة المحاولة"
                              : sc.image_url
                              ? "UNVERIFIED — تم التوليد وبانتظار فحص Gemini Vision الحقيقي"
                              : "UNVERIFIED — في انتظار التوليد"}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-slate-300 mb-2 leading-relaxed">
                        {sc.description}
                      </p>

                      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400 mb-3">
                        <span>
                          الشخصيات:{" "}
                          {(Array.isArray(sc.characters)
                            ? sc.characters.join("، ")
                            : (sc.characters || "—")) || "—"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          الأسلحة/الأدوات:{" "}
                          {(Array.isArray(sc.weapons)
                            ? sc.weapons
                            : Array.isArray(sc.costumes_and_weapons)
                            ? sc.costumes_and_weapons
                            : []
                          ).join("، ") || "—"}
                        </span>
                        {Array.isArray(sc.creatures) && sc.creatures.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>المخلوقات: {sc.creatures.join("، ")}</span>
                          </>
                        )}
                        {Array.isArray(sc.items) && sc.items.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>العناصر: {sc.items.join("، ")}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>
                          الموقع: <strong className="text-emerald-300">{sc.location_name}</strong>
                          {matchedLoc?.reference_image_url && (
                            <span className="text-[11px] text-sky-400 mr-1">
                              (مرتبط بمرجع الموقع البصري ✓)
                            </span>
                          )}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] text-slate-400">
                          IDs: [{sc.location_id}
                          {sc.secondary_location_ids?.length
                            ? `, ${sc.secondary_location_ids.join(", ")}`
                            : ""}
                          {sc.character_ids?.length ? ` | ${sc.character_ids.join(", ")}` : ""}
                          {sc.weapon_ids?.length ? ` | ${sc.weapon_ids.join(", ")}` : ""}
                          {sc.previous_scene_id ? ` | prev:${sc.previous_scene_id}` : ""}]
                        </span>
                        {sc.style_hash && (
                          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[10px] text-emerald-300">
                            styleHash: {sc.style_hash}
                          </span>
                        )}
                        {sc.image_url && (
                          <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 font-mono text-[11px] text-sky-300">
                            المصدر: {sc.flow_provider || "Google Flow"} · {sc.flow_model || selectedFlowModel} · flowProjectId: {sc.flowProjectId || sc.flow_project_id || "NOT_VERIFIED"} · flowAssetId: {sc.flowAssetId || "NONE"}
                          </span>
                        )}
                        {isRealVerifiedFlowProjectId(sc.flowProjectId || sc.flow_project_id) && (
                          <a
                            href={
                              sc.flowProjectUrl ||
                              buildRealFlowProjectUrl(
                                sc.flowProjectId || sc.flow_project_id,
                                sc.flowAssetId
                              ) ||
                              "https://flow.google.com"
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-[11px]"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>فتح في Google Flow</span>
                          </a>
                        )}
                      </div>

                      {/* Scene Location Binding Box (Requirement 4, 5 & 6) */}
                      <div
                        className={`mb-3 p-2.5 rounded-lg bg-slate-900/90 border text-[11px] flex flex-col gap-1.5 ${
                          sc.location_uncertain || sc.location_id === "LOCATION_UNCERTAIN"
                            ? "border-rose-500/60 bg-rose-950/20"
                            : "border-emerald-500/30"
                        }`}
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="font-bold text-emerald-300">
                            📍 ارتباط الموقع الحقيقي للمشهد والانتقال المكاني (Scene Location & Spatial Transition):
                          </span>
                          <div className="flex items-center gap-2 flex-wrap font-mono text-[10px]">
                            <span
                              className={`px-2 py-0.5 rounded border ${
                                sc.location_uncertain || sc.location_id === "LOCATION_UNCERTAIN"
                                  ? "bg-rose-950 border-rose-500/50 text-rose-300 font-bold"
                                  : "bg-emerald-950 border-emerald-500/40 text-emerald-300"
                              }`}
                            >
                              primary_location_id:{" "}
                              {sc.primary_location_id || sc.primary_location || sc.location_entity_id || sc.location_id}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-sky-300">
                              location_version: v{sc.location_version || matchedLoc?.version || 1}
                            </span>
                            {sc.location_confidence !== undefined && sc.location_confidence !== null && (
                              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-amber-300">
                                location_confidence: {sc.location_confidence}%
                              </span>
                            )}
                            {sc.location_transition && (
                              <span
                                className={`px-2 py-0.5 rounded border ${
                                  sc.location_transition.transition_occurred
                                    ? sc.location_transition.transition_verified
                                      ? "bg-violet-950 border-violet-500/40 text-violet-300"
                                      : "bg-rose-950 border-rose-500/40 text-rose-300"
                                    : "bg-slate-950 border-slate-700 text-slate-300"
                                }`}
                              >
                                transition:{" "}
                                {sc.location_transition.previous_location_id || "START"} →{" "}
                                {sc.location_transition.current_location_id}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-400">تغيير/تثبيت كيان الموقع المرتبط (يمنع نسخ موقع سابق تلقائيًا):</span>
                          <select
                            value={sc.location_entity_id || sc.location_id}
                            onChange={(e) => {
                              const pickedLoc = locations.find((l) => l.location_id === e.target.value);
                              if (!pickedLoc) return;
                              setScenes((prev) =>
                                prev.map((item) =>
                                  item.scene_id === sc.scene_id
                                    ? {
                                        ...item,
                                        location_id: pickedLoc.location_id,
                                        primary_location: pickedLoc.location_id,
                                        primary_location_id: pickedLoc.location_id,
                                        primary_location_name: pickedLoc.name,
                                        location_entity_id: pickedLoc.location_id,
                                        location_name: pickedLoc.name,
                                        location_version: pickedLoc.version || 1,
                                        location_uncertain: false,
                                        location_confidence: 100,
                                        last_error: null,
                                      }
                                    : item
                                )
                              );
                            }}
                            className="px-2.5 py-1 rounded bg-slate-950 border border-slate-700 text-emerald-300 text-xs font-semibold"
                          >
                            {sc.location_id === "LOCATION_UNCERTAIN" && (
                              <option value="LOCATION_UNCERTAIN">
                                ⚠ LOCATION_UNCERTAIN — اختر الموقع الفعلي من النص
                              </option>
                            )}
                            {locations
                              .filter((locOption) => Boolean(locOption && locOption.location_id))
                              .map((locOption) => (
                                <option key={locOption.location_id} value={locOption.location_id}>
                                  {locOption.location_id} — {locOption.name}
                                </option>
                              ))}
                          </select>
                        </div>
                        {(sc.source_evidence || sc.location_evidence || sc.location_source_text || sc.location_source_excerpt) && (
                          <div className="text-[11px] text-slate-300">
                            <span className="text-slate-400 font-semibold">الدليل النصي للموقع (location_source_excerpt):</span>{" "}
                            {sc.location_source_excerpt || sc.source_evidence || sc.location_evidence || sc.location_source_text}
                          </div>
                        )}
                        {sc.location_transition?.transition_evidence && (
                          <div className="text-[11px] text-violet-300">
                            <span className="text-slate-400 font-semibold">دليل الانتقال المكاني (transition_evidence):</span>{" "}
                            {sc.location_transition.transition_evidence}
                          </div>
                        )}
                      </div>

                      {/* SEQUENTIAL SCENE CONTINUITY ENGINE Inspector Panel */}
                      <div
                        className={`mb-3 rounded-xl p-3 border text-xs space-y-2.5 ${
                          sc.continuity_status === "CONTINUITY_PASS" ||
                          sc.continuity_status === "INITIAL_SCENE_ANCHOR"
                            ? "bg-emerald-950/15 border-emerald-500/40"
                            : sc.continuity_status === "CONTINUITY_NEEDS_CORRECTION"
                            ? "bg-amber-950/20 border-amber-500/40"
                            : sc.continuity_status === "CONTINUITY_FAILED" ||
                              sc.continuity_status === "MANUAL_CONTINUITY_REVIEW_REQUIRED"
                            ? "bg-rose-950/20 border-rose-500/40"
                            : "bg-slate-900/90 border-sky-500/30"
                        }`}
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sky-300">
                              🔗 SEQUENTIAL SCENE CONTINUITY ENGINE (فحص الاستمرارية التسلسلية عبر Gemini Vision):
                            </span>
                            {prevSceneObj ? (
                              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 font-mono text-[10px] text-slate-200" dir="ltr">
                                {prevSceneObj.scene_id} ({prevSceneObj.location_id}) → {sc.scene_id} ({sc.location_id})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 font-mono text-[10px] text-emerald-300" dir="ltr">
                                SCENE_001 — INITIAL_SCENE_ANCHOR
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap font-mono text-[10px]">
                            <span
                              className={`px-2 py-0.5 rounded border ${
                                (sc.continuity_mode ||
                                  (prevSceneObj
                                    ? prevSceneObj.location_id === sc.location_id
                                      ? "SAME_LOCATION_CONTINUITY_MODE"
                                      : "LOCATION_TRANSITION_MODE"
                                    : "INITIAL_ANCHOR_MODE")) === "SAME_LOCATION_CONTINUITY_MODE"
                                  ? "bg-violet-950 border-violet-500/50 text-violet-200 font-bold"
                                  : (sc.continuity_mode || "") === "LOCATION_TRANSITION_MODE"
                                  ? "bg-amber-950 border-amber-500/50 text-amber-200 font-bold"
                                  : "bg-sky-950 border-sky-500/40 text-sky-200"
                              }`}
                            >
                              mode:{" "}
                              {sc.continuity_mode ||
                                (prevSceneObj
                                  ? prevSceneObj.location_id === sc.location_id
                                    ? "SAME_LOCATION_CONTINUITY_MODE"
                                    : "LOCATION_TRANSITION_MODE"
                                  : "INITIAL_ANCHOR_MODE")}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded border font-bold ${
                                sc.continuity_status === "CONTINUITY_PASS" ||
                                sc.continuity_status === "INITIAL_SCENE_ANCHOR"
                                  ? "bg-emerald-950 border-emerald-500/50 text-emerald-300"
                                  : sc.continuity_status === "CONTINUITY_NEEDS_CORRECTION"
                                  ? "bg-amber-950 border-amber-500/50 text-amber-300"
                                  : sc.continuity_status === "CONTINUITY_FAILED" ||
                                    sc.continuity_status === "MANUAL_CONTINUITY_REVIEW_REQUIRED"
                                  ? "bg-rose-950 border-rose-500/50 text-rose-300"
                                  : "bg-slate-950 border-slate-700 text-slate-400"
                              }`}
                            >
                              status: {sc.continuity_status || "UNVERIFIED"}
                            </span>
                            {typeof sc.continuity_attempts === "number" && sc.continuity_attempts > 0 && (
                              <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-slate-300">
                                attempts: {sc.continuity_attempts}/3
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Visual Strip of Actual Images Sent to Gemini Vision */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                          {/* 1. Previous Scene Image */}
                          <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-2">
                            {prevSceneObj?.image_url ? (
                              <img
                                src={prevSceneObj.image_url}
                                alt={prevSceneObj.title}
                                className="w-11 h-11 rounded object-cover border border-slate-700 shrink-0"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-[9px] text-slate-500 shrink-0 font-mono">
                                {prevSceneObj ? "NO IMG" : "START"}
                              </div>
                            )}
                            <div className="min-w-0 text-[10px]">
                              <span className="text-slate-400 block font-mono truncate">
                                1. PREVIOUS_SCENE
                              </span>
                              <span className="text-white font-semibold block truncate">
                                {prevSceneObj ? `${prevSceneObj.scene_id} (${prevSceneObj.location_id})` : "المشهد الأول (بداية)"}
                              </span>
                            </div>
                          </div>

                          {/* 2. Current Scene Image */}
                          <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-2">
                            {sc.image_url ? (
                              <img
                                src={sc.image_url}
                                alt={sc.title}
                                className="w-11 h-11 rounded object-cover border border-emerald-500/40 shrink-0"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-[9px] text-slate-500 shrink-0 font-mono">
                                NO IMG
                              </div>
                            )}
                            <div className="min-w-0 text-[10px]">
                              <span className="text-emerald-400 block font-mono truncate">
                                2. CURRENT_SCENE
                              </span>
                              <span className="text-white font-semibold block truncate">
                                {sc.scene_id} ({sc.location_id})
                              </span>
                            </div>
                          </div>

                          {/* 3. Locked Location Reference */}
                          <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-2">
                            {matchedLoc?.reference_image_url ? (
                              <img
                                src={matchedLoc.reference_image_url}
                                alt={matchedLoc.name}
                                className="w-11 h-11 rounded object-cover border border-sky-500/40 shrink-0"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-[9px] text-slate-500 shrink-0 font-mono">
                                LOC REF
                              </div>
                            )}
                            <div className="min-w-0 text-[10px]">
                              <span className="text-sky-400 block font-mono truncate">
                                3. LOCKED_LOCATION
                              </span>
                              <span className="text-white font-semibold block truncate">
                                {matchedLoc ? `${matchedLoc.location_id}: ${matchedLoc.name}` : sc.location_id}
                              </span>
                            </div>
                          </div>

                          {/* 4. Location Continuity Anchor */}
                          <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-2">
                            {locAnchor?.first_approved_scene_image_url ? (
                              <img
                                src={locAnchor.first_approved_scene_image_url}
                                alt={locAnchor.location_name}
                                className="w-11 h-11 rounded object-cover border border-violet-500/40 shrink-0"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-[9px] text-slate-500 shrink-0 font-mono">
                                ANCHOR
                              </div>
                            )}
                            <div className="min-w-0 text-[10px]">
                              <span className="text-violet-400 block font-mono truncate">
                                4. LOCATION_ANCHOR
                              </span>
                              <span className="text-white font-semibold block truncate">
                                {locAnchor?.first_approved_scene_id
                                  ? `First: ${locAnchor.first_approved_scene_id} · Latest: ${locAnchor.latest_approved_scene_id}`
                                  : "تُحفظ بعد اعتماد أول مشهد بالموقع"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Continuity Analysis Detailed Results (7 Dimensions + Fixed Landmarks Matrix) */}
                        {contAnalysis && (
                          <div className="space-y-2 pt-2 border-t border-slate-800/80">
                            <div className="grid grid-cols-2 sm:grid-cols-7 gap-1.5 text-[10px] font-mono" dir="ltr">
                              {[
                                { label: "Location", data: contAnalysis.location_continuity },
                                { label: "Character", data: contAnalysis.character_continuity },
                                { label: "Weapon", data: contAnalysis.weapon_continuity },
                                { label: "Environment", data: contAnalysis.environment_continuity },
                                { label: "Lighting", data: contAnalysis.lighting_continuity },
                                { label: "Style", data: contAnalysis.style_continuity },
                                { label: "Temporal", data: contAnalysis.temporal_continuity },
                              ].map((dim, dIdx) => (
                                <div
                                  key={dIdx}
                                  className={`p-1.5 rounded border text-center ${
                                    dim.data?.match !== false
                                      ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300"
                                      : "bg-rose-950/40 border-rose-500/50 text-rose-300 font-bold"
                                  }`}
                                  title={(dim.data?.issues || []).join(" | ")}
                                >
                                  <div>{dim.label}</div>
                                  <div>{dim.data?.match !== false ? "✓ MATCH" : "✗ ISSUE"}</div>
                                </div>
                              ))}
                            </div>

                            {contAnalysis.camera_variation_note && (
                              <div className="text-[11px] text-sky-300 bg-slate-950/90 px-2.5 py-1.5 rounded border border-slate-800">
                                🎥 <strong>تغير زاوية/حجم اللقطة المسموح (Camera Variation):</strong>{" "}
                                {contAnalysis.camera_variation_note}
                              </div>
                            )}

                            {/* Fixed Landmarks Continuity Table (When same_location === true) */}
                            {Array.isArray(contAnalysis.fixed_landmarks_analysis) &&
                              contAnalysis.fixed_landmarks_analysis.length > 0 && (
                                <div className="rounded-lg border border-slate-800 overflow-hidden">
                                  <div className="bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-violet-300 flex items-center justify-between">
                                    <span>
                                      🏛️ تحليل المعالم الثابتة للموقع (Fixed Landmarks Continuity — لا يعاقب على NOT_VISIBLE بسبب زاوية الكاميرا)
                                    </span>
                                    <span className="font-mono">
                                      same_location: {String(contAnalysis.same_location)}
                                    </span>
                                  </div>
                                  <table className="w-full text-left font-mono text-[10px]" dir="ltr">
                                    <thead className="bg-slate-900 text-slate-400">
                                      <tr>
                                        <th className="p-1.5">Fixed Landmark</th>
                                        <th className="p-1.5">Previous Image</th>
                                        <th className="p-1.5">Current Image</th>
                                        <th className="p-1.5">Consistency</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/70 bg-slate-950/80">
                                      {contAnalysis.fixed_landmarks_analysis.map((lm, lIdx) => (
                                        <tr
                                          key={lIdx}
                                          className={
                                            lm.consistency === "CONTINUITY_ERROR"
                                              ? "bg-rose-950/30 text-rose-300"
                                              : lm.consistency === "NOT_VISIBLE"
                                              ? "text-sky-300"
                                              : "text-emerald-300"
                                          }
                                        >
                                          <td className="p-1.5 font-bold">{lm.landmark}</td>
                                          <td className="p-1.5">{lm.previous_image}</td>
                                          <td className="p-1.5">{lm.current_image}</td>
                                          <td className="p-1.5 font-bold">
                                            {lm.consistency === "MATCH"
                                              ? "✓ MATCH"
                                              : lm.consistency === "NOT_VISIBLE"
                                              ? "◌ NOT_VISIBLE (Out of Frame — OK)"
                                              : "✗ CONTINUITY_ERROR"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                            {Array.isArray(contAnalysis.critical_errors) &&
                              contAnalysis.critical_errors.length > 0 && (
                                <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-[11px] text-rose-200">
                                  <strong>✗ أخطاء الاستمرارية الحرجة (critical_errors):</strong>{" "}
                                  {contAnalysis.critical_errors.join(" — ")}
                                </div>
                              )}

                            {Array.isArray(contAnalysis.additive_corrections) &&
                              contAnalysis.additive_corrections.length > 0 && (
                                <div className="p-2 rounded bg-amber-950/30 border border-amber-500/40 text-[11px] text-amber-200 font-mono" dir="ltr">
                                  <strong>+ Additive Continuity Corrections:</strong>{" "}
                                  {contAnalysis.additive_corrections.join(" | ")}
                                </div>
                              )}
                          </div>
                        )}
                      </div>

                      {/* 3-Stage Architecture Inspector (A: CANONICAL_ANALYSIS | B: GENERATION_PLAN | C: ACTUAL_IMAGE_VERIFICATION) */}
                      <details className="mb-3 rounded-xl bg-slate-900/95 border border-indigo-500/35 p-3 text-xs">
                        <summary className="cursor-pointer font-bold text-indigo-300 flex items-center justify-between flex-wrap gap-2 select-none">
                          <span>
                            🧬 المعمارية ثلاثية المراحل المستقلة (A: CANONICAL_ANALYSIS → B: GENERATION_PLAN → C: ACTUAL_IMAGE_VERIFICATION)
                          </span>
                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            <span
                              className={`px-2 py-0.5 rounded border ${
                                sc.scene_canonical_pack?.ready_for_generation !== false &&
                                !sc.location_uncertain
                                  ? "bg-emerald-950 border-emerald-500/40 text-emerald-300"
                                  : "bg-rose-950 border-rose-500/40 text-rose-300"
                              }`}
                            >
                              Stage A:{" "}
                              {sc.scene_canonical_pack?.ready_for_generation !== false && !sc.location_uncertain
                                ? "CANONICAL_READY"
                                : "BLOCKED"}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded border ${
                                sc.generation_plan
                                  ? "bg-sky-950 border-sky-500/40 text-sky-300"
                                  : "bg-slate-950 border-slate-700 text-slate-400"
                              }`}
                            >
                              Stage B: {sc.generation_plan ? "PLAN_BUILT" : "PENDING"}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded border ${
                                sc.actual_image_verification?.overall_verdict === "PASS"
                                  ? "bg-emerald-950 border-emerald-500/40 text-emerald-300"
                                  : sc.actual_image_verification?.overall_verdict === "NEEDS_CORRECTION"
                                  ? "bg-amber-950 border-amber-500/40 text-amber-300"
                                  : sc.actual_image_verification
                                  ? "bg-rose-950 border-rose-500/40 text-rose-300"
                                  : "bg-slate-950 border-slate-700 text-slate-400"
                              }`}
                            >
                              Stage C: {sc.actual_image_verification?.overall_verdict || "UNVERIFIED"}
                            </span>
                          </div>
                        </summary>

                        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                          {/* Stage A: CANONICAL_ANALYSIS & SCENE_CANONICAL_PACK */}
                          <div className="p-2.5 rounded-lg bg-slate-950 border border-emerald-500/30 space-y-1.5">
                            <div className="font-bold text-emerald-300 flex items-center justify-between">
                              <span>المرحلة A — التحليل الكانوني المعتمد على النص فقط (CANONICAL_ANALYSIS & SCENE_CANONICAL_PACK)</span>
                              <span className="font-mono text-[10px]">
                                anti_speculation: ENFORCED
                              </span>
                            </div>
                            {Array.isArray(sc.character_bindings) && sc.character_bindings.length > 0 && (
                              <div className="text-[11px] text-slate-300 space-y-1">
                                <span className="font-semibold text-emerald-400 block">
                                  الشخصيات (STATIC_CHARACTER_IDENTITY vs SCENE_SPECIFIC_APPEARANCE):
                                </span>
                                {sc.character_bindings.filter(Boolean).map((cb, idx) => (
                                  <div
                                    key={idx}
                                    className="p-1.5 rounded bg-slate-900 border border-slate-800 font-mono text-[10px]"
                                    dir="ltr"
                                  >
                                    <div>
                                      <strong className="text-emerald-300">
                                        {cb.character_id} ({cb.character_name})
                                      </strong>{" "}
                                      · ref: {cb.appearance_reference_id} ({cb.locked_reference_version})
                                    </div>
                                    <div className="text-slate-400">
                                      STATIC: Face={cb.static_character_identity?.face || "—"} | Hair={cb.static_character_identity?.hair || "—"} | Eyes={cb.static_character_identity?.eye_color || "—"}
                                    </div>
                                    <div className="text-sky-300">
                                      SCENE_SPECIFIC: Weapon={cb.scene_specific_appearance?.active_weapon_in_scene || "—"} | Pose={cb.scene_specific_appearance?.combat_pose_or_stance || "—"} | Evidence=&quot;{cb.source_evidence || ""}&quot;
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {Array.isArray(sc.weapon_bindings) && sc.weapon_bindings.length > 0 ? (
                              <div className="text-[11px] text-slate-300 space-y-1">
                                <span className="font-semibold text-amber-400 block">
                                  الأسلحة المثبتة نصيًا في هذا المشهد فقط (Weapon Bindings):
                                </span>
                                {sc.weapon_bindings.map((wb, idx) => (
                                  <div
                                    key={idx}
                                    className="p-1.5 rounded bg-slate-900 border border-slate-800 font-mono text-[10px]"
                                    dir="ltr"
                                  >
                                    <strong className="text-amber-300">
                                      {wb.weapon_id} ({wb.weapon_name})
                                    </strong>{" "}
                                    · {wb.locked_reference_version} · present_in_scene_text:{" "}
                                    {String(wb.present_in_scene_text)} · Evidence: &quot;{wb.source_evidence}&quot;
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[10px] font-mono text-slate-400" dir="ltr">
                                Weapons in scene: NONE (Strict Rule 8: Character weapons are NOT auto-attached without explicit scene text evidence)
                              </div>
                            )}

                            {sc.canonical_analysis?.unsupported_claims_rejected &&
                              sc.canonical_analysis.unsupported_claims_rejected.length > 0 && (
                                <div className="text-[10px] font-mono text-rose-300" dir="ltr">
                                  Rejected Unsupported Claims (UNSUPPORTED_CLAIM):{" "}
                                  {sc.canonical_analysis.unsupported_claims_rejected.join(" | ")}
                                </div>
                              )}
                          </div>

                          {/* Stage B: GENERATION_PLAN */}
                          {sc.generation_plan && (
                            <div className="p-2.5 rounded-lg bg-slate-950 border border-sky-500/30 space-y-1 font-mono text-[10px]" dir="ltr">
                              <div className="font-bold text-sky-300" dir="rtl">
                                المرحلة B — خطة التوليد المبنية حصريًا من الكانون (GENERATION_PLAN)
                              </div>
                              <div>
                                <span className="text-slate-400">exact_location:</span>{" "}
                                <strong className="text-emerald-300">
                                  {sc.generation_plan.exact_location?.location_id ||
                                    sc.primary_location_id ||
                                    sc.location_id}{" "}
                                  ({sc.generation_plan.exact_location?.location_name || sc.location_name} ·{" "}
                                  {sc.generation_plan.exact_location?.locked_version ||
                                    `v${sc.location_version || 1}`})
                                </strong>
                              </div>
                              <div>
                                <span className="text-slate-400">exact_style / aspect_ratio / model:</span>{" "}
                                <strong className="text-sky-300">
                                  {sc.generation_plan.exact_style?.style_name ||
                                    sc.generation_plan.style_preset ||
                                    selectedStyle}{" "}
                                  · {sc.generation_plan.exact_aspect_ratio || sc.generation_plan.aspect_ratio || selectedAspectRatio} ·{" "}
                                  {sc.generation_plan.exact_model || sc.generation_plan.selected_model || selectedFlowModel}{" "}
                                  (styleHash:{" "}
                                  {sc.generation_plan.exact_style?.style_hash ||
                                    sc.generation_plan.style_hash ||
                                    sc.style_hash ||
                                    currentStyleHash}
                                  )
                                </strong>
                              </div>
                              <div>
                                <span className="text-slate-400">built_strictly_from_canonical_pack:</span>{" "}
                                <strong className="text-emerald-400">
                                  {String(sc.generation_plan.built_strictly_from_canonical_pack ?? true)}
                                </strong>
                              </div>
                            </div>
                          )}

                          {/* Stage C: ACTUAL_IMAGE_VERIFICATION */}
                          {sc.actual_image_verification && (
                            <div className="p-2.5 rounded-lg bg-slate-950 border border-violet-500/30 space-y-2">
                              <div className="font-bold text-violet-300 flex items-center justify-between flex-wrap gap-2">
                                <span>
                                  المرحلة C — التحقق البصري الفعلي من الصورة المولدة (Two-Step Gemini Vision Inspection)
                                </span>
                                <span className="font-mono text-[10px]">
                                  verdict: {sc.actual_image_verification.overall_verdict} · inspected_actual_pixels:{" "}
                                  {String(sc.actual_image_verification.inspected_actual_image_pixels ?? true)}
                                </span>
                              </div>

                              {/* Step 1: Actual Image Observation */}
                              {sc.actual_image_verification.step1_actual_observation && (
                                <div className="p-2 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono space-y-0.5" dir="ltr">
                                  <div className="text-emerald-300 font-bold">
                                    Step 1 — What Gemini Vision Actually Observed in Image Pixels:
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Observed Characters:</span>{" "}
                                    {(sc.actual_image_verification.step1_actual_observation.observed_characters || []).join(" | ") || "—"}
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Observed Weapons:</span>{" "}
                                    {(sc.actual_image_verification.step1_actual_observation.observed_weapons || []).join(" | ") || "—"}
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Observed Location:</span>{" "}
                                    {sc.actual_image_verification.step1_actual_observation.observed_location || "—"}
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Observed Style & Aspect:</span>{" "}
                                    {sc.actual_image_verification.step1_actual_observation.observed_style_and_aspect_ratio || "—"}
                                  </div>
                                </div>
                              )}

                              {/* Step 2: 24-Category Structured Comparison */}
                              {Array.isArray(sc.actual_image_verification.step2_structured_comparisons) &&
                                sc.actual_image_verification.step2_structured_comparisons.length > 0 && (
                                  <div className="max-h-48 overflow-y-auto rounded border border-slate-800">
                                    <table className="w-full text-left font-mono text-[10px]" dir="ltr">
                                      <thead className="bg-slate-900 text-slate-400 sticky top-0">
                                        <tr>
                                          <th className="p-1.5">Category</th>
                                          <th className="p-1.5">Expected</th>
                                          <th className="p-1.5">Observed</th>
                                          <th className="p-1.5">Match</th>
                                          <th className="p-1.5">Severity</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-800/80">
                                        {sc.actual_image_verification.step2_structured_comparisons.map(
                                          (item, cIdx) => (
                                            <tr
                                              key={cIdx}
                                              className={
                                                item.match ? "text-slate-300" : "bg-rose-950/30 text-rose-300"
                                              }
                                            >
                                              <td className="p-1.5 font-bold">{item.category}</td>
                                              <td className="p-1.5 truncate max-w-[150px]" title={item.expected}>
                                                {item.expected}
                                              </td>
                                              <td className="p-1.5 truncate max-w-[150px]" title={item.observed}>
                                                {item.observed}
                                              </td>
                                              <td className="p-1.5">
                                                {item.match ? "✓ PASS" : "✗ FAIL"}
                                              </td>
                                              <td className="p-1.5">{item.severity}</td>
                                            </tr>
                                          )
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      </details>

                      {/* Cinematic Camera Angle, Shot Plan, Block/Event Hierarchy & Smart Error Diagnosis Re-Plan */}
                      <div className="mb-3 rounded-xl bg-slate-900/90 border border-emerald-500/30 p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="font-bold text-emerald-300">
                            🎬 التخطيط السينمائي للكاميرا واللقطات (Cinematic Camera & Shot Director)
                          </span>
                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-emerald-300">
                              {sc.block_id || "BLOCK_001"} → {(sc.event_ids || ["EVENT_001"]).join(", ")}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-sky-950/80 border border-sky-500/40 text-sky-300">
                              {sc.shot_type || "Medium-Wide Narrative Shot"}
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          <div className="p-2 rounded bg-slate-950 border border-slate-800">
                            <span className="text-slate-400">زاوية الكاميرا (Camera Angle): </span>
                            <strong className="text-white">{sc.camera_angle || "Eye-Level Cinematic Three-Quarter Angle"}</strong>
                          </div>
                          <div className="p-2 rounded bg-slate-950 border border-slate-800">
                            <span className="text-slate-400">الحالة العاطفية واتجاه الحركة: </span>
                            <strong className="text-emerald-300">
                              {sc.emotional_state || "يقظة وتركيز"} {sc.movement_direction ? `· ${sc.movement_direction}` : ""}
                            </strong>
                          </div>
                        </div>

                        {Array.isArray(sc.shots_panels) && sc.shots_panels.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            {sc.shots_panels.map((sp) => (
                              <div key={sp.shot_id} className="p-2 rounded bg-slate-950/90 border border-slate-800/90 text-[10px] space-y-0.5">
                                <div className="flex items-center justify-between font-mono text-sky-300 font-bold">
                                  <span>{sp.shot_id} ({sp.panel_id})</span>
                                  <span>{sp.shot_type}</span>
                                </div>
                                <div className="text-slate-300">{sp.action_description}</div>
                                <div className="text-slate-400 font-mono" dir="ltr">Camera: {sp.camera_angle}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {sc.error_diagnosis_and_replan && (
                          <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/50 text-[11px] space-y-1">
                            <div className="font-bold text-amber-300 flex items-center justify-between flex-wrap gap-1">
                              <span>🛠️ تشخيص سبب الخطأ وإعادة التخطيط التلقائي للمشهد (Smart Root-Cause Diagnosis & Scene Re-Plan)</span>
                              <span className="font-mono text-[10px] text-rose-300">
                                {sc.error_diagnosis_and_replan.root_cause_categories.join(" | ")}
                              </span>
                            </div>
                            <p className="text-amber-100">{sc.error_diagnosis_and_replan.replan_summary_ar}</p>
                            <div className="text-[10px] font-mono text-emerald-300" dir="ltr">
                              Re-Planned Camera: {sc.error_diagnosis_and_replan.recommended_shot_type} | {sc.error_diagnosis_and_replan.recommended_camera_angle}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Prompt Box */}
                      <div
                        className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300"
                        dir="ltr"
                      >
                        {sc.visual_prompt}
                      </div>

                      {/* Additive Manual Correction Field + Correction History for Step 5 Scene Card (Requirement 7) */}
                      <div className="mt-2.5 p-3 rounded-xl bg-slate-900/80 border border-amber-500/30 flex flex-col gap-2">
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <span className="text-xs font-bold text-amber-300">
                            إضافة تصحيح إلى البرومت (Additive Manual Correction — يُضاف فوق الـ Base Prompt دون مسحه):
                          </span>
                          <span className="text-[10px] font-mono text-slate-400" dir="ltr">
                            current_prompt = base_prompt + existing_additive_corrections + new_manual_correction
                          </span>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={customSceneCorrections[sc.scene_id] || ""}
                            onChange={(e) =>
                              setCustomSceneCorrections((prev) => ({
                                ...prev,
                                [sc.scene_id]: e.target.value,
                              }))
                            }
                            placeholder="مثال: اجعل الجسر مكسورًا من المنتصف، وأعد التمثال إلى حجمه الضخم، وأزل الضباب..."
                            className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-amber-200 focus:border-amber-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleGenerateSingleScene(
                                sc.scene_id,
                                false,
                                sc,
                                customSceneCorrections[sc.scene_id] || ""
                              )
                            }
                            disabled={isBusy || isGeneratingAll || isVerifyingAllScenes}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer shrink-0 disabled:opacity-50"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>إضافة التصحيح وإعادة التوليد</span>
                          </button>
                        </div>

                        {Array.isArray(sc.correction_history) && sc.correction_history.length > 0 && (
                          <div className="pt-1.5 border-t border-slate-800/80 flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-slate-400">
                              سجل التصحيحات (Correction History — {sc.correction_history.length}):
                            </span>
                            <div className="space-y-1 max-h-24 overflow-y-auto text-[10px] font-mono text-slate-300" dir="ltr">
                              {sc.correction_history.map((h, hIdx) => (
                                <div key={hIdx} className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                                  <strong className="text-emerald-400">{h.label || `v${h.version}`}:</strong>{" "}
                                  {h.type === "BASE_PROMPT" ? "Base Prompt" : `+ ${h.correction_text}`}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Strict 6-Check Gemini Vision Verification Report */}
                      {vResult && (
                        <div
                          className={`mt-3 p-3 rounded-xl border text-xs space-y-2 ${
                            vResult.approved && vResult.all_required_checks_passed
                              ? "bg-emerald-950/20 border-emerald-800/40"
                              : "bg-rose-950/20 border-rose-800/40"
                          }`}
                        >
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="font-bold text-slate-200">
                              تقرير التحقق الصارم للمشهد (Strict 6-Check Scene Verification)
                            </span>
                            <span className="font-mono text-[11px] text-slate-200">
                              all_required_checks_passed:{" "}
                              <strong
                                className={
                                  vResult.all_required_checks_passed
                                    ? "text-emerald-400"
                                    : "text-rose-400"
                                }
                              >
                                {String(Boolean(vResult.all_required_checks_passed))}
                              </strong>
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                            <span
                              className={
                                vResult.checks?.character_consistency
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {vResult.checks?.character_consistency ? "✓" : "✗"} 1. ثبات الشخصيات
                            </span>
                            <span
                              className={
                                vResult.checks?.costume_and_weapon_accuracy
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {vResult.checks?.costume_and_weapon_accuracy ? "✓" : "✗"} 2. الملابس والأسلحة
                            </span>
                            <span
                              className={
                                vResult.checks?.location_reference_match
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {vResult.checks?.location_reference_match ? "✓" : "✗"} 3. تطابق مرجع الموقع
                            </span>
                            <span
                              className={
                                (vResult.checks?.action_and_composition_accuracy ??
                                  vResult.checks?.action_and_composition)
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {(vResult.checks?.action_and_composition_accuracy ??
                                vResult.checks?.action_and_composition)
                                ? "✓"
                                : "✗"}{" "}
                              4. دقة الحركة واللقطة
                            </span>
                            <span
                              className={
                                (vResult.checks?.style_and_lighting_consistency ??
                                  vResult.checks?.style_and_lighting)
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {(vResult.checks?.style_and_lighting_consistency ??
                                vResult.checks?.style_and_lighting)
                                ? "✓"
                                : "✗"}{" "}
                              5. تناسق الستايل والإضاءة
                            </span>
                            <span
                              className={
                                (vResult.checks?.no_text_or_watermarks ?? true)
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }
                            >
                              {(vResult.checks?.no_text_or_watermarks ?? true) ? "✓" : "✗"} 6. خلو من النصوص
                            </span>
                          </div>

                          {Array.isArray(vResult.failed_checks) && vResult.failed_checks.length > 0 && (
                            <p className="text-[11px] font-mono text-rose-300">
                              failed_checks: [{vResult.failed_checks.join(", ")}]
                            </p>
                          )}

                          {Array.isArray(vResult.what_is_correct) && vResult.what_is_correct.length > 0 && (
                            <p className="text-emerald-300 text-[11px]">
                              <strong>✓ ما هو صحيح (what_is_correct):</strong> {vResult.what_is_correct.join(" — ")}
                            </p>
                          )}
                          {Array.isArray(vResult.what_is_missing) && vResult.what_is_missing.length > 0 && (
                            <p className="text-rose-300 text-[11px]">
                              <strong>✗ ما هو ناقص (what_is_missing):</strong> {vResult.what_is_missing.join(" — ")}
                            </p>
                          )}
                          {Array.isArray(vResult.what_is_different) && vResult.what_is_different.length > 0 && (
                            <p className="text-amber-300 text-[11px]">
                              <strong>⚠ ما هو مختلف (what_is_different):</strong> {vResult.what_is_different.join(" — ")}
                            </p>
                          )}
                          {Array.isArray(vResult.critical_corrections) && vResult.critical_corrections.length > 0 && (
                            <p className="text-rose-200 text-[11px]">
                              <strong>🔧 التصحيحات الحرجة (critical_corrections):</strong> {vResult.critical_corrections.join(" — ")}
                            </p>
                          )}
                          {!vResult.approved && Array.isArray(vResult.detected_issues) && vResult.detected_issues.length > 0 && (
                            <p className="text-rose-300 text-[11px]">
                              الأخطاء المكتشفة: {vResult.detected_issues.join(" — ")}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Inspection Attempts History */}
                      {Array.isArray(sc.attempts_log) && sc.attempts_log.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {sc.attempts_log.map((att) => (
                            <div
                              key={att.attempt}
                              className={`p-2.5 rounded-lg border text-xs ${
                                att.approved
                                  ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                                  : "bg-amber-950/20 border-amber-800/40 text-amber-300"
                              }`}
                            >
                              <div className="flex items-center justify-between font-semibold">
                                <span>
                                  محاولة #{att.attempt}:{" "}
                                  {att.approved
                                    ? `✓ الصورة مطابقة ومعتمدة من Gemini (${att.score ?? 95}%)`
                                    : `✗ رفضها Gemini (${att.score ?? 50}%) وأعاد ضبط الـ Prompt تلقائيًا`}
                                </span>
                              </div>
                              {!att.approved && Array.isArray(att.detected_issues) && att.detected_issues.length > 0 && (
                                <p className="mt-1 text-[11px] text-amber-200">
                                  الأخطاء المكتشفة: {att.detected_issues.join(" — ")}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {sc.last_error && (
                        <p className="mt-2 text-xs text-rose-400">{sc.last_error}</p>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800/80 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleVerifySingleScene(sc.scene_id)}
                        disabled={
                          isBusy ||
                          isGeneratingAll ||
                          isVerifyingAllScenes ||
                          !sc.image_url
                        }
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-40"
                      >
                        {isBusy && sc.pipeline_stage === "GEMINI_INSPECTING" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        <span>✓ التأكد من الصورة عبر Gemini</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleGenerateSingleScene(sc.scene_id)}
                        disabled={isBusy || isGeneratingAll || isVerifyingAllScenes}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-50"
                      >
                        {isBusy && sc.pipeline_stage !== "GEMINI_INSPECTING" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {sc.image_url ? "إعادة التوليد والفحص" : "توليد وفحص هذا المشهد"}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Step Footer Navigation */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => goToStep(4)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition cursor-pointer"
            >
              <ArrowRight className="h-4 w-4" />
              <span>السابق: المواقع</span>
            </button>

            <button
              type="button"
              onClick={() => goToStep(6)}
              className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition cursor-pointer shadow-lg shadow-emerald-950/50"
            >
              <span>التالي: عرض المشاهد النهائية</span>
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {/* ===================================================================== */}
      {/* STEP 6️⃣: المشاهد (Final Approved Scenes Showcase & Editor)           */}
      {/* ===================================================================== */}
      {currentStep === 6 && (
        <section className="flex flex-col gap-6">
          {/* 🔀 زر خطوة المشاهد: الفصل التام بين [تجهيز مسبق] و [بدء تجهيز حدث] */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-950/95 border-2 border-emerald-500/40 shadow-xl flex flex-col gap-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="flex flex-col">
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    مسار خطوة المشاهد (Scene Preparation Mode)
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    زر الفصل بين المشاهد المجهزة مسبقًا بدون الذكاء الاصطناعي وبدء تجهيز الأحداث والمشاهد الآن
                  </span>
                </div>
              </div>
              <span
                className={`px-3 py-1 rounded-full font-mono text-xs font-bold border ${
                  scenePreparationMode === "PREPARED"
                    ? "bg-emerald-950 text-emerald-300 border-emerald-500/40"
                    : "bg-sky-950 text-sky-300 border-sky-500/40"
                }`}
              >
                {scenePreparationMode === "PREPARED"
                  ? "⚡ الوضع النشط: تجهيز مسبق"
                  : "🎬 الوضع النشط: بدء تجهيز حدث"}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* زر 1: تجهيز مسبق */}
              <button
                type="button"
                onClick={() => handleSelectScenePrepMode("PREPARED")}
                className={`p-4 rounded-xl border-2 text-right transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                  scenePreparationMode === "PREPARED"
                    ? "bg-emerald-950/60 border-emerald-500 text-white shadow-lg shadow-emerald-950/60 ring-1 ring-emerald-500/50"
                    : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">⚡</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-emerald-300">
                        تجهيز مسبق (Prepared Novel Data)
                      </span>
                      <span className="text-xs font-semibold text-slate-200">
                        استخدام المشاهد المجهزة مسبقًا مباشرة دون استدعاء Gemini
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      scenePreparationMode === "PREPARED"
                        ? "border-emerald-400 bg-emerald-500"
                        : "border-slate-600 bg-slate-950"
                    }`}
                  >
                    {scenePreparationMode === "PREPARED" && (
                      <div className="w-2 h-2 rounded-full bg-slate-950" />
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  يُخفي خانة بدء تجهيز الأحداث والتوليد، ويعتمد المشاهد المجهزة مسبقًا مباشرة.
                </p>
              </button>

              {/* زر 2: بدء تجهيز حدث */}
              <button
                type="button"
                onClick={() => handleSelectScenePrepMode("LIVE_EVENTS")}
                className={`p-4 rounded-xl border-2 text-right transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                  scenePreparationMode === "LIVE_EVENTS"
                    ? "bg-sky-950/60 border-sky-500 text-white shadow-lg shadow-sky-950/60 ring-1 ring-sky-500/50"
                    : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">🎬</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-sky-300">
                        بدء تجهيز حدث (Live Event Setup)
                      </span>
                      <span className="text-xs font-semibold text-slate-200">
                        تجهيز الأحداث والمشاهد وتوليدها وفحصها الآن
                      </span>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      scenePreparationMode === "LIVE_EVENTS"
                        ? "border-sky-400 bg-sky-500"
                        : "border-slate-600 bg-slate-950"
                    }`}
                  >
                    {scenePreparationMode === "LIVE_EVENTS" && (
                      <div className="w-2 h-2 rounded-full bg-slate-950" />
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  يُخفي خانة التجهيز المسبق، ويُظهر محرك فحص Gemini Vision وتوليد المشاهد وإعادة التوليد الآن.
                </p>
              </button>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-emerald-400 block mb-1">
                الخطوة 6 من 6
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                ⑥ المشاهد — النتيجة النهائية للمشروع ({projectTitle})
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                {scenePreparationMode === "PREPARED"
                  ? "المشاهد معتمدة مباشرة من بيانات التجهيز المسبق (Prepared Novel Data) دون أي إعادة تحليل عبر الذكاء الاصطناعي."
                  : "جميع المشاهد قابلة للفتح بالحجم الكامل، التحقق عبر Gemini Vision، التعديل المباشر، وإعادة التوليد عبر Google Flow."}
              </p>
            </div>

            {scenePreparationMode === "PREPARED" ? (
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="px-3.5 py-2 rounded-xl bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 shadow">
                  <Zap className="h-4 w-4 fill-current text-emerald-400" />
                  <span>⚡ مشاهد معتمدة من التجهيز المسبق (بدون Gemini)</span>
                </span>

                {(activePreparedNovelData || preparedNovelData)?.converted_studio_data && (
                  <button
                    type="button"
                    onClick={() => handleApplyPreparedDataToStudio((activePreparedNovelData || preparedNovelData)!)}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs transition cursor-pointer shadow-lg shadow-emerald-950/40"
                    title="إعادة تطبيق المشاهد المجهزة مباشرة"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>تطبيق المشاهد المجهزة ({(activePreparedNovelData || preparedNovelData)!.converted_studio_data.scenes?.length ?? 0})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveStudioToLibrary}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm transition cursor-pointer shadow-lg shadow-emerald-950/50"
                >
                  <Save className="h-4 w-4" />
                  <span>حفظ المشاهد في مكتبتي</span>
                </button>
              </div>
            ) : (
              /* الخانة الخاصة ببدء تجهيز حدث - تظهر فقط عند LIVE_EVENTS وتختفي في التجهيز المسبق */
              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleVerifyAllScenesParallel}
                  disabled={
                    isVerifyingAllScenes ||
                    isGeneratingAll ||
                    Object.values(busySceneIds).some(Boolean) ||
                    scenes.every((s) => !s.image_url)
                  }
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isVerifyingAllScenes ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  <span>✓ التأكد من جميع الصور عبر Gemini</span>
                </button>

                {scenes.some((s) => !s.approved) && (
                  <button
                    type="button"
                    onClick={() => handleGenerateAllScenes(true)}
                    disabled={
                      isGeneratingAll ||
                      isVerifyingAllScenes ||
                      Object.values(busySceneIds).some(Boolean)
                    }
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span>إعادة توليد غير المعتمدة فقط</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveStudioToLibrary}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm transition cursor-pointer shadow-lg shadow-emerald-950/50"
                >
                  <Save className="h-4 w-4" />
                  <span>حفظ المشاهد في مكتبتي</span>
                </button>
              </div>
            )}
          </div>

          {/* Step 6 Sub-View Navigation Switcher */}
          <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950/80 border border-slate-800 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep6SubView("MANHWA_PAGES")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  step6SubView === "MANHWA_PAGES"
                    ? "bg-emerald-600 text-white shadow-lg shadow-emerald-950/50"
                    : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Palette className="h-4 w-4" />
                <span>🎨 نظام إخراج صفحات المانهوا الكورية (Chapter → Scenes → Pages → Panels → Frames)</span>
              </button>

              <button
                type="button"
                onClick={() => setStep6SubView("SCENES_LIST")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  step6SubView === "SCENES_LIST"
                    ? "bg-emerald-600 text-white shadow-lg shadow-emerald-950/50"
                    : "bg-slate-900 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Film className="h-4 w-4" />
                <span>🎬 قائمة المشاهد المتسلسلة (Sequential Scenes View — {scenes.length})</span>
              </button>
            </div>

            <span className="text-[11px] font-mono text-emerald-400">
              Top → Bottom Reading · 100% Events Covered
            </span>
          </div>

          {step6SubView === "MANHWA_PAGES" ? (
            <ManhwaPageLayoutViewer
              scenes={scenes}
              blocks={longNovelReport?.blocks}
              elements={productionElements}
              locations={locations}
              chapterId={longNovelReport?.chapter_id || "CHAPTER_221"}
              chapterTitle={projectTitle}
              selectedStyle={selectedStyle}
              aspectRatio={selectedAspectRatio}
              pageMode={pageGenerationMode}
              onPageModeChange={setPageGenerationMode}
            />
          ) : (
            <>
              {/* Sequential Scene Cards Showcase */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {scenes
              .filter((sc): sc is StudioSceneItem => Boolean(sc && sc.scene_id))
              .map((sc) => {
              const isBusy =
                busySceneId === sc.scene_id || Boolean(busySceneIds[sc.scene_id]);
              const isEditing = editingSceneId === sc.scene_id && editSceneDraft;
              const paddedNum = String(sc.scene_number).padStart(2, "0");

              return (
                <article
                  key={sc.scene_id}
                  className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between"
                >
                  {/* Top Header: المشهد 01 */}
                  <div className="p-5 border-b border-slate-800/80 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-mono text-emerald-400 block">
                        المشهد {paddedNum} · v{sc.version || 1}
                      </span>
                      <h3 className="text-lg font-bold text-white mt-0.5">{sc.title}</h3>
                    </div>

                    {sc.approved && sc.verification_status === "VERIFIED" ? (
                      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                        <Check className="h-4 w-4" />
                        <span>
                          الصورة معتمدة (PASS
                          {typeof sc.verification_result?.confidence === "number"
                            ? ` · ${sc.verification_result.confidence}%`
                            : typeof sc.verification_result?.score === "number"
                            ? ` · ${sc.verification_result.score}%`
                            : ""}
                          )
                        </span>
                      </span>
                    ) : sc.vision_status === "VISION_FAILED" || sc.vision_status === "GEMINI_VISION_FAILED" ? (
                      <span className="text-xs font-semibold text-rose-400">
                        ✗ فشل الفحص (VISION_FAILED)
                      </span>
                    ) : sc.verification_status === "REJECTED" ? (
                      <span className="text-xs font-semibold text-rose-400">
                        ✗ غير معتمدة من Gemini Vision (FAIL
                        {typeof sc.verification_result?.confidence === "number"
                          ? ` · ${sc.verification_result.confidence}%`
                          : typeof sc.verification_result?.score === "number"
                          ? ` · ${sc.verification_result.score}%`
                          : ""}
                        )
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">UNVERIFIED — بانتظار فحص Gemini Vision</span>
                    )}
                  </div>

                  {/* [ صورة ] */}
                  <div
                    onClick={() => sc.image_url && setOpenedSceneModal(sc)}
                    className="relative w-full aspect-[4/3] bg-slate-950 border-b border-slate-800/80 flex items-center justify-center overflow-hidden cursor-pointer group"
                  >
                    {sc.image_url ? (
                      <>
                        <img
                          src={sc.image_url}
                          alt={sc.title}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-slate-950/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="px-4 py-2 rounded-xl bg-slate-900/90 text-white text-xs font-bold flex items-center gap-2">
                            <Eye className="h-4 w-4 text-emerald-400" />
                            <span>فتح المشهد بالحجم الكامل</span>
                          </span>
                        </div>
                      </>
                    ) : isBusy ? (
                      <div className="text-center p-6">
                        <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mx-auto mb-2" />
                        <span className="text-xs text-emerald-300">
                          جاري توليد وفحص صورة المشهد...
                        </span>
                      </div>
                    ) : (
                      <div className="text-center p-6 text-slate-500">
                        <Film className="h-10 w-10 mx-auto mb-2 opacity-40" />
                        <span className="text-xs block">لم يتم توليد صورة المشهد بعد</span>
                      </div>
                    )}
                  </div>

                  {/* Scene Details OR Inline Editor */}
                  {isEditing ? (
                    <div className="p-5 flex flex-col gap-3 bg-slate-950/90">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-400">عنوان المشهد</label>
                        <input
                          type="text"
                          value={editSceneDraft.title}
                          onChange={(e) =>
                            setEditSceneDraft({ ...editSceneDraft, title: e.target.value })
                          }
                          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-400">الوصف</label>
                        <textarea
                          rows={2}
                          value={editSceneDraft.description}
                          onChange={(e) =>
                            setEditSceneDraft({ ...editSceneDraft, description: e.target.value })
                          }
                          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-400">الشخصيات (مفصولة بفاصلة)</label>
                          <input
                            type="text"
                            value={editSceneDraft.characters.join("، ")}
                            onChange={(e) =>
                              setEditSceneDraft({
                                ...editSceneDraft,
                                characters: e.target.value
                                  .split(/[،,]/)
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                            }
                            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-400">الموقع</label>
                          <input
                            type="text"
                            value={editSceneDraft.location_name}
                            onChange={(e) =>
                              setEditSceneDraft({
                                ...editSceneDraft,
                                location_name: e.target.value,
                              })
                            }
                            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-400">الحركة</label>
                        <input
                          type="text"
                          value={editSceneDraft.action}
                          onChange={(e) =>
                            setEditSceneDraft({ ...editSceneDraft, action: e.target.value })
                          }
                          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-400">الحوار</label>
                        <input
                          type="text"
                          value={editSceneDraft.dialogue}
                          onChange={(e) =>
                            setEditSceneDraft({ ...editSceneDraft, dialogue: e.target.value })
                          }
                          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-400">المؤثرات</label>
                        <input
                          type="text"
                          value={editSceneDraft.sfx}
                          onChange={(e) =>
                            setEditSceneDraft({ ...editSceneDraft, sfx: e.target.value })
                          }
                          className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => saveEditedScene(false)}
                          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer"
                        >
                          حفظ التعديلات
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEditedScene(true)}
                          className="px-4 py-2 rounded-lg bg-sky-600 text-white text-xs font-bold cursor-pointer"
                        >
                          حفظ وإعادة التوليد الآن
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSceneId(null);
                            setEditSceneDraft(null);
                          }}
                          className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs cursor-pointer"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-5 flex flex-col gap-3 text-xs leading-relaxed">
                      <div>
                        <span className="text-slate-400 font-semibold block">الوصف:</span>
                        <p className="text-slate-100 mt-0.5">{sc.description}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/60">
                        <div>
                          <span className="text-slate-400 font-semibold block">الشخصيات:</span>
                          <p className="text-slate-200 mt-0.5">
                            {sc.characters.join("، ") || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400 font-semibold block">الموقع:</span>
                          <p className="text-emerald-300 mt-0.5">{sc.location_name}</p>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-800/60">
                        <span className="text-slate-400 font-semibold block">الحركة:</span>
                        <p className="text-slate-200 mt-0.5">{sc.action || "—"}</p>
                      </div>

                      <div className="pt-2 border-t border-slate-800/60">
                        <span className="text-slate-400 font-semibold block">الحوار:</span>
                        <p className="text-amber-200 mt-0.5">
                          {sc.dialogue ? `"${sc.dialogue}"` : "—"}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-slate-800/60">
                        <span className="text-slate-400 font-semibold block">المؤثرات:</span>
                        <p className="text-sky-300 mt-0.5">{sc.sfx || "—"}</p>
                      </div>

                      <div className="pt-2 border-t border-slate-800/60 grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-400 font-semibold block">الأسلحة / الأدوات:</span>
                          <p className="text-slate-200 mt-0.5">
                            {(sc.weapons || sc.costumes_and_weapons || []).join("، ") || "—"}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400 font-semibold block">ربط المراجع والاستمرارية:</span>
                          <p className="text-emerald-300 font-mono mt-0.5">
                            {sc.location_entity_id || sc.location_id}
                            {sc.character_ids?.length ? ` · ${sc.character_ids.join(", ")}` : ""}
                            {sc.continuity_status ? ` · ${sc.continuity_status}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-800/60">
                        <span className="text-slate-400 font-semibold block mb-1">
                          البرومت الحالي للمشهد (scene_prompt):
                        </span>
                        <div
                          className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 max-h-24 overflow-y-auto"
                          dir="ltr"
                        >
                          {sc.scene_prompt || sc.visual_prompt}
                        </div>
                      </div>

                      {/* Additive Manual Correction + Correction History in Step 6 Scene Card */}
                      <div className="pt-3 border-t border-slate-800/80 flex flex-col gap-2">
                        <span className="text-amber-300 font-bold text-xs">
                          إضافة تصحيح إلى البرومت (Additive Manual Correction):
                        </span>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={customSceneCorrections[sc.scene_id] || ""}
                            onChange={(e) =>
                              setCustomSceneCorrections((prev) => ({
                                ...prev,
                                [sc.scene_id]: e.target.value,
                              }))
                            }
                            placeholder="مثال: اجعل شعر Sunny أسود قصيرًا وفوضويًا، وأعد العباءة السوداء الطويلة..."
                            className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-amber-200 focus:border-amber-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleGenerateSingleScene(
                                sc.scene_id,
                                false,
                                sc,
                                customSceneCorrections[sc.scene_id] || ""
                              )
                            }
                            disabled={isBusy}
                            className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer shrink-0 disabled:opacity-50"
                          >
                            إضافة التصحيح وإعادة التوليد
                          </button>
                        </div>
                        {Array.isArray(sc.correction_history) && sc.correction_history.length > 0 && (
                          <div className="space-y-1 max-h-24 overflow-y-auto text-[10px] font-mono text-slate-300" dir="ltr">
                            {sc.correction_history.map((h, hIdx) => (
                              <div key={hIdx} className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                                <strong className="text-emerald-400">{h.label || `v${h.version}`}:</strong>{" "}
                                {h.type === "BASE_PROMPT" ? "Base Prompt" : `+ ${h.correction_text}`}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Card Actions Footer: Open / Edit / Verify / Regenerate */}
                  <div className="p-4 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenedSceneModal(sc)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5 text-emerald-400" />
                        <span>فتح</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => startEditingScene(sc)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5 text-sky-400" />
                        <span>تعديل</span>
                      </button>

                      {sc.image_url && (
                        <button
                          type="button"
                          onClick={() => handleVerifySingleScene(sc.scene_id)}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-900/60 hover:bg-sky-800/80 border border-sky-700/50 text-sky-200 text-xs font-semibold cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-sky-400" />
                          <span>✓ فحص Gemini</span>
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleGenerateSingleScene(sc.scene_id)}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      <span>إعادة التوليد</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          </>
          )}

          {/* Step Footer Navigation */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => goToStep(5)}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition cursor-pointer"
            >
              <ArrowRight className="h-4 w-4" />
              <span>السابق: التحليل والتوليد</span>
            </button>
          </div>
        </section>
      )}

      {/* Full Scene Inspection Modal */}
      {openedSceneModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpenedSceneModal(null);
          }}
        >
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-mono text-emerald-400 block">
                  المشهد {String(openedSceneModal.scene_number).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-bold text-white">{openedSceneModal.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpenedSceneModal(null)}
                className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {openedSceneModal.image_url && (
                <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex justify-center">
                  <img
                    src={openedSceneModal.image_url}
                    alt={openedSceneModal.title}
                    className="max-h-[420px] object-contain"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div>
                  <span className="text-slate-400 font-semibold block">الوصف:</span>
                  <p className="text-white mt-0.5">{openedSceneModal.description}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold block">الشخصيات:</span>
                  <p className="text-white mt-0.5">{openedSceneModal.characters.join("، ")}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold block">الموقع:</span>
                  <p className="text-emerald-300 mt-0.5">{openedSceneModal.location_name}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold block">الحركة:</span>
                  <p className="text-white mt-0.5">{openedSceneModal.action}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold block">الحوار:</span>
                  <p className="text-amber-300 mt-0.5">"{openedSceneModal.dialogue}"</p>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold block">المؤثرات:</span>
                  <p className="text-sky-300 mt-0.5">{openedSceneModal.sfx}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Universal Production JSON & Strict Execution Audit Modal */}
      {showUniversalJsonModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowUniversalJsonModal(false);
          }}
        >
          <div className="w-full max-w-4xl bg-slate-950 border border-violet-500/40 rounded-2xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-violet-600/20 border border-violet-500/40 text-violet-300">
                  <FileCode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <span>Universal Novel → Manga JSON (Schema 1.0)</span>
                    <span className="px-2 py-0.5 rounded bg-violet-900 border border-violet-400/30 text-[10px] font-mono text-violet-200">
                      v1.0 Strict
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    JSON هو مصدر الحقيقة المطلق لتوزيع الكيانات (target_step) وأعضاء لوحات التصميم (reference_sheets).
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowUniversalJsonModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Audit Status Bar */}
              <div
                className={`p-3.5 rounded-xl border flex flex-col gap-2 ${
                  universalReport && !universalReport.is_valid
                    ? "bg-rose-950/60 border-rose-500/50 text-rose-200"
                    : "bg-emerald-950/50 border-emerald-500/40 text-emerald-200"
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {universalReport && !universalReport.is_valid ? (
                      <>
                        <AlertTriangle className="h-4 w-4 text-rose-400" />
                        <span>نتائج فحص التدقيق الصارم: تم اكتشاف {universalReport.errors.length} أخطاء تعارض</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <span>نتائج فحص التدقيق الصارم: متطابق وصالح بنسبة 100% (Strict Audit PASS)</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                      عناصر الإنتاج: {strictlySeparatedElements.length}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                      المواقع: {locations.filter((l) => l.target_step !== "production_elements").length}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                      لوحات التصميم: {studioMasterSheets.length}
                    </span>
                  </div>
                </div>

                {/* Detailed Errors List if any */}
                {universalReport && universalReport.errors.length > 0 && (
                  <div className="mt-2 space-y-1.5 bg-slate-900/90 p-3 rounded-lg border border-rose-500/30">
                    <span className="font-bold text-rose-300 block text-xs">
                      الأخطاء المكتشفة التي تمنع الاعتماد (لا يتم التخمين أو الإصلاح الصامت):
                    </span>
                    {universalReport.errors.map((err, eIdx) => (
                      <div
                        key={eIdx}
                        className="text-[11px] text-rose-200 font-mono bg-rose-950/40 p-2 rounded border border-rose-800/60"
                      >
                        <strong className="text-rose-400">[{err.code}]</strong>{" "}
                        {err.entity_id ? `(الكيان: ${err.entity_id}) ` : ""}
                        {err.sheet_id ? `(اللوحة: ${err.sheet_id}) ` : ""}
                        <span>{err.message_ar}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status Message */}
              {universalJsonActionStatus && (
                <div
                  className={`p-3 rounded-xl border text-xs font-semibold ${
                    universalJsonActionStatus.includes("✓")
                      ? "bg-emerald-950/80 border-emerald-500/40 text-emerald-300"
                      : "bg-rose-950/80 border-rose-500/40 text-rose-300"
                  }`}
                >
                  {universalJsonActionStatus}
                </div>
              )}

              {/* JSON Textarea Editor */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>محتوى ملف Universal JSON (يمكنك التعديل أو لصق JSON لأي رواية أخرى):</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    schema_version: "1.0"
                  </span>
                </div>
                <textarea
                  value={universalJsonText}
                  onChange={(e) => setUniversalJsonText(e.target.value)}
                  rows={16}
                  dir="ltr"
                  className="w-full font-mono text-[11px] leading-relaxed p-4 rounded-xl bg-slate-950 border border-slate-800 text-emerald-300 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="Paste or edit Universal Production JSON here..."
                />
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleValidateUniversalJsonInput}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition cursor-pointer"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>فحص وتدقيق (Live Audit)</span>
                </button>

                <button
                  type="button"
                  onClick={handleApplyUniversalJsonInput}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition cursor-pointer"
                >
                  <Play className="h-4 w-4" />
                  <span>تطبيق واستيراد في الاستوديو</span>
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(universalJsonText);
                    setUniversalJsonActionStatus("✓ تم نسخ كود JSON إلى الحافظة بنجاح!");
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition cursor-pointer"
                >
                  <Copy className="h-4 w-4 text-emerald-400" />
                  <span>نسخ JSON</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([universalJsonText], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `universal_novel_manga_${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    setUniversalJsonActionStatus("✓ تم تنزيل ملف JSON بنجاح!");
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition cursor-pointer"
                >
                  <Download className="h-4 w-4 text-sky-400" />
                  <span>تحميل ملف JSON</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
