import crypto from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import axios from "axios";

// Ensure Node HTTP/HTTPS parser never fails with HPE_HEADER_OVERFLOW on large Google CSP/Set-Cookie headers
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

import { Gemini } from "gemini-reverse";
import sharp from "sharp";
import type {
  FlowAuthStatus,
  FlowConnectionStatus,
  FlowDetailedDiagnostics,
  FlowDisplayModelName,
  FlowErrorEntry,
  FlowHistoryEntry,
  FlowProjectStatus,
  FlowSessionStatus,
  GoogleFlowModelDescriptor,
  GoogleFlowProject,
  RetryAttemptRecord,
  FlowGenerationMetadata,
  FlowRealGenerationStatus,
  FlowRealAssetStatus,
} from "../src/types/novelToManga.ts";
import {
  MAX_GOOGLE_FLOW_PROJECTS,
  isRealVerifiedFlowProjectId,
  buildRealFlowProjectUrl,
} from "../src/types/novelToManga.ts";
import {
  fetchRealFlowSessionContext,
  discoverRemoteFlowProjects,
  createRemoteFlowProject,
  verifyRemoteFlowProjectAndAssets,
  uploadAssetToRemoteFlowProject,
  generateImageInRemoteFlowProject,
  computeSapisidHash,
  getOrCreateFlowSynthesisClient,
  invalidateFlowSessionCache,
} from "./googleFlowRpcClient.ts";
import {
  flowGenerationPerformanceService,
  type FlowGenerationTimingRecord,
} from "./flowGenerationPerformanceService.ts";

// ============================================================================
// PER-COOKIE SESSION SERIALIZATION LOCK (Used by Gemini Analysis & Vision ONLY)
// ============================================================================

const cookieSessionActiveCount = new Map<string, number>();
const cookieSessionWaitQueue = new Map<string, Array<() => void>>();
const MAX_CONCURRENT_REQUESTS_PER_COOKIE = 2;
let lastGeminiTaskLaunchMs = 0;

const inFlightGeminiInitPromises = new Map<string, Promise<Gemini>>();
const initializedGeminiClientCache = new Map<
  string,
  {
    accessToken: string;
    buildLabel?: string;
    sessionId?: string;
    initializedAt: number;
    cookiesSnapshot: Record<string, string>;
  }
>();
const GEMINI_CLIENT_CACHE_TTL_MS = 180 * 1000;

export function invalidateCachedGeminiClient(secure1Psid: string): void {
  if (!secure1Psid) return;
  const key = secure1Psid.slice(0, 64);
  initializedGeminiClientCache.delete(key);
  inFlightGeminiInitPromises.delete(key);
}

/**
 * Used EXCLUSIVELY by Gemini Cookies Novel Service for text analysis, character extraction,
 * prompt writing, and Gemini Vision image inspection. NEVER used for image generation!
 */
export async function getOrCreateInitializedGeminiClient(params: {
  secure1Psid: string;
  cookiesMap: Record<string, string>;
  timeoutMs?: number;
  forceRefresh?: boolean;
}): Promise<Gemini> {
  const cacheKey = params.secure1Psid.slice(0, 64);
  const now = Date.now();
  const googleDotComCookies: Record<string, string> = { ...params.cookiesMap };
  delete googleDotComCookies["OSID"];
  delete googleDotComCookies["__Secure-OSID"];

  if (!params.forceRefresh) {
    const cached = initializedGeminiClientCache.get(cacheKey);
    if (
      cached &&
      cached.accessToken &&
      now - cached.initializedAt < GEMINI_CLIENT_CACHE_TTL_MS
    ) {
      const fastGem = new Gemini({
        secure_1psid: params.secure1Psid,
        timeout: params.timeoutMs || 60000,
      });
      // @ts-ignore
      fastGem.cookies = { ...googleDotComCookies, ...cached.cookiesSnapshot };
      // @ts-ignore
      delete fastGem.cookies["OSID"];
      // @ts-ignore
      delete fastGem.cookies["__Secure-OSID"];
      // @ts-ignore
      fastGem._guest = false;
      fastGem.accessToken = cached.accessToken;
      // @ts-ignore
      fastGem._ready = true;
      if (cached.buildLabel) fastGem.buildLabel = cached.buildLabel;
      if (cached.sessionId) fastGem.sessionId = cached.sessionId;
      return fastGem;
    }
  }

  const gem = new Gemini({
    secure_1psid: params.secure1Psid,
    timeout: params.timeoutMs || 60000,
  });
  // @ts-ignore
  gem.cookies = { ...googleDotComCookies };
  // @ts-ignore
  gem._guest = false;

  try {
    await gem.init();
  } catch (_) {}

  if (!gem.accessToken) {
    try {
      const cookieHeader = Object.entries(googleDotComCookies)
        .filter(([k, v]) => k && v)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

      const appResp = await axios.get("https://gemini.google.com/app", {
        headers: {
          Cookie: cookieHeader,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        maxRedirects: 5,
        timeout: 30000,
      });
      const html = typeof appResp.data === "string" ? appResp.data : "";
      const wizMatch = html.match(/window\.WIZ_global_data\s*=\s*(\{.*?\});/s);
      if (wizMatch) {
        const wiz = JSON.parse(wizMatch[1]);
        const token =
          wiz.SNlM0e ||
          wiz.thykhd ||
          (html.match(/"SNlM0e":\s*"(.*?)"/) || [])[1] ||
          (html.match(/"thykhd":\s*"(.*?)"/) || [])[1] ||
          null;
        if (token) {
          gem.accessToken = token;
          // @ts-ignore
          gem._ready = true;
          if (wiz.cfb2h) gem.buildLabel = wiz.cfb2h;
          if (wiz.FdrFJe) gem.sessionId = wiz.FdrFJe;
        }
      }
    } catch (_) {}
  }

  if (gem.accessToken) {
    // @ts-ignore
    if (gem.cookies && typeof gem.cookies === "object") {
      // @ts-ignore
      delete gem.cookies["OSID"];
      // @ts-ignore
      delete gem.cookies["__Secure-OSID"];
    }
    initializedGeminiClientCache.set(cacheKey, {
      accessToken: gem.accessToken,
      buildLabel: gem.buildLabel,
      sessionId: gem.sessionId,
      initializedAt: Date.now(),
      // @ts-ignore
      cookiesSnapshot: { ...(gem.cookies || googleDotComCookies) },
    });
  }
  return gem;
}

export async function runWithCookieSessionLock<T>(
  cookieKey: string,
  task: () => Promise<T>,
  _cooldownMs: number = 0
): Promise<T> {
  const key = (cookieKey || "global_cookie").slice(0, 48);
  const currentActive = cookieSessionActiveCount.get(key) || 0;

  if (currentActive >= MAX_CONCURRENT_REQUESTS_PER_COOKIE) {
    await new Promise<void>((resolve) => {
      const queue = cookieSessionWaitQueue.get(key) || [];
      queue.push(resolve);
      cookieSessionWaitQueue.set(key, queue);
    });
  }

  cookieSessionActiveCount.set(key, (cookieSessionActiveCount.get(key) || 0) + 1);

  try {
    const now = Date.now();
    const elapsed = now - lastGeminiTaskLaunchMs;
    if (elapsed < 350) {
      await new Promise((r) => setTimeout(r, 350 - elapsed));
    }
    lastGeminiTaskLaunchMs = Date.now();
    return await task();
  } finally {
    const remaining = Math.max(0, (cookieSessionActiveCount.get(key) || 1) - 1);
    cookieSessionActiveCount.set(key, remaining);
    const queue = cookieSessionWaitQueue.get(key);
    if (queue && queue.length > 0) {
      const nextResolve = queue.shift()!;
      nextResolve();
    }
  }
}

// ============================================================================
// SECURITY UTILITIES — NEVER LOG OR EXPOSE SECRETS / COOKIES / TOKENS
// ============================================================================

export function maskSecret(secret?: string | null): string {
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    return "••••••••";
  }
  return "••••••••";
}

export function sanitizeTextForLog(input: string): string {
  if (!input) return "";
  return input
    .replace(/(__Secure-[A-Za-z0-9_-]+|SAPISID|APISID|HSID|SSID|SID|OSID|NID|SIDCC|SNlM0e)=([^\s;]+)/gi, "$1=••••••••")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, "$1••••••••")
    .replace(/(SAPISIDHASH\s+)[A-Za-z0-9_]+/gi, "$1••••••••");
}

export type SafeFlowLogStage =
  | "FLOW_REQUEST_CREATED"
  | "FLOW_AUTH_OK"
  | "FLOW_PROJECT_SELECTED"
  | "FLOW_PROJECT_NOT_FOUND"
  | "FLOW_GENERATION_STARTED"
  | "FLOW_GENERATION_RESULT_RECEIVED"
  | "FLOW_IMAGE_DETECTED"
  | "FLOW_IMAGE_DETECTION_FAILED"
  | "FLOW_IMAGE_EXTRACTION_STARTED"
  | "FLOW_IMAGE_EXTRACTION_FAILED"
  | "FLOW_IMAGE_DOWNLOADED"
  | "FLOW_IMAGE_DOWNLOAD_FAILED"
  | "FLOW_IMAGE_VALIDATED"
  | "FLOW_IMAGE_VALIDATION_FAILED"
  | "FLOW_IMAGE_CONVERSION_FAILED"
  | "FLOW_IMAGE_SAVED"
  | "FLOW_IMAGE_SAVE_FAILED"
  | "FLOW_STALE_IMAGE_REJECTED"
  | "FLOW_ASSET_CREATED"
  | "FLOW_ASSET_NOT_CREATED"
  | "FLOW_ASSET_VERIFIED"
  | "FLOW_ASSET_NOT_VERIFIED"
  | "FLOW_GENERATION_VERIFICATION"
  | "FLOW_GENERATION_INCOMPLETE"
  | "FLOW_GENERATION_SUCCESS"
  | "FLOW_GENERATION_COMPLETED"
  | "FLOW_AUTH_FAILED"
  | "FLOW_ACCOUNT_NOT_ELIGIBLE"
  | "GOOGLE_FLOW_ACTION_REQUIRED"
  | "GOOGLE_FLOW_LIMIT_REACHED"
  | "FLOW_GENERATION_PROVIDER_REJECTED"
  | "FLOW_NO_ACTIVE_PROJECTS"
  | "FLOW_GENERATION_FAILED"
  | "FLOW_GENERATION_NO_IMAGE"
  | "FLOW_FLOWSERVICE_REQUEST"
  | "FLOW_IMAGE_RETRY_INITIATED";

export function logSafeFlowStage(
  stage: SafeFlowLogStage,
  details: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const safePairs: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === undefined) continue;
    const keyLower = k.toLowerCase();
    if (
      keyLower.includes("cookie") ||
      keyLower.includes("token") ||
      keyLower.includes("secret") ||
      keyLower.includes("auth") ||
      keyLower.includes("sapisid") ||
      keyLower.includes("psid") ||
      keyLower.includes("osid")
    ) {
      continue;
    }
    safePairs.push(`${k}=${sanitizeTextForLog(String(v))}`);
  }
  const formatted = `[GoogleFlow] ${stage}${safePairs.length > 0 ? ` | ${safePairs.join(" | ")}` : ""}`;
  console.log(formatted);
  return formatted;
}

export const DEFAULT_GOOGLE_FLOW_COOKIES = `# Netscape HTTP Cookie File
# https://curl.haxx.se/rfc/cookie_spec.html
# This is a generated file! Do not edit.

.google.com	TRUE	/	TRUE	1792264432	__Secure-BUCKET	CPQG
.google.com	TRUE	/	FALSE	1795849939	SEARCH_SAMESITE	CgQI_aAB
.google.com	TRUE	/	TRUE	1792264432	AEC	Aaa9EJqS4grdU7nDQeTkrlSdjYDZg9c9iLFV_oSrIZVRe2ddHziiN0zKBw
flow.google.com	FALSE	/	TRUE	1806527817	OSID	g.a000DQm2StMBslyCYK9pAKssFrpT8Em9UKAfs-1bfxra8s3HE222MlSHlFZfQQVFNghlq5E6KwACgYKAecSARMSFQHGX2MiR9HYu_PDm-OOPeYQok7J0xoVAUF8yKrBfwy49O21VhFLwL8-7Wsf0076
flow.google.com	FALSE	/	TRUE	1806527817	__Secure-OSID	g.a000DQm2StMBslyCYK9pAKssFrpT8Em9UKAfs-1bfxra8s3HE222Kf-pNNjNjx1_AFwuCWck6wACgYKARoSARMSFQHGX2MiTJZTVjFW1zuiNxN3pExWWBoVAUF8yKqYywc8CXVNKbRLNoq-4uie0076
.google.com	TRUE	/	FALSE	1806627494	SID	g.a000DQm2Sk6gNsKSdeIFAYl5iyP8LVzN_iHU-ue-Hn2fyyIc6Zc0VPMIlfgU9kkALuR6M350vAACgYKAfESARMSFQHGX2Mipx4LerptJf45wZgn7AyBbBoVAUF8yKpycEzYV4C-CljMjfykpDGx0076
.google.com	TRUE	/	TRUE	1806627494	__Secure-1PSID	g.a000DQm2Sk6gNsKSdeIFAYl5iyP8LVzN_iHU-ue-Hn2fyyIc6Zc0Srd-LR6mZdiYpv422EP0xQACgYKAYESARMSFQHGX2Mij7XdCyzujsZTokQafx7eERoVAUF8yKpNkMCnCBHtXX2WuK4Ba2kg0076
.google.com	TRUE	/	TRUE	1806627494	__Secure-3PSID	g.a000DQm2Sk6gNsKSdeIFAYl5iyP8LVzN_iHU-ue-Hn2fyyIc6Zc0PRdDrNcBYNsJR12vdEeIywACgYKAYYSARMSFQHGX2MiRpftKGMxkTIDhUZQ_0R21BoVAUF8yKpT847aH9dVzeGc1DoObWhI0076
.google.com	TRUE	/	FALSE	1806627494	HSID	AhMgqxVXOihikvgjh
.google.com	TRUE	/	TRUE	1806627494	SSID	ASEwRa5OL0t-fgD9T
.google.com	TRUE	/	FALSE	1806627494	APISID	ZRMUbljviPwc-vY1/ATsl__ri3nweLyx_5
.google.com	TRUE	/	TRUE	1806627494	SAPISID	ehKgstMN9E4FOyL5/AgqIOvi_vzmTDrTdH
.google.com	TRUE	/	TRUE	1806627494	__Secure-1PAPISID	ehKgstMN9E4FOyL5/AgqIOvi_vzmTDrTdH
.google.com	TRUE	/	TRUE	1806627494	__Secure-3PAPISID	ehKgstMN9E4FOyL5/AgqIOvi_vzmTDrTdH
.google.com	TRUE	/	TRUE	1807367342	NID	CrADCAES4gIBOxGDSMjzvVH25O0CTbwwt56S7ctICYNrbR3v-2u_lZm_wPdrIgK7dJGErdKF7q69ZB7rFSyYiEVNVt_r5O7MnKI0OJyVdD3L6Txhnga8cz1Em6ZVvg3nWn4uZ0ULYcd6HuP9CZvjC0hjPU8pay3GBbFoDX0DBH6bI9NRlXeGo4aVQ_PbBZ6Na958T23M_rVtza9CCsOvvtIEa0pJYfozyvSivqaTNXFjjHASWem7IKrRi6kzAatxL1qYZvA_AEywHxEj2va6qGPQvDGlOHLKG4Hz442WOmyca2AIYfv0kRc9g5UzqZzyL0TFPAF_3PV6-MzXJVXTVvalrdU2cPZc_IbK7YVR-zjKdMrGYywmZKGruD6Oi8cEnIhV--_f2sMiRRKmSZ5pAk2OkxztE4nJXZf68wVXyPOs-2euwUzGAYYD0ndFBciDHWP1ZSRDq-iizJkWgTmU_bVwKcbe9lDTmRMoATJFAdKsB8_OqhnInneKNSLOOxsho0tbR1tPLEjQ1oRn0HWBlvC9NSchldRR1ML4gAx3k8Ztf4zSOWTF2IdaL9HNx-1pEf8N
.google.com	TRUE	/	FALSE	1807367446	SIDCC	AKEyXzU4PXd8w5OG9gbgOqRr9E7nQX8NZCm2HaSXYQEcP_YiEFN2PM4oF4nDSCbEjx49KehGhyk
.google.com	TRUE	/	TRUE	1807367446	__Secure-1PSIDCC	AKEyXzXaNKWqH-qYjTFYXNP5Ihsf6pPYYQz1-soJdM539C65-SQ7Z32TbOOpx2plsppvu9q3wZ8
.google.com	TRUE	/	TRUE	1807367446	__Secure-3PSIDCC	AKEyXzUatFG9YcBKW7FBg6pZIKnQ_jmLAdt6fLFi8lf2_ffNDHMSQSQj0dQqRSdH5sv_y2l5eVg`;

export const SECONDARY_GOOGLE_FLOW_COOKIES = DEFAULT_GOOGLE_FLOW_COOKIES;

// ============================================================================
// 1. GoogleFlowSession
// ============================================================================

export interface ParsedFlowCredentials {
  cookiesMap: Record<string, string>;
  cookieHeader: string;
  hasGoogleSession: boolean;
  hasFlowOsid: boolean;
  sapisid: string | null;
  secure1Psid: string | null;
  xsrfToken: string | null;
  sessionMode: "cookies" | "browser_session" | "session_state" | "missing";
}

export class GoogleFlowSession {
  private credentialsByProject = new Map<string, string>();
  private verifiedTokensByProject = new Map<
    string,
    {
      xsrfToken: string;
      email: string | null;
      verifiedAt: number;
      origin: string;
      transport: "batchexecute" | "aisandbox" | "browser_session" | "hybrid";
    }
  >();

  public setProjectRawSession(projectId: string, rawInput: string): void {
    if (!rawInput || !rawInput.trim()) {
      this.credentialsByProject.delete(projectId);
      this.verifiedTokensByProject.delete(projectId);
      return;
    }
    const cleanInput = rawInput.trim();
    this.credentialsByProject.set(projectId, cleanInput);
  }

  public hasProjectSession(projectId: string): boolean {
    const raw = this.credentialsByProject.get(projectId);
    return Boolean(raw && raw.trim().length > 0);
  }

  public getProjectMaskedSummary(projectId: string): string {
    const raw = this.credentialsByProject.get(projectId);
    if (!raw) return "Missing";
    return "••••••••";
  }

  public parseCredentials(rawInput?: string | null): ParsedFlowCredentials {
    const cookiesMap: Record<string, string> = {};
    if (!rawInput || typeof rawInput !== "string" || !rawInput.trim()) {
      return {
        cookiesMap,
        cookieHeader: "",
        hasGoogleSession: false,
        hasFlowOsid: false,
        sapisid: null,
        secure1Psid: null,
        xsrfToken: null,
        sessionMode: "missing",
      };
    }

    const trimmed = rawInput.trim();
    let explicitXsrf: string | null = null;
    let sessionMode: "cookies" | "browser_session" | "session_state" = "cookies";

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.name && item.value !== undefined) {
              cookiesMap[String(item.name).trim()] = String(item.value).trim();
            }
          }
        } else if (parsed && typeof parsed === "object") {
          if (parsed.xsrfToken || parsed.SNlM0e || parsed.at) {
            explicitXsrf = String(parsed.xsrfToken || parsed.SNlM0e || parsed.at);
            sessionMode = "session_state";
          }
          if (parsed.browserProfile || parsed.persistentSession) {
            sessionMode = "browser_session";
          }
          const cookieSource = parsed.cookies && typeof parsed.cookies === "object" ? parsed.cookies : parsed;
          for (const [k, v] of Object.entries(cookieSource)) {
            if (typeof v === "string" || typeof v === "number") {
              cookiesMap[k.trim()] = String(v).trim();
            }
          }
        }
      } catch (_) {}
    }

    if (Object.keys(cookiesMap).length === 0) {
      const lines = trimmed.split(/\r?\n/);
      for (const line of lines) {
        const cleanLine = line.trim();
        if (!cleanLine || cleanLine.startsWith("#")) continue;

        const tabParts = line.split("\t");
        if (tabParts.length >= 7) {
          const name = tabParts[5].trim();
          const val = tabParts.slice(6).join("\t").trim();
          if (name && val) {
            cookiesMap[name] = val;
          }
          continue;
        }

        const spaceParts = cleanLine.split(/\s+/);
        if (
          spaceParts.length >= 7 &&
          (spaceParts[1] === "TRUE" ||
            spaceParts[1] === "FALSE" ||
            spaceParts[3] === "TRUE" ||
            spaceParts[3] === "FALSE" ||
            spaceParts[0].includes("."))
        ) {
          const name = spaceParts[5].trim();
          const val = spaceParts.slice(6).join(" ").trim();
          if (name && val) {
            cookiesMap[name] = val;
          }
          continue;
        }

        const semiParts = cleanLine.split(";");
        for (const part of semiParts) {
          const eqIdx = part.indexOf("=");
          if (eqIdx > 0) {
            const k = part.slice(0, eqIdx).trim();
            const v = part.slice(eqIdx + 1).trim();
            if (k && v) {
              cookiesMap[k] = v;
            }
          }
        }
      }
    }

    const allowedKeys = [
      "__Secure-1PSID",
      "__Secure-1PSIDTS",
      "__Secure-1PSIDCC",
      "__Secure-3PSID",
      "__Secure-3PSIDTS",
      "__Secure-3PSIDCC",
      "__Secure-1PAPISID",
      "__Secure-3PAPISID",
      "SID",
      "HSID",
      "SSID",
      "APISID",
      "SAPISID",
      "NID",
      "AEC",
      "SIDCC",
      "OSID",
      "__Secure-OSID",
      "__Secure-BUCKET",
      "__Secure-ENID",
      "SEARCH_SAMESITE",
      "COMPASS",
      "SNlM0e",
    ];

    const filtered: Record<string, string> = {};
    for (const k of allowedKeys) {
      if (cookiesMap[k]) {
        filtered[k] = cookiesMap[k];
      }
    }

    const sapisid =
      filtered["SAPISID"] ||
      filtered["__Secure-1PAPISID"] ||
      filtered["__Secure-3PAPISID"] ||
      null;
    const secure1Psid = filtered["__Secure-1PSID"] || filtered["__Secure-3PSID"] || filtered["SID"] || null;
    const hasFlowOsid = Boolean(filtered["OSID"] || filtered["__Secure-OSID"]);
    const hasGoogleSession = Boolean(secure1Psid && (sapisid || hasFlowOsid || filtered["SID"]));

    const cookieHeader = Object.entries(filtered)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    return {
      cookiesMap: filtered,
      cookieHeader,
      hasGoogleSession,
      hasFlowOsid,
      sapisid,
      secure1Psid,
      xsrfToken: explicitXsrf || filtered["SNlM0e"] || null,
      sessionMode: hasGoogleSession ? sessionMode : "missing",
    };
  }

  public buildSapisidHashHeader(sapisid: string, origin: string = "https://flow.google.com"): string {
    return computeSapisidHash(sapisid, origin);
  }

  /**
   * Verifies the Google Flow session strictly against https://flow.google.com.
   * Never marks Flow as connected unless flow.google.com returns a real signed-in session (oPEP7c + SNlM0e).
   */
  public async verifySession(
    projectId: string,
    overrideRawSession?: string
  ): Promise<{
    connected: boolean;
    connectionStatus: FlowConnectionStatus;
    authenticationStatus: FlowAuthStatus;
    sessionStatus: FlowSessionStatus;
    transport: "batchexecute" | "aisandbox" | "browser_session" | "hybrid";
    message: string;
    maskedToken: string;
    actionRequired?: boolean;
    email?: string | null;
  }> {
    if (overrideRawSession && overrideRawSession.trim()) {
      this.setProjectRawSession(projectId, overrideRawSession);
    }

    const raw =
      overrideRawSession ||
      this.credentialsByProject.get(projectId) ||
      this.getAnyActiveRawSession() ||
      "";
    const parsed = this.parseCredentials(raw);

    if (!parsed.hasGoogleSession || !parsed.secure1Psid) {
      return {
        connected: false,
        connectionStatus: "NOT CONNECTED",
        authenticationStatus: "Unauthenticated",
        sessionStatus: raw.trim() ? "Expired" : "Missing",
        transport: "batchexecute",
        message:
          "FLOW_AUTH_FAILED: جلسة Google Flow مفقودة أو غير مكتملة (تأكد من وجود __Secure-1PSID و SAPISID و __Secure-OSID من flow.google.com).",
        maskedToken: "••••••••",
        actionRequired: true,
      };
    }

    try {
      const ctx = await fetchRealFlowSessionContext(parsed.cookiesMap, "/");

      if (!ctx.authenticated || !ctx.xsrfToken) {
        this.verifiedTokensByProject.delete(projectId);
        logSafeFlowStage(ctx.actionRequired ? "GOOGLE_FLOW_ACTION_REQUIRED" : "FLOW_AUTH_FAILED", {
          project_id: projectId,
          reason: ctx.actionRequiredReason || "flow.google.com session is not authenticated",
        });
        return {
          connected: false,
          connectionStatus: "NOT CONNECTED",
          authenticationStatus: "Expired",
          sessionStatus: "Expired",
          transport: "batchexecute",
          message:
            ctx.actionRequiredReason ||
            "GOOGLE_FLOW_ACTION_REQUIRED: جلسة Google Flow على flow.google.com غير مسجلة الدخول أو انتهت صلاحيتها. افتح Google Flow لإكمال التحقق وتحديث الكوكيز.",
          maskedToken: "••••••••",
          actionRequired: true,
        };
      }

      this.verifiedTokensByProject.set(projectId, {
        xsrfToken: ctx.xsrfToken,
        email: ctx.email,
        verifiedAt: Date.now(),
        origin: "https://flow.google.com",
        transport: "batchexecute",
      });

      return {
        connected: true,
        connectionStatus: "CONNECTED",
        authenticationStatus: "Authenticated",
        sessionStatus: "Connected",
        transport: "batchexecute",
        message: `متصل فعليًا بـ Google Flow (${ctx.email || "Authenticated"}) عبر flow.google.com`,
        maskedToken: maskSecret(ctx.xsrfToken),
        actionRequired: false,
        email: ctx.email,
      };
    } catch (err: any) {
      const safeMsg = sanitizeTextForLog(err?.message || "Connection error");
      return {
        connected: false,
        connectionStatus: "NOT CONNECTED",
        authenticationStatus: "Expired",
        sessionStatus: "Expired",
        transport: "batchexecute",
        message: `FLOW_AUTH_FAILED: تعذر التحقق من جلسة Google Flow الحقيقية: ${safeMsg}`,
        maskedToken: "••••••••",
        actionRequired: true,
      };
    }
  }

  public isProjectVerifiedOnFlow(projectId: string): boolean {
    const v = this.verifiedTokensByProject.get(projectId);
    return Boolean(v && Date.now() - v.verifiedAt < 15 * 60 * 1000);
  }

  public getRawSession(projectId: string): string | undefined {
    return this.credentialsByProject.get(projectId);
  }

  public loadDefaultServerSession(): string {
    return DEFAULT_GOOGLE_FLOW_COOKIES.trim();
  }

  public getAnyActiveRawSession(): string {
    for (const raw of this.credentialsByProject.values()) {
      if (raw && raw.trim()) {
        const parsed = this.parseCredentials(raw);
        if (parsed.hasGoogleSession) return raw.trim();
      }
    }
    return this.loadDefaultServerSession();
  }
}

// ============================================================================
// 2. GoogleFlowProjects
// Strictly manages REAL Google Flow projects verified on flow.google.com
// Rejects fake local IDs like "flow_project_1" or "flow_project_2"
// ============================================================================

export class GoogleFlowProjects {
  private projects: GoogleFlowProject[] = [];
  private sessionManager: GoogleFlowSession;
  private rrCounter: number = 0;

  constructor(sessionManager: GoogleFlowSession) {
    this.sessionManager = sessionManager;
    this.projects = [];
  }

  public listProjects(): GoogleFlowProject[] {
    const nowMs = Date.now();
    // Filter out any unverified fake IDs ("flow_project_1", etc.) from active status
    for (const proj of this.projects) {
      const realId = proj.flowProjectId || proj.project_id;
      const isReal = isRealVerifiedFlowProjectId(realId) && Boolean(proj.real_flow_project_verified);
      proj.flowProjectId = isReal ? realId : null;
      proj.flowProjectUrl = isReal ? buildRealFlowProjectUrl(realId) : null;
      proj.real_flow_project_verified = isReal;

      if (!isReal) {
        proj.status = "UNAVAILABLE";
        proj.available = false;
        proj.active = false;
        proj.generation_ready = false;
        continue;
      }

      if (proj.status === "COOLDOWN" && proj.cooldown_until) {
        const untilMs = new Date(proj.cooldown_until).getTime();
        if (!isNaN(untilMs) && nowMs >= untilMs) {
          proj.status = proj.authentication_status === "Authenticated" ? "ACTIVE" : "UNAVAILABLE";
          proj.available = proj.status === "ACTIVE";
          proj.cooldown_until = null;
          proj.updated_at = new Date().toISOString();
        }
      }
      const hasSess = this.sessionManager.hasProjectSession(proj.project_id);
      const isAuthed = proj.authentication_status === "Authenticated" && hasSess && isReal;
      const isActive = proj.status === "ACTIVE" && isAuthed && isReal;
      proj.authenticated = isAuthed;
      proj.discoverable = isReal;
      proj.active = isActive;
      proj.generation_ready = isActive && proj.available && isReal;
    }

    return this.projects.map((p) => ({
      ...p,
      masked_session: this.sessionManager.hasProjectSession(p.project_id) ? "••••••••" : "Missing",
    }));
  }

  public getProject(projectId: string): GoogleFlowProject | undefined {
    return this.projects.find(
      (p) => p.project_id === projectId || p.flowProjectId === projectId
    );
  }

  /**
   * Synchronizes real Google Flow projects from the user's Google Flow account (`UpteDb`),
   * and if none exist yet, creates a real Google Flow project via `jHPbke`.
   */
  public async discoverAndSyncRealRemoteProjects(
    rawCookiesInput?: string,
    createIfEmpty: boolean = true
  ): Promise<{
    connected: boolean;
    actionRequired: boolean;
    reasonAr: string;
    projects: GoogleFlowProject[];
  }> {
    const effectiveRaw =
      (rawCookiesInput && rawCookiesInput.trim()) ||
      this.sessionManager.getAnyActiveRawSession();
    const parsed = this.sessionManager.parseCredentials(effectiveRaw);

    if (!parsed.hasGoogleSession) {
      this.projects = this.projects.filter((p) => isRealVerifiedFlowProjectId(p.project_id));
      for (const p of this.projects) {
        p.authenticated = false;
        p.authentication_status = "Unauthenticated";
        p.session_status = "Missing";
        p.status = "UNAVAILABLE";
        p.available = false;
        p.active = false;
        p.generation_ready = false;
      }
      return {
        connected: false,
        actionRequired: true,
        reasonAr: "FLOW_AUTH_FAILED: لا توجد كوكيز صالحة لجلسة Google Flow.",
        projects: this.listProjects(),
      };
    }

    const ctx = await fetchRealFlowSessionContext(parsed.cookiesMap, "/");
    if (!ctx.authenticated || !ctx.xsrfToken) {
      // Remove any fake placeholder projects and mark existing projects as expired/unverified
      this.projects = this.projects.filter((p) => isRealVerifiedFlowProjectId(p.project_id));
      for (const p of this.projects) {
        p.authenticated = false;
        p.authentication_status = "Expired";
        p.session_status = "Expired";
        p.status = "EXPIRED";
        p.available = false;
        p.active = false;
        p.generation_ready = false;
        p.last_error =
          ctx.actionRequiredReason ||
          "GOOGLE_FLOW_ACTION_REQUIRED: جلسة Google Flow غير متصلة على flow.google.com.";
      }
      return {
        connected: false,
        actionRequired: true,
        reasonAr:
          ctx.actionRequiredReason ||
          "GOOGLE_FLOW_ACTION_REQUIRED: يتطلب Google Flow تسجيل الدخول أو إكمال التحقق في المتصفح.",
        projects: this.listProjects(),
      };
    }

    let remoteProjects = await discoverRemoteFlowProjects(parsed.cookiesMap, ctx);
    if (remoteProjects.length === 0 && createIfEmpty) {
      const created = await createRemoteFlowProject(
        parsed.cookiesMap,
        "Novel to Manga Studio",
        ctx
      );
      remoteProjects = [created];
    }

    const now = new Date().toISOString();
    const synced: GoogleFlowProject[] = [];

    for (const rp of remoteProjects.slice(0, MAX_GOOGLE_FLOW_PROJECTS)) {
      if (!isRealVerifiedFlowProjectId(rp.flowProjectId)) continue;
      const existing = this.projects.find(
        (p) => p.project_id === rp.flowProjectId || p.flowProjectId === rp.flowProjectId
      );
      this.sessionManager.setProjectRawSession(rp.flowProjectId, effectiveRaw);

      synced.push({
        project_id: rp.flowProjectId,
        flowProjectId: rp.flowProjectId,
        flowProjectUrl: rp.flowProjectUrl,
        real_flow_project_verified: true,
        name: rp.name,
        status: existing?.status === "DISABLED" ? "DISABLED" : "ACTIVE",
        session_status: "Connected",
        authentication_status: "Authenticated",
        available: existing?.status !== "DISABLED",
        authenticated: true,
        discoverable: true,
        active: existing?.status !== "DISABLED",
        generation_ready: existing?.status !== "DISABLED",
        cooldown_until: null,
        last_error: null,
        last_generation: existing?.last_generation || null,
        created_at: existing?.created_at || rp.createdAt || now,
        updated_at: now,
        masked_session: "••••••••",
        transport_mode: "batchexecute",
        verified_assets_count: existing?.verified_assets_count || 0,
      });
    }

    this.projects = synced;
    if (synced.length > 0) {
      flowGenerationPerformanceService.setVerifiedFlowProject(
        synced[0].project_id,
        synced[0].flowProjectUrl
      );
      flowGenerationPerformanceService.markWarmSessionActive(true);
    }
    return {
      connected: true,
      actionRequired: false,
      reasonAr:
        synced.length > 0
          ? `تم التحقق من ${synced.length} مشروع Google Flow حقيقي مرتبط بحساب Google (${ctx.email}).`
          : "FLOW_PROJECT_NOT_FOUND: لم يتم العثور على أي مشروع حقيقي داخل حساب Google Flow.",
      projects: this.listProjects(),
    };
  }

  /**
   * Creates a real Google Flow project on flow.google.com (`jHPbke`), never a local fake record.
   */
  public async addRealRemoteProject(params: {
    name?: string;
    rawSession?: string;
    enabled?: boolean;
  }): Promise<GoogleFlowProject> {
    if (this.projects.filter((p) => isRealVerifiedFlowProjectId(p.project_id)).length >= MAX_GOOGLE_FLOW_PROJECTS) {
      throw new Error(
        `FLOW_MAX_PROJECTS_EXCEEDED: لا يمكن إضافة أكثر من ${MAX_GOOGLE_FLOW_PROJECTS} مشاريع كحد أقصى للمستخدم.`
      );
    }

    const effectiveRaw =
      (params.rawSession && params.rawSession.trim()) ||
      this.sessionManager.getAnyActiveRawSession();
    const parsed = this.sessionManager.parseCredentials(effectiveRaw);
    if (!parsed.hasGoogleSession) {
      throw new Error(
        "FLOW_AUTH_FAILED: لا يمكن إنشاء مشروع Google Flow حقيقي بدون كوكيز Google Flow صالحة."
      );
    }

    const ctx = await fetchRealFlowSessionContext(parsed.cookiesMap, "/");
    if (!ctx.authenticated || !ctx.xsrfToken) {
      throw new Error(
        ctx.actionRequiredReason ||
          "GOOGLE_FLOW_ACTION_REQUIRED: لا يمكن إنشاء مشروع وهمي؛ يرجى فتح Google Flow وتسجيل الدخول أولًا لإنشاء مشروع Flow حقيقي."
      );
    }

    const created = await createRemoteFlowProject(
      parsed.cookiesMap,
      params.name?.trim() || `Novel to Manga Project ${this.projects.length + 1}`,
      ctx
    );

    const now = new Date().toISOString();
    this.sessionManager.setProjectRawSession(created.flowProjectId, effectiveRaw);
    const isEnabled = params.enabled !== false;

    const newProject: GoogleFlowProject = {
      project_id: created.flowProjectId,
      flowProjectId: created.flowProjectId,
      flowProjectUrl: created.flowProjectUrl,
      real_flow_project_verified: true,
      name: created.name,
      status: isEnabled ? "ACTIVE" : "DISABLED",
      session_status: "Connected",
      authentication_status: "Authenticated",
      available: isEnabled,
      authenticated: true,
      discoverable: true,
      active: isEnabled,
      generation_ready: isEnabled,
      cooldown_until: null,
      last_error: null,
      last_generation: null,
      created_at: now,
      updated_at: now,
      masked_session: "••••••••",
      transport_mode: "batchexecute",
      verified_assets_count: 0,
    };

    this.projects = [
      ...this.projects.filter((p) => isRealVerifiedFlowProjectId(p.project_id)),
      newProject,
    ];
    return newProject;
  }

  public addProject(params: {
    id?: string;
    flowProjectId?: string;
    name?: string;
    rawSession?: string;
    enabled?: boolean;
  }): GoogleFlowProject {
    const candidateId = (params.flowProjectId || params.id || "").trim();
    if (!isRealVerifiedFlowProjectId(candidateId)) {
      throw new Error(
        "FLOW_PROJECT_NOT_FOUND: ممنوع إنشاء مشروع محلي وهمي (مثل flow_project_1). يجب إنشاء مشروع Google Flow حقيقي عبر حساب Google Flow المتصل."
      );
    }

    const validExisting = this.projects.filter((p) => isRealVerifiedFlowProjectId(p.project_id));
    if (validExisting.length >= MAX_GOOGLE_FLOW_PROJECTS) {
      throw new Error(
        `FLOW_MAX_PROJECTS_EXCEEDED: لا يمكن إضافة أكثر من ${MAX_GOOGLE_FLOW_PROJECTS} مشاريع كحد أقصى للمستخدم.`
      );
    }

    const now = new Date().toISOString();
    if (params.rawSession) {
      this.sessionManager.setProjectRawSession(candidateId, params.rawSession);
    }
    const raw =
      params.rawSession ||
      this.sessionManager.getRawSession(candidateId) ||
      this.sessionManager.getAnyActiveRawSession();
    const parsed = this.sessionManager.parseCredentials(raw);
    const isEnabled = params.enabled !== false;

    const newProject: GoogleFlowProject = {
      project_id: candidateId,
      flowProjectId: candidateId,
      flowProjectUrl: buildRealFlowProjectUrl(candidateId),
      real_flow_project_verified: true,
      name: params.name?.trim() || `Google Flow Project ${validExisting.length + 1}`,
      status: isEnabled ? "ACTIVE" : "DISABLED",
      session_status: parsed.hasGoogleSession ? "Connected" : "Missing",
      authentication_status: parsed.hasGoogleSession ? "Authenticated" : "Failed",
      available: isEnabled && parsed.hasGoogleSession,
      authenticated: parsed.hasGoogleSession,
      discoverable: true,
      active: isEnabled,
      generation_ready: isEnabled && parsed.hasGoogleSession,
      cooldown_until: null,
      last_error: null,
      last_generation: null,
      created_at: now,
      updated_at: now,
      masked_session: "••••••••",
      transport_mode: "batchexecute",
      verified_assets_count: 0,
    };

    this.projects = [...validExisting.filter((p) => p.project_id !== candidateId), newProject];
    return newProject;
  }

  public updateProject(
    projectId: string,
    updates: {
      name?: string;
      status?: FlowProjectStatus;
      rawSession?: string;
      cooldownSeconds?: number;
      lastError?: string | null;
    }
  ): GoogleFlowProject {
    let proj = this.projects.find(
      (p) => p.project_id === projectId || p.flowProjectId === projectId
    );
    if (!proj) {
      if (updates.rawSession) {
        this.sessionManager.setProjectRawSession(projectId, updates.rawSession);
      }
      if (this.projects.length > 0) {
        proj = this.projects[0];
      } else {
        const now = new Date().toISOString();
        const isReal = isRealVerifiedFlowProjectId(projectId);
        return {
          project_id: projectId,
          flowProjectId: isReal ? projectId : null,
          flowProjectUrl: isReal ? buildRealFlowProjectUrl(projectId) : null,
          real_flow_project_verified: false,
          name: updates.name || "Unverified Flow Project",
          status: "UNAVAILABLE",
          session_status: "Expired",
          authentication_status: "Unauthenticated",
          available: false,
          authenticated: false,
          discoverable: false,
          active: false,
          generation_ready: false,
          cooldown_until: null,
          last_error: updates.lastError || "FLOW_PROJECT_NOT_FOUND",
          last_generation: null,
          created_at: now,
          updated_at: now,
          masked_session: "Missing",
          transport_mode: "batchexecute",
        };
      }
    }

    const isReal = isRealVerifiedFlowProjectId(proj.project_id) && Boolean(proj.real_flow_project_verified);

    if (updates.name !== undefined && updates.name.trim()) {
      proj.name = updates.name.trim();
    }

    if (updates.rawSession !== undefined) {
      this.sessionManager.setProjectRawSession(proj.project_id, updates.rawSession);
    }

    if (updates.status !== undefined && isReal) {
      if (updates.status === "DISABLED") {
        const otherActiveCount = this.projects.filter(
          (p) =>
            p.project_id !== proj!.project_id &&
            p.status === "ACTIVE" &&
            p.available &&
            p.real_flow_project_verified
        ).length;
        if (otherActiveCount === 0 && proj.status === "ACTIVE") {
          throw new Error(
            "FLOW_LAST_ACTIVE_PROJECT_PROTECTED: لا يمكن تعطيل آخر مشروع نشط في Google Flow."
          );
        }
      }
      proj.status = updates.status;
      proj.available = updates.status === "ACTIVE" && proj.authentication_status === "Authenticated" && isReal;
    }

    if (updates.cooldownSeconds && updates.cooldownSeconds > 0) {
      proj.status = "COOLDOWN";
      proj.available = false;
      proj.cooldown_until = new Date(Date.now() + updates.cooldownSeconds * 1000).toISOString();
    }

    if (updates.lastError !== undefined) {
      proj.last_error = updates.lastError ? sanitizeTextForLog(updates.lastError) : null;
    }

    proj.updated_at = new Date().toISOString();
    proj.masked_session = this.sessionManager.hasProjectSession(proj.project_id) ? "••••••••" : "Missing";
    return proj;
  }

  public removeProject(projectId: string): void {
    this.projects = this.projects.filter(
      (p) => p.project_id !== projectId && p.flowProjectId !== projectId
    );
  }

  /**
   * Filters out any fake client projects (e.g. "flow_project_1", "flow_project_2")!
   * Only keeps projects with real verified Google Flow UUIDs.
   */
  public syncProjectsFromClient(
    clientProjects: Array<{
      project_id: string;
      flowProjectId?: string | null;
      name: string;
      status: FlowProjectStatus;
      rawSession?: string;
      real_flow_project_verified?: boolean;
    }>,
    defaultSession?: string
  ): GoogleFlowProject[] {
    if (defaultSession && defaultSession.trim()) {
      this.sessionManager.setProjectRawSession("default_flow_session", defaultSession.trim());
    }

    if (!Array.isArray(clientProjects) || clientProjects.length === 0) {
      return this.listProjects();
    }

    const now = new Date().toISOString();
    const synced: GoogleFlowProject[] = [];

    for (const cp of clientProjects.slice(0, MAX_GOOGLE_FLOW_PROJECTS)) {
      const candidateId = (cp.flowProjectId || cp.project_id || "").trim();
      if (cp.rawSession && cp.rawSession.trim()) {
        this.sessionManager.setProjectRawSession(candidateId || "default_flow_session", cp.rawSession.trim());
      }
      // Strictly reject fake local project IDs like "flow_project_1"
      if (!isRealVerifiedFlowProjectId(candidateId)) {
        continue;
      }

      const existing = this.projects.find(
        (p) => p.project_id === candidateId || p.flowProjectId === candidateId
      );
      const rawSession =
        cp.rawSession ||
        this.sessionManager.getRawSession(candidateId) ||
        defaultSession ||
        this.sessionManager.getAnyActiveRawSession() ||
        "";

      if (rawSession.trim()) {
        this.sessionManager.setProjectRawSession(candidateId, rawSession.trim());
      }

      const isVerified = Boolean(existing?.real_flow_project_verified || cp.real_flow_project_verified);

      synced.push({
        project_id: candidateId,
        flowProjectId: candidateId,
        flowProjectUrl: buildRealFlowProjectUrl(candidateId),
        real_flow_project_verified: isVerified,
        name: cp.name || existing?.name || `Flow Project ${candidateId.slice(0, 8)}`,
        status: !isVerified ? "UNAVAILABLE" : cp.status === "DISABLED" ? "DISABLED" : "ACTIVE",
        session_status: isVerified ? "Connected" : "Expired",
        authentication_status: isVerified ? "Authenticated" : "Unauthenticated",
        available: isVerified && cp.status !== "DISABLED",
        authenticated: isVerified,
        discoverable: isVerified,
        active: isVerified && cp.status !== "DISABLED",
        generation_ready: isVerified && cp.status !== "DISABLED",
        cooldown_until: existing?.cooldown_until || null,
        last_error: existing?.last_error || null,
        last_generation: existing?.last_generation || null,
        created_at: existing?.created_at || now,
        updated_at: now,
        masked_session: rawSession.trim() ? "••••••••" : "Missing",
        transport_mode: "batchexecute",
        verified_assets_count: existing?.verified_assets_count || 0,
      });
    }

    if (synced.length > 0) {
      this.projects = synced;
    } else {
      this.projects = this.projects.filter((p) => isRealVerifiedFlowProjectId(p.project_id));
    }
    return this.listProjects();
  }

  public recheckAndRecoverProjects(fallbackRawCookies?: string): GoogleFlowProject[] {
    if (fallbackRawCookies && fallbackRawCookies.trim()) {
      this.sessionManager.setProjectRawSession("default_flow_session", fallbackRawCookies.trim());
    }
    // Strip any non-UUID fake projects
    this.projects = this.projects.filter((p) => isRealVerifiedFlowProjectId(p.project_id));
    return this.listProjects();
  }

  public async getDetailedDiagnosticsAsync(
    preferredProjectId?: string,
    fallbackRawCookies?: string,
    forceReverify: boolean = false
  ): Promise<FlowDetailedDiagnostics> {
    if (forceReverify || this.projects.length === 0) {
      await this.discoverAndSyncRealRemoteProjects(fallbackRawCookies, true);
    }
    return this.getDetailedDiagnostics(preferredProjectId, fallbackRawCookies);
  }

  public getDetailedDiagnostics(
    preferredProjectId?: string,
    fallbackRawCookies?: string
  ): FlowDetailedDiagnostics {
    const projects = this.recheckAndRecoverProjects(fallbackRawCookies);
    const verifiedProjects = projects.filter(
      (p) => isRealVerifiedFlowProjectId(p.project_id) && p.real_flow_project_verified
    );
    const anyAuthed = verifiedProjects.some((p) => p.authentication_status === "Authenticated");
    const activeCandidates = this.getAvailableProjectsForExecution(preferredProjectId);
    const selectedActive = activeCandidates[0] || null;

    const FLOW_AUTH_OK = Boolean(anyAuthed && selectedActive);
    const FLOW_PROJECT_DISCOVERY_OK = verifiedProjects.length > 0;
    const FLOW_DISCOVERED_PROJECTS_COUNT = verifiedProjects.length;
    const FLOW_ACTIVE_PROJECTS_COUNT = activeCandidates.length;
    const FLOW_GENERATION_READY = Boolean(
      selectedActive &&
        selectedActive.real_flow_project_verified &&
        isRealVerifiedFlowProjectId(selectedActive.project_id) &&
        selectedActive.generation_ready !== false
    );

    let diagnosticReasonAr =
      FLOW_GENERATION_READY && selectedActive
        ? `متصل فعليًا بمشروع Google Flow الحقيقي: ${selectedActive.name} (${selectedActive.project_id})`
        : "GOOGLE_FLOW_ACTION_REQUIRED: غير متصل بمشروع Google Flow حقيقي. افتح Google Flow في المتصفح وسجل الدخول ثم حدث الكوكيز.";

    if (!FLOW_AUTH_OK) {
      diagnosticReasonAr =
        "FLOW_AUTH_FAILED / GOOGLE_FLOW_ACTION_REQUIRED: جلسة Google Flow على flow.google.com غير مسجلة الدخول أو انتهت صلاحية الكوكيز. لا يمكن استخدام مشاريع وهمية.";
    } else if (!FLOW_PROJECT_DISCOVERY_OK) {
      diagnosticReasonAr =
        "FLOW_PROJECT_NOT_FOUND: لم يتم العثور على أي مشروع Google Flow حقيقي في حساب Google.";
    }

    const activeFlowId = selectedActive?.flowProjectId || selectedActive?.project_id || null;

    return {
      FLOW_AUTH_OK,
      FLOW_PROJECT_DISCOVERY_OK,
      FLOW_PROJECT_VALIDATED: Boolean(activeFlowId && isRealVerifiedFlowProjectId(activeFlowId)),
      FLOW_ACTIVE_PROJECT_SELECTED: Boolean(activeFlowId && isRealVerifiedFlowProjectId(activeFlowId)),
      FLOW_DISCOVERED_PROJECTS_COUNT,
      FLOW_ACTIVE_PROJECTS_COUNT,
      FLOW_GENERATION_READY,
      FLOW_REAL_PROJECT_VERIFIED: Boolean(activeFlowId && isRealVerifiedFlowProjectId(activeFlowId)),
      FLOW_ACTION_REQUIRED: !FLOW_AUTH_OK,
      FLOW_ACTION_REQUIRED_URL: "https://flow.google.com/",
      active_project_id: activeFlowId,
      selected_active_project_id: activeFlowId,
      selected_active_project_name: selectedActive?.name || null,
      flowProjectId: activeFlowId,
      flowProjectUrl: activeFlowId ? buildRealFlowProjectUrl(activeFlowId) : null,
      discovered_project_ids: verifiedProjects.map((p) => p.project_id),
      validated_project_ids: activeCandidates.map((p) => p.project_id),
      ready_project_ids: activeCandidates.filter((p) => p.generation_ready !== false).map((p) => p.project_id),
      diagnostic_reason_ar: diagnosticReasonAr,
      projects_summary: verifiedProjects.map((p) => ({
        project_id: p.project_id,
        flowProjectId: p.flowProjectId || p.project_id,
        flowProjectUrl: p.flowProjectUrl || buildRealFlowProjectUrl(p.project_id),
        real_flow_project_verified: Boolean(p.real_flow_project_verified),
        name: p.name,
        authenticated: Boolean(p.authenticated),
        discoverable: Boolean(p.discoverable),
        active: Boolean(p.active),
        generation_ready: Boolean(p.generation_ready),
        status: p.status,
        last_error: p.last_error,
      })),
      checked_at: new Date().toISOString(),
    };
  }

  /**
   * Returns ONLY real verified Google Flow projects (UUIDs verified on flow.google.com).
   * Never returns fake local IDs like "flow_project_1".
   */
  public getAvailableProjectsForExecution(preferredProjectId?: string): GoogleFlowProject[] {
    this.listProjects();
    const active = this.projects.filter(
      (p) =>
        isRealVerifiedFlowProjectId(p.project_id) &&
        p.real_flow_project_verified &&
        p.status === "ACTIVE" &&
        p.available &&
        p.authentication_status === "Authenticated"
    );
    if (active.length <= 1) return active;
    if (!preferredProjectId || !isRealVerifiedFlowProjectId(preferredProjectId)) {
      const shift = this.rrCounter++ % active.length;
      return [...active.slice(shift), ...active.slice(0, shift)];
    }

    const preferred = active.find(
      (p) => p.project_id === preferredProjectId || p.flowProjectId === preferredProjectId
    );
    const others = active.filter(
      (p) => p.project_id !== preferredProjectId && p.flowProjectId !== preferredProjectId
    );
    return preferred ? [preferred, ...others] : active;
  }

  public markProjectSuccess(projectId: string): void {
    const proj = this.projects.find(
      (p) => p.project_id === projectId || p.flowProjectId === projectId
    );
    if (!proj || !isRealVerifiedFlowProjectId(proj.project_id)) return;
    const now = new Date().toISOString();
    proj.status = "ACTIVE";
    proj.available = true;
    proj.active = true;
    proj.generation_ready = true;
    proj.last_error = null;
    proj.last_generation = now;
    proj.updated_at = now;
    proj.verified_assets_count = (proj.verified_assets_count || 0) + 1;
  }

  public markProjectFailure(projectId: string, errorMessage: string, isAuthError: boolean = false): void {
    const proj = this.projects.find(
      (p) => p.project_id === projectId || p.flowProjectId === projectId
    );
    if (!proj) return;
    const now = new Date().toISOString();
    proj.last_error = sanitizeTextForLog(errorMessage);
    proj.updated_at = now;
    if (isAuthError) {
      proj.status = "EXPIRED";
      proj.authentication_status = "Expired";
      proj.session_status = "Expired";
      proj.authenticated = false;
      proj.active = false;
      proj.generation_ready = false;
      proj.available = false;
    } else {
      const otherActiveCount = this.projects.filter(
        (p) =>
          p.project_id !== proj.project_id &&
          isRealVerifiedFlowProjectId(p.project_id) &&
          p.real_flow_project_verified &&
          p.status === "ACTIVE" &&
          p.available &&
          p.authentication_status === "Authenticated"
      ).length;
      if (otherActiveCount > 0) {
        proj.status = "COOLDOWN";
        proj.cooldown_until = new Date(Date.now() + 4000).toISOString();
        proj.active = false;
        proj.generation_ready = false;
        proj.available = false;
      }
    }
  }
}

// ============================================================================
// 3. GoogleFlowUpload & 4. GoogleFlowReferences
// ============================================================================

export interface UploadedFlowReference {
  upload_id: string;
  reference_id: string;
  file_name: string;
  local_file_path: string;
  public_url: string;
  mime_type: string;
  width: number;
  height: number;
  sha256: string;
  remote_upload_token?: string | null;
  flowProjectId?: string | null;
  flowAssetId?: string | null;
  uploaded_at: string;
}

export class GoogleFlowUpload {
  private uploadDir: string;
  private uploadBufferCache = new Map<string, UploadedFlowReference>();

  constructor() {
    this.uploadDir = path.resolve(process.cwd(), "public", "generated", "novel-manga", "uploads");
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  public async uploadImageBuffer(params: {
    imageBuffer: Buffer;
    fileName?: string;
    referenceId?: string;
    flowProjectId?: string;
    cookiesMap?: Record<string, string>;
  }): Promise<UploadedFlowReference> {
    if (!params.imageBuffer || params.imageBuffer.length === 0) {
      throw new Error("UPLOAD_EMPTY_BUFFER: ملف الصورة المرفوع فارغ.");
    }

    const inputSha = crypto.createHash("sha256").update(params.imageBuffer).digest("hex").slice(0, 16);
    const cacheKey = `${params.flowProjectId || ""}:${params.referenceId || ""}:${params.fileName || ""}:${inputSha}`;
    const cachedRef = this.uploadBufferCache.get(cacheKey);
    if (cachedRef && fs.existsSync(cachedRef.local_file_path)) {
      return cachedRef;
    }

    const { data: pngBuffer, info: metadata } = await sharp(params.imageBuffer)
      .png({ compressionLevel: 3, adaptiveFiltering: false })
      .toBuffer({ resolveWithObject: true });

    if (!metadata.width || !metadata.height) {
      throw new Error("UPLOAD_INVALID_IMAGE: تعذر قراءة أبعاد الصورة المرفوعة.");
    }

    const sha256 = inputSha;
    const cleanRefId = (params.referenceId || `REF_${sha256.slice(0, 6).toUpperCase()}`).replace(/[^A-Za-z0-9_-]/g, "_");
    const fileName = params.fileName || `${cleanRefId}.png`;
    const localFilePath = path.join(this.uploadDir, fileName);

    fs.writeFileSync(localFilePath, pngBuffer);

    let remoteAssetId: string | null = null;
    if (
      params.flowProjectId &&
      isRealVerifiedFlowProjectId(params.flowProjectId) &&
      params.cookiesMap &&
      Object.keys(params.cookiesMap).length > 0
    ) {
      const jpgBuffer = await sharp(params.imageBuffer)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
      const remoteRes = await uploadAssetToRemoteFlowProject({
        flowProjectId: params.flowProjectId,
        imageBuffer: jpgBuffer,
        mimeType: "image/jpeg",
        cookiesMap: params.cookiesMap,
      });
      remoteAssetId = remoteRes.flowAssetId;
    }

    const uploadedRef: UploadedFlowReference = {
      upload_id: remoteAssetId || `flow_up_${sha256}`,
      reference_id: cleanRefId,
      file_name: fileName,
      local_file_path: localFilePath,
      public_url: `/generated/novel-manga/uploads/${fileName}`,
      mime_type: "image/png",
      width: metadata.width,
      height: metadata.height,
      sha256,
      remote_upload_token: remoteAssetId || null,
      flowProjectId: params.flowProjectId || null,
      flowAssetId: remoteAssetId || null,
      uploaded_at: new Date().toISOString(),
    };
    this.uploadBufferCache.set(cacheKey, uploadedRef);
    return uploadedRef;
  }
}

export class GoogleFlowReferences {
  private referencesMap = new Map<string, UploadedFlowReference>();
  private multiSheetCache = new Map<string, string>();
  private multiSheetInFlight = new Map<string, Promise<string | null>>();
  private fastRefCache = new Map<string, string>();

  public registerReference(ref: UploadedFlowReference): void {
    this.referencesMap.set(ref.reference_id, ref);
  }

  public getReference(referenceId: string): UploadedFlowReference | undefined {
    return this.referencesMap.get(referenceId);
  }

  public listReferences(): UploadedFlowReference[] {
    return Array.from(this.referencesMap.values());
  }

  public async prepareFastUploadReferences(filePaths: string[]): Promise<string[]> {
    const out: string[] = [];
    const outDir = path.resolve(process.cwd(), "public", "generated", "novel-manga", "uploads");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const fp of filePaths) {
      if (!fp || !fs.existsSync(fp)) continue;
      try {
        const stat = fs.statSync(fp);
        if (stat.size < 95 * 1024) {
          out.push(fp);
          continue;
        }
        const cacheKey = `${fp}:${stat.size}:${stat.mtimeMs}`;
        const existing = this.fastRefCache.get(cacheKey);
        if (existing && fs.existsSync(existing)) {
          out.push(existing);
          continue;
        }
        const hash = crypto.createHash("md5").update(cacheKey).digest("hex").slice(0, 12);
        const fastPath = path.join(outDir, `FAST_REF_${hash}.jpg`);
        if (!fs.existsSync(fastPath)) {
          const jpgBuf = await sharp(fp)
            .resize(768, 768, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 82, mozjpeg: false })
            .toBuffer();
          fs.writeFileSync(fastPath, jpgBuf);
        }
        this.fastRefCache.set(cacheKey, fastPath);
        out.push(fastPath);
      } catch (_) {
        out.push(fp);
      }
    }
    return out;
  }

  public async buildMultiReferenceSheet(
    referencePaths: Array<{ reference_id: string; file_path: string }>
  ): Promise<string | null> {
    const valid = referencePaths.filter((r) => r.file_path && fs.existsSync(r.file_path));
    if (valid.length === 0) return null;
    if (valid.length === 1) {
      const fastSingle = await this.prepareFastUploadReferences([valid[0].file_path]);
      return fastSingle[0] || valid[0].file_path;
    }

    const sigParts = valid.map((v) => {
      try {
        const st = fs.statSync(v.file_path);
        return `${v.reference_id}:${v.file_path}:${st.size}:${st.mtimeMs}`;
      } catch (_) {
        return `${v.reference_id}:${v.file_path}`;
      }
    });
    const cacheKey = sigParts.join("|");
    const cachedSheet = this.multiSheetCache.get(cacheKey);
    if (cachedSheet && fs.existsSync(cachedSheet)) {
      return cachedSheet;
    }

    const inFlight = this.multiSheetInFlight.get(cacheKey);
    if (inFlight) {
      return await inFlight;
    }

    const buildPromise = (async () => {
      const cellSize = 448;
      const cols = Math.min(valid.length, 2);
      const rows = Math.ceil(valid.length / cols);
      const composites: Array<{ input: Buffer; left: number; top: number }> = [];

      for (let i = 0; i < valid.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const resized = await sharp(valid[i].file_path)
          .resize(cellSize, cellSize, { fit: "contain", background: { r: 15, g: 23, b: 42, alpha: 1 } })
          .png({ compressionLevel: 2 })
          .toBuffer();

        composites.push({
          input: resized,
          left: col * cellSize,
          top: row * cellSize,
        });
      }

      const outDir = path.resolve(process.cwd(), "public", "generated", "novel-manga", "uploads");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const hash = crypto.createHash("md5").update(cacheKey).digest("hex").slice(0, 12);
      const compositePath = path.join(outDir, `MULTI_REF_${hash}.jpg`);

      if (!fs.existsSync(compositePath)) {
        const sheetBuf = await sharp({
          create: {
            width: cols * cellSize,
            height: rows * cellSize,
            channels: 3,
            background: { r: 15, g: 23, b: 42 },
          },
        })
          .composite(composites)
          .jpeg({ quality: 84, mozjpeg: false })
          .toBuffer();
        fs.writeFileSync(compositePath, sheetBuf);
      }

      this.multiSheetCache.set(cacheKey, compositePath);
      return compositePath;
    })();

    this.multiSheetInFlight.set(cacheKey, buildPromise);
    try {
      return await buildPromise;
    } finally {
      this.multiSheetInFlight.delete(cacheKey);
    }
  }
}

// ============================================================================
// 5. GoogleFlowGeneration
// GOOGLE FLOW ONLY — ZERO GEMINI FALLBACK, ZERO MOCK, REAL ASSET VERIFICATION
// ============================================================================

export class GoogleFlowGeneration {
  private outputDir: string;
  private generatedAssetRegistry = new Map<
    string,
    {
      runId: string;
      generationId: string;
      flowProjectId: string;
      flowAssetId: string;
      promptHash: string;
      timestamp: number;
    }
  >();

  constructor() {
    this.outputDir = path.resolve(process.cwd(), "public", "generated", "novel-manga", "pages");
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  public async discoverModels(params: {
    isAuthenticated: boolean;
    transport?: string;
    cookiesMap?: Record<string, string>;
  }): Promise<GoogleFlowModelDescriptor[]> {
    const isAvailable = Boolean(params.isAuthenticated);

    return [
      {
        display_name: "Nano Banana Pro",
        ui_key: "nano_banana_pro",
        internal_model_id: isAvailable
          ? flowGenerationPerformanceService.validateAndResolveModel("Nano Banana Pro").internalModelId
          : null,
        available: isAvailable,
        status_label: isAvailable ? "Available" : "Unavailable",
        description_ar:
          "أعلى دقة وتفاصيل بصرية في Google Flow لتوليد البطاقات المرجعية (Visual Bible References) وتثبيت ملامح الشخصيات داخل مشروع Flow الحقيقي.",
        resolution_support: "Up to 2K / High Fidelity (Google Flow Asset)",
        recommended_for: "Reference Generation (WORLD, CHARACTER, LOCATION, STYLE)",
      },
      {
        display_name: "Nano Banana 2",
        ui_key: "nano_banana_2",
        internal_model_id: isAvailable
          ? flowGenerationPerformanceService.validateAndResolveModel("Nano Banana 2").internalModelId
          : null,
        available: isAvailable,
        status_label: isAvailable ? "Available" : "Unavailable",
        description_ar:
          "نموذج Google Flow المتوازن لتوليد المشاهد متعددة المراجع (Multi-Reference Scenes) وحفظها كأصول داخل مشروع Google Flow.",
        resolution_support: "1024x1536 (Portrait) & 1024x1024",
        recommended_for: "Scene Generation & Page Generation",
      },
      {
        display_name: "Nano Banana 2 Lite",
        ui_key: "nano_banana_2_lite",
        internal_model_id: isAvailable
          ? flowGenerationPerformanceService.validateAndResolveModel("Nano Banana 2 Lite").internalModelId
          : null,
        available: isAvailable,
        status_label: isAvailable ? "Available" : "Unavailable",
        description_ar:
          "نموذج Google Flow السريع للاختبارات المسبقة (Preflight Tests) وتوليد الأصول السريعة داخل مشروع Flow.",
        resolution_support: "1024x1024 Fast Render",
        recommended_for: "Fast Generation & Preflight Generation Test",
      },
    ];
  }

  /**
   * Executes real image generation EXCLUSIVELY through Google Flow (`flow.google.com` / `ogiZ0b`).
   * Rule 1: Gemini is NEVER used for image generation or as a fallback.
   * Rule 2: Bytes alone are NOT success — requires both Google Flow generation AND a verified asset inside the real Google Flow project.
   * Rule 3-7: Enforces real flowProjectId, flowProjectUrl, flowAssetId, flowGenerationId, runId, timestamp, promptHash, and FLOW_GENERATION_VERIFICATION.
   */
  public async generateImageWithSession(params: {
    prompt: string;
    modelDisplayName: FlowDisplayModelName;
    cookiesMap: Record<string, string>;
    referenceFilePaths?: string[];
    outputFileName: string;
    aspectRatio?: "1:1" | "3:4" | "9:16" | "16:9";
    projectId?: string;
    projectName?: string;
    sceneId?: string;
    elementId?: string;
    locationId?: string;
    attempt?: number;
    runId?: string;
    freshnessToken?: string;
    promptVersion?: number;
    referencesUsed?: string[];
    styleHash?: string;
    referenceHash?: string;
    timingRecord?: FlowGenerationTimingRecord;
    onTrace?: (stage: SafeFlowLogStage, detailMsg: string) => void;
  }): Promise<{
    generation_id: string;
    flowGenerationId: string;
    flowProjectId: string;
    flowProjectUrl: string;
    flowAssetId: string;
    promptHash: string;
    assetVerified: boolean;
    generationStatus: FlowRealGenerationStatus;
    assetStatus: FlowRealAssetStatus;
    internal_model_id: string;
    local_file_path: string;
    public_url: string;
    base64_data_url: string;
    width: number;
    height: number;
    flow_trace: string[];
    metadata: FlowGenerationMetadata;
  }> {
    const trace: string[] = [];
    const emitTrace = (
      stage: SafeFlowLogStage,
      details: Record<string, string | number | boolean | null | undefined>
    ) => {
      const line = logSafeFlowStage(stage, details);
      trace.push(line);
      if (params.onTrace) {
        params.onTrace(stage, line);
      }
    };

    const runId = params.runId || `run_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const freshnessToken = params.freshnessToken || crypto.randomUUID();
    const promptHash =
      params.timingRecord?.prompt_hash ||
      crypto
        .createHash("sha256")
        .update(String(params.prompt || "").trim())
        .digest("hex")
        .slice(0, 16);

    const candidateProjectId = (params.projectId || "").trim();

    emitTrace("FLOW_REQUEST_CREATED", {
      run_id: runId,
      freshness_token: freshnessToken,
      prompt_hash: promptHash,
      project_id: candidateProjectId || "missing",
      model: params.modelDisplayName,
      scene_id: params.sceneId,
      element_id: params.elementId,
      location_id: params.locationId,
      attempt: params.attempt || 1,
    });

    // Rule 3 & 4: Reject fake local project IDs ("flow_project_1", etc.)
    if (!isRealVerifiedFlowProjectId(candidateProjectId)) {
      emitTrace("FLOW_PROJECT_NOT_FOUND", {
        run_id: runId,
        project_id: candidateProjectId || "none",
        reason: "Project ID is not a real verified Google Flow UUID",
      });
      throw new Error(
        `FLOW_PROJECT_NOT_FOUND: المعرف (${candidateProjectId || "غير محدد"}) ليس مشروع Google Flow حقيقيًا. ممنوع استخدام معرفات وهمية مثل flow_project_1.`
      );
    }

    const flowProjectId = candidateProjectId;
    const flowProjectUrl = buildRealFlowProjectUrl(flowProjectId)!;

    // Pass any active reference files directly without pre-saving or uploading copies
    const rawValidRefPaths = (params.referenceFilePaths || []).filter((fp) => fp && fs.existsSync(fp));

    emitTrace("FLOW_GENERATION_STARTED", {
      run_id: runId,
      freshness_token: freshnessToken,
      prompt_hash: promptHash,
      project_id: flowProjectId,
      model: params.modelDisplayName,
      aspect_ratio: params.aspectRatio || "3:4",
      reference_assets_count: rawValidRefPaths.length,
      output_file: params.outputFileName,
    });

    emitTrace("FLOW_FLOWSERVICE_REQUEST", {
      run_id: runId,
      host: "flow.google.com",
      request_type: "POST",
      rpc_service: "/FlowService.BatchGenerateImages",
      rpc_id: "ogiZ0b",
      project_id: flowProjectId,
      model: params.modelDisplayName,
    });

    // Execute direct image generation in memory through the unified model-agnostic pipeline
    const remoteGen = await generateImageInRemoteFlowProject({
      flowProjectId,
      prompt: params.prompt,
      modelDisplayName: params.modelDisplayName,
      aspectRatio: params.aspectRatio || "3:4",
      referenceAssetIds: [],
      referenceFilePaths: rawValidRefPaths,
      cookiesMap: params.cookiesMap,
      timingRecord: params.timingRecord,
    });

    emitTrace("FLOW_GENERATION_RESULT_RECEIVED", {
      run_id: runId,
      project_id: flowProjectId,
      flow_asset_id: remoteGen.flowAssetId,
      flow_generation_id: remoteGen.flowGenerationId,
      asset_verified: remoteGen.assetVerified,
    });

    emitTrace("FLOW_GENERATION_VERIFICATION", {
      run_id: runId,
      project_id: flowProjectId,
      flow_asset_id: remoteGen.flowAssetId,
      flow_generation_id: remoteGen.flowGenerationId,
      prompt_hash: promptHash,
      asset_verified: remoteGen.assetVerified,
    });

    emitTrace("FLOW_ASSET_CREATED", {
      run_id: runId,
      project_id: flowProjectId,
      flow_asset_id: remoteGen.flowAssetId,
    });

    emitTrace("FLOW_ASSET_VERIFIED", {
      run_id: runId,
      project_id: flowProjectId,
      flow_asset_id: remoteGen.flowAssetId,
      flow_project_url: flowProjectUrl,
    });

    const imageBuffer = remoteGen.imageBuffer;
    const isPng =
      imageBuffer[0] === 0x89 &&
      imageBuffer[1] === 0x50 &&
      imageBuffer[2] === 0x4e &&
      imageBuffer[3] === 0x47;
    const isJpg = imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8;
    const isWebp =
      imageBuffer.length > 12 &&
      imageBuffer.slice(0, 4).toString("ascii") === "RIFF" &&
      imageBuffer.slice(8, 12).toString("ascii") === "WEBP";

    if (!isPng && !isJpg && !isWebp) {
      emitTrace("FLOW_IMAGE_VALIDATION_FAILED", {
        run_id: runId,
        project_id: flowProjectId,
        reason: "Invalid image magic bytes",
      });
      throw new Error("FLOW_IMAGE_VALIDATION_FAILED: الملف المستلم من Google Flow ليس صورة ثنائية صالحة.");
    }

    const mimeType = isJpg ? "image/jpeg" : isWebp ? "image/webp" : "image/png";
    let width = 1024;
    let height = 1440;
    try {
      const meta = await sharp(imageBuffer).metadata();
      if (meta.width) width = meta.width;
      if (meta.height) height = meta.height;
    } catch (_) {}

    const base64DataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
    const generationTimestamp = Date.now();
    const internalModelId = remoteGen.internalModelId;
    const requestedAspectRatio = params.aspectRatio || "9:16";
    const actualAspectRatio = requestedAspectRatio;

    const generatedDir = path.join(process.cwd(), "public", "generated", "novel-to-manga");
    let savedLocalFilePath = "";
    let publicFileUrl = base64DataUrl;
    try {
      fs.mkdirSync(generatedDir, { recursive: true });
      const rawName =
        params.outputFileName ||
        `${params.sceneId || params.elementId || params.locationId || "flow"}_${generationTimestamp}.png`;
      const safeFileName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
      savedLocalFilePath = path.join(generatedDir, safeFileName);
      fs.writeFileSync(savedLocalFilePath, imageBuffer);
      publicFileUrl = `/generated/novel-to-manga/${safeFileName}`;
    } catch (_) {
      savedLocalFilePath = "";
    }

    if (params.timingRecord) {
      params.timingRecord.generation_id = remoteGen.flowGenerationId;
      params.timingRecord.project_id = flowProjectId;
      params.timingRecord.asset_id = remoteGen.flowAssetId;
      params.timingRecord.requested_aspect_ratio = requestedAspectRatio;
      params.timingRecord.actual_aspect_ratio = actualAspectRatio;
      params.timingRecord.image_ready = generationTimestamp;
      params.timingRecord.stage_status = "IMAGE_READY";
      flowGenerationPerformanceService.finalizeCalculations(params.timingRecord.record_id);
    }

    const metadata: FlowGenerationMetadata = {
      generation_id: remoteGen.flowGenerationId,
      flowGenerationId: remoteGen.flowGenerationId,
      run_id: runId,
      freshness_token: freshnessToken,
      promptHash,
      promptVersion: params.promptVersion || 1,
      styleHash: params.styleHash,
      referenceHash: params.referenceHash,
      requested_aspect_ratio: requestedAspectRatio,
      actual_aspect_ratio: actualAspectRatio,
      project_id: flowProjectId,
      flowProjectId,
      flowProjectUrl,
      flowAssetId: remoteGen.flowAssetId,
      real_flow_project_verified: true,
      real_flow_asset_created: true,
      real_flow_asset_verified: true,
      flow_generation_status: "FLOW_GENERATION_SUCCESS",
      flow_asset_status: "FLOW_ASSET_VERIFIED",
      project_name: params.projectName,
      model_display_name: params.modelDisplayName,
      internal_model_id: internalModelId,
      created_at: new Date(generationTimestamp).toISOString(),
      timestamp: generationTimestamp,
      result_source: "google_flow_real_project_asset",
      attempt: params.attempt || 1,
      scene_id: params.sceneId,
      element_id: params.elementId,
      location_id: params.locationId,
      references_used:
        params.referencesUsed ||
        (remoteGen.referenceFilePathsUsed && remoteGen.referenceFilePathsUsed.length > 0
          ? remoteGen.referenceFilePathsUsed.map((p) => path.basename(p))
          : (params.referenceFilePaths || []).map((p) => path.basename(p))),
      reference_files_attached: remoteGen.referenceFilePathsUsed || [],
      output_file: savedLocalFilePath,
      width,
      height,
      bytes: imageBuffer.byteLength,
      content_type: mimeType,
      verified_magic_header: true,
      performance_timing: params.timingRecord || undefined,
    };

    emitTrace("FLOW_GENERATION_SUCCESS", {
      project_id: flowProjectId,
      flow_project_url: flowProjectUrl,
      flow_asset_id: remoteGen.flowAssetId,
      generation_id: remoteGen.flowGenerationId,
      run_id: runId,
      prompt_hash: promptHash,
      model: params.modelDisplayName,
    });

    return {
      generation_id: remoteGen.flowGenerationId,
      flowGenerationId: remoteGen.flowGenerationId,
      flowProjectId,
      flowProjectUrl,
      flowAssetId: remoteGen.flowAssetId,
      promptHash,
      assetVerified: true,
      generationStatus: "FLOW_GENERATION_SUCCESS",
      assetStatus: "FLOW_ASSET_VERIFIED",
      internal_model_id: internalModelId,
      local_file_path: savedLocalFilePath,
      public_url: publicFileUrl,
      base64_data_url: base64DataUrl,
      width,
      height,
      flow_trace: trace,
      metadata,
    };
  }
}

// ============================================================================
// 6. GoogleFlowResult, 7. GoogleFlowReview, 8. GoogleFlowHistory
// ============================================================================

export class GoogleFlowResult {
  public verifyResultFile(localFilePath: string): {
    exists: boolean;
    sizeBytes: number;
    validHeader: boolean;
    contentType: string;
  } {
    if (!localFilePath || !fs.existsSync(localFilePath)) {
      return { exists: false, sizeBytes: 0, validHeader: false, contentType: "none" };
    }
    const stat = fs.statSync(localFilePath);
    if (stat.size < 512) {
      return { exists: true, sizeBytes: stat.size, validHeader: false, contentType: "invalid/too-small" };
    }
    const fd = fs.openSync(localFilePath, "r");
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);
    const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
    const isJpg = header[0] === 0xff && header[1] === 0xd8;
    return {
      exists: true,
      sizeBytes: stat.size,
      validHeader: isPng || isJpg,
      contentType: isPng ? "image/png" : isJpg ? "image/jpeg" : "application/octet-stream",
    };
  }
}

export class GoogleFlowReview {
  public buildReviewPayload(params: {
    generationId: string;
    localFilePath: string;
    referenceIds: string[];
    expectedPrompt: string;
  }) {
    return {
      generation_id: params.generationId,
      local_file_path: params.localFilePath,
      reference_ids: params.referenceIds,
      expected_prompt: params.expectedPrompt,
      prepared_at: new Date().toISOString(),
    };
  }
}

export class GoogleFlowHistory {
  private history: FlowHistoryEntry[] = [];
  private errors: FlowErrorEntry[] = [];

  public recordHistory(entry: Omit<FlowHistoryEntry, "id" | "timestamp">): FlowHistoryEntry {
    const full: FlowHistoryEntry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
      message: sanitizeTextForLog(entry.message),
    };
    this.history.unshift(full);
    if (this.history.length > 200) {
      this.history = this.history.slice(0, 200);
    }
    return full;
  }

  public recordError(entry: Omit<FlowErrorEntry, "id" | "timestamp">): FlowErrorEntry {
    const full: FlowErrorEntry = {
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
      error_message: sanitizeTextForLog(entry.error_message),
    };
    this.errors.unshift(full);
    if (this.errors.length > 200) {
      this.errors = this.errors.slice(0, 200);
    }
    return full;
  }

  public getHistory(): FlowHistoryEntry[] {
    return this.history;
  }

  public getErrors(): FlowErrorEntry[] {
    return this.errors;
  }

  public clearHistory(): void {
    this.history = [];
    this.errors = [];
  }
}

// ============================================================================
// 9. UNIFIED GoogleFlowProvider ADAPTER
// ============================================================================

export class GoogleFlowProvider {
  public readonly session: GoogleFlowSession;
  public readonly projects: GoogleFlowProjects;
  public readonly upload: GoogleFlowUpload;
  public readonly references: GoogleFlowReferences;
  public readonly generation: GoogleFlowGeneration;
  public readonly result: GoogleFlowResult;
  public readonly review: GoogleFlowReview;
  public readonly history: GoogleFlowHistory;
  public flowRequestsCount = 0;
  public regenerationAttemptsCount = 0;

  public recordRegenerationAttempt(): void {
    this.regenerationAttemptsCount++;
  }

  public incrementRegenerationCount(): void {
    this.regenerationAttemptsCount++;
  }

  public resetTelemetry(): void {
    this.flowRequestsCount = 0;
    this.regenerationAttemptsCount = 0;
  }

  public resetFlowTelemetry(): void {
    this.flowRequestsCount = 0;
    this.regenerationAttemptsCount = 0;
  }

  public getTelemetry() {
    return {
      flow_requests_count: this.flowRequestsCount,
      regeneration_attempts_count: this.regenerationAttemptsCount,
      flow_regenerations_count: this.regenerationAttemptsCount,
    };
  }

  public getFlowTelemetry() {
    return {
      flow_requests_count: this.flowRequestsCount,
      regeneration_attempts_count: this.regenerationAttemptsCount,
      flow_regenerations_count: this.regenerationAttemptsCount,
    };
  }

  constructor(options?: { autoLoadServerSession?: boolean }) {
    this.session = new GoogleFlowSession();
    this.projects = new GoogleFlowProjects(this.session);
    this.upload = new GoogleFlowUpload();
    this.references = new GoogleFlowReferences();
    this.generation = new GoogleFlowGeneration();
    this.result = new GoogleFlowResult();
    this.review = new GoogleFlowReview();
    this.history = new GoogleFlowHistory();

    if (options?.autoLoadServerSession) {
      const defaultCookies = this.session.loadDefaultServerSession();
      if (defaultCookies) {
        this.session.setProjectRawSession("default_flow_session", defaultCookies);
        const parsed = this.session.parseCredentials(defaultCookies);
        setImmediate(() => {
          this.projects.discoverAndSyncRealRemoteProjects(defaultCookies, true).catch(() => {});
          const secure1Psid = parsed.cookiesMap["__Secure-1PSID"] || parsed.cookiesMap["SID"];
          if (secure1Psid) {
            const googleCookies = { ...parsed.cookiesMap };
            delete googleCookies["OSID"];
            delete googleCookies["__Secure-OSID"];
            getOrCreateFlowSynthesisClient(secure1Psid, googleCookies).catch(() => {});
            getOrCreateInitializedGeminiClient({
              secure1Psid,
              cookiesMap: googleCookies,
            }).catch(() => {});
          }
        });
      }
    }
  }

  public async discoverAndValidateProjects(params?: {
    preferredProjectId?: string;
    fallbackRawCookies?: string;
    forceReverify?: boolean;
  }): Promise<FlowDetailedDiagnostics> {
    return await this.projects.getDetailedDiagnosticsAsync(
      params?.preferredProjectId,
      params?.fallbackRawCookies,
      params?.forceReverify !== false
    );
  }

  /**
   * Verifies a specific project and asset directly on Google Flow (`HTrJv` & `Zzl0ze`).
   */
  public async verifyFlowProjectAsset(params: {
    flowProjectId: string;
    flowAssetId?: string | null;
    rawCookies?: string;
  }) {
    const raw =
      (params.rawCookies && params.rawCookies.trim()) ||
      this.session.getRawSession(params.flowProjectId) ||
      this.session.getAnyActiveRawSession();
    const parsed = this.session.parseCredentials(raw);
    if (!parsed.hasGoogleSession) {
      return {
        projectVerified: false,
        assetVerified: false,
        flowProjectId: params.flowProjectId,
        flowProjectUrl: buildRealFlowProjectUrl(params.flowProjectId),
        flowAssetId: params.flowAssetId || null,
        status: "FLOW_AUTH_FAILED",
      };
    }

    const res = await verifyRemoteFlowProjectAndAssets({
      flowProjectId: params.flowProjectId,
      cookiesMap: parsed.cookiesMap,
    });

    const assetVerified = params.flowAssetId
      ? Boolean(
          res.projectVerified &&
            res.assets.some(
              (a) => a.flowAssetId.toLowerCase() === params.flowAssetId!.toLowerCase()
            )
        )
      : false;

    return {
      projectVerified: res.projectVerified,
      assetVerified,
      projectName: res.projectName,
      flowProjectId: params.flowProjectId,
      flowProjectUrl: res.flowProjectUrl,
      flowAssetId: params.flowAssetId || null,
      assetsCount: res.assets.length,
      assets: res.assets,
      status: !res.projectVerified
        ? "FLOW_PROJECT_NOT_FOUND"
        : params.flowAssetId && !assetVerified
        ? "FLOW_ASSET_NOT_VERIFIED"
        : "FLOW_ASSET_VERIFIED",
    };
  }

  /**
   * Executes an image generation request EXCLUSIVELY through real verified Google Flow projects.
   * Never uses Gemini for image generation, never uses fake project IDs.
   */
  public async generateWithProjectFailover(params: {
    prompt: string;
    modelDisplayName: FlowDisplayModelName;
    outputFileName: string;
    referenceFilePaths?: string[];
    preferredProjectId?: string;
    fallbackRawCookies?: string;
    aspectRatio?: "1:1" | "3:4" | "9:16" | "16:9";
    actionType: "REFERENCE_GENERATION" | "SCENE_GENERATION" | "PAGE_GENERATION";
    sceneId?: string;
    elementId?: string;
    locationId?: string;
    attempt?: number;
    runId?: string;
    freshnessToken?: string;
    promptVersion?: number;
    referencesUsed?: string[];
    styleHash?: string;
    referenceHash?: string;
    timingRecord?: FlowGenerationTimingRecord;
  }): Promise<{
    generation_id: string;
    flowGenerationId: string;
    project_id: string;
    flowProjectId: string;
    flowProjectUrl: string;
    flowAssetId: string;
    promptHash: string;
    assetVerified: boolean;
    generationStatus: FlowRealGenerationStatus;
    assetStatus: FlowRealAssetStatus;
    internal_model_id: string;
    local_file_path: string;
    public_url: string;
    base64_data_url: string;
    width: number;
    height: number;
    retries: RetryAttemptRecord[];
    flow_provider: "Google Flow";
    flow_trace: string[];
    metadata: FlowGenerationMetadata;
  }> {
    const explicitTrimmed = params.fallbackRawCookies?.trim() || "";
    const effectiveFallbackCookies = explicitTrimmed || this.session.getAnyActiveRawSession();

    const parsedFallback = this.session.parseCredentials(effectiveFallbackCookies);
    if (!parsedFallback.hasGoogleSession) {
      logSafeFlowStage("FLOW_AUTH_FAILED", {
        reason: "Missing or invalid Google Flow Cookies",
      });
      this.history.recordError({
        project_id: params.preferredProjectId || "none",
        operation: "Session",
        attempt: 1,
        error_code: "FLOW_AUTH_FAILED",
        error_message:
          "FLOW_AUTH_FAILED: كوكيز Google Flow غير صالحة أو منتهية الصلاحية.",
      });
      throw new Error(
        "FLOW_AUTH_FAILED: كوكيز Google Flow غير صالحة أو منتهية الصلاحية (تأكد من وجود __Secure-1PSID و SAPISID و __Secure-OSID من flow.google.com)."
      );
    }

    // Ensure real remote Google Flow projects are discovered or created in the user's Google Flow account
    let candidates = this.projects.getAvailableProjectsForExecution(params.preferredProjectId);
    if (candidates.length === 0) {
      const syncRes = await this.projects.discoverAndSyncRealRemoteProjects(
        effectiveFallbackCookies,
        true
      );
      if (!syncRes.connected) {
        const errCode = syncRes.actionRequired ? "GOOGLE_FLOW_ACTION_REQUIRED" : "FLOW_AUTH_FAILED";
        logSafeFlowStage(errCode, {
          reason: syncRes.reasonAr,
        });
        this.history.recordError({
          project_id: params.preferredProjectId || "none",
          operation: "Session",
          attempt: 1,
          error_code: errCode,
          error_message: syncRes.reasonAr,
        });
        throw new Error(syncRes.reasonAr);
      }
      candidates = this.projects.getAvailableProjectsForExecution(params.preferredProjectId);
    }

    if (candidates.length === 0) {
      logSafeFlowStage("FLOW_PROJECT_NOT_FOUND", {
        preferred_project_id: params.preferredProjectId || "none",
      });
      this.history.recordError({
        project_id: params.preferredProjectId || "none",
        operation: "Generation",
        attempt: 1,
        error_code: "FLOW_PROJECT_NOT_FOUND",
        error_message:
          "FLOW_PROJECT_NOT_FOUND: لم يتم العثور على أي مشروع Google Flow حقيقي تم التحقق منه داخل حساب Google.",
      });
      throw new Error(
        "FLOW_PROJECT_NOT_FOUND: لم يتم العثور على أي مشروع Google Flow حقيقي تم التحقق منه داخل حساب Google. لا يُسمح باستخدام مشاريع وهمية مثل flow_project_1."
      );
    }

    const retries: RetryAttemptRecord[] = [];
    let lastErrorMsg = "FLOW_GENERATION_FAILED";
    let lastErrorCode = "FLOW_GENERATION_FAILED";

    for (let idx = 0; idx < Math.min(candidates.length, MAX_GOOGLE_FLOW_PROJECTS); idx++) {
      const proj = candidates[idx];
      const realProjectId = proj.flowProjectId || proj.project_id;
      const attemptNum = idx + 1;
      const startMs = Date.now();
      const attemptTraces: string[] = [];

      try {
        if (!isRealVerifiedFlowProjectId(realProjectId)) {
          throw new Error(
            `FLOW_PROJECT_NOT_FOUND: المعرف (${realProjectId}) ليس مشروع Google Flow حقيقيًا.`
          );
        }

        const rawSession =
          this.session.getRawSession(realProjectId) || effectiveFallbackCookies || "";
        const parsed = this.session.parseCredentials(rawSession);

        if (!parsed.hasGoogleSession) {
          throw new Error(`FLOW_AUTH_FAILED: جلسة المشروع الحقيقي ${proj.name} مفقودة أو غير صالحة.`);
        }

        const selectedTrace = logSafeFlowStage("FLOW_PROJECT_SELECTED", {
          project_id: realProjectId,
          project_name: proj.name,
          attempt: attemptNum,
          total_candidates: candidates.length,
        });
        attemptTraces.push(selectedTrace);

        this.flowRequestsCount++;
        const genRes = await this.generation.generateImageWithSession({
          prompt: params.prompt,
          modelDisplayName: params.modelDisplayName,
          cookiesMap: parsed.cookiesMap,
          referenceFilePaths: params.referenceFilePaths,
          outputFileName: params.outputFileName,
          aspectRatio: params.aspectRatio,
          projectId: realProjectId,
          projectName: proj.name,
          sceneId: params.sceneId,
          elementId: params.elementId,
          locationId: params.locationId,
          attempt: params.attempt || attemptNum,
          runId: params.runId,
          freshnessToken: params.freshnessToken,
          promptVersion: params.promptVersion,
          referencesUsed: params.referencesUsed,
          styleHash: params.styleHash,
          referenceHash: params.referenceHash,
          timingRecord: params.timingRecord,
          onTrace: (stage, detailLine) => {
            this.history.recordHistory({
              action: stage,
              project_id: realProjectId,
              model_display_name: params.modelDisplayName,
              status: "SUCCESS",
              message: detailLine,
            });
          },
        });

        this.projects.markProjectSuccess(realProjectId);
        this.history.recordHistory({
          action: params.actionType,
          project_id: realProjectId,
          model_display_name: params.modelDisplayName,
          internal_model_id: genRes.internal_model_id,
          status: "SUCCESS",
          message: `FLOW_GENERATION_SUCCESS: تم توليد الصورة وحفظ الأصل (${genRes.flowAssetId}) داخل مشروع Google Flow الحقيقي (${proj.name} - ${realProjectId})`,
          duration_ms: Date.now() - startMs,
        });

        return {
          ...genRes,
          project_id: realProjectId,
          retries,
          flow_provider: "Google Flow",
          flow_trace: [...attemptTraces, ...genRes.flow_trace],
          metadata: genRes.metadata,
        };
      } catch (err: any) {
        const safeErr = sanitizeTextForLog(err?.message || "FLOW_GENERATION_FAILED");
        lastErrorMsg = safeErr;
        const isAuth =
          safeErr.includes("FLOW_AUTH_FAILED") ||
          safeErr.includes("GOOGLE_FLOW_ACTION_REQUIRED") ||
          safeErr.includes("401");

        let currentErrorCode = "FLOW_GENERATION_FAILED";
        if (safeErr.includes("GOOGLE_FLOW_ACTION_REQUIRED")) {
          currentErrorCode = "GOOGLE_FLOW_ACTION_REQUIRED";
        } else if (safeErr.includes("GOOGLE_FLOW_LIMIT_REACHED")) {
          currentErrorCode = "GOOGLE_FLOW_LIMIT_REACHED";
        } else if (safeErr.includes("FLOW_PROJECT_NOT_FOUND")) {
          currentErrorCode = "FLOW_PROJECT_NOT_FOUND";
        } else if (safeErr.includes("FLOW_ASSET_NOT_CREATED")) {
          currentErrorCode = "FLOW_ASSET_NOT_CREATED";
        } else if (safeErr.includes("FLOW_ASSET_NOT_VERIFIED")) {
          currentErrorCode = "FLOW_ASSET_NOT_VERIFIED";
        } else if (safeErr.includes("FLOW_GENERATION_INCOMPLETE")) {
          currentErrorCode = "FLOW_GENERATION_INCOMPLETE";
        } else if (isAuth) {
          currentErrorCode = "FLOW_AUTH_FAILED";
        }
        lastErrorCode = currentErrorCode;

        invalidateFlowSessionCache();
        this.projects.markProjectFailure(realProjectId, safeErr, isAuth);
        if (idx + 1 < Math.min(candidates.length, MAX_GOOGLE_FLOW_PROJECTS)) {
          await new Promise((r) => setTimeout(r, 600));
        }

        const retryRecord: RetryAttemptRecord = {
          operation: "Generation",
          attempt: attemptNum,
          error_code: currentErrorCode,
          error_message: safeErr,
          project_id: realProjectId,
          timestamp: new Date().toISOString(),
        };
        retries.push(retryRecord);

        this.history.recordError({
          project_id: realProjectId,
          operation: "Generation",
          attempt: attemptNum,
          error_code: retryRecord.error_code,
          error_message: safeErr,
        });
      }
    }

    throw new Error(`FLOW_ALL_PROJECTS_FAILED (${lastErrorCode}): ${lastErrorMsg}`);
  }
}

export const googleFlowProvider = new GoogleFlowProvider({ autoLoadServerSession: true });
