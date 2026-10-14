import React, { useState, useEffect, useMemo } from "react";
import {
  Puzzle,
  Download,
  Trash2,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Globe,
  SlidersHorizontal,
  Layers,
  Sparkles,
  Server
} from "lucide-react";

export interface ExtensionItem {
  pkg: string;
  name: string;
  apk?: string;
  apkUrl?: string;
  iconUrl?: string;
  lang: string;
  version: string;
  versionCode?: number;
  nsfw: boolean;
  isInstalled?: boolean;
  hasUpdate?: boolean;
  sources?: Array<{
    id: string;
    name: string;
    baseUrl?: string;
    lang?: string;
  }>;
}

interface ExtensionsPageProps {
  onBackToCatalogue?: () => void;
}

export default function ExtensionsPage({ onBackToCatalogue }: ExtensionsPageProps) {
  const [activeTab, setActiveTab] = useState<"installed" | "available" | "updates">("available");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLang, setSelectedLang] = useState<string>("all");
  const [includeNsfw, setIncludeNsfw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [installedList, setInstalledList] = useState<ExtensionItem[]>([]);
  const [repoList, setRepoList] = useState<ExtensionItem[]>([]);
  const [processingPkgs, setProcessingPkgs] = useState<Record<string, string>>({});
  const [selectedExtension, setSelectedExtension] = useState<ExtensionItem | null>(null);

  const fetchData = async () => {
    try {
      setErrorMessage(null);
      // 1. Fetch repo index (Keiyoushi repository)
      const [repoRes, installedRes] = await Promise.allSettled([
        fetch("/api/suwayomi/extensions/repo").then((r) => r.json()),
        fetch("/api/suwayomi/extensions").then((r) => r.json())
      ]);

      let loadedRepo: ExtensionItem[] = [];
      let loadedInstalled: ExtensionItem[] = [];

      if (repoRes.status === "fulfilled" && repoRes.value?.success) {
        loadedRepo = repoRes.value.extensions || [];
      }

      if (installedRes.status === "fulfilled" && installedRes.value?.online) {
        setServerOnline(true);
        loadedInstalled = installedRes.value.extensions || [];
      } else {
        setServerOnline(false);
      }

      // Merge installed status onto repo list
      const installedPkgMap = new Map<string, ExtensionItem>();
      loadedInstalled.forEach((ext) => {
        installedPkgMap.set(ext.pkg, ext);
      });

      const mergedRepo = loadedRepo.map((ext) => {
        const inst = installedPkgMap.get(ext.pkg);
        return {
          ...ext,
          isInstalled: Boolean(inst),
          hasUpdate: inst ? (ext.versionCode || 0) > (inst.versionCode || 0) : false
        };
      });

      setRepoList(mergedRepo);
      setInstalledList(loadedInstalled);
    } catch (err: any) {
      console.error("Failed to load extensions:", err);
      setErrorMessage("تعذر الاتصال بخادم الإضافات. يرجى التحقق من الاتصال.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleInstall = async (ext: ExtensionItem) => {
    setProcessingPkgs((prev) => ({ ...prev, [ext.pkg]: "installing" }));
    try {
      const res = await fetch(`/api/suwayomi/extensions/install/${encodeURIComponent(ext.pkg)}`, {
        method: "POST"
      });
      const data = await res.json();
      if (data.success) {
        setInstalledList((prev) => [...prev.filter((i) => i.pkg !== ext.pkg), { ...ext, isInstalled: true }]);
        setRepoList((prev) =>
          prev.map((i) => (i.pkg === ext.pkg ? { ...i, isInstalled: true, hasUpdate: false } : i))
        );
      } else {
        alert(data.error || "تعذر تثبيت الإضافة");
      }
    } catch (err: any) {
      alert("حدث خطأ أثناء التثبيت: " + err.message);
    } finally {
      setProcessingPkgs((prev) => {
        const next = { ...prev };
        delete next[ext.pkg];
        return next;
      });
    }
  };

  const handleUninstall = async (ext: ExtensionItem) => {
    if (!confirm(`هل أنت متأكد من رغبتك في إزالة إضافة "${ext.name}"؟`)) return;
    setProcessingPkgs((prev) => ({ ...prev, [ext.pkg]: "uninstalling" }));
    try {
      const res = await fetch(`/api/suwayomi/extensions/uninstall/${encodeURIComponent(ext.pkg)}`, {
        method: "POST"
      });
      const data = await res.json();
      if (data.success) {
        setInstalledList((prev) => prev.filter((i) => i.pkg !== ext.pkg));
        setRepoList((prev) =>
          prev.map((i) => (i.pkg === ext.pkg ? { ...i, isInstalled: false, hasUpdate: false } : i))
        );
      } else {
        alert(data.error || "تعذر إزالة الإضافة");
      }
    } catch (err: any) {
      alert("حدث خطأ أثناء إزالة الإضافة: " + err.message);
    } finally {
      setProcessingPkgs((prev) => {
        const next = { ...prev };
        delete next[ext.pkg];
        return next;
      });
    }
  };

  const handleUpdate = async (ext: ExtensionItem) => {
    setProcessingPkgs((prev) => ({ ...prev, [ext.pkg]: "updating" }));
    try {
      const res = await fetch(`/api/suwayomi/extensions/update/${encodeURIComponent(ext.pkg)}`, {
        method: "POST"
      });
      const data = await res.json();
      if (data.success) {
        setInstalledList((prev) =>
          prev.map((i) => (i.pkg === ext.pkg ? { ...i, version: ext.version, hasUpdate: false } : i))
        );
        setRepoList((prev) =>
          prev.map((i) => (i.pkg === ext.pkg ? { ...i, hasUpdate: false } : i))
        );
      } else {
        alert(data.error || "تعذر تحديث الإضافة");
      }
    } catch (err: any) {
      alert("حدث خطأ أثناء تحديث الإضافة: " + err.message);
    } finally {
      setProcessingPkgs((prev) => {
        const next = { ...prev };
        delete next[ext.pkg];
        return next;
      });
    }
  };

  // Filtered lists
  const currentList = useMemo(() => {
    let baseList = repoList;
    if (activeTab === "installed") {
      baseList = repoList.filter((e) => e.isInstalled);
    } else if (activeTab === "updates") {
      baseList = repoList.filter((e) => e.isInstalled && e.hasUpdate);
    }

    return baseList.filter((item) => {
      // Language filter
      if (selectedLang !== "all" && item.lang !== selectedLang) {
        return false;
      }
      // NSFW filter
      if (!includeNsfw && item.nsfw) {
        return false;
      }
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesPkg = item.pkg.toLowerCase().includes(q);
        const matchesSource = item.sources?.some((s) => s.name.toLowerCase().includes(q));
        if (!matchesName && !matchesPkg && !matchesSource) return false;
      }
      return true;
    });
  }, [repoList, activeTab, selectedLang, includeNsfw, searchQuery]);

  // Unique languages in repository
  const availableLangs = useMemo(() => {
    const langs = new Set<string>();
    repoList.forEach((e) => {
      if (e.lang) langs.add(e.lang);
    });
    return Array.from(langs).sort();
  }, [repoList]);

  const updatesCount = useMemo(() => {
    return repoList.filter((e) => e.isInstalled && e.hasUpdate).length;
  }, [repoList]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24" dir="rtl">
      {/* Header Bar */}
      <div className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-16 z-30">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              {onBackToCatalogue && (
                <button
                  onClick={onBackToCatalogue}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="العودة للمصادر"
                >
                  <ArrowRight className="h-5 w-5" />
                </button>
              )}
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 text-emerald-400">
                <Puzzle className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
                  مركز الإضافات والمصادر (Extensions Hub)
                  {serverOnline === false && (
                    <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300">
                      خادم محلي غير متصل
                    </span>
                  )}
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  إدارة إضافات ومصادر قراءة المانجا والمانهوا المعتمدة من مستودع Keiyoushi و Suwayomi
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-sm font-semibold text-slate-200 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-emerald-400" : ""}`} />
                <span>تحديث المستودع</span>
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-4 border-t border-slate-800/80 pt-3">
            <button
              onClick={() => setActiveTab("available")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                activeTab === "available"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                  : "bg-slate-800/60 hover:bg-slate-800 text-slate-300"
              }`}
            >
              <Globe className="h-4 w-4" />
              <span>المستودع والمصادر</span>
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-900/40 font-mono">
                {repoList.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("installed")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                activeTab === "installed"
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                  : "bg-slate-800/60 hover:bg-slate-800 text-slate-300"
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>المثبتة</span>
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-900/40 font-mono">
                {installedList.length}
              </span>
            </button>

            {updatesCount > 0 && (
              <button
                onClick={() => setActiveTab("updates")}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                  activeTab === "updates"
                    ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                }`}
              >
                <Sparkles className="h-4 w-4" />
                <span>تحديثات متوفرة</span>
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-950/40 font-mono">
                  {updatesCount}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Search & Filter Controls */}
        <div className="mb-6 p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80 flex flex-col md:flex-row gap-3 items-center justify-between">
          {/* Search Input */}
          <div className="relative w-full md:max-w-md">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم، الحزمة، أو المصدر..."
              className="w-full pr-10 pl-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/70 transition-colors"
            />
          </div>

          {/* Filters: Language and NSFW */}
          <div className="flex items-center gap-3 w-full md:w-auto flex-wrap justify-between md:justify-end">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-slate-400" />
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/70"
              >
                <option value="all">كل اللغات ({availableLangs.length})</option>
                <option value="ar">العربية (ar)</option>
                <option value="en">الإنجليزية (en)</option>
                <option value="ja">اليابانية (ja)</option>
                <option value="ko">الكورية (ko)</option>
                {availableLangs
                  .filter((l) => !["all", "ar", "en", "ja", "ko"].includes(l))
                  .map((l) => (
                    <option key={l} value={l}>
                      {l.toUpperCase()}
                    </option>
                  ))}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors select-none">
              <input
                type="checkbox"
                checked={includeNsfw}
                onChange={(e) => setIncludeNsfw(e.target.checked)}
                className="rounded border-slate-700 text-rose-500 focus:ring-0"
              />
              <span>إظهار +18 (NSFW)</span>
            </label>
          </div>
        </div>

        {/* Server status alert when offline */}
        {serverOnline === false && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 flex items-start gap-3">
            <Server className="h-5 w-5 shrink-0 mt-0.5 text-amber-400" />
            <div className="text-xs sm:text-sm">
              <span className="font-bold">ملاحظة بشأن خادم Suwayomi:</span> يتصفح التطبيق المستودع السحابي المباشر Keiyoushi. لتثبيت وتشغيل الإضافات محلياً، تأكد من تشغيل خادم Suwayomi على المنفذ الافتراضي (4567). يمكنك أيضاً تصفح الفهارس والمصادر مباشرة عبر واجهة المصادر.
            </div>
          </div>
        )}

        {/* Content State */}
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            <span className="text-sm font-semibold">جاري جلب قائمة الإضافات من المستودع...</span>
          </div>
        ) : currentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[35vh] p-8 text-center rounded-2xl bg-slate-900/40 border border-slate-800/60">
            <div className="p-4 rounded-2xl bg-slate-800/60 text-slate-500 mb-3">
              <Puzzle className="h-8 w-8" />
            </div>
            <h3 className="text-base font-bold text-slate-200">لا توجد إضافات تطابق البحث</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              جرب تغيير كلمات البحث أو إعادة تعيين فلتر اللغة أو خيار المحتوى الحساس.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentList.map((ext) => {
              const isProcessing = Boolean(processingPkgs[ext.pkg]);
              const actionState = processingPkgs[ext.pkg];

              return (
                <div
                  key={ext.pkg}
                  className="flex flex-col justify-between p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 hover:border-slate-700 hover:bg-slate-900 transition-all group shadow-sm hover:shadow-lg"
                >
                  <div>
                    {/* Top row: Icon + Names + Badges */}
                    <div className="flex items-start gap-3">
                      <div className="relative w-12 h-12 rounded-xl bg-slate-800 border border-slate-700/60 flex items-center justify-center shrink-0 overflow-hidden">
                        {ext.iconUrl ? (
                          <img
                            src={ext.iconUrl}
                            alt={ext.name}
                            className="w-full h-full object-contain p-1"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <Puzzle className="h-6 w-6 text-slate-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-bold text-white truncate max-w-[200px]" title={ext.name}>
                            {ext.name}
                          </h3>
                          {ext.nsfw && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                              +18
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-slate-400 font-mono">
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                            {ext.lang.toUpperCase()}
                          </span>
                          <span className="text-[11px] text-slate-400">v{ext.version}</span>
                          {ext.sources && ext.sources.length > 0 && (
                            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                              <Layers className="h-3 w-3" />
                              {ext.sources.length} مصادر
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 text-[11px] text-slate-400 truncate font-mono select-all">
                      {ext.pkg}
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    {ext.sources && ext.sources.length > 0 ? (
                      <button
                        onClick={() => setSelectedExtension(ext)}
                        className="text-xs font-semibold text-slate-400 hover:text-emerald-400 transition-colors flex items-center gap-1"
                      >
                        <span>عرض المصادر</span>
                      </button>
                    ) : (
                      <span />
                    )}

                    <div className="flex items-center gap-1.5">
                      {ext.isInstalled ? (
                        <>
                          {ext.hasUpdate && (
                            <button
                              onClick={() => handleUpdate(ext)}
                              disabled={isProcessing}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-50"
                            >
                              {actionState === "updating" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5" />
                              )}
                              <span>تحديث</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleUninstall(ext)}
                            disabled={isProcessing}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold transition-all disabled:opacity-50"
                            title="إزالة الإضافة"
                          >
                            {actionState === "uninstalling" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleInstall(ext)}
                          disabled={isProcessing}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-all disabled:opacity-50 shadow-sm shadow-emerald-500/20"
                        >
                          {actionState === "installing" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          <span>تثبيت</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Extension Sources Details Modal */}
      {selectedExtension && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm" dir="rtl">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center overflow-hidden">
                  {selectedExtension.iconUrl ? (
                    <img src={selectedExtension.iconUrl} alt={selectedExtension.name} className="w-full h-full object-contain p-1" />
                  ) : (
                    <Puzzle className="h-5 w-5 text-slate-400" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">{selectedExtension.name}</h3>
                  <p className="text-xs text-slate-400 font-mono">{selectedExtension.pkg}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedExtension(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="py-4 overflow-y-auto space-y-2 flex-1">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                المصادر المشمولة في هذه الإضافة ({selectedExtension.sources?.length || 0}):
              </h4>
              {selectedExtension.sources && selectedExtension.sources.length > 0 ? (
                selectedExtension.sources.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-200">{s.name}</div>
                      {s.baseUrl && (
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">{s.baseUrl}</div>
                      )}
                    </div>
                    {s.lang && (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                        {s.lang.toUpperCase()}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">لا توجد مصادر مفصلة متاحة لهذه الإضافة.</p>
              )}
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedExtension(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
