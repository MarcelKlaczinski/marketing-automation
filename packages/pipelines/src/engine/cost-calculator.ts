// Spec 61.4 Pattern 120: batch API cost at 50% of sync rates.
// Use EUR_PER_USD from cost-tracker so all FX conversions stay in sync.
import { EUR_PER_USD } from "@marketing-auto/cost-tracker";

// 50% of sync rates — see CLAUDE.md pricing.ts note for rate verification.
const BATCH_RATES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-sonnet-4-6": { inputPer1M: 1.5, outputPer1M: 7.5 },
  "claude-haiku-4-5-20251001": { inputPer1M: 0.125, outputPer1M: 0.625 },
  "claude-opus-4-7": { inputPer1M: 7.5, outputPer1M: 37.5 },
};

export function calculateBatchCostEur(
  model: string,
  usage: { input_tokens: number; output_tokens: number }
): number {
  const rates = BATCH_RATES[model];
  if (!rates) return 0;
  const usd =
    (usage.input_tokens / 1_000_000) * rates.inputPer1M +
    (usage.output_tokens / 1_000_000) * rates.outputPer1M;
  return usd * EUR_PER_USD;
}
