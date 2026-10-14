import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Mutex queue to serialize browser automation requests
let queuePromise = Promise.resolve<any>(null);

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queuePromise.then(() => task(), () => task());
  queuePromise = result.catch(() => {});
  return result;
}

const DEFAULT_COOKIES_FILE = path.join(process.cwd(), "metaai_cookies.txt");
const CHAPTER_CONVERSATIONS_FILE = path.join(process.cwd(), "chapter_metaai_conversations.json");

export interface ChapterConversationRecord {
  conversationId?: string;
  conversationUrl?: string;
  lastUsed: number;
}

export function loadChapterMetaAiConversations(): Record<string, ChapterConversationRecord> {
  try {
    if (fs.existsSync(CHAPTER_CONVERSATIONS_FILE)) {
      const data = fs.readFileSync(CHAPTER_CONVERSATIONS_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn("Could not load chapter_metaai_conversations.json:", err);
  }
  return {};
}

export function saveChapterMetaAiConversation(chapterId: string, info: { conversationId?: string; conversationUrl?: string }) {
  try {
    const all = loadChapterMetaAiConversations();
    all[chapterId] = {
      ...info,
      lastUsed: Date.now()
    };
    fs.writeFileSync(CHAPTER_CONVERSATIONS_FILE, JSON.stringify(all, null, 2), "utf8");
  } catch (err) {
    console.warn("Could not save chapter conversation:", err);
  }
}

export function resetChapterMetaAiConversation(chapterId: string): boolean {
  try {
    const all = loadChapterMetaAiConversations();
    if (all[chapterId]) {
      delete all[chapterId];
      fs.writeFileSync(CHAPTER_CONVERSATIONS_FILE, JSON.stringify(all, null, 2), "utf8");
    }
    return true;
  } catch {
    return false;
  }
}

export interface MetaAiCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: number;
}

export function parseMetaAiCookies(raw: string): MetaAiCookie[] {
  const cookies: MetaAiCookie[] = [];
  if (!raw || typeof raw !== "string" || !raw.trim()) return cookies;

  let trimmed = raw.trim();

  // 1. Check if Base64 encoded
  if (
    !trimmed.includes(";") &&
    !trimmed.includes("\t") &&
    !trimmed.startsWith("[") &&
    !trimmed.startsWith("{") &&
    trimmed.length > 30
  ) {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
      if (decoded.includes("=") || decoded.startsWith("[") || decoded.startsWith("{")) {
        trimmed = decoded.trim();
      }
    } catch (_) {}
  }

  // 2. Try JSON Array or Object (e.g. from Cookie-Editor, EditThisCookie)
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.name && item.value !== undefined) {
            cookies.push({
              name: String(item.name).trim(),
              value: String(item.value).trim(),
              domain: item.domain || ".meta.ai",
              path: item.path || "/",
              secure: typeof item.secure === "boolean" ? item.secure : undefined,
              httpOnly: typeof item.httpOnly === "boolean" ? item.httpOnly : undefined,
              expires: typeof item.expirationDate === "number" ? Math.floor(item.expirationDate) : (typeof item.expires === "number" ? Math.floor(item.expires) : undefined)
            });
          }
        }
      } else if (typeof data === "object" && data !== null) {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === "string" || typeof v === "number") {
            cookies.push({
              name: k.trim(),
              value: String(v).trim(),
              domain: ".meta.ai",
              path: "/"
            });
          } else if (v && typeof v === "object" && "value" in (v as any)) {
            const it = v as any;
            cookies.push({
              name: (it.name || k).trim(),
              value: String(it.value).trim(),
              domain: it.domain || ".meta.ai",
              path: it.path || "/"
            });
          }
        }
      }
    } catch (_) {}
  }

  // 3. Fallback: Tab-separated (Netscape format) or semicolon separated (Header format)
  if (cookies.length === 0) {
    const lines = trimmed.split("\n");
    for (const line of lines) {
      const lineTrim = line.trim();
      if (!lineTrim || lineTrim.startsWith("#")) continue;

      const parts = lineTrim.split(/\t+/);
      if (parts.length >= 7) {
        cookies.push({
          domain: parts[0],
          path: parts[2],
          secure: parts[3].toLowerCase() === "true",
          expires: parseInt(parts[4], 10) || undefined,
          name: parts[5].trim(),
          value: parts[6].trim()
        });
      } else if (lineTrim.includes("=")) {
        const pairs = lineTrim.split(";");
        for (const p of pairs) {
          const eqIdx = p.indexOf("=");
          if (eqIdx !== -1) {
            const k = p.substring(0, eqIdx).trim();
            const v = p.substring(eqIdx + 1).trim();
            if (k) {
              cookies.push({
                domain: ".meta.ai",
                path: "/",
                name: k,
                value: v
              });
            }
          }
        }
      }
    }
  }

  return cookies;
}

export function parseNetscapeCookies(raw: string): MetaAiCookie[] {
  return parseMetaAiCookies(raw);
}

function getAgentBrowserBin(): string {
  const localBin = path.join(process.cwd(), "node_modules", ".bin", "agent-browser");
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return "agent-browser";
}

let browserReadyPromise: Promise<void> | null = null;
async function ensureAgentBrowserReady(): Promise<void> {
  const homeDir = os.homedir();
  const browsersDir = path.join(homeDir, ".agent-browser", "browsers");
  if (fs.existsSync(browsersDir)) {
    try {
      const files = fs.readdirSync(browsersDir);
      if (files.length > 0) return;
    } catch {}
  }

  if (!browserReadyPromise) {
    browserReadyPromise = new Promise((resolve) => {
      const bin = getAgentBrowserBin();
      console.log("[Meta AI / agent-browser] Initializing headless browser engine...");
      const binDir = path.join(process.cwd(), "node_modules", ".bin");
      const envPath = process.env.PATH ? `${binDir}:${process.env.PATH}` : binDir;
      execFile(bin, ["install"], { timeout: 120000, env: { ...process.env, PATH: envPath } }, (err) => {
        if (err) {
          console.warn("[Meta AI / agent-browser] Notice installing browser:", err.message);
        } else {
          console.log("[Meta AI / agent-browser] Headless browser ready.");
        }
        resolve();
      });
    });
  }
  await browserReadyPromise;
}

async function runAgentBrowser(args: string[], timeoutMs: number = 30000): Promise<string> {
  await ensureAgentBrowserReady();
  const binPath = getAgentBrowserBin();
  const binDir = path.join(process.cwd(), "node_modules", ".bin");
  const envPath = process.env.PATH ? `${binDir}:${process.env.PATH}` : binDir;

  return new Promise((resolve, reject) => {
    execFile(
      binPath,
      ["--session", "metaai", ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: envPath
        }
      },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || stdout?.trim() || err.message));
        }
        resolve(stdout.trim());
      }
    );
  });
}

let isInitialized = false;
let lastCookieSignature = "";

export async function applyMetaAiCookies(rawCookies?: string): Promise<{ success: boolean; count: number; message: string }> {
  let cookiesStr = rawCookies?.trim();
  if (!cookiesStr && fs.existsSync(DEFAULT_COOKIES_FILE)) {
    try {
      cookiesStr = fs.readFileSync(DEFAULT_COOKIES_FILE, "utf8").trim();
    } catch {}
  }

  if (!cookiesStr) {
    throw new Error("لم يتم تقديم ملفات تعريف الارتباط لـ Meta AI (Cookies)");
  }

  const parsed = parseMetaAiCookies(cookiesStr);
  if (parsed.length === 0) {
    throw new Error("تنسيق ملفات تعريف الارتباط غير صالح. يرجى توفير ملف بتنسيق JSON أو Netscape صالح.");
  }

  const signature = JSON.stringify(parsed.map(c => [c.name, c.value]));
  if (isInitialized && signature === lastCookieSignature) {
    return { success: true, count: parsed.length, message: "Cookies already loaded." };
  }

  // Set cookies via agent-browser in concurrent batches
  const cookieChunks: MetaAiCookie[][] = [];
  const chunkSize = 6;
  for (let i = 0; i < parsed.length; i += chunkSize) {
    cookieChunks.push(parsed.slice(i, i + chunkSize));
  }
  for (const chunk of cookieChunks) {
    await Promise.all(chunk.map(c => {
      const args = [
        "cookies", "set", c.name, c.value,
        "--url", "https://www.meta.ai/",
        "--domain", c.domain || ".meta.ai",
        "--path", c.path || "/"
      ];
      if (c.secure) args.push("--secure");
      if (c.httpOnly) args.push("--httpOnly");
      if (c.expires) args.push("--expires", String(c.expires));

      return runAgentBrowser(args, 15000).catch(err => {
        console.warn(`[Meta AI] Notice setting cookie ${c.name}:`, err.message || err);
      });
    }));
  }

  // Open Meta AI once with cookies loaded
  await runAgentBrowser(["open", "https://www.meta.ai/"], 25000);
  await new Promise(r => setTimeout(r, 600));

  isInitialized = true;
  lastCookieSignature = signature;

  return { success: true, count: parsed.length, message: `تم تفعيل ${parsed.length} ملف تعريف ارتباط بنجاح!` };
}

// Helper to repair unescaped quotes in JSON string
function repairJsonQuotes(str: string): string {
  return str.replace(/"(arabic_text|translated_text|translation|text)"\s*:\s*"([\s\S]*?)"(?=\s*[,}\]])/g, (_match, key, val) => {
    const repairedVal = val.replace(/(?<!\\)"/g, '\\"');
    return `"${key}": "${repairedVal}"`;
  });
}

export async function testMetaAiCookies(rawCookies?: string): Promise<{ success: boolean; status: string; message?: string; error?: string }> {
  let cookiesStr = rawCookies?.trim();
  if (!cookiesStr && fs.existsSync(DEFAULT_COOKIES_FILE)) {
    try {
      cookiesStr = fs.readFileSync(DEFAULT_COOKIES_FILE, "utf8").trim();
    } catch {}
  }

  if (!cookiesStr) {
    return {
      success: false,
      status: "Not Configured",
      error: "لم يتم تقديم ملفات تعريف الارتباط لـ Meta AI."
    };
  }

  // 1. Parse cookies
  const parsed = parseMetaAiCookies(cookiesStr);
  if (parsed.length === 0) {
    return {
      success: false,
      status: "Parse Failed",
      error: "فشل استخراج ملفات تعريف الارتباط. يرجى توفير ملف بتنسيق JSON أو Netscape صالح."
    };
  }

  try {
    // 2. Clear old cookies and inject new cookies
    await runAgentBrowser(["cookies", "clear"], 10000).catch(() => {});
    isInitialized = false;
    lastCookieSignature = "";
    await applyMetaAiCookies(cookiesStr);

    // 3. Verify page URL / redirection to login
    const curUrl = await runAgentBrowser(["eval", "window.location.href"], 10000).catch(() => "");
    if (curUrl.includes("/login") || curUrl.includes("accounts.") || curUrl.includes("facebook.com/login")) {
      return {
        success: false,
        status: "Unauthenticated",
        error: "جلسة Meta AI غير مسجلة الدخول (تم التحويل إلى صفحة تسجيل الدخول). يرجى التأكد من تسجيل الدخول في المتصفح وإعادة نسخ ملفات تعريف الارتباط."
      };
    }

    // 4. Check snapshot for login barriers vs active prompt interface
    const snapshot = await runAgentBrowser(["snapshot", "-i"], 12000).catch(() => "");
    const lowerSnap = snapshot.toLowerCase();
    if (
      (lowerSnap.includes("log in") || lowerSnap.includes("تسجيل الدخول") || lowerSnap.includes("log in with")) &&
      !lowerSnap.includes("ask meta ai") &&
      !lowerSnap.includes("message") &&
      !lowerSnap.includes("textbox")
    ) {
      return {
        success: false,
        status: "Unauthenticated",
        error: "جلسة Meta AI غير صالحة (تطلب الصفحة تسجيل الدخول أولاً)."
      };
    }

    // 5. Minimal harmless translation test through the exact same Meta Cookies path
    const testPrompt = `ترجم إلى العربية: Hello. أجب بصيغة JSON فقط: {"text": "مرحبا"}`;
    const testResult = await sendMetaAiPrompt(testPrompt, { cookies: cookiesStr, newConversation: true });

    if (testResult && testResult.text && testResult.text.trim().length > 0) {
      return {
        success: true,
        status: "Connected",
        message: "تم الاتصال والتحقق بنجاح من مسار ترجمة Meta AI Cookies!"
      };
    } else {
      return {
        success: false,
        status: "Request Failed",
        error: "لم يتم استلام استجابة صالحة من جلسة Meta AI."
      };
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[Meta AI Connection Test Failed]:", msg);
    return {
      success: false,
      status: "Request Failed",
      error: `فشل التحقق من الاتصال بـ Meta AI: ${msg}`
    };
  }
}

export interface MetaAiPromptOptions {
  newConversation?: boolean;
  cookies?: string;
  chapterId?: string;
  conversationId?: string;
  conversationUrl?: string;
}

export async function sendMetaAiPrompt(
  promptText: string,
  options?: MetaAiPromptOptions
): Promise<{ text: string; mediaUrls: string[]; conversationId?: string; conversationUrl?: string }> {
  return enqueue(async () => {
    // Ensure cookies applied
    await applyMetaAiCookies(options?.cookies);

    const chapterId = options?.chapterId;
    let targetConvUrl = options?.conversationUrl;
    let targetConvId = options?.conversationId;

    // Check saved chapter mapping if not explicitly passed
    if (chapterId && !targetConvUrl && !targetConvId) {
      const existing = loadChapterMetaAiConversations()[chapterId];
      if (existing) {
        targetConvUrl = existing.conversationUrl;
        targetConvId = existing.conversationId;
      }
    }

    // Inspect current browser URL
    let curUrl = "";
    try {
      curUrl = await runAgentBrowser(["eval", "window.location.href"], 5000);
    } catch {}

    const isExplicitNew = options?.newConversation === true;

    if (isExplicitNew) {
      console.log(`[Meta AI] Starting fresh conversation for chapter: ${chapterId || "new"}`);
      await runAgentBrowser(["open", "https://www.meta.ai/"], 25000);
      await new Promise(r => setTimeout(r, 350));
    } else if (targetConvUrl || targetConvId) {
      const destination = targetConvUrl || `https://www.meta.ai/c/${targetConvId}`;
      const isAlreadyOnDestination = curUrl && (curUrl === destination || (targetConvId && curUrl.includes(targetConvId)));

      if (!isAlreadyOnDestination) {
        console.log(`[Meta AI] Navigating to chapter (${chapterId || "active"}) conversation: ${destination}`);
        try {
          await runAgentBrowser(["open", destination], 25000);
          await new Promise(r => setTimeout(r, 350));
        } catch (navErr) {
          console.warn("[Meta AI] Failed navigating to existing conversation, falling back to new:", navErr);
          await runAgentBrowser(["open", "https://www.meta.ai/"], 25000);
          await new Promise(r => setTimeout(r, 350));
        }
      }
    } else {
      // First translation of this chapter: open clean home page to create a dedicated conversation
      console.log(`[Meta AI] Opening fresh chat for chapter: ${chapterId || "new"}`);
      await runAgentBrowser(["open", "https://www.meta.ai/"], 25000);
      await new Promise(r => setTimeout(r, 350));
    }

    // Fast initial article count (instant eval instead of heavy accessibility tree snapshot)
    let initialArticles = 0;
    try {
      const countRaw = await runAgentBrowser(["eval", "document.querySelectorAll('article').length"], 5000);
      initialArticles = parseInt(countRaw.trim(), 10) || 0;
    } catch {}

    // Find the input field and enter prompt
    try {
      await runAgentBrowser(["find", "role", "textbox", "click"], 5000);
    } catch {
      // If click fails, continue to fill
    }

    await runAgentBrowser(["fill", "@last", promptText], 20000);
    await new Promise(r => setTimeout(r, 80));
    await runAgentBrowser(["press", "Enter"], 6000);

    // High-performance polling loop (fast 300ms intervals with instant JSON return)
    const startTime = Date.now();
    const timeoutMs = 45000;
    let lastFoundText = "";
    let stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, 300));

      let pollData: { isNew: boolean; text: string; isGenerating: boolean; href: string } | null = null;
      try {
        const evalRaw = await runAgentBrowser([
          "eval",
          `(() => {
            const articles = Array.from(document.querySelectorAll('article'));
            const isNew = articles.length > ${initialArticles};
            const target = isNew ? articles[articles.length - 1] : null;
            const text = target ? (target.innerText || "").trim() : "";
            const isGen = Boolean(document.querySelector('[aria-label="Stop streaming"], [aria-label="Stop generating"], button[aria-label*="Stop"]'));
            return JSON.stringify({ isNew, text, isGenerating: isGen, href: window.location.href });
          })()`
        ], 6000);

        const parsed = JSON.parse(evalRaw.trim());
        if (parsed && typeof parsed.text === "string") {
          pollData = parsed;
        }
      } catch {}

      if (!pollData || !pollData.text) {
        continue;
      }

      const currentText = pollData.text.trim();
      const currentHref = pollData.href || "";
      const convMatch = currentHref.match(/\/(?:c|prompt)\/([a-zA-Z0-9_-]+)/);
      const convId = convMatch ? convMatch[1] : undefined;

      // Instant return optimization: Check if Meta AI finished generating valid complete JSON
      const firstBrace = currentText.indexOf("{");
      const lastBrace = currentText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace && (currentText.includes('"translations"') || currentText.includes('"page_translations"') || currentText.includes('"arabic_text"'))) {
        const subStr = currentText.substring(firstBrace, lastBrace + 1);
        let isValid = false;
        try {
          JSON.parse(subStr);
          isValid = true;
        } catch {
          try {
            JSON.parse(repairJsonQuotes(subStr));
            isValid = true;
          } catch {}
        }

        if (isValid) {
          if (chapterId && (currentHref || convId)) {
            saveChapterMetaAiConversation(chapterId, {
              conversationId: convId,
              conversationUrl: currentHref
            });
          }
          return {
            text: currentText,
            mediaUrls: [],
            conversationId: convId,
            conversationUrl: currentHref
          };
        }
      }

      // If generation is not in progress and text is stable
      if (!pollData.isGenerating) {
        if (currentText === lastFoundText && currentText.length > 5) {
          stableCount++;
          if (stableCount >= 1) {
            if (chapterId && (currentHref || convId)) {
              saveChapterMetaAiConversation(chapterId, {
                conversationId: convId,
                conversationUrl: currentHref
              });
            }
            return {
              text: currentText,
              mediaUrls: [],
              conversationId: convId,
              conversationUrl: currentHref
            };
          }
        } else {
          stableCount = 0;
          lastFoundText = currentText;
        }
      } else {
        lastFoundText = currentText;
      }
    }

    // Fallback if loop ended
    let finalUrl: string | undefined;
    try {
      finalUrl = await runAgentBrowser(["eval", "window.location.href"], 8000);
    } catch {}
    const convMatch = finalUrl ? finalUrl.match(/\/(?:c|prompt)\/([a-zA-Z0-9_-]+)/) : null;
    const convId = convMatch ? convMatch[1] : undefined;

    if (chapterId && (finalUrl || convId)) {
      saveChapterMetaAiConversation(chapterId, {
        conversationId: convId,
        conversationUrl: finalUrl
      });
    }

    if (lastFoundText) {
      return { text: lastFoundText, mediaUrls: [], conversationId: convId, conversationUrl: finalUrl };
    }

    throw new Error("انتهت مهلة انتظار رد Meta AI دون الحصول على استجابة كاملة.");
  });
}

async function extractMediaUrls(): Promise<string[]> {
  try {
    const raw = await runAgentBrowser([
      "eval",
      "Array.from(document.querySelectorAll('img, video, source')).map(el => el.src).filter(s => s && s.includes('fbcdn'))",
      "--json"
    ], 10000);
    const data = JSON.parse(raw);
    const urls: string[] = data?.data?.result || [];
    return urls.filter(u => typeof u === "string" && (u.includes("scontent") || u.includes("video")));
  } catch {
    return [];
  }
}

async function getConversationId(): Promise<string | undefined> {
  try {
    const url = await runAgentBrowser(["eval", "window.location.href"], 10000);
    const match = url.match(/\/(?:c|prompt)\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

export interface MetaAiTranslationItem {
  region_id: string;
  source_text: string;
  reading_order: number;
  panel_id?: string | null;
  bubble_id?: string | null;
  text_type?: string;
}

export async function translateMangaWithMetaAi(params: {
  texts?: string[];
  blockIds?: string[];
  items?: MetaAiTranslationItem[];
  structuredBlocks?: any[];
  page_translations?: any[];
  targetLanguage?: string;
  workType?: string;
  workName?: string;
  mangaContext?: string;
  cookies?: string;
  chapterId?: string;
  conversationId?: string;
  conversationUrl?: string;
  newConversation?: boolean;
}): Promise<{
  translations: string[];
  translationMap: Record<string, string>;
  page_translations: Array<{ region_id: string; reading_order: number; source_text: string; translated_text: string }>;
  conversationId?: string;
  conversationUrl?: string;
}> {
  const { texts, blockIds, items, structuredBlocks, page_translations, workType, workName, mangaContext, cookies, chapterId, conversationId, conversationUrl, newConversation } = params;

  // Build deterministic translation items preserving existing region identity and reading order
  let translationItems: MetaAiTranslationItem[] = [];
  const rawList = items || page_translations || structuredBlocks;
  if (Array.isArray(rawList) && rawList.length > 0) {
    translationItems = rawList.map((b: any, i: number) => ({
      region_id: String(b.region_id || b.id || `region_${i + 1}`).trim(),
      source_text: String(b.source_text ?? b.text ?? b.original_text ?? b.originalText ?? "").trim(),
      reading_order: (typeof b.reading_order === "number" && !isNaN(b.reading_order)) ? b.reading_order : (i + 1),
      panel_id: b.panel_id || b.container_id || null,
      bubble_id: b.bubble_id || b.parent_bubble_id || null,
      text_type: b.text_type || b.type || "dialogue"
    }));
  } else if (Array.isArray(texts) && texts.length > 0) {
    translationItems = texts.map((t: string, i: number) => ({
      region_id: Array.isArray(blockIds) && blockIds[i] ? String(blockIds[i]).trim() : `region_${i + 1}`,
      source_text: String(t || "").trim(),
      reading_order: i + 1,
      panel_id: null,
      bubble_id: null,
      text_type: "dialogue"
    }));
  }

  if (translationItems.length === 0) {
    return { translations: [], translationMap: {}, page_translations: [] };
  }

  // Strictly preserve existing Region Intelligence reading order
  translationItems.sort((a, b) => a.reading_order - b.reading_order);

  const selectedWorkType = (workType && workType.trim()) ? workType.trim() : "مانهوا / مانجا";
  const selectedWorkName = (workName && workName.trim()) ? workName.trim() : (mangaContext ? mangaContext : "غير محدد");

  const formattedItems = translationItems.map(it => ({
    region_id: it.region_id,
    reading_order: it.reading_order,
    text_type: it.text_type,
    source_text: it.source_text
  }));
  const formattedTexts = JSON.stringify(formattedItems, null, 2);

  const isContinuingChapter = !newConversation && (conversationUrl || conversationId || (chapterId && !!loadChapterMetaAiConversations()[chapterId]));

  const sampleTemplate = translationItems.slice(0, Math.min(3, translationItems.length)).map(it => 
    `    { "region_id": "${it.region_id}", "arabic_text": "الترجمة هنا" }`
  ).join(",\n");

  let prompt = "";
  if (!isContinuingChapter) {
    prompt = `ترجم النص إلى العربية بأسلوب بسيط وطبيعي وسهل الفهم، مع الحفاظ على المعنى الأصلي والمشاعر والسياق، دون ترجمة حرفية أو كلمات معقدة. اجعل الصياغة مناسبة للمانجا والحوارات اليومية، واستخدم عربية فصحى حديثة وسلسة. عرّب كل شيء في النص، بما في ذلك الحوارات، النصوص خارج الفقاعات، المؤثرات الصوتية، العناوين وأي كلمات ظاهرة، ولا تترك أي نص باللغة الأصلية.

أنت خبير تعريب القصص المصورة والمانجا (${selectedWorkName} - ${selectedWorkType}).
المطلوب تعريب نصوص وحوارات القصة المصورة بدقة واحترافية متناهية، مع الالتزام الصارم بالقواعد التالية:

المبدأ الأساسي:
«بسّط الصياغة، ولا تبسّط المعنى. حافظ على كل المعلومات الموجودة في النص الأصلي، واجعل العربية واضحة وسهلة وطبيعية فقط.»

- تعريب الصفحة بالكامل دفعة واحدة: جميع نصوص الصفحة البالغ عددها (${translationItems.length}) نصاً يجب تعريبها معاً، مع فهم سياق المشهد وتسلسل الأحداث وترتيب الحوار لتجنب الترجمة المنفصلة أو الخاطئة.
- التعامل مع كل فقاعة كلام كوحدة متكاملة واحدة تحتوي على نص كامل دون تجزئة.
- التعامل المستقل والدقيق مع النصوص خارج الفقاعات (السرد، التعليقات، نصوص الخلفية، مربعات النص، المؤثرات SFX) حسب وظيفتها دون دمج عشوائي.
- تبسيط الكلمات بدون حذف المعنى: إذا كانت الكلمة صعبة أو نادرة استخدم بديلاً عربياً سهلاً ومباشراً، وإذا كانت الجملة معقدة التركيب اجعل صياغتها سلسة، مع تحذير صارم: ممنوع حذف أي معلومة، ممنوع اختصار الجمل، ممنوع تغيير المعنى، وممنوع إضافة معلومات غير موجودة.
- الحفاظ الصارم على الأسماء والمصطلحات: الحفاظ التام على أسماء الشخصيات والأماكن والمهارات والتقنيات والمصطلحات الخاصة بالعمل كما هي دون ترجمتها حرفياً ودون اختراع أسماء جديدة.
- تحذير صارم: ممنوع منعاً باتاً الاكتفاء بجزء من النصوص أو ترك أي نص! يجب أن يحتوي الـ JSON على جميع الـ (${translationItems.length}) نصاً كاملة.
- مخرجات JSON فقط بهذا الهيكل وتضم جميع الـ (${translationItems.length}) عنصر:
{
  "page_translations": [
${sampleTemplate}${translationItems.length > 3 ? `,\n    ... (أكمل باقي جميع النصوص حتى تكتمل جميع الـ ${translationItems.length} نصاً)` : ""}
  ]
}

قائمة جميع النصوص المطلوب تعريبها (${translationItems.length} نصاً):
${formattedTexts}`;
  } else {
    prompt = `ترجم النص إلى العربية بأسلوب بسيط وطبيعي وسهل الفهم، مع الحفاظ على المعنى الأصلي والمشاعر والسياق، دون ترجمة حرفية أو كلمات معقدة. اجعل الصياغة مناسبة للمانجا والحوارات اليومية، واستخدم عربية فصحى حديثة وسلسة. عرّب كل شيء في النص، بما في ذلك الحوارات، النصوص خارج الفقاعات، المؤثرات الصوتية، العناوين وأي كلمات ظاهرة، ولا تترك أي نص باللغة الأصلية.

المجموعة التالية من نصوص ${selectedWorkName} (${selectedWorkType}).
المبدأ الأساسي: «بسّط الصياغة، ولا تبسّط المعنى. حافظ على كل المعلومات، واجعل العربية واضحة وسهلة وطبيعية فقط.»
عرّب كافة نصوص وحوارات المجموعة (${translationItems.length} نصاً بالكامل، تشمل نصوص داخل الفقاعات وخارجها)، مع الحفاظ التام على أسماء الشخصيات والمصطلحات، وتسهيل الألفاظ الصعبة دون حذف أي معلومة أو اختصار، شاملاً الحوار والسرد والمؤثرات والضحكات دون استثناء ودون اختصار!
مخرجات JSON فقط مطابقة للهيكل وتضم جميع الـ (${translationItems.length}) نصاً:
{
  "page_translations": [
${sampleTemplate}${translationItems.length > 3 ? `,\n    ... (أكمل باقي جميع النصوص حتى تكتمل جميع الـ ${translationItems.length} نصاً)` : ""}
  ]
}

قائمة جميع النصوص المطلوب تعريبها (${translationItems.length} نصاً):
${formattedTexts}`;
  }

  const response = await sendMetaAiPrompt(prompt, {
    newConversation,
    cookies,
    chapterId,
    conversationId,
    conversationUrl
  });
  const rawText = response.text;

  // Robust boundary extraction: handle markdown code blocks or outermost JSON structure
  let jsonStr = rawText.trim();
  const codeBlockMatch = rawText.match(/```(?:json|JSON)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else {
    const firstBracket = rawText.indexOf("[");
    const firstBrace = rawText.indexOf("{");
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      const lastBracket = rawText.lastIndexOf("]");
      if (lastBracket > firstBracket) {
        jsonStr = rawText.substring(firstBracket, lastBracket + 1);
      }
    } else if (firstBrace !== -1) {
      const lastBrace = rawText.lastIndexOf("}");
      if (lastBrace > firstBrace) {
        jsonStr = rawText.substring(firstBrace, lastBrace + 1);
      }
    }
  }

  const translationMap: Record<string, string> = {};

  function cleanVal(str: string): string {
    if (!str || typeof str !== "string") return "";
    return str.replace(/[\u0000\uFFFD]/g, "").trim();
  }

  // Helper to repair unescaped quotes in JSON string
  function repairJsonQuotes(str: string): string {
    return str.replace(/"(arabic_text|translated_text|translation|text)"\s*:\s*"([\s\S]*?)"(?=\s*[,}\]])/g, (_match, key, val) => {
      const repairedVal = val.replace(/(?<!\\)"/g, '\\"');
      return `"${key}": "${repairedVal}"`;
    });
  }

  const registerMetaTranslation = (rawId: any, transRaw: any, sourceTextMatch?: string) => {
    if (typeof transRaw !== "string") return;
    const trans = cleanVal(transRaw);
    if (!trans) return;

    if (rawId !== undefined && rawId !== null) {
      const idStr = String(rawId).trim();
      if (idStr) {
        translationMap[idStr] = trans;
        const num = parseInt(idStr.replace(/\D+/g, ""), 10);
        if (!isNaN(num)) {
          translationMap[`region_${String(num).padStart(3, "0")}`] = trans;
          translationMap[`region_${num}`] = trans;
          translationMap[String(num)] = trans;
          translationMap[`block_${num}`] = trans;
          const byReading = translationItems.find(it => it.reading_order === num);
          if (byReading) translationMap[byReading.region_id] = trans;
          if (num >= 1 && num <= translationItems.length) {
            translationMap[translationItems[num - 1].region_id] = trans;
          }
        }
      }
    }

    if (sourceTextMatch) {
      const matched = translationItems.find(it => it.source_text && it.source_text.trim() === sourceTextMatch.trim());
      if (matched) {
        translationMap[matched.region_id] = trans;
      }
    }
  };

  const extractItemTrans = (item: any): string | null => {
    if (!item) return null;
    if (typeof item === "string") return item;
    if (typeof item !== "object") return null;

    const std = (
      item.arabic_text ??
      item.translated_text ??
      item.translatedText ??
      item.translation ??
      item.arabic ??
      item.ar ??
      item.target_text ??
      item.targetText ??
      item.text ??
      item.content ??
      item.value ??
      item.val ??
      item.result ??
      item["الترجمة"] ??
      item["النص_المعرب"] ??
      item["نص_مترجم"] ??
      item["الترجمة_العربية"] ??
      null
    );
    if (typeof std === "string" && std.trim()) return std;

    const entries = Object.entries(item);
    for (const [k, v] of entries) {
      if (typeof v === "string" && v.trim() && !k.toLowerCase().includes("id") && !k.toLowerCase().includes("order") && !k.toLowerCase().includes("type") && !k.toLowerCase().includes("source") && !k.toLowerCase().includes("orig")) {
        return v;
      }
    }
    return null;
  };

  const extractItemId = (item: any): any => {
    if (!item || typeof item !== "object") return null;
    return (
      item.region_id ??
      item.regionId ??
      item.region ??
      item.id ??
      item.bubble_id ??
      item.bubbleId ??
      item.block_id ??
      item.blockId ??
      item["المعرف"] ??
      item["رقم_المنطقة"] ??
      null
    );
  };

  function processParsedList(list: any[]): boolean {
    if (!Array.isArray(list) || list.length === 0) return false;
    let found = false;
    for (let idx = 0; idx < list.length; idx++) {
      const item = list[idx];
      if (!item) continue;
      const transRaw = extractItemTrans(item);
      const rawId = extractItemId(item);
      const srcText = typeof item === "object" ? (item.source_text ?? item.original_text) : undefined;
      registerMetaTranslation(rawId, transRaw, srcText);

      if (rawId === null && idx < translationItems.length && typeof transRaw === "string") {
        registerMetaTranslation(translationItems[idx].region_id, transRaw);
      }
      if (transRaw) found = true;
    }

    // Positional fallback for any missing item if list length matches
    for (let idx = 0; idx < Math.min(list.length, translationItems.length); idx++) {
      const it = translationItems[idx];
      if (!translationMap[it.region_id]) {
        const transRaw = extractItemTrans(list[idx]);
        if (typeof transRaw === "string") {
          registerMetaTranslation(it.region_id, transRaw);
          found = true;
        }
      }
    }

    return found;
  }

  function processDict(obj: Record<string, any>) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string") {
        registerMetaTranslation(key, val);
      } else if (val && typeof val === "object") {
        const trans = extractItemTrans(val);
        const nestedId = extractItemId(val) || key;
        registerMetaTranslation(nestedId, trans);
      }
    }
  }

  let parsedSuccessfully = false;

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      parsedSuccessfully = processParsedList(parsed);
    } else if (parsed && typeof parsed === "object") {
      const list = parsed.page_translations || parsed.translations || parsed.data || parsed.results || parsed.items;
      if (Array.isArray(list)) {
        parsedSuccessfully = processParsedList(list);
      } else if (list && typeof list === "object") {
        processDict(list);
        parsedSuccessfully = Object.keys(translationMap).length > 0;
      } else {
        processDict(parsed);
        parsedSuccessfully = Object.keys(translationMap).length > 0;
      }
    }
  } catch (err) {
    try {
      const repaired = repairJsonQuotes(jsonStr);
      const parsed = JSON.parse(repaired);
      if (Array.isArray(parsed)) {
        parsedSuccessfully = processParsedList(parsed);
      } else if (parsed && typeof parsed === "object") {
        const list = parsed.page_translations || parsed.translations || parsed.data || parsed.results || parsed.items;
        if (Array.isArray(list)) {
          parsedSuccessfully = processParsedList(list);
        } else {
          processDict(parsed);
          parsedSuccessfully = Object.keys(translationMap).length > 0;
        }
      }
    } catch (_) {
      // Order-agnostic Regex extraction fallback
      const objectBlocks = [...rawText.matchAll(/\{([^{}]+)\}/g)];
      for (let idx = 0; idx < objectBlocks.length; idx++) {
        const chunk = objectBlocks[idx][1];
        const idMatch = chunk.match(/"(?:region_id|regionId|region|id|bubble_id|المعرف)"\s*:\s*("([^"]+)"|(\d+))/);
        const textMatch = chunk.match(/"(?:arabic_text|translated_text|translatedText|translation|arabic|ar|target_text|targetText|text|content|الترجمة)"\s*:\s*"([\s\S]*?)"(?=\s*(?:[,}\]]|$))/);
        if (idMatch && textMatch) {
          const rawId = (idMatch[2] || idMatch[3] || "").trim();
          const rawText = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
          registerMetaTranslation(rawId, rawText);
          parsedSuccessfully = true;
        } else if (textMatch && !idMatch && idx < translationItems.length) {
          const rawText = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
          registerMetaTranslation(translationItems[idx].region_id, rawText);
          parsedSuccessfully = true;
        }
      }

      // XML-like tags
      const tagMatches = [...rawText.matchAll(/<(?:region|block|bubble)[^>]*?(?:id|region_id)=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/(?:region|block|bubble)>/gi)];
      for (const tm of tagMatches) {
        if (tm[1] && tm[2]) {
          registerMetaTranslation(tm[1].trim(), tm[2].trim());
          parsedSuccessfully = true;
        }
      }

      // Markdown bold/bulleted ID
      const idLineMatches = [...rawText.matchAll(/(?:^|\n)\s*(?:[-*•]|\d+[\.\-\:])?\s*\*?\*?`?([a-zA-Z0-9_\-]+)`?\*?\*?\s*[:=]\s*["']?([^\n"'}]+)/g)];
      for (const lm of idLineMatches) {
        if (lm[1] && lm[2]) {
          registerMetaTranslation(lm[1].trim(), lm[2].trim());
          parsedSuccessfully = true;
        }
      }

      // Numbered lines
      const numberedLines = [...rawText.matchAll(/(?:^|\n)\s*(\d+)[\.\-\:\)]\s*([^\n]+)/g)];
      for (const nl of numberedLines) {
        const num = parseInt(nl[1], 10);
        const text = nl[2].trim();
        if (!isNaN(num) && text) {
          registerMetaTranslation(String(num), text);
          parsedSuccessfully = true;
        }
      }
    }
  }

  if (!parsedSuccessfully || Object.keys(translationMap).length === 0) {
    console.warn("Could not parse JSON from Meta AI response, using line-by-line fallback");
    const lines = rawText.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith('```') && !l.startsWith('{') && !l.startsWith('}'));
    const arabicLines = lines.filter(l => /[\u0600-\u06FF]/.test(l));
    const candidateLines = arabicLines.length >= translationItems.length ? arabicLines : lines;
    let curIdx = 0;
    for (const l of candidateLines) {
      if (curIdx < translationItems.length) {
        const cleaned = l.replace(/^\d+[\.\-\:]\s*/, "").trim();
        if (cleaned) {
          translationMap[translationItems[curIdx].region_id] = cleanVal(cleaned);
        }
        curIdx++;
      }
    }
  }

  // Build final translations strictly mapped by region_id
  const translations: string[] = translationItems.map(it => {
    return translationMap[it.region_id] || translationMap[String(it.reading_order)] || translationMap[`region_${it.reading_order}`] || "";
  });

  const page_translations_result = translationItems.map(it => ({
    region_id: it.region_id,
    reading_order: it.reading_order,
    source_text: it.source_text,
    translated_text: translationMap[it.region_id] || translationMap[String(it.reading_order)] || ""
  }));

  return {
    translations,
    translationMap,
    page_translations: page_translations_result,
    conversationId: response.conversationId,
    conversationUrl: response.conversationUrl
  };
}
