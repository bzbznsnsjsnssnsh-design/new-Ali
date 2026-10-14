import React, { useState, useEffect, useMemo } from "react";
import { 
  X, 
  Settings, 
  Sparkles, 
  Mic, 
  Gauge, 
  Cookie, 
  Check, 
  AlertCircle, 
  RefreshCw, 
  Search,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Volume2
} from "lucide-react";
import { DubbingConfig } from "../../types/videoDubbing";
import { 
  ALL_PROJECT_VOICES, 
  VOICE_CATEGORIES, 
  getVoiceById, 
  UnifiedVoice, 
  VoiceCategory 
} from "./dubbingVoices";
import { MicrosoftVoicePicker } from "../common/MicrosoftVoicePicker";

interface DubbingSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: DubbingConfig;
  onSaveConfig: (newConfig: DubbingConfig, resynthesize: boolean) => void;
  onNavigateToSettings: () => void;
}

const TTS_SPEEDS = [0.75, 0.85, 1.0, 1.1, 1.25, 1.5];

export const DubbingSettingsModal: React.FC<DubbingSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  onNavigateToSettings
}) => {
  const [localConfig, setLocalConfig] = useState<DubbingConfig>({ 
    ...config, 
    provider: 'gemini_cookies' 
  });
  const [hasCookies, setHasCookies] = useState(false);
  const [resynthesizeOnSave, setResynthesizeOnSave] = useState(false);

  // Voice filtering states
  const [activeCategory, setActiveCategory] = useState<VoiceCategory | 'all'>('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'ذكر' | 'أنثى'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setLocalConfig({ 
      ...config, 
      provider: 'gemini_cookies' 
    });
    try {
      const cookies = localStorage.getItem("gemini_cookies");
      setHasCookies(Boolean(cookies && cookies.trim()));
    } catch (_) {
      setHasCookies(false);
    }
  }, [config, isOpen]);

  // Filter voices based on category, gender, and search text
  const filteredVoices = useMemo(() => {
    return ALL_PROJECT_VOICES.filter((voice) => {
      // Category filter
      if (activeCategory !== 'all' && voice.category !== activeCategory) {
        return false;
      }
      // Gender filter
      if (genderFilter !== 'all' && voice.gender !== genderFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = voice.name.toLowerCase().includes(q);
        const matchDesc = voice.description.toLowerCase().includes(q);
        const matchDialect = voice.dialectOrTone?.toLowerCase().includes(q) ?? false;
        const matchCategory = voice.categoryLabel.toLowerCase().includes(q);
        const matchTraits = voice.traits?.some(t => t.toLowerCase().includes(q)) ?? false;
        const matchRec = voice.recommendedFor?.some(r => r.toLowerCase().includes(q)) ?? false;
        return matchName || matchDesc || matchDialect || matchCategory || matchTraits || matchRec;
      }
      return true;
    });
  }, [activeCategory, genderFilter, searchQuery]);

  const selectedVoiceObj = useMemo(() => {
    return getVoiceById(localConfig.ttsVoice) || ALL_PROJECT_VOICES[0];
  }, [localConfig.ttsVoice]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveConfig(
      { ...localConfig, provider: 'gemini_cookies' }, 
      resynthesizeOnSave
    );
    onClose();
  };

  const handleSelectVoice = (voiceId: string) => {
    setLocalConfig(prev => ({ ...prev, ttsVoice: voiceId }));
    setResynthesizeOnSave(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 font-sans text-right select-none animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-5 sm:p-6 space-y-5 max-h-[92vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between flex-row-reverse border-b border-neutral-800 pb-3 shrink-0">
          <div className="flex items-center gap-2.5 flex-row-reverse">
            <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">إعدادات الدبلجة الصوتية الذكية</h3>
              <p className="text-xs text-neutral-400">محرك Gemini Cookies وقوائم أصوات المشروع الأصلية المعتمدة</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-all"
            title="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="space-y-5 overflow-y-auto pr-1 flex-1">
          
          {/* Section 1: AI Dubbing Engine (Gemini Cookies Exclusively) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-row-reverse">
              <label className="text-xs font-bold text-neutral-200 flex items-center gap-1.5 flex-row-reverse">
                <Cookie className="w-4 h-4 text-amber-400" />
                <span>محرك الذكاء الاصطناعي (AI Dubbing Engine)</span>
              </label>
              <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full flex items-center gap-1 flex-row-reverse">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>جلسة كوكيز الرسمية فقط</span>
              </span>
            </div>

            {/* Cookies Info & Status Box */}
            <div className={`p-3.5 rounded-xl border text-xs transition-all ${
              hasCookies
                ? "bg-emerald-950/25 border-emerald-800/50 text-emerald-300"
                : "bg-amber-950/30 border-amber-800/60 text-amber-200"
            }`}>
              <div className="flex items-start justify-between flex-row-reverse gap-3">
                <div className="flex items-start gap-2.5 flex-row-reverse">
                  {hasCookies ? (
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5 text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5 text-amber-400">
                      <AlertCircle className="w-4 h-4" />
                    </div>
                  )}
                  <div className="space-y-1">
                    <div className="font-bold text-white text-xs flex items-center gap-1.5 flex-row-reverse">
                      <span>{hasCookies ? "ملفات تعريف ارتباط كوكيز Gemini نشطة وجاهزة" : "ملفات كوكيز Gemini غير مضافة"}</span>
                    </div>
                    <p className="text-[11px] text-neutral-300 leading-relaxed">
                      {hasCookies
                        ? "يتم تشغيل الترجمة وتحليل الكلام عبر جلسة كوكيز Google Gemini الرسمية دون حدود أو قيود على الحصص."
                        : "يتطلب نظام الدبلجة إدخال كوكيز Gemini الخاصة بك في شاشة الإعدادات العامة لتعمل الدبلجة دون قيود حصص."}
                    </p>
                  </div>
                </div>

                {!hasCookies && (
                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToSettings();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs flex items-center gap-1.5 font-bold shrink-0 transition-all shadow-md shadow-amber-950/50"
                  >
                    <span>ضبط الكوكيز</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Complete Project Voices Adoption */}
          <div className="space-y-3 border-t border-neutral-800 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 flex-row-reverse">
              <label className="text-xs font-bold text-neutral-200 flex items-center gap-1.5 flex-row-reverse">
                <Mic className="w-4 h-4 text-emerald-400" />
                <span>قوائم أصوات المشروع الأصلية ({ALL_PROJECT_VOICES.length} صوتاً معتمداً)</span>
              </label>

              {/* Gender Quick Filter */}
              <div className="flex items-center gap-1 bg-neutral-950 border border-neutral-800 p-1 rounded-lg text-xs self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setGenderFilter('all')}
                  className={`px-2 py-0.5 rounded transition-all text-[11px] ${
                    genderFilter === 'all'
                      ? "bg-neutral-800 text-white font-bold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  الكل
                </button>
                <button
                  type="button"
                  onClick={() => setGenderFilter('ذكر')}
                  className={`px-2 py-0.5 rounded transition-all text-[11px] ${
                    genderFilter === 'ذكر'
                      ? "bg-emerald-600 text-white font-bold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  ذكور ♂️
                </button>
                <button
                  type="button"
                  onClick={() => setGenderFilter('أنثى')}
                  className={`px-2 py-0.5 rounded transition-all text-[11px] ${
                    genderFilter === 'أنثى'
                      ? "bg-emerald-600 text-white font-bold"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  إناث ♀️
                </button>
              </div>
            </div>

            {/* Category Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none flex-row-reverse">
              {VOICE_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-xl border text-xs whitespace-nowrap transition-all flex items-center gap-1.5 flex-row-reverse ${
                    activeCategory === cat.id
                      ? "bg-emerald-950/60 border-emerald-500 text-emerald-300 font-bold shadow-sm"
                      : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  }`}
                >
                  <span>{cat.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    activeCategory === cat.id ? "bg-emerald-800/60 text-white" : "bg-neutral-800 text-neutral-400"
                  }`}>
                    {cat.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بالاسم، اللهجة، أو الطابع..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl py-2 px-3 pl-8 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500 text-right dir-rtl"
              />
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2.5" />
            </div>

            {/* Dynamic Microsoft Multilingual Voice Selector */}
            {activeCategory === "edge" && (
              <div className="mb-2">
                <MicrosoftVoicePicker
                  selectedVoice={localConfig.ttsVoice}
                  onSelectVoice={(voiceId) => handleSelectVoice(voiceId)}
                  label="أصوات Microsoft متعددة اللغات واللهجات ديناميكيًا:"
                />
              </div>
            )}

            {/* Voices Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1 bg-neutral-950/70 border border-neutral-800/80 rounded-xl">
              {filteredVoices.map((voice) => {
                const isSelected = localConfig.ttsVoice === voice.id;
                return (
                  <button
                    key={voice.id}
                    type="button"
                    onClick={() => handleSelectVoice(voice.id)}
                    className={`p-2.5 rounded-xl border text-right transition-all flex flex-col gap-1.5 ${
                      isSelected
                        ? "bg-emerald-950/40 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500/50"
                        : "bg-neutral-900/60 border-neutral-800 text-neutral-300 hover:bg-neutral-800/70 hover:border-neutral-700"
                    }`}
                  >
                    <div className="flex items-center justify-between flex-row-reverse w-full">
                      <div className="flex items-center gap-1.5 flex-row-reverse">
                        <span className="text-sm">{voice.flag || "🎙️"}</span>
                        <span className="text-xs font-bold text-white">{voice.name}</span>
                        <span className="text-[10px] text-neutral-400 px-1.5 py-0.5 rounded bg-neutral-800/80">
                          {voice.gender === 'ذكر' ? "ذكر ♂️" : "أنثى ♀️"}
                        </span>
                      </div>
                      {isSelected ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <span className="text-[10px] text-neutral-500">
                          {voice.category === 'gemini' ? 'Gemini' : voice.category === 'chatgpt' ? 'ChatGPT' : voice.category === 'capcut' ? 'CapCut' : voice.category === 'huggingface' ? 'نبرة' : (voice.category as string) === 'multilingual' ? 'Multi' : 'Edge'}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-neutral-400 line-clamp-1 text-right">
                      {voice.dialectOrTone || voice.description}
                    </p>
                  </button>
                );
              })}

              {filteredVoices.length === 0 && (
                <div className="col-span-full py-8 text-center text-xs text-neutral-500">
                  لا توجد أصوات مطابقة لبحثك الحالي
                </div>
              )}
            </div>

            {/* Selected Voice Detail Card */}
            {selectedVoiceObj && (
              <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between flex-row-reverse">
                  <div className="flex items-center gap-2 flex-row-reverse">
                    <span className="text-lg">{selectedVoiceObj.flag || "🎙️"}</span>
                    <div>
                      <div className="font-bold text-white flex items-center gap-2 flex-row-reverse">
                        <span>{selectedVoiceObj.name}</span>
                        <span className="text-[10px] font-mono text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-800/60">
                          {selectedVoiceObj.categoryLabel}
                        </span>
                        <span className="text-[10px] text-neutral-400">
                          ({selectedVoiceObj.gender})
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] text-emerald-400 font-bold">الصوت المعتمد للدبلجة</span>
                </div>

                <p className="text-[11px] text-neutral-300 leading-relaxed">
                  {selectedVoiceObj.description}
                </p>

                {selectedVoiceObj.recommendedFor && selectedVoiceObj.recommendedFor.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap flex-row-reverse pt-1">
                    <span className="text-[10px] text-neutral-500">مناسب لـ:</span>
                    {selectedVoiceObj.recommendedFor.map((rec, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">
                        {rec}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 3: TTS Speech Speed Slider (1.0x - 2.0x) */}
          <div className="space-y-3 border-t border-neutral-800 pt-4">
            <div className="flex items-center justify-between flex-row-reverse">
              <label className="text-xs font-bold text-neutral-200 flex items-center gap-1.5 flex-row-reverse">
                <Gauge className="w-4 h-4 text-teal-400" />
                <span>سرعة الإلقاء الصوتي (TTS Speed Slider)</span>
              </label>
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-2.5 py-0.5 rounded-lg shadow-sm">
                {Number(localConfig.ttsSpeed || 1.0).toFixed(2)}x
              </span>
            </div>

            {/* Continuous Interactive Range Slider (1.0x - 2.0x) */}
            <div className="space-y-2 bg-neutral-950/80 p-3 rounded-xl border border-neutral-800">
              <input
                type="range"
                min="1.0"
                max="2.0"
                step="0.05"
                value={localConfig.ttsSpeed || 1.0}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setLocalConfig(prev => ({ ...prev, ttsSpeed: Number(val.toFixed(2)) }));
                  setResynthesizeOnSave(true);
                }}
                className="w-full accent-emerald-500 bg-neutral-900 h-2 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-neutral-500 px-1">
                <span>1.00x (طبيعي)</span>
                <span>1.25x</span>
                <span>1.50x</span>
                <span>1.75x</span>
                <span>2.00x (سريع)</span>
              </div>
            </div>

            {/* Quick Speed Preset Buttons */}
            <div className="grid grid-cols-6 gap-1.5">
              {[1.0, 1.1, 1.25, 1.5, 1.75, 2.0].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => {
                    setLocalConfig(prev => ({ ...prev, ttsSpeed: spd }));
                    setResynthesizeOnSave(true);
                  }}
                  className={`py-2 rounded-xl border text-xs font-mono font-medium transition-all ${
                    Math.abs(localConfig.ttsSpeed - spd) < 0.01
                      ? "bg-emerald-600 border-emerald-500 text-white font-bold shadow-md shadow-emerald-950/40"
                      : "bg-neutral-950 border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              * ملاحظة: يضبط الشريط مدة القراءة الصوتية ومزامنة المشهد الحركي بدقة متناهية (1.0x إلى 2.0x) مع الحفاظ الكامل على نبرة الصوت البشرية وسرعة تشغيل الفيديو الأصلية.
            </p>
          </div>

          {/* Section 4: Resynthesize toggle if voice or speed changed */}
          {resynthesizeOnSave && (
            <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-between flex-row-reverse">
              <div className="flex items-center gap-2 flex-row-reverse text-xs text-neutral-300">
                <RefreshCw className="w-4 h-4 text-emerald-400" />
                <span>إعادة توليد المقاطع الصوتية المعالجة مسبقاً بالصوت والسرعة الجديدة؟</span>
              </div>
              <input
                type="checkbox"
                checked={resynthesizeOnSave}
                onChange={(e) => setResynthesizeOnSave(e.target.checked)}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 flex-row-reverse border-t border-neutral-800 pt-3 shrink-0">
          <button
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-950/50 flex items-center gap-2 flex-row-reverse"
          >
            <Check className="w-4 h-4" />
            <span>حفظ الإعدادات</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-all"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
};
