import React, { useState, useEffect } from "react";
import {
  Save,
  Trash2,
  ShieldCheck,
  Loader2,
  KeyRound,
  Database,
  Bot,
  Languages,
  Check,
  Sparkles,
  Image as ImageIcon,
} from "lucide-react";
import { globalEngine, EngineMode } from "../lib/mangaGlobalEngine";
import {
  DEFAULT_USER_FLOW_COOKIES,
  loadFlowCookies,
  loadFlowTaskModels,
  saveFlowCookies,
  saveFlowTaskModels,
  testGoogleFlowConnection,
  testGoogleFlowGeneration,
} from "../services/novelToMangaClient";
import type { FlowDisplayModelName } from "../types/novelToManga";

export const GOOGLE_FLOW_MODEL_OPTIONS: Array<{
  id: FlowDisplayModelName;
  name: string;
  badge: string;
  badgeColor: string;
  desc: string;
}> = [
  {
    id: "Nano Banana 2 Lite",
    name: "Nano Banana 2 Lite (gemini-2.5-flash-image)",
    badge: "⚡ أسرع توليد",
    badgeColor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    desc: "أقصى سرعة لتوليد صور المواقع والمشاهد في أقل وقت ممكن (~6 ثوانٍ).",
  },
  {
    id: "Nano Banana 2",
    name: "Nano Banana 2 (gemini-3.1-flash-image)",
    badge: "🌟 متوازن",
    badgeColor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    desc: "توازن مثالي بين السرعة وتفاصيل المشاهد متعددة المراجع.",
  },
  {
    id: "Nano Banana Pro",
    name: "Nano Banana Pro (gemini-3-pro-image)",
    badge: "🎨 فائق الدقة",
    badgeColor: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    desc: "أعلى دقة بصرية لتثبيت المراجع وتفاصيل الشخصيات والبيئة.",
  },
];

export const GEMINI_COOKIE_OPTIONS = [
  {
    id: "3.5-flash-lite",
    name: "3.5 Flash-Lite",
    badge: "⚡ سريع",
    badgeColor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    desc: "سرعة قصوى واستجابة فورية.",
    feature: "Extended Thinking: OFF",
  },
  {
    id: "3.5-flash-lite-extended",
    name: "3.5 Flash-Lite (Extended)",
    badge: "🧠 تفكير موسع",
    badgeColor: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    desc: "تفكير موسع للمهام الدقيقة.",
    feature: "Extended Thinking: ON",
  },
  {
    id: "3.6-flash",
    name: "3.6 Flash",
    badge: "🌟 متوازن",
    badgeColor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    desc: "متوازن للسياق الطويل والحوارات.",
    feature: "Extended Thinking: OFF",
  },
  {
    id: "3.1-pro",
    name: "3.1 Pro",
    badge: "🧠 متقدم",
    badgeColor: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    desc: "للمشاكل المعقدة والاستمرارية.",
    feature: "Extended Thinking: OFF",
  },
];

export default function SettingsPage() {
  // Gemini Cookies states
  const [cookies, setCookies] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return localStorage.getItem("gemini_cookie_model") || "3.6-flash";
  });

  const handleGeminiModelChange = (modelId: string) => {
    setGeminiModel(modelId);
    localStorage.setItem("gemini_cookie_model", modelId);
  };

  // Google Flow Cookies states (Novel -> Manga Image Generation)
  const [flowCookies, setFlowCookies] = useState<string>(() => loadFlowCookies());
  const [isFlowSaving, setIsFlowSaving] = useState(false);
  const [isFlowTesting, setIsFlowTesting] = useState(false);
  const [isFlowGenTesting, setIsFlowGenTesting] = useState(false);
  const [flowTestResult, setFlowTestResult] = useState<{
    success: boolean;
    message: string;
    previewUrl?: string;
  } | null>(null);
  const [flowModel, setFlowModel] = useState<FlowDisplayModelName>(() => {
    return loadFlowTaskModels().scene_generation || "Nano Banana 2 Lite";
  });

  const handleFlowModelChange = (modelName: FlowDisplayModelName) => {
    setFlowModel(modelName);
    const currentMap = loadFlowTaskModels();
    saveFlowTaskModels({
      ...currentMap,
      reference_generation: modelName,
      scene_generation: modelName,
      page_generation: modelName,
    });
  };

  // ChatGPT Cookies states
  const [gptCookies, setGptCookies] = useState("");
  const [isGptSaving, setIsGptSaving] = useState(false);
  const [isGptTesting, setIsGptTesting] = useState(false);
  const [gptTestResult, setGptTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Meta AI Cookies states
  const [metaAiCookies, setMetaAiCookies] = useState("");
  const [isMetaAiSaving, setIsMetaAiSaving] = useState(false);
  const [isMetaAiTesting, setIsMetaAiTesting] = useState(false);
  const [metaAiTestResult, setMetaAiTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Suwayomi Engine states
  const DEFAULT_SUWAYOMI_URL =
    "https://f212af09-ae8a-4d6f-be1a-59fbca80573e-00-3ctaa6lqfzq7d.sisko.replit.dev";
  const [engineMode, setEngineMode] = useState<EngineMode>("suwayomi");
  const [suwayomiUrl, setSuwayomiUrl] = useState(DEFAULT_SUWAYOMI_URL);
  const [isSuwayomiTesting, setIsSuwayomiTesting] = useState(false);
  const [suwayomiTestResult, setSuwayomiTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Default Reader Translator Engine
  const [translatorEngine, setTranslatorEngine] = useState<string>(() => {
    const saved = localStorage.getItem("reader_translator_engine");
    if (saved === "gemini" || saved === "gemini_cookies") {
      const c = localStorage.getItem("gemini_cookies");
      if (c && c.trim()) return "gemini_cookies";
      return "google";
    }
    if (saved === "metaai") return "metaai";
    if (saved === "google") return "google";
    const c = localStorage.getItem("gemini_cookies");
    if (c && c.trim()) return "gemini_cookies";
    return "google";
  });

  const handleTranslatorEngineChange = (engine: string) => {
    setTranslatorEngine(engine);
    localStorage.setItem("reader_translator_engine", engine);
  };

  useEffect(() => {
    const rawSaved = localStorage.getItem("gemini_cookies") || "";
    const isStale =
      !rawSaved.trim() ||
      rawSaved.includes("g.a000DAkn") ||
      rawSaved.includes("g.a000Cwm2") ||
      rawSaved.includes("g.a000BQkn");
    const savedCookies = isStale ? DEFAULT_USER_FLOW_COOKIES : rawSaved;
    if (isStale) {
      localStorage.setItem("gemini_cookies", DEFAULT_USER_FLOW_COOKIES);
    }
    setCookies(savedCookies);

    const initialFlowCookies = loadFlowCookies();
    setFlowCookies(initialFlowCookies);

    const savedGptCookies = localStorage.getItem("gpt_cookies") || "";
    setGptCookies(savedGptCookies);

    const savedMetaCookies = localStorage.getItem("metaai_cookies") || "";
    setMetaAiCookies(savedMetaCookies);

    const savedSuw =
      localStorage.getItem("suwayomi_server_url") ||
      localStorage.getItem("suwayomi_url");
    if (
      savedSuw &&
      savedSuw.startsWith("http") &&
      savedSuw.includes("f212af09-ae8a")
    ) {
      setSuwayomiUrl(savedSuw);
    } else {
      setSuwayomiUrl(DEFAULT_SUWAYOMI_URL);
      localStorage.setItem("suwayomi_server_url", DEFAULT_SUWAYOMI_URL);
      localStorage.setItem("suwayomi_url", DEFAULT_SUWAYOMI_URL);
    }
    setEngineMode("suwayomi");
    globalEngine.setMode("suwayomi");
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    const encoded = btoa(unescape(encodeURIComponent(cookies)));
    localStorage.setItem("gemini_cookies_encoded", encoded);
    localStorage.setItem("gemini_cookies", cookies);
    await new Promise((r) => setTimeout(r, 400));
    setIsSaving(false);
    setTestResult({
      success: true,
      message: "تم حفظ ملفات تعريف الارتباط لـ Gemini AI بنجاح!",
    });
  };

  const handleDelete = () => {
    localStorage.removeItem("gemini_cookies");
    localStorage.removeItem("gemini_cookies_encoded");
    localStorage.removeItem("gemini_cookies_status");
    setCookies("");
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!cookies.trim()) {
      setTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط أولاً.",
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/manga/test-cookies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cookies, model: geminiModel }),
      });

      const data = await response.json().catch(() => null);
      if (response.ok && data?.success !== false) {
        localStorage.setItem("gemini_cookies_status", "Connected");
        setTestResult({
          success: true,
          message: data?.message || "تم الاتصال بنجاح بـ Gemini AI!",
        });
      } else {
        setTestResult({
          success: false,
          message:
            data?.error ||
            "فشل الاتصال، تأكد من صلاحية ملفات تعريف الارتباط.",
        });
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء الاتصال.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleFlowSave = async () => {
    setIsFlowSaving(true);
    saveFlowCookies(flowCookies);
    try {
      const data = await testGoogleFlowConnection(flowCookies);
      const realId =
        data?.diagnostics?.selected_active_project_id ||
        data?.diagnostics?.active_project_id ||
        null;
      setIsFlowSaving(false);
      setFlowTestResult({
        success: Boolean(data?.success),
        message: data?.success
          ? `تم حفظ الكوكيز وربط مشروع Google Flow الحقيقي بنجاح (${realId || "متصل"})!`
          : data?.message || "تم حفظ الكوكيز في المتصفح. يرجى التحقق من وجود مشروع Google Flow حقيقي في حسابك.",
      });
    } catch (_) {
      setIsFlowSaving(false);
      setFlowTestResult({
        success: true,
        message: "تم حفظ ملفات تعريف الارتباط لـ Google Flow بنجاح!",
      });
    }
  };

  const handleFlowDelete = () => {
    localStorage.removeItem("google_flow_cookies");
    setFlowCookies("");
    setFlowTestResult(null);
  };

  const handleFlowTest = async () => {
    if (!flowCookies.trim()) {
      setFlowTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط لـ Google Flow أولاً.",
      });
      return;
    }

    setIsFlowTesting(true);
    setFlowTestResult(null);
    try {
      saveFlowCookies(flowCookies);
      const data = await testGoogleFlowConnection(flowCookies);
      if (data?.success) {
        const activeCount =
          data?.diagnostics?.FLOW_ACTIVE_PROJECTS_COUNT ||
          (Array.isArray(data?.projects)
            ? data.projects.filter((p: any) => p.status === "ACTIVE").length
            : 1);
        const realProjectId =
          data?.diagnostics?.selected_active_project_id ||
          data?.diagnostics?.active_project_id ||
          "";
        setFlowTestResult({
          success: true,
          message:
            data.message ||
            `تم الاتصال بنجاح بـ Google Flow! (${activeCount} مشاريع حقيقية نشطة — المشروع النشط: ${realProjectId})`,
        });
      } else {
        setFlowTestResult({
          success: false,
          message:
            data?.message ||
            data?.error ||
            "FLOW_PROJECT_NOT_FOUND: فشل الاتصال أو لم يتم العثور على مشروع حقيقي في Google Flow.",
        });
      }
    } catch (e: any) {
      setFlowTestResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء فحص جلسة Google Flow.",
      });
    } finally {
      setIsFlowTesting(false);
    }
  };

  const handleFlowTestGeneration = async () => {
    if (!flowCookies.trim()) {
      setFlowTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط لـ Google Flow أولاً.",
      });
      return;
    }

    setIsFlowGenTesting(true);
    setFlowTestResult(null);
    try {
      saveFlowCookies(flowCookies);
      const res = await testGoogleFlowGeneration({
        flowCookies,
        modelDisplayName: flowModel,
      });
      if (res?.success) {
        setFlowTestResult({
          success: true,
          message:
            res.message ||
            `تم اختبار توليد الصور بنجاح داخل مشروع Google Flow الحقيقي (${res.flowProjectId || flowModel})!`,
          previewUrl: res.public_url || undefined,
        });
      } else {
        setFlowTestResult({
          success: false,
          message: res?.error || res?.message || "FLOW_GENERATION_FAILED: فشل اختبار توليد الصورة عبر Google Flow.",
        });
      }
    } catch (e: any) {
      setFlowTestResult({
        success: false,
        message: e.message || "حدث خطأ أثناء اختبار توليد الصورة.",
      });
    } finally {
      setIsFlowGenTesting(false);
    }
  };

  const handleGptSave = async () => {
    setIsGptSaving(true);
    const encoded = btoa(unescape(encodeURIComponent(gptCookies)));
    localStorage.setItem("gpt_cookies_encoded", encoded);
    localStorage.setItem("gpt_cookies", gptCookies);
    await new Promise((r) => setTimeout(r, 400));
    setIsGptSaving(false);
    setGptTestResult({
      success: true,
      message: "تم حفظ ملفات تعريف ارتباط ChatGPT بنجاح!",
    });
  };

  const handleGptDelete = () => {
    localStorage.removeItem("gpt_cookies");
    localStorage.removeItem("gpt_cookies_encoded");
    setGptCookies("");
    setGptTestResult(null);
  };

  const handleGptTest = async () => {
    if (!gptCookies.trim()) {
      setGptTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط لحساب ChatGPT أولاً.",
      });
      return;
    }

    setIsGptTesting(true);
    setGptTestResult(null);
    try {
      const response = await fetch("/api/manga/test-gpt-cookies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cookies: gptCookies }),
      });

      const data = await response.json().catch(() => null);
      if (response.ok && data?.success !== false) {
        setGptTestResult({
          success: true,
          message:
            data?.message || "تم الاتصال وحصلنا على رمز الوصول بنجاح!",
        });
      } else {
        setGptTestResult({
          success: false,
          message:
            data?.error ||
            "فشل الاتصال، تأكد من صلاحية ملفات تعريف الارتباط لحساب ChatGPT.",
        });
      }
    } catch (e: any) {
      setGptTestResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء الاتصال.",
      });
    } finally {
      setIsGptTesting(false);
    }
  };

  const handleMetaAiSave = async () => {
    setIsMetaAiSaving(true);
    localStorage.setItem("metaai_cookies", metaAiCookies);
    await new Promise((r) => setTimeout(r, 400));
    setIsMetaAiSaving(false);
    setMetaAiTestResult({
      success: true,
      message: "تم حفظ ملفات تعريف ارتباط Meta AI بنجاح!",
    });
  };

  const handleMetaAiDelete = () => {
    localStorage.removeItem("metaai_cookies");
    setMetaAiCookies("");
    setMetaAiTestResult(null);
  };

  const handleMetaAiTest = async () => {
    if (!metaAiCookies.trim()) {
      setMetaAiTestResult({
        success: false,
        message: "يرجى إدخال ملفات تعريف الارتباط لـ Meta AI أولاً.",
      });
      return;
    }

    setIsMetaAiTesting(true);
    setMetaAiTestResult(null);
    try {
      const response = await fetch("/api/manga/test-metaai-cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: metaAiCookies }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.success !== false) {
        setMetaAiTestResult({
          success: true,
          message: data?.message || "تم الاتصال بـ Meta AI بنجاح!",
        });
      } else {
        setMetaAiTestResult({
          success: false,
          message: data?.error || "فشل الاتصال بـ Meta AI.",
        });
      }
    } catch (e: any) {
      setMetaAiTestResult({
        success: false,
        message: e.message || "حدث خطأ غير متوقع أثناء الاتصال.",
      });
    } finally {
      setIsMetaAiTesting(false);
    }
  };

  const handleEngineChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value as EngineMode;
    setEngineMode(newMode);
    globalEngine.setMode(newMode);
  };

  const handleSuwayomiUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSuwayomiUrl(val);
    localStorage.setItem("suwayomi_server_url", val);
    localStorage.setItem("suwayomi_url", val);
  };

  const handleTestSuwayomi = async () => {
    setIsSuwayomiTesting(true);
    setSuwayomiTestResult(null);
    try {
      const resp = await fetch("/api/suwayomi/status", {
        headers: { "x-suwayomi-url": suwayomiUrl.trim() },
      });
      const data = await resp.json();
      if (data.online) {
        setSuwayomiTestResult({
          success: true,
          message: `تم الاتصال بنجاح بخادم Suwayomi (${data.sourcesCount || 0} مصادر نشطة)`,
        });
      } else {
        setSuwayomiTestResult({
          success: false,
          message:
            data.error || data.message || "تعذر الاتصال بخادم Suwayomi.",
        });
      }
    } catch (e: any) {
      setSuwayomiTestResult({
        success: false,
        message: e.message || "فشل الاتصال بخادم Suwayomi.",
      });
    } finally {
      setIsSuwayomiTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8 pb-24" dir="rtl">
      <div className="flex flex-col gap-12">
        {/* Gemini AI Settings (Classic View) */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <KeyRound className="h-6 w-6 text-emerald-400" />
              إعدادات Gemini AI
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              قم بضبط إعدادات الوصول إلى Gemini AI باستخدام ملفات تعريف الارتباط (Cookies) للحصول على أداء فائق في الترجمة.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            {/* Gemini Cookie Model Selector */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span>اختر نموذج Gemini المفضل (عبر الكوكيز):</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {GEMINI_COOKIE_OPTIONS.map((opt) => {
                  const isSelected = geminiModel === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleGeminiModelChange(opt.id)}
                      className={`p-3.5 rounded-xl border text-right transition flex flex-col gap-1.5 cursor-pointer ${
                        isSelected
                          ? "bg-emerald-500/15 border-emerald-500 text-white shadow-lg shadow-emerald-500/5"
                          : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-white">
                          {opt.name}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${opt.badgeColor}`}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                مربع إدخال ملفات تعريف الارتباط (Cookies)
              </label>
              <textarea
                dir="ltr"
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                placeholder={`# Netscape HTTP Cookie File\n\n.google.com\tTRUE\t/\tFALSE\t1792536260\t__Secure-1PSID\t...`}
                className="w-full h-64 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-emerald-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Cookies
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting || !cookies.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test Cookies
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 font-bold text-sm border border-red-900/30 transition active:scale-95 mr-auto cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete Cookies
              </button>
            </div>

            {testResult && (
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  testResult.success
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {testResult.success ? (
                  <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0" />
                ) : (
                  <span className="h-5 w-5 mt-0.5 text-lg leading-none shrink-0">
                    ⚠️
                  </span>
                )}
                <div>
                  <strong className="block text-sm mb-1">
                    {testResult.success ? "نجاح العملية" : "تنبيه"}
                  </strong>
                  <p className="text-xs">{testResult.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Google Flow Cookies Settings (Classic View for Novel -> Manga) */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <ImageIcon className="h-6 w-6 text-indigo-400" />
              إعدادات Google Flow (توليد صور الرواية → مانجا)
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              قم بضبط ملفات تعريف الارتباط (Cookies) الخاصة بـ Google Flow لتوليد صور المواقع والمشاهد وصفحات المانجا بأقصى سرعة ودقة.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            {/* Google Flow Model Selector */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                <span>اختر نموذج التوليد الافتراضي في Google Flow:</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {GOOGLE_FLOW_MODEL_OPTIONS.map((opt) => {
                  const isSelected = flowModel === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleFlowModelChange(opt.id)}
                      className={`p-3.5 rounded-xl border text-right transition flex flex-col gap-1.5 cursor-pointer ${
                        isSelected
                          ? "bg-indigo-500/15 border-indigo-500 text-white shadow-lg shadow-indigo-500/5"
                          : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-white">
                          {opt.id}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${opt.badgeColor}`}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                مربع إدخال ملفات تعريف الارتباط لـ Google Flow (Cookies)
              </label>
              <textarea
                dir="ltr"
                value={flowCookies}
                onChange={(e) => setFlowCookies(e.target.value)}
                placeholder={`# Netscape HTTP Cookie File\n\n.google.com\tTRUE\t/\tTRUE\t1825356318\t__Secure-1PSID\t...\nflow.google.com\tFALSE\t/\tTRUE\t1825356617\t__Secure-OSID\t...`}
                className="w-full h-64 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-indigo-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleFlowSave}
                disabled={isFlowSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isFlowSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Flow Cookies
              </button>
              <button
                type="button"
                onClick={handleFlowTest}
                disabled={isFlowTesting || !flowCookies.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isFlowTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test Flow Cookies
              </button>
              <button
                type="button"
                onClick={handleFlowTestGeneration}
                disabled={isFlowGenTesting || !flowCookies.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 font-bold text-sm border border-emerald-700/40 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isFlowGenTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                اختبار توليد صورة سريع
              </button>
              <button
                type="button"
                onClick={handleFlowDelete}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 font-bold text-sm border border-red-900/30 transition active:scale-95 mr-auto cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete Flow Cookies
              </button>
            </div>

            {flowTestResult && (
              <div
                className={`p-4 rounded-xl border flex flex-col gap-3 ${
                  flowTestResult.success
                    ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                <div className="flex items-start gap-3">
                  {flowTestResult.success ? (
                    <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0 text-emerald-400" />
                  ) : (
                    <span className="h-5 w-5 mt-0.5 text-lg leading-none shrink-0">
                      ⚠️
                    </span>
                  )}
                  <div>
                    <strong className="block text-sm mb-1">
                      {flowTestResult.success ? "نجاح فحص Google Flow" : "تنبيه"}
                    </strong>
                    <p className="text-xs">{flowTestResult.message}</p>
                  </div>
                </div>
                {flowTestResult.previewUrl && (
                  <div className="mt-1">
                    <img
                      src={flowTestResult.previewUrl}
                      alt="Flow Test Output"
                      className="h-36 w-auto rounded-lg border border-indigo-500/30 object-cover"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ChatGPT Multimodal TTS Settings (Classic View) */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <KeyRound className="h-6 w-6 text-purple-400" />
              إعدادات ChatGPT Multimodal TTS
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              قم بضبط إعدادات الوصول إلى حساب ChatGPT الخاص بك باستخدام ملفات تعريف الارتباط (Cookies) لتشغيل ميزة النطق الصوتي الفائق الواقعية والذكية.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                مربع إدخال ملفات تعريف الارتباط لـ ChatGPT (Cookies)
              </label>
              <textarea
                dir="ltr"
                value={gptCookies}
                onChange={(e) => setGptCookies(e.target.value)}
                placeholder={`# Netscape HTTP Cookie File\n\n.chatgpt.com\tTRUE\t/\tTRUE\t1799801739\toai-did\t6fabe2d1-8c3d-4414-aec2-ee11f424f8bd...`}
                className="w-full h-64 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-purple-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGptSave}
                disabled={isGptSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isGptSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save ChatGPT Cookies
              </button>
              <button
                type="button"
                onClick={handleGptTest}
                disabled={isGptTesting || !gptCookies.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isGptTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test ChatGPT Cookies
              </button>
              <button
                type="button"
                onClick={handleGptDelete}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 font-bold text-sm border border-red-900/30 transition active:scale-95 mr-auto cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete ChatGPT Cookies
              </button>
            </div>

            {gptTestResult && (
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  gptTestResult.success
                    ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {gptTestResult.success ? (
                  <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0" />
                ) : (
                  <span className="h-5 w-5 mt-0.5 text-lg leading-none shrink-0">
                    ⚠️
                  </span>
                )}
                <div>
                  <strong className="block text-sm mb-1">
                    {gptTestResult.success ? "نجاح العملية" : "تنبيه"}
                  </strong>
                  <p className="text-xs">{gptTestResult.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Meta AI Cookies Settings (Classic View) */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <Bot className="h-6 w-6 text-blue-400" />
              إعدادات Meta AI للترجمة السريعة
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              قم بإدخال ملفات تعريف الارتباط (Cookies) الخاصة بـ Meta AI لتفعيل الترجمة المجانية السريعة للفصول.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                مربع إدخال ملفات تعريف الارتباط لـ Meta AI (Cookies)
              </label>
              <textarea
                dir="ltr"
                value={metaAiCookies}
                onChange={(e) => setMetaAiCookies(e.target.value)}
                placeholder={`datr=...; abra_sess=...; wd=...`}
                className="w-full h-48 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-blue-500 focus:outline-none resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleMetaAiSave}
                disabled={isMetaAiSaving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isMetaAiSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Meta AI Cookies
              </button>
              <button
                type="button"
                onClick={handleMetaAiTest}
                disabled={isMetaAiTesting || !metaAiCookies.trim()}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm border border-slate-700 transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isMetaAiTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Test Meta AI Cookies
              </button>
              <button
                type="button"
                onClick={handleMetaAiDelete}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-400 font-bold text-sm border border-red-900/30 transition active:scale-95 mr-auto cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete Meta AI Cookies
              </button>
            </div>

            {metaAiTestResult && (
              <div
                className={`p-4 rounded-xl border flex items-start gap-3 ${
                  metaAiTestResult.success
                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {metaAiTestResult.success ? (
                  <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0" />
                ) : (
                  <span className="h-5 w-5 mt-0.5 text-lg leading-none shrink-0">
                    ⚠️
                  </span>
                )}
                <div>
                  <strong className="block text-sm mb-1">
                    {metaAiTestResult.success ? "نجاح العملية" : "تنبيه"}
                  </strong>
                  <p className="text-xs">{metaAiTestResult.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Default Translator Engine & Suwayomi Server Settings */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl flex items-center gap-2">
              <Languages className="h-6 w-6 text-emerald-400" />
              إعدادات الترجمة ومحرك المصادر
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              اختر محرك الترجمة الافتراضي داخل القارئ واضبط رابط خادم Suwayomi للمصادر.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300">
                نظام الترجمة الافتراضي
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { id: "gemini_cookies", label: "Gemini AI (عبر الكوكيز)" },
                  { id: "metaai", label: "Meta AI (عبر الكوكيز)" },
                  { id: "google", label: "ترجمة Google الفورية" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleTranslatorEngineChange(item.id)}
                    className={`p-3.5 rounded-xl border text-right text-xs font-bold flex items-center justify-between cursor-pointer transition ${
                      translatorEngine === item.id
                        ? "bg-emerald-500/15 border-emerald-500 text-white"
                        : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <span>{item.label}</span>
                    {translatorEngine === item.id && (
                      <Check className="h-4 w-4 text-emerald-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[1px] bg-slate-800" />

            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <Database className="h-4 w-4 text-sky-400" />
                <span>محرك المصادر (Suwayomi Server)</span>
              </label>
              <select
                value={engineMode}
                onChange={handleEngineChange}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:border-sky-500 focus:outline-none"
              >
                <option value="suwayomi">Suwayomi Server (2200+ مصدر)</option>
              </select>
              <input
                type="text"
                dir="ltr"
                value={suwayomiUrl}
                onChange={handleSuwayomiUrlChange}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 focus:border-sky-500 focus:outline-none"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestSuwayomi}
                  disabled={isSuwayomiTesting || !suwayomiUrl.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isSuwayomiTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  <span>فحص اتصال Suwayomi</span>
                </button>
              </div>
              {suwayomiTestResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs font-bold ${
                    suwayomiTestResult.success
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-red-500/10 border-red-500/30 text-red-400"
                  }`}
                >
                  {suwayomiTestResult.message}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
