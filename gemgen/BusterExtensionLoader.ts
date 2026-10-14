import { RaptorExtensionLoader, type RaptorStatus, type RaptorVerificationResult } from "./RaptorExtensionLoader.ts";

export type BusterStatus = "BUSTER_AVAILABLE" | "BUSTER_UNAVAILABLE" | "RAPTOR_AVAILABLE" | "RAPTOR_UNAVAILABLE";
export type BusterVerificationResult = RaptorVerificationResult;

/**
 * Backwards compatibility alias for RaptorExtensionLoader
 * Free AI ReCaptcha Solver by Raptor (Captcha Plugin) has replaced Buster
 */
export class BusterExtensionLoader {
  public static readonly DEFAULT_PATH = RaptorExtensionLoader.DEFAULT_PATH;

  public static verifyExtension(customPath?: string) {
    return RaptorExtensionLoader.verifyExtension(customPath);
  }

  public static getChromiumArgs(customPath?: string): string[] {
    return RaptorExtensionLoader.getChromiumArgs(customPath);
  }

  public static recordLoaded(swUrl: string) {
    RaptorExtensionLoader.recordLoaded(swUrl);
  }

  public static recordUnloaded() {
    RaptorExtensionLoader.recordUnloaded();
  }

  public static getRuntimeStatus() {
    return RaptorExtensionLoader.getRuntimeStatus();
  }
}

