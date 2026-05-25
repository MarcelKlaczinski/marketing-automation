/**
 * Spec 65.1 — tool_persona_scores read helpers.
 */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../client.ts";
import { type ToolPersonaScore, toolPersonaScores } from "../schema/tool-persona-scores.ts";

export async function getPersonaScore(input: {
  toolId: string;
  projectId: string;
  persona: string;
}): Promise<ToolPersonaScore | null> {
  const rows = await db
    .select()
    .from(toolPersonaScores)
    .where(
      and(
        eq(toolPersonaScores.toolId, input.toolId),
        eq(toolPersonaScores.projectId, input.projectId),
        eq(toolPersonaScores.persona, input.persona)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listPersonaScoresForTool(input: {
  toolId: string;
  projectId: string;
}): Promise<ToolPersonaScore[]> {
  return await db
    .select()
    .from(toolPersonaScores)
    .where(
      and(
        eq(toolPersonaScores.toolId, input.toolId),
        eq(toolPersonaScores.projectId, input.projectId)
      )
    )
    .orderBy(asc(toolPersonaScores.persona));
}

/**
 * Hot-path for the 65.3 Brief-Generator: "top N tools for persona X in
 * project Y, score >= threshold". Uses the (projectId, persona, score DESC)
 * index. Tiebreak by `scored_at DESC` so freshly-scored tools beat stale
 * ties; then by tool_id for stable order.
 */
export async function listTopToolsForPersona(input: {
  projectId: string;
  persona: string;
  minScore?: number;
  limit?: number;
}): Promise<ToolPersonaScore[]> {
  const minScore = input.minScore ?? 5;
  const limit = input.limit ?? 10;
  return await db
    .select()
    .from(toolPersonaScores)
    .where(
      and(
        eq(toolPersonaScores.projectId, input.projectId),
        eq(toolPersonaScores.persona, input.persona),
        gte(toolPersonaScores.score, minScore)
      )
    )
    .orderBy(
      desc(toolPersonaScores.score),
      desc(toolPersonaScores.scoredAt),
      asc(toolPersonaScores.toolId)
    )
    .limit(limit);
}

/**
 * "Which tools in the given toolIds list have NO score for this persona/project?"
 * Drives the 65.3 backfill backlog — the worker hits this to find work.
 *
 * Returns an empty list when `toolIds` is empty (Drizzle's `inArray` rejects
 * empty arrays). Same defensive guard pattern used elsewhere in this package.
 */
export async function listToolsMissingPersonaScores(input: {
  projectId: string;
  persona: string;
  toolIds: string[];
}): Promise<string[]> {
  if (input.toolIds.length === 0) return [];
  // SELECT scored tools first, then subtract from the input set in JS — avoids
  // a NOT IN subquery that PostgreSQL handles poorly with large input sets.
  const scoredRows = await db
    .select({ toolId: toolPersonaScores.toolId })
    .from(toolPersonaScores)
    .where(
      and(
        eq(toolPersonaScores.projectId, input.projectId),
        eq(toolPersonaScores.persona, input.persona),
        inArray(toolPersonaScores.toolId, input.toolIds)
      )
    );
  const scoredSet = new Set(scoredRows.map((r) => r.toolId));
  return input.toolIds.filter((id) => !scoredSet.has(id));
}
