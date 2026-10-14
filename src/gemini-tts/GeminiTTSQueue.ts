import type { GeminiTTSBatchItem, GeminiTTSRequest, GeminiTTSResponse } from "./GeminiTTSTypes";
import { GeminiTTSService } from "./GeminiTTSService";

export type QueueEvent = "progress" | "captcha_pause" | "resumed" | "completed" | "error" | "item_ready";

export class GeminiTTSQueue {
  private items: GeminiTTSBatchItem[] = [];
  private isRunning: boolean = false;
  private isPausedForCaptcha: boolean = false;
  private concurrency: number = 2;
  private activeWorkers: number = 0;
  private listeners: Array<(event: QueueEvent, queue: GeminiTTSBatchItem[], currentIdx: number) => void> = [];

  constructor(items: GeminiTTSBatchItem[] = [], concurrency: number = 2) {
    this.concurrency = Math.max(1, Math.min(concurrency, 3));
    this.items = items.map((it, idx) => ({
      ...it,
      retryCount: it.retryCount || 0,
      maxRetries: it.maxRetries ?? 3,
      status: it.status || "pending",
      segmentId: it.segmentId || it.id || `seg_${idx}`,
      generationId: it.generationId || `gen_${it.voiceName || 'Achernar'}_${Date.now()}`,
    }));
  }

  public setItems(items: GeminiTTSBatchItem[]) {
    this.items = items.map((it, idx) => ({
      ...it,
      retryCount: it.retryCount || 0,
      maxRetries: it.maxRetries ?? 3,
      status: it.status || "pending",
      segmentId: it.segmentId || it.id || `seg_${idx}`,
      generationId: it.generationId || `gen_${it.voiceName || 'Achernar'}_${Date.now()}`,
    }));
    this.isRunning = false;
    this.isPausedForCaptcha = false;
    this.notify("progress");
  }

  public getItems(): GeminiTTSBatchItem[] {
    return this.items;
  }

  public getProgress(): { completed: number; total: number; percent: number } {
    const total = this.items.length;
    const completed = this.items.filter((i) => i.status === "completed" || i.status === "ready").length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, percent };
  }

  public subscribe(cb: (event: QueueEvent, queue: GeminiTTSBatchItem[], currentIdx: number) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify(event: QueueEvent, currentIdx: number = 0) {
    this.listeners.forEach((cb) => cb(event, this.items, currentIdx));
  }

  /**
   * Starts or resumes processing the queue with limited concurrency
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPausedForCaptcha = false;
    this.notify("resumed");

    // Spawn concurrent workers
    const workerPromises: Promise<void>[] = [];
    for (let i = 0; i < this.concurrency; i++) {
      workerPromises.push(this.workerLoop());
    }

    await Promise.all(workerPromises);

    this.isRunning = false;
    if (!this.isPausedForCaptcha) {
      this.notify("completed");
    }
  }

  /**
   * Worker loop: pulls next pending / retrying item
   */
  private async workerLoop(): Promise<void> {
    while (this.isRunning && !this.isPausedForCaptcha) {
      const nextItem = this.items.find(
        (i) => i.status === "pending" || i.status === "queued" || i.status === "idle"
      );

      if (!nextItem) {
        // No more items ready right now
        break;
      }

      await this.processItem(nextItem);
    }
  }

  /**
   * Processes a single item with exponential backoff retries
   * Strictly preserves locked voiceName throughout all retries
   */
  private async processItem(item: GeminiTTSBatchItem): Promise<void> {
    const lockedVoice = item.voiceName; // STRICT VOICE LOCK: Never change!
    item.status = "generating";
    this.notify("progress");

    let success = false;

    while (!success && this.isRunning && !this.isPausedForCaptcha) {
      try {
        const req: GeminiTTSRequest = {
          text: item.text,
          voiceDirection: item.voiceDirection,
          voiceName: lockedVoice, // ALWAYS THE EXACT SAME VOICE
          generationId: item.generationId,
          segmentId: item.segmentId || item.id,
          allowFallback: false, // NO FALLBACK VOICES
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: lockedVoice,
              },
            },
          },
        };

        const result: GeminiTTSResponse = await GeminiTTSService.synthesize(req);

        // Verify that received audio is not fallback
        if (result.fallbackUsed) {
          throw new Error(`رفض الصوت البديل: تم حظر استبدال الصوت وتثبيت "${lockedVoice}".`);
        }

        item.result = result;
        item.status = "ready";
        const mime = result.mimeType || "audio/mp3";
        item.audioUrl = `data:${mime};base64,${result.audioBase64}`;
        item.error = undefined;
        success = true;
        this.notify("item_ready");
        this.notify("progress");
      } catch (err: any) {
        const msg = err?.message || String(err);

        // Check CAPTCHA pause
        if (msg.includes("CAPTCHA_REQUIRED") || msg.includes("captcha")) {
          console.warn("[GeminiTTSQueue] Queue paused for CAPTCHA resolution at item:", item.id);
          item.status = "paused_captcha";
          item.error = "بانتظار حل اختبار التحقق (CAPTCHA)...";
          this.isRunning = false;
          this.isPausedForCaptcha = true;
          this.notify("captcha_pause");
          return;
        }

        // Retry with exponential backoff
        const maxRetries = item.maxRetries ?? 3;
        const currentRetry = item.retryCount ?? 0;

        if (currentRetry < maxRetries) {
          item.retryCount = currentRetry + 1;
          item.status = "retrying";
          item.error = `محاولة ${item.retryCount}/${maxRetries}... (${msg})`;
          this.notify("progress");

          // Exponential backoff: 1s, 2s, 4s...
          const backoffDelay = Math.min(1000 * Math.pow(2, currentRetry), 8000);
          await new Promise((r) => setTimeout(r, backoffDelay));
        } else {
          // All retries failed for this item: set failed, do NOT block queue
          item.status = "failed";
          item.error = msg;
          this.notify("error");
          this.notify("progress");
          break;
        }
      }
    }
  }

  /**
   * Retries a specific failed item using its original locked voice
   */
  public async retryItem(itemId: string): Promise<void> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item) return;

    item.status = "pending";
    item.retryCount = 0;
    item.error = undefined;
    this.notify("progress");

    if (!this.isRunning) {
      this.start();
    }
  }

  /**
   * Pauses the queue
   */
  public pause(): void {
    this.isRunning = false;
    this.notify("progress");
  }

  /**
   * Resumes the queue after CAPTCHA or pause
   */
  public resume(): void {
    if (this.isPausedForCaptcha) {
      const pausedItems = this.items.filter((i) => i.status === "paused_captcha");
      pausedItems.forEach((it) => {
        it.status = "pending";
      });
      this.isPausedForCaptcha = false;
    }
    this.start();
  }

  public isQueueRunning(): boolean {
    return this.isRunning;
  }

  public isCaptchaPaused(): boolean {
    return this.isPausedForCaptcha;
  }
}
