export class GeminiTTSError extends Error {
  public code: string;
  public isVerification: boolean;

  constructor(message: string, code: string = "TTS_ERROR", isVerification: boolean = false) {
    super(message);
    this.name = "GeminiTTSError";
    this.code = code;
    this.isVerification = isVerification;
  }

  public static fromError(err: any): GeminiTTSError {
    if (err instanceof GeminiTTSError) return err;
    const msg = err?.message || String(err || "Unknown Gemini TTS error");
    const isVer = Boolean(err?.isVerification || msg.includes("VERIFICATION_REQUIRED") || msg.includes("CAPTCHA"));
    return new GeminiTTSError(msg, err?.code || (isVer ? "VERIFICATION_REQUIRED" : "TTS_ERROR"), isVer);
  }
}
