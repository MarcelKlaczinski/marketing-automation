export const REPLICATE_MODELS = {
  "flux-1.1-pro": "black-forest-labs/flux-1.1-pro",
  "flux-schnell": "black-forest-labs/flux-schnell",
  "ideogram-v3": "ideogram-ai/ideogram-v3",
} as const;

export type ReplicateModel = keyof typeof REPLICATE_MODELS;

export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9" | "3:2" | "2:3";

export type OutputFormat = "webp" | "jpg" | "png";

export type GenerateImageInput = {
  // Tracking
  projectId: string;
  pipelineRunId?: string;
  articleId?: string;
  /** cost_logs operation field (e.g. "hero-image", "social-carousel-slide"). */
  operation: string;

  // Generation
  model: ReplicateModel;
  prompt: string;
  /** Negative prompt — Ideogram supports it; Flux ignores. */
  negativePrompt?: string;
  aspectRatio?: AspectRatio;
  outputFormat?: OutputFormat;
  /** 1-100, higher = better quality. flux-1.1-pro maps to output_quality 80-100. */
  quality?: number;
  /** Random seed for reproducibility. Omit for a random seed. */
  seed?: number;

  // Storage
  /**
   * R2 key prefix. The actual key will be `${prefix}/<uuid>.<ext>`.
   * Example: "ki-wissensraum/articles/hero" → "ki-wissensraum/articles/hero/<uuid>.webp"
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
  /** Original Replicate URL — expires in 24h. For debug only. */
  replicateUrl: string;
  /** The seed actually used. Useful for reproduction. */
  seed: number | null;
};

export class ReplicateGenerationError extends Error {
  constructor(
    message: string,
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = "ReplicateGenerationError";
  }
}
