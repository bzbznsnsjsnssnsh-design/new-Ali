import { ReaderAudioCache } from "./readerAudioCache";

export type TTSTaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "waiting"
  | "failed"
  // Backward compatibility aliases
  | "idle"
  | "generating"
  | "retrying"
  | "ready"
  | "error";

export interface TTSTask {
  id: string; // `${pageIndex}_${speechUnitId || blockId}`
  speechUnitId?: string;
  regionIds: string[];
  generationId: string;
  segmentId: string;
  pageIndex: number;
  blockId: string;
  blockIndex: number;
  text: string;
  voiceGroup: string;
  voiceName: string; // Strictly locked chosen voice
  voiceDirection?: string;
  playbackSpeed?: number;
  priority: number; // 0: urgent (user clicked), 1: current visible page, 2: next page, 3: background
  status: TTSTaskStatus;
  retries: number;
  maxRetries: number;
  waitingReason?: "rate_limit" | "verification_required" | "none";
  waitingUntil?: number;
  addedAt: number;
  completedAt?: number;
  error?: string;
}

export type AudioSynthesizerFn = (
  text: string,
  voice: string,
  group: string,
  direction?: string,
  speed?: number,
  options?: { generationId?: string; segmentId?: string }
) => Promise<{ audioBase64: string; mimeType: string; fallbackUsed?: boolean }>;

export class ReaderTTSQueueManager {
  private chapterId: string | number;
  private synthesizer: AudioSynthesizerFn;
  private onAudioReady: (key: string, audioDataUrl: string, task: TTSTask) => void;
  private onStatusChange?: (taskId: string, status: TTSTaskStatus) => void;

  private tasks: Map<string, TTSTask> = new Map();
  // Map constituent region IDs to the speech unit task ID
  private blockToTaskIdMap: Map<string, string> = new Map();

  private activeWorkers = 0;
  private maxConcurrency = 1; // Strict single-task queue for Gemini TTS to prevent rate limits & collisions
  private minIntervalBetweenTasksMs = 600; // Pacing between consecutive tasks
  private lastTaskCompletedAt = 0;
  private isThrottling = false;
  private globalCooldownUntil = 0;
  private isRunning = true;
  private urgentResolvers: Map<string, Array<(audioUrl: string | null) => void>> = new Map();

  // Verification monitoring for Google Cloud TTS Demo
  private isCheckingVerification = false;
  private verificationPollTimer: any = null;

  constructor(options: {
    chapterId: string | number;
    synthesizer: AudioSynthesizerFn;
    onAudioReady: (key: string, audioDataUrl: string, task: TTSTask) => void;
    onStatusChange?: (taskId: string, status: TTSTaskStatus) => void;
    maxConcurrency?: number;
  }) {
    this.chapterId = options.chapterId;
    this.synthesizer = options.synthesizer;
    this.onAudioReady = options.onAudioReady;
    this.onStatusChange = options.onStatusChange;
    if (options.maxConcurrency) {
      this.maxConcurrency = options.maxConcurrency;
    }

    // Setup listener for external verification resolution
    if (typeof window !== "undefined") {
      window.addEventListener("gemini-tts-verification-resolved", this.handleVerificationResolved);
    }

    // Restore persisted queue state if available
    this.restoreState();
  }

  private handleVerificationResolved = () => {
    console.log("[TTS Queue] Verification resolved event received! Resuming waiting tasks...");
    this.resumeFromVerification();
  };

  public setConcurrency(concurrency: number) {
    this.maxConcurrency = Math.max(1, Math.min(concurrency, 3));
  }

  public setChapterId(newChapterId: string | number) {
    if (this.chapterId !== newChapterId) {
      this.persistQueueState();
      this.destroy();
      this.chapterId = newChapterId;
      this.isRunning = true;
      this.restoreState();
    }
  }

  /**
   * Persists the queue task states to localStorage for resumption on reload
   */
  private persistQueueState() {
    if (typeof window === "undefined") return;
    try {
      const stateList: any[] = [];
      for (const task of this.tasks.values()) {
        stateList.push({
          id: task.id,
          speechUnitId: task.speechUnitId,
          regionIds: task.regionIds,
          generationId: task.generationId,
          segmentId: task.segmentId,
          pageIndex: task.pageIndex,
          blockId: task.blockId,
          blockIndex: task.blockIndex,
          text: task.text,
          voiceGroup: task.voiceGroup,
          voiceName: task.voiceName,
          voiceDirection: task.voiceDirection,
          playbackSpeed: task.playbackSpeed,
          priority: task.priority,
          status: task.status === "processing" ? "pending" : task.status,
          retries: task.retries,
          maxRetries: task.maxRetries,
          waitingReason: task.waitingReason,
          addedAt: task.addedAt,
          completedAt: task.completedAt,
        });
      }
      localStorage.setItem(`reader_tts_queue_${this.chapterId}`, JSON.stringify(stateList));
    } catch (_) {}
  }

  /**
   * Restores queue tasks from localStorage across page reloads
   */
  private restoreState() {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(`reader_tts_queue_${this.chapterId}`);
      if (!raw) return;
      const parsed: any[] = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      for (const item of parsed) {
        const status: TTSTaskStatus =
          item.status === "completed" || item.status === "ready"
            ? "completed"
            : item.status === "waiting"
            ? "waiting"
            : item.status === "failed"
            ? "failed"
            : "pending";

        const task: TTSTask = {
          ...item,
          status,
          regionIds: item.regionIds || [item.blockId],
        };

        this.tasks.set(task.id, task);

        // Map region IDs
        for (const rId of task.regionIds) {
          this.blockToTaskIdMap.set(`${task.pageIndex}_${rId}`, task.id);
        }

        // Verify if completed task audio is in cache
        if (status === "completed") {
          const cacheKey = ReaderAudioCache.makeKey(
            this.chapterId,
            task.pageIndex,
            task.speechUnitId || task.blockId,
            task.voiceGroup,
            task.voiceName,
            task.text,
            task.playbackSpeed,
            task.generationId
          );

          ReaderAudioCache.get(cacheKey, {
            expectedBlockId: task.speechUnitId || task.blockId,
            expectedText: task.text,
            expectedVoice: task.voiceName,
          }).then((cached) => {
            if (cached) {
              this.onAudioReady(cacheKey, cached, task);
              for (const rId of task.regionIds) {
                const aliasKey = ReaderAudioCache.makeKey(
                  this.chapterId,
                  task.pageIndex,
                  rId,
                  task.voiceGroup,
                  task.voiceName,
                  task.text,
                  task.playbackSpeed,
                  task.generationId
                );
                this.onAudioReady(aliasKey, cached, task);
              }
            }
          });
        }
      }

      console.log(`[TTS Queue] Restored ${this.tasks.size} tasks for chapter ${this.chapterId}`);
      // Resume pending or waiting tasks
      setTimeout(() => this.dispatchNext(), 300);
    } catch (_) {}
  }

  /**
   * Enqueue a single translated block into the queue
   */
  public enqueueSingleBlock(
    pageIndex: number,
    block: any,
    blockIndex: number,
    voiceGroup: string,
    voiceName: string,
    voiceDirection: string = "",
    playbackSpeed: number = 1.0,
    currentVisiblePageIndex: number = 0,
    generationId?: string
  ) {
    this.enqueuePageBlocks(
      pageIndex,
      [block],
      voiceGroup,
      voiceName,
      voiceDirection,
      playbackSpeed,
      currentVisiblePageIndex,
      generationId
    );
  }

  /**
   * Enqueue all translated text blocks from a page into the background queue.
   * Consecutive regions sharing a speech_unit_id are unified into a single sentence task!
   */
  public enqueuePageBlocks(
    pageIndex: number,
    blocks: any[],
    voiceGroup: string,
    voiceName: string,
    voiceDirection: string = "",
    playbackSpeed: number = 1.0,
    currentVisiblePageIndex: number = 0,
    generationId?: string
  ) {
    if (!blocks || blocks.length === 0 || !this.isRunning) return;

    const lockedVoice = (voiceName || "Achernar").replace(/^gemini-/, "").trim();
    const activeGenId = generationId || `gen_ch${this.chapterId}_v_${lockedVoice}`;

    // Group page blocks by speech_unit_id (or standalone region_id)
    const groupedMap = new Map<string, any[]>();

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const rawText = block.speech_unit_text || block.translated_text || block.translatedText || block.text || "";
      const cleanText = rawText
        .replace(/[\n\r]+/g, " ")
        .replace(/[~～〜]/g, "")
        .replace(/\uFFFD/g, "")
        .replace(/[◆◇♦]/g, "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!cleanText) continue;

      // Ensure block has an immutable region_id
      const assignedRegionId = String(
        block.region_id || block.id || `p${pageIndex}_reg_${i + 1}`
      ).trim();
      block.region_id = assignedRegionId;
      if (!block.id) block.id = assignedRegionId;

      const groupKey = block.speech_unit_id || assignedRegionId;
      if (!groupedMap.has(groupKey)) {
        groupedMap.set(groupKey, []);
      }
      groupedMap.get(groupKey)!.push({ block, blockIndex: i, cleanText });
    }

    let pagePriority = 3;
    if (pageIndex === currentVisiblePageIndex) {
      pagePriority = 1;
    } else if (pageIndex === currentVisiblePageIndex + 1) {
      pagePriority = 2;
    }

    let unitCounter = 0;
    groupedMap.forEach((items, groupKey) => {
      const first = items[0];
      const speechUnitId = first.block.speech_unit_id;
      // Speech unit sentence is the complete united sentence
      const fullSentence = first.block.speech_unit_text || items.map(it => it.cleanText).join(" ");
      const regionIds = items.map(it => String(it.block.region_id || `p${pageIndex}_reg_${it.blockIndex + 1}`));
      const primaryBlockId = String(first.block.region_id || groupKey);

      const taskId = `${pageIndex}_${speechUnitId || primaryBlockId}`;

      // Associate all constituent regions strictly to this task
      for (const rId of regionIds) {
        this.blockToTaskIdMap.set(`${pageIndex}_${rId}`, taskId);
      }
      if (speechUnitId) {
        this.blockToTaskIdMap.set(`${pageIndex}_${speechUnitId}`, taskId);
      }

      const existing = this.tasks.get(taskId);
      if (
        existing &&
        (existing.status === "completed" || existing.status === "ready" || existing.status === "processing" || existing.status === "generating") &&
        existing.text === fullSentence &&
        existing.voiceName === lockedVoice
      ) {
        return;
      }

      const itemPriority = pageIndex === currentVisiblePageIndex
        ? (unitCounter === 0 ? 1.0 : 1.0 + unitCounter * 0.05)
        : pagePriority;
      unitCounter++;

      const cacheKey = ReaderAudioCache.makeKey(
        this.chapterId,
        pageIndex,
        speechUnitId || primaryBlockId,
        voiceGroup,
        lockedVoice,
        fullSentence,
        playbackSpeed,
        activeGenId
      );

      // Check persistent cache first
      ReaderAudioCache.get(cacheKey, {
        expectedBlockId: speechUnitId || primaryBlockId,
        expectedText: fullSentence,
        expectedVoice: lockedVoice,
      }).then((cached) => {
        if (cached && this.isRunning) {
          const task: TTSTask = {
            id: taskId,
            speechUnitId,
            regionIds,
            generationId: activeGenId,
            segmentId: primaryBlockId,
            pageIndex,
            blockId: primaryBlockId,
            blockIndex: first.blockIndex,
            text: fullSentence,
            voiceGroup,
            voiceName: lockedVoice,
            voiceDirection,
            playbackSpeed,
            priority: itemPriority,
            status: "completed",
            retries: 0,
            maxRetries: 3,
            addedAt: Date.now(),
            completedAt: Date.now(),
          };

          this.tasks.set(taskId, task);
          this.onStatusChange?.(taskId, "completed");
          this.onAudioReady(cacheKey, cached, task);

          // Also notify ready for all constituent regions
          for (const rId of regionIds) {
            const aliasKey = ReaderAudioCache.makeKey(
              this.chapterId,
              pageIndex,
              rId,
              voiceGroup,
              lockedVoice,
              fullSentence,
              playbackSpeed,
              activeGenId
            );
            this.onAudioReady(aliasKey, cached, task);
          }

          this.resolveUrgent(taskId, cached);
          this.persistQueueState();
          return;
        }

        if (!this.isRunning) return;

        const task: TTSTask = {
          id: taskId,
          speechUnitId,
          regionIds,
          generationId: activeGenId,
          segmentId: primaryBlockId,
          pageIndex,
          blockId: primaryBlockId,
          blockIndex: first.blockIndex,
          text: fullSentence,
          voiceGroup,
          voiceName: lockedVoice,
          voiceDirection,
          playbackSpeed,
          priority: itemPriority,
          status: "pending",
          retries: 0,
          maxRetries: 3,
          addedAt: Date.now(),
        };

        this.tasks.set(taskId, task);
        this.onStatusChange?.(taskId, "pending");
        this.persistQueueState();
        this.dispatchNext();
      });
    });
  }

  /**
   * Adjust priorities when user navigates pages
   */
  public updateVisiblePage(currentVisiblePageIndex: number) {
    for (const task of this.tasks.values()) {
      if (task.status === "pending" || task.status === "waiting") {
        if (task.pageIndex === currentVisiblePageIndex) {
          task.priority = 1;
        } else if (task.pageIndex === currentVisiblePageIndex + 1) {
          task.priority = 2;
        } else {
          task.priority = 3;
        }
      }
    }
    this.dispatchNext();
  }

  /**
   * User clicked a speech bubble directly.
   * If audio is completed, returns it immediately.
   * If pending or waiting, elevates priority to 0 (URGENT) and returns Promise.
   */
  public async requestUrgentBubble(
    pageIndex: number,
    regionId: string | number,
    text: string,
    voiceGroup: string,
    voiceName: string,
    voiceDirection: string = "",
    playbackSpeed: number = 1.0,
    speechUnitId?: string,
    generationId?: string
  ): Promise<string | null> {
    const rawId = String(regionId).trim();
    const lookupKey = `${pageIndex}_${rawId}`;
    let taskId = this.blockToTaskIdMap.get(lookupKey);
    if (!taskId && speechUnitId) {
      taskId = this.blockToTaskIdMap.get(`${pageIndex}_${speechUnitId}`);
    }
    if (!taskId) {
      taskId = `${pageIndex}_${speechUnitId || rawId}`;
    }

    const lockedVoice = (voiceName || "Achernar").replace(/^gemini-/, "").trim();
    const activeGenId = generationId || `gen_ch${this.chapterId}_v_${lockedVoice}`;

    const task = this.tasks.get(taskId);
    // Strict task region check: task must explicitly contain rawId
    const taskMatchesRegion = Boolean(
      task && (
        task.id === `${pageIndex}_${rawId}` ||
        task.blockId === rawId ||
        (Array.isArray(task.regionIds) && task.regionIds.includes(rawId))
      )
    );

    const validTask = taskMatchesRegion ? task : null;
    const effectiveText = validTask ? validTask.text : text;
    const effectiveUnitId = validTask?.speechUnitId || speechUnitId || rawId;
    if (!validTask) {
      taskId = `${pageIndex}_${rawId}`;
    }

    const cacheKey = ReaderAudioCache.makeKey(
      this.chapterId,
      pageIndex,
      effectiveUnitId,
      voiceGroup,
      lockedVoice,
      effectiveText,
      playbackSpeed,
      activeGenId
    );

    // 1. Instant check in cache with strict region and speech unit validation
    const cached = await ReaderAudioCache.get(cacheKey, {
      expectedRegionId: rawId,
      expectedSpeechUnitId: speechUnitId,
      expectedText: effectiveText,
      expectedVoice: lockedVoice,
    });
    if (cached) {
      return cached;
    }

    // Also check rawId cache key in case cached under constituent region
    const aliasCached = await ReaderAudioCache.get(
      ReaderAudioCache.makeKey(
        this.chapterId,
        pageIndex,
        rawId,
        voiceGroup,
        lockedVoice,
        effectiveText,
        playbackSpeed,
        activeGenId
      ),
      { expectedRegionId: rawId, expectedSpeechUnitId: speechUnitId, expectedText: effectiveText, expectedVoice: lockedVoice }
    );
    if (aliasCached) {
      return aliasCached;
    }

    if (task) {
      if (task.status === "completed" || task.status === "ready") {
        const audio = await ReaderAudioCache.get(cacheKey, {
          expectedRegionId: rawId,
          expectedSpeechUnitId: speechUnitId,
          expectedVoice: lockedVoice,
        });
        if (audio) return audio;
      }

      // Elevate priority to 0
      task.priority = 0;
      if (task.status === "waiting" && task.waitingReason === "rate_limit") {
        // Fast-forward cooldown for urgent user clicks
        task.status = "pending";
      }
      this.onStatusChange?.(taskId, task.status);
      this.dispatchNext();

      return new Promise<string | null>((resolve) => {
        if (!this.urgentResolvers.has(taskId)) {
          this.urgentResolvers.set(taskId, []);
        }
        this.urgentResolvers.get(taskId)!.push(resolve);
      });
    }

    // If not in queue, create urgent task
    const urgentTask: TTSTask = {
      id: taskId,
      regionIds: [rawId],
      speechUnitId: speechUnitId,
      generationId: activeGenId,
      segmentId: rawId,
      pageIndex,
      blockId: rawId,
      blockIndex: 0,
      text: effectiveText,
      voiceGroup,
      voiceName: lockedVoice,
      voiceDirection,
      playbackSpeed,
      priority: 0,
      status: "pending",
      retries: 0,
      maxRetries: 3,
      addedAt: Date.now(),
    };

    this.tasks.set(taskId, urgentTask);
    this.blockToTaskIdMap.set(lookupKey, taskId);
    this.onStatusChange?.(taskId, "pending");
    this.persistQueueState();
    this.dispatchNext();

    return new Promise<string | null>((resolve) => {
      if (!this.urgentResolvers.has(taskId)) {
        this.urgentResolvers.set(taskId, []);
      }
      this.urgentResolvers.get(taskId)!.push(resolve);
    });
  }

  /**
   * Main queue dispatcher: picks next pending task and runs it
   */
  private dispatchNext() {
    if (!this.isRunning) return;

    if (Date.now() < this.globalCooldownUntil) {
      if (!this.isThrottling) {
        this.isThrottling = true;
        const waitTime = this.globalCooldownUntil - Date.now();
        setTimeout(() => {
          this.isThrottling = false;
          this.dispatchNext();
        }, Math.max(waitTime, 500));
      }
      return;
    }

    while (this.activeWorkers < this.maxConcurrency) {
      const task = this.getNextPendingTask();
      if (!task) break;

      const timeSinceLast = Date.now() - this.lastTaskCompletedAt;
      if (timeSinceLast < this.minIntervalBetweenTasksMs && task.priority > 0) {
        if (!this.isThrottling) {
          this.isThrottling = true;
          setTimeout(() => {
            this.isThrottling = false;
            this.dispatchNext();
          }, this.minIntervalBetweenTasksMs - timeSinceLast);
        }
        break;
      }

      this.activeWorkers++;
      this.processTask(task)
        .catch((err) => {
          console.error(`[TTS Queue] Error on task ${task.id}:`, err);
        })
        .finally(() => {
          this.activeWorkers--;
          this.lastTaskCompletedAt = Date.now();
          this.persistQueueState();
          this.dispatchNext();
        });
    }
  }

  private getNextPendingTask(): TTSTask | null {
    let bestTask: TTSTask | null = null;

    for (const task of this.tasks.values()) {
      if (task.status !== "pending") continue;

      if (!bestTask) {
        bestTask = task;
        continue;
      }

      if (task.priority < bestTask.priority) {
        bestTask = task;
      } else if (task.priority === bestTask.priority) {
        if (task.addedAt < bestTask.addedAt) {
          bestTask = task;
        }
      }
    }

    return bestTask;
  }

  /**
   * Executes a single audio synthesis task
   */
  private async processTask(task: TTSTask): Promise<void> {
    const lockedVoice = task.voiceName;
    task.status = "processing";
    this.onStatusChange?.(task.id, "processing");

    const primaryUnitId = task.speechUnitId || task.blockId;
    const cacheKey = ReaderAudioCache.makeKey(
      this.chapterId,
      task.pageIndex,
      primaryUnitId,
      task.voiceGroup,
      lockedVoice,
      task.text,
      task.playbackSpeed,
      task.generationId
    );

    try {
      console.log(
        `[TTS Queue] Synthesizing task ${task.id} (${lockedVoice}) [Priority: ${task.priority}] "${task.text.substring(0, 30)}..."`
      );

      const res = await this.synthesizer(
        task.text,
        lockedVoice,
        task.voiceGroup,
        task.voiceDirection,
        task.playbackSpeed,
        { generationId: task.generationId, segmentId: primaryUnitId }
      );

      if (res.fallbackUsed) {
        throw new Error(`رفض استخدام الصوت البديل: تم طلب الصوت الرسمي "${lockedVoice}" لكن الخادم حاول استبداله.`);
      }

      if (!res.audioBase64) {
        throw new Error("لم يتم استلام أي بيانات صوتية من الخادم.");
      }

      const mime = res.mimeType || "audio/mp3";
      const audioDataUrl = `data:${mime};base64,${res.audioBase64}`;

      // Build alias keys for all constituent region IDs
      const aliasKeys = (task.regionIds || []).map(rId =>
        ReaderAudioCache.makeKey(
          this.chapterId,
          task.pageIndex,
          rId,
          task.voiceGroup,
          lockedVoice,
          task.text,
          task.playbackSpeed,
          task.generationId
        )
      );

      // Persist to cache under primary speech unit and alias region IDs
      await ReaderAudioCache.setWithAliases(
        cacheKey,
        aliasKeys,
        this.chapterId,
        audioDataUrl,
        {
          generationId: task.generationId,
          pageIndex: task.pageIndex,
          blockId: primaryUnitId,
          region_id: task.blockId,
          region_ids: task.regionIds,
          speech_unit_id: task.speechUnitId,
          text: task.text,
          voiceGroup: task.voiceGroup,
          voiceName: lockedVoice,
          playbackSpeed: task.playbackSpeed,
        }
      );

      task.status = "completed";
      task.completedAt = Date.now();
      task.error = undefined;
      task.waitingReason = "none";
      this.onStatusChange?.(task.id, "completed");

      // Notify ready for primary key and all aliases
      this.onAudioReady(cacheKey, audioDataUrl, task);
      for (const aKey of aliasKeys) {
        this.onAudioReady(aKey, audioDataUrl, task);
      }

      this.resolveUrgent(task.id, audioDataUrl);
      this.persistQueueState();
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.warn(`[TTS Queue] Error on task ${task.id}:`, errMsg);

      // 1. Check for Google Cloud TTS Demo Verification
      const isVerification =
        err?.isVerification ||
        err?.code === "VERIFICATION_REQUIRED" ||
        errMsg.includes("VERIFICATION_REQUIRED") ||
        errMsg.includes("CAPTCHA_REQUIRED") ||
        errMsg.includes("reCAPTCHA");

      if (isVerification) {
        console.warn(`[TTS Queue] Task ${task.id} entered WAITING state for Google Cloud TTS verification.`);
        task.status = "waiting";
        task.waitingReason = "verification_required";
        task.error = "بانتظار إكمال خطوة التحقق في Google Cloud TTS...";
        this.onStatusChange?.(task.id, "waiting");
        this.persistQueueState();

        // Start active monitoring of verification status
        this.startVerificationMonitoring();
        return;
      }

      // 2. Check for Rate Limit (429 / quota limit)
      const isQuotaError =
        errMsg.includes("429") ||
        errMsg.includes("quota") ||
        errMsg.includes("RESOURCE_EXHAUSTED") ||
        errMsg.includes("limit");

      if (isQuotaError) {
        const backoffDelay = Math.min(15_000 * Math.pow(2, task.retries), 60_000);
        this.globalCooldownUntil = Date.now() + backoffDelay;
        task.retries++;
        task.status = "waiting";
        task.waitingReason = "rate_limit";
        task.waitingUntil = Date.now() + backoffDelay;
        task.error = `انتظار تجديد الحصة (${Math.round(backoffDelay / 1000)} ثانية)...`;
        this.onStatusChange?.(task.id, "waiting");
        this.persistQueueState();

        setTimeout(() => {
          if (this.isRunning && task.status === "waiting") {
            task.status = "pending";
            task.waitingReason = "none";
            this.onStatusChange?.(task.id, "pending");
            this.dispatchNext();
          }
        }, backoffDelay);
        return;
      }

      // 3. General Retry with Exponential Backoff
      if (task.retries < task.maxRetries) {
        task.retries++;
        const backoffDelay = Math.min(1500 * Math.pow(2, task.retries - 1), 10_000);
        task.status = "waiting";
        task.waitingReason = "none";
        task.error = `محاولة ${task.retries}/${task.maxRetries}... (${errMsg})`;
        this.onStatusChange?.(task.id, "waiting");
        this.persistQueueState();

        setTimeout(() => {
          if (this.isRunning && task.status === "waiting") {
            task.status = "pending";
            this.onStatusChange?.(task.id, "pending");
            this.dispatchNext();
          }
        }, backoffDelay);
      } else {
        // Max retries exceeded
        task.status = "failed";
        task.error = errMsg;
        this.onStatusChange?.(task.id, "failed");
        this.resolveUrgent(task.id, null);
        this.persistQueueState();
      }
    }
  }

  /**
   * Polls the server status endpoint to detect when Google Cloud TTS verification is completed
   */
  private startVerificationMonitoring() {
    if (this.isCheckingVerification) return;
    this.isCheckingVerification = true;

    if (this.verificationPollTimer) {
      clearInterval(this.verificationPollTimer);
    }

    this.verificationPollTimer = setInterval(async () => {
      if (!this.isRunning) {
        this.stopVerificationMonitoring();
        return;
      }

      try {
        const res = await fetch("/api/gemini-tts/status");
        if (res.ok) {
          const status = await res.json();
          // If browser frame has token or captcha is solved
          if (status.pageReady && (status.hasToken || status.isCaptchaResolved || !status.needsCaptcha)) {
            console.log("[TTS Queue] Detected Google Cloud TTS verification completion! Resuming queue...");
            this.resumeFromVerification();
          }
        }
      } catch (_) {}
    }, 2500);
  }

  private stopVerificationMonitoring() {
    this.isCheckingVerification = false;
    if (this.verificationPollTimer) {
      clearInterval(this.verificationPollTimer);
      this.verificationPollTimer = null;
    }
  }

  /**
   * Resumes waiting tasks once verification is resolved
   */
  public resumeFromVerification() {
    this.stopVerificationMonitoring();

    let hasResumed = false;
    for (const task of this.tasks.values()) {
      if (task.status === "waiting" && task.waitingReason === "verification_required") {
        task.status = "pending";
        task.waitingReason = "none";
        task.error = undefined;
        this.onStatusChange?.(task.id, "pending");
        hasResumed = true;
      }
    }

    if (hasResumed) {
      this.persistQueueState();
      this.dispatchNext();
    }
  }

  private resolveUrgent(taskId: string, audioUrl: string | null) {
    const list = this.urgentResolvers.get(taskId);
    if (list && list.length > 0) {
      this.urgentResolvers.delete(taskId);
      list.forEach((cb) => cb(audioUrl));
    }
  }

  public getTaskStatus(taskId: string): TTSTaskStatus | null {
    return this.tasks.get(taskId)?.status || null;
  }

  public getAllTasks(): TTSTask[] {
    return Array.from(this.tasks.values());
  }

  public clear() {
    this.tasks.clear();
    this.blockToTaskIdMap.clear();
    this.urgentResolvers.clear();
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(`reader_tts_queue_${this.chapterId}`);
      } catch (_) {}
    }
  }

  public destroy() {
    this.isRunning = false;
    this.stopVerificationMonitoring();
    if (typeof window !== "undefined") {
      window.removeEventListener("gemini-tts-verification-resolved", this.handleVerificationResolved);
    }
    this.tasks.clear();
    this.blockToTaskIdMap.clear();
    this.urgentResolvers.clear();
  }
}
