import { zValidator } from "@hono/zod-validator";
import { COST_OPS } from "@marketing-auto/core";
import {
  and,
  db,
  desc,
  eq,
  externalSignals,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  projects,
  rejectedTopicCandidates,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import {
  enqueueBlogGenerationPipeline,
  executeDecision,
  type GenerationMode,
  type RoutingDecision,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";
import { paginated, paginationQuerySchema } from "../lib/pagination.ts";
import { triggerWithPreRunId } from "./_lib/trigger-helpers.ts";
import { getTrendSynthesizerQueue } from "../workers/trend-synthesizer.ts";

const log = createLogger("trends-route");

function normalizeCandidateTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}

export const trendRoutes = new Hono();

trendRoutes.use(requireAuth);

// ─── Helper: resolve project by slug ─────────────────────────────────────────

async function resolveProject(slug: string): Promise<{ id: string } | null> {
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj ?? null;
}

// ─── GET /:slug/trends/pending-briefs ─────────────────────────────────────────

trendRoutes.get("/:slug/trends/pending-briefs", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const briefs = await db
    .select()
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, proj.id),
        eq(topicBriefs.source, "trend_discovery"),
        eq(topicBriefs.approvalStatus, "pending"),
      ),
    )
    .orderBy(desc(sql`(${topicBriefs.trendMetadata}->>'trendScore')::int`));

  return c.json({ ok: true, data: { briefs } });
});

// ─── GET /:slug/trends/rejected-topics ───────────────────────────────────────

const rejectedTopicsQuerySchema = z.object({
  reason: z
    .enum([
      "existing_coverage",
      "low_score",
      "excluded_by_scope",
      "low_signal_volume",
      "manual_dismissal",
    ])
    .optional(),
});

trendRoutes.get(
  "/:slug/trends/rejected-topics",
  zValidator("query", rejectedTopicsQuerySchema),
  async (c) => {
    const slug   = c.req.param("slug");
    const { reason } = c.req.valid("query");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const conditions = [
      eq(rejectedTopicCandidates.projectId, proj.id),
      gt(rejectedTopicCandidates.expiresAt, new Date()),
    ];
    if (reason) {
      conditions.push(eq(rejectedTopicCandidates.reason, reason));
    }

    const rejected = await db
      .select()
      .from(rejectedTopicCandidates)
      .where(and(...conditions))
      .orderBy(desc(rejectedTopicCandidates.rejectedAt));

    return c.json({ ok: true, data: { rejected } });
  },
);

// ─── GET /:slug/trends/signal-pool ───────────────────────────────────────────

const signalPoolQuerySchema = paginationQuerySchema.extend({
  source: z
    .enum(["producthunt", "hackernews", "vendor_rss", "reddit", "github", "dataforseo_trends"])
    .optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to:   z.string().datetime({ offset: true }).optional(),
  processed: z.enum(["unprocessed", "processed-to-brief", "processed-skipped"]).optional(),
});

trendRoutes.get(
  "/:slug/trends/signal-pool",
  zValidator("query", signalPoolQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q    = c.req.valid("query");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const conditions = [eq(externalSignals.projectId, proj.id)];

    if (q.source) {
      conditions.push(eq(externalSignals.source, q.source));
    }
    if (q.from) {
      conditions.push(gte(externalSignals.collectedAt, new Date(q.from)));
    }
    if (q.to) {
      conditions.push(lte(externalSignals.collectedAt, new Date(q.to)));
    }
    if (q.processed === "unprocessed") {
      conditions.push(isNull(externalSignals.processedAt));
    } else if (q.processed === "processed-to-brief") {
      conditions.push(isNotNull(externalSignals.processedAt));
      conditions.push(isNotNull(externalSignals.processedInto));
    } else if (q.processed === "processed-skipped") {
      conditions.push(isNotNull(externalSignals.processedAt));
      conditions.push(isNull(externalSignals.processedInto));
    }

    const where = and(...conditions);

    const [signals, countRows] = await Promise.all([
      db
        .select()
        .from(externalSignals)
        .where(where)
        .orderBy(desc(externalSignals.collectedAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(externalSignals)
        .where(where),
    ]);

    return c.json({ ok: true, data: paginated(signals, countRows, q) });
  },
);

// ─── POST /:slug/trends/briefs/:briefId/approve ───────────────────────────────

const approveBodySchema = z.object({
  mode: z.enum(["generate", "queue"]).default("queue"),
});

trendRoutes.post(
  "/:slug/trends/briefs/:briefId/approve",
  zValidator("json", approveBodySchema),
  async (c) => {
    const slug    = c.req.param("slug");
    const briefId = c.req.param("briefId");
    const { mode } = c.req.valid("json");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const [brief] = await db
      .select()
      .from(topicBriefs)
      .where(
        and(
          eq(topicBriefs.id, briefId),
          eq(topicBriefs.projectId, proj.id),
          eq(topicBriefs.source, "trend_discovery"),
          eq(topicBriefs.approvalStatus, "pending"),
        ),
      )
      .limit(1);

    if (!brief) return c.json({ ok: false, error: "Trend brief not found or already processed" }, 404);

    // create_new briefs must go through Cluster Creator (Spec 54.7) first
    if (brief.clusterAction === "create_new" || !brief.clusterId) {
      return c.json(
        {
          ok: false,
          error: "cluster_assignment_required",
          message:
            "This trend brief requires a cluster before it can be approved. Use the Cluster Creator flow to propose or select a cluster.",
          brief_id: brief.id,
          next_action: {
            type: "cluster_creator",
            url: `/projects/${slug}/clusters/new?fromBrief=${brief.id}`,
          },
        },
        409,
      );
    }

    // Construct routing decision directly — decideRoute skips non-gap_analysis sources in 54.3
    const decision: RoutingDecision = {
      kind: "create_article",
      clusterId: brief.clusterId,
      intentType: brief.intentType ?? "general",
      mode: (brief.generationMode ?? "spoke") as GenerationMode, // brief.generationMode is string | null; default "spoke" is always a valid GenerationMode
    };

    const routeResult = await db.transaction(async (tx) => executeDecision(decision, brief, tx));

    if (routeResult.kind === "skipped") {
      return c.json({ ok: false, error: routeResult.reason }, 422);
    }
    if (routeResult.kind !== "article_created") {
      return c.json({ ok: false, error: "Unexpected routing result" }, 500);
    }

    // Trend briefs always have locale + clusterId (guarded above) — route to blog pipeline
    const triggerResult = await triggerWithPreRunId({
      pipelineName: "article:blog",
      projectId:    proj.id,
      uniqueKey:    { field: "articleId", value: routeResult.articleId },
      costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
      extraInput:   { articleId: routeResult.articleId, briefId: brief.id },
      enqueue:      enqueueBlogGenerationPipeline,
    });

    if ("error" in triggerResult) {
      return c.json({ ok: false, error: triggerResult.error }, 402);
    }

    log.info(
      { briefId, articleId: routeResult.articleId, mode, slug },
      "trend brief approved",
    );

    return c.json(
      {
        ok:   true,
        data: {
          articleId: routeResult.articleId,
          runId:     triggerResult.runId,
          jobId:     triggerResult.jobId,
          deduped:   triggerResult.deduped,
          briefId:   routeResult.briefId,
        },
      },
      triggerResult.deduped ? 200 : 202,
    );
  },
);

// ─── POST /:slug/trends/briefs/:briefId/dismiss ───────────────────────────────

trendRoutes.post("/:slug/trends/briefs/:briefId/dismiss", async (c) => {
  const slug    = c.req.param("slug");
  const briefId = c.req.param("briefId");

  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.id, briefId),
        eq(topicBriefs.projectId, proj.id),
        eq(topicBriefs.source, "trend_discovery"),
        eq(topicBriefs.approvalStatus, "pending"),
      ),
    )
    .limit(1);

  if (!brief) return c.json({ ok: false, error: "Trend brief not found or already processed" }, 404);

  const signalIds = (brief.trendMetadata?.signals ?? []).map((s) => s.id);

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await db.transaction(async (tx) => {
    await tx.insert(rejectedTopicCandidates).values({
      projectId:                proj.id,
      topicTitle:               brief.topicTitle,
      candidateTitleNormalized: normalizeCandidateTitle(brief.topicTitle),
      reason:                   "manual_dismissal",
      trendScore:               brief.trendMetadata?.trendScore ?? null,
      sourceSignalIds:          signalIds,
      expiresAt,
    });

    await tx
      .update(topicBriefs)
      .set({ approvalStatus: "rejected", updatedAt: new Date() })
      .where(eq(topicBriefs.id, briefId));
  });

  // Stamp contributing signals as processed (outside transaction — signals may already be stamped)
  if (signalIds.length > 0) {
    await db
      .update(externalSignals)
      .set({ processedAt: new Date() })
      .where(
        and(
          inArray(externalSignals.id, signalIds),
          isNull(externalSignals.processedAt),
        ),
      );
  }

  log.info({ briefId, signalCount: signalIds.length, slug }, "trend brief dismissed");

  return c.json({ ok: true, data: { briefId } });
});

// ─── POST /:slug/trends/briefs/:briefId/edit ──────────────────────────────────

const editBodySchema = z.object({
  suggestedTitle: z.string().min(10).max(200).optional(),
  suggestedMeta:  z.string().min(50).max(160).optional(),
  suggestedSlug:  z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
});

trendRoutes.post(
  "/:slug/trends/briefs/:briefId/edit",
  async (c) => {
    const slug    = c.req.param("slug");
    const briefId = c.req.param("briefId");

    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const rawBody = await c.req.json().catch(() => ({}));
    const parsed = editBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ ok: false, error: "Validation failed", issues: parsed.error.issues }, 400);
    }
    const body = parsed.data;

    if (!body.suggestedTitle && !body.suggestedMeta && !body.suggestedSlug) {
      return c.json({ ok: false, error: "No fields to update" }, 400);
    }

    const [brief] = await db
      .select({ id: topicBriefs.id })
      .from(topicBriefs)
      .where(
        and(
          eq(topicBriefs.id, briefId),
          eq(topicBriefs.projectId, proj.id),
          eq(topicBriefs.source, "trend_discovery"),
          eq(topicBriefs.approvalStatus, "pending"),
        ),
      )
      .limit(1);

    if (!brief) return c.json({ ok: false, error: "Trend brief not found or already processed" }, 404);

    const setValues = {
      updatedAt: new Date(),
      ...(body.suggestedTitle !== undefined ? { suggestedTitle: body.suggestedTitle } : {}),
      ...(body.suggestedMeta  !== undefined ? { suggestedMeta:  body.suggestedMeta  } : {}),
      ...(body.suggestedSlug  !== undefined ? { suggestedSlug:  body.suggestedSlug  } : {}),
    };

    await db.update(topicBriefs).set(setValues).where(eq(topicBriefs.id, briefId));

    log.info({ briefId, fields: Object.keys(body), slug }, "trend brief edited");

    return c.json({ ok: true, data: { briefId } });
  },
);

// ─── POST /:slug/trends/synthesize ───────────────────────────────────────────

trendRoutes.post("/:slug/trends/synthesize", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const jobId = `synthesize-project-${proj.id}-${new Date().toISOString().slice(0, 10)}-manual`;
  const queue = getTrendSynthesizerQueue();

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") {
      return c.json({ ok: true, data: { jobId, deduped: true } }, 200);
    }
  }

  await queue.add(
    "synthesize-project",
    { type: "synthesize-project", projectId: proj.id },
    { jobId },
  );

  log.info({ projectId: proj.id, jobId, slug }, "manual synthesis triggered");

  return c.json({ ok: true, data: { jobId, deduped: false } }, 202);
});

// ─── GET /:slug/trends/synthesis-status ──────────────────────────────────────

trendRoutes.get("/:slug/trends/synthesis-status", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const today   = new Date().toISOString().slice(0, 10);
  const jobId   = `synthesize-project-${proj.id}-${today}-manual`;
  const queue   = getTrendSynthesizerQueue();

  const job = await queue.getJob(jobId);
  if (!job) {
    return c.json({ ok: true, data: { status: "idle", jobId: null } });
  }

  const state = await job.getState();

  let status: "idle" | "running" | "completed" | "failed";
  if (state === "active" || state === "waiting" || state === "delayed") {
    status = "running";
  } else if (state === "completed") {
    status = "completed";
  } else if (state === "failed") {
    status = "failed";
  } else {
    status = "idle";
  }

  return c.json({ ok: true, data: { status, jobId } });
});
