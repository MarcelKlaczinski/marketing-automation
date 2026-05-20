import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../client.ts";
import { idempotencyOutputs, type IdempotencyOutput } from "../schema/operations.ts";

export interface IdempotencyLookupKey {
  idempotencyKey: string;
  pipelineName: string;
  stepName: string;
  projectId: string;
}

/**
 * Returns a cached step output if the (key, pipeline, step, project) hits and the
 * row has not expired. Rows with NULL expires_at are treated as no-expiry.
 */
export async function getIdempotencyOutput(
  key: IdempotencyLookupKey
): Promise<IdempotencyOutput | null> {
  const rows = await db
    .select()
    .from(idempotencyOutputs)
    .where(
      and(
        eq(idempotencyOutputs.idempotencyKey, key.idempotencyKey),
        eq(idempotencyOutputs.pipelineName, key.pipelineName),
        eq(idempotencyOutputs.stepName, key.stepName),
        eq(idempotencyOutputs.projectId, key.projectId),
        or(
          isNull(idempotencyOutputs.expiresAt),
          gt(idempotencyOutputs.expiresAt, sql`now()`)
        )
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
