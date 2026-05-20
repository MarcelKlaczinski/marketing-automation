import { zValidator } from "@hono/zod-validator";
import {
  articles,
  astroSyncRuns,
  autoDismissStepPauses,
  clusters,
  costLogs,
  db,
  linkRebuildRuns,
  listStepPausesForRun,
  pagespeedRuns,
  pipelineRuns,
  projects,
  schemaExtensionRuns,
  topicBriefs,
} from "@marketing-auto/db";
import { getPauseInfo, isProjectPaused } from "@marketing-auto/core";
import { enqueuePipeline } from "@marketing-auto/pipelines";
import { createLogger, stepPausePayloadSchema } from "@marketing-auto/shared";
import { and, asc, desc, eq, gte, inArray, isNull, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { paginated, paginationQuerySchema } from "../lib/pagination.ts";
import { requireAuth } from "../middleware/auth.ts";
import { resolveStepPause } from "../lib/step-pause-service.ts";

const log = createLogger("routes:pipeline-runs");

export type ActivityType =
  | "cold_start"
  | "article_outline"
  | "article_draft"
  | "astro_sync"
  | "pagespeed"
  | "schema_extension"
  | "link_rebuild"
  | "other";

export type NormalizedStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "batch_pending"
  | "paused";  // Spec 62.0a: step paused in debug mode awaiting user action

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

export function classifyPipelineName(name: string): ActivityType {
  if (name.startsWith("cold-start:")) return "cold_start";
  if (name === "article:outline") return "article_outline";
  if (name === "article:draft") return "article_draft";
  if (name === "article:sync") return "astro_sync";
  if (name === "article:validate-pagespeed") return "pagespeed";
  if (name === "article:schema-extension") return "schema_extension";
  if (name === "article:link-rebuild") return "link_rebuild";
  return "other";
}

export function normalizeStatus(raw: string): NormalizedStatus {
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
    batch_pending: "batch_pending",
    paused: "paused",
    // Spec 62.0a: superseded is an internal cleanup state for replaced substeps; UI does not
    // surface it as its own status — map to failed so it appears in the activity feed as a
    // terminal/non-success row.
    superseded: "failed",
  };
  return map[raw] ?? "failed";
}

export function buildPipelineTitle(
  pipelineName: string,
  articleInfo: { title: string | null; cornerstoneKeyword: string | null } | null | undefined
): string {
  if (articleInfo) return articleInfo.title ?? articleInfo.cornerstoneKeyword ?? pipelineName;
  if (pipelineName.startsWith("cold-start:")) {
    return pipelineName.replace("cold-start:", "").replace(/-/g, " ");
  }
  return pipelineName;
}

export function buildPipelineSubtitle(
  pipelineName: string,
  articleInfo: { title: string | null; cornerstoneKeyword: string | null } | null | undefined,
  currentStep?: string
): string | null {
  const stepSuffix = currentStep ? ` · ${currentStep}` : "";
  if (articleInfo) {
    if (pipelineName === "article:outline") return `Outline generation${stepSuffix}`;
    if (pipelineName === "article:draft") return `Draft generation${stepSuffix}`;
    return stepSuffix || null;
  }
  if (pipelineName.startsWith("cold-start:")) {
    const phase = pipelineName.replace("cold-start:", "");
    return `Cold-start phase: ${phase}${stepSuffix}`;
  }
  return stepSuffix || null;
}

export const pipelineRunsRoutes = new Hono();

pipelineRunsRoutes.use(requireAuth);

// ─── GET /api/pipeline-runs/active ──────────────────────────────────────────
pipelineRunsRoutes.get("/active", async (c) => {
  const projectIdParam = c.req.query("projectId") ?? null;

  if (projectIdParam) {
    c.header("X-Deprecated", "true");
    c.header("X-Replaced-By", `/api/projects/:slug/pipeline-runs/active`);
    c.header("X-Deprecation-Date", "2026-05-16");
  }
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
        // Only top-level pipeline rows — step-level rows (step_name IS NOT NULL) would cause
        // one pipeline invocation to appear N times (once per step) in the activity feed.
        isNull(pipelineRuns.stepName),
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

  // For running top-level rows, fetch the currently active step name so the UI can
  // show progress ("Draft generation · step: self-review") without polling per-step.
  const runningParentIds = pipelineRunRows
    .filter((r) => r.status === "running")
    .map((r) => r.id);

  const currentStepMap = new Map<string, string>(); // parentRunId → stepName
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
          inArray(pipelineRuns.status, ["running", "queued"] as Array<"running" | "queued">)
        )
      )
      .orderBy(desc(pipelineRuns.createdAt));
    // Keep only the most recent (first) step per parent
    for (const row of stepRows) {
      if (row.parentRunId && row.stepName && !currentStepMap.has(row.parentRunId)) {
        currentStepMap.set(row.parentRunId, row.stepName);
      }
    }
  }

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
      status: normalizeStatus(pr.status),
      projectId: pr.projectId,
      projectName: pr.projectName ?? null,
      projectSlug: pr.projectSlug ?? null,
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

    c.header("X-Deprecated", "true");
    c.header("X-Replaced-By", `/api/projects/:slug/pipeline-runs`);
    c.header("X-Deprecation-Date", "2026-05-16");

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

// ─── POST /api/pipeline-runs/:id/retry ───────────────────────────────────────
// One-shot pipelines (cluster:plan, cold-start:*) are NOT retryable via this endpoint.
const NOT_RETRYABLE = ["cluster:plan"];

pipelineRunsRoutes.post("/:id/retry", async (c) => {
  const id = c.req.param("id");

  const [run] = await db
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.id, id), isNull(pipelineRuns.stepName)))
    .limit(1);

  if (!run) return c.json({ ok: false, error: "not_found" }, 404);
  if (run.status !== "failed") {
    return c.json(
      { ok: false, error: "not_failed", message: `Run is "${run.status}", only "failed" runs can be retried` },
      422
    );
  }

  const pipelineName = run.pipelineName;

  if (NOT_RETRYABLE.includes(pipelineName) || pipelineName.startsWith("cold-start:")) {
    return c.json(
      { ok: false, error: "not_retryable", message: `Pipeline "${pipelineName}" is not retryable via this endpoint` },
      422
    );
  }

  if (await isProjectPaused(run.projectId)) {
    const pauseInfo = await getPauseInfo(run.projectId);
    return c.json({ ok: false, error: "project_paused", data: pauseInfo }, 423);
  }

  // Merge retriedFromRunId into input for audit trail
  const retryInput: Record<string, unknown> = {
    ...(run.input as Record<string, unknown>),
    retriedFromRunId: id,
  };

  // Insert a new queued pipeline_runs row (preRunId pattern)
  const [newRun] = await db
    .insert(pipelineRuns)
    .values({ projectId: run.projectId, pipelineName, status: "queued", input: retryInput })
    .returning({ id: pipelineRuns.id });

  if (!newRun) return c.json({ ok: false, error: "internal_error" }, 500);

  const { jobId } = await enqueuePipeline({
    pipelineName,
    projectId: run.projectId,
    input: retryInput,
    preRunId: newRun.id,
  });

  await db.update(pipelineRuns).set({ jobId }).where(eq(pipelineRuns.id, newRun.id));

  return c.json({ ok: true, data: { newRunId: newRun.id, retriedFromRunId: id, jobId } }, 202);
});

// ─── PATCH /api/pipeline-runs/:id/cancel ──────────────────────────────────────
pipelineRunsRoutes.patch("/:id/cancel", async (c) => {
  const id = c.req.param("id");

  const [run] = await db
    .select({ id: pipelineRuns.id, status: pipelineRuns.status })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, id))
    .limit(1);

  if (!run) return c.json({ ok: false, error: "Run not found" }, 404);

  // Spec 62.0a: paused and batch_pending runs are also cancellable. Marcel may want to
  // abandon a paused debug run without going through the resolve flow, or kill a stuck
  // batch_pending run whose batch will never complete.
  const cancellableStatuses = ["queued", "running", "paused", "batch_pending"];
  if (!cancellableStatuses.includes(run.status)) {
    return c.json(
      { ok: false, error: "Only queued, running, paused, or batch_pending runs can be cancelled" },
      409
    );
  }

  await db
    .update(pipelineRuns)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(pipelineRuns.id, id));

  // Spec 62.0a Section 4.5.2: auto-dismiss unresolved step_pauses so the cancelled run
  // drops out of the "needs attention" queue. Wrapped so a DB hiccup doesn't 500 a
  // successful cancel — stale pauses are caught by the 6h cleanup worker as backup.
  try {
    await autoDismissStepPauses(id, "cancelled");
  } catch (err) {
    log.warn({ err, runId: id }, "autoDismissStepPauses failed on cancel — stale pauses remain");
  }

  return c.json({ ok: true });
});

// ─── GET /api/pipeline-runs/:id/step-pauses — Spec 62.0a ──────────────────────
// Returns all step_pauses for a pipeline run (resolved + unresolved), newest first.
pipelineRunsRoutes.get("/:id/step-pauses", async (c) => {
  const id = c.req.param("id");
  const [run] = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, id))
    .limit(1);
  if (!run) return c.json({ ok: false, error: "Run not found" }, 404);

  const pauses = await listStepPausesForRun(id);
  return c.json({ ok: true, data: pauses });
});

// ─── POST /api/pipeline-runs/:id/step-pauses/:stepPauseId/resolve — Spec 62.0a ─
// Resolves a paused step with one of the 7 user actions and re-enqueues the pipeline.
// `extract-for-optimization` tags the row but does NOT re-enqueue.
pipelineRunsRoutes.post(
  "/:id/step-pauses/:stepPauseId/resolve",
  zValidator("json", stepPausePayloadSchema),
  async (c) => {
    const id = c.req.param("id");
    const stepPauseId = c.req.param("stepPauseId");
    const payload = c.req.valid("json");

    const user = c.get("user");
    const resolvedBy = user?.email ?? user?.id ?? "system";

    const result = await resolveStepPause(stepPauseId, payload, resolvedBy);
    if (!result.ok) {
      const status = result.status as 404 | 409 | 422;
      return c.json({ ok: false, error: result.error }, status);
    }

    // Defensive: the resolved pause must belong to the run id in the URL.
    if (result.resolved.pipelineRunId !== id) {
      return c.json({ ok: false, error: "step_pause_mismatched_run" }, 400);
    }

    return c.json(
      {
        ok: true,
        data: {
          stepPauseId,
          action: result.resolved.action,
          reEnqueued: result.reEnqueued,
          jobId: result.jobId,
        },
      },
      202
    );
  }
);

// ─── GET /api/pipeline-runs/:runId — enriched with steps + costs + article + brief ──
pipelineRunsRoutes.get("/:runId", async (c) => {
  const runId = c.req.param("runId");
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  if (!run) return c.json({ ok: false, error: "Run not found" }, 404);

  const [stepRuns, allCosts] = await Promise.all([
    db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.parentRunId, runId))
      .orderBy(asc(pipelineRuns.createdAt)),
    db
      .select()
      .from(costLogs)
      .where(inArray(costLogs.pipelineRunId, [runId]))
      .orderBy(asc(costLogs.createdAt)),
  ]);

  // Fetch costs for child step runs too
  const stepRunIds = stepRuns.map((s) => s.id);
  const stepCosts =
    stepRunIds.length > 0
      ? await db
          .select()
          .from(costLogs)
          .where(inArray(costLogs.pipelineRunId, stepRunIds))
          .orderBy(asc(costLogs.createdAt))
      : [];

  const costs = [...allCosts, ...stepCosts];

  const input = run.input ?? {};
  const articleId = typeof input.articleId === "string" ? input.articleId : undefined;
  const briefId = typeof input.briefId === "string" ? input.briefId : undefined;

  const [articleRow, briefRow] = await Promise.all([
    articleId
      ? db
          .select({ id: articles.id, title: articles.title, slug: articles.slug, status: articles.status, locale: articles.locale, clusterId: articles.clusterId })
          .from(articles)
          .where(eq(articles.id, articleId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    briefId
      ? db
          .select({ id: topicBriefs.id, source: topicBriefs.source, topicTitle: topicBriefs.topicTitle })
          .from(topicBriefs)
          .where(eq(topicBriefs.id, briefId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  const durationMs =
    run.completedAt && run.startedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : null;

  return c.json({
    ok: true,
    data: {
      run: {
        id: run.id,
        pipelineName: run.pipelineName,
        projectId: run.projectId,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
        durationMs,
        input: run.input,
        output: run.output,
        error: run.errorMessage,
        retriedFromRunId: typeof input.retriedFromRunId === "string" ? input.retriedFromRunId : null,
      },
      steps: stepRuns.map((s) => ({
        id: s.id,
        stepName: s.stepName,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationMs:
          s.completedAt && s.startedAt
            ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()
            : null,
        output: s.output,
        error: s.errorMessage,
      })),
      costs: costs.map((cost) => ({
        id: cost.id,
        operation: cost.operation,
        service: cost.service,
        costEur: Number(cost.costEur),
        stepRunId: cost.pipelineRunId !== runId ? cost.pipelineRunId : null,
        createdAt: cost.createdAt,
      })),
      totalCostEur: costs.reduce((sum, cost) => sum + Number(cost.costEur), 0),
      article: articleRow,
      brief: briefRow,
    },
  });
});
