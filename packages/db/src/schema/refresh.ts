import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { articles } from "./content.ts";
import { projects } from "./projects.ts";
import { refreshSuggestionSourceEnum } from "./_enums.ts";

export const refreshDismissed = pgTable(
  "refresh_dismissed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedBy: text("dismissed_by").notNull().default("system"),
    reason: text("reason"),
  },
  (t) => ({
    projectArticleUnique: unique("refresh_dismissed_project_article_unique").on(
      t.projectId,
      t.articleId
    ),
    projectIdx: index("refresh_dismissed_project_idx").on(t.projectId),
    articleIdx: index("refresh_dismissed_article_idx").on(t.articleId),
  })
);

export type RefreshDismissed = typeof refreshDismissed.$inferSelect;
export type NewRefreshDismissed = typeof refreshDismissed.$inferInsert;

// ─── refresh_suggestions ──────────────────────────────────────────────────────

export type QualityFindings = {
  outdatedClaims: Array<{ snippet: string; reason: string }>;
  missingCoverage: string[];
  staleReferences: Array<{ entity: string; note: string }>;
  overallRecommendation: "refresh-now" | "refresh-soon" | "no-action";
  confidence: "high" | "medium" | "low";
};

export const refreshSuggestions = pgTable(
  "refresh_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    source: refreshSuggestionSourceEnum("source").notNull(),
    reasoning: text("reasoning"),
    stalenessDays: integer("staleness_days"),
    qualityFindings: jsonb("quality_findings").$type<QualityFindings | null>().default(null),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedRunId: uuid("approved_run_id"),
  },
  (t) => ({
    articleSourceUnique: unique("refresh_suggestions_article_source").on(t.articleId, t.source),
    activeIdx: index("refresh_suggestions_active_idx")
      .on(t.articleId)
      .where(sql`dismissed_at IS NULL AND approved_at IS NULL`),
    articleIdx: index("refresh_suggestions_article_idx").on(t.articleId),
    projectIdx: index("refresh_suggestions_project_idx").on(t.projectId),
  })
);

export type RefreshSuggestion = typeof refreshSuggestions.$inferSelect;
export type NewRefreshSuggestion = typeof refreshSuggestions.$inferInsert;
