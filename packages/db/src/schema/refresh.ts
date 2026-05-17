import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { articles } from "./content.ts";
import { projects } from "./projects.ts";

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
