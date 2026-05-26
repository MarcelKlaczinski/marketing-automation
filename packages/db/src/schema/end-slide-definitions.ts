import { sql } from "drizzle-orm";
/**
 * Spec 65.1 — End Slide Definitions
 *
 * Pluggable end-slide library. Each definition describes one swappable end-
 * slide variant (follow-CTA, comment-to-get, link-in-bio, etc.). The 65.9
 * end-slide renderer reads from this table; recurring_content_definitions
 * names which end-slide IDs are eligible for rotation via `end_slide_pool`.
 *
 * Project-scoped (Memory D5) — each tenant maintains its own follow-handles,
 * keywords, and CTAs.
 *
 * `type` is text (not enum) because the renderer registry grows over time
 * (v1: follow-cta, comment-to-get, link-in-bio; v2: poll-cta, quiz-cta, ...).
 * Per-type config-shape validated via shared/format-types/registry (skeleton
 * today, populated in 65.4/65.9).
 *
 * Spec 65.9-followup (migration 0124): `name` widened from `text` to
 * `jsonb {de, en}` so bilingual tenants (Toolwiki) render the admin label in
 * the user's UI locale. Per-type `config` jsonb additionally stores
 * locale-binding strings as `{de, en}` rather than plain text — handled by
 * the per-type Zod schemas in `packages/social/src/end-slide-components/types.ts`.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

/**
 * Localized admin label shared across both UI locales. Always carries both
 * values; the migration backfills `{de: existing, en: existing}` for legacy
 * rows so Marcel sees the original string in either locale until he edits.
 */
export type LocalizedEndSlideName = { de: string; en: string };

export const endSlideDefinitions = pgTable(
  "end_slide_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    name: jsonb("name").notNull().$type<LocalizedEndSlideName>(),
    /** Type discriminator — 'follow-cta' | 'comment-to-get' | 'link-in-bio' | etc. */
    type: text("type").notNull(),

    /** Type-specific config (e.g. {handle: "@toolwiki", arrowDirection: "right"}). */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`).$type<Record<string, unknown>>(),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectTypeActiveIdx: index("idx_end_slides_project_type")
      .on(t.projectId, t.type)
      .where(sql`${t.isActive} = TRUE`),
  })
);

export type EndSlideDefinition = typeof endSlideDefinitions.$inferSelect;
export type NewEndSlideDefinition = typeof endSlideDefinitions.$inferInsert;
