import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import dns from "dns";
import { Agent, setGlobalDispatcher } from "undici";

export const suwayomiRouter = Router();

// Default Suwayomi Server URL - requested active instance
export const DEFAULT_SUWAYOMI_URL = "https://f212af09-ae8a-4d6f-be1a-59fbca80573e-00-3ctaa6lqfzq7d.sisko.replit.dev";
const SUWAYOMI_HOST = "f212af09-ae8a-4d6f-be1a-59fbca80573e-00-3ctaa6lqfzq7d.sisko.replit.dev";
const SUWAYOMI_IP = "8.231.72.240";

// 1. Ensure /etc/hosts entry exists
try {
  const hosts = fs.readFileSync("/etc/hosts", "utf8");
  if (!hosts.includes(SUWAYOMI_HOST)) {
    fs.appendFileSync("/etc/hosts", `\n${SUWAYOMI_IP} ${SUWAYOMI_HOST}\n`);
    console.log("[Suwayomi Network] /etc/hosts updated with Suwayomi IP");
  }
} catch (e: any) {
  console.warn("[Suwayomi Network] Note on /etc/hosts:", e.message);
}

// 2. Configure undici custom lookup agent to resolve Replit domain reliably
try {
  const suwAgent = new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        if (hostname === SUWAYOMI_HOST) {
          return callback(null, [{ address: SUWAYOMI_IP, family: 4 }]);
        }
        return dns.lookup(hostname, options, callback);
      }
    }
  });
  setGlobalDispatcher(suwAgent);
  console.log("[Suwayomi Network] undici global dispatcher configured for Suwayomi");
} catch (e: any) {
  console.warn("[Suwayomi Network] Note on undici dispatcher:", e.message);
}

// Default Extension Repositories
export const DEFAULT_EXTENSION_REPOS = [
  {
    name: "Keiyoushi Extensions (Official Keiyoushi Repo)",
    url: "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json",
    baseUrl: "https://raw.githubusercontent.com/keiyoushi/extensions/repo",
    isDefault: true
  }
];

// Custom / Manual Sources structure and persistence
export interface CustomSourceRecord {
  id: string;
  rawId: string;
  name: string;
  displayName: string;
  rawName: string;
  lang: string;
  language: string;
  baseUrl?: string;
  iconUrl?: string;
  provider: "suwayomi" | "custom";
  status: "live";
  supportsLatest?: boolean;
  type?: "suwayomi_source" | "extension_repo" | "custom_url";
  addedAt: number;
}

const CUSTOM_SOURCES_FILE = path.join(process.cwd(), "custom-sources.json");

function loadCustomSources(): CustomSourceRecord[] {
  try {
    if (fs.existsSync(CUSTOM_SOURCES_FILE)) {
      const content = fs.readFileSync(CUSTOM_SOURCES_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err: any) {
    console.warn("[Suwayomi] Note on loading custom-sources.json:", err.message);
  }
  return [];
}

function saveCustomSources(sources: CustomSourceRecord[]) {
  try {
    fs.writeFileSync(CUSTOM_SOURCES_FILE, JSON.stringify(sources, null, 2), "utf-8");
  } catch (err: any) {
    console.warn("[Suwayomi] Failed to save custom-sources.json:", err.message);
  }
}

export let customSourcesList: CustomSourceRecord[] = loadCustomSources();

// In-memory chapter metadata cache to speed up image streaming and prevent 404s
interface CachedChapterInfo {
  mangaId: string | number;
  sourceOrder: string | number;
  pageCount: number;
  updatedAt: number;
}
const chapterCache = new Map<string, CachedChapterInfo>();

// Helper to determine active Suwayomi Server URL
export function getSuwayomiUrl(req?: Request): string {
  // 1. Header override from frontend client (only if valid active URL)
  const headerUrl = req?.headers["x-suwayomi-url"] as string;
  if (headerUrl && headerUrl.trim() && headerUrl.startsWith("http") && !headerUrl.includes("60428483-9860") && !headerUrl.includes("73497d20-627a")) {
    return headerUrl.trim().replace(/\/+$/, "");
  }
  // 2. Query param override
  const queryUrl = req?.query?.suwayomiUrl as string;
  if (queryUrl && queryUrl.trim() && queryUrl.startsWith("http") && !queryUrl.includes("60428483-9860") && !queryUrl.includes("73497d20-627a")) {
    return queryUrl.trim().replace(/\/+$/, "");
  }
  // 3. Centralized default - strict single source
  return DEFAULT_SUWAYOMI_URL;
}

// In-memory cache for extension repository index
let cachedRepoIndex: {
  url: string;
  timestamp: number;
  data: any[];
} | null = null;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Generic GraphQL caller for Suwayomi with customizable timeout and abort signal support
export async function executeSuwayomiGraphQL<T = any>(
  suwayomiUrl: string, 
  query: string, 
  variables?: any,
  timeoutMsOrSignal: number | AbortSignal = 20000
): Promise<T> {
  const timeoutMs = typeof timeoutMsOrSignal === "number" ? timeoutMsOrSignal : 20000;
  const externalSignal = typeof timeoutMsOrSignal === "object" ? timeoutMsOrSignal : undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeout);
      throw new Error("Aborted");
    }
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${suwayomiUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`Suwayomi GraphQL HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();
    if (json.errors && json.errors.length > 0 && !json.data) {
      throw new Error(json.errors[0]?.message || "GraphQL error from Suwayomi");
    }

    return json.data as T;
  } finally {
    clearTimeout(timeout);
  }
}

// 1. Check Suwayomi Server Status & Health
suwayomiRouter.get("/status", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    let version = "unknown";
    let isHealthy = false;
    let details: any = {};
    let sourcesCount = 0;

    try {
      const resp = await fetch(`${suwayomiUrl}/api/v1/settings/about`, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      if (resp.ok) {
        details = await resp.json().catch(() => ({}));
        version = details.version || details.revision || "v2.x";
        isHealthy = true;
      }
    } catch {
      // Fallback probe
      try {
        const ping = await executeSuwayomiGraphQL(suwayomiUrl, `query { __typename }`);
        if (ping) {
          isHealthy = true;
          version = "Active (GraphQL)";
        }
      } catch {}
    }

    if (isHealthy) {
      try {
        const sResp = await fetch(`${suwayomiUrl}/api/v1/source/list`, {
          signal: controller.signal,
          headers: { Accept: "application/json" }
        });
        if (sResp.ok) {
          const sList = await sResp.json();
          sourcesCount = Array.isArray(sList) ? sList.length : 0;
        }
      } catch {}
    }

    clearTimeout(timeout);

    if (isHealthy) {
      return res.json({
        online: true,
        url: suwayomiUrl,
        version,
        details,
        sourcesCount,
        message: "Suwayomi Server is connected and active."
      });
    } else {
      return res.json({
        online: false,
        url: suwayomiUrl,
        error: "Suwayomi Server returned a non-OK status",
        message: "Server reached but returned unexpected response."
      });
    }
  } catch (err: any) {
    return res.json({
      online: false,
      url: suwayomiUrl,
      error: err.name === "AbortError" ? "Connection timed out" : err.message || "Connection refused",
      message: "Suwayomi Server is currently unreachable or offline at this URL."
    });
  }
});

// 2. Fetch Extension Repository Index (Keiyoushi or Custom Repo)
suwayomiRouter.get("/repo-index", async (req: Request, res: Response) => {
  const repoUrl = (req.query.repoUrl as string) || DEFAULT_EXTENSION_REPOS[0].url;

  try {
    const now = Date.now();
    if (cachedRepoIndex && cachedRepoIndex.url === repoUrl && (now - cachedRepoIndex.timestamp) < CACHE_TTL_MS) {
      return res.json({
        success: true,
        repoUrl,
        fromCache: true,
        count: cachedRepoIndex.data.length,
        extensions: cachedRepoIndex.data
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(repoUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MangaSourceHub/1.0",
        Accept: "application/json"
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Repository server returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const rawList = Array.isArray(data) ? data : (data.extensions || []);
    const repoBase = repoUrl.substring(0, repoUrl.lastIndexOf("/"));

    const normalizedExtensions = rawList.map((ext: any) => {
      const pkg = ext.pkg || ext.package || "";
      const iconUrl = ext.icon 
        ? (ext.icon.startsWith("http") ? ext.icon : `${repoBase}/icon/${ext.icon}`)
        : (ext.apk ? `${repoBase}/icon/${pkg}.png` : "");
      
      const apkUrl = ext.apk
        ? (ext.apk.startsWith("http") ? ext.apk : `${repoBase}/apk/${ext.apk}`)
        : "";

      return {
        name: ext.name || pkg,
        pkg: pkg,
        apk: ext.apk || "",
        apkUrl,
        iconUrl,
        lang: (ext.lang || "all").toLowerCase(),
        version: ext.version || ext.versionName || "1.0",
        versionCode: ext.versionCode || ext.code || 1,
        nsfw: ext.nsfw === 1 || ext.nsfw === true,
        hasReadme: Boolean(ext.hasReadme),
        hasChangelog: Boolean(ext.hasChangelog),
        sources: Array.isArray(ext.sources) ? ext.sources.map((s: any) => ({
          id: s.id,
          name: s.name,
          baseUrl: s.baseUrl,
          lang: s.lang
        })) : []
      };
    });

    cachedRepoIndex = {
      url: repoUrl,
      timestamp: now,
      data: normalizedExtensions
    };

    return res.json({
      success: true,
      repoUrl,
      fromCache: false,
      count: normalizedExtensions.length,
      extensions: normalizedExtensions
    });
  } catch (err: any) {
    console.error("[Suwayomi Service] Failed to fetch repository index:", err.message);
    if (cachedRepoIndex) {
      return res.json({
        success: true,
        repoUrl,
        fromCache: true,
        stale: true,
        count: cachedRepoIndex.data.length,
        extensions: cachedRepoIndex.data,
        warning: `Serving cached data: ${err.message}`
      });
    }

    return res.status(502).json({
      success: false,
      repoUrl,
      error: `Could not fetch extension repository index: ${err.message}`
    });
  }
});

// 3. Suwayomi Extensions Management
suwayomiRouter.get("/extensions", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(`${suwayomiUrl}/api/v1/extension/list`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    clearTimeout(timeout);

    if (response.ok) {
      const rawList = await response.json();
      const normalized = (Array.isArray(rawList) ? rawList : []).map((ext: any) => ({
        pkg: ext.pkgName,
        name: ext.name,
        apk: ext.apkName || "",
        apkUrl: ext.repo ? `${ext.repo.replace(/\/index\.pb$/, "")}/${ext.apkName}` : "",
        iconUrl: ext.iconUrl ? `/api/suwayomi/icon-proxy?path=${encodeURIComponent(ext.iconUrl)}` : "",
        lang: (ext.lang || "all").toLowerCase(),
        version: ext.versionName || "1.0",
        versionCode: ext.versionCode || 1,
        nsfw: Boolean(ext.isNsfw),
        isInstalled: Boolean(ext.installed ?? ext.isInstalled),
        hasUpdate: Boolean(ext.hasUpdate)
      }));

      return res.json({
        online: true,
        extensions: normalized,
        count: normalized.length
      });
    }

    return res.json({
      online: false,
      extensions: [],
      error: `Suwayomi returned HTTP ${response.status}`
    });
  } catch (err: any) {
    return res.json({
      online: false,
      extensions: [],
      error: err.message || "Suwayomi Server offline"
    });
  }
});

suwayomiRouter.post("/extensions/install/:pkgName", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const { pkgName } = req.params;
  try {
    console.log(`[Suwayomi Extension] Installing package: ${pkgName} via GraphQL mutation`);
    const mutation = `
      mutation UpdateExt($input: UpdateExtensionInput!) {
        updateExtension(input: $input) {
          extension {
            pkgName
            name
            isInstalled
            hasUpdate
          }
        }
      }
    `;
    const data = await executeSuwayomiGraphQL(suwayomiUrl, mutation, {
      input: {
        id: pkgName,
        patch: { install: true }
      }
    });
    const ext = data?.updateExtension?.extension;
    return res.json({ success: true, extension: ext });
  } catch (err: any) {
    console.error(`[Suwayomi Extension] Install failed for ${pkgName}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

suwayomiRouter.post("/extensions/uninstall/:pkgName", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const { pkgName } = req.params;
  try {
    console.log(`[Suwayomi Extension] Uninstalling package: ${pkgName} via GraphQL mutation`);
    const mutation = `
      mutation UpdateExt($input: UpdateExtensionInput!) {
        updateExtension(input: $input) {
          extension {
            pkgName
            name
            isInstalled
            hasUpdate
          }
        }
      }
    `;
    const data = await executeSuwayomiGraphQL(suwayomiUrl, mutation, {
      input: {
        id: pkgName,
        patch: { uninstall: true }
      }
    });
    const ext = data?.updateExtension?.extension;
    return res.json({ success: true, extension: ext });
  } catch (err: any) {
    console.error(`[Suwayomi Extension] Uninstall failed for ${pkgName}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

suwayomiRouter.post("/extensions/update/:pkgName", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const { pkgName } = req.params;
  try {
    console.log(`[Suwayomi Extension] Updating package: ${pkgName} via GraphQL mutation`);
    const mutation = `
      mutation UpdateExt($input: UpdateExtensionInput!) {
        updateExtension(input: $input) {
          extension {
            pkgName
            name
            isInstalled
            hasUpdate
          }
        }
      }
    `;
    const data = await executeSuwayomiGraphQL(suwayomiUrl, mutation, {
      input: {
        id: pkgName,
        patch: { update: true }
      }
    });
    const ext = data?.updateExtension?.extension;
    return res.json({ success: true, extension: ext });
  } catch (err: any) {
    console.error(`[Suwayomi Extension] Update failed for ${pkgName}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Suwayomi Sources list
suwayomiRouter.get("/sources", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(`${suwayomiUrl}/api/v1/source/list`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    clearTimeout(timeout);

    if (response.ok) {
      const rawSources = await response.json();
      const mapped = (Array.isArray(rawSources) ? rawSources : []).map((s: any) => {
        const langStr = (s.lang || "all").toLowerCase();
        // Resolve icon URL using our internal proxy
        let iconUrl: string | null = null;
        if (s.iconUrl) {
          iconUrl = `/api/suwayomi/icon-proxy?path=${encodeURIComponent(s.iconUrl)}`;
        } else {
          iconUrl = `/api/suwayomi/source/${s.id}/icon`;
        }

        return {
          id: `suwayomi_${s.id}`,
          rawId: String(s.id),
          name: s.displayName ? s.displayName : `${s.name} [${langStr.toUpperCase()}]`,
          displayName: s.displayName || s.name,
          rawName: s.name,
          lang: langStr,
          language: langStr,
          isConfigurable: Boolean(s.isConfigurable),
          iconUrl,
          provider: "suwayomi",
          status: "live",
          supportsLatest: Boolean(s.supportsLatest),
          baseUrl: s.baseUrl || "",
          isCustom: false
        };
      });

      // Merge custom user-added sources seamlessly at the very top
      for (const custom of customSourcesList) {
        if (!mapped.some((s: any) => s.rawId === custom.rawId || s.id === custom.id)) {
          mapped.unshift({
            id: custom.id,
            rawId: custom.rawId,
            name: custom.name,
            displayName: `⭐ ${custom.displayName || custom.name} [يدوي]`,
            rawName: custom.rawName || custom.name,
            lang: custom.lang || "all",
            language: custom.language || "all",
            isConfigurable: false,
            iconUrl: custom.iconUrl || null,
            provider: custom.provider || "suwayomi",
            status: "live",
            supportsLatest: true,
            baseUrl: custom.baseUrl || "",
            isCustom: true
          });
        }
      }

      // Priority sort: Place custom sources, requested test source 6247824327199706550 (Asura Scans), and Arabic sources first
      mapped.sort((a: any, b: any) => {
        if (a.isCustom && !b.isCustom) return -1;
        if (!a.isCustom && b.isCustom) return 1;
        if (a.rawId === "6247824327199706550") return -1;
        if (b.rawId === "6247824327199706550") return 1;
        if (a.language === "ar" && b.language !== "ar") return -1;
        if (b.language === "ar" && a.language !== "ar") return 1;
        return a.displayName.localeCompare(b.displayName);
      });

      return res.json({
        online: true,
        sources: mapped,
        count: mapped.length
      });
    }

    return res.json({
      online: false,
      sources: [],
      error: `Suwayomi returned HTTP ${response.status}`
    });
  } catch (err: any) {
    return res.json({
      online: false,
      sources: [],
      error: err.message || "Suwayomi Server offline"
    });
  }
});

// Custom Source Management Endpoints
suwayomiRouter.get("/custom-sources", (req: Request, res: Response) => {
  res.json({
    success: true,
    sources: customSourcesList,
    count: customSourcesList.length
  });
});

suwayomiRouter.post("/custom-sources", async (req: Request, res: Response) => {
  try {
    const suwayomiUrl = getSuwayomiUrl(req);
    const { name, sourceId, rawId, lang, language, baseUrl, iconUrl, type } = req.body || {};
    const finalRawId = String(rawId || sourceId || "").trim().replace(/^suwayomi_/, "");
    const finalName = String(name || "").trim();

    if (!finalName || !finalRawId) {
      return res.status(400).json({
        success: false,
        error: "يرجى توفير اسم المصدر ومعرّف المصدر (Source ID)."
      });
    }

    // Check if already added
    if (customSourcesList.some(s => s.rawId === finalRawId || s.id === `custom_${finalRawId}`)) {
      return res.status(400).json({
        success: false,
        error: "هذا المصدر مضاف بالفعل في قائمة المصادر."
      });
    }

    // Attempt connectivity verification with Suwayomi if numeric ID
    let isConnected = false;
    let detectedDisplayName = finalName;
    try {
      const probeRes = await fetch(`${suwayomiUrl}/api/v1/source/${encodeURIComponent(finalRawId)}/popular`, {
        signal: AbortSignal.timeout(6000)
      });
      if (probeRes.ok) {
        isConnected = true;
      }
    } catch {}

    const newRecord: CustomSourceRecord = {
      id: `custom_${finalRawId}`,
      rawId: finalRawId,
      name: finalName,
      displayName: detectedDisplayName,
      rawName: finalName,
      lang: (lang || language || "all").toLowerCase().trim(),
      language: (lang || language || "all").toLowerCase().trim(),
      baseUrl: baseUrl || "",
      iconUrl: iconUrl || `/api/suwayomi/source/${finalRawId}/icon`,
      provider: "suwayomi",
      status: "live",
      supportsLatest: true,
      type: type || "suwayomi_source",
      addedAt: Date.now()
    };

    customSourcesList.push(newRecord);
    saveCustomSources(customSourcesList);

    return res.json({
      success: true,
      message: `تمت إضافة المصدر "${finalName}" بنجاح وربطه بنظام البحث!`,
      source: newRecord,
      testedConnected: isConnected
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

suwayomiRouter.delete("/custom-sources/:id", (req: Request, res: Response) => {
  const targetId = req.params.id;
  const initialLen = customSourcesList.length;
  customSourcesList = customSourcesList.filter(s => s.id !== targetId && s.rawId !== targetId && `custom_${s.rawId}` !== targetId);
  saveCustomSources(customSourcesList);

  return res.json({
    success: true,
    message: "تم حذف المصدر اليدوي بنجاح.",
    deleted: initialLen > customSourcesList.length
  });
});

// Helper for source or extension icon proxy
suwayomiRouter.get("/icon-proxy", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawPath = req.query.path as string;
  if (!rawPath) return res.status(400).send("Missing icon path");

  try {
    const cleanPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const targetUrl = `${suwayomiUrl}${cleanPath}`;
    const iconRes = await fetch(targetUrl);
    if (iconRes.ok) {
      const contentType = iconRes.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      const buffer = await iconRes.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }
    return res.status(iconRes.status).send("Icon not found");
  } catch (e: any) {
    return res.status(500).send(e.message);
  }
});

suwayomiRouter.get("/source/:sourceId/icon", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawSourceId = req.params.sourceId.replace(/^suwayomi_/, "");
  try {
    const iconRes = await fetch(`${suwayomiUrl}/api/v1/source/${encodeURIComponent(rawSourceId)}/icon`);
    if (iconRes.ok) {
      const contentType = iconRes.headers.get("content-type") || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      const buffer = await iconRes.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }
    return res.status(iconRes.status).send("Icon not found");
  } catch (e: any) {
    return res.status(500).send(e.message);
  }
});

// 5. Browse Manga from Source (Popular, Latest, Search)
// CRITICAL: In Suwayomi GraphQL schema, the $source variable must be declared as LongString!
suwayomiRouter.get("/source/:sourceId/popular", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawSourceId = req.params.sourceId.replace(/^suwayomi_/, "");
  const page = parseInt(req.query.page as string) || 1;

  try {
    // 1. Preferred method: GraphQL mutation fetchSourceManga with LongString!
    try {
      const gqlQuery = `
        mutation FetchPopular($source: LongString!, $page: Int!) {
          fetchSourceManga(input: { source: $source, type: POPULAR, page: $page }) {
            hasNextPage
            mangas {
              id
              title
              thumbnailUrl
              artist
              author
              description
              status
            }
          }
        }
      `;
      const gqlData = await executeSuwayomiGraphQL(suwayomiUrl, gqlQuery, {
        source: rawSourceId,
        page
      });

      const mangaList = gqlData?.fetchSourceManga?.mangas;
      if (Array.isArray(mangaList)) {
        const results = mangaList.map((m: any) => ({
          id: `suwayomi_${m.id}`,
          rawId: String(m.id),
          title: m.title,
          coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
          author: m.author || "Unknown",
          artist: m.artist || "",
          status: m.status || "Unknown",
          description: m.description || "",
          sourceId: `suwayomi_${rawSourceId}`,
          provider: "suwayomi"
        }));

        return res.json({
          results,
          hasNextPage: Boolean(gqlData.fetchSourceManga?.hasNextPage)
        });
      }
    } catch (gqlErr: any) {
      console.warn("[Suwayomi] GraphQL popular notice:", gqlErr.message);
    }

    // 2. Fallback to REST v1
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${suwayomiUrl}/api/v1/source/${encodeURIComponent(rawSourceId)}/popular/${page}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const mangaList = (data.mangaList || data || []).map((m: any) => ({
        id: `suwayomi_${m.id}`,
        rawId: String(m.id),
        title: m.title,
        coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
        author: m.author || "Unknown",
        artist: m.artist || "",
        status: m.status || "Unknown",
        description: m.description || "",
        sourceId: `suwayomi_${rawSourceId}`,
        provider: "suwayomi"
      }));

      return res.json({
        results: mangaList,
        hasNextPage: Boolean(data.hasNextPage)
      });
    }

    return res.status(response.status).json({ error: "Failed to fetch popular manga from Suwayomi" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

suwayomiRouter.get("/source/:sourceId/latest", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawSourceId = req.params.sourceId.replace(/^suwayomi_/, "");
  const page = parseInt(req.query.page as string) || 1;

  try {
    // 1. Preferred method: GraphQL mutation fetchSourceManga with LongString!
    try {
      const gqlQuery = `
        mutation FetchLatest($source: LongString!, $page: Int!) {
          fetchSourceManga(input: { source: $source, type: LATEST, page: $page }) {
            hasNextPage
            mangas {
              id
              title
              thumbnailUrl
              artist
              author
              description
              status
            }
          }
        }
      `;
      const gqlData = await executeSuwayomiGraphQL(suwayomiUrl, gqlQuery, {
        source: rawSourceId,
        page
      });

      const mangaList = gqlData?.fetchSourceManga?.mangas;
      if (Array.isArray(mangaList)) {
        const results = mangaList.map((m: any) => ({
          id: `suwayomi_${m.id}`,
          rawId: String(m.id),
          title: m.title,
          coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
          author: m.author || "Unknown",
          artist: m.artist || "",
          status: m.status || "Unknown",
          description: m.description || "",
          sourceId: `suwayomi_${rawSourceId}`,
          provider: "suwayomi"
        }));

        return res.json({
          results,
          hasNextPage: Boolean(gqlData.fetchSourceManga?.hasNextPage)
        });
      }
    } catch (gqlErr: any) {
      console.warn("[Suwayomi] GraphQL latest notice:", gqlErr.message);
    }

    // 2. Fallback to REST v1
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${suwayomiUrl}/api/v1/source/${encodeURIComponent(rawSourceId)}/latest/${page}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const mangaList = (data.mangaList || data || []).map((m: any) => ({
        id: `suwayomi_${m.id}`,
        rawId: String(m.id),
        title: m.title,
        coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
        author: m.author || "Unknown",
        artist: m.artist || "",
        status: m.status || "Unknown",
        description: m.description || "",
        sourceId: `suwayomi_${rawSourceId}`,
        provider: "suwayomi"
      }));

      return res.json({
        results: mangaList,
        hasNextPage: Boolean(data.hasNextPage)
      });
    }

    return res.status(response.status).json({ error: "Failed to fetch latest manga from Suwayomi" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Real Search Endpoint on selected Suwayomi Source
suwayomiRouter.get("/source/:sourceId/search", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawSourceId = req.params.sourceId.replace(/^suwayomi_/, "");
  const query = (req.query.query as string) || (req.query.q as string) || "";
  const page = parseInt(req.query.page as string) || 1;

  try {
    // 1. GraphQL Real Search Mutation with LongString!
    try {
      const gqlQuery = `
        mutation FetchSearch($source: LongString!, $query: String!, $page: Int!) {
          fetchSourceManga(input: { source: $source, type: SEARCH, query: $query, page: $page }) {
            hasNextPage
            mangas {
              id
              title
              thumbnailUrl
              artist
              author
              description
              status
            }
          }
        }
      `;
      const gqlData = await executeSuwayomiGraphQL(suwayomiUrl, gqlQuery, {
        source: rawSourceId,
        query: query.trim(),
        page
      });

      let mangaList = gqlData?.fetchSourceManga?.mangas;
      // Fallback: If 0 results on this source, check if query matches a canonical series (Arabic <-> English aliases)
      const qLower = query.trim().toLowerCase();
      const seriesMatch = findSeriesForQuery(query);
      if ((!Array.isArray(mangaList) || mangaList.length === 0) && seriesMatch) {
        const potentialAliases = [
          seriesMatch.canonical,
          ...seriesMatch.en,
          ...seriesMatch.ar,
          ...(seriesMatch.ko || []),
          ...(seriesMatch.ja || []),
          ...(seriesMatch.zh || [])
        ].filter(a => a.toLowerCase() !== qLower);
        for (const alias of potentialAliases.slice(0, 2)) {
          try {
            const aliasData = await executeSuwayomiGraphQL(suwayomiUrl, gqlQuery, {
              source: rawSourceId,
              query: alias,
              page
            });
            const aliasMangas = aliasData?.fetchSourceManga?.mangas;
            if (Array.isArray(aliasMangas) && aliasMangas.length > 0) {
              mangaList = aliasMangas;
              break;
            }
          } catch {}
        }
      }
      if (Array.isArray(mangaList)) {
        const results = mangaList.map((m: any) => ({
          id: `suwayomi_${m.id}`,
          rawId: String(m.id),
          title: m.title,
          coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
          author: m.author || "Unknown",
          artist: m.artist || "",
          status: m.status || "Unknown",
          description: m.description || "",
          sourceId: `suwayomi_${rawSourceId}`,
          provider: "suwayomi"
        }));

        return res.json({
          results,
          hasNextPage: Boolean(gqlData.fetchSourceManga?.hasNextPage)
        });
      }
    } catch (gqlErr: any) {
      console.warn("[Suwayomi] GraphQL search notice:", gqlErr.message);
    }

    // 2. Fallback to REST v1 search
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const searchUrl = `${suwayomiUrl}/api/v1/source/${encodeURIComponent(rawSourceId)}/search?query=${encodeURIComponent(query)}&pageNum=${page}`;
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const mangaList = (data.mangaList || data || []).map((m: any) => ({
        id: `suwayomi_${m.id}`,
        rawId: String(m.id),
        title: m.title,
        coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
        author: m.author || "Unknown",
        artist: m.artist || "",
        status: m.status || "Unknown",
        description: m.description || "",
        sourceId: `suwayomi_${rawSourceId}`,
        provider: "suwayomi"
      }));

      return res.json({
        results: mangaList,
        hasNextPage: Boolean(data.hasNextPage)
      });
    }

    return res.status(response.status).json({ error: "Search failed on Suwayomi source" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// In-memory cache for search results to speed up repeated queries and prevent rate limits
interface SmartSearchCacheEntry {
  normalizedKey: string;
  normalizedQuery: string;
  rawQuery: string;
  lang: string;
  timestamp: number;
  expiresAt: number;
  data: {
    results: any[];
    sourcesSearched: number;
    successfulCount: number;
    timedOutCount: number;
    failedCount: number;
    successfulSources: string[];
    timedOutSources: string[];
    failedSources: string[];
    totalSources: number;
    avgLatencyMs: number;
    durationMs: number;
  };
}

const federatedSearchCache = new Map<string, SmartSearchCacheEntry>();
const SMART_CACHE_TTL_MS = 6 * 60 * 1000; // 6 minutes temporary cache
const MAX_SEARCH_CACHE_ENTRIES = 250;

export function getNormalizedSearchCacheKey(query: string, lang: string = "all"): string {
  const normQ = normalizeText(query);
  const normL = (lang || "all").toLowerCase().trim();
  return `${normL}:::${normQ}`;
}

// In-memory performance tracking metrics for all connected Suwayomi sources
interface SourceMetrics {
  totalRequests: number;
  successCount: number;
  timeoutCount: number;
  failCount: number;
  totalHits: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
}
const sourceMetricsMap = new Map<string, SourceMetrics>();

function updateSourceMetrics(sourceId: string, status: "success" | "timeout" | "fail", latencyMs: number = 0, hits: number = 0) {
  const m = sourceMetricsMap.get(sourceId) || {
    totalRequests: 0,
    successCount: 0,
    timeoutCount: 0,
    failCount: 0,
    totalHits: 0,
    lastLatencyMs: 0,
    avgLatencyMs: 0
  };
  m.totalRequests++;
  if (status === "success") {
    m.successCount++;
    m.totalHits += hits;
    m.lastLatencyMs = latencyMs;
    m.avgLatencyMs = m.avgLatencyMs === 0 ? latencyMs : Math.round((m.avgLatencyMs * 0.7) + (latencyMs * 0.3));
  } else if (status === "timeout") {
    m.timeoutCount++;
  } else {
    m.failCount++;
  }
  sourceMetricsMap.set(sourceId, m);
}

// Arabic diacritics / tashkeel regex
const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670]/g;

// Normalize text for clean comparison:
// - lowercase
// - strip Arabic tashkeel/diacritics
// Helper to clean messy aggregator titles that dump multiple aliases e.g. "Title (Alt1 / Alt2 / ...)"
export function cleanMangaTitle(title: string): string {
  if (!title) return "";
  let clean = title.trim();
  // Strip trailing or enclosed alternate title dumps e.g. "Title (Alt1/Alt2...)"
  const parenIdx = clean.indexOf("(");
  if (parenIdx > 2 && (clean.includes("/") || clean.includes("،") || clean.includes(";"))) {
    clean = clean.substring(0, parenIdx).trim();
  }
  // Strip trailing slashes with alternate titles e.g. "Title / Alt1 / Alt2"
  if (clean.includes(" / ")) {
    const firstPart = clean.split(" / ")[0].trim();
    if (firstPart.length > 2) clean = firstPart;
  }
  clean = clean.replace(/[\u2018\u2019`´]/g, "'").replace(/[\u201C\u201D]/g, '"');
  return clean.trim();
}

// - unify Arabic alefs (إأآٱ -> ا), ta-marbuta (ة -> ه), ya (ى -> ي)
// - strip all punctuation, hyphens, curly apostrophes/quotes, brackets
// - collapse multiple spaces
export function normalizeText(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(ARABIC_DIACRITICS_REGEX, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u2018\u2019\u201A\u201B\u02BB\u02BC\u02BD\x27\x60\xB4\u201C\u201D\x22\u00AB\u00BB\u2010\u2011\u2012\u2013\u2014\u2015\u2212\-_.:,;!?~@#$%^&*()[\]{}|\\\/<>+=・〜…、。！？（）「」『』【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Levenshtein distance for limited fuzzy typo comparison (Level 5)
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) d[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = d[j];
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[j] = Math.min(
        d[j] + 1,
        d[j - 1] + 1,
        prev + cost
      );
      prev = temp;
    }
  }
  return d[n];
}

// Secondary / Spin-off / Derivative indicators
const SUB_WORK_INDICATORS = [
  "ragnarok", "arise", "side story", "sidestory", "gaiden", "spin off", "spinoff",
  "after story", "special", "extra", "sequel", "prequel", "anthology",
  "fan art", "fanart", "guide", "guidebook", "artbook", "tribute", "parody",
  "novel", "light novel", "webnovel", "raw", "colored", "official",
  "قصة جانبية", "راغناروك", "أرايز", "دليل", "رواية", "خاص"
];

const JUNK_INDICATORS = ["fan art", "fanart", "guide", "guidebook", "artbook", "tribute", "parody", "دليل"];

// Detect whether a candidate title is a sub-work/spin-off/guide relative to the user query
function detectSubWork(normTitle: string, normQuery: string): { isSub: boolean; isJunk: boolean } {
  let isSub = false;
  let isJunk = false;

  for (const ind of SUB_WORK_INDICATORS) {
    if (normTitle.includes(ind) && !normQuery.includes(ind)) {
      isSub = true;
      if (JUNK_INDICATORS.includes(ind)) {
        isJunk = true;
      }
    }
  }

  // Also check if title is a subtitle of the main work when query didn't specify one
  if (!isSub && normTitle.startsWith(normQuery + " ") && (normTitle.length - normQuery.length) > 5) {
    isSub = true;
  }

  return { isSub, isJunk };
}

// Multilingual Canonical Series Database (Verified titles across Arabic, English, Korean, Japanese, Chinese)
interface CanonicalSeries {
  canonical: string;
  ar: string[];
  en: string[];
  ko?: string[];
  ja?: string[];
  zh?: string[];
}

const MULTILINGUAL_SERIES_DB: CanonicalSeries[] = [
  {
    canonical: "One Piece",
    ar: ["ون بيس", "قطعة واحدة"],
    en: ["One Piece", "OnePiece"],
    ja: ["ワンピース", "Wan Pisu"]
  },
  {
    canonical: "Solo Leveling",
    ar: ["سولو ليفلينج", "أنا وحدي أرفع مستواي"],
    en: ["Solo Leveling", "Only I Level Up", "Na Honjaman Level Up"],
    ko: ["나 혼자만 레벨업"]
  },
  {
    canonical: "Magic Emperor",
    ar: ["الإمبراطور الساحر", "خادم الشيطان", "ديمونيك امبيرور"],
    en: ["Demonic Emperor", "Magic Emperor", "The Devil Butler", "The Steward Demonic Emperor"],
    zh: ["魔皇大管家", "Mo Huang Da Guan Jia"]
  },
  {
    canonical: "Return of the Mount Hua Sect",
    ar: ["عودة طائفة هواشان", "طائفة هواشان", "جبل هوا"],
    en: ["Return of the Mount Hua Sect", "Mount Hua Sect", "Return of the Blossoming Blade", "Mount Hua"],
    ko: ["화산귀환"]
  },
  {
    canonical: "Nano Machine",
    ar: ["نانو ماشين"],
    en: ["Nano Machine", "Nano Mashin"],
    ko: ["나노마신"]
  },
  {
    canonical: "Demon Slayer",
    ar: ["قاتل الشياطين"],
    en: ["Demon Slayer", "Kimetsu no Yaiba"],
    ja: ["鬼滅の刃"]
  },
  {
    canonical: "Attack on Titan",
    ar: ["هجوم العمالقة"],
    en: ["Attack on Titan", "Shingeki no Kyojin"],
    ja: ["進撃の巨人"]
  },
  {
    canonical: "Jujutsu Kaisen",
    ar: ["جوجيتسو كايسن"],
    en: ["Jujutsu Kaisen", "Sorcery Fight"],
    ja: ["呪術廻戦"]
  },
  {
    canonical: "Berserk",
    ar: ["بيرسيرك"],
    en: ["Berserk"],
    ja: ["ベルセルク"]
  },
  {
    canonical: "Bleach",
    ar: ["بليتش"],
    en: ["Bleach"],
    ja: ["ブリーチ"]
  },
  {
    canonical: "Naruto",
    ar: ["ناروتو"],
    en: ["Naruto"],
    ja: ["ナルト"]
  },
  {
    canonical: "Hunter x Hunter",
    ar: ["هنتر x هنتر", "القناص"],
    en: ["Hunter x Hunter", "Hunter X Hunter"],
    ja: ["ハンター×ハンター"]
  },
  {
    canonical: "Chainsaw Man",
    ar: ["رجل المنشار"],
    en: ["Chainsaw Man"],
    ja: ["チェンソーマン"]
  },
  {
    canonical: "Martial Peak",
    ar: ["قمة فنون الدفاع عن النفس"],
    en: ["Martial Peak"],
    zh: ["武炼巅峰", "Wu Lian Dian Feng"]
  },
  {
    canonical: "Apotheosis",
    ar: ["تأليه"],
    en: ["Apotheosis"],
    zh: ["百炼成神", "Bai Lian Cheng Shen"]
  },
  {
    canonical: "Omniscient Reader",
    ar: ["وجهة نظر القارئ العليم"],
    en: ["Omniscient Reader", "Omniscient Reader's Viewpoint", "ORV"],
    ko: ["전지적 독자 시점"]
  },
  {
    canonical: "The Beginning After The End",
    ar: ["البداية بعد النهاية"],
    en: ["The Beginning After The End", "TBATE"]
  },
  {
    canonical: "Lookism",
    ar: ["المظهرية"],
    en: ["Lookism"],
    ko: ["외모지상주의"]
  },
  {
    canonical: "Tower of God",
    ar: ["برج الإله"],
    en: ["Tower of God"],
    ko: ["신의 탑"]
  },
  {
    canonical: "Eleceed",
    ar: ["إليسيد"],
    en: ["Eleceed"],
    ko: ["일렉시드"]
  },
  {
    canonical: "Mercenary Enrollment",
    ar: ["تسجيل المرتزقة"],
    en: ["Mercenary Enrollment", "Teenage Mercenary"],
    ko: ["입학용병"]
  },
  {
    canonical: "The Greatest Estate Developer",
    ar: ["أعظم مطور عقاري"],
    en: ["The Greatest Estate Developer"],
    ko: ["역대급 영지 설계사"]
  },
  {
    canonical: "Damn Reincarnation",
    ar: ["اللعنة التناسخية"],
    en: ["Damn Reincarnation"],
    ko: ["빌어먹을 환생"]
  },
  {
    canonical: "SSS-Class Suicide Hunter",
    ar: ["صياد الانتحار رتبة SSS"],
    en: ["SSS-Class Suicide Hunter", "SSS-Class Revival Hunter"],
    ko: ["SSS급 죽어야 사는 헌터"]
  },
  {
    canonical: "Wail of a Dragon's Rage",
    ar: ["صراخ غضب التنين", "عويل غضب التنين", "عويل التنين", "عويل الضعف", "رمز التنين الهادر"],
    en: [
      "Wail of a Dragon's Rage",
      "Wail of a Dragon’s Rage",
      "Wail of Weakness",
      "The Roaring Dragon's Emblem",
      "The Roaring Dragon’s Emblem",
      "The Wailing Perversion",
      "Howling Dragon"
    ],
    ko: ["울부짖는 역린", "Ulbujijneun Yeongrin"]
  }
];

// Helper to look up canonical series from any multilingual representation
function findSeriesForQuery(queryText: string): CanonicalSeries | null {
  if (!queryText) return null;
  const q = queryText.toLowerCase().trim();
  const qNorm = normalizeText(queryText);

  for (const s of MULTILINGUAL_SERIES_DB) {
    if (s.canonical.toLowerCase() === q || normalizeText(s.canonical) === qNorm) return s;
    const all = [
      ...s.ar,
      ...s.en,
      ...(s.ko || []),
      ...(s.ja || []),
      ...(s.zh || [])
    ];
    for (const title of all) {
      const t = title.toLowerCase().trim();
      const tNorm = normalizeText(title);
      if (t === q || tNorm === qNorm) return s;
      if (tNorm.length > 3 && (qNorm === tNorm || qNorm.includes(tNorm) || tNorm.includes(qNorm))) {
        // If either contains the other, verify token overlap is substantial
        const qW = qNorm.split(" ").filter(w => w.length > 1);
        const tW = tNorm.split(" ").filter(w => w.length > 1);
        if (qW.length >= 2 && tW.length >= 2) {
          const common = qW.filter(w => tW.includes(w));
          if (common.length >= Math.min(qW.length, tW.length)) {
            return s;
          }
        } else if (qW.length === 1 && tW.length === 1 && qW[0] === tW[0]) {
          return s;
        }
      }
    }
  }
  return null;
}

// Canonical title helper
function getCanonicalTitle(rawTitle: string): string {
  if (!rawTitle) return "";
  const series = findSeriesForQuery(rawTitle);
  if (series) return series.canonical;
  return rawTitle.replace(/\s*[\(\[](official|unoriginal|colored|novel|manhuaplus|raw)[\)\]]/gi, "").trim();
}

// Stop words to exclude from partial word matching count
const STOP_WORDS = new Set(["the", "of", "in", "a", "an", "and", "to", "for", "on", "with", "s", "من", "في", "على", "إلى", "و", "عن"]);

export interface RelevanceScoringContext {
  sourceItemIndex?: number;
  sourceLang?: string;
  hasCover?: boolean;
  hasAuthor?: boolean;
  hasDescription?: boolean;
  sourceReliabilityBonus?: number;
  altTitles?: string[];
}

// 5-Level Fuzzy & Semantic Scoring Engine:
// Level 1: Exact Match (26,000+) - exact string match ignoring only outer whitespace & lowercasing
// Level 2: Alternative Title Match (20,500 - 21,000) - verified canonical aliases in MULTILINGUAL_SERIES_DB
// Level 3: Normalized Match (19,000) - case, punctuation, tashkeel, alef/ta-marbuta stripped
// Level 4: Partial Match (12,000 - 16,000) - contiguous phrase contained in or starting title
// Level 5: Token Overlap & Fuzzy Levenshtein Match (3,200 - 9,500)
// Rule: Multi-word query (e.g. "Solo Leveling") must NEVER give high scores to single-word matches (e.g. only "Solo" or only "Leveling")!
// Rule: Sub-works/spin-offs (e.g. "Solo Leveling: Ragnarok") must be demoted below the main work without being removed!
export function calculateRelevanceScore(title: string, rawQuery: string, context?: RelevanceScoringContext): number {
  if (!title || !rawQuery) return -10000;

  // If alternate titles or cleaned title exist, evaluate them to find the strongest match
  const cleaned = cleanMangaTitle(title);
  if (cleaned && cleaned !== title) {
    const cleanedScore = calculateRelevanceScore(cleaned, rawQuery, { ...context, altTitles: undefined });
    const rawScore = calculateRelevanceScoreInternal(title, rawQuery, context);
    let bestScore = Math.max(rawScore, cleanedScore);
    if (context?.altTitles && context.altTitles.length > 0) {
      for (const alt of context.altTitles) {
        if (!alt || alt === title) continue;
        const aScore = calculateRelevanceScore(alt, rawQuery, { ...context, altTitles: undefined });
        if (aScore > bestScore) {
          bestScore = Math.max(bestScore, aScore - 200);
        }
      }
    }
    return bestScore;
  }

  if (context?.altTitles && context.altTitles.length > 0) {
    let bestScore = calculateRelevanceScoreInternal(title, rawQuery, context);
    for (const alt of context.altTitles) {
      if (!alt || alt === title) continue;
      const aScore = calculateRelevanceScore(alt, rawQuery, { ...context, altTitles: undefined });
      if (aScore > bestScore) {
        bestScore = Math.max(bestScore, aScore - 200);
      }
    }
    return bestScore;
  }

  return calculateRelevanceScoreInternal(title, rawQuery, context);
}

function calculateRelevanceScoreInternal(title: string, rawQuery: string, context?: RelevanceScoringContext): number {
  if (!title || !rawQuery) return -10000;

  const tRaw = title.trim().toLowerCase();
  const qRaw = rawQuery.trim().toLowerCase();
  const tNorm = normalizeText(title);
  const qNorm = normalizeText(rawQuery);

  let baseScore = -10000;
  let matchLevel = 5;

  // Level 1: Exact Match (Highest Priority)
  if (tRaw === qRaw) {
    baseScore = 26000;
    matchLevel = 1;
  }
  // Level 2: Alternative Title Match via Multilingual DB
  else {
    const seriesQuery = findSeriesForQuery(rawQuery);
    const seriesTitle = findSeriesForQuery(title);
    if (seriesQuery && seriesTitle && seriesQuery.canonical === seriesTitle.canonical) {
      baseScore = 21000;
      matchLevel = 2;
    } else if (seriesQuery) {
      const allAliases = [
        ...seriesQuery.ar,
        ...seriesQuery.en,
        ...(seriesQuery.ko || []),
        ...(seriesQuery.ja || []),
        ...(seriesQuery.zh || [])
      ].map(a => normalizeText(a));
      if (allAliases.includes(tNorm)) {
        baseScore = 20500;
        matchLevel = 2;
      }
    }
  }

  // Level 3: Normalized Match (Ignore case, spaces, dashes, punctuation, tashkeel, hamzas)
  if (baseScore < 19000 && tNorm === qNorm) {
    baseScore = 19000;
    matchLevel = 3;
  }

  // Level 4: Partial Match (Contiguous phrase contained in title)
  if (baseScore < 12000 && (tNorm.includes(qNorm) || qNorm.includes(tNorm))) {
    const lengthRatio = qNorm.length / Math.max(1, tNorm.length);
    if (tNorm.startsWith(qNorm)) {
      baseScore = 14500 + Math.round(lengthRatio * 1500);
      matchLevel = 4;
    } else {
      baseScore = 12000 + Math.round(lengthRatio * 1200);
      matchLevel = 4;
    }
  }

  // Level 5: Token Overlap & Limited Fuzzy Match
  const qWords = qNorm.split(" ").filter(w => w.length > 0 && !STOP_WORDS.has(w));
  const tWordsList = tNorm.split(" ").filter(w => w.length > 0 && !STOP_WORDS.has(w));
  const tWords = new Set(tWordsList);

  const matchedWords = qWords.filter(w => tWords.has(w));
  const matchRatio = qWords.length > 0 ? (matchedWords.length / qWords.length) : 0;

  if (baseScore < 9500 && qWords.length > 0) {
    if (qWords.length >= 2) {
      if (matchedWords.length === qWords.length) {
        // All meaningful words from query matched inside the title
        baseScore = 9500;
        matchLevel = 5;
      } else if (matchedWords.length >= 2 && matchRatio >= 0.66) {
        baseScore = 5500 + Math.round(matchRatio * 1500);
        matchLevel = 5;
      } else {
        // Multi-word query, but only 1 word matched (e.g. only "Solo" or only "Leveling")!
        // Strictly reject as requested: "ولا يجب إعطاء نتيجة درجة عالية لمجرد أنها تحتوي على كلمة واحدة مشتركة"
        return -9000;
      }
    } else {
      // Single word query (e.g. "Bleach", "Berserk")
      const qw = qWords[0];
      if (tWords.has(qw)) {
        baseScore = 7500;
        matchLevel = 5;
      } else if (tNorm.includes(qw)) {
        baseScore = 4000;
        matchLevel = 5;
      } else if (qw.length >= 4) {
        // Check limited typo tolerance (Levenshtein distance <= 1)
        let minD = 999;
        for (const tw of tWordsList) {
          if (Math.abs(tw.length - qw.length) <= 1) {
            const d = levenshteinDistance(qw, tw);
            if (d < minD) minD = d;
          }
        }
        if (minD <= 1) {
          baseScore = 3200;
          matchLevel = 5;
        } else {
          return -9000;
        }
      } else {
        return -9000;
      }
    }
  }

  // Dynamic Multi-Factor Modifiers:
  let finalScore = baseScore;

  // Factor 1: Word match ratio bonus
  finalScore += Math.round(matchRatio * 800);

  // Factor 2: Title cleanliness penalty for superfluous words
  const extraWords = Math.max(0, tWordsList.length - qWords.length);
  finalScore -= Math.min(2000, extraWords * 100);

  // Factor 3: Main work vs Sub-work / spin-off (Requirement 5)
  const subCheck = detectSubWork(tNorm, qNorm);
  if (subCheck.isJunk) {
    finalScore -= 7000; // Fan art, guide, etc. (demoted, not deleted)
  } else if (subCheck.isSub) {
    finalScore -= 4500; // Spin-off / secondary work
  } else if (matchLevel <= 3) {
    finalScore += 1200; // Direct main work bonus
  }

  // Factor 4: Source's own ranking order (earlier result from extension gets bonus)
  if (context?.sourceItemIndex !== undefined) {
    finalScore += Math.max(0, 800 - context.sourceItemIndex * 50);
  }

  // Factor 5: Language alignment
  const isArabicQuery = /[\u0600-\u06FF]/.test(rawQuery);
  if (isArabicQuery && context?.sourceLang === "ar") {
    finalScore += 800;
  } else if (!isArabicQuery && (context?.sourceLang === "en" || context?.sourceLang === "all")) {
    finalScore += 500;
  }

  // Factor 6: Data quality factors
  if (context?.hasCover) finalScore += 400;
  if (context?.hasAuthor) finalScore += 250;
  if (context?.hasDescription) finalScore += 250;

  // Factor 7: Source reliability
  if (context?.sourceReliabilityBonus) {
    finalScore += context.sourceReliabilityBonus;
  }

  return finalScore;
}

// Compute intelligent priority score for ordering sources in the queue
function computeSourcePriority(source: any, targetLang: string, query: string): number {
  let score = 100;
  const name = (source.name || "").toLowerCase();
  const lang = (source.lang || "").toLowerCase();

  // 1. Language alignment
  const isArabicQuery = /[\u0600-\u06FF]/.test(query);
  if (targetLang === "ar" || isArabicQuery) {
    if (lang === "ar") score += 8000;
  }
  if (targetLang === "en" || /^[a-zA-Z0-9\s\-':,]+$/.test(query)) {
    if (lang === "en") score += 3000;
  }
  if (lang === "all") score += 2500;

  // 2. High-reputation / popular responsive extensions
  const topTier = [
    "mangadex", "manga ball", "azora", "comick", "flame", "asura",
    "mangaswat", "mangalabs", "mangalionz", "dilar", "despair", "xcomic",
    "mangapark", "manganato", "mangakakalot", "reaper", "manhuaplus",
    "webtoons", "mangafire", "bato", "mangapill", "mangahere", "mangaspark",
    "manga starz", "kawii manga", "hentaiman", "topmanhua", "toonily", "arbxcomix"
  ];
  if (topTier.some(t => name.includes(t))) {
    score += 15000;
  }

  // 3. Historical performance metrics from in-memory cache
  const metrics = sourceMetricsMap.get(String(source.id));
  if (metrics) {
    if (metrics.successCount > 0) {
      score += Math.min(metrics.successCount * 150, 4000);
      score += Math.min(metrics.totalHits * 200, 6000);
    }
    if (metrics.avgLatencyMs > 0) {
      score += Math.max(0, 3000 - metrics.avgLatencyMs);
    }
    if (metrics.timeoutCount > 2 && metrics.successCount === 0) {
      score -= 4000; // Demote consistently unresponsive sources
    }
  }

  return score;
}

// Helper to get smart multilingual search queries based on source language
export function getTargetQueriesForSource(query: string, sourceLang: string): string[] {
  const qClean = query.trim();
  const series = findSeriesForQuery(qClean);

  // If the work is NOT known in MULTILINGUAL_SERIES_DB:
  // Strictly do NOT invent translations or make up titles.
  // Use the exact user query directly across all sources!
  if (!series) {
    return [qClean];
  }

  const queries: string[] = [];
  const sLang = (sourceLang || "").toLowerCase();

  if (sLang === "ar") {
    for (const a of series.ar) if (!queries.includes(a)) queries.push(a);
    for (const e of series.en) if (!queries.includes(e)) queries.push(e);
  } else if (sLang === "ko") {
    if (series.ko) for (const k of series.ko) if (!queries.includes(k)) queries.push(k);
    for (const e of series.en) if (!queries.includes(e)) queries.push(e);
  } else if (sLang === "ja") {
    if (series.ja) for (const j of series.ja) if (!queries.includes(j)) queries.push(j);
    for (const e of series.en) if (!queries.includes(e)) queries.push(e);
  } else if (sLang === "zh") {
    if (series.zh) for (const z of series.zh) if (!queries.includes(z)) queries.push(z);
    for (const e of series.en) if (!queries.includes(e)) queries.push(e);
  } else {
    // English or "all"
    for (const e of series.en) if (!queries.includes(e)) queries.push(e);
    for (const a of series.ar) if (!queries.includes(a)) queries.push(a);
  }

  if (!queries.includes(qClean)) {
    queries.push(qClean);
  }

  return queries;
}

// Cache for manga chapter counts to avoid re-fetching
export const mangaChapterCountCache = new Map<string, number>();

// Native multi-source search providers for instant ultra-fast response with chapter counts
async function searchFastNativeProviders(
  query: string,
  lang: string,
  onResult?: (source: any, mangas: any[]) => void
): Promise<any[]> {
  const nativeResults: any[] = [];
  const promises: Promise<void>[] = [];

  const cleanQuery = query.replace(/[\u2018\u2019`´]/g, "'").trim();

  // 1. 3asq (Arabic - with accurate chapter count)
  if (lang === "all" || lang === "ar") {
    promises.push((async () => {
      try {
        const queries3asq = [cleanQuery];
        const seriesLookup = findSeriesForQuery(cleanQuery);
        if (seriesLookup && seriesLookup.ar.length > 0) {
          for (const arTitle of seriesLookup.ar) {
            if (!queries3asq.includes(arTitle)) queries3asq.push(arTitle);
          }
        }

        for (const q3 of queries3asq) {
          const searchUrl = `https://3asq.online/?s=${encodeURIComponent(q3)}&post_type=wp-manga`;
          const res = await fetch(searchUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            signal: AbortSignal.timeout(8000)
          });
          if (res.ok) {
            const text = await res.text();
            const parts = text.split(/class="[^"]*c-tabs-item[^"]*"/).slice(1);
            const mangas: any[] = [];
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
                  const rawTitle = linkMatch[2].replace(/&#8211;/g, '-').replace(/&amp;/g, '&').trim();
                  const cleanedTitle = cleanMangaTitle(rawTitle);

                  const key = `3asq_${slug}`;
                  if (chaptersCount > 0) mangaChapterCountCache.set(key, chaptersCount);

                  const score = calculateRelevanceScore(rawTitle, query, {
                    sourceLang: "ar",
                    hasCover: Boolean(imgMatch),
                    sourceReliabilityBonus: 1000
                  });

                  if (score > -5000) {
                    const item = {
                      id: key,
                      rawId: slug,
                      title: cleanedTitle,
                      rawTitle,
                      coverUrl: imgMatch?.[1]?.trim() || "",
                      author: "عاشق المانجا",
                      status,
                      description: "مانجا مترجمة للعربية من شبكة عاشق المانجا",
                      sourceId: "3asq",
                      sourceRawId: "3asq",
                      sourceName: "العاشق (3asq)",
                      sourceLanguage: "ar",
                      language: "ar",
                      provider: "3asq",
                      chaptersCount,
                      latestChapter: rawChapter ? `الفصل ${rawChapter}` : undefined,
                      relevanceScore: score + chaptersCount
                    };
                    mangas.push(item);
                  }
                }
              }
            }

            if (mangas.length > 0) {
              nativeResults.push(...mangas);
              if (onResult) {
                onResult({ id: "3asq", name: "العاشق (3asq)", lang: "ar" }, mangas);
              }
              break; // Got results for 3asq, no need for next query variant
            }
          }
        }
      } catch {}
    })());
  }

  // 2. MangaDex (Worldwide Multi-language)
  promises.push((async () => {
    try {
      const titleParam = `title=${encodeURIComponent(cleanQuery)}&`;
      const url = `https://api.mangadex.org/manga?${titleParam}limit=15&includes[]=cover_art&includes[]=author`;
      const res = await fetch(url, {
        headers: { "User-Agent": "MangaReaderApp/1.0" },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        const list = data?.data || [];
        const mangas = list.map((m: any) => {
          const rawTitle = m.attributes?.title?.en || Object.values(m.attributes?.title || {})[0] || "";
          const altTitlesList: string[] = (m.attributes?.altTitles || [])
            .map((obj: any) => Object.values(obj)[0])
            .filter(Boolean) as string[];

          const lastCh = m.attributes?.lastChapter;
          const parsed = parseFloat(String(lastCh || ""));
          const chCount = !isNaN(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
          const coverRel = m.relationships?.find((r: any) => r.type === "cover_art");
          const coverFile = coverRel?.attributes?.fileName;
          const coverUrl = coverFile ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.256.jpg` : "";

          const key = `mangadex_${m.id}`;
          if (chCount > 0) mangaChapterCountCache.set(key, chCount);

          const score = calculateRelevanceScore(rawTitle, query, {
            sourceLang: "all",
            hasCover: Boolean(coverUrl),
            altTitles: altTitlesList,
            sourceReliabilityBonus: 800
          });

          return {
            id: key,
            rawId: m.id,
            title: cleanMangaTitle(rawTitle),
            rawTitle,
            coverUrl,
            author: "MangaDex",
            status: m.attributes?.status === "completed" ? "مكتملة" : "مستمرة",
            description: m.attributes?.description?.en || "",
            sourceId: "consumet_mangadex",
            sourceRawId: "mangadex",
            sourceName: "MangaDex (عالمي)",
            sourceLanguage: "all",
            language: "all",
            provider: "mangadex",
            chaptersCount: chCount,
            latestChapter: lastCh ? `الفصل ${lastCh}` : undefined,
            relevanceScore: score
          };
        }).filter((m: any) => m.title && m.relevanceScore > -5000);

        if (mangas.length > 0) {
          nativeResults.push(...mangas);
          if (onResult) {
            onResult({ id: "consumet_mangadex", name: "MangaDex (عالمي)", lang: "all" }, mangas);
          }
        }
      }
    } catch {}
  })());

  // 3. WeebCentral (Direct fast crawler supporting special titles and full scan)
  promises.push((async () => {
    try {
      const variants = [cleanQuery];
      if (cleanQuery.includes("'")) variants.push(cleanQuery.replace(/'/g, "’"));
      if (cleanQuery.includes("’")) variants.push(cleanQuery.replace(/’/g, "'"));
      const aposIdx = Math.max(cleanQuery.indexOf("'"), cleanQuery.indexOf("’"));
      if (aposIdx > 3) {
        variants.push(cleanQuery.substring(0, aposIdx).trim());
      }

      const seen = new Set<string>();
      const weebMangas: any[] = [];

      for (const q of variants) {
        try {
          const url = `https://weebcentral.com/search/data?limit=24&offset=0&text=${encodeURIComponent(q)}&sort=Best+Match&order=Descending&official=Any&anime=Any&adult=Any&display_mode=Full+Display`;
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "HX-Request": "true"
            },
            signal: AbortSignal.timeout(8500)
          });
          if (!res.ok) continue;

          const html = await res.text();
          const articles = html.split(/<article class="bg-base-300[^"]*"/).slice(1);

          for (const art of articles) {
            const linkMatch = art.match(/href="https:\/\/weebcentral\.com\/series\/([^"]+)"[^>]*>([^<]+)<\/a>/);
            const imgMatch = art.match(/<img[^>]+(?:data-src|src)="([^"]+)"/);

            if (linkMatch) {
              const rawId = linkMatch[1];
              const rawTitle = linkMatch[2].trim();
              if (!seen.has(rawId)) {
                seen.add(rawId);
                const score = calculateRelevanceScore(rawTitle, query, {
                  sourceLang: "en",
                  hasCover: Boolean(imgMatch),
                  sourceReliabilityBonus: 1000
                });

                if (score > -5000) {
                  // Attempt quick chapter count for high relevance match
                  let chaptersCount = 0;
                  const seriesId = rawId.split("/")[0];
                  const cachedCount = mangaChapterCountCache.get(`weebcentral_${rawId}`);
                  if (cachedCount !== undefined) {
                    chaptersCount = cachedCount;
                  } else if (score >= 18000) {
                    // Pre-fetch chapter count so it displays accurately right away
                    try {
                      const chListRes = await fetch(`https://weebcentral.com/series/${seriesId}/full-chapter-list`, {
                        headers: {
                          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                          "HX-Request": "true"
                        },
                        signal: AbortSignal.timeout(3000)
                      });
                      if (chListRes.ok) {
                        const chHtml = await chListRes.text();
                        const chMatches = [...chHtml.matchAll(/href="[^"]*\/chapters\/([^"]+)"/g)];
                        chaptersCount = chMatches.length;
                        mangaChapterCountCache.set(`weebcentral_${rawId}`, chaptersCount);
                      }
                    } catch {}
                  }

                  weebMangas.push({
                    id: `weebcentral_${rawId}`,
                    rawId,
                    title: cleanMangaTitle(rawTitle),
                    rawTitle,
                    coverUrl: imgMatch ? imgMatch[1] : "",
                    author: "WeebCentral",
                    status: "مستمرة",
                    description: "",
                    sourceId: "consumet_weebcentral",
                    sourceRawId: "weebcentral",
                    sourceName: "WeebCentral",
                    sourceLanguage: "en",
                    language: "en",
                    provider: "weebcentral",
                    chaptersCount,
                    relevanceScore: score
                  });
                }
              }
            }
          }

          if (weebMangas.length > 0) break; // Found matches with this variant!
        } catch {}
      }

      if (weebMangas.length > 0) {
        nativeResults.push(...weebMangas);
        if (onResult) {
          onResult({ id: "consumet_weebcentral", name: "WeebCentral", lang: "en" }, weebMangas);
        }
      }
    } catch {}
  })());

  // 4. ComicK (Global extensive aggregator)
  promises.push((async () => {
    try {
      const { MANGA } = await import("@consumet/extensions");
      if ((MANGA as any)?.ComicK) {
        const comick = new (MANGA as any).ComicK();
        const res = await comick.search(cleanQuery, 1).catch(() => ({ results: [] }));
        const list = (res?.results || []).slice(0, 15);
        const mangas = list.map((m: any) => {
          const rawTitle = m.title || "";
          const score = calculateRelevanceScore(rawTitle, query, {
            sourceLang: "all",
            sourceReliabilityBonus: 700
          });
          return {
            id: `comick_${m.id}`,
            rawId: m.id,
            title: cleanMangaTitle(rawTitle),
            rawTitle,
            coverUrl: m.image || "",
            author: "ComicK",
            status: "مستمرة",
            description: "",
            sourceId: "consumet_comick",
            sourceRawId: "comick",
            sourceName: "ComicK",
            sourceLanguage: "all",
            language: "all",
            provider: "comick",
            chaptersCount: 0,
            relevanceScore: score
          };
        }).filter((m: any) => m.title && m.relevanceScore > -5000);

        if (mangas.length > 0) {
          nativeResults.push(...mangas);
          if (onResult) {
            onResult({ id: "consumet_comick", name: "ComicK", lang: "all" }, mangas);
          }
        }
      }
    } catch {}
  })());

  await Promise.allSettled(promises);
  return nativeResults;
}

// Federated Multi-Source Search helper that searches ALL available sources with a Concurrency Worker Pool
export async function executeFederatedSearchAcrossSources(
  suwayomiUrl: string,
  rawQuery: string,
  options: {
    lang?: string;
    sourcesFilter?: string[];
    onSourceResult?: (source: any, mangas: any[]) => void;
    onProgress?: (data: {
      completed: number;
      total: number;
      currentSource: string;
      foundCount: number;
      successfulCount: number;
      timedOutCount: number;
      failedCount: number;
    }) => void;
  } = {}
) {
  const query = rawQuery.trim();
  if (!query) {
    return {
      results: [],
      sourcesSearched: 0,
      successfulCount: 0,
      timedOutCount: 0,
      failedCount: 0,
      successfulSources: [],
      timedOutSources: [],
      failedSources: [],
      totalSources: 0,
      avgLatencyMs: 0,
      durationMs: 0
    };
  }

  const startTime = Date.now();
  const allFoundResults: any[] = [];
  const seenGlobalKeys = new Set<string>(); // Dedup by sourceId + mangaId
  const successfulSources: string[] = [];
  const timedOutSources: string[] = [];
  const failedSources: string[] = [];
  let totalLatencyAccumulator = 0;
  let latencyMeasurementsCount = 0;

  // 1. Kick off fast native multi-source search in background immediately!
  const targetLang = (options.lang || "all").toLowerCase().trim();
  const nativeSearchPromise = searchFastNativeProviders(query, targetLang, (src, mangas) => {
    for (const m of mangas) {
      const gKey = `${m.sourceRawId}::${m.rawId}`;
      if (!seenGlobalKeys.has(gKey)) {
        seenGlobalKeys.add(gKey);
        allFoundResults.push(m);
      }
    }
    if (options.onSourceResult && mangas.length > 0) {
      options.onSourceResult(src, mangas);
    }
  });

  // 2. Fetch available sources from Suwayomi safely
  let allSources: any[] = [];
  try {
    const sourcesRes = await fetch(`${suwayomiUrl}/api/v1/source/list`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000)
    });
    if (sourcesRes.ok) {
      allSources = await sourcesRes.json();
    }
  } catch (err: any) {
    console.warn("[Suwayomi Federated Search] Note on fetching sources list:", err.message);
  }

  // 3. Filter out explicit adult / junk sources
  const blacklistedKeywords = [
    "comic fury", "akuma", "3hentai", "allporncomics", "hentaicosplay", 
    "hentaimanga", "pornhwa", "nhentai", "hitomi", "doujin", "8muses",
    "hentaihand", "anyone manga", "هنتاي", "sex"
  ];

  const validSources = allSources.filter(s => {
    if (!s.id || s.id === "0" || s.isLocal) return false;
    const n = (s.name || "").toLowerCase();
    return !blacklistedKeywords.some(b => n.includes(b));
  });

  // 4. Target sources selection:
  let targetSources: any[] = [];

  if (options.sourcesFilter && options.sourcesFilter.length > 0) {
    const filterSet = new Set(options.sourcesFilter.map(id => String(id).replace(/^suwayomi_/, "")));
    targetSources = validSources.filter(s => filterSet.has(String(s.id)));
  } else if (targetLang === "ar") {
    targetSources = validSources.filter(s => (s.lang || "").toLowerCase() === "ar");
  } else if (targetLang === "en") {
    targetSources = validSources.filter(s => {
      const l = (s.lang || "").toLowerCase();
      return l === "en" || l === "all";
    });
  } else {
    // "all": Target valid sources, prioritising top active sources
    targetSources = [...validSources];
  }

  // Merge any user-added custom sources into targetSources so they are automatically searched!
  for (const custom of customSourcesList) {
    const customMatchLang = targetLang === "all" || !custom.lang || custom.lang === "all" || custom.lang.toLowerCase() === targetLang;
    if (customMatchLang && !targetSources.some(s => String(s.id) === custom.rawId || s.id === custom.id)) {
      targetSources.unshift({
        id: custom.rawId,
        name: custom.name,
        displayName: custom.displayName,
        lang: custom.lang,
        baseUrl: custom.baseUrl,
        isCustom: true
      });
    }
  }

  // Sort sources by intelligent priority score
  targetSources.sort((a, b) => {
    const scoreA = computeSourcePriority(a, targetLang, query);
    const scoreB = computeSourcePriority(b, targetLang, query);
    return scoreB - scoreA;
  });

  // User requirement 1: Search ALL connected sources across Suwayomi without capping at 100!
  // Concurrency worker pool handles all sources smoothly with adaptive timeout and streaming results.

  const searchGql = `
    mutation FetchSearch($source: LongString!, $query: String!, $page: Int!) {
      fetchSourceManga(input: { source: $source, type: SEARCH, query: $query, page: $page }) {
        mangas {
          id
          title
          thumbnailUrl
          artist
          author
          description
          status
        }
      }
    }
  `;

  let completedCount = 0;
  const totalCount = targetSources.length;
  let nextSourceIndex = 0;

  // Process a single source worker function
  async function processSource(src: any) {
    const srcName = src.displayName || src.name;
    const srcLang = (src.lang || "all").toLowerCase();
    const queriesToTry = getTargetQueriesForSource(query, srcLang);
    const sourceMangas: any[] = [];
    const sourceStartTime = Date.now();

    // Adaptive timeout: 15000ms for high-priority, 10000ms for standard to ensure consistent search results
    const isHighPriority = computeSourcePriority(src, targetLang, query) > 5000;
    const timeoutMs = isHighPriority ? 15000 : 10000;

    try {
      const gqlData = await executeSuwayomiGraphQL(suwayomiUrl, searchGql, {
        source: String(src.id),
        query: queriesToTry[0],
        page: 1
      }, timeoutMs);

      const latency = Date.now() - sourceStartTime;
      totalLatencyAccumulator += latency;
      latencyMeasurementsCount++;

      const mangas = gqlData?.fetchSourceManga?.mangas || [];
      const seenLocalKeys = new Set<string>();

      const metrics = sourceMetricsMap.get(String(src.id));
      let sourceReliabilityBonus = 0;
      if (metrics) {
        if (metrics.totalRequests > 2 && (metrics.successCount / metrics.totalRequests) > 0.8) {
          sourceReliabilityBonus += 300;
        }
        if (metrics.avgLatencyMs > 0 && metrics.avgLatencyMs < 2000) {
          sourceReliabilityBonus += 200;
        }
        if (metrics.timeoutCount > 2 && metrics.successCount === 0) {
          sourceReliabilityBonus -= 500;
        }
      }

      for (let i = 0; i < mangas.length; i++) {
        const m = mangas[i];
        if (!m.title) continue;
        const rawId = String(m.id);
        const localKey = `${src.id}::${rawId}`;
        if (seenLocalKeys.has(localKey)) continue;
        seenLocalKeys.add(localKey);

        const scoringContext: RelevanceScoringContext = {
          sourceItemIndex: i,
          sourceLang: srcLang,
          hasCover: Boolean(m.thumbnailUrl),
          hasAuthor: Boolean(m.author && m.author !== "Unknown"),
          hasDescription: Boolean(m.description && m.description.length > 20),
          sourceReliabilityBonus
        };

        const scoreAgainstRaw = calculateRelevanceScore(m.title, query, scoringContext);
        let relevanceScore = scoreAgainstRaw;
        if (queriesToTry[0] && queriesToTry[0] !== query) {
          const scoreAgainstAlt = calculateRelevanceScore(m.title, queriesToTry[0], scoringContext);
          if (scoreAgainstAlt > relevanceScore) {
            relevanceScore = scoreAgainstAlt;
          }
        }

        if (relevanceScore < -5000) continue; // Skip noise and false positives

        const cachedCh = mangaChapterCountCache.get(`suwayomi_${src.id}_${rawId}`) || 0;

        const item = {
          id: `suwayomi_${m.id}`,
          rawId,
          title: m.title.trim(),
          coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
          author: m.author || "Unknown",
          artist: m.artist || "",
          status: m.status || "UNKNOWN",
          description: m.description || "",
          sourceId: `suwayomi_${src.id}`,
          sourceRawId: String(src.id),
          sourceName: srcName,
          sourceLanguage: srcLang,
          language: srcLang,
          provider: "suwayomi",
          chaptersCount: cachedCh,
          relevanceScore
        };
        sourceMangas.push(item);
      }

      // If source returned 0 results and an alternate query exists, try alternate query
      if (sourceMangas.length === 0 && queriesToTry.length > 1) {
        try {
          const altGql = await executeSuwayomiGraphQL(suwayomiUrl, searchGql, {
            source: String(src.id),
            query: queriesToTry[1],
            page: 1
          }, timeoutMs);

          const altMangas = altGql?.fetchSourceManga?.mangas || [];
          for (let i = 0; i < altMangas.length; i++) {
            const m = altMangas[i];
            if (!m.title) continue;
            const rawId = String(m.id);
            const localKey = `${src.id}::${rawId}`;
            if (seenLocalKeys.has(localKey)) continue;
            seenLocalKeys.add(localKey);

            const scoringContext: RelevanceScoringContext = {
              sourceItemIndex: i,
              sourceLang: srcLang,
              hasCover: Boolean(m.thumbnailUrl),
              hasAuthor: Boolean(m.author && m.author !== "Unknown"),
              hasDescription: Boolean(m.description && m.description.length > 20),
              sourceReliabilityBonus
            };

            const scoreAgainstRaw = calculateRelevanceScore(m.title, query, scoringContext);
            let relevanceScore = scoreAgainstRaw;
            if (queriesToTry[1] && queriesToTry[1] !== query) {
              const scoreAgainstAlt = calculateRelevanceScore(m.title, queriesToTry[1], scoringContext);
              if (scoreAgainstAlt > relevanceScore) {
                relevanceScore = scoreAgainstAlt;
              }
            }

            if (relevanceScore < -5000) continue;

            const cachedCh = mangaChapterCountCache.get(`suwayomi_${src.id}_${rawId}`) || 0;

            const item = {
              id: `suwayomi_${m.id}`,
              rawId,
              title: m.title.trim(),
              coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
              author: m.author || "Unknown",
              artist: m.artist || "",
              status: m.status || "UNKNOWN",
              description: m.description || "",
              sourceId: `suwayomi_${src.id}`,
              sourceRawId: String(src.id),
              sourceName: srcName,
              sourceLanguage: srcLang,
              language: srcLang,
              provider: "suwayomi",
              chaptersCount: cachedCh,
              relevanceScore
            };
            sourceMangas.push(item);
          }
        } catch {}
      }

      successfulSources.push(srcName);
      updateSourceMetrics(String(src.id), "success", latency, sourceMangas.length);
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError" || 
        String(err?.message || "").toLowerCase().includes("abort") || 
        String(err?.message || "").toLowerCase().includes("timeout");

      if (isTimeout) {
        timedOutSources.push(srcName);
        updateSourceMetrics(String(src.id), "timeout");
      } else {
        failedSources.push(srcName);
        updateSourceMetrics(String(src.id), "fail");
      }
    } finally {
      completedCount++;

      // Strict Deduplication based on sourceId + mangaId
      for (const item of sourceMangas) {
        const globalKey = `${item.sourceRawId}::${item.rawId}`;
        if (!seenGlobalKeys.has(globalKey)) {
          seenGlobalKeys.add(globalKey);
          allFoundResults.push(item);
        }
      }

      if (options.onSourceResult && sourceMangas.length > 0) {
        options.onSourceResult(src, sourceMangas);
      }

      if (options.onProgress) {
        options.onProgress({
          completed: completedCount,
          total: totalCount,
          currentSource: srcName,
          foundCount: allFoundResults.length,
          successfulCount: successfulSources.length,
          timedOutCount: timedOutSources.length,
          failedCount: failedSources.length
        });
      }
    }
  }

  // 5. Concurrency Worker Pool (processes sources with concurrency limit)
  const CONCURRENCY_LIMIT = 15;
  const numWorkers = Math.min(CONCURRENCY_LIMIT, totalCount);

  const workers = Array.from({ length: numWorkers }, async () => {
    while (nextSourceIndex < totalCount) {
      const idx = nextSourceIndex++;
      const src = targetSources[idx];
      if (src) {
        await processSource(src);
      }
    }
  });

  await Promise.all([...workers, nativeSearchPromise]);

  // Sort results by relevance tier first (exact/alias matches always prioritized), then by chapter count descending
  allFoundResults.sort((a, b) => {
    const relA = a.relevanceScore || 0;
    const relB = b.relevanceScore || 0;
    const tierA = relA >= 18000 ? 3 : relA >= 10000 ? 2 : relA >= 4000 ? 1 : 0;
    const tierB = relB >= 18000 ? 3 : relB >= 10000 ? 2 : relB >= 4000 ? 1 : 0;
    if (tierA !== tierB) {
      return tierB - tierA;
    }
    const chA = a.chaptersCount || 0;
    const chB = b.chaptersCount || 0;
    if (chB !== chA) {
      return chB - chA;
    }
    return relB - relA;
  });

  const durationMs = Date.now() - startTime;
  const avgLatencyMs = latencyMeasurementsCount > 0 ? Math.round(totalLatencyAccumulator / latencyMeasurementsCount) : 0;

  return {
    results: allFoundResults,
    sourcesSearched: targetSources.length,
    successfulCount: successfulSources.length,
    timedOutCount: timedOutSources.length,
    failedCount: failedSources.length,
    successfulSources,
    timedOutSources,
    failedSources,
    totalSources: allSources.length,
    avgLatencyMs,
    durationMs
  };
}

// 1. SSE Streaming Federated Search across all sources in real-time
suwayomiRouter.get("/federated-search/stream", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawQuery = (req.query.query as string) || (req.query.q as string) || "";
  const query = rawQuery.trim();
  const lang = (req.query.lang as string) || "all";

  // Setup Server-Sent Events headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.write(`event: init\ndata: ${JSON.stringify({ query, lang })}\n\n`);

  if (!query) {
    res.write(`event: done\ndata: ${JSON.stringify({ totalResults: 0, sourcesSearched: 0 })}\n\n`);
    return res.end();
  }

  // Check smart cache using normalized query key
  const cacheKey = getNormalizedSearchCacheKey(query, lang);
  const cached = federatedSearchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    // Stream cached results to UI instantly
    const sourceMap = new Map<string, { source: any; mangas: any[] }>();
    for (const m of cached.data.results) {
      const sId = m.sourceId;
      if (!sourceMap.has(sId)) {
        sourceMap.set(sId, {
          source: {
            id: m.sourceRawId || sId.replace(/^suwayomi_/, ""),
            displayName: m.sourceName,
            name: m.sourceName,
            lang: m.sourceLanguage
          },
          mangas: []
        });
      }
      sourceMap.get(sId)!.mangas.push(m);
    }

    for (const entry of sourceMap.values()) {
      res.write(`event: source_result\ndata: ${JSON.stringify({
        sourceId: `suwayomi_${entry.source.id}`,
        sourceName: entry.source.displayName || entry.source.name,
        sourceLanguage: entry.source.lang || "all",
        count: entry.mangas.length,
        mangas: entry.mangas
      })}\n\n`);
    }

    res.write(`event: progress\ndata: ${JSON.stringify({
      completed: cached.data.sourcesSearched,
      total: cached.data.totalSources,
      currentSource: "الذاكرة المؤقتة (Smart Cache)",
      foundCount: cached.data.results.length,
      successfulCount: cached.data.successfulCount,
      timedOutCount: cached.data.timedOutCount,
      failedCount: cached.data.failedCount
    })}\n\n`);

    res.write(`event: done\ndata: ${JSON.stringify({
      totalResults: cached.data.results.length,
      sourcesSearched: cached.data.sourcesSearched,
      successfulCount: cached.data.successfulCount,
      timedOutCount: cached.data.timedOutCount,
      failedCount: cached.data.failedCount,
      totalSources: cached.data.totalSources,
      avgLatencyMs: cached.data.avgLatencyMs,
      durationMs: 5,
      fromCache: true
    })}\n\n`);
    return res.end();
  }

  const startTime = Date.now();
  let totalFound = 0;

  try {
    const outcome = await executeFederatedSearchAcrossSources(suwayomiUrl, query, {
      lang,
      onSourceResult: (source, mangas) => {
        totalFound += mangas.length;
        res.write(`event: source_result\ndata: ${JSON.stringify({
          sourceId: `suwayomi_${source.id}`,
          sourceName: source.displayName || source.name,
          sourceLanguage: source.lang || "all",
          count: mangas.length,
          mangas
        })}\n\n`);
      },
      onProgress: (progress) => {
        res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
      }
    });

    // Save to smart normalized cache only if we had a reasonable success rate
    // This prevents caching completely failed searches (e.g. rate limits or timeouts)
    const successRatio = outcome.totalSources > 0 ? (outcome.successfulCount / outcome.totalSources) : 1;
    if (successRatio >= 0.3 || outcome.results.length > 0) {
      federatedSearchCache.set(cacheKey, {
        normalizedKey: cacheKey,
        normalizedQuery: normalizeText(query),
        rawQuery: query,
        lang,
        timestamp: Date.now(),
        expiresAt: Date.now() + SMART_CACHE_TTL_MS,
        data: outcome
      });
    }

    const durationMs = Date.now() - startTime;
    res.write(`event: done\ndata: ${JSON.stringify({
      totalResults: outcome.results.length,
      sourcesSearched: outcome.sourcesSearched,
      successfulCount: outcome.successfulCount,
      timedOutCount: outcome.timedOutCount,
      failedCount: outcome.failedCount,
      totalSources: outcome.totalSources,
      avgLatencyMs: outcome.avgLatencyMs,
      durationMs,
      fromCache: false
    })}\n\n`);
    res.end();
  } catch (err: any) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Resolve chapter counts for a batch of mangas in background without blocking UI
suwayomiRouter.post("/resolve-chapter-counts", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const items: Array<{ id: string; rawId: string; sourceId: string; provider?: string; title?: string }> = req.body?.items || [];
  
  const counts: Record<string, number> = {};

  const unindexed = items.filter(it => {
    const key = it.id || `${it.provider || 'suwayomi'}_${it.sourceId}_${it.rawId}`;
    if (mangaChapterCountCache.has(key)) {
      counts[it.id] = mangaChapterCountCache.get(key)!;
      return false;
    }
    return true;
  }).slice(0, 30); // Process batch of up to 30 items

  await Promise.allSettled(
    unindexed.map(async (it) => {
      try {
        const key = it.id || `${it.provider || 'suwayomi'}_${it.sourceId}_${it.rawId}`;
        let count = 0;

        if (it.provider === "3asq" || it.sourceId === "3asq") {
          count = mangaChapterCountCache.get(key) || 0;
        } else if (it.provider === "mangadex" || it.sourceId === "consumet_mangadex") {
          const mdRes = await fetch(`https://api.mangadex.org/chapter?manga=${it.rawId}&limit=1`, {
            headers: { "User-Agent": "MangaReaderApp/1.0" },
            signal: AbortSignal.timeout(3000)
          });
          if (mdRes.ok) {
            const data = await mdRes.json();
            count = data?.total || 0;
          }
        } else {
          const cleanId = String(it.rawId || it.id).replace(/^suwayomi_/, "").trim();
          const numId = parseInt(cleanId);
          if (!isNaN(numId)) {
            // 1. Query current chapters totalCount via GraphQL (must use Int! type)
            const suwGql = `
              query GetMangaChaptersCount($id: Int!) {
                manga(id: $id) {
                  chapters {
                    totalCount
                  }
                }
              }
            `;
            const data = await executeSuwayomiGraphQL(suwayomiUrl, suwGql, { id: numId }, 2500);
            count = data?.manga?.chapters?.totalCount || 0;

            // 2. If count is 0, trigger fast live onlineFetch to populate chapters from source
            if (count === 0) {
              try {
                const onlineRes = await fetch(`${suwayomiUrl}/api/v1/manga/${numId}/chapters?onlineFetch=true`, {
                  headers: { Accept: "application/json" },
                  signal: AbortSignal.timeout(4000)
                });
                if (onlineRes.ok) {
                  const chs = await onlineRes.json();
                  if (Array.isArray(chs) && chs.length > 0) {
                    count = chs.length;
                  }
                }
              } catch {}
            }
          } else {
            // Unindexed source manga (URL string ID from search results)
            const sId = String((it as any).sourceRawId || it.sourceId).replace(/^suwayomi_/, "");
            if (sId) {
              const suwGql = `
                query FetchSourceChapters($source: LongString!, $url: String!) {
                  fetchSourceMangaChapters(input: { source: $source, url: $url }) {
                    chapters {
                      id
                    }
                  }
                }
              `;
              const data = await executeSuwayomiGraphQL(suwayomiUrl, suwGql, { source: sId, url: cleanId }, 8000);
              count = data?.fetchSourceMangaChapters?.chapters?.length || 0;
            }
          }
        }

        if (count > 0) {
          mangaChapterCountCache.set(key, count);
          counts[it.id] = count;
        }
      } catch {}
    })
  );

  res.json({ success: true, counts });
});

// 2. Standard JSON Federated Search across all sources (Distinct results per source)
suwayomiRouter.get("/federated-search", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawQuery = (req.query.query as string) || (req.query.q as string) || "";
  const query = rawQuery.trim();
  const lang = (req.query.lang as string) || "all";

  if (!query) {
    return res.json({ results: [], count: 0, sourcesSearched: 0 });
  }

  const cacheKey = getNormalizedSearchCacheKey(query, lang);
  const cached = federatedSearchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return res.json({
      results: cached.data.results,
      count: cached.data.results.length,
      sourcesSearched: cached.data.sourcesSearched,
      successfulCount: cached.data.successfulCount,
      timedOutCount: cached.data.timedOutCount,
      failedCount: cached.data.failedCount,
      totalSources: cached.data.totalSources,
      avgLatencyMs: cached.data.avgLatencyMs,
      durationMs: 5,
      fromCache: true
    });
  }

  try {
    const outcome = await executeFederatedSearchAcrossSources(suwayomiUrl, query, { lang });

    // Cache results in smart cache only if we had a reasonable success rate
    const successRatio = outcome.totalSources > 0 ? (outcome.successfulCount / outcome.totalSources) : 1;
    if (successRatio >= 0.3 || outcome.results.length > 0) {
      federatedSearchCache.set(cacheKey, {
        normalizedKey: cacheKey,
        normalizedQuery: normalizeText(query),
        rawQuery: query,
        lang,
        timestamp: Date.now(),
        expiresAt: Date.now() + SMART_CACHE_TTL_MS,
        data: outcome
      });
    }

    return res.json({
      results: outcome.results,
      count: outcome.results.length,
      sourcesSearched: outcome.sourcesSearched,
      successfulCount: outcome.successfulCount,
      timedOutCount: outcome.timedOutCount,
      failedCount: outcome.failedCount,
      totalSources: outcome.totalSources,
      avgLatencyMs: outcome.avgLatencyMs,
      durationMs: outcome.durationMs,
      fromCache: false
    });
  } catch (err: any) {
    console.error("[Federated Search] Error:", err.message);
    return res.status(500).json({ error: err.message, results: [] });
  }
});

// 3. Backward-compatible /search-all endpoint
suwayomiRouter.get("/search-all", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawQuery = (req.query.query as string) || (req.query.q as string) || "";
  const query = rawQuery.trim();
  const lang = (req.query.lang as string) || "all";
  const grouped = req.query.grouped === "true";

  if (!query) {
    return res.json({ results: [], count: 0 });
  }

  const normKey = getNormalizedSearchCacheKey(query, lang);
  const cached = federatedSearchCache.get(normKey);
  if (cached && Date.now() < cached.expiresAt) {
    let finalResults = cached.data.results;
    if (grouped) {
      const groupedMap = new Map<string, any>();
      for (const item of cached.data.results) {
        const canonicalTitle = getCanonicalTitle(item.title);
        const normTitle = normalizeText(canonicalTitle);
        if (!normTitle) continue;
        const existing = groupedMap.get(normTitle);
        const sourceObj = {
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          mangaId: item.id,
          language: item.language,
          sourceLanguage: item.sourceLanguage
        };
        if (!existing) {
          groupedMap.set(normTitle, {
            id: item.id,
            displayTitle: canonicalTitle,
            title: canonicalTitle,
            coverUrl: item.coverUrl,
            author: item.author,
            description: item.description,
            status: item.status,
            sources: [sourceObj]
          });
        } else {
          if (!existing.sources.some((s: any) => s.sourceId === sourceObj.sourceId)) {
            existing.sources.push(sourceObj);
          }
        }
      }
      finalResults = Array.from(groupedMap.values());
    }

    return res.json({
      results: finalResults,
      count: finalResults.length,
      fromCache: true
    });
  }

  try {
    const outcome = await executeFederatedSearchAcrossSources(suwayomiUrl, query, { lang });
    let finalResults = outcome.results;

    // Cache results in smart cache only if we had a reasonable success rate
    const successRatio = outcome.totalSources > 0 ? (outcome.successfulCount / outcome.totalSources) : 1;
    if (successRatio >= 0.3 || outcome.results.length > 0) {
      federatedSearchCache.set(normKey, {
        normalizedKey: normKey,
        normalizedQuery: normalizeText(query),
        rawQuery: query,
        lang,
        timestamp: Date.now(),
        expiresAt: Date.now() + SMART_CACHE_TTL_MS,
        data: outcome
      });
    }

    if (grouped) {
      // Group by canonical title if explicitly requested
      const groupedMap = new Map<string, any>();
      for (const item of outcome.results) {
        const canonicalTitle = getCanonicalTitle(item.title);
        const normTitle = normalizeText(canonicalTitle);
        if (!normTitle) continue;
        const existing = groupedMap.get(normTitle);
        const sourceObj = {
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          mangaId: item.id,
          language: item.language,
          sourceLanguage: item.sourceLanguage
        };
        if (!existing) {
          groupedMap.set(normTitle, {
            id: item.id,
            displayTitle: canonicalTitle,
            title: canonicalTitle,
            coverUrl: item.coverUrl,
            author: item.author,
            description: item.description,
            status: item.status,
            sources: [sourceObj]
          });
        } else {
          if (!existing.sources.some((s: any) => s.sourceId === sourceObj.sourceId)) {
            existing.sources.push(sourceObj);
          }
        }
      }
      finalResults = Array.from(groupedMap.values());
    }

    return res.json({
      results: finalResults,
      count: finalResults.length,
      sourcesSearched: outcome.sourcesSearched,
      fromCache: false
    });
  } catch (err: any) {
    console.error("[Suwayomi Search] Error in search-all:", err.message);
    return res.status(500).json({ error: err.message, results: [] });
  }
});

// 6. Manga Details & Chapters (Live Extension Execution)
export async function fetchSuwayomiMangaDetailsAndChapters(
  suwayomiUrl: string,
  mangaId: string | number
): Promise<{ details: any; chapters: any[] } | null> {
  const rawMangaId = String(mangaId).replace(/^suwayomi_/, "").trim();
  const isPureInt = /^\d+$/.test(rawMangaId);
  const numId = isPureInt ? parseInt(rawMangaId, 10) : NaN;

  try {
    let mangaData: any = null;
    let chaptersList: any[] = [];

    // 1. Fast check: Query existing manga state from Suwayomi database (instant 10ms for library/favorites)
    if (!isNaN(numId)) {
      try {
        const queryManga = `
          query QueryManga($id: Int!) {
            manga(id: $id) {
              id
              title
              description
              author
              artist
              genre
              status
              thumbnailUrl
              chapters {
                totalCount
                nodes {
                  id
                  name
                  chapterNumber
                  sourceOrder
                  uploadDate
                  scanlator
                }
              }
            }
          }
        `;
        const queryRes = await executeSuwayomiGraphQL(suwayomiUrl, queryManga, { id: numId }, 4000);
        if (queryRes?.manga) {
          mangaData = queryRes.manga;
          if (Array.isArray(mangaData.chapters?.nodes) && mangaData.chapters.nodes.length > 0) {
            chaptersList = mangaData.chapters.nodes;
          }
        }
      } catch {}

      // 2. If chapters are empty or manga not found, trigger live fetch of manga metadata and chapters via GraphQL mutation
      if (!mangaData || chaptersList.length === 0) {
        try {
          const fetchMutation = `
            mutation FetchMangaAndChapters($id: Int!) {
              fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) {
                manga {
                  id
                  title
                  description
                  author
                  artist
                  genre
                  status
                  thumbnailUrl
                }
                chapters {
                  id
                  name
                  chapterNumber
                  sourceOrder
                  uploadDate
                  scanlator
                }
              }
            }
          `;
          const resGql = await executeSuwayomiGraphQL(suwayomiUrl, fetchMutation, { id: numId }, 8000);
          if (resGql?.fetchMangaAndChapters) {
            if (resGql.fetchMangaAndChapters.manga) {
              mangaData = resGql.fetchMangaAndChapters.manga;
            }
            if (Array.isArray(resGql.fetchMangaAndChapters.chapters) && resGql.fetchMangaAndChapters.chapters.length > 0) {
              chaptersList = resGql.fetchMangaAndChapters.chapters;
            }
          }
        } catch (gqlErr: any) {
          console.warn("[Suwayomi] fetchMangaAndChapters mutation notice:", gqlErr.message);
        }
      }

      // 3. If still empty chapters, try fetchChapters mutation specifically
      if (mangaData && chaptersList.length === 0) {
        try {
          const fetchChMut = `
            mutation FetchChapters($mangaId: Int!) {
              fetchChapters(input: { mangaId: $mangaId }) {
                chapters {
                  id
                  name
                  chapterNumber
                  sourceOrder
                  uploadDate
                  scanlator
                }
              }
            }
          `;
          const chRes = await executeSuwayomiGraphQL(suwayomiUrl, fetchChMut, { mangaId: numId });
          if (chRes?.fetchChapters?.chapters && chRes.fetchChapters.chapters.length > 0) {
            chaptersList = chRes.fetchChapters.chapters;
          }
        } catch {}
      }

      // 4. If still empty chapters, force live fetch from source extension via Suwayomi REST with onlineFetch=true
      if (chaptersList.length === 0) {
        try {
          const onlineRes = await fetch(`${suwayomiUrl}/api/v1/manga/${numId}/chapters?onlineFetch=true`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(15000)
          });
          if (onlineRes.ok) {
            const rawCh = await onlineRes.json();
            if (Array.isArray(rawCh) && rawCh.length > 0) {
              chaptersList = rawCh;
            }
          }
        } catch (onlineErr: any) {
          console.warn("[Suwayomi] onlineFetch chapters fallback notice:", onlineErr.message);
        }
      }
    }

    // 5. Fallback to REST v1 if GraphQL mangaData was unavailable
    if (!mangaData) {
      const [mangaRes, chaptersRes] = await Promise.all([
        fetch(`${suwayomiUrl}/api/v1/manga/${encodeURIComponent(rawMangaId)}`, {
          headers: { Accept: "application/json" }
        }).catch(() => null),
        fetch(`${suwayomiUrl}/api/v1/manga/${encodeURIComponent(rawMangaId)}/chapters?onlineFetch=true`, {
          headers: { Accept: "application/json" }
        }).catch(() => null)
      ]);

      if (mangaRes && mangaRes.ok) {
        mangaData = await mangaRes.json();
        const rawCh = chaptersRes && chaptersRes.ok ? await chaptersRes.json() : [];
        if (Array.isArray(rawCh) && rawCh.length > 0) {
          chaptersList = rawCh;
        }
      }
    }

    if (mangaData) {
      // Cache chapter details to accelerate page serving
      chaptersList.forEach((c: any) => {
        const cIdStr = String(c.id);
        const existing = chapterCache.get(cIdStr);
        chapterCache.set(cIdStr, {
          mangaId: String(mangaData.id),
          sourceOrder: c.sourceOrder !== undefined ? c.sourceOrder : (existing?.sourceOrder ?? 1),
          pageCount: existing?.pageCount ?? 0,
          updatedAt: Date.now()
        });
      });

      const formattedChapters = chaptersList.map((c: any) => ({
        id: `suwayomi_${c.id}`,
        rawId: String(c.id),
        mangaId: String(mangaData.id),
        sourceOrder: c.sourceOrder,
        title: c.name || `الفصل ${c.chapterNumber || ""}`,
        chapter: String(c.chapterNumber || "0"),
        chapterNumber: String(c.chapterNumber || "0"),
        scanlator: c.scanlator || "",
        groupName: c.scanlator || "Suwayomi",
        language: c.language || mangaData.language || "all",
        read: Boolean(c.read),
        dateUpload: c.uploadDate || 0,
        provider: "suwayomi"
      }));

      return {
        details: {
          id: `suwayomi_${mangaData.id}`,
          rawId: String(mangaData.id),
          title: mangaData.title,
          coverUrl: `/api/suwayomi/manga/${mangaData.id}/thumbnail`,
          author: mangaData.author || "Unknown",
          artist: mangaData.artist || "",
          description: mangaData.description || "",
          genre: Array.isArray(mangaData.genre) ? mangaData.genre : [],
          status: mangaData.status || "Unknown",
          originalLanguage: mangaData.language || "all",
          language: mangaData.language || "all",
          provider: "suwayomi"
        },
        chapters: formattedChapters
      };
    }
  } catch (err: any) {
    console.error("[Suwayomi] fetchSuwayomiMangaDetailsAndChapters error:", err.message);
  }
  return null;
}

suwayomiRouter.get("/manga/:mangaId", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  try {
    const data = await fetchSuwayomiMangaDetailsAndChapters(suwayomiUrl, req.params.mangaId);
    if (data) {
      return res.json(data);
    }
    return res.status(404).json({ error: "Manga not found in Suwayomi" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. Chapter Pages (Fetch Chapter Pages & Unlock via Extension)
export async function fetchSuwayomiPages(
  suwayomiUrl: string,
  chapterId: string | number
): Promise<string[]> {
  const rawChapterId = String(chapterId).replace(/^suwayomi_/, "").trim();
  const numChapterId = parseInt(rawChapterId);

  try {
    let pageCount = 0;
    let sourceOrder: any = 1;
    let mangaId: any = "";

    // 1. Preferred method: GraphQL mutation fetchChapterPages
    if (!isNaN(numChapterId)) {
      try {
        const fetchPagesMutation = `
          mutation FetchChapterPages($chapterId: Int!) {
            fetchChapterPages(input: { chapterId: $chapterId }) {
              chapter {
                id
                pageCount
                sourceOrder
                mangaId
              }
            }
          }
        `;
        const mutData = await executeSuwayomiGraphQL(suwayomiUrl, fetchPagesMutation, { chapterId: numChapterId });
        const ch = mutData?.fetchChapterPages?.chapter;
        if (ch && ch.pageCount > 0) {
          pageCount = ch.pageCount;
          sourceOrder = ch.sourceOrder ?? 1;
          mangaId = ch.mangaId;
        }
      } catch (mutErr: any) {
        console.warn("[Suwayomi] fetchChapterPages mutation notice:", mutErr.message);
      }

      // 2. Query chapter info directly if mutation didn't populate pageCount immediately
      if (pageCount === 0) {
        try {
          const queryChapter = `
            query QueryChapter($id: Int!) {
              chapter(id: $id) {
                id
                pageCount
                sourceOrder
                mangaId
              }
            }
          `;
          const qData = await executeSuwayomiGraphQL(suwayomiUrl, queryChapter, { id: numChapterId });
          const ch = qData?.chapter;
          if (ch && ch.pageCount > 0) {
            pageCount = ch.pageCount;
            sourceOrder = ch.sourceOrder ?? 1;
            mangaId = ch.mangaId;
          }
        } catch {}
      }
    }

    // 3. Fallback to REST v1
    if (pageCount === 0) {
      const response = await fetch(`${suwayomiUrl}/api/v1/chapter/${encodeURIComponent(rawChapterId)}`, {
        headers: { Accept: "application/json" }
      });
      if (response.ok) {
        const chapterData = await response.json();
        pageCount = chapterData.pageCount || chapterData.pages || 0;
        sourceOrder = chapterData.sourceOrder ?? 1;
        mangaId = chapterData.mangaId || "";
      }
    }

    // Check cached info if mangaId is missing
    const cached = chapterCache.get(rawChapterId);
    if (!mangaId && cached?.mangaId) {
      mangaId = cached.mangaId;
    }
    if (sourceOrder === 1 && cached?.sourceOrder) {
      sourceOrder = cached.sourceOrder;
    }

    // Save to chapterCache
    chapterCache.set(rawChapterId, {
      mangaId: String(mangaId),
      sourceOrder: String(sourceOrder),
      pageCount: pageCount,
      updatedAt: Date.now()
    });

    if (pageCount > 0) {
      const pages: string[] = [];
      for (let i = 0; i < pageCount; i++) {
        pages.push(`/api/suwayomi/chapter/${rawChapterId}/page/${i}?mangaId=${mangaId}&sourceOrder=${sourceOrder}`);
      }
      return pages;
    }
  } catch (err: any) {
    console.error("[Suwayomi] fetchSuwayomiPages error:", err.message);
  }
  return [];
}

suwayomiRouter.get("/chapter/:chapterId/pages", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const chapterId = req.params.chapterId;

  // 1. WeebCentral Pages
  if (chapterId.startsWith("weebcentral_")) {
    try {
      const chId = chapterId.replace(/^weebcentral_/, "");
      const wcUrl = `https://weebcentral.com/chapters/${chId}/images?is_prev=False&current_page=1&reading_style=long_strip`;
      const wcRes = await fetch(wcUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "HX-Request": "true"
        },
        signal: AbortSignal.timeout(12000)
      });
      if (wcRes.ok) {
        const html = await wcRes.text();
        const rawImgs = [...html.matchAll(/<img[^>]+(?:data-src|src)="([^"]+)"/g)]
          .map(m => m[1].trim())
          .filter(u => u.includes("/manga/") || u.includes("lowee.us") || u.includes("temp.compsci88.com"));
        if (rawImgs.length > 0) {
          return res.json({
            success: true,
            chapterId,
            pageCount: rawImgs.length,
            pages: rawImgs
          });
        }
      }
    } catch (err: any) {
      console.warn("[WeebCentral] Pages fetch error:", err.message);
    }
  }

  // 2. ComicK Pages
  if (chapterId.startsWith("comick_")) {
    try {
      const chId = chapterId.replace(/^comick_/, "");
      const { MANGA } = await import("@consumet/extensions");
      const comick = new (MANGA as any).ComicK();
      const pagesData = await comick.fetchChapterPages(chId);
      const pages = (pagesData || []).map((p: any) => p.img).filter(Boolean);
      if (pages.length > 0) {
        return res.json({
          success: true,
          chapterId,
          pageCount: pages.length,
          pages
        });
      }
    } catch (err: any) {
      console.warn("[ComicK] Pages fetch error:", err.message);
    }
  }

  // 3. MangaDex Pages
  if (chapterId.startsWith("md_")) {
    try {
      const chId = chapterId.replace(/^md_/, "");
      const sRes = await fetch(`https://api.mangadex.org/at-home/server/${chId}`, {
        headers: { "User-Agent": "MangaReaderApp/1.0" },
        signal: AbortSignal.timeout(10000)
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        const baseUrl = sData.baseUrl;
        const hash = sData.chapter.hash;
        const pages = (sData.chapter.data || []).map((f: string) => `${baseUrl}/data/${hash}/${f}`);
        return res.json({
          success: true,
          chapterId,
          pageCount: pages.length,
          pages
        });
      }
    } catch (err: any) {
      console.warn("[MangaDex] Pages fetch error:", err.message);
    }
  }

  // 4. 3asq Pages
  if (chapterId.startsWith("3asq_")) {
    try {
      const parts = chapterId.replace(/^3asq_/, "").split("_");
      const mangaSlug = parts[0];
      const chSlug = parts.slice(1).join("_");
      const chUrl = `https://3asq.online/manga/${mangaSlug}/${chSlug}/`;
      const pRes = await fetch(chUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: AbortSignal.timeout(10000)
      });
      if (pRes.ok) {
        const html = await pRes.text();
        const imgs = [...html.matchAll(/<img[^>]+(?:data-src|src)="([^"]+)"[^>]*class="[^"]*wp-manga-chapter-img/g)]
          .map(m => m[1].trim());
        if (imgs.length > 0) {
          return res.json({
            success: true,
            chapterId,
            pageCount: imgs.length,
            pages: imgs
          });
        }
      }
    } catch (err: any) {
      console.warn("[3asq] Pages fetch error:", err.message);
    }
  }

  // 5. Suwayomi Pages
  try {
    const pages = await fetchSuwayomiPages(suwayomiUrl, chapterId);
    if (pages.length > 0) {
      return res.json({
        success: true,
        chapterId,
        pageCount: pages.length,
        pages
      });
    }
    return res.status(404).json({ error: "No pages found for this chapter in Suwayomi" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 8. Chapter Page Image Proxy Stream
suwayomiRouter.get("/chapter/:chapterId/page/:pageIndex", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawChapterId = req.params.chapterId.replace(/^suwayomi_/, "");
  const pageIndex = req.params.pageIndex;

  let mangaId = (req.query.mangaId as string) || "";
  let sourceOrder = (req.query.sourceOrder as string) || (req.query.chapterOrder as string) || "";

  try {
    // 1. Lookup from memory cache if missing
    if (!mangaId || !sourceOrder) {
      const cached = chapterCache.get(rawChapterId);
      if (cached) {
        mangaId = mangaId || String(cached.mangaId);
        sourceOrder = sourceOrder || String(cached.sourceOrder);
      }
    }

    // 2. Lookup from GraphQL if still missing
    if (!mangaId || !sourceOrder) {
      const numChapterId = parseInt(rawChapterId);
      if (!isNaN(numChapterId)) {
        try {
          const qData = await executeSuwayomiGraphQL(
            suwayomiUrl,
            `query QueryCh($id: Int!) { chapter(id: $id) { id mangaId sourceOrder pageCount } }`,
            { id: numChapterId }
          );
          if (qData?.chapter) {
            mangaId = String(qData.chapter.mangaId);
            sourceOrder = String(qData.chapter.sourceOrder);
            chapterCache.set(rawChapterId, {
              mangaId,
              sourceOrder,
              pageCount: qData.chapter.pageCount,
              updatedAt: Date.now()
            });
          }
        } catch {}
      }
    }

    // 3. Build verified Suwayomi v2 page URL
    let targetUrl = "";
    if (mangaId && sourceOrder) {
      targetUrl = `${suwayomiUrl}/api/v1/manga/${encodeURIComponent(mangaId)}/chapter/${encodeURIComponent(sourceOrder)}/page/${encodeURIComponent(pageIndex)}`;
    } else {
      targetUrl = `${suwayomiUrl}/api/v1/chapter/${encodeURIComponent(rawChapterId)}/page/${encodeURIComponent(pageIndex)}`;
    }

    const imgResponse = await fetch(targetUrl, {
      headers: {
        Accept: "image/*,*/*"
      }
    });

    if (!imgResponse.ok) {
      // Try alternate URL if first failed
      if (mangaId && sourceOrder) {
        const altUrl = `${suwayomiUrl}/api/v1/chapter/${encodeURIComponent(rawChapterId)}/page/${encodeURIComponent(pageIndex)}`;
        const altRes = await fetch(altUrl, { headers: { Accept: "image/*,*/*" } });
        if (altRes.ok) {
          const contentType = altRes.headers.get("content-type") || "image/jpeg";
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "public, max-age=86400");
          const buffer = await altRes.arrayBuffer();
          return res.send(Buffer.from(buffer));
        }
      }
      return res.status(imgResponse.status).send("Failed to load page image from Suwayomi");
    }

    const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");

    const arrayBuffer = await imgResponse.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    return res.status(500).send(`Image proxy error: ${err.message}`);
  }
});

// 9. Manga Thumbnail Proxy
suwayomiRouter.get("/manga/:mangaId/thumbnail", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawMangaId = req.params.mangaId.replace(/^suwayomi_/, "");

  try {
    const targetUrl = `${suwayomiUrl}/api/v1/manga/${encodeURIComponent(rawMangaId)}/thumbnail`;
    const response = await fetch(targetUrl, {
      headers: { Accept: "image/*,*/*" }
    });

    if (response.ok) {
      const contentType = response.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      const buffer = await response.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }

    return res.status(response.status).send("Thumbnail not found");
  } catch (err: any) {
    return res.status(500).send(`Thumbnail proxy error: ${err.message}`);
  }
});

// 10. Recent Chapters from Suwayomi (History/Recent)
suwayomiRouter.get("/recent-chapters", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  try {
    const q = `
      query {
        chapters(first: 25) {
          nodes {
            id
            name
            chapterNumber
            pageCount
            lastReadAt
            lastPageRead
            mangaId
            manga {
              id
              title
              thumbnailUrl
            }
          }
        }
      }
    `;
    const gqlRes = await executeSuwayomiGraphQL(suwayomiUrl, q);
    const nodes = gqlRes?.chapters?.nodes || [];
    const chapters = nodes.map((node: any) => ({
      id: String(node.id),
      name: node.name || `الفصل ${node.chapterNumber ?? ""}`,
      chapterNumber: String(node.chapterNumber ?? "0"),
      pageCount: node.pageCount > 0 ? node.pageCount : 0,
      mangaId: String(node.mangaId || node.manga?.id || ""),
      mangaTitle: node.manga?.title || "عمل مانجا",
      coverUrl: node.manga?.id ? `/api/suwayomi/manga/${node.manga.id}/thumbnail` : null,
      lastReadAt: node.lastReadAt
    }));

    return res.json({ success: true, chapters });
  } catch (err: any) {
    return res.json({ success: false, error: err.message, chapters: [], offline: true });
  }
});

// 11. Resolve Work or Chapter by URL / ID / Title
suwayomiRouter.get("/resolve-work", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const input = String(req.query.input || "").trim();

  if (!input) {
    return res.status(400).json({ error: "Input is required" });
  }

  try {
    // 1. Check if input is a Chapter URL e.g. .../chapter/123 or .../manga/147/chapter/123
    const chapterIdMatch = input.match(/\/chapter\/(\d+)/i);
    const mangaIdMatch = input.match(/\/manga\/(\d+)/i);

    let chapterId: number | null = chapterIdMatch ? parseInt(chapterIdMatch[1]) : null;
    let mangaId: number | null = mangaIdMatch ? parseInt(mangaIdMatch[1]) : null;

    // If input is purely a number:
    if (!chapterId && !mangaId && /^\d+$/.test(input)) {
      const num = parseInt(input);
      try {
        const qChapter = `
          query QueryChapter($id: Int!) {
            chapter(id: $id) {
              id
              name
              chapterNumber
              pageCount
              mangaId
              manga {
                id
                title
                thumbnailUrl
              }
            }
          }
        `;
        const chData = await executeSuwayomiGraphQL(suwayomiUrl, qChapter, { id: num });
        if (chData?.chapter) {
          chapterId = num;
        } else {
          mangaId = num;
        }
      } catch {
        mangaId = num;
      }
    }

    // If we resolved a chapterId:
    if (chapterId) {
      const qChapter = `
        query QueryChapter($id: Int!) {
          chapter(id: $id) {
            id
            name
            chapterNumber
            pageCount
            mangaId
            manga {
              id
              title
              thumbnailUrl
            }
          }
        }
      `;
      const chData = await executeSuwayomiGraphQL(suwayomiUrl, qChapter, { id: chapterId });
      const ch = chData?.chapter;
      
      const pages = await fetchSuwayomiPages(suwayomiUrl, chapterId);

      return res.json({
        success: true,
        type: "chapter",
        chapter: {
          id: String(ch?.id || chapterId),
          title: ch?.name || `الفصل ${ch?.chapterNumber ?? chapterId}`,
          chapterNumber: String(ch?.chapterNumber ?? "0"),
          mangaId: String(ch?.mangaId || ch?.manga?.id || ""),
          mangaTitle: ch?.manga?.title || "عمل مانجا",
          pageCount: pages.length
        },
        pages,
        manga: ch?.manga ? {
          id: String(ch.manga.id),
          title: ch.manga.title,
          coverUrl: `/api/suwayomi/manga/${ch.manga.id}/thumbnail`
        } : null
      });
    }

    // If we resolved a mangaId:
    if (mangaId) {
      const qManga = `
        query QueryManga($id: Int!) {
          manga(id: $id) {
            id
            title
            description
            author
            artist
            thumbnailUrl
            chapters {
              totalCount
              nodes {
                id
                name
                chapterNumber
                pageCount
              }
            }
          }
        }
      `;
      const mData = await executeSuwayomiGraphQL(suwayomiUrl, qManga, { id: mangaId });
      const m = mData?.manga;
      if (m) {
        return res.json({
          success: true,
          type: "manga",
          manga: {
            id: String(m.id),
            title: m.title,
            description: m.description,
            author: m.author,
            artist: m.artist,
            coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
            chaptersCount: m.chapters?.totalCount || m.chapters?.nodes?.length || 0
          },
          chapters: (m.chapters?.nodes || []).map((c: any) => ({
            id: String(c.id),
            title: c.name || `الفصل ${c.chapterNumber || ""}`,
            chapterNumber: String(c.chapterNumber || "0"),
            pageCount: c.pageCount > 0 ? c.pageCount : 0
          }))
        });
      }
    }

    // Otherwise, search by title query in Suwayomi mangas
    const qSearch = `
      query SearchMangas($query: String!) {
        mangas(filter: { title: { includesInsensitive: $query } }, first: 12) {
          nodes {
            id
            title
            thumbnailUrl
            chapters {
              totalCount
            }
          }
        }
      }
    `;
    const searchRes = await executeSuwayomiGraphQL(suwayomiUrl, qSearch, { query: input });
    const foundMangas = searchRes?.mangas?.nodes || [];

    return res.json({
      success: true,
      type: "search",
      results: foundMangas.map((m: any) => ({
        id: String(m.id),
        title: m.title,
        coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
        chaptersCount: m.chapters?.totalCount || 0
      }))
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 12. List Active Works / Library with Chapters Count
suwayomiRouter.get("/works", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const search = String(req.query.q || "").trim();
  try {
    let q = "";
    let variables: any = {};
    if (search) {
      q = `
        query SearchMangas($query: String!) {
          mangas(filter: { title: { includesInsensitive: $query } }, first: 30) {
            nodes {
              id
              title
              description
              author
              artist
              thumbnailUrl
              chapters {
                totalCount
              }
            }
          }
        }
      `;
      variables = { query: search };
    } else {
      q = `
        query GetMangas {
          mangas(first: 30) {
            nodes {
              id
              title
              description
              author
              artist
              thumbnailUrl
              chapters {
                totalCount
              }
            }
          }
        }
      `;
    }

    const gqlRes = await executeSuwayomiGraphQL(suwayomiUrl, q, variables);
    const nodes = gqlRes?.mangas?.nodes || [];
    const works = nodes.map((m: any) => ({
      id: String(m.id),
      title: m.title,
      description: m.description,
      author: m.author,
      artist: m.artist,
      coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
      chaptersCount: m.chapters?.totalCount || 0
    }));

    return res.json({ success: true, works });
  } catch (err: any) {
    return res.json({ success: false, error: err.message, works: [], offline: true });
  }
});

// 13. Full Manga Details and Chapters
suwayomiRouter.get("/works/:mangaId/chapters", async (req: Request, res: Response) => {
  const suwayomiUrl = getSuwayomiUrl(req);
  const rawIdStr = String(req.params.mangaId).replace(/^suwayomi_/, "").trim();
  const isPureInt = /^\d+$/.test(rawIdStr);
  const mangaId = isPureInt ? parseInt(rawIdStr, 10) : NaN;

  // If not integer, check if it's WeebCentral, ComicK, 3asq, or MangaDex
  if (!mangaId || isNaN(mangaId)) {
    // 1. WeebCentral
    if (rawIdStr.startsWith("weebcentral_") || /^[0-9A-Z]{26}/.test(rawIdStr)) {
      try {
        const seriesSlug = rawIdStr.replace(/^weebcentral_/, "");
        const seriesId = seriesSlug.split("/")[0];
        const wcRes = await fetch(`https://weebcentral.com/series/${seriesId}/full-chapter-list`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "HX-Request": "true"
          },
          signal: AbortSignal.timeout(10000)
        });
        if (wcRes.ok) {
          const html = await wcRes.text();
          const chMatches = [...html.matchAll(/href="[^"]*\/chapters\/([^"]+)"[^>]*>[\s\S]*?<span class="grow[^"]*">[\s\S]*?<span class="[^"]*">([^<]+)<\/span>/g)];
          const chs = chMatches.map((m, idx) => {
            const chId = m[1];
            const chTitle = m[2].trim();
            const numMatch = chTitle.match(/([\d.]+)/);
            const chNum = numMatch ? parseFloat(numMatch[1]) : (chMatches.length - idx);
            return {
              id: `weebcentral_${chId}`,
              rawId: chId,
              mangaId: rawIdStr,
              title: chTitle,
              chapter: String(chNum),
              chapterNumber: String(chNum),
              pageCount: 0,
              provider: "weebcentral"
            };
          });
          return res.json({
            success: true,
            manga: { id: rawIdStr, title: seriesSlug },
            chapters: chs
          });
        }
      } catch (err: any) {
        console.warn("[WeebCentral] Chapters fetch error:", err.message);
      }
    }

    // 2. ComicK
    if (rawIdStr.startsWith("comick_")) {
      try {
        const rawSlug = rawIdStr.replace(/^comick_/, "");
        const { MANGA } = await import("@consumet/extensions");
        const comick = new (MANGA as any).ComicK();
        const info = await comick.fetchMangaInfo(rawSlug);
        const chs = (info?.chapters || []).map((c: any) => ({
          id: `comick_${c.id}`,
          rawId: c.id,
          mangaId: rawIdStr,
          title: c.title || `الفصل ${c.chapter || ""}`,
          chapter: String(c.chapter || "0"),
          chapterNumber: String(c.chapter || "0"),
          pageCount: 0,
          provider: "comick"
        }));
        return res.json({
          success: true,
          manga: { id: rawIdStr, title: info?.title || "ComicK Manga" },
          chapters: chs
        });
      } catch (err: any) {
        console.warn("[ComicK] Chapters fetch error:", err.message);
      }
    }

    // 3. 3asq
    if (rawIdStr.startsWith("3asq_")) {
      try {
        const slug = rawIdStr.replace(/^3asq_/, "");
        const res3 = await fetch(`https://3asq.online/manga/${slug}/ajax/chapters/`, {
          method: "POST",
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          signal: AbortSignal.timeout(10000)
        });
        if (res3.ok) {
          const html = await res3.text();
          const chMatches = [...html.matchAll(/<li[^>]*class="wp-manga-chapter[^"]*"[^>]*>[\s\S]*?<a href="([^"]+)">([^<]+)<\/a>/g)];
          const chs = chMatches.map(m => {
            const chUrl = m[1];
            const chTitle = m[2].trim();
            const chSlug = chUrl.replace(/\/$/, "").split("/").pop() || "";
            const numMatch = chTitle.match(/([\d.]+)/);
            return {
              id: `3asq_${slug}_${chSlug}`,
              rawId: chUrl,
              mangaId: rawIdStr,
              title: chTitle,
              chapter: numMatch ? numMatch[1] : "0",
              chapterNumber: numMatch ? numMatch[1] : "0",
              pageCount: 0,
              provider: "3asq"
            };
          });
          return res.json({
            success: true,
            manga: { id: rawIdStr, title: slug },
            chapters: chs
          });
        }
      } catch (err: any) {
        console.warn("[3asq] Chapters fetch error:", err.message);
      }
    }

    // 4. MangaDex
    try {
      const cleanMdId = rawIdStr.replace(/^mangadex_/, "");
      const mdRes = await fetch(`https://api.mangadex.org/manga/${cleanMdId}/feed?limit=500&order[chapter]=desc&includes[]=scanlation_group`);
      if (mdRes.ok) {
        const mdData = await mdRes.json();
        const chs = (mdData.data || []).map((c: any) => ({
          id: `md_${c.id}`,
          rawId: c.id,
          mangaId: rawIdStr,
          title: c.attributes?.title || `الفصل ${c.attributes?.chapter || ""}`,
          chapter: c.attributes?.chapter || "0",
          chapterNumber: c.attributes?.chapter || "0",
          pageCount: c.attributes?.pages || 0,
          uploadDate: c.attributes?.publishAt,
          provider: "mangadex"
        }));
        return res.json({
          success: true,
          manga: { id: rawIdStr, title: "Manga" },
          chapters: chs
        });
      }
    } catch (_) {}
    return res.status(400).json({ success: false, error: "Invalid manga ID" });
  }

  try {
    const q = `
      query QueryMangaFull($id: Int!) {
        manga(id: $id) {
          id
          title
          description
          author
          artist
          thumbnailUrl
          chapters {
            totalCount
            nodes {
              id
              name
              chapterNumber
              pageCount
              uploadDate
            }
          }
        }
      }
    `;
    const gqlRes = await executeSuwayomiGraphQL(suwayomiUrl, q, { id: mangaId });
    const m = gqlRes?.manga;
    if (!m) {
      // Fallback: try fetching full details
      const fallback = await fetchSuwayomiMangaDetailsAndChapters(suwayomiUrl, mangaId);
      if (fallback) {
        return res.json({
          success: true,
          manga: fallback.details,
          chapters: fallback.chapters
        });
      }
      return res.status(404).json({ success: false, error: "Manga not found" });
    }

    let chapters = (m.chapters?.nodes || []).map((c: any) => {
      const cIdStr = String(c.id);
      chapterCache.set(cIdStr, {
        mangaId: String(m.id),
        sourceOrder: 1,
        pageCount: c.pageCount > 0 ? c.pageCount : 0,
        updatedAt: Date.now()
      });
      return {
        id: `suwayomi_${c.id}`,
        rawId: cIdStr,
        mangaId: String(m.id),
        title: c.name || (c.chapterNumber !== undefined && c.chapterNumber !== null ? `الفصل ${c.chapterNumber}` : "فصل بدون عنوان"),
        chapter: String(c.chapterNumber ?? "0"),
        chapterNumber: String(c.chapterNumber ?? "0"),
        pageCount: c.pageCount > 0 ? c.pageCount : 0,
        uploadDate: c.uploadDate,
        provider: "suwayomi"
      };
    });

    if (chapters.length === 0 || req.query.onlineFetch === "true") {
      const live = await fetchSuwayomiMangaDetailsAndChapters(suwayomiUrl, mangaId);
      if (live && live.chapters && live.chapters.length > 0) {
        chapters = live.chapters;
      } else {
        // Direct guaranteed fallback to Suwayomi REST with onlineFetch=true
        try {
          const directOnline = await fetch(`${suwayomiUrl}/api/v1/manga/${mangaId}/chapters?onlineFetch=true`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(15000)
          });
          if (directOnline.ok) {
            const rawList = await directOnline.json();
            if (Array.isArray(rawList) && rawList.length > 0) {
              chapters = rawList.map((c: any) => {
                const cIdStr = String(c.id);
                chapterCache.set(cIdStr, {
                  mangaId: String(m.id),
                  sourceOrder: c.sourceOrder ?? 1,
                  pageCount: c.pageCount > 0 ? c.pageCount : 0,
                  updatedAt: Date.now()
                });
                return {
                  id: `suwayomi_${c.id}`,
                  rawId: cIdStr,
                  mangaId: String(m.id),
                  title: c.name || (c.chapterNumber !== undefined && c.chapterNumber !== null ? `الفصل ${c.chapterNumber}` : "فصل بدون عنوان"),
                  chapter: String(c.chapterNumber ?? "0"),
                  chapterNumber: String(c.chapterNumber ?? "0"),
                  pageCount: c.pageCount > 0 ? c.pageCount : 0,
                  uploadDate: c.uploadDate,
                  provider: "suwayomi"
                };
              });
            }
          }
        } catch (err: any) {
          console.warn("[Suwayomi] Direct onlineFetch error:", err.message);
        }
      }
    }

    if (chapters.length > 0) {
      mangaChapterCountCache.set(`suwayomi_${m.id}`, chapters.length);
      if (m.sourceId) {
        mangaChapterCountCache.set(`suwayomi_${m.sourceId}_${m.id}`, chapters.length);
      }
    }

    return res.json({
      success: true,
      manga: {
        id: String(m.id),
        title: m.title,
        description: m.description,
        author: m.author,
        artist: m.artist,
        coverUrl: `/api/suwayomi/manga/${m.id}/thumbnail`,
        chaptersCount: m.chapters?.totalCount || chapters.length
      },
      chapters
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for discovering manga records across top active sources by title
async function discoverMangaAcrossSources(suwayomiUrl: string, title: string) {
  const sampleSources = [
    "1073624495230267708", // 3asq
    "6247824327199706550", // Asura Scans
    "2499283537670799839", // MangaDex
    "7868461746231908488", // Flamescans
    "4035985108427926189"  // Arab Manga
  ];

  // Include any custom sources added by user
  for (const c of customSourcesList) {
    if (!sampleSources.includes(c.rawId)) {
      sampleSources.push(c.rawId);
    }
  }

  const results: any[] = [];
  await Promise.allSettled(
    sampleSources.map(async (sId) => {
      try {
        const gqlQuery = `
          mutation Search($s: LongString!, $q: String!) {
            fetchSourceManga(input: { source: $s, type: SEARCH, query: $q, page: 1 }) {
              mangas {
                id
                title
              }
            }
          }
        `;
        const data = await executeSuwayomiGraphQL(suwayomiUrl, gqlQuery, { s: sId, q: title }, 6000);
        const list = data?.fetchSourceManga?.mangas || [];
        if (list.length > 0) {
          const matched = list[0];
          results.push({
            id: `suwayomi_${matched.id}`,
            rawId: String(matched.id),
            sourceId: sId,
            sourceName: sId === "1073624495230267708" ? "مانجا العاشق" : (sId === "6247824327199706550" ? "Asura Scans" : `مصدر ${sId}`)
          });
        }
      } catch {}
    })
  );
  return results;
}

// 13B. Multi-Source In-Depth Chapter Inspection & Deduplication Engine
// Inspects the work directly inside each source page (onlineFetch=true), verifies real chapters, and combines them without duplicate chapters
async function handleAggregateChapters(req: Request, res: Response) {
  const suwayomiUrl = getSuwayomiUrl(req);
  const body = req.body || {};
  const query = req.query || {};

  const title = (body.title || query.title || "").trim();
  let mangas: Array<{ id: string; rawId?: string; sourceId: string; sourceName?: string; sourceLanguage?: string }> = body.mangas || [];

  if (!mangas.length && query.mangas) {
    try {
      mangas = JSON.parse(query.mangas as string);
    } catch {}
  }

  if (!mangas.length && (query.mangaId || body.mangaId)) {
    const singleId = String(query.mangaId || body.mangaId);
    mangas = [{
      id: singleId,
      rawId: singleId.replace(/^suwayomi_/, ""),
      sourceId: String(query.sourceId || body.sourceId || ""),
      sourceName: String(query.sourceName || body.sourceName || "المصدر المحدد"),
      sourceLanguage: String(query.sourceLanguage || body.sourceLanguage || "all")
    }];
  }

  if (!mangas.length && title) {
    try {
      const discovered = await discoverMangaAcrossSources(suwayomiUrl, title);
      mangas = discovered;
    } catch (e: any) {
      console.warn("[Aggregate Chapters] Error discovering title across sources:", e.message);
    }
  }

  if (!mangas.length) {
    return res.status(400).json({
      success: false,
      error: "يرجى توفير قائمة المصادر أو عنوان العمل للفحص الشامل."
    });
  }

  const sourcesChecked: Array<{
    sourceId: string;
    sourceName: string;
    sourceLanguage?: string;
    chaptersFound: number;
    status: "ok" | "empty" | "error";
    error?: string;
  }> = [];

  // Group chapters by normalized chapter key to eliminate duplicates
  const unifiedChapterMap = new Map<string, any>();

  // Deep in-source inspection: query each source's actual page with onlineFetch=true
  await Promise.allSettled(
    mangas.map(async (m) => {
      const rawMangaId = String(m.rawId || m.id).replace(/^suwayomi_/, "").trim();
      const numId = parseInt(rawMangaId);
      const sId = String(m.sourceId || "").replace(/^suwayomi_/, "");
      const sName = m.sourceName || `مصدر (${sId})`;
      const sLang = m.sourceLanguage || "all";

      let fetchedChapters: any[] = [];
      let sourceStatus: "ok" | "empty" | "error" = "empty";
      let errorMsg: string | undefined;

      try {
        if (!isNaN(numId)) {
          // 1. Enter the manga's page directly inside the source with onlineFetch=true
          const onlineRes = await fetch(`${suwayomiUrl}/api/v1/manga/${numId}/chapters?onlineFetch=true`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(15000)
          });
          if (onlineRes.ok) {
            const rawList = await onlineRes.json();
            if (Array.isArray(rawList)) {
              fetchedChapters = rawList;
            }
          }

          // 2. If 0 chapters returned, fallback to GraphQL check
          if (fetchedChapters.length === 0) {
            try {
              const gqlRes = await executeSuwayomiGraphQL(suwayomiUrl, `
                query DeepCheck($id: Int!) {
                  manga(id: $id) {
                    chapters {
                      nodes {
                        id
                        name
                        chapterNumber
                        pageCount
                        uploadDate
                        sourceOrder
                        realUrl
                      }
                    }
                  }
                }
              `, { id: numId }, 10000);
              const nodes = gqlRes?.manga?.chapters?.nodes;
              if (Array.isArray(nodes) && nodes.length > 0) {
                fetchedChapters = nodes;
              }
            } catch {}
          }
        } else if ((m as any).provider === "weebcentral" || rawMangaId.startsWith("weebcentral_") || sId.includes("weebcentral")) {
          const seriesSlug = rawMangaId.replace(/^weebcentral_/, "");
          const seriesId = seriesSlug.split("/")[0];
          const wcRes = await fetch(`https://weebcentral.com/series/${seriesId}/full-chapter-list`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "HX-Request": "true"
            },
            signal: AbortSignal.timeout(10000)
          });
          if (wcRes.ok) {
            const html = await wcRes.text();
            const chMatches = [...html.matchAll(/href="[^"]*\/chapters\/([^"]+)"[^>]*>[\s\S]*?<span class="grow[^"]*">[\s\S]*?<span class="[^"]*">([^<]+)<\/span>/g)];
            fetchedChapters = chMatches.map((match, idx) => {
              const chId = match[1];
              const chTitle = match[2].trim();
              const numMatch = chTitle.match(/([\d.]+)/);
              const chNum = numMatch ? parseFloat(numMatch[1]) : (chMatches.length - idx);
              return {
                id: `weebcentral_${chId}`,
                name: chTitle,
                chapterNumber: chNum,
                pageCount: 0,
                uploadDate: Date.now(),
                provider: "weebcentral"
              };
            });
          }
        } else if ((m as any).provider === "comick" || rawMangaId.startsWith("comick_") || sId.includes("comick")) {
          const rawSlug = rawMangaId.replace(/^comick_/, "");
          const { MANGA } = await import("@consumet/extensions");
          const comick = new (MANGA as any).ComicK();
          const info = await comick.fetchMangaInfo(rawSlug);
          fetchedChapters = (info?.chapters || []).map((c: any) => ({
            id: `comick_${c.id}`,
            name: c.title || `الفصل ${c.chapter || ""}`,
            chapterNumber: parseFloat(c.chapter || "0"),
            pageCount: 0,
            uploadDate: Date.now(),
            provider: "comick"
          }));
        } else if ((m as any).provider === "3asq" || rawMangaId.startsWith("3asq_") || sId.includes("3asq")) {
          const slug = rawMangaId.replace(/^3asq_/, "");
          const chRes = await fetch(`https://3asq.online/manga/${slug}/ajax/chapters/`, {
            method: "POST",
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            signal: AbortSignal.timeout(10000)
          });
          if (chRes.ok) {
            const html = await chRes.text();
            const chMatches = [...html.matchAll(/<li[^>]*class="wp-manga-chapter[^"]*"[^>]*>[\s\S]*?<a href="([^"]+)">([^<]+)<\/a>/g)];
            fetchedChapters = chMatches.map(match => {
              const chUrl = match[1];
              const chTitle = match[2].trim();
              const chSlug = chUrl.replace(/\/$/, "").split("/").pop() || "";
              const numMatch = chTitle.match(/([\d.]+)/);
              return {
                id: `3asq_${slug}_${chSlug}`,
                name: chTitle,
                chapterNumber: numMatch ? parseFloat(numMatch[1]) : 0,
                pageCount: 0,
                uploadDate: Date.now(),
                provider: "3asq"
              };
            });
          }
        } else if ((m as any).provider === "mangadex" || rawMangaId.startsWith("mangadex_") || sId.includes("mangadex")) {
          const uuid = rawMangaId.replace(/^mangadex_/, "");
          const mdRes = await fetch(`https://api.mangadex.org/manga/${uuid}/feed?limit=500&order[chapter]=desc&includes[]=scanlation_group`, {
            headers: { "User-Agent": "MangaReaderApp/1.0" },
            signal: AbortSignal.timeout(10000)
          });
          if (mdRes.ok) {
            const mdData = await mdRes.json();
            fetchedChapters = (mdData.data || []).map((c: any) => ({
              id: `md_${c.id}`,
              name: c.attributes?.title || `الفصل ${c.attributes?.chapter || ""}`,
              chapterNumber: parseFloat(c.attributes?.chapter || "0"),
              pageCount: c.attributes?.pages || 0,
              uploadDate: c.attributes?.publishAt ? new Date(c.attributes.publishAt).getTime() : Date.now(),
              provider: "mangadex"
            }));
          }
        }
      } catch (err: any) {
        sourceStatus = "error";
        errorMsg = err.message || "فشل الاتصال بالمصدر";
      }

      // Filter out invalid/empty/ghost chapters - ONLY REAL CHAPTERS FROM SOURCE
      const validChapters = fetchedChapters.filter((c: any) => {
        if (!c || c.id === undefined || c.id === null) return false;
        const hasNum = c.chapterNumber !== undefined && c.chapterNumber !== null && !isNaN(parseFloat(c.chapterNumber));
        const hasName = c.name && typeof c.name === "string" && c.name.trim().length > 0;
        return hasNum || hasName;
      });

      if (validChapters.length > 0) {
        sourceStatus = "ok";
      }

      sourcesChecked.push({
        sourceId: sId,
        sourceName: sName,
        sourceLanguage: sLang,
        chaptersFound: validChapters.length,
        status: sourceStatus,
        error: errorMsg
      });

      // Integrate into unifiedChapterMap with DEDUPLICATION
      for (const c of validChapters) {
        const cIdStr = String(c.id);
        const num = typeof c.chapterNumber === "number" ? c.chapterNumber : parseFloat(c.chapterNumber);
        const hasValidNum = !isNaN(num);

        // Key for deduplication: use normalized chapter number if valid, otherwise sanitized title
        const dedupeKey = hasValidNum
          ? `ch_${num}`
          : `title_${(c.name || '').trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '')}`;

        // Cache chapter metadata for reader streaming
        chapterCache.set(cIdStr, {
          mangaId: rawMangaId,
          sourceOrder: c.sourceOrder ?? 1,
          pageCount: c.pageCount > 0 ? c.pageCount : 0,
          updatedAt: Date.now()
        });

        // Clean chapter title: No boilerplate text, clean number format
        let cleanTitle = (c.name || "").trim();
        if (!cleanTitle || cleanTitle.toLowerCase() === "null") {
          cleanTitle = hasValidNum ? `الفصل ${num}` : "فصل بدون عنوان";
        }

        const chUniqueId = String(c.id).startsWith("suwayomi_") ||
          String(c.id).startsWith("weebcentral_") ||
          String(c.id).startsWith("comick_") ||
          String(c.id).startsWith("3asq_") ||
          String(c.id).startsWith("md_")
            ? String(c.id)
            : `suwayomi_${c.id}`;

        const sourceItem = {
          sourceId: sId,
          sourceName: sName,
          sourceLanguage: sLang,
          chapterId: chUniqueId,
          rawId: cIdStr,
          mangaId: rawMangaId,
          pageCount: c.pageCount > 0 ? c.pageCount : 0,
          uploadDate: c.uploadDate || 0,
          url: c.realUrl || c.url || ""
        };

        if (unifiedChapterMap.has(dedupeKey)) {
          // CHAPTER ALREADY EXISTS: Do NOT duplicate the chapter!
          // Append this source to availableSources
          const existing = unifiedChapterMap.get(dedupeKey);
          const alreadyHasSource = existing.availableSources.some((s: any) => s.sourceId === sId);
          if (!alreadyHasSource) {
            existing.availableSources.push(sourceItem);
          }
          // Prioritize primary source (e.g. Arabic source preference or higher page count)
          if (sLang === "ar" && existing.primarySource.sourceLanguage !== "ar") {
            existing.primarySource = sourceItem;
            existing.id = chUniqueId;
            existing.rawId = cIdStr;
            existing.mangaId = rawMangaId;
          }
        } else {
          // New unique chapter
          unifiedChapterMap.set(dedupeKey, {
            id: chUniqueId,
            rawId: cIdStr,
            mangaId: rawMangaId,
            chapterNumber: hasValidNum ? String(num) : String(c.chapterNumber ?? ""),
            numericNumber: hasValidNum ? num : 0,
            title: cleanTitle,
            pageCount: c.pageCount > 0 ? c.pageCount : 0,
            uploadDate: c.uploadDate || 0,
            primarySource: sourceItem,
            availableSources: [sourceItem],
            provider: (c as any).provider || "suwayomi"
          });
        }
      }
    })
  );

  // Convert map to sorted array (descending by chapter number by default)
  const unifiedChapters = Array.from(unifiedChapterMap.values()).sort((a, b) => {
    return b.numericNumber - a.numericNumber;
  });

  return res.json({
    success: true,
    title: title || (mangas[0]?.sourceName ? `عمل من ${mangas[0].sourceName}` : "العمل المطلوب"),
    totalUniqueChapters: unifiedChapters.length,
    sourcesChecked,
    chapters: unifiedChapters
  });
}

suwayomiRouter.post("/aggregate-chapters", async (req: Request, res: Response) => {
  return handleAggregateChapters(req, res);
});

suwayomiRouter.get("/aggregate-chapters", async (req: Request, res: Response) => {
  return handleAggregateChapters(req, res);
});

// 14. Suwayomi Proxy Handler for Embedded Web UI with Auto Chapter Interception
export async function handleSuwayomiEmbed(req: Request, res: Response) {
  const suwayomiUrl = DEFAULT_SUWAYOMI_URL;
  // Subpath inside suwayomi-embed
  const rawSubPath = req.originalUrl.replace(/^\/suwayomi-embed/, "") || "/";
  const [cleanPath] = rawSubPath.split("?");

  // Handle embedded GraphQL calls (when relative api/graphql is requested)
  if (cleanPath === "/api/graphql" || cleanPath === "/graphql" || cleanPath.startsWith("/api/graphql")) {
    return handleSuwayomiGraphQLProxy(req, res);
  }

  // Handle embedded REST API v1 or any /api/ calls
  if (cleanPath.startsWith("/api/v1") || cleanPath.startsWith("/api/")) {
    return handleSuwayomiV1Proxy(req, res);
  }

  const isAsset = /\.(js|css|png|jpg|jpeg|svg|ico|json|woff|woff2|ttf|wasm|webmanifest)$/i.test(cleanPath) ||
    cleanPath.startsWith("/assets/") ||
    cleanPath.startsWith("/favicon") ||
    cleanPath.includes("manifest");

  try {
    if (isAsset) {
      // Proxy static asset directly
      const assetUrl = `${suwayomiUrl}${cleanPath.startsWith("/") ? cleanPath : "/" + cleanPath}`;
      const assetRes = await fetch(assetUrl);
      if (!assetRes.ok) {
        return res.status(assetRes.status).send(`Asset error ${assetRes.statusText}`);
      }
      const ct = assetRes.headers.get("content-type");
      if (ct) res.setHeader("Content-Type", ct);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");
      const buffer = await assetRes.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }

    // HTML entry point: Fetch index.html, inject base and interceptor script
    const htmlRes = await fetch(`${suwayomiUrl}/`);
    let html = await htmlRes.text();

    // Disable the service worker inside the iframe to avoid security / cross-origin sandbox errors
    html = html.replace(/<script[^>]*registerSW\.js[^>]*><\/script>/gi, "<!-- ServiceWorker disabled in iframe proxy -->");
    html = html.replace(/navigator\.serviceWorker\.register/g, "(function(){return Promise.reject('SW disabled in iframe')})");

    // Replace base href to work under /suwayomi-embed/
    html = html.replace('<base href="/">', '<base href="/suwayomi-embed/">');

    // Injected interceptor script to capture chapter clicks and notify parent window
    const interceptorScript = `
      <script>
        (function() {
          console.log("[Suwayomi Auto-Chapter Interceptor Active]");
          
          function checkChapter(urlStr) {
            if (!urlStr) return;
            const match = urlStr.match(/\\/manga\\/(\\d+)\\/chapter\\/(\\d+)/i) || urlStr.match(/\\/chapter\\/(\\d+)/i);
            if (match) {
              const chapterId = match[2] || match[1];
              const mangaId = match[1];
              try {
                window.parent.postMessage({
                  type: "SUWAYOMI_AUTO_OPEN_CHAPTER",
                  chapterId: chapterId,
                  mangaId: mangaId,
                  url: urlStr
                }, "*");
              } catch(e) {}
            }
          }

          // Hook pushState & replaceState
          var origPush = history.pushState;
          history.pushState = function() {
            origPush.apply(this, arguments);
            setTimeout(function() { checkChapter(window.location.href); }, 50);
          };
          var origReplace = history.replaceState;
          history.replaceState = function() {
            origReplace.apply(this, arguments);
            setTimeout(function() { checkChapter(window.location.href); }, 50);
          };
          window.addEventListener("popstate", function() {
            setTimeout(function() { checkChapter(window.location.href); }, 50);
          });

          // Intercept click on links or chapter rows
          document.addEventListener("click", function(e) {
            var el = e.target.closest("a, button, [role='button']");
            if (!el) return;
            var href = el.getAttribute("href") || (el.tagName === "A" ? el.href : "");
            if (href) {
              var match = href.match(/\\/manga\\/(\\d+)\\/chapter\\/(\\d+)/i) || href.match(/\\/chapter\\/(\\d+)/i);
              if (match) {
                e.preventDefault();
                e.stopPropagation();
                checkChapter(href);
              }
            }
          }, true);

          setTimeout(function() { checkChapter(window.location.href); }, 600);
        })();
      </script>
    `;

    html = html.replace("</body>", `${interceptorScript}</body>`);

    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self' *;");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err: any) {
    return res.status(500).send(`Suwayomi Embed Proxy Error: ${err.message}`);
  }
}

// 15. GraphQL Upstream Proxy Handler
export async function handleSuwayomiGraphQLProxy(req: Request, res: Response) {
  const suwayomiUrl = DEFAULT_SUWAYOMI_URL;
  try {
    const headers: Record<string, string> = {
      "Content-Type": (req.headers["content-type"] as string) || "application/json",
      Accept: (req.headers["accept"] as string) || "application/json"
    };
    if (req.headers["authorization"]) {
      headers["Authorization"] = req.headers["authorization"] as string;
    }

    let bodyData: any = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
        bodyData = req.body;
      } else if (req.body && typeof req.body === "object") {
        bodyData = JSON.stringify(req.body);
      }
    }

    const upstreamRes = await fetch(`${suwayomiUrl}/api/graphql`, {
      method: req.method,
      headers,
      body: bodyData
    });

    const data = await upstreamRes.arrayBuffer();
    res.status(upstreamRes.status);
    const ct = upstreamRes.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.send(Buffer.from(data));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// 16. API v1 Upstream Proxy Handler
export async function handleSuwayomiV1Proxy(req: Request, res: Response) {
  const suwayomiUrl = DEFAULT_SUWAYOMI_URL;
  try {
    let subPath = req.originalUrl.replace(/^\/suwayomi-embed/, "");
    if (!subPath.startsWith("/")) subPath = "/" + subPath;
    const upstreamUrl = `${suwayomiUrl}${subPath}`;

    const headers: Record<string, string> = {};
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"] as string;
    if (req.headers["accept"]) headers["Accept"] = req.headers["accept"] as string;
    if (req.headers["authorization"]) headers["Authorization"] = req.headers["authorization"] as string;

    let bodyData: any = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
        bodyData = req.body;
      } else if (req.body && typeof req.body === "object") {
        bodyData = JSON.stringify(req.body);
      }
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: bodyData
    });

    const data = await upstreamRes.arrayBuffer();
    res.status(upstreamRes.status);
    const ct = upstreamRes.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.send(Buffer.from(data));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

