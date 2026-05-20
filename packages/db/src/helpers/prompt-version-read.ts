import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../client.ts";
import { promptVersions, type PromptVersion } from "../schema/operations.ts";

/**
 * Spec 62.0b: look up the active golden prompt for a (step, project) pair.
 * `projectId === null` selects the global golden; otherwise the project-specific one.
 * Returns null when no golden is set — caller falls back to the next resolver tier.
 */
export async function getGoldenPrompt(input: {
  stepName: string;
  projectId: string | null;
}): Promise<PromptVersion | null> {
  const rows = await db
    .select()
    .from(promptVersions)
    .where(
      and(
        eq(promptVersions.stepName, input.stepName),
        eq(promptVersions.isGolden, true),
        input.projectId === null
          ? isNull(promptVersions.projectId)
          : eq(promptVersions.projectId, input.projectId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * All prompt versions (golden + superseded) for a project, newest first.
 * Optional stepName filter narrows to a single step's history.
 * Used by GET /projects/:slug/prompt-versions.
 */
export async function listPromptVersionsForProject(input: {
  projectId: string;
  stepName?: string;
}): Promise<PromptVersion[]> {
  const stepFilter = input.stepName ? eq(promptVersions.stepName, input.stepName) : undefined;
  const projectFilter = eq(promptVersions.projectId, input.projectId);
  return db
    .select()
    .from(promptVersions)
    .where(stepFilter ? and(projectFilter, stepFilter) : projectFilter)
    .orderBy(desc(promptVersions.createdAt));
}
