# Spec 41: Cost Enforcement & Pipeline Hardening

**Phase:** 4 (Welle 4 — kritische Härtung VOR Spec 40 Push Notifications)
**Estimated Effort:** 2-3 days (3 sessions)
**Dependencies:** Spec 03 (cost tracker), Spec 05 (pipeline engine), Spec 35/36 (existing trigger endpoints)
**Status:** **CRITICAL — implement before further pipeline development**
**Recommended Model:** Opus 4.7 (cross-cutting concern: backend + frontend + DB; touches every adapter)

---

## Goal

Close three classes of cost/correctness gaps discovered in the post-Welle-3 security review:

1. **No cost-limit enforcement** — `projects.costLimits` is schema-decorated but read by zero code. A bug in any pipeline (infinite retry, accidental loop, large input) could spend hundreds of euros before manual intervention. **This is the dominant risk.**
2. **No idempotency on pipeline triggers** — the `triggerWithPreRunId` pattern from Spec 35/36 has no check for "is this article already running this pipeline?" A double-click on a Generate-Outline button = 2× Anthropic call.
3. **Cold-start auto-chain has no confirmation** — Phase 2.1 (LLM, ~€0.05) auto-triggers Phase 2.2 (DataForSEO, **€2-30** depending on competitor count) without user confirmation. A halucinating LLM with 50 fake competitors blows the budget silently.

This spec also bundles a few smaller bugs from the same review (PageSpeed cooldown, polling 401-handling, sync stale-read check). After this, the system is **"fail-closed" for cost"** — no operation can spend money beyond configured limits, and every trigger validates against active runs first.

## Architecture Decisions

**Decision 1: Cost limits enforce via two checkpoints (defense-in-depth).**
- **Trigger checkpoint** (HTTP layer): every pipeline-trigger endpoint calls `assertCostBudget(projectId, service, estimatedCostEur)` before enqueueing. If overspent, returns 402 (Payment Required) with `error: "cost_limit_exceeded"` and details. No DB row created, no queue activity.
- **Adapter checkpoint** (per-call): every adapter (Anthropic, Replicate, DataForSEO, SMTP) calls the same helper before each external API call. If exceeded mid-pipeline, throws `CostLimitExceededError`. The pipeline's `afterError` hook catches this and writes status='failed' with `errorMessage='cost_limit_exceeded'`.

This way, a long-running pipeline (50+ Anthropic calls) cannot escape the limit even if it was within budget at trigger time.

**Decision 2: When `killAtPercent` (default 100%) is hit, the project's BullMQ queue is paused.**

Pause is per-project, not global. Implementation:
- New table `project_pause_state(projectId, pausedAt, reason, pausedBy)` — single-row-per-project
- When the adapter-check or trigger-check fails, writes pause-state and calls `queue.pause()` for all the project's queues
- Subsequent triggers (HTTP) immediately fail with the same error until pause is lifted
- Manual resume via dedicated endpoint `POST /api/projects/:slug/resume-queues`, requires user confirmation in UI

When `alertAtPercent` (default 80%) is hit but `killAtPercent` is not yet exceeded: log a warning to a new `cost_alerts` table for visibility, do NOT pause. Marcel sees these in a UI surface (added to cost dashboard).

**Decision 3: Idempotency check looks for "active run for same article + same pipeline".**
The `triggerWithPreRunId` helper extends:
1. SELECT recent pipeline_runs WHERE pipelineName = ? AND input->>'articleId' = ? AND status IN ('queued', 'running')
2. If found → return existing `{runId, jobId, deduped: true}` instead of creating new
3. Otherwise → continue with pre-INSERT and enqueue

Frontend can show a toast ("Pipeline already running") when `deduped=true`. Backend returns 200 (not 202) to signal it didn't create a new run.

**Decision 4: Cold-start Phase 2 needs an explicit confirmation step.**

Phase 2.1 (`cold-start:competitor-questions`) auto-completes and writes competitor list to `pipeline_runs.output`. Phase 2.2 (`cold-start:competitor-analysis`) was previously auto-triggered by frontend polling-terminal watcher. We change this:

- Phase 2.1 ends → frontend stops auto-chain
- UI displays competitor count + estimated cost: "12 Competitors identified. Analysis will cost ~€2.40 (DataForSEO). Continue?"
- Marcel clicks "Run analysis" → Phase 2.2 triggers
- Backend caps competitor count at 15 (hard limit). If LLM returned 30, frontend shows error and asks user to trim list.

**Decision 5: Cost estimation per service/operation is centrally maintained.**

`packages/core/src/cost/estimates.ts`:

```typescript
export const COST_ESTIMATES_EUR: Record<string, Record<string, number>> = {
  anthropic: {
    'outline-generation': 0.30,
    'draft-generation': 1.50,
    'self-review': 0.80,
    'briefing-generation': 0.10,
    'cold-start:voice-extraction': 0.20,
    'cold-start:competitor-questions': 0.05,
    'cold-start:cluster-plan': 0.50,
    'cold-start:cornerstone-spec': 0.40,
    'cold-start:go-live-checklist': 0.10,
    'schema-extension': 0.20,
    'internal-linking': 0.30,
  },
  replicate: {
    'hero-image': 0.10,
  },
  dataforseo: {
    'serp-analysis': 0.20,         // per competitor
    'keyword-research': 0.05,
    'backlink-check': 0.30,
  },
  smtp: {
    'magic-link': 0.001,
    'briefing': 0.001,
  },
};

export function estimateCostEur(service: string, operation: string, multiplier = 1): number {
  const baseEur = COST_ESTIMATES_EUR[service]?.[operation] ?? 0;
  return baseEur * multiplier;
}
```

Estimates are deliberately **conservative (rounded up)** to provide safety margin. Real costs from `costLogs` post-call are exact; estimates are just for pre-flight checks. They DO NOT need to match exactly — they need to be in the right ballpark.

When a new operation is added without an estimate entry: `estimateCostEur` returns 0, which means the check passes. To enforce that estimates exist: ESLint rule or runtime warn-log when fallback hits. **For this spec: log a warning, don't fail. Defer strict enforcement.**

**Decision 6: Defaults applied via project creation endpoint, NOT via migration.**

The migration approach (Option A from the question) was rejected because:
- Migrations modifying user data are risky (could overwrite Marcel's existing manual settings)
- Existing projects might have intentionally-empty `costLimits`

Instead, the project-creation endpoint (existing in Spec 32 Installer Wizard logic) injects defaults if `costLimits = '{}'`. **For existing projects (e.g., KI-Wissensraum), Marcel runs a one-shot "apply defaults" script.**

Default limits, conservative for KI-Wissensraum scale:
```typescript
export const DEFAULT_COST_LIMITS: CostLimits = {
  daily: {
    anthropic: 5.0,
    replicate: 3.0,
    dataforseo: 5.0,
    smtp: 1.0,
  },
  monthly: {
    anthropic: 100.0,
    replicate: 50.0,
    dataforseo: 30.0,
    smtp: 5.0,
  },
  alertAtPercent: 80,
  killAtPercent: 100,
};
```

**Decision 7: Polling-composables stop on 401/403.**
Both `usePipelineRunPolling` (Spec 35) and `useActiveRunsPolling` (Spec 39) get a check: if response is 401 or 403, stop polling immediately. The auth-store handles logout/redirect; the composable just stops generating useless requests.

**Decision 8: Sync-pipeline checks for stale read.**
Before committing to the Astro repo, the sync worker checks `articles.updatedAt > runStartedAt`. If true, abort with `errorStage='stale_read'`, no commit. The Idempotency-pattern from Decision 3 prevents the same trigger from re-running, but a *new* manual trigger picks up the fresh content.

**Decision 9: PageSpeed cooldown = 5 minutes per article + same commit_sha.**
Manual trigger of validate-pagespeed checks: was there a run for this article in the last 5 minutes with the same `astro_commit_sha`? If yes → 429 with `error: "pagespeed_cooldown"`. Forces meaningful change between runs.

**Decision 10: Cost alerts surface in Cost Dashboard.**
Spec 38 Cost Dashboard gets a new top-level banner: "⚠ N alerts active (last 24h)". Click → expand to show alert list. Each alert: project, service, percentage, timestamp.

## Non-Goals

- **No real-time cost streaming** — limits checked on each call, not via continuous monitor
- **No per-user limits** — limits are per-project (single-user system)
- **No budget grace period** — once `killAtPercent` is hit, hard pause. No "5 minutes more" override
- **No auto-resume of paused queues** — must be manual confirmation by user
- **No notifications/email for alerts** — Spec 40 (push) handles that
- **No cost forecasting** — out of scope (already excluded in Spec 38)
- **No budget tracking across calendar boundaries beyond day/month** — week/quarter not implemented
- **No retroactive cleanup of paused jobs** — paused queues mean queued jobs sit waiting; they resume on un-pause

## Detailed Implementation

### Schema Migration

`packages/db/migrations/000Y_cost_enforcement.sql`:

```sql
-- Pause-state per project (single row per project)
CREATE TABLE project_pause_states (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  paused_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  reason_details jsonb DEFAULT '{}'::jsonb,
  paused_by uuid REFERENCES users(id) ON DELETE SET NULL,
  service text,        -- which service triggered pause (anthropic/replicate/etc.)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cost alerts log (alertAtPercent breaches that didn't escalate to kill)
CREATE TABLE cost_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service text NOT NULL,
  threshold_type text NOT NULL CHECK (threshold_type IN ('daily', 'monthly')),
  limit_eur numeric(10,2) NOT NULL,
  spent_eur numeric(10,4) NOT NULL,
  percent integer NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cost_alerts_project_unack_idx
  ON cost_alerts (project_id, created_at DESC)
  WHERE acknowledged_at IS NULL;
```

Update `packages/db/src/schema/operations.ts` and `index.ts` to export the new tables.

### Backend: Core Cost-Enforcement Module

`packages/core/src/cost/enforcement.ts`:

```typescript
import { eq, and, gte, sql, isNull } from 'drizzle-orm';
import { db, projects, costLogs, projectPauseStates, costAlerts } from '@marketing-auto/db';

export class CostLimitExceededError extends Error {
  constructor(
    public readonly service: string,
    public readonly thresholdType: 'daily' | 'monthly',
    public readonly limitEur: number,
    public readonly spentEur: number,
    public readonly projectId: string,
  ) {
    super(`cost_limit_exceeded: ${service} ${thresholdType} limit ${limitEur} EUR, spent ${spentEur} EUR`);
    this.name = 'CostLimitExceededError';
  }
}

export interface CostBudgetCheck {
  ok: true;
  alertTriggered?: boolean;
  alertPercent?: number;
}

export interface CostBudgetExceeded {
  ok: false;
  service: string;
  thresholdType: 'daily' | 'monthly';
  limitEur: number;
  spentEur: number;
  projectedSpendEur: number; // spentEur + estimatedCostEur
}

/**
 * Pre-flight cost check. Returns ok=true if the operation can proceed,
 * ok=false if it would exceed killAtPercent threshold.
 *
 * Side effects:
 * - Writes cost_alerts row if alertAtPercent threshold crossed (and not already alerted today for same service/type)
 * - Does NOT pause queue (caller is responsible if ok=false)
 */
export async function checkCostBudget(
  projectId: string,
  service: string,
  estimatedCostEur: number,
): Promise<CostBudgetCheck | CostBudgetExceeded> {
  // Load project's costLimits
  const [project] = await db.select({ costLimits: projects.costLimits })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const limits = project?.costLimits;
  if (!limits || (!limits.daily && !limits.monthly)) {
    // No limits configured — allow (this is the fallback for legacy projects).
    // Note: project-creation endpoint should always populate defaults, so this branch
    // only executes for projects that existed before Spec 41.
    return { ok: true };
  }

  const killPercent = limits.killAtPercent ?? 100;
  const alertPercent = limits.alertAtPercent ?? 80;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Single query: get sum for both day and month windows in parallel
  const [spendRow] = await db.select({
    daySpend: sql<string>`coalesce(sum(case when ${costLogs.createdAt} >= ${startOfDay} then ${costLogs.costEur} else 0 end), 0)::text`,
    monthSpend: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
  })
    .from(costLogs)
    .where(and(
      eq(costLogs.projectId, projectId),
      eq(costLogs.service, service as 'anthropic' | 'replicate' | 'dataforseo' | 'smtp'),
      gte(costLogs.createdAt, startOfMonth),
    ));

  const daySpend = parseFloat(spendRow?.daySpend ?? '0');
  const monthSpend = parseFloat(spendRow?.monthSpend ?? '0');

  // Check daily limit
  const dailyLimit = limits.daily?.[service];
  if (dailyLimit !== undefined) {
    const projectedDay = daySpend + estimatedCostEur;
    const projectedDayPct = (projectedDay / dailyLimit) * 100;

    if (projectedDayPct >= killPercent) {
      return {
        ok: false,
        service,
        thresholdType: 'daily',
        limitEur: dailyLimit,
        spentEur: daySpend,
        projectedSpendEur: projectedDay,
      };
    }

    if (projectedDayPct >= alertPercent) {
      await maybeRecordAlert(projectId, service, 'daily', dailyLimit, projectedDay, projectedDayPct);
    }
  }

  // Check monthly limit
  const monthlyLimit = limits.monthly?.[service];
  if (monthlyLimit !== undefined) {
    const projectedMonth = monthSpend + estimatedCostEur;
    const projectedMonthPct = (projectedMonth / monthlyLimit) * 100;

    if (projectedMonthPct >= killPercent) {
      return {
        ok: false,
        service,
        thresholdType: 'monthly',
        limitEur: monthlyLimit,
        spentEur: monthSpend,
        projectedSpendEur: projectedMonth,
      };
    }

    if (projectedMonthPct >= alertPercent) {
      await maybeRecordAlert(projectId, service, 'monthly', monthlyLimit, projectedMonth, projectedMonthPct);
    }
  }

  return { ok: true };
}

/**
 * Asserts cost budget. Throws if exceeded. Used in adapter pre-call hooks.
 */
export async function assertCostBudget(
  projectId: string,
  service: string,
  estimatedCostEur: number,
): Promise<void> {
  const result = await checkCostBudget(projectId, service, estimatedCostEur);
  if (!result.ok) {
    // Pause queue + throw
    await pauseProjectQueues(
      projectId,
      'cost_limit_exceeded',
      {
        service: result.service,
        thresholdType: result.thresholdType,
        limitEur: result.limitEur,
        spentEur: result.spentEur,
      },
      result.service,
    );
    throw new CostLimitExceededError(
      result.service,
      result.thresholdType,
      result.limitEur,
      result.spentEur,
      projectId,
    );
  }
}

/**
 * Records an alert if no recent alert exists for same project+service+thresholdType (last 6 hours).
 * Prevents alert spam.
 */
async function maybeRecordAlert(
  projectId: string,
  service: string,
  thresholdType: 'daily' | 'monthly',
  limitEur: number,
  spentEur: number,
  percent: number,
): Promise<void> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const [recent] = await db.select({ id: costAlerts.id })
    .from(costAlerts)
    .where(and(
      eq(costAlerts.projectId, projectId),
      eq(costAlerts.service, service),
      eq(costAlerts.thresholdType, thresholdType),
      gte(costAlerts.createdAt, sixHoursAgo),
    ))
    .limit(1);

  if (recent) return; // Already alerted in this window

  await db.insert(costAlerts).values({
    projectId,
    service,
    thresholdType,
    limitEur: limitEur.toFixed(2),
    spentEur: spentEur.toFixed(4),
    percent: Math.round(percent),
  });

  console.warn('[cost-enforcement] Alert recorded:', {
    projectId, service, thresholdType, percent: Math.round(percent),
  });
}
```

### Backend: Project-Pause Module

`packages/core/src/cost/pause.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { db, projectPauseStates, pipelineRuns } from '@marketing-auto/db';
import { getQueuesForProject } from '@marketing-auto/pipelines'; // existing helper from Spec 05

export interface PauseInfo {
  pausedAt: string;
  reason: string;
  reasonDetails: Record<string, unknown>;
  service: string | null;
}

export async function pauseProjectQueues(
  projectId: string,
  reason: string,
  reasonDetails: Record<string, unknown>,
  service: string | null,
  pausedBy?: string,
): Promise<void> {
  // Idempotent — UPSERT
  await db.insert(projectPauseStates).values({
    projectId,
    reason,
    reasonDetails,
    service,
    pausedBy: pausedBy ?? null,
  }).onConflictDoUpdate({
    target: projectPauseStates.projectId,
    set: {
      reason,
      reasonDetails,
      service,
      pausedAt: new Date(),
      pausedBy: pausedBy ?? null,
    },
  });

  // Pause all BullMQ queues for this project
  const queues = getQueuesForProject(projectId);
  for (const queue of queues) {
    await queue.pause();
  }

  console.warn('[cost-enforcement] Project queues paused:', { projectId, reason, service });
}

export async function resumeProjectQueues(projectId: string, resumedBy?: string): Promise<void> {
  await db.delete(projectPauseStates).where(eq(projectPauseStates.projectId, projectId));

  const queues = getQueuesForProject(projectId);
  for (const queue of queues) {
    await queue.resume();
  }

  console.info('[cost-enforcement] Project queues resumed:', { projectId, resumedBy });
}

export async function getPauseInfo(projectId: string): Promise<PauseInfo | null> {
  const [row] = await db.select()
    .from(projectPauseStates)
    .where(eq(projectPauseStates.projectId, projectId))
    .limit(1);
  if (!row) return null;
  return {
    pausedAt: row.pausedAt.toISOString(),
    reason: row.reason,
    reasonDetails: row.reasonDetails as Record<string, unknown>,
    service: row.service,
  };
}

export async function isProjectPaused(projectId: string): Promise<boolean> {
  const [row] = await db.select({ projectId: projectPauseStates.projectId })
    .from(projectPauseStates)
    .where(eq(projectPauseStates.projectId, projectId))
    .limit(1);
  return !!row;
}
```

**Note for implementer:** `getQueuesForProject(projectId)` may not exist yet in `packages/pipelines`. Most BullMQ setups use a single queue per pipeline-name (not per-project). Adjust the implementation:

```typescript
// If queues are global (one queue per pipeline name), pause all queues used by this project's pipelines.
// Identify by checking pipeline_runs WHERE projectId = X for distinct pipelineNames.
// Alternative: maintain a Set<Queue> of all known queues, and pause all of them
// (acceptable if cost-pause is rare and short-lived).
// Decide based on actual existing queue architecture.
```

If queues are global (one queue per pipeline name), then "pausing for one project" actually pauses globally — which is acceptable for a single-tenant deployment. For multi-tenant it would need a per-project queue refactor (out of scope).

For Marcel's current single-active-project setup (KI-Wissensraum primary, others test): **global pause is fine**. Document this in the spec as "single-project scope OK; multi-project deployments need per-project queue refactor".

### Backend: Adapter Pre-Call Wiring

Each adapter's main entry point gets a pre-call check. Example for Anthropic:

`packages/adapter-anthropic/src/index.ts` (approximate location):

```typescript
import { assertCostBudget } from '@marketing-auto/core/cost/enforcement';
import { estimateCostEur } from '@marketing-auto/core/cost/estimates';

export async function callAnthropic(opts: {
  projectId: string;
  operation: string; // matches estimates lookup
  messages: AnthropicMessage[];
  // ... other params
}): Promise<AnthropicResponse> {
  // Pre-flight: hard cost check
  const estimated = estimateCostEur('anthropic', opts.operation);
  await assertCostBudget(opts.projectId, 'anthropic', estimated);

  // Existing call logic
  const response = await anthropicClient.messages.create({...});

  // Post-call: real cost logging (existing Spec 03 behavior)
  await logCost(opts.projectId, 'anthropic', opts.operation, computeRealCost(response));

  return response;
}
```

Same pattern for `adapter-replicate`, `adapter-dataforseo`, `adapter-email`. For SMTP, the cost is so low it could be skipped, but consistency wins — include it.

**Important:** the `assertCostBudget` call is BEFORE the API call. If it throws, no money is spent. The pause+throw sequence is atomic from the adapter's caller's perspective: either the operation completes or it throws `CostLimitExceededError`.

### Backend: Pipeline Worker Error-Handler Update

`packages/pipelines/src/engine/worker.ts` (or wherever the BullMQ worker `failed` hook lives):

```typescript
// Existing afterError logic adds errorMessage to pipeline_runs
// Extend to recognize CostLimitExceededError specifically:

queue.on('failed', async (job, err) => {
  const isCostError = err.name === 'CostLimitExceededError'
    || err.message?.startsWith('cost_limit_exceeded:');

  await db.update(pipelineRuns)
    .set({
      status: 'failed',
      errorMessage: err.message,
      completedAt: new Date(),
      // Add a tag so frontend can show special error UI
      output: isCostError
        ? { errorType: 'cost_limit_exceeded' }
        : undefined,
    })
    .where(eq(pipelineRuns.id, job.data.preRunId));

  // pause was already triggered inside assertCostBudget — no additional action needed
});
```

### Backend: Trigger-Endpoint Wiring (extends Spec 35/36 pattern)

The canonical `triggerWithPreRunId` helper from Spec 36 gets two enhancements:

`apps/api/src/routes/_lib/trigger-helpers.ts` (extracted from articles.ts for reuse):

```typescript
import { eq, and, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db, pipelineRuns } from '@marketing-auto/db';
import { checkCostBudget } from '@marketing-auto/core/cost/enforcement';
import { isProjectPaused } from '@marketing-auto/core/cost/pause';
import { estimateCostEur } from '@marketing-auto/core/cost/estimates';

export interface TriggerOptions {
  pipelineName: string;
  projectId: string;
  /** For idempotency check; e.g., articleId, clusterId */
  uniqueKey: { field: string; value: string };
  /** Service + operation for pre-flight cost check */
  costEstimate?: { service: string; operation: string; multiplier?: number };
  enqueue: (input: { preRunId: string; projectId: string; [key: string]: unknown }) => Promise<{ jobId: string }>;
  /** Extra fields to merge into pipeline_runs.input + enqueue payload */
  extraInput?: Record<string, unknown>;
}

export type TriggerResult =
  | { runId: string; jobId: string; deduped: false }
  | { runId: string; jobId: string; deduped: true }
  | { error: 'project_paused'; pauseInfo: unknown }
  | { error: 'cost_limit_exceeded'; details: unknown };

export async function triggerWithPreRunId(opts: TriggerOptions): Promise<TriggerResult> {
  // Step 1: Project pause check
  if (await isProjectPaused(opts.projectId)) {
    const info = await import('@marketing-auto/core/cost/pause').then((m) => m.getPauseInfo(opts.projectId));
    return { error: 'project_paused', pauseInfo: info };
  }

  // Step 2: Cost budget check (if estimate provided)
  if (opts.costEstimate) {
    const cost = estimateCostEur(opts.costEstimate.service, opts.costEstimate.operation, opts.costEstimate.multiplier ?? 1);
    const result = await checkCostBudget(opts.projectId, opts.costEstimate.service, cost);
    if (!result.ok) {
      return { error: 'cost_limit_exceeded', details: result };
    }
  }

  // Step 3: Idempotency check — is there already an active run for the same key?
  const existing = await db.select({ id: pipelineRuns.id, jobId: pipelineRuns.jobId })
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.pipelineName, opts.pipelineName),
      sql`${pipelineRuns.input}->>${opts.uniqueKey.field} = ${opts.uniqueKey.value}`,
      inArray(pipelineRuns.status, ['queued', 'running']),
    ))
    .limit(1);

  if (existing.length > 0) {
    return {
      runId: existing[0]!.id,
      jobId: existing[0]!.jobId ?? '',
      deduped: true,
    };
  }

  // Step 4: Pre-INSERT pipeline_runs row + enqueue
  const preRunId = randomUUID();
  const inputPayload = {
    preRunId,
    projectId: opts.projectId,
    [opts.uniqueKey.field]: opts.uniqueKey.value,
    ...(opts.extraInput ?? {}),
  };

  await db.insert(pipelineRuns).values({
    id: preRunId,
    pipelineName: opts.pipelineName,
    projectId: opts.projectId,
    status: 'queued',
    input: inputPayload,
  });

  const { jobId } = await opts.enqueue(inputPayload);

  await db.update(pipelineRuns)
    .set({ jobId })
    .where(eq(pipelineRuns.id, preRunId));

  return { runId: preRunId, jobId, deduped: false };
}

/** Helper for HTTP responses */
export function triggerResultToResponse(c: import('hono').Context, result: TriggerResult): Response {
  if ('error' in result) {
    if (result.error === 'project_paused') {
      return c.json({ ok: false, error: 'project_paused', data: result.pauseInfo }, 423); // Locked
    }
    if (result.error === 'cost_limit_exceeded') {
      return c.json({ ok: false, error: 'cost_limit_exceeded', data: result.details }, 402); // Payment Required
    }
  }
  return c.json({ ok: true, data: result }, result.deduped ? 200 : 202);
}
```

Update `apps/api/src/routes/articles.ts` triggers to use new helper:

```typescript
articleRoutes.post('/:id/generate-outline', async (c) => {
  const id = c.req.param('id');
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: 'article:outline',
    projectId: article.projectId,
    uniqueKey: { field: 'articleId', value: id },
    costEstimate: { service: 'anthropic', operation: 'outline-generation' },
    extraInput: { articleId: id },
    enqueue: enqueueArticleOutlinePipeline,
  });

  return triggerResultToResponse(c, result);
});
```

Same pattern for `generate-draft`, `sync`, `validate-pagespeed`, `extend-schema`. Spec 35 cold-start triggers also adopt this helper.

### Backend: PageSpeed Cooldown

`apps/api/src/routes/articles.ts` `validate-pagespeed` endpoint:

```typescript
articleRoutes.post('/:id/validate-pagespeed', async (c) => {
  const id = c.req.param('id');
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  // Cooldown check: 5 minutes + same astro_commit_sha
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const [recent] = await db.select()
    .from(pagespeedRuns)
    .where(and(
      eq(pagespeedRuns.articleId, id),
      gte(pagespeedRuns.startedAt, fiveMinAgo),
    ))
    .orderBy(desc(pagespeedRuns.startedAt))
    .limit(1);

  if (recent && recent.astroCommitSha === article.astroCommitSha) {
    return c.json({
      ok: false,
      error: 'pagespeed_cooldown',
      message: 'PageSpeed run too recent for unchanged content. Wait 5 minutes or sync new changes first.',
      data: { lastRunAt: recent.startedAt.toISOString() },
    }, 429);
  }

  // ... continue with triggerWithPreRunId
});
```

### Backend: Sync Stale-Read Check

`packages/pipelines/src/article/sync.ts` (location may vary):

```typescript
async function commitToAstro(articleId: string, runStartedAt: Date): Promise<void> {
  // Re-fetch article to check for stale read
  const [article] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
  if (!article) throw new Error('article_disappeared');

  if (article.updatedAt > runStartedAt) {
    throw new SyncStaleReadError(`Article was updated at ${article.updatedAt.toISOString()} after run started at ${runStartedAt.toISOString()}`);
  }

  // ... continue with commit
}

export class SyncStaleReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncStaleReadError';
  }
}
```

Worker error handler maps `SyncStaleReadError` to `errorStage='stale_read'` in `astro_sync_runs`.

### Backend: Project Resume Endpoint

`apps/api/src/routes/projects.ts` (extend existing):

```typescript
projectRoutes.post('/:slug/resume-queues', async (c) => {
  const slug = c.req.param('slug');
  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);

  const user = c.get('user') as { id: string };
  await resumeProjectQueues(project.id, user.id);

  return c.json({ ok: true, data: { resumed: true } });
});

projectRoutes.get('/:slug/pause-state', async (c) => {
  const slug = c.req.param('slug');
  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);

  const info = await getPauseInfo(project.id);
  return c.json({ ok: true, data: info });
});
```

### Backend: Cost Alerts Endpoints

`apps/api/src/routes/cost.ts` (extend Spec 38):

```typescript
costRoutes.get('/alerts', async (c) => {
  const projectId = c.req.query('projectId');
  const includeAcked = c.req.query('includeAcked') === 'true';

  const filters = [];
  if (projectId) filters.push(eq(costAlerts.projectId, projectId));
  if (!includeAcked) filters.push(isNull(costAlerts.acknowledgedAt));

  const alerts = await db.select({
    id: costAlerts.id,
    projectId: costAlerts.projectId,
    projectName: projects.name,
    service: costAlerts.service,
    thresholdType: costAlerts.thresholdType,
    limitEur: costAlerts.limitEur,
    spentEur: costAlerts.spentEur,
    percent: costAlerts.percent,
    acknowledgedAt: costAlerts.acknowledgedAt,
    createdAt: costAlerts.createdAt,
  })
    .from(costAlerts)
    .leftJoin(projects, eq(costAlerts.projectId, projects.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(costAlerts.createdAt))
    .limit(100);

  return c.json({ ok: true, data: alerts });
});

costRoutes.post('/alerts/:id/acknowledge', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user') as { id: string };
  await db.update(costAlerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: user.id })
    .where(eq(costAlerts.id, id));
  return c.json({ ok: true, data: { id } });
});
```

### Backend: Cold-Start Hard Cap on Competitors

`packages/pipelines/src/cold-start/competitor-analysis.ts` — at pipeline entry, enforce max 15:

```typescript
export async function competitorAnalysisPipeline(input: CompetitorAnalysisInput): Promise<CompetitorAnalysisOutput> {
  const competitors = input.competitors;
  const MAX_COMPETITORS = 15;

  if (competitors.length > MAX_COMPETITORS) {
    throw new Error(
      `competitor_count_exceeded: ${competitors.length} competitors exceeds limit of ${MAX_COMPETITORS}. Please trim the list before running analysis.`,
    );
  }

  // ... continue
}
```

### Backend: Project-Defaults Helper

`apps/api/src/routes/projects.ts` — extend project create endpoint:

```typescript
import { DEFAULT_COST_LIMITS } from '@marketing-auto/core/cost/defaults';

projectRoutes.post('/', zValidator('json', createProjectSchema), async (c) => {
  const input = c.req.valid('json');

  // Merge defaults if costLimits empty
  const costLimits = (!input.costLimits || Object.keys(input.costLimits).length === 0)
    ? DEFAULT_COST_LIMITS
    : input.costLimits;

  const [created] = await db.insert(projects).values({
    ...input,
    costLimits,
  }).returning();

  return c.json({ ok: true, data: created }, 201);
});
```

`packages/core/src/cost/defaults.ts`:

```typescript
import type { CostLimits } from '@marketing-auto/db';

export const DEFAULT_COST_LIMITS: CostLimits = {
  daily: {
    anthropic: 5.0,
    replicate: 3.0,
    dataforseo: 5.0,
    smtp: 1.0,
  },
  monthly: {
    anthropic: 100.0,
    replicate: 50.0,
    dataforseo: 30.0,
    smtp: 5.0,
  },
  alertAtPercent: 80,
  killAtPercent: 100,
};
```

One-shot script for existing projects: `apps/api/src/scripts/apply-cost-defaults.ts`:

```typescript
import { db, projects } from '@marketing-auto/db';
import { DEFAULT_COST_LIMITS } from '@marketing-auto/core/cost/defaults';
import { sql } from 'drizzle-orm';

async function main(): Promise<void> {
  const all = await db.select({ id: projects.id, slug: projects.slug, costLimits: projects.costLimits })
    .from(projects);

  let updated = 0;
  for (const p of all) {
    const isEmpty = !p.costLimits || Object.keys(p.costLimits as object).length === 0;
    if (isEmpty) {
      await db.update(projects)
        .set({ costLimits: DEFAULT_COST_LIMITS })
        .where(sql`${projects.id} = ${p.id}`);
      console.log(`Applied defaults to ${p.slug}`);
      updated++;
    } else {
      console.log(`Skipped ${p.slug} (limits already set)`);
    }
  }
  console.log(`Done. Updated ${updated} of ${all.length} projects.`);
}

void main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run once: `bun run apps/api/src/scripts/apply-cost-defaults.ts`.

### Frontend: Polling Composables 401-Handling

`apps/web/src/composables/usePipelineRunPolling.ts` — patch `fetchOnce`:

```typescript
async function fetchOnce(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<{ ok: boolean; data: PipelineRunData }>(`/pipeline-runs/${runId.value}`);
    runData.value = res.data.data;
    error.value = null;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      stop();
      // Don't show error toast — auth-store handles redirect
      return;
    }
    error.value = e instanceof Error ? e.message : 'fetch_failed';
  } finally {
    loading.value = false;
  }
}
```

Same patch in `useActiveRunsPolling.ts`.

### Frontend: Activity Feed Polling — Cache-Friendly `since`

`apps/web/src/composables/useActiveRunsPolling.ts` — fix the `since` rounding:

```typescript
async function fetchOnce(): Promise<void> {
  loading.value = true;
  try {
    const sinceMs = (opts.sinceHours?.value ?? 24) * 60 * 60 * 1000;
    const rawSince = Date.now() - sinceMs;
    // Round down to 5-minute boundary for cache-friendliness
    const ROUND_TO = 5 * 60 * 1000;
    const roundedSince = Math.floor(rawSince / ROUND_TO) * ROUND_TO;
    const since = new Date(roundedSince).toISOString();

    const params = new URLSearchParams({ since });
    if (opts.projectId?.value) params.set('projectId', opts.projectId.value);
    // ... rest
  }
  // ...
}
```

### Frontend: Article Body Re-Sync UX Fix

`apps/web/src/components/articles/ArticleBodyPanel.vue` — disable re-sync checkbox when status doesn't allow:

```vue
<q-checkbox
  v-model="resyncAfterSave"
  :disable="!canResync()"
  class="q-mt-md"
  :label="$t('articles.body.saveDialog.resyncAfterSave')"
/>
<div v-if="!canResync()" class="text-caption text-grey-7">
  {{ $t('articles.body.saveDialog.resyncDisabledHint') }}
</div>
```

Add i18n key: `articles.body.saveDialog.resyncDisabledHint: 'Re-sync nur möglich wenn Status "Ready to publish", "Published" oder "Blocked by PageSpeed".'`

### Frontend: Pause-State UI

`apps/web/src/composables/useProjectPauseState.ts` — small composable to fetch and watch pause state:

```typescript
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { api } from 'src/lib/api-client';

interface PauseInfo {
  pausedAt: string;
  reason: string;
  reasonDetails: Record<string, unknown>;
  service: string | null;
}

export function useProjectPauseState(slug: string) {
  const pauseInfo = ref<PauseInfo | null>(null);
  const loading = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function fetchOnce(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<{ ok: boolean; data: PauseInfo | null }>(`/projects/${slug}/pause-state`);
      pauseInfo.value = res.data.data;
    } finally {
      loading.value = false;
    }
  }

  async function resume(): Promise<void> {
    await api.post(`/projects/${slug}/resume-queues`);
    await fetchOnce();
  }

  onMounted(() => {
    void fetchOnce();
    // Re-check every 30 seconds (low-frequency; pause is a rare state)
    timer = setInterval(() => void fetchOnce(), 30000);
  });

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });

  return { pauseInfo, loading, refresh: fetchOnce, resume };
}
```

`apps/web/src/components/common/ProjectPauseBanner.vue` — surface in project pages:

```vue
<template>
  <q-banner v-if="pauseInfo" class="bg-negative text-white q-mb-md">
    <template v-slot:avatar>
      <q-icon name="pause_circle" size="32px" />
    </template>
    <div class="text-h6">{{ $t('projectPause.title') }}</div>
    <div class="text-body2 q-mt-xs">
      {{ $t('projectPause.reason', { reason: $t(`projectPause.reasons.${pauseInfo.reason}`) }) }}
      <span v-if="pauseInfo.service"> ({{ pauseInfo.service }})</span>
    </div>
    <div class="text-caption q-mt-xs">
      {{ $t('projectPause.pausedAt', { time: formatTime(pauseInfo.pausedAt) }) }}
    </div>
    <template v-slot:action>
      <q-btn flat color="white" :label="$t('projectPause.resume')" :loading="resuming" @click="onResume" />
    </template>
  </q-banner>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useProjectPauseState } from 'src/composables/useProjectPauseState';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';

export default defineComponent({
  name: 'ProjectPauseBanner',

  props: {
    slug: { type: String, required: true },
  },

  setup(props) {
    const { pauseInfo, resume } = useProjectPauseState(props.slug);
    return { pauseInfo, resume, notify: useNotify() };
  },

  data: () => ({
    resuming: false,
  }),

  methods: {
    formatTime(iso: string): string {
      return new Date(iso).toLocaleString(this.$i18n.locale);
    },

    async onResume(): Promise<void> {
      this.resuming = true;
      try {
        await this.resume();
        this.notify.success(this.$t('projectPause.resumeSuccess') as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.resuming = false;
      }
    },
  },
});
</script>
```

Mount this banner inside `ProjectDetailPage.vue` and `ClustersManagementPage.vue` (and any other project-scoped pages). It auto-displays when the project is paused.

### Frontend: Cold-Start Confirmation for Phase 2.2

`apps/web/src/components/cold-start/Phase2CompetitorAnalysis.vue` — replace auto-chain with explicit confirmation:

```vue
<template>
  <!-- ... existing UI ... -->

  <div v-if="phase2_1_complete && !phase2_2_started" class="confirmation-card">
    <div class="confirmation-card__title">
      {{ $t('coldStart.phase2.confirmation.title') }}
    </div>
    <div class="confirmation-card__body">
      {{ $t('coldStart.phase2.confirmation.body', {
        count: competitorCount,
        cost: estimatedCost.toFixed(2),
      }) }}
    </div>
    <div v-if="competitorCount > MAX_COMPETITORS" class="confirmation-card__warning">
      <q-icon name="warning" color="warning" />
      {{ $t('coldStart.phase2.confirmation.tooManyCompetitors', {
        count: competitorCount,
        max: MAX_COMPETITORS,
      }) }}
    </div>
    <div class="confirmation-card__actions">
      <q-btn
        outline
        :label="$t('coldStart.phase2.confirmation.cancel')"
        @click="onCancel"
      />
      <q-btn
        color="primary"
        :label="$t('coldStart.phase2.confirmation.runAnalysis')"
        :disable="competitorCount > MAX_COMPETITORS || competitorCount === 0"
        @click="onConfirm"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

const MAX_COMPETITORS = 15;
const COST_PER_COMPETITOR_EUR = 0.20;

export default defineComponent({
  // ...

  computed: {
    competitorCount(): number {
      return this.competitorList?.length ?? 0;
    },
    estimatedCost(): number {
      return this.competitorCount * COST_PER_COMPETITOR_EUR;
    },
  },

  data() {
    return {
      MAX_COMPETITORS,
      // ...
    };
  },

  methods: {
    async onConfirm(): Promise<void> {
      // Trigger phase 2.2
      // ...
    },
  },
});
</script>
```

i18n keys:
```typescript
// de/coldStart.ts
phase2: {
  confirmation: {
    title: 'Bereit für Wettbewerbs-Analyse?',
    body: '{count} Wettbewerber identifiziert. Die Analyse kostet ca. €{cost} (DataForSEO).',
    tooManyCompetitors: '{count} Wettbewerber überschreiten das Maximum von {max}. Bitte kürze die Liste vor dem Start.',
    cancel: 'Abbrechen',
    runAnalysis: 'Analyse starten',
  },
}
```

### Frontend: Cost Dashboard Alerts Banner

`apps/web/src/pages/CostDashboardPage.vue` — add alerts section above summary cards:

```vue
<template>
  <q-page padding>
    <CostAlertsBanner v-if="alerts.length > 0" :alerts="alerts" @acknowledge="onAcknowledge" />
    <!-- ... existing ... -->
  </q-page>
</template>
```

`apps/web/src/components/cost/CostAlertsBanner.vue`:

```vue
<template>
  <q-banner class="bg-warning text-dark q-mb-md">
    <template v-slot:avatar>
      <q-icon name="warning" size="28px" />
    </template>
    <div class="text-subtitle1">
      {{ $t('cost.alerts.title', { count: alerts.length }) }}
    </div>
    <q-list dense>
      <q-item v-for="alert in alerts" :key="alert.id">
        <q-item-section>
          <q-item-label>
            <strong>{{ alert.projectName ?? '—' }}</strong> · {{ alert.service }}
          </q-item-label>
          <q-item-label caption>
            {{ alert.thresholdType }}: € {{ formatEur(alert.spentEur) }} / € {{ formatEur(alert.limitEur) }}
            ({{ alert.percent }}%)
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn flat dense :label="$t('common.acknowledge') as string" @click="$emit('acknowledge', alert.id)" />
        </q-item-section>
      </q-item>
    </q-list>
  </q-banner>
</template>
```

Cost store extension:
```typescript
// stores/cost.ts
async fetchAlerts(): Promise<void> {
  const res = await api.get<{ ok: boolean; data: CostAlert[] }>(`/cost/alerts`);
  this.alerts = res.data.data;
},

async acknowledgeAlert(id: string): Promise<void> {
  await api.post(`/cost/alerts/${id}/acknowledge`);
  await this.fetchAlerts();
},
```

### Frontend: Trigger-Response Error Handling

UI components that call trigger endpoints need to handle the new error responses (402/423/200-deduped):

```typescript
// In ArticleActionPanel.vue or similar:
async onAction(action: PipelineAction & { enabled: boolean }): Promise<void> {
  if (!action.enabled) return;
  this.loadingAction = action.id;
  try {
    const result = await action.triggerFn(this.article.id);
    if ('deduped' in result && result.deduped) {
      this.notify.info(this.$t('articles.actions.alreadyRunning') as string);
      return;
    }
    this.notify.success(this.$t('articles.actions.triggered', { action: this.$t(action.i18nKey) }) as string);
    this.$emit('action-triggered', { actionId: action.id, runId: result.runId });
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 402) {
        this.notify.error(this.$t('cost.errors.limitExceeded') as string);
      } else if (e.status === 423) {
        this.notify.error(this.$t('projectPause.errors.queuePaused') as string);
      } else {
        this.notify.error(e.userMessage);
      }
    }
  } finally {
    this.loadingAction = null;
  }
}
```

Article store action returns the full result for the deduped check:
```typescript
async triggerOutline(articleId: string): Promise<{ runId: string; jobId: string; deduped?: boolean }> {
  const res = await api.post(`/articles/${articleId}/generate-outline`);
  // Backend returns 200 if deduped, 202 if newly created
  return res.data.data;
},
```

### i18n keys (additions)

`apps/web/src/i18n/de/projectPause.ts`:

```typescript
export default {
  title: 'Projekt-Pipeline pausiert',
  reason: 'Grund: {reason}',
  reasons: {
    cost_limit_exceeded: 'Kostenlimit überschritten',
    manual: 'Manuell pausiert',
    error: 'Fehler-Eskalation',
  },
  pausedAt: 'Pausiert seit {time}',
  resume: 'Fortsetzen',
  resumeSuccess: 'Projekt-Pipeline fortgesetzt',
  errors: {
    queuePaused: 'Projekt-Pipeline ist pausiert. Bitte zuerst fortsetzen.',
  },
};
```

`apps/web/src/i18n/de/cost.ts` (extend):

```typescript
// add to existing cost translations
alerts: {
  title: '{count} aktive Kostenwarnungen',
},
errors: {
  limitExceeded: 'Kostenlimit erreicht. Pipeline pausiert.',
},
```

`apps/web/src/i18n/de/articles.ts` (extend):

```typescript
actions: {
  // existing keys
  alreadyRunning: 'Pipeline läuft bereits — Aktion wurde nicht erneut ausgelöst',
},
body: {
  saveDialog: {
    // existing keys
    resyncDisabledHint: 'Re-sync nur möglich wenn Status "Ready to publish", "Published" oder "Blocked by PageSpeed".',
  },
},
```

`apps/web/src/i18n/de/common.ts` (extend):

```typescript
acknowledge: 'Bestätigen',
```

Mirror everything in `en/`.

## Acceptance Criteria

### Cost Enforcement

- [ ] Migration creates `project_pause_states` and `cost_alerts` tables
- [ ] `checkCostBudget()` returns `ok: true` when no limits configured
- [ ] `checkCostBudget()` returns `ok: false` when daily threshold (>= killAtPercent) exceeded
- [ ] `checkCostBudget()` returns `ok: false` when monthly threshold exceeded
- [ ] `checkCostBudget()` records cost-alert when alertAtPercent crossed but killAtPercent not reached
- [ ] Cost-alert dedup: no duplicate alert within 6h for same project+service+threshold-type
- [ ] `assertCostBudget()` throws `CostLimitExceededError` on exceed + pauses queues
- [ ] Anthropic adapter calls `assertCostBudget` before API call
- [ ] Replicate adapter calls `assertCostBudget` before API call
- [ ] DataForSEO adapter calls `assertCostBudget` before API call
- [ ] SMTP adapter calls `assertCostBudget` before send
- [ ] BullMQ worker `failed` hook adds `errorType: 'cost_limit_exceeded'` to output for cost errors

### Idempotency + Trigger Hardening

- [ ] `triggerWithPreRunId` checks for active run before creating new
- [ ] Returns `deduped: true` with existing runId when active run found
- [ ] HTTP returns 200 (deduped) vs 202 (new) — clear distinction
- [ ] Returns 423 (Locked) when project queues paused
- [ ] Returns 402 (Payment Required) when cost limit would be exceeded by trigger
- [ ] All 5 article triggers updated to use new helper
- [ ] All 5 cold-start triggers updated to use new helper
- [ ] Cluster + pillar mutation endpoints unchanged (no cost implications)

### PageSpeed Cooldown

- [ ] PageSpeed validation rejects with 429 when last run < 5 min ago + same commit_sha
- [ ] PageSpeed validation accepts when last run > 5 min ago
- [ ] PageSpeed validation accepts when commit_sha differs

### Sync Stale-Read

- [ ] Sync worker re-fetches article before commit
- [ ] Aborts with `errorStage='stale_read'` if article updated after run started
- [ ] No commit happens; new pipeline run by user picks up fresh content

### Pause/Resume

- [ ] `pauseProjectQueues()` writes pause-state row + calls `queue.pause()` on relevant queues
- [ ] `resumeProjectQueues()` deletes pause-state + calls `queue.resume()`
- [ ] `isProjectPaused()` checks pause-state row existence
- [ ] `getPauseInfo()` returns full pause details
- [ ] HTTP `POST /api/projects/:slug/resume-queues` requires auth + responds 200 on success
- [ ] HTTP `GET /api/projects/:slug/pause-state` returns current state (or null)

### Cost Limits Defaults

- [ ] Project create endpoint applies `DEFAULT_COST_LIMITS` if costLimits empty
- [ ] One-shot script `apply-cost-defaults.ts` updates only projects with empty costLimits
- [ ] Existing projects with manual limits unchanged

### Polling Composables

- [ ] `usePipelineRunPolling` stops on 401/403 response
- [ ] `useActiveRunsPolling` stops on 401/403 response
- [ ] `useActiveRunsPolling` rounds `since` to 5-min boundary

### Frontend UX

- [ ] Project pause banner displayed on project pages when paused
- [ ] Resume button works + refreshes state
- [ ] Cost dashboard shows alerts banner above summary
- [ ] Article action buttons handle 402/423 with appropriate messages
- [ ] Article action buttons handle deduped (200) with info notification
- [ ] Body-edit re-sync checkbox disabled when status doesn't allow + helpful hint
- [ ] Cold-start phase 2 shows confirmation card before phase 2.2 with cost estimate
- [ ] Cold-start phase 2 blocks if competitor count > 15

### Cold-Start Hardening

- [ ] Backend `competitor-analysis` pipeline rejects > 15 competitors
- [ ] Frontend disables "Run analysis" button if > 15 competitors
- [ ] Frontend shows clear cost estimate before phase 2.2

## Testing Strategy

### Unit / Integration Tests

1. **Cost check basic**: Project with `daily.anthropic = 5.0`, current daySpend = 4.0. Call `checkCostBudget(projectId, 'anthropic', 0.5)`. Returns `ok: true` (4.5 / 5.0 = 90% — alert recorded but not killed).
2. **Cost check kill**: Same setup. Call with estimate = 1.5. Returns `ok: false`, exceeds 100%.
3. **Cost check no-limit**: Empty costLimits. Returns `ok: true` regardless.
4. **Idempotency**: Insert pipeline_runs row with status='running' for article X. Call `triggerWithPreRunId({pipelineName: 'article:outline', uniqueKey: {field: 'articleId', value: X}, ...})`. Returns deduped=true with existing runId.
5. **Pause idempotent**: Call `pauseProjectQueues()` twice in a row. Second call updates the existing row, no error.
6. **Alert dedup**: Trigger same alert (project+service+thresholdType) twice within 6h. Only one row in cost_alerts.

### Manual Smoke Tests

7. **Cost-pause flow**: Set `monthly.anthropic = 0.10` artificially low. Run a Cold-Start phase that uses Anthropic. Pipeline fails immediately, project gets paused, banner appears, resume button works.
8. **Idempotency UX**: Click Generate Outline twice in 100ms. Verify only one pipeline run created (DB query). Second click shows "Pipeline läuft bereits" toast.
9. **Cold-start confirm**: Run Phase 2.1, get 12 competitors. UI shows confirmation card with "12 competitors, ~€2.40". Click confirm → Phase 2.2 starts. Click cancel → no Phase 2.2.
10. **PageSpeed cooldown**: Trigger validate-pagespeed, wait 1 minute, trigger again with same content. 429 error.
11. **Sync stale read**: Trigger sync. Within 2 seconds, edit article body via API. The sync should still complete the original commit (sees stale_read on re-fetch attempt — actual behavior depends on timing). Verify no double-commit.
12. **Polling stops on logout**: Open Activity page, wait for poll. Open browser dev tools network tab. Manually call `/api/auth/logout`. Verify subsequent polls stop after first 401.
13. **Defaults applied to new project**: Create new project via Installer Wizard. Check DB → costLimits matches DEFAULT_COST_LIMITS.
14. **Defaults script for existing**: Run script. KI-Wissensraum costLimits gets defaults (assuming it was empty). Other projects with manual limits unchanged.

## Open Questions / Decisions Made

**Decision 1: 6-hour alert dedup window.**
Prevents alert spam without making them too rare to notice. Tunable.

**Decision 2: 5-minute PageSpeed cooldown.**
Long enough to require meaningful change, short enough not to frustrate. Astro builds take 30-60s, so 5 min ≈ 5-10× build time.

**Decision 3: Cost estimates are conservative (rounded up).**
A miss in the safe direction. Actual cost-tracking continues post-call, so estimates only need to be ballpark.

**Decision 4: Pause is global per BullMQ queue, not per-project.**
For single-tenant Marcel setup, pausing the queue effectively pauses the project. Multi-tenant deployments would need per-project queues — explicitly out of scope.

**Decision 5: Resume is manual only.**
No auto-resume after period. Marcel must consciously decide "OK, increase limits, then resume" or "investigate, then resume."

**Decision 6: Defaults applied on creation (not migration).**
Avoids touching projects that intentionally have empty limits. The `apply-cost-defaults.ts` script is the explicit migration step.

**Decision 7: SMTP gets cost enforcement too despite tiny per-call cost.**
Consistency. A bug that sends 10,000 emails would be noticed via the limit. The 0.001 EUR estimate per send means daily limit of 1.0 EUR = 1000 sends — plenty for normal use.

**Decision 8: `triggerResultToResponse()` helper standardizes HTTP responses.**
Centralizes the 200/202/402/423 mapping. Reduces boilerplate in each route.

**Decision 9: Cost alerts don't auto-acknowledge.**
Marcel must explicitly acknowledge — forces awareness. If unacknowledged alerts pile up beyond 100, the dashboard truncates the list (not a problem in practice).

**Decision 10: No "test mode" or "dry run" for cost checks.**
Could be added later if Marcel wants to forecast a Cold-Start cost without running it. Out of scope.

**Decision 11: Pause-state has `service` column for context only.**
Tells you "the pause was due to anthropic" — but resuming resumes everything, not just anthropic. This is intentional — partial resume would be a Pandora's box of edge cases.

**Decision 12: Cold-start Phase 2 cost estimate is hard-coded in frontend.**
Could read from `COST_ESTIMATES_EUR['dataforseo']['serp-analysis']` * count, but that requires exposing the estimates table. For now, hard-code COST_PER_COMPETITOR_EUR = 0.20 in the frontend constant. Long-term: expose via API.

## Implementation Order

**Recommend 3 sessions.**

**Session 1: DB + Core Cost Module + Adapter Wiring (~6h)**

1. Migration for `project_pause_states` + `cost_alerts` (~30 min)
2. `packages/core/src/cost/enforcement.ts` — `checkCostBudget`, `assertCostBudget`, `CostLimitExceededError` (~1.5h)
3. `packages/core/src/cost/pause.ts` — pause/resume/info helpers (~1h)
4. `packages/core/src/cost/estimates.ts` + `defaults.ts` (~30 min)
5. Adapter pre-call wiring (Anthropic, Replicate, DataForSEO, SMTP) (~1.5h)
6. Worker error-handler update for `CostLimitExceededError` (~30 min)
7. Unit tests for cost-check logic (~30 min)
8. Commit: `feat(core,db): cost enforcement core (spec 41 part 1)`

**Session 2: Trigger Helper + Endpoints + Cold-Start Hardening (~5h)**

1. Extract `_lib/trigger-helpers.ts` from articles.ts (~45 min)
2. Update all article triggers to use new helper with cost-estimate + idempotency (~1h)
3. Update all cold-start triggers similarly (~45 min)
4. PageSpeed cooldown logic (~30 min)
5. Sync stale-read check (~30 min)
6. `cold-start:competitor-analysis` hard cap of 15 (~15 min)
7. Project resume + pause-state HTTP endpoints (~30 min)
8. Cost alerts HTTP endpoints (~30 min)
9. Project create endpoint defaults injection + `apply-cost-defaults.ts` script (~30 min)
10. Manual test all endpoints with curl (~30 min)
11. Commit: `feat(api): trigger idempotency + cost checks + pause endpoints (spec 41 part 2)`

**Session 3: Frontend (~5h)**

1. Polling composables 401-handling + `since` rounding (~30 min)
2. `useProjectPauseState` composable (~30 min)
3. `ProjectPauseBanner` component (~45 min)
4. Mount banner in ProjectDetailPage + ClustersManagementPage (~15 min)
5. Cost dashboard alerts banner (~45 min)
6. Body-edit re-sync UX fix (~15 min)
7. Cold-start phase 2 confirmation card (~1h)
8. Trigger-response error handling in ArticleActionPanel + cold-start phase pages (~45 min)
9. i18n keys de + en (~30 min)
10. End-to-end test: artificially low limit → trigger pipeline → see pause banner → resume (~30 min)
11. Commit: `feat(web): cost enforcement UX + pause banner (spec 41 part 3)`

Total: ~16 hours.

## Splitting Plan

3 sessions with `/clear` between. Session 1 is heavy on core logic — single-shot ideal. Session 2 is per-route grunt work. Session 3 is UX glue.

**Critical:** finish Session 1 before any further pipeline work. Without adapter pre-checks, the system has no real budget protection even if HTTP-layer checks are in place.

## Discovered During Implementation

**Session 1**

- `packages/pipelines` uses a single global queue named `"pipelines"` — not one queue per project. Decision 4 (global pause acceptable for single-tenant) is confirmed. A per-project queue refactor would require changing `QUEUE_NAME` to be dynamic and creating one Queue instance per project at enqueue time.

- `startPipelineWorker()` never called `getPipelineQueue()`, so in a worker-only process the `registerQueuePauser` callback would never fire and `assertCostBudget`'s queue-pause side-effect would silently do nothing (DB row written, queue not paused). Fixed by adding `getPipelineQueue()` call at the top of `startPipelineWorker()`.

- Pre-existing `exactOptionalPropertyTypes` bug in `queue.ts`: `runPipeline` was called with `{ ..., preRunId }` where `preRunId: string | undefined` — TypeScript requires conditional spread when a field is `string | undefined` vs optionally absent. Fixed as a side-effect of this spec.

- The `@marketing-auto/core` package previously had no dependency in `packages/pipelines/package.json`. Added it; run `bun install` after pulling this change.

## Deviations

**Session 1**

- **Queue pauser injection instead of `getQueuesForProject()`**: The spec proposed a `getQueuesForProject(projectId)` helper from `@marketing-auto/pipelines`. This doesn't exist and would create a circular dependency (core → pipelines → core via adapters). Instead, `packages/core/src/cost/pause.ts` exposes `registerQueuePauser(pauseFn, resumeFn)`. `packages/pipelines/src/engine/queue.ts` calls it inside `getPipelineQueue()` and at the top of `startPipelineWorker()`. Behavior is identical; decoupling is maintained.

- **`checkCostBudget` service filter via raw SQL**: The spec shows `eq(costLogs.service, service)`. At runtime `service` is a `string`, but Drizzle's `eq()` against a `pgEnum` column requires the exact enum type. Using `sql\`${costLogs.service} = ${service}\`` avoids a TypeScript error without a dangerous `as` cast. The comment in `enforcement.ts` explains the constraint.
