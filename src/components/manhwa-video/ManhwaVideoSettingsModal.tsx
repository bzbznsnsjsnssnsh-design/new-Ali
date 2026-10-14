// Settings Modal for Manhwa Video Creator
import React from "react";
import { 
  X, Sparkles, Volume2, Sliders, CheckCircle2, 
  Smartphone, Monitor, Square, Cpu 
} from "lucide-react";
import { VideoCreatorSettings, VIDEO_GEMINI_MODELS, VideoAspectRatio, VideoResolution } from "./types";
import { ALL_PROJECT_VOICES as UNIFIED_DUBBING_VOICES } from "../video-dubbing/dubbingVoices";
import { MicrosoftVoicePicker } from "../common/MicrosoftVoicePicker";

interface ManhwaVideoSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: VideoCreatorSettings;
  onUpdateSettings: (newSettings: Partial<VideoCreatorSettings>) => void;
}

export default function ManhwaVideoSettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdateSettings
}: ManhwaVideoSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in" dir="rtl">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Sliders className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base sm:text-lg font-bold text-white">إعدادات إنشاء فيديو المانهاوا</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {/* 1. Gemini Model Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-white flex items-center gap-2">
                <Cpu className="h-4 w-4 text-emerald-400" />
                <span>نموذج تحليل وسرد Gemini (Cookies)</span>
              </label>
              <span className="text-xs text-emerald-400 font-medium">نظام Gemini Cookies الحالي</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {VIDEO_GEMINI_MODELS.map((model) => {
                const isSelected = settings.geminiModel === model.id;
                return (
                  <div
                    key={model.id}
                    onClick={() => onUpdateSettings({ geminiModel: model.id })}
                    className={`relative p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-950/20 shadow-md shadow-emerald-500/10"
                        : "border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-800/40"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-sm text-white">{model.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          model.badge.includes("الموصى")
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-slate-800 text-slate-300"
                        }`}>
                          {model.badge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed mb-2">
                        {model.description}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-800/60 text-[11px] text-slate-500">
                      {model.features}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. TTS Voice & Provider */}
          <div className="space-y-3">
            <label className="text-sm font-bold text-white flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-emerald-400" />
              <span>الصوت والسرد الصوتي (TTS الحالي)</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">مزود الصوت (Voice Provider)</label>
                <select
                  value={settings.voiceGroup}
                  onChange={(e) => {
                    const group = e.target.value as any;
                    const firstVoice = UNIFIED_DUBBING_VOICES.find(v => v.category === group) || UNIFIED_DUBBING_VOICES[0];
                    onUpdateSettings({ voiceGroup: group, voiceName: firstVoice.id });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="gemini">✨ أصوات Gemini الرسمية (Google)</option>
                  <option value="current">🌊 أصوات Microsoft متعددة اللغات واللهجات (Edge Neural)</option>
                  <option value="capcut">🎬 أصوات CapCut / TikTok</option>
                  <option value="chatgpt">💬 أصوات ChatGPT الطبيعية</option>
                  <option value="huggingface">🤗 Hugging Face TTS</option>
                </select>
              </div>

              {settings.voiceGroup !== "current" && (
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">الصوت المختار</label>
                  <select
                    value={settings.voiceName}
                    onChange={(e) => onUpdateSettings({ voiceName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    {UNIFIED_DUBBING_VOICES.filter(v => settings.voiceGroup === "all" || v.category === settings.voiceGroup).map(v => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.gender} - {v.dialectOrTone || v.categoryLabel})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Dynamic Microsoft Multilingual Voice Selector */}
            {settings.voiceGroup === "current" && (
              <div className="mt-1">
                <MicrosoftVoicePicker
                  selectedVoice={settings.voiceName}
                  onSelectVoice={(voiceId) => onUpdateSettings({ voiceName: voiceId })}
                  label="أصوات Microsoft متعددة اللغات واللهجات ديناميكيًا (جميع الدول واللغات):"
                />
              </div>
            )}

            {/* Playback speed */}
            <div className="pt-2">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span>سرعة الإلقاء الصوتي</span>
                <span className="font-mono text-emerald-400 font-bold">{settings.playbackSpeed}x</span>
              </div>
              <input
                type="range"
                min="1.0"
                max="2.0"
                step="0.05"
                value={settings.playbackSpeed}
                onChange={(e) => onUpdateSettings({ playbackSpeed: parseFloat(e.target.value) })}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>
          </div>

          {/* 3. Video Format & Aspect Ratio */}
          <div className="space-y-3">
            <label className="text-sm font-bold text-white flex items-center gap-2">
              <Monitor className="h-4 w-4 text-emerald-400" />
              <span>أبعاد ودقة الفيديو</span>
            </label>

            <div className="grid grid-cols-3 gap-3">
              {[
                { id: "9:16", label: "عمودي 9:16", sub: "Webtoon / Reels / Shorts", icon: <Smartphone className="h-4 w-4" /> },
                { id: "16:9", label: "أفقي 16:9", sub: "YouTube / شاشات عريضة", icon: <Monitor className="h-4 w-4" /> },
                { id: "1:1", label: "مربع 1:1", sub: "Instagram / Feed", icon: <Square className="h-4 w-4" /> }
              ].map(opt => {
                const isSelected = settings.aspectRatio === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateSettings({ aspectRatio: opt.id as VideoAspectRatio })}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-950/20 text-emerald-400 font-bold shadow-md shadow-emerald-500/10"
                        : "border-slate-800 bg-slate-950/50 text-slate-400 hover:text-white hover:border-slate-700"
                    }`}
                  >
                    {opt.icon}
                    <span className="text-xs">{opt.label}</span>
                    <span className="text-[10px] text-slate-500 text-center leading-tight">{opt.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Subtitles & Options */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">عرض الترجمة والنصوص التوضيحية (Captions)</span>
                <span className="text-[11px] text-slate-400">إظهار شريط النصوص العربية السينمائية أسفل الفيديو</span>
              </div>
              <input
                type="checkbox"
                checked={settings.includeNarrationCaptions}
                onChange={(e) => onUpdateSettings({ includeNarrationCaptions: e.target.checked })}
                className="w-5 h-5 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
          >
            حفظ الإعدادات وإغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
