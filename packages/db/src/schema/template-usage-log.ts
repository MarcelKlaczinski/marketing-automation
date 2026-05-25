/**
 * Spec 65.1 — Template Usage Log
 *
 * Append-only log of which template+end_slide combinations the 65.6 renderer
 * picked per recurring-content run. Drives the LRU template-rotation strategy
 * — the picker reads the last N entries to know which templates were used
 * most recently and skips them in favor of less-used ones.
 *
 * Capped at 50 entries per definition by the daily auto-prune cron at
 * apps/api/src/workers/template-usage-log-prune.cron.ts (Marcel-Decision Q3).
 *
 * Inherits project scope transitively via recurring_content_definitions FK
 * (Memory D5 transitive multi-tenant chain). On ON DELETE CASCADE — removing
 * a definition drops its usage history.
 */
import { desc } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { recurringContentDefinitions } from "./recurring-content-definitions.ts";

export const templateUsageLog = pgTable(
  "template_usage_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recurringDefinitionId: uuid("recurring_definition_id")
      .notNull()
      .references(() => recurringContentDefinitions.id, { onDelete: "cascade" }),

    templateKey: text("template_key").notNull(),
    /** Which end-slide variant was rendered alongside this template. NULL if no end-slide. */
    endSlideType: text("end_slide_type"),

    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * (definition_id, used_at DESC) — LRU picker reads the recent slice via
     * `WHERE recurring_definition_id = X ORDER BY used_at DESC LIMIT N` and
     * the prune helper reads the same shape with a different LIMIT.
     */
    defTimeIdx: index("idx_template_usage_def_time").on(t.recurringDefinitionId, desc(t.usedAt)),
  })
);

export type TemplateUsageLog = typeof templateUsageLog.$inferSelect;
export type NewTemplateUsageLog = typeof templateUsageLog.$inferInsert;
