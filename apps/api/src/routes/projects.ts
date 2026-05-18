import { zValidator } from "@hono/zod-validator";
import { checkCostBudget, DEFAULT_COST_LIMITS, getPauseInfo, isProjectPaused, resumeProjectQueues, COST_OPS } from "@marketing-auto/core";
import { articles, astroImportRuns, clusters, contentGaps, costLogs, cronState, db, eq, and, desc, gte, inArray, pipelineChains, pipelineRuns, projectConfigurations, projects, sql, topicBriefs, TopicScopeSchema } from "@marketing-auto/db";
import { DetectContentGapsStep, enqueueRepoImport } from "@marketing-auto/adapter-astro-sync/import";
import type { StepContext } from "@marketing-auto/pipelines/engine";
import { enqueueArticleOutlinePipeline, enqueueBlogGenerationPipeline, decideRoute, executeDecision } from "@marketing-auto/pipelines";
import { enqueueDiscoveryJob } from "../workers/discoveryWorker.ts";
import { syncCronJobs } from "../workers/cron-orchestrator.ts";
import { triggerWithPreRunId } from "./_lib/trigger-helpers.ts";
import { suggestGapTitle } from "../lib/gap-service.ts";
import { startChain, resumeChain, cancelChain, isBlogEligible } from "../lib/chain-orchestrator.ts";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { paginated, paginationQuerySchema } from "../lib/pagination.ts";
import { requireAuth } from "../middleware/auth.ts";
import {
  checkTriggerAllowed,
  guardErrorToResponse,
} from "./_lib/trigger-helpers.ts";

const log = createLogger("routes:projects");

export const projectRoutes = new Hono();

projectRoutes.use(requireAuth);

async function getProjectStats(projectId: string) {
  const [clusterCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clusters)
    .where(eq(clusters.projectId, projectId));

  const articleCountsByStatus = await db
    .select({
      status: articles.status,
      count: sql<number>`count(*)::int`,
    })
    .from(articles)
    .where(eq(articles.projectId, projectId))
    .groupBy(articles.status);

  const articleCounts: Record<string, number> = {};
  for (const row of articleCountsByStatus) {
    articleCounts[row.status] = row.count;
  }

  return {
    clusterCount: clusterCountRow?.count ?? 0,
    articleCounts,
    totalArticles: Object.values(articleCounts).reduce((a, b) => a + b, 0),
  };
}

projectRoutes.get("/", async (c) => {
  const allProjects = await db.select().from(projects);

  const enriched = await Promise.all(
    allProjects.map(async (proj) => ({
      id: proj.id,
      slug: proj.slug,
      name: proj.name,
      domain: proj.domain,
      industry: proj.industry,
      lifecycleStage: proj.lifecycleStage,
      pipelineTemplate: proj.pipelineTemplate,
      marketingContextMd: proj.marketingContextMd,
      astroRepo: proj.astroRepo,
      pagespeedThresholds: proj.pagespeedThresholds,
      linkRebuildBudgetMonthly: proj.linkRebuildBudgetMonthly,
      costLimits: proj.costLimits,
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
      stats: await getProjectStats(proj.id),
    }))
  );

  return c.json({ ok: true, data: enriched });
});

// ─── GET /picker — lightweight project list with activity indicators ──────────
// Must be registered BEFORE /:slug to avoid Hono matching "picker" as a slug.
projectRoutes.get("/picker", async (c) => {
  const allProjects = await db
    .select({ id: projects.id, slug: projects.slug, name: projects.name, industry: projects.industry })
    .from(projects);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const activeStatuses: Array<"running" | "queued"> = ["running", "queued"];

  const [runningRows, failedRows, costRows, articleCountRows] = await Promise.all([
    db
      .select({ projectId: pipelineRuns.projectId, count: sql<number>`COUNT(*)::int` })
      .from(pipelineRuns)
      .where(inArray(pipelineRuns.status, activeStatuses))
      .groupBy(pipelineRuns.projectId),

    db
      .select({ projectId: pipelineRuns.projectId, count: sql<number>`COUNT(*)::int` })
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.status, "failed"), gte(pipelineRuns.createdAt, dayAgo)))
      .groupBy(pipelineRuns.projectId),

    db
      .select({ projectId: costLogs.projectId, total: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)` })
      .from(costLogs)
      .where(gte(costLogs.createdAt, monthStart))
      .groupBy(costLogs.projectId),

    db
      .select({ projectId: articles.projectId, count: sql<number>`COUNT(*)::int` })
      .from(articles)
      .where(eq(articles.source, "generated"))
      .groupBy(articles.projectId),
  ]);

  const runningMap = Object.fromEntries(runningRows.map((r) => [r.projectId, r.count]));
  const failedMap = Object.fromEntries(failedRows.map((r) => [r.projectId, r.count]));
  const costMap = Object.fromEntries(costRows.map((r) => [r.projectId, Number(r.total)]));
  const articleMap = Object.fromEntries(articleCountRows.map((r) => [r.projectId, r.count]));

  return c.json({
    ok: true,
    data: allProjects.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      industry: p.industry,
      activity: {
        runningCount: runningMap[p.id] ?? 0,
        failedLast24h: failedMap[p.id] ?? 0,
      },
      stats: {
        articleCount: articleMap[p.id] ?? 0,
        costThisMonthEur: costMap[p.id] ?? 0,
      },
    })),
  });
});

projectRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const [proj] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  return c.json({
    ok: true,
    data: {
      id: proj.id,
      slug: proj.slug,
      name: proj.name,
      domain: proj.domain,
      industry: proj.industry,
      lifecycleStage: proj.lifecycleStage,
      pipelineTemplate: proj.pipelineTemplate,
      marketingContextMd: proj.marketingContextMd,
      astroRepo: proj.astroRepo,
      pagespeedThresholds: proj.pagespeedThresholds,
      linkRebuildBudgetMonthly: proj.linkRebuildBudgetMonthly,
      costLimits: proj.costLimits,
      translationAutoTrigger: proj.translationAutoTrigger,
      autoPublish: proj.autoPublish,
      targetLocales: proj.targetLocales,
      socialAutoRenderLocales: proj.socialAutoRenderLocales,
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
      stats: await getProjectStats(proj.id),
    },
  });
});

const createProjectSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(120),
  industry: z.enum([
    "ai_education",
    "automotive_dealer",
    "renewable_affiliate",
    "music_school",
    "other",
  ]),
  pipelineTemplate: z.enum([
    "educational",
    "affiliate_review",
    "local_business",
    "programmatic_seo",
  ]),
  marketingContextMd: z.string().max(50_000).optional(),
});

projectRoutes.post("/", zValidator("json", createProjectSchema), async (c) => {
  const input = c.req.valid("json");

  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, input.slug))
    .limit(1);

  if (existing) return c.json({ ok: false, error: "Slug already in use" }, 409);

  const [created] = await db
    .insert(projects)
    .values({
      slug: input.slug,
      name: input.name,
      industry: input.industry,
      pipelineTemplate: input.pipelineTemplate,
      marketingContextMd: input.marketingContextMd ?? "",
      costLimits: DEFAULT_COST_LIMITS,
    })
    .returning();

  if (created) {
    await db.insert(projectConfigurations).values({
      projectId: created.id,
      version: 1,
      status: "active",
      activatedAt: new Date(),
      intentTaxonomyDefault: ["comparison", "pricing", "alternatives", "use_case"],
      masterPrompts: {},
      topicScope: TopicScopeSchema.parse({ languages: ["de", "en"] }),
      signalSources: {
        producthunt: false,
        hackernews: { enabled: false, queries: [], hitsPerPage: 50, minPoints: 5 },
        reddit: { enabled: false, subreddits: [] },
        github: false,
        vendor_rss: { enabled: false, feeds: [] },
        dataforseo_trends: false,
      },
      automationRules: [],
    });
  }

  return c.json({ ok: true, data: created }, 201);
});

const updateProjectSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  domain: z.string().nullable().optional(),
  industry: z
    .enum(["ai_education", "automotive_dealer", "renewable_affiliate", "music_school", "other"])
    .optional(),
  pipelineTemplate: z
    .enum(["educational", "affiliate_review", "local_business", "programmatic_seo"])
    .optional(),
  marketingContextMd: z.string().max(50_000).optional(),
  costLimits: z
    .object({
      daily: z.record(z.number().nonnegative()).optional(),
      monthly: z.record(z.number().nonnegative()).optional(),
    })
    .optional(),
  astroRepo: z
    .object({
      owner: z.string().min(1),
      name: z.string().min(1),
      installationId: z.number().int().positive(),
      defaultBranch: z.string().default("main"),
      contentRoot: z.string().default("src/content"),
      assetsRoot: z.string().default("src/assets"),
      // Local filesystem path for dev preview — optional, machine-specific
      localPath: z.string().min(1).optional(),
      // Per-collection URL path templates, e.g. { "blog": "/{locale}/blog/{slug}" }
      // Smart default when absent: /{locale}/{collection}/{slug}
      collectionPaths: z.record(z.string().min(1)).optional(),
      // Backward-compat: old single previewPath (used as blog fallback when no collectionPaths)
      previewPath: z.string().min(1).optional(),
    })
    .nullable()
    .optional(),
  pagespeedThresholds: z
    .object({
      performance: z.number().min(0).max(100),
      accessibility: z.number().min(0).max(100),
      bestPractices: z.number().min(0).max(100),
      seo: z.number().min(0).max(100),
    })
    .optional(),
  linkRebuildBudgetMonthly: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  translationAutoTrigger: z.boolean().optional(),
  // Spec 57.1: auto-pipeline locale setting. 'one' = canonical only, 'all' = all targetLocales
  socialAutoRenderLocales: z.enum(["one", "all"]).optional(),
  // Discovery automation (Spec 56.6 / 58.1)
  trendsCronEnabled: z.boolean().optional(),
  refreshCronEnabled: z.boolean().optional(),
  qualityAnalysisCronEnabled: z.boolean().optional(),
  autoApproveGaps: z.boolean().optional(),
  refreshStalenessThresholdDays: z.number().int().min(7).max(365).optional(),
});

projectRoutes.patch("/:slug", zValidator("json", updateProjectSchema), async (c) => {
  const slug = c.req.param("slug");
  const input = c.req.valid("json");

  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!existing) return c.json({ ok: false, error: "Project not found" }, 404);

  // Build update object conditionally — exactOptionalPropertyTypes forbids spreading optional fields directly
  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) setFields.name = input.name;
  if (input.domain !== undefined) setFields.domain = input.domain;
  if (input.industry !== undefined) setFields.industry = input.industry;
  if (input.pipelineTemplate !== undefined) setFields.pipelineTemplate = input.pipelineTemplate;
  if (input.marketingContextMd !== undefined)
    setFields.marketingContextMd = input.marketingContextMd;
  if (input.costLimits !== undefined) setFields.costLimits = input.costLimits;
  if (input.astroRepo !== undefined) setFields.astroRepo = input.astroRepo;
  if (input.pagespeedThresholds !== undefined)
    setFields.pagespeedThresholds = input.pagespeedThresholds;
  if (input.linkRebuildBudgetMonthly !== undefined)
    setFields.linkRebuildBudgetMonthly = input.linkRebuildBudgetMonthly;
  if (input.translationAutoTrigger !== undefined)
    setFields.translationAutoTrigger = input.translationAutoTrigger;
  if (input.socialAutoRenderLocales !== undefined)
    setFields.socialAutoRenderLocales = input.socialAutoRenderLocales;
  if (input.trendsCronEnabled !== undefined) setFields.trendsCronEnabled = input.trendsCronEnabled;
  if (input.refreshCronEnabled !== undefined) setFields.refreshCronEnabled = input.refreshCronEnabled;
  if (input.qualityAnalysisCronEnabled !== undefined) setFields.qualityAnalysisCronEnabled = input.qualityAnalysisCronEnabled;
  if (input.autoApproveGaps !== undefined) setFields.autoApproveGaps = input.autoApproveGaps;
  if (input.refreshStalenessThresholdDays !== undefined)
    setFields.refreshStalenessThresholdDays = input.refreshStalenessThresholdDays;

  await db
    .update(projects)
    // biome-ignore lint/suspicious/noExplicitAny: Record<string,unknown> is structurally incompatible with Drizzle's strict partial column type; conditional build ensures only valid keys are present
    .set(setFields as any)
    .where(eq(projects.id, existing.id));

  // Sync cron_state rows when cron flags change so orchestrator picks up changes within seconds
  const cronChanges: Array<{ jobType: "trends_synthesizer" | "refresh_detector" | "quality_analysis"; isActive: boolean }> = [];
  if (input.trendsCronEnabled !== undefined)
    cronChanges.push({ jobType: "trends_synthesizer", isActive: input.trendsCronEnabled });
  if (input.refreshCronEnabled !== undefined)
    cronChanges.push({ jobType: "refresh_detector", isActive: input.refreshCronEnabled });
  if (input.qualityAnalysisCronEnabled !== undefined)
    cronChanges.push({ jobType: "quality_analysis", isActive: input.qualityAnalysisCronEnabled });

  if (cronChanges.length > 0) {
    const defaultPatterns: Record<string, string> = {
      trends_synthesizer: "30 1 * * *",
      refresh_detector: "0 2 * * *",
      quality_analysis: "0 3 * * *",
    };
    for (const { jobType, isActive } of cronChanges) {
      await db
        .insert(cronState)
        .values({
          projectId: existing.id,
          jobType,
          isActive,
          cronPattern: defaultPatterns[jobType]!,
        })
        .onConflictDoUpdate({
          target: [cronState.projectId, cronState.jobType],
          set: { isActive, updatedAt: new Date() },
        });
    }
    void syncCronJobs();
  }

  const [updated] = await db.select().from(projects).where(eq(projects.id, existing.id)).limit(1);

  return c.json({ ok: true, data: updated });
});

// ─── Pause / Resume ───────────────────────────────────────────────────────────

projectRoutes.get("/:slug/pause-state", async (c) => {
  const slug = c.req.param("slug");
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const info = await getPauseInfo(proj.id);
  return c.json({ ok: true, data: info });
});

projectRoutes.post("/:slug/resume-queues", async (c) => {
  const slug = c.req.param("slug");
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const user = c.get("user") as { id: string } | undefined;
  await resumeProjectQueues(proj.id, user?.id);

  return c.json({ ok: true, data: { resumed: true } });
});

// Spec 44: Astro repo import trigger
const astroImportBodySchema = z.object({
  forceAll: z.boolean().default(false),
});

projectRoutes.post("/:slug/astro-import", async (c) => {
  const slug = c.req.param("slug");

  const rawBody = await c.req.json().catch(() => ({}));
  const { forceAll } = astroImportBodySchema.safeParse(rawBody).data ?? { forceAll: false };

  const [project] = await db
    .select({ id: projects.id, astroRepo: projects.astroRepo })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
  if (!project.astroRepo) {
    return c.json({ ok: false, error: "astroRepo not configured for this project" }, 400);
  }

  // Enforce pause + idempotency (GitHub API has no per-call cost → no cost estimate)
  const guard = await checkTriggerAllowed({
    pipelineName: "astro:repo-import",
    projectId: project.id,
    uniqueKey: { field: "projectId", value: project.id },
  });
  if (guard !== null) {
    if ("error" in guard) return guardErrorToResponse(c, guard);
    // Deduped: find the existing active import run to return its ID
    const [activeRun] = await db
      .select({ id: astroImportRuns.id })
      .from(astroImportRuns)
      .where(
        and(
          eq(astroImportRuns.projectId, project.id),
          inArray(astroImportRuns.status, ["pending", "running"])
        )
      )
      .limit(1);
    return c.json(
      { ok: true, data: { importRunId: activeRun?.id ?? guard.runId, jobId: guard.jobId, deduped: true } },
      200
    );
  }

  try {
    const { importRunId, jobId } = await enqueueRepoImport({
      projectId: project.id,
      triggerSource: "manual",
      forceAll,
    });
    return c.json({ ok: true, data: { importRunId, jobId } }, 202);
  } catch (e) {
    log.error({ error: e, slug }, "Failed to enqueue repo import");
    return c.json({ ok: false, error: (e as Error).message }, 500);
  }
});

// Spec 44: List recent import runs for a project
const importRunsQuerySchema = paginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

projectRoutes.get(
  "/:slug/astro-import-runs",
  zValidator("query", importRunsQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const whereClause = eq(astroImportRuns.projectId, project.id);

    const [runs, countRows] = await Promise.all([
      db
        .select()
        .from(astroImportRuns)
        .where(whereClause)
        .orderBy(desc(astroImportRuns.startedAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(astroImportRuns)
        .where(whereClause),
    ]);

    return c.json({ ok: true, data: paginated(runs, countRows, q) });
  }
);

// Spec 54c: Trigger discovery after import run completes
const triggerDiscoveryBodySchema = z.object({
  mode: z.enum(["deterministic_only", "full"]).default("full"),
});

projectRoutes.post("/:slug/astro-import/:importRunId/trigger-discovery", requireAuth, async (c) => {
  const slug = c.req.param("slug");
  const importRunId = c.req.param("importRunId");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [run] = await db
    .select()
    .from(astroImportRuns)
    .where(and(eq(astroImportRuns.id, importRunId), eq(astroImportRuns.projectId, project.id)))
    .limit(1);
  if (!run) return c.json({ ok: false, error: "Import run not found" }, 404);

  const rawBody = await c.req.json().catch(() => ({}));
  const { mode } = triggerDiscoveryBodySchema.safeParse(rawBody).data ?? { mode: "full" as const };

  // Find articles imported during this run by their importedAt timestamp
  const importedArticles = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, project.id),
        eq(articles.source, "imported"),
        run.startedAt ? sql`${articles.importedAt} >= ${run.startedAt.toISOString()}` : sql`true`,
        run.finishedAt ? sql`${articles.importedAt} <= ${run.finishedAt.toISOString()}` : sql`true`,
      )
    );

  const jobs = await Promise.all(
    importedArticles.map((a) =>
      enqueueDiscoveryJob({ articleId: a.id, projectId: project.id, mode })
    )
  );

  log.info({ importRunId, enqueued: jobs.length, mode }, "Discovery jobs enqueued after import");
  return c.json({ ok: true, data: { enqueued: jobs.length, mode } }, 202);
});

// ── Spec 49b: Content Gap Detection ──────────────────────────────────────────

// POST /:slug/detect-gaps — trigger on-demand (synchronous, zero-cost)
projectRoutes.post("/:slug/detect-gaps", async (c) => {
  const slug = c.req.param("slug");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const step = new DetectContentGapsStep();
  const ctx: StepContext = {
    projectId:      project.id,
    pipelineRunId:  "00000000-0000-0000-0000-000000000000",
    stepRunId:      "00000000-0000-0000-0000-000000000000",
    pipelineName:   "detect-content-gaps",
    log:            log as StepContext["log"],
    reportProgress: async () => { /* on-demand: no-op */ },
    getStepOutput:  () => undefined,
  };
  const result = await step.execute({ projectId: project.id }, ctx);

  return c.json({ ok: true, data: result }, 200);
});

// GET /:slug/content-gaps — list open/in_progress gaps with optional filters
const gapsQuerySchema = paginationQuerySchema.extend({
  limit:     z.coerce.number().int().min(1).max(200).default(50),
  status:    z.enum(["open", "in_progress", "resolved", "dismissed"]).optional(),
  gapType:   z
    .enum(["missing_hub", "missing_translation", "missing_spoke_type", "cluster_too_small"])
    .optional(),
  priority:  z.coerce.number().int().min(1).max(3).optional(),
  clusterId: z.string().uuid().optional(),
});

projectRoutes.get(
  "/:slug/content-gaps",
  zValidator("query", gapsQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q    = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id, gapsLastDetectedAt: projects.gapsLastDetectedAt })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const conditions = [eq(contentGaps.projectId, project.id)];
    if (q.status)    conditions.push(eq(contentGaps.status, q.status));
    if (q.gapType)   conditions.push(eq(contentGaps.gapType, q.gapType));
    if (q.priority)  conditions.push(eq(contentGaps.priority, q.priority));
    if (q.clusterId) conditions.push(eq(contentGaps.clusterId, q.clusterId));

    // Default: open + in_progress
    if (!q.status) {
      const activeStatuses: Array<"open" | "in_progress"> = ["open", "in_progress"];
      conditions.push(inArray(contentGaps.status, activeStatuses));
    }

    const where = and(...conditions);

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(contentGaps)
        .where(where)
        .orderBy(contentGaps.priority, desc(contentGaps.detectedAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(contentGaps)
        .where(where),
    ]);

    return c.json({
      ok: true,
      data: {
        ...paginated(rows, countRows, q),
        gapsLastDetectedAt: project.gapsLastDetectedAt,
      },
    });
  }
);

// PATCH /:slug/content-gaps/:id — update status (dismiss / mark in_progress / resolve)
const gapPatchSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "dismissed"]),
});

projectRoutes.patch(
  "/:slug/content-gaps/:id",
  zValidator("json", gapPatchSchema),
  async (c) => {
    const slug   = c.req.param("slug");
    const gapId  = c.req.param("id");
    const body   = c.req.valid("json");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const now = new Date();
    const setFields: Partial<typeof contentGaps.$inferInsert> = {
      status:    body.status,
      updatedAt: now,
    };
    if (body.status === "resolved")  setFields.resolvedAt  = now;
    if (body.status === "dismissed") setFields.dismissedAt = now;

    const updated = await db
      .update(contentGaps)
      .set(setFields)
      .where(
        and(
          eq(contentGaps.projectId, project.id),
          eq(contentGaps.id, gapId)
        )
      )
      .returning({ id: contentGaps.id });

    if (updated.length === 0) return c.json({ ok: false, error: "Gap not found" }, 404);

    // Spec 54.1: mirror resolve/dismiss → supersede any active briefs for this gap
    if (body.status === "resolved" || body.status === "dismissed") {
      const activeStatuses: Array<"pending" | "approved" | "auto_approved"> = [
        "pending", "approved", "auto_approved",
      ];
      await db
        .update(topicBriefs)
        .set({ approvalStatus: "superseded", updatedAt: now })
        .where(
          and(
            eq(topicBriefs.gapId, gapId),
            inArray(topicBriefs.approvalStatus, activeStatuses),
          )
        );
    }

    return c.json({ ok: true, data: { id: gapId, status: body.status } });
  }
);

// ── Spec 49c: Gap-to-Article Generation ──────────────────────────────────────

// POST /:slug/content-gaps/batch
// NOTE: registered before /:slug/content-gaps/:id/* so Hono doesn't treat "batch" as an ID
const batchBodySchema = z.object({
  action:  z.enum(["dismiss", "suggest-all"]),
  filters: z
    .object({
      gapType:  z
        .enum(["missing_hub", "missing_translation", "missing_spoke_type", "cluster_too_small"])
        .optional(),
      priority: z.coerce.number().int().min(1).max(3).optional(),
    })
    .optional(),
  gapIds: z.array(z.string().uuid()).optional(),
});

projectRoutes.post("/:slug/content-gaps/batch", async (c) => {
  const slug    = c.req.param("slug");
  const rawBody = await c.req.json().catch(() => ({}));
  const parsed  = batchBodySchema.safeParse(rawBody);
  if (!parsed.success)
    return c.json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, 400);
  const body = parsed.data;

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  // Build WHERE for matching open gaps
  const activeStatuses: Array<"open" | "in_progress"> = ["open", "in_progress"];
  const conditions = [
    eq(contentGaps.projectId, project.id),
    inArray(contentGaps.status, activeStatuses),
  ];
  if (body.filters?.gapType)  conditions.push(eq(contentGaps.gapType, body.filters.gapType));
  if (body.filters?.priority) conditions.push(eq(contentGaps.priority, body.filters.priority));

  // If explicit gapIds given, restrict to those
  if (body.gapIds && body.gapIds.length > 0) {
    conditions.push(inArray(contentGaps.id, body.gapIds));
  }

  const where = and(...conditions);

  if (body.action === "dismiss") {
    const rows = await db
      .update(contentGaps)
      .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
      .where(where)
      .returning({ id: contentGaps.id });
    return c.json({ ok: true, data: { affected: rows.length } });
  }

  // suggest-all: load gaps, run suggest for each (max 20)
  const SUGGEST_BATCH_LIMIT = 20;
  const gapRows = await db
    .select({
      id:        contentGaps.id,
      gapType:   contentGaps.gapType,
      clusterId: contentGaps.clusterId,
      intentType: contentGaps.intentType,
      locale:    contentGaps.locale,
      metadata:  contentGaps.metadata,
    })
    .from(contentGaps)
    .where(where)
    .limit(SUGGEST_BATCH_LIMIT);

  let affected = 0;
  for (const gap of gapRows) {
    const suggestion = await suggestGapTitle({
      projectId: project.id,
      gap,
    });
    if (!suggestion) continue;
    await db
      .update(contentGaps)
      .set({
        metadata: {
          ...gap.metadata,
          suggestedTitle:           suggestion.title,
          suggestedSlug:            suggestion.slug,
          suggestedMetaDescription: suggestion.metaDescription,
          suggestedHeroImagePrompt: suggestion.heroImagePrompt,
          ...(suggestion.cornerstoneKeyword  ? { suggestedCornerstoneKeyword: suggestion.cornerstoneKeyword }  : {}),
          ...(suggestion.discoveredKeywords  ? { discoveredKeywords: suggestion.discoveredKeywords }           : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(contentGaps.id, gap.id));
    affected++;
  }

  return c.json({ ok: true, data: { affected } });
});

// POST /:slug/content-gaps/:id/suggest — LLM title suggestion (Haiku, cheap)
projectRoutes.post("/:slug/content-gaps/:id/suggest", async (c) => {
  const slug  = c.req.param("slug");
  const gapId = c.req.param("id");

  const [project] = await db
    .select({ id: projects.id, autoApproveGaps: projects.autoApproveGaps })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [gap] = await db
    .select({
      id:         contentGaps.id,
      gapType:    contentGaps.gapType,
      clusterId:  contentGaps.clusterId,
      intentType: contentGaps.intentType,
      locale:     contentGaps.locale,
      metadata:   contentGaps.metadata,
    })
    .from(contentGaps)
    .where(and(eq(contentGaps.id, gapId), eq(contentGaps.projectId, project.id)))
    .limit(1);
  if (!gap) return c.json({ ok: false, error: "Gap not found" }, 404);

  // Load the brief for this gap (Spec 54.3: brief is SSoT for keyword data)
  const activeBriefStatuses: Array<"pending" | "approved"> = ["pending", "approved"];
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(and(
      eq(topicBriefs.gapId, gapId),
      inArray(topicBriefs.approvalStatus, activeBriefStatuses),
    ))
    .limit(1);
  if (!brief) return c.json({ ok: false, error: "No active brief for this gap" }, 404);

  // Idempotency: return cached data if brief already has keywords
  if (brief.secondaryKeywords.length > 0 && brief.primaryKeyword) {
    return c.json({
      ok: true,
      data: {
        suggestedTitle:     brief.suggestedTitle ?? "",
        suggestedSlug:      brief.suggestedSlug ?? "",
        suggestedMeta:      brief.suggestedMeta ?? "",
        primaryKeyword:     brief.primaryKeyword,
        secondaryKeywords:  brief.secondaryKeywords,
        briefId:            brief.id,
        clusterUpdated:     false,
        cached:             true,
      },
    });
  }

  const suggestion = await suggestGapTitle({ projectId: project.id, gap });
  if (!suggestion) return c.json({ ok: false, error: "LLM suggestion failed" }, 500);

  const secondaryKeywords = suggestion.discoveredKeywords ?? [];

  // Write to brief (primary destination — Spec 54.3)
  await db
    .update(topicBriefs)
    .set({
      primaryKeyword:    suggestion.cornerstoneKeyword,
      secondaryKeywords,
      suggestedTitle:    suggestion.title,
      suggestedSlug:     suggestion.slug,
      suggestedMeta:     suggestion.metaDescription,
      heroImagePrompt:   suggestion.heroImagePrompt,
      updatedAt:         new Date(),
    })
    .where(eq(topicBriefs.id, brief.id));

  // Dual-write to content_gaps.metadata for backward-compat readers (Spec 54.3 Decision 8)
  await db
    .update(contentGaps)
    .set({
      metadata: {
        ...gap.metadata,
        suggestedTitle:           suggestion.title,
        suggestedSlug:            suggestion.slug,
        suggestedMetaDescription: suggestion.metaDescription,
        suggestedHeroImagePrompt: suggestion.heroImagePrompt,
        ...(suggestion.cornerstoneKeyword
          ? { suggestedCornerstoneKeyword: suggestion.cornerstoneKeyword }
          : {}),
        ...(secondaryKeywords.length > 0
          ? { discoveredKeywords: secondaryKeywords }
          : {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(contentGaps.id, gapId));

  // Auto-approval: inline-trigger generation when project flag is set
  if (project.autoApproveGaps) {
    try {
      const updatedBrief = {
        ...brief,
        primaryKeyword:    suggestion.cornerstoneKeyword,
        secondaryKeywords,
        suggestedTitle:    suggestion.title,
        suggestedSlug:     suggestion.slug,
        suggestedMeta:     suggestion.metaDescription,
        heroImagePrompt:   suggestion.heroImagePrompt,
      };
      const decision = decideRoute(updatedBrief);
      const routeResult = await db.transaction(async (tx) =>
        executeDecision(decision, updatedBrief, tx),
      );

      if (routeResult.kind === "skipped") {
        log.warn({ gapId, reason: routeResult.reason }, "Auto-approval skipped by routing policy");
      } else if (
        routeResult.kind === "article_created" ||
        routeResult.kind === "translation_created"
      ) {
        const isBlogBrief =
          routeResult.kind === "article_created" &&
          updatedBrief.locale !== null &&
          updatedBrief.clusterId !== null;
        const triggerResult = await (isBlogBrief
          ? triggerWithPreRunId({
              pipelineName: "article:blog",
              projectId:    project.id,
              uniqueKey:    { field: "articleId", value: routeResult.articleId },
              costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
              extraInput:   { articleId: routeResult.articleId, briefId: updatedBrief.id },
              enqueue:      enqueueBlogGenerationPipeline,
            })
          : triggerWithPreRunId({
              pipelineName: "article:outline",
              projectId:    project.id,
              uniqueKey:    { field: "articleId", value: routeResult.articleId },
              costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
              extraInput:   { articleId: routeResult.articleId },
              enqueue:      enqueueArticleOutlinePipeline,
            }));

        await db
          .update(contentGaps)
          .set({
            filledByArticleId:     routeResult.articleId,
            generationTriggeredAt: new Date(),
            status:                "in_progress",
            updatedAt:             new Date(),
          })
          .where(eq(contentGaps.id, gapId));

        if (!("error" in triggerResult)) {
          log.info({ gapId, articleId: routeResult.articleId }, "Gap auto-approved after suggest");
          return c.json({
            ok:   true,
            data: {
              suggestedTitle:    suggestion.title,
              suggestedSlug:     suggestion.slug,
              suggestedMeta:     suggestion.metaDescription,
              primaryKeyword:    suggestion.cornerstoneKeyword,
              secondaryKeywords,
              briefId:           brief.id,
              clusterUpdated:    false,
              cached:            false,
              autoTriggered:     true,
              articleId:         routeResult.articleId,
              runId:             triggerResult.runId,
              jobId:             triggerResult.jobId,
            },
          });
        }
        log.warn({ gapId, error: triggerResult.error }, "Auto-approval trigger blocked — returning plain suggestion");
      } else if (routeResult.kind === "cornerstone_spec_created") {
        await db
          .update(contentGaps)
          .set({
            filledBySpecId:        routeResult.cornerstoneSpecId,
            generationTriggeredAt: new Date(),
            status:                "in_progress",
            updatedAt:             new Date(),
          })
          .where(eq(contentGaps.id, gapId));

        log.info({ gapId, specId: routeResult.cornerstoneSpecId }, "Gap auto-approved to cornerstone spec after suggest");
        return c.json({
          ok:   true,
          data: {
            suggestedTitle:    suggestion.title,
            suggestedSlug:     suggestion.slug,
            suggestedMeta:     suggestion.metaDescription,
            primaryKeyword:    suggestion.cornerstoneKeyword,
            secondaryKeywords,
            briefId:           brief.id,
            clusterUpdated:    false,
            cached:            false,
            autoTriggered:     true,
            cornerstoneSpecId: routeResult.cornerstoneSpecId,
          },
        });
      }
    } catch (err) {
      log.error({ err, gapId }, "Auto-approval failed after suggest — returning plain suggestion");
    }
  }

  return c.json({
    ok: true,
    data: {
      suggestedTitle:    suggestion.title,
      suggestedSlug:     suggestion.slug,
      suggestedMeta:     suggestion.metaDescription,
      primaryKeyword:    suggestion.cornerstoneKeyword,
      secondaryKeywords,
      briefId:           brief.id,
      clusterUpdated:    false,
      cached:            false,
      autoTriggered:     false,
    },
  });
});

// POST /:slug/content-gaps/:id/generate — trigger article / cornerstone spec creation
// (Spec 54.3: now routes via TopicRoutingPolicy — brief is the Single Source of Truth)

projectRoutes.post("/:slug/content-gaps/:id/generate", async (c) => {
  const slug  = c.req.param("slug");
  const gapId = c.req.param("id");

  const [project] = await db
    .select({ id: projects.id, pipelineConfig: projects.pipelineConfig })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [gap] = await db
    .select({ id: contentGaps.id, status: contentGaps.status })
    .from(contentGaps)
    .where(and(eq(contentGaps.id, gapId), eq(contentGaps.projectId, project.id)))
    .limit(1);
  if (!gap) return c.json({ ok: false, error: "Gap not found" }, 404);
  if (gap.status === "dismissed" || gap.status === "resolved")
    return c.json({ ok: false, error: "Gap is already closed" }, 409);

  const activeBriefStatuses: Array<"pending" | "approved"> = ["pending", "approved"];
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(and(
      eq(topicBriefs.gapId, gapId),
      inArray(topicBriefs.approvalStatus, activeBriefStatuses),
    ))
    .limit(1);
  if (!brief) return c.json({ ok: false, error: "No active brief for this gap" }, 404);

  const decision = decideRoute(brief);
  const routeResult = await db.transaction(async (tx) =>
    executeDecision(decision, brief, tx),
  );

  if (routeResult.kind === "skipped") {
    return c.json(
      { ok: false, error: routeResult.reason, data: { briefId: routeResult.briefId } },
      422,
    );
  }

  if (
    routeResult.kind === "article_created" ||
    routeResult.kind === "translation_created"
  ) {
    // Translation mode is Spec 54.10 — only fresh article_created routes to blog pipeline
    const isBlogBrief = routeResult.kind === "article_created" && brief.locale !== null && brief.clusterId !== null;
    const triggerResult = await (isBlogBrief
      ? triggerWithPreRunId({
          pipelineName: "article:blog",
          projectId:    project.id,
          uniqueKey:    { field: "articleId", value: routeResult.articleId },
          costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
          extraInput:   { articleId: routeResult.articleId, briefId: brief.id },
          enqueue:      enqueueBlogGenerationPipeline,
        })
      : triggerWithPreRunId({
          pipelineName: "article:outline",
          projectId:    project.id,
          uniqueKey:    { field: "articleId", value: routeResult.articleId },
          costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
          extraInput:   { articleId: routeResult.articleId },
          enqueue:      enqueueArticleOutlinePipeline,
        }));

    await db
      .update(contentGaps)
      .set({
        filledByArticleId:     routeResult.articleId,
        generationTriggeredAt: new Date(),
        status:                "in_progress",
        updatedAt:             new Date(),
      })
      .where(eq(contentGaps.id, gapId));

    log.info(
      { gapId, articleId: routeResult.articleId, briefId: routeResult.briefId },
      "Created article from gap via routing policy",
    );

    if ("error" in triggerResult)
      return c.json({ ok: false, error: triggerResult.error }, 402);

    return c.json(
      {
        ok:   true,
        data: {
          type:      "article",
          articleId: routeResult.articleId,
          runId:     triggerResult.runId,
          jobId:     triggerResult.jobId,
          deduped:   triggerResult.deduped,
          gapStatus: "in_progress",
          briefId:   routeResult.briefId,
        },
      },
      triggerResult.deduped ? 200 : 202,
    );
  }

  if (routeResult.kind === "cornerstone_spec_created") {
    await db
      .update(contentGaps)
      .set({
        filledBySpecId:        routeResult.cornerstoneSpecId,
        generationTriggeredAt: new Date(),
        status:                "in_progress",
        updatedAt:             new Date(),
      })
      .where(eq(contentGaps.id, gapId));

    log.info(
      { gapId, specId: routeResult.cornerstoneSpecId, briefId: routeResult.briefId, slug },
      "Created cornerstone spec from gap via routing policy",
    );
    return c.json({
      ok:   true,
      data: {
        type:              "cornerstone_spec",
        cornerstoneSpecId: routeResult.cornerstoneSpecId,
        gapStatus:         "in_progress",
        briefId:           routeResult.briefId,
      },
    });
  }

  return c.json({ ok: false, error: "Unexpected routing result" }, 500);
});

// suggestGapTitle() lives in src/lib/gap-service.ts (adapter calls must not be in routes)

// ─── POST /:slug/content-gaps/:id/automate ────────────────────────────────────
// Full automation chain: outline → draft → schema-de → localize → schema-en → [astro-transfer]
// (Spec 54.3: now routes via TopicRoutingPolicy — brief is the Single Source of Truth)

projectRoutes.post("/:slug/content-gaps/:id/automate", async (c) => {
  const slug  = c.req.param("slug");
  const gapId = c.req.param("id");

  const [project] = await db
    .select({ id: projects.id, autoPublish: projects.autoPublish })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [gap] = await db
    .select({ id: contentGaps.id, status: contentGaps.status })
    .from(contentGaps)
    .where(and(eq(contentGaps.id, gapId), eq(contentGaps.projectId, project.id)))
    .limit(1);
  if (!gap) return c.json({ ok: false, error: "Gap not found" }, 404);
  if (gap.status === "dismissed" || gap.status === "resolved")
    return c.json({ ok: false, error: "Gap is already closed" }, 409);

  // Check for already-running chain for this gap (idempotency — checked before brief load)
  const [existingChain] = await db
    .select({ id: pipelineChains.id, status: pipelineChains.status })
    .from(pipelineChains)
    .where(
      and(
        eq(pipelineChains.gapId, gapId),
        sql`${pipelineChains.status} IN ('queued', 'running')`,
      ),
    )
    .limit(1);
  if (existingChain) {
    return c.json({ ok: true, data: { chainId: existingChain.id, deduped: true } }, 200);
  }

  // Project-pause guard
  if (await isProjectPaused(project.id)) {
    const info = await getPauseInfo(project.id);
    return c.json({ ok: false, error: "project_paused", data: info }, 423);
  }

  // Cost pre-flight: full chain ~$0.65 ≈ $0.65 ÷ ~0.92 ≈ €0.71 (conservative)
  const costCheck = await checkCostBudget(project.id, "anthropic", 0.71);
  if (!costCheck.ok) {
    return c.json({ ok: false, error: "cost_limit_exceeded", data: costCheck }, 402);
  }

  // Load active brief
  const activeBriefStatuses: Array<"pending" | "approved"> = ["pending", "approved"];
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(and(
      eq(topicBriefs.gapId, gapId),
      inArray(topicBriefs.approvalStatus, activeBriefStatuses),
    ))
    .limit(1);
  if (!brief) return c.json({ ok: false, error: "No active brief for this gap" }, 404);

  const decision = decideRoute(brief);

  // Hub gaps produce a cornerstone spec, not a chain — direct caller to /generate
  if (decision.kind === "create_cornerstone_spec") {
    return c.json(
      { ok: false, error: "Hub gaps use cornerstone spec workflow — use /generate instead" },
      400,
    );
  }

  const routeResult = await db.transaction(async (tx) =>
    executeDecision(decision, brief, tx),
  );

  if (routeResult.kind === "skipped") {
    return c.json(
      { ok: false, error: routeResult.reason, data: { briefId: routeResult.briefId } },
      422,
    );
  }

  if (
    routeResult.kind !== "article_created" &&
    routeResult.kind !== "translation_created"
  ) {
    return c.json({ ok: false, error: "Unexpected routing result for automate" }, 500);
  }

  // Spec 54.10: route blog-eligible briefs through article:blog instead of legacy outline chain.
  // Same eligibility check as isBlogBrief() used in /generate — locale + clusterId present,
  // and not a refresh/translation brief.
  const useBlogPipeline = routeResult.kind === "article_created" && isBlogEligible(brief);

  const { chainId } = await startChain({
    projectId: project.id,
    gapId,
    articleId: routeResult.articleId,
    ...(useBlogPipeline && { briefId: routeResult.briefId, useBlogPipeline: true }),
  });

  await db
    .update(contentGaps)
    .set({
      filledByArticleId:     routeResult.articleId,
      generationTriggeredAt: new Date(),
      status:                "in_progress",
      updatedAt:             new Date(),
    })
    .where(eq(contentGaps.id, gapId));

  log.info(
    { gapId, articleId: routeResult.articleId, chainId, briefId: routeResult.briefId, slug },
    "Full-automation chain started via routing policy",
  );
  return c.json(
    { ok: true, data: { chainId, articleId: routeResult.articleId, briefId: routeResult.briefId, deduped: false } },
    202,
  );
});

// ─── GET /:slug/pipeline-chains — list chains for project ─────────────────────

const chainListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["queued", "running", "paused", "completed", "failed", "cancelled"]).optional(),
});

projectRoutes.get("/:slug/pipeline-chains", zValidator("query", chainListQuerySchema), async (c) => {
  const slug = c.req.param("slug");
  const q    = c.req.valid("query");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const where = q.status
    ? and(eq(pipelineChains.projectId, project.id), eq(pipelineChains.status, q.status))
    : eq(pipelineChains.projectId, project.id);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(pipelineChains)
      .where(where)
      .orderBy(desc(pipelineChains.createdAt))
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(pipelineChains)
      .where(where),
  ]);

  return c.json({ ok: true, data: paginated(rows, countRows, q) });
});

// ─── GET /:slug/pipeline-chains/:chainId — chain detail ──────────────────────

projectRoutes.get("/:slug/pipeline-chains/:chainId", async (c) => {
  const slug    = c.req.param("slug");
  const chainId = c.req.param("chainId");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [chain] = await db
    .select()
    .from(pipelineChains)
    .where(and(eq(pipelineChains.id, chainId), eq(pipelineChains.projectId, project.id)))
    .limit(1);
  if (!chain) return c.json({ ok: false, error: "Chain not found" }, 404);

  return c.json({ ok: true, data: chain });
});

// ─── POST /:slug/pipeline-chains/:chainId/resume ──────────────────────────────

projectRoutes.post("/:slug/pipeline-chains/:chainId/resume", async (c) => {
  const slug    = c.req.param("slug");
  const chainId = c.req.param("chainId");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [chain] = await db
    .select({ id: pipelineChains.id, status: pipelineChains.status, projectId: pipelineChains.projectId })
    .from(pipelineChains)
    .where(and(eq(pipelineChains.id, chainId), eq(pipelineChains.projectId, project.id)))
    .limit(1);
  if (!chain) return c.json({ ok: false, error: "Chain not found" }, 404);
  if (chain.status !== "failed" && chain.status !== "paused") {
    return c.json({ ok: false, error: `Chain is not resumable (status: ${chain.status})` }, 409);
  }

  if (await isProjectPaused(project.id)) {
    const info = await getPauseInfo(project.id);
    return c.json({ ok: false, error: "project_paused", data: info }, 423);
  }

  const { resumedStep } = await resumeChain(chainId);
  return c.json({ ok: true, data: { chainId, resumedStep } }, 202);
});

// ─── POST /:slug/pipeline-chains/:chainId/cancel ──────────────────────────────

projectRoutes.post("/:slug/pipeline-chains/:chainId/cancel", async (c) => {
  const slug    = c.req.param("slug");
  const chainId = c.req.param("chainId");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [chain] = await db
    .select({ id: pipelineChains.id, status: pipelineChains.status })
    .from(pipelineChains)
    .where(and(eq(pipelineChains.id, chainId), eq(pipelineChains.projectId, project.id)))
    .limit(1);
  if (!chain) return c.json({ ok: false, error: "Chain not found" }, 404);
  if (chain.status === "completed" || chain.status === "cancelled" || chain.status === "failed") {
    return c.json({ ok: false, error: `Chain already in terminal state (status: ${chain.status})` }, 409);
  }

  await cancelChain(chainId);
  return c.json({ ok: true, data: { chainId, status: "cancelled" } });
});
