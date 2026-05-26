/**
 * Spec 65.3 — Persona-score invalidation on material tool-data change.
 *
 * Called from the tool-data-refresh worker when an `applyToolDataChanges()`
 * tick detects a material change for a tool (pricing-tier added/removed,
 * free-tier flip, major feature added/removed, etc.). Deletes ALL persona
 * scores for that tool across ALL projects (Marcel-Decision §10 — material
 * tool-changes affect comparison content in every tenant; cascading
 * invalidation across projects is correct behaviour).
 *
 * The next brief-generator call that needs a score for this tool will
 * lazy-trigger `scoreToolForPersonas` via `pickPersonaScoredTools` and
 * write fresh scores.
 */
import { db, eq, toolPersonaScores } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("persona-scoring:invalidate");

export interface InvalidatePersonaScoresInput {
  toolId: string;
  /** Reason string for the audit log (e.g. "pricing-tier added"). */
  reason: string;
}

export interface InvalidatePersonaScoresResult {
  deletedCount: number;
  toolId: string;
  reason: string;
}

/**
 * Delete every persona-score row for `toolId` across all projects. Returns
 * the count of rows deleted. Returns `{ deletedCount: 0 }` when no scores
 * existed (e.g. fresh tool that was never scored — still safe to call from
 * the refresh worker).
 */
export async function invalidatePersonaScoresForTool(
  input: InvalidatePersonaScoresInput
): Promise<InvalidatePersonaScoresResult> {
  const rows = await db
    .delete(toolPersonaScores)
    .where(eq(toolPersonaScores.toolId, input.toolId))
    .returning({ toolId: toolPersonaScores.toolId, projectId: toolPersonaScores.projectId });

  if (rows.length > 0) {
    const projectIds = new Set(rows.map((r) => r.projectId));
    log.info(
      {
        toolId: input.toolId,
        deletedCount: rows.length,
        projectCount: projectIds.size,
        reason: input.reason,
      },
      "Persona-scores invalidated for tool (material data change)"
    );
  }

  return { deletedCount: rows.length, toolId: input.toolId, reason: input.reason };
}
