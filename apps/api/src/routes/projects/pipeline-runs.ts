import { zValidator } from "@hono/zod-validator";
import {
  and,
  articles,
  astroSyncRuns,
  clusters,
  db,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  linkRebuildRuns,
  or,
  pagespeedRuns,
  pipelineRuns,
  projects,
  schemaExtensionRuns,
  sql,
} from "@marketing-auto/db";
import { Hono } from "hono";
import { z } from "zod";
import { paginated, paginationQuerySchema } from "../../lib/pagination.ts";
import { requireAuth } from "../../middleware/auth.ts";
import type { ActivityEntry } from "../pipeline-runs.ts";
import {
  buildPipelineSubtitle,
  buildPipelineTitle,
  classifyPipelineName,
  normalizeStatus,
} from "../pipeline-runs.ts";

export const scopedPipelineRunsRoutes = new Hono();
scopedPipelineRunsRoutes.use(requireAuth);

// ─── GET /api/projects/:slug/pipeline-runs ────────────────────────────────────

const projectRunsQuerySchema = paginationQuerySchema.extend({
  pipelineNamePrefix: z.string().optional(),
});

scopedPipelineRunsRoutes.get(
  "/:slug/pipeline-runs",
  zValidator("query", projectRunsQuerySchema),
  async (c) => {
    const { slug } = c.req.param();
    const q = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const conditions = [eq(pipelineRuns.projectId, project.id), isNull(pipelineRuns.stepName)];
    if (q.pipelineNamePrefix) {
      conditions.push(ilike(pipelineRuns.pipelineName, `${q.pipelineNamePrefix}%`));
    }
    const whereClause = and(...conditions);

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(pipelineRuns)
        .where(whereClause)
        .orderBy(desc(pipelineRuns.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pipelineRuns)
        .where(whereClause),
    ]);

    return c.json({ ok: true, data: paginated(rows, countRows, q) });
  },
);

// ─── GET /api/projects/:slug/pipeline-runs/active ─────────────────────────────

scopedPipelineRunsRoutes.get("/:slug/pipeline-runs/active", async (c) => {
  const { slug } = c.req.param();
  const sinceParam = c.req.query("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (Number.isNaN(since.getTime())) {
    return c.json({ ok: false, error: "Invalid `since` parameter" }, 400);
  }

  const [project] = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const projectId = project.id;

  // ─── pipelineRuns ─────────────────────────────────────────────────────────
  const pipelineRunRows = await db
    .select({
      id: pipelineRuns.id,
      pipelineName: pipelineRuns.pipelineName,
      stepName: pipelineRuns.stepName,
      status: pipelineRuns.status,
      projectId: pipelineRuns.projectId,
      input: pipelineRuns.input,
      errorMessage: pipelineRuns.errorMessage,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      createdAt: pipelineRuns.createdAt,
    })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.projectId, projectId),
        isNull(pipelineRuns.stepName),
        or(
          inArray(pipelineRuns.status, ["queued", "running"] as Array<"queued" | "running">),
          and(
            inArray(pipelineRuns.status, ["completed", "failed", "cancelled"] as Array<
              "completed" | "failed" | "cancelled"
            >),
            gte(pipelineRuns.createdAt, since),
          ),
        ),
      ),
    )
    .orderBy(desc(pipelineRuns.createdAt));

  const runningParentIds = pipelineRunRows
    .filter((r) => r.status === "running")
    .map((r) => r.id);

  const currentStepMap = new Map<string, string>();
  if (runningParentIds.length > 0) {
    const stepRows = await db
      .select({
        parentRunId: pipelineRuns.parentRunId,
        stepName: pipelineRuns.stepName,
      })
      .from(pipelineRuns)
      .where(
        and(
          inArray(pipelineRuns.parentRunId, runningParentIds),
          inArray(pipelineRuns.status, ["running", "queued"] as Array<"running" | "queued">),
        ),
      )
      .orderBy(desc(pipelineRuns.createdAt));
    for (const row of stepRows) {
      if (row.parentRunId && row.stepName && !currentStepMap.has(row.parentRunId)) {
        currentStepMap.set(row.parentRunId, row.stepName);
      }
    }
  }

  const articleIdsFromPR = pipelineRunRows
    .map((r) => (r.input as { articleId?: string } | null)?.articleId)
    .filter((id): id is string => typeof id === "string");

  const articleInfoMap = new Map<
    string,
    { id: string; slug: string; title: string | null; cornerstoneKeyword: string | null }
  >();
  if (articleIdsFromPR.length > 0) {
    const rows = await db
      .select({
        id: articles.id,
        slug: articles.slug,
        title: articles.title,
        cornerstoneKeyword: articles.cornerstoneKeyword,
      })
      .from(articles)
      .where(inArray(articles.id, articleIdsFromPR));
    for (const r of rows) articleInfoMap.set(r.id, r);
  }

  // ─── astroSyncRuns ────────────────────────────────────────────────────────
  const astroSyncRows = await db
    .select({
      run: astroSyncRuns,
      articleId: articles.id,
      articleSlug: articles.slug,
      articleTitle: articles.title,
      articleCornerstoneKeyword: articles.cornerstoneKeyword,
    })
    .from(astroSyncRuns)
    .leftJoin(articles, eq(astroSyncRuns.articleId, articles.id))
    .where(
      and(
        eq(astroSyncRuns.projectId, projectId),
        or(eq(astroSyncRuns.status, "pending"), gte(astroSyncRuns.startedAt, since)),
      ),
    )
    .orderBy(desc(astroSyncRuns.startedAt));

  // ─── pagespeedRuns ────────────────────────────────────────────────────────
  const pagespeedRows = await db
    .select({
      run: pagespeedRuns,
      articleId: articles.id,
      articleSlug: articles.slug,
      articleTitle: articles.title,
      articleCornerstoneKeyword: articles.cornerstoneKeyword,
    })
    .from(pagespeedRuns)
    .leftJoin(articles, eq(pagespeedRuns.articleId, articles.id))
    .where(
      and(
        eq(pagespeedRuns.projectId, projectId),
        or(eq(pagespeedRuns.status, "pending"), gte(pagespeedRuns.startedAt, since)),
      ),
    )
    .orderBy(desc(pagespeedRuns.startedAt));

  // ─── schemaExtensionRuns ──────────────────────────────────────────────────
  const schemaRows = await db
    .select({
      run: schemaExtensionRuns,
      articleId: articles.id,
      articleSlug: articles.slug,
      articleTitle: articles.title,
      articleCornerstoneKeyword: articles.cornerstoneKeyword,
    })
    .from(schemaExtensionRuns)
    .leftJoin(articles, eq(schemaExtensionRuns.articleId, articles.id))
    .where(
      and(
        eq(schemaExtensionRuns.projectId, projectId),
        or(eq(schemaExtensionRuns.status, "pending"), gte(schemaExtensionRuns.startedAt, since)),
      ),
    )
    .orderBy(desc(schemaExtensionRuns.startedAt));

  // ─── linkRebuildRuns ──────────────────────────────────────────────────────
  const linkRows = await db
    .select({
      run: linkRebuildRuns,
      clusterId: clusters.id,
      clusterName: clusters.name,
    })
    .from(linkRebuildRuns)
    .leftJoin(clusters, eq(linkRebuildRuns.clusterId, clusters.id))
    .where(
      and(
        eq(linkRebuildRuns.projectId, projectId),
        or(eq(linkRebuildRuns.status, "pending"), gte(linkRebuildRuns.startedAt, since)),
      ),
    )
    .orderBy(desc(linkRebuildRuns.startedAt));

  // ─── Normalize into unified ActivityEntry shape ───────────────────────────
  const entries: ActivityEntry[] = [];

  for (const pr of pipelineRunRows) {
    const articleId = (pr.input as { articleId?: string } | null)?.articleId ?? null;
    const articleInfo = articleId ? articleInfoMap.get(articleId) : null;
    entries.push({
      id: pr.id,
      source: "pipeline_runs",
      type: classifyPipelineName(pr.pipelineName),
      status: pr.status,
      projectId: pr.projectId,
      projectName: project.name,
      projectSlug: project.slug,
      title: buildPipelineTitle(pr.pipelineName, articleInfo),
      subtitle: buildPipelineSubtitle(pr.pipelineName, articleInfo, currentStepMap.get(pr.id)),
      errorMessage: pr.errorMessage ?? null,
      articleId: articleInfo?.id ?? null,
      articleSlug: articleInfo?.slug ?? null,
      clusterId: null,
      startedAt: pr.startedAt?.toISOString() ?? null,
      finishedAt: pr.completedAt?.toISOString() ?? null,
      createdAt: pr.createdAt.toISOString(),
    });
  }

  for (const row of astroSyncRows) {
    entries.push({
      id: row.run.id,
      source: "astro_sync_runs",
      type: "astro_sync",
      status: normalizeStatus(row.run.status),
      projectId: row.run.projectId,
      projectName: project.name,
      projectSlug: project.slug,
      title: row.articleTitle ?? row.articleCornerstoneKeyword ?? "Article sync",
      subtitle: "Astro sync",
      errorMessage: row.run.errorMessage ?? null,
      articleId: row.articleId ?? null,
      articleSlug: row.articleSlug ?? null,
      clusterId: null,
      startedAt: row.run.startedAt.toISOString(),
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      createdAt: row.run.startedAt.toISOString(),
    });
  }

  for (const row of pagespeedRows) {
    entries.push({
      id: row.run.id,
      source: "pagespeed_runs",
      type: "pagespeed",
      status: normalizeStatus(row.run.status),
      projectId: row.run.projectId,
      projectName: project.name,
      projectSlug: project.slug,
      title: row.articleTitle ?? row.articleCornerstoneKeyword ?? "Article validation",
      subtitle: "PageSpeed validation",
      errorMessage: row.run.errorMessage ?? null,
      articleId: row.articleId ?? null,
      articleSlug: row.articleSlug ?? null,
      clusterId: null,
      startedAt: row.run.startedAt.toISOString(),
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      createdAt: row.run.startedAt.toISOString(),
    });
  }

  for (const row of schemaRows) {
    entries.push({
      id: row.run.id,
      source: "schema_extension_runs",
      type: "schema_extension",
      status: normalizeStatus(row.run.status),
      projectId: row.run.projectId,
      projectName: project.name,
      projectSlug: project.slug,
      title: row.articleTitle ?? row.articleCornerstoneKeyword ?? "Schema extension",
      subtitle: "Schema.org extension",
      errorMessage: row.run.errorMessage ?? null,
      articleId: row.articleId ?? null,
      articleSlug: row.articleSlug ?? null,
      clusterId: null,
      startedAt: row.run.startedAt.toISOString(),
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      createdAt: row.run.startedAt.toISOString(),
    });
  }

  for (const row of linkRows) {
    const processed = row.run.articlesProcessed ?? 0;
    const subtitle =
      processed > 0
        ? `${row.run.articlesModified ?? 0} of ${processed} articles modified`
        : "Internal linking rebuild";
    entries.push({
      id: row.run.id,
      source: "link_rebuild_runs",
      type: "link_rebuild",
      status: normalizeStatus(row.run.status),
      projectId: row.run.projectId,
      projectName: project.name,
      projectSlug: project.slug,
      title: row.clusterName ? `Cluster: ${row.clusterName}` : "Internal links",
      subtitle,
      errorMessage: row.run.errorMessage ?? null,
      articleId: null,
      articleSlug: null,
      clusterId: row.clusterId ?? null,
      startedAt: row.run.startedAt.toISOString(),
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      createdAt: row.run.startedAt.toISOString(),
    });
  }

  entries.sort((a, b) => {
    const aActive = a.status === "queued" || a.status === "running";
    const bActive = b.status === "queued" || b.status === "running";
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return (
      new Date(b.startedAt ?? b.createdAt).getTime() -
      new Date(a.startedAt ?? a.createdAt).getTime()
    );
  });

  const activeCount = entries.filter((e) => e.status === "queued" || e.status === "running").length;

  return c.json({ ok: true, data: { entries, since: since.toISOString(), activeCount } });
});
