export interface Manga {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  author: string;
  status: string;
  tags: string[];
  contentRating: string;
  originalLanguage: string;
  sourceId?: string;
  sourceName?: string;
}

export interface Chapter {
  id: string;
  mangaId?: string;
  mangaTitle?: string;
  workType?: string;
  volume?: string;
  chapter: string;
  title: string;
  translatedLanguage?: string;
  publishAt?: string;
  pages: number;
  pageUrls?: string[];
  sourceId?: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface TranslationArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanonicalRegionLayout {
  region_id?: string;
  reading_order?: number;
  panel_index?: number;
  panel_id?: string;
  box?: BoundingBox;
  safe_area?: TranslationArea;
  polygon?: PolygonPoint[];
  bubble_type?: string;
  text_type?: string;
  original_text?: string;
  translated_text?: string;
  direction?: "rtl" | "ltr";
  [key: string]: any;
}

export interface OCRBlock {
  id?: string;
  region_id?: string;
  panel_id?: string;
  panel_index?: number;
  reading_order?: number;
  original: string;
  translated: string;
  speaker_gender?: "male" | "female" | "unknown";
  emotion?: string;
  bubble_type?: string;
  text_type?: "dialogue" | "narration" | "thought" | "sfx" | "whisper" | "scream" | "title" | "outside" | "other" | string;
  is_inside_bubble?: boolean;
  needs_cleaning?: boolean;
  font_scale?: number;
  preferred_lines?: number;
  preserve_original?: boolean;
  direction?: "rtl" | "ltr";
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  safe_area?: TranslationArea;
  translation_area?: TranslationArea;
  polygon?: PolygonPoint[];
  mask_polygon?: PolygonPoint[];
  text_mask_polygon?: PolygonPoint[];
  background_color?: string;
  text_color?: string;
  stroke_color?: string;
  rotation_angle?: number;
  confidence?: number;
  [key: string]: any;
}

export type Language = {
  code: string;
  name: string;
  dir: "ltr" | "rtl";
  flag?: string;
};

export const DEFAULT_MANGA_COVER =
  "https://images.unsplash.com/photo-1618336753974-aae8e04506aa?auto=format&fit=crop&w=600&q=80";

export const TARGET_LANGUAGES: Language[] = [
  { code: "ar", name: "العربية (Arabic)", dir: "rtl" },
  { code: "en", name: "English", dir: "ltr" },
  { code: "es", name: "Español (Spanish)", dir: "ltr" },
  { code: "fr", name: "Français (French)", dir: "ltr" },
  { code: "de", name: "Deutsch (German)", dir: "ltr" },
  { code: "ru", name: "Русский (Russian)", dir: "ltr" },
  { code: "pt", name: "Português (Portuguese)", dir: "ltr" },
  { code: "id", name: "Bahasa Indonesia", dir: "ltr" },
  { code: "tr", name: "Türkçe (Turkish)", dir: "ltr" },
  { code: "it", name: "Italiano (Italian)", dir: "ltr" },
  { code: "zh", name: "中文 (Chinese)", dir: "ltr" },
  { code: "ja", name: "日本語 (Japanese)", dir: "ltr" },
  { code: "ko", name: "한국어 (Korean)", dir: "ltr" },
  { code: "hi", name: "हिन्दी (Hindi)", dir: "ltr" },
];
