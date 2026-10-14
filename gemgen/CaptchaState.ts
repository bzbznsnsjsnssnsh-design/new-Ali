export type CaptchaStatus = "NONE" | "REQUIRED" | "COMPLETED" | "SOLVING" | "ERROR";

export interface CaptchaInfo {
  status: CaptchaStatus;
  needsCaptcha: boolean;
  hasCaptchaToken: boolean;
  hasRecaptchaFrames: boolean;
  raptorDetected?: boolean;
  busterDetected: boolean;
  isDosBlocked?: boolean;
  message: string;
  timestamp?: number;
}
