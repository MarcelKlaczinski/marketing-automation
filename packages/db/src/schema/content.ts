import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { vector } from "drizzle-orm/pg-core";
import type { ArticleCollectionType } from "@marketing-auto/shared";
import {
  articleSourceEnum,
  articleStatusEnum,
  cornerstoneSpecStatusEnum,
  socialFormatEnum,
  socialPlatformEnum,
  socialRenderStatusEnum,
  socialStatusEnum,
} from "./_enums.ts";
import { clusters } from "./identity.ts";
import { projects } from "./projects.ts";

// ArticleOutline and SelfReviewIssue shapes are defined in packages/pipelines — these
// are lightweight re-declarations for DB typing only (no Zod dependency in DB package).
export type ArticleOutline = {
  title: string;
  slug: string;
  metaDescription: string;
  introAngle: string;
  sections: Array<{
    h2: string;
    intent: string;
    keyPoints: string[];
    estimatedWords: number;
    targetKeywords: string[];
  }>;
  heroImagePrompt: string;
  heroImageStyle: "photorealistic" | "illustrated" | "3d_render" | "minimalist";
  estimatedTotalWords: number;
};

export type ImportMetadata = {
  wordCount?: number;
  readingTimeMinutes?: number;
  headings?: Array<{ level: number; text: string; id?: string }>;
  hasAffiliateLinks?: boolean;
  imageCount?: number;
  internalLinks?: string[];
};

export type SelfReviewIssue = {
  severity: "critical" | "warning" | "suggestion";
  category:
    | "voice_drift"
    | "factual_concern"
    | "weak_intro"
    | "weak_conclusion"
    | "section_imbalance"
    | "keyword_stuffing"
    | "missing_examples"
    | "verbose"
    | "other";
  location: string;
  description: string;
  suggestion?: string;
};

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id").references(() => clusters.id, { onDelete: "set null" }),
    // No DB-level FK to pipelineRuns — avoids circular dep between content.ts ↔ operations.ts
    cornerstoneSpecId: uuid("cornerstone_spec_id"),

    // Identity
    slug: text("slug").notNull(),
    // Nullable: imported articles have no cornerstone keyword
    cornerstoneKeyword: text("cornerstone_keyword"),

    // Content fields — populated incrementally by pipeline steps
    title: text("title"),
    metaDescription: text("meta_description"),
    outline: jsonb("outline").$type<ArticleOutline>(),
    bodyMd: text("body_md"),

    // Generated assets
    heroImageR2Key: text("hero_image_r2_key"),
    heroImagePublicUrl: text("hero_image_public_url"),
    heroImageAltText: text("hero_image_alt_text"),
    // Spec 64.6c: R2 key of the pre-conversion original image (PNG/JPEG/etc.).
    // NULL = input was already WebP, or row predates migration 0091 and hasn't been
    // processed by the historical-backfill script.
    heroImageOriginalR2Key: text("hero_image_original_r2_key"),
    // Spec 000 (Hero-Image-Mirror): SHA-256 (hex) over the raw source hero bytes
    // from the Astro repo. Populated by `MirrorHeroImagesStep` on import; used for
    // DE+EN sibling + cross-run dedup and the hash-equality refresh whitelist in
    // `UpsertArticlesStep`. NULL = article has never been mirrored (or predates
    // migration 0101).
    heroImageSourceSha256: text("hero_image_source_sha256"),

    /**
     * Schema.org JSON-LD — array of objects (Spec 23 extended from single
     * object in Spec 20).
     *
     * SOFT-GUARDED footgun (Spec Bucket-D / BD2, 2026-05-24).
     *
     * Written by `SchemaExtensionPipeline.PersistSchemaStep` — adds rich-type
     * JSON-LD (FAQPage, HowTo, Review) detected from the article body. Read
     * by `ArticleSyncPipeline.RenderMdxStep` and injected into the rendered
     * MDX frontmatter as `schema:` / `schemaJsonLd:` keys.
     *
     * **The footgun:**
     * 1. `POST /api/articles/:id/extend-schema` (HTTP route) is source-agnostic
     *    and can fire `SchemaExtensionPipeline` against an imported article,
     *    populating this column.
     * 2. `POST /api/articles/:id/sync` is also source-agnostic — running
     *    `ArticleSyncPipeline` against an imported article reads this column
     *    and writes it to MDX frontmatter IFF the project's Astro Zod schema
     *    declares a `schema:` or `schemaJsonLd:` field.
     * 3. Conflicts with Branch-B's design (rich types are rendered from
     *    individual frontmatter fields like `howTo:` / `faqs:`, not from
     *    pre-baked JSON-LD).
     *
     * **Why dormant today** (verified 2026-05-24 against Toolwiki):
     * No Toolwiki Astro collection declares `schema:` or `schemaJsonLd:`
     * fields, so `RenderMdxStep`'s `collectionInfo.fields` filter silently
     * drops them from the rendered MDX. The DB column may be populated, but
     * the MDX stays Branch-B-clean.
     *
     * **Activation conditions** (any one of these flips dormant → live):
     * - A future Astro schema adds `schema:` or `schemaJsonLd:` to a
     *   collection that contains imported articles
     * - `RenderMdxStep` field-filter logic changes to emit all merged keys
     *   (not just schema-declared ones)
     *
     * **Defense — Spec 004 / F3 (2026-05-24)**: Trigger-Filter now applied at
     * two layers:
     * 1. `enqueueSchemaExtension` in `packages/pipelines/src/schema-extension/trigger.ts`
     *    short-circuits with `{ skipped: 'imported-article' }` for imported
     *    rows. Covers internal `afterComplete` callers (BlogPipeline,
     *    RefreshPipeline, TranslationPipeline) plus the admin CLI
     *    `bun --filter @marketing-auto/api article:extend-schema`.
     * 2. `POST /api/articles/:id/extend-schema` in `apps/api/src/routes/articles.ts`
     *    pre-checks `source` and returns 422 with `skipped: 'imported-article'`
     *    before the pipeline trigger. Closes the original BD2 exploit path
     *    (the HTTP route uses `enqueueSchemaExtensionPipeline`, NOT
     *    `enqueueSchemaExtension`, so the trigger-layer gate alone wouldn't
     *    reach it).
     *
     * `POST /api/articles/:id/sync` (the read-side of the footgun) is still
     * source-agnostic — kept that way intentionally so an imported article
     * with a manually-populated `schema_json_ld` (e.g. from a future retrofit
     * spec) can still be synced. The MDX side stays Branch-B-clean as long
     * as no Astro collection declares `schema:` / `schemaJsonLd:` fields,
     * which the BD2 audit confirmed for Toolwiki.
     */
    schemaJsonLd: jsonb("schema_json_ld").$type<Array<Record<string, unknown>>>(),

    // Pipeline state
    status: articleStatusEnum("status").notNull().default("proposed"),
    approvalMode: text("approval_mode").$type<"manual" | "auto">().notNull().default("manual"),

    // Pipeline-run correlation (UUIDs only — no DB FK to avoid circular dep with operations.ts)
    outlinePipelineRunId: uuid("outline_pipeline_run_id"),
    draftPipelineRunId: uuid("draft_pipeline_run_id"),

    // Self-review output (written by SelfReviewStep)
    selfReviewIssues: jsonb("self_review_issues").$type<SelfReviewIssue[]>(),
    selfReviewScore: integer("self_review_score"),

    // Word count cached for queries / dashboards
    wordCount: integer("word_count"),

    // Vector embedding for internal linking (Spec 24) — 1024 dims = Voyage AI voyage-3
    embedding: vector("embedding", { dimensions: 1024 }),

    // Collection type — drives Astro content folder routing (Spec 61.1).
    // Spec multi-domain-evolution S4.2: was pgEnum articleCollectionTypeEnum,
    // now plain text with Drizzle `.$type<ArticleCollectionType>()` narrowing.
    // Per-tenant value set widens via Domain-Registry (Sprint 5); Toolwiki
    // keeps the 5-value union via the TypeScript constraint. The pgEnum type
    // itself stays in PostgreSQL for back-compat (other code may reference
    // `articleCollectionTypeEnum.enumValues` for select options etc.).
    collectionType: text("collection_type")
      .$type<ArticleCollectionType>()
      .notNull()
      .default("blog"),

    // Astro sync tracking (Spec 21)
    astroSyncedAt: timestamp("astro_synced_at", { withTimezone: true }),
    astroCommitSha: text("astro_commit_sha"),
    astroPullRequestUrl: text("astro_pull_request_url"),
    astroAssetPaths: jsonb("astro_asset_paths").$type<{ heroImage?: string }>(),
    /**
     * Forensic copy of the rendered Astro frontmatter, written by
     * `ArticleSyncPipeline.UpdateDbStatusStep` (generation → Astro-repo sync,
     * Spec 21) when an article is committed to the Astro repo. By-design
     * dormant on `source='imported'` rows — the import path
     * (`UpsertArticlesStep`) intentionally does NOT populate this column.
     *
     * No production code reads it; only `apps/api/src/scripts/discovery/`
     * audit scripts do. Investigated under Spec Bucket-D / BD1 (2026-05-24,
     * 0/318 populated rows in Toolwiki) and kept intentionally:
     * - generated-workflow tenants (Bellemann, Balkonkraftwerk) will populate
     *   it once they ship
     * - useful as a forensic "what frontmatter did we commit?" debug column
     */
    astroFrontmatter: jsonb("astro_frontmatter").$type<Record<string, unknown>>(),

    // PageSpeed validation results (Spec 22)
    pagespeedValidatedAt: timestamp("pagespeed_validated_at", { withTimezone: true }),
    pagespeedScores: jsonb("pagespeed_scores")
      .$type<{
        performance: number;
        accessibility: number;
        bestPractices: number;
        seo: number;
      } | null>()
      .default(null),
    pagespeedCoreWebVitals: jsonb("pagespeed_core_web_vitals")
      .$type<{
        lcp: number;
        inp: number | null;
        cls: number;
      } | null>()
      .default(null),
    pagespeedFailedThresholds: jsonb("pagespeed_failed_thresholds")
      .$type<string[] | null>()
      .default(null),
    pagespeedReportUrl: text("pagespeed_report_url"),
    pagespeedAstroCommitSha: text("pagespeed_astro_commit_sha"),

    publishedUrl: text("published_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    // Internal linking (Spec 24)
    internalLinksUpdatedAt: timestamp("internal_links_updated_at", { withTimezone: true }),
    internalLinksAdded: integer("internal_links_added").default(0),
    internalLinkTargets: jsonb("internal_link_targets").$type<string[]>().default([]),

    // Spec 44: source discriminator — 'generated' (pipeline) or 'imported' (Astro repo mirror)
    source: articleSourceEnum("source").notNull().default("generated"),

    // Spec 44: collection name from Astro repo (e.g. 'blog', 'tools', 'comparisons')
    // NOT NULL with default 'blog' so the (projectId, source, collection, locale, slug) unique index works
    collection: text("collection").notNull().default("blog"),

    // Spec 44: locale of the article ('de' or 'en')
    // NOT NULL with default 'de' for the same uniqueness reason
    locale: text("locale").notNull().default("de"),

    // Spec 44: links DE+EN articles that are translations of each other
    translationKey: text("translation_key"),

    // Spec 44: file path in Astro repo (e.g. 'src/content/blog/de/foo.mdx')
    filePath: text("file_path"),

    // Spec 44: git blob SHA for change-detection (imported articles only)
    gitSha: text("git_sha"),

    // Spec 44: frontmatter date fields (supplement existing publishedAt for imported articles)
    frontmatterUpdatedAt: timestamp("frontmatter_updated_at", { withTimezone: true }),

    // Spec 44: structured frontmatter columns for cross-project queries
    author: text("author"),
    category: text("category"),
    subcategory: text("subcategory"),
    tags: text("tags").array(),
    noindex: boolean("noindex").notNull().default(false),

    // Spec 49a: typed cluster metadata promoted from domainExtras
    clusterKey: text("cluster_key"),
    clusterRole: text("cluster_role").$type<"hub" | "spoke" | null>(),
    intentType: text("intent_type"),

    // Spec 54.12: cluster-generation tracking (set by enqueueBlogGeneration for hub/spoke roles)
    // Distinct from cluster_id (membership) — tracks which generation run produced this article.
    clusterGenerationId: uuid("cluster_generation_id"),
    // 'hub' | 'spoke' | null — generation role; distinct from clusterRole (Astro frontmatter field)
    role: text("role").$type<"hub" | "spoke" | null>(),

    // ─── BUCKET-C TOOLWIKI-PROMOTION (Spec 54.8 + multi-domain-evolution S4.1) ──
    //
    // Columns prefixed `tool_*` are Toolwiki-domain-specific promotions —
    // they exist on the central `articles` table for Spec 54.8 query
    // performance on the AI-tools collection. Per Phase-1 §2 / Phase-2 §2
    // (Bucket-C semantics), these fields belong to one tenant's vertical
    // and MUST be left NULL for non-Toolwiki projects.
    //
    // Domain-guard in adapter-astro-sync `buildToolColumns()` enforces this
    // at the write boundary: rows imported for projects whose industry is
    // NOT `ai_education` skip the promotion. Future per-domain promoted
    // columns follow the same pattern: a `<domain>_<field>` prefix + a
    // guard at the importer (e.g. `product_einspeisung_w` for a future
    // balkon-kraft-werk.de tenant would gate on `industry='renewable_affiliate'`).
    //
    // Sprint 5 Domain-Registry adds the `domain` axis to the lookup so
    // callers don't need to grep for these manually; until then, the
    // header comment IS the source of truth for which columns are
    // tenant-locked.
    toolPricing: text("tool_pricing"),
    toolPriceFrom: numeric("tool_price_from", { precision: 10, scale: 2 }),
    toolRating: numeric("tool_rating", { precision: 3, scale: 1 }),
    toolVotes: integer("tool_votes"),
    toolAffiliateSlug: text("tool_affiliate_slug"),
    toolWebsite: text("tool_website"),
    // ───────────────────────────────────────────────────────────────────────────

    // Spec 44: catch-all for collection-specific frontmatter fields
    domainExtras: jsonb("domain_extras")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    // Spec 44: computed metadata (wordCount, readingTime, headings, affiliateLinks, etc.)
    importMetadata: jsonb("import_metadata")
      .$type<ImportMetadata>()
      .notNull()
      .default({}),

    // Spec 44: import audit timestamps
    importedAt: timestamp("imported_at", { withTimezone: true }),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),

    // Spec E.1a: tracks when article body was last meaningfully refreshed (≠ updatedAt)
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),

    // Spec 59.2: set by translation pipeline on target article after each sync completes
    lastSyncedFromSiblingAt: timestamp("last_synced_from_sibling_at", { withTimezone: true }),
    // Spec 59.2: set by PATCH /articles/:id and POST /articles/:id/body (user edits only, NOT pipelines)
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true }),
    // Spec 62.0a: per-article auto-translation skip — BlogPipeline.afterComplete + RefreshPipeline
    // must not enqueue translation while now() < this timestamp.
    skipAutoTranslationUntil: timestamp("skip_auto_translation_until", { withTimezone: true }),

    // Spec 54.2: links article to the project_configurations row active when it was generated
    // FK declared via raw SQL migration (project-config.ts → projects.ts; no circular dep,
    // but project-config.ts is loaded after content.ts in schema/index.ts ordering)
    projectConfigVersionId: uuid("project_config_version_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index("articles_project_idx").on(t.projectId),
    clusterIdx: index("articles_cluster_idx").on(t.clusterId),
    statusIdx: index("articles_status_idx").on(t.projectId, t.status),
    cornerstoneKeywordIdx: index("articles_cornerstone_keyword_idx").on(t.cornerstoneKeyword),
    embeddingIdx: index("articles_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops")
    ),
    // Spec 005 IR1: partial unique — superseded rows are tombstones and may
    // coexist with active rows at the same key. The importer's
    // onConflictDoUpdate mirrors this predicate via `targetWhere`.
    // Replaces the pre-005 hard unique `articles_project_source_coll_locale_slug_unique`.
    sourceCollectionLocaleSlugActiveUnique: uniqueIndex(
      "articles_project_source_coll_locale_slug_active_unique"
    )
      .on(t.projectId, t.source, t.collection, t.locale, t.slug)
      .where(sql`${t.status} != 'superseded'`),
    // Spec 44: translation-pair lookups
    translationKeyIdx: index("articles_project_translation_key_idx").on(
      t.projectId,
      t.translationKey
    ),
    // Spec 44: collection filtering
    collectionLocaleIdx: index("articles_project_collection_locale_idx").on(
      t.projectId,
      t.collection,
      t.locale
    ),
    // Spec 44: source filtering
    sourceIdx: index("articles_project_source_idx").on(t.projectId, t.source),
    // Spec 45: cornerstone-spec → article lookup
    cornerstoneSpecIdx: index("articles_cornerstone_spec_id_idx").on(t.cornerstoneSpecId),
    // Spec 49a: cluster key + role filtering
    clusterKeyIdx: index("articles_cluster_key_idx").on(t.projectId, t.clusterKey),
    clusterRoleIdx: index("articles_cluster_role_idx").on(t.projectId, t.clusterRole),
    // Spec 54.12: cluster generation run filtering (completion detection + partial-retry)
    clusterGenerationIdIdx: index("articles_cluster_generation_id_idx").on(t.clusterGenerationId),
    // Spec E.1a: staleness queries for refresh detection
    lastRefreshedAtIdx: index("articles_last_refreshed_at_idx")
      .on(t.lastRefreshedAt)
      .where(sql`last_refreshed_at IS NOT NULL`),
  })
);

export type Article    = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;

export const cornerstoneSpecs = pgTable(
  "cornerstone_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),

    locale: text("locale").notNull(),
    translationKey: text("translation_key").notNull(),

    cornerstoneKeyword: text("cornerstone_keyword").notNull(),
    proposedTitle: text("proposed_title").notNull(),
    proposedSlug: text("proposed_slug").notNull(),
    metaDescription: text("meta_description").notNull(),
    estimatedWordCount: integer("estimated_word_count").notNull(),
    h2Outline: jsonb("h2_outline").$type<string[]>().notNull(),

    status: cornerstoneSpecStatusEnum("status").notNull().default("proposed"),
    rejectedReason: text("rejected_reason"),

    // No DB-level FK to articles — avoids circular dep with articles.cornerstoneSpecId
    articleId: uuid("article_id"),

    // No DB-level FK to pipelineRuns — avoids circular dep with operations.ts
    cornerstoneListPipelineRunId: uuid("cornerstone_list_pipeline_run_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clusterLocaleUnique: uniqueIndex("cornerstone_specs_cluster_locale_unique").on(
      t.clusterId,
      t.locale
    ),
    translationKeyIdx: index("cornerstone_specs_translation_key_idx").on(
      t.projectId,
      t.translationKey
    ),
    projectStatusIdx: index("cornerstone_specs_project_status_idx").on(t.projectId, t.status),
    clusterIdIdx: index("cornerstone_specs_cluster_id_idx").on(t.clusterId),
  })
);

export const articleVersions = pgTable(
  "article_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    bodyMd: text("body_md").notNull(),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    articleIdx: index("article_versions_article_idx").on(t.articleId),
  })
);

export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),

    platform: socialPlatformEnum("platform").notNull(),
    format: socialFormatEnum("format").notNull(),
    status: socialStatusEnum("status").notNull().default("draft"),

    content: jsonb("content").$type<SocialPostContent>().notNull(),

    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedUrl: text("published_url"),

    metrics: jsonb("metrics").$type<Record<string, number>>(),

    // Spec 51: social-image generation columns
    theme: text("theme").notNull().default("dark"),         // 'dark' | 'light'
    totalSlides: integer("total_slides"),
    costEur: numeric("cost_eur", { precision: 10, scale: 4 }).$type<string>().notNull().default("0"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),

    // Spec 54k: content planner columns
    templateKey: text("template_key"),  // e.g. "single-tool-spotlight" — enables dedup query
    // Spec 57.1: locale is now NOT NULL (migration 0047 backfilled existing rows to 'de-DE')
    locale: text("locale").notNull().default("de-DE"),

    // Spec 57.2: render lifecycle (orthogonal to content-lifecycle `status`)
    renderStatus: socialRenderStatusEnum("render_status").notNull().default("pending"),
    renderJobId: text("render_job_id"),
    renderStartedAt: timestamp("render_started_at", { withTimezone: true }),
    renderCompletedAt: timestamp("render_completed_at", { withTimezone: true }),
    renderError: jsonb("render_error").$type<RenderError | null>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index("social_posts_project_idx").on(t.projectId),
    statusIdx: index("social_posts_status_idx").on(t.projectId, t.status),
    scheduledIdx: index("social_posts_scheduled_idx").on(t.scheduledAt),
    articleIdx: index("social_posts_article_idx").on(t.articleId),
    templateKeyIdx: index("social_posts_template_key_idx").on(t.projectId, t.templateKey),
    articleTemplateIdx: index("social_posts_article_template_idx").on(t.articleId, t.templateKey, t.locale),
    articleLocaleStatusIdx: index("social_posts_article_locale_status_idx").on(t.articleId, t.locale, t.status),
    renderStatusActiveIdx: index("social_posts_render_status_idx")
      .on(t.renderStatus)
      .where(sql`render_status IN ('pending', 'rendering')`),
  })
);

// Snapshot of all Remotion composition inputs, persisted at INSERT time so that
// re-render (Spec 58.2) can rebuild SocialRenderJobData without re-running pipeline steps.
export type SocialPostRenderInput = {
  templateKey: string;
  locale: string;
  theme: string;
  variant: string;
  articleTitle: string;
  articleSlug: string;
  projectSlug: string;
  articleUrl: string;
  coverEyebrow: string;
  coverHeadlineLead: string;
  coverHeadlineHighlight: string;
  coverHeadlineTrail?: string;
  coverSubhead?: string;
  endHeadline: string;
  endHeadlineHighlight: string;
  resolvedTools: Array<Record<string, unknown>>;
  coverHookOutput?: Record<string, unknown>;
  endCloser?: Record<string, unknown>;
};

export type SocialPostContent =
  | {
      kind: "carousel";
      slides: Array<{ imageUrl: string; caption?: string }>;
      caption: string;
      hashtags: string[];
      warnings?: string[];
      renderInput?: SocialPostRenderInput;
    }
  | { kind: "reel"; videoUrl: string; coverUrl: string; caption: string; hashtags: string[] }
  | { kind: "single_image"; imageUrl: string; caption: string; hashtags: string[] }
  | { kind: "story"; imageUrl: string; durationSec?: number };

export type RenderError = {
  code: string;
  message: string;
  stack?: string;
  attemptedAt: string;
};

// ─── Spec 49b: Content Gap Detection ─────────────────────────────────────────

export type ContentGapMetadata = {
  clusterName?: string;                  // cluster display name
  clusterMemberCount?: number;           // total articles in cluster at detection time
  existingLocale?: "de" | "en";          // missing_translation: locale that EXISTS
  existingArticleSlug?: string;          // missing_translation: slug of existing article
  spokesPresent?: string[];              // missing_spoke_type: intent types already covered
  // Spec 49c: LLM suggestion fields (populated by /suggest endpoint)
  suggestedTitle?: string;
  suggestedSlug?: string;
  suggestedCornerstoneKeyword?: string;  // real search keyword anchored to cluster.satelliteKeywords
  suggestedMetaDescription?: string;
  suggestedHeroImagePrompt?: string;     // image generation prompt for the suggested article
  discoveredKeywords?: string[];         // keywords found via DataForSEO relatedKeywords (Path B)
};

export const contentGaps = pgTable(
  "content_gaps",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    projectId:      uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    clusterId:      uuid("cluster_id").references(() => clusters.id, { onDelete: "cascade" }),

    // Gap classification
    gapType:        text("gap_type")
      .$type<"missing_hub" | "missing_translation" | "missing_spoke_type" | "cluster_too_small">()
      .notNull(),
    locale:         text("locale"),         // missing_translation: the locale that IS missing
    intentType:     text("intent_type"),    // missing_spoke_type: which intent is absent
    translationKey: text("translation_key"), // missing_translation: key of the existing article

    // Prioritisation: 1=critical, 2=high, 3=medium
    priority:       integer("priority").notNull().default(2),

    // Lifecycle
    status:         text("status")
      .$type<"open" | "in_progress" | "resolved" | "dismissed">()
      .notNull()
      .default("open"),
    resolvedAt:     timestamp("resolved_at",  { withTimezone: true }),
    dismissedAt:    timestamp("dismissed_at", { withTimezone: true }),

    // Context for UI and future generation pipeline
    metadata:       jsonb("metadata").$type<ContentGapMetadata>().notNull().default({}),

    // Spec 49c: generation tracking
    filledByArticleId:      uuid("filled_by_article_id"),   // FK to articles (no DB-level FK — avoids circular dep)
    filledBySpecId:         uuid("filled_by_spec_id"),      // FK to cornerstone_specs
    generationTriggeredAt:  timestamp("generation_triggered_at", { withTimezone: true }),

    detectedAt:     timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt:      timestamp("created_at",  { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp("updated_at",  { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index("content_gaps_project_idx").on(t.projectId),
    clusterIdx: index("content_gaps_cluster_idx").on(t.clusterId),
    statusIdx:  index("content_gaps_status_idx").on(t.projectId, t.status),
    typeIdx:    index("content_gaps_type_idx").on(t.projectId, t.gapType),
  })
);

export type ContentGap    = typeof contentGaps.$inferSelect;
export type NewContentGap = typeof contentGaps.$inferInsert;

// ─── Spec 49d: Pipeline Chains ────────────────────────────────────────────────

export type ChainStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type ChainStep =
  | "outline"
  | "draft"
  | "schema-de"
  | "localize"
  | "schema-en"
  | "astro-transfer"
  | "blog";  // Spec 54.10: routes blog-eligible briefs through article:blog pipeline

export const pipelineChains = pgTable(
  "pipeline_chains",
  {
    id:               uuid("id").primaryKey().defaultRandom(),
    projectId:        uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    // No DB-level FK to contentGaps — avoids issues if gap is deleted mid-chain
    gapId:            uuid("gap_id"),
    // No DB-level FK to articles — avoids circular dep; article_id references the DE article
    articleId:        uuid("article_id"),
    siblingArticleId: uuid("sibling_article_id"),

    status:        text("status").$type<ChainStatus>().notNull().default("queued"),
    currentStep:   text("current_step").$type<ChainStep>(),
    failedStep:    text("failed_step").$type<ChainStep>(),
    failedAt:      timestamp("failed_at",   { withTimezone: true }),
    errorMessage:  text("error_message"),

    // Per-step pipeline_run IDs for audit: { "outline": "uuid", "draft": "uuid", ... }
    stepRuns:      jsonb("step_runs").$type<Partial<Record<ChainStep, string>>>().notNull().default({}),
    totalCostEur:  numeric("total_cost_eur", { precision: 10, scale: 4 }).notNull().default("0"),
    autoPublish:   boolean("auto_publish").notNull().default(false),

    createdAt:     timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp("updated_at",   { withTimezone: true }).notNull().defaultNow(),
    completedAt:   timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index("pipeline_chains_project_idx").on(t.projectId),
    gapIdx:     index("pipeline_chains_gap_idx").on(t.gapId),
    articleIdx: index("pipeline_chains_article_idx").on(t.articleId),
    statusIdx:  index("pipeline_chains_status_idx").on(t.projectId, t.status),
  })
);

// ─── Spec 53c: Article Discovery ──────────────────────────────────────────────

export type ArticleDiscoveryContentHooks = Record<string, unknown>;
export type ArticleDiscoverySuggestedTemplates = Array<{ templateKey: string; confidence: number }>;

export const articleDiscovery = pgTable(
  "article_discovery",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),

    // Deterministic body/structure metrics (Phase 1)
    wordCount:          integer("word_count"),
    imageCount:         integer("image_count"),
    headerCountH2:      integer("header_count_h2"),
    headerCountH3:      integer("header_count_h3"),
    headerSlugs:        text("header_slugs").array(),
    paragraphCount:     integer("paragraph_count"),
    linkCountInternal:  integer("link_count_internal"),
    linkCountExternal:  integer("link_count_external"),
    codeBlockCount:     integer("code_block_count"),
    tableCount:         integer("table_count"),
    listCountUl:        integer("list_count_ul"),
    listCountOl:        integer("list_count_ol"),
    hasAffiliateLinks:  boolean("has_affiliate_links"),

    // Normalised cross-collection fields (Phase 1)
    referencedTools:     text("referenced_tools").array(),
    containerFormHint:   text("container_form_hint"),
    completenessScore:   numeric("completeness_score", { precision: 4, scale: 3 }),
    estimatedAngles:     integer("estimated_angles"),

    // LLM-enriched fields (Phase 2, initially null)
    contentHooks:       jsonb("content_hooks").$type<ArticleDiscoveryContentHooks>().notNull().default({}),
    suggestedTemplates: jsonb("suggested_templates").$type<ArticleDiscoverySuggestedTemplates>().notNull().default([]),
    narrativeArc:       text("narrative_arc"),
    estimatedCarousels: integer("estimated_carousels"),

    // Bookkeeping
    contentHash:     text("content_hash"),
    enrichmentRunAt: timestamp("enrichment_run_at", { withTimezone: true }),
    enrichmentMode:  text("enrichment_mode"),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    articleUnique:        uniqueIndex("article_discovery_article_id_unique").on(t.articleId),
    containerFormIdx:     index("article_discovery_container_form_idx").on(t.containerFormHint),
    enrichmentModeIdx:    index("article_discovery_enrichment_mode_idx").on(t.enrichmentMode),
  })
);

export type ArticleDiscovery = typeof articleDiscovery.$inferSelect;
export type NewArticleDiscovery = typeof articleDiscovery.$inferInsert;

// ─── Spec 54a: Template Renders ───────────────────────────────────────────────

export type TemplateRenderStatus = "pending" | "rendering" | "ready" | "failed" | "superseded";

export type TemplateRenderOutputFiles = {
  slides: Array<{ filePath: string; width: number; height: number }>;
  caption: string;
  hashtags: string[];
};

export const templateRenders = pgTable(
  "template_renders",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    articleId:   uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    templateKey: text("template_key").notNull(),
    locale:      text("locale").notNull(),
    theme:       text("theme").notNull(),
    status:      text("status").$type<TemplateRenderStatus>().notNull().default("pending"),
    renderInput: jsonb("render_input").$type<Record<string, unknown>>().notNull(),
    outputFiles: jsonb("output_files").$type<TemplateRenderOutputFiles>(),
    costUsd:     numeric("cost_usd", { precision: 8, scale: 4 }),
    durationMs:  integer("duration_ms"),
    error:       text("error"),
    createdAt:   timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    // Spec 60.6: suggestion tracking for LLM template recommendation accuracy
    suggestedTemplate:    text("suggested_template"),
    suggestionConfidence: numeric("suggestion_confidence", { precision: 3, scale: 2 }),
    suggestionReason:     text("suggestion_reason"),
    userOverride:         boolean("user_override").notNull().default(false),
  },
  (t) => ({
    articleIdx:     index("template_renders_article_id_idx").on(t.articleId),
    templateKeyIdx: index("template_renders_template_key_idx").on(t.templateKey),
    statusIdx:      index("template_renders_status_idx").on(t.status),
  })
);

export type TemplateRender    = typeof templateRenders.$inferSelect;
export type NewTemplateRender = typeof templateRenders.$inferInsert;

// ─── Spec 54.1: Topic Briefs ───────────────────────────────────────────────────

// ── Source-specific metadata schemas ─────────────────────────────────────────

export const GapMetadataSchema = z.object({
  gapType: z.enum([
    "missing_hub",
    "missing_spoke_type",
    "missing_translation",
    "cluster_too_small",
  ]),
  priority: z.number().int().min(1).max(3),
  clusterName: z.string().optional(),
  clusterMemberCount: z.number().optional(),
  existingLocale: z.enum(["de", "en"]).optional(),
  existingArticleSlug: z.string().optional(),
  spokesPresent: z.array(z.string()).optional(),
  translationKey: z.string().optional(),
  suggestedCornerstoneKeyword: z.string().optional(),
  discoveredKeywords: z.array(z.string()).optional(),
});
export type GapMetadata = z.infer<typeof GapMetadataSchema>;

export const TrendMetadataSchema = z.object({
  trendScore: z.number(),
  signals: z.array(
    z.object({
      id: z.string().uuid(),
      source: z.enum([
        "producthunt",
        "hackernews",
        "reddit",
        "github",
        "vendor_rss",
        "dataforseo_trends",
      ]),
      externalId: z.string(),
      url: z.string().url().optional(),
      capturedAt: z.string(),
    }),
  ),
  freshnessWindow: z.enum(["breaking", "rising", "stable"]),
  relatedEvent: z.string().optional(),
  scoreBreakdown: z.object({
    communityBuzz: z.number(),
    searchVolumeGrowth: z.number(),
    officialAnnouncement: z.number(),
    serpVolatility: z.number(),
    existingCoveragePenalty: z.number(),
  }).optional(),
});
export type TrendMetadata = z.infer<typeof TrendMetadataSchema>;

export const RefreshMetadataSchema = z.object({
  targetArticleId: z.string().uuid(),
  reason: z.string().optional(),  // user-provided refresh reason (Spec 54.10)
  staleness: z.object({
    daysSinceLastUpdate: z.number(),
    rankingChange: z.number().nullable(),
    competitorRefreshed: z.boolean(),
  }),
});
export type RefreshMetadata = z.infer<typeof RefreshMetadataSchema>;

// Spec 62.3: comparison-pair candidates discovered by discoverComparisonPairs().
// Tool slugs are canonicalized: toolASlug < toolBSlug alphabetically. The partial
// UNIQUE index in migration 0072 reproduces this ordering for upsert idempotency.
export const ComparisonMetadataSchema = z.object({
  toolASlug: z.string(),
  toolBSlug: z.string(),
  toolAName: z.string(),
  toolBName: z.string(),
  coMentionCount: z.number().int().min(0),
  coMentionArticleIds: z.array(z.string().uuid()),
  score: z.number().min(0).max(1),
  categoryOverlap: z.boolean(),
  recencyBoost: z.number().min(0).max(1),
  reason: z.string(),
});
export type ComparisonMetadata = z.infer<typeof ComparisonMetadataSchema>;

// ── Drizzle table ─────────────────────────────────────────────────────────────

export const topicBriefs = pgTable(
  "topic_briefs",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

    source: text("source").notNull().$type<
      "gap_analysis" | "trend_discovery" | "refresh_detection" | "manual" | "comparison_discovery"
    >(),

    // FK to content_gaps declared in migration SQL (avoids circular ordering within this file)
    gapId: uuid("gap_id"),

    topicTitle:        text("topic_title").notNull(),
    primaryKeyword:    text("primary_keyword"),
    secondaryKeywords: jsonb("secondary_keywords").$type<string[]>().notNull().default([]),
    locale:            text("locale"),
    intentType:        text("intent_type"),

    clusterId:     uuid("cluster_id"),
    clusterAction: text("cluster_action").notNull().$type<
      "append_to_existing" | "create_new" | "translation" | "refresh" | "standalone" | "comparison"
    >(),

    searchVolumeDe: integer("search_volume_de"),
    searchVolumeEn: integer("search_volume_en"),
    difficulty:     integer("difficulty"),
    serpSnapshot:   jsonb("serp_snapshot"),

    suggestedTitle:  text("suggested_title"),
    suggestedSlug:   text("suggested_slug"),
    suggestedMeta:   text("suggested_meta"),
    heroImagePrompt: text("hero_image_prompt"),
    generationMode:  text("generation_mode").$type<
      "evergreen" | "timely" | "pillar" | "spoke" | "refresh" | "translation" | null
    >(),

    approvalRequired: boolean("approval_required").notNull().default(true),
    approvalStatus:   text("approval_status").notNull().default("pending").$type<
      "pending" | "plan_pending" | "approved" | "rejected" | "auto_approved" | "superseded" | "routed"
    >(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    gapMetadata:        jsonb("gap_metadata").$type<GapMetadata>(),
    trendMetadata:      jsonb("trend_metadata").$type<TrendMetadata>(),
    refreshMetadata:    jsonb("refresh_metadata").$type<RefreshMetadata>(),
    comparisonMetadata: jsonb("comparison_metadata").$type<ComparisonMetadata>(),

    // Spec 64.15 Phase C: precomputed Voyage-3 embedding (1024d). emit-brief.ts
    // (trend-discovery) writes this at brief-creation time so the planner doesn't
    // pay the Voyage call per plan-run. Lazy-backfilled via ensureEmbedding() for
    // legacy + manual + comparison_discovery briefs that bypass emit-brief.ts.
    // HNSW cosine index — see migration 0093 — also enables future
    // "find similar briefs" UI without a follow-up migration.
    embedding: vector("embedding", { dimensions: 1024 }),

    // Spec 54.3: direct FK to the article/spec created by executeDecision
    // FKs declared via raw SQL migration (54.1 convention — avoids circular ordering within this file)
    routedArticleId:         uuid("routed_article_id"),
    routedCornerstoneSpecId: uuid("routed_cornerstone_spec_id"),

    // Spec 54.12: soft back-link to the cluster created from this brief via Full Cluster flow
    routedClusterId: uuid("routed_cluster_id"),

    // Spec 63.6: audit-trail for plan_pending → routed flip. NULL when the brief
    // was routed via dispatch='immediate' (no planned_item involved).
    routedViaPlanItemId: uuid("routed_via_plan_item_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx:       index("topic_briefs_project_idx").on(t.projectId),
    projectStatusIdx: index("topic_briefs_project_status_idx").on(t.projectId, t.approvalStatus),
    projectSourceIdx: index("topic_briefs_project_source_idx").on(t.projectId, t.source),
  }),
);

// ── TopicBrief Zod schema (public insert contract) ───────────────────────────

export const TopicBriefInsertSchema = z
  .object({
    projectId: z.string().uuid(),
    source: z.enum([
      "gap_analysis",
      "trend_discovery",
      "refresh_detection",
      "manual",
      "comparison_discovery", // Spec 62.3
    ]),
    gapId: z.string().uuid().nullable().optional(),

    topicTitle:        z.string().min(3).max(300),
    primaryKeyword:    z.string().nullable().optional(),
    secondaryKeywords: z.array(z.string()).default([]),
    locale:            z.enum(["de", "en"]).nullable().optional(),
    intentType:        z.string().nullable().optional(),

    clusterId:     z.string().uuid().nullable().optional(),
    clusterAction: z.enum([
      "append_to_existing",
      "create_new",
      "translation",
      "refresh",
      "standalone",
      "comparison", // Spec 62.3
    ]),

    searchVolumeDe: z.number().int().nullable().optional(),
    searchVolumeEn: z.number().int().nullable().optional(),
    difficulty:     z.number().int().nullable().optional(),
    serpSnapshot:   z.unknown().nullable().optional(),

    suggestedTitle:  z.string().nullable().optional(),
    suggestedSlug:   z.string().nullable().optional(),
    suggestedMeta:   z.string().nullable().optional(),
    heroImagePrompt: z.string().nullable().optional(),
    generationMode:  z
      .enum(["evergreen", "timely", "pillar", "spoke", "refresh", "translation"])
      .nullable()
      .optional(),

    approvalRequired: z.boolean().default(true),
    approvalStatus:   z
      .enum(["pending", "plan_pending", "approved", "rejected", "auto_approved", "superseded", "routed"])
      .default("pending"),
    approvedBy: z.string().nullable().optional(),
    approvedAt: z.date().nullable().optional(),

    gapMetadata:        GapMetadataSchema.nullable().optional(),
    trendMetadata:      TrendMetadataSchema.nullable().optional(),
    refreshMetadata:    RefreshMetadataSchema.nullable().optional(),
    comparisonMetadata: ComparisonMetadataSchema.nullable().optional(),

    // Spec 64.15 Phase C: precomputed Voyage-3 embedding for plan diversity.
    // Optional + nullable: emit-brief.ts (trend-discovery) populates this at
    // brief creation; other sources (manual, comparison-discovery, gap-detection)
    // rely on lazy-backfill via the diversity provider's first read.
    embedding: z.array(z.number()).length(1024).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const hasGap        = data.gapMetadata        != null;
    const hasTrend      = data.trendMetadata      != null;
    const hasRefresh    = data.refreshMetadata    != null;
    const hasComparison = data.comparisonMetadata != null;
    const total         = (hasGap ? 1 : 0) + (hasTrend ? 1 : 0) + (hasRefresh ? 1 : 0) + (hasComparison ? 1 : 0);

    if (data.source === "manual") {
      if (total !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "manual source must have no source-specific metadata",
        });
      }
      return;
    }

    if (total !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `source '${data.source}' requires exactly one matching metadata field`,
      });
      return;
    }

    const expectedMap = {
      gap_analysis:          hasGap,
      trend_discovery:       hasTrend,
      refresh_detection:     hasRefresh,
      comparison_discovery:  hasComparison,
    } as const;

    if (!expectedMap[data.source as keyof typeof expectedMap]) {
      const fieldName = {
        gap_analysis:         "gap_metadata",
        trend_discovery:      "trend_metadata",
        refresh_detection:    "refresh_metadata",
        comparison_discovery: "comparison_metadata",
      }[data.source as keyof typeof expectedMap];
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `source '${data.source}' requires '${fieldName}' to be set`,
      });
    }

    // gapId must be set iff source='gap_analysis'
    if (data.source === "gap_analysis" && !data.gapId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "gap_analysis briefs require gapId" });
    }
    if (data.source !== "gap_analysis" && data.gapId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only gap_analysis briefs may set gapId" });
    }

    // Spec 62.3: canonicalize toolASlug < toolBSlug for comparison_discovery
    if (data.source === "comparison_discovery" && data.comparisonMetadata) {
      const { toolASlug, toolBSlug } = data.comparisonMetadata;
      if (toolASlug >= toolBSlug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `comparison_discovery requires toolASlug < toolBSlug (got '${toolASlug}', '${toolBSlug}')`,
        });
      }
    }
  });

export type TopicBriefInsert = z.infer<typeof TopicBriefInsertSchema>;

// ── external_signals ─────────────────────────────────────────────────────────
// Raw signals fetched by adapter packages (producthunt, hackernews, vendor_rss).
// Dedup key: (source, external_id). FK to topic_briefs declared via raw SQL migration
// (54.1 convention: avoids circular Drizzle import ordering within this file).

export type ExternalSignalSource =
  | "producthunt"
  | "hackernews"
  | "vendor_rss"
  | "reddit"
  | "github"
  | "dataforseo_trends";

export const externalSignals = pgTable(
  "external_signals",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    projectId:  uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

    source:     text("source").notNull().$type<ExternalSignalSource>(),
    externalId: text("external_id").notNull(),

    title:       text("title").notNull(),
    url:         text("url"),
    summary:     text("summary"),
    author:      text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    rawPayload: jsonb("raw_payload").notNull().$type<Record<string, unknown>>(),
    metrics:    jsonb("metrics").notNull().default({}).$type<Record<string, number>>(),

    collectedAt:   timestamp("collected_at",  { withTimezone: true }).notNull().defaultNow(),
    processedAt:   timestamp("processed_at",  { withTimezone: true }),
    processedInto: uuid("processed_into"),
    expiredAt:     timestamp("expired_at",    { withTimezone: true }),
  },
  (t) => ({
    sourceExternalUnique: uniqueIndex("external_signals_source_external_unique").on(t.source, t.externalId),
    projectSourceIdx:     index("external_signals_project_source_idx").on(t.projectId, t.source),
  }),
);

export type ExternalSignal    = typeof externalSignals.$inferSelect;
export type NewExternalSignal = typeof externalSignals.$inferInsert;
export type TopicBrief       = typeof topicBriefs.$inferSelect;

// ── rejected_topic_candidates ─────────────────────────────────────────────────
// Topics that were evaluated during trend synthesis but rejected. 30-day expiry
// allows the same topic to resurface if signals rebuild momentum.
// FK to articles(id) declared via raw SQL migration (same 54.1 circular-import rule).

export type RejectedTopicReason =
  | "existing_coverage"
  | "low_score"
  | "excluded_by_scope"
  | "low_signal_volume"
  | "manual_dismissal";

export const rejectedTopicCandidates = pgTable(
  "rejected_topic_candidates",
  {
    id:                       uuid("id").primaryKey().defaultRandom(),
    projectId:                uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

    topicTitle:               text("topic_title").notNull(),
    candidateTitleNormalized: text("candidate_title_normalized").notNull(),

    reason:                   text("reason").notNull().$type<RejectedTopicReason>(),
    trendScore:               integer("trend_score"),
    similarityScore:          numeric("similarity_score", { precision: 4, scale: 3 }),
    matchedArticleId:         uuid("matched_article_id"),

    sourceSignalIds:          jsonb("source_signal_ids").$type<string[]>().notNull(),

    rejectedAt:               timestamp("rejected_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt:                timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    projectActiveIdx:  index("rejected_topic_candidates_project_active_idx").on(t.projectId, t.expiresAt),
    normalizedIdx:     index("rejected_topic_candidates_normalized_idx").on(t.projectId, t.candidateTitleNormalized),
  }),
);

export type RejectedTopicCandidate    = typeof rejectedTopicCandidates.$inferSelect;
export type NewRejectedTopicCandidate = typeof rejectedTopicCandidates.$inferInsert;
