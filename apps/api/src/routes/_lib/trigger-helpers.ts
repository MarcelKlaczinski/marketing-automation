import { randomUUID } from "node:crypto";
import {
  checkCostBudget,
  estimateCostEur,
  getPauseInfo,
  isProjectPaused,
} from "@marketing-auto/core";
import { db, pipelineRuns } from "@marketing-auto/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";

export interface TriggerOptions {
  pipelineName: string;
  projectId: string;
  /** For idempotency: field name + value used to detect an already-active run */
  uniqueKey: { field: string; value: string };
  /**
   * Optional cost pre-flight. Two forms:
   *   - { service, operation, multiplier? } — looks up estimate from COST_OPS table
   *   - { service, estimatedCostEur }       — uses a raw EUR value (e.g. multi-call sum)
   */
  costEstimate?:
    | { service: string; operation: string; multiplier?: number }
    | { service: string; estimatedCostEur: number };
  /** Enqueue the actual BullMQ job; receives the full input payload including preRunId */
  // biome-ignore lint/suspicious/noExplicitAny: Function contravariance — enqueue fns like enqueueArticleOutlinePipeline require concrete input types (e.g. PreRunInput with articleId) that are structurally incompatible with the generic Record payload at the type level.
  // biome-ignore lint/complexity/noBannedTypes: same reason
  enqueue: (input: any) => Promise<{ jobId: string }>;
  /** Additional fields merged into pipeline_runs.input and the enqueue payload */
  extraInput?: Record<string, unknown>;
  /**
   * Spec 62.6.1: optional run-mode override. When set to `"debug"`, the helper
   * forwards `runMode: "debug"` to the `enqueue` callback via `inputPayload`.
   * The enqueue wrapper must read it and forward to `enqueuePipeline`. Default
   * (omitted) is production-mode execution.
   */
  runMode?: "production" | "debug";
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
    const estimated =
      "estimatedCostEur" in opts.costEstimate
        ? opts.costEstimate.estimatedCostEur
        : estimateCostEur(
            opts.costEstimate.service,
            opts.costEstimate.operation,
            opts.costEstimate.multiplier ?? 1
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
        inArray(pipelineRuns.status, activeStatuses)
      )
    )
    .limit(1);

  const firstExisting = existing[0];
  if (firstExisting !== undefined) {
    return { runId: firstExisting.id, jobId: firstExisting.jobId ?? "", deduped: true };
  }

  // Step 4: pre-INSERT pipeline_runs row + enqueue
  const preRunId = randomUUID();
  const inputPayload: Record<string, unknown> = {
    preRunId,
    projectId: opts.projectId,
    [opts.uniqueKey.field]: opts.uniqueKey.value,
    ...(opts.extraInput ?? {}),
    // Spec 62.6.1: forward runMode if the route passed one. Pipeline-specific
    // enqueue wrappers (e.g. enqueuePlanWeekPipeline) read this field off the
    // payload and forward it to enqueuePipeline so the runner picks it up.
    ...(opts.runMode !== undefined ? { runMode: opts.runMode } : {}),
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
  costEstimate?:
    | { service: string; operation: string; multiplier?: number }
    | { service: string; estimatedCostEur: number };
}): Promise<Exclude<TriggerResult, { deduped: false }> | null> {
  if (await isProjectPaused(opts.projectId)) {
    const info = await getPauseInfo(opts.projectId);
    return { error: "project_paused", pauseInfo: info };
  }

  if (opts.costEstimate) {
    const estimated =
      "estimatedCostEur" in opts.costEstimate
        ? opts.costEstimate.estimatedCostEur
        : estimateCostEur(
            opts.costEstimate.service,
            opts.costEstimate.operation,
            opts.costEstimate.multiplier ?? 1
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
        inArray(pipelineRuns.status, activeStatuses)
      )
    )
    .limit(1);

  const firstFound = existing[0];
  if (firstFound !== undefined) {
    return { runId: firstFound.id, jobId: firstFound.jobId ?? "", deduped: true };
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
  // Error branches are already handled above; result is safely the success union here
  return c.json({ ok: true, data: result }, (result as { deduped: boolean }).deduped ? 200 : 202);
}

/** Converts a guard-only check error to an HTTP response */
export function guardErrorToResponse(
  c: Context,
  blocked: Exclude<TriggerResult, { deduped: false }>
): Response {
  return triggerResultToResponse(c, blocked);
}
