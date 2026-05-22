/**
 * Pricing reference for all tracked services.
 * Update quarterly when provider pricing changes.
 *
 * USD prices converted to EUR at fixed rate (1 USD = 0.92 EUR).
 * Adjust EUR_PER_USD when FX shifts significantly (>5%).
 */

export const EUR_PER_USD = 0.92;
const usdToEur = (usd: number) => usd * EUR_PER_USD;

// Anthropic charges two different cache-write rates depending on the TTL:
// 5-minute write = 1.25× base input; 1-hour write = 2× base input.
// The adapter defaults to 1h TTL, so cacheWrite1h is the rate most calls incur.
export const ANTHROPIC_PRICING_USD_PER_MTOK = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10.0 },
} as const;

export type AnthropicModel = keyof typeof ANTHROPIC_PRICING_USD_PER_MTOK;

/**
 * Compute Anthropic cost in EUR from token usage.
 * cacheTtl must match the ttl used in the cache_control block — defaults to "1h"
 * (the adapter default) to avoid silent undercounting on cache writes.
 */
export function anthropicCostEur(input: {
  model: AnthropicModel;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheTtl?: "5m" | "1h";
}): number {
  const p = ANTHROPIC_PRICING_USD_PER_MTOK[input.model];
  const cacheWriteRate = input.cacheTtl === "5m" ? p.cacheWrite5m : p.cacheWrite1h;
  const usd =
    (input.inputTokens / 1_000_000) * p.input +
    (input.outputTokens / 1_000_000) * p.output +
    ((input.cacheReadTokens ?? 0) / 1_000_000) * p.cacheRead +
    ((input.cacheWriteTokens ?? 0) / 1_000_000) * cacheWriteRate;
  return usdToEur(usd);
}

export const REPLICATE_PRICING_USD_PER_IMAGE = {
  "black-forest-labs/flux-1.1-pro": 0.04,
  "black-forest-labs/flux-schnell": 0.003,
  "ideogram-ai/ideogram-v3": 0.04,
} as const;

export type ReplicateModel = keyof typeof REPLICATE_PRICING_USD_PER_IMAGE;

export function replicateImageCostEur(input: { model: ReplicateModel; count: number }): number {
  const usd = REPLICATE_PRICING_USD_PER_IMAGE[input.model] * input.count;
  return usdToEur(usd);
}

// Spec 64.6b: Google Gemini Image API ("Nano Banana") pricing per generated image,
// keyed by output resolution. Source: Google Cloud Generative AI pricing page
// (verified web-search 2026-05-23). Pro tier doesn't support 0.5k natively —
// the adapter silently upgrades to 1K, so the 0.5k → Pro rate mirrors the 1k Pro
// rate ($0.134) for cost-accounting consistency.
export type NanoBananaResolution = "0.5k" | "1k" | "2k" | "4k";

export const NANO_BANANA_2_PRICING_USD: Record<NanoBananaResolution, number> = {
  "0.5k": 0.045,
  "1k": 0.067,
  "2k": 0.101,
  "4k": 0.151,
};

export const NANO_BANANA_PRO_PRICING_USD: Record<NanoBananaResolution, number> = {
  "0.5k": 0.134, // Pro doesn't support 512 — adapter upgrades to 1K, accounted at 1K rate.
  "1k": 0.134,
  "2k": 0.134, // Same token count as 1K per Google's pricing.
  "4k": 0.24,
};

// Back-compat: legacy callers (Spec 64.6) keyed by model only — kept as the 1K rate
// since 1K is the Toolwiki default. Remove once 64.6b is fully rolled out.
export const NANO_BANANA_PRICING_USD_PER_IMAGE = {
  "nano-banana-2": NANO_BANANA_2_PRICING_USD["1k"],
  "nano-banana-pro": NANO_BANANA_PRO_PRICING_USD["1k"],
} as const;

export type NanoBananaModel = keyof typeof NANO_BANANA_PRICING_USD_PER_IMAGE;

/**
 * Compute real-cost EUR for a Nano Banana image generation. Spec 64.6b widened
 * the signature to require `resolution`. Callers that don't know the resolution
 * (or read it from the project later) should pass "1k" to mirror the column default.
 */
export function nanoBananaImageCostEur(input: {
  model: NanoBananaModel;
  resolution: NanoBananaResolution;
  count: number;
}): number {
  const usdMap =
    input.model === "nano-banana-2" ? NANO_BANANA_2_PRICING_USD : NANO_BANANA_PRO_PRICING_USD;
  return usdToEur(usdMap[input.resolution] * input.count);
}

export const DATAFORSEO_PRICING_USD = {
  serpStandard: 0.0006,
  serpPriority: 0.0012,
  serpLive: 0.002,
  keywordSuggestions: 0.001,

  // Labs API — pre-computed database
  keywordOverviewLive: 0.0201,
  relatedKeywordsLive: 0.012,
  keywordSuggestionsLive: 0.012,
  rankedKeywordsLive: 0.012,

  // Keywords Data API
  searchVolumeLive: 0.025,
} as const;

export function dataforseoCostEur(input: {
  operation: keyof typeof DATAFORSEO_PRICING_USD;
  count: number;
}): number {
  return usdToEur(DATAFORSEO_PRICING_USD[input.operation] * input.count);
}

export const SMTP_PRICING_USD_PER_EMAIL = 0.0001;

export function smtpCostEur(input: { count: number }): number {
  return usdToEur(SMTP_PRICING_USD_PER_EMAIL * input.count);
}
