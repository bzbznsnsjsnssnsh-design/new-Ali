// Dynamic Microsoft Multilingual Neural Voices Service
import { UnifiedVoice } from "../components/video-dubbing/dubbingVoices";

export interface MicrosoftVoice {
  name: string;
  shortName: string;
  displayName: string;
  gender: "ذكر" | "أنثى";
  genderEn: "Female" | "Male";
  locale: string;
  localeName: string;
  languageCode: string;
  suggestedCodec?: string;
  personalities?: string[];
  categories?: string[];
}

export interface MicrosoftLanguageItem {
  code: string;
  label: string;
  count: number;
}

export interface MicrosoftRegionItem {
  locale: string;
  label: string;
  count: number;
}

// Arabic country & dialect translations
const ARABIC_REGIONS_MAP: Record<string, string> = {
  "ar-SA": "المملكة العربية السعودية 🇸🇦",
  "ar-EG": "مصر 🇪🇬",
  "ar-AE": "الإمارات العربية المتحدة 🇦🇪",
  "ar-DZ": "الجزائر 🇩🇿",
  "ar-MA": "المغرب 🇲🇦",
  "ar-IQ": "العراق 🇮🇶",
  "ar-JO": "الأردن 🇯🇴",
  "ar-KW": "الكويت 🇰🇼",
  "ar-LB": "لبنان 🇱🇧",
  "ar-TN": "تونس 🇹🇳",
  "ar-SY": "سوريا 🇸🇾",
  "ar-QA": "قطر 🇶🇦",
  "ar-OM": "سلطنة عمان 🇴🇲",
  "ar-YE": "اليمن 🇾🇪",
  "ar-BH": "البحرين 🇧🇭",
  "ar-LY": "ليبيا 🇱🇾"
};

// Global Language Names in Arabic
const LANGUAGE_NAMES_MAP: Record<string, string> = {
  "ar": "العربية (Arabic)",
  "en": "الإنجليزية (English)",
  "ja": "اليابانية (Japanese)",
  "ko": "الكورية (Korean)",
  "zh": "الصينية (Chinese)",
  "fr": "الفرنسية (French)",
  "es": "الإسبانية (Spanish)",
  "de": "الألمانية (German)",
  "tr": "التركية (Turkish)",
  "ru": "الروسية (Russian)",
  "it": "الإيطالية (Italian)",
  "pt": "البرتغالية (Portuguese)",
  "id": "الإندونيسية (Indonesian)",
  "hi": "الهندية (Hindi)",
  "fa": "الفارسية (Persian)",
  "ur": "الأردية (Urdu)",
  "ms": "الماليزية (Malay)",
  "th": "التايلاندية (Thai)",
  "vi": "الفيتنامية (Vietnamese)",
  "pl": "البولندية (Polish)",
  "nl": "الهولندية (Dutch)",
  "sv": "السويدية (Swedish)"
};

let cachedVoices: MicrosoftVoice[] | null = null;
let fetchPromise: Promise<MicrosoftVoice[]> | null = null;

/**
 * Dynamically fetches the complete list of 320+ Microsoft voices from the server
 */
export async function fetchMicrosoftVoices(): Promise<MicrosoftVoice[]> {
  if (cachedVoices && cachedVoices.length > 0) {
    return cachedVoices;
  }

  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      const res = await fetch("/api/manga/microsoft-voices");
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.voices) && data.voices.length > 0) {
        cachedVoices = data.voices;
        return data.voices;
      }
      throw new Error("Invalid voice list format");
    } catch (err) {
      console.warn("[MicrosoftVoicesService] Notice: using fallback list:", err);
      // Return minimum cached or empty
      return cachedVoices || [];
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/**
 * Returns available languages with voice counts, prioritizing Arabic, English, Japanese, Korean
 */
export async function getMicrosoftLanguages(): Promise<MicrosoftLanguageItem[]> {
  const voices = await fetchMicrosoftVoices();
  const langMap = new Map<string, number>();

  for (const v of voices) {
    const code = v.languageCode || (v.locale ? v.locale.split("-")[0] : "other");
    langMap.set(code, (langMap.get(code) || 0) + 1);
  }

  const list: MicrosoftLanguageItem[] = [];
  langMap.forEach((count, code) => {
    const label = LANGUAGE_NAMES_MAP[code] || `${code.toUpperCase()} (${code})`;
    list.push({ code, label, count });
  });

  // Priority order: Arabic first, then English, Japanese, Korean, French, Spanish, then alphabetical
  const priorityOrder = ["ar", "en", "ja", "ko", "zh", "fr", "es", "de", "tr", "ru"];
  list.sort((a, b) => {
    const idxA = priorityOrder.indexOf(a.code);
    const idxB = priorityOrder.indexOf(b.code);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.label.localeCompare(b.label, "ar");
  });

  return list;
}

/**
 * Returns regions/dialects for a given language code (e.g. ar -> Saudi Arabia, Egypt, etc.)
 */
export async function getMicrosoftRegions(langCode: string): Promise<MicrosoftRegionItem[]> {
  const voices = await fetchMicrosoftVoices();
  const regionMap = new Map<string, { label: string; count: number }>();

  const filtered = voices.filter(v => v.languageCode === langCode);

  for (const v of filtered) {
    const loc = v.locale;
    let label = ARABIC_REGIONS_MAP[loc];
    if (!label) {
      // Clean display from localeName: e.g. "English (United States)" -> "United States"
      const match = v.localeName.match(/\(([^)]+)\)/);
      label = match ? match[1] : loc;
    }
    const current = regionMap.get(loc) || { label, count: 0 };
    current.count++;
    regionMap.set(loc, current);
  }

  const list: MicrosoftRegionItem[] = [];
  regionMap.forEach((data, locale) => {
    list.push({ locale, label: data.label, count: data.count });
  });

  list.sort((a, b) => b.count - a.count);
  return list;
}

/**
 * Filters Microsoft voices by language, region/dialect, gender, and search query
 */
export async function filterMicrosoftVoices(params: {
  langCode?: string;
  locale?: string;
  gender?: "all" | "ذكر" | "أنثى";
  search?: string;
}): Promise<MicrosoftVoice[]> {
  const voices = await fetchMicrosoftVoices();
  return voices.filter(v => {
    if (params.langCode && params.langCode !== "all" && v.languageCode !== params.langCode) {
      return false;
    }
    if (params.locale && params.locale !== "all" && v.locale !== params.locale) {
      return false;
    }
    if (params.gender && params.gender !== "all" && v.gender !== params.gender) {
      return false;
    }
    if (params.search && params.search.trim()) {
      const q = params.search.toLowerCase().trim();
      const matchName = v.displayName.toLowerCase().includes(q) || v.shortName.toLowerCase().includes(q);
      const matchLoc = v.locale.toLowerCase().includes(q) || v.localeName.toLowerCase().includes(q);
      const matchArabicRegion = (ARABIC_REGIONS_MAP[v.locale] || "").toLowerCase().includes(q);
      return matchName || matchLoc || matchArabicRegion;
    }
    return true;
  });
}

/**
 * Converts a Microsoft voice to UnifiedVoice format for app-wide compatibility
 */
export function convertMicrosoftVoiceToUnifiedVoice(v: MicrosoftVoice): UnifiedVoice {
  const regionLabel = ARABIC_REGIONS_MAP[v.locale] || v.localeName;
  const isArabic = v.languageCode === "ar";
  
  // Extract simple first name from FriendlyName (e.g. "Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)" -> "حامد / Hamed")
  const shortPart = v.shortName.split("-")[2]?.replace("Neural", "") || v.shortName;
  
  return {
    id: v.shortName,
    name: `${shortPart} (${regionLabel})`,
    category: "edge",
    categoryLabel: "أصوات Microsoft Edge الطبيعية",
    gender: v.gender,
    description: `صوت Microsoft الطبيعي بدقة عالية (${v.displayName})`,
    flag: isArabic ? "⚡" : "🌐",
    dialectOrTone: regionLabel,
    traits: v.personalities || ["طبيعي", "دقيق", "سريع"],
    recommendedFor: isArabic ? ["قراءة المانهاوا", "حوارات", "سرد"] : ["متعدد اللغات", "دبلجة عالمية"]
  };
}
