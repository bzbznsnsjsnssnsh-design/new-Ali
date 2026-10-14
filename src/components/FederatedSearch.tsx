import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Search, Loader2, BookOpen, Heart, Globe, Sparkles, Filter, 
  Layers, ExternalLink, RefreshCw, X, CheckCircle2, ChevronRight,
  TrendingUp, AlertCircle, Eye, ArrowUpDown, LayoutGrid, Trophy,
  ListOrdered, Check, Award, Plus
} from "lucide-react";
import AddCustomSourceModal from "./AddCustomSourceModal";

export interface FederatedMangaItem {
  id: string;
  rawId: string;
  title: string;
  coverUrl: string;
  author?: string;
  artist?: string;
  status?: string;
  description?: string;
  sourceId: string;
  sourceRawId: string;
  sourceName: string;
  sourceLanguage?: string;
  language?: string;
  provider?: string;
  chaptersCount?: number;
  latestChapter?: string;
  relevanceScore?: number;
}

interface FederatedSearchProps {
  initialQuery?: string;
  onOpenManga: (manga: any) => void;
  isFavorite: (id: string, title?: string, sourceId?: string) => boolean;
  toggleFavorite: (manga: any) => void;
  onBackToSources?: () => void;
}

const POPULAR_SUGGESTIONS = [
  "Solo Leveling",
  "One Piece",
  "Return of the Mount Hua Sect",
  "Nano Machine",
  "Berserk",
  "Omniscient Reader",
  "Tower of God",
  "Bleach",
  "Jujutsu Kaisen"
];

export default function FederatedSearch({
  initialQuery = "",
  onOpenManga,
  isFavorite,
  toggleFavorite,
  onBackToSources
}: FederatedSearchProps) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [activeLang, setActiveLang] = useState<"all" | "ar" | "en">("all");
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<FederatedMangaItem[]>([]);
  const [totalSourcesSearched, setTotalSourcesSearched] = useState(0);
  const [viewMode, setViewMode] = useState<"grid" | "grouped">("grid");
  const [showAddCustomSourceModal, setShowAddCustomSourceModal] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{
    completed: number;
    total: number;
    currentSource: string;
    foundCount: number;
    successfulCount?: number;
    timedOutCount?: number;
    failedCount?: number;
  } | null>(null);
  const [completedStats, setCompletedStats] = useState<{
    totalResults: number;
    sourcesSearched: number;
    successfulCount: number;
    timedOutCount: number;
    failedCount: number;
    totalSources: number;
    durationMs: number;
    avgLatencyMs?: number;
  } | null>(null);

  // In-results filtering
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<string>("all");
  const [filterQuery, setFilterQuery] = useState("");
  const [sortBy, setSortBy] = useState<"chapters" | "relevance" | "title" | "source">("chapters");

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Buffered streaming refs to avoid UI freezing and keep UI silky smooth ("اسلس بدون تعليق")
  const incomingBufferRef = useRef<FederatedMangaItem[]>([]);
  const lastFlushTimeRef = useRef<number>(0);
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);

  const flushBuffer = () => {
    if (incomingBufferRef.current.length === 0) return;
    const toAdd = [...incomingBufferRef.current];
    incomingBufferRef.current = [];
    setResults((prev) => {
      const existingKeys = new Set(prev.map((m) => `${m.sourceId}_${m.rawId}`));
      const newItems = toAdd.filter(
        (m: FederatedMangaItem) => !existingKeys.has(`${m.sourceId}_${m.rawId}`)
      );
      if (newItems.length === 0) return prev;
      return [...prev, ...newItems];
    });
  };

  const scheduleFlush = () => {
    const now = Date.now();
    if (now - lastFlushTimeRef.current > 180) {
      lastFlushTimeRef.current = now;
      flushBuffer();
    } else if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        lastFlushTimeRef.current = Date.now();
        flushBuffer();
      }, 180);
    }
  };

  // Clear debounce timer and abort controller on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Background resolver for chapter counts
  useEffect(() => {
    if (results.length === 0) return;
    const unindexed = results
      .filter((r) => (!r.chaptersCount || r.chaptersCount === 0) && !r.latestChapter && !(r as any)._resolutionAttempted)
      .slice(0, 20);

    if (unindexed.length === 0) return;

    const timer = setTimeout(async () => {
      try {
        // Optimistically mark these as attempted so we don't get stuck in a loop and can process the next batch
        setResults((prev) =>
          prev.map((item) =>
            unindexed.some(u => u.id === item.id)
              ? { ...item, _resolutionAttempted: true }
              : item
          )
        );

        const res = await fetch("/api/suwayomi/resolve-chapter-counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: unindexed })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.counts && Object.keys(data.counts).length > 0) {
            setResults((prev) =>
              prev.map((item) => {
                const count = data.counts[item.id];
                if (count && count > 0) {
                  return { ...item, chaptersCount: count };
                }
                return item;
              })
            );
          }
        }
      } catch {}
    }, 450);

    return () => clearTimeout(timer);
  }, [results]);

  // Auto trigger search if initialQuery is supplied
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      setSearchQuery(initialQuery.trim());
      executeFederatedSearch(initialQuery.trim(), activeLang);
    }
  }, [initialQuery]);

  const executeFederatedSearch = (queryText: string, lang: string) => {
    const q = queryText.trim();
    if (!q) return;

    // Abort any ongoing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    incomingBufferRef.current = [];

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    setHasSearched(true);
    setResults([]);
    setCompletedStats(null);
    setSelectedSourceFilter("all");
    setFilterQuery("");
    const initialTotal = lang === "ar" ? 65 : 2211;
    setSearchProgress({
      completed: 0,
      total: initialTotal,
      currentSource: "بدء فحص جميع المصادر والملحقات المتصلة (أكثر من 2200 مصدر)...",
      foundCount: 0,
      successfulCount: 0,
      timedOutCount: 0,
      failedCount: 0
    });

    // Try Server-Sent Events (SSE) streaming for real-time live results as each extension completes!
    const streamUrl = `/api/suwayomi/federated-search/stream?query=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`;
    
    fetch(streamUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          throw new Error("SSE not available, falling back to JSON");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEventType = "message";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEventType = line.replace("event:", "").trim();
            } else if (line.startsWith("data:")) {
              const dataStr = line.replace("data:", "").trim();
              if (!dataStr) continue;
              try {
                const parsed = JSON.parse(dataStr);
                if (currentEventType === "source_result" && Array.isArray(parsed.mangas)) {
                  incomingBufferRef.current.push(...parsed.mangas);
                  scheduleFlush();
                } else if (currentEventType === "progress") {
                  setSearchProgress(parsed);
                } else if (currentEventType === "done") {
                  flushBuffer();
                  setTotalSourcesSearched(parsed.sourcesSearched || 0);
                  setCompletedStats({
                    totalResults: parsed.totalResults || 0,
                    sourcesSearched: parsed.sourcesSearched || 0,
                    successfulCount: parsed.successfulCount || 0,
                    timedOutCount: parsed.timedOutCount || 0,
                    failedCount: parsed.failedCount || 0,
                    totalSources: parsed.totalSources || 0,
                    durationMs: parsed.durationMs || 0,
                    avgLatencyMs: parsed.avgLatencyMs || 0
                  });
                  setIsSearching(false);
                }
              } catch (e) {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
        flushBuffer();
        setIsSearching(false);
      })
      .catch(async (err) => {
        if (err.name === "AbortError") return;
        console.warn("[FederatedSearch] Stream fallback to JSON:", err);

        // Fallback to standard JSON endpoint
        try {
          const jsonRes = await fetch(
            `/api/suwayomi/federated-search?query=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`,
            { signal: controller.signal }
          );
          if (jsonRes.ok) {
            const data = await jsonRes.json();
            setResults(data.results || []);
            setTotalSourcesSearched(data.sourcesSearched || 0);
            setCompletedStats({
              totalResults: data.count || data.results?.length || 0,
              sourcesSearched: data.sourcesSearched || 0,
              successfulCount: data.successfulCount || 0,
              timedOutCount: data.timedOutCount || 0,
              failedCount: data.failedCount || 0,
              totalSources: data.totalSources || 0,
              durationMs: data.durationMs || 0,
              avgLatencyMs: data.avgLatencyMs || 0
            });
          }
        } catch (jsonErr: any) {
          if (jsonErr.name !== "AbortError") {
            console.error("Federated search JSON error:", jsonErr);
          }
        } finally {
          setIsSearching(false);
        }
      });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const trimmed = val.trim();
    if (trimmed.length >= 3) {
      debounceTimerRef.current = setTimeout(() => {
        executeFederatedSearch(trimmed, activeLang);
      }, 750);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    executeFederatedSearch(searchQuery, activeLang);
  };

  const handleSuggestionClick = (title: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setSearchQuery(title);
    executeFederatedSearch(title, activeLang);
  };

  const handleLangChange = (newLang: "all" | "ar" | "en") => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setActiveLang(newLang);
    if (searchQuery.trim()) {
      executeFederatedSearch(searchQuery, newLang);
    }
  };

  // Grouping of sources present in the results, sorted by maxChapters descending so sources with most chapters appear first!
  const sourcesInResults = useMemo(() => {
    const map = new Map<string, { id: string; name: string; lang: string; count: number; maxChapters: number }>();
    for (const r of results) {
      const existing = map.get(r.sourceName);
      const ch = r.chaptersCount || 0;
      if (existing) {
        existing.count++;
        if (ch > existing.maxChapters) existing.maxChapters = ch;
      } else {
        map.set(r.sourceName, {
          id: r.sourceId,
          name: r.sourceName,
          lang: r.sourceLanguage || "all",
          count: 1,
          maxChapters: ch
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.maxChapters !== a.maxChapters) return b.maxChapters - a.maxChapters;
      return b.count - a.count;
    });
  }, [results]);

  // Filter and sort results
  const filteredResults = useMemo(() => {
    let list = results;

    if (selectedSourceFilter !== "all") {
      list = list.filter((m) => m.sourceName === selectedSourceFilter);
    }

    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.author && m.author.toLowerCase().includes(q)) ||
          m.sourceName.toLowerCase().includes(q)
      );
    }

    // Sorting: user requested sources with the most chapters appear at the top descending!
    return [...list].sort((a, b) => {
      if (sortBy === "chapters") {
        const chA = a.chaptersCount || 0;
        const chB = b.chaptersCount || 0;
        if (chB !== chA) return chB - chA;
        return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      }
      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "source") {
        return a.sourceName.localeCompare(b.sourceName);
      }
      return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    });
  }, [results, selectedSourceFilter, filterQuery, sortBy]);

  // Group results by canonical work title to show comparative sources breakdown ranked by chapters count!
  const groupedWorks = useMemo(() => {
    const map = new Map<string, {
      canonicalTitle: string;
      coverUrl: string;
      author: string;
      sources: FederatedMangaItem[];
      maxChapters: number;
    }>();

    for (const item of filteredResults) {
      const normKey = item.title
        .toLowerCase()
        .replace(/[:\-–—_.,!?'"()[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const existing = map.get(normKey);
      const ch = item.chaptersCount || 0;
      if (existing) {
        existing.sources.push(item);
        if (ch > existing.maxChapters) existing.maxChapters = ch;
        if (!existing.coverUrl && item.coverUrl) existing.coverUrl = item.coverUrl;
      } else {
        map.set(normKey, {
          canonicalTitle: item.title,
          coverUrl: item.coverUrl,
          author: item.author || "",
          sources: [item],
          maxChapters: ch
        });
      }
    }

    const works = Array.from(map.values()).map((work) => {
      const sortedSources = [...work.sources].sort((a, b) => {
        const chA = a.chaptersCount || 0;
        const chB = b.chaptersCount || 0;
        if (chB !== chA) return chB - chA;
        return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      });
      return {
        ...work,
        sources: sortedSources,
        maxChapters: sortedSources[0]?.chaptersCount || work.maxChapters
      };
    });

    return works.sort((a, b) => b.maxChapters - a.maxChapters);
  }, [filteredResults]);

  return (
    <div className="flex flex-col gap-5 w-full max-w-7xl mx-auto" dir="rtl">
      {/* Header Banner explaining the federated cross-source search engine */}
      <div className="relative overflow-hidden rounded-3xl border border-teal-500/40 bg-gradient-to-br from-slate-900 via-slate-950 to-teal-950/40 p-5 sm:p-7 shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 text-slate-950 shadow-xl shadow-teal-500/25 shrink-0">
              <Search className="h-6 w-6 sm:h-7 sm:w-7 font-black" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight">
                  البحث الشامل عبر كافة المصادر والملحقات
                </h1>
                <span className="rounded-full bg-teal-500/20 px-3 py-0.5 text-xs font-bold text-teal-300 border border-teal-500/40 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>محرك بحث موحد (Federated Multi-Source)</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
                اكتب اسم العمل مرة واحدة، ويقوم النظام بالتوجه لكل ملحق ومصدر متصل على حدة، وإدخال الاسم في خانة بحث المصدر واستخراج نتائجه المنفصلة مع توضيح المصدر وحالة العمل وغلافه وفصوله.
              </p>
            </div>
          </div>

          {onBackToSources && (
            <button
              type="button"
              onClick={onBackToSources}
              className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-500 transition cursor-pointer shrink-0"
            >
              <span>العودة لدليل المصادر</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search Input Box */}
        <form onSubmit={handleFormSubmit} className="relative z-10 mt-6 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                <Search className="h-5 w-5 text-teal-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={handleInputChange}
                placeholder="اكتب اسم أي مانجا أو مانهوا (مثال: Solo Leveling, ون بيس, Berserk, Return of the Mount Hua)..."
                className="w-full rounded-2xl border border-teal-500/40 bg-slate-950/90 py-3.5 pr-12 pl-12 text-sm sm:text-base text-white placeholder-slate-500 shadow-inner outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    if (debounceTimerRef.current) {
                      clearTimeout(debounceTimerRef.current);
                      debounceTimerRef.current = null;
                    }
                    setSearchQuery("");
                  }}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  title="مسح"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-400 to-emerald-500 px-7 py-3.5 text-sm sm:text-base font-black text-slate-950 shadow-xl shadow-teal-500/20 transition hover:brightness-110 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isSearching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              <span>{isSearching ? "جاري فحص المصادر..." : "تنفيذ البحث الشامل"}</span>
            </button>
          </div>

          {/* Language selector & quick filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/70 p-1 flex-wrap">
              <button
                type="button"
                onClick={() => handleLangChange("all")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeLang === "all"
                    ? "bg-teal-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                <span>كل المصادر (2,043 مصدر)</span>
              </button>
              <button
                type="button"
                onClick={() => handleLangChange("ar")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeLang === "ar"
                    ? "bg-teal-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span>المصادر العربية (65 مصدر)</span>
              </button>
              <button
                type="button"
                onClick={() => handleLangChange("en")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  activeLang === "en"
                    ? "bg-teal-500 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span>المصادر الإنجليزية والعالمية</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddCustomSourceModal(true)}
                className="rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 px-3 py-1.5 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>إضافة مصدر يدوي</span>
              </button>
            </div>

            {/* Popular search terms suggestions */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-teal-400" />
                <span>أعمال شائعة:</span>
              </span>
              {POPULAR_SUGGESTIONS.slice(0, 5).map((title) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => handleSuggestionClick(title)}
                  className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-teal-300 hover:border-teal-500/40 transition cursor-pointer"
                >
                  {title}
                </button>
              ))}
            </div>
          </div>
        </form>

        {/* Live Search Progress & Telemetry Card */}
        {isSearching && searchProgress && (
          <div className="mt-5 rounded-2xl border border-teal-500/40 bg-slate-950/90 p-4 space-y-3 shadow-xl shadow-teal-950/30">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <Loader2 className="h-4 w-4 animate-spin text-teal-400 shrink-0" />
                <span className="font-bold text-white">
                  جاري فحص المصادر...
                </span>
                <span className="font-mono text-teal-300 font-bold bg-teal-500/15 border border-teal-500/30 px-2.5 py-0.5 rounded-lg">
                  المصادر المفحوصة: {searchProgress.completed} / {searchProgress.total}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-emerald-400 font-black bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 rounded-lg">
                  النتائج: {results.length}
                </span>
              </div>
            </div>

            {/* Current Source Name Indicator */}
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="truncate max-w-[320px] sm:max-w-md">
                المصدر الحالي: <strong className="text-white font-mono">{searchProgress.currentSource || "جاري البدء..."}</strong>
              </span>
              <span className="font-mono text-slate-400">
                {Math.round(((searchProgress.completed || 0) / Math.max(1, searchProgress.total || 1)) * 100)}%
              </span>
            </div>

            {/* Progress Bar */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-gradient-to-r from-teal-400 via-emerald-400 to-teal-300 transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.max(1, ((searchProgress.completed || 0) / Math.max(1, searchProgress.total || 1)) * 100))}%`
                }}
              />
            </div>
          </div>
        )}

        {/* Completed Search Telemetry Banner */}
        {!isSearching && completedStats && (
          <div className="mt-5 rounded-2xl border border-teal-500/40 bg-slate-900/90 p-4 sm:p-5 shadow-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <h4 className="font-bold text-sm sm:text-base text-white">
                  اكتمل البحث — تم فحص {completedStats.sourcesSearched} مصدرًا
                </h4>
              </div>
              {completedStats.durationMs > 0 && (
                <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                  <span>المدة: {(completedStats.durationMs / 1000).toFixed(1)} ثانية</span>
                  {completedStats.avgLatencyMs !== undefined && completedStats.avgLatencyMs > 0 && (
                    <span>متوسط الاستجابة: {completedStats.avgLatencyMs}ms</span>
                  )}
                </div>
              )}
            </div>

            {/* 4 Telemetry Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-center">
                <span className="text-[11px] text-emerald-300 block font-medium">المصادر الناجحة</span>
                <span className="text-base sm:text-xl font-black text-emerald-400 font-mono">{completedStats.successfulCount}</span>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-center">
                <span className="text-[11px] text-amber-300 block font-medium">لم تستجب (Timeout)</span>
                <span className="text-base sm:text-xl font-black text-amber-400 font-mono">{completedStats.timedOutCount}</span>
              </div>
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-center">
                <span className="text-[11px] text-rose-300 block font-medium">غير متاحة / Offline</span>
                <span className="text-base sm:text-xl font-black text-rose-400 font-mono">{completedStats.failedCount}</span>
              </div>
              <div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-2.5 text-center">
                <span className="text-[11px] text-teal-300 block font-medium">إجمالي النتائج</span>
                <span className="text-base sm:text-xl font-black text-teal-400 font-mono">{completedStats.totalResults}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Search Results Area */}
      {hasSearched && (
        <div className="flex flex-col gap-4">
          {/* Results Summary & Filter Bar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-3 sm:p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex h-2.5 w-2.5 rounded-full bg-teal-400 animate-ping" />
              <h3 className="text-sm sm:text-base font-bold text-white">
                نتائج البحث عن &quot;{searchQuery}&quot;
              </h3>
              <span className="rounded-lg bg-teal-500/20 px-2.5 py-0.5 text-xs font-bold text-teal-300 border border-teal-500/40">
                {filteredResults.length} عمل من {sourcesInResults.length} مصدر مختلف
              </span>
              {totalSourcesSearched > 0 && (
                <span className="text-xs text-slate-400">
                  (تم فحص {totalSourcesSearched} مصدر)
                </span>
              )}
            </div>

            {/* In-results filtering controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* View Mode Switcher */}
              <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer ${
                    viewMode === "grid"
                      ? "bg-teal-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title="عرض شبكي للبطاقات"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>الشبكة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("grouped")}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer ${
                    viewMode === "grouped"
                      ? "bg-teal-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title="تجميع حسب العمل ومقارنة المصادر الأكثر فصولاً"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>مقارنة المصادر</span>
                </button>
              </div>

              {/* Filter by title within results */}
              <div className="relative">
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="فلترة ضمن النتائج..."
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none w-32 sm:w-40"
                />
                {filterQuery && (
                  <button
                    type="button"
                    onClick={() => setFilterQuery("")}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Sorting Selector */}
              <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => setSortBy("chapters")}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    sortBy === "chapters" ? "bg-teal-500 text-slate-950 shadow-sm" : "text-slate-400 hover:text-white"
                  }`}
                  title="ترتيب تنازلي: المصادر التي تحتوي على أكثر فصول في البداية"
                >
                  <TrendingUp className="h-3 w-3" />
                  <span>الأكثر فصولاً أولاً</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy("relevance")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    sortBy === "relevance" ? "bg-teal-500 text-slate-950" : "text-slate-400 hover:text-white"
                  }`}
                  title="الأقرب للاسم"
                >
                  الأكثر تطابقاً
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy("source")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    sortBy === "source" ? "bg-teal-500 text-slate-950" : "text-slate-400 hover:text-white"
                  }`}
                  title="ترتيب حسب المصدر"
                >
                  حسب المصدر
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy("title")}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    sortBy === "title" ? "bg-teal-500 text-slate-950" : "text-slate-400 hover:text-white"
                  }`}
                  title="أبجدياً"
                >
                  أبجدياً
                </button>
              </div>
            </div>
          </div>

          {/* Sources Filter Chips - sorted with highest chapter counts first */}
          {sourcesInResults.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              <span className="text-xs text-slate-400 shrink-0 font-medium ml-1">المصادر (بالأكثر فصولاً):</span>
              <button
                type="button"
                onClick={() => setSelectedSourceFilter("all")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition shrink-0 cursor-pointer ${
                  selectedSourceFilter === "all"
                    ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20"
                    : "border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:border-slate-700"
                }`}
              >
                الكل ({results.length})
              </button>
              {sourcesInResults.map((src) => (
                <button
                  key={src.id || src.name}
                  type="button"
                  onClick={() => setSelectedSourceFilter(src.name)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition shrink-0 cursor-pointer ${
                    selectedSourceFilter === src.name
                      ? "bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20"
                      : "border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:border-slate-700"
                  }`}
                >
                  <span>{src.name}</span>
                  {src.maxChapters > 0 ? (
                    <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.2 text-[10px] text-emerald-300 font-mono font-bold">
                      {src.maxChapters} فصل
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.2 text-[10px] text-teal-300 font-mono">
                      {src.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Results Views: Empty State, Grouped Comparative View, or Grid View */}
          {filteredResults.length === 0 && !isSearching ? (
            <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-12 text-center text-slate-400">
              <AlertCircle className="mx-auto h-10 w-10 text-amber-400 mb-3" />
              <h4 className="text-base font-bold text-white mb-1">
                لم يتم العثور على أعمال مطابقة لـ &quot;{searchQuery}&quot;
              </h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
                تأكد من كتابة الاسم باللغة الإنجليزية أو العربية، أو جرب اختيار &quot;جميع اللغات والمصادر&quot;.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => executeFederatedSearch(searchQuery, "all")}
                  className="rounded-xl bg-teal-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-teal-400 transition cursor-pointer"
                >
                  إعادة المحاولة في جميع اللغات
                </button>
              </div>
            </div>
          ) : viewMode === "grouped" ? (
            /* Grouped View: Works grouped with ranked sources list ordered by chapter counts */
            <div className="flex flex-col gap-4">
              {groupedWorks.map((work) => {
                const topSource = work.sources[0];
                return (
                  <div
                    key={work.canonicalTitle}
                    className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl transition hover:border-slate-700"
                  >
                    <div className="flex flex-col md:flex-row items-stretch">
                      {/* Work cover and primary info */}
                      <div className="flex md:w-80 shrink-0 p-4 gap-3 bg-slate-950/50 border-b md:border-b-0 md:border-l border-slate-800">
                        <div className="relative aspect-[3/4] w-24 sm:w-28 shrink-0 overflow-hidden rounded-xl bg-slate-950 border border-slate-800 shadow-md">
                          <img
                            src={work.coverUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600"}
                            alt={work.canonicalTitle}
                            loading="lazy"
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600";
                            }}
                          />
                        </div>
                        <div className="flex flex-col justify-between py-0.5">
                          <div>
                            <h4 className="text-sm sm:text-base font-black text-white line-clamp-2">
                              {work.canonicalTitle}
                            </h4>
                            {work.author && (
                              <p className="text-xs text-slate-400 truncate mt-0.5">{work.author}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 mt-2">
                            <span className="inline-flex items-center gap-1 rounded-lg bg-teal-500/15 border border-teal-500/30 px-2 py-0.5 text-xs font-bold text-teal-300 w-fit">
                              <Layers className="h-3 w-3" />
                              <span>{work.sources.length} مصادر متصلة</span>
                            </span>
                            {work.maxChapters > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-black text-emerald-300 w-fit">
                                <Trophy className="h-3 w-3 text-amber-400" />
                                <span>أعلى عدد: {work.maxChapters} فصل</span>
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                onOpenManga({
                                  ...topSource,
                                  title: work.canonicalTitle,
                                  coverUrl: work.coverUrl,
                                  siblingSources: work.sources.map(s => ({
                                    id: s.id,
                                    rawId: s.rawId,
                                    sourceId: s.sourceId,
                                    sourceName: s.sourceName,
                                    sourceLanguage: s.sourceLanguage || s.language
                                  })),
                                  aggregateAll: true
                                });
                              }}
                              className="mt-1 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 px-2.5 py-1.5 text-xs font-black shadow-md transition cursor-pointer"
                              title="فحص فصول هذا العمل من كافة المصادر الحية بدون تكرار"
                            >
                              <Sparkles className="h-3.5 w-3.5 text-slate-950 shrink-0" />
                              <span className="whitespace-nowrap">فحص وتجميع الفصول ({work.sources.length} مصادر)</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Ranked Sources Table / List ordered by chapters descending */}
                      <div className="flex-1 p-3 sm:p-4 flex flex-col justify-center">
                        <div className="mb-2 flex items-center justify-between text-xs text-slate-400 font-bold border-b border-slate-800 pb-1.5">
                          <span>المصادر المتاحة لهذا العمل (مرتبة بالأكثر فصولاً):</span>
                          <span className="text-[11px] text-teal-400">انقر على أي مصدر لقراءة فصوله مباشرة</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                          {work.sources.map((manga, idx) => {
                            const isArabic = manga.sourceLanguage === "ar" || manga.language === "ar";
                            const isTop = idx === 0 && (manga.chaptersCount || 0) > 0;
                            return (
                              <div
                                key={`${manga.sourceId}-${manga.id}`}
                                onClick={() => onOpenManga(manga)}
                                className={`group flex items-center justify-between gap-2.5 rounded-xl border p-2.5 transition cursor-pointer ${
                                  isTop
                                    ? "border-emerald-500/50 bg-emerald-950/25 hover:bg-emerald-950/40 shadow-sm"
                                    : "border-slate-800 bg-slate-950/60 hover:border-teal-500/40 hover:bg-slate-900"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div
                                    className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs font-black shrink-0 ${
                                      idx === 0
                                        ? "bg-amber-400 text-slate-950 shadow-sm"
                                        : idx === 1
                                        ? "bg-slate-300 text-slate-950"
                                        : idx === 2
                                        ? "bg-amber-700 text-white"
                                        : "bg-slate-800 text-slate-400"
                                    }`}
                                  >
                                    {idx + 1}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-bold text-white group-hover:text-teal-300 truncate">
                                        {manga.sourceName}
                                      </span>
                                      {isArabic && (
                                        <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-300">
                                          عربي
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 text-[11px] font-bold text-slate-300 mt-0.5">
                                      <BookOpen className="h-3 w-3 text-teal-400" />
                                      <span>
                                        {manga.chaptersCount && manga.chaptersCount > 0
                                          ? `${manga.chaptersCount} فصل`
                                          : manga.latestChapter
                                          ? manga.latestChapter
                                          : (manga as any)._resolutionAttempted ? "? فصل" : "جاري العد..."}
                                      </span>
                                      {isTop && (
                                        <span className="text-[10px] text-amber-300 font-extrabold mr-1">
                                          (الأكثر فصولاً ⭐)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenManga(manga);
                                  }}
                                  className="flex items-center gap-1 rounded-lg bg-teal-500/20 hover:bg-teal-500 text-teal-300 hover:text-slate-950 px-2.5 py-1 text-[11px] font-bold transition shrink-0 border border-teal-500/40 cursor-pointer"
                                >
                                  <span>فتح</span>
                                  <ChevronRight className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Grid View: Cards with chapter count directly beneath cover photo, sorted by chapter count */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
              {filteredResults.map((manga) => {
                const isFav = isFavorite(manga.id, manga.title, manga.sourceId);
                const isArabic = manga.sourceLanguage === "ar" || manga.language === "ar";

                return (
                  <div
                    key={`${manga.sourceId}-${manga.id}`}
                    onClick={() => onOpenManga(manga)}
                    className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-md transition-all duration-300 hover:-translate-y-1.5 hover:border-teal-500/50 hover:shadow-2xl cursor-pointer"
                  >
                    {/* Favorite Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite({
                          id: manga.id,
                          sourceId: manga.sourceId,
                          sourceName: manga.sourceName,
                          title: manga.title,
                          coverUrl: manga.coverUrl,
                          author: manga.author,
                          status: manga.status,
                          description: manga.description
                        });
                      }}
                      title={isFav ? "إزالة من المفضلة" : "إضافة للمفضلة"}
                      className={`absolute top-2 left-2 z-20 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition shadow-md cursor-pointer ${
                        isFav
                          ? "bg-rose-600 text-white shadow-rose-600/50 scale-105"
                          : "bg-slate-950/70 text-slate-300 hover:text-rose-400 hover:bg-slate-900 border border-slate-750"
                      }`}
                    >
                      <Heart className={`h-3.5 w-3.5 ${isFav ? "fill-white text-white" : ""}`} />
                    </button>

                    {/* Source Badge on Cover (Top Right) */}
                    <div className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md bg-slate-950/85 px-2 py-0.5 text-[10px] font-bold backdrop-blur-md border border-slate-750 shadow-md">
                      <span className={`h-2 w-2 rounded-full ${isArabic ? "bg-emerald-400" : "bg-teal-400"}`} />
                      <span className="text-slate-200 truncate max-w-[90px]">{manga.sourceName}</span>
                    </div>

                    {/* Manga Cover Image */}
                    <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                      <img
                        src={manga.coverUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600"}
                        alt={manga.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600";
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-90" />

                      {/* Bottom Info inside Cover */}
                      <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-0.5">
                        <h4 className="font-display text-xs sm:text-sm font-bold text-white line-clamp-2 leading-tight drop-shadow-md">
                          {manga.title}
                        </h4>
                        {manga.author && manga.author !== "Unknown" && (
                          <p className="text-[10px] text-slate-400 truncate">
                            {manga.author}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Prominent Chapter Count Badge directly below the cover photo */}
                    <div className="mx-2 -mt-3 relative z-10 flex items-center justify-between rounded-xl bg-slate-950/95 border border-teal-500/40 px-2 py-1.5 shadow-lg backdrop-blur-md">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <BookOpen className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                        <span className="text-[11px] font-black text-white truncate">
                          {manga.chaptersCount && manga.chaptersCount > 0
                            ? `${manga.chaptersCount} فصل متوفر`
                            : manga.latestChapter
                            ? manga.latestChapter
                            : (manga as any)._resolutionAttempted ? "? فصل متوفر" : "جاري العد..."}
                        </span>
                      </div>
                      {manga.chaptersCount && manga.chaptersCount > 0 ? (
                        <span className="rounded bg-teal-500/20 border border-teal-500/30 px-1 py-0.2 text-[9px] font-mono font-bold text-teal-300 shrink-0">
                          {manga.chaptersCount} Ch
                        </span>
                      ) : null}
                    </div>

                    {/* Card Footer with Status, Source tags and Action Button */}
                    <div className="p-2.5 pt-2 bg-slate-950/90 border-t border-slate-800/80 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-[10px] font-medium text-slate-400">
                        <span className="truncate">
                          {manga.status && manga.status !== "UNKNOWN" ? (
                            <span className="text-emerald-400">● {manga.status}</span>
                          ) : (
                            <span className="text-slate-400 truncate">{manga.sourceName}</span>
                          )}
                        </span>
                        <span className="rounded bg-slate-850 px-1.5 py-0.5 text-[9px] font-mono text-slate-400 uppercase">
                          {manga.sourceLanguage || manga.language || "ALL"}
                        </span>
                      </div>

                      {/* Open chapters button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenManga(manga);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-teal-500/15 hover:bg-teal-500 text-teal-300 hover:text-slate-950 py-2 px-2 text-xs font-bold transition duration-200 border border-teal-500/30 cursor-pointer shadow-xs"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>فتح فصول {manga.sourceName}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Custom Source Modal */}
      <AddCustomSourceModal
        isOpen={showAddCustomSourceModal}
        onClose={() => setShowAddCustomSourceModal(false)}
        onSourceAdded={() => {
          if (searchQuery.trim()) {
            executeFederatedSearch(searchQuery, activeLang);
          }
        }}
      />
    </div>
  );
}
