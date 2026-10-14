import React, { useState } from "react";
import { X, Plus, Globe, Loader2 } from "lucide-react";

interface AddCustomSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSourceAdded?: (source?: any) => void;
}

export default function AddCustomSourceModal({
  isOpen,
  onClose,
  onSourceAdded,
}: AddCustomSourceModalProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState("ar");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/suwayomi/custom-sources/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || url.trim(), url: url.trim(), lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "تعذر إضافة المصدر");
      }
      if (onSourceAdded) onSourceAdded(data.source || data);
      setName("");
      setUrl("");
      onClose();
    } catch (err: any) {
      setError(err?.message || "حدث خطأ أثناء إضافة المصدر");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-6 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-emerald-400" />
            <h3 className="text-base font-bold">إضافة مصدر مانجا مخصص</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs text-neutral-400">اسم الموقع / المصدر</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: MangaLek"
              className="w-full rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-neutral-400">رابط الموقع (URL)</label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-neutral-400">اللغة</label>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="ar">العربية (ar)</option>
              <option value="en">English (en)</option>
              <option value="all">متعدد اللغات (all)</option>
            </select>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs text-neutral-300 hover:bg-white/5"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span>إضافة المصدر</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
