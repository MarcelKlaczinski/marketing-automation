import { and, eq, isNull } from "drizzle-orm";
import { db } from "../client.ts";
import { promptVersions, type PromptVersion } from "../schema/operations.ts";

export interface PromoteToGoldenInput {
  stepName: string;
  /** null = global golden, string = project-specific. */
  projectId: string | null;
  body: string;
  sourcePauseId: string | null;
  promoteNote: string | null;
  createdBy: string;
}

/**
 * Spec 62.0b: persist a new golden in two steps inside one transaction.
 * 1. Mark every existing golden for the same (step, project) as superseded.
 * 2. Insert the new row with `is_golden = true`.
 *
 * The partial unique index `prompt_versions_one_golden_per_step` is the race-condition
 * safety net: if two callers promote the same (step, project) concurrently the second
 * INSERT raises a unique-constraint error and its transaction aborts cleanly.
 *
 * Cache invalidation is the caller's responsibility (outside the transaction) so the
 * helper is reusable from scripts that don't have access to the in-process cache.
 */
export async function promoteToGolden(input: PromoteToGoldenInput): Promise<PromptVersion> {
  return db.transaction(async (tx) => {
    await tx
      .update(promptVersions)
      .set({ isGolden: false, supersededAt: new Date() })
      .where(
        and(
          eq(promptVersions.stepName, input.stepName),
          input.projectId === null
            ? isNull(promptVersions.projectId)
            : eq(promptVersions.projectId, input.projectId),
          eq(promptVersions.isGolden, true)
        )
      );

    const rows = await tx
      .insert(promptVersions)
      .values({
        stepName: input.stepName,
        projectId: input.projectId,
        body: input.body,
        sourcePauseId: input.sourcePauseId,
        isGolden: true,
        createdBy: input.createdBy,
        promoteNote: input.promoteNote,
      })
      .returning();

    if (!rows[0]) throw new Error("promoteToGolden: INSERT returned no row");
    return rows[0];
  });
}
