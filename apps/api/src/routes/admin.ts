import { pruneOldNotifications } from "@marketing-auto/core/notifications";
import { articleDiscovery, articles, db, templateRenders } from "@marketing-auto/db";
import { and, eq, inArray, isNotNull, sql } from "@marketing-auto/db";
import type { Article, ArticleDiscovery } from "@marketing-auto/db";
import { templateRegistry } from "@marketing-auto/social/templates";
import type { TemplateKey } from "@marketing-auto/social/templates";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { Hono } from "hono";
import IORedis from "ioredis";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth.ts";

const log = createLogger("admin-templates");

// ── Redis singleton (lazy-init, 1h TTL for preview cache) ──────────────────
let _previewRedis: IORedis | null = null;
function getPreviewRedis(): IORedis {
  if (_previewRedis) return _previewRedis;
  const env = getEnv();
  _previewRedis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _previewRedis;
}
const PREVIEW_CACHE_TTL = 3600; // 1 hour

// ── Helpers ────────────────────────────────────────────────────────────────

function previewCacheKey(templateKey: string, fixtureKey: string, theme: string, locale: string): string {
  return `tmpl-preview:v1:${templateKey}:${fixtureKey}:${theme}:${locale}`;
}

// Convert absolute filesystem path to /renders/... URL for the frontend.
// writeSlides returns absolute paths under process.cwd()/renders/...
function filePathToUrl(filePath: string): string {
  const cwd = process.cwd();
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  const relative = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
  return `/${relative.replace(/\\/g, "/")}`;
}

// Minimal mock article for fixture renders — only id and slug are accessed by render functions.
function createMockArticle(fixtureKey: string, locale: string): Article {
  const now = new Date();
  return {
    id: `preview-${fixtureKey}`,
    slug: fixtureKey,
    title: `Preview: ${fixtureKey}`,
    collection: "comparisons",
    locale,
    projectId: "00000000-0000-0000-0000-000000000001",
    status: "draft",
    approvalMode: "manual",
    source: "generated",
    collectionType: "blog",
    noindex: false,
    internalLinksAdded: 0,
    internalLinkTargets: [],
    frontmatterExtras: {},
    frontmatterSchema: [],
    schemaExtensions: {},
    importMetadata: {},
    createdAt: now,
    updatedAt: now,
    clusterId: null,
    cornerstoneSpecId: null,
    cornerstoneKeyword: null,
    outline: null,
    draft: null,
    seoTitle: null,
    seoDescription: null,
    heroImageUrl: null,
    heroImagePrompt: null,
    heroImageStorageKey: null,
    selfReviewIssues: null,
    selfReviewScore: null,
    wordCount: null,
    embedding: null,
    astroSyncedAt: null,
    astroCommitSha: null,
    astroPullRequestUrl: null,
    astroAssetPaths: null,
    astroFrontmatter: null,
    pagespeedValidatedAt: null,
    pagespeedScores: null,
    pagespeedCoreWebVitals: null,
    pagespeedFailedThresholds: null,
    pagespeedReportUrl: null,
    pagespeedAstroCommitSha: null,
    publishedUrl: null,
    publishedAt: null,
    internalLinksUpdatedAt: null,
    translationKey: null,
    filePath: null,
    gitSha: null,
    frontmatterUpdatedAt: null,
    author: null,
    category: null,
    subcategory: null,
    tags: null,
    clusterKey: null,
    clusterRole: null,
    intentType: null,
    outlinePipelineRunId: null,
    draftPipelineRunId: null,
    importedAt: null,
    lastImportedAt: null,
  } as unknown as Article;
}

// Minimal mock discovery — eligibility predicates for fixture renders are skipped.
function createMockDiscovery(): ArticleDiscovery {
  const now = new Date();
  return {
    id: "00000000-0000-0000-0000-000000000002",
    articleId: "00000000-0000-0000-0000-000000000000",
    wordCount: null,
    imageCount: null,
    headerCountH2: null,
    headerCountH3: null,
    headerSlugs: null,
    paragraphCount: null,
    linkCountInternal: null,
    linkCountExternal: null,
    codeBlockCount: null,
    tableCount: null,
    listCountUl: null,
    listCountOl: null,
    hasAffiliateLinks: null,
    referencedTools: null,
    containerFormHint: null,
    completenessScore: null,
    estimatedAngles: null,
    contentHooks: {},
    suggestedTemplates: [],
    narrativeArc: null,
    estimatedCarousels: null,
    contentHash: null,
    enrichmentRunAt: null,
    enrichmentMode: null,
    createdAt: now,
    updatedAt: now,
  } as unknown as ArticleDiscovery;
}

export const adminRoutes = new Hono();
adminRoutes.use(requireAuth);

adminRoutes.post("/prune-notifications", async (c) => {
  const result = await pruneOldNotifications();
  return c.json({ ok: true, data: result });
});

// Spec 54c: notification counts for admin header badge
const countsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
});

adminRoutes.get("/notification-counts", zValidator("query", countsQuerySchema), async (c) => {
  const { projectId } = c.req.valid("query");

  // Articles with pending suggestions (have suggested_templates but no ready/rendering renders)
  const articleConditions = [
    isNotNull(articles.projectId),
    sql`jsonb_typeof(${articleDiscovery.suggestedTemplates}) = 'array'`,
    sql`jsonb_array_length(${articleDiscovery.suggestedTemplates}) > 0`,
  ];
  if (projectId) {
    articleConditions.push(eq(articles.projectId, projectId));
  }

  const pendingSuggestionsResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articleDiscovery)
    .innerJoin(articles, eq(articleDiscovery.articleId, articles.id))
    .where(
      and(
        ...articleConditions,
        sql`NOT EXISTS (
          SELECT 1 FROM ${templateRenders} tr
          WHERE tr.article_id = ${articleDiscovery.articleId}
            AND tr.status IN ('ready', 'rendering')
        )`
      )
    );

  const pendingSuggestions = pendingSuggestionsResult[0]?.count ?? 0;

  return c.json({ ok: true, data: { pendingSuggestions } });
});

// ── Spec 54d: Template Preview Gallery ────────────────────────────────────

// GET /admin/templates — list all registered templates with fixture metadata
adminRoutes.get("/templates", (c) => {
  const templates = templateRegistry.list();
  return c.json({
    ok: true,
    data: {
      templates: templates.map((t) => ({
        key: t.key,
        displayName: t.displayName,
        description: t.description,
        defaultSlideCount: t.defaultSlideCount,
        estimatedCostUsd: t.estimatedCostUsd,
        fixtures: Object.entries(t.mockFixtures).map(([key, f]) => ({
          key,
          name: f.name,
          description: f.description,
        })),
      })),
    },
  });
});

const previewBodySchema = z.object({
  source: z.enum(["fixture", "sample-article"]),
  fixtureKey: z.string().optional(),
  sampleArticleId: z.string().uuid().optional(),
  theme: z.enum(["dark", "light"]),
  locale: z.enum(["de", "en"]),
  force: z.boolean().optional(),
});

const previewQuerySchema = z.object({
  force: z.coerce.boolean().optional(),
});

// POST /admin/templates/:key/preview — render with mock fixture or sample article
adminRoutes.post(
  "/templates/:key/preview",
  zValidator("query", previewQuerySchema),
  async (c) => {
    const rawBody = await c.req.json().catch(() => ({}));
    const bodyResult = previewBodySchema.safeParse(rawBody);
    if (!bodyResult.success) {
      return c.json({ ok: false, error: bodyResult.error.message }, 400);
    }
    const body = bodyResult.data;
    const { force: forceQuery } = c.req.valid("query");
    const force = body.force ?? forceQuery ?? false;

    const templateKey = c.req.param("key");
    let template;
    try {
      template = templateRegistry.getById(templateKey as TemplateKey);
    } catch {
      return c.json({ ok: false, error: `Template "${templateKey}" not found` }, 404);
    }

    if (body.source === "fixture") {
      if (!body.fixtureKey) {
        return c.json({ ok: false, error: "fixtureKey required when source=fixture" }, 400);
      }
      const fixture = template.mockFixtures[body.fixtureKey];
      if (!fixture) {
        return c.json({ ok: false, error: `Fixture "${body.fixtureKey}" not found` }, 404);
      }

      const cacheKey = previewCacheKey(templateKey, body.fixtureKey, body.theme, body.locale);
      const redis = getPreviewRedis();

      if (!force) {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return c.json({ ok: true, data: { ...JSON.parse(cached), cacheKey, fromCache: true } });
        }
      }

      const mockArticle = createMockArticle(body.fixtureKey, body.locale);
      const mockDiscovery = createMockDiscovery();

      const renderContext = {
        article: mockArticle,
        discovery: mockDiscovery,
        locale: body.locale,
        theme: body.theme,
        input: fixture.input,
      };

      log.info({ templateKey, fixtureKey: body.fixtureKey, theme: body.theme, locale: body.locale }, "Rendering fixture preview");

      let result;
      try {
        result = await template.render(renderContext as Parameters<typeof template.render>[0]);
      } catch (err) {
        log.error({ err }, "Fixture render failed");
        return c.json({ ok: false, error: `Render failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
      }

      // Convert absolute file paths to /renders/... URLs
      const slides = result.slides.map((s) => ({ ...s, filePath: filePathToUrl(s.filePath) }));
      const responseData = { slides, caption: result.caption, hashtags: result.hashtags, metadata: result.metadata, cacheKey, fromCache: false };

      await redis.setex(cacheKey, PREVIEW_CACHE_TTL, JSON.stringify(responseData));

      return c.json({ ok: true, data: responseData });
    }

    // source === 'sample-article'
    if (!body.sampleArticleId) {
      return c.json({ ok: false, error: "sampleArticleId required when source=sample-article" }, 400);
    }

    const [articleRow] = await db.select().from(articles).where(eq(articles.id, body.sampleArticleId)).limit(1);
    if (!articleRow) {
      return c.json({ ok: false, error: "Article not found" }, 404);
    }
    const [discoveryRow] = await db.select().from(articleDiscovery).where(eq(articleDiscovery.articleId, body.sampleArticleId)).limit(1);
    if (!discoveryRow) {
      return c.json({ ok: false, error: "Article discovery not found — run discovery first" }, 404);
    }

    const eligibility = template.eligibility(
      articleRow as Article,
      discoveryRow as ArticleDiscovery,
    );
    if (!eligibility.eligible) {
      return c.json({ ok: false, error: `Template not eligible for this article: ${eligibility.reason ?? "unknown reason"}` }, 400);
    }

    let input: unknown;
    try {
      input = await template.buildInput(articleRow as Article, discoveryRow as ArticleDiscovery);
    } catch (err) {
      log.error({ err }, "buildInput failed for sample article");
      return c.json({ ok: false, error: `buildInput failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }

    const renderContext = {
      article: articleRow as Article,
      discovery: discoveryRow as ArticleDiscovery,
      locale: body.locale,
      theme: body.theme,
      input,
    };

    log.info({ templateKey, articleId: body.sampleArticleId, theme: body.theme, locale: body.locale }, "Rendering sample-article preview");

    let result;
    try {
      result = await template.render(renderContext as Parameters<typeof template.render>[0]);
    } catch (err) {
      log.error({ err }, "Sample article render failed");
      return c.json({ ok: false, error: `Render failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }

    const slides = result.slides.map((s) => ({ ...s, filePath: filePathToUrl(s.filePath) }));
    const cacheKey = `tmpl-preview:v1:${templateKey}:sample:${body.sampleArticleId}:${body.theme}:${body.locale}`;
    return c.json({ ok: true, data: { slides, caption: result.caption, hashtags: result.hashtags, metadata: result.metadata, cacheKey, fromCache: false } });
  },
);

const eligibleArticlesQuerySchema = z.object({
  locale: z.enum(["de", "en"]).optional().default("de"),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

// GET /admin/templates/:key/eligible-articles — list articles that pass template eligibility
adminRoutes.get(
  "/templates/:key/eligible-articles",
  zValidator("query", eligibleArticlesQuerySchema),
  async (c) => {
    const templateKey = c.req.param("key");
    let template;
    try {
      template = templateRegistry.getById(templateKey as TemplateKey);
    } catch {
      return c.json({ ok: false, error: `Template "${templateKey}" not found` }, 404);
    }

    const { locale, limit } = c.req.valid("query");

    const allArticles = await db
      .select()
      .from(articles)
      .where(eq(articles.locale, locale))
      .limit(limit);

    const articleIds = allArticles.map((a) => a.id);
    const discoveries =
      articleIds.length > 0
        ? await db
            .select()
            .from(articleDiscovery)
            .where(inArray(articleDiscovery.articleId, articleIds))
        : [];

    const discoveryMap = new Map(discoveries.map((d) => [d.articleId, d]));

    const eligible = allArticles.filter((article) => {
      const discovery = discoveryMap.get(article.id);
      if (!discovery) return false;
      return template.eligibility(article as Article, discovery as ArticleDiscovery).eligible;
    });

    return c.json({
      ok: true,
      data: {
        articles: eligible.map((a) => ({
          id: a.id,
          slug: a.slug,
          title: a.title,
          collection: a.collection,
        })),
      },
    });
  },
);
