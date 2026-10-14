import type { Page } from "playwright";
import { GOOGLE_TTS_CONFIG } from "./GoogleTTSConfig.ts";

export class GoogleTTSPage {
  public static async navigateToDemo(page: Page): Promise<void> {
    await page.goto(GOOGLE_TTS_CONFIG.DEMO_URL, {
      waitUntil: "domcontentloaded",
      timeout: GOOGLE_TTS_CONFIG.TIMEOUT_MS,
    });
  }
}
