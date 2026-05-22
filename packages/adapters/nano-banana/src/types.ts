// Google Gemini Image API model slugs. Public name "Nano Banana" — internal slug below.
export const NANO_BANANA_MODELS = {
  "nano-banana-2": "gemini-3-flash-image-preview",
  "nano-banana-pro": "gemini-3-pro-image-preview",
} as const;

export type NanoBananaModel = keyof typeof NANO_BANANA_MODELS;

export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "4:5";

export type OutputFormat = "webp" | "png" | "jpg";

/**
 * Spec 64.6b: hero-image output resolution. Lowercase tokens match
 * `projects.image_generation_resolution`; the adapter maps them to Gemini's
 * `imageSize` string ("512" / "1K" / "2K" / "4K" — uppercase K is required, the
 * Gemini API rejects lowercase). The "0.5k" → "512" mapping is asymmetric
 * because Gemini uses "512" (no K) for the sub-1K tier.
 *
 * Pro tier supports only "1k" / "2k" / "4k" — "0.5k" is silently upgraded to
 * "1K" in `model-inputs.ts` to avoid an HTTP 400.
 */
export type NanoBananaResolution = "0.5k" | "1k" | "2k" | "4k";

export type GenerateImageInput = {
  // Tracking
  projectId: string;
  pipelineRunId?: string;
  articleId?: string;
  /** cost_logs operation field (e.g. "hero-image-generation"). */
  operation: string;

  // Generation
  model: NanoBananaModel;
  prompt: string;
  aspectRatio?: AspectRatio;
  /** Spec 64.6b: output resolution. Defaults to "1k" when omitted. */
  resolution?: NanoBananaResolution;
  outputFormat?: OutputFormat;
  /** 1-100 — applied to webp/jpg only (png is lossless). */
  outputQuality?: number;
  /** Deterministic seed. Omit for a random seed. */
  seed?: number;

  // Storage
  /**
   * R2 key prefix. The actual key will be `${prefix}/<uuid>.<ext>`.
   * Example: "toolwiki/articles/hero" → "toolwiki/articles/hero/<uuid>.webp"
   */
  storagePrefix: string;

  /** Pre-flight cost estimate in EUR (for cost-tracker limit check). */
  estimatedCostEur: number;
};

export type GenerateImageResult = {
  /** Stable, public Cloudflare R2 URL. */
  publicUrl: string;
  /** R2 object key for later management. */
  r2Key: string;
  /** Size of stored file in bytes. */
  bytesStored: number;
  /** MIME type (e.g. "image/webp"). */
  contentType: string;
  /** The seed actually used (echoed by Gemini if provided; null when none was supplied). */
  seed: number | null;
  /** Wall-clock duration of the Gemini call. */
  durationMs: number;
  /** Resolved model slug (e.g. "gemini-3-flash-image-preview"). */
  modelSlug: string;
};

export class NanoBananaGenerationError extends Error {
  constructor(
    message: string,
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = "NanoBananaGenerationError";
  }
}
