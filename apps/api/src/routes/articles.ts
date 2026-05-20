import { zValidator } from "@hono/zod-validator";
import { COST_OPS, estimateCostEur, isProjectPaused, getPauseInfo } from "@marketing-auto/core";
import {
  type FrontmatterFieldDescriptor,
  articleVersions,
  articles,
  astroSyncRuns,
  clusters,
  contentPillars,
  costLogs,
  db,
  pagespeedRuns,
  pipelineRuns,
  projects,
  schemaExtensionRuns,
  topicBriefs,
} from "@marketing-auto/db";
import { suggestFrontmatterFields } from "../lib/frontmatter-service.ts";
import { detectDivergence } from "../lib/divergence.ts";
import {
  enqueueRefreshPipeline,
  enqueueTranslationPipeline,
  findSibling,
} from "@marketing-auto/pipelines";
import {
  continueArticleGeneration,
  enqueueArticleDraftPipeline,
  enqueueArticleGenerationLegacy as enqueueArticleGeneration,
  enqueueArticleOutlinePipeline,
  enqueueArticleSyncPipeline,
  enqueuePagespeedApiValidationPipeline,
  enqueuePagespeedValidationPipeline,
  enqueueSchemaExtensionPipeline,
  enqueueHeroImageGenerationPipeline,
  enqueueLocalizeArticlePipeline,
  slugify,
} from "@marketing-auto/pipelines";
import { ARTICLE_COLLECTION_TYPES, createLogger } from "@marketing-auto/shared";
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import yamlLib from "yaml";
import { HERO_VARIANTS, hasVariants, heroPublicPath } from "@marketing-auto/shared/hero-variants";
import { LOCAL_UPLOADS_ROOT } from "@marketing-auto/adapter-storage";
import { requireAuth } from "../middleware/auth.ts";
import { paginated, paginationQuerySchema } from "../lib/pagination.ts";
import { triggerResultToResponse, triggerWithPreRunId } from "./_lib/trigger-helpers.ts";
import { recalcPillarArticleId } from "./clusters.ts";

// ─── MDX body sanitizer ────────────────────────────────────────────────────────
/**
 * Strips JSX component tags that appear in the body without a matching import.
 * The LLM occasionally hallucinates <AuthorBox />, <ToolCard />, etc. — components
 * that are either handled by the layout (AuthorBox) or simply non-existent.
 * Regex operates on the full body to also catch multi-line tags, but deliberately
 * skips fenced code blocks (```…```) by restoring them after the strip pass.
 */
function sanitizeMdxComponents(body: string): string {
  // Collect all imported component names from the body (e.g. "HubCarousel")
  const imported = new Set<string>();
  for (const m of body.matchAll(/^import\s+(\w+)\s+from\s+['"][^'"]+['"]/gm)) {
    imported.add(m[1]!);
  }

  // Temporarily remove fenced code blocks so we don't strip tags inside them
  const codeBlocks: string[] = [];
  const withoutCode = body.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `\x00CODE_BLOCK_${codeBlocks.length - 1}\x00`;
  });

  // Strip self-closing and open/close tags for components that are NOT imported
  // and are NOT HubCarousel (added by DraftStep — always safe)
  const sanitized = withoutCode.replace(
    /<([A-Z][a-zA-Z]*)([^>]*)\/?>[\s\S]*?<\/\1>|<([A-Z][a-zA-Z]*)([^>]*)\/>/g,
    (match, openTag, _attrs, selfTag) => {
      const name = openTag ?? selfTag;
      if (!name) return match;
      if (imported.has(name)) return match; // keep imported components
      // Strip unimported component — replace with nothing (removes the whole tag)
      return "";
    }
  );

  // Restore code blocks
  return sanitized.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_, idx) => codeBlocks[Number(idx)] ?? "");
}

// ─── YAML serializer — wraps the `yaml` library for consistent output ─────────
function toYaml(obj: Record<string, unknown>): string {
  const body = yamlLib
    .stringify(obj, {
      lineWidth: -1,
      defaultStringType: "QUOTE_DOUBLE",
    })
    .trimEnd();
  return `---\n${body}\n---`;
}

// ─── shared frontmatter builder ────────────────────────────────────────────────

/**
 * Spec 50: Builds a frontmatter object that satisfies the Astro blog collection schema.
 *
 * Field priority (highest → lowest):
 * 1. article.frontmatterExtras — LLM-generated or user-edited values (category, intentType, faq, tags…)
 * 2. Schema-derived defaults — required fields get sensible defaults if not in extras
 * 3. Static article columns — title, slug, heroImage, wordCount, clusterRole, clusterKey, etc.
 *
 * When `schema` is provided the function uses it to know which fields are required
 * and which have enum constraints. Without a schema it falls back to a minimal
 * hardcoded set for the blog collection.
 */
function buildFrontmatter(
  article: {
    title: string | null;
    metaDescription: string | null;
    slug: string;
    locale: string | null;
    heroImageAltText: string | null;
    cornerstoneKeyword: string | null;
    wordCount: number | null;
    heroImagePublicUrl: string | null;
    heroImageR2Key?: string | null;
    schemaJsonLd: unknown;
    frontmatterExtras: unknown;
    clusterRole: string | null;
    clusterKey: string | null;
    // Extended DB columns (all present on the full articles row)
    translationKey?: string | null;
    author?: string | null;
    category?: string | null;
    tags?: string[] | null;
    intentType?: string | null;
    updatedAt?: Date | null;
    importMetadata?: { readingTimeMinutes?: number; wordCount?: number } | null;
  },
  cluster: { name: string; pillar: string | null } | null,
  schema?: FrontmatterFieldDescriptor[]
): Record<string, unknown> {
  const today = new Date().toISOString().split("T")[0]!;
  const locale = (article.locale as string | null) ?? "de";

  // Merge LLM/user-edited extras (may contain category, intentType, tags, faq…)
  const extras = (article.frontmatterExtras ?? {}) as Record<string, unknown>;

  // Compute readingTime string from importMetadata or wordCount
  const readingMinutes =
    article.importMetadata?.readingTimeMinutes ??
    (Math.ceil((article.wordCount ?? 0) / 250) || 1);
  const readingTime = locale === "de"
    ? `${readingMinutes} Min. Lesezeit`
    : `${readingMinutes} min read`;

  // Build the base frontmatter from static article columns
  const fm: Record<string, unknown> = {
    title: article.title ?? "",
    slug: article.slug,
    locale,
    // Toolwiki uses `date` and `updated`, not pubDate/publishedAt
    date: today,
    updated: article.updatedAt ? article.updatedAt.toISOString().split("T")[0] : today,
    heroImageAlt: article.heroImageAltText ?? "",
    // seoTitle defaults to title; extras can override with a shorter SEO variant
    seoTitle: article.title ?? "",
    // seoDescription / excerpt both default to metaDescription
    seoDescription: article.metaDescription ?? "",
    excerpt: article.metaDescription ?? "",
    // Author from DB column (set by import or user)
    ...(article.author ? { author: article.author } : {}),
    readingTime,
    featured: false,
    speakable: true,
    // Tags from DB column (lower priority than extras)
    ...(article.tags?.length ? { tags: article.tags } : {}),
    cornerstoneKeyword: article.cornerstoneKeyword ?? "",
    // Fall back to importMetadata.wordCount for imported articles where the DB column is null
    wordCount: article.wordCount ?? article.importMetadata?.wordCount ?? 0,
    draft: false,
    // Cluster role + key from article columns; fall back to cluster.name when column is null
    ...(article.clusterRole ? { clusterRole: article.clusterRole } : {}),
    ...(article.clusterKey
      ? { clusterKey: article.clusterKey }
      : cluster?.name
        ? { clusterKey: cluster.name }
        : {}),
    // intentType from dedicated DB column
    ...(article.intentType ? { intentType: article.intentType } : {}),
    // translationKey for DE/EN pair linking
    ...(article.translationKey ? { translationKey: article.translationKey } : {}),
  };

  // Apply schema-required fields with defaults if not already in extras.
  // NOTE: when the stored schema is stale/empty this loop is a no-op — the
  // safety-net below always runs to cover the common toolwiki/blog required fields.
  if (schema?.length) {
    for (const field of schema.filter((f) => f.required)) {
      if (!(field.name in extras) && !(field.name in fm)) {
        if (field.name === "pubDate") {
          fm[field.name] = today; // legacy schemas that use pubDate instead of date
        } else if (field.enumValues?.length) {
          fm[field.name] = field.enumValues[0]; // first enum value as default
        } else if (field.type === "string_array") {
          fm[field.name] = [];
        } else if (field.type === "boolean") {
          fm[field.name] = field.hasDefault ? undefined : false; // let Astro default handle it
        }
      }
    }
  }

  // Safety-net: category is required in virtually every Astro blog schema.
  if (!("category" in fm) && !("category" in extras)) {
    const catField = schema?.find((f) => f.name === "category");
    fm.category =
      (article.category as string | undefined) ??
      catField?.enumValues?.[0] ??
      "Guides & Tutorials";
  }

  // Overlay extras on top (LLM / user values win over all defaults above)
  Object.assign(fm, extras);

  // Sanitize fields against the collection schema so Astro Zod validation never
  // rejects the MDX (which silently produces a 404 instead of a render error).
  // Two cases: enum values the LLM hallucinated, and array fields with a .min()
  // constraint our schema parser doesn't extract (e.g. toolSlugs requires ≥2).
  if (schema?.length) {
    for (const field of schema) {
      if (!(field.name in fm)) continue;
      const val = fm[field.name];
      if (field.enumValues?.length && typeof val === "string" && !field.enumValues.includes(val)) {
        // Coerce to first allowed value — keeps the field populated and schema-valid
        log.warn({ field: field.name, value: val, allowed: field.enumValues }, "buildFrontmatter: coercing invalid enum value");
        fm[field.name] = field.enumValues[0];
      }
    }
  }
  // toolSlugs has a .min(2) constraint in the Astro schema (our parser doesn't
  // extract .min()). The LLM occasionally writes it with 0-1 items for non-
  // comparison articles. Remove it rather than break getStaticPaths().
  if (Array.isArray(fm.toolSlugs) && (fm.toolSlugs as unknown[]).length < 2) {
    delete fm.toolSlugs;
  }

  // Static columns that always come from DB (not overrideable via extras).
  // When variants have been generated (slug-based r2Key), use the public/gen/ path
  // so Astro serves the image from its static directory (no localhost dependency).
  // Use the slug embedded in the R2 key as the folder name — translated articles
  // (EN) share the DE hero and must point at the DE slug folder, not their own slug.
  if (article.heroImageR2Key && hasVariants(article.heroImageR2Key)) {
    const heroSourceSlug =
      article.heroImageR2Key.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? article.slug;
    fm.heroImage = heroPublicPath(heroSourceSlug);
  } else if (
    article.heroImagePublicUrl &&
    !article.heroImagePublicUrl.includes("localhost") &&
    !article.heroImagePublicUrl.includes("127.0.0.1")
  ) {
    // Only use the raw publicUrl when it is a real external/CDN URL.
    // Localhost URLs (dev-only upload server) are never written to Astro frontmatter
    // — they would break in production or in a team member's checkout.
    fm.heroImage = article.heroImagePublicUrl;
  }
  if (article.schemaJsonLd) fm.schemaJsonLd = article.schemaJsonLd;

  return fm;
}

const log = createLogger("routes:articles");

/** Extract the slug embedded in an R2 hero key, e.g. "proj/articles/hero/my-slug.webp" → "my-slug". */
function heroSourceSlugFromR2Key(r2Key: string, fallback: string): string {
  return r2Key.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? fallback;
}

/** Write a single article as MDX into the local Astro repo. Returns the slug written. */
async function writeArticleToAstroRepo(
  article: typeof import("@marketing-auto/db").articles.$inferSelect,
  repoPath: string,
  cluster: { name: string; pillar: string | null } | null,
  collectionSchema: FrontmatterFieldDescriptor[] | undefined,
  opts: { skipImages?: boolean } = {}
): Promise<void> {
  const locale = (article.locale as string | null) ?? "de";
  const collection = (article.collection as string | null) ?? "blog";
  const fm = buildFrontmatter(article, cluster, collectionSchema);
  const yamlStr = toYaml(fm);
  const strippedBody = (article.bodyMd ?? "").replace(/\s*<!--\s*FRONTMATTER_EXTRAS:[\s\S]*/g, "").trimEnd();
  const cleanBody = sanitizeMdxComponents(strippedBody);
  const mdxContent = [yamlStr, "", cleanBody].join("\n");

  const collectionDir = path.join(repoPath, "src", "content", collection, locale);
  await mkdir(collectionDir, { recursive: true });
  await Bun.write(path.join(collectionDir, `${article.slug}.mdx`), mdxContent);

  // Copy local hero images into public/gen/<slug>/
  // skipImages=true when a sibling shares the same hero (files already copied under the primary slug folder).
  if (!opts.skipImages && article.heroImagePublicUrl) {
    const rawUrl = article.heroImagePublicUrl;
    const isLocal = rawUrl.includes("localhost") || rawUrl.includes("127.0.0.1") || rawUrl.startsWith("/uploads/");
    if (isLocal) {
      try {
        const pathname = rawUrl.startsWith("http") ? new URL(rawUrl).pathname : rawUrl;
        const key = pathname.replace(/^\/uploads\//, "");
        const prefix = key.split("/").slice(0, -1).join("/");
        const uploadsRoot = LOCAL_UPLOADS_ROOT;
        const destDir = path.join(repoPath, "public", "gen", article.slug);
        await mkdir(destDir, { recursive: true });

        const srcBase = path.join(uploadsRoot, key);
        if (existsSync(srcBase)) {
          await Bun.write(path.join(destDir, "hero.webp"), await Bun.file(srcBase).arrayBuffer());
        }

        if (article.heroImageR2Key && hasVariants(article.heroImageR2Key)) {
          // Variant files on disk are named after the slug embedded in the R2 key,
          // which may differ from article.slug when this is a translated article
          // (e.g. EN article shares DE hero: R2 key "…/chatgpt-preise-2026.webp" but slug is "chatgpt-pricing-2026").
          const sourceSlug = article.heroImageR2Key.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? article.slug;
          for (const variant of HERO_VARIANTS) {
            for (const fmt of ["webp", "avif"] as const) {
              const srcVar = path.join(uploadsRoot, prefix, `${sourceSlug}${variant.suffix}.${fmt}`);
              if (existsSync(srcVar)) {
                await Bun.write(
                  path.join(destDir, `hero${variant.suffix}.${fmt}`),
                  await Bun.file(srcVar).arrayBuffer()
                );
              }
            }
          }
        }
      } catch (err) {
        log.warn({ slug: article.slug, err }, "Could not copy hero image for local preview — continuing");
      }
    }
  }
}

export const articleRoutes = new Hono();

articleRoutes.use(requireAuth);

// ─── shared types ─────────────────────────────────────────────────────────────

const VALID_ARTICLE_STATUSES = [
  "proposed", "approved", "generating", "outline_review", "drafting",
  "final_review", "schema_extending", "ready_to_publish", "validating",
  "published", "blocked_by_pagespeed", "failed", "rejected",
] as const;
type ArticleStatus = typeof VALID_ARTICLE_STATUSES[number];

// ─── list ─────────────────────────────────────────────────────────────────────

const articlesListQuerySchema = paginationQuerySchema.extend({
  projectSlug: z.string(),
  lane: z.enum(VALID_ARTICLE_STATUSES).optional(),
});

articleRoutes.get("/", zValidator("query", articlesListQuerySchema), async (c) => {
  const q = c.req.valid("query");

  c.header("X-Deprecated", "true");
  c.header("X-Replaced-By", `/api/projects/${q.projectSlug}/articles`);
  c.header("X-Deprecation-Date", "2026-05-16");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, q.projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const conditions = [eq(articles.projectId, project.id)];
  if (q.lane) conditions.push(eq(articles.status, q.lane));
  const whereClause = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
        cornerstoneKeyword: articles.cornerstoneKeyword,
        status: articles.status,
        cornerstoneSpecId: articles.cornerstoneSpecId,
        clusterId: articles.clusterId,
        clusterName: clusters.name,
        pillarId: clusters.pillarId,
        pillarName: contentPillars.name,
        pillarPosition: contentPillars.position,
        wordCount: articles.wordCount,
        publishedAt: articles.publishedAt,
        astroSyncedAt: articles.astroSyncedAt,
        createdAt: articles.createdAt,
        updatedAt: articles.updatedAt,
        locale: articles.locale,
        source: articles.source,
      })
      .from(articles)
      .leftJoin(clusters, eq(articles.clusterId, clusters.id))
      .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
      .where(whereClause)
      .orderBy(desc(articles.updatedAt))
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(articles)
      .where(whereClause),
  ]);

  return c.json({ ok: true, data: paginated(rows, countRows, q) });
});

// ─── across-projects ──────────────────────────────────────────────────────────

const acrossProjectsQuerySchema = paginationQuerySchema.extend({
  statuses: z.string(),
});

articleRoutes.get("/across-projects", zValidator("query", acrossProjectsQuerySchema), async (c) => {
  const q = c.req.valid("query");

  const requested = q.statuses.split(",").map((s) => s.trim());
  const statuses = requested.filter((s): s is ArticleStatus =>
    (VALID_ARTICLE_STATUSES as readonly string[]).includes(s)
  );
  if (statuses.length === 0) {
    return c.json({ ok: false, error: "no valid statuses" }, 400);
  }

  const whereClause = inArray(articles.status, statuses);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
        cornerstoneKeyword: articles.cornerstoneKeyword,
        status: articles.status,
        cornerstoneSpecId: articles.cornerstoneSpecId,
        projectId: articles.projectId,
        projectName: projects.name,
        projectSlug: projects.slug,
        clusterId: articles.clusterId,
        clusterName: clusters.name,
        pillarName: contentPillars.name,
        updatedAt: articles.updatedAt,
      })
      .from(articles)
      .leftJoin(projects, eq(articles.projectId, projects.id))
      .leftJoin(clusters, eq(articles.clusterId, clusters.id))
      .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
      .where(whereClause)
      .orderBy(desc(articles.updatedAt))
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(articles)
      .where(whereClause),
  ]);

  return c.json({ ok: true, data: paginated(rows, countRows, q) });
});

// ─── imported articles (Spec 44) — must be before /:id wildcard ──────────────

// GET /articles/imported/collections?projectSlug=... — counts per collection
articleRoutes.get("/imported/collections", async (c) => {
  const projectSlug = c.req.query("projectSlug");
  if (!projectSlug) return c.json({ ok: false, error: "projectSlug required" }, 400);

  c.header("X-Deprecated", "true");
  c.header("X-Replaced-By", `/api/projects/${projectSlug}/articles/imported/collections`);
  c.header("X-Deprecation-Date", "2026-05-16");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const rows = await db
    .select({
      collection: articles.collection,
      locale: articles.locale,
      count: sql<number>`count(*)::int`,
    })
    .from(articles)
    .where(and(eq(articles.projectId, project.id), eq(articles.source, "imported")))
    .groupBy(articles.collection, articles.locale);

  const summary: Record<string, { de: number; en: number; total: number }> = {};
  for (const row of rows) {
    const coll = row.collection ?? "unknown";
    summary[coll] = summary[coll] ?? { de: 0, en: 0, total: 0 };
    if (row.locale === "de") summary[coll]!.de = row.count;
    else if (row.locale === "en") summary[coll]!.en = row.count;
    summary[coll]!.total += row.count;
  }

  return c.json({ ok: true, data: summary });
});

// GET /articles/imported?projectSlug=...&collection=... — translation-pair-grouped rows (paginated by pair)
const importedQuerySchema = paginationQuerySchema.extend({
  projectSlug: z.string(),
  collection: z.string().optional(),
});

articleRoutes.get("/imported", zValidator("query", importedQuerySchema), async (c) => {
  const q = c.req.valid("query");

  c.header("X-Deprecated", "true");
  c.header("X-Replaced-By", `/api/projects/${q.projectSlug}/articles/imported`);
  c.header("X-Deprecation-Date", "2026-05-16");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, q.projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const conditions = [
    eq(articles.projectId, project.id),
    eq(articles.source, "imported"),
  ];
  if (q.collection) conditions.push(eq(articles.collection, q.collection));
  const whereClause = and(...conditions);

  // Step 1: get paginated distinct translationKeys ordered by most-recent update
  const [keyRows, countRows] = await Promise.all([
    db
      .select({
        translationKey: articles.translationKey,
      })
      .from(articles)
      .where(whereClause)
      .groupBy(articles.translationKey)
      .orderBy(desc(sql`MAX(${articles.frontmatterUpdatedAt})`))
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ count: sql<number>`count(DISTINCT ${articles.translationKey})::int` })
      .from(articles)
      .where(whereClause),
  ]);

  const keys = keyRows.map((r) => r.translationKey).filter((k): k is string => !!k);

  // Step 2: load all articles for these translationKeys
  const articleRows = keys.length > 0
    ? await db
        .select({
          id: articles.id,
          collection: articles.collection,
          locale: articles.locale,
          slug: articles.slug,
          title: articles.title,
          metaDescription: articles.metaDescription,
          translationKey: articles.translationKey,
          author: articles.author,
          category: articles.category,
          subcategory: articles.subcategory,
          tags: articles.tags,
          publishedAt: articles.publishedAt,
          frontmatterUpdatedAt: articles.frontmatterUpdatedAt,
          filePath: articles.filePath,
          frontmatterExtras: articles.frontmatterExtras,
          importMetadata: articles.importMetadata,
          lastImportedAt: articles.lastImportedAt,
          clusterKey: articles.clusterKey,
          clusterRole: articles.clusterRole,
        })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, project.id),
            eq(articles.source, "imported"),
            inArray(articles.translationKey, keys)
          )
        )
    : [];

  type ArticleRow = (typeof articleRows)[number];

  // Step 3: group into pairs, preserving key order from step 1
  const pairs = keys.map((key) => {
    const members = articleRows.filter((a) => a.translationKey === key);
    return {
      translationKey: key,
      de: members.find((m) => m.locale === "de") ?? null,
      en: members.find((m) => m.locale === "en") ?? null,
    };
  }) satisfies Array<{ translationKey: string; de: ArticleRow | null; en: ArticleRow | null }>;

  return c.json({ ok: true, data: paginated(pairs, countRows, q) });
});

// GET /articles/imported/:id — detail with translation pendant
articleRoutes.get("/imported/:id", async (c) => {
  const id = c.req.param("id");

  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.source, "imported")))
    .limit(1);

  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  let pendant = null;
  if (article.translationKey) {
    const [p] = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.projectId, article.projectId),
          eq(articles.source, "imported"),
          eq(articles.translationKey, article.translationKey),
          ne(articles.id, id)
        )
      )
      .limit(1);
    pendant = p ?? null;
  }

  return c.json({ ok: true, data: { article, pendant } });
});

// ─── pipeline-run cleanup ─────────────────────────────────────────────────────

articleRoutes.post("/pipeline-runs/fix-stuck", async (c) => {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const rows = await db
    .update(pipelineRuns)
    .set({ status: "failed", errorMessage: "Stuck run reset by admin cleanup" })
    .where(and(eq(pipelineRuns.status, "running"), lt(pipelineRuns.startedAt, thirtyMinAgo)))
    .returning({ id: pipelineRuns.id });
  log.info({ fixed: rows.length }, "Stuck pipeline runs reset by admin cleanup");
  return c.json({ ok: true, data: { fixed: rows.length } });
});

// ─── frontmatter preview + extras ─────────────────────────────────────────────

articleRoutes.get("/:id/frontmatter", async (c) => {
  const id = c.req.param("id");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [[cluster], [project]] = await Promise.all([
    article.clusterId
      ? db
          .select({ name: clusters.name, pillar: clusters.pillar })
          .from(clusters)
          .where(eq(clusters.id, article.clusterId))
          .limit(1)
      : Promise.resolve([null]),
    db
      .select({ astroCollectionSchemas: projects.astroCollectionSchemas })
      .from(projects)
      .where(eq(projects.id, article.projectId))
      .limit(1),
  ]);

  const schemas = project?.astroCollectionSchemas as Record<string, FrontmatterFieldDescriptor[]> | null;
  const collectionSchema = schemas?.["blog"] ?? undefined;

  // If frontmatterExtras is null/empty but bodyMd still contains the FRONTMATTER_EXTRAS
  // marker (LLM omitted closing -->), extract and persist it now so the panel can display
  // the fields (category, intentType, tags, faq, …) immediately without re-drafting.
  let resolvedExtras = (article.frontmatterExtras ?? {}) as Record<string, unknown>;
  const hasExtras = Object.keys(resolvedExtras).length > 0;
  if (!hasExtras && article.bodyMd) {
    const extrasStartIdx = article.bodyMd.indexOf("<!-- FRONTMATTER_EXTRAS:");
    if (extrasStartIdx !== -1) {
      const extrasRaw = article.bodyMd.slice(extrasStartIdx);
      const jsonMatch = extrasRaw.match(/<!--\s*FRONTMATTER_EXTRAS:\s*(\{[\s\S]*)/);
      if (jsonMatch?.[1]) {
        const jsonStr = jsonMatch[1].replace(/\s*-->\s*$/, "").trimEnd();
        try {
          const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
          if (Object.keys(parsed).length > 0) {
            resolvedExtras = parsed;
            // Persist so future loads are fast and DraftStep's snapshot is up-to-date
            await db
              .update(articles)
              .set({ frontmatterExtras: parsed, frontmatterUpdatedAt: new Date() })
              .where(eq(articles.id, id));
            log.info({ articleId: id }, "Backfilled frontmatterExtras from bodyMd FRONTMATTER_EXTRAS marker");
          }
        } catch {
          // JSON was malformed — skip silently
        }
      }
    }
  }

  const fm = buildFrontmatter(
    { ...article, frontmatterExtras: resolvedExtras },
    cluster ?? null,
    collectionSchema
  );
  const yaml = toYaml(fm);

  return c.json({
    ok: true,
    data: {
      yaml,
      fields: fm,
      slug: article.slug,
      extras: resolvedExtras,
      schema: collectionSchema ?? null,
    },
  });
});

// PATCH /:id/frontmatter-extras — save user-edited / LLM-suggested extras
articleRoutes.patch(
  "/:id/frontmatter-extras",
  zValidator(
    "json",
    z.object({
      extras: z.record(z.unknown()),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { extras } = c.req.valid("json");

    const [article] = await db.select({ id: articles.id }).from(articles).where(eq(articles.id, id)).limit(1);
    if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

    await db
      .update(articles)
      .set({ frontmatterExtras: extras, frontmatterUpdatedAt: new Date() })
      .where(eq(articles.id, id));

    return c.json({ ok: true, data: { saved: true } });
  }
);

// PATCH /:id/skip-translation — Spec 62.0a-followup Issue 1.
// Sets or clears articles.skip_auto_translation_until. While set to a future
// timestamp, BlogPipeline.afterComplete and RefreshPipeline.afterComplete will
// not enqueue the translation pipeline for this article. Pass `skipUntil: null`
// to clear the flag immediately.
articleRoutes.patch(
  "/:id/skip-translation",
  zValidator(
    "json",
    z.object({
      // ISO-8601 timestamp string. `null` clears the flag.
      skipUntil: z.string().datetime().nullable(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { skipUntil } = c.req.valid("json");

    const [article] = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.id, id))
      .limit(1);
    if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

    const skipUntilDate = skipUntil === null ? null : new Date(skipUntil);

    await db
      .update(articles)
      .set({ skipAutoTranslationUntil: skipUntilDate })
      .where(eq(articles.id, id));

    return c.json({
      ok: true,
      data: { articleId: id, skipAutoTranslationUntil: skipUntilDate?.toISOString() ?? null },
    });
  }
);

// POST /:id/frontmatter-suggest — Haiku-powered field suggestions
articleRoutes.post("/:id/frontmatter-suggest", async (c) => {
  const id = c.req.param("id");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [project] = await db
    .select({ astroCollectionSchemas: projects.astroCollectionSchemas })
    .from(projects)
    .where(eq(projects.id, article.projectId))
    .limit(1);

  const schemas = project?.astroCollectionSchemas as Record<string, FrontmatterFieldDescriptor[]> | null;
  const schema = schemas?.["blog"] ?? null;

  if (!schema) {
    return c.json(
      { ok: false, error: "No schema stored for this project yet. Run an Astro import first." },
      422
    );
  }

  // Use first ~600 words of body as context
  const bodyExcerpt = article.bodyMd
    ? article.bodyMd.split(/\s+/).slice(0, 600).join(" ")
    : null;

  const suggestions = await suggestFrontmatterFields({
    projectId: article.projectId,
    pipelineRunId: crypto.randomUUID(), // one-off cost-tracking run
    title: article.title,
    metaDescription: article.metaDescription,
    bodyExcerpt,
    schema,
    currentExtras: (article.frontmatterExtras ?? {}) as Record<string, unknown>,
  });

  return c.json({ ok: true, data: suggestions });
});

// ─── local Astro dev preview ──────────────────────────────────────────────────

articleRoutes.post("/:id/local-preview", async (c) => {
  const id = c.req.param("id");
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  // Read localPath + collection schemas from project
  const [project] = await db
    .select({ astroRepo: projects.astroRepo, astroCollectionSchemas: projects.astroCollectionSchemas })
    .from(projects)
    .where(eq(projects.id, article.projectId))
    .limit(1);

  const astroRepo = project?.astroRepo as {
    localPath?: string;
    collectionPaths?: Record<string, string>;
    previewPath?: string; // backward-compat fallback
  } | null;
  const schemas = project?.astroCollectionSchemas as Record<string, FrontmatterFieldDescriptor[]> | null;
  const collectionSchema = schemas?.["blog"] ?? undefined;
  const repoPath = astroRepo?.localPath ?? null;
  if (!repoPath) {
    return c.json(
      {
        ok: false,
        error:
          "No local Astro path configured. Set astroRepo.localPath on the project (e.g. via Drizzle Studio).",
      },
      422
    );
  }

  const [cluster] = article.clusterId
    ? await db
        .select({ name: clusters.name, pillar: clusters.pillar })
        .from(clusters)
        .where(eq(clusters.id, article.clusterId))
        .limit(1)
    : [null];

  // Write the requested article
  await writeArticleToAstroRepo(article, repoPath, cluster ?? null, collectionSchema);
  log.info({ slug: article.slug, locale: article.locale }, "Written article MDX to Astro repo");

  // Also write the translation sibling (if it exists and has a body)
  if (article.translationKey) {
    const [sibling] = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.translationKey, article.translationKey),
          eq(articles.projectId, article.projectId),
          ne(articles.id, article.id)
        )
      )
      .limit(1);

    if (sibling?.bodyMd) {
      const [siblingCluster] = sibling.clusterId
        ? await db
            .select({ name: clusters.name, pillar: clusters.pillar })
            .from(clusters)
            .where(eq(clusters.id, sibling.clusterId))
            .limit(1)
        : [null];

      // Skip image copy for the sibling when both articles share the same hero source slug
      // (i.e. the sibling's R2 key points to the same file already copied under the primary's folder).
      // When the sibling has its own separately-generated hero (different source slug), copy normally.
      const primarySourceSlug = article.heroImageR2Key
        ? heroSourceSlugFromR2Key(article.heroImageR2Key, article.slug)
        : null;
      const siblingSourceSlug = sibling.heroImageR2Key
        ? heroSourceSlugFromR2Key(sibling.heroImageR2Key, sibling.slug)
        : null;
      const siblingSkipImages = primarySourceSlug !== null && primarySourceSlug === siblingSourceSlug;

      await writeArticleToAstroRepo(sibling, repoPath, siblingCluster ?? null, collectionSchema, { skipImages: siblingSkipImages });
      log.info({ slug: sibling.slug, locale: sibling.locale, skipImages: siblingSkipImages }, "Written sibling article MDX to Astro repo");
    }
  }

  // Build preview URL for the requested article
  const locale = (article.locale as string | null) ?? "de";
  const collection = (article.collection as string | null) ?? "blog";
  const smartDefault = "/{locale}/{collection}/{slug}";
  const pathTemplate =
    astroRepo?.collectionPaths?.[collection] ??
    (collection === "blog" ? astroRepo?.previewPath : undefined) ??
    smartDefault;
  const previewPath = pathTemplate
    .replace("{locale}", locale)
    .replace("{collection}", collection)
    .replace("{slug}", article.slug)
    .replace(/\/?$/, "/");
  const previewUrl = `http://localhost:4321${previewPath}`;

  return c.json({
    ok: true,
    data: { url: previewUrl, slug: article.slug, repoPath },
  });
});

// ─── detail ───────────────────────────────────────────────────────────────────

articleRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [proj] = await db
    .select({ slug: projects.slug, astroRepo: projects.astroRepo })
    .from(projects)
    .where(eq(projects.id, article.projectId))
    .limit(1);

  const [cluster] = article.clusterId
    ? await db.select().from(clusters).where(eq(clusters.id, article.clusterId)).limit(1)
    : [null];

  // Look up translation sibling (same translationKey, opposite locale)
  const translationSibling = article.translationKey
    ? await db
        .select({
          id: articles.id,
          locale: articles.locale,
          status: articles.status,
          lastEditedAt: articles.lastEditedAt,
          lastSyncedFromSiblingAt: articles.lastSyncedFromSiblingAt,
        })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, article.projectId),
            eq(articles.translationKey, article.translationKey),
            ne(articles.id, article.id)
          )
        )
        .limit(1)
    : [];

  const [pillar] = cluster?.pillarId
    ? await db.select().from(contentPillars).where(eq(contentPillars.id, cluster.pillarId)).limit(1)
    : [null];

  const [recentSync, recentPagespeed, recentSchema] = await Promise.all([
    db
      .select()
      .from(astroSyncRuns)
      .where(eq(astroSyncRuns.articleId, id))
      .orderBy(desc(astroSyncRuns.startedAt))
      .limit(5),
    db
      .select()
      .from(pagespeedRuns)
      .where(eq(pagespeedRuns.articleId, id))
      .orderBy(desc(pagespeedRuns.startedAt))
      .limit(5),
    db
      .select()
      .from(schemaExtensionRuns)
      .where(eq(schemaExtensionRuns.articleId, id))
      .orderBy(desc(schemaExtensionRuns.startedAt))
      .limit(5),
  ]);

  // Fetch outline + draft pipeline runs linked to this article via FK columns
  const pipelineRunIds = [
    (article as { outlinePipelineRunId?: string | null }).outlinePipelineRunId,
    (article as { draftPipelineRunId?: string | null }).draftPipelineRunId,
  ].filter((runId): runId is string => runId != null);

  const pipelineRunsSelect = {
    id: pipelineRuns.id,
    pipelineName: pipelineRuns.pipelineName,
    status: pipelineRuns.status,
    stepName: pipelineRuns.stepName,
    startedAt: pipelineRuns.startedAt,
    completedAt: pipelineRuns.completedAt,
    errorMessage: pipelineRuns.errorMessage,
  };

  const [fkRuns, heroRuns, localizeRuns] = await Promise.all([
    pipelineRunIds.length > 0
      ? db.select(pipelineRunsSelect).from(pipelineRuns).where(inArray(pipelineRuns.id, pipelineRunIds))
      : Promise.resolve([]),
    // hero-generation: show only the 2 most recent (one current, one previous if user regenerated)
    db.select(pipelineRunsSelect).from(pipelineRuns)
      .where(and(
        eq(pipelineRuns.pipelineName, "article:hero-generation"),
        sql`${pipelineRuns.input}->>'articleId' = ${id}`,
      ))
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(2),
    // localize: only where this article is the TARGET (not the source)
    // We don't show source-article localize runs here — those belong to the sibling's page
    db.select(pipelineRunsSelect).from(pipelineRuns)
      .where(and(
        eq(pipelineRuns.pipelineName, "article:localize"),
        sql`${pipelineRuns.input}->>'targetArticleId' = ${id}`,
      ))
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(2),
  ]);

  const seenIds = new Set<string>();
  const recentPipeline = [...fkRuns, ...heroRuns, ...localizeRuns].filter((r) => {
    if (seenIds.has(r.id)) return false;
    seenIds.add(r.id);
    return true;
  });

  return c.json({
    ok: true,
    data: {
      article: {
        ...article,
        projectSlug: proj?.slug ?? null,
        projectAstroLocalPath: (proj?.astroRepo as { localPath?: string } | null)?.localPath ?? null,
        translationSibling: translationSibling[0]
          ? {
              id:     translationSibling[0].id,
              locale: translationSibling[0].locale,
              status: translationSibling[0].status,
              divergence: detectDivergence(
                article.lastEditedAt ?? null,
                article.lastSyncedFromSiblingAt ?? null,
                translationSibling[0].lastEditedAt ?? null,
                translationSibling[0].lastSyncedFromSiblingAt ?? null,
              ),
            }
          : null,
      },
      cluster,
      pillar,
      recentRuns: {
        sync: recentSync,
        pagespeed: recentPagespeed,
        schema: recentSchema,
        pipeline: recentPipeline,
      },
    },
  });
});

// ─── patch metadata ───────────────────────────────────────────────────────────

const ArticleUpdateSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  metaDescription: z.string().max(500).optional(),
  cornerstoneKeyword: z.string().min(2).max(200).optional(),
  slug: z
    .string()
    .min(2)
    .max(200)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  status: z
    .enum([
      "proposed",
      "approved",
      "generating",
      "outline_review",
      "drafting",
      "final_review",
      "schema_extending",
      "ready_to_publish",
      "validating",
      "published",
      "blocked_by_pagespeed",
      "failed",
      "rejected",
    ])
    .optional(),
});

articleRoutes.patch("/:id", zValidator("json", ArticleUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const [existing] = await db
    .select({ id: articles.id, clusterId: articles.clusterId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!existing) return c.json({ ok: false, error: "Article not found" }, 404);

  // Build update object conditionally — required by exactOptionalPropertyTypes
  const now = new Date();
  // lastEditedAt only on content-field changes — status is a workflow action, not a content edit
  const isContentEdit =
    input.title !== undefined ||
    input.metaDescription !== undefined ||
    input.cornerstoneKeyword !== undefined ||
    input.slug !== undefined;
  const patch: Record<string, unknown> = { updatedAt: now };
  if (isContentEdit) patch.lastEditedAt = now;
  if (input.title !== undefined) patch.title = input.title;
  if (input.metaDescription !== undefined) patch.metaDescription = input.metaDescription;
  if (input.cornerstoneKeyword !== undefined) patch.cornerstoneKeyword = input.cornerstoneKeyword;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.status !== undefined) patch.status = input.status;

  await db.update(articles).set(patch).where(eq(articles.id, id));

  // Recalc pillarArticleId when cornerstoneSpecId-related fields change for clustered articles
  if (existing.clusterId && input.cornerstoneKeyword !== undefined) {
    await recalcPillarArticleId(existing.clusterId);
  }

  const [updated] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  return c.json({ ok: true, data: updated });
});

// ─── body update (creates version) ───────────────────────────────────────────

const BodyUpdateSchema = z.object({
  bodyMd: z.string().max(500_000),
  changeReason: z.string().max(500).optional(),
});

articleRoutes.post("/:id/body", zValidator("json", BodyUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(version), 0)::int` })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, id));
  const nextVersion = (maxRow?.max ?? 0) + 1;

  const values: typeof articleVersions.$inferInsert = {
    articleId: id,
    version: nextVersion,
    bodyMd: input.bodyMd,
  };
  if (input.changeReason) values.changeReason = input.changeReason;

  await db.insert(articleVersions).values(values);

  const now = new Date();
  await db
    .update(articles)
    .set({
      bodyMd: input.bodyMd,
      wordCount: input.bodyMd.trim().split(/\s+/).filter(Boolean).length,
      updatedAt: now,
      lastRefreshedAt: now,
      lastEditedAt: now,
    })
    .where(eq(articles.id, id));

  return c.json({ ok: true, data: { version: nextVersion } });
});

// ─── versions list ────────────────────────────────────────────────────────────

articleRoutes.get("/:id/versions", async (c) => {
  const id = c.req.param("id");

  const [exists] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!exists) return c.json({ ok: false, error: "Article not found" }, 404);

  const versions = await db
    .select({
      id: articleVersions.id,
      version: articleVersions.version,
      changeReason: articleVersions.changeReason,
      createdAt: articleVersions.createdAt,
    })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, id))
    .orderBy(desc(articleVersions.version));

  return c.json({ ok: true, data: versions });
});

// ─── runs list ────────────────────────────────────────────────────────────────

articleRoutes.get("/:id/runs", async (c) => {
  const id = c.req.param("id");

  const [exists] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!exists) return c.json({ ok: false, error: "Article not found" }, 404);

  const rows = await db
    .select({
      id: pipelineRuns.id,
      pipelineName: pipelineRuns.pipelineName,
      status: pipelineRuns.status,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      createdAt: pipelineRuns.createdAt,
    })
    .from(pipelineRuns)
    .where(sql`${pipelineRuns.input}->>'articleId' = ${id}`)
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(50);

  const runs = rows.map((r) => ({
    id: r.id,
    pipelineName: r.pipelineName,
    status: r.status,
    createdAt: r.createdAt,
    durationMs:
      r.startedAt && r.completedAt
        ? new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()
        : null,
    costEur: null as number | null,
  }));

  return c.json({ ok: true, data: { runs } });
});

// ─── per-article cost logs ─────────────────────────────────────────────────────

articleRoutes.get("/:id/costs", async (c) => {
  const id = c.req.param("id");

  const [exists] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!exists) return c.json({ ok: false, error: "Article not found" }, 404);

  const costs = await db
    .select({
      id: costLogs.id,
      operation: costLogs.operation,
      service: costLogs.service,
      costEur: costLogs.costEur,
      createdAt: costLogs.createdAt,
    })
    .from(costLogs)
    .where(eq(costLogs.articleId, id))
    .orderBy(desc(costLogs.createdAt));

  const totalCostEur = costs.reduce((sum, c) => sum + parseFloat(c.costEur), 0);

  return c.json({ ok: true, data: { costs, totalCostEur } });
});

// ─── version body ─────────────────────────────────────────────────────────────

articleRoutes.get("/:id/versions/:version", async (c) => {
  const id = c.req.param("id");
  const version = Number.parseInt(c.req.param("version"), 10);
  if (Number.isNaN(version)) return c.json({ ok: false, error: "Invalid version number" }, 400);

  const [row] = await db
    .select()
    .from(articleVersions)
    .where(and(eq(articleVersions.articleId, id), eq(articleVersions.version, version)))
    .limit(1);
  if (!row) return c.json({ ok: false, error: "Version not found" }, 404);

  return c.json({ ok: true, data: row });
});

// ─── pipeline triggers (preRunId pattern) ─────────────────────────────────────

// ─── POST /:id/refresh ────────────────────────────────────────────────────────
// Spec 54.10 Section B: Manual refresh trigger — re-generates body_md of an existing article,
// preserving the original in article_versions before regeneration.

const RefreshBodySchema = z.object({
  reason: z.string().min(3).max(500).default("manual refresh"),
});

articleRoutes.post("/:id/refresh", async (c) => {
  const id = c.req.param("id");

  const rawBody = await c.req.json().catch(() => ({}));
  const { reason } = RefreshBodySchema.parse(rawBody);

  const [article] = await db
    .select({
      id:                 articles.id,
      projectId:          articles.projectId,
      title:              articles.title,
      slug:               articles.slug,
      cornerstoneKeyword: articles.cornerstoneKeyword,
      locale:             articles.locale,
      intentType:         articles.intentType,
      clusterId:          articles.clusterId,
      metaDescription:    articles.metaDescription,
      source:             articles.source,
      status:             articles.status,
      updatedAt:          articles.updatedAt,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);

  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);
  if (article.source !== "generated") {
    return c.json({ ok: false, error: "Only generated articles can be refreshed" }, 422);
  }

  // Check project pause before enqueuing
  if (await isProjectPaused(article.projectId)) {
    const info = await getPauseInfo(article.projectId);
    return c.json({ ok: false, error: "project_paused", data: info }, 423);
  }

  // Build refresh brief and enqueue — cost estimate: outline + draft + review
  const staleDays = article.updatedAt
    ? Math.floor((Date.now() - new Date(article.updatedAt).getTime()) / 86_400_000)
    : 0;

  // Insert the refresh brief
  const [brief] = await db
    .insert(topicBriefs)
    .values({
      projectId:      article.projectId,
      source:         "refresh_detection",
      topicTitle:     article.title ?? "",
      primaryKeyword: article.cornerstoneKeyword ?? "",
      locale:         article.locale ?? "de",
      intentType:     article.intentType,
      clusterId:      article.clusterId,
      clusterAction:  "refresh",
      suggestedTitle: article.title,
      suggestedSlug:  article.slug,
      suggestedMeta:  article.metaDescription,
      approvalStatus: "approved",
      approvedBy:     "user",
      refreshMetadata: {
        targetArticleId: article.id,
        reason,
        staleness: {
          daysSinceLastUpdate: staleDays,
          rankingChange: null,
          competitorRefreshed: false,
        },
      },
    })
    .returning();

  if (!brief) return c.json({ ok: false, error: "Failed to create refresh brief" }, 500);

  const refreshCostEur =
    estimateCostEur("anthropic", COST_OPS.REFRESH_OUTLINE) +
    estimateCostEur("anthropic", COST_OPS.REFRESH_DRAFT) +
    estimateCostEur("anthropic", COST_OPS.ARTICLE_SELF_REVIEW);

  const result = await triggerWithPreRunId({
    pipelineName: "article:refresh",
    projectId:    article.projectId,
    uniqueKey:    { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", estimatedCostEur: refreshCostEur },
    extraInput:   { articleId: article.id, briefId: brief.id },
    enqueue:      enqueueRefreshPipeline,
  });

  log.info({ articleId: id, briefId: brief.id, reason, staleDays, ...result }, "Refresh pipeline triggered");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/generate-outline", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:outline",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
    extraInput: { articleId: article.id },
    enqueue: enqueueArticleOutlinePipeline,
  });
  log.info({ articleId: id, ...result }, "Outline pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/generate-draft", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:draft",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_DRAFT },
    extraInput: { articleId: article.id },
    enqueue: enqueueArticleDraftPipeline,
  });
  log.info({ articleId: id, ...result }, "Draft pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

const generateHeroBodySchema = z.object({
  promptOverride: z.string().min(10).max(1000).optional(),
});

articleRoutes.post("/:id/generate-hero-image", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId, outline: articles.outline, slug: articles.slug })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);
  if (!article.outline) return c.json({ ok: false, error: "Article has no outline yet — generate outline first" }, 422);

  const rawBody = await c.req.json().catch(() => ({}));
  const { promptOverride } = generateHeroBodySchema.safeParse(rawBody).data ?? {};

  const result = await triggerWithPreRunId({
    pipelineName: "article:hero-generation",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: { service: "replicate", operation: COST_OPS.HERO_IMAGE },
    extraInput: {
      articleId: article.id,
      articleSlug: article.slug,
      ...(promptOverride ? { promptOverride } : {}),
    },
    enqueue: enqueueHeroImageGenerationPipeline,
  });
  log.info({ articleId: id, ...result }, "Hero image pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

// ─── localize ─────────────────────────────────────────────────────────────────

const localizeBodySchema = z.object({
  targetLocale: z.enum(["de", "en"]),
  mode: z.enum(["translate", "fresh"]).default("translate"),
});

articleRoutes.post("/:id/localize", async (c) => {
  const id = c.req.param("id");

  const [sourceArticle] = await db
    .select({
      id: articles.id,
      projectId: articles.projectId,
      locale: articles.locale,
      title: articles.title,
      slug: articles.slug,
      metaDescription: articles.metaDescription,
      cornerstoneKeyword: articles.cornerstoneKeyword,
      bodyMd: articles.bodyMd,
      translationKey: articles.translationKey,
      clusterId: articles.clusterId,
      collection: articles.collection,
      cornerstoneSpecId: articles.cornerstoneSpecId,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!sourceArticle) return c.json({ ok: false, error: "Article not found" }, 404);

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = localizeBodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.message }, 400);
  const { targetLocale, mode } = parsed.data;

  if (sourceArticle.locale === targetLocale) {
    return c.json({ ok: false, error: "Source and target locale are the same" }, 400);
  }

  if (mode === "translate" && !sourceArticle.bodyMd) {
    return c.json({ ok: false, error: "Article has no draft body — run draft pipeline first or use fresh mode" }, 422);
  }

  // Look up project slug for pipeline prompt building
  const [proj] = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, sourceArticle.projectId))
    .limit(1);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  // Ensure translationKey is set on source article (generate from slug if missing)
  let translationKey = sourceArticle.translationKey;
  if (!translationKey) {
    translationKey = slugify(sourceArticle.slug);
    await db
      .update(articles)
      .set({ translationKey, updatedAt: new Date() })
      .where(eq(articles.id, sourceArticle.id));
  }

  // Check if a translation already exists for this locale + translationKey
  const [existing] = await db
    .select({ id: articles.id, status: articles.status })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, sourceArticle.projectId),
        eq(articles.translationKey, translationKey),
        eq(articles.locale, targetLocale)
      )
    )
    .limit(1);

  let targetArticleId: string;

  if (existing) {
    // Re-use existing target article if not currently running
    if (existing.status === "generating" || existing.status === "drafting") {
      return c.json({ ok: false, error: "A localization is already in progress for this article" }, 409);
    }
    targetArticleId = existing.id;
    await db
      .update(articles)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(articles.id, targetArticleId));
  } else {
    // Create the target article stub
    const [created] = await db
      .insert(articles)
      .values({
        projectId: sourceArticle.projectId,
        clusterId: sourceArticle.clusterId,
        locale: targetLocale,
        translationKey,
        title: sourceArticle.title ?? "",
        slug: `${sourceArticle.slug}-${targetLocale}`, // temp — pipeline will overwrite
        metaDescription: sourceArticle.metaDescription,
        cornerstoneKeyword: sourceArticle.cornerstoneKeyword,
        collection: sourceArticle.collection ?? "blog",
        source: "generated",
        status: "generating",
        approvalMode: "manual",
      })
      .returning({ id: articles.id });
    targetArticleId = created!.id;
  }

  const result = await triggerWithPreRunId({
    pipelineName: "article:localize",
    projectId: sourceArticle.projectId,
    uniqueKey: { field: "targetArticleId", value: targetArticleId },
    costEstimate: { service: "anthropic", estimatedCostEur: mode === "translate" ? 1.2 : 0.05 },
    extraInput: {
      articleId: targetArticleId, // PreRunInput convention — enqueueLocalizeArticlePipeline maps this to targetArticleId
      sourceArticleId: sourceArticle.id,
      targetLocale,
      mode,
      projectSlug: proj.slug,
    },
    enqueue: enqueueLocalizeArticlePipeline,
  });

  log.info(
    { sourceArticleId: id, targetArticleId, targetLocale, mode, ...result },
    "Localize pipeline triggered via HTTP"
  );
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/sync", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:astro-sync",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    extraInput: { articleId: article.id },
    enqueue: enqueueArticleSyncPipeline,
  });
  log.info({ articleId: id, ...result }, "Astro sync triggered via HTTP");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/validate-pagespeed", async (c) => {
  const id = c.req.param("id");

  // All body fields are optional — parse manually to avoid hard-fail on missing Content-Type
  const rawBody = await c.req.json().catch(() => ({}));
  const bodySchema = z.object({
    mode: z.enum(["local", "api"]).default("local"),
    urlOverride: z.string().url().optional(),
  });
  const body = bodySchema.safeParse(rawBody).data ?? { mode: "local" as const };

  const [article] = await db
    .select({
      id: articles.id,
      projectId: articles.projectId,
      astroCommitSha: articles.astroCommitSha,
      slug: articles.slug,
      locale: articles.locale,
      collection: articles.collection,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  if (body.mode === "api") {
    let resolvedUrl: string;
    if (body.urlOverride) {
      resolvedUrl = body.urlOverride;
    } else {
      const [project] = await db
        .select({ domain: projects.domain })
        .from(projects)
        .where(eq(projects.id, article.projectId))
        .limit(1);

      if (!project?.domain) {
        return c.json(
          {
            ok: false,
            error: "no_domain",
            message:
              "API mode requires either urlOverride or projects.domain to be set. Set the production domain in project settings.",
          },
          400
        );
      }

      const cleanDomain = project.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const segments = ["https:/", cleanDomain, article.locale, article.collection, article.slug];
      resolvedUrl = segments.join("/") + "/";
    }

    const result = await triggerWithPreRunId({
      pipelineName: "article:pagespeed-validation-api",
      projectId: article.projectId,
      uniqueKey: { field: "articleId", value: article.id },
      extraInput: { articleId: article.id, url: resolvedUrl },
      enqueue: enqueuePagespeedApiValidationPipeline,
    });
    log.info({ articleId: id, mode: "api", resolvedUrl, ...result }, "PageSpeed API validation triggered");
    return triggerResultToResponse(c, result);
  }

  // local mode: existing cooldown guard + local pipeline
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const [recentRun] = await db
    .select({ startedAt: pagespeedRuns.startedAt, astroCommitSha: pagespeedRuns.astroCommitSha })
    .from(pagespeedRuns)
    .where(and(eq(pagespeedRuns.articleId, id), gte(pagespeedRuns.startedAt, fiveMinAgo)))
    .orderBy(desc(pagespeedRuns.startedAt))
    .limit(1);

  if (recentRun?.astroCommitSha && recentRun.astroCommitSha === article.astroCommitSha) {
    return c.json(
      {
        ok: false,
        error: "pagespeed_cooldown",
        message:
          "PageSpeed run too recent for unchanged content. Wait 5 minutes or sync new changes first.",
        data: { lastRunAt: recentRun.startedAt.toISOString() },
      },
      429
    );
  }

  const result = await triggerWithPreRunId({
    pipelineName: "article:pagespeed-validation",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    extraInput: { articleId: article.id },
    enqueue: enqueuePagespeedValidationPipeline,
  });
  log.info({ articleId: id, mode: "local", ...result }, "PageSpeed local validation triggered");
  return triggerResultToResponse(c, result);
});

articleRoutes.post("/:id/extend-schema", async (c) => {
  const id = c.req.param("id");
  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: "article:schema-extension",
    projectId: article.projectId,
    uniqueKey: { field: "articleId", value: article.id },
    costEstimate: {
      service: "anthropic",
      estimatedCostEur:
        estimateCostEur("anthropic", COST_OPS.SCHEMA_RICH_DETECTION) +
        estimateCostEur("anthropic", COST_OPS.SCHEMA_FAQ_BUILD) +
        estimateCostEur("anthropic", COST_OPS.SCHEMA_HOWTO_BUILD),
    },
    extraInput: { articleId: article.id },
    enqueue: enqueueSchemaExtensionPipeline,
  });
  log.info({ articleId: id, ...result }, "Schema extension triggered via HTTP");
  return triggerResultToResponse(c, result);
});

// ─── translate (manual trigger / re-sync, Spec 59.2 B.4) ─────────────────────

const TranslateBodySchema = z.object({
  force: z.boolean().optional(),
});

articleRoutes.post("/:id/translate", async (c) => {
  const id = c.req.param("id");
  const rawBody = await c.req.json().catch(() => ({}));
  const { force = false } = TranslateBodySchema.safeParse(rawBody).data ?? {};

  const [article] = await db
    .select({
      id:             articles.id,
      projectId:      articles.projectId,
      bodyMd:         articles.bodyMd,
      locale:         articles.locale,
      translationKey: articles.translationKey,
      source:         articles.source,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);

  if (!article) return c.json({ ok: false, error: "article_not_found" }, 404);

  if (!article.bodyMd) {
    return c.json({ ok: false, error: "article_not_ready", message: "Article has no body content yet" }, 422);
  }

  const existingSibling = await findSibling(article);

  if (existingSibling && !force) {
    return c.json({
      ok: false,
      error: "sibling_exists",
      message: "Sibling translation already exists. Use force=true to re-translate as manual_resync.",
      data: { siblingId: existingSibling.id },
    }, 409);
  }

  const mode = existingSibling ? "manual_resync" : "fresh_translation";

  const translationCostEur =
    estimateCostEur("anthropic", COST_OPS.TRANSLATION_DECISION) +
    estimateCostEur("anthropic", COST_OPS.TRANSLATE_DRAFT) +
    estimateCostEur("anthropic", COST_OPS.ARTICLE_SELF_REVIEW);

  const result = await triggerWithPreRunId({
    pipelineName: "article:translation",
    projectId:    article.projectId,
    uniqueKey:    { field: "sourceArticleId", value: article.id },
    costEstimate: { service: "anthropic", estimatedCostEur: translationCostEur },
    extraInput: {
      sourceArticleId: article.id,
      mode,
      ...(existingSibling ? { targetArticleId: existingSibling.id } : {}),
    },
    enqueue: enqueueTranslationPipeline,
  });

  log.info({ articleId: id, mode, siblingId: existingSibling?.id ?? null, ...result }, "Translation pipeline triggered via HTTP");
  return triggerResultToResponse(c, result);
});

// ─── continue (CLI compat) ────────────────────────────────────────────────────

const ContinueBodySchema = z.object({
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
});

articleRoutes.post("/:articleId/continue", async (c) => {
  const articleId = c.req.param("articleId");
  const rawBody = await c.req.json().catch(() => ({}));
  const bodyResult = ContinueBodySchema.safeParse(rawBody);
  const body = bodyResult.success ? bodyResult.data : {};

  const [article] = await db
    .select({ id: articles.id, projectId: articles.projectId })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!article) return c.json({ ok: false, error: "Article not found" }, 404);

  try {
    const base = { articleId: article.id, projectId: article.projectId };
    const input = body.modelOverride ? { ...base, modelOverride: body.modelOverride } : base;
    const result = await continueArticleGeneration(input);
    log.info(
      { articleId, draftJobId: result.draftJobId },
      "Article continuation enqueued via HTTP"
    );
    return c.json({ ok: true, data: result }, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: e, articleId }, "Article continuation failed");
    return c.json({ ok: false, error: msg }, 400);
  }
});

// ─── legacy generate (CLI compat, mounted at /api NOT /api/articles) ──────────
// POST /api/projects/:projectSlug/articles/generate starts with /projects/ so it
// cannot live on articleRoutes (mounted at /api/articles). Exported separately
// and mounted at /api in server.ts.

const GenerateBodySchema = z.object({
  cornerstoneSlug: z.string().min(1),
  approvalMode: z.enum(["manual", "auto"]).default("manual"),
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
  // Spec 61.1: accepted for forward-compat. This legacy route enqueues article:outline (deprecated);
  // collectionType is honored by the blog pipeline via enqueueBlogGenerationPipeline in newer routes.
  collectionType: z.enum(ARTICLE_COLLECTION_TYPES).optional().default("blog"),
});

export const legacyArticleRoutes = new Hono();

legacyArticleRoutes.use(requireAuth);

legacyArticleRoutes.post(
  "/projects/:projectSlug/articles/generate",
  zValidator("json", GenerateBodySchema),
  async (c) => {
    const projectSlug = c.req.param("projectSlug");
    const body = c.req.valid("json");

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, projectSlug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    try {
      const base = {
        cornerstoneSlug: body.cornerstoneSlug,
        projectId: project.id,
        approvalMode: body.approvalMode,
      };
      const input = body.modelOverride ? { ...base, modelOverride: body.modelOverride } : base;
      const result = await enqueueArticleGeneration(input);
      log.info(
        { projectSlug, cornerstoneSlug: body.cornerstoneSlug, articleId: result.articleId },
        "Article generation enqueued via HTTP"
      );
      return c.json({ ok: true, data: result }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(
        { err: e, projectSlug, cornerstoneSlug: body.cornerstoneSlug },
        "Article generation enqueue failed"
      );
      return c.json({ ok: false, error: msg }, 400);
    }
  }
);
