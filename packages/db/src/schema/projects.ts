import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import {
  credentialServiceEnum,
  industryEnum,
  lifecycleStageEnum,
  pipelineTemplateEnum,
} from "./_enums.ts";

export const projects = pgTable(
  "projects",
  {
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
    monetizationConfig: jsonb("monetization_config")
      .$type<MonetizationConfig>()
      .notNull()
      .default({}),
    pipelineConfig: jsonb("pipeline_config").$type<PipelineConfig>().notNull().default({}),
    costLimits: jsonb("cost_limits").$type<CostLimits>().notNull().default({}),

    marketingContextMd: text("marketing_context_md"),
    marketingContextUpdatedAt: timestamp("marketing_context_updated_at", { withTimezone: true }),

    // Target locales for Cold-Start pipelines (Phase 2 + 3 locale-aware prompts)
    targetLocales: jsonb("target_locales").$type<string[]>().notNull().default(["de-DE"]),

    // Niche tag for Cold-Start competitor + cluster hints (Phase 2 + 3)
    // e.g. "ai-tool-wiki", "automotive-dealer", "solar-energy" — null = generic fallback
    targetNiche: text("target_niche"),

    // Astro repo config for Spec 21 sync adapter (null = not wired up yet)
    astroRepo: jsonb("astro_repo").$type<AstroRepoConfig>(),

    // Internal linking budget (Spec 24) — max EUR/month for cluster link-rebuild runs
    linkRebuildBudgetMonthly: numeric("link_rebuild_budget_monthly", { precision: 10, scale: 2 })
      .$type<string>()
      .default("30.00"),

    // PageSpeed thresholds (Spec 22) — all scores 0-100; defaults match local-build expectations
    pagespeedThresholds: jsonb("pagespeed_thresholds")
      .$type<PagespeedThresholds>()
      .notNull()
      .default({
        performance: 85,
        accessibility: 90,
        bestPractices: 90,
        seo: 95,
      }),

    // Spec 49b: timestamp of last content-gap detection run (zero-cost step)
    gapsLastDetectedAt: timestamp("gaps_last_detected_at", { withTimezone: true }),

    // Spec 50: Astro content collection schemas extracted during import.
    // Keyed by collection name ("blog", "ki-wissen", etc.) → array of field descriptors.
    // Updated on every successful astro:repo-import run.
    astroCollectionSchemas: jsonb("astro_collection_schemas").$type<AstroCollectionSchemas>(),

    // Spec 49d: if true, automation chain triggers Astro-Transfer automatically after Schema-EN.
    // Default false (safe for new projects). Set true for toolwiki via migration 0024.
    autoPublish: boolean("auto_publish").notNull().default(false),

    // Spec 54.10: if true, Blog Pipeline auto-triggers EN translation after DE article completes.
    // Default true. Set false per project to opt out of auto-translation.
    translationAutoTrigger: boolean("translation_auto_trigger").notNull().default(true),

    // Spec 51: Visual brand tokens for social-image generation (colors, typography, voice, social handles)
    brandTokens: jsonb("brand_tokens").$type<BrandTokens>().notNull().default({}),

    // Spec 57.1: controls future auto-pipeline locale rendering. 'one' = canonical only, 'all' = all targetLocales.
    // Stored but unused today — manual UI gives per-trigger choice; this setting is for Phase E automation.
    socialAutoRenderLocales: text("social_auto_render_locales").notNull().default("one"),

    // Spec 56.6: Discovery automation config
    trendsCronEnabled: boolean("trends_cron_enabled").notNull().default(false),
    refreshCronEnabled: boolean("refresh_cron_enabled").notNull().default(false),
    qualityAnalysisCronEnabled: boolean("quality_analysis_cron_enabled").notNull().default(false),
    autoApproveGaps: boolean("auto_approve_gaps").notNull().default(false),
    refreshStalenessThresholdDays: integer("refresh_staleness_threshold_days").notNull().default(90),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: index("projects_slug_idx").on(t.slug),
  })
);

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

// Spec 51: Visual brand tokens for social-image generation
export type BrandTokens = {
  colors?: {
    primary?: string;
    primaryHue?: number;
    accent?: string;
    surface?: string;
    surfaceDark?: string;
    ink?: string;
    inkMuted?: string;
    wikiCream?: string;
  };
  typography?: {
    fontFamily?: string;
    fontFamilyOptions?: string[];
    headingWeight?: number;
    bodyWeight?: number;
    eyebrowWeight?: number;
    captionWeight?: number;
    eyebrowLetterSpacing?: string;
    headingLetterSpacing?: string;
    bodyLetterSpacing?: string;
    headingSize?: number;
    subheadSize?: number;
    bodySize?: number;
    eyebrowSize?: number;
    headingLineHeight?: number;
    bodyLineHeight?: number;
  };
  voice?: {
    locale?: string;
    addressForm?: string;
    forbiddenWords?: string[];
    signaturePhrases?: string[];
  };
  social?: {
    instagramHandle?: string;
    websiteUrl?: string;
    logoAssetKey?: string;
  };
};

// Spec 50: Frontmatter schema descriptor for a single field in an Astro collection
export type FrontmatterFieldDescriptor = {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "image" | "string_array" | "object_array" | "object" | "unknown";
  required: boolean;
  hasDefault: boolean;
  /** Enum values for z.enum([...]) fields, e.g. ["Guides & Tutorials", "Tool-Reviews", ...] */
  enumValues?: string[];
  /** Human-readable description of the object shape, e.g. for faq: "{ question: string, answer: string }[]" */
  objectShape?: string;
};

// Keyed by Astro collection name → fields
export type AstroCollectionSchemas = Record<string, FrontmatterFieldDescriptor[]>;

export const projectCredentials = pgTable(
  "project_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    service: credentialServiceEnum("service").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectServiceUnique: unique("project_credentials_project_service_unique").on(
      t.projectId,
      t.service
    ),
    projectIdx: index("project_credentials_project_idx").on(t.projectId),
  })
);
