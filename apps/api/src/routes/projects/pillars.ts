import { asc, clusters, contentPillars, db, eq, projects, sql } from "@marketing-auto/db";
import { Hono } from "hono";
import { requireAuth } from "../../middleware/auth.ts";

export const scopedPillarRoutes = new Hono();
scopedPillarRoutes.use(requireAuth);

// ─── GET /api/projects/:slug/pillars ──────────────────────────────────────────

scopedPillarRoutes.get("/:slug/pillars", async (c) => {
  const { slug } = c.req.param();

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const rows = await db
    .select({
      id: contentPillars.id,
      name: contentPillars.name,
      description: contentPillars.description,
      position: contentPillars.position,
      createdAt: contentPillars.createdAt,
      clusterCount: sql<number>`coalesce(count(${clusters.id}), 0)::int`,
    })
    .from(contentPillars)
    .leftJoin(clusters, eq(clusters.pillarId, contentPillars.id))
    .where(eq(contentPillars.projectId, project.id))
    .groupBy(contentPillars.id)
    .orderBy(asc(contentPillars.position), asc(contentPillars.createdAt));

  return c.json({ ok: true, data: rows });
});
