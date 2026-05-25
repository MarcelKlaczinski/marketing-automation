/**
 * Spec 65.1 — tool_persona_scores write helpers.
 */
import { eq, lt } from "drizzle-orm";
import { db } from "../client.ts";
import { articles } from "../schema/content.ts";
import {
  type NewToolPersonaScore,
  type ToolPersonaScore,
  toolPersonaScores,
} from "../schema/tool-persona-scores.ts";

/**
 * Spec 65.1 — guard. tool_id must reference an article with collection='tools'.
 * Mirrors tool-brand-assets-write.ts; throws on mismatch.
 */
async function assertArticleIsTool(toolId: string): Promise<void> {
  const rows = await db
    .select({ collection: articles.collection })
    .from(articles)
    .where(eq(articles.id, toolId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      `tool_persona_scores: article ${toolId} not found (tool_id must reference an existing tool-article)`
    );
  }
  if (row.collection !== "tools") {
    throw new Error(
      `tool_persona_scores: article ${toolId} has collection='${row.collection}', expected 'tools'`
    );
  }
}

/**
 * UPSERT a score for (tool, project, persona). Composite PK is the conflict
 * target so re-scoring the same triple replaces the prior row in place.
 * Stamps `scored_at = NOW()` on every write so freshness ordering stays
 * meaningful.
 */
export async function upsertPersonaScore(input: NewToolPersonaScore): Promise<ToolPersonaScore> {
  await assertArticleIsTool(input.toolId);

  const rows = await db
    .insert(toolPersonaScores)
    .values(input)
    .onConflictDoUpdate({
      target: [toolPersonaScores.toolId, toolPersonaScores.projectId, toolPersonaScores.persona],
      set: {
        score: input.score,
        reasoning: input.reasoning,
        scoredAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertPersonaScore: UPSERT returned no row");
  return row;
}

/**
 * Cron-callable: delete scores older than `olderThanDays`. Returns the count
 * deleted. Used by the 65.3 stale-score-prune cron (currently unwired; helper
 * is in place so 65.3 can call it without schema change).
 *
 * Cutoff computed in application layer (PostgreSQL CHECK predicates forbid
 * NOW(); the spec's hypothetical partial index was therefore moot, see
 * tool-persona-scores.ts header for the deviation note).
 */
export async function deleteStalePersonaScores(opts: {
  olderThanDays: number;
}): Promise<number> {
  if (opts.olderThanDays <= 0) {
    throw new Error("deleteStalePersonaScores: olderThanDays must be > 0");
  }
  const cutoff = new Date(Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .delete(toolPersonaScores)
    .where(lt(toolPersonaScores.scoredAt, cutoff))
    .returning({ toolId: toolPersonaScores.toolId });
  return rows.length;
}
