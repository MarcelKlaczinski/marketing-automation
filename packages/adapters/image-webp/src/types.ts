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
  /**
   * Spec 65.16 V1.6-followup — optional downscale ceiling for the WebP output.
   * When set, sharp resizes the image to fit inside `maxWidth × ∞` (preserving
   * aspect ratio) BEFORE the WebP encode. Honours sharp's `withoutEnlargement`
   * so smaller inputs pass through unchanged. The forensic original is stored
   * at full resolution regardless.
   *
   * Use case: producer hands us a 4000×6000 stock photo (Pexels `src.original`)
   * but we render on a 1080×1350 canvas. Setting `maxWidth: 1620` (1.5× canvas
   * for retina-safety) keeps R2 compact without sacrificing sharpness at
   * render time.
   *
   * Omit for the legacy hero-image path — Gemini/Replicate already produce
   * the right size and resize is a wasted CPU spend.
   */
  maxWidth?: number;
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
