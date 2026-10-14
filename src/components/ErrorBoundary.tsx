import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
    error: null,
  };

  constructor(props: Props) {
    super(props);
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const msg = error?.message || "";
    if (
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Importing a module script failed") ||
      msg.includes("Unable to preload CSS")
    ) {
      try {
        const key = "chunk_reload_ts";
        const lastReload = Number(sessionStorage.getItem(key) || "0");
        if (Date.now() - lastReload > 5000) {
          sessionStorage.setItem(key, String(Date.now()));
          const url = new URL(window.location.href);
          url.searchParams.set("_v", String(Date.now()));
          window.location.replace(url.toString());
          return;
        }
      } catch (_) {
        window.location.reload();
        return;
      }
      return;
    }
    console.error("[ErrorBoundary] Uncaught application error:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetCache = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn("Could not clear storage", e);
    }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans"
        >
          <div className="max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl text-center flex flex-col items-center">
            <div className="h-16 w-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-5">
              <AlertTriangle className="h-8 w-8" />
            </div>

            <h1 className="font-display text-xl sm:text-2xl font-bold text-white mb-2">
              حدث خطأ أثناء تحميل واجهة التطبيق
            </h1>
            
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
              حدثت مشكلة غير متوقعة أثناء معالجة الصفحة. يمكنك محاولة إعادة تحميل الصفحة أو إعادة ضبط الذاكرة المؤقتة.
            </p>

            {this.state.error && (
              <div className="w-full mb-6 text-left dir-ltr bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-xs font-mono text-red-400/90 max-h-24 overflow-y-auto select-all">
                {this.state.error.message || "Unknown error"}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition shadow-lg shadow-emerald-950/40 cursor-pointer"
              >
                <RefreshCw className="h-4 w-4" />
                إعادة التحميل
              </button>

              <button
                type="button"
                onClick={this.handleResetCache}
                className="flex-1 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition border border-slate-700 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                مسح الذاكرة وإعادة البدء
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
