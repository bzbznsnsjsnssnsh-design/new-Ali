export class AudioDecoder {
  public static decodeBase64(audioContent: string): Buffer {
    const clean = audioContent.replace(/^data:audio\/[a-z0-9+-]+;base64,/i, "").trim();
    return Buffer.from(clean, "base64");
  }
}
