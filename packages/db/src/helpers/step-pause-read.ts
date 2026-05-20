import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../client.ts";
import { stepPauses, type StepPause } from "../schema/operations.ts";

/**
 * Find an unresolved pause by id. Returns null if resolved or not found.
 */
export async function getActiveStepPause(stepPauseId: string): Promise<StepPause | null> {
  const rows = await db
    .select()
    .from(stepPauses)
    .where(and(eq(stepPauses.id, stepPauseId), isNull(stepPauses.resolvedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Load a pause by id regardless of resolved state. Used when reconstructing
 * resume payloads after a successful resolve UPDATE.
 */
export async function getStepPauseById(stepPauseId: string): Promise<StepPause | null> {
  const rows = await db.select().from(stepPauses).where(eq(stepPauses.id, stepPauseId)).limit(1);
  return rows[0] ?? null;
}

/**
 * All pauses (resolved + unresolved) for one pipeline run, newest first.
 */
export async function listStepPausesForRun(pipelineRunId: string): Promise<StepPause[]> {
  return db
    .select()
    .from(stepPauses)
    .where(eq(stepPauses.pipelineRunId, pipelineRunId))
    .orderBy(desc(stepPauses.requestedAt));
}

/**
 * Unresolved pauses for a project, newest first.
 * Backs the Cmd+K "Show paused runs" view (62.0a stub; 62.6 fully wires UI).
 */
export async function listUnresolvedStepPausesForProject(
  projectId: string
): Promise<StepPause[]> {
  return db
    .select()
    .from(stepPauses)
    .where(and(eq(stepPauses.projectId, projectId), isNull(stepPauses.resolvedAt)))
    .orderBy(desc(stepPauses.requestedAt));
}
