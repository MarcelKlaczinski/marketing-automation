import { zValidator } from "@hono/zod-validator";
import {
  and,
  articles,
  contentGaps,
  cronState,
  db,
  eq,
  isNull,
  isNotNull,
  lt,
  projects,
  refreshDismissed,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import { syncCronJobs } from "../../workers/cron-orchestrator.ts";
import { getRefreshDetectorQueue } from "../../workers/refresh-detector.ts";
import { getTrendSynthesizerQueue } from "../../workers/trend-synthesizer.ts";
import { getArticleQualityAnalysisQueue } from "@marketing-auto/pipelines/article-quality-analysis-queue";

const log = createLogger("api:cron-routes");

export const projectCronRoutes = new Hono();
projectCronRoutes.use(requireAuth);

// ─── Helper: resolve project ──────────────────────────────────────────────────

async function resolveProject(
  slug: string
): Promise<{ id: string; refreshStalenessThresholdDays: number } | null> {
  const [project] = await db
    .select({ id: projects.id, refreshStalenessThresholdDays: projects.refreshStalenessThresholdDays })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return project ?? null;
}

// ─── GET /:slug/cron-status ───────────────────────────────────────────────────

projectCronRoutes.get("/:slug/cron-status", async (c) => {
  const { slug } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const rows = await db
    .select()
    .from(cronState)
    .where(eq(cronState.projectId, project.id));

  const byType = Object.fromEntries(rows.map((r) => [r.jobType, r]));

  const format = (row: typeof rows[number] | undefined) => ({
    isActive: row?.isActive ?? false,
    cronPattern: row?.cronPattern ?? "30 1 * * *",
    lastRunAt: row?.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row?.lastRunStatus ?? null,
    lastRunError: row?.lastRunError ?? null,
    nextRunAt: row?.nextRunAt?.toISOString() ?? null,
  });

  return c.json({
    ok: true,
    data: {
      trendsSynthesizer: format(byType["trends_synthesizer"]),
      refreshDetector: format(byType["refresh_detector"]),
      qualityAnalysis: format(byType["quality_analysis"]),
    },
  });
});

// ─── PATCH /:slug/cron-status ─────────────────────────────────────────────────

const patchCronStatusSchema = z.object({
  jobType: z.enum(["trends_synthesizer", "refresh_detector", "quality_analysis"]),
  isActive: z.boolean(),
  cronPattern: z.string().optional(),
});

projectCronRoutes.patch(
  "/:slug/cron-status",
  zValidator("json", patchCronStatusSchema),
  async (c) => {
    const { slug } = c.req.param();
    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const body = c.req.valid("json");
    const defaultPattern =
      body.jobType === "trends_synthesizer" ? "30 1 * * *" :
      body.jobType === "refresh_detector" ? "0 2 * * *" :
      "0 3 * * *";
    const cronPattern = body.cronPattern ?? defaultPattern;

    // Upsert cron_state row
    await db
      .insert(cronState)
      .values({
        projectId: project.id,
        jobType: body.jobType,
        isActive: body.isActive,
        cronPattern,
      })
      .onConflictDoUpdate({
        target: [cronState.projectId, cronState.jobType],
        set: {
          isActive: body.isActive,
          cronPattern,
          updatedAt: new Date(),
        },
      });

    // Also mirror to the projects table flag for quick reads
    const projectUpdate =
      body.jobType === "trends_synthesizer" ? { trendsCronEnabled: body.isActive } :
      body.jobType === "refresh_detector" ? { refreshCronEnabled: body.isActive } :
      { qualityAnalysisCronEnabled: body.isActive };
    await db.update(projects).set(projectUpdate).where(eq(projects.id, project.id));

    // Trigger immediate sync (don't block the response)
    syncCronJobs().catch((err) => {
      log.warn({ err }, "Background cron sync failed after PATCH");
    });

    log.info({ slug, jobType: body.jobType, isActive: body.isActive }, "Cron state updated");
    return c.json({ ok: true, data: { jobType: body.jobType, isActive: body.isActive } });
  }
);

// ─── POST /:slug/cron-status/run ─────────────────────────────────────────────

const runNowSchema = z.object({
  jobType: z.enum(["trends_synthesizer", "refresh_detector", "quality_analysis"]),
});

projectCronRoutes.post(
  "/:slug/cron-status/run",
  zValidator("json", runNowSchema),
  async (c) => {
    const { slug } = c.req.param();
    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const { jobType } = c.req.valid("json");

    if (jobType === "trends_synthesizer") {
      const queue = getTrendSynthesizerQueue();
      const job = await queue.add(
        "synthesize-project",
        { type: "synthesize-project", projectId: project.id },
        { jobId: `manual:trends:${project.id}:${Date.now()}` }
      );
      return c.json({ ok: true, data: { jobId: job.id, jobType } }, 202);
    }

    if (jobType === "refresh_detector") {
      const queue = getRefreshDetectorQueue();
      const job = await queue.add(
        `refresh_detector:${project.id}`,
        { projectId: project.id },
        { jobId: `manual:refresh:${project.id}:${Date.now()}` }
      );
      return c.json({ ok: true, data: { jobId: job.id, jobType } }, 202);
    }

    // quality_analysis — enqueue a cron-triggered batch job
    const queue = getArticleQualityAnalysisQueue();
    const job = await queue.add(
      `quality_analysis:${project.id}`,
      { type: "cron-triggered", projectId: project.id },
      { jobId: `manual:quality:${project.id}:${Date.now()}` }
    );
    return c.json({ ok: true, data: { jobId: job.id, jobType } }, 202);
  }
);

// ─── GET /:slug/discovery-counts ─────────────────────────────────────────────

projectCronRoutes.get("/:slug/discovery-counts", async (c) => {
  const { slug } = c.req.param();
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const cutoff = new Date(
    Date.now() - project.refreshStalenessThresholdDays * 24 * 60 * 60 * 1000
  );

  const [trendsPendingResult, gapsOpenResult, refreshCandidatesResult] = await Promise.all([
    // Pending trend briefs (source=trend_discovery, approval_status=pending)
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(topicBriefs)
      .where(
        and(
          eq(topicBriefs.projectId, project.id),
          eq(topicBriefs.source, "trend_discovery"),
          eq(topicBriefs.approvalStatus, "pending")
        )
      ),

    // Open content gaps
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(contentGaps)
      .where(and(eq(contentGaps.projectId, project.id), eq(contentGaps.status, "open"))),

    // Published articles older than staleness threshold, not dismissed
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(articles)
      .leftJoin(
        refreshDismissed,
        and(
          eq(refreshDismissed.projectId, project.id),
          eq(refreshDismissed.articleId, articles.id)
        )
      )
      .where(
        and(
          eq(articles.projectId, project.id),
          eq(articles.status, "published"),
          isNotNull(articles.lastRefreshedAt),
          lt(articles.lastRefreshedAt, cutoff),
          isNull(refreshDismissed.id)
        )
      ),
  ]);

  return c.json({
    ok: true,
    data: {
      trendsPending: trendsPendingResult[0]?.count ?? 0,
      gapsOpen: gapsOpenResult[0]?.count ?? 0,
      refreshCandidates: refreshCandidatesResult[0]?.count ?? 0,
    },
  });
});
