import type { Frame, Page } from "playwright";
import { GOOGLE_TTS_SELECTORS } from "./GoogleTTSSelectors.ts";
import type { CaptchaInfo, CaptchaStatus } from "./CaptchaState.ts";

export class CaptchaDetector {
  /**
   * Inspects the demo frame and main page to detect if CAPTCHA is required or completed.
   */
  public static async inspectCaptcha(page: Page, demoFrame: Frame): Promise<CaptchaInfo> {
    try {
      const frameStatus = await demoFrame.evaluate(() => {
        const app = (document as any).querySelector("ts-app");
        if (!app) return { hasApp: false, hasToken: false, shouldShow: false };
        return {
          hasApp: true,
          hasToken: Boolean(app.captchaToken),
          shouldShow: Boolean(app.shouldShowCaptcha),
        };
      }).catch(() => ({ hasApp: false, hasToken: false, shouldShow: false }));

      // Look for recaptcha iframes
      const frames = page.frames();
      const hasAnchor = frames.some((f) => f.url().includes(GOOGLE_TTS_SELECTORS.RECAPTCHA_ANCHOR_FILTER));
      const hasBframe = frames.some((f) => f.url().includes(GOOGLE_TTS_SELECTORS.RECAPTCHA_BFRAME_FILTER));
      const hasRecaptchaFrames = hasAnchor || hasBframe;

      // Check if Free AI ReCaptcha Solver by Raptor is active, and check for DOS Captcha (Try again later)
      let raptorDetected = false;
      let isDosBlocked = false;
      const bframe = frames.find((f) => f.url().includes(GOOGLE_TTS_SELECTORS.RECAPTCHA_BFRAME_FILTER));
      if (bframe) {
        const check = await bframe.evaluate(() => {
          const isDos =
            Boolean(document.querySelector(".rc-doscaptcha-body")) ||
            (document.body && document.body.innerText.includes("Try again later"));
          const hasRaptorSteps = typeof (window as any).__recaptchaSteps !== "undefined";
          const hasImageSelect = Boolean(document.querySelector(".rc-imageselect, .rc-imageselect-target"));
          const hasRaptorHook = hasRaptorSteps || Boolean(document.querySelector("#solver-button, .help-button-holder, .rc-imageselect"));
          return {
            isDos,
            raptor: hasRaptorHook || hasImageSelect,
          };
        }).catch(() => ({ isDos: false, raptor: false }));

        isDosBlocked = check.isDos;
        raptorDetected = check.raptor;
      }

      let status: CaptchaStatus = "NONE";
      let message = "لا يوجد تحقق CAPTCHA نشط.";

      if (frameStatus.hasToken) {
        status = "COMPLETED";
        message = "تم حل CAPTCHA بنجاح!";
      } else if (frameStatus.shouldShow || hasRecaptchaFrames) {
        status = "REQUIRED";
        if (isDosBlocked) {
          message =
            "تم تقييد التحدي مؤقتاً من قبل Google (Try again later). يمكنك النقر على 'إعادة تعيين الكابتشا' لتحديث التحدي، أو استخدام 'التوليد الفوري' لتخطي الكابتشا فوراً.";
        } else if (raptorDetected) {
          message = "مطلوب حل CAPTCHA - إضافة Free AI ReCaptcha Solver by Raptor متواجدة داخل النافذة وتقوم بحل الصور تلقائياً.";
        } else {
          message = "مطلوب حل Google CAPTCHA في النافذة التفاعلية.";
        }
      }

      return {
        status,
        needsCaptcha: status === "REQUIRED",
        hasCaptchaToken: frameStatus.hasToken,
        hasRecaptchaFrames,
        raptorDetected,
        busterDetected: raptorDetected,
        isDosBlocked,
        message,
        timestamp: Date.now(),
      };
    } catch (e: any) {
      return {
        status: "NONE",
        needsCaptcha: false,
        hasCaptchaToken: false,
        hasRecaptchaFrames: false,
        raptorDetected: false,
        busterDetected: false,
        message: `خطأ أثناء فحص حالة التحقق: ${e.message}`,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Waits for CAPTCHA to be completed without closing the session.
   * Periodically checks if app.captchaToken has been populated.
   */
  public static async waitForCaptchaResolution(
    demoFrame: Frame,
    timeoutMs: number = 300_000,
    onPoll?: (elapsedMs: number) => void
  ): Promise<boolean> {
    const startTime = Date.now();
    const interval = 1000;

    while (Date.now() - startTime < timeoutMs) {
      const hasToken = await demoFrame.evaluate(() => {
        const app = (document as any).querySelector("ts-app");
        return Boolean(app && app.captchaToken);
      }).catch(() => false);

      if (hasToken) {
        return true;
      }

      if (onPoll) {
        onPoll(Date.now() - startTime);
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return false;
  }
}
