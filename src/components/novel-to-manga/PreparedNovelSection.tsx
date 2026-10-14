import React, { useState, useEffect, useMemo } from "react";
import {
  Zap,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  FileCheck,
  Save,
  Trash2,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Layers,
  Database,
  Hash,
  Copy,
  Check,
  ArrowRight,
  ArrowLeft,
  Info,
  HardDrive,
  Ban,
  ShieldCheck,
} from "lucide-react";
import {
  parseAndValidatePreparedNovel,
  adoptPreparedNovelDataset,
  isDatasetAdopted,
  EVENT_ORDERING_PROMPT,
  SAMPLE_ORDERED_EVENTS_PAYLOAD,
  type ActivePreparedNovelData,
  type PreparedNovelData,
  type PreparedNovelStatus,
  type PreparedNovelValidationResult,
} from "../../utils/preparedNovelParser";

interface PreparedNovelSectionProps {
  currentNovelTitle: string;
  currentNovelText: string;
  preparedData: PreparedNovelData | null;
  onSavePreparedData: (data: PreparedNovelData) => void;
  onClearPreparedData: () => void;
  onApplyDirectlyToStudio: (data: PreparedNovelData) => void;
}

export default function PreparedNovelSection({
  currentNovelTitle,
  currentNovelText,
  preparedData,
  onSavePreparedData,
  onClearPreparedData,
  onApplyDirectlyToStudio,
}: PreparedNovelSectionProps) {
  // Local text input state
  const [inputText, setInputText] = useState<string>("");
  const [validationResult, setValidationResult] =
    useState<PreparedNovelValidationResult | null>(null);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState<boolean>(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [showPromptDetails, setShowPromptDetails] = useState<boolean>(false);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);

  // Sync initial input text with saved prepared data if present
  useEffect(() => {
    if (preparedData?.raw_input) {
      setInputText(preparedData.raw_input);
      const res = parseAndValidatePreparedNovel(
        preparedData.raw_input,
        currentNovelTitle,
        currentNovelText
      );
      setValidationResult(res);
    }
  }, [preparedData?.prepared_novel_id]);

  // Compute Current Status with strict DRAFT -> VALID -> ADOPTED distinction:
  // ⚪ لا توجد بيانات مجهزة (EMPTY)
  // 🟡 مسودة جديدة غير معتمدة بعد (DRAFT)
  // 🔵 تم التحقق وجاهز للاعتماد (VALID)
  // 🟢 معتمد ونشط - المصدر الأساسي للاستوديو (ADOPTED / SAVED)
  // 🔴 بيانات التجهيز غير صالحة (INVALID)
  const currentStatus: PreparedNovelStatus = useMemo(() => {
    const trimmed = inputText.trim();
    if (!trimmed && !preparedData) {
      return "EMPTY";
    }

    if (validationResult && !validationResult.isValid) {
      return "INVALID";
    }

    const isAdopted = isDatasetAdopted(preparedData);
    const hasUnsavedChanges =
      Boolean(preparedData) && trimmed !== preparedData?.raw_input?.trim();

    // If text was modified or new text exists without being adopted yet:
    if (hasUnsavedChanges || (!preparedData && trimmed.length > 0)) {
      if (validationResult?.isValid) {
        return "VALID";
      }
      return "DRAFT";
    }

    if (isAdopted) {
      return "ADOPTED";
    }

    if (preparedData && validationResult?.isValid) {
      return "SAVED";
    }

    return "EMPTY";
  }, [inputText, preparedData, validationResult]);

  // Handle Input Change
  const handleInputChange = (val: string) => {
    setInputText(val);
    setNoticeMessage(null);
    if (!val.trim()) {
      setValidationResult(null);
      return;
    }
    // Auto-parse silently on edit for real-time validation feedback
    const res = parseAndValidatePreparedNovel(
      val,
      currentNovelTitle,
      currentNovelText
    );
    setValidationResult(res);
  };

  // Button: التحقق من البيانات (Validate Data)
  const handleValidate = () => {
    if (!inputText.trim()) {
      setValidationResult({
        isValid: false,
        errors: ["حقل التحليل فارغ، يرجى لصق بيانات التحليل أولاً."],
        warnings: [],
        stats: {
          scenes_count: 0,
          characters_count: 0,
          locations_count: 0,
          events_count: 0,
          weapons_count: 0,
          items_count: 0,
          creatures_count: 0,
        },
      });
      return;
    }
    const res = parseAndValidatePreparedNovel(
      inputText,
      currentNovelTitle,
      currentNovelText
    );
    setValidationResult(res);
    if (res.isValid) {
      setNoticeMessage("✓ البيانات صالحة تمامًا ومكتملة للتحويل المباشر!");
    } else {
      setNoticeMessage("⚠️ البيانات تحتوي على أخطاء، يرجى التحقق منها أدناه.");
    }
  };

  // Button: استيراد البيانات (Import Data) -> يعتمد ويحفظ البيانات مباشرة كمصدر نشط للاستوديو
  const handleImport = () => {
    const res = parseAndValidatePreparedNovel(
      inputText,
      currentNovelTitle,
      currentNovelText
    );
    setValidationResult(res);
    if (!res.isValid || !res.parsedData) {
      setNoticeMessage("فشل استيراد البيانات: " + res.errors.join(" · "));
      return;
    }
    // اعتماد حقيقي DRAFT -> VALIDATED -> ADOPTED ونقل فوري إلى الاستوديو
    const adopted = adoptPreparedNovelDataset(res.parsedData);
    onSavePreparedData(adopted);
    setNoticeMessage(`🟢 تم اعتماد وتطبيق بيانات «${adopted.novel_title || "الرواية"}» كمصدر نشط بنجاح! تم استبدال كافة البيانات القديمة في جميع الأقسام التالية.`);
  };

  // Button: حفظ واعتماد التجهيز (Save & Adopt Prepared Data)
  const handleSave = () => {
    const res = parseAndValidatePreparedNovel(
      inputText,
      currentNovelTitle,
      currentNovelText
    );
    setValidationResult(res);
    if (!res.isValid || !res.parsedData) {
      setNoticeMessage("لا يمكن الحفظ والاعتماد: " + res.errors.join(" · "));
      return;
    }

    // اعتماد حقيقي DRAFT -> VALIDATED -> ADOPTED ونقل فوري إلى الاستوديو
    const adopted = adoptPreparedNovelDataset(res.parsedData);
    onSavePreparedData(adopted);
    setNoticeMessage(`🟢 تم اعتماد وتطبيق بيانات «${adopted.novel_title || "الرواية"}» كمصدر نشط بنجاح! جميع الأقسام التالية تستخدم هذه البيانات مباشرة بدون Gemini.`);
  };

  // Button: استبدال التجهيز (Replace Prepared Data)
  const handleReplace = () => {
    setConfirmReplaceOpen(false);
    handleSave();
  };

  // Button: مسح التجهيز (Clear Prepared Data)
  const handleClear = () => {
    setConfirmClearOpen(false);
    setInputText("");
    setValidationResult(null);
    onClearPreparedData();
    setNoticeMessage("تم مسح بيانات التجهيز والعودة إلى المسار الافتراضي.");
  };

  // Copy ID
  const handleCopyId = (id: string) => {
    navigator.clipboard?.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // 📋 نسخ برومبت ترتيب الأحداث للذكاء الاصطناعي
  const handleCopyPrompt = () => {
    try {
      navigator.clipboard?.writeText(EVENT_ORDERING_PROMPT);
      setCopiedPrompt(true);
      setNoticeMessage("✓ تم نسخ برومبت ترتيب الأحداث بنجاح! يمكنك الآن إرساله مع نص روايتك إلى أي AI خارجي.");
      setTimeout(() => setCopiedPrompt(false), 3000);
    } catch (_) {
      setNoticeMessage("تعذر النسخ التلقائي، يمكنك نسخ البرومبت يدويًا من المعاينة أدناه.");
    }
  };

  // ⚡ تحميل نموذج تجريبي لترتيب الأحداث فقط
  const handleLoadSampleOrderedEvents = () => {
    setInputText(SAMPLE_ORDERED_EVENTS_PAYLOAD);
    const res = parseAndValidatePreparedNovel(
      SAMPLE_ORDERED_EVENTS_PAYLOAD,
      currentNovelTitle,
      currentNovelText
    );
    setValidationResult(res);
    setNoticeMessage("✓ تم تحميل نموذج تجريبي لترتيب الأحداث (JSON منظم)! اضغط «حفظ التجهيز» أو «استيراد البيانات» لاعتماده مباشرة.");
  };

  // Check Novel Mismatch Warning
  const showMismatchWarning =
    validationResult?.mismatchWarning ||
    (preparedData &&
      currentNovelTitle &&
      currentNovelTitle.trim().length > 3 &&
      preparedData.novel_title &&
      !preparedData.novel_title.toLowerCase().includes(currentNovelTitle.toLowerCase().trim()) &&
      !currentNovelTitle.toLowerCase().includes(preparedData.novel_title.toLowerCase().trim())
      ? `⚠️ بيانات التجهيز الحالية مرتبطة برواية مختلفة («${preparedData.novel_title}» مقابل «${currentNovelTitle}»). هل تريد استبدالها؟`
      : null);

  const displayStats =
    validationResult?.stats ||
    preparedData?.stats || {
      scenes_count: 0,
      characters_count: 0,
      locations_count: 0,
      events_count: 0,
      weapons_count: 0,
      items_count: 0,
      creatures_count: 0,
    };

  return (
    <div className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-b from-slate-900/90 to-slate-950/95 p-5 sm:p-6 shadow-2xl flex flex-col gap-5 text-right transition-all">
      {/* 1. Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 shrink-0">
            <Zap className="h-5 w-5 fill-current" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-wide">
                ⚡ تجهيز الرواية مسبقًا
              </h3>
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30 font-mono">
                Prepared Novel Data
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 leading-relaxed">
              ألصق هنا تحليل الرواية الذي تم إنشاؤه مسبقًا بواسطة أي ذكاء اصطناعي. سيتم استخدام البيانات مباشرة دون إعادة تحليلها.
            </p>
          </div>
        </div>

        {/* Status Indicator (DRAFT -> VALID -> ADOPTED) */}
        <div className="shrink-0 flex items-center gap-2">
          {currentStatus === "EMPTY" && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-300 text-xs font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
              <span>⚪ لا توجد بيانات مجهزة</span>
            </div>
          )}
          {currentStatus === "DRAFT" && (
            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-950/80 border border-amber-500 text-amber-300 text-xs font-bold shadow-md shadow-amber-950/50">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
              <span>🟡 مسودة تجهيز (Draft) — لم يتم الاعتماد بعد</span>
            </div>
          )}
          {currentStatus === "VALID" && (
            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-950/80 border border-sky-400 text-sky-300 text-xs font-bold shadow-md shadow-sky-950/50">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse"></span>
              <span>🔵 تم التحقق (VALID) — جاهز للاعتماد النشط</span>
            </div>
          )}
          {(currentStatus === "ADOPTED" || currentStatus === "SAVED") && (
            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-950/90 border border-emerald-500 text-emerald-300 text-xs font-bold shadow-md shadow-emerald-950/50">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>🟢 معتمد ونشط (ADOPTED) — المصدر الوحيد النشط</span>
            </div>
          )}
          {currentStatus === "INVALID" && (
            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-950/80 border border-rose-500 text-rose-300 text-xs font-bold shadow-md shadow-rose-950/50">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
              <span>🔴 بيانات التجهيز غير صالحة</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. 📋 برومبت وترتيب الأحداث للذكاء الاصطناعي (Event Ordering Prompt & Guide) */}
      <div className="rounded-2xl border border-sky-500/30 bg-slate-950/80 p-5 sm:p-6 flex flex-col gap-4 shadow-xl">
        {/* Header & Steps */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-xl bg-sky-500/20 text-sky-400 font-bold shrink-0">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="flex flex-col">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-base sm:text-lg font-bold text-white">
                    📋 برومبت ترتيب الأحداث للذكاء الاصطناعي (Event Ordering Prompt)
                  </h4>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-sky-950 text-sky-300 border border-sky-500/30 font-mono">
                    ترتيب الأحداث فقط
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 mt-1 leading-relaxed">
                  استخدم هذا البرومبت مع أي ذكاء اصطناعي خارجي مثل <strong>ChatGPT / Claude / DeepSeek</strong> لتحليل نص الرواية واستخراج ترتيب الأحداث فقط.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button
                type="button"
                onClick={handleCopyPrompt}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-md ${
                  copiedPrompt
                    ? "bg-emerald-600 text-white"
                    : "bg-sky-600 hover:bg-sky-500 text-white"
                }`}
              >
                {copiedPrompt ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>✓ تم نسخ البرومبت!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>نسخ البرومبت أدناه</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowPromptDetails(!showPromptDetails)}
                className="flex items-center gap-1 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition cursor-pointer"
              >
                {showPromptDetails ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    <span>إخفاء نص البرومبت</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" />
                    <span>عرض نص البرومبت</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleLoadSampleOrderedEvents}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-400 text-xs font-semibold border border-emerald-500/30 transition cursor-pointer"
                title="تحميل نموذج تجريبي لترتيب الأحداث في حقل التحليل"
              >
                <Zap className="h-4 w-4" />
                <span>تجربة نموذج أحداث جاهز</span>
              </button>
            </div>
          </div>

          {/* الخطوات الخمسة المرقمة */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-xs text-slate-300 pt-1">
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/80 flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 border border-sky-500/30">
                1
              </span>
              <span className="leading-snug">انسخ البرومبت أدناه.</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/80 flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 border border-sky-500/30">
                2
              </span>
              <span className="leading-snug">أضف نص الرواية المطلوب تحليله.</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/80 flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 border border-sky-500/30">
                3
              </span>
              <span className="leading-snug">أرسله إلى الذكاء الاصطناعي الخارجي.</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/80 flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 border border-sky-500/30">
                4
              </span>
              <span className="leading-snug">انسخ نتيجة ترتيب الأحداث التي أعادها الذكاء الاصطناعي.</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/90 border border-emerald-500/30 flex items-start gap-2.5 bg-emerald-950/20">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 border border-emerald-500/30">
                5
              </span>
              <span className="leading-snug font-medium text-emerald-200">الصق النتيجة في حقل تجهيز الرواية مسبقًا أدناه.</span>
            </div>
          </div>
        </div>

        {/* Expandable Prompt Preview */}
        {showPromptDetails && (
          <div className="mt-1 p-4 rounded-xl bg-slate-900/95 border border-slate-800 flex flex-col gap-2.5 text-xs text-slate-300 leading-relaxed">
            <div className="flex items-center justify-between text-slate-400 text-xs pb-1.5 border-b border-slate-800">
              <span className="font-bold text-sky-400">
                نص البرومبت المخصص الموجه للذكاء الاصطناعي (ترتيب الأحداث فقط):
              </span>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="text-xs text-sky-400 hover:text-sky-300 underline cursor-pointer"
              >
                نسخ إلى الحافظة
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-200 bg-slate-950 p-3.5 rounded-lg border border-slate-800 max-h-80 overflow-y-auto" dir="rtl">
              {EVENT_ORDERING_PROMPT}
            </pre>
          </div>
        )}

        {/* 📚 شرح مسار التدفق والقواعد التفصيلية */}
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Card 1: ⚡ ماذا يحدث بعد لصق النتيجة؟ */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs sm:text-sm">
              <Zap className="h-4 w-4 fill-current shrink-0" />
              <span>⚡ ماذا يحدث بعد لصق النتيجة؟</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              عند إدخال نتيجة جديدة وصالحة واعتمادها، سيتم اعتبارها مصدر البيانات الأساسي للمراحل التالية.
            </p>
            {/* Pipeline diagram */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto gap-1">
              <span className="font-semibold">البيانات المجهزة</span>
              <ArrowLeft className="h-3 w-3 text-slate-500 shrink-0" />
              <span>الأحداث</span>
              <ArrowLeft className="h-3 w-3 text-slate-500 shrink-0" />
              <span>المشاهد</span>
              <ArrowLeft className="h-3 w-3 text-slate-500 shrink-0" />
              <span>الصفحات</span>
              <ArrowLeft className="h-3 w-3 text-slate-500 shrink-0" />
              <span>المراحل التالية</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              بدون إعادة إرسال نص الرواية إلى Gemini لإعادة تحليل الأحداث. إذا كانت هناك بيانات تجهيز سابقة، فإن اعتماد البيانات الجديدة سيؤدي إلى استبدال البيانات السابقة واستخدام البيانات الجديدة بدلًا منها في الخطوات التالية.
            </p>
            <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-[11px] text-amber-200 font-semibold leading-relaxed">
              «⚠️ مهم: لا يكفي لصق النص فقط. يجب اعتماد/حفظ البيانات الجديدة حتى تصبح هي البيانات المستخدمة فعليًا في المراحل التالية.»
            </div>
          </div>

          {/* Card 2: 🔄 عند استبدال البيانات & 🚫 لا تتم إعادة التحليل */}
          <div className="flex flex-col gap-3.5">
            {/* عند استبدال البيانات */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sky-400 font-bold text-xs sm:text-sm">
                <RefreshCw className="h-4 w-4 shrink-0" />
                <span>🔄 عند استبدال البيانات</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                إذا كان المشروع يحتوي على بيانات مجهزة سابقًا، يمكنك لصق تحليل جديد ثم اعتماده.
              </p>
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                <span className="text-rose-400 line-through">البيانات القديمة ❌</span>
                <span className="text-slate-500 font-bold">←</span>
                <span className="text-emerald-400 font-bold">البيانات الجديدة ✅</span>
              </div>
              <p className="text-[11px] text-slate-400">
                وسيتم بناء المراحل التالية اعتمادًا على البيانات الجديدة فقط.
              </p>
            </div>

            {/* لا تتم إعادة التحليل */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-xs sm:text-sm">
                <Ban className="h-4 w-4 shrink-0" />
                <span>🚫 لا تتم إعادة التحليل</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono">
                Prepared Novel Data → مباشرة إلى الخطوات التالية
              </div>
              <div className="text-[11px] text-slate-400 space-y-1 pr-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                  <span>لا تتم إعادة تحليل الرواية بواسطة Gemini.</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                  <span>لا تتم إعادة استخراج الأحداث.</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                  <span>لا تتم إعادة إنشاء الأحداث من النص الأصلي.</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                  <span>لا يتم استخدام البيانات القديمة بالتوازي مع البيانات الجديدة.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: 💾 الحفظ والاستمرارية & 🎯 الهدف من هذا القسم */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 flex items-start gap-3">
            <span className="p-2 rounded-lg bg-purple-500/20 text-purple-400 shrink-0 mt-0.5">
              <HardDrive className="h-4 w-4" />
            </span>
            <div className="flex flex-col gap-1">
              <h5 className="text-xs sm:text-sm font-bold text-white">💾 الحفظ والاستمرارية</h5>
              <p className="text-xs text-slate-300 leading-relaxed">
                بعد اعتماد البيانات الجديدة، يتم حفظها تلقائيًا ضمن بيانات ونقاط تفتيش المشروع بحيث تبقى متاحة ومستمرة عند الانتقال بين الخطوات أو إعادة فتح المشروع لاحقًا.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-start gap-3">
            <span className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="flex flex-col gap-1">
              <h5 className="text-xs sm:text-sm font-bold text-emerald-300">🎯 الهدف من هذا القسم:</h5>
              <p className="text-xs text-emerald-200/90 leading-relaxed font-medium">
                تحليل الرواية يمكن أن يتم <strong>مرة واحدة فقط</strong> بواسطة أي ذكاء اصطناعي خارجي، ثم يتم إدخال النتيجة إلى المشروع واستخدامها مباشرة في جميع المراحل التالية دون تكرار التحليل.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Novel Mismatch Warning Banner */}
      {showMismatchWarning && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
            <span className="font-bold leading-relaxed">{showMismatchWarning}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer shadow-lg flex items-center gap-1.5"
            >
              <Zap className="h-4 w-4" />
              <span>نعم، اعتماد «{validationResult?.detectedTitle || "الرواية الجديدة"}» واستبدال البيانات القديمة فورًا</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Direct Usage Active Banner */}
      {(currentStatus === "ADOPTED" || currentStatus === "SAVED") && preparedData && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>
              <strong>🚀 مسار الاستخدام المباشر مفعّل:</strong> يتم تمرير المشاهد ({displayStats.scenes_count}) والـ Visual Bible ({displayStats.characters_count + displayStats.weapons_count}) والمواقع ({displayStats.locations_count}) مباشرة إلى جميع الأقسام دون أي استدعاء لـ Gemini.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onApplyDirectlyToStudio(validationResult?.parsedData ? adoptPreparedNovelDataset(validationResult.parsedData) : preparedData)}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition cursor-pointer shadow"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>تطبيق مباشر على الاستوديو</span>
          </button>
        </div>
      )}

      {/* تنبيه واعتماد فوري إذا كانت هناك مسودة جديدة أو بيانات غير محفوظة */}
      {(currentStatus === "DRAFT" || currentStatus === "VALID") && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border-2 border-emerald-500 flex items-start sm:items-center justify-between gap-3 text-xs text-emerald-200 shadow-xl">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-emerald-400 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="leading-relaxed font-bold text-white text-xs sm:text-sm">
                بيانات جديدة: «{validationResult?.detectedTitle || "رواية جديدة"}» ({displayStats.scenes_count} مشاهد · {displayStats.characters_count} شخصيات · {displayStats.locations_count} مواقع)
              </span>
              <span className="text-[11px] text-emerald-300">
                الحالة: {currentStatus === "VALID" ? "🔵 تم التحقق بنجاح — جاهز للاعتماد" : "🟡 مسودة جاهزة للتحقق والاعتماد"}. اضغط الزر لاعتماد البيانات واستبدال البيانات القديمة فوراً.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSave}
            className="shrink-0 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold transition cursor-pointer shadow-lg flex items-center gap-1.5 text-xs sm:text-sm"
          >
            <Zap className="h-4 w-4 fill-current" />
            <span>⚡ اعتماد واستبدال البيانات الآن</span>
          </button>
        </div>
      )}

      {/* 4. Large Text Area */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-slate-300">
            محتوى التحليل الخارجي (JSON أو Markdown أو نص منظم من ChatGPT / Claude / DeepSeek...):
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            {inputText.length.toLocaleString()} حرف · {inputText.split("\n").length} أسطر
          </span>
        </div>
        <textarea
          value={inputText}
          onChange={(e) => handleInputChange(e.target.value)}
          rows={9}
          placeholder="الصق تحليل الرواية الجاهز هنا... (يدعم كتل JSON، أو Markdown منظم، أو قوائم الشخصيات والمشاهد والمواقع والـ Canon مباشرة)"
          className="w-full p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs sm:text-sm font-mono text-slate-200 leading-relaxed focus:border-emerald-500 focus:outline-none transition-colors"
          dir="auto"
        />
      </div>

      {/* 5. Metrics & Metadata Preview */}
      {(validationResult || preparedData) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5">
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 font-semibold">المشاهد (Scenes)</span>
            <span className="text-base font-bold text-emerald-400 font-mono">
              {displayStats.scenes_count}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 font-semibold">الشخصيات (Characters)</span>
            <span className="text-base font-bold text-sky-400 font-mono">
              {displayStats.characters_count}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 font-semibold">المواقع (Locations)</span>
            <span className="text-base font-bold text-amber-400 font-mono">
              {displayStats.locations_count}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 font-semibold">الأحداث (Events)</span>
            <span className="text-base font-bold text-indigo-400 font-mono">
              {displayStats.events_count}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 font-semibold">الأسلحة (Weapons)</span>
            <span className="text-base font-bold text-rose-400 font-mono">
              {displayStats.weapons_count}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 font-semibold">العناصر (Items)</span>
            <span className="text-base font-bold text-teal-400 font-mono">
              {displayStats.items_count}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-400 font-semibold">المخلوقات (Creatures)</span>
            <span className="text-base font-bold text-purple-400 font-mono">
              {displayStats.creatures_count ?? 0}
            </span>
          </div>
        </div>
      )}

      {/* 6. Metadata tags if prepared */}
      {preparedData && (
        <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5 text-[11px] font-mono">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400">ID:</span>
            <button
              type="button"
              onClick={() => handleCopyId(preparedData.prepared_novel_id)}
              className="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1 cursor-pointer bg-slate-900 px-2 py-0.5 rounded border border-slate-800"
              title="نسخ معرف التجهيز الثابت"
            >
              {preparedData.prepared_novel_id}
              {copiedId ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
            </button>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">Hash:</span>
            <span className="text-sky-300">{preparedData.content_hash.slice(0, 10)}...</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">Source:</span>
            <span className="text-purple-300">{preparedData.source_type}</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">Schema:</span>
            <span className="text-indigo-300">v{preparedData.schema_version}</span>
          </div>

          <div className="flex items-center gap-2 text-slate-400">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            <span>{new Date(preparedData.created_at).toLocaleDateString("ar-EG")}</span>
          </div>
        </div>
      )}

      {/* Errors or Warnings details */}
      {validationResult && Array.isArray(validationResult.errors) && validationResult.errors.length > 0 && (
        <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/50 flex flex-col gap-1 text-xs text-rose-300">
          <div className="flex items-center gap-1.5 font-bold text-rose-200">
            <AlertCircle className="h-4 w-4" />
            <span>أخطاء في بنية بيانات التجهيز:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {validationResult.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {noticeMessage && (
        <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-300 font-bold">
          {noticeMessage}
        </div>
      )}

      {/* 7. Action Buttons */}
      <div className="flex items-center justify-between flex-wrap gap-2.5 pt-2 border-t border-slate-800">
        <div className="flex items-center gap-2 flex-wrap">
          {/* استيراد واعتماد البيانات */}
          <button
            type="button"
            onClick={handleImport}
            disabled={!inputText.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-40 shadow border border-sky-400/50"
            title="استيراد واعتماد بيانات التجهيز مباشرة في كافة أقسام الاستوديو"
          >
            <Database className="h-3.5 w-3.5" />
            <span>استيراد واعتماد البيانات</span>
          </button>

          {/* التحقق من البيانات */}
          <button
            type="button"
            onClick={handleValidate}
            disabled={!inputText.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs font-bold transition cursor-pointer disabled:opacity-40 border border-slate-700"
          >
            <FileCheck className="h-3.5 w-3.5" />
            <span>التحقق من البيانات</span>
          </button>

          {/* حفظ واعتماد التجهيز */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!inputText.trim()}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer disabled:opacity-40 shadow-md shadow-emerald-950/40"
            title="حفظ واعتماد البيانات واستبدال البيانات القديمة فوراً"
          >
            <Save className="h-3.5 w-3.5" />
            <span>حفظ واعتماد التجهيز</span>
          </button>

          {/* استبدال التجهيز */}
          {Boolean(preparedData) && (
            <button
              type="button"
              onClick={() => setConfirmReplaceOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition cursor-pointer shadow-md shadow-amber-950/40"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>استبدال التجهيز</span>
            </button>
          )}

          {/* مسح التجهيز */}
          {Boolean(preparedData || inputText.trim()) && (
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900 border border-rose-500/40 text-rose-300 text-xs font-bold transition cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>مسح التجهيز</span>
            </button>
          )}
        </div>

        {/* Inspect Details Toggle */}
        {(preparedData || validationResult?.parsedData) && (
          <button
            type="button"
            onClick={() => setIsInspecting(!isInspecting)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>{isInspecting ? "إخفاء التفاصيل" : "استعراض تفاصيل التجهيز"}</span>
            {isInspecting ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* 8. Collapsible Inspection Drawer */}
      {isInspecting && (preparedData || validationResult?.parsedData) && (
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-3 text-xs">
          <div className="font-bold text-white border-b border-slate-800 pb-2">
            محتوى التجهيز المحفوظ (معاينة الكيانات المستخرجة والحقول الأصلية):
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto p-1">
            {/* Characters */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="font-bold text-sky-400 block">الشخصيات المستخرجة:</span>
              <div className="space-y-1 text-slate-300 text-[11px]">
                {(preparedData?.converted_studio_data?.production_elements ||
                  validationResult?.parsedData?.converted_studio_data?.production_elements ||
                  [])
                  .filter((e) => e.category === "CHARACTER")
                  .map((ch) => (
                    <div key={ch.id} className="border-b border-slate-800/60 pb-1">
                      <strong className="text-white">{ch.name}</strong> ({ch.id}): {ch.description.slice(0, 100)}
                    </div>
                  ))}
              </div>
            </div>

            {/* Locations */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="font-bold text-amber-400 block">المواقع المستخرجة:</span>
              <div className="space-y-1 text-slate-300 text-[11px]">
                {(preparedData?.converted_studio_data?.locations ||
                  validationResult?.parsedData?.converted_studio_data?.locations ||
                  []).map((loc) => (
                  <div key={loc.location_id} className="border-b border-slate-800/60 pb-1">
                    <strong className="text-white">{loc.name}</strong> ({loc.location_id}): {loc.description.slice(0, 100)}
                  </div>
                ))}
              </div>
            </div>

            {/* Weapons */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="font-bold text-rose-400 block">الأسلحة المستخرجة (Weapons):</span>
              <div className="space-y-1 text-slate-300 text-[11px]">
                {(preparedData?.weapons ||
                  validationResult?.parsedData?.weapons ||
                  (preparedData?.converted_studio_data?.production_elements ||
                    validationResult?.parsedData?.converted_studio_data?.production_elements ||
                    []).filter((e) => e.category === "WEAPON")
                ).map((w: any) => (
                  <div key={w.id || w.name} className="border-b border-slate-800/60 pb-1">
                    <strong className="text-white">{w.name}</strong> ({w.id || "WEAPON"}): {w.description?.slice(0, 100)}
                  </div>
                ))}
              </div>
            </div>

            {/* Items */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="font-bold text-teal-400 block">العناصر المستخرجة (Items):</span>
              <div className="space-y-1 text-slate-300 text-[11px]">
                {(preparedData?.items ||
                  validationResult?.parsedData?.items ||
                  (preparedData?.converted_studio_data?.production_elements ||
                    validationResult?.parsedData?.converted_studio_data?.production_elements ||
                    []).filter((e) => e.category === "ITEM")
                ).map((it: any) => (
                  <div key={it.id || it.name} className="border-b border-slate-800/60 pb-1">
                    <strong className="text-white">{it.name}</strong> ({it.id || "ITEM"}): {it.description?.slice(0, 100)}
                  </div>
                ))}
              </div>
            </div>

            {/* Creatures */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="font-bold text-purple-400 block">المخلوقات المستخرجة (Creatures):</span>
              <div className="space-y-1 text-slate-300 text-[11px]">
                {(preparedData?.creatures ||
                  validationResult?.parsedData?.creatures ||
                  (preparedData?.converted_studio_data?.production_elements ||
                    validationResult?.parsedData?.converted_studio_data?.production_elements ||
                    []).filter((e) => e.category === "CREATURE")
                ).map((cr: any) => (
                  <div key={cr.id || cr.name} className="border-b border-slate-800/60 pb-1">
                    <strong className="text-white">{cr.name}</strong> ({cr.id || "CREATURE"}): {cr.description?.slice(0, 100)}
                  </div>
                ))}
              </div>
            </div>

            {/* Scenes */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5 md:col-span-2">
              <span className="font-bold text-emerald-400 block">المشاهد المستخرجة:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 text-[11px]">
                {(preparedData?.converted_studio_data?.scenes ||
                  validationResult?.parsedData?.converted_studio_data?.scenes ||
                  []).map((sc) => (
                  <div key={sc.scene_id} className="p-2 rounded bg-slate-950 border border-slate-800">
                    <div className="flex items-center justify-between font-mono text-[10px] text-emerald-400">
                      <span>{sc.scene_id}</span>
                      <span>{sc.location_name}</span>
                    </div>
                    <div className="font-bold text-white text-xs mt-0.5">{sc.title}</div>
                    <p className="text-slate-400 text-[10px] line-clamp-2 mt-0.5">{sc.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Canon & Extra AI fields */}
            {(preparedData?.canon || validationResult?.parsedData?.canon) && (
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1 md:col-span-2">
                <span className="font-bold text-indigo-400 block">Canon / Lore / حقائق العالم:</span>
                <p className="text-slate-300 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {(() => {
                    const c = preparedData?.canon || validationResult?.parsedData?.canon;
                    return typeof c === "string" ? c : JSON.stringify(c, null, 2);
                  })()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm Replace Modal */}
      {confirmReplaceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-4 text-right shadow-2xl">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <span>تأكيد استبدال بيانات التجهيز</span>
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              هل أنت متأكد من استبدال بيانات التجهيز الحالية ببيانات التحليل الجديدة؟ سيتم تحديث جميع المشاهد والمواقع والـ Visual Bible بالبيانات الجديدة مباشرة.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmReplaceOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleReplace}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer shadow"
              >
                نعم، استبدال التجهيز
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Clear Modal */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col gap-4 text-right shadow-2xl">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-rose-400" />
              <span>تأكيد مسح التجهيز</span>
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              هل تريد بالتأكيد مسح بيانات التجهيز المسبق؟ سيتم الرجوع إلى المسار العادي لتوليد السكريبت بواسطة Gemini.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer shadow"
              >
                نعم، مسح التجهيز
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
