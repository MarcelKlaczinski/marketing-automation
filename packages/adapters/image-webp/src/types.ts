/**
 * Spec 64.6c: image-to-WebP conversion adapter.
 *
 * The adapter sits between an image producer (Gemini / Replicate / manual upload)
 * and R2 storage. Inputs that are NOT already WebP are converted via sharp; the
 * WebP variant becomes the canonical asset and the pre-conversion original is
 * stored alongside (under a `/originals/` subpath) for forensic fallback.
 *
 * Solves the Spec 64.6 / Discovery #14 footgun: the Gemini Image API silently
 * ignored our `outputFormat: "webp"` hint and returned whatever it wanted. R2
 * keys ended with `.webp` but the bytes were PNG. With this adapter the R2 key
 * extension matches the actual bytes — always.
 */

export interface ConvertImageToWebpInput {
  projectId: string;
  /** Raw image bytes from the producer (Gemini inlineData, Replicate download, multipart upload, ...). */
  bytes: Uint8Array;
  /** MIME type reported by the producer. Used as a hint only — magic-byte sniffing wins on disagreement. */
  contentType: string;
  /**
   * R2 key prefix. The WebP lands at `<prefix>/<uuid>.webp`; when a conversion
   * happened, the original lands at `<prefix>/originals/<uuid>.<ext>`.
   * Leading/trailing slashes are stripped.
   */
  storagePrefix: string;
  /** WebP encoder quality 1-100. Default 85 — Google-recommended balance for hero images. */
  quality?: number;
  /**
   * When true, the pre-conversion original is discarded after the WebP write
   * succeeds (no R2 upload). Default false: originals are kept for forensic
   * fallback. Set true for memory-constrained pipelines or when the producer
   * keeps its own copy upstream.
   */
  discardOriginal?: boolean;
}

export interface ConvertImageToWebpResult {
  /** R2 key of the canonical WebP image. Always set. */
  webpKey: string;
  /** Stable public URL for the WebP image. Always set. */
  webpUrl: string;
  /** Byte size of the stored WebP. */
  webpBytes: number;
  /**
   * R2 key of the pre-conversion original. `null` when:
   * - the input was already WebP (no conversion, no original stored), or
   * - `discardOriginal: true` was passed.
   */
  originalKey: string | null;
  /** Stable public URL for the original, when stored. */
  originalUrl: string | null;
  /** Byte size of the stored original, when stored. */
  originalBytes: number | null;
  /**
   * `true` if magic-byte detection said the input was already WebP; the bytes
   * were uploaded as-is and no sharp conversion ran. Independent of
   * `contentType` — Gemini may lie about the content type, magic bytes don't.
   */
  alreadyWebp: boolean;
}

export class ImageWebpError extends Error {
  constructor(
    message: string,
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = "ImageWebpError";
  }
}
