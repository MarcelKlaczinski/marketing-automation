import { and, asc, eq } from "drizzle-orm";
import { db } from "../client.ts";
import { projectGoals, type ProjectGoal } from "../schema/operations.ts";

/**
 * Spec 62.2: list all goals for a project. `activeOnly` defaults to true (the common
 * read path — Planner + UI). Pass false to include inactive history (soft-deleted rows).
 */
export async function listProjectGoals(input: {
  projectId: string;
  activeOnly?: boolean;
}): Promise<ProjectGoal[]> {
  const activeOnly = input.activeOnly ?? true;
  const baseFilter = eq(projectGoals.projectId, input.projectId);
  const filter = activeOnly ? and(baseFilter, eq(projectGoals.isActive, true)) : baseFilter;
  return db
    .select()
    .from(projectGoals)
    .where(filter)
    .orderBy(asc(projectGoals.contentType));
}

/** Look up the active goal for one (project, content_type) pair, or null. */
export async function getActiveProjectGoal(input: {
  projectId: string;
  contentType: string;
}): Promise<ProjectGoal | null> {
  const rows = await db
    .select()
    .from(projectGoals)
    .where(
      and(
        eq(projectGoals.projectId, input.projectId),
        eq(projectGoals.contentType, input.contentType),
        eq(projectGoals.isActive, true)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
