// Spec 62.4: enqueue helper for PlanWeekPipeline.
//
// Mirrors the article-trigger helpers' PreRunInput pattern. The route
// constructs the input shape, this wrapper forwards it to the queue with
// a deterministic jobId so duplicate POST /generate calls dedupe.

import { enqueuePipeline } from "../engine/queue.ts";
import type { PlanWeekPipelineInput } from "./types.ts";

export interface EnqueuePlanWeekInput extends PlanWeekPipelineInput {
  preRunId: string;
}

export async function enqueuePlanWeekPipeline(
  input: EnqueuePlanWeekInput,
): Promise<{ jobId: string }> {
  const { preRunId, ...pipelineInput } = input;
  const { jobId } = await enqueuePipeline({
    pipelineName: "planning:weekly",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId,
    jobOptions: {
      jobId: `plan-week-${input.projectId}-${input.targetYear}-${input.targetIsoWeek}`,
    },
  });
  return { jobId };
}
