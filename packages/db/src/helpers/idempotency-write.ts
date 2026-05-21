import { and, eq, inArray } from "drizzle-orm";
import { db } from "../client.ts";
import { type NewIdempotencyOutput, idempotencyOutputs } from "../schema/operations.ts";

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

/**
 * Spec 62.6 §6.8: invalidate idempotency-cache entries for a set of steps in one
 * pipeline at one project. Used by rerun cleanup so the re-executed step does NOT
 * pick up its own cached output and instead recomputes fresh. Returns the number
 * of rows deleted (across all idempotency_keys that existed for those steps).
 */
export async function deleteIdempotencyForSteps(args: {
  projectId: string;
  pipelineName: string;
  stepNames: string[];
}): Promise<number> {
  if (args.stepNames.length === 0) return 0;
  const rows = await db
    .delete(idempotencyOutputs)
    .where(
      and(
        eq(idempotencyOutputs.projectId, args.projectId),
        eq(idempotencyOutputs.pipelineName, args.pipelineName),
        inArray(idempotencyOutputs.stepName, args.stepNames)
      )
    )
    .returning({ idempotencyKey: idempotencyOutputs.idempotencyKey });
  return rows.length;
}
