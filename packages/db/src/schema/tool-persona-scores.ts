/**
 * Spec 65.1 — Tool Persona Scores
 *
 * LLM-cached per-(tool, project, persona) suitability scoring used by the 65.3
 * Persona-Scorer to rank tools for a given persona angle (e.g. "best tools for
 * Beginners" rubric). Composite PK (tool_id, project_id, persona) lets each
 * project keep independent scoring — Toolwiki's "beginners" persona differs
 * structurally from a hypothetical BK Solar-Eigentümer persona.
 *
 * `tool_id` references articles(id) where collection='tools' (app-layer
 * enforced by tool-persona-scores-write.ts). Spec narrative referenced a
 * non-existent `tools` table.
 *
 * Stale-detection: handled by `deleteStalePersonaScores({ olderThanDays })` in
 * the write helper. The spec originally proposed a partial-index
 * `WHERE scored_at < NOW() - INTERVAL '6 months'` but PostgreSQL forbids
 * non-IMMUTABLE functions (NOW() is STABLE) in index WHERE clauses. Pruning
 * is done via a cron-callable helper instead.
 */
import { desc } from "drizzle-orm";
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { articles } from "./content.ts";
import { projects } from "./projects.ts";

export const toolPersonaScores = pgTable(
  "tool_persona_scores",
  {
    toolId: uuid("tool_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),

    /** 0-10 inclusive, validated at SQL CHECK + Zod boundary. */
    score: integer("score").notNull(),
    reasoning: text("reasoning").notNull(),

    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.toolId, t.projectId, t.persona] }),
    /**
     * Per-project "top tools for persona" hot-path. score DESC matches the
     * canonical sort order; tiebreak by scored_at DESC keeps freshest-first.
     */
    personaScoreIdx: index("idx_persona_scores_persona").on(t.projectId, t.persona, desc(t.score)),
    // SQL-level CHECK (score BETWEEN 0 AND 10) lives in migration 0113.
  })
);

export type ToolPersonaScore = typeof toolPersonaScores.$inferSelect;
export type NewToolPersonaScore = typeof toolPersonaScores.$inferInsert;
