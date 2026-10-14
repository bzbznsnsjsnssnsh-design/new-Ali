import http from "http";
import https from "https";

const origHttpsRequest = https.request;
// @ts-ignore
https.request = function (...args: any[]) {
  if (args[0] && typeof args[0] === "object") args[0].maxHeaderSize = 1048576;
  if (args[1] && typeof args[1] === "object") args[1].maxHeaderSize = 1048576;
  // @ts-ignore
  return origHttpsRequest.apply(this, args);
};
const origHttpRequest = http.request;
// @ts-ignore
http.request = function (...args: any[]) {
  if (args[0] && typeof args[0] === "object") args[0].maxHeaderSize = 1048576;
  if (args[1] && typeof args[1] === "object") args[1].maxHeaderSize = 1048576;
  // @ts-ignore
  return origHttpRequest.apply(this, args);
};

import { Client, handle_file } from "@gradio/client";
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import { createServer as createViteServer, build as viteBuild } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { Communicate, listVoices } from "edge-tts-ts";
import { Gemini } from "gemini-reverse";
import { 
  resolveGeminiModelDef, 
  normalizeGeminiModel, 
  GEMINI_COOKIE_MODELS, 
  type GeminiCookieModelId 
} from "./server/geminiCookiesService.ts";
import { MANGA } from "@consumet/extensions";
import { 
  suwayomiRouter, 
  getSuwayomiUrl, 
  fetchSuwayomiMangaDetailsAndChapters, 
  fetchSuwayomiPages,
  handleSuwayomiEmbed,
  handleSuwayomiGraphQLProxy,
  handleSuwayomiV1Proxy
} from "./server/suwayomiService.ts";
import {
  applyMetaAiCookies,
  testMetaAiCookies,
  parseMetaAiCookies,
  sendMetaAiPrompt,
  translateMangaWithMetaAi,
  resetChapterMetaAiConversation,
  loadChapterMetaAiConversations
} from "./server/metaaiService.ts";
import {
  analyzeComicPage,
  reOcrRegion,
  inpaintPageText
} from "./server/comicVisionService.ts";
import {
  finalComposer,
  hybridRenderArabicPage,
  hybridInpaintPageText
} from "./server/hybrid_vision/index.ts";
import { processWithGoogleLensWorker } from "./server/googleLensWorkerService.ts";
import { colorizeMangaImage } from "./server/mangaColorizerService.ts";
import { novelToMangaRouter } from "./server/novelToMangaRouter.ts";
import { GemgenController, BrowserSession } from "./gemgen/index.ts";
import axios from "axios";
import compression from "compression";

// Configure default headers on Axios to simulate modern Chrome browser and avoid Google bot throttling
axios.defaults.headers.common["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
axios.defaults.headers.common["Accept-Language"] = "en-US,en;q=0.9,ar;q=0.8";

dotenv.config();

const currentFilename = typeof __filename !== "undefined" ? __filename : "";
const currentDirname = typeof __dirname !== "undefined"
  ? __dirname
  : (currentFilename ? path.dirname(currentFilename) : process.cwd());

const app = express();
const PORT = (process.env.NGINX_PORT && process.env.DEFAULT_APP_PORT && process.env.PORT === process.env.NGINX_PORT)
  ? (Number(process.env.DEFAULT_APP_PORT) || 3000)
  : (Number(process.env.PORT) || 3000);

// High-performance gzip/deflate compression for fast JSON/API responses (bypasses raw image proxy to avoid re-compressing JPEG/WebP)
app.use(compression({
  filter: (req, res) => {
    if (req.path.startsWith("/api/proxy-image")) return false;
    return compression.filter(req, res);
  },
  threshold: 1024,
}));

// Enable JSON body parser with increased limit for high-res manga base64 images
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cors());

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mount Suwayomi embedded proxy with auto-interception and API proxies
app.all("/suwayomi-embed/api/graphql", handleSuwayomiGraphQLProxy);
app.all("/suwayomi-embed/graphql", handleSuwayomiGraphQLProxy);
app.all("/suwayomi-embed/api/v1/*", handleSuwayomiV1Proxy);
app.all("/suwayomi-embed/api/*", handleSuwayomiV1Proxy);
app.use("/suwayomi-embed", handleSuwayomiEmbed);
app.all("/api/graphql", handleSuwayomiGraphQLProxy);
app.all("/graphql", handleSuwayomiGraphQLProxy);
app.all("/api/v1/*", handleSuwayomiV1Proxy);

// Fallback proxy for Suwayomi Web assets requested under /suwayomi-embed/assets/
app.get("/suwayomi-embed/assets/:filename", async (req, res, next) => {
  const filename = req.params.filename;
  if (/\.(js|css|png|svg|ico|woff|woff2|json|webmanifest)$/i.test(filename)) {
    try {
      const suwayomiUrl = "https://f212af09-ae8a-4d6f-be1a-59fbca80573e-00-3ctaa6lqfzq7d.sisko.replit.dev";
      const assetRes = await fetch(`${suwayomiUrl}/assets/${filename}`);
      if (assetRes.ok) {
        const ct = assetRes.headers.get("content-type");
        if (ct && !ct.includes("text/html")) {
          res.setHeader("Content-Type", ct);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "public, max-age=86400");
          const buf = await assetRes.arrayBuffer();
          return res.send(Buffer.from(buf));
        }
      }
    } catch (_) {}
  }
  next();
});

// Mount Suwayomi & Mihon/Tachiyomi Extensions API router
app.use("/api/suwayomi", suwayomiRouter);

// Mount Novel → Manga Pages 1.1 & Google Flow API router
app.use("/api", novelToMangaRouter);
app.use("/generated", express.static(path.resolve(process.cwd(), "public", "generated")));

// General Web Proxy endpoint for viewing external websites safely within the app without X-Frame-Options or CORS issues
app.get("/api/web-proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send("Missing url parameter");
  }

  let fullUrl = targetUrl.trim();
  if (!/^https?:\/\//i.test(fullUrl)) {
    fullUrl = `https://${fullUrl}`;
  }

  try {
    const parsedUrl = new URL(fullUrl);
    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ar,en-US,en;q=0.9",
      },
    });

    const contentType = response.headers.get("content-type") || "text/html; charset=utf-8";
    res.removeHeader("X-Frame-Options");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self' *;");
    res.setHeader("Content-Type", contentType);

    if (contentType.includes("text/html")) {
      let html = await response.text();
      const baseTag = `<base href="${parsedUrl.origin}/">`;
      html = html.replace(/<meta[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, "");
      html = html.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "");

      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head>${baseTag}`);
      } else {
        html = `${baseTag}${html}`;
      }
      return res.send(html);
    } else {
      const buffer = await response.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }
  } catch (err: any) {
    return res.status(502).send(`
      <!DOCTYPE html>
      <html dir="rtl">
        <head>
          <meta charset="utf-8">
          <title>تعذر عرض الموقع مضمناً</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #090d16; color: #e2e8f0; padding: 2rem; text-align: center; }
            .box { background: #131b2e; border: 1px solid #1e293b; border-radius: 1rem; padding: 2rem; max-width: 480px; margin: 3rem auto; }
            a { display: inline-block; background: #10b981; color: #022c22; text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: bold; margin-top: 1rem; }
          </style>
        </head>
        <body>
          <div class="box">
            <h3>الموقع محمي أو يتطلب فتحه مباشرة</h3>
            <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.5rem;">هذا الموقع يمنع التضمين داخل الإطارات. يمكنك فتحه مباشرة في نافذة المتصفح:</p>
            <a href="${fullUrl}" target="_blank" rel="noopener noreferrer">اضغط هنا لفتح الموقع في نافذة جديدة ↗</a>
          </div>
        </body>
      </html>
    `);
  }
});

// Lazy initialize Gemini Client
let ai: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!ai) {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "dummy-key-to-prevent-crash-if-missing",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return ai;
}

// Helper: Normalize MangaDex manga structure
function normalizeManga(item: any) {
  const attributes = item.attributes || {};
  const id = item.id;
  const title = attributes.title?.en || attributes.title?.ja || attributes.title?.["ja-ro"] || Object.values(attributes.title || {})[0] || "Unknown Title";
  const altTitles = attributes.altTitles || [];
  const description = attributes.description?.en || attributes.description?.ar || Object.values(attributes.description || {})[0] || "No description available.";
  
  // Find cover art filename
  const coverRelationship = item.relationships?.find((r: any) => r.type === "cover_art");
  const coverFileName = coverRelationship?.attributes?.fileName;
  const coverUrl = coverFileName 
    ? `https://uploads.mangadex.org/covers/${id}/${coverFileName}`
    : null;

  // Find author
  const authorRelationship = item.relationships?.find((r: any) => r.type === "author");
  const authorName = authorRelationship?.attributes?.name || "Unknown Author";

  return {
    id,
    title,
    description,
    status: attributes.status,
    year: attributes.year,
    contentRating: attributes.contentRating,
    tags: attributes.tags?.map((t: any) => t.attributes?.name?.en).filter(Boolean) || [],
    coverUrl,
    author: authorName,
    originalLanguage: attributes.originalLanguage,
  };
}

// API Routes

// --- NATIVE ARABIC 3ASQ SCRAPER ENGINE ---
async function fetch3asqSearch(query: string = "", page = 1) {
  try {
    if (!query.trim()) {
      return fetch3asqPopular(page);
    }
    const searchUrl = page === 1 
      ? `https://3asq.online/?s=${encodeURIComponent(query)}&post_type=wp-manga`
      : `https://3asq.online/page/${page}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
    const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    if (!res.ok) return [];
    const text = await res.text();
    const parts = text.split(/class="[^"]*c-tabs-item[^"]*"/).slice(1);
    const list: any[] = [];
    const seen = new Set<string>();

    for (const part of parts) {
      const linkMatch = part.match(/<h3 class="h4"><a href="([^"]+)">([^<]+)<\/a><\/h3>/);
      const imgMatch = part.match(/<img[^>]+(?:data-src|src)="([^">]+)"/);
      const chapMatch = part.match(/class="font-meta chapter"><a href="[^"]*\/([^\/"]+)\/?">([^<]+)<\/a>/);
      const statusMatch = part.match(/<div class="post-content_item mg_status">[\s\S]*?<div class="summary-content">\s*([^<]+)\s*<\/div>/);

      if (linkMatch) {
        const slugMatch = linkMatch[1].match(/\/manga\/([^\/]+)\//);
        const slug = slugMatch ? slugMatch[1] : linkMatch[1];
        if (!seen.has(slug)) {
          seen.add(slug);
          const rawChapter = chapMatch ? chapMatch[2].trim() : "";
          const parsedChNum = parseFloat(rawChapter.replace(/[^\d.]/g, ""));
          const chaptersCount = !isNaN(parsedChNum) && parsedChNum > 0 ? Math.floor(parsedChNum) : 0;
          const status = statusMatch ? statusMatch[1].trim() : "مستمرة";

          list.push({
            id: slug,
            title: linkMatch[2].replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim(),
            coverUrl: imgMatch?.[1]?.trim() || "",
            author: "عاشق المانجا",
            status,
            description: "مانجا مترجمة للعربية من شبكة عاشق المانجا",
            chaptersCount,
            latestChapter: rawChapter ? `الفصل ${rawChapter}` : undefined
          });
        }
      }
    }
    return list;
  } catch (e) {
    console.error("3asq search error:", e);
    return [];
  }
}

async function fetch3asqPopular(page = 1) {
  try {
    const targetUrl = page === 1 
      ? "https://3asq.online/" 
      : `https://3asq.online/manga/page/${page}/`;
    const res = await fetch(targetUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    if (!res.ok) return [];
    const html = await res.text();
    const list: any[] = [];
    const seen = new Set<string>();

    const regex = /<(?:div id="manga-item-\d+" class="item-thumb[^>]*|div class="page-item-detail[^>]*)([\s\S]*?)<\/div>\s*<\/div>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const chunk = match[1];
      const linkMatch = chunk.match(/<a href="([^"]+)" title="([^"]+)">/);
      const imgMatch = chunk.match(/<img[^>]+(?:data-src|src)="([^">]+)"/);
      if (linkMatch) {
        const slugMatch = linkMatch[1].match(/\/manga\/([^\/]+)\//);
        const slug = slugMatch ? slugMatch[1] : linkMatch[1];
        if (!seen.has(slug)) {
          seen.add(slug);
          list.push({
            id: slug,
            title: linkMatch[2].replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim(),
            coverUrl: imgMatch?.[1]?.trim() || "",
            author: "عاشق المانجا",
            status: "مكتملة / مستمرة",
            description: "مانجا ومانهوا مترجمة بالعربية"
          });
        }
      }
    }
    return list.slice(0, 30);
  } catch (e) {
    console.error("3asq popular error:", e);
    return [];
  }
}

async function fetch3asqInfo(slug: string) {
  try {
    const cleanSlug = String(slug || "").replace(/^(suwayomi_)?3asq_/, "").trim();
    if (!cleanSlug) return null;
    const infoUrl = `https://3asq.online/manga/${cleanSlug}/`;
    const iRes = await fetch(infoUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    const iText = await iRes.text();

    const titleMatch = iText.match(/<div class="post-title">[\s\S]*?<h1>([^<]+)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim() : cleanSlug;

    const imgMatch = iText.match(/<div class="summary_image">[\s\S]*?<img[^>]+(?:data-src|src)="([^">]+)"/i);
    const coverUrl = imgMatch ? imgMatch[1].trim() : "";

    const authorMatch = iText.match(/<div class="author-content">[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    const author = authorMatch ? authorMatch[1].trim() : "Unknown";

    const descMatch = iText.match(/<div class="description-summary">[\s\S]*?<div class="summary__content[^"]*">([\s\S]*?)<\/div>/i);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : "";

    // Fetch chapters via ajax
    const chRes = await fetch(`https://3asq.online/manga/${cleanSlug}/ajax/chapters/`, { 
      method: "POST", 
      headers: { "User-Agent": "Mozilla/5.0" } 
    });
    const chText = await chRes.text();
    const chRegex = /<li class="wp-manga-chapter[^>]*>[\s\S]*?<a href="([^"]+)">([^<]+)<\/a>/g;
    let chMatch;
    const chapters: any[] = [];
    while ((chMatch = chRegex.exec(chText)) !== null) {
      const rawTitle = chMatch[2].trim();
      const chNumMatch = rawTitle.match(/(\d+(?:\.\d+)?)/);
      const chNum = chNumMatch ? chNumMatch[1] : "0";
      chapters.push({
        id: chMatch[1].trim(),
        title: rawTitle,
        chapter: chNum,
        volume: null,
        language: "ar",
        pages: 0,
        publishAt: null,
        groupName: "3ASQ"
      });
    }

    return {
      details: {
        id: slug,
        title,
        coverUrl,
        author,
        status: "مستمرة",
        description
      },
      chapters
    };
  } catch (e) {
    console.error("3asq info error:", e);
    return null;
  }
}

async function fetch3asqPages(chapterUrl: string) {
  try {
    const res = await fetch(chapterUrl, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" 
      } 
    });
    if (!res.ok) return [];
    const text = await res.text();
    const pages: string[] = [];
    const seen = new Set<string>();

    // 1. Primary extraction: find all img tags with wp-manga-chapter-img
    const imgTagRegex = /<img\b[^>]*\bclass=["'][^"']*wp-manga-chapter-img[^"']*["'][^>]*>/gi;
    const allImgs = text.match(imgTagRegex) || [];

    for (const tag of allImgs) {
      const srcMatch = tag.match(/(?:data-src|data-full-url|src)=["']\s*([^"'\s]+)\s*["']/i);
      if (srcMatch && srcMatch[1]) {
        let u = srcMatch[1].trim();
        if (u.startsWith("//")) u = "https:" + u;
        if (!seen.has(u)) {
          seen.add(u);
          pages.push(u);
        }
      }
    }

    // 2. Fallback regex if class matching was empty
    if (pages.length === 0) {
      const fallbackRegex = /<img[^>]+(?:data-src|src)=["\s]*([^">\s]+)["\s]*class="[^"]*wp-manga-chapter-img[^"]*"/gi;
      let match;
      while ((match = fallbackRegex.exec(text)) !== null) {
        let u = match[1].trim();
        if (u.startsWith("//")) u = "https:" + u;
        if (!seen.has(u)) {
          seen.add(u);
          pages.push(u);
        }
      }
    }

    return pages;
  } catch (e) {
    console.error("3asq pages error:", e);
    return [];
  }
}

// --- NATIVE CONSUMET MEGA ENGINE API ---
const consumetProviders: Record<string, any> = {
  mangadex: new (MANGA as any).MangaDex(),
  mangapill: new (MANGA as any).MangaPill(),
  weebcentral: new (MANGA as any).WeebCentral(),
  mangakakalot: new (MANGA as any).MangaKakalot(),
  comick: new (MANGA as any).ComicK(),
  mangahere: new (MANGA as any).MangaHere(),
};

// Patch ComicK md_titles array compatibility
if (consumetProviders.comick && consumetProviders.comick.getComicData) {
  const originalGetComicData = consumetProviders.comick.getComicData.bind(consumetProviders.comick);
  consumetProviders.comick.getComicData = async (mangaId: string) => {
    const data = await originalGetComicData(mangaId);
    if (data && data.md_titles && !Array.isArray(data.md_titles)) {
      data.md_titles = Object.values(data.md_titles);
    }
    return data;
  };
}

// --- LIVE NYORA & KOTATSU MULTI-SOURCE INTEGRATION ENGINE ---
const NYORA_API_BASE = "https://api.nyora.xyz";
const NYORA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Origin": "https://web.nyora.xyz",
  "Referer": "https://web.nyora.xyz/"
};

// Global Parser Map mapping source IDs / slugs to live Kotatsu parser IDs
const nyoraParserMap = new Map<string, string>();

// Automated Source Health Check state map
interface SourceHealthState {
  status: "live" | "degraded" | "broken" | "dead";
  lastChecked: number;
  failureCount: number;
  successCount: number;
  language: string;
  anchorFallback: string;
}

const sourceHealthMap = new Map<string, SourceHealthState>();
const deadSourcesSet = new Set<string>();
const verifiedLiveSourcesSet = new Set<string>();

// Verified high-reliability anchor sources by language (Always active and healthy)
const ANCHOR_HEALTHY_SOURCES: Record<string, string[]> = {
  ar: ["consumet_3asq", "parser:ASQORG", "parser:AREASCANS", "parser:LEKMANGAORG", "consumet_mangadex_ar"],
  en: ["parser:ASURASCANS", "consumet_mangapill", "consumet_comick", "consumet_weebcentral", "consumet_mangadex_en"],
  ko: ["consumet_comick", "consumet_mangadex_ko"],
  ja: ["consumet_mangadex_ja"],
  zh: ["consumet_mangadex_zh", "consumet_mangadex_zh-hk"],
  fr: ["consumet_mangadex_fr", "parser:SCANFR"],
  es: ["consumet_mangadex_es", "parser:TMO"],
  pt: ["consumet_mangadex_pt-br", "parser:NEOXSCANS"],
  id: ["consumet_mangadex_id", "parser:KOMIKINDO"],
  tr: ["consumet_mangadex_tr"],
  ru: ["consumet_mangadex_ru", "parser:MANGALIB"],
  all: ["parser:ASURASCANS", "consumet_comick", "consumet_mangadex_en"]
};

function getHealthyAnchorForLang(lang: string = "all"): string {
  const l = (lang || "all").toLowerCase().trim();
  const list = ANCHOR_HEALTHY_SOURCES[l] || ANCHOR_HEALTHY_SOURCES["all"];
  return list[0] || "parser:ASURASCANS";
}

function resolveNyoraParser(sourceId: string = ""): string {
  if (!sourceId) return "parser:ASURASCANS";
  const raw = sourceId.trim();

  // Guard against routing Suwayomi requests through Nyora
  if (raw.toLowerCase().includes("suwayomi")) {
    return "";
  }
  
  if (raw.startsWith("parser:")) return raw;
  if (raw.startsWith("nyora_parser:")) return raw.replace(/^nyora_/, "");
  
  const clean = raw.replace(/^nyora_/, "").replace(/^consumet_/, "").trim().toLowerCase();
  
  if (nyoraParserMap.has(clean)) {
    return nyoraParserMap.get(clean)!;
  }
  if (nyoraParserMap.has(raw.toLowerCase())) {
    return nyoraParserMap.get(raw.toLowerCase())!;
  }
  
  // Try common Kotatsu parser key
  return `parser:${clean.toUpperCase()}`;
}

async function fetchNyoraPopular(parserId: string, page = 1) {
  if (!parserId || parserId.toLowerCase().includes("suwayomi")) {
    return [];
  }
  try {
    const url = `${NYORA_API_BASE}/sources/popular?id=${encodeURIComponent(parserId)}&page=${page}`;
    const res = await fetch(url, { headers: NYORA_HEADERS, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      const entries = data.entries || [];
      if (entries.length > 0) {
        return entries.map((m: any) => ({
          id: `${parserId}:::${m.url || m.id}`,
          title: m.title || "Untitled",
          coverUrl: m.largeCoverUrl || m.coverUrl || "",
          author: (m.authors || []).join(", ") || "Unknown",
          description: m.description || "",
          status: m.state || "Ongoing"
        }));
      }
    }
  } catch (e: any) {
    console.warn(`[NyoraPopular] Warning for ${parserId}:`, e.message);
  }

  // Fallback 1: latest updates from that same source
  try {
    const latestUrl = `${NYORA_API_BASE}/sources/latest?id=${encodeURIComponent(parserId)}&page=${page}`;
    const lRes = await fetch(latestUrl, { headers: NYORA_HEADERS, signal: AbortSignal.timeout(8000) });
    if (lRes.ok) {
      const lData = await lRes.json();
      const entries = lData.entries || [];
      if (entries.length > 0) {
        return entries.map((m: any) => ({
          id: `${parserId}:::${m.url || m.id}`,
          title: m.title || "Untitled",
          coverUrl: m.largeCoverUrl || m.coverUrl || "",
          author: (m.authors || []).join(", ") || "Unknown",
          description: m.description || "",
          status: m.state || "Ongoing"
        }));
      }
    }
  } catch {}

  // Fallback 2: search generic character 'a' in that source
  try {
    const sUrl = `${NYORA_API_BASE}/sources/search?id=${encodeURIComponent(parserId)}&q=a&page=${page}`;
    const sRes = await fetch(sUrl, { headers: NYORA_HEADERS, signal: AbortSignal.timeout(8000) });
    if (sRes.ok) {
      const sData = await sRes.json();
      const entries = sData.entries || [];
      if (entries.length > 0) {
        return entries.map((m: any) => ({
          id: `${parserId}:::${m.url || m.id}`,
          title: m.title || "Untitled",
          coverUrl: m.largeCoverUrl || m.coverUrl || "",
          author: (m.authors || []).join(", ") || "Unknown",
          description: m.description || "",
          status: m.state || "Ongoing"
        }));
      }
    }
  } catch {}

  return [];
}

async function fetchNyoraSearch(parserId: string, query: string = "", page = 1) {
  if (!parserId || parserId.toLowerCase().includes("suwayomi")) {
    return [];
  }
  try {
    const qParam = encodeURIComponent(query || "");
    const url = `${NYORA_API_BASE}/sources/search?id=${encodeURIComponent(parserId)}&q=${qParam}&query=${qParam}&page=${page}`;
    const res = await fetch(url, { headers: NYORA_HEADERS, signal: AbortSignal.timeout(9000) });
    if (res.ok) {
      const data = await res.json();
      const entries = data.entries || [];
      if (entries.length > 0) {
        return entries.map((m: any) => ({
          id: `${parserId}:::${m.url || m.id}`,
          title: m.title || "Untitled",
          coverUrl: m.largeCoverUrl || m.coverUrl || "",
          author: (m.authors || []).join(", ") || "Unknown",
          description: m.description || "",
          status: m.state || "Ongoing"
        }));
      }
    }
  } catch (e: any) {
    console.warn(`[NyoraSearch] Warning for ${parserId}:`, e.message);
  }

  // If query is empty or failed to return search entries, fallback to full catalog / popular for this page
  if (!query || !query.trim()) {
    return fetchNyoraPopular(parserId, page);
  }

  return [];
}

async function fetchNyoraDetails(parserId: string, mangaUrl: string) {
  if (!parserId || parserId.toLowerCase().includes("suwayomi")) {
    return null;
  }
  try {
    const url = `${NYORA_API_BASE}/manga/details?id=${encodeURIComponent(parserId)}&url=${encodeURIComponent(mangaUrl)}`;
    const res = await fetch(url, { headers: NYORA_HEADERS, signal: AbortSignal.timeout(9000) });
    if (res.ok) {
      const data = await res.json();
      const chapters = (data.chapters || []).map((ch: any) => ({
        id: `${parserId}:::${ch.url || ch.id}`,
        title: ch.title || `الفصل ${ch.number || "0"}`,
        chapterNumber: String(ch.number || "0"),
        volumeNumber: null,
        language: "all",
        pages: ch.pages?.length || 0,
        releaseDate: ch.uploadDate || null,
        scanlator: ch.scanlator || ""
      }));

      return {
        details: {
          id: `${parserId}:::${mangaUrl}`,
          title: data.title || "Manga Details",
          coverUrl: data.largeCoverUrl || data.coverUrl || "",
          description: data.description || "",
          author: (data.authors || []).join(", ") || "Unknown",
          status: data.state || "Ongoing"
        },
        chapters
      };
    }
  } catch (e: any) {
    console.error(`[NyoraDetails] Error for ${parserId}:`, e.message);
  }
  return null;
}

async function fetchNyoraPages(parserId: string, chapterUrl: string): Promise<string[]> {
  if (!parserId || parserId.toLowerCase().includes("suwayomi")) {
    return [];
  }
  try {
    const url = `${NYORA_API_BASE}/manga/pages?id=${encodeURIComponent(parserId)}&url=${encodeURIComponent(chapterUrl)}`;
    const res = await fetch(url, { headers: NYORA_HEADERS, signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      const rawList = data.pages || [];
      const imageUrls = rawList.map((p: any) => {
        let rawUrl = p.url || p;
        let referer = "";
        if (typeof rawUrl === "string" && (rawUrl.includes("?u=") || rawUrl.includes("&u="))) {
          try {
            const uObj = new URL(rawUrl);
            const realU = uObj.searchParams.get("u");
            const h = uObj.searchParams.get("h");
            if (realU) rawUrl = realU;
            if (h && h.toLowerCase().startsWith("referer:")) referer = h.slice(8).trim();
          } catch {}
        }
        if (referer) {
          return `/api/proxy-image?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(referer)}`;
        }
        return `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
      }).filter(Boolean);
      return imageUrls;
    }
  } catch (e: any) {
    console.error(`[NyoraPages] Error for ${parserId}:`, e.message);
  }
  return [];
}

function parseProvider(raw: string = "") {
  const clean = raw.replace(/^consumet_/, "").trim();
  if (clean.toLowerCase().includes("suwayomi") || raw.toLowerCase().includes("suwayomi")) {
    return { type: "suwayomi", lang: "all", parserId: "", sourceId: raw };
  }
  if (!clean || clean === "3asq") {
    return { type: "3asq", lang: "ar" };
  }
  if (clean === "comick") return { type: "comick", lang: "ko" };
  if (clean === "mangapill") return { type: "mangapill", lang: "en" };
  if (clean === "weebcentral") return { type: "weebcentral", lang: "en" };
  if (clean === "mangahere") return { type: "mangahere", lang: "en" };
  if (clean === "mangakakalot") return { type: "mangakakalot", lang: "en" };

  if (clean.startsWith("mangadex")) {
    const parts = clean.split("_");
    const lang = parts.length > 1 ? parts.slice(1).join("_") : "en";
    return { type: "mangadex", lang };
  }

  // Any other source is treated as a dynamic live Nyora/Kotatsu parser
  const parserId = resolveNyoraParser(raw);
  if (!parserId) {
    return { type: "unknown", lang: "all", parserId: "", sourceId: raw };
  }
  return { type: "nyora", lang: "all", parserId, sourceId: raw };
}

interface GlobalSourceItem {
  id: string;
  name: string;
  language: string;
  status: "live" | "offline";
  domain?: string;
  engine?: string;
  icon?: string;
}

let cachedGlobalSources: GlobalSourceItem[] | null = null;
let lastGlobalSourcesFetch = 0;
const GLOBAL_SOURCES_TTL = 1000 * 60 * 60; // 1 hour cache

async function getGlobalSources(): Promise<GlobalSourceItem[]> {
  const now = Date.now();
  if (cachedGlobalSources && now - lastGlobalSourcesFetch < GLOBAL_SOURCES_TTL) {
    return cachedGlobalSources;
  }

  // Base list of verified omni-language providers across the globe
  const baseSources: GlobalSourceItem[] = [
    // Arabic
    { id: "consumet_3asq", name: "3asq (عاشق المانجا والمانهوا)", language: "ar", status: "live" },
    { id: "consumet_mangadex_ar", name: "MangaDex (مانجا مترجمة عربي)", language: "ar", status: "live" },
    // English
    { id: "consumet_mangapill", name: "MangaPill (سريع وبدقة عالية)", language: "en", status: "live" },
    { id: "consumet_mangadex_en", name: "MangaDex Global (English)", language: "en", status: "live" },
    { id: "consumet_weebcentral", name: "WeebCentral (HD Releases)", language: "en", status: "live" },
    { id: "consumet_mangahere", name: "MangaHere (Classic Archive)", language: "en", status: "live" },
    { id: "consumet_mangakakalot", name: "MangaKakalot (Massive Archive)", language: "en", status: "live" },
    // Korean / Manhwa
    { id: "consumet_comick", name: "ComicK (مانهوا كورية ومانجا)", language: "ko", status: "live" },
    { id: "consumet_mangadex_ko", name: "MangaDex Manhwa (مانهوا كورية أصلية)", language: "ko", status: "live" },
    // Japanese / Manga
    { id: "consumet_mangadex_ja", name: "MangaDex Manga (مانجا يابانية أصلية)", language: "ja", status: "live" },
    // Chinese / Manhua
    { id: "consumet_mangadex_zh", name: "MangaDex Manhua (مانها صينية أصلية)", language: "zh", status: "live" },
    { id: "consumet_mangadex_zh-hk", name: "MangaDex (中文 - Hong Kong)", language: "zh-hk", status: "live" },
    // French
    { id: "consumet_mangadex_fr", name: "MangaDex (Français)", language: "fr", status: "live" },
    // Spanish
    { id: "consumet_mangadex_es", name: "MangaDex (Español)", language: "es", status: "live" },
    { id: "consumet_mangadex_es-la", name: "MangaDex (Español - LATAM)", language: "es-la", status: "live" },
    // German
    { id: "consumet_mangadex_de", name: "MangaDex (Deutsch)", language: "de", status: "live" },
    // Portuguese
    { id: "consumet_mangadex_pt-br", name: "MangaDex (Português - Brasil)", language: "pt-br", status: "live" },
    { id: "consumet_mangadex_pt", name: "MangaDex (Português - Portugal)", language: "pt", status: "live" },
    // Italian
    { id: "consumet_mangadex_it", name: "MangaDex (Italiano)", language: "it", status: "live" },
    // Turkish
    { id: "consumet_mangadex_tr", name: "MangaDex (Türkçe)", language: "tr", status: "live" },
    // Russian
    { id: "consumet_mangadex_ru", name: "MangaDex (Русский)", language: "ru", status: "live" },
    // Hindi
    { id: "consumet_mangadex_hi", name: "MangaDex (हिन्दी - Hindi)", language: "hi", status: "live" },
    // Indonesian
    { id: "consumet_mangadex_id", name: "MangaDex (Bahasa Indonesia)", language: "id", status: "live" },
    // Thai
    { id: "consumet_mangadex_th", name: "MangaDex (ไทย - Thai)", language: "th", status: "live" },
    // Vietnamese
    { id: "consumet_mangadex_vi", name: "MangaDex (Tiếng Việt)", language: "vi", status: "live" },
    // Polish
    { id: "consumet_mangadex_pl", name: "MangaDex (Polski)", language: "pl", status: "live" },
    // Ukrainian
    { id: "consumet_mangadex_uk", name: "MangaDex (Українська)", language: "uk", status: "live" },
    // Czech
    { id: "consumet_mangadex_cs", name: "MangaDex (Čeština)", language: "cs", status: "live" },
    // Hungarian
    { id: "consumet_mangadex_hu", name: "MangaDex (Magyar)", language: "hu", status: "live" },
    // Malay
    { id: "consumet_mangadex_ms", name: "MangaDex (Bahasa Melayu)", language: "ms", status: "live" },
    // Dutch
    { id: "consumet_mangadex_nl", name: "MangaDex (Nederlands)", language: "nl", status: "live" },
    // Swedish
    { id: "consumet_mangadex_sv", name: "MangaDex (Svenska)", language: "sv", status: "live" },
    // Persian
    { id: "consumet_mangadex_fa", name: "MangaDex (فارسی - Persian)", language: "fa", status: "live" },
    // Hebrew
    { id: "consumet_mangadex_he", name: "MangaDex (עברית - Hebrew)", language: "he", status: "live" },
    // Greek
    { id: "consumet_mangadex_el", name: "MangaDex (Ελληνικά - Greek)", language: "el", status: "live" },
    // Romanian
    { id: "consumet_mangadex_ro", name: "MangaDex (Română)", language: "ro", status: "live" },
    // Bulgarian
    { id: "consumet_mangadex_bg", name: "MangaDex (Български)", language: "bg", status: "live" },
    // Filipino
    { id: "consumet_mangadex_fil", name: "MangaDex (Filipino)", language: "fil", status: "live" },
    // Bengali
    { id: "consumet_mangadex_bn", name: "MangaDex (বাংলা - Bengali)", language: "bn", status: "live" }
  ];

  let nyoraSources: GlobalSourceItem[] = [];

  // 1. Fetch live sources from Nyora API directly (contains live Kotatsu parser IDs)
  try {
    const apiRes = await fetch(`${NYORA_API_BASE}/sources`, {
      headers: NYORA_HEADERS,
      signal: AbortSignal.timeout(6000)
    }).catch(() => null);

    if (apiRes && apiRes.ok) {
      const apiData = await apiRes.json();
      const sourcesList = (apiData.sources || []) as any[];
      console.log(`[GlobalSources] Loaded ${sourcesList.length} sources from api.nyora.xyz/sources`);

      for (const s of sourcesList) {
        if (!s.id) continue;
        const pid = s.id;
        const cleanId = s.id.replace(/^parser:/i, "").toLowerCase();
        nyoraParserMap.set(pid.toLowerCase(), pid);
        nyoraParserMap.set(cleanId, pid);
        nyoraParserMap.set(`nyora_${cleanId}`, pid);
        if (s.name) {
          nyoraParserMap.set(s.name.toLowerCase().trim(), pid);
        }

        const langCode = (s.lang || "all").toLowerCase().trim();
        nyoraSources.push({
          id: `nyora_${cleanId}`,
          name: s.name || cleanId,
          language: langCode || "all",
          status: "live" as const,
          domain: s.baseUrl || "",
          engine: "Nyora",
          icon: s.iconUrl || ""
        });
      }
    }
  } catch (err: any) {
    console.warn("[GlobalSources] Notice from api.nyora.xyz/sources:", err.message || err);
  }

  // 2. Also fetch catalogue.json from repository/CDN to ensure all 695+ sources are present
  try {
    let nyoraRes = await fetch("https://nyora.xyz/catalogue.json", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000)
    }).catch(() => null);

    let nyoraData: any = null;
    if (nyoraRes && nyoraRes.ok) {
      const text = await nyoraRes.text();
      if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
        try { nyoraData = JSON.parse(text); } catch {}
      }
    }

    if (!nyoraData || (!nyoraData.sources && !Array.isArray(nyoraData))) {
      const rawRes = await fetch("https://raw.githubusercontent.com/Nyora-Manga/nyora-data-driven/main/catalogue.json", {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000)
      });
      if (rawRes.ok) {
        nyoraData = await rawRes.json();
      }
    }

    const rawList = (nyoraData?.sources || (Array.isArray(nyoraData) ? nyoraData : [])) as any[];
    console.log(`[GlobalSources] Loaded ${rawList.length} sources from Nyora catalogue.json.`);

    for (const s of rawList) {
      if (s.name && s.id) {
        // Automated Source Health Check: eliminate broken, offline or disabled sources
        if (s.broken === true || s.status === "broken" || s.disabled === true) {
          continue;
        }

        const cleanId = s.id.toLowerCase().replace(/^nyora_/, "");
        const parserId = `parser:${cleanId.toUpperCase()}`;
        if (!nyoraParserMap.has(cleanId)) {
          nyoraParserMap.set(cleanId, parserId);
          nyoraParserMap.set(`nyora_${cleanId}`, parserId);
          nyoraParserMap.set(s.name.toLowerCase().trim(), parserId);
        }

        const langCode = (s.lang || s.language || "all").toLowerCase().trim();
        nyoraSources.push({
          id: `nyora_${cleanId}`,
          name: s.name,
          language: langCode || "all",
          status: "live" as const,
          domain: s.domain,
          engine: s.engine || "Nyora",
          icon: s.icon
        });
      }
    }
  } catch (err: any) {
    console.warn("[GlobalSources] Notice while fetching Nyora catalogue:", err.message || err);
  }

  // Combine and deduplicate
  const combined = [...baseSources];
  const existingIds = new Set(baseSources.map(s => s.id));

  for (const ns of nyoraSources) {
    if (!existingIds.has(ns.id) && !deadSourcesSet.has(ns.id)) {
      existingIds.add(ns.id);
      combined.push(ns);
    }
  }

  // Filter out any dead or offline sources
  const liveOnly = combined.filter(s => !deadSourcesSet.has(s.id) && s.status !== "offline");
  cachedGlobalSources = liveOnly;
  lastGlobalSourcesFetch = now;
  return liveOnly;
}

// Automated Source Health Check & Intelligent Fallback Executor
async function fetchDirectoryWithHealthCheck(options: {
  provider: string;
  query?: string;
  page?: number;
  lang?: string;
}) {
  const { provider = "", query = "", page = 1, lang = "all" } = options;
  const { type, parserId, lang: parsedLang } = parseProvider(provider);
  const effectiveLang = lang || parsedLang || "all";
  let results: any[] = [];
  let isSubstituted = false;
  let activeProvider = provider;

  // 1. Try requested primary provider
  try {
    if (type === "3asq") {
      results = query ? await fetch3asqSearch(query, page) : await fetch3asqPopular(page);
    } else if (type === "nyora" && parserId) {
      results = query ? await fetchNyoraSearch(parserId, query, page) : await fetchNyoraPopular(parserId, page);
    } else if (type === "mangadex") {
      const offset = (page - 1) * 24;
      let filterParam = "";
      if (effectiveLang && effectiveLang !== "all") {
        if (effectiveLang === "ko" || effectiveLang === "ja" || effectiveLang === "zh") {
          filterParam = `originalLanguage[]=${effectiveLang}&`;
        } else {
          filterParam = `availableTranslatedLanguage[]=${effectiveLang}&`;
        }
      }
      const titleParam = query ? `title=${encodeURIComponent(query)}&` : "";
      const mdUrl = `https://api.mangadex.org/manga?limit=24&offset=${offset}&${titleParam}${filterParam}order[followedCount]=desc&includes[]=cover_art&includes[]=author`;
      const mdRes = await fetch(mdUrl, { signal: AbortSignal.timeout(8000) });
      if (mdRes.ok) {
        const data = await mdRes.json();
        results = (data.data || []).map(normalizeManga);
      }
    } else {
      const engine = consumetProviders[type];
      if (engine) {
        if (query) {
          const res = await engine.search(query, page).catch(() => ({ results: [] }));
          results = (res.results || []).map((m: any) => ({
            id: m.id,
            title: m.title,
            coverUrl: m.image || "",
            author: m.author || "Unknown",
            status: m.status || "Unknown",
            description: m.description || ""
          }));
        } else {
          let res: any = { results: [] };
          if (type === "comick") res = await engine.search("manhwa", page).catch(() => ({ results: [] }));
          else if (type === "weebcentral") res = await engine.search("the", page).catch(() => ({ results: [] }));
          else if (engine.fetchPopular) res = await engine.fetchPopular(page).catch(() => ({ results: [] }));
          if (!res.results || res.results.length === 0) {
            res = await engine.search("a", page).catch(() => ({ results: [] }));
          }
          results = (res.results || []).map((m: any) => ({
            id: m.id,
            title: m.title,
            coverUrl: m.image || "",
            author: m.author || "Unknown",
            status: m.status || "Unknown",
            description: m.description || ""
          }));
        }
      }
    }
  } catch (err: any) {
    console.warn(`[DirectoryHealthCheck] Primary provider ${provider} failed:`, err.message);
  }

  // Update health status
  if (results.length > 0) {
    sourceHealthMap.set(provider, {
      status: "live",
      lastChecked: Date.now(),
      failureCount: 0,
      successCount: (sourceHealthMap.get(provider)?.successCount || 0) + 1,
      language: effectiveLang,
      anchorFallback: ""
    });
    verifiedLiveSourcesSet.add(provider);
  } else {
    // 2. ABSOLUTE SOURCE ISOLATION:
    // If provider returns 0 results or fails, record failure status but DO NOT inject other sources' catalogs!
    const currentHealth = sourceHealthMap.get(provider);
    const newFailureCount = (currentHealth?.failureCount || 0) + 1;
    const isDead = newFailureCount >= 3;

    sourceHealthMap.set(provider, {
      status: isDead ? "dead" : "degraded",
      lastChecked: Date.now(),
      failureCount: newFailureCount,
      successCount: currentHealth?.successCount || 0,
      language: effectiveLang,
      anchorFallback: ""
    });

    if (isDead) {
      deadSourcesSet.add(provider);
      console.warn(`[SourceIsolation] Source ${provider} marked dead after ${newFailureCount} failures. Purging from live sources.`);
      if (cachedGlobalSources) {
        cachedGlobalSources = cachedGlobalSources.filter(s => s.id !== provider);
      }
    }

    // Return empty results cleanly for this source without borrowing works from other websites
    results = [];
    isSubstituted = false;
    activeProvider = provider;
  }

  return {
    results,
    count: results.length,
    page,
    provider,
    activeProvider,
    substituted: false,
    message: results.length === 0 ? "لا توجد أعمال متاحة في هذا المصدر حالياً أو تعذر الاتصال بخادمه" : undefined
  };
}

// 1. Sources Endpoints (Zero direct browser requests target)
app.get(["/api/sources/global", "/api/nyora/catalogue", "/api/nyora/sources"], async (req, res) => {
  try {
    const sources = await getGlobalSources();
    const languages = Array.from(new Set(sources.map(s => s.language))).filter(Boolean).sort();
    res.json({ sources, languages, total: sources.length });
  } catch (error: any) {
    console.error("Global sources error:", error);
    res.status(500).json({ error: error.message || "Failed to load global sources" });
  }
});

// Automated Health Check Status Endpoint
app.get("/api/sources/health", (req, res) => {
  const healthList: any[] = [];
  sourceHealthMap.forEach((val, key) => {
    healthList.push({ sourceId: key, ...val });
  });
  res.json({
    totalTracked: healthList.length,
    liveCount: healthList.filter(h => h.status === "live").length,
    degradedCount: healthList.filter(h => h.status === "degraded").length,
    deadCount: healthList.filter(h => h.status === "dead").length,
    sources: healthList
  });
});

// Live background health checker for the source catalog (probes sources continuously)
let healthCheckBatchIndex = 0;
async function runBackgroundHealthCheckBatch() {
  try {
    const sources = cachedGlobalSources || [];
    if (sources.length === 0) return;

    const batchSize = 10;
    const batch = sources.slice(healthCheckBatchIndex, healthCheckBatchIndex + batchSize);
    healthCheckBatchIndex = (healthCheckBatchIndex + batchSize) % sources.length;

    await Promise.allSettled(batch.map(async (source) => {
      if (deadSourcesSet.has(source.id)) return;

      let isLive = false;
      const { type, parserId } = parseProvider(source.id);

      try {
        if (source.domain) {
          const testUrl = source.domain.startsWith("http") ? source.domain : `https://${source.domain}`;
          const headRes = await fetch(testUrl, {
            method: "HEAD",
            signal: AbortSignal.timeout(3000),
            headers: { "User-Agent": "Mozilla/5.0" }
          }).catch(() => null);

          if (headRes && (headRes.ok || headRes.status === 403 || headRes.status === 301 || headRes.status === 302)) {
            isLive = true;
          }
        }

        if (!isLive && type === "nyora" && parserId) {
          const testItems = await fetchNyoraPopular(parserId, 1).catch(() => []);
          if (testItems.length > 0) {
            isLive = true;
          }
        }

        if (!isLive && (consumetProviders[type] || type === "mangadex" || type === "3asq")) {
          isLive = true;
        }

        if (isLive) {
          verifiedLiveSourcesSet.add(source.id);
          sourceHealthMap.set(source.id, {
            status: "live",
            lastChecked: Date.now(),
            failureCount: 0,
            successCount: (sourceHealthMap.get(source.id)?.successCount || 0) + 1,
            language: source.language,
            anchorFallback: ""
          });
        } else {
          deadSourcesSet.add(source.id);
          sourceHealthMap.set(source.id, {
            status: "dead",
            lastChecked: Date.now(),
            failureCount: 5,
            successCount: 0,
            language: source.language,
            anchorFallback: ""
          });
          if (cachedGlobalSources) {
            cachedGlobalSources = cachedGlobalSources.filter(s => s.id !== source.id);
          }
        }
      } catch {
        deadSourcesSet.add(source.id);
      }
    }));
  } catch (err: any) {
    console.warn("[BackgroundHealthCheck] Batch check error:", err.message);
  }
}

// Run periodic live health checker every 25 seconds in background
setInterval(runBackgroundHealthCheckBatch, 25000);

// --- SEAMLESS CHAPTER-LEVEL SUBSTITUTION ENGINE ---
interface ChapterSubstitutionResult {
  pages: string[];
  providerName: string;
  providerId: string;
}

async function findSeamlessChapterSubstitution(params: {
  mangaTitle: string;
  chapterNumber: string;
  language?: string;
  excludeSource?: string;
}): Promise<ChapterSubstitutionResult | null> {
  const { mangaTitle, chapterNumber, language = "ar", excludeSource = "" } = params;
  if (!mangaTitle || !mangaTitle.trim()) return null;

  const cleanTitle = mangaTitle
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const targetChNum = parseFloat(chapterNumber.replace(/[^0-9.]/g, "")) || 1;
  const isArabic = /[\u0600-\u06FF]/.test(cleanTitle) || language === "ar";

  console.info(`[ChapterSubstitution] Searching live substitution for: "${cleanTitle}" Ch ${chapterNumber} (Lang: ${language}, Exclude: ${excludeSource})`);

  interface SubstitutionCandidate {
    id: string;
    name: string;
    search: (q: string) => Promise<any[]>;
    getChapters: (id: string) => Promise<any[]>;
    getPages: (cId: string) => Promise<string[]>;
  }

  const candidates: SubstitutionCandidate[] = [];

  // Arabic Candidate: 3asq
  if (isArabic && excludeSource !== "3asq" && excludeSource !== "consumet_3asq") {
    candidates.push({
      id: "consumet_3asq",
      name: "العاشق (3asq)",
      search: async (q) => fetch3asqSearch(q, 1),
      getChapters: async (mId) => (await fetch3asqInfo(mId)).chapters || [],
      getPages: async (cId) => fetch3asqPages(cId),
    });
  }

  // ComicK (Manhwa / Korean / English)
  if (excludeSource !== "consumet_comick" && consumetProviders.comick) {
    candidates.push({
      id: "consumet_comick",
      name: "ComicK",
      search: async (q) => {
        const res = await consumetProviders.comick.search(q, 1).catch(() => ({ results: [] }));
        return res.results || [];
      },
      getChapters: async (mId) => {
        const info = await consumetProviders.comick.fetchMangaInfo(mId).catch(() => ({ chapters: [] }));
        return info.chapters || [];
      },
      getPages: async (cId) => {
        const p = await consumetProviders.comick.fetchChapterPages(cId).catch(() => []);
        return (p || []).map((x: any) => x.img || x.url || x).filter(Boolean);
      }
    });
  }

  // MangaPill
  if (excludeSource !== "consumet_mangapill" && consumetProviders.mangapill) {
    candidates.push({
      id: "consumet_mangapill",
      name: "MangaPill",
      search: async (q) => {
        const res = await consumetProviders.mangapill.search(q, 1).catch(() => ({ results: [] }));
        return res.results || [];
      },
      getChapters: async (mId) => {
        const info = await consumetProviders.mangapill.fetchMangaInfo(mId).catch(() => ({ chapters: [] }));
        return info.chapters || [];
      },
      getPages: async (cId) => {
        const p = await consumetProviders.mangapill.fetchChapterPages(cId).catch(() => []);
        return (p || []).map((x: any) => x.img || x.url || x).filter(Boolean);
      }
    });
  }

  // MangaDex (Global / Multilingual)
  if (!excludeSource.includes("mangadex")) {
    candidates.push({
      id: "consumet_mangadex",
      name: "MangaDex",
      search: async (q) => {
        const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(q)}&limit=5&includes[]=cover_art`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) }).catch(() => null);
        if (!res || !res.ok) return [];
        const data = await res.json();
        return (data.data || []).map(normalizeManga);
      },
      getChapters: async (mId) => {
        const langFilter = language && language !== "all" ? `&translatedLanguage[]=${language}` : "";
        const url = `https://api.mangadex.org/manga/${mId}/feed?limit=100&order[chapter]=desc${langFilter}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) }).catch(() => null);
        if (!res || !res.ok) return [];
        const data = await res.json();
        return (data.data || []).map((ch: any) => ({
          id: ch.id,
          chapter: ch.attributes?.chapter || "",
          title: ch.attributes?.title || ""
        }));
      },
      getPages: async (cId) => {
        const atHomeUrl = `https://api.mangadex.org/at-home/server/${cId}`;
        const res = await fetch(atHomeUrl, { signal: AbortSignal.timeout(6000) }).catch(() => null);
        if (!res || !res.ok) return [];
        const data = await res.json();
        if (!data.chapter?.data) return [];
        const baseUrl = data.baseUrl || "https://uploads.mangadex.org";
        const hash = data.chapter.hash;
        return data.chapter.data.map((f: string) => `${baseUrl}/data/${hash}/${f}`);
      }
    });
  }

  // WeebCentral
  if (excludeSource !== "consumet_weebcentral" && consumetProviders.weebcentral) {
    candidates.push({
      id: "consumet_weebcentral",
      name: "WeebCentral",
      search: async (q) => {
        const res = await consumetProviders.weebcentral.search(q, 1).catch(() => ({ results: [] }));
        return res.results || [];
      },
      getChapters: async (mId) => {
        const info = await consumetProviders.weebcentral.fetchMangaInfo(mId).catch(() => ({ chapters: [] }));
        return info.chapters || [];
      },
      getPages: async (cId) => {
        const p = await consumetProviders.weebcentral.fetchChapterPages(cId).catch(() => []);
        return (p || []).map((x: any) => x.img || x.url || x).filter(Boolean);
      }
    });
  }

  for (const candidate of candidates) {
    try {
      const results = await candidate.search(cleanTitle);
      if (!results || results.length === 0) continue;

      const matchedManga = results[0];
      if (!matchedManga?.id) continue;

      const chapters = await candidate.getChapters(matchedManga.id);
      if (!chapters || chapters.length === 0) continue;

      const targetCh = chapters.find((ch: any) => {
        const chNumStr = String(ch.chapter || ch.chapterNumber || "").trim();
        const chNum = parseFloat(chNumStr.replace(/[^0-9.]/g, ""));
        if (!isNaN(chNum) && chNum === targetChNum) return true;
        if (chNumStr === String(targetChNum) || chNumStr === chapterNumber) return true;
        const titleStr = String(ch.title || "");
        if (titleStr.includes(`الفصل ${targetChNum}`) || titleStr.includes(`Chapter ${targetChNum}`)) return true;
        return false;
      }) || (targetChNum === 1 ? chapters[chapters.length - 1] : null);

      if (!targetCh?.id) continue;

      const rawPages = await candidate.getPages(targetCh.id);
      if (rawPages && rawPages.length > 0) {
        const proxiedPages = rawPages.map((url: string) => {
          if (url.startsWith("/api/proxy-image") || url.startsWith("data:")) return url;
          return `/api/proxy-image?url=${encodeURIComponent(url)}`;
        });

        console.info(`[ChapterSubstitution] SUCCESS: Substituted Ch ${chapterNumber} with ${candidate.name} (${proxiedPages.length} real pages)`);
        return {
          pages: proxiedPages,
          providerName: candidate.name,
          providerId: candidate.id
        };
      }
    } catch (e: any) {
      console.warn(`[ChapterSubstitution] Candidate ${candidate.name} failed:`, e.message);
    }
  }

  return null;
}

// 2. ENFORCED NYORA API TUNNELING ENDPOINTS
// - Manga Details & Chapters Tunnel
app.get(["/api/nyora/manga/:sourceId/:mangaId(*)", "/api/nyora/manga", "/api/nyora/chapters", "/api/nyora/info"], async (req, res) => {
  try {
    const sourceId = (req.params.sourceId || req.query.sourceId || req.query.provider || "").toString().trim();
    const mangaId = (req.params.mangaId || req.query.mangaId || req.query.id || "").toString().trim();
    
    if (!mangaId) {
      return res.status(400).json({ error: "mangaId is required" });
    }

    // Direct Suwayomi route handling
    if (sourceId.toLowerCase().includes("suwayomi") || mangaId.toLowerCase().includes("suwayomi")) {
      const suwUrl = getSuwayomiUrl(req);
      const cleanMangaId = mangaId.replace(/^suwayomi_/, "");
      const suwData = await fetchSuwayomiMangaDetailsAndChapters(suwUrl, cleanMangaId);
      if (suwData) {
        return res.json(suwData);
      }
    }

    const parserId = resolveNyoraParser(sourceId);
    let detailsData: any = null;

    if (mangaId.includes(":::")) {
      const [pid, chUrl] = mangaId.split(":::");
      detailsData = await fetchNyoraDetails(pid, chUrl);
    } else {
      detailsData = await fetchNyoraDetails(parserId, mangaId);
    }

    // Resilient Fallback: if chapters are empty, check Consumet / MangaDex mirrors
    if (!detailsData || !detailsData.chapters || detailsData.chapters.length === 0) {
      const { type, lang } = parseProvider(sourceId);
      if (type !== "nyora") {
        const engine = consumetProviders[type];
        if (engine) {
          const cInfo = await engine.fetchMangaInfo(mangaId).catch(() => null);
          if (cInfo) {
            detailsData = {
              details: {
                id: cInfo.id,
                title: cInfo.title,
                coverUrl: cInfo.image || "",
                description: cInfo.description || "",
                author: cInfo.author || "Unknown",
                status: cInfo.status || "Ongoing"
              },
              chapters: (cInfo.chapters || []).map((ch: any) => ({
                id: ch.id,
                title: ch.title || `الفصل ${ch.chapterNumber || "0"}`,
                chapterNumber: String(ch.chapterNumber || "0"),
                volumeNumber: null,
                language: lang || "all",
                pages: ch.pages || 0,
                releaseDate: ch.releaseDate || null
              }))
            };
          }
        }
      }
    }

    if (!detailsData) {
      return res.status(404).json({ error: "Manga details not found" });
    }

    return res.json(detailsData);
  } catch (error: any) {
    console.error("[NyoraMangaTunnel] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// - Search & Directory Tunnel with Health Check
app.get(["/api/nyora/search", "/api/nyora/popular", "/api/nyora/directory"], async (req, res) => {
  try {
    const sourceId = (req.query.sourceId || req.query.provider || req.query.id || "").toString().trim();
    const query = (req.query.query || req.query.q || "").toString().trim();
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const lang = (req.query.lang || "").toString().trim();

    const data = await fetchDirectoryWithHealthCheck({
      provider: sourceId,
      query,
      page,
      lang
    });
    return res.json(data);
  } catch (error: any) {
    console.error("[NyoraSearchTunnel] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// - Chapter Pages Tunnel
app.get("/api/nyora/pages", async (req, res) => {
  try {
    const sourceId = (req.query.sourceId || req.query.provider || "").toString().trim();
    const chapterId = (req.query.chapterId || req.query.chapterUrl || req.query.id || "").toString().trim();
    const mangaTitle = (req.query.mangaTitle || req.query.title || "").toString().trim();
    const chapterNumber = (req.query.chapterNumber || req.query.chapter || "1").toString().trim();
    const lang = (req.query.lang || req.query.language || "").toString().trim();

    if (!chapterId) {
      return res.status(400).json({ error: "chapterId is required" });
    }

    // Direct Suwayomi chapter pages handling
    if (chapterId.toLowerCase().includes("suwayomi") || sourceId.toLowerCase().includes("suwayomi")) {
      const suwUrl = getSuwayomiUrl(req);
      const cleanChapterId = chapterId.replace(/^suwayomi_/, "");
      const suwPages = await fetchSuwayomiPages(suwUrl, cleanChapterId);
      if (suwPages.length > 0) {
        return res.json({ pages: suwPages, count: suwPages.length });
      }
    }

    let pages: string[] = [];
    if (chapterId.includes(":::")) {
      const [pid, chUrl] = chapterId.split(":::");
      pages = await fetchNyoraPages(pid, chUrl);
    } else {
      const parserId = resolveNyoraParser(sourceId);
      pages = await fetchNyoraPages(parserId, chapterId);
    }

    if (pages.length === 0) {
      const { type } = parseProvider(sourceId);
      const engine = consumetProviders[type];
      if (engine && engine.fetchChapterPages) {
        try {
          const cPages = await engine.fetchChapterPages(chapterId);
          pages = (cPages || []).map((p: any) => `/api/proxy-image?url=${encodeURIComponent(p.img || p.url || p)}`);
        } catch {}
      }
    }

    // Seamless Chapter-Level Substitution Engine fallback
    if (pages.length === 0 && mangaTitle) {
      console.info(`[NyoraPages] Primary fetch empty for "${mangaTitle}" Ch ${chapterNumber}. Initiating seamless chapter substitution...`);
      const sub = await findSeamlessChapterSubstitution({
        mangaTitle,
        chapterNumber,
        language: lang,
        excludeSource: sourceId
      });
      if (sub && sub.pages.length > 0) {
        return res.json({ pages: sub.pages, count: sub.pages.length, substituted: true, providerName: sub.providerName });
      }
    }

    return res.json({ pages, count: pages.length });
  } catch (error: any) {
    console.error("[NyoraPagesTunnel] Error:", error.message);
    const mangaTitle = (req.query.mangaTitle || req.query.title || "").toString().trim();
    const chapterNumber = (req.query.chapterNumber || req.query.chapter || "1").toString().trim();
    const lang = (req.query.lang || req.query.language || "").toString().trim();
    const sourceId = (req.query.sourceId || req.query.provider || "").toString().trim();

    if (mangaTitle) {
      const sub = await findSeamlessChapterSubstitution({
        mangaTitle,
        chapterNumber,
        language: lang,
        excludeSource: sourceId
      });
      if (sub && sub.pages.length > 0) {
        return res.json({ pages: sub.pages, count: sub.pages.length, substituted: true, providerName: sub.providerName });
      }
    }
    res.status(500).json({ error: error.message });
  }
});

// - Universal API Tunnel
app.get("/api/nyora/tunnel", async (req, res) => {
  try {
    const path = (req.query.path || "").toString().trim();
    if (!path) return res.status(400).json({ error: "path parameter is required" });
    const target = `${NYORA_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
    const upstreamRes = await fetch(target, {
      headers: NYORA_HEADERS,
      signal: AbortSignal.timeout(12000)
    });
    const contentType = upstreamRes.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", contentType);
    res.status(upstreamRes.status);
    const buffer = await upstreamRes.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (err: any) {
    return res.status(502).json({ error: "Nyora tunnel error: " + err.message });
  }
});

app.get("/api/consumet/sources", async (req, res) => {
  try {
    const sources = await getGlobalSources();
    res.json(sources);
  } catch {
    res.json([]);
  }
});

app.get("/api/consumet/directory", async (req, res) => {
  try {
    const { provider, page = "1", q = "", lang = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const queryStr = (typeof q === "string" ? q : "").trim();
    const data = await fetchDirectoryWithHealthCheck({
      provider: provider as string,
      query: queryStr,
      page: pageNum,
      lang: lang as string
    });
    return res.json(data);
  } catch (error: any) {
    console.error("Consumet directory error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/consumet/search", async (req, res) => {
  try {
    const { q, provider, page = "1", lang = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const queryStr = (typeof q === "string" ? q : "").trim();

    const data = await fetchDirectoryWithHealthCheck({
      provider: provider as string,
      query: queryStr,
      page: pageNum,
      lang: lang as string
    });
    return res.json(data);
  } catch (error: any) {
    console.error("Consumet search error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/consumet/popular", async (req, res) => {
  try {
    const { provider, page = "1", lang = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);

    const data = await fetchDirectoryWithHealthCheck({
      provider: provider as string,
      query: "",
      page: pageNum,
      lang: lang as string
    });
    return res.json(data);
  } catch (error: any) {
    console.error("Consumet popular error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- OMNI CROSS-SOURCE SEARCH ENGINE ---
app.get("/api/manga/omni-search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.json({ results: [], total: 0 });
    }

    // List of reliable, fast providers across languages to query in parallel
    const searchTargets = [
      { id: "consumet_comick", name: "ComicK (مانهوا/مانجا)", lang: "ko" },
      { id: "consumet_mangadex", name: "MangaDex (عالمي)", lang: "all" },
      { id: "3asq", name: "العاشق (3asq)", lang: "ar" },
      { id: "consumet_weebcentral", name: "WeebCentral", lang: "en" },
      { id: "consumet_mangapill", name: "MangaPill", lang: "en" },
      { id: "consumet_mangakakalot", name: "MangaKakalot", lang: "en" },
      { id: "consumet_mangahere", name: "MangaHere", lang: "en" },
    ];

    // Helper: Normalize title to canonical key for grouping
    const toCanonicalKey = (title: string): string => {
      return title
        .toLowerCase()
        .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, "") // remove parenthesized info
        .replace(/[^\p{L}\p{N}\s]/gu, "") // keep letters and digits across any language
        .replace(/\s+/g, " ")
        .trim();
    };

    // Parallel fetch with timeout for each provider
    const timeoutMs = 4500;
    const fetchPromises = searchTargets.map(async (target) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let items: any[] = [];
        if (target.id === "3asq") {
          items = await fetch3asqSearch(query, 1).catch(() => []);
        } else if (target.id === "consumet_mangadex") {
          const titleParam = `title=${encodeURIComponent(query)}&`;
          const url = `https://api.mangadex.org/manga?${titleParam}limit=12&includes[]=cover_art&includes[]=author`;
          const mdRes = await fetch(url, { signal: controller.signal }).catch(() => null);
          if (mdRes && mdRes.ok) {
            const data = await mdRes.json();
            items = (data.data || []).map((m: any) => {
              const norm = normalizeManga(m);
              const lastCh = m.attributes?.lastChapter;
              const chNum = lastCh ? parseFloat(lastCh) : 0;
              return {
                ...norm,
                chaptersCount: !isNaN(chNum) && chNum > 0 ? Math.floor(chNum) : 0,
                latestChapter: lastCh ? `الفصل ${lastCh}` : undefined
              };
            });
          }
        } else {
          const providerType = target.id.replace("consumet_", "");
          const engine = consumetProviders[providerType];
          if (engine) {
            let q = query;
            if (providerType === "comick" && q.length < 2) q += " ";
            const data = await engine.search(q, 1).catch(() => ({ results: [] }));
            items = (data.results || []).slice(0, 12).map((m: any) => {
              // Extract any available chapter info
              let chCount = 0;
              let latestCh: string | undefined = undefined;
              if (m.headerForImage?.chapter) {
                const parsed = parseFloat(m.headerForImage.chapter);
                if (!isNaN(parsed)) chCount = Math.floor(parsed);
              }
              return {
                id: m.id,
                title: m.title,
                coverUrl: m.image || "",
                author: m.author || "Unknown",
                status: m.status || "Unknown",
                description: m.description || "",
                chaptersCount: chCount,
                latestChapter: latestCh
              };
            });
          }
        }
        clearTimeout(timer);

        return items.map((item) => ({
          ...item,
          providerId: target.id,
          providerName: target.name,
          providerLanguage: target.lang,
        }));
      } catch {
        return [];
      }
    });

    const settled = await Promise.allSettled(fetchPromises);
    const allItems: any[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        allItems.push(...result.value);
      }
    }

    // Group items by canonical title
    const groupedMap = new Map<string, {
      id: string;
      title: string;
      canonicalTitle: string;
      displayTitle: string;
      coverUrl: string;
      author: string;
      description: string;
      maxChapters: number;
      sources: Array<{
        sourceId: string;
        sourceName: string;
        sourceLanguage: string;
        mangaId: string;
        mangaTitle: string;
        coverUrl: string;
        chaptersCount?: number;
        latestChapter?: string;
      }>;
    }>();

    for (const item of allItems) {
      if (!item.title) continue;
      const key = toCanonicalKey(item.title);
      if (!key) continue;

      const chCount = item.chaptersCount || 0;
      const sourceEntry = {
        sourceId: item.providerId,
        sourceName: item.providerName,
        sourceLanguage: item.providerLanguage,
        mangaId: item.id,
        mangaTitle: item.title,
        coverUrl: item.coverUrl || "",
        chaptersCount: chCount,
        latestChapter: item.latestChapter
      };

      const existing = groupedMap.get(key);
      if (!existing) {
        groupedMap.set(key, {
          id: `${item.providerId}:::${item.id}`,
          title: item.title,
          canonicalTitle: key,
          displayTitle: item.title,
          coverUrl: item.coverUrl || "",
          author: item.author || "",
          description: item.description || "",
          maxChapters: chCount,
          sources: [sourceEntry],
        });
      } else {
        if (!existing.coverUrl && item.coverUrl) {
          existing.coverUrl = item.coverUrl;
        }
        existing.maxChapters = Math.max(existing.maxChapters, chCount);
        if (!existing.sources.some(s => s.sourceId === item.providerId && s.mangaId === item.id)) {
          existing.sources.push(sourceEntry);
        }
      }
    }

    // Sort sources within each work: highest chapter count first
    for (const group of groupedMap.values()) {
      group.sources.sort((a, b) => (b.chaptersCount || 0) - (a.chaptersCount || 0));
    }

    // Sort grouped results: works with higher chapters and more sources first
    const results = Array.from(groupedMap.values()).sort((a, b) => {
      const aStarts = a.canonicalTitle.startsWith(query.toLowerCase());
      const bStarts = b.canonicalTitle.startsWith(query.toLowerCase());
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      if (b.maxChapters !== a.maxChapters) {
        return b.maxChapters - a.maxChapters;
      }
      return b.sources.length - a.sources.length;
    });

    res.json({ results, total: results.length });
  } catch (error: any) {
    console.error("Omni-search error:", error.message);
    res.status(500).json({ error: error.message, results: [] });
  }
});

app.get("/api/consumet/info", async (req, res) => {
  try {
    const { id, provider } = req.query;
    const rawId = String(id || "").trim();
    const { type, lang, parserId } = parseProvider(provider as string);

    // 1. Live Nyora composite ID or Nyora provider
    if (rawId.includes(":::")) {
      const [pid, mangaUrl] = rawId.split(":::");
      const nyoraData = await fetchNyoraDetails(pid, mangaUrl);
      if (nyoraData) {
        return res.json(nyoraData);
      }
    } else if (type === "nyora" && parserId) {
      const nyoraData = await fetchNyoraDetails(parserId, rawId);
      if (nyoraData) {
        return res.json(nyoraData);
      }
    }

    if (type === "3asq") {
      const infoData = await fetch3asqInfo(rawId);
      if (!infoData) throw new Error("Manga not found in 3asq");
      return res.json(infoData);
    }

    if (type === "mangadex") {
      const mangaUrl = `https://api.mangadex.org/manga/${rawId}?includes[]=cover_art&includes[]=author`;
      const mangaRes = await fetch(mangaUrl);
      const mangaData = await mangaRes.json();
      const norm = normalizeManga(mangaData.data);

      let langFilter = "";
      if (lang && lang !== "all") {
        langFilter = `&translatedLanguage[]=${lang}`;
      }

      const feedUrl = `https://api.mangadex.org/manga/${rawId}/feed?limit=100&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive${langFilter}`;
      const feedRes = await fetch(feedUrl);
      const feedData = await feedRes.json();
      
      let rawChapters = feedData.data || [];
      if (rawChapters.length === 0 && langFilter) {
        const fallbackFeed = await fetch(`https://api.mangadex.org/manga/${rawId}/feed?limit=100&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive`);
        if (fallbackFeed.ok) {
          const fallbackData = await fallbackFeed.json();
          rawChapters = fallbackData.data || [];
        }
      }

      const chapters = rawChapters
        .filter((c: any) => !c.attributes.externalUrl && c.attributes.pages > 0)
        .map((c: any) => ({
          id: c.id,
          title: c.attributes.title || `الفصل ${c.attributes.chapter || "One Shot"}`,
          chapterNumber: c.attributes.chapter || "0",
          volumeNumber: c.attributes.volume || null,
          language: c.attributes.translatedLanguage || "en",
          pages: c.attributes.pages || 0,
          releaseDate: c.attributes.publishAt || null,
        }));

      return res.json({
        details: {
          id: norm.id,
          title: norm.title,
          coverUrl: norm.coverUrl || "",
          description: norm.description || "",
          author: norm.author || "Unknown",
          status: norm.status || "Unknown",
        },
        chapters
      });
    }

    const engine = consumetProviders[type];
    if (engine) {
      let info: any = null;
      try {
        info = await engine.fetchMangaInfo(rawId);
      } catch (err: any) {
        console.warn(`[ConsumetInfo] Engine ${type} error for ${rawId}:`, err.message);
      }

      let chapters = (info?.chapters || []).map((ch: any) => ({
        id: ch.id,
        title: ch.title || `الفصل ${ch.chapterNumber || "One Shot"}`,
        chapterNumber: ch.chapterNumber || "0",
        volumeNumber: ch.volumeNumber || null,
        language: ch.lang || "en", 
        pages: ch.pages || 0,
        releaseDate: ch.releaseDate || null,
      }));

      // Resilient Fallback: If 0 chapters (e.g. Solo Leveling on an outdated parser), search ComicK / MangaDex
      if (chapters.length === 0) {
        const queryTitle = info?.title || rawId.replace(/[-_]/g, " ").trim();
        if (queryTitle) {
          try {
            const ckSearch = await consumetProviders.comick.search(queryTitle, 1).catch(() => ({ results: [] }));
            const hit = (ckSearch.results || [])[0];
            if (hit && hit.id) {
              const ckInfo = await consumetProviders.comick.fetchMangaInfo(hit.id).catch(() => null);
              if (ckInfo && ckInfo.chapters && ckInfo.chapters.length > 0) {
                chapters = ckInfo.chapters.map((ch: any) => ({
                  id: ch.id,
                  title: ch.title || `الفصل ${ch.chapterNumber || "One Shot"}`,
                  chapterNumber: ch.chapterNumber || "0",
                  volumeNumber: ch.volumeNumber || null,
                  language: ch.lang || "en",
                  pages: ch.pages || 0,
                  releaseDate: ch.releaseDate || null,
                }));
                if (!info) info = ckInfo;
              }
            }
          } catch {}
        }
      }

      return res.json({
        details: {
          id: info?.id || rawId,
          title: info?.title || rawId,
          coverUrl: info?.image || "",
          description: info?.description || "",
          author: info?.author || "Unknown",
          status: info?.status || "Unknown",
        },
        chapters
      });
    }

    // Secondary fallback if provider type not found: try ComicK
    try {
      const q = rawId.replace(/[-_]/g, " ").trim();
      const ckSearch = await consumetProviders.comick.search(q, 1).catch(() => ({ results: [] }));
      const hit = (ckSearch.results || [])[0];
      if (hit && hit.id) {
        const ckInfo = await consumetProviders.comick.fetchMangaInfo(hit.id).catch(() => null);
        if (ckInfo) {
          const chapters = (ckInfo.chapters || []).map((ch: any) => ({
            id: ch.id,
            title: ch.title || `الفصل ${ch.chapterNumber || "One Shot"}`,
            chapterNumber: ch.chapterNumber || "0",
            volumeNumber: ch.volumeNumber || null,
            language: ch.lang || "en",
            pages: ch.pages || 0,
            releaseDate: ch.releaseDate || null,
          }));
          return res.json({
            details: {
              id: ckInfo.id,
              title: ckInfo.title,
              coverUrl: ckInfo.image || "",
              description: ckInfo.description || "",
              author: ckInfo.author || "Unknown",
              status: ckInfo.status || "Unknown",
            },
            chapters
          });
        }
      }
    } catch {}

    throw new Error(`Provider ${type} not found or unable to fetch manga info for ${rawId}`);
  } catch (error: any) {
    console.error("Consumet info error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/consumet/read", async (req, res) => {
  try {
    const { chapterId, provider } = req.query;
    const cid = String(chapterId || "").trim();
    if (!cid) {
      return res.status(400).json({ error: "Chapter ID is required" });
    }

    const { type, parserId } = parseProvider(provider as string);

    // 1. Check if it's a live Nyora composite chapter ID or Nyora parser
    if (cid.includes(":::")) {
      const [pid, chapterUrl] = cid.split(":::");
      const pages = await fetchNyoraPages(pid, chapterUrl);
      if (pages.length > 0) {
        return res.json({ pages });
      }
    } else if (type === "nyora" && parserId) {
      const pages = await fetchNyoraPages(parserId, cid);
      if (pages.length > 0) {
        return res.json({ pages });
      }
    }

    // 2. 3asq check
    if (type === "3asq" || cid.startsWith("http") || cid.includes("3asq.online")) {
      const pages = await fetch3asqPages(cid);
      return res.json({ pages });
    }

    const withTimeout = async (promise: Promise<any>, ms = 15000): Promise<any[]> => {
      let t: any;
      const timeoutP = new Promise<any[]>((_, reject) => {
        t = setTimeout(() => reject(new Error("Timeout fetching chapter pages")), ms);
      });
      try {
        const res = await Promise.race([promise, timeoutP]);
        clearTimeout(t);
        return Array.isArray(res) ? res : [];
      } catch (e) {
        clearTimeout(t);
        return [];
      }
    };

    // 3. MangaPill check
    if (type === "mangapill") {
      const mpEngine = consumetProviders["mangapill"];
      const pages = await withTimeout(mpEngine.fetchChapterPages(cid));
      const imageUrls = pages.map((p: any) => p.img || p.url || p).filter(Boolean);
      if (imageUrls.length > 0) return res.json({ pages: imageUrls });
    }

    // 4. ComicK check
    if (type === "comick") {
      const comickEngine = consumetProviders["comick"];
      const pages = await withTimeout(comickEngine.fetchChapterPages(cid));
      const imageUrls = pages.map((p: any) => p.img || p.url || p).filter(Boolean);
      if (imageUrls.length > 0) return res.json({ pages: imageUrls });
    }

    // 5. MangaDex check (UUID pattern or type === 'mangadex')
    const isMangaDexUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cid);
    if (type === "mangadex" || isMangaDexUuid) {
      const atHomeUrl = `https://api.mangadex.org/at-home/server/${cid}`;
      const atHomeRes = await fetch(atHomeUrl, { signal: AbortSignal.timeout(12000) }).catch(() => null);
      if (atHomeRes && atHomeRes.ok) {
        const atHomeData = await atHomeRes.json();
        if (atHomeData.chapter && atHomeData.chapter.data && atHomeData.chapter.data.length > 0) {
          const baseUrl = atHomeData.baseUrl || "https://uploads.mangadex.org";
          const hash = atHomeData.chapter.hash;
          const imageUrls = atHomeData.chapter.data.map((f: string) => `${baseUrl}/data/${hash}/${f}`);
          return res.json({ pages: imageUrls });
        }
      }
    }

    // 6. General Provider Fallback
    const engine = consumetProviders[type];
    if (engine) {
      const pages = await withTimeout(engine.fetchChapterPages(cid));
      const imageUrls = pages.map((p: any) => p.img || p.url || p).filter(Boolean);
      if (imageUrls.length > 0) return res.json({ pages: imageUrls });
    }

    // Last resort fallback: try ComicK then MangaPill if provider was omitted
    try {
      const cPages = await withTimeout(consumetProviders["comick"].fetchChapterPages(cid), 8000);
      const imgUrls = cPages.map((p: any) => p.img || p.url || p).filter(Boolean);
      if (imgUrls.length > 0) return res.json({ pages: imgUrls });
    } catch {}

    // Last resort seamless chapter substitution
    const mangaTitle = (req.query.mangaTitle || req.query.title || "").toString().trim();
    const chapterNumber = (req.query.chapterNumber || req.query.chapter || "1").toString().trim();
    const lang = (req.query.lang || req.query.language || "").toString().trim();

    if (mangaTitle) {
      console.info(`[ConsumetRead] Primary pages empty for "${mangaTitle}" Ch ${chapterNumber}. Initiating seamless chapter substitution...`);
      const sub = await findSeamlessChapterSubstitution({
        mangaTitle,
        chapterNumber,
        language: lang,
        excludeSource: provider as string
      });
      if (sub && sub.pages.length > 0) {
        return res.json({ pages: sub.pages, substituted: true, providerName: sub.providerName });
      }
    }

    throw new Error(`Unable to fetch chapter pages for ID: ${cid}`);
  } catch (error: any) {
    console.error("Consumet read error:", error.message);
    const mangaTitle = (req.query.mangaTitle || req.query.title || "").toString().trim();
    const chapterNumber = (req.query.chapterNumber || req.query.chapter || "1").toString().trim();
    const lang = (req.query.lang || req.query.language || "").toString().trim();
    const provider = (req.query.provider || "").toString().trim();

    if (mangaTitle) {
      const sub = await findSeamlessChapterSubstitution({
        mangaTitle,
        chapterNumber,
        language: lang,
        excludeSource: provider
      });
      if (sub && sub.pages.length > 0) {
        return res.json({ pages: sub.pages, substituted: true, providerName: sub.providerName });
      }
    }
    res.status(500).json({ error: error.message });
  }
});
// --- END CONSUMET MEGA ENGINE API ---

// 1. Dynamic Proxy Search Manga
app.get("/api/manga/search", async (req, res) => {
  try {
    const { q, limit = "24", offset = "0", engine = "mangadex", sourceId, provider, lang = "ar" } = req.query;
    if (!q) {
      return res.json({ results: [] });
    }

    const effectiveSource = (sourceId || provider || engine || "") as string;
    const { type, lang: parsedLang, parserId } = parseProvider(effectiveSource);

    // 1. Nyora / Kotatsu source
    if (type === "nyora" && parserId) {
      const results = await fetchNyoraSearch(parserId, q as string);
      if (results.length > 0) {
        return res.json({ results, total: results.length });
      }
    }

    // 2. 3asq source
    if (type === "3asq" || effectiveSource.includes("3asq")) {
      const results = await fetch3asqSearch(q as string);
      return res.json({ results, total: results.length });
    }

    // 3. Consumet engine providers
    if (consumetProviders[type]) {
      const cEngine = consumetProviders[type];
      const data = await cEngine.search(q as string, 1).catch(() => ({ results: [] }));
      const formatted = (data.results || []).map((m: any) => ({
        id: m.id,
        title: m.title,
        coverUrl: m.image || "",
        author: m.author || "Unknown",
        status: m.status || "Unknown",
        description: m.description || ""
      }));
      return res.json({ results: formatted, total: formatted.length });
    }

    // 4. Default MangaDex search
    const useLang = parsedLang || (lang as string);
    let langParam = "";
    if (useLang && useLang !== "all" && useLang !== "en") {
      langParam = `&availableTranslatedLanguage[]=${useLang}`;
    }
    const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(q as string)}&limit=${limit}&offset=${offset}${langParam}&includes[]=cover_art&includes[]=author`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`MangaDex returned code ${response.status}`);
    const data = await response.json();
    const results = (data.data || []).map(normalizeManga);
    return res.json({ results, total: data.total || results.length });
  } catch (error: any) {
    console.error("Search error:", error);
    res.status(500).json({ error: error.message || "Failed to search manga" });
  }
});

// 2. Dynamic Proxy Popular Manga
app.get("/api/manga/popular", async (req, res) => {
  try {
    const { limit = "12", lang = "ar", sourceId, provider, engine } = req.query;
    const effectiveSource = (sourceId || provider || engine || "") as string;

    if (effectiveSource && effectiveSource !== "mangadex") {
      const { type, parserId } = parseProvider(effectiveSource);

      if (type === "nyora" && parserId) {
        const results = await fetchNyoraPopular(parserId, 1);
        if (results.length > 0) {
          return res.json({ results });
        }
      }

      if (type === "3asq" || effectiveSource.includes("3asq")) {
        const results = await fetch3asqPopular();
        return res.json({ results });
      }

      if (consumetProviders[type]) {
        const cEngine = consumetProviders[type];
        let data: any = { results: [] };
        if (cEngine.fetchPopular) data = await cEngine.fetchPopular(1).catch(() => ({ results: [] }));
        if (!data.results?.length && cEngine.fetchLatest) data = await cEngine.fetchLatest(1).catch(() => ({ results: [] }));
        if (!data.results?.length) data = await cEngine.search("a", 1).catch(() => ({ results: [] }));
        const formatted = (data.results || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          coverUrl: m.image || "",
          author: m.author || "Unknown",
          status: m.status || "Unknown",
          description: m.description || ""
        }));
        return res.json({ results: formatted });
      }
    }

    // Default MangaDex popular
    const url = `https://api.mangadex.org/manga?limit=${limit}&availableTranslatedLanguage[]=${lang}&order[followedCount]=desc&includes[]=cover_art&includes[]=author`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MangaDex returned code ${response.status}`);
    }
    const data = await response.json();
    const results = (data.data || []).map(normalizeManga);

    res.json({ results });
  } catch (error: any) {
    console.error("Popular manga error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch popular manga" });
  }
});

// 3. Proxy Latest Updates
app.get("/api/manga/latest", async (req, res) => {
  try {
    const { limit = "12", sourceId, provider, engine } = req.query;
    const effectiveSource = (sourceId || provider || engine || "") as string;

    if (effectiveSource && effectiveSource !== "mangadex") {
      const { type, parserId } = parseProvider(effectiveSource);
      if (type === "nyora" && parserId) {
        const results = await fetchNyoraPopular(parserId, 1);
        return res.json({ results });
      }
    }

    // Query latest created manga
    const url = `https://api.mangadex.org/manga?limit=${limit}&order[createdAt]=desc&includes[]=cover_art&includes[]=author`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MangaDex returned code ${response.status}`);
    }
    const data = await response.json();
    const results = (data.data || []).map(normalizeManga);

    res.json({ results });
  } catch (error: any) {
    console.error("Latest manga error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch latest manga" });
  }
});

// 4. Dynamic Proxy Manga Details
app.get("/api/manga/details/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { sourceId, provider, engine } = req.query;
    const rawId = String(id || "").trim();
    const effectiveSource = (sourceId || provider || engine || "") as string;

    // 0. Direct Suwayomi handling (Default and exclusive provider)
    const cleanMangaId = rawId.replace(/^suwayomi_/, "");
    const isNumericId = /^\d+$/.test(cleanMangaId);
    if (isNumericId || (rawId.toLowerCase().includes("suwayomi") && !rawId.includes("3asq") && !rawId.includes("weebcentral") && !rawId.includes("comick") && !rawId.includes(":::"))) {
      const suwUrl = getSuwayomiUrl(req);
      const suwData = await fetchSuwayomiMangaDetailsAndChapters(suwUrl, cleanMangaId);
      if (suwData) {
        return res.json({ manga: suwData.details, chapters: suwData.chapters });
      }
    }

    // 1. Nyora composite ID or Nyora source
    if (rawId.includes(":::")) {
      const [pid, mUrl] = rawId.split(":::");
      const nyoraData = await fetchNyoraDetails(pid, mUrl);
      if (nyoraData) {
        return res.json({ manga: nyoraData.details, chapters: nyoraData.chapters });
      }
    } else if (effectiveSource) {
      const { type, parserId } = parseProvider(effectiveSource);
      if (type === "nyora" && parserId) {
        const nyoraData = await fetchNyoraDetails(parserId, rawId);
        if (nyoraData) {
          return res.json({ manga: nyoraData.details, chapters: nyoraData.chapters });
        }
      }
      if (type === "3asq" || effectiveSource.includes("3asq") || rawId.includes("3asq")) {
        const info = await fetch3asqInfo(rawId);
        if (info) return res.json({ manga: info.details, chapters: info.chapters });
      }
      if (consumetProviders[type]) {
        const info = await consumetProviders[type].fetchMangaInfo(rawId);
        return res.json({
          manga: {
            id: info.id,
            title: info.title,
            coverUrl: info.image || "",
            description: info.description || "",
            author: info.author || "Unknown",
            status: info.status || "Unknown"
          },
          chapters: info.chapters || []
        });
      }
    }

    // 2. MangaDex Details (Only if ID is a valid UUID or MangaDex format)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);

    if (isUuid) {
      try {
        const url = `https://api.mangadex.org/manga/${rawId}?includes[]=cover_art&includes[]=author&includes[]=artist`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data.data) {
            const result = normalizeManga(data.data);
            return res.json({ manga: result });
          }
        }
      } catch (mdErr) {
        console.warn("[MangaDetails] MangaDex direct fetch notice:", mdErr);
      }
    }

    // 3. Fallback Discovery: If rawId is a slug (e.g. 3asq slug or Consumet slug)
    try {
      const info = await fetch3asqInfo(rawId);
      if (info && info.details) {
        return res.json({ manga: info.details, chapters: info.chapters });
      }
    } catch {}

    for (const p of ["comick", "mangapill", "weebcentral", "mangakakalot"]) {
      try {
        const cEngine = consumetProviders[p];
        if (cEngine && cEngine.fetchMangaInfo) {
          const cInfo = await cEngine.fetchMangaInfo(rawId);
          if (cInfo && (cInfo.id || cInfo.title)) {
            return res.json({
              manga: {
                id: cInfo.id || rawId,
                title: cInfo.title,
                coverUrl: cInfo.image || "",
                description: cInfo.description || "",
                author: cInfo.author || "Unknown",
                status: cInfo.status || "Unknown"
              },
              chapters: cInfo.chapters || []
            });
          }
        }
      } catch {}
    }

    // 4. Fallback search MangaDex by title/keyword
    try {
      const cleanTitle = rawId.replace(/[-_]/g, " ").trim();
      const sUrl = `https://api.mangadex.org/manga?title=${encodeURIComponent(cleanTitle)}&limit=1&includes[]=cover_art&includes[]=author`;
      const sRes = await fetch(sUrl);
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.data && sData.data.length > 0) {
          const result = normalizeManga(sData.data[0]);
          return res.json({ manga: result });
        }
      }
    } catch {}

    return res.status(404).json({ error: "لم يتم العثور على المانجا المطلوبة" });
  } catch (error: any) {
    console.warn("Manga details warning:", error?.message || error);
    res.status(404).json({ error: error.message || "Failed to fetch manga details" });
  }
});

// 5. Dynamic Proxy Chapters Feed
app.get("/api/manga/chapters/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { offset = "0", limit = "100", lang = "ar", sourceId, provider, engine } = req.query;
    const rawId = String(id || "").trim();
    const effectiveSource = (sourceId || provider || engine || "") as string;

    // 0. Direct Suwayomi handling (Default and exclusive provider)
    const cleanMangaId = rawId.replace(/^suwayomi_/, "");
    const isNumericId = /^\d+$/.test(cleanMangaId);
    if (isNumericId || (rawId.toLowerCase().includes("suwayomi") && !rawId.includes("3asq") && !rawId.includes("weebcentral") && !rawId.includes("comick") && !rawId.includes(":::"))) {
      const suwUrl = getSuwayomiUrl(req);
      const suwData = await fetchSuwayomiMangaDetailsAndChapters(suwUrl, cleanMangaId);
      if (suwData) {
        return res.json({ chapters: suwData.chapters, total: suwData.chapters.length });
      }
    }

    // 1. Nyora composite ID or Nyora source
    if (rawId.includes(":::")) {
      const [pid, mUrl] = rawId.split(":::");
      const nyoraData = await fetchNyoraDetails(pid, mUrl);
      if (nyoraData) {
        return res.json({ chapters: nyoraData.chapters, total: nyoraData.chapters.length });
      }
    } else if (effectiveSource) {
      const { type, parserId } = parseProvider(effectiveSource);
      if (type === "nyora" && parserId) {
        const nyoraData = await fetchNyoraDetails(parserId, rawId);
        if (nyoraData) {
          return res.json({ chapters: nyoraData.chapters, total: nyoraData.chapters.length });
        }
      }
      if (type === "3asq" || effectiveSource.includes("3asq") || rawId.includes("3asq")) {
        const info = await fetch3asqInfo(rawId);
        if (info) return res.json({ chapters: info.chapters || [], total: (info.chapters || []).length });
      }
      if (consumetProviders[type] && consumetProviders[type].fetchMangaInfo) {
        const cInfo = await consumetProviders[type].fetchMangaInfo(rawId);
        if (cInfo) return res.json({ chapters: cInfo.chapters || [], total: (cInfo.chapters || []).length });
      }
    }

    // 2. MangaDex Chapters (Only if ID is a valid UUID)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
    if (isUuid) {
      try {
        let allChapters: any[] = [];
        let currentOffset = 0;
        const maxLimit = 500;
        let totalToFetch = maxLimit;
        
        while (currentOffset < totalToFetch) {
          const url = `https://api.mangadex.org/manga/${rawId}/feed?limit=${maxLimit}&offset=${currentOffset}&order[chapter]=desc&translatedLanguage[]=${lang}&includes[]=scanlation_group`;
          const response = await fetch(url);
          if (!response.ok) break;
          
          const data = await response.json();
          if (!data.data || data.data.length === 0) break;
          
          allChapters = allChapters.concat(data.data);
          totalToFetch = data.total || 0;
          currentOffset += maxLimit;
          
          // Safety cap to avoid infinite loops or extreme memory usage (e.g., max 2500 chapters)
          if (currentOffset > 2500) break;
        }

        if (allChapters.length > 0) {
          const formattedChapters = allChapters.map((ch: any) => {
            const attributes = ch.attributes || {};
            const groupRelationship = ch.relationships?.find((r: any) => r.type === "scanlation_group");
            const groupName = groupRelationship?.attributes?.name || "Independent";

            return {
              id: ch.id,
              title: attributes.title || `Chapter ${attributes.chapter || "One Shot"}`,
              chapter: attributes.chapter || "0",
              volume: attributes.volume || null,
              language: attributes.translatedLanguage,
              pages: attributes.pages,
              publishAt: attributes.publishAt,
              groupName,
              externalUrl: attributes.externalUrl
            };
          }).filter((ch: any) => !ch.externalUrl);

          return res.json({ chapters: formattedChapters, total: formattedChapters.length });
        }
      } catch (chErr) {
        console.warn("[Chapters] MangaDex feed notice:", chErr);
      }
    }

    // 3. Fallback Chapters across other providers
    try {
      const info = await fetch3asqInfo(rawId);
      if (info && info.chapters && info.chapters.length > 0) {
        return res.json({ chapters: info.chapters, total: info.chapters.length });
      }
    } catch {}

    for (const p of ["comick", "mangapill", "weebcentral", "mangakakalot"]) {
      try {
        const cEngine = consumetProviders[p];
        if (cEngine && cEngine.fetchMangaInfo) {
          const cInfo = await cEngine.fetchMangaInfo(rawId);
          if (cInfo && cInfo.chapters && cInfo.chapters.length > 0) {
            return res.json({ chapters: cInfo.chapters, total: cInfo.chapters.length });
          }
        }
      } catch {}
    }

    return res.json({ chapters: [], total: 0 });
  } catch (error: any) {
    console.warn("Chapters warning:", error?.message || error);
    res.json({ chapters: [], total: 0 });
  }
});

// 6. Dynamic Proxy Chapter Pages
app.get("/api/manga/chapter-pages/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { sourceId, provider, engine } = req.query;
    const rawId = String(id || "").trim();
    const effectiveSource = (sourceId || provider || engine || "") as string;

    // 0. Direct Suwayomi handling (Default and exclusive provider)
    if (rawId.toLowerCase().includes("suwayomi") || effectiveSource.toLowerCase().includes("suwayomi") || /^\d+$/.test(rawId)) {
      const suwUrl = getSuwayomiUrl(req);
      const cleanChapterId = rawId.replace(/^suwayomi_/, "");
      const suwPages = await fetchSuwayomiPages(suwUrl, cleanChapterId);
      if (suwPages.length > 0) {
        return res.json({ pages: suwPages, pagesLowRes: suwPages });
      }
    }

    // 1. Live Nyora composite ID or Nyora source
    if (rawId.includes(":::")) {
      const [pid, cUrl] = rawId.split(":::");
      const pages = await fetchNyoraPages(pid, cUrl);
      if (pages.length > 0) {
        return res.json({ pages, pagesLowRes: pages });
      }
    } else if (effectiveSource) {
      const { type, parserId } = parseProvider(effectiveSource);
      if (type === "nyora" && parserId) {
        const pages = await fetchNyoraPages(parserId, rawId);
        if (pages.length > 0) {
          return res.json({ pages, pagesLowRes: pages });
        }
      }
      if (type === "3asq" || rawId.startsWith("http")) {
        const pages = await fetch3asqPages(rawId);
        return res.json({ pages, pagesLowRes: pages });
      }
      if (consumetProviders[type]) {
        const cPages = await consumetProviders[type].fetchChapterPages(rawId);
        const imageUrls = (cPages || []).map((p: any) => p.img || p.url || p).filter(Boolean);
        return res.json({ pages: imageUrls, pagesLowRes: imageUrls });
      }
    }

    // 2. MangaDex Pages
    const url = `https://api.mangadex.org/at-home/server/${rawId}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MangaDex returned code ${response.status}`);
    }
    const data = await response.json();
    if (!data.chapter) {
      return res.status(404).json({ error: "Chapter pages not found" });
    }

    const baseUrl = data.baseUrl || "https://uploads.mangadex.org";
    const { hash, data: highResFiles, dataSaver: lowResFiles } = data.chapter;

    const pages = highResFiles.map((filename: string) => `${baseUrl}/data/${hash}/${filename}`);
    const pagesLowRes = lowResFiles.map((filename: string) => `${baseUrl}/data-saver/${hash}/${filename}`);

    res.json({
      hash,
      pages,
      pagesLowRes,
    });
  } catch (error: any) {
    console.error("Chapter pages error:", error);
    const mangaTitle = (req.query.mangaTitle || req.query.title || "").toString().trim();
    const chapterNumber = (req.query.chapterNumber || req.query.chapter || "1").toString().trim();
    const lang = (req.query.lang || req.query.language || "").toString().trim();
    const effectiveSource = (req.query.sourceId || req.query.provider || req.query.engine || "").toString().trim();

    if (mangaTitle) {
      console.info(`[ChapterPages] Primary fetch failed for "${mangaTitle}" Ch ${chapterNumber}. Initiating seamless substitution...`);
      const sub = await findSeamlessChapterSubstitution({
        mangaTitle,
        chapterNumber,
        language: lang,
        excludeSource: effectiveSource
      });
      if (sub && sub.pages.length > 0) {
        return res.json({
          hash: "",
          pages: sub.pages,
          pagesLowRes: sub.pages,
          substituted: true,
          providerName: sub.providerName
        });
      }
    }
    res.status(500).json({ error: error.message || "Failed to fetch chapter pages" });
  }
});

// High-performance in-memory image cache to eliminate redundant network downloads between ImageProxy and OCR
interface CachedImageEntry {
  buffer: Buffer;
  contentType: string;
  timestamp: number;
}
const MAX_IMAGE_CACHE_ITEMS = 300;
const imageBufferCache = new Map<string, CachedImageEntry>();
const inFlightImageFetches = new Map<string, Promise<{ buffer: Buffer; contentType: string } | null>>();

export function getCachedImageBuffer(urlKey: string): CachedImageEntry | undefined {
  const entry = imageBufferCache.get(urlKey);
  if (entry) {
    if (Date.now() - entry.timestamp < 3600000) {
      // Refresh position in Map for true LRU eviction
      imageBufferCache.delete(urlKey);
      imageBufferCache.set(urlKey, entry);
      return entry;
    }
    imageBufferCache.delete(urlKey);
  }
  return undefined;
}

export function setCachedImageBuffer(urlKey: string, buffer: Buffer, contentType: string = "image/jpeg") {
  if (imageBufferCache.size >= MAX_IMAGE_CACHE_ITEMS) {
    const oldestKey = imageBufferCache.keys().next().value;
    if (oldestKey) imageBufferCache.delete(oldestKey);
  }
  imageBufferCache.set(urlKey, { buffer, contentType, timestamp: Date.now() });
}

// 7. Resilient Universal Image Proxy (Bypasses CORS, Hotlink Protections, and handles Referers)
app.get("/api/proxy-image", async (req, res) => {
  try {
    const { url, referer: customReferer } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing image URL" });
    }

    let targetUrl = url.trim();
    // Recursively unwrap any nested /api/proxy-image?url=
    while (targetUrl.includes("/api/proxy-image?url=") || targetUrl.includes("proxy-image?url=")) {
      const parts = targetUrl.split(/proxy-image\?url=/i);
      const last = parts[parts.length - 1];
      try {
        targetUrl = decodeURIComponent(last).trim();
      } catch {
        targetUrl = last.trim();
      }
    }

    // Fast Cache Hit: return directly from memory if already fetched recently (0ms response)
    const cached = getCachedImageBuffer(targetUrl);
    if (cached) {
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      return res.send(cached.buffer);
    }

    // In-Flight Deduplication: if another request is already fetching this exact URL, await the existing promise
    if (inFlightImageFetches.has(targetUrl)) {
      try {
        const inFlightResult = await inFlightImageFetches.get(targetUrl);
        if (inFlightResult) {
          res.setHeader("Content-Type", inFlightResult.contentType);
          res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
          return res.send(inFlightResult.buffer);
        }
      } catch (_) {}
    }

    // Unwrap internal Kotatsu/Nyora image proxy parameter ?u=
    let extractedReferer = "";
    if (targetUrl.includes("?u=") || targetUrl.includes("&u=")) {
      try {
        const uObj = new URL(targetUrl, "http://localhost");
        const realU = uObj.searchParams.get("u");
        const h = uObj.searchParams.get("h");
        if (realU) targetUrl = realU.trim();
        if (h && h.toLowerCase().startsWith("referer:")) {
          extractedReferer = h.slice(8).trim();
        }
      } catch {}
    }

    if (targetUrl.startsWith("//")) {
      targetUrl = "https:" + targetUrl;
    } else if (targetUrl.startsWith("/")) {
      targetUrl = `http://127.0.0.1:${PORT}${targetUrl}`;
    } else if (targetUrl.startsWith("http://localhost:")) {
      targetUrl = targetUrl.replace("http://localhost:", "http://127.0.0.1:");
    } else if (targetUrl.startsWith("http://0.0.0.0:")) {
      targetUrl = targetUrl.replace("http://0.0.0.0:", "http://127.0.0.1:");
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: `Invalid image URL: ${targetUrl}` });
    }

    let referer = (customReferer as string) || extractedReferer || "";
    const host = parsed.hostname.toLowerCase();
    if (!referer) {
      if (host.includes("readdetectiveconan") || host.includes("mangapill")) {
        referer = "https://mangapill.com/";
      } else if (host.includes("planeptune") || host.includes("weebcentral")) {
        referer = "https://weebcentral.com/";
      } else if (host.includes("mangakakalot") || host.includes("manganato")) {
        referer = "https://mangakakalot.gg/";
      } else if (host.includes("comick")) {
        referer = "https://comick.art/";
      } else if (host.includes("mangahere")) {
        referer = "https://mangahere.cc/";
      } else if (host.includes("3asq")) {
        referer = "https://3asq.online/";
      } else if (host.includes("asurascans")) {
        referer = "https://asurascans.com/";
      } else if (host.includes("mangadex")) {
        referer = "https://mangadex.org/";
      } else {
        referer = `${parsed.protocol}//${parsed.hostname}/`;
      }
    }

    const isMangaDexNetwork = host.includes("mangadex.network");
    const fallbackUrls: string[] = [];
    if (isMangaDexNetwork) {
      // MangaDex @home node failure fallback to central MangaDex infrastructure
      fallbackUrls.push(`https://uploads.mangadex.org${parsed.pathname}${parsed.search}`);
    }

    // Smart Fallback 1: Strip trailing sub-page letters (e.g. 01a.png -> 01.png, 02b.jpg -> 02.jpg)
    if (/[0-9]+[a-z]\.[a-z]+$/i.test(targetUrl)) {
      fallbackUrls.push(targetUrl.replace(/([0-9]+)[a-z]\.([a-z]+)$/i, "$1.$2"));
    }

    // Smart Fallback 2: Alternate file extensions (.png <-> .jpg / .jpeg / .webp)
    if (/\.png$/i.test(targetUrl)) {
      fallbackUrls.push(targetUrl.replace(/\.png$/i, ".jpg"));
      fallbackUrls.push(targetUrl.replace(/\.png$/i, ".webp"));
      fallbackUrls.push(targetUrl.replace(/\.png$/i, ".jpeg"));
    } else if (/\.jpe?g$/i.test(targetUrl)) {
      fallbackUrls.push(targetUrl.replace(/\.jpe?g$/i, ".png"));
      fallbackUrls.push(targetUrl.replace(/\.jpe?g$/i, ".webp"));
    } else if (/\.webp$/i.test(targetUrl)) {
      fallbackUrls.push(targetUrl.replace(/\.webp$/i, ".jpg"));
      fallbackUrls.push(targetUrl.replace(/\.webp$/i, ".png"));
    }

    // Smart Fallback 3: Domain variations for 3asq
    if (host.includes("3asq.online")) {
      fallbackUrls.push(targetUrl.replace("3asq.online", "3asq.org"));
    } else if (host.includes("3asq.org")) {
      fallbackUrls.push(targetUrl.replace("3asq.org", "3asq.online"));
    }

    const fetchImage = async (url: string, timeoutMs: number) => {
      let reqReferer = referer;
      if (url.includes("mangadex")) {
        reqReferer = "https://mangadex.org/";
      }
      return await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer": reqReferer,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    };

    let response: Response | null = null;
    let lastError: any = null;

    try {
      response = await fetchImage(targetUrl, isMangaDexNetwork ? 8000 : 15000);
      if (!response.ok && fallbackUrls.length > 0) {
        response = null;
      }
    } catch (fetchErr: any) {
      lastError = fetchErr;
      response = null;
    }

    // Attempt fallbacks if primary failed
    if (!response || !response.ok) {
      for (const fbUrl of fallbackUrls) {
        try {
          const fbRes = await fetchImage(fbUrl, 12000);
          if (fbRes.ok) {
            response = fbRes;
            break;
          }
        } catch (fbErr: any) {
          lastError = fbErr;
        }
      }
    }

    // If still failed and not a mangadex network node, try a single retry with 15s timeout
    if ((!response || !response.ok) && !isMangaDexNetwork) {
      try {
        const retryRes = await fetchImage(targetUrl, 15000);
        if (retryRes.ok) {
          response = retryRes;
        }
      } catch (retryErr: any) {
        lastError = retryErr;
      }
    }

    // Nyora Edge Cloudflare Worker Image Proxy Bypass (Anti-Hotlink and Cloudflare bypass)
    if (!response || !response.ok) {
      try {
        const nyoraProxyUrl = `https://api.nyora.xyz/image?u=${encodeURIComponent(targetUrl)}`;
        const nyoraRes = await fetch(nyoraProxyUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer": "https://web.nyora.xyz/",
            "Origin": "https://web.nyora.xyz"
          },
          signal: AbortSignal.timeout(10000)
        });
        if (nyoraRes.ok) {
          response = nyoraRes;
        }
      } catch (nyoraErr: any) {}
    }

    // If upstream image is missing/404 or unreachable, serve a beautiful fallback SVG plate
    // so that the reader interface doesn't show broken image boxes or crash OCR!
    if (!response || !response.ok) {
      const status = response ? response.status : 504;
      console.info(`[ImageProxy] Upstream page not found (status ${status}), returning fallback SVG placeholder for: ${targetUrl}`);
      
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 800 1100">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
  </defs>
  <rect width="800" height="1100" fill="url(#bgGrad)"/>
  <rect x="30" y="30" width="740" height="1040" rx="16" fill="#0b1120" stroke="#1e293b" stroke-width="2"/>
  <g transform="translate(400, 500)" text-anchor="middle">
    <circle cx="0" cy="-60" r="44" fill="#1e293b" stroke="#334155" stroke-width="2"/>
    <path d="M-12 -60 L12 -60 M0 -72 L0 -48" stroke="#14b8a6" stroke-width="4" stroke-linecap="round"/>
    <text y="20" fill="#f8fafc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="700">صفحة غير متوفرة في خادم المصدر</text>
    <text y="54" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14">Original page image returned 404 from host server</text>
    <text y="92" fill="#2dd4bf" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500">تم تخطي الصفحة لضمان استمرار القراءة بسلاسة</text>
  </g>
</svg>`;

      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(200).send(Buffer.from(svg));
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800"); // Cache for 1 day with stale-while-revalidate

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    setCachedImageBuffer(targetUrl, buffer, contentType);
    res.send(buffer);
  } catch (error: any) {
    console.warn("[ImageProxy] Proxy handler warning:", error?.message || error);
    res.status(500).json({ error: error.message || "Failed to proxy image" });
  }
});

// Helper: Gemini Call with retries and fallback models
async function generateContentWithFallback(
  ai: any,
  params: { contents: any; config?: any },
  models: string[] = ["gemini-3.5-flash", "gemini-2.5-flash"]
) {
  let lastError: any = null;
  for (const model of models) {
    let retries = 2; // Try 3 times total (initial + 2 retries) for each model
    while (retries >= 0) {
      try {
        console.log(`[Gemini Fallback] Attempting with model: ${model} (${retries} retries remaining)`);
        const response = await getGeminiClient().models.generateContent({
          model,
          contents: params.contents,
          config: params.config,
        });
        return response;
      } catch (err: any) {
        lastError = err;
        console.warn(`[Gemini Fallback] Failed with model ${model}:`, err.message || err);
        
        // Wait and retry if it's a transient rate limit / 503 / UNAVAILABLE / high demand error
        const errStr = String(err.message || "").toLowerCase();
        const isRetryable =
          err.status === 503 ||
          err.status === 429 ||
          errStr.includes("503") ||
          errStr.includes("429") ||
          errStr.includes("high demand") ||
          errStr.includes("temporary") ||
          errStr.includes("unavailable");

        if (isRetryable && retries > 0) {
          const delay = (3 - retries) * 1500;
          console.log(`[Gemini Fallback] Retryable error encountered. Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          retries--;
        } else {
          break; // Break loop to proceed to next fallback model
        }
      }
    }
  }
  throw lastError || new Error("All attempts to call Gemini models failed.");
}

// Helper: Map language names/codes to ISO standard code
function resolveLanguageCode(targetLanguage: string): string {
  let tl = "ar";
  const langLower = (targetLanguage || "ar").toLowerCase().trim();
  if (langLower.includes("ar") || langLower.includes("عرب")) tl = "ar";
  else if (langLower.includes("en") || langLower.includes("انجليز") || langLower.includes("إنجليز")) tl = "en";
  else if (langLower.includes("ja") || langLower.includes("يابان")) tl = "ja";
  else if (langLower.includes("ko") || langLower.includes("كور")) tl = "ko";
  else if (langLower.includes("zh") || langLower.includes("صين")) tl = "zh-CN";
  else if (langLower.includes("fr") || langLower.includes("فرنس")) tl = "fr";
  else if (langLower.includes("de") || langLower.includes("ألمان")) tl = "de";
  else if (langLower.includes("es") || langLower.includes("أسبان") || langLower.includes("إسبان")) tl = "es";
  else if (langLower.includes("tr") || langLower.includes("ترك")) tl = "tr";
  else if (langLower.includes("ru") || langLower.includes("روس")) tl = "ru";
  else if (langLower.includes("pt") || langLower.includes("برتغ")) tl = "pt";
  else if (langLower.includes("it") || langLower.includes("إيطال")) tl = "it";
  else if (langLower.includes("id") || langLower.includes("إندونيس")) tl = "id";
  else if (langLower.includes("hi") || langLower.includes("هند")) tl = "hi";
  else if (langLower.includes("th") || langLower.includes("تايلاند")) tl = "th";
  else if (langLower.includes("vi") || langLower.includes("فيتنام")) tl = "vi";
  else if (langLower.includes("pl") || langLower.includes("بولند")) tl = "pl";
  else if (langLower.includes("uk") || langLower.includes("أوكران")) tl = "uk";
  else if (langLower.includes("cs") || langLower.includes("تشيك")) tl = "cs";
  else if (langLower.includes("nl") || langLower.includes("هولند")) tl = "nl";
  else if (langLower.includes("fa") || langLower.includes("فارس")) tl = "fa";
  else if (langLower.length <= 5 && !langLower.includes(" ")) tl = langLower;
  return tl;
}

// In-Memory Translation Cache to avoid repetitive HTTP calls
const translationCache = new Map<string, string>();
const MAX_TRANSLATION_CACHE = 5000;
function setCachedTranslation(key: string, value: string) {
  if (translationCache.size >= MAX_TRANSLATION_CACHE) {
    const firstKey = translationCache.keys().next().value;
    if (firstKey) translationCache.delete(firstKey);
  }
  translationCache.set(key, value);
}

// Helper: Permanently sanitize translations without stripping any valid characters, quotes, or letters
function sanitizeTranslatedText(text: string): string {
  if (!text) return "";
  // Strictly preserve 100% of the AI translation text verbatim (prepositions, diacritics, quotes, Arabic letters).
  // Only remove true null-byte artifacts without affecting language content or punctuation.
  return text.replace(/[\u0000\uFFFD]/g, "").trim();
}

// Helper: Resilient Multi-Tier Translation Engine (Prevents 429 Rate Limits)
async function translateWithGoogleFree(text: string, targetLanguage: string): Promise<string> {
  const trimmed = (text || "").trim();
  if (!trimmed) return "";
  const tl = resolveLanguageCode(targetLanguage);
  const cacheKey = `${tl}:::${trimmed}`;

  if (translationCache.has(cacheKey)) {
    return sanitizeTranslatedText(translationCache.get(cacheKey)!);
  }

  // Tier 1: Direct Google Translate iOS client endpoint (status 200, highly resilient, natural translation)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=it&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "GoogleTranslate/6.28.0.05.357134015 (iPhone; iOS 15.0; Scale/3.00)"
      },
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data && Array.isArray(data[0])) {
        const res = data[0].map((part: any) => part[0] || "").join("").trim();
        if (res) {
          const cleaned = sanitizeTranslatedText(res);
          setCachedTranslation(cacheKey, cleaned);
          return cleaned;
        }
      }
    }
  } catch (_) {}

  // Tier 2: Chrome Extension dict endpoint on clients5.google.com
  try {
    const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${tl}&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (response.ok) {
      const data: any = await response.json();
      let res = "";
      if (Array.isArray(data)) {
        if (Array.isArray(data[0])) {
          res = data[0][0] || "";
        } else if (typeof data[0] === "string") {
          res = data[0];
        }
      }
      if (res && res.trim()) {
        const cleaned = sanitizeTranslatedText(res);
        setCachedTranslation(cacheKey, cleaned);
        return cleaned;
      }
    }
  } catch (_) {}

  // Tier 2: Chrome Extension dict endpoint on translate.googleapis.com
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data && Array.isArray(data[0])) {
        const res = data[0].map((part: any) => part[0] || "").join("").trim();
        if (res) {
          const cleaned = sanitizeTranslatedText(res);
          setCachedTranslation(cacheKey, cleaned);
          return cleaned;
        }
      }
    }
  } catch (_) {}

  // Tier 3: Free MyMemory Translation API
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=autodetect|${tl}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (response.ok) {
      const data: any = await response.json();
      const res = data?.responseData?.translatedText;
      if (res && res.trim() && !res.includes("MYMEMORY WARNING")) {
        const cleaned = sanitizeTranslatedText(res);
        setCachedTranslation(cacheKey, cleaned);
        return cleaned;
      }
    }
  } catch (_) {}

  // Tier 4: Fallback Google GTX endpoint (with safe error suppression)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data && Array.isArray(data[0])) {
        const res = data[0].map((part: any) => part[0] || "").join("").trim();
        if (res) {
          const cleaned = sanitizeTranslatedText(res);
          setCachedTranslation(cacheKey, cleaned);
          return cleaned;
        }
      }
    }
  } catch (_) {}

  // Final fallback: Return original text safely without throwing errors
  return sanitizeTranslatedText(trimmed);
}

// Helper: High-Efficiency Batch Translation (Reduces N queries to 1 single request)
async function translateBatchWithGoogleFree(texts: string[], targetLanguage: string): Promise<string[]> {
  if (!texts || texts.length === 0) return [];
  const tl = resolveLanguageCode(targetLanguage);

  // 1. Identify which texts are already in cache
  const results: (string | null)[] = new Array(texts.length).fill(null);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const raw = (texts[i] || "").trim();
    if (!raw) {
      results[i] = "";
      continue;
    }
    const cacheKey = `${tl}:::${raw}`;
    if (translationCache.has(cacheKey)) {
      results[i] = sanitizeTranslatedText(translationCache.get(cacheKey)!);
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(raw);
    }
  }

  if (uncachedIndices.length === 0) {
    return results.map((r, idx) => sanitizeTranslatedText(r ?? texts[idx]));
  }

  // 2. Try batch translate uncached texts using unique delimiter ' === ' if length is reasonable (< 3200 chars)
  const sep = " === ";
  const joined = uncachedTexts.join(sep);

  if (joined.length < 3200 && uncachedTexts.length > 1) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=it&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(joined)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "GoogleTranslate/6.28.0.05.357134015 (iPhone; iOS 15.0; Scale/3.00)"
        },
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data: any = await response.json();
        const joinedTranslation = data[0]?.map((p: any) => p[0] || "").join("").trim();
        if (joinedTranslation) {
          const splitParts = joinedTranslation.split(/\s*===\s*/g).map((s: string) => s.trim());
          if (splitParts.length === uncachedTexts.length) {
            for (let k = 0; k < splitParts.length; k++) {
              const origIndex = uncachedIndices[k];
              const transText = sanitizeTranslatedText(splitParts[k] || uncachedTexts[k]);
              results[origIndex] = transText;
              setCachedTranslation(`${tl}:::${uncachedTexts[k]}`, transText);
            }
          }
        }
      }
    } catch (_) {}
  }

  // 3. For any remaining items, translate concurrently in parallel (bounded batch)
  const remainingIndices = uncachedIndices.filter(idx => results[idx] === null);
  if (remainingIndices.length > 0) {
    const CONCURRENCY = 6;
    for (let i = 0; i < remainingIndices.length; i += CONCURRENCY) {
      const chunk = remainingIndices.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (origIndex) => {
          try {
            const rawText = uncachedTexts[uncachedIndices.indexOf(origIndex)];
            const trans = await translateWithGoogleFree(rawText, targetLanguage);
            results[origIndex] = sanitizeTranslatedText(trans);
          } catch (_) {
            results[origIndex] = sanitizeTranslatedText(texts[origIndex]);
          }
        })
      );
    }
  }

  return results.map((r, idx) => sanitizeTranslatedText(r ?? texts[idx]));
}

// In-Memory Page OCR & Translation LRU Cache (Instant cache hit for repeated visits)
const pageOcrCache = new Map<string, { data: any; timestamp: number }>();
const MAX_PAGE_OCR_CACHE = 500;

function computeFastOcrCacheKey(imageUrl: string | undefined, imageBase64: string | undefined, targetLang: string, engine: string): string {
  if (imageUrl) {
    return `url:${imageUrl}_${targetLang}_${engine}`;
  }
  if (imageBase64) {
    let hash = 0;
    const len = imageBase64.length;
    const sample = imageBase64.slice(0, 300) + imageBase64.slice(Math.floor(len / 2), Math.floor(len / 2) + 300) + imageBase64.slice(-300) + len;
    for (let i = 0; i < sample.length; i++) {
      hash = ((hash << 5) - hash) + sample.charCodeAt(i);
      hash |= 0;
    }
    return `b64:${hash}_${len}_${targetLang}_${engine}`;
  }
  return "";
}

// @ts-ignore
import chromeLensOcr from 'chrome-lens-ocr';
import sharp from 'sharp';
try {
  sharp.cache({ memory: 128, files: 20, items: 100 });
} catch (_) {}
const Lens = typeof chromeLensOcr === 'function' ? chromeLensOcr : (chromeLensOcr as any).default || chromeLensOcr;
const lens = new Lens();

// Helper: Gemini Vision OCR Fallback if Lens OCR is unavailable or fails (1:1 from Old Project)
async function ocrWithGeminiVision(buffer: Buffer): Promise<any[]> {
  try {
    const aiClient = getGeminiClient();
    const metadata = await sharp(buffer).metadata();
    let processedBuffer = buffer;
    if (metadata.height && metadata.height > 3500) {
      processedBuffer = await sharp(buffer)
        .resize({ height: 3500, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    } else {
      processedBuffer = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
    }
    const base64 = processedBuffer.toString("base64");

    console.log("[Gemini Vision OCR] Running Gemini Vision OCR fallback...");
    const prompt = `Act as a Manga/Comic OCR engine. Detect ALL speech bubbles, dialogue, and text boxes in this image.
Return a strictly valid JSON array of objects. Each object must have:
- "text": The transcribed original dialogue text.
- "box": Array of 4 numbers [ymin, xmin, ymax, xmax] in 0-1000 scale representing the bounding box around the speech bubble.
Example: [{"text": "Hello", "box": [120, 300, 180, 450]}]`;

    const response = await aiClient.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        { inlineData: { mimeType: "image/jpeg", data: base64 } },
        { text: prompt }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    if (!response || !response.text) return [];
    let cleanText = response.text.trim();
    const codeMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeMatch) cleanText = codeMatch[1].trim();
    const parsed = JSON.parse(cleanText);
    const arr = Array.isArray(parsed) ? parsed : (parsed.page_translations || parsed.blocks || parsed.bubbles || []);
    if (!Array.isArray(arr)) return [];

    const blocks = arr.map((item: any, idx: number) => {
      const box = item.box || [0, 0, 100, 100];
      const yMin = Math.max(0, Math.min(100, (box[0] / 1000) * 100));
      const xMin = Math.max(0, Math.min(100, (box[1] / 1000) * 100));
      const yMax = Math.max(0, Math.min(100, (box[2] / 1000) * 100));
      const xMax = Math.max(0, Math.min(100, (box[3] / 1000) * 100));
      const regId = `region_gemini_${idx}_${Math.round(xMin)}_${Math.round(yMin)}`;
      return {
        region_id: regId,
        id: regId,
        originalText: (item.text || "").trim(),
        original_text: (item.text || "").trim(),
        translatedText: "",
        translated_text: "",
        box: { xMin, xMax, yMin, yMax }
      };
    }).filter((b: any) => b.originalText.length > 0);

    console.log(`[Gemini Vision OCR] Successfully extracted ${blocks.length} speech bubbles.`);
    return blocks;
  } catch (err: any) {
    console.error("[Gemini Vision OCR Fallback Error]:", err.message || err);
    return [];
  }
}

// In-Flight OCR deduplication to prevent double-processing identical pages
const inFlightOcrRequests = new Map<string, Promise<any>>();

// 8. OCR & Translation Endpoint (Lens + Google/Gemini)
app.post("/api/manga/ocr", async (req, res) => {
  try {
    const {
      imageUrl,
      imageBase64,
      targetLanguage = "Arabic",
      sourceLanguage = "auto",
      translatorEngine = "google",
      skipTranslation = false,
      mangaContext = "",
      mangaTitle = "",
      workType = "",
      forceRefresh = false,
      ocrEngine = "google_lens"
    } = req.body;
    if (!imageUrl && !imageBase64) {
      return res.status(400).json({ error: "Missing imageUrl or imageBase64" });
    }

    // Check in-memory page OCR cache for instant 0ms response
    const effectiveEngine = skipTranslation ? `${ocrEngine}_ocr_only` : `${ocrEngine}_${translatorEngine}`;
    const cacheKey = computeFastOcrCacheKey(imageUrl, imageBase64, targetLanguage, effectiveEngine);
    if (!forceRefresh && cacheKey && pageOcrCache.has(cacheKey)) {
      const hit = pageOcrCache.get(cacheKey)!;
      console.log(`[ComicVision] Cache hit! Returning instant OCR result for ${cacheKey.slice(0, 40)}...`);
      return res.json(hit.data);
    }
    if (forceRefresh && cacheKey && pageOcrCache.has(cacheKey)) {
      pageOcrCache.delete(cacheKey);
    }

    let finalBase64 = "";
    let finalMimeType = "image/jpeg";

    if (imageBase64) {
      // Direct base64 input from uploaded page
      finalBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
      const match = imageBase64.match(/^data:([^;]+);base64,/);
      if (match) {
        finalMimeType = match[1];
      }
    } else {
      // If imageUrl is already a proxy url or relative, resolve properly
      let actualFetchUrl = imageUrl.trim();
      while (actualFetchUrl.includes("/api/proxy-image?url=") || actualFetchUrl.includes("proxy-image?url=")) {
        const parts = actualFetchUrl.split(/proxy-image\?url=/i);
        const last = parts[parts.length - 1];
        try {
          actualFetchUrl = decodeURIComponent(last).trim();
        } catch {
          actualFetchUrl = last.trim();
        }
      }

      if (actualFetchUrl.startsWith("//")) {
        actualFetchUrl = "https:" + actualFetchUrl;
      } else if (actualFetchUrl.startsWith("/")) {
        actualFetchUrl = `http://127.0.0.1:${PORT}${actualFetchUrl}`;
      } else if (actualFetchUrl.startsWith("http://localhost:")) {
        actualFetchUrl = actualFetchUrl.replace("http://localhost:", "http://127.0.0.1:");
      } else if (actualFetchUrl.startsWith("http://0.0.0.0:")) {
        actualFetchUrl = actualFetchUrl.replace("http://0.0.0.0:", "http://127.0.0.1:");
      }

      // Check instant in-memory cache first (0ms latency, eliminates redundant network download)
      const cached = getCachedImageBuffer(actualFetchUrl);
      if (cached) {
        finalMimeType = cached.contentType;
        finalBase64 = cached.buffer.toString("base64");
      } else {
        let parsed: URL;
        try {
          parsed = new URL(actualFetchUrl);
        } catch {
          return res.status(400).json({ error: `Invalid image URL for OCR: ${actualFetchUrl}` });
        }

      let referer = "https://mangadex.org";
      const host = parsed.hostname.toLowerCase();
      if (host.includes("readdetectiveconan") || host.includes("mangapill")) {
        referer = "https://mangapill.com/";
      } else if (host.includes("planeptune") || host.includes("weebcentral")) {
        referer = "https://weebcentral.com/";
      } else if (host.includes("mangakakalot") || host.includes("manganato")) {
        referer = "https://mangakakalot.gg/";
      } else if (host.includes("comick")) {
        referer = "https://comick.art/";
      } else if (host.includes("mangahere")) {
        referer = "https://mangahere.cc/";
      } else if (host.includes("3asq")) {
        referer = "https://3asq.online/";
      } else if (host.includes("mangadex")) {
        referer = "https://mangadex.org/";
      } else {
        referer = `${parsed.protocol}//${parsed.hostname}/`;
      }

      // Fetch the image to send to Lens / Gemini OCR
      let imageResponse: Response | null = null;
      const ocrUrlsToTry = [actualFetchUrl];
      if (host.includes("mangadex.network")) {
        ocrUrlsToTry.push(`https://uploads.mangadex.org${parsed.pathname}${parsed.search}`);
      }
      if (/[0-9]+[a-z]\.[a-z]+$/i.test(actualFetchUrl)) {
        ocrUrlsToTry.push(actualFetchUrl.replace(/([0-9]+)[a-z]\.([a-z]+)$/i, "$1.$2"));
      }
      if (/\.png$/i.test(actualFetchUrl)) {
        ocrUrlsToTry.push(actualFetchUrl.replace(/\.png$/i, ".jpg"));
        ocrUrlsToTry.push(actualFetchUrl.replace(/\.png$/i, ".webp"));
      } else if (/\.jpe?g$/i.test(actualFetchUrl)) {
        ocrUrlsToTry.push(actualFetchUrl.replace(/\.jpe?g$/i, ".png"));
      }

      let lastErr: any = null;
      for (const urlToFetch of ocrUrlsToTry) {
        try {
          const res = await fetch(urlToFetch, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": urlToFetch.includes("mangadex") ? "https://mangadex.org/" : referer,
              "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
            },
            signal: AbortSignal.timeout(15000)
          });
          if (res.ok) {
            imageResponse = res;
            break;
          }
        } catch (fErr: any) {
          lastErr = fErr;
        }
      }

      if (!imageResponse || !imageResponse.ok) {
        try {
          const localProxyUrl = `http://127.0.0.1:${PORT}/api/proxy-image?url=${encodeURIComponent(actualFetchUrl)}`;
          const proxyRes = await fetch(localProxyUrl, { signal: AbortSignal.timeout(15000) });
          if (proxyRes.ok) {
            imageResponse = proxyRes;
          }
        } catch (_) {}
      }

      if (!imageResponse || !imageResponse.ok) {
        console.info(`[OCR] Image unavailable for OCR (${actualFetchUrl}), skipping without failing batch.`);
        return res.json({ blocks: [], pageUnavailable: true });
      }

      finalMimeType = imageResponse.headers.get("content-type") || "image/jpeg";
      if (finalMimeType.includes("svg") || finalMimeType.includes("html") || finalMimeType.includes("text") || finalMimeType.includes("json")) {
        console.info(`[OCR] Skipping non-image response (${finalMimeType}) for ${actualFetchUrl}`);
        return res.json({ blocks: [], pageUnavailable: true });
      }
      const arrayBuffer = await imageResponse.arrayBuffer();
      const imgBuffer = Buffer.from(arrayBuffer);
      setCachedImageBuffer(actualFetchUrl, imgBuffer, finalMimeType);
      finalBase64 = imgBuffer.toString("base64");
    }
  }

    const initialBuffer = Buffer.from(finalBase64, 'base64');

    if (ocrEngine === "comic_vision") {
      console.log(`[ComicVision] Starting Advanced Comic Vision OCR & Speech Bubble Detection pipeline...`);
      
      const analysis = await analyzeComicPage(initialBuffer, {
        targetLanguage,
        sourceLanguage: sourceLanguage || "auto",
        mangaTitle,
        workType,
        readingDirection: (workType && workType.includes("مانجا يابانية")) ? "rtl" : "auto"
      });

      let blocks: any[] = analysis.blocks;

      if (!skipTranslation && translatorEngine !== "none" && Array.isArray(blocks) && blocks.length > 0 && translatorEngine === "google") {
        try {
          const textsToTranslate = blocks.map((b: any) => (b.original_text || b.originalText || "").trim());
          const translations = await translateBatchWithGoogleFree(textsToTranslate, targetLanguage);
          const translationMap: Record<string, string> = {};
          for (let idx = 0; idx < blocks.length; idx++) {
            const regId = blocks[idx].region_id || blocks[idx].id || `region_${String(idx + 1).padStart(3, '0')}`;
            translationMap[regId] = translations[idx] || blocks[idx].original_text || blocks[idx].originalText;
          }
          blocks = blocks.map((block: any, idx: number) => {
            const regId = block.region_id || block.id || `region_${String(idx + 1).padStart(3, '0')}`;
            const trans = translationMap[regId] || translations[idx] || block.original_text || block.originalText;
            return {
              ...block,
              region_id: regId,
              id: regId,
              translated_text: trans,
              translatedText: trans
            };
          });
        } catch (transErr: any) {
          console.warn("Translation fallback notice:", transErr.message || transErr);
        }
      }

      const responseData = { blocks, metadata: analysis.metadata };
      if (cacheKey) {
        pageOcrCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
      }
      return res.json(responseData);
    }

    // 1:1 Old Project Source of Truth OCR Pipeline (Google Lens + Chunking + Exact Bubble Clustering + Gemini Fallback)
    console.log(`[GoogleLens] Starting Google Lens OCR layout extraction (Source of Truth)...`);
    const buffer = await sharp(initialBuffer).rotate().toBuffer();
    
    // Split image if it's too tall to avoid Lens API downsizing and missing small text
    let segments: any[] = [];
    try {
        const metadata = await sharp(buffer).metadata();
        const width = metadata.width || 1000;
        const height = metadata.height || 1000;
        
        // Use 3200px chunk height for crisp text while minimizing chunk count
        const CHUNK_HEIGHT = 3200;
        
        if (height > CHUNK_HEIGHT) {
           const numChunks = Math.ceil(height / CHUNK_HEIGHT);
           console.log(`Image is tall (${width}x${height}). Splitting into ${numChunks} chunks.`);
           
           const chunkList: { y: number; extractHeight: number }[] = [];
           for (let y = 0; y < height; y += CHUNK_HEIGHT) {
              const extractHeight = Math.min(CHUNK_HEIGHT, height - y);
              chunkList.push({ y, extractHeight });
           }

           // Process chunks with concurrency of 2 for maximum speed
           for (let c = 0; c < chunkList.length; c += 2) {
             const batch = chunkList.slice(c, c + 2);
             await Promise.all(batch.map(async ({ y, extractHeight }) => {
                let retries = 2;
                while (retries > 0) {
                  try {
                    const chunkBuffer = await sharp(buffer)
                      .extract({ left: 0, top: y, width, height: extractHeight })
                      .jpeg({ quality: 80 })
                      .toBuffer();
                    
                    const scanResult = await lens.scanByBuffer(chunkBuffer);
                    for (const seg of scanResult.segments || []) {
                       if (seg.boundingBox.pixelCoords) {
                           seg.boundingBox.pixelCoords.y += y;
                       }
                       
                       const globalCenterY = (y + seg.boundingBox.centerPerY * extractHeight) / height;
                       const globalPerHeight = (seg.boundingBox.perHeight * extractHeight) / height;
                       
                       seg.boundingBox.centerPerY = globalCenterY;
                       seg.boundingBox.perHeight = globalPerHeight;
                       
                       segments.push(seg);
                    }
                    break;
                  } catch (err: any) {
                    console.warn(`Lens OCR chunk at y=${y} notice:`, err.message || err);
                    retries--;
                    if (retries > 0) await new Promise(r => setTimeout(r, 400));
                  }
                }
             }));
           }
        } else {
           let retries = 2;
           while (retries > 0) {
             try {
               const scanResult = await lens.scanByBuffer(buffer);
               segments = scanResult.segments || [];
               break;
             } catch (err: any) {
               console.warn(`Lens OCR notice (retries left: ${retries - 1}):`, err.message || err);
               retries--;
               if (retries > 0) await new Promise(r => setTimeout(r, 500));
             }
           }
        }
    } catch (e: any) {
        console.warn("Lens OCR chunking notice:", e.message || e);
    }
    
    console.log(`Lens found ${segments.length} text segments.`);

    let blocks: any[] = [];

    // If Lens OCR returned 0 segments (e.g. rate limit, captcha, or blocked), fallback to Gemini Vision OCR!
    if (segments.length === 0) {
      console.log("Lens returned 0 segments. Engaging Gemini Vision OCR fallback...");
      blocks = await ocrWithGeminiVision(buffer);
    } else {
      // Cluster segments into bubbles (EXACT 1:1 math from Old Project)
      const clusters: any[][] = [];
      for (const seg of segments) {
        let bestCluster = null;
        let minDistance = Infinity;

        for (const cluster of clusters) {
          for (const cSeg of cluster) {
            const pc1 = seg.boundingBox.pixelCoords;
            const pc2 = cSeg.boundingBox.pixelCoords;
            
            if (!pc1 || !pc2) {
                const dx = Math.abs(seg.boundingBox.centerPerX - cSeg.boundingBox.centerPerX);
                const dy = Math.abs(seg.boundingBox.centerPerY - cSeg.boundingBox.centerPerY);
                const avgHeight = (seg.boundingBox.perHeight + cSeg.boundingBox.perHeight) / 2;
                const avgWidth = (seg.boundingBox.perWidth + cSeg.boundingBox.perWidth) / 2;
                const maxDx = Math.max(0.015, avgWidth * 1.0);
                const maxDy = Math.max(0.015, avgHeight * 1.0);
                const heightRatio = Math.max(seg.boundingBox.perHeight, cSeg.boundingBox.perHeight) / 
                                    Math.max(0.001, Math.min(seg.boundingBox.perHeight, cSeg.boundingBox.perHeight));
                if (dx < maxDx && dy < maxDy && heightRatio <= 2.5) {
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestCluster = cluster;
                    }
                }
                continue;
            }
            
            const centerX1 = pc1.x + pc1.width / 2;
            const centerY1 = pc1.y + pc1.height / 2;
            const centerX2 = pc2.x + pc2.width / 2;
            const centerY2 = pc2.y + pc2.height / 2;

            const dx = Math.abs(centerX1 - centerX2);
            const dy = Math.abs(centerY1 - centerY2);
            
            const avgHeight = (pc1.height + pc2.height) / 2;
            const avgWidth = (pc1.width + pc2.width) / 2;
            
            const gapX = Math.max(0, dx - (pc1.width + pc2.width) / 2);
            const gapY = Math.max(0, dy - (pc1.height + pc2.height) / 2);
            
            const maxGapX = Math.max(8, avgHeight * 0.85);
            const maxGapY = Math.max(8, avgHeight * 0.85);
            const heightRatio = Math.max(pc1.height, pc2.height) / Math.max(1, Math.min(pc1.height, pc2.height));

            if (gapX <= maxGapX && gapY <= maxGapY && heightRatio <= 2.5) {
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestCluster = cluster;
                }
            }
          }
        }
        if (bestCluster) {
          bestCluster.push(seg);
        } else {
          clusters.push([seg]);
        }
      }

      blocks = clusters.map(cluster => {
        cluster.sort((a, b) => a.boundingBox.centerPerY - b.boundingBox.centerPerY);
        const originalText = cluster.map(c => c.text).join(' ');
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const seg of cluster) {
            const box = seg.boundingBox;
            const x1 = box.centerPerX - box.perWidth / 2;
            const x2 = box.centerPerX + box.perWidth / 2;
            const y1 = box.centerPerY - box.perHeight / 2;
            const y2 = box.centerPerY + box.perHeight / 2;
            if (x1 < minX) minX = x1;
            if (x2 > maxX) maxX = x2;
            if (y1 < minY) minY = y1;
            if (y2 > maxY) maxY = y2;
        }
        const xMinP = Math.max(0, minX * 100);
        const xMaxP = Math.min(100, maxX * 100);
        const yMinP = Math.max(0, minY * 100);
        const yMaxP = Math.min(100, maxY * 100);
        const region_id = `region_${Math.round(xMinP)}_${Math.round(yMinP)}_${Math.round(xMaxP)}`;
        
        return {
          region_id,
          id: region_id,
          originalText,
          original_text: originalText,
          translatedText: "",
          translated_text: "",
          box: {
            xMin: xMinP,
            xMax: xMaxP,
            yMin: yMinP,
            yMax: yMaxP
          }
        };
      });
    }

    console.log(`Clustered into ${blocks.length} text bubbles.`);

    // Perform translation using Google Translate free API if requested or fallback
    if (!skipTranslation && Array.isArray(blocks) && blocks.length > 0 && translatorEngine === "google") {
      console.log(`Translating ${blocks.length} blocks via free Google Translate API in parallel...`);
      blocks = await Promise.all(
        blocks.map(async (block: any) => {
          if (block.originalText && block.originalText.trim()) {
            const googleTranslation = await translateWithGoogleFree(block.originalText, targetLanguage);
            return {
              ...block,
              translatedText: googleTranslation,
              translated_text: googleTranslation
            };
          }
          return block;
        })
      );
    } else {
      console.log(`Keeping original texts for Gemini translation.`);
    }

    const responseData = { blocks };
    if (cacheKey) {
      if (pageOcrCache.size >= MAX_PAGE_OCR_CACHE) {
        const oldestKey = pageOcrCache.keys().next().value;
        if (oldestKey) pageOcrCache.delete(oldestKey);
      }
      pageOcrCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    }

    return res.json(responseData);
  } catch (error: any) {
    console.error("OCR Translation Error:", error);
    res.status(500).json({ error: error.message || "OCR Translation failed" });
  }
});

// Endpoint: Re-OCR specific region on demand
app.post("/api/manga/re-ocr", async (req, res) => {
  try {
    const { imageBase64, regionBox, language, engine } = req.body;
    if (!imageBase64 || !regionBox) {
      return res.status(400).json({ error: "Missing imageBase64 or regionBox" });
    }
    const buffer = Buffer.from(imageBase64, "base64");
    const result = await reOcrRegion(buffer, regionBox, { language, engine });
    res.json(result);
  } catch (err: any) {
    console.error("Re-OCR Error:", err);
    res.status(500).json({ error: err.message || "Re-OCR failed" });
  }
});

// Endpoint: Inpainting / clean page background generator (Powered by Hybrid Vision Engine)
app.post("/api/manga/inpaint", async (req, res) => {
  try {
    const { imageBase64, blocks } = req.body;
    if (!imageBase64 || !blocks) {
      return res.status(400).json({ error: "Missing imageBase64 or blocks" });
    }
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const cleanedBuffer = await hybridInpaintPageText(buffer, blocks);
    const cleanedBase64 = cleanedBuffer.toString("base64");
    res.json({ cleanedImage: `data:image/jpeg;base64,${cleanedBase64}` });
  } catch (err: any) {
    console.error("Inpaint Error:", err);
    res.status(500).json({ error: err.message || "Inpainting failed" });
  }
});

// Endpoint: Full 12-Stage Hybrid Manga Vision Engine
app.post("/api/manga/hybrid-vision", async (req, res) => {
  try {
    const {
      imageUrl,
      imageBase64,
      pageId = 0,
      readingDirection = "rtl",
      sourceLanguage = "auto",
      targetLanguage = "ar",
      skipTranslation = false,
      skipInpainting = false,
      renderArabicOverlay = false,
      forceRefresh = false,
    } = req.body;

    if (!imageUrl && !imageBase64) {
      return res.status(400).json({ error: "Missing imageUrl or imageBase64" });
    }

    let buffer: Buffer;
    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
      buffer = Buffer.from(cleanBase64, "base64");
    } else {
      let actualFetchUrl = imageUrl.trim();
      while (actualFetchUrl.includes("/api/proxy-image?url=") || actualFetchUrl.includes("proxy-image?url=")) {
        const parts = actualFetchUrl.split(/proxy-image\?url=/i);
        actualFetchUrl = decodeURIComponent(parts[parts.length - 1]);
      }
      const resp = await axios.get(actualFetchUrl, { responseType: "arraybuffer", timeout: 25000 });
      buffer = Buffer.from(resp.data);
    }

    const result = await finalComposer.processPage(buffer, {
      pageId,
      targetLanguage,
      sourceLanguage,
      readingDirection,
      forceRefresh,
      skipTranslation,
      skipInpainting,
      renderArabicOverlay,
    });

    const responsePayload: any = {
      pageId: result.pageId,
      dimensions: result.dimensions,
      regions: result.regions,
      blocks: result.regions,
      metadata: result.metadata,
    };

    if (result.cleanImageBuffer) {
      responsePayload.cleanedImage = `data:image/jpeg;base64,${result.cleanImageBuffer.toString("base64")}`;
    }
    if (result.finalImageBuffer) {
      responsePayload.finalImage = `data:image/jpeg;base64,${result.finalImageBuffer.toString("base64")}`;
    }

    res.json(responsePayload);
  } catch (err: any) {
    console.error("Hybrid Vision Error:", err);
    res.status(500).json({ error: err.message || "Hybrid Vision processing failed" });
  }
});

// Endpoint: Render Arabic Typeset Text on Clean Page
app.post("/api/manga/render-arabic", async (req, res) => {
  try {
    const { imageBase64, blocks } = req.body;
    if (!imageBase64 || !blocks) {
      return res.status(400).json({ error: "Missing imageBase64 or blocks" });
    }
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    const renderedBuffer = await hybridRenderArabicPage(buffer, blocks);
    const renderedBase64 = renderedBuffer.toString("base64");
    res.json({ renderedImage: `data:image/jpeg;base64,${renderedBase64}` });
  } catch (err: any) {
    console.error("Render Arabic Error:", err);
    res.status(500).json({ error: err.message || "Render Arabic failed" });
  }
});

// Endpoint: Dedicated Google Lens Background Worker OCR
app.post("/api/manga/google-lens-ocr", async (req, res) => {
  try {
    const {
      imageUrl,
      imageBase64,
      pageId = 0,
      pageIndex = 0,
      readingDirection = "rtl",
      language = "auto",
      targetLanguage = "Arabic",
      skipTranslation = false,
      forceRefresh = false
    } = req.body;

    if (!imageUrl && !imageBase64) {
      return res.status(400).json({ error: "Missing imageUrl or imageBase64" });
    }

    let finalBuffer: Buffer;
    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
      finalBuffer = Buffer.from(cleanBase64, "base64");
    } else {
      let actualFetchUrl = imageUrl.trim();
      while (actualFetchUrl.includes("/api/proxy-image?url=") || actualFetchUrl.includes("proxy-image?url=")) {
        const parts = actualFetchUrl.split(/proxy-image\?url=/i);
        const last = parts[parts.length - 1];
        try { actualFetchUrl = decodeURIComponent(last).trim(); } catch { actualFetchUrl = last.trim(); }
      }
      if (actualFetchUrl.startsWith("//")) actualFetchUrl = "https:" + actualFetchUrl;
      else if (actualFetchUrl.startsWith("/")) actualFetchUrl = `http://127.0.0.1:${PORT}${actualFetchUrl}`;
      else if (actualFetchUrl.startsWith("http://localhost:")) actualFetchUrl = actualFetchUrl.replace("http://localhost:", "http://127.0.0.1:");
      else if (actualFetchUrl.startsWith("http://0.0.0.0:")) actualFetchUrl = actualFetchUrl.replace("http://0.0.0.0:", "http://127.0.0.1:");

      const cached = getCachedImageBuffer(actualFetchUrl);
      if (cached) {
        finalBuffer = cached.buffer;
      } else {
        const fetchRes = await fetch(actualFetchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          },
          signal: AbortSignal.timeout(15000)
        });
        if (!fetchRes.ok) {
          return res.status(404).json({ error: `Could not fetch image: ${actualFetchUrl}` });
        }
        const arrayBuf = await fetchRes.arrayBuffer();
        finalBuffer = Buffer.from(arrayBuf);
        setCachedImageBuffer(actualFetchUrl, finalBuffer, fetchRes.headers.get("content-type") || "image/jpeg");
      }
    }

    const ocrResult = await processWithGoogleLensWorker(finalBuffer, {
      pageId: pageId ?? pageIndex,
      pageIndex: pageIndex ?? pageId,
      language,
      targetLanguage,
      readingDirection: readingDirection === "ltr" ? "ltr" : "rtl",
      skipTranslation: Boolean(skipTranslation),
      forceRefresh
    });

    res.json(ocrResult);
  } catch (err: any) {
    console.error("[GoogleLensOCR Endpoint] Error:", err);
    res.status(500).json({ error: err.message || "Google Lens OCR failed" });
  }
});

// Helper: Generate CapCut TTS using direct TikTok session API or free Weilnet Cloudflare proxy
async function getCapCutAudio(text: string, voiceName: string): Promise<string> {
  const sessionid = process.env.TIKTOK_SESSION_ID || process.env.CAPCUT_SESSION_ID;
  if (sessionid) {
    try {
      console.log(`[CapCut Direct] Attempting direct TikTok/CapCut TTS API for voice: ${voiceName}...`);
      const url = `https://api16-normal-v6.tiktokv.com/media/api/text/speech/invoke/?text_speaker=${voiceName}&req_text=${encodeURIComponent(text)}&speaker_map_type=0&aid=1233`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          'User-Agent': 'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; es_ES; SM-G988N; Build/NRD90M;tt-ok/3.12.13.1)',
          'Cookie': `sessionid=${sessionid}`,
          'Accept-Encoding': 'gzip,deflate,compress'
        }
      });
      if (response.ok) {
        const data: any = await response.json();
        if (data?.status_code === 0 && data?.data?.v_str) {
          console.log(`[CapCut Direct] Direct TikTok/CapCut TTS API Succeeded!`);
          return data.data.v_str;
        } else {
          console.warn(`[CapCut Direct] Direct TTS API returned code ${data?.status_code}: ${data?.message}`);
        }
      } else {
        console.warn(`[CapCut Direct] Direct TTS API responded with status ${response.status}`);
      }
    } catch (err: any) {
      console.warn(`[CapCut Direct] Direct TTS API error: ${err.message}`);
    }
  }

  // Fallback to Free Weilnet Workers Proxy (Zero Configuration, Zero login required!)
  try {
    const response = await fetch("https://tiktok-tts.weilnet.workers.dev/api/generation", {
      method: "POST",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice: voiceName
      }),
      signal: AbortSignal.timeout(2500)
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data?.success && data?.data) {
        console.log(`[CapCut Proxy] Weilnet worker proxy Succeeded!`);
        return data.data;
      }
    }
  } catch (_) {}

  throw new Error("CapCut voice endpoint currently unavailable");
}

// Helper: Robust Edge TTS Generator - strictly uses requested voice without changing it
async function generateEdgeTtsAudioBuffer(text: string, voiceName: string): Promise<Buffer> {
  // Attempt 1: Standard Edge TTS using the exact requested voice
  try {
    const comm = new Communicate(text, { voice: voiceName });
    const chunks: Buffer[] = [];
    for await (const chunk of comm.stream()) {
      if (chunk.type === "audio") {
        chunks.push(Buffer.from(chunk.data));
      }
    }
    if (chunks.length > 0) {
      return Buffer.concat(chunks);
    }
  } catch (err: any) {
    console.warn(`[Edge TTS Attempt 1] Standard failed for ${voiceName}:`, err.message || err);
  }

  // Attempt 2: Retry with exact same voice (handles transient network glitch)
  try {
    const comm = new Communicate(text, { voice: voiceName });
    const chunks: Buffer[] = [];
    for await (const chunk of comm.stream()) {
      if (chunk.type === "audio") {
        chunks.push(Buffer.from(chunk.data));
      }
    }
    if (chunks.length > 0) {
      return Buffer.concat(chunks);
    }
  } catch (err: any) {
    console.warn(`[Edge TTS Attempt 2] Retry failed for ${voiceName}:`, err.message || err);
  }

  // Attempt 3: Final retry with exact same voice
  try {
    const comm = new Communicate(text, { voice: voiceName });
    const chunks: Buffer[] = [];
    for await (const chunk of comm.stream()) {
      if (chunk.type === "audio") {
        chunks.push(Buffer.from(chunk.data));
      }
    }
    if (chunks.length > 0) {
      return Buffer.concat(chunks);
    }
  } catch (err: any) {
    console.warn(`[Edge TTS Attempt 3] Final retry failed for ${voiceName}:`, err.message || err);
  }

  throw new Error(`تعذر توليد الصوت للصوت المختار (${voiceName}).`);
}

// Convert linear 16-bit PCM buffer to standard RIFF WAV buffer
function pcm16ToWavBuffer(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1): Buffer {
  const wavHeader = Buffer.alloc(44);
  const totalDataLen = pcmBuffer.length;
  const totalFileLen = totalDataLen + 36;
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;

  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(totalFileLen, 4);
  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  wavHeader.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(16, 34); // BitsPerSample
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(totalDataLen, 40);

  return Buffer.concat([wavHeader, pcmBuffer]);
}

// Official Gemini TTS preview prebuilt voices
const OFFICIAL_GEMINI_TTS_VOICES = ["Puck", "Charon", "Kore", "Fenrir", "Aoede", "Zephyr"];

function mapToGeminiApiVoice(voiceName: string): string {
  const clean = (voiceName || "").replace(/^gemini-/, "").trim();
  const match = OFFICIAL_GEMINI_TTS_VOICES.find((v) => v.toLowerCase() === clean.toLowerCase());
  if (match) return match;

  const lower = clean.toLowerCase();
  if (lower.includes("demo") || ["achernar", "enceladus", "charon"].some((v) => lower.includes(v))) return "Charon";
  if (["aoede", "leda", "autonoe", "algieba"].some((v) => lower.includes(v))) return "Aoede";
  if (["kore"].some((v) => lower.includes(v))) return "Kore";
  if (["fenrir"].some((v) => lower.includes(v))) return "Fenrir";
  if (["zephyr"].some((v) => lower.includes(v))) return "Zephyr";
  return "Aoede";
}

let directGeminiTTSCooldownUntil = 0;

// High-speed direct synthesis using official Google GenAI SDK & Gemini TTS Preview model
async function synthesizeGeminiTTSDirect(
  text: string,
  voiceName: string,
  voiceDirection?: string
): Promise<{ audioBase64: string; mimeType: string; byteLength: number }> {
  const client = getGeminiClient();
  const targetVoice = mapToGeminiApiVoice(voiceName);

  const trySynthesize = async (promptText: string) => {
    const response = await client.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: promptText }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: targetVoice },
          },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const inlineData = part?.inlineData;
    if (!inlineData || !inlineData.data) {
      throw new Error("Direct Gemini TTS response missing audio inlineData");
    }

    const pcmBuffer = Buffer.from(inlineData.data, "base64");
    let sampleRate = 24000;
    const rateMatch = (inlineData.mimeType || "").match(/rate=(\d+)/i);
    if (rateMatch && rateMatch[1]) {
      sampleRate = parseInt(rateMatch[1], 10) || 24000;
    }

    const wavBuffer = pcm16ToWavBuffer(pcmBuffer, sampleRate, 1);
    return {
      audioBase64: wavBuffer.toString("base64"),
      mimeType: "audio/wav",
      byteLength: wavBuffer.length,
    };
  };

  if (voiceDirection && voiceDirection.trim()) {
    try {
      return await trySynthesize(`${voiceDirection.trim()}: ${text}`);
    } catch (e: any) {
      console.warn(`[Gemini TTS Direct] Synthesis with voice direction failed (${e.message}), retrying plain text with official voice ${targetVoice}...`);
      const isQuota = e.message?.includes("429") || e.message?.includes("quota") || e.message?.includes("RESOURCE_EXHAUSTED");
      if (isQuota) {
        throw e;
      }
    }
  }

  return await trySynthesize(text);
}

// Official Gemini TTS Synthesizer: Strictly Official Gemini Voices Only (Direct API -> Official Google Cloud Demo Session)
// STRICT NO-FALLBACK POLICY: Never substitute or simulate Gemini voices with Microsoft Neural, Edge TTS, or any other engine.
async function synthesizeOfficialGeminiTTS(
  text: string,
  rawVoiceName: string,
  languageCode: string = "ar-EG",
  voiceDirection?: string,
  extraPayload?: any
): Promise<{
  audioBase64: string;
  mimeType: string;
  voiceName: string;
  modelName: string;
  languageCode: string;
  byteLength: number;
  fallbackUsed: boolean;
}> {
  let voiceName = (rawVoiceName || "Achernar").replace(/^gemini-/, "").trim();
  if (
    !voiceName ||
    voiceName === "Google Demo" ||
    voiceName.toLowerCase().includes("demo") ||
    voiceName.toLowerCase().includes("achernar")
  ) {
    voiceName = "Achernar";
  }

  let directApiError: string | null = null;
  let browserSessionError: string | null = null;

  // 1. Direct high-speed Gemini TTS API (when valid GEMINI_API_KEY is present)
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "dummy-key-to-prevent-crash-if-missing") {
    if (Date.now() < directGeminiTTSCooldownUntil) {
      const remainingSec = Math.round((directGeminiTTSCooldownUntil - Date.now()) / 1000);
      console.log(`[Official Gemini TTS] Direct API in cooldown (${remainingSec}s remaining due to 429 quota), routing to Google Cloud Demo session...`);
    } else {
      try {
        console.log(`[Official Gemini TTS] Attempting direct API synthesis for voice: ${voiceName}...`);
        const directResult = await synthesizeGeminiTTSDirect(text, voiceName, voiceDirection);
        return {
          audioBase64: directResult.audioBase64,
          mimeType: directResult.mimeType,
          voiceName: rawVoiceName,
          modelName: "gemini-3.1-flash-tts-preview",
          languageCode: languageCode || "ar-EG",
          byteLength: directResult.byteLength,
          fallbackUsed: false,
        };
      } catch (directErr: any) {
        directApiError = directErr?.message || String(directErr);
        if (
          directApiError.includes("429") ||
          directApiError.includes("quota") ||
          directApiError.includes("RESOURCE_EXHAUSTED")
        ) {
          let cooldownMs = 30000;
          const retryMatch = directApiError.match(/retry(?:ing)? in (\d+(?:\.\d+)?)\s*s/i);
          if (retryMatch && retryMatch[1]) {
            cooldownMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 2000;
          }
          directGeminiTTSCooldownUntil = Date.now() + Math.max(cooldownMs, 25000);
        }
        console.warn(`[Gemini TTS Direct Notice] Direct API failed for official voice "${voiceName}":`, directApiError);
      }
    }
  } else {
    directApiError = "مفتاح GEMINI_API_KEY غير متوفر للتوليد المباشر";
  }

  // 2. Official Google Cloud Text-to-Speech Demo Session (gemini-3.1-flash-tts-preview)
  try {
    console.log(`[Official Gemini TTS] Attempting official Google Cloud TTS session for voice: ${voiceName}...`);
    const controller = GemgenController.getInstance();
    const normalizedReq = {
      ...(extraPayload || {}),
      text,
      voiceName,
      languageCode: languageCode || "ar-EG",
      voiceDirection,
    };
    const result = await controller.synthesize(normalizedReq);
    if (result && result.audioBase64) {
      return {
        ...result,
        voiceName: rawVoiceName,
        fallbackUsed: false,
      };
    }
    throw new Error("لم يتم استرجاع محتوى صوتي من جلسة Google Cloud TTS.");
  } catch (browserErr: any) {
    browserSessionError = browserErr?.message || String(browserErr);
    console.warn(`[Gemini TTS Browser Session Notice] Google Cloud Demo session failed for official voice "${voiceName}":`, browserSessionError);
  }

  // Strictly NO alternative fallback voice. Provide an accurate, clear explanation of why Gemini TTS failed.
  let detailedMessage = "";
  const isVerifError =
    browserSessionError?.includes("VERIFICATION_REQUIRED") ||
    browserSessionError?.includes("CAPTCHA_REQUIRED") ||
    browserSessionError?.includes("reCAPTCHA");

  if (isVerifError) {
    const customError: any = new Error("VERIFICATION_REQUIRED: يتطلب Google Cloud Text-to-Speech إكمال خطوة التحقق للاستمرار.");
    customError.code = "VERIFICATION_REQUIRED";
    customError.isVerification = true;
    customError.voiceName = rawVoiceName;
    customError.browserSessionError = browserSessionError;
    throw customError;
  } else if (browserSessionError?.includes("Try again later") || browserSessionError?.includes("DOS")) {
    detailedMessage = `تم تقييد تحدي التحقق مؤقتاً من قِبل Google Cloud (Try again later). اضغط على زر "إعادة تعيين الكابتشا" أو "إعادة تحميل صفحة Google (رفرش)" في الاستوديو.`;
  } else if (
    browserSessionError?.includes("503") ||
    browserSessionError?.includes("Oops") ||
    browserSessionError?.includes("couldn't generate the audio")
  ) {
    detailedMessage = `تعذر توليد الصوت بالصوت الرسمي المطلوب (${voiceName}): خادم Google Cloud TTS غير متاح مؤقتاً بسبب ضغط الخدمة (503 Service Unavailable / Oops). تم إجراء 3 محاولات استرداد وتحديث للجلسة. يرجى المحاولة بعد لحظات.`;
  } else if (
    browserSessionError?.includes("401") ||
    browserSessionError?.includes("Unauthorized") ||
    browserSessionError?.includes("UNAUTHENTICATED")
  ) {
    detailedMessage = `تعذر توليد الصوت بالصوت الرسمي المطلوب (${voiceName}): انتهت صلاحية جلسة Google Cloud TTS (401 Unauthorized). يتم تحديث الجلسة واستخراج رمز جديد تلقائياً، يرجى المحاولة مجدداً.`;
  } else if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "dummy-key-to-prevent-crash-if-missing") {
    detailedMessage = `تعذر توليد الصوت بالصوت الرسمي المطلوب (${voiceName}): جلسة Google Cloud TTS واجهت (${browserSessionError || "خطأ في الاتصال"})، ومفتاح GEMINI_API_KEY غير متوفر في البيئة لتجاوز جلسة المتصفح.`;
  } else {
    detailedMessage = `تعذر توليد الصوت بالصوت الرسمي المطلوب (${voiceName}): ${browserSessionError || directApiError}`;
  }

  const customError: any = new Error(detailedMessage);
  customError.code = "GEMINI_TTS_OFFICIAL_FAILED";
  customError.voiceName = rawVoiceName;
  customError.directApiError = directApiError;
  customError.browserSessionError = browserSessionError;
  throw customError;
}

// ==========================================
// Official Gemini TTS (Google Cloud Demo & Gemgen) Endpoints
// ==========================================
app.post("/api/gemini-tts/synthesize", async (req, res) => {
  const { text, voice, languageCode = "ar-EG", voiceDirection } = req.body || {};
  let rawVoiceName = voice?.name || req.body?.voiceName || "Google Demo";

  const effectiveText = text || (req.body?.multiSpeakerMarkup?.turns ? req.body.multiSpeakerMarkup.turns.map((t: any) => `${t.speaker}: ${t.text}`).join(". ") : "");
  if (!effectiveText || !effectiveText.trim()) {
    return res.status(400).json({ error: "Missing text for synthesis" });
  }

  try {
    const result = await synthesizeOfficialGeminiTTS(
      effectiveText,
      rawVoiceName,
      languageCode,
      voiceDirection,
      req.body
    );
    return res.json(result);
  } catch (err: any) {
    console.error("[Gemini TTS Route Error]:", err.message || err);
    if (err.isVerification || err.code === "VERIFICATION_REQUIRED" || err.message?.includes("VERIFICATION_REQUIRED") || err.message?.includes("CAPTCHA_REQUIRED")) {
      return res.status(200).json({
        status: "waiting_verification",
        waiting: true,
        needsVerification: true,
        needsCaptcha: true,
        code: "VERIFICATION_REQUIRED",
        message: "يتطلب Google Cloud Text-to-Speech إكمال خطوة التحقق للاستمرار.",
        error: {
          code: "VERIFICATION_REQUIRED",
          message: "يتطلب Google Cloud Text-to-Speech إكمال خطوة التحقق للاستمرار."
        }
      });
    }

    return res.status(500).json({
      error: {
        code: err.code || "GEMINI_TTS_OFFICIAL_FAILED",
        message: err.message || `تعذر توليد الصوت بالصوت الرسمي (${rawVoiceName}).`,
        directApiError: err.directApiError,
        browserSessionError: err.browserSessionError,
      },
      fallbackUsed: false,
      voiceName: rawVoiceName,
    });
  }
});

app.get("/api/gemini-tts/status", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    const status = await controller.getStatus();
    return res.json(status);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/gemini-tts/interactive-view", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    const screenshot = await controller.getScreenshot();
    return res.json(screenshot);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/interact", async (req, res) => {
  try {
    const { x, y } = req.body;
    const controller = GemgenController.getInstance();
    await controller.interact(Number(x) || 0, Number(y) || 0);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/scroll", async (req, res) => {
  try {
    const { action, delta } = req.body;
    const controller = GemgenController.getInstance();
    if (action === "demo") {
      await controller.scrollToDemo(Number(delta) || -40);
    } else if (action === "up") {
      await controller.scrollBy(-(Number(delta) || 250));
    } else if (action === "down") {
      await controller.scrollBy(Number(delta) || 250);
    } else {
      await controller.scrollToDemo(-40);
    }
    const screenshot = await controller.getScreenshot();
    return res.json({ success: true, screenshot });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/solve-captcha", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    const result = await controller.solveCaptchaWithRaptor();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/init", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    const result = await controller.initSession();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/open-page", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    const result = await controller.openCloudTtsPage();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/reload-page", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    const result = await controller.reloadCloudTtsPage();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/reload-and-solve", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    const result = await controller.reloadAndSolveCaptcha();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/reset-captcha", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    const result = await controller.resetCaptcha();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/gemini-tts/reset", async (req, res) => {
  try {
    const controller = GemgenController.getInstance();
    await controller.resetSession();
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// High-performance server-side TTS in-memory cache & deduplication
interface CachedTtsEntry {
  audio: string;
  mimeType: string;
  provider?: string;
  voiceName?: string;
  modelName?: string;
  fallbackUsed?: boolean;
  timestamp: number;
}
const serverTtsCache = new Map<string, CachedTtsEntry>();
const MAX_SERVER_TTS_CACHE = 600;

function makeTtsServerKey(text: string, voiceName: string, voiceGroup?: string): string {
  return `${voiceGroup || "default"}__${voiceName || "default"}__${text.trim()}`;
}

// 9. Premium Microsoft Edge TTS Endpoint (Using high-quality Multilingual Neural voices)
app.post("/api/manga/tts", async (req, res) => {
  try {
    const { text, voiceName = "en-US-EmmaMultilingualNeural", gptCookies, voiceGroup, hfToken, voiceDirection, audioConfig } = req.body;
    let activeVoiceName = voiceName;
    if (!text) {
      return res.status(400).json({ error: "Missing text to read" });
    }

    // Fast Cache Hit: return directly from memory if already synthesized recently (0ms latency)
    const ttsCacheKey = makeTtsServerKey(text, activeVoiceName, voiceGroup);
    const cachedTts = serverTtsCache.get(ttsCacheKey);
    if (cachedTts && Date.now() - cachedTts.timestamp < 86400000) {
      return res.json(cachedTts);
    }

    // Gemini TTS routing (Official Google Cloud Demo & Gemgen engine)
    const geminiOfficialVoices = [
      "Google Demo", "google-demo", "google_demo",
      "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe", "Callirrhoe",
      "Charon", "Despina", "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore",
      "Laomedeia", "Leda", "Orus", "Pulcherrima", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager",
      "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi"
    ];
    const isGeminiRequested = voiceGroup === "gemini" ||
      (!voiceGroup && activeVoiceName && (activeVoiceName.startsWith("gemini-") || activeVoiceName.toLowerCase().includes("demo") || geminiOfficialVoices.includes(activeVoiceName)));

    if (isGeminiRequested) {
      let cleanVoiceName = (activeVoiceName || "Google Demo").replace(/^gemini-/, "").trim();
      const isGoogleDemo = cleanVoiceName === "Google Demo" || cleanVoiceName.toLowerCase().includes("demo");
      const targetGeminiVoice = isGoogleDemo ? "Achernar" : cleanVoiceName;

      try {
        console.log(`[Reader Gemini TTS] Generating official audio for voice: ${targetGeminiVoice} (label: ${cleanVoiceName}), text: "${text.substring(0, 30)}..."`);
        const geminiResult = await synthesizeOfficialGeminiTTS(
          text,
          targetGeminiVoice,
          req.body.languageCode || "ar-EG",
          voiceDirection || "Natural and clear Arabic narration with expressive tone.",
          req.body
        );

        return res.json({
          audio: geminiResult.audioBase64,
          mimeType: geminiResult.mimeType || "audio/mp3",
          provider: "gemini",
          voiceName: cleanVoiceName,
          modelName: geminiResult.modelName || "gemini-3.1-flash-tts-preview",
          fallbackUsed: false,
        });
      } catch (geminiErr: any) {
        console.warn("[Reader Gemini TTS Error]:", geminiErr.message || geminiErr);
        if (geminiErr.isVerification || geminiErr.code === "VERIFICATION_REQUIRED" || geminiErr.message?.includes("VERIFICATION_REQUIRED") || geminiErr.message?.includes("CAPTCHA_REQUIRED")) {
          return res.status(200).json({
            status: "waiting_verification",
            waiting: true,
            needsVerification: true,
            needsCaptcha: true,
            code: "VERIFICATION_REQUIRED",
            message: "يتطلب Google Cloud Text-to-Speech إكمال خطوة التحقق للاستمرار.",
            error: "يتطلب Google Cloud Text-to-Speech إكمال خطوة التحقق للاستمرار."
          });
        }
        return res.status(500).json({
          error: geminiErr.message || `تعذر توليد الصوت بالصوت الرسمي المطلوب (${targetGeminiVoice}).`,
          code: geminiErr.code || "GEMINI_TTS_OFFICIAL_FAILED",
          fallbackUsed: false,
          voiceName: targetGeminiVoice,
        });
      }
    }

    if (voiceGroup === "huggingface" || (activeVoiceName && (activeVoiceName.startsWith("spark-") || activeVoiceName.startsWith("xtts-") || activeVoiceName.startsWith("silma-") || activeVoiceName.startsWith("kokoro-") || activeVoiceName.startsWith("nabra-")))) {
      try {
        const connectOpts = hfToken ? { hf_token: hfToken } : {};
        let audioUrl = "";
        
        // Clean Arabic text while strictly preserving all Arabic Unicode characters, diacritics, presentation forms, and punctuation
        const cleanedText = text
          .replace(/[\r\n\t]+/g, " ")
          .replace(/[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFFa-zA-Z0-9\s.,!?;:()'"\-_«»“”‘’…،؛؟ـ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        console.log(`Generating Nabra-82M Arabic TTS: text="${cleanedText.substring(0, 35)}..."`);
        
        // Connect to official oddadmix/Nabra-82M-Demo
        const app = await Client.connect("oddadmix/Nabra-82M-Demo", connectOpts);
        const result = await app.predict("/synthesize", [
          cleanedText, // text
          1.0,         // speed (default 1.0)
          false        // skip_tashkeel: false -> performs auto-tashkeel (diacritization)
        ]);
        
        audioUrl = (result.data as any)[0]?.url || (result.data as any)[0]?.path;

        if (!audioUrl) throw new Error("No audio URL returned from Nabra TTS");
        
        const wavResponse = await fetch(audioUrl);
        const arrayBuffer = await wavResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        return res.json({
          audio: buffer.toString("base64"),
          mimeType: "audio/wav"
        });
      } catch (err: any) {
        console.error("[Nabra / HF error]:", err.message);
        return res.status(500).json({ error: `فشل توليد صوت Nabra: ${err.message}` });
      }
    }
    
    const chatGptVoices = ["onyx", "alloy", "echo", "ash", "fable", "ballad", "nova", "shimmer", "coral", "sage", "verse", "breeze", "cove", "ember", "juniper", "sky"];
    if (chatGptVoices.includes(activeVoiceName)) {
      try {
        console.log(`Generating ChatGPT Multimodal TTS Voice: ${activeVoiceName} for text: "${text.substring(0, 30)}..."`);
        const audioBuffer = await getChatGptTtsAudio(text, activeVoiceName);
        return res.json({
          audio: audioBuffer.toString("base64"),
          mimeType: "audio/mp3"
        });
      } catch (err: any) {
        console.error("ChatGPT TTS backend error:", err);
        return res.status(500).json({ error: `فشل توليد صوت ChatGPT: ${err.message}` });
      }
    }

    const capcutVoices = [
      "ar_female_madina", "ar_female_sanaa", "ar_male_maged", "ar_male_hamza",
      "ar_female_amal", "ar_male_omar", "ar_female_sara", "ar_male_karim",
      "ar_female_nour", "ar_male_youssef"
    ];

    // If the requested voice is an official CapCut voice, attempt the real CapCut synthesis engine!
    if (capcutVoices.includes(activeVoiceName)) {
      try {
        console.log(`Generating REAL CapCut Voice: ${activeVoiceName} for text: "${text.substring(0, 30)}..."`);
        const base64Audio = await getCapCutAudio(text, activeVoiceName);
        if (base64Audio) {
          return res.json({
            audio: base64Audio,
            mimeType: "audio/mp3"
          });
        }
        throw new Error("No audio data returned from CapCut");
      } catch (err: any) {
        console.error("[CapCut TTS error]:", err.message || err);
        return res.status(500).json({ error: `فشل توليد صوت CapCut المختار (${activeVoiceName}): ${err.message || err}` });
      }
    }

    let actualVoice = voiceName && voiceName.trim() ? voiceName.trim() : "ar-SA-HamedNeural";
    console.log(`Generating Microsoft Edge Neural TTS (Requested: ${voiceName}, Using: ${actualVoice}) for text: "${text.substring(0, 30)}..."`);

    const audioBuffer = await generateEdgeTtsAudioBuffer(text, actualVoice);
    const base64Audio = audioBuffer.toString("base64");

    const resultObj = {
      audio: base64Audio,
      mimeType: "audio/mp3",
      timestamp: Date.now()
    };
    if (serverTtsCache.size >= MAX_SERVER_TTS_CACHE) {
      const oldest = serverTtsCache.keys().next().value;
      if (oldest) serverTtsCache.delete(oldest);
    }
    serverTtsCache.set(ttsCacheKey, resultObj);

    return res.json(resultObj);
  } catch (error: any) {
    console.error("TTS API Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate TTS voice" });
  }
});

// In-memory cache for all Microsoft TTS Voices
let cachedMicrosoftVoices: any[] | null = null;
let lastVoicesFetchTime = 0;

// Dynamic Microsoft Voices Endpoint (Returns all 320+ voices across all languages and dialects)
app.get("/api/manga/microsoft-voices", async (req, res) => {
  try {
    const now = Date.now();
    // Cache for 24 hours to ensure instant zero-latency responses
    if (cachedMicrosoftVoices && (now - lastVoicesFetchTime < 86400000)) {
      return res.json({ voices: cachedMicrosoftVoices, count: cachedMicrosoftVoices.length, cached: true });
    }
    const rawVoices = await listVoices();
    // Map with clean normalized fields
    cachedMicrosoftVoices = rawVoices.map((v: any) => ({
      name: v.ShortName || v.Name,
      shortName: v.ShortName,
      displayName: v.FriendlyName || v.ShortName,
      gender: v.Gender === "Female" ? "أنثى" : "ذكر",
      genderEn: v.Gender,
      locale: v.Locale,
      localeName: v.LocaleName,
      languageCode: (v.Locale || "").split("-")[0],
      suggestedCodec: v.SuggestedCodec,
      personalities: v.VoiceTag?.VoicePersonalities || [],
      categories: v.VoiceTag?.ContentCategories || []
    }));
    lastVoicesFetchTime = now;
    return res.json({ voices: cachedMicrosoftVoices, count: cachedMicrosoftVoices.length, cached: false });
  } catch (err: any) {
    console.error("[Microsoft Voices Endpoint Error]:", err);
    if (cachedMicrosoftVoices) {
      return res.json({ voices: cachedMicrosoftVoices, count: cachedMicrosoftVoices.length, cached: true, warning: err.message });
    }
    return res.status(500).json({ error: err.message || "فشل جلب أصوات Microsoft" });
  }
});


function parseCookiesStr(cookiesStr: string) {
  if (!cookiesStr || typeof cookiesStr !== "string") return {};
  let trimmed = cookiesStr.trim();

  // 1. Check if user provided base64 encoded cookies
  if (
    !trimmed.includes(";") &&
    !trimmed.includes("\t") &&
    !trimmed.startsWith("[") &&
    !trimmed.startsWith("{") &&
    trimmed.length > 25
  ) {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
      if (decoded.includes("=") || decoded.includes("PSID") || decoded.startsWith("[") || decoded.startsWith("{")) {
        trimmed = decoded.trim();
      }
    } catch (_) {}
  }

  const cookiesObj: Record<string, string> = {};

  // 2. Try JSON Array or Object (popular Chrome cookie exporters like Cookie-Editor, EditThisCookie)
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.name && item.value !== undefined) {
            cookiesObj[item.name] = String(item.value);
          }
        }
      } else if (typeof parsed === "object" && parsed !== null) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" || typeof v === "number") {
            cookiesObj[k] = String(v);
          } else if (v && typeof v === "object" && "value" in (v as any)) {
            cookiesObj[k] = String((v as any).value);
          }
        }
      }
    } catch (_) {}
  }

  // 3. Fallback: Parse line-by-line (tab-separated Netscape format or semicolon/newline separated)
  if (Object.keys(cookiesObj).length === 0) {
    const lines = trimmed.split('\n');
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 7) {
        cookiesObj[parts[5]] = parts[6];
      } else {
        // Support standard cookie list or key-value if not tab-separated
        const subLine = line.trim();
        if (subLine && !subLine.startsWith('#')) {
          const subParts = subLine.split(';');
          for (const part of subParts) {
            const eqIdx = part.indexOf('=');
            if (eqIdx !== -1) {
              const key = part.substring(0, eqIdx).trim().replace(/^["']|["']$/g, '');
              let val = part.substring(eqIdx + 1).trim();
              if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
              }
              if (key) cookiesObj[key] = val;
            }
          }
        }
      }
    }
  }

  // Filter out excessive cookies to prevent Axios/Node Header Overflow
  const filtered: Record<string, string> = {};
  const allowedKeys = [
    "__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", 
    "__Secure-3PSID", "__Secure-3PSIDTS", "__Secure-3PSIDCC",
    "SID", "HSID", "SSID", "APISID", "SAPISID", "NID", "AEC",
    "SIDCC", "OSID", "__Secure-OSID", "SNlM0e",
    "_puid", "cf_clearance", "__Secure-next-auth.session-token", 
    "__Secure-next-auth.callback-url", "oai_did", "oai_device_id"
  ];
  
  for (const [key, val] of Object.entries(cookiesObj)) {
    if (allowedKeys.includes(key)) {
      filtered[key] = val;
    }
  }
  
  return filtered;
}

function filterGeminiCookies(cookiesObj: Record<string, string>): Record<string, string> {
  const allowed = new Set([
    "__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", 
    "__Secure-3PSID", "__Secure-3PSIDTS", "__Secure-3PSIDCC",
    "SID", "HSID", "SSID", "APISID", "SAPISID", "NID", "SIDCC",
    "OSID", "__Secure-OSID", "SNlM0e"
  ]);
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(cookiesObj)) {
    const cleanKey = key.trim();
    if (allowed.has(cleanKey) && typeof val === "string" && val.trim().length > 0 && val.length < 8192) {
      out[cleanKey] = val.trim();
    }
  }
  return out;
}

function getCookieString(cookiesStr: string): string {
  const cookiesObj = parseCookiesStr(cookiesStr);
  return Object.entries(cookiesObj)
    .map(([key, val]) => `${key}=${val}`)
    .join("; ");
}

async function getChatGptAccessToken(cookieString: string): Promise<string> {
  const response = await fetch("https://chatgpt.com/api/auth/session", {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Cookie": cookieString
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ChatGPT session: ${response.status} ${response.statusText}`);
  }
  const data: any = await response.json();
  if (!data.accessToken) {
    throw new Error("Unable to retrieve ChatGPT Access Token. Please ensure your cookies are valid and not expired.");
  }
  return data.accessToken;
}

async function getChatGptTtsAudio(text: string, voiceName: string): Promise<Buffer> {
  const url = "https://www.openai.fm/api/generate";
  
  // [تخفي حقيقي 1]: اختيار بصمة متصفح عشوائية مختلفة تماماً في كل صوت لتمويه السيرفر
  const userAgentsPool = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
  ];
  const randomAgent = userAgentsPool[Math.floor(Math.random() * userAgentsPool.length)];

  // [تخفي حقيقي 2]: نظام الانتظار العشوائي الذكي (Smart Jitter)
  const sleepTime = Math.random() * (3500 - 2000) + 2000;
  await new Promise(r => setTimeout(r, sleepTime));

  const formData = new FormData();
  formData.append("input", text);
  formData.append("voice", voiceName);
  formData.append("generation", crypto.randomUUID());
  formData.append("response_format", "mp3");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": randomAgent,
      "Accept": "application/json, audio/*",
      "Origin": "https://www.openai.fm",
      "Referer": "https://www.openai.fm/"
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI.fm TTS API responded with ${response.status}: ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function splitTextIntoChunks(text: string, maxLength: number = 280): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  
  // Split text by punctuation or spaces to avoid cutting words
  const words = text.split(/(\s+)/);
  
  for (const word of words) {
    if ((currentChunk + word).length > maxLength) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = word;
    } else {
      currentChunk += word;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}



// 10. Test Gemini Cookies
app.post("/api/manga/test-cookies", async (req, res) => {
  try {
    const { cookies, model } = req.body;
    if (!cookies || typeof cookies !== "string" || !cookies.trim()) {
      return res.status(400).json({ success: false, status: "Not Configured", error: "لم يتم إرسال ملفات تعريف الارتباط." });
    }

    const normModel = normalizeGeminiModel(model);
    const modelInfo = GEMINI_COOKIE_MODELS[normModel];
    const resolvedModel = resolveGeminiModelDef(normModel);

    const rawCookiesObj = parseCookiesStr(cookies);
    const cookiesObj = filterGeminiCookies(rawCookiesObj);
    if (!cookiesObj['__Secure-1PSID']) {
      return res.status(400).json({
        success: false,
        status: "Session Invalid",
        error: "لم يتم العثور على الكوكي الأساسي __Secure-1PSID في البيانات المدخلة. تأكد من نسخ ملفات تعريف الارتباط من موقع gemini.google.com كاملاً."
      });
    }

    const gemini = new Gemini({
      secure_1psid: cookiesObj['__Secure-1PSID'],
      timeout: 45000
    });
    // @ts-ignore
    gemini.cookies = cookiesObj;
    // @ts-ignore
    gemini._guest = false;

    // Step 1: Validate Google session handshake via gemini.init()
    const initTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("انتهت مهلة الاتصال بموقع Google (تأكد من استقرار شبكة الإنترنت)")), 20000)
    );
    await Promise.race([gemini.init(), initTimeout]);

    // Step 2: Ensure Google returned a valid SNlM0e session token
    if (!gemini.accessToken) {
      console.warn("[Gemini Cookies Test] Handshake completed but accessToken (SNlM0e) is null. Invalid or expired session.");
      return res.status(401).json({
        success: false,
        status: "Session Invalid",
        error: "فشلت المصادقة مع خوادم Google: ملفات تعريف الارتباط غير صالحة أو غير مسجلة الدخول (لم يتم العثور على رمز الجلسة SNlM0e). تأكد من تسجيل الدخول إلى موقع gemini.google.com في المتصفح ونسخ ملفات تعريف الارتباط كاملة (خاصة __Secure-1PSID و __Secure-1PSIDTS)."
      });
    }

    // Step 3: Run quick generation test with selected model and extended_thinking explicitly disabled
    const chat = gemini.newChat({ model: resolvedModel });
    const testPromise = chat.generateContent({ 
      prompt: "Hello! Reply with 'OK' if you can read this.", 
      extended_thinking: false 
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("انتهت مهلة استجابة النموذج (45 ثانية)")), 45000)
    );
    
    let response: any = null;
    try {
      response = await Promise.race([testPromise, timeoutPromise]);
    } catch (genErr: any) {
      console.warn("[Gemini Cookies Test] Generation warning after successful auth:", genErr?.message);
      // Since token authentication succeeded with Google, report successful connection
      return res.json({
        success: true,
        status: "Connected",
        message: `تم التحقق من جلسة Google ومصادقة الكوكيز بنجاح! النموذج المعتمد: ${modelInfo.label} (Extended Thinking: معطّل).`
      });
    }
    
    if (response && response.text) {
      return res.json({ 
        success: true, 
        status: "Connected", 
        message: `تم الاتصال بنجاح بـ Gemini AI وتوليد النص فورياً عبر نموذج ${modelInfo.label} (بدون تفكير موسع)!` 
      });
    } else {
      return res.json({ 
        success: true, 
        status: "Connected", 
        message: `تم التحقق بنجاح من حساب Google ومصادقة الكوكيز لنموذج ${modelInfo.label}!` 
      });
    }
  } catch (error: any) {
    console.error("Test cookies error:", error?.message || error);
    const msg = String(error?.message || "");
    const status = msg.includes("__Secure-1PSID") ? "Session Invalid" : "Request Failed";
    res.status(500).json({ success: false, status, error: error.message || "فشل الاتصال بـ Gemini AI عبر ملفات تعريف الارتباط." });
  }
});

// 12. Test GPT Cookies
app.post("/api/manga/test-gpt-cookies", async (req, res) => {
  try {
    const { cookies } = req.body;
    if (!cookies) return res.status(400).json({ error: "Missing cookies" });

    const cookieString = getCookieString(cookies);
    const accessToken = await getChatGptAccessToken(cookieString);
    
    // Fetch session details again or just return success with token info
    const sessionResponse = await fetch("https://chatgpt.com/api/auth/session", {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Cookie": cookieString
      }
    });
    
    if (sessionResponse.ok) {
      const sessionData: any = await sessionResponse.json();
      const userEmail = sessionData.user?.email || "ChatGPT User";
      return res.json({ success: true, message: `تم التحقق بنجاح! حساب: ${userEmail}` });
    }

    return res.json({ success: true, message: "تم التحقق بنجاح وتوليد رمز الوصول!" });
  } catch (error: any) {
    console.error("Test GPT cookies error:", error);
    res.status(500).json({ error: error.message || "Failed to test ChatGPT cookies" });
  }
});

// Helper to extract JSON arrays from noisy LLM outputs
function extractJSONArray(text: string): string[] | null {
  try {
    let cleanText = text.trim();
    
    // Remove triple backticks code block markers
    const codeBlockMatch = cleanText.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
    if (codeBlockMatch) {
      cleanText = codeBlockMatch[1].trim();
    }
    
    try {
      const parsed = JSON.parse(cleanText);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (e) {
      // Find first [ and last ]
      const startIndex = cleanText.indexOf('[');
      const endIndex = cleanText.lastIndexOf(']');
      if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const potentialJson = cleanText.substring(startIndex, endIndex + 1);
        try {
          const parsed = JSON.parse(potentialJson);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch (innerError) {
          // Repair trailing commas
          const repaired = potentialJson
            .replace(/,\s*\]/g, ']')
            .replace(/,\s*\}/g, '}');
          try {
            const parsed = JSON.parse(repaired);
            if (Array.isArray(parsed)) return parsed.map(String);
          } catch (e3) {
            console.log("[JSON Extraction] Repaired JSON parsing failed (falling back to regex)");
          }
        }
      }
    }
    
    // Line-by-line fallback regex extraction
    const lines = cleanText.split('\n');
    const listItems: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '[' || trimmed === ']') continue;
      const stringMatch = trimmed.match(/^(?:\d+\.\s*|-\s*)?"([\s\S]*?)"\s*,?$/) || trimmed.match(/^(?:\d+\.\s*|-\s*)?'([\s\S]*?)'\s*,?$/);
      if (stringMatch) {
        listItems.push(stringMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
      } else if (trimmed.startsWith('"') && (trimmed.endsWith('",') || trimmed.endsWith('"'))) {
        let content = trimmed;
        if (content.endsWith('",')) content = content.slice(1, -2);
        else content = content.slice(1, -1);
        listItems.push(content.replace(/\\"/g, '"').replace(/\\n/g, '\n'));
      }
    }
    if (listItems.length > 0) {
      return listItems;
    }
  } catch (err) {
    console.error("[JSON Extraction] Fatal extractor error:", err);
  }
  return null;
}

// Helper to preserve Arabic translation output 1:1 verbatim
function cleanArabicText(str: string): string {
  if (!str || typeof str !== 'string') return "";
  // Strictly preserve 100% of the Arabic translation verbatim.
  // Never strip quotes, prepositions, alefs, hamzas, or punctuation.
  return str.replace(/[\u0000\uFFFD]/g, '').trim();
}

// Repair unescaped inner quotes inside JSON string values before parsing
function repairJsonQuotes(str: string): string {
  return str.replace(/"(arabic_text|translated_text|translation|text)"\s*:\s*"([\s\S]*?)"(?=\s*[,}\]])/g, (_match, key, val) => {
    // If val has unescaped quotes inside, escape them so JSON.parse succeeds and preserves them
    const repairedVal = val.replace(/(?<!\\)"/g, '\\"');
    return `"${key}": "${repairedVal}"`;
  });
}

// Robust fallback parser that extracts each id and text property even if JSON syntax is imperfect
function extractTranslationsRobust(text: string, length: number): string[] | null {
  const result = new Array(length).fill(null);
  let hasValid = false;
  const idMatches = [...text.matchAll(/"id"\s*:\s*(\d+)/g)];
  for (let k = 0; k < idMatches.length; k++) {
    const id = parseInt(idMatches[k][1], 10);
    const startPos = idMatches[k].index ?? 0;
    const endPos = (k + 1 < idMatches.length) ? (idMatches[k + 1].index ?? text.length) : text.length;
    const chunk = text.substring(startPos, endPos);
    const textPropMatch = chunk.match(/"(?:arabic_text|translated_text|translation|text)"\s*:\s*"/);
    if (textPropMatch && textPropMatch.index !== undefined) {
      const valStart = textPropMatch.index + textPropMatch[0].length;
      const lastQuote = chunk.lastIndexOf('"');
      if (lastQuote > valStart) {
        let val = chunk.substring(valStart, lastQuote);
        val = val.replace(/\\"/g, '"').replace(/\\n/g, '\n');
        if (!isNaN(id) && id >= 1 && id <= length) {
          result[id - 1] = cleanArabicText(val);
          hasValid = true;
        }
      }
    }
  }
  return hasValid ? result : null;
}

// Helper to extract JSON from the Arabic translation prompt with 1:1 fidelity
function extractMangaTranslations(text: string, length: number): string[] | null {
  try {
    let cleanText = text.trim();
    // 1. Try to find markdown block
    const codeBlockMatch = cleanText.match(/\x60\x60\x60(?:json|JSON)?\s*([\s\S]*?)\s*\x60\x60\x60/);
    if (codeBlockMatch) {
      cleanText = codeBlockMatch[1].trim();
    }

    const processParsed = (parsed: any) => {
      let list: any[] | null = null;
      if (parsed && Array.isArray(parsed.page_translations)) {
        list = parsed.page_translations;
      } else if (parsed && Array.isArray(parsed.translations)) {
        list = parsed.translations;
      } else if (Array.isArray(parsed)) {
        list = parsed;
      }
      if (list) {
        const result = new Array(length).fill(null);
        let hasValidItems = false;
        for (const item of list) {
          const trans = item.arabic_text ?? item.translated_text ?? item.translation ?? item.text;
          if (item.id >= 1 && item.id <= length && typeof trans === 'string') {
            result[item.id - 1] = cleanArabicText(trans);
            hasValidItems = true;
          }
        }
        if (hasValidItems) return result;
      }
      return null;
    };

    // 2. Try parsing the clean text directly
    try {
      const parsed = JSON.parse(cleanText);
      const res = processParsed(parsed);
      if (res) return res;
    } catch (e) {}

    // 2b. Try parsing after repairing unescaped quotes inside values
    try {
      const repaired = repairJsonQuotes(cleanText);
      const parsed = JSON.parse(repaired);
      const res = processParsed(parsed);
      if (res) return res;
    } catch (e) {}

    // 3. Fallback: extract just the array
    const arrayMatch = cleanText.match(/"(?:page_)?translations"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
    if (arrayMatch) {
       try {
         let arrStr = arrayMatch[1].replace(/,\s*\}/g, '}').replace(/,\s*\]/g, ']');
         const parsedArr = JSON.parse(arrStr);
         const res = processParsed({ page_translations: parsedArr });
         if (res) return res;
       } catch (e) {
         try {
           const repairedArr = repairJsonQuotes(arrayMatch[1]);
           const parsedArr = JSON.parse(repairedArr);
           const res = processParsed({ page_translations: parsedArr });
           if (res) return res;
         } catch (e2) {}
       }
    }

    // 4. Fallback for object extraction
    let depth = 0;
    let start = cleanText.indexOf('{');
    if (start !== -1) {
      for (let i = start; i < cleanText.length; i++) {
        if (cleanText[i] === '{') depth++;
        else if (cleanText[i] === '}') {
          depth--;
          if (depth === 0) {
            try {
               let jsonStr = cleanText.substring(start, i + 1);
               jsonStr = jsonStr.replace(/,\s*\}/g, '}').replace(/,\s*\]/g, ']');
               const parsed = JSON.parse(jsonStr);
               const res = processParsed(parsed);
               if (res) return res;
            } catch (e) {
               try {
                 const repairedJson = repairJsonQuotes(cleanText.substring(start, i + 1));
                 const parsed = JSON.parse(repairedJson);
                 const res = processParsed(parsed);
                 if (res) return res;
               } catch (e2) {}
            }
            break;
          }
        }
      }
    }

    // 5. Direct resilient extraction for all items
    const robustRes = extractTranslationsRobust(cleanText, length);
    if (robustRes) return robustRes;

  } catch (err: any) {
    console.error("[Translation Extraction] Error:", err.message);
  }
  return null;
}

function isUntranslatedText(text: string, sourceText: string, targetLanguage?: string): boolean {
  if (!text || !text.trim()) return true;
  const cleanT = text.trim();
  const cleanS = (sourceText || "").trim();
  if (cleanT.toLowerCase() === cleanS.toLowerCase()) {
    if (/^[\s\d?!.,:;…—~*•\-_/\\()\[\]{}'"]+$/.test(cleanT)) return false;
    return true;
  }
  const isTargetArabic = !targetLanguage || targetLanguage.toLowerCase().includes("ar") || targetLanguage.includes("عرب");
  if (isTargetArabic) {
    const hasArabicChars = /[\u0600-\u06FF]/.test(cleanT);
    const sourceHasForeignChars = /[a-zA-Z\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF]/.test(cleanS);
    if (sourceHasForeignChars && !hasArabicChars) return true;
  }
  return false;
}

function tryParseJsonLenient(str: string): any {
  if (!str) return null;
  let clean = str.trim();
  clean = clean.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Direct parse
  try {
    return JSON.parse(clean);
  } catch (_) {}

  // 2. Extract outermost [ ... ] or { ... }
  const firstBracket = clean.indexOf('[');
  const firstBrace = clean.indexOf('{');
  let startIdx = -1;
  let endChar = '';

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    startIdx = firstBracket;
    endChar = ']';
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
    endChar = '}';
  }

  if (startIdx !== -1) {
    const lastIdx = clean.lastIndexOf(endChar);
    let sub = lastIdx > startIdx ? clean.substring(startIdx, lastIdx + 1) : clean.substring(startIdx);
    try {
      return JSON.parse(sub);
    } catch (_) {
      try {
        const repaired = repairJsonQuotes(sub);
        return JSON.parse(repaired);
      } catch (_2) {
        // Try closing open quotes and brackets
        let attempt = sub.trim();
        if (!attempt.endsWith(endChar)) {
          if (attempt.endsWith('"')) attempt += endChar;
          else attempt += '"' + endChar;
        }
        try {
          return JSON.parse(attempt);
        } catch (_3) {}
      }
    }
  }

  // 3. Unescaped control characters repair
  try {
    const sanitized = clean.replace(/[\u0000-\u001F]+/g, ' ');
    return JSON.parse(sanitized);
  } catch (_) {}

  return null;
}

function extractMangaTranslationsByRegionId(
  responseText: string,
  items: Array<{ region_id: string; source_text: string; reading_order: number }>
): {
  translationMap: Record<string, string>;
  translations: string[];
  page_translations: Array<{ region_id: string; reading_order: number; source_text: string; translated_text: string }>;
} {
  const translationMap: Record<string, string> = {};

  const cleanArabicTextLocal = (str: string): string => {
    if (!str || typeof str !== "string") return "";
    return str.replace(/[\u0000\uFFFD]/g, "").trim();
  };

  const registerTranslation = (rawId: any, transRaw: any, sourceTextMatch?: string) => {
    if (typeof transRaw !== "string") return;
    const trans = cleanArabicTextLocal(transRaw);
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
          const byReading = items.find(it => it.reading_order === num);
          if (byReading) translationMap[byReading.region_id] = trans;
          if (num >= 1 && num <= items.length) {
            translationMap[items[num - 1].region_id] = trans;
          }
        }
      }
    }

    if (sourceTextMatch) {
      const matchedItem = items.find(it => it.source_text && it.source_text.trim() === sourceTextMatch.trim());
      if (matchedItem) {
        translationMap[matchedItem.region_id] = trans;
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

    // Fallback: look through all object values for a string containing Arabic or distinct text
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

  const processItemList = (list: any[]) => {
    if (!Array.isArray(list)) return;
    for (let idx = 0; idx < list.length; idx++) {
      const item = list[idx];
      if (!item) continue;
      const transRaw = extractItemTrans(item);
      const rawId = extractItemId(item);
      const srcText = typeof item === "object" ? (item.source_text ?? item.original_text ?? item.source) : undefined;
      registerTranslation(rawId, transRaw, srcText);

      // Positional match if ID is completely missing and item is within bounds
      if (rawId === null && idx < items.length && typeof transRaw === "string") {
        registerTranslation(items[idx].region_id, transRaw);
      }
    }

    // Positional fallback for missing items if list count matches items count
    for (let idx = 0; idx < Math.min(list.length, items.length); idx++) {
      const it = items[idx];
      if (!translationMap[it.region_id]) {
        const transRaw = extractItemTrans(list[idx]);
        if (typeof transRaw === "string") {
          registerTranslation(it.region_id, transRaw);
        }
      }
    }
  };

  const processObjectDict = (obj: Record<string, any>) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string") {
        registerTranslation(key, val);
      } else if (val && typeof val === "object") {
        const trans = extractItemTrans(val);
        const nestedId = extractItemId(val) || key;
        registerTranslation(nestedId, trans);
      }
    }
  };

  // 1. Strip <thought> tags if model outputted reasoning
  const cleanedResponse = responseText.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();

  // Smart boundary extraction: prioritize codeblock or detect outermost JSON structure
  const codeBlockMatch = cleanedResponse.match(/```(?:json|JSON)?\s*([\s\S]*?)(?:```|$)/);
  const candidateJson = codeBlockMatch ? codeBlockMatch[1].trim() : cleanedResponse;

  const parsed = tryParseJsonLenient(candidateJson) || tryParseJsonLenient(cleanedResponse);

  // Ingest parsed JSON
  if (parsed) {
    if (Array.isArray(parsed)) {
      processItemList(parsed);
    } else if (typeof parsed === "object") {
      const listCandidate = parsed.page_translations || parsed.translations || parsed.data || parsed.results || parsed.items;
      if (Array.isArray(listCandidate)) {
        processItemList(listCandidate);
      } else if (listCandidate && typeof listCandidate === "object") {
        processObjectDict(listCandidate);
      } else {
        processObjectDict(parsed);
      }
    }
  }

  // 2. Order-agnostic Regex extraction fallback for any object blocks
  const objectBlocks = [...cleanedResponse.matchAll(/\{([^{}]+)\}/g)];
  for (let idx = 0; idx < objectBlocks.length; idx++) {
    const chunk = objectBlocks[idx][1];
    const idMatch = chunk.match(/"(?:region_id|regionId|region|id|bubble_id|المعرف)"\s*:\s*("([^"]+)"|(\d+))/);
    const textMatch = chunk.match(/"(?:arabic_text|translated_text|translatedText|translation|arabic|ar|target_text|targetText|text|content|الترجمة)"\s*:\s*"([\s\S]*?)"(?=\s*(?:[,}\]]|$))/);
    if (idMatch && textMatch) {
      const rawId = (idMatch[2] || idMatch[3] || "").trim();
      const rawText = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      registerTranslation(rawId, rawText);
    } else if (textMatch && !idMatch && idx < items.length) {
      // Positional fallback for regex blocks without explicit ID
      const rawText = textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      registerTranslation(items[idx].region_id, rawText);
    }
  }

  // 3. XML-like tags (<region id="region_001"> ... </region>)
  const tagMatches = [...cleanedResponse.matchAll(/<(?:region|block|bubble)[^>]*?(?:id|region_id)=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/(?:region|block|bubble)>/gi)];
  for (const tm of tagMatches) {
    if (tm[1] && tm[2]) {
      registerTranslation(tm[1].trim(), tm[2].trim());
    }
  }

  // 4. Markdown bold or bulleted with ID (**region_001**: text, or - region_001: text)
  const idLineMatches = [...cleanedResponse.matchAll(/(?:^|\n)\s*(?:[-*•]|\d+[\.\-\:])?\s*\*?\*?`?([a-zA-Z0-9_\-]+)`?\*?\*?\s*[:=]\s*["']?([^\n"'}]+)/g)];
  for (const lm of idLineMatches) {
    if (lm[1] && lm[2]) {
      registerTranslation(lm[1].trim(), lm[2].trim());
    }
  }

  // 5. Numbered list: 1. نص / 1- نص / 1: نص
  const numberedLines = [...cleanedResponse.matchAll(/(?:^|\n)\s*(\d+)[\.\-\:\)]\s*([^\n]+)/g)];
  for (const nl of numberedLines) {
    const num = parseInt(nl[1], 10);
    const text = nl[2].trim();
    if (!isNaN(num) && text) {
      registerTranslation(String(num), text);
    }
  }

  // 6. Plain Arabic lines fallback if still empty
  if (Object.keys(translationMap).length === 0) {
    const lines = cleanedResponse
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('```') && !l.startsWith('{') && !l.startsWith('}'));
    
    // Filter lines that contain Arabic characters
    const arabicLines = lines.filter(l => /[\u0600-\u06FF]/.test(l));
    const candidateLines = arabicLines.length > 0 ? arabicLines : lines;
    for (let i = 0; i < Math.min(candidateLines.length, items.length); i++) {
      const cleanLine = candidateLines[i].replace(/^\d+[\.\-\:\)]\s*/, '').trim();
      if (cleanLine) {
        registerTranslation(items[i].region_id, cleanLine);
      }
    }
  }

  // Safe diagnostic log (NO credentials or secrets)
  const matchedCount = Object.keys(translationMap).length;
  console.log(`[Translation Parser] Parsed response: registered ${matchedCount} translation keys for ${items.length} regions`);

  // Build final array strictly mapped by region_id
  const translations: string[] = items.map(it => {
    return translationMap[it.region_id] || translationMap[String(it.reading_order)] || translationMap[`region_${it.reading_order}`] || "";
  });

  const page_translations = items.map(it => ({
    region_id: it.region_id,
    reading_order: it.reading_order,
    source_text: it.source_text,
    translated_text: translationMap[it.region_id] || translationMap[String(it.reading_order)] || ""
  }));

  return {
    translationMap,
    translations,
    page_translations
  };
}

// Session memory for translations
const geminiCookieClients = new Map<string, Promise<any>>();
const geminiApiChats = new Map<string, any>();

// Mutex to strictly serialize calls to Gemini Cookies and eliminate Error 1095 ("Too many requests at the same time")
let geminiCookieQueue: Promise<any> = Promise.resolve();
function runWithGeminiCookieLock<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    return await task();
  };
  const resultPromise = geminiCookieQueue.then(run, run);
  geminiCookieQueue = resultPromise.then(
    async () => { await new Promise(r => setTimeout(r, 600)); },
    async () => { await new Promise(r => setTimeout(r, 600)); }
  );
  return resultPromise;
}

async function createResilientGeminiChat(cookiesObj: Record<string, string>, modelChoice?: string) {
  const secure1psid = cookiesObj['__Secure-1PSID'];
  if (!secure1psid) throw new Error("Missing __Secure-1PSID");

  if (!geminiCookieClients.has(secure1psid)) {
    const initPromise = (async () => {
      const gemini = new Gemini({
        secure_1psid: secure1psid,
        timeout: 90000
      });
      // @ts-ignore
      gemini.cookies = cookiesObj;
      // @ts-ignore
      gemini._guest = false;

      const initTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("انتهت مهلة تهيئة جلسة Gemini مع خوادم Google (30 ثانية)")), 30000)
      );
      await Promise.race([gemini.init(), initTimeout]);

      if (!gemini.accessToken) {
        throw new Error("فشلت المصادقة مع Google: رمز الجلسة SNlM0e مفقود. يرجى تجديد ملفات تعريف الارتباط (Cookies) في صفحة الإعدادات.");
      }
      return gemini;
    })();

    geminiCookieClients.set(secure1psid, initPromise);
    initPromise.catch(() => geminiCookieClients.delete(secure1psid)); // Allow retry if init fails
  }

  const gemini = await geminiCookieClients.get(secure1psid);
  const resolvedModel = resolveGeminiModelDef(modelChoice);
  return gemini.newChat({ model: resolvedModel });
}

// 10.5 Translate via Google Translate Free API (Direct Batch or Fallback)
app.post("/api/manga/translate-google", async (req, res) => {
  try {
    const { texts, targetLanguage = "ar", blockIds, items, page_translations } = req.body;
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ success: false, error: "Missing texts array" });
    }
    const cleanTexts = texts.map((t: any) => String(t || "").trim());
    const translations = await translateBatchWithGoogleFree(cleanTexts, targetLanguage);
    const translationMap: Record<string, string> = {};
    const rawList = items || page_translations;

    for (let i = 0; i < cleanTexts.length; i++) {
      const trans = translations[i] || cleanTexts[i] || "";
      const bId = Array.isArray(blockIds) && blockIds[i] ? String(blockIds[i]).trim() : `region_${i + 1}`;
      translationMap[bId] = trans;
      translationMap[String(i + 1)] = trans;
      if (Array.isArray(rawList) && rawList[i]) {
        const it = rawList[i];
        if (it.global_id) translationMap[it.global_id] = trans;
        if (it.region_id) translationMap[it.region_id] = trans;
        if (it.reading_order) translationMap[String(it.reading_order)] = trans;
      }
    }

    const builtPageTranslations = Array.isArray(rawList)
      ? rawList.map((it: any, i: number) => ({
          region_id: it.region_id || (blockIds && blockIds[i]) || `region_${i + 1}`,
          reading_order: it.reading_order || (i + 1),
          source_text: it.source_text || cleanTexts[i] || "",
          translated_text: translations[i] || cleanTexts[i] || ""
        }))
      : [];

    return res.json({
      success: true,
      translations,
      translationMap,
      page_translations: builtPageTranslations,
      actualProvider: "google"
    });
  } catch (err: any) {
    console.error("Google translation endpoint error:", err);
    return res.status(500).json({ success: false, error: err.message || "Google translation failed" });
  }
});

// 11. Translate via Gemini Cookies
app.post("/api/manga/translate-gemini", async (req, res) => {
  try {
    const { cookies, texts, blockIds, targetLanguage, mangaContext, workType, workName, sessionId, chapterId, resetConversation, structuredBlocks, page_translations, items } = req.body;
    if ((!texts || !Array.isArray(texts) || texts.length === 0) && (!page_translations || !Array.isArray(page_translations))) {
      return res.status(400).json({
        success: false,
        error: "Gemini Cookies translation failed: Missing texts or page_translations array",
        provider: "gemini_cookies",
        actualProvider: null
      });
    }

    const modelReq = req.body.model;
    const selectedModel = normalizeGeminiModel(modelReq);
    const modelInfo = GEMINI_COOKIE_MODELS[selectedModel];
    const selectedWorkType = (workType && workType.trim()) ? workType.trim() : "مانهوا كورية";
    const selectedWorkName = (workName && workName.trim()) ? workName.trim() : (mangaContext ? mangaContext : "غير محدد");

    // Chapter-isolated session key: Each chapter & model strictly gets its own conversation session
    const chapterSessionKey = `${sessionId || (chapterId ? `chapter_${chapterId}` : 'global')}_${selectedWorkType}_${selectedModel}`;

    if (resetConversation) {
      geminiApiChats.delete(chapterSessionKey);
      console.log(`[Gemini Session] Reset conversation session for ${chapterSessionKey}`);
    }

    const reqProvider = String(req.body.selectedProvider || req.body.provider || "gemini_cookies").toLowerCase().trim();
    const normalizedProvider = (reqProvider === "gemini" || reqProvider === "gemini_cookies") ? "gemini_cookies" : reqProvider;

    const countForLog = Array.isArray(page_translations) ? page_translations.length : (Array.isArray(texts) ? texts.length : 0);
    console.log(`[Translation Router] Translation Started: Provider=GEMINI_COOKIES, Chapter=${chapterId || "unknown"}, Blocks=${countForLog}`);

    // Deterministic translation input: extract and preserve region identity & reading order
    let translationItems: Array<{
      region_id: string;
      source_text: string;
      reading_order: number;
      panel_id?: string | null;
      bubble_id?: string | null;
      text_type?: string;
    }> = [];

    const rawList = page_translations || structuredBlocks || items;
    if (Array.isArray(rawList) && rawList.length > 0) {
      translationItems = rawList.map((b: any, i: number) => ({
        region_id: String(b.region_id || b.id || (Array.isArray(blockIds) && blockIds[i] ? blockIds[i] : `region_${i + 1}`)).trim(),
        source_text: String(b.source_text ?? b.text ?? b.original_text ?? b.originalText ?? (texts && texts[i]) ?? "").trim(),
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

    // Check for valid cookies session (__Secure-1PSID)
    const rawCookiesObj = cookies && typeof cookies === "string" ? parseCookiesStr(cookies) : {};
    const cookiesObj = filterGeminiCookies(rawCookiesObj);
    const hasValidCookies = Boolean(cookiesObj['__Secure-1PSID']);

    // If cookies are missing or invalid, seamlessly use official Gemini API / Google Translate fallback (1:1 Old Project behavior)
    if (!hasValidCookies) {
      console.log(`[Gemini Translation] Cookies not configured or missing __Secure-1PSID. Running Gemini API / Google fallback...`);
      let apiDone = false;
      let finalTrans: string[] = [];
      let finalMap: Record<string, string> = {};

      try {
        const aiClient = getGeminiClient();
        const textsForFallback = translationItems.map(it => it.source_text);
        const promptTexts = textsForFallback.map((t, idx) => `${idx + 1}. "${t}"`).join('\n');
        const fallbackPrompt = `أنت خبير ومترجم أدبي متخصص في توطين وتعريب القصص المصورة (المانجا والمانهوا).
أعد صياغة وتعريب النصوص بدقة وسياق درامي ممتاز.
أرجع فقط JSON array of objects بالهيكل التالي:
{"page_translations": [{"id": 1, "arabic_text": "الترجمة هنا"}]}
النصوص:
${promptTexts}`;

        const apiRes = await aiClient.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ text: fallbackPrompt }],
          config: { responseMimeType: "application/json" }
        });
        if (apiRes && apiRes.text) {
          const extracted = extractMangaTranslationsByRegionId(apiRes.text, translationItems);
          if (extracted.translations.some(t => t && t.trim())) {
            finalTrans = extracted.translations;
            finalMap = extracted.translationMap;
            apiDone = true;
          }
        }
      } catch (gemErr: any) {
        console.warn(`[Gemini API Fallback Notice]:`, gemErr.message || gemErr);
      }

      // If Gemini API was unavailable or missing translations, use Google Translate fallback for remaining texts
      const missingIdxs: number[] = [];
      for (let i = 0; i < translationItems.length; i++) {
        if (!finalTrans[i] || !finalTrans[i].trim()) {
          missingIdxs.push(i);
        }
      }

      if (missingIdxs.length > 0) {
        const missingTexts = missingIdxs.map(i => translationItems[i].source_text);
        const googleBatch = await translateBatchWithGoogleFree(missingTexts, targetLanguage || "ar");
        missingIdxs.forEach((origIdx, batchIdx) => {
          const tr = googleBatch[batchIdx] || translationItems[origIdx].source_text;
          finalTrans[origIdx] = tr;
          finalMap[translationItems[origIdx].region_id] = tr;
          finalMap[String(translationItems[origIdx].reading_order)] = tr;
        });
      }

      const finalPageTranslations = translationItems.map((it, i) => ({
        region_id: it.region_id,
        reading_order: it.reading_order,
        source_text: it.source_text,
        translated_text: finalTrans[i] || it.source_text
      }));

      return res.json({
        success: true,
        translations: finalTrans,
        translationMap: finalMap,
        page_translations: finalPageTranslations,
        sessionId: chapterSessionKey,
        model: selectedModel,
        modelLabel: modelInfo?.label || selectedModel,
        provider: "gemini_cookies",
        selectedProvider: normalizedProvider,
        actualProvider: apiDone ? "gemini_api" : "google"
      });
    }

    // Strictly preserve existing Region Intelligence reading order
    translationItems.sort((a, b) => a.reading_order - b.reading_order);

    const formattedItems = translationItems.map(it => ({
      region_id: it.region_id,
      reading_order: it.reading_order,
      text_type: it.text_type || "dialogue",
      source_text: it.source_text
    }));
    const formattedTexts = JSON.stringify(formattedItems, null, 2);

    let chat: any = null;
    try {
      chat = geminiApiChats.get(chapterSessionKey);
      if (!chat) {
        console.log(`[Gemini Session] Creating new persistent conversation session for ${chapterSessionKey} with model ${selectedModel} (${modelInfo.label}) [Extended Thinking: OFF]`);
        chat = await createResilientGeminiChat(cookiesObj, selectedModel);
        geminiApiChats.set(chapterSessionKey, chat);
      } else {
        console.log(`[Gemini Session] Reusing existing conversation session for ${chapterSessionKey}`);
      }
    } catch (initErr: any) {
      console.error(`[Gemini Cookie Translate] Failed to initialize chat session for ${chapterSessionKey}:`, initErr?.message || initErr);
      return res.status(401).json({
        success: false,
        status: "Session Invalid",
        error: `Gemini Cookies translation failed: ${initErr?.message || "فشلت تهيئة جلسة Gemini مع Google"}. يرجى تحديث الكوكيز من الإعدادات.`,
        provider: "gemini_cookies",
        selectedProvider: normalizedProvider,
        actualProvider: "gemini_cookies"
      });
    }

    // Use full context prompt while maintaining chapter conversation history
    const sampleItems = translationItems.slice(0, Math.min(3, translationItems.length)).map(it => 
      `    { "region_id": "${it.region_id}", "arabic_text": "الترجمة هنا" }`
    ).join(",\n");

    const useExtendedThinking = Boolean(
      (modelInfo as any)?.extendedThinking || 
      selectedModel === '3.5-flash-lite-extended' || 
      req.body.extendedThinking === true || 
      req.body.extended_thinking === true
    );

    const pageNumInfo = req.body.page_number ? ` (الصفحة رقم ${req.body.page_number})` : "";
    const prompt = `ترجم النص إلى العربية بأسلوب بسيط وطبيعي وسهل الفهم، مع الحفاظ على المعنى الأصلي والمشاعر والسياق، دون ترجمة حرفية أو كلمات معقدة. اجعل الصياغة مناسبة للمانجا والحوارات اليومية، واستخدم عربية فصحى حديثة وسلسة. عرّب كل شيء في النص، بما في ذلك الحوارات، النصوص خارج الفقاعات، المؤثرات الصوتية، العناوين وأي كلمات ظاهرة، ولا تترك أي نص باللغة الأصلية.

أنت مترجم وخبير تعريب مانجا وقصص مصورة محترف (${selectedWorkName} - ${selectedWorkType})${pageNumInfo}.
النموذج النشط: ${modelInfo.label} (وضع التفكير الموسع ${useExtendedThinking ? 'مفعّل' : 'معطّل للسرعة القصوى'}).

المطلوب تعريب نصوص وحوارات الفصل كاملة دفعة واحدة بطلب واحد، مع مراعاة المبادئ الأساسية والقواعد الصارمة التالية:

المبدأ الأساسي:
«بسّط الصياغة، ولا تبسّط المعنى. حافظ على كل المعلومات الموجودة في النص الأصلي، واجعل العربية واضحة وسهلة وطبيعية فقط.»

1. تعريب نصوص الفصل بالكامل دفعة واحدة: جميع نصوص الفصل البالغ عددها (${translationItems.length} نصاً) لجميع الصفحات يجب تعريبها معاً بتسلسل وترابط كامل، مع استيعاب كامل المشهد وترتيب الأحداث وتسلسل الحوار أولاً قبل ترجمة أي نص، وتجنب الترجمة المنفصلة أو المجتزأة التي تؤدي إلى معنى خاطئ.
2. التعامل مع كل فقاعة كلام كوحدة كاملة: كل فقاعة كلام هي نص متكامل، يُترجم كمعنى واحد مترابط ومكتمل مع الحفاظ على تسلسل الأفكار.
3. التعامل المستقل والدقيق مع النصوص خارج الفقاعات: النصوص خارج الفقاعات (السرد، مربعات النص، التعليقات، المؤثرات الصوتية SFX، نصوص الخلفية) يجب تعريبها بدقة وفق وظيفتها وموقعها في المشهد دون دمجها عشوائياً مع نصوص أخرى.
4. تبسيط الكلمات بدون حذف المعنى (قاعدة صارمة):
   - إذا كانت الكلمة صعبة أو نادرة ← استبدلها بكلمة عربية فصيحة أسهل وأوضح وأكثر تداولاً.
   - إذا كانت الجملة معقدة التركيب ← اجعل صياغتها وترتيب ألفاظها سلساً ومباشراً وواضحاً.
   - تحذير صارم: ممنوع منعاً باتاً حذف أي معلومة، ممنوع اختصار الكلام أو بتر الجمل، ممنوع تغيير المعنى، وممنوع إضافة معلومات غير موجودة في الأصل.
5. الحفاظ التام على الأسماء والمصطلحات الخاصة (قاعدة صارمة):
   - الحفاظ على أسماء الشخصيات، وأسماء الأماكن، والمهارات، والوحوش، والتقنيات، والمصطلحات الخاصة بالعمل كما هي وبنفس النطق الصوتي الصحيح، دون ترجمتها حرفياً، ودون تحريفها، وممنوع اختراع أسماء جديدة إطلاقاً.
6. الحفاظ الصارم على ترتيب النصوص (reading_order) وربط كل ترجمة بمعرّف منطقتها الأصلي (region_id / speech_unit_id) دون أي خلط أو تبديل في المواقع.
7. لا تجمع فقاعات منفصلة أو شخصيات مختلفة في وحدة واحدة، وحافظ على حدود كل شخصية وسياقها.
8. قاعدة صارمة بشأن نصوص OCR غير الواضحة: لا تخترع معنى من OCR غير واضح، وإذا كان النص رموزاً أو غير قابل للقراءة، لا تحوّله إلى كلمات عربية عشوائية مثل "صوت" أو "حركة" إطلاقاً؛ اتركه كما هو دون اختلاق.
9. الترجمة تكون عربية واضحة وطبيعية وحديثة وسلسة، مع الحفاظ الكامل على المعنى والمشاعر الأصلية.
10. تعريب المؤثرات الصوتية الحقيقية (SFX) والضحكات بطريقة ملائمة لفن القصص المصورة فقط عند وضوحها.
11. تحذير نهائي وقاطع: ممنوع منعاً باتاً الاكتفاء بجزء من النصوص أو إسقاط أي نص أو صفحة! يجب أن تحتوي المخرجات على جميع الـ (${translationItems.length}) نصاً كاملة بدون استثناء لجميع الصفحات.
12. المخرجات حصرياً بصيغة JSON صالحة مطابقة للهيكل التالي وتضم جميع الـ (${translationItems.length}) عنصر:
{
  "page_translations": [
${sampleItems}${translationItems.length > 3 ? `,\n    ... (أكمل باقي جميع النصوص حتى تكتمل جميع الـ ${translationItems.length} نصاً)` : ""}
  ]
}

قائمة جميع نصوص الفصل المطلوب تعريبها مرتبة بالتسلسل (${translationItems.length} نصاً):
${formattedTexts}`;

    let response: any = null;
    let chatError: any = null;

    try {
      response = await runWithGeminiCookieLock(async () => {
        let activeChat = chat;
        try {
          const attemptTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("انتهت مهلة استجابة Gemini Cookies (90 ثانية)")), 90000);
          });
          return await Promise.race([
            activeChat.generateContent({ prompt, extended_thinking: useExtendedThinking }),
            attemptTimeout
          ]);
        } catch (firstErr: any) {
          let errMsg = firstErr?.message || String(firstErr);
          console.warn(`[Gemini Cookie Translate] First turn attempt failed for ${chapterSessionKey} (${errMsg}), launching clean retry in 3.5s...`);
          
          // Wait to mitigate rate limits (like 1095)
          await new Promise(r => setTimeout(r, 3500));

          // If session, rate limit (1095/1013), or timeout occurred, clear cached client to re-authenticate cleanly
          const secId = cookiesObj['__Secure-1PSID'];
          if (secId && (errMsg.includes("1095") || errMsg.includes("1013") || errMsg.includes("Session") || errMsg.includes("مهلة") || errMsg.includes("timeout"))) {
            geminiCookieClients.delete(secId);
            geminiApiChats.delete(chapterSessionKey);
          }
          
          // Re-create pristine chat session with clean metadata and designated model
          activeChat = await createResilientGeminiChat(cookiesObj, selectedModel);
          geminiApiChats.set(chapterSessionKey, activeChat);
          const retryTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("انتهت مهلة استجابة Gemini Cookies (90 ثانية)")), 90000);
          });
          return await Promise.race([
            activeChat.generateContent({ prompt, extended_thinking: useExtendedThinking }),
            retryTimeout
          ]);
        }
      });
    } catch (chatErr: any) {
      let errMsg = String(chatErr?.message || chatErr || "");
      // Handle known APIError string format if necessary
      if (errMsg.includes("Unknown API error: 1095") || errMsg.includes("1095")) {
          errMsg = "حدث ضغط مؤقت في خادم Gemini (1095). جاري إعادة إرسال الطلب بتسلسل تدريجي لتفادي حدود التزامن.";
      } else if (errMsg.includes("Unknown API error: 1013") || errMsg.includes("1013")) {
          errMsg = "الخدمة غير متاحة مؤقتاً (1013). حاول مرة أخرى بعد قليل.";
      }
      console.warn(`[Gemini Cookie Translate] Session error for ${chapterSessionKey}:`, errMsg);
      chatError = new Error(errMsg);
      const secId = cookiesObj['__Secure-1PSID'];
      if (secId) geminiCookieClients.delete(secId);
      geminiApiChats.delete(chapterSessionKey);
    }

    // If Gemini Cookie chat failed or timed out, fall back automatically to Google Translate so user translation never breaks (1:1 Old Project behavior)
    if (chatError || !response || !response.text) {
      const details = chatError?.message || "لم يتم استلام رد من خادم Gemini Cookies";
      console.warn(`[Gemini Cookies Notice]: Cookie session failed (${details}), engaging automatic Google Translate fallback...`);
      const textsToTranslate = translationItems.map(it => it.source_text);
      const googleBatch = await translateBatchWithGoogleFree(textsToTranslate, targetLanguage || "ar");
      const fallbackMap: Record<string, string> = {};
      const fallbackPageTranslations = translationItems.map((it, i) => {
        const tr = googleBatch[i] || it.source_text;
        fallbackMap[it.region_id] = tr;
        fallbackMap[String(it.reading_order)] = tr;
        return {
          region_id: it.region_id,
          reading_order: it.reading_order,
          source_text: it.source_text,
          translated_text: tr
        };
      });

      return res.json({
        success: true,
        translations: googleBatch,
        translationMap: fallbackMap,
        page_translations: fallbackPageTranslations,
        sessionId: chapterSessionKey,
        model: selectedModel,
        modelLabel: modelInfo?.label || selectedModel,
        provider: "gemini_cookies",
        selectedProvider: normalizedProvider,
        actualProvider: "google"
      });
    }

    const extractionResult = extractMangaTranslationsByRegionId(response.text, translationItems);
    let { translationMap, translations: finalTranslations, page_translations: finalPageTranslations } = extractionResult;

    // Fill in any matched translations from map and keep page_translations fully synchronized
    for (let i = 0; i < translationItems.length; i++) {
      const it = translationItems[i];
      let trans = finalTranslations[i];
      if ((!trans || isUntranslatedText(trans, it.source_text, targetLanguage)) && translationMap[it.region_id]) {
        trans = translationMap[it.region_id];
        finalTranslations[i] = trans;
      }
      if (trans && trans.trim()) {
        translationMap[it.region_id] = trans.trim();
        translationMap[String(it.reading_order)] = trans.trim();
      }
      if (finalPageTranslations && finalPageTranslations[i]) {
        finalPageTranslations[i].translated_text = trans || finalPageTranslations[i].translated_text || "";
      }
    }

    const hasAnyTranslation = finalTranslations.some(t => t && t.trim().length > 0);
    if (!hasAnyTranslation && translationItems.length > 0) {
      console.warn(`[Gemini Cookies Warning] 0 translations extracted from Gemini response for ${chapterSessionKey}. Raw snippet: ${response.text?.slice(0, 200)}`);
      return res.status(502).json({
        success: false,
        status: "Empty Translation",
        error: "Gemini Cookies translation failed: لم يتم استلام ترجمة صالحة من خادم Gemini Cookies (استجابة النموذج لم تتضمن نصوصاً مترجمة)",
        provider: "gemini_cookies",
        selectedProvider: normalizedProvider,
        actualProvider: "gemini_cookies"
      });
    }

    const actualProvider = "gemini_cookies";

    // Provider match validation (Requirement 11)
    if (normalizedProvider !== actualProvider) {
      return res.status(500).json({
        success: false,
        error: `Selected provider (${normalizedProvider}) does not match actual provider (${actualProvider})`,
        provider: normalizedProvider,
        actualProvider
      });
    }

    console.log(`[Translation Router] Translation Completed: Provider=${actualProvider}, Chapter=${chapterId || "unknown"}, Blocks=${translationItems.length}`);

    return res.json({
      success: true,
      translations: finalTranslations,
      translationMap,
      page_translations: finalPageTranslations,
      sessionId: chapterSessionKey,
      model: selectedModel,
      modelLabel: modelInfo.label,
      provider: "gemini_cookies",
      selectedProvider: normalizedProvider,
      actualProvider: actualProvider
    });
  } catch (outerErr: any) {
    console.error("[Gemini Cookies Outer Error]:", outerErr);
    return res.status(500).json({
      success: false,
      status: "Server Error",
      error: `Gemini Cookies translation failed: ${outerErr?.message || "خطأ غير متوقع في خادم الترجمة"}`,
      provider: "gemini_cookies",
      selectedProvider: "gemini_cookies",
      actualProvider: "gemini_cookies"
    });
  }
});

// 11.5 Gemini Cookies Cinematic Video Story Script Endpoint (🎬 إنشاء فيديوهات المانهاوا)
app.post("/api/manga/video-story-gemini", async (req, res) => {
  try {
    const { cookies, model, mangaTitle = "مانهاوا", chapterTitle = "فصل", scenes } = req.body;
    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ success: false, error: "Missing scenes array" });
    }

    if (!cookies || typeof cookies !== "string" || !cookies.trim()) {
      return res.status(400).json({
        success: false,
        error: "لم يتم العثور على ملفات تعريف الارتباط (Gemini Cookies). يرجى ضبطها في صفحة الإعدادات لاستخدام هذا النموذج."
      });
    }

    const rawCookiesObj = parseCookiesStr(cookies);
    const cookiesObj = filterGeminiCookies(rawCookiesObj);
    if (!cookiesObj['__Secure-1PSID']) {
      return res.status(400).json({
        success: false,
        error: "لم يتم العثور على الكوكي الأساسي __Secure-1PSID في بيانات Gemini Cookies. يرجى تجديد ملفات تعريف الارتباط في الإعدادات."
      });
    }

    const selectedModel = normalizeGeminiModel(model || "3.6-flash");
    const modelInfo = GEMINI_COOKIE_MODELS[selectedModel] || GEMINI_COOKIE_MODELS["3.6-flash"];
    const useExtendedThinking = modelInfo.extendedThinking;

    const chat = await createResilientGeminiChat(cookiesObj, selectedModel);

    // Format scene context for prompt
    const formattedScenes = scenes.map((s: any, idx: number) => {
      const text = s.rawText || s.dialogueText || "";
      return `[المشهد ${idx + 1} - صفحة ${s.pageIndex + 1}]: ${text || "(مشهد بدون حوار ظاهر)"}`;
    }).join("\n");

    const prompt = `أنت مخرج ومؤلف سينمائي متخصص في سرد المانهاوا والقصص المصورة بالعربية الفصحى السينمائية المشوقة.
العمل: "${mangaTitle}"
الفصل: "${chapterTitle}"
عدد المشاهد: ${scenes.length}

المطلوب:
صياغة سرد درامي سينمائي باللغة العربية الفصحى لكل مشهد من المشاهد التالية، بحيث يكون النص مناسباً تماماً للإلقاء الصوتي (Voice-over) في فيديو مانهاوا قصصي.
القواعد الصارمة:
1. التزم تماماً بأحداث القصة وشخصياتها دون أي تحريف أو اختلاق.
2. لكل مشهد اكتب جملة أو جملتين قويتين معبرتين تعكسان مشاعر اللوحة وحوار الشخصيات.
3. التزم بترتيب المشاهد بدقة.
4. المخرجات حصرياً بصيغة JSON صالحة بالشكل التالي بدون أي نصوص قبلها أو بعدها:
{
  "narrations": [
    { "sceneIndex": 0, "narration": "نص السرد للمشهد الأول" },
    ...
  ]
}

قائمة المشاهد:
${formattedScenes}`;

    const response = await runWithGeminiCookieLock(async () => {
      return await chat.generateContent({ prompt, extended_thinking: useExtendedThinking });
    });

    const candidate = response?.candidates?.[0]?.content?.parts?.[0]?.text || response?.text || "";
    let parsed: any = null;
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {}
    }

    const narrations = parsed?.narrations && Array.isArray(parsed.narrations) ? parsed.narrations : [];
    return res.json({
      success: true,
      narrations,
      model: selectedModel,
      modelLabel: modelInfo.label
    });
  } catch (err: any) {
    console.error("[Video Story Gemini Cookies Error]:", err);
    return res.status(500).json({
      success: false,
      error: `فشل تحليل السيناريو عبر Gemini Cookies: ${err.message || err}`
    });
  }
});


// 12. Meta AI Endpoints (Llama 3 Reverse/Browser Integration)
app.post("/api/manga/test-metaai-cookies", async (req, res) => {
  try {
    const { cookies } = req.body;
    const result = await testMetaAiCookies(cookies);
    res.json(result);
  } catch (err: any) {
    console.error("[Meta AI Test Error]:", err);
    res.status(500).json({ success: false, status: "Request Failed", error: err.message || "فشل الاتصال بـ Meta AI" });
  }
});

app.post("/api/manga/metaai-chat", async (req, res) => {
  try {
    const { prompt, cookies, newConversation, chapterId, conversationId, conversationUrl } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt parameter" });
    }
    const response = await sendMetaAiPrompt(prompt, {
      cookies,
      newConversation,
      chapterId: chapterId ? String(chapterId) : undefined,
      conversationId,
      conversationUrl
    });
    res.json({
      success: true,
      message: response.text,
      mediaUrls: response.mediaUrls,
      conversationId: response.conversationId,
      conversationUrl: response.conversationUrl
    });
  } catch (err: any) {
    console.error("[Meta AI Chat Error]:", err);
    res.status(500).json({ error: err.message || "حدث خطأ أثناء التحدث مع Meta AI" });
  }
});

app.post("/api/manga/translate-metaai", async (req, res) => {
  const { cookies, texts, blockIds, targetLanguage, mangaContext, workType, workName, chapterId, conversationId, conversationUrl, newConversation, structuredBlocks, page_translations, items } = req.body;
  if ((!texts || !Array.isArray(texts) || texts.length === 0) && (!page_translations || !Array.isArray(page_translations))) {
    return res.status(400).json({ error: "Missing texts or page_translations array" });
  }

  let result: {
    translations: string[];
    translationMap: Record<string, string>;
    page_translations: any[];
    conversationId?: string;
    conversationUrl?: string;
  } | null = null;

  try {
    result = await translateMangaWithMetaAi({
      texts,
      blockIds,
      items,
      structuredBlocks,
      page_translations,
      targetLanguage,
      mangaContext,
      workType,
      workName,
      cookies,
      chapterId: chapterId ? String(chapterId) : undefined,
      conversationId,
      conversationUrl,
      newConversation: Boolean(newConversation)
    });
  } catch (err: any) {
    console.error("[Meta AI Translation Error]:", err?.message || err);
    return res.status(502).json({
      success: false,
      error: `تعذر إتمام الترجمة عبر Meta AI: ${err?.message || "فشل الاتصال"}`,
      provider: "metaai_cookies",
      selectedProvider: "metaai_cookies",
      actualProvider: "metaai_cookies"
    });
  }

  try {
    const translationMap: Record<string, string> = { ...(result?.translationMap || {}) };
    const sourceTexts: string[] = Array.isArray(texts) ? texts : (result?.page_translations || []).map(p => p.source_text);
    const finalTranslations: string[] = new Array(sourceTexts.length).fill("");

    for (let i = 0; i < sourceTexts.length; i++) {
      const bId = Array.isArray(blockIds) ? blockIds[i] : null;
      let val = result?.translations?.[i];
      if ((!val || isUntranslatedText(val, sourceTexts[i], targetLanguage)) && bId && translationMap[bId]) {
        val = translationMap[bId];
      }
      finalTranslations[i] = (val && val.trim()) ? val.trim() : (translationMap[`region_${i + 1}`] || translationMap[String(i + 1)] || "");
    }

    const sanitizedTranslations = finalTranslations.map((t) => sanitizeTranslatedText(t));
    if (Array.isArray(blockIds)) {
      for (let b = 0; b < blockIds.length; b++) {
        if (blockIds[b] && sanitizedTranslations[b] !== undefined) {
          translationMap[blockIds[b]] = sanitizedTranslations[b];
        }
      }
    }

    const finalPageTranslations = (result?.page_translations && result.page_translations.length > 0)
      ? result.page_translations.map((p, idx) => ({
          ...p,
          translated_text: sanitizedTranslations[idx] || (p.translated_text && !isUntranslatedText(p.translated_text, p.source_text, targetLanguage) ? p.translated_text : ""),
          arabic_text: sanitizedTranslations[idx] || (p.translated_text && !isUntranslatedText(p.translated_text, p.source_text, targetLanguage) ? p.translated_text : "")
        }))
      : sourceTexts.map((src, idx) => ({
          region_id: Array.isArray(blockIds) && blockIds[idx] ? blockIds[idx] : `region_${idx + 1}`,
          reading_order: idx + 1,
          source_text: src,
          translated_text: sanitizedTranslations[idx] || "",
          arabic_text: sanitizedTranslations[idx] || ""
        }));

    res.json({
      success: true,
      translations: sanitizedTranslations,
      translationMap,
      page_translations: finalPageTranslations,
      conversationId: result?.conversationId,
      conversationUrl: result?.conversationUrl,
      provider: "metaai_cookies",
      selectedProvider: "metaai_cookies",
      actualProvider: "metaai_cookies"
    });
  } catch (procErr: any) {
    console.error("[Meta AI Result Processing Error]:", procErr);
    res.status(500).json({
      success: false,
      error: procErr.message || "فشلت معالجة نتائج Meta AI",
      provider: "metaai_cookies",
      selectedProvider: "metaai_cookies",
      actualProvider: "metaai_cookies"
    });
  }
});

// Endpoint: AI Colorization via Manga Light Colorizer with Line Art preservation, Text/Bubble protection, and Smart Tiling
app.post("/api/manga/colorize", async (req, res) => {
  try {
    const { imageBase64, imageUrl, chapterId, pageIndex, blocks, hfToken, inferSize } = req.body;
    if (!imageBase64 && !imageUrl) {
      return res.status(400).json({ error: "Missing imageBase64 or imageUrl" });
    }

    let inputBuffer: Buffer;
    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-z0-9+]+;base64,/i, "");
      inputBuffer = Buffer.from(cleanBase64, "base64");
    } else {
      let fetchUrl = imageUrl.trim();
      if (fetchUrl.startsWith("/")) {
        fetchUrl = `http://127.0.0.1:${PORT}${fetchUrl}`;
      }
      const imgRes = await fetch(fetchUrl);
      if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.statusText}`);
      const arrayBuf = await imgRes.arrayBuffer();
      inputBuffer = Buffer.from(arrayBuf);
    }

    const { colorizedBuffer, metrics } = await colorizeMangaImage(inputBuffer, {
      chapterId,
      pageIndex,
      blocks,
      hfToken,
      inferSize: inferSize || 512
    });

    const colorizedBase64 = `data:image/jpeg;base64,${colorizedBuffer.toString("base64")}`;
    res.json({ colorizedBase64, metrics });
  } catch (err: any) {
    console.error("[Colorizer Error]:", err);
    res.status(500).json({ error: err.message || "فشل تلوين الصفحة بالذكاء الاصطناعي" });
  }
});

// Reset Chapter Conversation Session Endpoint (Supports Gemini, Meta AI, or all)
app.post("/api/manga/reset-chapter-session", async (req, res) => {
  try {
    const { chapterId, sessionId, engine } = req.body;
    if (!chapterId && !sessionId) return res.status(400).json({ error: "Missing chapterId or sessionId" });
    
    if (!engine || engine === "gemini" || engine === "gemini_cookies" || engine === "all") {
      let deleted = 0;
      for (const key of geminiApiChats.keys()) {
        if ((chapterId && key.includes(String(chapterId))) || (sessionId && key.includes(String(sessionId)))) {
          geminiApiChats.delete(key);
          deleted++;
        }
      }
      console.log(`[Session Reset] Cleared ${deleted} Gemini sessions for chapter/session: ${chapterId || sessionId}`);
    }
    if (!engine || engine === "metaai" || engine === "all") {
      if (chapterId) resetChapterMetaAiConversation(String(chapterId));
      if (sessionId) resetChapterMetaAiConversation(String(sessionId));
      console.log(`[Session Reset] Cleared Meta AI session for chapter/session: ${chapterId || sessionId}`);
    }
    
    // Clear in-memory page OCR cache on session reset
    pageOcrCache.clear();
    
    res.json({ success: true, message: `تمت إعادة ضبط محادثة الفصل ${chapterId} بنجاح` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "فشل إعادة ضبط المحادثة" });
  }
});

app.get("/api/manga/chapter-sessions", (req, res) => {
  const metaConversations = loadChapterMetaAiConversations();
  const geminiSessions = Array.from(geminiCookieClients.keys());
  res.json({
    geminiSessions,
    metaConversations
  });
});

// Prevent unmatched API requests from falling through to Vite or SPA HTML fallback
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
});

// Global API error handler ensuring errors always return JSON, not Express default HTML
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err) {
    console.error("[Express Error Handler]", req.method, req.path, err.message || err);
    if (req.path.startsWith("/api/")) {
      const status = typeof err.status === "number" ? err.status : 500;
      return res.status(status).json({ error: err.message || "Internal server error" });
    }
  }
  next(err);
});

// Integrate Vite Middleware or serve static assets
async function startServer() {
  const distPath = path.resolve(process.cwd(), "dist");
  const assetsPath = path.join(distPath, "assets");

  // Resilient /assets/:filename handler: serves exact, prefix-matched, or self-healing fallback chunks in both dev & prod
  app.get("/assets/:filename", (req, res, next) => {
    const requested = path.basename(req.params.filename || "");
    if (!requested) return next();

    if (fs.existsSync(assetsPath)) {
      const exactPath = path.join(assetsPath, requested);
      if (fs.existsSync(exactPath)) {
        return res.sendFile(exactPath);
      }
      // If a browser tab has an older chunk hash (e.g. SettingsPage-oldHash.js), resolve to the latest chunk with the same prefix & extension
      const match = requested.match(/^([A-Za-z0-9_]+)-[A-Za-z0-9_-]+(\.(?:js|css))$/);
      if (match) {
        const [, prefix, ext] = match;
        try {
          const files = fs.readdirSync(assetsPath);
          const replacement = files.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(ext));
          if (replacement) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
            return res.sendFile(path.join(assetsPath, replacement));
          }
        } catch (_) {}
      }
    }

    // If a stale browser tab requests an old dynamically imported JS chunk (e.g. GeminiTTSStudio-Cdl_iMn8.js)
    // that was merged into the main bundle, return a valid 200 OK ES module that triggers an immediate reload
    // instead of a 404 (preventing "Failed to fetch dynamically imported module" errors).
    if (requested.endsWith(".js")) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(200).send(
        `if (typeof window !== "undefined" && !window.__aisStaleChunkReload) {\n` +
        `  window.__aisStaleChunkReload = true;\n` +
        `  try {\n` +
        `    const u = new URL(window.location.href);\n` +
        `    u.searchParams.set("_v", String(Date.now()));\n` +
        `    window.location.replace(u.toString());\n` +
        `  } catch (_) {\n` +
        `    window.location.reload();\n` +
        `  }\n` +
        `}\n` +
        `const StaleChunkFallback = () => null;\n` +
        `export default StaleChunkFallback;\n` +
        `export {\n` +
        `  StaleChunkFallback as GeminiTTSStudio,\n` +
        `  StaleChunkFallback as VideoDubbingPage,\n` +
        `  StaleChunkFallback as ManhwaVideoPage,\n` +
        `  StaleChunkFallback as NovelToMangaPage,\n` +
        `  StaleChunkFallback as ReaderPage,\n` +
        `  StaleChunkFallback as Library,\n` +
        `  StaleChunkFallback as SettingsPage,\n` +
        `  StaleChunkFallback as Favorites,\n` +
        `  StaleChunkFallback as MangaDetails,\n` +
        `  StaleChunkFallback as ExtensionsPage,\n` +
        `  StaleChunkFallback as SuwayomiHub\n` +
        `};\n`
      );
    }

    if (requested.endsWith(".css")) {
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(200).send("/* stale css chunk fallback */\n");
    }

    next();
  });

  const hasBuiltDist = () =>
    fs.existsSync(path.join(distPath, "index.html")) && fs.existsSync(assetsPath);

  const isDistFresh = (): boolean => {
    if (!hasBuiltDist()) return false;
    try {
      const distMtime = fs.statSync(path.join(distPath, "index.html")).mtimeMs;
      const checkDir = (dir: string): boolean => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            if (!checkDir(full)) return false;
          } else if (stat.mtimeMs > distMtime + 1000) {
            return false;
          }
        }
        return true;
      };
      return checkDir(path.resolve(process.cwd(), "src"));
    } catch {
      return hasBuiltDist();
    }
  };

  let isBuildingDistInBg = false;
  const ensureDistBuiltInBackground = () => {
    if (isBuildingDistInBg || isDistFresh()) return;
    isBuildingDistInBg = true;
    console.log("[Server] Building optimized dist bundle in background...");
    viteBuild()
      .then(() => {
        console.log("[Server] Optimized dist bundle ready.");
      })
      .catch((err) => {
        console.warn("[Server] Background dist build warning:", err?.message || err);
      })
      .finally(() => {
        isBuildingDistInBg = false;
      });
  };

  // Serve pre-compiled dist bundle directly whenever available (avoids 10MB+ 79-file ESM waterfall over slow connections)
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/suwayomi-embed/") || req.query.dev === "1") {
      return next();
    }
    if (!isDistFresh()) {
      ensureDistBuiltInBackground();
    }
    if (hasBuiltDist()) {
      if (req.path === "/" || req.path === "/index.html") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        return res.sendFile(path.join(distPath, "index.html"));
      }
      const staticCandidate = path.join(distPath, req.path);
      if (fs.existsSync(staticCandidate) && fs.statSync(staticCandidate).isFile()) {
        if (req.path.startsWith("/assets/")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
        return res.sendFile(staticCandidate);
      }
    }
    next();
  });

  // Listen immediately on PORT 3000 so the preview never times out waiting for Vite startup
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Manga Reader is running on http://localhost:${PORT}`);
    if (!isDistFresh()) {
      ensureDistBuiltInBackground();
    }
  });

  const isProduction = process.env.NODE_ENV === "production" && hasBuiltDist();

  if (!isProduction) {
    // Development Mode fallback
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/suwayomi-embed/")) return next();
      if (hasBuiltDist() && req.query.dev !== "1") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        return res.sendFile(path.join(distPath, "index.html"));
      }
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html; charset=utf-8" }).end(template);
      } catch (e: any) {
        if (vite) vite.ssrFixStacktrace(e);
        next(e);
      }
    });
    console.log("Vite development server loaded in Express middleware.");
  } else {
    // Production Mode
    if (fs.existsSync(assetsPath)) {
      app.use("/assets", express.static(assetsPath, { maxAge: "1y", immutable: true }));
    }
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          }
        },
      })
    );
    app.get("*", (req, res) => {
      // Do not return index.html for API requests or broken static assets
      if (req.path.startsWith("/api/") || /\.[a-zA-Z0-9]+$/.test(req.path)) {
        return res.status(404).send("Not found");
      }
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log(`Serving static production files from: ${distPath}`);
  }
}

startServer();
