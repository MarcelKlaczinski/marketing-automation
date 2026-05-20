import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import {
  stepOptimizationRequests,
  type StepOptimizationRequest,
} from "../schema/operations.ts";
import type { OptimizationRequestStatus } from "./step-optimization-request-read.ts";

export interface CreateOptimizationRequestInput {
  stepPauseId: string;
  stepName: string;
  pipelineName: string;
  projectId: string;
  /** Frozen snapshot, copied from the step_pauses row at request time. */
  stepInput: Record<string, unknown>;
  stepOutput: Record<string, unknown>;
  promptUsed: string | null;
  userNote: string;
  requestedBy: string;
}

export async function createOptimizationRequest(
  input: CreateOptimizationRequestInput
): Promise<StepOptimizationRequest> {
  const rows = await db
    .insert(stepOptimizationRequests)
    .values({
      stepPauseId: input.stepPauseId,
      stepName: input.stepName,
      pipelineName: input.pipelineName,
      projectId: input.projectId,
      stepInput: input.stepInput,
      stepOutput: input.stepOutput,
      promptUsed: input.promptUsed,
      userNote: input.userNote,
      requestedBy: input.requestedBy,
    })
    .returning();
  if (!rows[0]) throw new Error("createOptimizationRequest: INSERT returned no row");
  return rows[0];
}

export interface UpdateOptimizationRequestStatusInput {
  id: string;
  status: Exclude<OptimizationRequestStatus, "open">;
  addressedNote?: string;
}

/**
 * Update lifecycle status. addressed_at is set when transitioning out of 'open'.
 * Returns null when the row does not exist.
 */
export async function updateOptimizationRequestStatus(
  input: UpdateOptimizationRequestStatusInput
): Promise<StepOptimizationRequest | null> {
  const rows = await db
    .update(stepOptimizationRequests)
    .set({
      status: input.status,
      addressedAt: new Date(),
      addressedNote: input.addressedNote ?? null,
    })
    .where(eq(stepOptimizationRequests.id, input.id))
    .returning();
  return rows[0] ?? null;
}
