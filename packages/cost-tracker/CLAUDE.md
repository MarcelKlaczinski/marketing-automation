# Cost Tracker

Mission-critical cost guard for the platform. Every external API call goes through `track()`.

## Usage Pattern

```typescript
import { track, anthropicCostEur } from "@marketing-auto/cost-tracker";

const result = await track({
  projectId,
  service: "anthropic",
  operation: "article_draft",
  estimatedCostEur: 0.5,    // pre-call estimate (worst-case)
  fn: async () => anthropic.messages.create({ ... }),
  computeCostEur: (response) => anthropicCostEur({
    model: "claude-sonnet-4-6",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens,
    cacheWriteTokens: response.usage.cache_creation_input_tokens,
  }),
  metadata: (response) => ({ stopReason: response.stop_reason }),
});
```

## Hard Rules

- NEVER call an external API outside of `track()`
- ALWAYS provide a realistic `estimatedCostEur` (used for limit check before execution)
- `computeCostEur` runs AFTER execution and uses real tokens — gives accurate billing

## Limits

- Configured per project in `projects.costLimits` JSONB
- Daily and monthly limits per service
- Default thresholds: alert at 80%, kill at 100%
- `CostLimitExceeded` is thrown — pipelines should let it bubble up to BullMQ for visible failure

## Tests

- Run with `bun --filter @marketing-auto/cost-tracker test`
- DO NOT run `bun run test` from inside this package — Bun resolves the same-name script before the built-in and recurses

## Common Mistakes

- DO NOT skip `track()` for "small" operations — 1000 small calls add up
- DO NOT use a fake/zero estimatedCostEur — limit check becomes useless
- DO NOT swallow CostLimitExceeded — it must surface as a failed pipeline run
