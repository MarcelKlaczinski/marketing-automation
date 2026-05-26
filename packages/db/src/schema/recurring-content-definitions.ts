import { sql } from "drizzle-orm";
/**
 * Spec 65.1 — Recurring Content Definitions
 *
 * Per-project rubrics with cron-frequency. Each definition describes ONE
 * recurring social/article rhythm (e.g. "Top 5 LLMs weekly", "Tool of the
 * week"). The 65.5 Brief-Generator + Cron reads `next_run_at <= NOW()` to
 * decide which definitions are due for the next run.
 *
 * Multi-tenancy: project_id NOT NULL (Memory D5). Each project owns its own
 * set of definitions.
 *
 * Lifecycle:
 *   - `is_active = TRUE`  → cron-eligible
 *   - `is_active = FALSE` → soft-disabled, audit-trail preserved
 *
 * Partial unique constraints: none today — multiple definitions per project
 * may share the same format_type (e.g. two weekly "Tool of the week" rubrics
 * with different format_config bodies). The active-cron filter is `next_run_at`-
 * driven, not key-based.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

/**
 * Output target map. Each recurring run can produce an article, a social
 * carousel, or both. Defaults to `{ article: false, social: true }` because
 * the v1 recurring rubrics are all social-first.
 */
export type RecurringOutputTargets = {
  article: boolean;
  social: boolean;
};

/**
 * Template selection strategies for the rendering pipeline:
 *   - 'fixed'     → always use `fixed_template_key`
 *   - 'lru'       → pick the least-recently-used eligible template
 *   - 'llm-picks' → LLM chooses from eligible templates (65.6)
 *   - 'latest'    → use the most-recently-created eligible template
 */
export type TemplateSelectionStrategy = "fixed" | "lru" | "llm-picks" | "latest";

export const recurringContentDefinitions = pgTable(
  "recurring_content_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    formatType: text("format_type").notNull(),
    formatConfig: jsonb("format_config")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),

    /**
     * Cadence — 'weekly' | 'biweekly' | 'monthly' OR a cron expression.
     * Validated at HTTP boundary via `frequencySchema` in
     * @marketing-auto/shared/recurring-content.
     */
    frequency: text("frequency").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),

    outputTargets: jsonb("output_targets")
      .notNull()
      .default(sql`'{"article":false,"social":true}'::jsonb`)
      .$type<RecurringOutputTargets>(),

    templateSelectionStrategy: text("template_selection_strategy")
      .notNull()
      .default("lru")
      .$type<TemplateSelectionStrategy>(),
    fixedTemplateKey: text("fixed_template_key"),

    endSlideStrategy: text("end_slide_strategy").notNull().default("rotation"),
    /** Array of end_slide_definitions IDs eligible for rotation. */
    endSlidePool: jsonb("end_slide_pool").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),

    /**
     * Spec 65.V1.5a Bridge #3 — locales the brief-generator fans out to per
     * fire. Default `["de"]` keeps pre-bridge behaviour (DE-only). Bilingual
     * tenants (Toolwiki) set `["de", "en"]` so each fire emits TWO sibling
     * briefs linked by a shared `runGroupId` UUID inside
     * `recurring_metadata.runGroupId`. Values are 2-letter codes (NOT BCP-47)
     * — Spec 65.5 worker already derives DE/EN from
     * `projects.target_locales[0]` and the 65.4 hook-picker accepts
     * `language: 'de' | 'en'` directly. Migration 0123.
     */
    targetLocales: jsonb("target_locales")
      .notNull()
      .default(sql`'["de"]'::jsonb`)
      .$type<string[]>(),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nextRunActiveIdx: index("idx_recurring_defs_next_run")
      .on(t.nextRunAt)
      .where(sql`${t.isActive} = TRUE`),
    projectIdx: index("idx_recurring_defs_project").on(t.projectId),
    formatTypeActiveIdx: index("idx_recurring_defs_format_type")
      .on(t.formatType)
      .where(sql`${t.isActive} = TRUE`),
  })
);

export type RecurringContentDefinition = typeof recurringContentDefinitions.$inferSelect;
export type NewRecurringContentDefinition = typeof recurringContentDefinitions.$inferInsert;
