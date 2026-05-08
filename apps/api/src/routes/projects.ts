import { zValidator } from "@hono/zod-validator";
import { DEFAULT_COST_LIMITS, getPauseInfo, resumeProjectQueues } from "@marketing-auto/core";
import { articles, astroImportRuns, clusters, db, projects } from "@marketing-auto/db";
import { enqueueRepoImport } from "@marketing-auto/adapter-astro-sync/import";
import { createLogger } from "@marketing-auto/shared";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";

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
projectRoutes.post("/:slug/astro-import", async (c) => {
  const slug = c.req.param("slug");
  const [project] = await db
    .select({ id: projects.id, astroRepo: projects.astroRepo })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
  if (!project.astroRepo) {
    return c.json({ ok: false, error: "astroRepo not configured for this project" }, 400);
  }

  try {
    const { importRunId, jobId } = await enqueueRepoImport({
      projectId: project.id,
      triggerSource: "manual",
    });
    return c.json({ ok: true, data: { importRunId, jobId } }, 202);
  } catch (e) {
    log.error({ error: e, slug }, "Failed to enqueue repo import");
    return c.json({ ok: false, error: (e as Error).message }, 500);
  }
});

// Spec 44: List recent import runs for a project
projectRoutes.get("/:slug/astro-import-runs", async (c) => {
  const slug = c.req.param("slug");
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const runs = await db
    .select()
    .from(astroImportRuns)
    .where(eq(astroImportRuns.projectId, project.id))
    .orderBy(desc(astroImportRuns.startedAt))
    .limit(20);

  return c.json({ ok: true, data: runs });
});
