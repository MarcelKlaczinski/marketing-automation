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
import { vector } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import type { IntentTaxonomy } from "./project-config.ts";

export const brandVoices = pgTable(
  "brand_voices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    exampleParagraphs: jsonb("example_paragraphs").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index("brand_voices_project_idx").on(t.projectId),
    activeIdx: index("brand_voices_active_idx").on(t.projectId, t.isActive),
  })
);

/**
 * content_pillars: legacy table, scheduled for refactor.
 *
 * Today this table is populated by two writers:
 * - `SyncClustersFromFrontmatterStep` (the Astro importer) — INSERTs one
 *   row per distinct `articles.category` value (NOT a dedicated `pillar:`
 *   frontmatter field). Auto-creates an "Uncategorized" fallback.
 * - `cluster:full-plan` (the Cluster-Creator UI path) — INSERTs a row
 *   when the user names a new pillar that doesn't yet exist.
 *
 * The table accumulates drift over time and is NOT authoritatively kept
 * in sync with the Astro repo's frontmatter category-set. As of 2026-05-24,
 * Toolwiki has 29 rows with a mix of:
 *   - 14 active rows (have ≥1 article referencing them by category)
 *   - 7 sister-concept pairs (German + English variants, e.g. "Grundlagen"
 *     orphan + "fundamentals" active, "Vergleiche" orphan, etc.)
 *   - 3 wrong-table cluster slugs that landed here via `cluster:full-plan`
 *     ("ki-regulierte-branchen-2026" etc.)
 *   - 1 boilerplate "Uncategorized" fallback row
 *
 * APPROVED REFACTOR PATH: Cluster-Toolification (Toolwiki repo
 * `docs/specs/cluster-toolification.md`, approved 2026-05-24, implementation
 * deferred). At implementation, this table is obsoleted in favor of unified
 * `clusters` + `cluster_memberships` (tenant-aware, Postgres source-of-truth).
 *
 * Until then: read-only consumer code can use this table, but writes
 * should be rare and trackable. New pillar-related features should NOT
 * extend this table — they should wait for the refactor.
 *
 * See also:
 * - docs/discovery/post-refactor-state-audit.md §6.1 D4
 * - docs/discovery/bd3-content-pillars-baseline.md
 * - docs/specs/bucket-d-fixes/spec.md §3.3 (BD3 patch)
 * - Toolwiki repo: docs/backlog/cluster-toolification.md
 */
export const contentPillars = pgTable(
  "content_pillars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    // Spec 54.2: per-pillar intent taxonomy override; null = use project default
    intentTaxonomyOverride: jsonb("intent_taxonomy_override").$type<IntentTaxonomy | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index("content_pillars_project_idx").on(t.projectId),
  })
);

// SatelliteKeywordEntry: maps one cornerstone keyword to its satellite keywords.
// Stored in clusters.satelliteKeywords as an array (one entry per cornerstone in the cluster).
export type SatelliteKeywordEntry = {
  cornerstoneKeyword: string;
  keywords: Array<{ keyword: string; searchVolume?: number | null; difficulty?: number | null }>;
};

// Spec 54.12: Full Cluster Generation — types for proposed cluster plan JSONB columns.

export type ClusterGenerationStatus =
  | "manual"
  | "plan_proposed"
  | "plan_approved"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export type ProposedSpoke = {
  proposedTitle: string;
  primaryKeyword: string;
  intentType: "review" | "comparison" | "pricing" | "tutorial" | "use-cases" | "features";
  estimatedWordCount: number;
  rationale: string;
  position: number;
};

export type ProposedHub = {
  title: string;
  primaryKeyword: string;
  intentType: "overview" | "general";
  estimatedWordCount: number;
  h2Outline: string[];
  metaDescription?: string;
};

export type PlanEdit = {
  timestamp: string;
  action: "patch_spoke" | "delete_spoke" | "patch_hub" | "regenerate";
  spokeIndex?: number;
  before?: ProposedSpoke | ProposedHub;
  after?: ProposedSpoke | ProposedHub;
  hint?: string;
};

export const clusters = pgTable(
  "clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    pillarId: uuid("pillar_id")
      .notNull()
      .references(() => contentPillars.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Denormalized pillar name — allows TopicIntakeStep to read cluster context without a join
    pillar: text("pillar"),
    primaryKeyword: text("primary_keyword"),
    // Cornerstone keywords belonging to this cluster (from cold-start cluster-plan output)
    cornerstoneKeywords: jsonb("cornerstone_keywords").$type<string[]>().notNull().default([]),
    // Satellite keywords keyed by cornerstone — used by ResearchStep and OutlineStep
    satelliteKeywords: jsonb("satellite_keywords")
      .$type<SatelliteKeywordEntry[]>()
      .notNull()
      .default([]),
    status: text("status").notNull().default("proposed"),
    pillarArticleId: uuid("pillar_article_id"),
    position: integer("position").notNull().default(0),
    // Vector embedding for cluster matching in trend synthesis (Spec 54.5) — 1024-dim voyage-3
    embedding: vector("embedding", { dimensions: 1024 }),

    // Spec 54.12: Full Cluster Generation columns
    generationStatus: text("generation_status").notNull().default("manual")
      .$type<ClusterGenerationStatus>(),
    proposedSpokes: jsonb("proposed_spokes").$type<ProposedSpoke[] | null>(),
    proposedHub: jsonb("proposed_hub").$type<ProposedHub | null>(),
    planEdits: jsonb("plan_edits").$type<PlanEdit[]>().default([]),
    // Soft FK to topic_briefs (no DB-level FK — avoids circular ordering between content.ts tables)
    triggerBriefId: uuid("trigger_brief_id"),
    pendingSpokeBriefIds: jsonb("pending_spoke_brief_ids").$type<string[]>().default([]),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index("clusters_project_idx").on(t.projectId),
    pillarIdx: index("clusters_pillar_idx").on(t.pillarId),
    pillarPositionIdx: index("clusters_pillar_position_idx").on(t.pillarId, t.position),
    embeddingIdx: index("clusters_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  })
);

export type Cluster    = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;
