// Spec 62.4: enqueue helper for PlanWeekPipeline.
//
// Mirrors the article-trigger helpers' PreRunInput pattern. The route
// constructs the input shape, this wrapper forwards it to the queue with
// a deterministic jobId so duplicate POST /generate calls dedupe.
//
// Spec 62.6.1: optionally forwards `runMode: "debug"` so the runner pauses
// after every pausable step for UI-driven inspection.

import { enqueuePipeline } from "../engine/queue.ts";
import type { PlanWeekPipelineInput } from "./types.ts";

export interface EnqueuePlanWeekInput extends PlanWeekPipelineInput {
  preRunId: string;
  /** When 'debug', runner pauses after every pausable step (Spec 62.6.1). */
  runMode?: "production" | "debug";
}

export async function enqueuePlanWeekPipeline(
  input: EnqueuePlanWeekInput
): Promise<{ jobId: string }> {
  const { preRunId, runMode, ...pipelineInput } = input;
  // Idempotency lives in the DB (`triggerWithPreRunId` checks for an active
  // `pipeline_runs` row with status IN ('queued','running') for the same
  // pipeline+uniqueKey before enqueuing). The BullMQ jobId only needs to be
  // unique per enqueue — using `preRunId` (a fresh UUID per call) guarantees
  // that. The prior static jobId `plan-week-${projectId}-${year}-${week}`
  // collided with BullMQ's completed-job dedup on repeat triggers for the
  // same week, silently dropping the second job (Memory D131).
  const { jobId } = await enqueuePipeline({
    pipelineName: "planning:weekly",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId,
    ...(runMode !== undefined ? { runMode } : {}),
    jobOptions: {
      jobId: `plan-week-${input.targetYear}-${input.targetIsoWeek}-${preRunId}`,
    },
  });
  return { jobId };
}
