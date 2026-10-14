export type VoiceCategory = "all" | "gemini" | "current" | "edge" | "capcut" | "chatgpt" | "huggingface" | "multilingual";

export interface UnifiedVoice {
  id: string;
  name: string;
  gender: "ذكر" | "أنثى";
  category: "gemini" | "current" | "edge" | "capcut" | "chatgpt" | "huggingface";
  categoryLabel: string;
  dialectOrTone?: string;
  locale?: string;
  description?: string;
  traits?: string[];
  recommendedFor?: string[];
  flag?: string;
}

export const VOICE_CATEGORIES: Array<{ id: VoiceCategory; label: string; count?: number }> = [
  { id: "all", label: "جميع الأصوات" },
  { id: "gemini", label: "Gemini Studio" },
  { id: "current", label: "Microsoft Edge" },
  { id: "capcut", label: "CapCut" },
  { id: "chatgpt", label: "OpenAI" },
  { id: "huggingface", label: "HuggingFace" },
  { id: "multilingual", label: "متعدد اللغات" },
];

export const ALL_PROJECT_VOICES: UnifiedVoice[] = [
  {
    id: "Aoede",
    name: "Aoede (Gemini)",
    gender: "أنثى",
    category: "gemini",
    categoryLabel: "Gemini TTS",
    dialectOrTone: "طبيعي معبّر",
    description: "صوت أنثوي متوازن ومعبّر للغاية من استوديو Gemini",
    traits: ["تعبيري", "سينمائي", "واضح"],
    recommendedFor: ["سرد الأحداث", "الحوارات الأنثوية"],
    flag: "💎"
  },
  {
    id: "Charon",
    name: "Charon (Gemini)",
    gender: "ذكر",
    category: "gemini",
    categoryLabel: "Gemini TTS",
    dialectOrTone: "عميق سينمائي",
    description: "صوت ذكوري عميق ورخيم مناسب للسرد الدرامي والراوي",
    traits: ["عميق", "درامي", "فخم"],
    recommendedFor: ["الراوي الأساسي", "المشاهد الملحمية"],
    flag: "💎"
  },
  {
    id: "Fenrir",
    name: "Fenrir (Gemini)",
    gender: "ذكر",
    category: "gemini",
    categoryLabel: "Gemini TTS",
    dialectOrTone: "حماسي قوي",
    description: "صوت حماسي بطولي للمواجهات والقتالات",
    traits: ["حماسي", "قوي", "قتالي"],
    recommendedFor: ["الشخصيات القتالية", "اللحظات الحماسية"],
    flag: "⚡"
  },
  {
    id: "Kore",
    name: "Kore (Gemini)",
    gender: "أنثى",
    category: "gemini",
    categoryLabel: "Gemini TTS",
    dialectOrTone: "هادئ واضح",
    description: "صوت هادئ ونقي مناسب للمشاهد العاطفية والتأملية",
    traits: ["هادئ", "واضح", "لطيف"],
    recommendedFor: ["الحوارات الهادئة", "الشخصيات اللطيفة"],
    flag: "🌸"
  },
  {
    id: "Puck",
    name: "Puck (Gemini)",
    gender: "ذكر",
    category: "gemini",
    categoryLabel: "Gemini TTS",
    dialectOrTone: "حيوي سريع",
    description: "صوت سريع ومرح للمشاهد الكوميدية والخفيفة",
    traits: ["مرح", "حيوي", "سريع"],
    recommendedFor: ["الشخصيات الجانبية", "المشاهد المرحة"],
    flag: "🎭"
  },
  {
    id: "ar-SA-HamedNeural",
    name: "حامد - السعودية",
    gender: "ذكر",
    category: "current",
    categoryLabel: "Microsoft Edge Neural",
    dialectOrTone: "سعودي فصيح",
    locale: "ar-SA",
    description: "نطق عربي فصيح وطبيعي من مايكروسوفت",
    traits: ["فصيح", "طبيعي", "رسمي"],
    recommendedFor: ["الراوي", "قراءة الروايات والمانجا"],
    flag: "🇸🇦"
  },
  {
    id: "ar-SA-ZariyahNeural",
    name: "زارية - السعودية",
    gender: "أنثى",
    category: "current",
    categoryLabel: "Microsoft Edge Neural",
    dialectOrTone: "سعودي ناعم",
    locale: "ar-SA",
    description: "صوت أنثوي فصيح ناعم وطبيعي",
    traits: ["فصيح", "ناعم", "طبيعي"],
    recommendedFor: ["البطلات", "الحوارات العامة"],
    flag: "🇸🇦"
  },
  {
    id: "ar-EG-ShakirNeural",
    name: "شاكر - مصر",
    gender: "ذكر",
    category: "current",
    categoryLabel: "Microsoft Edge Neural",
    dialectOrTone: "مصري درامي",
    locale: "ar-EG",
    description: "صوت مصري معبّر بدقة عالية",
    traits: ["معبّر", "درامي", "حيوي"],
    recommendedFor: ["الحوارات الدرامية"],
    flag: "🇪🇬"
  },
  {
    id: "ar-EG-SalmaNeural",
    name: "سلمى - مصر",
    gender: "أنثى",
    category: "current",
    categoryLabel: "Microsoft Edge Neural",
    dialectOrTone: "مصري واضح",
    locale: "ar-EG",
    description: "صوت أنثوي مصري واضح ومريح للأذن",
    traits: ["واضح", "مريح", "تعبيري"],
    recommendedFor: ["الحوارات", "البطولات النسائية"],
    flag: "🇪🇬"
  },
  {
    id: "ar_male_maged",
    name: "ماجد (CapCut)",
    gender: "ذكر",
    category: "capcut",
    categoryLabel: "CapCut TTS",
    dialectOrTone: "روائي فخم",
    description: "صوت كاب كت الشهير للفيديوهات القصيرة والريلز",
    traits: ["فخم", "تيك توك", "ريلز"],
    recommendedFor: ["فيديوهات المانهاوا القصيرة"],
    flag: "🎬"
  },
  {
    id: "ar_female_sanaa",
    name: "سناء (CapCut)",
    gender: "أنثى",
    category: "capcut",
    categoryLabel: "CapCut TTS",
    dialectOrTone: "دافئ طبيعي",
    description: "صوت نسائي دافئ ومحبوب لمحتوى التواصل الاجتماعي",
    traits: ["دافئ", "طبيعي", "سلس"],
    recommendedFor: ["القصص والمانهاوا"],
    flag: "🎬"
  },
  {
    id: "onyx",
    name: "Onyx (ChatGPT)",
    gender: "ذكر",
    category: "chatgpt",
    categoryLabel: "OpenAI Voice",
    dialectOrTone: "عميق سينمائي",
    description: "صوت Onyx السينمائي من OpenAI",
    traits: ["سينمائي", "عميق", "فخم"],
    recommendedFor: ["أفلام المانجا والقصص الملحمية"],
    flag: "🤖"
  },
  {
    id: "nova",
    name: "Nova (ChatGPT)",
    gender: "أنثى",
    category: "chatgpt",
    categoryLabel: "OpenAI Voice",
    dialectOrTone: "حيوي متألق",
    description: "صوت Nova الذكي المليء بالحيوية",
    traits: ["حيوي", "ذكي", "متألق"],
    recommendedFor: ["البطلات", "الراويات الحيوية"],
    flag: "🤖"
  },
];

export function getVoiceById(id: string): UnifiedVoice | undefined {
  return ALL_PROJECT_VOICES.find((v) => v.id === id);
}
