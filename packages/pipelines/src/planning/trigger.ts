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
  input: EnqueuePlanWeekInput,
): Promise<{ jobId: string }> {
  const { preRunId, runMode, ...pipelineInput } = input;
  // Debug runs need a unique jobId per attempt so BullMQ doesn't dedupe a
  // re-trigger against a stale debug run. Production keeps the stable jobId
  // (deterministic so duplicate POST /generate calls dedupe at the queue level).
  const jobIdSuffix = runMode === "debug" ? `-debug-${Date.now()}` : "";
  const { jobId } = await enqueuePipeline({
    pipelineName: "planning:weekly",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId,
    ...(runMode !== undefined ? { runMode } : {}),
    jobOptions: {
      jobId: `plan-week-${input.projectId}-${input.targetYear}-${input.targetIsoWeek}${jobIdSuffix}`,
    },
  });
  return { jobId };
}
