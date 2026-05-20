import { db } from "../client.ts";
import { idempotencyOutputs, type NewIdempotencyOutput } from "../schema/operations.ts";

export interface WriteIdempotencyInput {
  idempotencyKey: string;
  pipelineName: string;
  stepName: string;
  projectId: string;
  stepOutput: Record<string, unknown>;
  costEur?: number;
  expiresAt?: Date;
}

/**
 * Insert a cache entry. ON CONFLICT DO NOTHING — the first writer wins; subsequent
 * runs with the same idempotency key are a benign no-op (the prior row is the source
 * of truth and the runner cache-check hits it).
 *
 * Pattern (bewährt aus refresh-detector): no upsert, no race-handling — concurrent
 * writers compute the same output, so losing the race is harmless.
 */
export async function writeIdempotencyOutput(input: WriteIdempotencyInput): Promise<void> {
  const values: NewIdempotencyOutput = {
    idempotencyKey: input.idempotencyKey,
    pipelineName: input.pipelineName,
    stepName: input.stepName,
    projectId: input.projectId,
    stepOutput: input.stepOutput,
    costEur: input.costEur !== undefined ? String(input.costEur) : "0",
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
  await db.insert(idempotencyOutputs).values(values).onConflictDoNothing();
}
