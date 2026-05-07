import { zValidator } from "@hono/zod-validator";
import { articles, clusters, contentPillars, db, projects } from "@marketing-auto/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";

export const clusterRoutes = new Hono();
clusterRoutes.use(requireAuth);

// GET /api/clusters?projectSlug=foo[&pillarId=...]
clusterRoutes.get("/", async (c) => {
  const projectSlug = c.req.query("projectSlug");
  const pillarId = c.req.query("pillarId");

  if (!projectSlug) return c.json({ ok: false, error: "projectSlug required" }, 400);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const whereClause = pillarId
    ? and(eq(clusters.projectId, project.id), eq(clusters.pillarId, pillarId))
    : eq(clusters.projectId, project.id);

  const rows = await db
    .select({
      id: clusters.id,
      name: clusters.name,
      pillarId: clusters.pillarId,
      pillarName: contentPillars.name,
      primaryKeyword: clusters.primaryKeyword,
      cornerstoneKeywords: clusters.cornerstoneKeywords,
      pillarArticleId: clusters.pillarArticleId,
      position: clusters.position,
      createdAt: clusters.createdAt,
      articleCount: sql<number>`coalesce((select count(*) from ${articles} where ${articles.clusterId} = ${clusters.id})::int, 0)`,
      cornerstoneCount: sql<number>`coalesce((select count(*) from ${articles} where ${articles.clusterId} = ${clusters.id} and ${articles.cornerstoneSpecId} is not null)::int, 0)`,
    })
    .from(clusters)
    .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
    .where(whereClause)
    .orderBy(asc(clusters.position), asc(clusters.createdAt));

  const pillarArticleIds = rows
    .map((r) => r.pillarArticleId)
    .filter((id): id is string => id !== null);

  const titleMap = new Map<string, string>();
  if (pillarArticleIds.length > 0) {
    const titles = await db
      .select({
        id: articles.id,
        title: articles.title,
        cornerstoneKeyword: articles.cornerstoneKeyword,
      })
      .from(articles)
      .where(inArray(articles.id, pillarArticleIds));
    for (const t of titles) {
      titleMap.set(t.id, t.title ?? t.cornerstoneKeyword);
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    pillarArticleTitle: r.pillarArticleId ? (titleMap.get(r.pillarArticleId) ?? null) : null,
  }));

  return c.json({ ok: true, data: enriched });
});

// POST /api/clusters
const createClusterSchema = z.object({
  projectSlug: z.string(),
  pillarId: z.string().uuid(),
  name: z.string().min(2).max(200),
  primaryKeyword: z.string().max(200).optional(),
});

clusterRoutes.post("/", zValidator("json", createClusterSchema), async (c) => {
  const input = c.req.valid("json");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, input.projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [pillar] = await db
    .select({ id: contentPillars.id, name: contentPillars.name })
    .from(contentPillars)
    .where(and(eq(contentPillars.id, input.pillarId), eq(contentPillars.projectId, project.id)))
    .limit(1);
  if (!pillar) return c.json({ ok: false, error: "Pillar not found in this project" }, 404);

  const [maxPos] = await db
    .select({ max: sql<number>`coalesce(max(${clusters.position}), -1)::int` })
    .from(clusters)
    .where(eq(clusters.pillarId, input.pillarId));

  const insertValues: typeof clusters.$inferInsert = {
    projectId: project.id,
    pillarId: input.pillarId,
    name: input.name.trim(),
    pillar: pillar.name,
    cornerstoneKeywords: [],
    satelliteKeywords: [],
    position: (maxPos?.max ?? -1) + 1,
  };
  if (input.primaryKeyword !== undefined) insertValues.primaryKeyword = input.primaryKeyword;

  const [created] = await db.insert(clusters).values(insertValues).returning();

  return c.json({ ok: true, data: created }, 201);
});

// PATCH /api/clusters/:id
const updateClusterSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  primaryKeyword: z.string().max(200).nullable().optional(),
  pillarId: z.string().uuid().optional(),
});

clusterRoutes.patch("/:id", zValidator("json", updateClusterSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const [existing] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
  if (!existing) return c.json({ ok: false, error: "Cluster not found" }, 404);

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.primaryKeyword !== undefined)
    updates.primaryKeyword = input.primaryKeyword?.trim() || null;

  if (input.pillarId && input.pillarId !== existing.pillarId) {
    const [newPillar] = await db
      .select({ name: contentPillars.name })
      .from(contentPillars)
      .where(
        and(eq(contentPillars.id, input.pillarId), eq(contentPillars.projectId, existing.projectId))
      )
      .limit(1);
    if (!newPillar) {
      return c.json({ ok: false, error: "Target pillar not found in this project" }, 404);
    }

    const [maxPos] = await db
      .select({ max: sql<number>`coalesce(max(${clusters.position}), -1)::int` })
      .from(clusters)
      .where(eq(clusters.pillarId, input.pillarId));

    updates.pillarId = input.pillarId;
    updates.pillar = newPillar.name;
    updates.position = (maxPos?.max ?? -1) + 1;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ ok: true, data: existing });
  }

  await db.update(clusters).set(updates).where(eq(clusters.id, id));

  const [updated] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
  return c.json({ ok: true, data: updated });
});

// DELETE /api/clusters/:id — articles cascade to clusterId=null via FK
clusterRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const [cluster] = await db
    .select({ id: clusters.id })
    .from(clusters)
    .where(eq(clusters.id, id))
    .limit(1);
  if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .where(eq(articles.clusterId, id));
  const count = countResult[0]?.count ?? 0;

  await db.delete(clusters).where(eq(clusters.id, id));

  return c.json({ ok: true, data: { id, articlesUncategorized: count } });
});

// POST /api/clusters/:id/move — swap position with neighbour within same pillar
const moveClusterSchema = z.object({
  direction: z.enum(["up", "down"]),
});

clusterRoutes.post("/:id/move", zValidator("json", moveClusterSchema), async (c) => {
  const id = c.req.param("id");
  const { direction } = c.req.valid("json");

  const [cluster] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
  if (!cluster) return c.json({ ok: false, error: "Cluster not found" }, 404);

  const neighbour =
    direction === "up"
      ? await db
          .select()
          .from(clusters)
          .where(
            and(
              eq(clusters.pillarId, cluster.pillarId),
              sql`${clusters.position} < ${cluster.position}`
            )
          )
          .orderBy(desc(clusters.position))
          .limit(1)
      : await db
          .select()
          .from(clusters)
          .where(
            and(
              eq(clusters.pillarId, cluster.pillarId),
              sql`${clusters.position} > ${cluster.position}`
            )
          )
          .orderBy(asc(clusters.position))
          .limit(1);

  if (neighbour.length === 0) {
    return c.json({ ok: true, data: { changed: false } });
  }

  const neighbourRow = neighbour[0];
  if (neighbourRow === undefined) {
    return c.json({ ok: true, data: { changed: false } });
  }
  const targetPos = neighbourRow.position;
  const sourcePos = cluster.position;

  await db.transaction(async (tx) => {
    await tx.update(clusters).set({ position: -1 }).where(eq(clusters.id, cluster.id));
    await tx.update(clusters).set({ position: sourcePos }).where(eq(clusters.id, neighbourRow.id));
    await tx.update(clusters).set({ position: targetPos }).where(eq(clusters.id, cluster.id));
  });

  return c.json({ ok: true, data: { changed: true } });
});

// POST /api/clusters/:id/move-articles
const moveArticlesSchema = z.object({
  articleIds: z.array(z.string().uuid()).min(1).max(100),
  toClusterId: z.string().uuid().nullable(),
});

clusterRoutes.post("/:id/move-articles", zValidator("json", moveArticlesSchema), async (c) => {
  const fromClusterId = c.req.param("id");
  const { articleIds, toClusterId } = c.req.valid("json");

  const matches = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(inArray(articles.id, articleIds), eq(articles.clusterId, fromClusterId)));

  if (matches.length !== articleIds.length) {
    return c.json({ ok: false, error: "Some articles do not belong to this cluster" }, 400);
  }

  if (toClusterId) {
    const [fromCluster] = await db
      .select({ projectId: clusters.projectId })
      .from(clusters)
      .where(eq(clusters.id, fromClusterId))
      .limit(1);
    const [toCluster] = await db
      .select({ projectId: clusters.projectId })
      .from(clusters)
      .where(eq(clusters.id, toClusterId))
      .limit(1);
    if (!fromCluster || !toCluster) {
      return c.json({ ok: false, error: "Cluster not found" }, 404);
    }
    if (fromCluster.projectId !== toCluster.projectId) {
      return c.json({ ok: false, error: "Cannot move articles across projects" }, 400);
    }
  }

  await db
    .update(articles)
    .set({ clusterId: toClusterId, updatedAt: new Date() })
    .where(inArray(articles.id, articleIds));

  await recalcPillarArticleId(fromClusterId);
  if (toClusterId) await recalcPillarArticleId(toClusterId);

  return c.json({ ok: true, data: { movedCount: articleIds.length } });
});

// Helper: auto-detect first cornerstone in cluster and update pillarArticleId
export async function recalcPillarArticleId(clusterId: string): Promise<void> {
  const [first] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.clusterId, clusterId), sql`${articles.cornerstoneSpecId} IS NOT NULL`))
    .orderBy(asc(articles.createdAt))
    .limit(1);

  await db
    .update(clusters)
    .set({ pillarArticleId: first?.id ?? null })
    .where(eq(clusters.id, clusterId));
}
