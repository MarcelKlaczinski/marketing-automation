import { zValidator } from "@hono/zod-validator";
import { DEFAULT_COST_LIMITS, getPauseInfo, resumeProjectQueues } from "@marketing-auto/core";
import { articles, astroImportRuns, clusters, contentGaps, db, projects } from "@marketing-auto/db";
import { DetectContentGapsStep, enqueueRepoImport } from "@marketing-auto/adapter-astro-sync/import";
import type { StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

  await db
    .update(projects)
    // biome-ignore lint/suspicious/noExplicitAny: Record<string,unknown> is structurally incompatible with Drizzle's strict partial column type; conditional build ensures only valid keys are present
    .set(setFields as any)
    .where(eq(projects.id, existing.id));

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
  limit:    z.coerce.number().int().min(1).max(200).default(50),
  status:   z.enum(["open", "in_progress", "resolved", "dismissed"]).optional(),
  gapType:  z
    .enum(["missing_hub", "missing_translation", "missing_spoke_type", "cluster_too_small"])
    .optional(),
  priority: z.coerce.number().int().min(1).max(3).optional(),
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
    if (q.status)   conditions.push(eq(contentGaps.status, q.status));
    if (q.gapType)  conditions.push(eq(contentGaps.gapType, q.gapType));
    if (q.priority) conditions.push(eq(contentGaps.priority, q.priority));

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

    return c.json({ ok: true, data: { id: gapId, status: body.status } });
  }
);
