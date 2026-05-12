# Spec 01: Database Schema

**Phase:** 1 (Foundation)
**Estimated Effort:** 1 day
**Dependencies:** Spec 00 (Foundation Setup)
**Status:** Ready for implementation

---

## Goal

Define the complete Drizzle schema for the marketing automation platform's core entities, set up Drizzle Kit for migrations, and create the foundational migration that establishes all tables. Multi-tenant isolation is enforced via `project_id` foreign keys on every tenant-scoped table. After this spec, we can persist projects, articles, clusters, social posts, cost logs, and briefings.

## Non-Goals

- No application logic that uses these tables (that comes in Spec 02-05+)
- No seed data (will be added per-spec when needed)
- No Drizzle Studio setup (nice-to-have, can do later)
- No row-level security (RLS) – we enforce tenant isolation in application code; RLS comes if/when SaaS pivot
- No backup strategy (operational concern, separate doc)

## User-Facing Behavior

After this spec:
- `bun --filter @marketing-auto/db generate` creates a new migration from schema diffs
- `bun --filter @marketing-auto/db migrate` applies pending migrations
- `bun --filter @marketing-auto/db studio` opens Drizzle Studio (visual DB browser)
- The DB has all tables ready for use in subsequent specs

## Schema Overview

```
Tenant Layer:
  projects                   (the tenant entity)
  project_credentials        (encrypted external API creds per tenant)

Identity Layer:
  brand_voices               (versioned brand voice prompts per project)
  content_pillars            (4-6 strategic pillars per project)
  clusters                   (topic clusters within pillars)

Content Layer:
  articles                   (blog posts, the main content type)
  article_versions           (version history for refresh/rollback)
  social_posts               (Instagram posts, future TikTok/etc.)

Operational Layer:
  cost_logs                  (every external API call's cost)
  briefings                  (daily insight reports)
  pipeline_runs              (BullMQ job tracking, audit trail)
  approvals                  (approval history with comments)

Auth Layer (used in Spec 04):
  users                      (Marcel + team members)
  magic_link_tokens          (short-lived auth tokens)
  sessions                   (active web sessions)

Web Push Layer (used in Spec 41):
  push_subscriptions         (browser push subscriptions per user)
```

## Detailed Schema

### Package Setup

`packages/db/package.json`:
```json
{
  "name": "@marketing-auto/db",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts",
    "./client": "./src/client.ts"
  },
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "bun --env-file ../../.env src/migrate.ts",
    "studio": "drizzle-kit studio",
    "push": "drizzle-kit push",
    "test": "cd ../.. && bun test packages/db/test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0"
  }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*", "drizzle.config.ts"]
}
```

`packages/db/drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";
import { getEnv } from "@marketing-auto/shared/config";

const env = getEnv();

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
```

### Client Setup

`packages/db/src/client.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv, createLogger } from "@marketing-auto/shared";
import * as schema from "./schema/index.ts";

const log = createLogger("db");
const env = getEnv();

// Single connection pool for the application
const queryClient = postgres(env.DATABASE_URL, {
  max: 20,                        // pool size
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: (n) => log.debug({ notice: n }, "PG notice"),
});

export const db = drizzle(queryClient, {
  schema,
  logger: env.NODE_ENV === "development",
});

export type DB = typeof db;
export { schema };
```

### Migration Runner

`packages/db/src/migrate.ts`:
```typescript
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("db:migrate");

async function main() {
  log.info("Starting migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  log.info("Migrations completed");
  process.exit(0);
}

main().catch((err) => {
  log.error({ err }, "Migration failed");
  process.exit(1);
});
```

### Schema Files

Schema is split into multiple files for maintainability. Single re-export from `index.ts`.

`packages/db/src/schema/_enums.ts`:
```typescript
import { pgEnum } from "drizzle-orm/pg-core";

export const lifecycleStageEnum = pgEnum("lifecycle_stage", [
  "cold_start",
  "pre_launch",
  "launch",
  "growth",
  "mature",
]);

export const pipelineTemplateEnum = pgEnum("pipeline_template", [
  "educational",
  "affiliate_review",
  "local_business",
  "programmatic_seo",
]);

export const industryEnum = pgEnum("industry", [
  "ai_education",
  "automotive_dealer",
  "renewable_affiliate",
  "music_school",
  "other",
]);

export const articleStatusEnum = pgEnum("article_status", [
  "planned",
  "researching",
  "drafting",
  "in_review",
  "approved",
  "published",
  "needs_refresh",
  "rejected",
  "failed",
]);

export const socialPlatformEnum = pgEnum("social_platform", [
  "instagram",
  "tiktok",       // future
  "linkedin",     // future
  "twitter",      // future
]);

export const socialFormatEnum = pgEnum("social_format", [
  "carousel",
  "reel",
  "single_image",
  "story",
]);

export const socialStatusEnum = pgEnum("social_status", [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "failed",
]);

export const credentialServiceEnum = pgEnum("credential_service", [
  "google_analytics",
  "google_search_console",
  "google_adsense",
  "instagram_graph",
  "github_deploy",
  "astro_deploy_webhook",
]);

export const costServiceEnum = pgEnum("cost_service", [
  "anthropic",
  "replicate",
  "dataforseo",
  "elevenlabs",
  "resend",
]);

export const pipelineRunStatusEnum = pgEnum("pipeline_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const approvalActionEnum = pgEnum("approval_action", [
  "requested",
  "approved",
  "rejected",
  "changes_requested",
]);

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "editor",
]);
```

`packages/db/src/schema/projects.ts`:
```typescript
import { pgTable, uuid, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { lifecycleStageEnum, pipelineTemplateEnum, industryEnum, credentialServiceEnum } from "./_enums.ts";

/**
 * Projects = Tenants. Each project is one website/content property.
 * KI-Wissensraum, Bellemann, Balkonkraftwerk are projects.
 */
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain"),                                // primary domain (e.g., "ki-wissensraum.de")
  industry: industryEnum("industry").notNull(),
  lifecycleStage: lifecycleStageEnum("lifecycle_stage").notNull().default("cold_start"),
  pipelineTemplate: pipelineTemplateEnum("pipeline_template").notNull(),
  
  // Flexible config blobs
  brandIdentity: jsonb("brand_identity").$type<BrandIdentity>().notNull().default({}),
  targetAudience: jsonb("target_audience").$type<TargetAudience>().notNull().default({}),
  cmsConfig: jsonb("cms_config").$type<CmsConfig>().notNull().default({}),
  monetizationConfig: jsonb("monetization_config").$type<MonetizationConfig>().notNull().default({}),
  pipelineConfig: jsonb("pipeline_config").$type<PipelineConfig>().notNull().default({}),
  costLimits: jsonb("cost_limits").$type<CostLimits>().notNull().default({}),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: index("projects_slug_idx").on(t.slug),
}));

// Type definitions for jsonb columns (runtime validation in Spec 05+)
export type BrandIdentity = {
  voice?: string;                  // primary voice prompt component
  tone?: string;
  forbiddenPhrases?: string[];
  signaturePhrases?: string[];
  pronounStyle?: "du" | "sie";
  anglicismPolicy?: "avoid" | "pragmatic" | "embrace";
  humorLevel?: "dry" | "pragmatic" | "pointed";
};

export type TargetAudience = {
  primaryPersona?: string;
  language?: string;               // BCP 47 (e.g., "de-DE")
  region?: string;
};

export type CmsConfig = {
  type?: "astro" | "wordpress" | "custom";
  repoUrl?: string;
  contentPath?: string;            // e.g., "src/content/blog"
  deployWebhookUrl?: string;
  baseUrl?: string;                // for absolute URL construction
};

export type MonetizationConfig = {
  adsenseEnabled?: boolean;
  affiliatePrograms?: Array<{
    name: string;
    network: string;               // "amazon", "awin", "belboon", "direct"
    disclosureRequired?: boolean;
  }>;
  ownProducts?: Array<{ name: string; url: string }>;
};

export type PipelineConfig = {
  articleMinWords?: number;
  articleMaxWords?: number;
  publishFrequencyPerWeek?: number;
  socialRepurposeEnabled?: boolean;
  approvalMode?: "all" | "social_only" | "none";
  autoTopicSuggestionsPerDay?: number;
};

export type CostLimits = {
  daily?: Record<string, number>;     // service -> EUR
  monthly?: Record<string, number>;
  alertAtPercent?: number;            // default 80
  killAtPercent?: number;             // default 100
};

/**
 * Encrypted credentials per tenant for external services.
 * The `encryptedPayload` is AES-256-GCM encrypted JSON.
 * Encryption key lives in ENV (ENCRYPTION_KEY).
 * Implementation in Spec 02.
 */
export const projectCredentials = pgTable("project_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  service: credentialServiceEnum("service").notNull(),
  
  // AES-256-GCM ciphertext (base64), nonce + auth tag prefixed
  encryptedPayload: text("encrypted_payload").notNull(),
  
  // For OAuth tokens
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectServiceUnique: unique("project_credentials_project_service_unique").on(t.projectId, t.service),
  projectIdx: index("project_credentials_project_idx").on(t.projectId),
}));
```

`packages/db/src/schema/identity.ts`:
```typescript
import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

/**
 * Versioned brand voice prompts. New versions are created when Marcel tunes the prompt.
 * The active version is referenced from projects.brandIdentity.activeVoiceId
 * (or, for simplicity, we just take the latest version with isActive=true).
 */
export const brandVoices = pgTable("brand_voices", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  systemPrompt: text("system_prompt").notNull(),       // the actual prompt content
  exampleParagraphs: jsonb("example_paragraphs").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("brand_voices_project_idx").on(t.projectId),
  activeIdx: index("brand_voices_active_idx").on(t.projectId, t.isActive),
}));

/**
 * 4-6 strategic content pillars per project.
 * E.g., for KI-Wissensraum: "Bildgenerierung", "Prompt Engineering", "AI-Tools-Reviews", etc.
 */
export const contentPillars = pgTable("content_pillars", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("content_pillars_project_idx").on(t.projectId),
}));

/**
 * Topic clusters within a pillar.
 * Each cluster has a "pillar article" (cornerstone) and several supporting articles.
 */
export const clusters = pgTable("clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  pillarId: uuid("pillar_id").notNull().references(() => contentPillars.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  primaryKeyword: text("primary_keyword"),
  status: text("status").notNull().default("planned"),  // "planned" | "building" | "complete" | "expanding"
  pillarArticleId: uuid("pillar_article_id"),           // FK to articles.id (set after creation)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("clusters_project_idx").on(t.projectId),
  pillarIdx: index("clusters_pillar_idx").on(t.pillarId),
}));
```

`packages/db/src/schema/content.ts`:
```typescript
import { pgTable, uuid, text, timestamp, jsonb, integer, vector, index } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { clusters } from "./identity.ts";
import { articleStatusEnum, socialPlatformEnum, socialFormatEnum, socialStatusEnum } from "./_enums.ts";

/**
 * Articles = blog posts (the primary content type).
 */
export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  clusterId: uuid("cluster_id").references(() => clusters.id, { onDelete: "set null" }),
  
  status: articleStatusEnum("status").notNull().default("planned"),
  
  // Topic + SEO
  topic: text("topic").notNull(),
  primaryKeyword: text("primary_keyword"),
  secondaryKeywords: jsonb("secondary_keywords").$type<string[]>().notNull().default([]),
  
  // Content
  title: text("title"),
  slug: text("slug"),
  metaDescription: text("meta_description"),
  draftMd: text("draft_md"),                       // Markdown body
  
  // Metadata for publishing
  metadata: jsonb("metadata").$type<ArticleMetadata>().notNull().default({}),
  
  // Hero image
  heroImageUrl: text("hero_image_url"),
  heroImagePrompt: text("hero_image_prompt"),
  
  // Research data (SERP snapshot, competitor analysis, etc.)
  researchData: jsonb("research_data").$type<ResearchData>(),
  
  // Generation log: which models, which prompts, which costs (denormalized snapshot)
  generationLog: jsonb("generation_log").$type<GenerationLog>().notNull().default({ steps: [] }),
  
  // Publishing
  publishedUrl: text("published_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  
  // Embedding for semantic similarity (internal linking)
  // Using 1024 dimensions to match Voyage AI's voyage-3 embedding model.
  // Adjust if you switch embedding provider.
  embedding: vector("embedding", { dimensions: 1024 }),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("articles_project_idx").on(t.projectId),
  statusIdx: index("articles_status_idx").on(t.projectId, t.status),
  clusterIdx: index("articles_cluster_idx").on(t.clusterId),
  slugIdx: index("articles_slug_idx").on(t.projectId, t.slug),
  // pgvector HNSW index for fast similarity search
  embeddingIdx: index("articles_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
}));

export type ArticleMetadata = {
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  schemaOrg?: Record<string, unknown>;
  internalLinks?: Array<{ url: string; anchor: string; targetArticleId: string }>;
  readingTimeMinutes?: number;
  wordCount?: number;
};

export type ResearchData = {
  serpSnapshot?: Array<{ position: number; url: string; title: string; snippet: string }>;
  competitorAnalysis?: Array<{ url: string; wordCount: number; gapTopics: string[] }>;
  searchVolume?: number;
  difficulty?: number;
  capturedAt?: string;
};

export type GenerationLog = {
  steps: Array<{
    stepName: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costEur: number;
    durationMs: number;
    timestamp: string;
  }>;
};

/**
 * Article version history. New version on every approval+publish, also on refresh.
 * Used for rollback and tracking content evolution.
 */
export const articleVersions = pgTable("article_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  draftMd: text("draft_md").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  changeReason: text("change_reason"),                  // "initial", "refresh", "approval-edit"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  articleIdx: index("article_versions_article_idx").on(t.articleId),
}));

/**
 * Social posts derived from articles (or standalone).
 */
export const socialPosts = pgTable("social_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
  
  platform: socialPlatformEnum("platform").notNull(),
  format: socialFormatEnum("format").notNull(),
  status: socialStatusEnum("status").notNull().default("draft"),
  
  content: jsonb("content").$type<SocialPostContent>().notNull(),
  
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedUrl: text("published_url"),
  
  // Performance metrics, populated post-publish
  metrics: jsonb("metrics").$type<Record<string, number>>(),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("social_posts_project_idx").on(t.projectId),
  statusIdx: index("social_posts_status_idx").on(t.projectId, t.status),
  scheduledIdx: index("social_posts_scheduled_idx").on(t.scheduledAt),
}));

export type SocialPostContent =
  | { kind: "carousel"; slides: Array<{ imageUrl: string; caption?: string }>; caption: string; hashtags: string[] }
  | { kind: "reel"; videoUrl: string; coverUrl: string; caption: string; hashtags: string[] }
  | { kind: "single_image"; imageUrl: string; caption: string; hashtags: string[] }
  | { kind: "story"; imageUrl: string; durationSec?: number };
```

`packages/db/src/schema/operations.ts`:
```typescript
import { pgTable, uuid, text, timestamp, jsonb, decimal, index } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { articles, socialPosts } from "./content.ts";
import { costServiceEnum, pipelineRunStatusEnum, approvalActionEnum } from "./_enums.ts";

/**
 * Every external API call's cost. Mission-critical for hard-limit enforcement.
 * Implementation of cost tracker in Spec 03.
 */
export const costLogs = pgTable("cost_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  service: costServiceEnum("service").notNull(),
  operation: text("operation").notNull(),               // e.g., "article_draft", "hero_image", "serp_check"
  
  costEur: decimal("cost_eur", { precision: 10, scale: 6 }).notNull(),
  
  // Service-specific metadata: tokens, model, etc.
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  
  // Optional: link to triggering entity
  pipelineRunId: uuid("pipeline_run_id"),
  articleId: uuid("article_id"),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectServiceTimeIdx: index("cost_logs_project_service_time_idx").on(t.projectId, t.service, t.createdAt),
  projectTimeIdx: index("cost_logs_project_time_idx").on(t.projectId, t.createdAt),
  pipelineRunIdx: index("cost_logs_pipeline_run_idx").on(t.pipelineRunId),
}));

/**
 * Daily insight reports (active when project is in lifecycle "growth"+).
 */
export const briefings = pgTable("briefings", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
  briefingMd: text("briefing_md").notNull(),
  rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default({}),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectDateIdx: index("briefings_project_date_idx").on(t.projectId, t.date),
}));

/**
 * Tracks every BullMQ pipeline job for audit trail and retry visibility.
 */
export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  pipelineName: text("pipeline_name").notNull(),       // e.g., "article-pipeline"
  stepName: text("step_name"),                         // null = whole-pipeline run, set = specific step
  
  status: pipelineRunStatusEnum("status").notNull().default("queued"),
  
  jobId: text("job_id"),                                // BullMQ job id
  parentRunId: uuid("parent_run_id"),                  // for sub-runs
  
  // Input/output snapshots for debugging
  input: jsonb("input").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("pipeline_runs_project_idx").on(t.projectId),
  statusIdx: index("pipeline_runs_status_idx").on(t.projectId, t.status),
  pipelineIdx: index("pipeline_runs_pipeline_idx").on(t.pipelineName),
}));

/**
 * Approval history for articles and social posts.
 * When a piece of content is reviewed, a row is added.
 */
export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  
  // Polymorphic: either article OR social post
  articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }),
  socialPostId: uuid("social_post_id").references(() => socialPosts.id, { onDelete: "cascade" }),
  
  action: approvalActionEnum("action").notNull(),
  comment: text("comment"),
  
  // Who approved (nullable until Spec 04 auth lands)
  userId: uuid("user_id"),
  
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  articleIdx: index("approvals_article_idx").on(t.articleId),
  socialPostIdx: index("approvals_social_post_idx").on(t.socialPostId),
}));
```

`packages/db/src/schema/auth.ts`:
```typescript
import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { userRoleEnum } from "./_enums.ts";

/**
 * Users (Marcel + 1-2 team members for MVP).
 * No password column — magic-link auth only (Spec 04).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: userRoleEnum("role").notNull().default("editor"),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (t) => ({
  emailIdx: index("users_email_idx").on(t.email),
}));

/**
 * Short-lived tokens for magic-link login (15 min TTL).
 * Implementation in Spec 04.
 */
export const magicLinkTokens = pgTable("magic_link_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),              // SHA-256 of raw token (raw token only sent in email)
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenHashIdx: index("magic_link_tokens_hash_idx").on(t.tokenHash),
  expiresIdx: index("magic_link_tokens_expires_idx").on(t.expiresAt),
}));

/**
 * Active web sessions (httpOnly cookie -> session lookup).
 * Implementation in Spec 04.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("sessions_user_idx").on(t.userId),
  tokenIdx: index("sessions_token_idx").on(t.tokenHash),
}));
```

`packages/db/src/schema/push.ts`:
```typescript
import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

/**
 * Web Push subscriptions per user/device. Used in Spec 41.
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  endpoint: text("endpoint").notNull().unique(),        // browser-provided URL
  p256dh: text("p256dh").notNull(),                     // public key
  auth: text("auth").notNull(),                         // auth secret
  
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => ({
  userIdx: index("push_subscriptions_user_idx").on(t.userId),
}));
```

`packages/db/src/schema/index.ts`:
```typescript
export * from "./_enums.ts";
export * from "./projects.ts";
export * from "./identity.ts";
export * from "./content.ts";
export * from "./operations.ts";
export * from "./auth.ts";
export * from "./push.ts";
```

`packages/db/src/index.ts`:
```typescript
export { db, type DB, schema } from "./client.ts";
export * from "./schema/index.ts";
```

### Subtree CLAUDE.md

`packages/db/CLAUDE.md`:
```markdown
# Database Conventions

## Schema Organization
- One file per logical group: projects, identity, content, operations, auth, push
- All tables exported via `schema/index.ts`
- Type definitions for jsonb columns are co-located with the table

## Multi-Tenancy
- EVERY tenant-scoped table has `project_id` as a non-nullable FK to `projects.id`
- All queries that read/write tenant data MUST filter by `project_id`
- Cross-tenant queries are a security bug — wrap in helper that requires explicit `crossTenant: true` flag
- The `users`, `magic_link_tokens`, `sessions`, `push_subscriptions` tables are platform-wide (not tenant-scoped)

## Conventions
- Primary keys: `uuid` with `defaultRandom()`
- Timestamps: `timestamp({ withTimezone: true })` everywhere, `notNull()`, `defaultNow()`
- All FKs explicit `onDelete` (`cascade` for owned children, `restrict` for protected refs, `set null` for optional refs)
- JSONB for flexible config + a separate column when query-relevant
- Indexes on every FK and frequently-filtered column
- Enum types live in `_enums.ts`, prefixed with their domain

## Migrations
- Generate with `bun --filter @marketing-auto/db generate`
- Apply with `bun --filter @marketing-auto/db migrate`
- Migrations go in `packages/db/drizzle/` (committed)
- NEVER edit applied migration files — create a new migration to fix
- For dev iteration, `drizzle-kit push` is fine (no migration file); use `generate` once schema is stable

## pgvector
- `embedding` columns use `vector({ dimensions: N })`
- HNSW index with appropriate distance op:
  - `vector_cosine_ops` for normalized embeddings (most common)
  - `vector_l2_ops` for L2 distance
- Embeddings are 1024-dim (Voyage AI voyage-3) — change carefully, requires re-embedding everything

## Common Mistakes to Avoid
- DO NOT use `serial` for IDs — use `uuid` with `defaultRandom()`
- DO NOT forget `withTimezone: true` on timestamps
- DO NOT add columns without considering `notNull()` and a sensible default
- DO NOT cross-reference tenants in queries
- DO NOT use `pgEnum` without importing from `_enums.ts`
- DO NOT modify already-applied migrations
```

## Acceptance Criteria

- [ ] `bun --filter @marketing-auto/db typecheck` passes
- [ ] `bun --filter @marketing-auto/db generate` produces a valid migration in `packages/db/drizzle/`
- [ ] `bun --filter @marketing-auto/db migrate` applies the migration to the running DB
- [ ] `psql $DATABASE_URL -c "\dt"` lists all expected tables
- [ ] `psql $DATABASE_URL -c "\dT"` lists all enum types
- [ ] All FKs are present (verify with `\d <tablename>`)
- [ ] HNSW index on `articles.embedding` exists
- [ ] `bun --filter @marketing-auto/db studio` opens Drizzle Studio successfully
- [ ] One smoke test inserts and reads a project (see below)

## Testing Strategy

ONE smoke test that proves the schema works end-to-end:

`packages/db/test/schema.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { db, projects } from "../src/index.ts";
import { eq } from "drizzle-orm";

describe("Schema smoke test", () => {
  let projectId: string;
  
  it("inserts and reads a project", async () => {
    const [inserted] = await db.insert(projects).values({
      slug: "test-project-" + Date.now(),
      name: "Test Project",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();
    
    expect(inserted).toBeDefined();
    expect(inserted!.lifecycleStage).toBe("cold_start");  // default
    projectId = inserted!.id;
    
    const [read] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(read).toBeDefined();
    expect(read!.name).toBe("Test Project");
  });
  
  afterAll(async () => {
    if (projectId) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });
});
```

Run with: `bun --filter @marketing-auto/db test`

## Open Questions / Decisions Made

**Decision 1: jsonb for flexible config blocks.** `brandIdentity`, `cmsConfig` etc. are jsonb so we can evolve the shape without migrations. Type safety enforced via `$type<>()`. Trade-off: can't index inside, but we don't query inside them.

**Decision 2: Polymorphic `approvals` table.** One table for both article + social-post approvals, with two nullable FKs. Alternative (separate tables) considered but rejected as duplication. CHECK constraint to ensure exactly one is set: add via raw SQL in migration if needed.

**Decision 3: Embedding dimensions = 1024.** Matches Voyage AI's voyage-3 (the high-quality embedding model). If Marcel switches to OpenAI's text-embedding-3-small (1536) or large (3072), change carefully — requires re-embedding all rows.

**Decision 4: Versioned brand voices.** Brand voice will evolve as Marcel tunes prompts. Old versions kept for audit and possible rollback. Active version flagged with `isActive=true`.

**Decision 5: Generation log denormalized in articles.** A complete history of which models/prompts/costs created an article, kept inline as jsonb. Easier debugging than joining cost_logs by time. cost_logs remains source of truth for billing.

**Decision 6: No `tenant_id` aliased name.** We stick with `project_id` consistently to match the domain language.

**Decision 7: Auth tables in this spec, even though Spec 04 implements auth.** Cheaper to put them in one big initial migration than many small ones. Tables are inert until Spec 04 adds the logic.

## Implementation Order

1. Create `packages/db/` package files (package.json, tsconfig.json, drizzle.config.ts, CLAUDE.md)
2. Create `client.ts`, `migrate.ts`
3. Create `schema/_enums.ts`
4. Create `schema/projects.ts` (foundation)
5. Create `schema/identity.ts`, `schema/content.ts`, `schema/operations.ts`
6. Create `schema/auth.ts`, `schema/push.ts`
7. Create `schema/index.ts` and `src/index.ts`
8. `bun install` (drizzle-kit, drizzle-orm, postgres)
9. `bun --filter @marketing-auto/db generate` — generate first migration
10. Inspect generated SQL, verify it makes sense
11. `bun --filter @marketing-auto/db migrate` — apply
12. Add HNSW index manually if drizzle-kit didn't (it should handle it as of v0.28+)
13. Write and run smoke test
14. Commit: `feat(db): initial schema with multi-tenant support (spec 01)`

## Splitting Plan

This spec is ~500 lines of schema, manageable in one session if Claude works methodically. If session pressure shows up, split as:
- Session A: package setup + enums + projects + identity (Steps 1-5)
- Session B: content + operations + auth + push + migration + test (Steps 6-13)

Run `/clear` between if splitting.

## Discovered During Implementation

- **drizzle-orm v0.36.4 installed** (spec asked for `^0.36.0`). `vector` is re-exported from `drizzle-orm/pg-core` via `pg-core/columns/vector_extension/vector` — no separate import path needed.
- **HNSW index generated correctly** by drizzle-kit v0.28 without manual SQL. `USING hnsw ("embedding" vector_cosine_ops)` is in the migration as expected.
- **Migration and smoke test require Docker up** (`docker compose up -d`) before they can run.
- **Bun's built-in `test` subcommand collides with a script named `test` in `package.json`** — when `bun run test` is invoked from `packages/db/` directly, Bun's workspace test broadcasting kicks in and runs other workspaces too. Always invoke as `bun --filter @marketing-auto/db test`. Documented in `packages/db/CLAUDE.md`.

## Deviations

- **`tsconfig.json` has no `rootDir`/`outDir`**: The spec included `rootDir: ./src` and `outDir: ./dist`, but `drizzle.config.ts` lives outside `src/`, causing a `tsc` error. Since we set `noEmit: true`, both fields are meaningless and were removed.
- **`allowImportingTsExtensions: true` added to tsconfig**: Required to use `.ts` extensions in import statements (Marcel's explicit preference for TypeScript imports over `.js`). Also requires `noEmit: true` (already set).
- **`migrate` script needs `--env-file ../../.env`**: When run via `bun --filter @marketing-auto/db migrate`, the workspace cwd is `packages/db/` where there is no `.env`. The script was changed to `bun --env-file ../../.env src/migrate.ts` so it can find `DATABASE_URL` from the repo-root `.env`.
- **`test` script uses `cd ../.. && bun test packages/db/test`**: Same env-loading problem as `migrate`, but `bun --env-file` triggers workspace broadcasting for the `test` subcommand. Working around by `cd`ing to repo root (where `.env` is auto-loaded by Bun) before invoking `bun test`. Must be run via `bun --filter @marketing-auto/db test` — see `packages/db/CLAUDE.md`.
- **Two FK indexes added during /review-task**: `approvals_project_idx` and `social_posts_article_idx` were missing in the spec's schema snippets. Added to `operations.ts` and `content.ts`. The spec snippets above still don't include them — keep this deviation if regenerating from the spec.
