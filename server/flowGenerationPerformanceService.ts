import crypto from "crypto";
import type { FlowDisplayModelName } from "../src/types/novelToManga.ts";
import { isRealVerifiedFlowProjectId, buildRealFlowProjectUrl } from "../src/types/novelToManga.ts";

export interface FlowTimingRecord {
  record_id: string;
  target_id: string;
  target_type: string;
  model_id: string;
  internal_model_id?: string;
  project_id?: string;
  prompt_hash?: string;
  style_hash?: string;
  reference_hash?: string;
  requested_aspect_ratio?: string;
  prompt_cache_hit?: boolean;
  stage_status?: string;
  failure_category?: string;

  // Timestamps (ms)
  request_start: number;
  flow_submit_start?: number;
  generation_end?: number;
  image_ready?: number;
  vision_start?: number;
  vision_end?: number;
  total_end?: number;

  // Calculated metrics
  flow_generation_time?: number;
  total_time?: number;
  application_overhead?: number;
}

export type FlowGenerationTimingRecord = FlowTimingRecord;

export interface CachedPromptEntry {
  promptHash: string;
  assembledPrompt: string;
  styleHash?: string;
  referenceHash?: string;
  modelId?: string;
  timestamp: number;
}

export interface CachedReferenceAssetEntry {
  flowProjectId: string;
  flowAssetId: string;
  referenceHash: string;
  referenceVersion?: number;
  timestamp: number;
}

export interface BackgroundTaskState {
  target_id: string;
  target_type: string;
  run_token: string;
  record_id?: string;
  stage_status: string;
  timing?: FlowTimingRecord;
  updated_at: string;
  [key: string]: any;
}

export class FlowGenerationPerformanceService {
  private timingRecords: Map<string, FlowTimingRecord> = new Map();
  private promptCache: Map<string, CachedPromptEntry> = new Map();
  private referenceAssetCache: Map<string, CachedReferenceAssetEntry> = new Map();
  private backgroundTasks: Map<string, BackgroundTaskState> = new Map();
  private activeTargetOperations: Map<string, string> = new Map();
  private verifiedFlowProjects: Map<string, { projectId: string; projectUrl: string }> = new Map();
  private isWarmSession: boolean = false;

  setVerifiedFlowProject(projectId: string, projectUrl?: string): void {
    if (!projectId) return;
    this.verifiedFlowProjects.set(projectId, {
      projectId,
      projectUrl: projectUrl || buildRealFlowProjectUrl(projectId),
    });
  }

  markWarmSessionActive(active: boolean = true): void {
    this.isWarmSession = active;
  }

  isWarmSessionActive(): boolean {
    return this.isWarmSession;
  }

  // Model Resolution
  validateAndResolveModel(modelName?: string | null): {
    modelId: FlowDisplayModelName;
    internalModelId: string;
  } {
    const raw = String(modelName || "").trim();
    if (raw.includes("Pro") || raw.toLowerCase().includes("pro")) {
      return { modelId: "Nano Banana Pro", internalModelId: "imagen_3_pro" };
    }
    if (raw.includes("Lite") || raw.toLowerCase().includes("lite") || raw.includes("fast")) {
      return { modelId: "Nano Banana 2 Lite", internalModelId: "imagen_3_fast" };
    }
    return { modelId: "Nano Banana 2", internalModelId: "imagen_3_plus" };
  }

  // Operation tokens (cancellation of stale polling/verification on regenerate)
  beginTargetOperation(targetId: string): { targetId: string; runToken: string } {
    const runToken = `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.activeTargetOperations.set(targetId, runToken);
    return { targetId, runToken };
  }

  isTargetOperationActive(targetId: string, runToken: string): boolean {
    return this.activeTargetOperations.get(targetId) === runToken;
  }

  // Hashes
  computeReferenceHash(payload: {
    referenceIds: string[];
    referenceVersions?: number[];
  }): string {
    const str = `${payload.referenceIds.join(",")}_v_${(payload.referenceVersions || []).join(",")}`;
    return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
  }

  computePromptHash(payload: {
    targetId: string;
    canonicalText: string;
    styleHash?: string;
    referenceHash?: string;
    modelId?: string;
    aspectRatio?: string;
    corrections?: string[];
  }): string {
    const str = JSON.stringify({
      t: payload.targetId,
      c: payload.canonicalText,
      s: payload.styleHash,
      r: payload.referenceHash,
      m: payload.modelId,
      a: payload.aspectRatio,
      corrs: payload.corrections || [],
    });
    return crypto.createHash("sha256").update(str).digest("hex").slice(0, 24);
  }

  // Verified Flow Projects
  getVerifiedFlowProject(projectId?: string | null): {
    projectId: string;
    verified: boolean;
  } {
    if (projectId && this.verifiedFlowProjects.has(projectId)) {
      return { projectId, verified: true };
    }
    if (projectId && isRealVerifiedFlowProjectId(projectId)) {
      return { projectId: projectId.trim(), verified: true };
    }
    const first = Array.from(this.verifiedFlowProjects.values())[0];
    if (first) {
      return { projectId: first.projectId, verified: true };
    }
    return { projectId: "", verified: false };
  }

  // Prompt Cache
  getCachedPrompt(promptHash?: string | null): CachedPromptEntry | undefined {
    if (!promptHash) return undefined;
    return this.promptCache.get(promptHash);
  }

  setCachedPrompt(entry: {
    promptHash: string;
    assembledPrompt?: string;
    styleHash?: string;
    referenceHash?: string;
    modelId?: string;
  }): void {
    if (!entry.promptHash) return;
    this.promptCache.set(entry.promptHash, {
      promptHash: entry.promptHash,
      assembledPrompt: entry.assembledPrompt || "",
      styleHash: entry.styleHash,
      referenceHash: entry.referenceHash,
      modelId: entry.modelId,
      timestamp: Date.now(),
    });
  }

  // Reference Asset Cache
  getCachedReferenceAsset(
    flowProjectId: string,
    referenceHash: string
  ): CachedReferenceAssetEntry | undefined {
    const key = `${flowProjectId}:${referenceHash}`;
    return this.referenceAssetCache.get(key);
  }

  setCachedReferenceAsset(entry: {
    flowProjectId: string;
    flowAssetId: string;
    referenceHash: string;
    referenceVersion?: number;
  }): void {
    const key = `${entry.flowProjectId}:${entry.referenceHash}`;
    this.referenceAssetCache.set(key, {
      ...entry,
      timestamp: Date.now(),
    });
  }

  // Timing Records
  startTimingRecord(params: {
    targetId: string;
    targetType: string;
    modelId: string;
    internalModelId?: string;
    projectId?: string;
    promptHash?: string;
    styleHash?: string;
    referenceHash?: string;
    requestedAspectRatio?: string;
  }): FlowTimingRecord {
    const recordId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const rec: FlowTimingRecord = {
      record_id: recordId,
      target_id: params.targetId,
      target_type: params.targetType,
      model_id: params.modelId,
      internal_model_id: params.internalModelId,
      project_id: params.projectId,
      prompt_hash: params.promptHash,
      style_hash: params.styleHash,
      reference_hash: params.referenceHash,
      requested_aspect_ratio: params.requestedAspectRatio,
      request_start: Date.now(),
      stage_status: "STARTED",
    };
    this.timingRecords.set(recordId, rec);
    return rec;
  }

  finalizeCalculations(recordId: string): FlowTimingRecord | undefined {
    const rec = this.timingRecords.get(recordId);
    if (!rec) return undefined;

    const reqStart = rec.request_start || Date.now();
    const totalEnd = rec.total_end || Date.now();
    rec.total_time = Math.max(0, totalEnd - reqStart);

    if (rec.flow_submit_start && rec.generation_end) {
      rec.flow_generation_time = Math.max(0, rec.generation_end - rec.flow_submit_start);
    } else if (rec.flow_submit_start && rec.image_ready) {
      rec.flow_generation_time = Math.max(0, rec.image_ready - rec.flow_submit_start);
    } else {
      rec.flow_generation_time = 0;
    }

    rec.application_overhead = Math.max(0, rec.total_time - (rec.flow_generation_time || 0));
    return rec;
  }

  getAllTimingRecords(limit: number = 50): FlowTimingRecord[] {
    const all = Array.from(this.timingRecords.values());
    all.sort((a, b) => (b.request_start || 0) - (a.request_start || 0));
    return all.slice(0, limit);
  }

  // Background Task State
  setBackgroundTaskState(task: BackgroundTaskState): void {
    this.backgroundTasks.set(task.target_id, task);
  }

  getBackgroundTaskState(targetId: string): BackgroundTaskState | null {
    return this.backgroundTasks.get(targetId) || null;
  }

  getAllBackgroundTasks(): BackgroundTaskState[] {
    return Array.from(this.backgroundTasks.values());
  }

  // Performance Summaries
  getPerformanceSummaryByModel(): Record<
    string,
    {
      model: string;
      count: number;
      avg_flow_time_ms: number;
      avg_total_time_ms: number;
      success_rate: number;
    }
  > {
    const models: FlowDisplayModelName[] = ["Nano Banana Pro", "Nano Banana 2", "Nano Banana 2 Lite"];
    const summary: Record<string, any> = {};

    for (const m of models) {
      const records = Array.from(this.timingRecords.values()).filter((r) => r.model_id === m);
      if (records.length === 0) {
        summary[m] = {
          model: m,
          count: 0,
          avg_flow_time_ms: 0,
          avg_total_time_ms: 0,
          success_rate: 1.0,
        };
      } else {
        const totalFlow = records.reduce((acc, r) => acc + (r.flow_generation_time || 0), 0);
        const totalAll = records.reduce((acc, r) => acc + (r.total_time || 0), 0);
        const successful = records.filter(
          (r) => r.stage_status !== "POST_PROCESSING_FAILURE" && r.stage_status !== "FAILED"
        ).length;
        summary[m] = {
          model: m,
          count: records.length,
          avg_flow_time_ms: Math.round(totalFlow / records.length),
          avg_total_time_ms: Math.round(totalAll / records.length),
          success_rate: Number((successful / records.length).toFixed(2)),
        };
      }
    }

    return summary;
  }
}

export const flowGenerationPerformanceService = new FlowGenerationPerformanceService();
