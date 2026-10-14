// Safe Text Chunker and Audio Stitcher for Google Cloud TTS (Achernar)
// Preserves 100% of words, punctuation, sentence order, and audio sequence.

export interface AudioChunk {
  audioBase64: string;
  mimeType: string;
  byteLength: number;
}

export class TextChunker {
  public static readonly SAFE_TEXT_THRESHOLD: number = 1000;
  public static readonly TARGET_CHUNK_SIZE: number = 750;

  /**
   * Determines if text exceeds safe threshold for single-call Google Cloud TTS demo synthesis.
   */
  public static shouldChunk(text?: string, threshold: number = TextChunker.SAFE_TEXT_THRESHOLD): boolean {
    if (!text) return false;
    return text.trim().length > threshold;
  }

  /**
   * Splits long text into safe, logical sentence chunks without dropping any word or punctuation.
   * Preserves exact order and all Arabic letters, diacritics, and punctuation.
   */
  public static splitText(text: string, maxChunkSize: number = TextChunker.TARGET_CHUNK_SIZE): string[] {
    const trimmed = text.trim();
    if (trimmed.length <= maxChunkSize) {
      return [trimmed];
    }

    // Split on natural Arabic/Latin sentence and clause boundaries
    // Preserves the delimiter attached to the previous chunk
    const sentenceRegex = /([^.!\?\n؛؟،]+[.!\?\n؛؟،]+|\S+)/g;
    const tokens: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = sentenceRegex.exec(trimmed)) !== null) {
      tokens.push(match[0]);
    }

    if (tokens.length === 0) {
      return [trimmed];
    }

    const chunks: string[] = [];
    let currentChunk = "";

    for (const token of tokens) {
      if (!currentChunk) {
        currentChunk = token;
      } else if (currentChunk.length + token.length + 1 <= maxChunkSize) {
        currentChunk += " " + token;
      } else {
        chunks.push(currentChunk.trim());
        currentChunk = token;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * Stitches multiple synthesized audio chunks into a single contiguous, playable audio stream.
   * Supports standard MP3 frame streams and WAV PCM containers.
   */
  public static stitchAudioChunks(
    chunks: AudioChunk[],
    encoding: string = "MP3"
  ): { audioBase64: string; mimeType: string; byteLength: number } {
    if (!chunks || chunks.length === 0) {
      throw new Error("INVALID_AUDIO_DATA: لم يتم توفير أي مقاطع صوتية للدمج.");
    }

    if (chunks.length === 1) {
      return {
        audioBase64: chunks[0].audioBase64,
        mimeType: chunks[0].mimeType,
        byteLength: chunks[0].byteLength,
      };
    }

    const isWav = encoding.toUpperCase() === "LINEAR16" || chunks[0].mimeType.includes("wav");

    if (isWav) {
      return TextChunker.stitchWavChunks(chunks);
    }

    // Default: MP3 MPEG frame stream concatenation
    return TextChunker.stitchMp3Chunks(chunks);
  }

  /**
   * Stitches MP3 chunks by concatenating MPEG audio frames while stripping secondary ID3 headers.
   */
  private static stitchMp3Chunks(
    chunks: AudioChunk[]
  ): { audioBase64: string; mimeType: string; byteLength: number } {
    const buffers: Buffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
      let buf = Buffer.from(chunks[i].audioBase64, "base64");

      // For subsequent chunks, strip any prepended ID3v2 tag to maintain pure MPEG frame continuity
      if (i > 0 && buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
        // ID3 header size is stored in bytes 6..9 as 7-bit synchsafe integer
        const tagSize =
          ((buf[6] & 0x7f) << 21) |
          ((buf[7] & 0x7f) << 14) |
          ((buf[8] & 0x7f) << 7) |
          (buf[9] & 0x7f);
        const totalHeaderSize = 10 + tagSize;
        if (buf.length > totalHeaderSize) {
          buf = buf.subarray(totalHeaderSize);
        }
      }

      buffers.push(buf);
    }

    const merged = Buffer.concat(buffers);
    return {
      audioBase64: merged.toString("base64"),
      mimeType: "audio/mp3",
      byteLength: merged.length,
    };
  }

  /**
   * Stitches WAV (PCM) chunks by taking the WAV header from the first chunk and appending raw PCM samples.
   */
  private static stitchWavChunks(
    chunks: AudioChunk[]
  ): { audioBase64: string; mimeType: string; byteLength: number } {
    const headerSize = 44;
    const firstBuf = Buffer.from(chunks[0].audioBase64, "base64");

    if (firstBuf.length < headerSize) {
      throw new Error("INVALID_AUDIO_DATA: مطلع ملف WAV تالف أو أقل من 44 بايت.");
    }

    const pcmBuffers: Buffer[] = [firstBuf.subarray(headerSize)];

    for (let i = 1; i < chunks.length; i++) {
      const buf = Buffer.from(chunks[i].audioBase64, "base64");
      if (buf.length > headerSize) {
        pcmBuffers.push(buf.subarray(headerSize));
      }
    }

    const totalPcm = Buffer.concat(pcmBuffers);
    const combined = Buffer.alloc(headerSize + totalPcm.length);

    // Copy original 44-byte header
    firstBuf.copy(combined, 0, 0, headerSize);

    // Update RIFF chunk size: (total size - 8) at offset 4
    combined.writeUInt32LE(combined.length - 8, 4);

    // Update data subchunk size at offset 40
    combined.writeUInt32LE(totalPcm.length, 40);

    // Append PCM samples
    totalPcm.copy(combined, headerSize);

    return {
      audioBase64: combined.toString("base64"),
      mimeType: "audio/wav",
      byteLength: combined.length,
    };
  }
}
