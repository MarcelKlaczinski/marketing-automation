import { eq, and, sql, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { db, pipelineRuns } from "@marketing-auto/db";
import {
  checkCostBudget,
  estimateCostEur,
  isProjectPaused,
  getPauseInfo,
} from "@marketing-auto/core";

export interface TriggerOptions {
  pipelineName: string;
  projectId: string;
  /** For idempotency: field name + value used to detect an already-active run */
  uniqueKey: { field: string; value: string };
  /** Optional cost pre-flight */
  costEstimate?: { service: string; operation: string; multiplier?: number };
  /** Enqueue the actual BullMQ job; receives the full input payload including preRunId */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enqueue: (input: any) => Promise<{ jobId: string }>;
  /** Additional fields merged into pipeline_runs.input and the enqueue payload */
  extraInput?: Record<string, unknown>;
}

export type TriggerResult =
  | { runId: string; jobId: string; deduped: false }
  | { runId: string; jobId: string; deduped: true }
  | { error: "project_paused"; pauseInfo: unknown }
  | { error: "cost_limit_exceeded"; details: unknown };

/**
 * Canonical pre-RunId trigger helper with three guards:
 * 1. Project-pause check → returns error:'project_paused'
 * 2. Cost-budget pre-flight → returns error:'cost_limit_exceeded'
 * 3. Idempotency — returns deduped:true with existing runId if same pipeline+uniqueKey is active
 */
export async function triggerWithPreRunId(opts: TriggerOptions): Promise<TriggerResult> {
  // Step 1: project-pause guard
  if (await isProjectPaused(opts.projectId)) {
    const info = await getPauseInfo(opts.projectId);
    return { error: "project_paused", pauseInfo: info };
  }

  // Step 2: cost pre-flight
  if (opts.costEstimate) {
    const estimated = estimateCostEur(
      opts.costEstimate.service,
      opts.costEstimate.operation,
      opts.costEstimate.multiplier ?? 1,
    );
    const result = await checkCostBudget(opts.projectId, opts.costEstimate.service, estimated);
    if (!result.ok) {
      return { error: "cost_limit_exceeded", details: result };
    }
  }

  // Step 3: idempotency — find active run for same pipeline + uniqueKey
  const activeStatuses: Array<"queued" | "running"> = ["queued", "running"];
  const existing = await db
    .select({ id: pipelineRuns.id, jobId: pipelineRuns.jobId })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.pipelineName, opts.pipelineName),
        eq(pipelineRuns.projectId, opts.projectId),
        sql`${pipelineRuns.input}->>${opts.uniqueKey.field} = ${opts.uniqueKey.value}`,
        inArray(pipelineRuns.status, activeStatuses),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const found = existing[0]!;
    return { runId: found.id, jobId: found.jobId ?? "", deduped: true };
  }

  // Step 4: pre-INSERT pipeline_runs row + enqueue
  const preRunId = randomUUID();
  const inputPayload: Record<string, unknown> = {
    preRunId,
    projectId: opts.projectId,
    [opts.uniqueKey.field]: opts.uniqueKey.value,
    ...(opts.extraInput ?? {}),
  };

  await db.insert(pipelineRuns).values({
    id: preRunId,
    pipelineName: opts.pipelineName,
    projectId: opts.projectId,
    status: "queued",
    input: inputPayload,
  });

  const { jobId } = await opts.enqueue(inputPayload);

  await db.update(pipelineRuns).set({ jobId }).where(eq(pipelineRuns.id, preRunId));

  return { runId: preRunId, jobId, deduped: false };
}

/**
 * Lighter guard for enqueue functions that manage their own pipeline_runs row (e.g. cold-start).
 * Checks pause + cost + idempotency. Returns an error result if blocked, or null if allowed.
 * Caller is responsible for doing the actual enqueue when null is returned.
 */
export async function checkTriggerAllowed(opts: {
  pipelineName: string;
  projectId: string;
  uniqueKey: { field: string; value: string };
  costEstimate?: { service: string; operation: string; multiplier?: number };
}): Promise<Exclude<TriggerResult, { deduped: false }> | null> {
  if (await isProjectPaused(opts.projectId)) {
    const info = await getPauseInfo(opts.projectId);
    return { error: "project_paused", pauseInfo: info };
  }

  if (opts.costEstimate) {
    const estimated = estimateCostEur(
      opts.costEstimate.service,
      opts.costEstimate.operation,
      opts.costEstimate.multiplier ?? 1,
    );
    const result = await checkCostBudget(opts.projectId, opts.costEstimate.service, estimated);
    if (!result.ok) {
      return { error: "cost_limit_exceeded", details: result };
    }
  }

  const activeStatuses: Array<"queued" | "running"> = ["queued", "running"];
  const existing = await db
    .select({ id: pipelineRuns.id, jobId: pipelineRuns.jobId })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.pipelineName, opts.pipelineName),
        eq(pipelineRuns.projectId, opts.projectId),
        sql`${pipelineRuns.input}->>${opts.uniqueKey.field} = ${opts.uniqueKey.value}`,
        inArray(pipelineRuns.status, activeStatuses),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const found = existing[0]!;
    return { runId: found.id, jobId: found.jobId ?? "", deduped: true };
  }

  return null;
}

/** Converts a TriggerResult to the appropriate Hono HTTP response */
export function triggerResultToResponse(c: Context, result: TriggerResult): Response {
  if ("error" in result) {
    if (result.error === "project_paused") {
      return c.json({ ok: false, error: "project_paused", data: result.pauseInfo }, 423);
    }
    if (result.error === "cost_limit_exceeded") {
      return c.json({ ok: false, error: "cost_limit_exceeded", data: result.details }, 402);
    }
  }
  return c.json(
    { ok: true, data: result },
    (result as { deduped: boolean }).deduped ? 200 : 202,
  );
}

/** Converts a guard-only check error to an HTTP response */
export function guardErrorToResponse(c: Context, blocked: Exclude<TriggerResult, { deduped: false }>): Response {
  return triggerResultToResponse(c, blocked);
}
