import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { db, projects, clusters, articles, pipelineRuns } from "@marketing-auto/db";
import { requireAuth } from "../middleware/auth.ts";
import { checkTriggerAllowed, guardErrorToResponse } from "./_lib/trigger-helpers.ts";
import {
  enqueueColdStartVoiceQuestions,
  enqueueColdStartVoiceSynthesize,
  enqueueColdStartCompetitorQuestions,
  enqueueColdStartCompetitorAnalysis,
  enqueueColdStartClusterPropose,
  enqueueColdStartCornerstoneList,
  enqueueColdStartGoLiveChecklist,
} from "@marketing-auto/pipelines";

export const coldStartRoutes = new Hono();

coldStartRoutes.use(requireAuth);

async function resolveProject(slug: string): Promise<{ id: string; marketingContextMd: string | null } | null> {
  const [proj] = await db
    .select({ id: projects.id, marketingContextMd: projects.marketingContextMd })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj ?? null;
}

// ───── Status endpoint ─────────────────────────────────────────────────────

coldStartRoutes.get("/:slug/cold-start/status", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const projectId = proj.id;

  // Phase 1: brand voice complete when marketingContextMd is populated
  const voiceRunning = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.projectId, projectId),
      inArray(pipelineRuns.pipelineName, ["cold-start:voice-refinement-questions", "cold-start:voice-synthesis"]),
      eq(pipelineRuns.status, "running"),
    ))
    .limit(1);

  const voiceComplete = !!(proj.marketingContextMd?.trim());

  // Phase 2: competitor analysis
  const competitorRunning = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.projectId, projectId),
      inArray(pipelineRuns.pipelineName, ["cold-start:competitor-questions", "cold-start:competitor-analysis"]),
      eq(pipelineRuns.status, "running"),
    ))
    .limit(1);

  const [latestCompetitorRun] = await db
    .select({ status: pipelineRuns.status })
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.projectId, projectId),
      eq(pipelineRuns.pipelineName, "cold-start:competitor-analysis"),
    ))
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(1);
  const competitorComplete = latestCompetitorRun?.status === "completed";

  // Phase 3: clusters
  const [clusterCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clusters)
    .where(eq(clusters.projectId, projectId));
  const clusterCount = clusterCountRow?.count ?? 0;

  const clusterRunning = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.projectId, projectId),
      eq(pipelineRuns.pipelineName, "cold-start:cluster-propose"),
      eq(pipelineRuns.status, "running"),
    ))
    .limit(1);

  // Phase 4: cornerstones
  const cornerstoneArticles = await db
    .select({ status: articles.status })
    .from(articles)
    .where(and(
      eq(articles.projectId, projectId),
      inArray(articles.status, ["proposed", "approved"] as Array<"proposed" | "approved">),
    ));

  const proposedCount = cornerstoneArticles.filter((a) => a.status === "proposed").length;
  const approvedCount = cornerstoneArticles.filter((a) => a.status === "approved").length;

  const cornerstoneRunning = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.projectId, projectId),
      eq(pipelineRuns.pipelineName, "cold-start:cornerstone-list"),
      eq(pipelineRuns.status, "running"),
    ))
    .limit(1);

  // Phase 5: go-live checklist
  const [latestGoLiveRun] = await db
    .select({ status: pipelineRuns.status })
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.projectId, projectId),
      eq(pipelineRuns.pipelineName, "cold-start:go-live-checklist"),
    ))
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(1);

  const goLiveRunning = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(
      eq(pipelineRuns.projectId, projectId),
      eq(pipelineRuns.pipelineName, "cold-start:go-live-checklist"),
      eq(pipelineRuns.status, "running"),
    ))
    .limit(1);

  return c.json({
    ok: true,
    data: {
      voice: {
        status: voiceRunning.length > 0 ? "running" : voiceComplete ? "complete" : "pending",
      },
      competitors: {
        status: competitorRunning.length > 0 ? "running" : competitorComplete ? "complete" : "pending",
      },
      clusters: {
        status: clusterRunning.length > 0 ? "running" : clusterCount > 0 ? "complete" : "pending",
        count: clusterCount,
      },
      cornerstones: {
        status: cornerstoneRunning.length > 0
          ? "running"
          : proposedCount > 0
            ? "awaiting_review"
            : approvedCount > 0
              ? "complete"
              : "pending",
        proposedCount,
        approvedCount,
      },
      goLive: {
        status: goLiveRunning.length > 0 ? "running" : latestGoLiveRun?.status === "completed" ? "complete" : "pending",
      },
    },
  });
});

// ───── Phase 1: Voice Refinement ───────────────────────────────────────────

coldStartRoutes.post("/:slug/cold-start/voice-refinement/questions", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const blocked = await checkTriggerAllowed({
    pipelineName: "cold-start:voice-refinement-questions",
    projectId: proj.id,
    uniqueKey: { field: "projectId", value: proj.id },
    costEstimate: { service: "anthropic", operation: "cold-start:voice-extraction" },
  });
  if (blocked) return guardErrorToResponse(c, blocked);

  const { runId, jobId } = await enqueueColdStartVoiceQuestions({ projectId: proj.id });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

const synthesizeSchema = z.object({
  answers: z.array(z.object({
    questionIndex: z.number().int().nonnegative(),
    answer: z.string().max(5000),
  })),
});

coldStartRoutes.post(
  "/:slug/cold-start/voice-refinement/synthesize",
  zValidator("json", synthesizeSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const blocked = await checkTriggerAllowed({
      pipelineName: "cold-start:voice-synthesis",
      projectId: proj.id,
      uniqueKey: { field: "projectId", value: proj.id },
      costEstimate: { service: "anthropic", operation: "cold-start:voice-extraction" },
    });
    if (blocked) return guardErrorToResponse(c, blocked);

    const { answers } = c.req.valid("json");
    const { runId, jobId } = await enqueueColdStartVoiceSynthesize({ projectId: proj.id, answers });
    return c.json({ ok: true, data: { runId, jobId } }, 202);
  },
);

// ───── Phase 2: Competitor Analysis ────────────────────────────────────────

coldStartRoutes.post("/:slug/cold-start/competitor-analysis/questions", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const blocked = await checkTriggerAllowed({
    pipelineName: "cold-start:competitor-questions",
    projectId: proj.id,
    uniqueKey: { field: "projectId", value: proj.id },
    costEstimate: { service: "anthropic", operation: "cold-start:competitor-questions" },
  });
  if (blocked) return guardErrorToResponse(c, blocked);

  const { runId, jobId } = await enqueueColdStartCompetitorQuestions({ projectId: proj.id });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

const MAX_COMPETITORS = 15;

const competitorAnalysisSchema = z.object({
  competitors: z.array(z.object({
    domain: z.string(),
    why_relevant: z.string(),
    expected_strengths: z.array(z.string()),
  })).min(1).max(MAX_COMPETITORS),
});

coldStartRoutes.post(
  "/:slug/cold-start/competitor-analysis/run",
  zValidator("json", competitorAnalysisSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const { competitors } = c.req.valid("json");

    // Hard cap enforced at schema level above; defensive double-check
    if (competitors.length > MAX_COMPETITORS) {
      return c.json({
        ok: false,
        error: "competitor_count_exceeded",
        message: `${competitors.length} competitors exceed the limit of ${MAX_COMPETITORS}. Trim the list before running analysis.`,
      }, 422);
    }

    const blocked = await checkTriggerAllowed({
      pipelineName: "cold-start:competitor-analysis",
      projectId: proj.id,
      uniqueKey: { field: "projectId", value: proj.id },
      costEstimate: { service: "dataforseo", operation: "serp-analysis", multiplier: competitors.length },
    });
    if (blocked) return guardErrorToResponse(c, blocked);

    const { runId, jobId } = await enqueueColdStartCompetitorAnalysis({ projectId: proj.id, competitors });
    return c.json({ ok: true, data: { runId, jobId } }, 202);
  },
);

// ───── Phase 3: Cluster Plan ────────────────────────────────────────────────

coldStartRoutes.post("/:slug/cold-start/cluster-plan", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const blocked = await checkTriggerAllowed({
    pipelineName: "cold-start:cluster-propose",
    projectId: proj.id,
    uniqueKey: { field: "projectId", value: proj.id },
    costEstimate: { service: "anthropic", operation: "cold-start:cluster-plan" },
  });
  if (blocked) return guardErrorToResponse(c, blocked);

  const rawBody = await c.req.json().catch(() => ({}));
  const { contentGaps, topicsToAvoid } = z.object({
    contentGaps: z.array(z.string()).optional(),
    topicsToAvoid: z.array(z.string()).optional(),
  }).parse(rawBody);

  const clusterProposeInput: Parameters<typeof enqueueColdStartClusterPropose>[0] = { projectId: proj.id };
  if (contentGaps !== undefined) clusterProposeInput.contentGaps = contentGaps;
  if (topicsToAvoid !== undefined) clusterProposeInput.topicsToAvoid = topicsToAvoid;
  const { runId, jobId } = await enqueueColdStartClusterPropose(clusterProposeInput);
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

// ───── Phase 4: Cornerstone List ─────────────────────────────────────────────

const cornerstoneListSchema = z.object({
  approvedClusters: z.array(z.object({
    name: z.string(),
    pillar: z.string(),
    status: z.enum(["proposed", "approved", "rejected"]),
    cornerstone_keyword: z.string(),
    cornerstone_search_volume: z.number().nullable(),
    cornerstone_difficulty: z.number().nullable(),
    satellite_keywords: z.array(z.object({
      keyword: z.string(),
      search_volume: z.number().nullable(),
      difficulty: z.number().nullable(),
    })),
  })).min(1),
});

coldStartRoutes.post(
  "/:slug/cold-start/cornerstones",
  zValidator("json", cornerstoneListSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const blocked = await checkTriggerAllowed({
      pipelineName: "cold-start:cornerstone-list",
      projectId: proj.id,
      uniqueKey: { field: "projectId", value: proj.id },
      costEstimate: { service: "anthropic", operation: "cold-start:cornerstone-spec" },
    });
    if (blocked) return guardErrorToResponse(c, blocked);

    const { approvedClusters } = c.req.valid("json");
    const { runId, jobId } = await enqueueColdStartCornerstoneList({ projectId: proj.id, approvedClusters });
    return c.json({ ok: true, data: { runId, jobId } }, 202);
  },
);

const cornerstoneActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

coldStartRoutes.post(
  "/:slug/cold-start/cornerstones/:articleId/action",
  zValidator("json", cornerstoneActionSchema),
  async (c) => {
    const articleId = c.req.param("articleId");
    const { action } = c.req.valid("json");

    const newStatus = action === "approve" ? "approved" : "rejected";
    await db.update(articles).set({ status: newStatus, updatedAt: new Date() }).where(eq(articles.id, articleId));
    return c.json({ ok: true, data: { articleId, newStatus } });
  },
);

const cornerstoneEditSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  cornerstoneKeyword: z.string().min(2).max(200).optional(),
  metaDescription: z.string().max(500).optional(),
});

coldStartRoutes.patch(
  "/:slug/cold-start/cornerstones/:articleId",
  zValidator("json", cornerstoneEditSchema),
  async (c) => {
    const articleId = c.req.param("articleId");
    const patch = c.req.valid("json");

    const patchFields: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) patchFields["title"] = patch.title;
    if (patch.cornerstoneKeyword !== undefined) patchFields["cornerstoneKeyword"] = patch.cornerstoneKeyword;
    if (patch.metaDescription !== undefined) patchFields["metaDescription"] = patch.metaDescription;
    // exactOptionalPropertyTypes: Record<string,unknown> is not assignable to Drizzle's strict column type; conditional build above ensures only valid keys are present
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.update(articles).set(patchFields as any).where(eq(articles.id, articleId));
    const [updated] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
    return c.json({ ok: true, data: updated });
  },
);

// List proposed+approved cornerstones for a project
coldStartRoutes.get("/:slug/cold-start/cornerstones", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const rows = await db
    .select()
    .from(articles)
    .where(and(
      eq(articles.projectId, proj.id),
      inArray(articles.status, ["proposed", "approved", "rejected"] as Array<"proposed" | "approved" | "rejected">),
    ))
    .orderBy(articles.createdAt);

  return c.json({ ok: true, data: rows });
});

// ───── Phase 5: Go-Live Checklist ──────────────────────────────────────────

coldStartRoutes.post("/:slug/cold-start/go-live-checklist", async (c) => {
  const slug = c.req.param("slug");
  const proj = await resolveProject(slug);
  if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

  const blocked = await checkTriggerAllowed({
    pipelineName: "cold-start:go-live-checklist",
    projectId: proj.id,
    uniqueKey: { field: "projectId", value: proj.id },
    costEstimate: { service: "anthropic", operation: "cold-start:go-live-checklist" },
  });
  if (blocked) return guardErrorToResponse(c, blocked);

  const { runId, jobId } = await enqueueColdStartGoLiveChecklist({ projectId: proj.id });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});
