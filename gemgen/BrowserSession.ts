import { chromium, type BrowserContext, type Page, type Frame } from "playwright";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execSync } from "child_process";
import { GOOGLE_TTS_CONFIG } from "./GoogleTTSConfig.ts";
import { GOOGLE_TTS_SELECTORS } from "./GoogleTTSSelectors.ts";
import { RaptorExtensionLoader } from "./RaptorExtensionLoader.ts";
import { BusterExtensionLoader } from "./BusterExtensionLoader.ts";

export class BrowserSession {
  private static instance: BrowserSession | null = null;
  private static xvfbStarted: boolean = false;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private demoFrame: Frame | null = null;
  private userDataDir: string | null = null;
  private initPromise: Promise<{ page: Page; demoFrame: Frame }> | null = null;
  private isInitializing: boolean = false;
  private lastActivity: number = Date.now();
  private idleTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): BrowserSession {
    if (!BrowserSession.instance) {
      BrowserSession.instance = new BrowserSession();
    }
    return BrowserSession.instance;
  }

  /**
   * Discovers an available Chromium executable on the system or in Playwright cache
   */
  public static getChromiumExecutablePath(): string | undefined {
    try {
      const pwPath = chromium.executablePath();
      if (pwPath && typeof pwPath === "string" && fs.existsSync(pwPath)) {
        return pwPath;
      }
    } catch (_) {}

    const candidates = [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/snap/bin/chromium",
    ];

    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) {
          return c;
        }
      } catch (_) {}
    }

    return undefined;
  }

  /**
   * Ensures Chromium browser executable is physically installed on the system
   */
  public static ensureChromiumInstalled(): void {
    const existing = BrowserSession.getChromiumExecutablePath();
    if (existing) {
      return;
    }

    console.log("[BrowserSession] Chromium executable missing. Auto-installing Playwright chromium...");
    try {
      const cliPath = path.resolve(process.cwd(), "node_modules/playwright-core/cli.js");
      if (fs.existsSync(cliPath)) {
        execSync(`node "${cliPath}" install chromium`, {
          stdio: "pipe",
          env: { ...process.env },
        });
      } else {
        execSync("npx playwright install chromium", {
          stdio: "pipe",
          env: { ...process.env },
        });
      }
      console.log("[BrowserSession] Playwright chromium installed successfully.");
    } catch (installErr: any) {
      console.error("[BrowserSession] Failed to auto-install Playwright chromium:", installErr?.message || installErr);
      throw installErr;
    }
  }

  /**
   * Ensures Xvfb virtual display is active so extensions run with full native Chromium APIs if available
   */
  private static ensureXvfb(): void {
    if (this.xvfbStarted || process.env.DISPLAY) {
      return;
    }
    try {
      // Check if Xvfb binary is available on the system
      try {
        execSync("which Xvfb", { stdio: "ignore" });
      } catch {
        // Xvfb not installed; proceed directly with Chromium native headless mode (--headless=new)
        return;
      }

      try {
        execSync("pgrep -x Xvfb", { stdio: "ignore" });
        process.env.DISPLAY = ":99";
        this.xvfbStarted = true;
        return;
      } catch (_) {}

      const xvfb = spawn("Xvfb", [":99", "-screen", "0", "1280x900x24", "-ac"], {
        stdio: "ignore",
        detached: true,
      });

      xvfb.on("error", (err) => {
        console.warn(`[BrowserSession] Xvfb notice: ${err.message}`);
        this.xvfbStarted = false;
        if (process.env.DISPLAY === ":99") {
          delete process.env.DISPLAY;
        }
      });

      xvfb.unref();
      process.env.DISPLAY = ":99";
      this.xvfbStarted = true;
      console.log("[BrowserSession] Xvfb virtual display initialized on :99");
    } catch (e: any) {
      console.warn(`[BrowserSession] Note on Xvfb: ${e.message}`);
      if (process.env.DISPLAY === ":99") {
        delete process.env.DISPLAY;
      }
    }
  }

  /**
   * Initializes the persistent Chromium browser session with Free AI ReCaptcha Solver by Raptor
   */
  public async getSession(forceFresh: boolean = false): Promise<{ page: Page; demoFrame: Frame }> {
    this.lastActivity = Date.now();
    this.resetIdleTimer();

    if (!forceFresh && this.context && this.page && !this.page.isClosed()) {
      const liveFrame = await this.getDemoFrame();
      if (liveFrame && !liveFrame.isDetached()) {
        return { page: this.page, demoFrame: liveFrame };
      }
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initSession(forceFresh);
    try {
      return await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async _initSession(forceFresh: boolean = false): Promise<{ page: Page; demoFrame: Frame }> {
    if (forceFresh || (this.page && this.page.isClosed()) || !this.context) {
      await this.closeSession();
    }

    this.isInitializing = true;
    try {
      // Ensure chromium binary is physically present
      BrowserSession.ensureChromiumInstalled();
      const resolvedExecutable = BrowserSession.getChromiumExecutablePath();

      // Ensure persistent userDataDir is always a guaranteed valid non-null directory
      if (!this.userDataDir || typeof this.userDataDir !== "string" || !fs.existsSync(this.userDataDir)) {
        this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemgen-chrome-"));
      }
      const dirToUse = this.userDataDir;

      // Ensure Xvfb virtual frame buffer for extensions
      BrowserSession.ensureXvfb();

      // Check Free AI ReCaptcha Solver by Raptor extension
      const raptorVerification = RaptorExtensionLoader.verifyExtension();
      const extensionArgs = RaptorExtensionLoader.getChromiumArgs();

      console.log(`[BrowserSession] Launching Chromium with ${extensionArgs.length > 0 ? "Free AI ReCaptcha Solver by Raptor" : "no extensions"}...`);

      const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,900",
        "--headless=new",
        "--disable-features=IsolateOrigins,site-per-process",
        ...extensionArgs,
      ];

      const launchOptions: any = {
        headless: false, // In Playwright, Chrome extensions are loaded with headless: false + --headless=new in args
        ignoreDefaultArgs: ["--disable-extensions"],
        args: launchArgs,
        viewport: { width: 1280, height: 900 },
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      };
      if (resolvedExecutable) {
        launchOptions.executablePath = resolvedExecutable;
      }

      try {
        this.context = await chromium.launchPersistentContext(dirToUse, launchOptions);
      } catch (launchErr: any) {
        console.warn("[BrowserSession] launchPersistentContext initial attempt failed:", launchErr?.message || launchErr);
        // Attempt recovery installation and re-launch
        try {
          const cliPath = path.resolve(process.cwd(), "node_modules/playwright-core/cli.js");
          if (fs.existsSync(cliPath)) {
            execSync(`node "${cliPath}" install chromium`, { stdio: "pipe", env: { ...process.env } });
          } else {
            execSync("npx playwright install chromium", { stdio: "pipe", env: { ...process.env } });
          }
          const freshExecutable = BrowserSession.getChromiumExecutablePath();
          if (freshExecutable) {
            launchOptions.executablePath = freshExecutable;
          }
          const safeDir = (this.userDataDir && typeof this.userDataDir === "string" && fs.existsSync(this.userDataDir))
            ? this.userDataDir
            : fs.mkdtempSync(path.join(os.tmpdir(), "gemgen-chrome-"));
          this.userDataDir = safeDir;
          this.context = await chromium.launchPersistentContext(safeDir, launchOptions);
        } catch (installErr: any) {
          console.error("[BrowserSession] Failed to auto-install or recover Playwright chromium:", installErr);
          throw installErr;
        }
      }

      this.context.on("close", () => {
        console.log("[BrowserSession] BrowserContext closed.");
        this.context = null;
        this.page = null;
        this.demoFrame = null;
      });

      // Instantly capture extension service worker when registered
      this.context.on("serviceworker", (sw) => {
        const swUrl = sw.url();
        if (
          swUrl.includes("background") ||
          swUrl.includes("raptor") ||
          swUrl.includes("captchaplugin") ||
          swUrl.includes("nbioonnfgjgpepfihghjlkhfkgnanfnj")
        ) {
          RaptorExtensionLoader.recordLoaded(swUrl);
          BusterExtensionLoader.recordLoaded(swUrl);
          console.log(`[BrowserSession] Raptor service worker active: ${swUrl}`);
        }
      });

      // Check if Raptor service worker is already available
      for (const sw of this.context.serviceWorkers()) {
        const swUrl = sw.url();
        if (
          swUrl.includes("background") ||
          swUrl.includes("raptor") ||
          swUrl.includes("captchaplugin") ||
          swUrl.includes("nbioonnfgjgpepfihghjlkhfkgnanfnj")
        ) {
          RaptorExtensionLoader.recordLoaded(swUrl);
          BusterExtensionLoader.recordLoaded(swUrl);
          console.log(`[BrowserSession] Raptor service worker confirmed: ${swUrl}`);
          break;
        }
      }

      this.page = this.context.pages()[0] || (await this.context.newPage());
      this.page.on("close", () => {
        console.log("[BrowserSession] Page closed.");
        this.page = null;
        this.demoFrame = null;
      });
      this.page.on("crash", () => {
        console.warn("[BrowserSession] Page crashed.");
        this.page = null;
        this.demoFrame = null;
      });

      // Navigate to Google Cloud Text-to-Speech
      console.log(`[BrowserSession] Navigating to ${GOOGLE_TTS_CONFIG.CLOUD_TTS_PAGE}...`);
      await this.page.goto(GOOGLE_TTS_CONFIG.CLOUD_TTS_PAGE, {
        waitUntil: "domcontentloaded",
        timeout: GOOGLE_TTS_CONFIG.PAGE_LOAD_TIMEOUT_MS,
      });

      // Dismiss cookie prompts if present
      for (const pattern of GOOGLE_TTS_SELECTORS.COOKIE_ACCEPT_BUTTON_PATTERNS) {
        try {
          await this.page.getByRole("button", { name: pattern }).click({ timeout: 1500 }).catch(() => {});
        } catch (_) {}
      }

      // Scroll down directly to #demo to trigger lazy loading of the demo section
      await this.page.evaluate(() => {
        const demo = document.querySelector("#demo") || document.querySelector("[data-track-name='demo']");
        if (demo) {
          demo.scrollIntoView({ behavior: "instant", block: "start" });
        } else {
          window.scrollTo(0, 1200);
        }
      }).catch(() => {});

      // Locate active demo frame
      const frame = await this.getDemoFrame();
      if (!frame) {
        throw new Error("Could not find or attach active Google TTS demo frame.");
      }

      this.demoFrame = frame;
      console.log(`[BrowserSession] Demo frame ready! URL: ${this.demoFrame.url()}`);

      // Automatically scroll and center on the #demo section for mobile users
      await this.scrollToDemo(-40);

      return { page: this.page, demoFrame: this.demoFrame };
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Dynamically resolves the active, non-detached Google TTS demo frame
   */
  public async getDemoFrame(): Promise<Frame | null> {
    if (!this.page || this.page.isClosed()) return null;

    // 1. Check existing demoFrame
    if (this.demoFrame && !this.demoFrame.isDetached()) {
      try {
        const hasApp = await this.demoFrame.evaluate(() => Boolean(document.querySelector("ts-app"))).catch(() => false);
        if (hasApp) return this.demoFrame;
      } catch (_) {}
    }

    // 2. Search existing frames in page
    try {
      const frames = this.page.frames();
      for (const f of frames) {
        if (f.isDetached()) continue;
        if (f.url().includes(GOOGLE_TTS_SELECTORS.DEMO_IFRAME_FILTER) || f.url().includes("text_to_speech")) {
          const hasApp = await f.evaluate(() => Boolean(document.querySelector("ts-app"))).catch(() => false);
          if (hasApp) {
            this.demoFrame = f;
            return f;
          }
        }
      }
    } catch (_) {}

    // 3. Check mainFrame if page itself is the direct demo page
    try {
      if (this.page.url().includes("text_to_speech")) {
        const mainFrame = this.page.mainFrame();
        if (!mainFrame.isDetached()) {
          const hasApp = await mainFrame.evaluate(() => Boolean(document.querySelector("ts-app"))).catch(() => false);
          if (hasApp) {
            this.demoFrame = mainFrame;
            return mainFrame;
          }
        }
      }
    } catch (_) {}

    // 4. Scroll to #demo and wait for iframe attachment
    await this.scrollToDemo(-40).catch(() => {});
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 600));
      if (!this.page || this.page.isClosed()) break;
      for (const f of this.page.frames()) {
        if (f.isDetached()) continue;
        if (f.url().includes(GOOGLE_TTS_SELECTORS.DEMO_IFRAME_FILTER) || f.url().includes("text_to_speech")) {
          const hasApp = await f.evaluate(() => Boolean(document.querySelector("ts-app"))).catch(() => false);
          if (hasApp) {
            this.demoFrame = f;
            return f;
          }
        }
      }
    }

    // 5. Fallback: navigate directly to DEMO_PAGE
    try {
      console.log(`[BrowserSession] Direct demo frame fallback navigation: ${GOOGLE_TTS_CONFIG.DEMO_PAGE}`);
      await this.page.goto(GOOGLE_TTS_CONFIG.DEMO_PAGE, {
        waitUntil: "domcontentloaded",
        timeout: 25_000,
      });
      await this.page.waitForSelector(GOOGLE_TTS_SELECTORS.TS_APP_TAG, { timeout: 12_000 }).catch(() => {});
      this.demoFrame = this.page.mainFrame();
      return this.demoFrame;
    } catch (e: any) {
      console.warn("[BrowserSession] Fallback navigation notice:", e?.message || e);
    }

    return null;
  }

  /**
   * Scrolls the page directly to the #demo section and Google Cloud TTS iframe
   */
  public async scrollToDemo(offset: number = -40): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      await this.page.evaluate((off) => {
        const iframe = document.querySelector("iframe[src*='text_to_speech']");
        const demo = document.querySelector("#demo") || document.querySelector("[data-track-name='demo']");
        const target = iframe || demo;
        if (target) {
          target.scrollIntoView({ behavior: "instant", block: "start" });
          if (off) {
            window.scrollBy(0, off);
          }
        } else {
          // Fallback approximate position of the demo on cloud.google.com
          window.scrollTo(0, 1150);
        }
      }, offset);
      await this.page.waitForTimeout(300);
    } catch (_) {}
  }

  /**
   * Scrolls the page up or down by a given pixel delta
   */
  public async scrollBy(deltaY: number): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      await this.page.evaluate((dy) => {
        window.scrollBy({ top: dy, behavior: "instant" });
      }, deltaY);
      await this.page.waitForTimeout(200);
    } catch (_) {}
  }

  /**
   * Captures a high-resolution screenshot of the current page for live UI preview and interaction,
   * ensuring it is focused on the demo section for mobile and desktop users.
   */
  public async getScreenshot(): Promise<{ base64: string; width: number; height: number }> {
    if (!this.page || this.page.isClosed()) {
      await this.getSession();
    }
    
    // Ensure viewport is scrolled to the demo area if at the top
    try {
      const scrollY = await this.page!.evaluate(() => window.scrollY);
      if (scrollY < 600) {
        await this.scrollToDemo(-40);
      }
    } catch (_) {}

    const buf = await this.page!.screenshot({ fullPage: false, type: "jpeg", quality: 80 });
    return {
      base64: buf.toString("base64"),
      width: 1280,
      height: 900,
    };
  }

  /**
   * Allows click interaction at specified (x, y) coordinates for manual or Buster CAPTCHA solving
   */
  public async clickAt(x: number, y: number): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    await this.page.mouse.click(x, y);
  }

  /**
   * Automatically triggers Free AI ReCaptcha Solver by Raptor on any active reCAPTCHA challenge
   */
  public async triggerRaptorSolve(): Promise<{ success: boolean; message: string }> {
    if (!this.page || this.page.isClosed()) {
      await this.getSession();
    }
    if (!this.page) {
      return { success: false, message: "جلسة المتصفح غير متوفرة." };
    }

    try {
      const frames = this.page.frames();
      let bframe = frames.find((f) => f.url().includes("bframe"));

      // If bframe not open, click the reCAPTCHA checkbox in anchor frame to open challenge
      if (!bframe) {
        const anchor = frames.find((f) => f.url().includes("anchor"));
        if (anchor) {
          const checkbox = await anchor.$(".recaptcha-checkbox-border, #recaptcha-anchor");
          if (checkbox) {
            console.log("[BrowserSession] Clicking reCAPTCHA anchor to prompt Raptor AI solver...");
            await checkbox.click();
            await this.page.waitForTimeout(2000);
          }
        }
      }

      // Re-check for active bframe challenge
      bframe = this.page.frames().find((f) => f.url().includes("bframe"));
      
      // Let Raptor's neural network model solve the active challenge
      console.log("[BrowserSession] Raptor AI solver active. Monitoring reCAPTCHA resolution...");

      // Wait up to 10 seconds checking if reCAPTCHA token has been issued
      for (let i = 0; i < 10; i++) {
        await this.page.waitForTimeout(1000);
        if (this.demoFrame) {
          const hasToken = await this.demoFrame.evaluate(() => {
            const app = (document as any).querySelector("ts-app");
            return Boolean(app?.captchaToken);
          }).catch(() => false);

          if (hasToken) {
            return { success: true, message: "تم حل تحقق reCAPTCHA تلقائياً بنجاح بواسطة إضافة Free AI ReCaptcha Solver by Raptor!" };
          }
        }

        // Also check if bframe has verify button ready
        if (bframe) {
          const isSolved = await bframe.evaluate(() => {
            const box = (window.top as any)?.document?.querySelector(".recaptcha-checkbox");
            return box?.getAttribute("aria-checked") === "true";
          }).catch(() => false);

          if (isSolved) {
            return { success: true, message: "تم حل تحقق reCAPTCHA تلقائياً بنجاح بواسطة إضافة Free AI ReCaptcha Solver by Raptor!" };
          }
        }
      }

      return {
        success: true,
        message: "تم تفعيل إضافة Free AI ReCaptcha Solver by Raptor لحل التحدي بالذكاء الاصطناعي، يمكنك متابعة النتيجة أو إكمال الحل.",
      };
    } catch (err: any) {
      return { success: false, message: `فشل تشغيل Raptor: ${err.message}` };
    }
  }

  /**
   * Backwards compatible alias for Raptor solver
   */
  public async triggerBusterSolve(): Promise<{ success: boolean; message: string }> {
    return this.triggerRaptorSolve();
  }

  /**
   * Resets or reloads the active CAPTCHA challenge (particularly useful when blocked by 'Try again later' DOS screen)
   */
  public async resetCaptchaChallenge(): Promise<{ success: boolean; message: string }> {
    if (!this.page || this.page.isClosed()) {
      await this.getSession();
    }
    if (!this.page) {
      return { success: false, message: "جلسة المتصفح غير متوفرة." };
    }

    try {
      const frames = this.page.frames();
      const bframe = frames.find((f) => f.url().includes("bframe"));

      if (bframe) {
        // 1. Look for Buster reset button or Google reload button
        const resetBtn = await bframe.$(
          "#reset-button, .solver-controls button, #recaptcha-reload-button, .rc-button-reload, button[title*='Reset'], button[title*='challenge']"
        );
        if (resetBtn) {
          console.log("[BrowserSession] Clicking reset-button in bframe...");
          await resetBtn.click({ timeout: 3000 }).catch(() => {});
          await this.page.waitForTimeout(2000);
          return {
            success: true,
            message: "تم النقر على زر إعادة تعيين الكابتشا وتحديث التحدي بنجاح.",
          };
        }
      }

      // 2. Try calling grecaptcha.reset in demoFrame
      if (this.demoFrame) {
        const resetExecuted = await this.demoFrame.evaluate(() => {
          try {
            if ((window as any).grecaptcha?.reset) {
              (window as any).grecaptcha.reset();
              return true;
            }
            const app = (document as any).querySelector("ts-app");
            if (app) {
              app.captchaToken = null;
              app.shouldShowCaptcha = true;
              return true;
            }
            return false;
          } catch {
            return false;
          }
        }).catch(() => false);

        if (resetExecuted) {
          await this.page.waitForTimeout(2000);
          return {
            success: true,
            message: "تم إعادة تعيين كود التحقق وتحديثه بنجاح.",
          };
        }
      }

      // 3. Fallback: Reload demoFrame to refresh reCAPTCHA instance completely
      if (this.demoFrame) {
        console.log("[BrowserSession] Reloading demoFrame to refresh CAPTCHA challenge...");
        await this.demoFrame.evaluate(() => {
          window.location.reload();
        }).catch(() => {});
        await this.page.waitForTimeout(3000);
        return {
          success: true,
          message: "تمت إعادة تحميل نافذة التحقق لتجاوز رسالة Try again later.",
        };
      }

      return {
        success: false,
        message: "لم يتم العثور على نافذة اختبار التحقق لتحديثها.",
      };
    } catch (err: any) {
      return { success: false, message: `فشل إعادة تعيين الكابتشا: ${err.message}` };
    }
  }

  /**
   * Reloads only the official Google Cloud Text-to-Speech page in the browser session without affecting the main application.
   * Performs an authentic, complete browser page refresh (page.reload / page.goto) and re-attaches the demo interface.
   */
  public async reloadCloudTtsPage(): Promise<{ success: boolean; message: string; screenshot?: { base64: string; width: number; height: number } }> {
    try {
      console.log(`[BrowserSession] Performing full authentic browser page reload on Google Cloud Text-to-Speech (${GOOGLE_TTS_CONFIG.CLOUD_TTS_PAGE})...`);
      this.demoFrame = null;

      // Check if active page exists; if closed or uninitialized, start a fresh session
      if (!this.page || this.page.isClosed() || !this.context) {
        console.log("[BrowserSession] No active page found, launching/reconnecting fresh browser session...");
        await this.getSession(true);
      } else {
        // Execute an authentic full page reload from the browser
        try {
          console.log("[BrowserSession] Calling page.reload({ waitUntil: 'domcontentloaded' })...");
          await this.page.reload({
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
        } catch (reloadErr) {
          console.warn("[BrowserSession] page.reload encountered an issue, navigating fresh to URL:", reloadErr);
          await this.page.goto(GOOGLE_TTS_CONFIG.CLOUD_TTS_PAGE, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
        }

        // Wait briefly for resources to settle
        await this.page.waitForTimeout(1500).catch(() => {});

        // Dismiss any cookie consent dialogs if they re-appeared upon full reload
        for (const pattern of GOOGLE_TTS_SELECTORS.COOKIE_ACCEPT_BUTTON_PATTERNS) {
          try {
            await this.page.getByRole("button", { name: pattern }).click({ timeout: 1000 }).catch(() => {});
          } catch (_) {}
        }

        // Scroll down to #demo section to activate dynamic demo iframe
        await this.page.evaluate(() => {
          const demo = document.querySelector("#demo") || document.querySelector("[data-track-name='demo']");
          if (demo) {
            demo.scrollIntoView({ behavior: "instant", block: "start" });
          } else {
            window.scrollTo(0, 1200);
          }
        }).catch(() => {});

        // Re-locate and attach the fresh demoFrame after the full reload
        this.demoFrame = await this.getDemoFrame();
        await this.scrollToDemo(-40);
      }

      const screenshot = await this.getScreenshot().catch(() => undefined);
      return {
        success: true,
        message: "تم عمل Refresh حقيقي وإعادة تحميل صفحة Google Cloud بالكامل من جديد بنجاح.",
        screenshot,
      };
    } catch (err: any) {
      console.error("[BrowserSession] reloadCloudTtsPage error:", err);
      // Attempt full session recovery if reload failed critically
      try {
        console.log("[BrowserSession] Recovering with a fresh session...");
        await this.getSession(true);
        const screenshot = await this.getScreenshot().catch(() => undefined);
        return {
          success: true,
          message: "تمت إعادة تشغيل وتحميل صفحة Google Cloud TTS بالكامل بنجاح.",
          screenshot,
        };
      } catch (recErr: any) {
        return {
          success: false,
          message: `فشل إعادة تحميل صفحة Google Cloud TTS: ${err.message}`,
        };
      }
    }
  }

  /**
   * Reloads the Google Cloud Text-to-Speech page and immediately attempts solving CAPTCHA
   */
  public async reloadAndSolveCaptcha(): Promise<{ success: boolean; message: string; screenshot?: { base64: string; width: number; height: number } }> {
    try {
      console.log("[BrowserSession] Reloading Google Cloud page and triggering CAPTCHA resolution...");
      const reloadRes = await this.reloadCloudTtsPage();
      if (!reloadRes.success) {
        return reloadRes;
      }

      // Small pause to let frames load
      await this.page?.waitForTimeout(2500);

      // Trigger Raptor AI solving
      const raptorRes = await this.triggerRaptorSolve().catch(() => ({ success: false, message: "" }));
      const screenshot = await this.getScreenshot().catch(() => undefined);

      return {
        success: true,
        message: raptorRes.message
          ? `تمت إعادة تحميل صفحة Google بنجاح: ${raptorRes.message}`
          : "تمت إعادة تحميل صفحة Google والبدء في حل اختبار التحقق (CAPTCHA).",
        screenshot,
      };
    } catch (err: any) {
      console.error("[BrowserSession] reloadAndSolveCaptcha error:", err);
      const screenshot = await this.getScreenshot().catch(() => undefined);
      return {
        success: false,
        message: `حدث خطأ أثناء إعادة التحميل وحل الكابتشا: ${err.message}`,
        screenshot,
      };
    }
  }

  /**
   * Directly opens or navigates to the official Google Cloud Text-to-Speech page
   */
  public async openCloudTtsPage(): Promise<{ success: boolean; message: string; screenshot?: { base64: string; width: number; height: number } }> {
    try {
      console.log(`[BrowserSession] Ensuring session and navigating to ${GOOGLE_TTS_CONFIG.CLOUD_TTS_PAGE}...`);
      await this.getSession();
      await this.scrollToDemo(-40);
      const screenshot = await this.getScreenshot().catch(() => undefined);
      return {
        success: true,
        message: "تم فتح متصفح Chromium وتنشيط واجهة #demo تلقائياً بنجاح مع تفعيل إضافة Free AI ReCaptcha Solver by Raptor.",
        screenshot,
      };
    } catch (err: any) {
      console.error("[BrowserSession] openCloudTtsPage failed:", err);
      return { success: false, message: `فشل فتح صفحة #demo: ${err.message}` };
    }
  }

  /**
   * Cleans up and resets browser session
   */
  public async closeSession(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    try {
      if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
      if (this.context) await this.context.close().catch(() => {});
    } catch (_) {}
    this.context = null;
    this.page = null;
    this.demoFrame = null;
    const oldDir = this.userDataDir;
    this.userDataDir = null;
    if (oldDir && typeof oldDir === "string") {
      try {
        fs.rmSync(oldDir, { recursive: true, force: true });
      } catch (_) {}
    }
    RaptorExtensionLoader.recordUnloaded();
    BusterExtensionLoader.recordUnloaded();
    console.log("[BrowserSession] Session closed and temp data cleared.");
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(async () => {
      console.log("[BrowserSession] Idle timeout reached. Closing browser to conserve memory.");
      await this.closeSession();
    }, GOOGLE_TTS_CONFIG.IDLE_SESSION_TIMEOUT_MS);
  }

  public isReady(): boolean {
    return Boolean(
      this.context &&
      this.page &&
      !this.page.isClosed() &&
      this.demoFrame &&
      !this.demoFrame.isDetached()
    );
  }
}
