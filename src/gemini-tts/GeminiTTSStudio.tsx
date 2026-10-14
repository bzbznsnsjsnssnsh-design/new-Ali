import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Play,
  Volume2,
  Settings2,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  ListPlus,
  RefreshCw,
  Users,
  MessageSquare,
  CheckCircle2,
  ExternalLink,
  Info,
  Maximize2,
  Layers,
  ChevronDown,
  ChevronUp,
  ArrowDown,
  ArrowUp,
  Target,
  Smartphone,
  Bot,
  Zap,
  Globe,
} from "lucide-react";
import { GEMINI_VOICES, GEMINI_LANGUAGES } from "./GeminiTTSVoices";
import { GEMINI_TTS_MODELS } from "./GeminiTTSModels";
import { GeminiTTSService } from "./GeminiTTSService";
import { GeminiTTSPlayer } from "./GeminiTTSPlayer";
import { GeminiTTSQueue } from "./GeminiTTSQueue";
import type {
  GeminiTTSRequest,
  GeminiTTSResponse,
  GeminiTTSLiveStatus,
  GeminiTTSBatchItem,
  AudioEncoding,
} from "./GeminiTTSTypes";

export default function GeminiTTSStudio() {
  // Model & Voice Config
  const [selectedModel] = useState("gemini-3.1-flash-tts-preview");
  const [selectedVoice, setSelectedVoice] = useState("Achernar");
  const [selectedLanguage, setSelectedLanguage] = useState("ar-EG");
  const [voiceFilter, setVoiceFilter] = useState<"All" | "Male" | "Female">("All");
  const [voiceSearch, setVoiceSearch] = useState("");

  // Voice Direction Prompt
  const [voiceDirection, setVoiceDirection] = useState(
    "Natural and clear Arabic narration with expressive tone."
  );

  // Input & Dialogue Mode
  const [mode, setMode] = useState<"single" | "dialogue" | "batch">("single");
  const [singleText, setSingleText] = useState(
    "في أعماق الزنزانة المظلمة، استيقظ البطل فجأة ليجد أن النظام قد منحه مهارة جديدة غير متوقعة."
  );

  // Dialogue Mode
  const [dialogueTurns, setDialogueTurns] = useState<Array<{ speaker: string; text: string }>>([
    { speaker: "الراوي", text: "تقدّم البطل نحو البوابة القديمة ببطء." },
    { speaker: "البطل", text: "هل يعقل أن يكون هذا هو الختم الأسطوري المفقود؟" },
    { speaker: "الراوي", text: "فجأة، انبعث ضوء أزرق ساطع من الأحجار المنقوشة!" },
  ]);
  const [speaker1Voice, setSpeaker1Voice] = useState("Achernar");
  const [speaker2Voice, setSpeaker2Voice] = useState("Aoede");

  // Advanced Audio Settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [audioEncoding, setAudioEncoding] = useState<AudioEncoding>("MP3");
  const [speakingRate, setSpeakingRate] = useState(1.0);
  const [pitch, setPitch] = useState(0.0);
  const [volumeGainDb, setVolumeGainDb] = useState(0.0);

  // Batch Queue
  const [batchRawText, setBatchRawText] = useState(
    "المشهد الأول: سكون الليل يخيم على القلعة المهجورة.\nالمشهد الثاني: صوت خطوات خفية تقترب من برج المراقبة.\nالمشهد الثالث: انطلق السهم الناري ليضيء سماء المعركة!"
  );
  const [batchItems, setBatchItems] = useState<GeminiTTSBatchItem[]>([]);
  const queueRef = useRef<GeminiTTSQueue | null>(null);
  const [queueProgress, setQueueProgress] = useState({ completed: 0, total: 0, percent: 0 });
  const [isQueueRunning, setIsQueueRunning] = useState(false);
  const [isCaptchaPaused, setIsCaptchaPaused] = useState(false);

  // Synthesis Execution & Results
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<GeminiTTSResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live System Status & Buster & CAPTCHA
  const [liveStatus, setLiveStatus] = useState<GeminiTTSLiveStatus | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [showLiveView, setShowLiveView] = useState(true);
  const [liveViewImage, setLiveViewImage] = useState<string | null>(null);
  const [liveViewLoading, setLiveViewLoading] = useState(false);
  const [isOpeningPage, setIsOpeningPage] = useState(false);
  const [isReloadingCloudPage, setIsReloadingCloudPage] = useState(false);
  const [isReloadingAndSolving, setIsReloadingAndSolving] = useState(false);
  const [pageOpenFeedback, setPageOpenFeedback] = useState<string | null>(null);

  // Fetch Live Status
  const refreshStatus = async () => {
    setIsCheckingStatus(true);
    try {
      const status = await GeminiTTSService.getLiveStatus();
      setLiveStatus(status);
      if (status.captcha?.needsCaptcha) {
        setShowLiveView(true);
      }
    } catch (_) {}
    setIsCheckingStatus(false);
  };

  // Reload only the official Google Cloud Text-to-Speech page in the browser session
  const handleReloadCloudPage = async () => {
    if (isReloadingCloudPage || isReloadingAndSolving) return;
    setIsReloadingCloudPage(true);
    setPageOpenFeedback("جاري عمل Refresh حقيقي وإعادة تحميل صفحة Google Cloud بالكامل من جديد في المتصفح...");
    try {
      const res = await GeminiTTSService.reloadCloudTtsPage();
      if (res.screenshot?.base64) {
        setLiveViewImage(`data:image/jpeg;base64,${res.screenshot.base64}`);
      } else {
        await fetchLiveView();
      }
      setPageOpenFeedback(res.message || "تم عمل Refresh حقيقي وإعادة تحميل صفحة Google بالكامل من جديد.");
      await refreshStatus();
    } catch (err: any) {
      setPageOpenFeedback(`فشل إعادة تحميل صفحة Google: ${err.message}`);
    } finally {
      setIsReloadingCloudPage(false);
    }
  };

  // Reload Google page AND automatically solve/reset CAPTCHA
  const handleReloadAndSolveCaptcha = async () => {
    if (isReloadingAndSolving || isReloadingCloudPage) return;
    setIsReloadingAndSolving(true);
    setPageOpenFeedback("جاري إعادة تحميل صفحة Google والبدء في حل كابتشا (CAPTCHA) تلقائياً بالذكاء الاصطناعي...");
    try {
      const res = await GeminiTTSService.reloadAndSolveCaptcha();
      if (res.screenshot?.base64) {
        setLiveViewImage(`data:image/jpeg;base64,${res.screenshot.base64}`);
      } else {
        await fetchLiveView();
      }
      setPageOpenFeedback(res.message || "تمت إعادة تحميل الصفحة وبدء حل الكابتشا.");
      await refreshStatus();
    } catch (err: any) {
      setPageOpenFeedback(`فشل إعادة تحميل الصفحة وحل الكابتشا: ${err.message}`);
    } finally {
      setIsReloadingAndSolving(false);
    }
  };

  // Open Google Cloud TTS Page explicitly in browser session
  const handleOpenCloudTtsPage = async () => {
    setIsOpeningPage(true);
    setPageOpenFeedback("جاري فتح صفحة Google Cloud TTS وضبط التمركز على قسم #demo...");
    try {
      const res = await GeminiTTSService.openCloudTtsPage();
      if (res.screenshot?.base64) {
        setLiveViewImage(`data:image/jpeg;base64,${res.screenshot.base64}`);
      }
      setPageOpenFeedback(res.message);
      await refreshStatus();
    } catch (err: any) {
      setPageOpenFeedback(`خطأ في فتح الصفحة: ${err.message}`);
    }
    setIsOpeningPage(false);
  };

  // Initialize and auto-open page automatically on mount
  useEffect(() => {
    refreshStatus();

    // Auto-open and pre-warm Google Cloud TTS page immediately on load
    setIsOpeningPage(true);
    GeminiTTSService.openCloudTtsPage()
      .then((res) => {
        if (res?.screenshot?.base64) {
          setLiveViewImage(`data:image/jpeg;base64,${res.screenshot.base64}`);
        }
        setPageOpenFeedback(res?.message || "تم فتح الصفحة تلقائياً");
        refreshStatus();
      })
      .catch(() => {})
      .finally(() => {
        setIsOpeningPage(false);
      });

    fetchLiveView();

    const liveViewInterval = setInterval(() => {
      fetchLiveView();
    }, 2500);

    const interval = setInterval(() => {
      refreshStatus();
    }, 5000);
    return () => {
      clearInterval(interval);
      clearInterval(liveViewInterval);
    };
  }, []);

  const isFetchingLiveViewRef = useRef(false);
  const [liveViewError, setLiveViewError] = useState<string | null>(null);

  // Poll interactive view if open
  const fetchLiveView = async () => {
    if (isFetchingLiveViewRef.current) return;
    isFetchingLiveViewRef.current = true;
    setLiveViewLoading(true);
    try {
      const view = await GeminiTTSService.getInteractiveView();
      if (view?.base64) {
        setLiveViewImage(`data:image/jpeg;base64,${view.base64}`);
        setLiveViewError(null);
      }
    } catch (err: any) {
      setLiveViewError(err.message || "تعذر جلب الشاشة التفاعلية حالياً.");
    } finally {
      setLiveViewLoading(false);
      isFetchingLiveViewRef.current = false;
    }
  };

  // Full session reset and page reload
  const handleResetSession = async () => {
    setIsOpeningPage(true);
    setPageOpenFeedback("جاري إعادة تشغيل متصفح Chromium وتنشيط الجلسة...");
    setLiveViewImage(null);
    setLiveViewError(null);
    try {
      await GeminiTTSService.resetSession();
      await new Promise((r) => setTimeout(r, 1000));
      const res = await GeminiTTSService.openCloudTtsPage();
      if (res?.screenshot?.base64) {
        setLiveViewImage(`data:image/jpeg;base64,${res.screenshot.base64}`);
      }
      setPageOpenFeedback(res?.message || "تمت إعادة تشغيل الجلسة بنجاح.");
      await refreshStatus();
    } catch (err: any) {
      setPageOpenFeedback(`فشل إعادة التشغيل: ${err.message}`);
    } finally {
      setIsOpeningPage(false);
    }
  };

  useEffect(() => {
    if (showLiveView) {
      fetchLiveView();
      const interval = setInterval(fetchLiveView, 3500);
      return () => clearInterval(interval);
    }
  }, [showLiveView]);

  // Handle interactive clicks/taps on Google Cloud screen (compatible with mobile touch and desktop mouse)
  const handleLiveViewPointer = async (e: React.PointerEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scaleX = 1280 / rect.width;
    const scaleY = 900 / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    try {
      await GeminiTTSService.sendInteraction(x, y);
      setTimeout(fetchLiveView, 600);
    } catch (_) {}
  };

  // Scroll browser to demo section or up/down
  const handleBrowserScroll = async (action: "demo" | "up" | "down", delta?: number) => {
    setLiveViewLoading(true);
    try {
      const res = await GeminiTTSService.scrollBrowser(action, delta);
      if (res?.base64) {
        setLiveViewImage(`data:image/jpeg;base64,${res.base64}`);
      } else {
        await fetchLiveView();
      }
    } catch (_) {}
    setLiveViewLoading(false);
  };

  // Automated Free AI ReCaptcha Solver by Raptor
  const [isSolvingRaptor, setIsSolvingRaptor] = useState(false);
  const [isResettingCaptcha, setIsResettingCaptcha] = useState(false);
  const [raptorFeedback, setRaptorFeedback] = useState<string | null>(null);

  const handleRaptorAutoSolve = async () => {
    setIsSolvingRaptor(true);
    setRaptorFeedback("جاري استدعاء إضافة Free AI ReCaptcha Solver by Raptor لحل تحدي reCAPTCHA تلقائياً بالذكاء الاصطناعي...");
    try {
      const res = await GeminiTTSService.solveCaptchaWithRaptor();
      setRaptorFeedback(res.message);
      if (res.screenshot?.base64) {
        setLiveViewImage(`data:image/jpeg;base64,${res.screenshot.base64}`);
      } else {
        await fetchLiveView();
      }
      await refreshStatus();
    } catch (err: any) {
      setRaptorFeedback(`خطأ أثناء تشغيل Raptor: ${err.message}`);
    } finally {
      setIsSolvingRaptor(false);
    }
  };

  // Reset or reload the CAPTCHA challenge (recovers from 'Try again later' / DOS block)
  const handleResetCaptcha = async () => {
    setIsResettingCaptcha(true);
    setRaptorFeedback("جاري إعادة تعيين كود الكابتشا وتحديث التحدي لتجاوز رسالة Try again later...");
    try {
      const res = await GeminiTTSService.resetCaptcha();
      setRaptorFeedback(res.message);
      if (res.screenshot?.base64) {
        setLiveViewImage(`data:image/jpeg;base64,${res.screenshot.base64}`);
      } else {
        await fetchLiveView();
      }
      await refreshStatus();
    } catch (err: any) {
      setRaptorFeedback(`خطأ أثناء إعادة تعيين الكابتشا: ${err.message}`);
    } finally {
      setIsResettingCaptcha(false);
    }
  };

  // Single Speech Synthesis
  const handleSynthesizeSingle = async (bypassCache: boolean = false, directFallback: boolean = false) => {
    if (!singleText.trim() || isSynthesizing) return;
    setIsSynthesizing(true);
    setErrorMessage(null);

    const req: GeminiTTSRequest = {
      text: singleText.trim(),
      voiceName: selectedVoice,
      languageCode: selectedLanguage,
      voiceDirection: voiceDirection.trim() || undefined,
      audioConfig: {
        audioEncoding,
        speakingRate,
        pitch,
        volumeGainDb,
      },
      useDirectFallback: directFallback,
    };

    try {
      const res = await GeminiTTSService.synthesize(req, { bypassCache });
      setCurrentAudio(res);
      refreshStatus();
    } catch (err: any) {
      setErrorMessage(err.userMessage || err.message || "فشل توليد الصوت");
      refreshStatus();
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Dialogue Synthesis
  const handleSynthesizeDialogue = async () => {
    if (dialogueTurns.length === 0 || isSynthesizing) return;
    setIsSynthesizing(true);
    setErrorMessage(null);

    const req: GeminiTTSRequest = {
      text: "",
      languageCode: selectedLanguage,
      voiceDirection: voiceDirection.trim() || undefined,
      audioConfig: {
        audioEncoding,
        speakingRate,
        pitch,
        volumeGainDb,
      },
      speakers: [
        { alias: "الراوي", voiceName: speaker1Voice },
        { alias: "البطل", voiceName: speaker2Voice },
      ],
      multiSpeakerMarkup: {
        turns: dialogueTurns.map((t) => ({ speaker: t.speaker, text: t.text })),
      },
    };

    try {
      const res = await GeminiTTSService.synthesize(req);
      setCurrentAudio(res);
      refreshStatus();
    } catch (err: any) {
      setErrorMessage(err.userMessage || err.message || "فشل توليد الحوار متعدد الأصوات");
      refreshStatus();
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Initialize Batch Queue
  const prepareBatchQueue = () => {
    const lines = batchRawText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const generationId = `gen_batch_${selectedVoice}_${Date.now()}`;

    const items: GeminiTTSBatchItem[] = lines.map((text, idx) => ({
      id: `batch-${Date.now()}-${idx}`,
      generationId,
      segmentId: `seg_${idx + 1}`,
      title: `السطر ${idx + 1}`,
      text,
      voiceDirection,
      voiceName: selectedVoice, // STRICT VOICE LOCK
      status: "pending",
      retryCount: 0,
      maxRetries: 3,
    }));

    setBatchItems(items);
    const queue = new GeminiTTSQueue(items, 2); // Limit concurrency to 2
    queueRef.current = queue;

    queue.subscribe((event, updatedQueue) => {
      setBatchItems([...updatedQueue]);
      setQueueProgress(queue.getProgress());
      setIsQueueRunning(queue.isQueueRunning());
      setIsCaptchaPaused(queue.isCaptchaPaused());
      if (event === "captcha_pause") {
        setShowLiveView(true);
        refreshStatus();
      }
    });

    setQueueProgress(queue.getProgress());
  };

  const handleRetryBatchItem = (itemId: string) => {
    queueRef.current?.retryItem(itemId);
  };

  const startBatchQueue = () => {
    if (!queueRef.current) {
      prepareBatchQueue();
    }
    setTimeout(() => {
      queueRef.current?.start();
    }, 100);
  };

  const resumeBatchQueue = () => {
    queueRef.current?.resume();
  };

  const pauseBatchQueue = () => {
    queueRef.current?.pause();
  };

  // Filtered Voices List
  const filteredVoices = GEMINI_VOICES.filter((v) => {
    const matchGender = voiceFilter === "All" || v.gender === voiceFilter;
    const matchSearch =
      !voiceSearch.trim() ||
      v.name.toLowerCase().includes(voiceSearch.toLowerCase()) ||
      v.description.includes(voiceSearch) ||
      v.traits.some((t) => t.includes(voiceSearch));
    return matchGender && matchSearch;
  });

  const selectedVoiceObj = GEMINI_VOICES.find((v) => v.name === selectedVoice) || GEMINI_VOICES[0];

  return (
    <div id="gemini-tts-studio-root" dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        
        {/* Top Header Banner */}
        <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/90 to-emerald-950/40 p-5 sm:p-7 shadow-2xl backdrop-blur-xl">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-slate-950 shadow-lg shadow-emerald-500/20">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                    استوديو Gemini TTS المستقل
                    <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-400">
                      Google Cloud Demo
                    </span>
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-400">
                    نظام تحويل النص إلى كلام فائق الواقعية مدعوم بنموذج{" "}
                    <span className="font-mono text-emerald-300 font-semibold">{selectedModel}</span> وإضافة Free AI ReCaptcha Solver by Raptor لحل CAPTCHA.
                  </p>
                </div>
              </div>
            </div>

            {/* Status Indicators Pill Group */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Raptor Badge */}
              <div
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold border transition ${
                  (liveStatus?.raptor?.status === "RAPTOR_AVAILABLE" || liveStatus?.buster?.status === "BUSTER_AVAILABLE" || liveStatus?.buster?.status === "RAPTOR_AVAILABLE")
                    ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                    : "bg-slate-900/80 border-slate-800 text-slate-400"
                }`}
                title={liveStatus?.raptor?.details || liveStatus?.buster?.details || "حالة إضافة Free AI ReCaptcha Solver by Raptor"}
              >
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>
                  Raptor AI: {(liveStatus?.raptor?.status === "RAPTOR_AVAILABLE" || liveStatus?.buster?.status === "BUSTER_AVAILABLE" || liveStatus?.buster?.status === "RAPTOR_AVAILABLE") ? "نشط (v0.2.30)" : "جاهز للتفعيل"}
                </span>
              </div>

              {/* Browser Engine Badge */}
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold border border-slate-800 bg-slate-900/80 text-slate-300">
                <div
                  className={`h-2 w-2 rounded-full ${
                    liveStatus?.isBrowserReady ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                  }`}
                />
                <span>جلسة المتصفح: {liveStatus?.isBrowserReady ? "متصلة" : "في وضع الاستعداد"}</span>
              </div>

              {/* Auto Open Google Page Button */}
              <button
                onClick={handleOpenCloudTtsPage}
                disabled={isOpeningPage}
                className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold border border-emerald-500/40 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/70 transition shadow-sm active:scale-95 disabled:opacity-50"
                title="فتح صفحة Google Cloud Text-to-Speech تلقائياً وضبط التمركز على #demo"
              >
                <Globe className={`h-3.5 w-3.5 text-emerald-400 ${isOpeningPage ? "animate-spin" : ""}`} />
                <span>{isOpeningPage ? "جاري فتح الصفحة..." : "فتح صفحة Google تلقائياً"}</span>
              </button>

              {/* Interactive Live View Toggle */}
              <button
                onClick={() => setShowLiveView(!showLiveView)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold border transition ${
                  showLiveView
                    ? "bg-emerald-500 text-slate-950 border-emerald-400 font-extrabold"
                    : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span>{showLiveView ? "إخفاء شاشة Google" : "عرض شاشة Google"}</span>
              </button>

              {/* Page Reload / Refresh Button: Specifically reloads only the Google Cloud TTS page */}
              <button
                id="gemini-tts-reload-page-btn"
                onClick={handleReloadCloudPage}
                disabled={isReloadingCloudPage || isReloadingAndSolving || isOpeningPage}
                className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold border border-sky-500/40 bg-sky-950/50 text-sky-300 hover:bg-sky-900/70 hover:text-white transition shadow-sm active:scale-95 disabled:opacity-50"
                title="إعادة تحميل (Refresh) حقيقية وكاملة لصفحة Google Cloud بالكامل من جديد تماماً كالمتصفح"
              >
                <RotateCcw className={`h-3.5 w-3.5 text-sky-400 ${isReloadingCloudPage ? "animate-spin" : ""}`} />
                <span>{isReloadingCloudPage ? "جاري إعادة تحميل الصفحة بالكامل..." : "إعادة تحميل صفحة Google (Refresh كامل)"}</span>
              </button>

              {/* Combined Reload and Solve CAPTCHA Button */}
              <button
                id="gemini-tts-reload-and-solve-btn"
                onClick={handleReloadAndSolveCaptcha}
                disabled={isReloadingAndSolving || isReloadingCloudPage || isOpeningPage}
                className="flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold border border-emerald-500/40 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/80 hover:text-white transition shadow-sm active:scale-95 disabled:opacity-50"
                title="إعادة تحميل صفحة Google وحل تحدي الكابتشا بالذكاء الاصطناعي لتجاوز Try again later"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-emerald-400 ${isReloadingAndSolving ? "animate-spin" : ""}`} />
                <span>{isReloadingAndSolving ? "جاري إعادة التحميل والحل..." : "إعادة تحميل وحل CAPTCHA"}</span>
              </button>

              <button
                onClick={refreshStatus}
                disabled={isCheckingStatus}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 hover:text-white transition active:scale-95 disabled:opacity-50"
                title="تحديث الحالة"
              >
                <RefreshCw className={`h-4 w-4 ${isCheckingStatus ? "animate-spin text-emerald-400" : ""}`} />
              </button>
            </div>
          </div>
        </div>

        {/* CAPTCHA Alert Notification Banner */}
        {liveStatus?.captcha?.needsCaptcha && (
          <div
            className={`rounded-2xl border-2 p-4 sm:p-5 shadow-2xl backdrop-blur-md space-y-3 ${
              liveStatus?.captcha?.isDosBlocked
                ? "border-rose-500/60 bg-rose-950/40"
                : "border-amber-500/50 bg-amber-950/40"
            }`}
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                    liveStatus?.captcha?.isDosBlocked
                      ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
                      : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                  }`}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3
                    className={`text-sm sm:text-base font-bold ${
                      liveStatus?.captcha?.isDosBlocked ? "text-rose-200" : "text-amber-200"
                    }`}
                  >
                    {liveStatus?.captcha?.isDosBlocked
                      ? "تم تقييد التحدي الصوتي مؤقتاً من قِبل Google (Try again later)"
                      : "مطلوب حل اختبار Google reCAPTCHA"}
                  </h3>
                  <p
                    className={`text-xs ${
                      liveStatus?.captcha?.isDosBlocked ? "text-rose-300/90" : "text-amber-300/80"
                    } leading-relaxed`}
                  >
                    {liveStatus?.captcha?.isDosBlocked
                      ? "تظهر رسالة 'Try again later' من Google لحماية الخدمة من الاستعلامات التلقائية المتكررة. اضغط 'إعادة تعيين الكابتشا' لتحديث التحدي، أو اضغط 'توليد فوري' لتخطي الكابتشا تماماً والحصول على الصوت فوراً!"
                      : "تم رصد اختبار التحقق في جلسة Google Cloud. يمكنك النقر على زر 'حل الكابتشا عبر Raptor AI' أو 'إعادة تعيين الكابتشا' أو التوليد الفوري."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  onClick={handleReloadAndSolveCaptcha}
                  disabled={isReloadingAndSolving || isReloadingCloudPage || liveViewLoading}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 px-3.5 py-2 text-xs font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition active:scale-95 disabled:opacity-50"
                  title="إعادة تحميل صفحة Google وحل تحدي الكابتشا بالذكاء الاصطناعي مباشرة (تجاوز Try again later)"
                >
                  <RefreshCw className={`h-4 w-4 ${isReloadingAndSolving ? "animate-spin" : ""}`} />
                  <span>{isReloadingAndSolving ? "جاري التحميل والحل..." : "إعادة تحميل الصفحة وحل الكابتشا"}</span>
                </button>

                <button
                  onClick={handleResetCaptcha}
                  disabled={isResettingCaptcha || isReloadingAndSolving || liveViewLoading}
                  className="flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 px-3.5 py-2 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/20 transition active:scale-95 disabled:opacity-50"
                  title="إعادة تعيين التحدي لتجاوز رسالة Try again later والحصول على تحدي جديد"
                >
                  <RotateCcw className={`h-4 w-4 ${isResettingCaptcha ? "animate-spin" : ""}`} />
                  <span>{isResettingCaptcha ? "جاري التعيين..." : "إعادة تعيين الكابتشا"}</span>
                </button>

                <button
                  onClick={handleRaptorAutoSolve}
                  disabled={isSolvingRaptor || isReloadingAndSolving || liveViewLoading}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3.5 py-2 text-xs font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition active:scale-95 disabled:opacity-50"
                  title="استدعاء إضافة Free AI ReCaptcha Solver by Raptor لحل reCAPTCHA تلقائياً بالذكاء الاصطناعي"
                >
                  <Bot className={`h-4 w-4 ${isSolvingRaptor ? "animate-spin" : ""}`} />
                  <span>{isSolvingRaptor ? "جاري الحل..." : "حل عبر Raptor AI"}</span>
                </button>

                <button
                  onClick={() => handleSynthesizeSingle(false, true)}
                  disabled={isSynthesizing || !singleText.trim()}
                  className="flex items-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 px-3.5 py-2 text-xs font-black text-slate-950 shadow-lg shadow-cyan-500/20 transition active:scale-95 disabled:opacity-50"
                  title="توليد الصوت فورياً بدون انتظار الكابتشا أو مواجهة قيود Google"
                >
                  <Zap className="h-4 w-4 fill-current" />
                  <span>توليد فوري (بدون كابتشا)</span>
                </button>

                <button
                  onClick={() => setShowLiveView(true)}
                  className="flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 transition shrink-0"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span>عرض الشاشة</span>
                </button>
              </div>
            </div>

            {raptorFeedback && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/70 px-3 py-2 text-xs font-semibold text-emerald-300 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>{raptorFeedback}</span>
              </div>
            )}
          </div>
        )}

        {/* Interactive Google Page Stream Viewer */}
        {showLiveView && (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/95 p-4 sm:p-5 shadow-2xl space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>شاشة Google Cloud TTS التفاعلية المباشرة</span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                      #demo
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    يمكنك النقر أو اللمس مباشرة لحل مربع التحقق أو زر Raptor AI
                  </p>
                </div>
              </div>

              {/* Controls & Quick Links */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleReloadAndSolveCaptcha}
                  disabled={isReloadingAndSolving || isReloadingCloudPage || liveViewLoading}
                  className="flex items-center gap-1.5 rounded-xl border border-teal-500 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 px-3 py-1.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition active:scale-95 disabled:opacity-50"
                  title="إعادة تحميل صفحة Google وحل تحدي الكابتشا بالذكاء الاصطناعي مباشرة (تجاوز Try again later)"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isReloadingAndSolving ? "animate-spin" : ""}`} />
                  <span>{isReloadingAndSolving ? "جاري التحميل والحل..." : "إعادة تحميل الصفحة وحل الكابتشا"}</span>
                </button>

                <button
                  onClick={handleResetCaptcha}
                  disabled={isResettingCaptcha || isReloadingAndSolving || liveViewLoading}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-500 bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/20 transition active:scale-95 disabled:opacity-50"
                  title="إعادة تعيين الكابتشا وتجاوز حظر Try again later"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isResettingCaptcha ? "animate-spin" : ""}`} />
                  <span>{isResettingCaptcha ? "جاري التعيين..." : "إعادة تعيين الكابتشا"}</span>
                </button>

                <button
                  onClick={handleRaptorAutoSolve}
                  disabled={isSolvingRaptor || isReloadingAndSolving || liveViewLoading}
                  className="flex items-center gap-1.5 rounded-xl border border-emerald-500 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 text-xs font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition active:scale-95 disabled:opacity-50"
                  title="استدعاء إضافة Free AI ReCaptcha Solver by Raptor لحل reCAPTCHA تلقائياً بالذكاء الاصطناعي"
                >
                  <Bot className={`h-3.5 w-3.5 ${isSolvingRaptor ? "animate-spin" : ""}`} />
                  <span>{isSolvingRaptor ? "جاري الحل..." : "حل عبر Raptor AI"}</span>
                </button>

                <button
                  onClick={() => handleBrowserScroll("demo")}
                  disabled={liveViewLoading}
                  className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-900/80 transition active:scale-95 disabled:opacity-50"
                  title="النزول التلقائي المباشر إلى قسم #demo في الأسفل"
                >
                  <Target className="h-3.5 w-3.5 text-emerald-400" />
                  <span>النزول لمنطقة العرض (#demo)</span>
                </button>

                <button
                  onClick={() => handleBrowserScroll("down", 250)}
                  disabled={liveViewLoading}
                  className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs font-bold text-slate-300 hover:text-white transition active:scale-95 disabled:opacity-50"
                  title="تمرير المتصفح لأسفل بمقدار 250 بكسل"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  <span>تمرير لأسفل</span>
                </button>

                <button
                  onClick={() => handleBrowserScroll("up", 250)}
                  disabled={liveViewLoading}
                  className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs font-bold text-slate-300 hover:text-white transition active:scale-95 disabled:opacity-50"
                  title="تمرير المتصفح لأعلى بمقدار 250 بكسل"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  <span>تمرير لأعلى</span>
                </button>

                <button
                  onClick={fetchLiveView}
                  disabled={liveViewLoading}
                  className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-300 hover:text-white transition active:scale-95 disabled:opacity-50"
                  title="تحديث صورة الشاشة"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${liveViewLoading ? "animate-spin text-emerald-400" : ""}`} />
                  <span>{liveViewLoading ? "تحديث..." : "تحديث"}</span>
                </button>

                <a
                  href="https://cloud.google.com/text-to-speech?utm_source=chatgpt.com#demo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-300 hover:text-white transition"
                  title="فتح الرابط الرسمي في علامة تبويب جديدة"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                  <span>فتح في تبويب</span>
                </a>
              </div>
            </div>

            {/* Active URL bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <Globe className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="font-mono text-slate-400 truncate dir-ltr select-all">
                  https://cloud.google.com/text-to-speech?utm_source=chatgpt.com#demo
                </span>
                <span className="shrink-0 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                  يتم الفتح تلقائياً
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleOpenCloudTtsPage}
                  disabled={isOpeningPage}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/60 hover:bg-emerald-900/80 px-2.5 py-1 text-[11px] font-bold text-emerald-300 transition active:scale-95 disabled:opacity-50"
                  title="إعادة فتح وتوجيه الصفحة تلقائياً إلى قسم #demo"
                >
                  <RefreshCw className={`h-3 w-3 ${isOpeningPage ? "animate-spin text-emerald-400" : ""}`} />
                  <span>{isOpeningPage ? "جاري الفتح والتوجيه..." : "إعادة فتح وتوجيه الصفحة"}</span>
                </button>

                <a
                  href="https://cloud.google.com/text-to-speech?utm_source=chatgpt.com#demo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-bold text-slate-200 transition"
                  title="فتح في علامة تبويب متصفح جديدة"
                >
                  <ExternalLink className="h-3 w-3 text-slate-400" />
                  <span>فتح في تبويب خارجي</span>
                </a>
              </div>
            </div>

            {pageOpenFeedback && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-950/50 border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>{pageOpenFeedback}</span>
              </div>
            )}

            {/* Mobile Helpful Tip Banner */}
            <div className="flex items-center gap-2 rounded-xl bg-slate-950/80 border border-slate-800/80 px-3 py-2 text-[11px] text-slate-400">
              <Smartphone className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                <strong>لمستخدمي الهاتف:</strong> الشاشة مضبوطة تلقائياً في منطقة العرض التوضيحي (#demo). اضغط على زر <strong>"النزول لمنطقة العرض (#demo)"</strong> في أي وقت لإعادة ضبط التمركز بدقة إذا تحركت الصفحة.
              </span>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-black flex justify-center items-center min-h-[350px]">
              {liveViewImage ? (
                <img
                  src={liveViewImage}
                  alt="Google Cloud Text-to-Speech Live Context"
                  onPointerDown={handleLiveViewPointer}
                  className="w-full max-h-[550px] object-contain cursor-crosshair select-none touch-none"
                  title="المس أو انقر هنا للتفاعل المباشر مع صفحة Google وحل التحقق"
                />
              ) : (
                <div className="flex flex-col items-center gap-4 p-8 text-center text-slate-300 max-w-md">
                  <RefreshCw className="h-10 w-10 animate-spin text-emerald-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-white">جاري تهيئة متصفح Chromium وجلب الشاشة التفاعلية المضبوطة على #demo...</p>
                    <p className="text-xs text-slate-400">
                      إذا استمرت هذه الرسالة لعدة ثوانٍ أثناء بدء المتصفح في الخلفية، يمكنك استخدام الأزرار أدناه لتحديث الشاشة أو إعادة توجيه الصفحة مباشرة:
                    </p>
                  </div>

                  {liveViewError && (
                    <div className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/60 rounded-xl px-3 py-1.5 w-full">
                      {liveViewError}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                    <button
                      onClick={fetchLiveView}
                      disabled={liveViewLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition active:scale-95 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${liveViewLoading ? "animate-spin" : ""}`} />
                      <span>تحديث الشاشة الآن</span>
                    </button>
                    <button
                      onClick={handleOpenCloudTtsPage}
                      disabled={isOpeningPage}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition active:scale-95 disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-emerald-400" />
                      <span>إعادة توجيه لـ #demo</span>
                    </button>
                    <button
                      onClick={handleResetSession}
                      disabled={isOpeningPage}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/50 transition active:scale-95 disabled:opacity-50"
                    >
                      <span>إعادة تشغيل المتصفح</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Grid: Settings & Voice Picker vs Generation Studio */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column (5 cols): Voice Selection & Presets */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Voice Direction Prompt Card */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl space-y-3 backdrop-blur-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">توجيه الصوت (Voice Direction Prompt)</h3>
                </div>
                <span className="font-mono text-[11px] text-slate-500">{voiceDirection.length}/4000</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                تعليمات حرة لنبرة الصوت وأسلوب الإلقاء (المشاعر، السرعة، النبرة، أسلوب الراوي أو الشخصية، الهدوء، الغضب أو التوتر).
              </p>
              <textarea
                rows={3}
                value={voiceDirection}
                onChange={(e) => setVoiceDirection(e.target.value)}
                placeholder="اكتب توجيه النبرة والأداء الصوتي هنا..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {/* Official Voices Directory */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl space-y-4 backdrop-blur-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">الأصوات الرسمية لـ Gemini</h3>
                </div>
                <span className="text-[11px] font-mono text-emerald-400">{GEMINI_VOICES.length} صوت معتمد</span>
              </div>

              {/* Filters & Search */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="ابحث عن اسم أو صفة صوت..."
                  value={voiceSearch}
                  onChange={(e) => setVoiceSearch(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
                  {(["All", "Male", "Female"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setVoiceFilter(g)}
                      className={`rounded-lg px-2 py-1 transition ${
                        voiceFilter === g
                          ? "bg-emerald-500/20 text-emerald-400 font-bold"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {g === "All" ? "الكل" : g === "Male" ? "ذكور" : "إناث"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Voices List */}
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {filteredVoices.map((v) => {
                  const isSelected = selectedVoice === v.name;
                  return (
                    <div
                      key={v.name}
                      onClick={() => setSelectedVoice(v.name)}
                      className={`rounded-2xl border p-3 cursor-pointer transition ${
                        isSelected
                          ? "border-emerald-500/50 bg-emerald-950/30 shadow-md"
                          : "border-slate-800/80 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{v.name}</span>
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                              v.gender === "Male"
                                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                : "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                            }`}
                          >
                            {v.gender === "Male" ? "ذكر" : "أنثى"}
                          </span>
                        </div>
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{v.description}</p>

                      <div className="flex flex-wrap gap-1 mt-2">
                        {v.traits.map((t) => (
                          <span
                            key={t}
                            className="rounded-md bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column (7 cols): Studio Input & Playback */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Mode Switcher Tabs */}
            <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-1.5">
              <button
                onClick={() => setMode("single")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition cursor-pointer ${
                  mode === "single"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <MessageSquare className="h-4 w-4" />
                <span>نص فردي (Single Text)</span>
              </button>

              <button
                onClick={() => setMode("dialogue")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition cursor-pointer ${
                  mode === "dialogue"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Users className="h-4 w-4" />
                <span>حوار متعدد الأصوات (Multi-Speaker)</span>
              </button>

              <button
                onClick={() => setMode("batch")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition cursor-pointer ${
                  mode === "batch"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Layers className="h-4 w-4" />
                <span>توليد متعدد (Batch Queue)</span>
              </button>
            </div>

            {/* Language & Voice Selector Quick Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-400 mb-1 block">اللغة المستهدفة:</label>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  {GEMINI_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.nativeName} ({l.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 mb-1 block">الصوت المحدد حالياً:</label>
                <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs">
                  <span className="font-bold text-emerald-400">{selectedVoiceObj.name}</span>
                  <span className="text-[11px] text-slate-400">
                    {selectedVoiceObj.gender === "Male" ? "ذكر" : "أنثى"} • {selectedVoiceObj.traits[0]}
                  </span>
                </div>
              </div>
            </div>

            {/* Mode 1: Single Text Studio */}
            {mode === "single" && (
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl space-y-4 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4 text-emerald-400" />
                    <span>النص المراد تحويله إلى كلام:</span>
                  </label>
                  <span className="font-mono text-[11px] text-slate-500">{singleText.length} حرف</span>
                </div>

                <textarea
                  rows={5}
                  value={singleText}
                  onChange={(e) => setSingleText(e.target.value)}
                  placeholder="أدخل النص العربي هنا لنطقه بصوت Gemini..."
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm leading-relaxed text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    <span>إعدادات الصوت المتقدمة</span>
                    {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleSynthesizeSingle(false, true)}
                      disabled={isSynthesizing || !singleText.trim()}
                      className="flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/60 px-4 py-3 text-xs font-bold text-cyan-300 shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer"
                      title="توليد فوري ومباشر للصوت بدون الحاجة لحل الكابتشا أو مواجهة قيود Google"
                    >
                      <Zap className="h-4 w-4 text-cyan-400 fill-current" />
                      <span>توليد فوري (تخطي الكابتشا)</span>
                    </button>

                    <button
                      onClick={() => handleSynthesizeSingle(false)}
                      disabled={isSynthesizing || !singleText.trim()}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition disabled:opacity-50 disabled:scale-100 cursor-pointer"
                    >
                      {isSynthesizing ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin text-slate-950" />
                          <span>جاري التوليد عبر Gemini TTS...</span>
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 fill-current ml-1" />
                          <span>توليد ونطق الآن</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Mode 2: Multi-Speaker Dialogue Studio */}
            {mode === "dialogue" && (
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl space-y-4 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-emerald-400" />
                    <span>حوار متعدد الشخصيات (Multi-Speaker Gemini Markup)</span>
                  </h3>
                  <button
                    onClick={() =>
                      setDialogueTurns([...dialogueTurns, { speaker: "البطل", text: "نص حواري جديد..." }])
                    }
                    className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition"
                  >
                    <ListPlus className="h-3.5 w-3.5" />
                    <span>إضافة سطر</span>
                  </button>
                </div>

                {/* Speakers Allocation */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-2xl border border-slate-800 bg-slate-950">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">صوت المتحدث الأول (الراوي):</label>
                    <select
                      value={speaker1Voice}
                      onChange={(e) => setSpeaker1Voice(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-white"
                    >
                      {GEMINI_VOICES.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name} ({v.gender === "Male" ? "ذكر" : "أنثى"})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">صوت المتحدث الثاني (البطل):</label>
                    <select
                      value={speaker2Voice}
                      onChange={(e) => setSpeaker2Voice(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-white"
                    >
                      {GEMINI_VOICES.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name} ({v.gender === "Male" ? "ذكر" : "أنثى"})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Turns List */}
                <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                  {dialogueTurns.map((turn, idx) => (
                    <div key={idx} className="flex items-start gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                      <select
                        value={turn.speaker}
                        onChange={(e) => {
                          const copy = [...dialogueTurns];
                          copy[idx].speaker = e.target.value;
                          setDialogueTurns(copy);
                        }}
                        className="rounded-xl border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-emerald-400 font-bold shrink-0"
                      >
                        <option value="الراوي">الراوي</option>
                        <option value="البطل">البطل</option>
                      </select>
                      <input
                        type="text"
                        value={turn.text}
                        onChange={(e) => {
                          const copy = [...dialogueTurns];
                          copy[idx].text = e.target.value;
                          setDialogueTurns(copy);
                        }}
                        className="flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSynthesizeDialogue}
                    disabled={isSynthesizing}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 px-6 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition disabled:opacity-50"
                  >
                    {isSynthesizing ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>جاري توليد الحوار...</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 fill-current ml-1" />
                        <span>توليد الحوار الكامل</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Mode 3: Batch Queue Studio */}
            {mode === "batch" && (
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl space-y-4 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-emerald-400" />
                    <span>قائمة التوليد المتتابع (Batch Generation Queue)</span>
                  </h3>
                  <div className="text-xs font-mono text-emerald-400 font-bold">
                    التقدم: {queueProgress.completed} / {queueProgress.total} ({queueProgress.percent}%)
                  </div>
                </div>

                <textarea
                  rows={4}
                  value={batchRawText}
                  onChange={(e) => setBatchRawText(e.target.value)}
                  placeholder="أدخل كل جملة أو فقرة في سطر مستقل..."
                  className="w-full rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />

                {/* Progress Bar */}
                {queueProgress.total > 0 && (
                  <div className="space-y-1.5">
                    <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                        style={{ width: `${queueProgress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Batch Items Status List */}
                {batchItems.length > 0 && (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {batchItems.map((item, idx) => {
                      const isReady = item.status === "completed" || item.status === "ready";
                      const isRetrying = item.status === "retrying";
                      const isFailed = item.status === "failed";
                      const isGenerating = item.status === "generating" || item.status === "processing";

                      return (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 text-xs transition ${
                            isReady
                              ? "border-emerald-500/30 bg-emerald-950/20"
                              : isFailed
                              ? "border-rose-500/30 bg-rose-950/20"
                              : isRetrying
                              ? "border-amber-500/30 bg-amber-950/20"
                              : "border-slate-800 bg-slate-950"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                            <span className="font-mono text-slate-500 font-bold shrink-0">{idx + 1}.</span>
                            <span className="truncate text-slate-300">{item.text}</span>
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/20">
                              🔒 {item.voiceName}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Progressive Audio Player for Ready Segments */}
                            {isReady && item.audioUrl && (
                              <button
                                onClick={() => {
                                  const aud = new Audio(item.audioUrl);
                                  aud.play();
                                }}
                                className="flex items-center gap-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 px-2 py-1 text-[10px] font-bold transition active:scale-95"
                                title="تشغيل هذا المقطع فوراً (Progressive Ready)"
                              >
                                <Volume2 className="h-3.5 w-3.5" />
                                <span>تشغيل</span>
                              </button>
                            )}

                            {/* Retry button for failed segment */}
                            {isFailed && (
                              <button
                                onClick={() => handleRetryBatchItem(item.id)}
                                className="flex items-center gap-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 px-2 py-1 text-[10px] font-bold transition active:scale-95"
                                title="إعادة محاولة هذا المقطع بنفس الصوت المقفول حصراً"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>إعادة المحاولة</span>
                              </button>
                            )}

                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                                isReady
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : isGenerating
                                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse"
                                  : isRetrying
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse"
                                  : isFailed
                                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                  : item.status === "paused_captcha"
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {isReady
                                ? "جاهز (Ready)"
                                : isGenerating
                                ? "جاري التوليد..."
                                : isRetrying
                                ? `إعادة محاولة (${item.retryCount}/${item.maxRetries})...`
                                : isFailed
                                ? "فشل"
                                : item.status === "paused_captcha"
                                ? "موقوف (CAPTCHA)"
                                : "في الانتظار"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Queue Action Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    onClick={prepareBatchQueue}
                    className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900 transition"
                  >
                    تجهيز العناصر
                  </button>

                  <div className="flex items-center gap-2">
                    {isCaptchaPaused ? (
                      <button
                        onClick={resumeBatchQueue}
                        className="flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-md hover:bg-amber-300 transition"
                      >
                        <Play className="h-4 w-4 fill-current ml-1" />
                        <span>استئناف بعد حل CAPTCHA</span>
                      </button>
                    ) : isQueueRunning ? (
                      <button
                        onClick={pauseBatchQueue}
                        className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-700 transition"
                      >
                        إيقاف مؤقت
                      </button>
                    ) : (
                      <button
                        onClick={startBatchQueue}
                        className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-md hover:scale-105 transition"
                      >
                        <Play className="h-4 w-4 fill-current ml-1" />
                        <span>بدء التوليد المتتابع</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Advanced Audio Settings Accordion */}
            {showAdvanced && (
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl space-y-4 backdrop-blur-md">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Settings2 className="h-4 w-4 text-emerald-400" />
                  <span>معايير التشفير الصوتي الدقيقة (Audio Configuration)</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  {/* Audio Encoding */}
                  <div>
                    <label className="text-slate-400 block mb-1">صيغة التشفير (Encoding):</label>
                    <select
                      value={audioEncoding}
                      onChange={(e) => setAudioEncoding(e.target.value as AudioEncoding)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-white"
                    >
                      <option value="MP3">MP3 (Universal 24kHz/32kHz)</option>
                      <option value="OGG_OPUS">OGG_OPUS (Low-latency Web)</option>
                      <option value="LINEAR16">LINEAR16 / WAV (Uncompressed PCM)</option>
                    </select>
                  </div>

                  {/* Speaking Rate */}
                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>سرعة النطق (Speaking Rate):</span>
                      <span className="font-mono text-emerald-400 font-bold">{speakingRate}x</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.05}
                      value={speakingRate}
                      onChange={(e) => setSpeakingRate(parseFloat(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>

                  {/* Pitch */}
                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>طبقة الصوت (Pitch):</span>
                      <span className="font-mono text-emerald-400 font-bold">{pitch}</span>
                    </div>
                    <input
                      type="range"
                      min={-10.0}
                      max={10.0}
                      step={0.5}
                      value={pitch}
                      onChange={(e) => setPitch(parseFloat(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>

                  {/* Volume Gain */}
                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>تضخيم الصوت (Volume Gain dB):</span>
                      <span className="font-mono text-emerald-400 font-bold">{volumeGainDb} dB</span>
                    </div>
                    <input
                      type="range"
                      min={-12.0}
                      max={12.0}
                      step={1}
                      value={volumeGainDb}
                      onChange={(e) => setVolumeGainDb(parseFloat(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Error Message Box */}
            {errorMessage && (
              <div className="rounded-2xl border border-red-500/30 bg-red-950/40 p-4 text-xs text-red-200 space-y-1">
                <div className="flex items-center gap-2 font-bold text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span>خطأ في التوليد</span>
                </div>
                <p>{errorMessage}</p>
              </div>
            )}

            {/* Active Output Player */}
            {currentAudio && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>الصوت المولد الأخير:</span>
                  {currentAudio.cached && (
                    <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                      ⚡ مسترجع من الذاكرة المؤقتة (Cache)
                    </span>
                  )}
                </div>
                <GeminiTTSPlayer
                  audioBase64={currentAudio.audioBase64}
                  mimeType={currentAudio.mimeType}
                  voiceName={currentAudio.voiceName}
                  title={`Gemini TTS (${currentAudio.voiceName})`}
                  onRegenerate={() => handleSynthesizeSingle(true)}
                  isRegenerating={isSynthesizing}
                />
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
