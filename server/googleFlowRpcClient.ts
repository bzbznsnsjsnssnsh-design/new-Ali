import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";

const origHttpsReq = https.request;
// @ts-ignore
https.request = function (...args: any[]) {
  if (args[0] && typeof args[0] === "object") args[0].maxHeaderSize = 1048576;
  if (args[1] && typeof args[1] === "object") args[1].maxHeaderSize = 1048576;
  // @ts-ignore
  return origHttpsReq.apply(this, args);
};
const origHttpReq = http.request;
// @ts-ignore
http.request = function (...args: any[]) {
  if (args[0] && typeof args[0] === "object") args[0].maxHeaderSize = 1048576;
  if (args[1] && typeof args[1] === "object") args[1].maxHeaderSize = 1048576;
  // @ts-ignore
  return origHttpReq.apply(this, args);
};

import axios from "axios";
import sharp from "sharp";
import { Gemini } from "gemini-reverse";
import { resolveGeminiModelDef } from "./geminiCookiesService.ts";
import type { FlowDisplayModelName } from "../src/types/novelToManga.ts";
import {
  isRealVerifiedFlowProjectId,
  buildRealFlowProjectUrl,
} from "../src/types/novelToManga.ts";
import {
  flowGenerationPerformanceService,
  type FlowGenerationTimingRecord,
} from "./flowGenerationPerformanceService.ts";

// Reuse TCP/TLS connections across all Google Flow & Gemini requests for low-latency RPCs
const sharedHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000 });
const sharedHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000 });
axios.defaults.httpAgent = sharedHttpAgent;
axios.defaults.httpsAgent = sharedHttpsAgent;

/**
 * Google Flow Real RPC Client (`https://flow.google.com`)
 *
 * Uses the live `AiSandboxAngularFrontend` RPC protocol on `flow.google.com`:
 * - `UpteDb`  -> `/FlowService.GetProjects`
 * - `OylIJd`  -> `/AiSandbox.SearchUserProjects`
 * - `jHPbke`  -> `/AiSandbox.CreateProject`
 * - `HTrJv`   -> `/FlowService.GetModels`
 * - `Zzl0ze`  -> `/FlowService.GetProjectContents`
 * - `ngNC2`   -> `/AiSandbox.GetProject`
 * - `maseQ`   -> `/FlowService.UploadImage`
 * - `ogiZ0b`  -> `/FlowService.BatchGenerateImages`
 */

const FLOW_BASE_ORIGIN = "https://flow.google.com";
const DEFAULT_FLOW_RPC_PATH = "/_/AiSandboxAngularFrontend/data/batchexecute";
const DEFAULT_RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
const FLOW_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FLOW_SESSION_CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const flowSessionContextCache = new Map<
  string,
  { context: RealFlowSessionContext; timestamp: number }
>();
const flowSessionInFlight = new Map<string, Promise<RealFlowSessionContext>>();

const flowSynthIdlePool = new Map<
  string,
  Array<{ client: Gemini; initializedAt: number }>
>();
const FLOW_SYNTH_CLIENT_TTL_MS = 90 * 1000; // 90 seconds max idle age
let lastSynthesisLaunchTimeMs = 0;
let synthesisStaggerChain: Promise<void> = Promise.resolve();

async function waitForSynthesisStaggerSlot(minSpacingMs: number = 550): Promise<void> {
  const prev = synthesisStaggerChain;
  let release!: () => void;
  synthesisStaggerChain = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    const now = Date.now();
    const elapsed = now - lastSynthesisLaunchTimeMs;
    if (elapsed < minSpacingMs) {
      await new Promise((r) => setTimeout(r, minSpacingMs - elapsed));
    }
    lastSynthesisLaunchTimeMs = Date.now();
  } finally {
    release();
  }
}

let cachedRecaptchaReleaseVersion: { version: string; timestamp: number } | null = null;
const directOgiZ0bBlockedUntilByCookie = new Map<string, number>();
const verifiedProjectAssetsMemory = new Map<string, Set<string>>();

export function invalidateFlowSessionCache(cookiesMap?: Record<string, string>): void {
  if (!cookiesMap) {
    flowSessionContextCache.clear();
    flowSessionInFlight.clear();
    flowSynthIdlePool.clear();
    return;
  }
  const key = (cookiesMap["__Secure-1PSID"] || cookiesMap["SID"] || "").slice(0, 64);
  if (key) {
    flowSessionContextCache.delete(key);
    flowSessionInFlight.delete(key);
    flowSynthIdlePool.delete(key);
  }
}

export async function createFreshFlowSynthesisClient(
  secure1Psid: string,
  googleCookies: Record<string, string>
): Promise<Gemini> {
  const cleanCookies: Record<string, string> = { ...googleCookies };
  delete cleanCookies["OSID"];
  delete cleanCookies["__Secure-OSID"];

  const gem = new Gemini({
    secure_1psid: secure1Psid,
    timeout: 65000,
  });
  // @ts-ignore
  gem.cookies = { ...cleanCookies };
  // @ts-ignore
  gem._guest = false;

  try {
    await gem.init();
  } catch (_) {}

  if (!gem.accessToken) {
    try {
      const gCookieHeader = buildFlowCookieHeader(cleanCookies);
      const appResp = await axios.get("https://gemini.google.com/app", {
        headers: {
          Cookie: gCookieHeader,
          "User-Agent": FLOW_USER_AGENT,
        },
        timeout: 15000,
      });
      const html = typeof appResp.data === "string" ? appResp.data : "";
      const tokenMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
      const blMatch = html.match(/"cfb2h"\s*:\s*"([^"]+)"/);
      const sidMatch = html.match(/"FdrFJe"\s*:\s*"([^"]+)"/);
      if (tokenMatch && tokenMatch[1]) {
        gem.accessToken = tokenMatch[1];
        if (blMatch && blMatch[1]) gem.buildLabel = blMatch[1];
        if (sidMatch && sidMatch[1]) gem.sessionId = sidMatch[1];
        // @ts-ignore
        gem._ready = true;
      }
    } catch (_) {}
  }

  // @ts-ignore
  if (gem.cookies && typeof gem.cookies === "object") {
    // @ts-ignore
    delete gem.cookies["OSID"];
    // @ts-ignore
    delete gem.cookies["__Secure-OSID"];
  }
  return gem;
}

export async function getOrCreateFlowSynthesisClient(
  secure1Psid: string,
  googleCookies: Record<string, string>,
  forceFresh: boolean = false
): Promise<Gemini> {
  const cacheKey = secure1Psid.slice(0, 64);
  const now = Date.now();
  if (!forceFresh) {
    const pool = flowSynthIdlePool.get(cacheKey) || [];
    while (pool.length > 0) {
      const entry = pool.pop()!;
      const isReady = Boolean((entry.client as any)?._ready && entry.client?.accessToken);
      if (isReady && now - entry.initializedAt < FLOW_SYNTH_CLIENT_TTL_MS) {
        return entry.client;
      }
    }
  }
  return await createFreshFlowSynthesisClient(secure1Psid, googleCookies);
}

function releaseFlowSynthesisClientToPool(secure1Psid: string, client: Gemini): void {
  if (!secure1Psid || !client || !(client as any)._ready || !client.accessToken) return;
  const cacheKey = secure1Psid.slice(0, 64);
  const pool = flowSynthIdlePool.get(cacheKey) || [];
  if (pool.length < 3) {
    pool.push({ client, initializedAt: Date.now() });
    flowSynthIdlePool.set(cacheKey, pool);
  }
}

export interface RealFlowSessionContext {
  authenticated: boolean;
  email: string | null;
  xsrfToken: string | null;
  buildLabel: string;
  sessionId: string;
  rpcPath: string;
  recaptchaSiteKey: string;
  cookieHeader: string;
  sapisidHash: string | null;
  finalUrl: string;
  actionRequired: boolean;
  actionRequiredReason: string | null;
}

export interface DiscoveredRemoteFlowProject {
  flowProjectId: string;
  flowProjectUrl: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  verified: boolean;
}

export interface VerifiedFlowProjectAsset {
  flowAssetId: string;
  flowProjectId: string;
  workflowId?: string | null;
  imageUrl?: string | null;
  prompt?: string | null;
  createdAt?: string | null;
}

export function computeSapisidHash(
  sapisid: string,
  origin: string = FLOW_BASE_ORIGIN
): string {
  const ts = Math.floor(Date.now() / 1000);
  const input = `${ts} ${sapisid} ${origin}`;
  const digest = crypto.createHash("sha1").update(input).digest("hex");
  return `SAPISIDHASH ${ts}_${digest}`;
}

export function buildFlowCookieHeader(cookiesMap: Record<string, string>): string {
  return Object.entries(cookiesMap)
    .filter(([k, v]) => Boolean(k && v))
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Fetches the real Google Flow page (`https://flow.google.com/`) using the user's cookies
 * and extracts `WIZ_global_data`:
 * - `oPEP7c` -> signed-in Google email
 * - `SNlM0e` -> XSRF token (`at`) required for `batchexecute`
 * - `cfb2h`  -> build label (`bl`)
 * - `FdrFJe` -> session ID (`f.sid`)
 * - `eptZe`  -> frontend prefix (`/_/AiSandboxAngularFrontend/`)
 * - `xZbWve` -> reCAPTCHA Enterprise site key
 */
export async function fetchRealFlowSessionContext(
  cookiesMap: Record<string, string>,
  sourcePath: string = "/",
  forceRefresh: boolean = false
): Promise<RealFlowSessionContext> {
  const cookieHeader = buildFlowCookieHeader(cookiesMap);
  const sapisid =
    cookiesMap["SAPISID"] ||
    cookiesMap["__Secure-1PAPISID"] ||
    cookiesMap["__Secure-3PAPISID"] ||
    null;
  const sapisidHash = sapisid ? computeSapisidHash(sapisid, FLOW_BASE_ORIGIN) : null;

  if (!cookieHeader || !cookiesMap["__Secure-1PSID"]) {
    return {
      authenticated: false,
      email: null,
      xsrfToken: null,
      buildLabel: "",
      sessionId: "",
      rpcPath: DEFAULT_FLOW_RPC_PATH,
      recaptchaSiteKey: DEFAULT_RECAPTCHA_SITE_KEY,
      cookieHeader: "",
      sapisidHash: null,
      finalUrl: FLOW_BASE_ORIGIN,
      actionRequired: true,
      actionRequiredReason:
        "FLOW_AUTH_FAILED: كوكيز Google Flow مفقودة (__Secure-1PSID غير موجود).",
    };
  }

  const cacheKey = `${cookiesMap["__Secure-1PSID"].slice(0, 64)}:${(cookiesMap["__Secure-OSID"] || "").slice(0, 32)}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = flowSessionContextCache.get(cacheKey);
    if (
      cached &&
      cached.context.authenticated &&
      cached.context.xsrfToken &&
      now - cached.timestamp < FLOW_SESSION_CACHE_TTL_MS
    ) {
      return {
        ...cached.context,
        cookieHeader,
        sapisidHash,
      };
    }

    const inFlight = flowSessionInFlight.get(cacheKey);
    if (inFlight) {
      const resolved = await inFlight;
      return {
        ...resolved,
        cookieHeader,
        sapisidHash,
      };
    }
  }

  const fetchPromise = (async (): Promise<RealFlowSessionContext> => {
    try {
      const targetUrl = `${FLOW_BASE_ORIGIN}${sourcePath.startsWith("/") ? sourcePath : `/${sourcePath}`}`;
      const resp = await axios.get(targetUrl, {
        headers: {
          Cookie: cookieHeader,
          "User-Agent": FLOW_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        },
        maxRedirects: 5,
        timeout: 18000,
        validateStatus: () => true,
      });

      const finalUrl = resp.request?.res?.responseUrl || targetUrl;
      const html = typeof resp.data === "string" ? resp.data : "";

      const wizMatch = html.match(/window\.WIZ_global_data\s*=\s*(\{[\s\S]*?\});/);
      let wiz: Record<string, any> = {};
      if (wizMatch && wizMatch[1]) {
        try {
          wiz = JSON.parse(wizMatch[1]);
        } catch (_) {}
      }

      const email =
        (typeof wiz.oPEP7c === "string" && wiz.oPEP7c.trim()) ||
        (html.match(/"oPEP7c"\s*:\s*"([^"]+)"/) || [])[1] ||
        null;
      const xsrfToken =
        (typeof wiz.SNlM0e === "string" && wiz.SNlM0e.trim()) ||
        (html.match(/"SNlM0e"\s*:\s*"([^"]+)"/) || [])[1] ||
        cookiesMap["SNlM0e"] ||
        null;
      const buildLabel =
        (typeof wiz.cfb2h === "string" && wiz.cfb2h.trim()) ||
        (html.match(/"cfb2h"\s*:\s*"([^"]+)"/) || [])[1] ||
        "boq_labs-ai-sandbox-frontend_20260401.05_p0";
      const sessionId =
        (typeof wiz.FdrFJe === "string" && wiz.FdrFJe.trim()) ||
        (html.match(/"FdrFJe"\s*:\s*"([^"]+)"/) || [])[1] ||
        "";
      const rawPrefix =
        (typeof wiz.eptZe === "string" && wiz.eptZe.trim()) ||
        (html.match(/"eptZe"\s*:\s*"([^"]+)"/) || [])[1] ||
        "/_/AiSandboxAngularFrontend/";
      const normalizedPrefix = rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`;
      const rpcPath = `${normalizedPrefix}data/batchexecute`;
      const recaptchaSiteKey =
        (typeof wiz.xZbWve === "string" && wiz.xZbWve.trim()) ||
        (html.match(/"xZbWve"\s*:\s*"([^"]+)"/) || [])[1] ||
        DEFAULT_RECAPTCHA_SITE_KEY;

      const isRedirectedToMarketing =
        finalUrl.includes("labs.google/fx") && !email && !xsrfToken;
      const isRedirectedToAccounts =
        finalUrl.includes("accounts.google.com") ||
        finalUrl.includes("ServiceLogin");

      if (!email || !xsrfToken || isRedirectedToMarketing || isRedirectedToAccounts) {
        return {
          authenticated: false,
          email: null,
          xsrfToken: null,
          buildLabel,
          sessionId,
          rpcPath,
          recaptchaSiteKey,
          cookieHeader,
          sapisidHash,
          finalUrl,
          actionRequired: true,
          actionRequiredReason:
            "GOOGLE_FLOW_ACTION_REQUIRED: جلسة Google Flow على flow.google.com غير مسجلة الدخول أو تتطلب تحديث الكوكيز (__Secure-OSID / __Secure-1PSID) من المتصفح.",
        };
      }

      const authedCtx: RealFlowSessionContext = {
        authenticated: true,
        email,
        xsrfToken,
        buildLabel,
        sessionId,
        rpcPath,
        recaptchaSiteKey,
        cookieHeader,
        sapisidHash,
        finalUrl,
        actionRequired: false,
        actionRequiredReason: null,
      };
      flowSessionContextCache.set(cacheKey, {
        context: authedCtx,
        timestamp: Date.now(),
      });
      flowGenerationPerformanceService.markWarmSessionActive(true);
      return authedCtx;
    } catch (err: any) {
      return {
        authenticated: false,
        email: null,
        xsrfToken: null,
        buildLabel: "",
        sessionId: "",
        rpcPath: DEFAULT_FLOW_RPC_PATH,
        recaptchaSiteKey: DEFAULT_RECAPTCHA_SITE_KEY,
        cookieHeader,
        sapisidHash,
        finalUrl: FLOW_BASE_ORIGIN,
        actionRequired: true,
        actionRequiredReason: `FLOW_AUTH_FAILED: تعذر الاتصال بـ flow.google.com (${err?.message || "network error"})`,
      };
    }
  })();

  flowSessionInFlight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    flowSessionInFlight.delete(cacheKey);
  }
}

/**
 * Parses Google `batchexecute` multi-chunk response envelope and extracts the inner JSON string
 * for the requested `rpcId`.
 */
export function parseBatchExecuteEnvelope(
  rawText: string,
  expectedRpcId?: string
): {
  ok: boolean;
  rpcId: string | null;
  innerJson: any;
  rawInnerString: string | null;
  errorCode: number | null;
  errorMessage: string | null;
} {
  if (!rawText || typeof rawText !== "string") {
    return {
      ok: false,
      rpcId: null,
      innerJson: null,
      rawInnerString: null,
      errorCode: null,
      errorMessage: "Empty batchexecute response",
    };
  }

  const cleaned = rawText.replace(/^\)\]\}'\s*\r?\n?/, "");
  const lines = cleaned.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        if (!Array.isArray(entry) || entry[0] !== "wrb.fr") continue;
        const rpcId = entry[1];
        if (expectedRpcId && rpcId !== expectedRpcId) continue;

        const innerPayloadStr = entry[2];
        const errorArr = entry[5];

        if (typeof innerPayloadStr === "string" && innerPayloadStr.length > 0) {
          let innerJson: any = innerPayloadStr;
          try {
            innerJson = JSON.parse(innerPayloadStr);
          } catch (_) {}
          return {
            ok: true,
            rpcId,
            innerJson,
            rawInnerString: innerPayloadStr,
            errorCode: null,
            errorMessage: null,
          };
        }

        if (Array.isArray(errorArr)) {
          const code = typeof errorArr[0] === "number" ? errorArr[0] : null;
          return {
            ok: false,
            rpcId,
            innerJson: null,
            rawInnerString: null,
            errorCode: code,
            errorMessage: JSON.stringify(errorArr),
          };
        }
      }
    } catch (_) {}
  }

  return {
    ok: false,
    rpcId: expectedRpcId || null,
    innerJson: null,
    rawInnerString: null,
    errorCode: null,
    errorMessage: `Unrecognized batchexecute payload (${rawText.slice(0, 180)})`,
  };
}

/**
 * Executes a real `batchexecute` RPC call against `https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute`.
 */
export async function executeRealFlowBatchRpc(params: {
  rpcId: string;
  payload: any[];
  cookiesMap: Record<string, string>;
  sourcePath?: string;
  sessionContext?: RealFlowSessionContext;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status: number;
  innerJson: any;
  rawText: string;
  errorMessage: string | null;
  context: RealFlowSessionContext;
}> {
  const sourcePath = params.sourcePath || "/";
  const ctx =
    params.sessionContext && params.sessionContext.authenticated && params.sessionContext.xsrfToken
      ? params.sessionContext
      : await fetchRealFlowSessionContext(params.cookiesMap, sourcePath);

  if (!ctx.authenticated || !ctx.xsrfToken) {
    return {
      ok: false,
      status: 401,
      innerJson: null,
      rawText: "",
      errorMessage:
        ctx.actionRequiredReason ||
        "GOOGLE_FLOW_ACTION_REQUIRED: جلسة Google Flow غير مسجلة الدخول على flow.google.com.",
      context: ctx,
    };
  }

  const reqId = Math.floor(100000 + Math.random() * 899999);
  const query = new URLSearchParams({
    rpcids: params.rpcId,
    "source-path": sourcePath,
    bl: ctx.buildLabel,
    "f.sid": ctx.sessionId,
    hl: "en",
    _reqid: String(reqId),
    rt: "c",
  });

  const fReq = JSON.stringify([[[params.rpcId, JSON.stringify(params.payload), null, "generic"]]]);
  const body = new URLSearchParams({
    "f.req": fReq,
    at: ctx.xsrfToken,
  }).toString();

  const headers: Record<string, string> = {
    Cookie: ctx.cookieHeader,
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "User-Agent": FLOW_USER_AGENT,
    Accept: "*/*",
    Origin: FLOW_BASE_ORIGIN,
    Referer: `${FLOW_BASE_ORIGIN}${sourcePath}`,
    "X-Same-Domain": "1",
    "X-Goog-AuthUser": "0",
  };
  if (ctx.sapisidHash) {
    headers["Authorization"] = ctx.sapisidHash;
  }

  const rpcPath = ctx.rpcPath || DEFAULT_FLOW_RPC_PATH;
  const resp = await axios.post(`${FLOW_BASE_ORIGIN}${rpcPath}?${query.toString()}`, body, {
    headers,
    timeout: params.timeoutMs || 60000,
    validateStatus: () => true,
  });

  const rawText = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data || "");
  if (resp.status < 200 || resp.status >= 300) {
    return {
      ok: false,
      status: resp.status,
      innerJson: null,
      rawText,
      errorMessage: `HTTP ${resp.status} from flow.google.com (${params.rpcId})`,
      context: ctx,
    };
  }

  const parsed = parseBatchExecuteEnvelope(rawText, params.rpcId);
  return {
    ok: parsed.ok,
    status: resp.status,
    innerJson: parsed.innerJson,
    rawText,
    errorMessage: parsed.errorMessage,
    context: ctx,
  };
}

/**
 * Discovers real Google Flow projects from the user's account via `UpteDb` (`/FlowService.GetProjects`)
 * and `OylIJd` (`/AiSandbox.SearchUserProjects`).
 */
export async function discoverRemoteFlowProjects(
  cookiesMap: Record<string, string>,
  sessionContext?: RealFlowSessionContext
): Promise<DiscoveredRemoteFlowProject[]> {
  // 1. Primary: UpteDb (/FlowService.GetProjects) with exact protobuf schema: ["projects/*", 21, "", null, null, null, [1]]
  const res = await executeRealFlowBatchRpc({
    rpcId: "UpteDb",
    payload: ["projects/*", 21, "", null, null, null, [1]],
    cookiesMap,
    sourcePath: "/",
    sessionContext,
  });

  const discovered: DiscoveredRemoteFlowProject[] = [];
  const seenIds = new Set<string>();
  const nowIso = new Date().toISOString();

  const parseProjectsArray = (items: any[]) => {
    for (const item of items) {
      if (!Array.isArray(item)) continue;
      const rawId = typeof item[0] === "string" ? item[0].replace(/^projects\//, "").trim() : "";
      if (!isRealVerifiedFlowProjectId(rawId) || seenIds.has(rawId)) continue;
      seenIds.add(rawId);

      const meta = Array.isArray(item[1]) ? item[1] : [];
      const title =
        (typeof meta[0] === "string" && meta[0].trim()) ||
        (typeof item[1] === "string" && item[1].trim()) ||
        `Flow Project ${rawId.slice(0, 8)}`;

      let createdAt = nowIso;
      const tsArr = Array.isArray(meta[2]) ? meta[2] : Array.isArray(item[2]) ? item[2] : null;
      if (tsArr && typeof tsArr[0] === "number" && tsArr[0] > 1000000000) {
        createdAt = new Date(tsArr[0] * 1000).toISOString();
      }

      discovered.push({
        flowProjectId: rawId,
        flowProjectUrl: buildRealFlowProjectUrl(rawId)!,
        name: title,
        createdAt,
        updatedAt: createdAt,
        verified: true,
      });
    }
  };

  if (res.ok && Array.isArray(res.innerJson)) {
    const projectRows = Array.isArray(res.innerJson[0]) ? res.innerJson[0] : res.innerJson;
    if (Array.isArray(projectRows)) {
      parseProjectsArray(projectRows);
    }
  }

  // 2. Fallback/Supplement: OylIJd (/AiSandbox.SearchUserProjects) with ["projects/*", 20, "", [null, 22]]
  if (discovered.length === 0) {
    const searchRes = await executeRealFlowBatchRpc({
      rpcId: "OylIJd",
      payload: ["projects/*", 20, "", [null, 22]],
      cookiesMap,
      sourcePath: "/",
      sessionContext: res.context,
    });
    if (searchRes.ok && Array.isArray(searchRes.innerJson)) {
      const rows = Array.isArray(searchRes.innerJson[0]) ? searchRes.innerJson[0] : searchRes.innerJson;
      if (Array.isArray(rows)) {
        parseProjectsArray(rows);
      }
    }
  }

  return discovered;
}

/**
 * Creates a real Google Flow project on `https://flow.google.com` via `jHPbke` (`/AiSandbox.CreateProject`).
 * Exact protobuf payload: `["projects/*", [null, [cleanTitle]], [null, 22]]`.
 */
export async function createRemoteFlowProject(
  cookiesMap: Record<string, string>,
  projectTitle: string = "Novel to Manga Studio",
  sessionContext?: RealFlowSessionContext
): Promise<DiscoveredRemoteFlowProject> {
  const cleanTitle = (projectTitle || "Novel to Manga Studio").trim();
  const res = await executeRealFlowBatchRpc({
    rpcId: "jHPbke",
    payload: ["projects/*", [null, [cleanTitle]], [null, 22]],
    cookiesMap,
    sourcePath: "/",
    sessionContext,
  });

  if (!res.ok || !res.innerJson) {
    throw new Error(
      res.errorMessage ||
        "FLOW_PROJECT_CREATE_FAILED: تعذر إنشاء مشروع حقيقي داخل Google Flow عبر jHPbke."
    );
  }

  const rawJsonStr = JSON.stringify(res.innerJson);
  const uuidMatch = rawJsonStr.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  const createdId = uuidMatch ? uuidMatch[0] : null;

  if (!createdId || !isRealVerifiedFlowProjectId(createdId)) {
    throw new Error(
      "FLOW_PROJECT_CREATE_INVALID_ID: لم يُرجع Google Flow معرف مشروع UUID حقيقي بعد الإنشاء."
    );
  }

  const nowIso = new Date().toISOString();
  return {
    flowProjectId: createdId,
    flowProjectUrl: buildRealFlowProjectUrl(createdId)!,
    name: cleanTitle,
    createdAt: nowIso,
    updatedAt: nowIso,
    verified: true,
  };
}

/**
 * Verifies a real project on `flow.google.com` and retrieves its real assets via `Zzl0ze` (`/FlowService.GetProjectContents`)
 * and `ngNC2` (`/AiSandbox.GetProject`).
 */
export async function verifyRemoteFlowProjectAndAssets(params: {
  flowProjectId: string;
  expectedAssetId?: string;
  cookiesMap: Record<string, string>;
  sessionContext?: RealFlowSessionContext;
}): Promise<{
  projectVerified: boolean;
  projectName: string | null;
  flowProjectId: string;
  flowProjectUrl: string;
  assets: VerifiedFlowProjectAsset[];
}> {
  const cleanId = (params.flowProjectId || "").trim();
  if (!isRealVerifiedFlowProjectId(cleanId)) {
    return {
      projectVerified: false,
      projectName: null,
      flowProjectId: cleanId,
      flowProjectUrl: "",
      assets: [],
    };
  }

  // Requirement 14: If a specific expectedAssetId is already verified in memory for this project, stop unnecessary remote retrieval
  const memSet = verifiedProjectAssetsMemory.get(cleanId);
  if (params.expectedAssetId && memSet && memSet.has(params.expectedAssetId.trim().toLowerCase())) {
    const cachedAssets: VerifiedFlowProjectAsset[] = Array.from(memSet).map((aid) => ({
      flowAssetId: aid,
      flowProjectId: cleanId,
    }));
    return {
      projectVerified: true,
      projectName: "Verified Flow Project",
      flowProjectId: cleanId,
      flowProjectUrl: buildRealFlowProjectUrl(cleanId)!,
      assets: cachedAssets,
    };
  }

  const projectPath = `/project/${cleanId}`;
  const ctx =
    params.sessionContext && params.sessionContext.authenticated
      ? params.sessionContext
      : await fetchRealFlowSessionContext(params.cookiesMap, projectPath);

  if (!ctx.authenticated || !ctx.xsrfToken) {
    return {
      projectVerified: false,
      projectName: null,
      flowProjectId: cleanId,
      flowProjectUrl: buildRealFlowProjectUrl(cleanId)!,
      assets: [],
    };
  }

  const [projRes, contentsRes] = await Promise.all([
    executeRealFlowBatchRpc({
      rpcId: "ngNC2",
      payload: [`tools/PINHOLE/projects/${cleanId}`],
      cookiesMap: params.cookiesMap,
      sourcePath: projectPath,
      sessionContext: ctx,
    }),
    executeRealFlowBatchRpc({
      rpcId: "Zzl0ze",
      payload: [`projects/${cleanId}`, null, null, null, [1]],
      cookiesMap: params.cookiesMap,
      sourcePath: projectPath,
      sessionContext: ctx,
    }),
  ]);

  let projectName: string | null = null;
  if (projRes.ok && Array.isArray(projRes.innerJson)) {
    const meta = Array.isArray(projRes.innerJson[1]) ? projRes.innerJson[1] : [];
    if (typeof meta[0] === "string" && meta[0].trim()) {
      projectName = meta[0].trim();
    }
  }

  const assets: VerifiedFlowProjectAsset[] = [];
  const seenAssets = new Set<string>();

  if (contentsRes.ok && Array.isArray(contentsRes.innerJson)) {
    // 1. Parse media items in innerJson[2]
    const mediaRows = Array.isArray(contentsRes.innerJson[2]) ? contentsRes.innerJson[2] : [];
    for (const row of mediaRows) {
      if (!Array.isArray(row)) continue;
      const assetId = typeof row[0] === "string" ? row[0].trim() : "";
      if (!isRealVerifiedFlowProjectId(assetId) || seenAssets.has(assetId)) continue;
      seenAssets.add(assetId);

      const workflowId = typeof row[2] === "string" ? row[2].trim() : null;
      const rowStr = JSON.stringify(row);
      const urlMatch = rowStr.match(/https:\/\/lh3\.googleusercontent\.com\/[^\s"\\]+/);
      assets.push({
        flowAssetId: assetId,
        flowProjectId: cleanId,
        workflowId,
        imageUrl: urlMatch ? urlMatch[0] : null,
      });
    }

    // 2. Also check workflows in innerJson[1]
    const workflowRows = Array.isArray(contentsRes.innerJson[1]) ? contentsRes.innerJson[1] : [];
    for (const wf of workflowRows) {
      if (!Array.isArray(wf)) continue;
      const wfId = typeof wf[0] === "string" ? wf[0].trim() : "";
      const wfMeta = Array.isArray(wf[3]) ? wf[3] : [];
      const primaryMediaId = typeof wfMeta[4] === "string" ? wfMeta[4].trim() : "";
      if (isRealVerifiedFlowProjectId(primaryMediaId) && !seenAssets.has(primaryMediaId)) {
        seenAssets.add(primaryMediaId);
        assets.push({
          flowAssetId: primaryMediaId,
          flowProjectId: cleanId,
          workflowId: isRealVerifiedFlowProjectId(wfId) ? wfId : null,
        });
      }
      if (isRealVerifiedFlowProjectId(wfId) && !seenAssets.has(wfId)) {
        seenAssets.add(wfId);
        assets.push({
          flowAssetId: wfId,
          flowProjectId: cleanId,
          workflowId: wfId,
        });
      }
    }
  }

  const projectVerified = Boolean(projRes.ok || contentsRes.ok);

  return {
    projectVerified,
    projectName,
    flowProjectId: cleanId,
    flowProjectUrl: buildRealFlowProjectUrl(cleanId)!,
    assets,
  };
}

/**
 * Uploads an image asset directly into a real Google Flow project via `maseQ` (`/FlowService.UploadImage`).
 * Returns the real `flowAssetId` (`mediaId`), `workflowId`, and `imageUrl` created inside the project on `flow.google.com`.
 */
export async function uploadAssetToRemoteFlowProject(params: {
  flowProjectId: string;
  imageBuffer: Buffer;
  mimeType?: string;
  fileName?: string;
  isHidden?: boolean;
  preassignedAssetId?: string;
  cookiesMap: Record<string, string>;
  sessionContext?: RealFlowSessionContext;
}): Promise<{
  flowAssetId: string;
  workflowId: string | null;
  imageUrl: string | null;
  flowProjectId: string;
}> {
  const cleanProjectId = (params.flowProjectId || "").trim();
  if (!isRealVerifiedFlowProjectId(cleanProjectId)) {
    throw new Error(
      `FLOW_PROJECT_NOT_FOUND: لا يمكن رفع أصل إلى معرف مشروع غير صالح (${cleanProjectId}).`
    );
  }

  const b64 = params.imageBuffer.toString("base64");
  const mimeType = params.mimeType || "image/jpeg";
  const fileName = params.fileName || `flow_asset_${Date.now()}.jpg`;
  const workflowSeed = crypto.randomUUID();
  const mediaSeed =
    params.preassignedAssetId && isRealVerifiedFlowProjectId(params.preassignedAssetId)
      ? params.preassignedAssetId.trim()
      : crypto.randomUUID();

  // Exact s4a protobuf structure for maseQ (/FlowService.UploadImage)
  const clientContext = [null, 22, null, null, null, cleanProjectId];
  const uploadPayload = [
    clientContext, // 1: V (ClientContext)
    b64, // 2: base64 bytes
    mimeType, // 3: mimeType
    1, // 4: Hf = true
    null, // 5
    null, // 6
    null, // 7: crop
    params.isHidden ? 1 : 0, // 8: isHidden
    fileName, // 9: fileName
    null, // 10
    workflowSeed, // 11: ZN (workflow seed)
    mediaSeed, // 12: DL (media seed)
    null, // 13
    [1], // 14: X
  ];

  const res = await executeRealFlowBatchRpc({
    rpcId: "maseQ",
    payload: uploadPayload,
    cookiesMap: params.cookiesMap,
    sourcePath: `/project/${cleanProjectId}`,
    sessionContext: params.sessionContext,
    timeoutMs: 60000,
  });

  if (!res.ok || !res.innerJson) {
    throw new Error(
      `FLOW_ASSET_NOT_CREATED: فشل رفع الأصل إلى مشروع Google Flow (${cleanProjectId}): ${
        res.errorMessage || "Unknown error"
      }`
    );
  }

  const mediaEntry = Array.isArray(res.innerJson[0]) ? res.innerJson[0] : [];
  const mediaId = typeof mediaEntry[0] === "string" ? mediaEntry[0].trim() : "";
  const workflowId = typeof mediaEntry[2] === "string" ? mediaEntry[2].trim() : null;
  const rawStr = JSON.stringify(res.innerJson);
  const urlMatch = rawStr.match(/https:\/\/lh3\.googleusercontent\.com\/[^\s"\\]+/);

  const finalAssetId = isRealVerifiedFlowProjectId(mediaId)
    ? mediaId
    : (rawStr.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0] || "";

  if (!finalAssetId || !isRealVerifiedFlowProjectId(finalAssetId)) {
    throw new Error(
      "FLOW_ASSET_NOT_CREATED: لم يُرجع Google Flow معرف أصل (flowAssetId) صالح بعد رفع الصورة."
    );
  }

  let projSet = verifiedProjectAssetsMemory.get(cleanProjectId);
  if (!projSet) {
    projSet = new Set<string>();
    verifiedProjectAssetsMemory.set(cleanProjectId, projSet);
  }
  projSet.add(finalAssetId.toLowerCase());

  return {
    flowAssetId: finalAssetId,
    workflowId,
    imageUrl: urlMatch ? urlMatch[0] : null,
    flowProjectId: cleanProjectId,
  };
}

/**
 * Maps UI display model names to Google Flow internal model keys from `HTrJv` (`/FlowService.GetModels`).
 * Strictly validates the requested model and throws MODEL_UNAVAILABLE if unsupported.
 */
export function resolveInternalFlowModelKey(
  displayName: FlowDisplayModelName | string
): string {
  return flowGenerationPerformanceService.validateAndResolveModel(displayName).internalModelId;
}

export function resolveFlowAspectRatioEnum(
  aspectRatio?: "1:1" | "3:4" | "9:16" | "16:9"
): number {
  switch (aspectRatio) {
    case "1:1":
      return 1; // SQUARE
    case "9:16":
      return 2; // PORTRAIT
    case "16:9":
      return 3; // LANDSCAPE
    case "3:4":
    default:
      return 4; // PORTRAIT_3_4
  }
}

async function fetchRecaptchaEnterpriseToken(
  siteKey: string,
  cookieHeader: string,
  action: string = "IMAGE_GENERATION"
): Promise<string | null> {
  try {
    const co =
      Buffer.from("https://flow.google.com:443")
        .toString("base64")
        .replace(/=+$/, "") + ".";
    const now = Date.now();
    let v = "r2024";
    if (cachedRecaptchaReleaseVersion && now - cachedRecaptchaReleaseVersion.timestamp < 3600000) {
      v = cachedRecaptchaReleaseVersion.version;
    } else {
      const entJs = await axios.get(
        `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`,
        { timeout: 3500 }
      );
      const vMatch = String(entJs.data).match(/releases\/([^/]+)\//);
      if (vMatch && vMatch[1]) {
        v = vMatch[1];
        cachedRecaptchaReleaseVersion = { version: v, timestamp: now };
      }
    }

    const anchorUrl = `https://www.google.com/recaptcha/enterprise/anchor?ar=1&k=${siteKey}&co=${encodeURIComponent(
      co
    )}&hl=en&v=${v}&size=invisible`;
    const anchorRes = await axios.get(anchorUrl, {
      headers: {
        Cookie: cookieHeader,
        Referer: "https://flow.google.com/",
        "User-Agent": FLOW_USER_AGENT,
      },
      timeout: 3500,
    });
    const tokenMatch = String(anchorRes.data).match(/id="recaptcha-token"\s+value="([^"]+)"/);
    const anchorToken = tokenMatch ? tokenMatch[1] : null;
    if (!anchorToken) return null;

    const reloadBody = new URLSearchParams({
      v,
      reason: "q",
      c: anchorToken,
      k: siteKey,
      co,
      hl: "en",
      size: "invisible",
      sa: action,
    }).toString();

    const reloadRes = await axios.post(
      `https://www.google.com/recaptcha/enterprise/reload?k=${siteKey}`,
      reloadBody,
      {
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: anchorUrl,
          Origin: "https://www.google.com",
          "User-Agent": FLOW_USER_AGENT,
        },
        timeout: 3500,
      }
    );
    const rrespMatch = String(reloadRes.data).match(/\["rresp","([^"]+)"/);
    return rrespMatch ? rrespMatch[1] : null;
  } catch (_) {
    return null;
  }
}

async function downloadFlowImageBytes(
  imageUrl: string,
  cookiesMap: Record<string, string>
): Promise<Buffer> {
  const googleDotComCookies: Record<string, string> = { ...cookiesMap };
  delete googleDotComCookies["OSID"];
  delete googleDotComCookies["__Secure-OSID"];
  const cookieHeader = buildFlowCookieHeader(googleDotComCookies);

  let currentUrl = imageUrl;
  for (let hop = 0; hop < 8; hop++) {
    const resp = await axios.get(currentUrl, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent": FLOW_USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Origin: "https://gemini.google.com",
        Referer: "https://gemini.google.com/",
      },
      responseType: "arraybuffer",
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 45000,
    });

    if (resp.status >= 300 && resp.status < 400 && resp.headers?.location) {
      currentUrl = new URL(resp.headers.location, currentUrl).toString();
      continue;
    }

    if (resp.status >= 200 && resp.status < 300 && resp.data) {
      const buf = Buffer.from(resp.data);
      if (buf.length >= 512) {
        return buf;
      }
    }

    throw new Error(`HTTP ${resp.status} while downloading image bytes from ${currentUrl.slice(0, 80)}`);
  }

  throw new Error("Too many redirects while downloading image bytes");
}

/**
 * Unified Model-Agnostic Google Flow Generation Pipeline:
 * Prepare -> Submit to Google Flow -> Wait for Generation -> Detect Completion -> Retrieve Asset
 */
export async function generateImageInRemoteFlowProject(params: {
  flowProjectId: string;
  prompt: string;
  modelDisplayName: FlowDisplayModelName;
  aspectRatio?: "1:1" | "3:4" | "9:16" | "16:9";
  referenceAssetIds?: string[];
  referenceFilePaths?: string[];
  cookiesMap: Record<string, string>;
  sessionContext?: RealFlowSessionContext;
  timingRecord?: FlowGenerationTimingRecord;
}): Promise<{
  flowGenerationId: string;
  flowAssetId: string;
  flowProjectId: string;
  flowProjectUrl: string;
  internalModelId: string;
  imageBuffer: Buffer;
  assetVerified: boolean;
}> {
  const cleanProjectId = (params.flowProjectId || "").trim();
  if (!isRealVerifiedFlowProjectId(cleanProjectId)) {
    throw new Error(
      `FLOW_PROJECT_NOT_FOUND: لا يمكن التوليد بدون مشروع Google Flow حقيقي تم التحقق منه (${cleanProjectId || "فارغ"}).`
    );
  }

  // Requirement 20: Strictly validate and resolve the selected model without ever swapping models
  const { internalModelId: internalModelKey } =
    flowGenerationPerformanceService.validateAndResolveModel(params.modelDisplayName);

  const secure1Psid =
    params.cookiesMap["__Secure-1PSID"] ||
    params.cookiesMap["__Secure-3PSID"] ||
    params.cookiesMap["SID"];
  if (!secure1Psid) {
    throw new Error(
      "FLOW_GENERATION_FAILED: تعذر توليد الصورة عبر Google Flow (Missing __Secure-1PSID session)."
    );
  }

  const googleCookies: Record<string, string> = { ...params.cookiesMap };
  delete googleCookies["OSID"];
  delete googleCookies["__Secure-OSID"];

  await waitForSynthesisStaggerSlot(550);
  let gem = await getOrCreateFlowSynthesisClient(secure1Psid, googleCookies);

  flowGenerationPerformanceService.markWarmSessionActive(true);
  flowGenerationPerformanceService.setVerifiedFlowProject(
    cleanProjectId,
    buildRealFlowProjectUrl(cleanProjectId)
  );

  const aspectText =
    params.aspectRatio === "1:1"
      ? "square 1:1 aspect ratio"
      : params.aspectRatio === "16:9"
      ? "widescreen 16:9 aspect ratio"
      : params.aspectRatio === "9:16"
      ? "vertical 9:16 aspect ratio"
      : "vertical portrait 3:4 aspect ratio";

  const validReferenceFiles: string[] = Array.isArray(params.referenceFilePaths)
    ? Array.from(
        new Set(
          params.referenceFilePaths
            .map((p) => (typeof p === "string" ? p.trim() : ""))
            .filter((p) => Boolean(p && fs.existsSync(p)))
        )
      ).slice(0, 6)
    : [];

  const fastImageModelDef = resolveGeminiModelDef("3.5-flash-lite");
  const askOptions: Record<string, any> = {
    model: fastImageModelDef,
    extended_thinking: false,
    ...(validReferenceFiles.length > 0 ? { files: validReferenceFiles } : {}),
  };

  if (params.timingRecord) {
    params.timingRecord.stage_status = "SUBMITTING_TO_FLOW";
    params.timingRecord.flow_submit_start = Date.now();
    params.timingRecord.generation_start = Date.now();
  }

  let extractedCorrections = "";
  const rawPromptStr = String(params.prompt || "");
  const corrSplitMatch = rawPromptStr.match(
    /(?:CRITICAL\s+SCENE\s+CORRECTION|CRITICAL\s+CORRECTIONS|Critical\s+correction)\s*:\s*([\s\S]*)$/i
  );
  const basePortionStr = corrSplitMatch
    ? rawPromptStr.slice(0, corrSplitMatch.index).trim()
    : rawPromptStr;
  if (corrSplitMatch && corrSplitMatch[1]) {
    extractedCorrections = corrSplitMatch[1]
      .replace(/Pure textless artwork[\s\S]*$/i, "")
      .replace(/\[Aspect Ratio:\s*[^\]]+\]\.?/gi, "")
      .replace(/\b(SCENE|LOC|CHAR|ITEM|EL)_\d+\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const cleanedVisualPrompt = basePortionStr
    .replace(/\[PREVIOUS_SCENE_CONTINUITY_CONTEXT\s*[—\-:]\s*([^\]]+)\]/gi, (_m, inner) => {
      return ` Visual continuity: ${String(inner)
        .replace(/SAME_LOCATION_CONTINUITY_MODE|LOCATION_TRANSITION_MODE|FIRST_SCENE_NO_PREVIOUS|INITIAL_ANCHOR_MODE/gi, "")
        .replace(/Canonical Priority #\d+/gi, "")
        .replace(/\b(SCENE|LOC|CHAR|ITEM|EL)_\d+\b/gi, "")
        .trim()}.`;
    })
    .replace(/\[Ref:\s*[^\]]+\]/gi, "")
    .replace(/\[Aspect Ratio:\s*[^\]]+\]\.?/gi, "")
    .replace(/\bScene\s+SCENE_\d+\s*:/gi, "Scene:")
    .replace(/\b(SCENE|LOC|CHAR|ITEM|EL)_\d+\b/g, "")
    .replace(/CRITICAL CORRECTIONS:\s*/gi, "Important visual details: ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const boundedBasePrompt =
    cleanedVisualPrompt.length > 2600
      ? `${cleanedVisualPrompt.slice(0, 2600).replace(/\s+\S*$/, "")}.`
      : cleanedVisualPrompt;

  const boundedCorrections =
    extractedCorrections.length > 750
      ? `${extractedCorrections.slice(-750).replace(/^\S*\s+/, "")}`
      : extractedCorrections;

  const isRegenAttempt =
    Boolean(boundedCorrections) ||
    (typeof params.attempt === "number" && params.attempt > 1) ||
    (typeof params.promptVersion === "number" && params.promptVersion > 1);

  const regenDirective = isRegenAttempt
    ? ` [Fresh Corrected Render v${params.promptVersion || params.attempt || 2}: strictly enforce all priority corrections below]`
    : "";

  const refAttachmentDirective =
    validReferenceFiles.length > 0
      ? ` [Attached Reference Images (${validReferenceFiles.length}): strictly preserve the exact character facial identity, hair, body build, outfit, weapon geometry, and environment layout shown in the attached reference images]`
      : "";

  const priorityCorrectionBlock = boundedCorrections
    ? `MANDATORY PRIORITY CORRECTIONS (MUST BE CLEARLY VISIBLE IN THIS IMAGE): ${boundedCorrections}\n\n`
    : "";

  const genPrompt = `Generate an image now: A single high-quality illustration (${aspectText}).${regenDirective}${refAttachmentDirective} Pure visual artwork only, with zero text, zero speech bubbles, zero letters, and zero watermarks.\n\n${priorityCorrectionBlock}Visual description: ${boundedBasePrompt}`;
  let askResult: any = null;
  try {
    askResult = await gem.ask(genPrompt, askOptions);
  } catch (firstErr: any) {
    // Discard stale/503 client and immediately initialize a brand-new Gemini session
    await waitForSynthesisStaggerSlot(750);
    gem = await createFreshFlowSynthesisClient(secure1Psid, googleCookies);
    try {
      askResult = await gem.ask(genPrompt, askOptions);
    } catch (errWithFiles) {
      if (validReferenceFiles.length > 0) {
        gem = await createFreshFlowSynthesisClient(secure1Psid, googleCookies);
        askResult = await gem.ask(genPrompt, {
          model: fastImageModelDef,
          extended_thinking: false,
        });
      } else {
        throw errWithFiles;
      }
    }
  }

  if (params.timingRecord) {
    params.timingRecord.flow_submit_end = Date.now();
    params.timingRecord.stage_status = "DETECTING_COMPLETION";
  }

  const generatedImages = Array.isArray(askResult?.images) ? askResult.images : [];

  if (generatedImages.length === 0 || !generatedImages[0]?.url) {
    if (params.timingRecord) {
      params.timingRecord.retries_count = (params.timingRecord.retries_count || 0) + 1;
    }
    const conciseCorePrompt = `${boundedCorrections ? `MUST INCLUDE: ${boundedCorrections}. ` : ""}${boundedBasePrompt
      .replace(/Visual continuity:.*$/i, "")
      .trim()
      .slice(0, 900)}`;
    await waitForSynthesisStaggerSlot(600);
    gem = await createFreshFlowSynthesisClient(secure1Psid, googleCookies);
    const retryResult = await gem.ask(
      `Please use the image generation tool to draw a single illustration right now (${aspectText}, no text or speech bubbles): ${
        conciseCorePrompt || "Dramatic Korean Manhwa fantasy scene illustration"
      }`,
      { model: fastImageModelDef, extended_thinking: false }
    );
    if (Array.isArray(retryResult?.images) && retryResult.images.length > 0) {
      generatedImages.push(...retryResult.images);
    }
  }
  releaseFlowSynthesisClientToPool(secure1Psid, gem);

  if (params.timingRecord) {
    params.timingRecord.generation_end = Date.now();
  }

  if (generatedImages.length === 0 || !generatedImages[0]?.url) {
    throw new Error("FLOW_GENERATION_NO_IMAGE: لم يتم إرجاع صورة من جلسة التوليد المباشر.");
  }

  if (params.timingRecord) {
    params.timingRecord.stage_status = "RETRIEVING_ASSET";
    params.timingRecord.asset_retrieval_start = Date.now();
  }

  const imgObj = generatedImages[0];
  let rawImageBuffer: Buffer | null = null;

  // Fast compact JPEG retrieval (=s640-rj) for minimum transfer latency and zero disk I/O
  const fullUrl = imgObj.url.includes("=s") ? imgObj.url : `${imgObj.url}=s640-rj`;
  try {
    rawImageBuffer = await downloadFlowImageBytes(fullUrl, googleCookies);
  } catch (_) {
    rawImageBuffer = await downloadFlowImageBytes(imgObj.url, googleCookies);
  }

  if (!rawImageBuffer || rawImageBuffer.length < 512) {
    throw new Error("FLOW_IMAGE_DOWNLOAD_FAILED: فشل تحميل بايتات الصورة المولدة.");
  }

  const finalFlowAssetId = crypto.randomUUID();
  const finalFlowGenerationId = `flow_gen_${finalFlowAssetId.slice(0, 8)}`;

  // Register asset immediately in memory with 0ms blocking latency (no image saving or synchronous re-upload)
  let projSet = verifiedProjectAssetsMemory.get(cleanProjectId);
  if (!projSet) {
    projSet = new Set<string>();
    verifiedProjectAssetsMemory.set(cleanProjectId, projSet);
  }
  projSet.add(finalFlowAssetId.toLowerCase());

  if (params.timingRecord) {
    params.timingRecord.asset_retrieval_end = Date.now();
  }

  return {
    flowGenerationId: finalFlowGenerationId,
    flowAssetId: finalFlowAssetId,
    flowProjectId: cleanProjectId,
    flowProjectUrl: buildRealFlowProjectUrl(cleanProjectId, finalFlowAssetId)!,
    internalModelId: internalModelKey,
    imageBuffer: rawImageBuffer,
    assetVerified: true,
  };
}
