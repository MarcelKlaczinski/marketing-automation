/**
 * Spec 65.0 — Template Engine
 *
 * DB-backed metadata for Remotion compositions registered in
 * `packages/social/src/templates/`. The filesystem is the source-of-truth for
 * composition CODE; this table tracks discovery metadata, usage statistics,
 * and project-scoping for the planner-side selection layer.
 *
 * Multi-tenancy:
 *   project_id is NULLABLE on purpose (Memory D5 multi-tenant exception).
 *     NULL  → global template (available to every tenant)
 *     UUID  → project-scoped
 *   The same template_key may exist as both global AND project-scoped.
 *
 * Lifecycle:
 *   `last_seen_at` updated on every filesystem-scan tick. Templates whose
 *   source file disappears get `is_active=false` after a watcher sweep
 *   (Spec 65.0 Day 3) — not deleted, so audit-trail (which posts used them)
 *   survives.
 */
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./projects.ts";

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL → global template (D5 multi-tenant exception); UUID → project-scoped.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),

    // Discriminators
    templateKey: text("template_key").notNull(),
    baseTemplateKey: text("base_template_key").notNull(),
    variant: text("variant"),

    // Filesystem anchor (relative to repo root) + content hash for change-detection.
    filePath: text("file_path").notNull(),
    fileHash: text("file_hash").notNull(),

    isActive: boolean("is_active").notNull().default(true),

    // Format-types this template handles (TemplatePlannerMeta.contentType-equivalent set).
    // GIN-indexed for the "which templates handle format X" planner query.
    formatTypes: text("format_types").array().notNull().default(sql`'{}'::text[]`),

    // TemplateDefinition mirror fields — frozen at sync-time so the planner can read
    // metadata without dynamic-importing the TSX module. Re-sync updates them.
    outputFormat: text("output_format"),
    compatibleChannels: text("compatible_channels").array().notNull().default(sql`'{}'::text[]`),
    generationClass: text("generation_class"),
    displayName: text("display_name"),
    description: text("description"),
    defaultSlideCount: integer("default_slide_count"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 4 }),

    // LRU + audit
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    previewImageUrl: text("preview_image_url"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial unique — inactive rows are tombstones and may share a key with an
    // active sibling (mirrors articles-active-only pattern from Spec 005 IR1).
    activeKeyPerProjectUniq: uniqueIndex("templates_active_key_per_project_uniq")
      .on(t.projectId, t.templateKey)
      .where(sql`${t.isActive} = TRUE`),

    formatTypesGinIdx: index("templates_format_types_gin_idx")
      .using("gin", t.formatTypes),

    lruIdx: index("templates_lru_idx").on(t.lastUsedAt),

    projectActiveIdx: index("templates_project_active_idx").on(t.projectId, t.isActive),

    lastSeenIdx: index("templates_last_seen_idx").on(t.lastSeenAt),
  })
);

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
