import { Gemini } from 'gemini-reverse';
import { Model, buildModelHeader } from 'gemini-reverse/src/constants.js';

/**
 * Supported Gemini Cookies Models based on HanaokaYuzu/Gemini-API
 * All configured with Extended Thinking STRICTLY DISABLED (extended_thinking: false)
 * for maximum speed and instant response, while maintaining high reasoning power
 * for complex manga translation challenges.
 */
export type GeminiCookieModelId = '3.5-flash-lite' | '3.5-flash-lite-extended' | '3.6-flash' | '3.1-pro';

export interface GeminiModelInfo {
  id: GeminiCookieModelId;
  label: string;
  category: string;
  description: string;
  speed: string;
  reasoning: string;
  recommendedFor: string;
  modelNumber: number;
  freeModelId: string;
  advModelId: string;
  extendedThinking: boolean;
}

export const GEMINI_COOKIE_MODELS: Record<string, GeminiModelInfo> = {
  '3.5-flash-lite-extended': {
    id: '3.5-flash-lite-extended',
    label: '3.5 Flash-Lite (Extended Thinking)',
    category: 'Lite Thinking',
    description: 'خفيف الوزن وسريع مع تفعيل التفكير الموسع (Extended Thinking) للتعامل بذكاء وحرفية مع المشاكل المعقدة وسياق الحوار في ترجمة المانجا.',
    speed: 'سريعة مع تفكير موسع',
    reasoning: 'متعمقة للمشاكل المعقدة',
    recommendedFor: 'الحصول على إجابات أسرع مع تفعيل التفكير الموسع للتعامل مع أعقد فقاعات الحوار والمؤثرات الصوتية',
    modelNumber: 6,
    freeModelId: 'cf41b0e0dd7d53e5',
    advModelId: '8c46e95b1a07cecc',
    extendedThinking: true
  },
  '3.5-flash-lite-thinking': {
    id: '3.5-flash-lite-extended',
    label: '3.5 Flash-Lite (Extended Thinking)',
    category: 'Lite Thinking',
    description: 'خفيف الوزن وسريع مع تفعيل التفكير الموسع (Extended Thinking) للتعامل بذكاء وحرفية مع المشاكل المعقدة وسياق الحوار في ترجمة المانجا.',
    speed: 'سريعة مع تفكير موسع',
    reasoning: 'متعمقة للمشاكل المعقدة',
    recommendedFor: 'الحصول على إجابات أسرع مع تفعيل التفكير الموسع للتعامل مع أعقد فقاعات الحوار والمؤثرات الصوتية',
    modelNumber: 6,
    freeModelId: 'cf41b0e0dd7d53e5',
    advModelId: '8c46e95b1a07cecc',
    extendedThinking: true
  },
  '3.5-flash-lite': {
    id: '3.5-flash-lite',
    label: '3.5 Flash-Lite',
    category: 'Lite',
    description: 'خفيف الوزن وفائق السرعة، يعطي استجابة فورية بدون أي تأخير تفكير (Extended Thinking معطّل).',
    speed: 'فائقة جداً',
    reasoning: 'عالية وسريعة',
    recommendedFor: 'الترجمة اللحظية وتصفح الفصول بسرعة',
    modelNumber: 6,
    freeModelId: 'cf41b0e0dd7d53e5',
    advModelId: '8c46e95b1a07cecc',
    extendedThinking: false
  },
  '3.6-flash': {
    id: '3.6-flash',
    label: '3.6 Flash',
    category: 'Flash',
    description: 'المحرك المتوازن والمثالي، سرعة عالية جداً مع فهم ممتاز لسياق المانجا وفقاعات الحوار بدون تفكير موسع.',
    speed: 'عالية',
    reasoning: 'ممتازة ومتطورة',
    recommendedFor: 'الخيار الافتراضي لمعظم الفصول والقصص المصورة',
    modelNumber: 1,
    freeModelId: 'fbb127bbb056c959',
    advModelId: '56fdd199312815e2',
    extendedThinking: false
  },
  '3.1-pro': {
    id: '3.1-pro',
    label: '3.1 Pro',
    category: 'Pro',
    description: 'أقوى النماذج قدرة على حل المشاكل المعقدة، السياقات المتشابكة، والمؤثرات الصوتية الصعبة، بدون تفكير موسع.',
    speed: 'متوسطة إلى سريعة',
    reasoning: 'الأعلى قدرة ودقة للمشاكل المعقدة',
    recommendedFor: 'الفصول المعقدة، الحوارات الفلسفية والمؤثرات الصوتية الخاصة',
    modelNumber: 3,
    freeModelId: '9d8ca3786ebdfbea',
    advModelId: 'e6fa609c3fa255c0',
    extendedThinking: false
  }
};

/**
 * Normalizes input string to one of the supported model keys
 */
export function normalizeGeminiModel(input?: string): GeminiCookieModelId {
  if (!input) return '3.6-flash';
  const clean = input.toLowerCase().trim();
  if (clean.includes('thinking') || clean.includes('تفكير') || clean.includes('extended')) {
    return '3.5-flash-lite-extended';
  }
  if (clean.includes('3.5') || clean.includes('lite')) {
    return '3.5-flash-lite';
  }
  if (clean.includes('3.1') || clean.includes('pro')) {
    return '3.1-pro';
  }
  if (clean.includes('3.6') || clean.includes('flash')) {
    return '3.6-flash';
  }
  return '3.6-flash';
}

/**
 * Builds the exact model definition header matching HanaokaYuzu/Gemini-API specification.
 * Supports Free tier (capacity 1) and Google One / Advanced tier (capacity 2).
 */
export function resolveGeminiModelDef(modelKey?: string, isAdvanced: boolean = false) {
  const norm = normalizeGeminiModel(modelKey);
  const info = GEMINI_COOKIE_MODELS[norm];
  const cap = isAdvanced ? 2 : 1;
  const hexId = isAdvanced ? info.advModelId : info.freeModelId;

  return {
    model_name: `gemini-${norm}`,
    model_header: buildModelHeader(hexId, cap, info.modelNumber),
    model_number: info.modelNumber,
    model_id: hexId,
    advanced_only: isAdvanced
  };
}
