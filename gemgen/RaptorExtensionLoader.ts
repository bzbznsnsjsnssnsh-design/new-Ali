import fs from "fs";
import path from "path";

export type RaptorStatus = "RAPTOR_AVAILABLE" | "RAPTOR_UNAVAILABLE";

export interface RaptorVerificationResult {
  status: RaptorStatus;
  isAvailable: boolean;
  extensionPath: string;
  manifestVersion?: number;
  version?: string;
  name?: string;
  description?: string;
  details: string;
  errors: string[];
  requiredFilesFound: string[];
  missingFiles: string[];
}

export class RaptorExtensionLoader {
  private static cachedResult: RaptorVerificationResult | null = null;
  private static isLoadedInBrowser: boolean = false;
  private static serviceWorkerUrl: string | null = null;

  // Expected relative directory
  public static readonly DEFAULT_PATH = path.resolve(process.cwd(), "extensions/raptor");

  /**
   * Verify official Free AI ReCaptcha Solver by Raptor extension directory structure and manifest.json
   */
  public static verifyExtension(customPath?: string): RaptorVerificationResult {
    const extPath = customPath ? path.resolve(customPath) : this.DEFAULT_PATH;
    const errors: string[] = [];
    const requiredFilesFound: string[] = [];
    const missingFiles: string[] = [];

    // Check directory existence
    if (!fs.existsSync(extPath)) {
      return {
        status: "RAPTOR_UNAVAILABLE",
        isAvailable: false,
        extensionPath: extPath,
        details: `مجلد إضافة Free AI ReCaptcha Solver by Raptor غير موجود في المسار: ${extPath}`,
        errors: [`Directory does not exist: ${extPath}`],
        requiredFilesFound: [],
        missingFiles: ["manifest.json"],
      };
    }

    // Check manifest.json
    const manifestPath = path.join(extPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return {
        status: "RAPTOR_UNAVAILABLE",
        isAvailable: false,
        extensionPath: extPath,
        details: "ملف manifest.json مفقود داخل مجلد إضافة Raptor.",
        errors: ["manifest.json missing"],
        requiredFilesFound: [],
        missingFiles: ["manifest.json"],
      };
    }

    let manifest: any = null;
    try {
      const content = fs.readFileSync(manifestPath, "utf-8");
      manifest = JSON.parse(content);
    } catch (e: any) {
      return {
        status: "RAPTOR_UNAVAILABLE",
        isAvailable: false,
        extensionPath: extPath,
        details: `تعذر قراءة أو فك شفرة ملف manifest.json: ${e.message}`,
        errors: [e.message],
        requiredFilesFound: [],
        missingFiles: [],
      };
    }

    // Validate Raptor characteristics
    const name = manifest.name || "Free AI ReCaptcha Solver by Raptor (Captcha Plugin)";
    const version = manifest.version || "0.2.30";
    const manifestVersion = manifest.manifest_version || 0;
    const description = manifest.description || "";

    // Required files check according to Free AI ReCaptcha Solver by Raptor
    const essentialFiles = [
      "manifest.json",
      "background.js",
      "captcha/recaptcha.js",
      "models/type.onnx",
      "models/grid.onnx",
    ];

    for (const relFile of essentialFiles) {
      const fullPath = path.join(extPath, relFile);
      if (fs.existsSync(fullPath)) {
        requiredFilesFound.push(relFile);
      } else {
        missingFiles.push(relFile);
        errors.push(`Missing essential file: ${relFile}`);
      }
    }

    const isAvailable = missingFiles.length === 0 && manifestVersion >= 3;
    const status: RaptorStatus = isAvailable ? "RAPTOR_AVAILABLE" : "RAPTOR_UNAVAILABLE";

    const result: RaptorVerificationResult = {
      status,
      isAvailable,
      extensionPath: extPath,
      manifestVersion,
      version,
      name,
      description,
      details: isAvailable
        ? `إضافة Free AI ReCaptcha Solver by Raptor (الإصدار ${version}) جاهزة للتحميل كـ Unpacked Extension.`
        : `ملفات إضافة Raptor غير مكتملة. الملفات المفقودة: ${missingFiles.join(", ")}`,
      errors,
      requiredFilesFound,
      missingFiles,
    };

    this.cachedResult = result;
    return result;
  }

  /**
   * Generates Chromium launch arguments for Playwright
   */
  public static getChromiumArgs(customPath?: string): string[] {
    const check = this.verifyExtension(customPath);
    if (!check.isAvailable) {
      return [];
    }

    return [
      `--disable-extensions-except=${check.extensionPath}`,
      `--load-extension=${check.extensionPath}`,
    ];
  }

  /**
   * Mark that the extension has been physically confirmed loaded inside Chromium context
   */
  public static recordLoaded(swUrl: string) {
    this.isLoadedInBrowser = true;
    this.serviceWorkerUrl = swUrl;
  }

  public static recordUnloaded() {
    this.isLoadedInBrowser = false;
    this.serviceWorkerUrl = null;
  }

  public static getRuntimeStatus() {
    const verified = this.cachedResult || this.verifyExtension();
    return {
      name: verified.name || "Free AI ReCaptcha Solver by Raptor (Captcha Plugin)",
      verifiedAvailable: verified.isAvailable,
      status: (verified.isAvailable && this.isLoadedInBrowser ? "RAPTOR_AVAILABLE" : "RAPTOR_UNAVAILABLE") as RaptorStatus,
      isLoadedInBrowser: this.isLoadedInBrowser,
      serviceWorkerUrl: this.serviceWorkerUrl,
      version: verified.version,
      extensionPath: verified.extensionPath,
      details: this.isLoadedInBrowser
        ? `إضافة Free AI ReCaptcha Solver by Raptor (${verified.version}) مثبتة ونشطة في متصفح Chromium الخاص بـ Gemini TTS.`
        : verified.isAvailable
        ? `ملفات إضافة Free AI ReCaptcha Solver by Raptor (${verified.version}) متوفرة محليًا وتنتظر بدء جلسة المتصفح.`
        : verified.details,
    };
  }
}
