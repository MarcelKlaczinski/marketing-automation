/**
 * Spec 65.1 — Hook Templates (Family B Hook Library)
 *
 * Reusable hook patterns with `{variable}` placeholders that the 65.4 Hook-
 * Picker fills with run-specific values. Example:
 *
 *   pattern   = "I lost my {profession} job because of {tool}"
 *   variables = ["profession", "tool"]
 *
 * LRU + usage tracking lets the picker rotate hooks instead of always picking
 * the same one. Project-scoped (Memory D5) so each tenant maintains its own
 * voice/tone library.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

export type HookTemplateLanguage = "de" | "en";

/**
 * Spec 65.14 — drama-intensity classification for the SEO/Social mode-switch.
 *
 *   - `subtle`     SEO-safe, complies with Spec 64.16 drama-ban. Default for
 *                  the 60 generic hooks seeded by migration 0116 and for any
 *                  new INSERT without an explicit value.
 *   - `moderate`   Mild drama (number-driven, year-anchor patterns).
 *   - `aggressive` Full drama (contrarian "RIP X", curator-confidence
 *                  "I tested N. Only K survived.").
 *
 * The 65.4 Hook-Picker (apps/api/src/lib/hook-library/pick-hook.ts) reads
 * `recurring_content_definitions.outputTargets` and derives the allow-list:
 * article-only → `['subtle']`, social → all three. Filter happens at SQL
 * level via `listLruEligibleHooks({dramaIntensities})` so the LLM only
 * sees pool members it is allowed to pick (Spec 65.5-followup pattern —
 * pre-filter beats post-check).
 */
export type HookDramaIntensity = "subtle" | "moderate" | "aggressive";

export const hookTemplates = pgTable(
  "hook_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    formatType: text("format_type").notNull(),
    pattern: text("pattern").notNull(),
    language: text("language").notNull().$type<HookTemplateLanguage>(),

    /** Placeholder variable names referenced inside `pattern`. */
    variables: jsonb("variables").notNull().default(sql`'[]'::jsonb`).$type<string[]>(),

    /**
     * Spec 65.14 — drama-intensity for the SEO/Social mode-switch. Migration
     * 0128 adds with `DEFAULT 'subtle'` so the 60 hooks from migration 0116
     * are SEO-safe by classification (their existing text patterns are
     * already subtle by content).
     */
    dramaIntensity: text("drama_intensity")
      .notNull()
      .default("subtle")
      .$type<HookDramaIntensity>(),

    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    formatTypeLanguageActiveIdx: index("idx_hook_templates_format_type")
      .on(t.formatType, t.language)
      .where(sql`${t.isActive} = TRUE`),
    projectIdx: index("idx_hook_templates_project").on(t.projectId),
    /**
     * LRU index — `NULLS FIRST` is in the migration SQL itself so never-used
     * hooks bubble up before previously-used ones. Mirrors templates.lruIdx
     * convention from Spec 65.0.
     */
    lruIdx: index("idx_hook_templates_lru").on(t.lastUsedAt).where(sql`${t.isActive} = TRUE`),
  })
);

export type HookTemplate = typeof hookTemplates.$inferSelect;
export type NewHookTemplate = typeof hookTemplates.$inferInsert;
