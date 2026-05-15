import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { projects } from "./projects.ts";

// ─── Zod schemas for JSONB columns ────────────────────────────────────────────

export const IntentTaxonomySchema = z.array(z.string().min(1)).min(1).max(20);
export type IntentTaxonomy = z.infer<typeof IntentTaxonomySchema>;

export const MasterPromptKey = z.enum([
  "article.outline",
  "article.draft",
  "article.self_review",
  "article.localize.fresh",
  "article.localize.translate",
]);
export type MasterPromptKey = z.infer<typeof MasterPromptKey>;

export const MasterPromptsSchema = z
  .record(
    MasterPromptKey,
    z.object({
      prompt: z.string().min(50),
      notes: z.string().optional(),
      updatedAt: z.string().optional(),
    }),
  )
  .default({});
export type MasterPrompts = z.infer<typeof MasterPromptsSchema>;

export const TopicScopeSchema = z
  .object({
    languages: z.array(z.enum(["de", "en"])).min(1),
    exclusions: z.array(z.string()).default([]),
  })
  .default({ languages: ["de", "en"], exclusions: [] });
export type TopicScope = z.infer<typeof TopicScopeSchema>;

// Algolia HN silently returns 0 hits for queries with 7+ OR terms.
// Split into multiple short queries (≤5 terms each); adapter fans them out in parallel.
const HN_DEFAULT_QUERIES = [
  'ai OR llm OR gpt OR claude OR gemini',
  'midjourney OR "stable diffusion" OR flux OR sora OR runway',
  'cursor OR copilot OR devin OR codeium',
  'openai OR anthropic OR huggingface OR replicate',
];

export const SignalSourcesSchema = z
  .object({
    producthunt: z.boolean().default(false),
    hackernews: z
      .object({
        enabled:     z.boolean().default(false),
        queries:     z.array(z.string().min(1)).default(HN_DEFAULT_QUERIES),
        hitsPerPage: z.number().int().min(1).max(100).default(50),
        minPoints:   z.number().int().min(0).default(5),
      })
      .default({ enabled: false, queries: HN_DEFAULT_QUERIES, hitsPerPage: 50, minPoints: 5 }),
    reddit: z
      .object({
        enabled: z.boolean().default(false),
        subreddits: z.array(z.string()).default([]),
      })
      .default({ enabled: false, subreddits: [] }),
    github: z.boolean().default(false),
    vendor_rss: z
      .object({
        enabled: z.boolean().default(false),
        feeds: z.array(z.string().url()).default([]),
      })
      .default({ enabled: false, feeds: [] }),
    dataforseo_trends: z.boolean().default(false),
  })
  .default({
    producthunt: false,
    hackernews: { enabled: false, queries: HN_DEFAULT_QUERIES, hitsPerPage: 50, minPoints: 5 },
    reddit: { enabled: false, subreddits: [] },
    github: false,
    vendor_rss: { enabled: false, feeds: [] },
    dataforseo_trends: false,
  });
export type SignalSources = z.infer<typeof SignalSourcesSchema>;

// intentionally untyped in 54.2 — Phase 2 future
export const AutomationRulesSchema = z.array(z.unknown()).default([]);
export type AutomationRules = z.infer<typeof AutomationRulesSchema>;

// ─── Drizzle table ─────────────────────────────────────────────────────────────

export const projectConfigurations = pgTable(
  "project_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft").$type<"draft" | "active" | "archived">(),

    intentTaxonomyDefault: jsonb("intent_taxonomy_default")
      .$type<IntentTaxonomy>()
      .notNull(),
    masterPrompts: jsonb("master_prompts").$type<MasterPrompts>().notNull(),
    topicScope: jsonb("topic_scope").$type<TopicScope>().notNull(),
    signalSources: jsonb("signal_sources").$type<SignalSources>().notNull(),
    automationRules: jsonb("automation_rules").$type<AutomationRules>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index("project_configurations_project_idx").on(t.projectId),
    versionUnique: uniqueIndex("project_configurations_project_version_unique").on(
      t.projectId,
      t.version,
    ),
  }),
);

export type ProjectConfiguration = typeof projectConfigurations.$inferSelect;
export type NewProjectConfiguration = typeof projectConfigurations.$inferInsert;
