/**
 * Pricing reference for all tracked services.
 * Update quarterly when provider pricing changes.
 *
 * USD prices converted to EUR at fixed rate (1 USD = 0.92 EUR).
 * Adjust EUR_PER_USD when FX shifts significantly (>5%).
 */

export const EUR_PER_USD = 0.92;
const usdToEur = (usd: number) => usd * EUR_PER_USD;

export const ANTHROPIC_PRICING_USD_PER_MTOK = {
  "claude-haiku-4-5":  { input: 1.0,  output: 5.0,  cacheRead: 0.10, cacheWrite: 1.25 },
  "claude-sonnet-4-6": { input: 3.0,  output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-opus-4-7":   { input: 5.0,  output: 25.0, cacheRead: 0.50, cacheWrite: 6.25 },
} as const;

export type AnthropicModel = keyof typeof ANTHROPIC_PRICING_USD_PER_MTOK;

/**
 * Compute Anthropic cost in EUR from token usage.
 */
export function anthropicCostEur(input: {
  model: AnthropicModel;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  const p = ANTHROPIC_PRICING_USD_PER_MTOK[input.model];
  const usd =
    (input.inputTokens / 1_000_000) * p.input +
    (input.outputTokens / 1_000_000) * p.output +
    ((input.cacheReadTokens ?? 0) / 1_000_000) * p.cacheRead +
    ((input.cacheWriteTokens ?? 0) / 1_000_000) * p.cacheWrite;
  return usdToEur(usd);
}

export const REPLICATE_PRICING_USD_PER_IMAGE = {
  "black-forest-labs/flux-1.1-pro": 0.04,
  "black-forest-labs/flux-schnell": 0.003,
  "black-forest-labs/flux-2-pro":   0.05,
  "ideogram-ai/ideogram-v3":         0.04,
} as const;

export type ReplicateModel = keyof typeof REPLICATE_PRICING_USD_PER_IMAGE;

export function replicateImageCostEur(input: { model: ReplicateModel; count: number }): number {
  const usd = REPLICATE_PRICING_USD_PER_IMAGE[input.model] * input.count;
  return usdToEur(usd);
}

export const DATAFORSEO_PRICING_USD = {
  serpStandard:       0.0006,
  serpPriority:       0.0012,
  serpLive:           0.002,
  keywordSuggestions: 0.001,

  // Labs API — pre-computed database
  keywordOverviewLive:    0.0201,
  relatedKeywordsLive:    0.012,
  keywordSuggestionsLive: 0.012,
  rankedKeywordsLive:     0.012,

  // Keywords Data API
  searchVolumeLive: 0.025,
} as const;

export function dataforseoCostEur(input: {
  operation: keyof typeof DATAFORSEO_PRICING_USD;
  count: number;
}): number {
  return usdToEur(DATAFORSEO_PRICING_USD[input.operation] * input.count);
}

export const ELEVENLABS_PRICING_USD_PER_1K_CHARS = 0.30;

export function elevenlabsCostEur(input: { characters: number }): number {
  return usdToEur((input.characters / 1000) * ELEVENLABS_PRICING_USD_PER_1K_CHARS);
}

export const RESEND_PRICING_USD_PER_EMAIL = 0.0001;

export function resendCostEur(input: { count: number }): number {
  return usdToEur(RESEND_PRICING_USD_PER_EMAIL * input.count);
}
