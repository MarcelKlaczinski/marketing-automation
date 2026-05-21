import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import { projectPlannerConfig, type ProjectPlannerConfig } from "../schema/operations.ts";

/**
 * Spec 62.2: load the singleton planner-config row for a project, or null if not set.
 * Callers that need the row to exist (validator, planner) should treat null as
 * "NO_PLANNER_CONFIG" — never seed silently.
 */
export async function getProjectPlannerConfig(
  projectId: string
): Promise<ProjectPlannerConfig | null> {
  const rows = await db
    .select()
    .from(projectPlannerConfig)
    .where(eq(projectPlannerConfig.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}
