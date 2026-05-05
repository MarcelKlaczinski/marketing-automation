import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { clusters } from "./identity.ts";
import { articleStatusEnum, socialPlatformEnum, socialFormatEnum, socialStatusEnum } from "./_enums.ts";

export const articles = pgTable("articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  clusterId: uuid("cluster_id").references(() => clusters.id, { onDelete: "set null" }),

  status: articleStatusEnum("status").notNull().default("planned"),

  topic: text("topic").notNull(),
  primaryKeyword: text("primary_keyword"),
  secondaryKeywords: jsonb("secondary_keywords").$type<string[]>().notNull().default([]),

  title: text("title"),
  slug: text("slug"),
  metaDescription: text("meta_description"),
  draftMd: text("draft_md"),

  metadata: jsonb("metadata").$type<ArticleMetadata>().notNull().default({}),

  heroImageUrl: text("hero_image_url"),
  heroImagePrompt: text("hero_image_prompt"),

  researchData: jsonb("research_data").$type<ResearchData>(),

  generationLog: jsonb("generation_log").$type<GenerationLog>().notNull().default({ steps: [] }),

  publishedUrl: text("published_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }),

  // 1024 dims = Voyage AI voyage-3; change carefully — requires re-embedding all rows
  embedding: vector("embedding", { dimensions: 1024 }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("articles_project_idx").on(t.projectId),
  statusIdx: index("articles_status_idx").on(t.projectId, t.status),
  clusterIdx: index("articles_cluster_idx").on(t.clusterId),
  slugIdx: index("articles_slug_idx").on(t.projectId, t.slug),
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

export const articleVersions = pgTable("article_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  draftMd: text("draft_md").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  articleIdx: index("article_versions_article_idx").on(t.articleId),
}));

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

  metrics: jsonb("metrics").$type<Record<string, number>>(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("social_posts_project_idx").on(t.projectId),
  statusIdx: index("social_posts_status_idx").on(t.projectId, t.status),
  scheduledIdx: index("social_posts_scheduled_idx").on(t.scheduledAt),
  articleIdx: index("social_posts_article_idx").on(t.articleId),
}));

export type SocialPostContent =
  | { kind: "carousel"; slides: Array<{ imageUrl: string; caption?: string }>; caption: string; hashtags: string[] }
  | { kind: "reel"; videoUrl: string; coverUrl: string; caption: string; hashtags: string[] }
  | { kind: "single_image"; imageUrl: string; caption: string; hashtags: string[] }
  | { kind: "story"; imageUrl: string; durationSec?: number };
