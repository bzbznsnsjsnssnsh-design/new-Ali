// Reusable Dynamic Microsoft Multilingual Voice Picker
import React, { useState, useEffect, useMemo } from "react";
import { 
  Globe, Volume2, Sparkles, Filter, Loader2, Play, Pause, Search, Check 
} from "lucide-react";
import { 
  MicrosoftVoice, 
  MicrosoftLanguageItem, 
  MicrosoftRegionItem,
  fetchMicrosoftVoices, 
  getMicrosoftLanguages, 
  getMicrosoftRegions, 
  filterMicrosoftVoices 
} from "../../services/microsoftVoicesService";

interface MicrosoftVoicePickerProps {
  selectedVoice: string;
  onSelectVoice: (voiceId: string, voiceObj?: MicrosoftVoice) => void;
  defaultLanguage?: string;
  compact?: boolean;
  className?: string;
  label?: string;
}

export const MicrosoftVoicePicker: React.FC<MicrosoftVoicePickerProps> = ({
  selectedVoice,
  onSelectVoice,
  defaultLanguage = "ar",
  compact = false,
  className = "",
  label = "أصوات Microsoft متعددة اللغات واللهجات:"
}) => {
  const [languages, setLanguages] = useState<MicrosoftLanguageItem[]>([]);
  const [regions, setRegions] = useState<MicrosoftRegionItem[]>([]);
  const [voices, setVoices] = useState<MicrosoftVoice[]>([]);
  
  const [selectedLang, setSelectedLang] = useState<string>(() => {
    // If selectedVoice is e.g. "ar-SA-HamedNeural", extract "ar"
    if (selectedVoice && selectedVoice.includes("-")) {
      return selectedVoice.split("-")[0];
    }
    return defaultLanguage;
  });

  const [selectedLocale, setSelectedLocale] = useState<string>(() => {
    // If selectedVoice is e.g. "ar-SA-HamedNeural", extract "ar-SA"
    if (selectedVoice && selectedVoice.includes("-")) {
      const parts = selectedVoice.split("-");
      if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
    }
    return "all";
  });

  const [selectedGender, setSelectedGender] = useState<"all" | "ذكر" | "أنثى">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Audio preview state
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const audioPreviewRef = React.useRef<HTMLAudioElement | null>(null);

  // Load languages on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      setIsLoading(true);
      try {
        const langs = await getMicrosoftLanguages();
        if (isMounted) {
          setLanguages(langs);
        }
      } catch (err) {
        console.warn("Failed to load Microsoft languages:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  // Update regions when language changes
  useEffect(() => {
    let isMounted = true;
    (async () => {
      if (!selectedLang || selectedLang === "all") {
        setRegions([]);
        return;
      }
      try {
        const regs = await getMicrosoftRegions(selectedLang);
        if (isMounted) {
          setRegions(regs);
          // If current locale is not in new regions, reset to "all"
          if (selectedLocale !== "all" && !regs.some(r => r.locale === selectedLocale)) {
            setSelectedLocale("all");
          }
        }
      } catch (err) {
        console.warn("Failed to load regions:", err);
      }
    })();
    return () => { isMounted = false; };
  }, [selectedLang]);

  // Load & filter voices
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const list = await filterMicrosoftVoices({
          langCode: selectedLang,
          locale: selectedLocale !== "all" ? selectedLocale : undefined,
          gender: selectedGender !== "all" ? selectedGender : undefined,
          search: searchQuery
        });
        if (isMounted) {
          setVoices(list);
        }
      } catch (err) {
        console.warn("Failed to filter voices:", err);
      }
    })();
    return () => { isMounted = false; };
  }, [selectedLang, selectedLocale, selectedGender, searchQuery]);

  // Preview Voice TTS
  const handlePlayPreview = async (voiceId: string) => {
    if (isPlayingPreview) {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        audioPreviewRef.current = null;
      }
      setIsPlayingPreview(false);
      return;
    }

    try {
      setIsPlayingPreview(true);
      const isArabic = voiceId.startsWith("ar-");
      const sampleText = isArabic 
        ? "مرحباً، هذا نموذج تجريبي لصوت مايكروسوفت الطبيعي في قراءة المانهاوا." 
        : "Hello! This is a dynamic test of Microsoft Neural Text to Speech voice.";

      const res = await fetch("/api/manga/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sampleText,
          voiceName: voiceId,
          voiceGroup: "current"
        })
      });

      if (!res.ok) throw new Error("TTS generation failed");
      const data = await res.json();
      if (data.audio) {
        const audio = new Audio(`data:${data.mimeType || "audio/mp3"};base64,${data.audio}`);
        audioPreviewRef.current = audio;
        audio.onended = () => setIsPlayingPreview(false);
        audio.onerror = () => setIsPlayingPreview(false);
        await audio.play();
      } else {
        setIsPlayingPreview(false);
      }
    } catch (e) {
      console.warn("Preview error:", e);
      setIsPlayingPreview(false);
    }
  };

  // Find currently selected voice object
  const currentVoiceObj = useMemo(() => {
    return voices.find(v => v.shortName === selectedVoice) || null;
  }, [voices, selectedVoice]);

  return (
    <div className={`flex flex-col gap-2.5 rounded-xl bg-slate-900/80 p-3 border border-slate-800 text-right ${className}`} dir="rtl">
      {/* Title Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
          <Globe className="h-4 w-4 text-teal-400 shrink-0" />
          <span>{label}</span>
          <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5 rounded-full font-mono">
            {isLoading ? "..." : `${voices.length} صوت متاح`}
          </span>
        </div>
      </div>

      {/* Filter Row: Language & Region/Dialect */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Language selector */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-400 font-medium">اللغة (Language):</label>
          <select
            value={selectedLang}
            onChange={(e) => {
              setSelectedLang(e.target.value);
              setSelectedLocale("all");
            }}
            className="w-full rounded-lg bg-slate-950 border border-slate-700/80 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer"
          >
            <option value="all">🌍 جميع اللغات (All Languages)</option>
            {languages.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label} ({lang.count})
              </option>
            ))}
          </select>
        </div>

        {/* Region / Dialect selector (when available) */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-400 font-medium">اللهجة / المنطقة (Dialect/Region):</label>
          <select
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value)}
            disabled={regions.length === 0}
            className="w-full rounded-lg bg-slate-950 border border-slate-700/80 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="all">جميع مناطق {languages.find(l => l.code === selectedLang)?.label || "اللغة"}</option>
            {regions.map((reg) => (
              <option key={reg.locale} value={reg.locale}>
                {reg.label} ({reg.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Second Row: Gender filter & Search */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Gender Filter */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <span className="text-[10px] text-slate-400 px-2">النوع:</span>
          {(["all", "ذكر", "أنثى"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setSelectedGender(g)}
              className={`flex-1 py-1 text-[11px] rounded-md transition font-medium ${
                selectedGender === g 
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" 
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {g === "all" ? "الكل" : g}
            </button>
          ))}
        </div>

        {/* Search voice name */}
        <div className="relative">
          <Search className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="بحث عن صوت أو لهجة..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg bg-slate-950 border border-slate-700/80 pr-8 pl-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Voice Selection Dropdown & Preview Button */}
      <div className="flex flex-col gap-1 mt-1">
        <label className="text-[10px] text-slate-400 font-medium">الصوت المختار من Microsoft:</label>
        <div className="flex items-center gap-2">
          <select
            value={selectedVoice}
            onChange={(e) => {
              const vObj = voices.find(v => v.shortName === e.target.value);
              onSelectVoice(e.target.value, vObj);
            }}
            className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none cursor-pointer truncate"
          >
            {voices.map((v) => (
              <option key={v.shortName} value={v.shortName}>
                {v.gender === "أنثى" || v.genderEn === "Female" ? "♀️" : "♂️"} {v.shortName.split("-")[2]?.replace("Neural", "") || v.shortName} • {v.localeName}
              </option>
            ))}
            {/* If selected voice is not in current filtered list, keep it visible */}
            {!voices.some(v => v.shortName === selectedVoice) && selectedVoice && (
              <option value={selectedVoice}>
                ⭐ {selectedVoice} (الصوت المحفوظ)
              </option>
            )}
          </select>

          {/* Test / Preview Button */}
          <button
            type="button"
            onClick={() => handlePlayPreview(selectedVoice)}
            disabled={!selectedVoice}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition shrink-0 cursor-pointer ${
              isPlayingPreview
                ? "bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse"
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
            }`}
            title="تجربة الاستماع إلى الصوت"
          >
            {isPlayingPreview ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>إيقاف</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span>تجربة الصوت</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
