import { zValidator } from "@hono/zod-validator";
import {
  articles,
  astroSyncRuns,
  clusters,
  db,
  linkRebuildRuns,
  pagespeedRuns,
  pipelineRuns,
  projects,
  schemaExtensionRuns,
} from "@marketing-auto/db";
import { and, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { paginated, paginationQuerySchema } from "../lib/pagination.ts";
import { requireAuth } from "../middleware/auth.ts";

export type ActivityType =
  | "cold_start"
  | "article_outline"
  | "article_draft"
  | "astro_sync"
  | "pagespeed"
  | "schema_extension"
  | "link_rebuild"
  | "other";

export type NormalizedStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ActivityEntry {
  id: string;
  source:
    | "pipeline_runs"
    | "astro_sync_runs"
    | "pagespeed_runs"
    | "schema_extension_runs"
    | "link_rebuild_runs";
  type: ActivityType;
  status: NormalizedStatus;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  title: string;
  subtitle: string | null;
  errorMessage: string | null;
  articleId: string | null;
  articleSlug: string | null;
  clusterId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

function classifyPipelineName(name: string): ActivityType {
  if (name.startsWith("cold-start:")) return "cold_start";
  if (name === "article:outline") return "article_outline";
  if (name === "article:draft") return "article_draft";
  if (name === "article:sync") return "astro_sync";
  if (name === "article:validate-pagespeed") return "pagespeed";
  if (name === "article:extend-schema") return "schema_extension";
  if (name === "article:link-rebuild") return "link_rebuild";
  return "other";
}

function normalizeStatus(raw: string): NormalizedStatus {
  const map: Record<string, NormalizedStatus> = {
    queued: "queued",
    running: "running",
    pending: "running",
    completed: "completed",
    succeeded: "completed",
    failed: "failed",
    errored: "failed",
    budget_exceeded: "failed",
    cancelled: "cancelled",
  };
  return map[raw] ?? "failed";
}

function buildPipelineTitle(
  pipelineName: string,
  articleInfo: { title: string | null; cornerstoneKeyword: string | null } | null | undefined
): string {
  if (articleInfo) return articleInfo.title ?? articleInfo.cornerstoneKeyword ?? pipelineName;
  if (pipelineName.startsWith("cold-start:")) {
    return pipelineName.replace("cold-start:", "").replace(/-/g, " ");
  }
  return pipelineName;
}

function buildPipelineSubtitle(
  pipelineName: string,
  articleInfo: { title: string | null; cornerstoneKeyword: string | null } | null | undefined
): string | null {
  if (articleInfo) {
    if (pipelineName === "article:outline") return "Outline generation";
    if (pipelineName === "article:draft") return "Draft generation";
    return null;
  }
  if (pipelineName.startsWith("cold-start:")) {
    const phase = pipelineName.replace("cold-start:", "");
    return `Cold-start phase: ${phase}`;
  }
  return null;
}

export const pipelineRunsRoutes = new Hono();

pipelineRunsRoutes.use(requireAuth);

// ─── GET /api/pipeline-runs/active ──────────────────────────────────────────
pipelineRunsRoutes.get("/active", async (c) => {
  const projectIdParam = c.req.query("projectId") ?? null;
  const sinceParam = c.req.query("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (Number.isNaN(since.getTime())) {
    return c.json({ ok: false, error: "Invalid `since` parameter" }, 400);
  }

  // Helper: optionally restrict to one project. Cast justified: all callers pass UUID FK columns
  // that share the same Drizzle column type as pipelineRuns.projectId.
  const maybeProjectFilter = <T>(col: T) =>
    projectIdParam ? eq(col as typeof pipelineRuns.projectId, projectIdParam) : undefined;

  // ─── pipelineRuns (cold-start, article:outline, article:draft) ─────────────
  const pipelineRunRows = await db
    .select({
      id: pipelineRuns.id,
      pipelineName: pipelineRuns.pipelineName,
      stepName: pipelineRuns.stepName,
      status: pipelineRuns.status,
      projectId: pipelineRuns.projectId,
      projectName: projects.name,
      projectSlug: projects.slug,
      input: pipelineRuns.input,
      errorMessage: pipelineRuns.errorMessage,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      createdAt: pipelineRuns.createdAt,
    })
    .from(pipelineRuns)
    .leftJoin(projects, eq(pipelineRuns.projectId, projects.id))
    .where(
      and(
        or(
          inArray(pipelineRuns.status, ["queued", "running"] as Array<"queued" | "running">),
          and(
            inArray(pipelineRuns.status, ["completed", "failed", "cancelled"] as Array<
              "completed" | "failed" | "cancelled"
            >),
            gte(pipelineRuns.createdAt, since)
          )
        ),
        maybeProjectFilter(pipelineRuns.projectId)
      )
    )
    .orderBy(desc(pipelineRuns.createdAt));

  // Batch-fetch article info for pipeline runs that reference an articleId in input.
  // Cast justified: pipelineRuns.input is JSONB typed as Record<string,unknown>; we know
  // article pipeline runs always include articleId at the top level.
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

  // ─── astroSyncRuns ──────────────────────────────────────────────────────────
  const astroSyncRows = await db
    .select({
      run: astroSyncRuns,
      projectName: projects.name,
      projectSlug: projects.slug,
      articleId: articles.id,
      articleSlug: articles.slug,
      articleTitle: articles.title,
      articleCornerstoneKeyword: articles.cornerstoneKeyword,
    })
    .from(astroSyncRuns)
    .leftJoin(projects, eq(astroSyncRuns.projectId, projects.id))
    .leftJoin(articles, eq(astroSyncRuns.articleId, articles.id))
    .where(
      and(
        or(eq(astroSyncRuns.status, "pending"), gte(astroSyncRuns.startedAt, since)),
        maybeProjectFilter(astroSyncRuns.projectId)
      )
    )
    .orderBy(desc(astroSyncRuns.startedAt));

  // ─── pagespeedRuns ──────────────────────────────────────────────────────────
  const pagespeedRows = await db
    .select({
      run: pagespeedRuns,
      projectName: projects.name,
      projectSlug: projects.slug,
      articleId: articles.id,
      articleSlug: articles.slug,
      articleTitle: articles.title,
      articleCornerstoneKeyword: articles.cornerstoneKeyword,
    })
    .from(pagespeedRuns)
    .leftJoin(projects, eq(pagespeedRuns.projectId, projects.id))
    .leftJoin(articles, eq(pagespeedRuns.articleId, articles.id))
    .where(
      and(
        or(eq(pagespeedRuns.status, "pending"), gte(pagespeedRuns.startedAt, since)),
        maybeProjectFilter(pagespeedRuns.projectId)
      )
    )
    .orderBy(desc(pagespeedRuns.startedAt));

  // ─── schemaExtensionRuns ────────────────────────────────────────────────────
  const schemaRows = await db
    .select({
      run: schemaExtensionRuns,
      projectName: projects.name,
      projectSlug: projects.slug,
      articleId: articles.id,
      articleSlug: articles.slug,
      articleTitle: articles.title,
      articleCornerstoneKeyword: articles.cornerstoneKeyword,
    })
    .from(schemaExtensionRuns)
    .leftJoin(projects, eq(schemaExtensionRuns.projectId, projects.id))
    .leftJoin(articles, eq(schemaExtensionRuns.articleId, articles.id))
    .where(
      and(
        or(eq(schemaExtensionRuns.status, "pending"), gte(schemaExtensionRuns.startedAt, since)),
        maybeProjectFilter(schemaExtensionRuns.projectId)
      )
    )
    .orderBy(desc(schemaExtensionRuns.startedAt));

  // ─── linkRebuildRuns ────────────────────────────────────────────────────────
  const linkRows = await db
    .select({
      run: linkRebuildRuns,
      projectName: projects.name,
      projectSlug: projects.slug,
      clusterId: clusters.id,
      clusterName: clusters.name,
    })
    .from(linkRebuildRuns)
    .leftJoin(projects, eq(linkRebuildRuns.projectId, projects.id))
    .leftJoin(clusters, eq(linkRebuildRuns.clusterId, clusters.id))
    .where(
      and(
        or(eq(linkRebuildRuns.status, "pending"), gte(linkRebuildRuns.startedAt, since)),
        maybeProjectFilter(linkRebuildRuns.projectId)
      )
    )
    .orderBy(desc(linkRebuildRuns.startedAt));

  // ─── Normalize all into unified ActivityEntry shape ─────────────────────────
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
      projectName: pr.projectName ?? null,
      projectSlug: pr.projectSlug ?? null,
      title: buildPipelineTitle(pr.pipelineName, articleInfo),
      subtitle: buildPipelineSubtitle(pr.pipelineName, articleInfo),
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
      projectName: row.projectName ?? null,
      projectSlug: row.projectSlug ?? null,
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
      projectName: row.projectName ?? null,
      projectSlug: row.projectSlug ?? null,
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
      projectName: row.projectName ?? null,
      projectSlug: row.projectSlug ?? null,
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
      projectName: row.projectName ?? null,
      projectSlug: row.projectSlug ?? null,
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

  // In-flight first, then terminal sorted by startedAt desc
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

const projectRunsQuerySchema = paginationQuerySchema.extend({
  pipelineNamePrefix: z.string().optional(),
});

pipelineRunsRoutes.get(
  "/project/:projectId",
  zValidator("query", projectRunsQuerySchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const q = c.req.valid("query");

    const conditions = [eq(pipelineRuns.projectId, projectId)];
    if (q.pipelineNamePrefix) {
      conditions.push(like(pipelineRuns.pipelineName, `${q.pipelineNamePrefix}%`));
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
  }
);

pipelineRunsRoutes.get("/:runId", async (c) => {
  const runId = c.req.param("runId");
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  if (!run) return c.json({ ok: false, error: "Run not found" }, 404);

  return c.json({
    ok: true,
    data: {
      id: run.id,
      pipelineName: run.pipelineName,
      projectId: run.projectId,
      status: run.status,
      stepName: run.stepName,
      input: run.input,
      output: run.output,
      error: run.errorMessage,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
    },
  });
});
