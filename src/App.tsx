import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import Navbar from "./components/Navbar";
import MobileBottomNav from "./components/MobileBottomNav";
import { globalEngine } from "./lib/mangaGlobalEngine";
import { saveLocalManga, getAllLocalMangas, deleteLocalManga, clearAllLocalMangas, LocalManga } from "./lib/db";
import { MangaChapter } from "./lib/mangaGlobalEngine";
import { TARGET_LANGUAGES, Language, DEFAULT_MANGA_COVER } from "./types";
import { 
  Sparkles, Loader2, BookOpen, Trash2, ArrowLeft, ArrowRight,
  Plus, Upload, FileText, FolderArchive, Image as ImageIcon,
  CheckCircle, ChevronLeft, ChevronRight, Bookmark, HelpCircle,
  Clock, Check, AlertCircle
} from "lucide-react";
import { markChapterAsViewed } from "./lib/viewedChapters";
import JSZip from "jszip";
import SuwayomiHub from "./components/SuwayomiHub";

const ReaderPage = lazy(() => import("./components/ReaderPage"));
const SettingsPage = lazy(() => import("./components/SettingsPage"));
const Favorites = lazy(() => import("./components/Favorites"));
const MangaDetails = lazy(() => import("./components/MangaDetails"));
const ExtensionsPage = lazy(() => import("./components/ExtensionsPage"));
const GeminiTTSStudio = lazy(() => import("./gemini-tts/GeminiTTSStudio"));
const VideoDubbingPage = lazy(() =>
  import("./components/video-dubbing/VideoDubbingPage").then((m) => ({ default: m.VideoDubbingPage }))
);
const ManhwaVideoPage = lazy(() => import("./components/manhwa-video/ManhwaVideoPage"));
const NovelToMangaPage = lazy(() => import("./components/novel-to-manga/NovelToMangaPage"));

// Sleek zero-jank loading fallback for view transitions
function ViewLoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] w-full p-8 text-center select-none" dir="rtl">
      <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 mb-3 animate-pulse">
        <Loader2 className="h-7 w-7 text-emerald-400 animate-spin" />
      </div>
      <span className="text-xs text-slate-400 font-semibold">جاري التحميل الفوري...</span>
    </div>
  );
}

// Dynamically load PDF.js from a CDN for robust client-side PDF rendering
const loadPdfJS = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js";
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
      resolve(pdfjsLib);
    };
    script.onerror = () => reject(new Error("Failed to load PDF.js from CDN"));
    document.head.appendChild(script);
  });
};

export default function App() {
  const [currentView, setCurrentView] = useState<"catalogue" | "studio" | "favorites" | "library" | "details" | "source_details" | "reader" | "settings" | "extensions" | "history" | "gemini-tts" | "video-dubbing" | "manhwa-video" | "novel-to-manga">("catalogue");
  const [previousView, setPreviousView] = useState<string>("catalogue");
  
  // Chapter & Manga context for Video Creation Studio (🎬 إنشاء فيديوهات المانهاوا)
  const [videoChapterContext, setVideoChapterContext] = useState<{
    chapter: any;
    manga?: any;
  } | null>(null);
  
  // Catalogue selection state
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  
  // Local Upload states
  const [activeUploadTab, setActiveUploadTab] = useState<"unified" | "zip" | "pdf" | "images">("unified");
  const [customTitle, setCustomTitle] = useState<string>("");
  const [uploadedPages, setUploadedPages] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractionStatus, setExtractionStatus] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // File input refs for programmatic clearing
  const zipInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  const unifiedInputRef = useRef<HTMLInputElement>(null);
  
  // Work Type (نوع العمل) selection states
  const [selectedWorkType, setSelectedWorkType] = useState<string>("مانهوا كورية");
  const [isCustomWorkType, setIsCustomWorkType] = useState<boolean>(false);
  const [customWorkTypeInput, setCustomWorkTypeInput] = useState<string>("");

  // IndexedDB custom manga library
  const [localMangas, setLocalMangas] = useState<LocalManga[]>([]);
  const [targetLang, setTargetLang] = useState<Language>(TARGET_LANGUAGES[0]); // Default to Arabic

  // Reader Selection state
  const [selectedChapter, setSelectedChapter] = useState<{
    id: string;
    title: string;
    chapter: string;
    pages?: string[];
    isLocal?: boolean;
    workType?: string;
    mangaTitle?: string;
    sourceId?: string;
    language?: string;
  } | null>(null);
  const [selectedMangaId, setSelectedMangaId] = useState<string | null>(null);
  const [selectedMangaObj, setSelectedMangaObj] = useState<any | null>(null);

  // Global cross-source search state
  const [navSearchQuery, setNavSearchQuery] = useState<string>("");
  const [activeSearchQuery, setActiveSearchQuery] = useState<string>("");

  const handleNavSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (navSearchQuery.trim()) {
      setActiveSearchQuery(navSearchQuery.trim());
      setCurrentView("catalogue");
    }
  };

  // Load local manga list on mount
  const loadLocalLibrary = async () => {
    const list = await getAllLocalMangas();
    setLocalMangas(list);
  };

  useEffect(() => {
    loadLocalLibrary();
  }, []);

  // Handle Drag-And-Drop / File selection for ZIP files
  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setIsExtracting(true);
      let allExtractedDataUrls: string[] = [];
      let baseTitle = "";

      // Sort files naturally by name
      const filesArray = (Array.from(files) as File[]).sort((a, b) => 
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );

      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        if (i === 0) baseTitle = file.name.replace(/\.[^/.]+$/, "");
        
        setExtractionStatus(`جاري قراءة ملف الـ ZIP (${i + 1}/${filesArray.length})...`);
        
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        const filePromises: { name: string; promise: Promise<string> }[] = [];

        loadedZip.forEach((relativePath, zipEntry) => {
          // Support common image extensions
          if (!zipEntry.dir && /\.(png|jpe?g|webp|gif|bmp)$/i.test(zipEntry.name)) {
            const promise = zipEntry.async("base64").then((base64) => {
              const ext = zipEntry.name.split(".").pop() || "jpeg";
              const mime = ext === "jpg" ? "jpeg" : ext.toLowerCase();
              return `data:image/${mime};base64,${base64}`;
            });
            filePromises.push({ name: zipEntry.name, promise });
          }
        });

        if (filePromises.length > 0) {
          const extractedFiles = await Promise.all(
            filePromises.map(async (item) => ({
              name: item.name,
              dataUrl: await item.promise,
            }))
          );

          // Natural alphanumeric sort of files to preserve page order
          extractedFiles.sort((a, b) => 
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
          );

          allExtractedDataUrls.push(...extractedFiles.map((f) => f.dataUrl));
        }
      }

      if (allExtractedDataUrls.length === 0) {
        throw new Error("لم يتم العثور على أي ملفات صور صالحة داخل ملفات الـ ZIP!");
      }

      setUploadedPages((prev) => [...prev, ...allExtractedDataUrls]);
      
      // Auto fill title from file name
      setCustomTitle((prev) => prev || (filesArray.length > 1 ? `${baseTitle} والمزيد` : baseTitle));

    } catch (error: any) {
      console.error("ZIP Error:", error);
      alert(error.message || "فشل استخراج ملف الـ ZIP. تأكد من سلامة الملف وصيغة الصور داخله.");
    } finally {
      setIsExtracting(false);
      setExtractionStatus("");
    }
  };

  // Handle Drag-And-Drop / File selection for PDF files
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setIsExtracting(true);
      setExtractionStatus("جاري تحميل أستوديو الـ PDF الذكي...");
      const pdfjsLib = await loadPdfJS();

      let allPagesList: string[] = [];
      let baseTitle = "";

      // Sort files naturally by name
      const filesArray = (Array.from(files) as File[]).sort((a, b) => 
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );

      for (let fIdx = 0; fIdx < filesArray.length; fIdx++) {
        const file = filesArray[fIdx];
        if (fIdx === 0) baseTitle = file.name.replace(/\.[^/.]+$/, "");

        setExtractionStatus(`جاري فك تشفير مستند الـ PDF (${fIdx + 1}/${filesArray.length})...`);
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdf.numPages;

        for (let i = 1; i <= numPages; i++) {
          setExtractionStatus(`الملف ${fIdx + 1}: جاري تحويل ومعالجة الصفحة ${i} من أصل ${numPages}...`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 }); // Use high quality scale
          
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (context) {
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: context, viewport }).promise;
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85); // Compress lightly for speed and memory
            allPagesList.push(dataUrl);
          }
        }
      }

      if (allPagesList.length === 0) {
        throw new Error("فشل تحويل صفحات الـ PDF إلى صور صالحة.");
      }

      setUploadedPages((prev) => [...prev, ...allPagesList]);
      
      // Auto fill title from file name
      setCustomTitle((prev) => prev || (filesArray.length > 1 ? `${baseTitle} والمزيد` : baseTitle));

    } catch (error: any) {
      console.error("PDF Error:", error);
      alert(error.message || "فشل معالجة مستند الـ PDF. يرجى محاولة ملف آخر.");
    } finally {
      setIsExtracting(false);
      setExtractionStatus("");
    }
  };

  // Handle Drag-And-Drop / File selection for manual image select
  const handleImagesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setIsExtracting(true);
      setExtractionStatus("جاري قراءة الصور المحددة...");

      const promises = Array.from(files).map((file: File) => {
        return new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              name: file.name,
              dataUrl: reader.result as string,
            });
          };
          reader.onerror = () => reject(new Error(`فشل قراءة الملف ${file.name}`));
          reader.readAsDataURL(file);
        });
      });

      const results = await Promise.all(promises);

      // Sort naturally by filename
      results.sort((a, b) => 
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
      );

      setUploadedPages((prev) => [...prev, ...results.map((r) => r.dataUrl)]);
      if (!customTitle) {
        setCustomTitle("مجموعة صفحات مخصصة");
      }
    } catch (error: any) {
      console.error("Images Error:", error);
      alert(error.message || "فشل قراءة الصور المحددة.");
    } finally {
      setIsExtracting(false);
      setExtractionStatus("");
    }
  };

  // Move page in custom pages list
  const movePage = (index: number, direction: "prev" | "next") => {
    if (direction === "prev" && index > 0) {
      const copy = [...uploadedPages];
      const temp = copy[index];
      copy[index] = copy[index - 1];
      copy[index - 1] = temp;
      setUploadedPages(copy);
    } else if (direction === "next" && index < uploadedPages.length - 1) {
      const copy = [...uploadedPages];
      const temp = copy[index];
      copy[index] = copy[index + 1];
      copy[index + 1] = temp;
      setUploadedPages(copy);
    }
  };

  // Delete page in custom pages list
  const deletePage = (index: number) => {
    setUploadedPages((prev) => prev.filter((_, i) => i !== index));
  };

  // Clear all uploaded files in one click (زر سلة المهملات 🗑️)
  const handleClearAllUploadedFiles = () => {
    if (uploadedPages.length === 0 && !customTitle) {
      setToastMessage("لا توجد ملفات مرفوعة حالياً 🗑️");
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    const count = uploadedPages.length;
    setUploadedPages([]);
    setCustomTitle("");
    setExtractionStatus("");
    setIsExtracting(false);

    // Reset native file inputs
    if (zipInputRef.current) zipInputRef.current.value = "";
    if (pdfInputRef.current) pdfInputRef.current.value = "";
    if (imagesInputRef.current) imagesInputRef.current.value = "";
    if (unifiedInputRef.current) unifiedInputRef.current.value = "";

    setToastMessage(`تم حذف جميع الملفات المرفوعة (${count} صفحة) دفعة واحدة بنجاح 🗑️`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const clearActiveUpload = () => {
    handleClearAllUploadedFiles();
  };

  // Unified File Processor supporting ZIP, PDF, and Images all at once
  const processUnifiedFiles = async (filesArray: File[]) => {
    if (filesArray.length === 0) return;
    setIsExtracting(true);
    setExtractionStatus("جاري فحص وتصنيف الملفات المرفوعة...");

    try {
      const zips = filesArray.filter((f) => /\.zip$/i.test(f.name) || /\.cbz$/i.test(f.name));
      const pdfs = filesArray.filter((f) => /\.pdf$/i.test(f.name));
      const images = filesArray.filter((f) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name) || f.type.startsWith("image/"));

      if (zips.length === 0 && pdfs.length === 0 && images.length === 0) {
        throw new Error("يرجى اختيار ملفات مدعومة: ZIP أو PDF أو صور (PNG, JPG, WebP)");
      }

      let newExtractedUrls: string[] = [];
      let baseTitle = "";

      // 1. Process ZIP files
      for (let i = 0; i < zips.length; i++) {
        const zipFile = zips[i];
        if (!baseTitle) baseTitle = zipFile.name.replace(/\.[^/.]+$/, "");
        setExtractionStatus(`جاري فك ضغط ملف الـ ZIP (${i + 1}/${zips.length}): ${zipFile.name}...`);
        
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(zipFile);
        const filePromises: { name: string; promise: Promise<string> }[] = [];

        loadedZip.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir && /\.(png|jpe?g|webp|gif|bmp)$/i.test(zipEntry.name)) {
            const promise = zipEntry.async("base64").then((base64) => {
              const ext = zipEntry.name.split(".").pop() || "jpeg";
              const mime = ext === "jpg" ? "jpeg" : ext.toLowerCase();
              return `data:image/${mime};base64,${base64}`;
            });
            filePromises.push({ name: zipEntry.name, promise });
          }
        });

        const extracted = await Promise.all(
          filePromises.map(async (item) => ({
            name: item.name,
            dataUrl: await item.promise,
          }))
        );
        extracted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
        newExtractedUrls.push(...extracted.map((e) => e.dataUrl));
      }

      // 2. Process PDF files
      for (let i = 0; i < pdfs.length; i++) {
        const pdfFile = pdfs[i];
        if (!baseTitle) baseTitle = pdfFile.name.replace(/\.[^/.]+$/, "");
        setExtractionStatus(`جاري معالجة صفحات مستند الـ PDF (${i + 1}/${pdfs.length}): ${pdfFile.name}...`);
        
        const pdfjsLib = await loadPdfJS();
        const arrayBuffer = await pdfFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageIndices = Array.from({ length: pdf.numPages }, (_, idx) => idx + 1);

        for (const pageNum of pageIndices) {
          setExtractionStatus(`جاري تحويل صفحة PDF رقم (${pageNum}/${pdf.numPages})...`);
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          if (context) {
            await page.render({ canvasContext: context, viewport }).promise;
            newExtractedUrls.push(canvas.toDataURL("image/jpeg", 0.9));
          }
        }
      }

      // 3. Process Images
      if (images.length > 0) {
        if (!baseTitle) baseTitle = images[0].name.replace(/\.[^/.]+$/, "");
        setExtractionStatus(`جاري قراءة الصور (${images.length} صورة)...`);
        const imagePromises = images.map((file) => {
          return new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, dataUrl: reader.result as string });
            reader.onerror = () => reject(new Error(`فشل قراءة الملف ${file.name}`));
            reader.readAsDataURL(file);
          });
        });
        const readImages = await Promise.all(imagePromises);
        readImages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
        newExtractedUrls.push(...readImages.map((img) => img.dataUrl));
      }

      if (newExtractedUrls.length === 0) {
        throw new Error("لم يتم العثور على صفحات صور صالحة في الملفات المحددة.");
      }

      setUploadedPages((prev) => [...prev, ...newExtractedUrls]);
      if (baseTitle) {
        setCustomTitle((prev) => prev || baseTitle);
      }
      setToastMessage(`تم استخراج ورفع ${newExtractedUrls.length} صفحة بنجاح ✨`);
      setTimeout(() => setToastMessage(null), 3500);
    } catch (err: any) {
      console.error("Unified Upload Error:", err);
      alert(err.message || "حدث خطأ أثناء معالجة الملفات المرفوعة.");
    } finally {
      setIsExtracting(false);
      setExtractionStatus("");
    }
  };

  // Launch Reader and automatically save to IndexedDB local database
  const startReading = async () => {
    if (uploadedPages.length === 0) {
      alert("يرجى رفع أو استخراج بعض صفحات المانغا أولاً!");
      return;
    }

    const finalTitle = customTitle.trim() || "مانغا مخصصة مرفوعة";
    const mangaId = `local-${Date.now()}`;
    const effectiveWorkType = isCustomWorkType ? (customWorkTypeInput.trim() || "عمل مخصص") : selectedWorkType;

    // Create custom local manga record
    const newManga: LocalManga = {
      id: mangaId,
      title: finalTitle,
      coverUrl: uploadedPages[0], // First page as the thumbnail cover
      pages: uploadedPages,
      workType: effectiveWorkType,
      createdAt: Date.now(),
    };

    // Save to browser's high capacity IndexedDB
    await saveLocalManga(newManga);
    await loadLocalLibrary();

    // Prepare selection chapter for ReaderPage component
    setSelectedChapter({
      id: mangaId,
      title: finalTitle,
      chapter: "1",
      pages: uploadedPages,
      isLocal: true,
      workType: effectiveWorkType,
    });
    setSelectedMangaId(mangaId);
    setCurrentView("reader");
  };

  // Read saved local manga from the shelf
  const readSavedManga = (manga: LocalManga) => {
    setSelectedChapter({
      id: manga.id,
      title: manga.title,
      chapter: "1",
      pages: manga.pages,
      isLocal: true,
      workType: manga.workType || "مانهوا كورية",
    });
    setSelectedMangaId(manga.id);
    setCurrentView("reader");
  };

  // Remove saved manga from IndexedDB
  const deleteSavedManga = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await deleteLocalManga(id);
    await loadLocalLibrary();
  };

  // Clear all saved manga from IndexedDB
  const deleteAllSavedMangas = async () => {
    await clearAllLocalMangas();
    await loadLocalLibrary();
  };

  // Catalogue and Source Details actions
  const handleMangaSelect = (sourceId: string, mangaId: string) => {
    setSelectedSourceId(sourceId);
    setSelectedMangaId(mangaId);
    setCurrentView("details");
  };

  const [isFetchingPages, setIsFetchingPages] = useState(false);
  const [fetchPagesTimeoutLeft, setFetchPagesTimeoutLeft] = useState(20);
  const [fetchErrorState, setFetchErrorState] = useState<{
    message: string;
    chapter: MangaChapter;
    sourceId: string;
    mangaId: string;
  } | null>(null);

  const abortControllerRef = React.useRef<AbortController | null>(null);

  const handleReadChapter = async (chapter: MangaChapter, sourceId: string, mangaId: string) => {
    setFetchErrorState(null);
    setIsFetchingPages(true);
    setFetchPagesTimeoutLeft(30);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Countdown interval
    const interval = setInterval(() => {
      setFetchPagesTimeoutLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Timeout promise (30 seconds)
    const timeoutPromise = new Promise<string[]>((_, reject) => {
      setTimeout(() => reject(new Error("TIMEOUT")), 30000);
    });

    try {
      setSelectedMangaId(mangaId || chapter.id);

      const pages = await Promise.race([
        globalEngine.fetchChapterPages(chapter.id, sourceId),
        timeoutPromise
      ]);

      clearInterval(interval);

      if (pages && pages.length > 0) {
        setSelectedChapter({
          id: chapter.id,
          title: chapter.title,
          chapter: chapter.chapterNumber,
          pages: pages,
          isLocal: false,
          workType: selectedWorkType
        });
        setCurrentView("reader");
      } else {
        setFetchErrorState({
          message: "لم يتم العثور على صفحات لهذا الفصل في المصدر الحالي.",
          chapter,
          sourceId,
          mangaId
        });
      }
    } catch (error: any) {
      clearInterval(interval);
      console.error("[ReadChapter] Error:", error);
      const isTimeout = error?.message === "TIMEOUT";
      setFetchErrorState({
        message: isTimeout 
          ? "استغرق جلب الصفحات أكثر من 20 ثانية ولم يستجب خادم المصدر." 
          : "تعذر فتح هذا الفصل عبر المصدر الحالي أو تم قطع نفق الاتصال.",
        chapter,
        sourceId,
        mangaId
      });
    } finally {
      clearInterval(interval);
      setIsFetchingPages(false);
    }
  };

  const cancelFetchingPages = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsFetchingPages(false);
  };

  const handlePullChapter = (
    pages: string[],
    chapterInfo: { id: string; title: string; chapterNumber: string; mangaTitle?: string; mangaId?: string; pageCount?: number },
    target: "reader" | "studio"
  ) => {
    // Record chapter as viewed
    markChapterAsViewed(
      chapterInfo.mangaId || "",
      chapterInfo.id,
      chapterInfo.chapterNumber,
      chapterInfo.mangaTitle
    );

    if (target === "reader") {
      setSelectedMangaId(chapterInfo.mangaId || chapterInfo.id);
      setSelectedChapter({
        id: chapterInfo.id,
        title: chapterInfo.title,
        chapter: chapterInfo.chapterNumber,
        pages: pages,
        isLocal: false,
        mangaTitle: chapterInfo.mangaTitle,
        workType: selectedWorkType
      });
      setCurrentView("reader");
    } else {
      // Transfer pages to AI translation studio
      setUploadedPages(pages);
      setCustomTitle(`${chapterInfo.mangaTitle || "عمل"} - ${chapterInfo.title}`);
      setCurrentView("studio");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-300">
      
      {/* Loading overlay for pages fetch with 20s timeout and cancel */}
      {isFetchingPages && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-md px-4" dir="rtl">
          <div className="flex flex-col items-center max-w-md w-full p-6 rounded-2xl bg-slate-900/90 border border-teal-500/30 shadow-2xl text-center">
            <Loader2 className="h-12 w-12 animate-spin text-teal-400 mb-4" />
            <h3 className="text-lg font-bold text-white mb-2">جلب صفحات المانجا وبناء نفق العرض...</h3>
            <p className="text-slate-400 text-xs mb-4">
              يتم استخراج الروابط وتجهيز نفق البروكسي الآمن لعرض الصفحات
            </p>
            <div className="w-full bg-slate-800 rounded-full h-2 mb-4 overflow-hidden">
              <div 
                className="bg-teal-400 h-2 transition-all duration-1000 rounded-full"
                style={{ width: `${(fetchPagesTimeoutLeft / 20) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between w-full text-xs font-mono text-teal-300/90 mb-5">
              <span>المهلة الزمنية القصوى:</span>
              <span>{fetchPagesTimeoutLeft} ثانية متبقية</span>
            </div>
            <button
              onClick={cancelFetchingPages}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-bold transition border border-slate-700 cursor-pointer"
            >
              إلغاء الطلب والعودة
            </button>
          </div>
        </div>
      )}

      {/* Error state modal with Retry & Back */}
      {fetchErrorState && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-md px-4" dir="rtl">
          <div className="flex flex-col items-center max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-rose-500/40 shadow-2xl shadow-rose-950/30 text-center">
            <div className="p-3 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 mb-4">
              <AlertCircle className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">تعذر فتح هذا الفصل عبر المصدر الحالي</h3>
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              {fetchErrorState.message}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 w-full">
              <button
                onClick={() => {
                  const state = fetchErrorState;
                  setFetchErrorState(null);
                  handleReadChapter(state.chapter, state.sourceId, state.mangaId);
                }}
                className="flex-1 py-3 px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-sm font-extrabold transition shadow-lg shadow-teal-500/20 cursor-pointer"
              >
                إعادة المحاولة (Retry)
              </button>
              <button
                onClick={() => setFetchErrorState(null)}
                className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-sm font-semibold transition border border-slate-700 cursor-pointer"
              >
                العودة للخلف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent Navigation header */}
      <Navbar
        currentView={currentView === "source_details" ? "catalogue" : currentView}
        onViewChange={(view) => {
          setCurrentView(view);
        }}
        searchQuery={navSearchQuery}
        onSearchChange={setNavSearchQuery}
        onSearchSubmit={handleNavSearchSubmit}
      />

      {/* Main Content Area */}
      <main className="pb-24">
        
        {currentView === "catalogue" && (
          <SuwayomiHub 
            initialTab="sources"
            initialSearchQuery={activeSearchQuery}
            onOpenStudio={() => setCurrentView("studio")}
            onPullChapter={handlePullChapter}
          />
        )}

        {currentView === "studio" && (
          <div>
            
            {/* Top Branding Section */}
            <div className="relative w-full h-[220px] sm:h-[280px] bg-slate-950 overflow-hidden flex items-center border-b border-slate-900/40">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/20 via-slate-950 to-teal-950/20" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-teal-500/10 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/45 to-transparent" />
              
              <div className="absolute inset-0 flex items-center">
                <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center" dir="rtl">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 tracking-wider font-mono uppercase bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20 mb-4 animate-pulse">
                    <Sparkles className="h-4 w-4" />
                    أستوديو ترجمة المانغا بالذكاء الاصطناعي الفوري
                  </span>

                  <h1 className="font-display text-3xl sm:text-5xl font-extrabold text-white tracking-tight drop-shadow-md">
                    مرحباً بك في <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">AI Manga Studio</span>
                  </h1>
                  
                  <p className="mt-3 text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
                    قم برفع صفحات المانغا المفضلة لديك كملف ZIP أو PDF أو صور يدوية مبعثرة، وسيقوم الذكاء الاصطناعي (Gemini OCR) بالتعرف على فقاعات المحادثة وترجمتها فوراً للغتك مع قارئ ناطق احترافي!
                  </p>
                </div>
              </div>
            </div>

            {/* Core Workspace & Studio Container */}
            <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" dir="rtl">
              
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Right: Studio upload form */}
                <div className="lg:col-span-8 bg-slate-900/40 border border-slate-900 p-6 rounded-2xl shadow-xl flex flex-col gap-6">
                  
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                        <Upload className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-display text-lg font-bold text-white">قسم مخصص لرفع الملفات (ZIP • PDF • صور)</h2>
                        <p className="text-xs text-slate-400">يدعم السحب والإفلات أو التحديد المباشر لملفات الأرشيف، المستندات، ومجموعات الصور</p>
                      </div>
                    </div>
                    {uploadedPages.length > 0 && (
                      <button 
                        type="button"
                        onClick={handleClearAllUploadedFiles}
                        className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-red-950/40 border border-red-500/30 px-3 py-1.5 rounded-xl font-bold transition cursor-pointer"
                        title="حذف جميع الملفات المرفوعة"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>🗑️ حذف الكل</span>
                      </button>
                    )}
                  </div>

                  {/* Toast notification if present */}
                  {toastMessage && (
                    <div className="p-3 rounded-xl bg-teal-950/80 border border-teal-500/40 text-teal-200 text-xs font-bold flex items-center justify-between animate-in fade-in">
                      <span>{toastMessage}</span>
                      <button type="button" onClick={() => setToastMessage(null)} className="text-teal-400 hover:text-white">✕</button>
                    </div>
                  )}

                  {/* Upload Form Tab Selectors */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => setActiveUploadTab("unified")}
                      className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                        activeUploadTab === "unified" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <Sparkles className="h-4 w-4 text-emerald-400" />
                      <span>رفع شامل (الكل)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveUploadTab("zip")}
                      className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                        activeUploadTab === "zip" ? "bg-slate-800 text-emerald-400 border border-slate-700" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <FolderArchive className="h-4 w-4" />
                      <span>ملفات ZIP</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveUploadTab("pdf")}
                      className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                        activeUploadTab === "pdf" ? "bg-slate-800 text-emerald-400 border border-slate-700" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <FileText className="h-4 w-4" />
                      <span>ملف PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveUploadTab("images")}
                      className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                        activeUploadTab === "images" ? "bg-slate-800 text-emerald-400 border border-slate-700" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <ImageIcon className="h-4 w-4" />
                      <span>صور مجمعة</span>
                    </button>
                  </div>

                  {/* Extraction Logging Indicator */}
                  {isExtracting && (
                    <div className="flex flex-col items-center justify-center gap-3 p-8 border border-emerald-500/20 bg-emerald-500/5 rounded-2xl animate-pulse">
                      <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
                      <p className="text-xs font-mono text-slate-300">{extractionStatus}</p>
                    </div>
                  )}

                  {/* Dynamic Tab Panes */}
                  {!isExtracting && uploadedPages.length === 0 && (
                    <div 
                      className="relative"
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                          processUnifiedFiles(Array.from(e.dataTransfer.files));
                        }
                      }}
                    >
                      {activeUploadTab === "unified" && (
                        <label className={`flex flex-col items-center justify-center h-56 border-2 border-dashed rounded-2xl cursor-pointer transition p-6 text-center ${
                          isDragOver 
                            ? "border-emerald-400 bg-emerald-500/10 scale-[1.01]" 
                            : "border-slate-800 hover:border-emerald-500/50 bg-slate-950/40"
                        }`}>
                          <div className="flex items-center gap-3 mb-3">
                            <FolderArchive className="h-8 w-8 text-amber-400" />
                            <FileText className="h-8 w-8 text-rose-400" />
                            <ImageIcon className="h-8 w-8 text-teal-400" />
                          </div>
                          <span className="text-sm font-bold text-white">
                            {isDragOver ? "أفلت الملفات الآن للرفع التلقائي..." : "اسحب وأفلت أي ملفات (ZIP أو PDF أو صور) هنا"}
                          </span>
                          <span className="text-xs text-slate-400 mt-2 max-w-md leading-relaxed">
                            يدعم رفع ملفات ZIP المضغوطة، مستندات PDF، أو صور متعددة (PNG, JPG, WebP) دفعة واحدة مع ترتيب تلقائي للصفحات.
                          </span>
                          <span className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/30 transition">
                            <Upload className="h-3.5 w-3.5" />
                            <span>تصفح واختيار الملفات من جهازك</span>
                          </span>
                          <input 
                            ref={unifiedInputRef}
                            type="file" 
                            accept=".zip,.cbz,.pdf,image/*"
                            multiple 
                            onChange={(e) => {
                              if (e.target.files) processUnifiedFiles(Array.from(e.target.files));
                            }}
                            className="hidden" 
                          />
                        </label>
                      )}

                      {activeUploadTab === "zip" && (
                        <label className="flex flex-col items-center justify-center h-52 border-2 border-dashed border-slate-800 hover:border-emerald-500/50 bg-slate-950/40 rounded-2xl cursor-pointer transition p-6 text-center">
                          <FolderArchive className="h-10 w-10 text-emerald-400 mb-3" />
                          <span className="text-sm font-bold text-white">اختر ملف ZIP أو CBZ للمانغا</span>
                          <span className="text-xs text-slate-500 mt-2 max-w-xs leading-relaxed">
                            تأكد أن الملف يحتوي على صور صفحات المانغا مرتبة، وسيقوم النظام بفكها وترتيبها تلقائياً.
                          </span>
                          <span className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/30 transition">
                            <Upload className="h-3.5 w-3.5" />
                            <span>تحديد ملف الـ ZIP</span>
                          </span>
                          <input 
                            ref={zipInputRef}
                            type="file" 
                            accept=".zip,.cbz"
                            multiple 
                            onChange={handleZipUpload}
                            className="hidden" 
                          />
                        </label>
                      )}

                      {activeUploadTab === "pdf" && (
                        <label className="flex flex-col items-center justify-center h-52 border-2 border-dashed border-slate-800 hover:border-emerald-500/50 bg-slate-950/40 rounded-2xl cursor-pointer transition p-6 text-center">
                          <FileText className="h-10 w-10 text-emerald-400 mb-3" />
                          <span className="text-sm font-bold text-white">اختر ملف PDF للمانغا</span>
                          <span className="text-xs text-slate-500 mt-2 max-w-xs leading-relaxed">
                            سيقوم محول الـ PDF المدمج بتحويل صفحات المستند إلى صور عالية الدقة داخل المتصفح مباشرة.
                          </span>
                          <span className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/30 transition">
                            <Upload className="h-3.5 w-3.5" />
                            <span>تحديد مستند PDF</span>
                          </span>
                          <input 
                            ref={pdfInputRef}
                            type="file" 
                            accept=".pdf"
                            multiple 
                            onChange={handlePdfUpload}
                            className="hidden" 
                          />
                        </label>
                      )}

                      {activeUploadTab === "images" && (
                        <label className="flex flex-col items-center justify-center h-52 border-2 border-dashed border-slate-800 hover:border-emerald-500/50 bg-slate-950/40 rounded-2xl cursor-pointer transition p-6 text-center">
                          <ImageIcon className="h-10 w-10 text-emerald-400 mb-3" />
                          <span className="text-sm font-bold text-white">اختر مجموعة صور المانغا</span>
                          <span className="text-xs text-slate-500 mt-2 max-w-xs leading-relaxed">
                            يمكنك تحديد صفحة واحدة أو صفحات متعددة دفعة واحدة (JPEG, PNG, WebP).
                          </span>
                          <span className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-500/30 transition">
                            <Upload className="h-3.5 w-3.5" />
                            <span>تحديد الصور من الجهاز</span>
                          </span>
                          <input 
                            ref={imagesInputRef}
                            type="file" 
                            multiple 
                            accept="image/*" 
                            onChange={handleImagesUpload}
                            className="hidden" 
                          />
                        </label>
                      )}

                    </div>
                  )}

                  {/* Active Page Preview and Configuration Drawer */}
                  {uploadedPages.length > 0 && !isExtracting && (
                    <div className="flex flex-col gap-6">
                      
                      {/* Name input */}
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-slate-400">عنوان المانغا / الفصل المرفوع:</label>
                        <input
                          type="text"
                          value={customTitle}
                          onChange={(e) => setCustomTitle(e.target.value)}
                          placeholder="مثال: ون بيس الفصل 1110"
                          className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      {/* Work Type Selection Section (نوع العمل) */}
                      <div className="flex flex-col gap-3 p-4 rounded-xl bg-slate-950 border border-slate-900">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                            <BookOpen className="h-4 w-4" />
                            <span>نوع العمل (لضبط القواعد الثقافية والترجمة بالذكاء الاصطناعي):</span>
                          </label>
                          <span className="text-[10px] text-slate-500 font-mono">CULTURAL LOCALIZATION</span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedWorkType("مانهوا كورية");
                              setIsCustomWorkType(false);
                            }}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition gap-1.5 cursor-pointer ${
                              !isCustomWorkType && selectedWorkType === "مانهوا كورية"
                                ? "bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-500/10"
                                : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                            }`}
                          >
                            <span className="text-xl">🇰🇷</span>
                            <span>مانهوا كورية</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedWorkType("مانها صينية");
                              setIsCustomWorkType(false);
                            }}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition gap-1.5 cursor-pointer ${
                              !isCustomWorkType && selectedWorkType === "مانها صينية"
                                ? "bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-500/10"
                                : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                            }`}
                          >
                            <span className="text-xl">🇨🇳</span>
                            <span>مانها صينية</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedWorkType("مانجا يابانية");
                              setIsCustomWorkType(false);
                            }}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition gap-1.5 cursor-pointer ${
                              !isCustomWorkType && selectedWorkType === "مانجا يابانية"
                                ? "bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-500/10"
                                : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                            }`}
                          >
                            <span className="text-xl">🇯🇵</span>
                            <span>مانجا يابانية</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomWorkType(true);
                            }}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition gap-1.5 cursor-pointer ${
                              isCustomWorkType
                                ? "bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-500/10"
                                : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                            }`}
                          >
                            <span className="text-xl">✍️</span>
                            <span>إدخال يدوي</span>
                          </button>
                        </div>

                        {/* Custom Input Field if Manual option is active */}
                        {isCustomWorkType && (
                          <div className="mt-2 flex flex-col gap-1.5 animate-fadeIn">
                            <label className="text-[11px] font-medium text-slate-400">أدخل نوع العمل أو الوصف الثقافي يدوياً:</label>
                            <input
                              type="text"
                              value={customWorkTypeInput}
                              onChange={(e) => setCustomWorkTypeInput(e.target.value)}
                              placeholder="مثال: مانغا سينين حربية / كوميكس أمريكي..."
                              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-750 text-xs text-white focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                        )}
                      </div>

                      {/* Summary statistics */}
                      <div className="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-900 text-xs">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4.5 w-4.5 text-emerald-400" />
                          <span>تم معالجة وتجهيز: <strong className="text-emerald-400">{uploadedPages.length} صفحة مانغا</strong></span>
                        </div>
                        {activeUploadTab === "images" && (
                          <label className="text-emerald-400 hover:underline cursor-pointer font-bold">
                            + إضافة المزيد من الصفحات
                            <input 
                              type="file" 
                              multiple 
                              accept="image/*" 
                              onChange={handleImagesUpload}
                              className="hidden" 
                            />
                          </label>
                        )}
                      </div>

                      {/* Grid listing all pages */}
                      <div className="flex flex-col gap-2.5">
                        <span className="text-xs font-bold text-slate-400">تنظيم وترتيب صفحات المانغا (اسحب أو رتب يدوياً):</span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[340px] overflow-y-auto p-2 bg-slate-950 rounded-xl border border-slate-900">
                          {(Array.isArray(uploadedPages) ? uploadedPages : []).map((page, index) => (
                            <div key={index} className="group relative aspect-[3/4] bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col justify-end">
                              <img src={page || "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&q=80"} alt={`Page ${index + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/45" />
                              
                              {/* Page number badge */}
                              <span className="absolute top-1 right-1 bg-slate-950/80 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border border-slate-800 text-slate-300">
                                {index + 1}
                              </span>

                              {/* Controls */}
                              <div className="relative z-10 flex items-center justify-between p-1.5 bg-slate-950/85 backdrop-blur-xs border-t border-slate-800 gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="flex gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      movePage(index, "prev");
                                    }}
                                    disabled={index === 0}
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-25"
                                    title="تحريك للخلف"
                                  >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      movePage(index, "next");
                                    }}
                                    disabled={index === uploadedPages.length - 1}
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-25"
                                    title="تحريك للأمام"
                                  >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    deletePage(index);
                                  }}
                                  className="p-1 rounded bg-red-950/70 hover:bg-red-500 hover:text-white text-red-400 z-50 cursor-pointer pointer-events-auto"
                                  title="حذف الصفحة"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  )}

                  {/* Dedicated Trash Can 🗑️ Section Beneath File Upload */}
                  <div className="mt-2 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-red-500/30 bg-gradient-to-r from-red-950/40 via-slate-950/60 to-red-950/30 p-4 shadow-xl">
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/20 text-2xl text-red-400 border border-red-500/30 shadow-inner shrink-0">
                        🗑️
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">إفراغ وحذف جميع الملفات المرفوعة دفعة واحدة</h4>
                          {uploadedPages.length > 0 && (
                            <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-[10px] font-mono font-bold text-red-300 border border-red-500/30">
                              {uploadedPages.length} صفحة مرفوعة
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                          {uploadedPages.length > 0
                            ? "اضغط على زر سلة المهملات 🗑️ لحذف كافة الصفحات والملفات التي قمت برفعها وتصفير النموذج فوراً."
                            : "عند رفع أي ملفات (ZIP، PDF، أو صور)، يمكنك الضغط على هذا الزر لحذفها بالكامل دفعة واحدة."}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      id="trash-clear-all-uploads-btn"
                      onClick={handleClearAllUploadedFiles}
                      className="w-full sm:w-auto flex items-center justify-center gap-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 text-white px-5 py-3 text-xs font-bold transition shadow-lg shadow-red-600/20 cursor-pointer border border-red-500/40 shrink-0"
                      title="حذف جميع الملفات التي تم رفعها دفعة واحدة 🗑️"
                    >
                      <span className="text-lg leading-none">🗑️</span>
                      <Trash2 className="h-4 w-4" />
                      <span>حذف جميع الملفات المرفوعة</span>
                    </button>
                  </div>

                </div>

                {/* Left: Quick Actions sidebar */}
                <div className="lg:col-span-4 flex flex-col gap-6">
                  
                  {/* Option config */}
                  <div className="bg-slate-900/40 border border-slate-900 p-6 rounded-2xl shadow-xl flex flex-col gap-5">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest font-mono">الإعدادات المسبقة للترجمة</span>
                    <div className="h-[1px] bg-slate-800" />
                    
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-bold text-slate-400">لغة الترجمة المطلوبة:</label>
                      <select
                        value={targetLang.code}
                        onChange={(e) => {
                          const lang = TARGET_LANGUAGES.find((l) => l.code === e.target.value);
                          if (lang) setTargetLang(lang);
                        }}
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                      >
                        {TARGET_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.flag} {lang.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Launch Core reader */}
                    <button
                      onClick={startReading}
                      disabled={uploadedPages.length === 0}
                      className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:opacity-95 text-white font-bold text-sm tracking-wide shadow-lg shadow-emerald-500/10 transition active:scale-95 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2"
                    >
                      <Sparkles className="h-4.5 w-4.5 animate-pulse" />
                      <span>بدء القراءة والترجمة الذكية</span>
                    </button>
                  </div>

                  {/* Manual Helper / Quick FAQ box */}
                  <div className="bg-slate-900/10 border border-slate-900/50 p-5 rounded-xl text-xs text-slate-500 leading-relaxed flex flex-col gap-2">
                    <span className="font-bold text-slate-400 flex items-center gap-1">
                      <HelpCircle className="h-4 w-4 text-emerald-400" />
                      كيف تبدأ القراءة والترجمة؟
                    </span>
                    <p>1. اختر تبويب رفع ملف الـ ZIP أو PDF أو صور يدوية.</p>
                    <p>2. اضبط الاسم وسلسلة الصفحات بما يناسبك.</p>
                    <p>3. اضغط "بدء القراءة" لفتح واجهة القراءة المتقدمة.</p>
                    <p>4. انقر فوق "ترجمة الصفحة (OCR)" لبث الترجمة عبر الذكاء الاصطناعي مباشرة!</p>
                  </div>

                </div>

              </div>

              {/* Shelf: Saved Mangas from database */}
              <div className="mt-16">
                
                <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-6">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                      <Bookmark className="h-4.5 w-4.5" />
                    </div>
                    <h2 className="font-display text-lg sm:text-xl font-bold text-white">المانغا الخاصة بي (محفوظة محلياً)</h2>
                  </div>
                  <div className="flex items-center gap-3">
                    {localMangas.length > 0 && (
                      <button
                        onClick={deleteAllSavedMangas}
                        className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-400 transition hover:bg-red-500/20 border border-red-500/20 active:scale-95"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="hidden sm:inline">حذف الكل</span>
                      </button>
                    )}
                    <span className="text-[10px] font-mono text-slate-500">SAVED LOCAL SHELF</span>
                  </div>
                </div>

                {Array.isArray(localMangas) && localMangas.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {localMangas.map((manga) => (
                      <div
                        key={manga.id}
                        onClick={() => readSavedManga(manga)}
                        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-slate-900/60 border border-slate-850 transition hover:-translate-y-1 hover:border-slate-700"
                      >
                        <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                          <img
                            src={manga.coverUrl || DEFAULT_MANGA_COVER}
                            alt={manga.title}
                            loading="lazy"
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />
                          
                          {/* Absolute delete button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteSavedManga(manga.id, e);
                            }}
                            className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-lg bg-red-950/80 border border-red-900/30 text-red-400 hover:bg-red-500 hover:text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition duration-200 z-50 cursor-pointer pointer-events-auto"
                            title="حذف من المكتبة"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="p-3 text-right">
                          <span className="font-mono text-[9px] text-emerald-400">أرشيف محلي</span>
                          <h3 className="line-clamp-2 font-display text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">
                            {manga.title}
                          </h3>
                          <span className="text-[10px] text-slate-500 mt-1 block">
                            {manga.pages.length} صفحة
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-900 p-16 text-center text-slate-600">
                    <BookOpen className="mx-auto h-12 w-12 text-slate-700 mb-4" />
                    <h3 className="font-display text-base font-bold text-slate-500">مكتبة المانغا المرفوعة فارغة</h3>
                    <p className="mt-2 text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                      لم تقم برفع أي مانغا بعد. قم بسحب وإسقاط ملف مانغا ZIP أو PDF أو مجموعة صور لتخزينها والبدء في ترجمتها محلياً!
                    </p>
                  </div>
                )}

              </div>

            </div>

          </div>
        )}

        {/* Library dashboard */}
        {currentView === "library" && (
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" dir="rtl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-900 pb-6 mb-8">
              <div>
                <h1 className="font-display text-2xl font-extrabold text-white tracking-tight sm:text-3xl">
                  مكتبتك الشخصية
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                  تتبع المانجا المرفوعة وسجل فصولك المقروءة ومتابعة التقدم.
                </p>
              </div>
            </div>

            {/* Direct display of local shelf */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {(Array.isArray(localMangas) ? localMangas : []).map((manga) => (
                <div
                  key={manga.id}
                  onClick={() => readSavedManga(manga)}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-slate-900/60 border border-slate-850 transition hover:-translate-y-1 hover:border-slate-700"
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
                    <img
                      src={manga.coverUrl || DEFAULT_MANGA_COVER}
                      alt={manga.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = DEFAULT_MANGA_COVER;
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />
                    
                    {/* Absolute delete button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteSavedManga(manga.id, e);
                      }}
                      className="absolute top-2 left-2 flex h-7 w-7 items-center justify-center rounded-lg bg-red-950/80 border border-red-900/30 text-red-400 hover:bg-red-500 hover:text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition duration-200 z-50 cursor-pointer pointer-events-auto"
                      title="حذف من المكتبة"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="p-3 text-right">
                    <span className="font-mono text-[9px] text-emerald-400">أرشيف محلي</span>
                    <h3 className="line-clamp-2 font-display text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">
                      {manga.title}
                    </h3>
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      {manga.pages.length} صفحة
                    </span>
                  </div>
                </div>
              ))}
              
              {localMangas.length === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed border-slate-900 p-16 text-center text-slate-600">
                  <Bookmark className="mx-auto h-12 w-12 text-slate-700 mb-4" />
                  <h3 className="font-display text-base font-bold text-slate-500">لا توجد مانغا مرفوعة حالياً</h3>
                  <p className="mt-2 text-xs text-slate-600 max-w-sm mx-auto">
                    ارفع المانغا الخاصة بك في الصفحة الرئيسية لتتمكن من تصفحها هنا.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <Suspense fallback={<ViewLoadingFallback />}>
          {/* Favorites View */}
          {currentView === "favorites" && (
            <Favorites 
              onSelectManga={(mangaId, sourceId, mangaTitle, mangaObj) => {
                setSelectedMangaId(mangaId);
                setSelectedSourceId(sourceId || undefined);
                setSelectedMangaObj(mangaObj || null);
                setPreviousView("favorites");
                setCurrentView("details");
              }}
              onDirectRead={(mangaId, chapterId, chapterNumber, mangaTitle, sourceId) => {
                let resolvedSourceId = sourceId || selectedSourceId;
                let resolvedMangaTitle = mangaTitle;
                let resolvedWorkType = "مانهوا كورية";

                try {
                  const favs = JSON.parse(localStorage.getItem("manga_favorites") || "[]");
                  const cleanId = String(mangaId).replace(/^suwayomi_/, "");
                  const f = favs.find((item: any) => item.id === mangaId || item.id === cleanId);
                  if (f) {
                    if (!resolvedSourceId && f.sourceId) resolvedSourceId = f.sourceId;
                    if (!resolvedMangaTitle && f.title) resolvedMangaTitle = f.title;
                    if (f.type) resolvedWorkType = f.type;
                  }
                  const cached = JSON.parse(localStorage.getItem(`manga_cached_${mangaId}`) || "null");
                  if (cached) {
                    if (!resolvedSourceId && cached.sourceId) resolvedSourceId = cached.sourceId;
                    if (!resolvedMangaTitle && cached.manga?.title) resolvedMangaTitle = cached.manga.title;
                    if (cached.manga?.type) resolvedWorkType = cached.manga.type;
                  }
                } catch (_) {}

                setSelectedMangaId(mangaId);
                setSelectedSourceId(resolvedSourceId || undefined);
                setSelectedChapter({
                  id: chapterId,
                  title: `الفصل ${chapterNumber}`,
                  chapter: chapterNumber,
                  sourceId: resolvedSourceId || undefined,
                  mangaTitle: resolvedMangaTitle || undefined,
                  workType: resolvedWorkType,
                  isLocal: false,
                  pages: []
                });
                setPreviousView("favorites");
                setCurrentView("reader");
              }}
              onExploreSources={() => setCurrentView("catalogue")}
            />
          )}

          {/* Manga Details View */}
          {currentView === "details" && selectedMangaId && (
            <MangaDetails
              mangaId={selectedMangaId}
              sourceId={selectedSourceId || undefined}
              initialManga={selectedMangaObj || undefined}
              onBack={() => setCurrentView(previousView === "favorites" ? "favorites" : "catalogue")}
              onReadChapter={(chapter: any) => {
                setSelectedChapter({
                  id: chapter.id,
                  title: chapter.title,
                  chapter: chapter.chapter,
                  language: chapter.language,
                  sourceId: chapter.sourceId || selectedSourceId || undefined,
                  mangaTitle: chapter.mangaTitle || selectedMangaObj?.title || undefined,
                  workType: chapter.workType || selectedWorkType || undefined,
                  isLocal: false,
                  pages: chapter.pages || []
                });
                setPreviousView("details");
                setCurrentView("reader");
              }}
              onCreateVideo={(chapter: any, manga?: any) => {
                setVideoChapterContext({ chapter, manga });
                setPreviousView("details");
                setCurrentView("manhwa-video");
              }}
            />
          )}

          {/* Manhwa Video Creation Studio (🎬 إنشاء فيديوهات المانهاوا) */}
          {currentView === "manhwa-video" && (
            <ManhwaVideoPage
              initialChapter={videoChapterContext?.chapter}
              initialManga={videoChapterContext?.manga}
              onNavigateToSources={() => setCurrentView("catalogue")}
              onNavigateToFavorites={() => setCurrentView("favorites")}
              onBack={() => {
                if (previousView === "details" && selectedMangaId) {
                  setCurrentView("details");
                } else {
                  setCurrentView("catalogue");
                }
              }}
            />
          )}

          {/* Novel → Manga Pages 1.1 Studio */}
          {currentView === "novel-to-manga" && (
            <NovelToMangaPage
              onNavigateToSettings={() => setCurrentView("settings")}
            />
          )}

          {/* Suwayomi History View */}
          {currentView === "history" && (
            <SuwayomiHub 
              initialTab="history"
              onOpenStudio={() => setCurrentView("studio")}
              onPullChapter={handlePullChapter}
            />
          )}

          {/* Settings Page */}
          {currentView === "settings" && <SettingsPage />}

          {/* Dedicated Gemini TTS Studio */}
          {currentView === "gemini-tts" && <GeminiTTSStudio />}

          {/* Universal Video Player & Instant AI Arabic Dubbing */}
          {currentView === "video-dubbing" && (
            <VideoDubbingPage onNavigateToSettings={() => setCurrentView("settings")} />
          )}

          {/* Extensions Hub View */}
          {currentView === "extensions" && (
            <ExtensionsPage onBackToCatalogue={() => setCurrentView("catalogue")} />
          )}

          {/* Immersive Reader and OCR interface */}
          {currentView === "reader" && selectedChapter && selectedMangaId && (
            <div className="fixed inset-0 z-50 bg-slate-950 overflow-hidden">
              <ReaderPage
                chapter={selectedChapter}
                mangaId={selectedMangaId}
                onBack={() => {
                  if (selectedChapter.isLocal) {
                    setCurrentView("studio");
                  } else if (previousView === "details") {
                    setCurrentView("details");
                  } else if (previousView === "favorites") {
                    setCurrentView("favorites");
                  } else {
                    setCurrentView("catalogue");
                  }
                  setSelectedChapter(null);
                }}
              />
            </div>
          )}
        </Suspense>

      </main>

      {/* Footer copyright credit (hidden on small mobile screens and in reader view) */}
      {currentView !== "reader" && (
        <footer className="hidden sm:block border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p dir="rtl">© {new Date().getFullYear()} AI Manga Reader. جميع الحقوق محفوظة لقراءة وترجمة المانجا بالذكاء الاصطناعي.</p>
          </div>
        </footer>
      )}

      {/* Modern Android & Mobile Bottom Navigation */}
      <MobileBottomNav
        currentView={currentView === "source_details" ? "catalogue" : currentView}
        onViewChange={(view) => {
          setCurrentView(view);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

    </div>
  );
}
