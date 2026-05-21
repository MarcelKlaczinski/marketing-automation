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

## Article Freshness (Spec 62.0a Section 5.1)

`effectiveFreshnessSql` (SQL) and `effectiveFreshness(article)` (JS) are the **canonical** definition of "when was this article last meaningfully updated". Fallback order: `frontmatterUpdatedAt → lastRefreshedAt → publishedAt → updatedAt`.

Every consumer that computes article staleness MUST use one of these helpers — the refresh-detector worker, `/refresh-candidates`, `/discovery-counts`, and the weekly-budget cost estimator. Inline `coalesce(...)` expressions are forbidden because they drift out of sync (Pre-flight Task 3 incident: the worker used `lastRefreshedAt` first, the endpoint used `publishedAt` first, the views disagreed for weeks).

**Drizzle re-interpolation idiom**: callers that need a result alias wrap the shared SQL expression in another `sql\`\``  template:

```typescript
import { effectiveFreshnessSql } from "@marketing-auto/cost-tracker";

// In WHERE clauses — interpolate directly:
sql`${effectiveFreshnessSql} < ${cutoff.toISOString()}`

// In SELECT projections — re-wrap to expose .as():
sql<string>`${effectiveFreshnessSql}`.as("effective_date")
sql<number>`EXTRACT(DAY FROM NOW() - ${effectiveFreshnessSql})::int`
```

`SQL` instances from the `sql\`\``  template need to be re-templated to apply `.as()`. Not pretty, but consistent with Drizzle's API.

## Weekly Budget Estimator (Spec 62.0a Section 5)

`estimateWeeklyPlanCost` aggregates per-item costs for the Planner via a 3-tier fallback:

1. **`pipeline_steps`** — sum `step.estimatedCostEur(predictedInput)` across the pipeline's step list (`source: "pipeline_steps"`).
2. **`historical_avg`** — 30-day average from `cost_logs` JOIN `pipeline_runs`, grouped by parent run (`source: "historical_avg"`).
3. **`default`** — conservative defaults from `DEFAULT_COST_BY_ITEM_TYPE` / `DEFAULT_COST_BY_PIPELINE` (`source: "default"`). Falls to `"zero"` only when neither map has the key.

Refresh items whose article is younger than `freshSkipThresholdDays` (default 30) are short-circuited to €0 with `source: "skipped_recent"` — uses `effectiveFreshness()` so the skip threshold respects the canonical staleness definition.

**Cyclic-dependency avoidance**: cost-tracker is a leaf package (depends on `shared` + `db` only). To invoke `step.estimatedCostEur(input)` without importing `@marketing-auto/pipelines`, the function accepts a `resolvePipelineSteps: PipelineStepResolver` callback. The caller wires it:

```typescript
import { pipelineRegistry } from "@marketing-auto/pipelines";
import { estimateWeeklyPlanCost } from "@marketing-auto/cost-tracker";

const estimate = await estimateWeeklyPlanCost({
  plannedItems,
  weeklyBudgetEur,
  projectId,
  resolvePipelineSteps: (name) => pipelineRegistry.get(name)?.steps,
});
```

When the callback is omitted, tier 1 is skipped and the estimator falls straight to historical → defaults.

**Tier-1 zero-sum behaviour**: a pipeline whose every step returns 0 from `estimatedCostEur()` falls through to tier 2/3. Intentional — a pipeline with overrides that all happen to be 0 should be reported with the same default as one with no overrides. The edge case: a future pipeline that genuinely costs €0 (e.g. pure DB-rotation chain) will be tagged with the itemType default. Mark such pipelines with an explicit `estimatedCostEur(): number { return 0.0001; }` if you want tier 1 to "stick", or document the false positive.

## Common Mistakes

- DO NOT skip `track()` for "small" operations — 1000 small calls add up
- DO NOT use a fake/zero estimatedCostEur — limit check becomes useless
- DO NOT swallow CostLimitExceeded — it must surface as a failed pipeline run
- DO NOT compute article staleness with an inline `coalesce(...)` expression — use `effectiveFreshnessSql` (SQL) or `effectiveFreshness()` (JS) so all views agree. Inline expressions silently drift; the canonical helpers are the single source of truth.
- DO NOT add a direct workspace import of `@marketing-auto/pipelines` from cost-tracker — it creates a cycle (pipelines depends on cost-tracker for `track()`). Use the `PipelineStepResolver` callback pattern instead, so callers wire pipeline lookups via dependency injection.
