export const ANTHROPIC_MODELS = {
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-opus-4-7": "claude-opus-4-7",
} as const;

export type AnthropicModel = keyof typeof ANTHROPIC_MODELS;

export const MAX_OUTPUT_TOKENS: Record<AnthropicModel, number> = {
  "claude-haiku-4-5": 4096,
  "claude-sonnet-4-6": 8192,
  "claude-opus-4-7": 8192,
};

export type CacheTtl = "5m" | "1h";

export type AnthropicWebSearch =
  | {
      enabled: true;
      maxUses?: number;
      allowedDomains?: string[];
      blockedDomains?: string[];
    }
  | { enabled: false };

/**
 * Spec 65.8 — Image attachments for vision-capable Sonnet calls.
 *
 * Anthropic vision API accepts URL-based and base64-inline image sources.
 * `media_type` is required for base64 inputs (the wire format needs it);
 * URL sources have it inferred server-side.
 *
 * Vision-bearing calls are NEVER fixture-cached: image inputs are highly
 * context-dependent (provider URLs rotate, content can change) and the
 * non-determinism of vision picks makes replay misleading. `isCacheable`
 * returns false when `userImages !== undefined`.
 */
export type UserImageAttachment =
  | { type: "url"; url: string }
  | { type: "base64"; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };

export type MessagesInput = {
  projectId: string;
  pipelineRunId?: string;
  articleId?: string;
  operation: string;

  model: AnthropicModel;

  /**
   * Cacheable system prompt prefix. Marked with cache_control: ephemeral 1h.
   * Pass empty string if nothing to cache.
   */
  systemPrefix: string;
  /** Variable suffix appended after the cached prefix. NOT cached. */
  systemSuffix: string;

  userMessage: string;

  /**
   * Optional image attachments for vision-capable models (Sonnet 4.6+,
   * Opus 4.7). When set, the adapter constructs a multi-part user message
   * with image content blocks placed BEFORE the text block. Disables the
   * dev-mode fixture cache for this call. Spec 65.8.
   */
  userImages?: UserImageAttachment[];

  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;

  /**
   * Appends a strict JSON-formatting instruction to systemSuffix and parses
   * the response. Throws JsonParseError if the model returns non-JSON.
   */
  jsonMode?: boolean;

  cacheTtl?: CacheTtl;

  webSearch?: AnthropicWebSearch;

  estimatedCostEur: number;

  /**
   * Bypass the dev-mode fixture cache for this call (force live API even if
   * a fixture exists). Has no effect when ANTHROPIC_CACHE_MODE=off.
   */
  forceRefresh?: boolean;
};

export type CacheStats = {
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalInputTokens: number;
  freshInputTokens: number;
  hit: boolean;
};

export type MessagesResult = {
  raw: string;
  /** Parsed JSON object when jsonMode was true; null otherwise. */
  json: unknown | null;
  outputTokens: number;
  cacheStats: CacheStats;
  stopReason: string | null;
  messageId: string;
};

export class JsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly parseError: unknown
  ) {
    super(message);
    this.name = "JsonParseError";
  }
}

export class AnthropicClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "AnthropicClientError";
  }
}
