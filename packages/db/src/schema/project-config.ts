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
  "trend.synthesis",
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
    // Spec 54.5: additional fields for trend synthesis
    primary_themes: z.array(z.string()).default([]),
    relevance_keywords: z.array(z.string()).default([]),
    min_trend_score: z.number().int().min(0).max(100).default(25),
    min_signal_thresholds: z
      .object({
        hackernews: z.number().int().default(3),
        producthunt: z.number().int().default(0),
        vendor_rss: z.number().int().default(0),
      })
      .default({}),
  })
  .default({ languages: ["de", "en"], exclusions: [] });
export type TopicScope = z.infer<typeof TopicScopeSchema>;

export const SignalSourcesSchema = z
  .object({
    producthunt: z.boolean().default(false),
    hackernews: z
      .object({
        enabled:     z.boolean().default(false),
        queries:     z.array(z.string().min(1)).default([
          "ai OR llm OR gpt OR claude OR gemini",
          'midjourney OR "stable diffusion" OR flux OR sora OR runway',
          "cursor OR copilot OR devin OR codeium",
          "openai OR anthropic OR huggingface OR replicate",
        ]),
        hitsPerPage: z.number().int().min(1).max(100).default(50),
        minPoints:   z.number().int().min(0).default(5),
        // Spec 64.19 / Phase C: per-project override. Default 30 mirrors the
        // adapter-side schema default in packages/adapters/hackernews/src/signal-source.ts.
        // Setting this per-project lets Multi-Domain tenants (e.g. Balkon-Kraftwerk)
        // tighten or loosen the staleness window without an adapter deploy.
        maxAgeDays:  z.number().int().positive().max(365).default(30),
      })
      .default({
        enabled: false,
        queries: [
          "ai OR llm OR gpt OR claude OR gemini",
          'midjourney OR "stable diffusion" OR flux OR sora OR runway',
          "cursor OR copilot OR devin OR codeium",
          "openai OR anthropic OR huggingface OR replicate",
        ],
        hitsPerPage: 50,
        minPoints: 5,
        maxAgeDays: 30,
      }),
    reddit: z
      .object({
        enabled: z.boolean().default(false),
        subreddits: z.array(z.string()).default([
          "LocalLLaMA",
          "MachineLearning",
          "ChatGPT",
          "ClaudeAI",
          "SaaS",
          "InternetIsBeautiful",
          "SideProject",
          "PromptEngineering",
          "StableDiffusion",
        ]),
        sortMode: z.enum(["top", "hot", "new"]).default("top"),
        timeWindow: z.enum(["day", "week", "month"]).default("week"),
        minUpvotes: z.number().int().min(0).default(50),
        minComments: z.number().int().min(0).default(10),
        maxAgeDays: z.number().int().positive().default(7),
        cronPattern: z.string().default("30 2 * * *"),
      })
      .default({ enabled: false, subreddits: [], sortMode: "top", timeWindow: "week", minUpvotes: 50, minComments: 10, maxAgeDays: 7, cronPattern: "30 2 * * *" }),
    github: z
      .object({
        enabled: z.boolean().default(false),
        topics: z.array(z.string()).default([
          "ai-tools",
          "llm",
          "ai-agents",
          "chatbot",
          "ai-assistant",
          "langchain",
          "llamaindex",
          "rag",
          "prompt-engineering",
          "vector-database",
        ]),
        timeWindowDays: z.number().int().positive().default(7),
        minStarsNew: z.number().int().min(0).default(20),
        minStarsEstablished: z.number().int().min(0).default(500),
        maxAgeDays: z.number().int().positive().default(14),
        cronPattern: z.string().default("0 3 * * *"),
      })
      .default({
        enabled: false,
        topics: [
          "ai-tools",
          "llm",
          "ai-agents",
          "chatbot",
          "ai-assistant",
          "langchain",
          "llamaindex",
          "rag",
          "prompt-engineering",
          "vector-database",
        ],
        timeWindowDays: 7,
        minStarsNew: 20,
        minStarsEstablished: 500,
        maxAgeDays: 14,
        cronPattern: "0 3 * * *",
      }),
    vendor_rss: z
      .object({
        enabled: z.boolean().default(false),
        feeds: z
          .array(
            z.object({
              id: z.string().uuid(),
              url: z.string().url(),
              label: z.string().min(1).max(100),
              enabled: z.boolean().default(true),
              addedAt: z.string().datetime(),
              lastVerifiedAt: z.string().datetime().nullable().default(null),
            }),
          )
          .default([]),
        // Spec 64.19 / Phase C: per-project override. Default 14 mirrors the
        // adapter-side schema default in packages/adapters/vendor-rss/src/signal-source.ts.
        maxAgeDays: z.number().int().positive().max(365).default(14),
      })
      .default({ enabled: false, feeds: [], maxAgeDays: 14 }),
    dataforseo_trends: z.boolean().default(false),
  })
  .default({
    producthunt: false,
    hackernews: {
      enabled: false,
      queries: [
        "ai OR llm OR gpt OR claude OR gemini",
        'midjourney OR "stable diffusion" OR flux OR sora OR runway',
        "cursor OR copilot OR devin OR codeium",
        "openai OR anthropic OR huggingface OR replicate",
      ],
      hitsPerPage: 50,
      minPoints: 5,
      maxAgeDays: 30,
    },
    reddit: { enabled: false, subreddits: [], sortMode: "top", timeWindow: "week", minUpvotes: 50, minComments: 10, maxAgeDays: 7, cronPattern: "30 2 * * *" },
    github: {
      enabled: false,
      topics: [
        "ai-tools",
        "llm",
        "ai-agents",
        "chatbot",
        "ai-assistant",
        "langchain",
        "llamaindex",
        "rag",
        "prompt-engineering",
        "vector-database",
      ],
      timeWindowDays: 7,
      minStarsNew: 20,
      minStarsEstablished: 500,
      maxAgeDays: 14,
      cronPattern: "0 3 * * *",
    },
    vendor_rss: { enabled: false, feeds: [], maxAgeDays: 14 },
    dataforseo_trends: false,
  });
export type SignalSources = z.infer<typeof SignalSourcesSchema>;
export type VendorRssFeed = SignalSources["vendor_rss"]["feeds"][number];

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
