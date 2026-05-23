import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

// ───── content_categories (Spec multi-domain-evolution S3.1) ──────────────────
//
// Per-tenant taxonomy table that replaces the three parallel category models
// Phase-1 found in Toolwiki today (blog enum, ki-wissen German enum, tools
// free-text). Single shape that scales to N domains: every domain registers
// its category slugs here, scoped by (project_id, scope, slug). Articles
// reference categories by SLUG (text column on `articles`); soft validation
// against this table lands in S3.4 (DraftStep emits a Soft-Warning on
// unknown slugs) and tightens in S3.5 (Tool-CLI consolidation script).
//
// `scope` segments the taxonomy per content kind (e.g. a `tool` slug
// `audio-music` and a `blog` slug `audio-music` are distinct rows). The
// unique index keys on `(project_id, scope, slug)` because slugs may
// collide ACROSS scopes legitimately.
//
// `translations` JSONB holds per-locale `{label, urlSlug}` pairs — matches
// Phase-1 §3.3 design + the Toolwiki Astro repo's URL_SLUG_MAP shape.
// Scoping the URL slugs per-locale removes the brittle DE/EN drift the
// Phase-1 audit flagged.
//
// `parent_slug` is app-layer validated (no DB self-FK to avoid the
// recursive-FK complexity Phase-1 §5 R8 documented). The Sprint-3 validator
// helper will reject parent references that don't resolve.

export interface CategoryTranslation {
  /** Human-readable label rendered in the Astro UI. */
  label: string;
  /** Locale-specific URL fragment used in the Astro routes. */
  urlSlug: string;
}

export type CategoryTranslationMap = Record<string, CategoryTranslation>;

export const contentCategories = pgTable(
  "content_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * Locale-neutral slug — e.g. `audio-music`. Toolwiki's URL_SLUG_MAP
     * values are seeded here as `translations[locale].urlSlug`; the bare
     * `slug` is the stable identifier articles reference.
     */
    slug: text("slug").notNull(),
    /**
     * Taxonomy bucket: `tool` for the AI-tool category tree, `blog` for
     * blog post categories, `knowledge` for ki-wissen pillars,
     * `usecase` for usecase verticals. Extend as needed when new domains
     * onboard — string, not pgEnum, so per-domain values don't require
     * a migration.
     */
    scope: text("scope").notNull(),
    /**
     * Parent category slug for hierarchical taxonomies (e.g. a Tool
     * subcategory under a top-level category). App-layer validated;
     * intentionally NOT a DB self-FK (Phase-1 §5 R8).
     */
    parentSlug: text("parent_slug"),
    translations: jsonb("translations")
      .$type<CategoryTranslationMap>()
      .notNull()
      .default({}),
    /** Lucide icon name or asset key — optional UI hint. */
    icon: text("icon"),
    /** OKLCH or hex color string — optional UI accent. */
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectScopeSlugUnique: uniqueIndex("content_categories_project_scope_slug_idx").on(
      t.projectId,
      t.scope,
      t.slug,
    ),
    projectScopeIdx: index("content_categories_project_scope_idx").on(t.projectId, t.scope),
    parentSlugIdx: index("content_categories_parent_slug_idx").on(t.projectId, t.scope, t.parentSlug),
  }),
);

export type ContentCategory = typeof contentCategories.$inferSelect;
export type NewContentCategory = typeof contentCategories.$inferInsert;
