# Spec 03: Cost Tracker

**Phase:** 1 (Foundation)
**Estimated Effort:** 1 day
**Dependencies:** Spec 00, Spec 01
**Status:** Ready for implementation

---

## Goal

Implement a robust cost tracking system that logs every external API call with its EUR cost, enforces hard limits per project + service (daily and monthly), and provides a kill-switch that prevents runaway spending. The cost tracker is wrapped around all external API calls — no adapter may call an external API without going through it. This is mission-critical because agentic LLM pipelines can drift into expensive loops.

## Non-Goals

- No alerting integration in this spec (that comes with Spec 04 auth + later notification system)
- No cost dashboard UI (Spec 44)
- No FX rate handling (we treat all costs as EUR; USD-priced services convert at fixed rate per quarter)
- No invoice/billing reconciliation against actual provider invoices (separate concern)
- No prediction of cost (we measure, we don't forecast)

## User-Facing Behavior

After this spec:
- Code calls `costTracker.track({ projectId, service, operation, fn })` to wrap any external API call
- Before execution: limit check runs, throws `CostLimitExceeded` if exceeded
- After execution: cost is computed and logged to DB
- API endpoint `GET /api/projects/:id/costs/summary` returns today/month spend per service
- Daily-rollup view (using SQL view, not application code) for fast summary queries
- A `bun --filter @marketing-auto/api run cost-report` script prints per-project current spend

## Detailed Implementation

### Cost Tracker Package

`packages/cost-tracker/package.json`:
```json
{
  "name": "@marketing-auto/cost-tracker",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "@marketing-auto/db": "workspace:*",
    "drizzle-orm": "^0.36.0"
  }
}
```

### Pricing Configuration

`packages/cost-tracker/src/pricing.ts`:
```typescript
/**
 * Pricing reference for all tracked services.
 * Update quarterly. Last verified: 2026-05.
 *
 * USD prices converted to EUR at fixed rate (1 USD = 0.92 EUR).
 * Adjust EUR_PER_USD when FX shifts significantly.
 */

export const EUR_PER_USD = 0.92;
const usdToEur = (usd: number) => usd * EUR_PER_USD;

export const ANTHROPIC_PRICING_USD_PER_MTOK = {
  "claude-haiku-4-5":   { input: 1.0, output: 5.0,  cacheRead: 0.10, cacheWrite: 1.25 },
  "claude-sonnet-4-6":  { input: 3.0, output: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-opus-4-7":    { input: 5.0, output: 25.0, cacheRead: 0.50, cacheWrite: 6.25 },
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
    (input.inputTokens     / 1_000_000) * p.input +
    (input.outputTokens    / 1_000_000) * p.output +
    ((input.cacheReadTokens  ?? 0) / 1_000_000) * p.cacheRead +
    ((input.cacheWriteTokens ?? 0) / 1_000_000) * p.cacheWrite;
  return usdToEur(usd);
}

export const REPLICATE_PRICING_USD_PER_IMAGE = {
  "black-forest-labs/flux-1.1-pro":     0.04,
  "black-forest-labs/flux-schnell":     0.003,
  "black-forest-labs/flux-2-pro":       0.05,
  "ideogram-ai/ideogram-v3":            0.04,
} as const;

export type ReplicateModel = keyof typeof REPLICATE_PRICING_USD_PER_IMAGE;

export function replicateImageCostEur(input: { model: ReplicateModel; count: number }): number {
  const usd = REPLICATE_PRICING_USD_PER_IMAGE[input.model] * input.count;
  return usdToEur(usd);
}

export const DATAFORSEO_PRICING_USD = {
  serpStandard:  0.0006,
  serpPriority:  0.0012,
  serpLive:      0.002,
  keywordSuggestions: 0.001,
} as const;

export function dataforseoCostEur(input: { operation: keyof typeof DATAFORSEO_PRICING_USD; count: number }): number {
  return usdToEur(DATAFORSEO_PRICING_USD[input.operation] * input.count);
}

export const ELEVENLABS_PRICING_USD_PER_1K_CHARS = 0.30;  // approximate; refine when adapter built

export function elevenlabsCostEur(input: { characters: number }): number {
  return usdToEur((input.characters / 1000) * ELEVENLABS_PRICING_USD_PER_1K_CHARS);
}

export const RESEND_PRICING_USD_PER_EMAIL = 0.0001;  // bulk rate; free tier covers MVP

export function resendCostEur(input: { count: number }): number {
  return usdToEur(RESEND_PRICING_USD_PER_EMAIL * input.count);
}
```

### Limit Manager

`packages/cost-tracker/src/limits.ts`:
```typescript
import { db, projects, costLogs, type CostLimits } from "@marketing-auto/db";
import { eq, and, sql, gte } from "drizzle-orm";

/**
 * Thrown when a planned operation would exceed configured limits.
 */
export class CostLimitExceeded extends Error {
  constructor(
    public readonly details: {
      projectId: string;
      service: string;
      scope: "daily" | "monthly";
      limitEur: number;
      currentSpendEur: number;
      attemptedCostEur: number;
    },
  ) {
    super(
      `Cost limit exceeded: ${details.scope} limit of €${details.limitEur} for ${details.service} ` +
      `on project ${details.projectId} (current: €${details.currentSpendEur.toFixed(4)}, ` +
      `attempted: €${details.attemptedCostEur.toFixed(4)})`,
    );
    this.name = "CostLimitExceeded";
  }
}

const DEFAULT_ALERT_PERCENT = 80;
const DEFAULT_KILL_PERCENT = 100;

/**
 * Returns the configured limits for a project + service, with defaults.
 */
export async function getLimits(input: { projectId: string; service: string }): Promise<{
  dailyEur: number | null;
  monthlyEur: number | null;
  alertAtPercent: number;
  killAtPercent: number;
}> {
  const rows = await db
    .select({ costLimits: projects.costLimits })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  
  const limits = (rows[0]?.costLimits as CostLimits) ?? {};
  
  return {
    dailyEur: limits.daily?.[input.service] ?? null,
    monthlyEur: limits.monthly?.[input.service] ?? null,
    alertAtPercent: limits.alertAtPercent ?? DEFAULT_ALERT_PERCENT,
    killAtPercent: limits.killAtPercent ?? DEFAULT_KILL_PERCENT,
  };
}

/**
 * Returns current spend for a project + service in EUR.
 */
export async function getCurrentSpend(input: {
  projectId: string;
  service: string;
}): Promise<{ daily: number; monthly: number }> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const [row] = await db
    .select({
      daily: sql<string>`COALESCE(SUM(CASE WHEN ${costLogs.createdAt} >= ${startOfDay.toISOString()} THEN ${costLogs.costEur} ELSE 0 END), 0)`,
      monthly: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)`,
    })
    .from(costLogs)
    .where(
      and(
        eq(costLogs.projectId, input.projectId),
        eq(costLogs.service, input.service as never),
        gte(costLogs.createdAt, startOfMonth),
      ),
    );
  
  return {
    daily: Number(row?.daily ?? 0),
    monthly: Number(row?.monthly ?? 0),
  };
}

/**
 * Checks whether a planned operation would exceed limits.
 * Throws CostLimitExceeded if it would.
 * Returns alert info if a threshold (alert or kill) is crossed.
 */
export async function checkLimit(input: {
  projectId: string;
  service: string;
  estimatedCostEur: number;
}): Promise<{
  ok: true;
  alertTriggered?: { scope: "daily" | "monthly"; percent: number; limitEur: number };
}> {
  const limits = await getLimits({ projectId: input.projectId, service: input.service });
  const spend = await getCurrentSpend({ projectId: input.projectId, service: input.service });
  
  const checkScope = (
    scope: "daily" | "monthly",
    limitEur: number | null,
    current: number,
  ): { alertTriggered?: { scope: "daily" | "monthly"; percent: number; limitEur: number } } => {
    if (limitEur === null) return {};
    const projected = current + input.estimatedCostEur;
    const projectedPercent = (projected / limitEur) * 100;
    
    if (projectedPercent >= limits.killAtPercent) {
      throw new CostLimitExceeded({
        projectId: input.projectId,
        service: input.service,
        scope,
        limitEur,
        currentSpendEur: current,
        attemptedCostEur: input.estimatedCostEur,
      });
    }
    
    if (projectedPercent >= limits.alertAtPercent) {
      return { alertTriggered: { scope, percent: projectedPercent, limitEur } };
    }
    return {};
  };
  
  const dailyAlert = checkScope("daily", limits.dailyEur, spend.daily);
  const monthlyAlert = checkScope("monthly", limits.monthlyEur, spend.monthly);
  
  return {
    ok: true,
    alertTriggered: dailyAlert.alertTriggered ?? monthlyAlert.alertTriggered,
  };
}
```

### Tracker

`packages/cost-tracker/src/tracker.ts`:
```typescript
import { db, costLogs, type costServiceEnum } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { checkLimit, CostLimitExceeded } from "./limits.ts";

type CostService = (typeof costServiceEnum.enumValues)[number];

const log = createLogger("cost-tracker");

/**
 * Wraps an async operation with cost tracking.
 * Steps:
 *   1. Check limits with estimatedCostEur (throws CostLimitExceeded if blocked)
 *   2. Execute fn()
 *   3. Compute actual cost via computeCostEur(result)
 *   4. Persist cost_log row
 *   5. Return fn's result
 *
 * If `computeCostEur` returns NaN/negative, we log estimatedCostEur and warn.
 */
export async function track<T>(input: {
  projectId: string;
  service: CostService;
  operation: string;
  estimatedCostEur: number;
  pipelineRunId?: string;
  articleId?: string;
  fn: () => Promise<T>;
  computeCostEur: (result: T) => number;
  metadata?: (result: T) => Record<string, unknown>;
}): Promise<T> {
  // 1. Limit check (may throw)
  const check = await checkLimit({
    projectId: input.projectId,
    service: input.service,
    estimatedCostEur: input.estimatedCostEur,
  });
  
  if (check.alertTriggered) {
    log.warn({
      projectId: input.projectId,
      service: input.service,
      ...check.alertTriggered,
    }, "Cost alert threshold crossed");
    // TODO Spec 41: send Web Push notification to project owner
  }
  
  // 2. Execute
  const startedAt = Date.now();
  const result = await input.fn();
  const durationMs = Date.now() - startedAt;
  
  // 3. Compute actual cost
  let actualCost = input.computeCostEur(result);
  if (!Number.isFinite(actualCost) || actualCost < 0) {
    log.warn({ actualCost, estimated: input.estimatedCostEur }, "computeCostEur returned invalid value, using estimate");
    actualCost = input.estimatedCostEur;
  }
  
  // 4. Persist
  await db.insert(costLogs).values({
    projectId: input.projectId,
    service: input.service,
    operation: input.operation,
    costEur: String(actualCost),
    pipelineRunId: input.pipelineRunId,
    articleId: input.articleId,
    metadata: {
      durationMs,
      estimatedCostEur: input.estimatedCostEur,
      ...(input.metadata?.(result) ?? {}),
    },
  });
  
  log.debug({
    projectId: input.projectId,
    service: input.service,
    operation: input.operation,
    costEur: actualCost,
    durationMs,
  }, "Cost logged");
  
  return result;
}

export { CostLimitExceeded };
```

### Summary Helpers

`packages/cost-tracker/src/summary.ts`:
```typescript
import { db, costLogs } from "@marketing-auto/db";
import { eq, sql, and, gte } from "drizzle-orm";

/**
 * Returns a per-service spend breakdown for a project for today and current month.
 * Used by /api/projects/:id/costs/summary.
 */
export async function getProjectCostSummary(projectId: string): Promise<{
  today: Array<{ service: string; eur: number }>;
  month: Array<{ service: string; eur: number }>;
  totals: { todayEur: number; monthEur: number };
}> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  // Single query, group by service, sum daily and monthly
  const rows = await db
    .select({
      service: costLogs.service,
      todayEur: sql<string>`COALESCE(SUM(CASE WHEN ${costLogs.createdAt} >= ${startOfDay.toISOString()} THEN ${costLogs.costEur} ELSE 0 END), 0)`,
      monthEur: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)`,
    })
    .from(costLogs)
    .where(
      and(
        eq(costLogs.projectId, projectId),
        gte(costLogs.createdAt, startOfMonth),
      ),
    )
    .groupBy(costLogs.service);
  
  const today: Array<{ service: string; eur: number }> = [];
  const month: Array<{ service: string; eur: number }> = [];
  let todayTotal = 0;
  let monthTotal = 0;
  
  for (const row of rows) {
    const t = Number(row.todayEur);
    const m = Number(row.monthEur);
    if (t > 0) today.push({ service: row.service, eur: t });
    if (m > 0) month.push({ service: row.service, eur: m });
    todayTotal += t;
    monthTotal += m;
  }
  
  return { today, month, totals: { todayEur: todayTotal, monthEur: monthTotal } };
}

/**
 * CLI report: prints all projects' current spend.
 * Usage: bun --filter @marketing-auto/cost-tracker run report
 */
export async function printAllProjectsReport(): Promise<void> {
  const { db, projects } = await import("@marketing-auto/db");
  const allProjects = await db.select({ id: projects.id, name: projects.name, slug: projects.slug }).from(projects);
  
  console.log("\n📊 Cost Report - " + new Date().toISOString().split("T")[0] + "\n");
  
  for (const p of allProjects) {
    const summary = await getProjectCostSummary(p.id);
    console.log(`\n=== ${p.name} (${p.slug}) ===`);
    console.log(`Today:  €${summary.totals.todayEur.toFixed(4)}`);
    console.log(`Month:  €${summary.totals.monthEur.toFixed(4)}`);
    if (summary.today.length > 0) {
      console.log("  Today by service:");
      for (const s of summary.today) console.log(`    ${s.service.padEnd(20)} €${s.eur.toFixed(4)}`);
    }
  }
}
```

### Index

`packages/cost-tracker/src/index.ts`:
```typescript
export * from "./pricing.ts";
export * from "./limits.ts";
export { track } from "./tracker.ts";
export { getProjectCostSummary, printAllProjectsReport } from "./summary.ts";
```

`packages/cost-tracker/CLAUDE.md`:
```markdown
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

## Common Mistakes
- DO NOT skip `track()` for "small" operations — 1000 small calls add up
- DO NOT use a fake/zero estimatedCostEur — limit check becomes useless
- DO NOT swallow CostLimitExceeded — it must surface as a failed pipeline run
```

## Acceptance Criteria

- [ ] All pricing functions return correct EUR (verify Sonnet 1M input + 500K output ≈ €(3+7.5)*0.92 = €9.66)
- [ ] `getCurrentSpend` returns 0 for a fresh project
- [ ] `getCurrentSpend` correctly sums today vs month after multiple `track()` calls across different days (manual test by inserting old timestamps)
- [ ] `track()` writes a `cost_logs` row after success
- [ ] `track()` throws `CostLimitExceeded` when spend + estimate > kill threshold
- [ ] `track()` does NOT execute fn() when limit would be exceeded
- [ ] `track()` logs warning when alert threshold crossed but does not throw
- [ ] `getProjectCostSummary` returns correct today/month breakdown grouped by service
- [ ] `bun --filter @marketing-auto/cost-tracker run report` script runs and prints all projects
- [ ] Project with no `costLimits` configured: `track()` always succeeds (no limits = no enforcement)

## Testing Strategy

`packages/cost-tracker/test/cost-tracker.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { db, projects, costLogs } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { track, CostLimitExceeded, anthropicCostEur, getCurrentSpend } from "../src/index.ts";

describe("anthropic pricing", () => {
  it("computes Sonnet cost correctly", () => {
    // 1M input + 500k output Sonnet = (1*3 + 0.5*15) USD = 10.50 USD = ~9.66 EUR
    const eur = anthropicCostEur({
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });
    expect(eur).toBeCloseTo(9.66, 1);
  });
  
  it("includes cache costs", () => {
    const eur = anthropicCostEur({
      model: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,    // 1M tokens at $0.30 = $0.30 = ~€0.276
    });
    expect(eur).toBeCloseTo(0.276, 2);
  });
});

describe("track()", () => {
  let projectId: string;
  
  beforeEach(async () => {
    const [p] = await db.insert(projects).values({
      slug: `cost-test-${Date.now()}-${Math.random()}`,
      name: "Cost Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      costLimits: {
        daily: { anthropic: 1.0 },
        monthly: { anthropic: 10.0 },
        alertAtPercent: 80,
        killAtPercent: 100,
      },
    }).returning();
    projectId = p!.id;
  });
  
  it("logs cost after successful call", async () => {
    await track({
      projectId,
      service: "anthropic",
      operation: "test_op",
      estimatedCostEur: 0.05,
      fn: async () => ({ tokens: 1000 }),
      computeCostEur: () => 0.03,
    });
    
    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(1);
    expect(Number(logs[0]!.costEur)).toBeCloseTo(0.03, 4);
  });
  
  it("throws CostLimitExceeded when daily limit would be exceeded", async () => {
    // Configure limit at €1, attempt €2
    expect(track({
      projectId,
      service: "anthropic",
      operation: "test_op",
      estimatedCostEur: 2.0,  // exceeds €1 daily
      fn: async () => "should not run",
      computeCostEur: () => 2.0,
    })).rejects.toThrow(CostLimitExceeded);
    
    // Verify fn() did NOT execute (no log row)
    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(0);
  });
  
  it("accumulates spend across calls", async () => {
    for (let i = 0; i < 3; i++) {
      await track({
        projectId,
        service: "anthropic",
        operation: "small",
        estimatedCostEur: 0.10,
        fn: async () => "ok",
        computeCostEur: () => 0.10,
      });
    }
    const spend = await getCurrentSpend({ projectId, service: "anthropic" });
    expect(spend.daily).toBeCloseTo(0.30, 4);
  });
  
  it("project with no limits never throws", async () => {
    const [p] = await db.insert(projects).values({
      slug: `no-limits-${Date.now()}`,
      name: "No Limits",
      industry: "ai_education",
      pipelineTemplate: "educational",
      // costLimits intentionally omitted (defaults to {})
    }).returning();
    
    await track({
      projectId: p!.id,
      service: "anthropic",
      operation: "huge",
      estimatedCostEur: 9999,
      fn: async () => "ok",
      computeCostEur: () => 9999,
    });
    // Did not throw — pass
  });
});
```

## Open Questions / Decisions Made

**Decision 1: Decimal stored as text/numeric, parsed as Number for arithmetic.** Postgres NUMERIC(10,6) gives precision; Drizzle returns string. We parse with `Number()` for sums — sufficient precision for EUR amounts up to thousands.

**Decision 2: FX rate hardcoded.** USD pricing dominant; we convert at fixed 1.0 USD = 0.92 EUR. Re-evaluate quarterly. Real-time FX would be over-engineering.

**Decision 3: Limit check uses `estimatedCostEur` not actual.** Pre-flight check needs an estimate. After execution, actual cost is logged. If estimates are systematically too low, daily/monthly limits will be exceeded modestly between checks. Fix: estimates should be conservative (worst-case).

**Decision 4: No global (cross-project) limits in this spec.** Per-project limits are sufficient for MVP. Global "platform-wide kill switch" can be added later as a single special row.

**Decision 5: No retry/backoff inside `track()`.** Retries are the caller's responsibility (BullMQ does this for jobs). `track()` is one execution, one log entry.

**Decision 6: Alerts logged but not delivered yet.** Spec 41 (Web Push) wires up actual delivery. For MVP, looking at logs is acceptable — Marcel will set up structured log alerts via Better Stack/similar in operations.

## Implementation Order

1. Create `packages/cost-tracker/` skeleton
2. Implement `pricing.ts` + tests for cost computation
3. Implement `limits.ts` (`getLimits`, `getCurrentSpend`, `checkLimit`)
4. Implement `tracker.ts` (`track`)
5. Implement `summary.ts` (`getProjectCostSummary`, CLI report)
6. Wire up `index.ts`
7. Add CLI script entry to `package.json`: `"report": "bun src/summary.ts"` (with main guard in summary.ts)
8. Write tests, run them
9. Manual smoke test: insert a project with limits, call `track()` a few times, hit limit, verify behavior
10. Commit: `feat(cost-tracker): cost tracking with hard limits (spec 03)`

## Splitting Plan

Single session, 1 day. No splitting needed.

## Discovered During Implementation

(empty)

## Deviations

(empty)
