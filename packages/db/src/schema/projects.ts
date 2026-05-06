import { pgTable, uuid, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { lifecycleStageEnum, pipelineTemplateEnum, industryEnum, credentialServiceEnum } from "./_enums.ts";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain"),
  industry: industryEnum("industry").notNull(),
  lifecycleStage: lifecycleStageEnum("lifecycle_stage").notNull().default("cold_start"),
  pipelineTemplate: pipelineTemplateEnum("pipeline_template").notNull(),

  brandIdentity: jsonb("brand_identity").$type<BrandIdentity>().notNull().default({}),
  targetAudience: jsonb("target_audience").$type<TargetAudience>().notNull().default({}),
  cmsConfig: jsonb("cms_config").$type<CmsConfig>().notNull().default({}),
  monetizationConfig: jsonb("monetization_config").$type<MonetizationConfig>().notNull().default({}),
  pipelineConfig: jsonb("pipeline_config").$type<PipelineConfig>().notNull().default({}),
  costLimits: jsonb("cost_limits").$type<CostLimits>().notNull().default({}),

  marketingContextMd: text("marketing_context_md"),
  marketingContextUpdatedAt: timestamp("marketing_context_updated_at", { withTimezone: true }),

  // Astro repo config for Spec 21 sync adapter (null = not wired up yet)
  astroRepo: jsonb("astro_repo").$type<AstroRepoConfig>(),

  // PageSpeed thresholds (Spec 22) — all scores 0-100; defaults match local-build expectations
  pagespeedThresholds: jsonb("pagespeed_thresholds").$type<PagespeedThresholds>().notNull().default({
    performance: 85,
    accessibility: 90,
    bestPractices: 90,
    seo: 95,
  }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: index("projects_slug_idx").on(t.slug),
}));

export type BrandIdentity = {
  voice?: string;
  tone?: string;
  forbiddenPhrases?: string[];
  signaturePhrases?: string[];
  pronounStyle?: "du" | "sie";
  anglicismPolicy?: "avoid" | "pragmatic" | "embrace";
  humorLevel?: "dry" | "pragmatic" | "pointed";
};

export type TargetAudience = {
  primaryPersona?: string;
  language?: string;
  region?: string;
};

export type CmsConfig = {
  type?: "astro" | "wordpress" | "custom";
  repoUrl?: string;
  contentPath?: string;
  deployWebhookUrl?: string;
  baseUrl?: string;
};

export type MonetizationConfig = {
  adsenseEnabled?: boolean;
  affiliatePrograms?: Array<{
    name: string;
    network: string;
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
  daily?: Record<string, number>;
  monthly?: Record<string, number>;
  alertAtPercent?: number;
  killAtPercent?: number;
};

export type AstroRepoConfig = {
  owner: string;
  name: string;
  installationId: number;
  defaultBranch: string;
  contentRoot: string;
  assetsRoot: string;
};

export type PagespeedThresholds = {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
};

export const projectCredentials = pgTable("project_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  service: credentialServiceEnum("service").notNull(),
  encryptedPayload: text("encrypted_payload").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectServiceUnique: unique("project_credentials_project_service_unique").on(t.projectId, t.service),
  projectIdx: index("project_credentials_project_idx").on(t.projectId),
}));
