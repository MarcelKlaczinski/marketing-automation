// Spec 62.3:
//   POST /api/projects/:slug/comparison-discovery/run
//   GET  /api/projects/:slug/comparison-pairs
//
// Wraps planner.discoverComparisonPairs() + a read query for topic_briefs with
// source='comparison_discovery'. Used by 62.4 Planner to consume comparison candidates.

import { zValidator } from "@hono/zod-validator";
import {
  and,
  db,
  desc,
  eq,
  gte,
  projects,
  sql,
  topicBriefs,
  type ComparisonMetadata,
} from "@marketing-auto/db";
import { discoverComparisonPairs } from "@marketing-auto/planner";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";

const log = createLogger("api:comparison-discovery");

export const comparisonDiscoveryRoutes = new Hono();
comparisonDiscoveryRoutes.use(requireAuth);

const runBodySchema = z.object({
  minCoMentionCount: z.number().int().min(1).max(100).optional(),
  minScore: z.number().min(0).max(1).optional(),
  excludeExistingComparisons: z.boolean().optional(),
  topNToPersist: z.number().int().min(1).max(200).optional(),
});

comparisonDiscoveryRoutes.post(
  "/:slug/comparison-discovery/run",
  async (c) => {
    const slug = c.req.param("slug");
    if (!slug) return c.json({ ok: false, error: "missing :slug param" }, 400);

    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!proj) return c.json({ ok: false, error: `project not found: ${slug}` }, 404);

    const rawBody = await c.req.json().catch(() => ({}));
    const parsed = runBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.message }, 400);
    }

    try {
      const result = await discoverComparisonPairs({
        projectId: proj.id,
        ...(parsed.data.minCoMentionCount !== undefined ? { minCoMentionCount: parsed.data.minCoMentionCount } : {}),
        ...(parsed.data.minScore !== undefined ? { minScore: parsed.data.minScore } : {}),
        ...(parsed.data.excludeExistingComparisons !== undefined
          ? { excludeExistingComparisons: parsed.data.excludeExistingComparisons }
          : {}),
        ...(parsed.data.topNToPersist !== undefined ? { topNToPersist: parsed.data.topNToPersist } : {}),
      });
      return c.json({ ok: true, data: result });
    } catch (err) {
      log.error({ err, projectId: proj.id }, "comparison-discovery run failed");
      const message = err instanceof Error ? err.message : "internal error";
      return c.json({ ok: false, error: message }, 500);
    }
  },
);

const listQuerySchema = z.object({
  minScore: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(["score", "createdAt"]).default("score"),
});

comparisonDiscoveryRoutes.get(
  "/:slug/comparison-pairs",
  zValidator("query", listQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    if (!slug) return c.json({ ok: false, error: "missing :slug param" }, 400);

    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!proj) return c.json({ ok: false, error: `project not found: ${slug}` }, 404);

    const { minScore, limit, sortBy } = c.req.valid("query");

    const baseCondition = and(
      eq(topicBriefs.projectId, proj.id),
      eq(topicBriefs.source, "comparison_discovery"),
    );

    const filteredCondition =
      minScore !== undefined
        ? and(
            baseCondition,
            gte(sql`(${topicBriefs.comparisonMetadata}->>'score')::numeric`, String(minScore)),
          )
        : baseCondition;

    const orderBy =
      sortBy === "score"
        ? sql`(${topicBriefs.comparisonMetadata}->>'score')::numeric DESC`
        : desc(topicBriefs.createdAt);

    const rows = await db
      .select({
        id: topicBriefs.id,
        topicTitle: topicBriefs.topicTitle,
        approvalStatus: topicBriefs.approvalStatus,
        comparisonMetadata: topicBriefs.comparisonMetadata,
        createdAt: topicBriefs.createdAt,
        updatedAt: topicBriefs.updatedAt,
      })
      .from(topicBriefs)
      .where(filteredCondition)
      .orderBy(orderBy)
      .limit(limit);

    const items = rows.map((r) => ({
      ...r,
      comparisonMetadata: r.comparisonMetadata as ComparisonMetadata | null,
    }));

    return c.json({ ok: true, data: { items, total: items.length } });
  },
);
