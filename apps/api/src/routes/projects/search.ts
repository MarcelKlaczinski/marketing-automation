import {
  and,
  articles,
  clusters,
  db,
  eq,
  ilike,
  or,
  projects,
  topicBriefs,
} from "@marketing-auto/db";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";

export const projectSearchRoutes = new Hono();

projectSearchRoutes.use(requireAuth);

const searchQuerySchema = z.object({
  q: z.string().min(2).max(100),
  types: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─── GET /:slug/search?q= ─────────────────────────────────────────────────────
projectSearchRoutes.get("/:slug/search", async (c) => {
  const { slug } = c.req.param();

  const result = searchQuerySchema.safeParse(c.req.query());
  if (!result.success) {
    return c.json({ ok: false, error: "validation_error", details: result.error.flatten() }, 400);
  }
  const { q, types, limit } = result.data;

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const wantedTypes = types?.split(",").map((t) => t.trim()) ?? ["articles", "briefs", "clusters"];
  const pattern = `%${q}%`;

  const [articleRows, briefRows, clusterRows] = await Promise.all([
    wantedTypes.includes("articles")
      ? db
          .select({
            id: articles.id,
            title: articles.title,
            slug: articles.slug,
            collection: articles.collection,
            locale: articles.locale,
            status: articles.status,
          })
          .from(articles)
          .where(
            and(
              eq(articles.projectId, project.id),
              or(
                ilike(articles.title, pattern),
                ilike(articles.cornerstoneKeyword, pattern),
                ilike(articles.slug, pattern),
              ),
            ),
          )
          .limit(limit)
      : Promise.resolve([]),

    wantedTypes.includes("briefs")
      ? db
          .select({
            id: topicBriefs.id,
            topicTitle: topicBriefs.topicTitle,
            primaryKeyword: topicBriefs.primaryKeyword,
            source: topicBriefs.source,
            approvalStatus: topicBriefs.approvalStatus,
          })
          .from(topicBriefs)
          .where(
            and(
              eq(topicBriefs.projectId, project.id),
              or(
                ilike(topicBriefs.topicTitle, pattern),
                ilike(topicBriefs.primaryKeyword, pattern),
              ),
            ),
          )
          .limit(limit)
      : Promise.resolve([]),

    wantedTypes.includes("clusters")
      ? db
          .select({
            id: clusters.id,
            name: clusters.name,
            primaryKeyword: clusters.primaryKeyword,
            generationStatus: clusters.generationStatus,
          })
          .from(clusters)
          .where(
            and(
              eq(clusters.projectId, project.id),
              or(
                ilike(clusters.name, pattern),
                ilike(clusters.primaryKeyword, pattern),
              ),
            ),
          )
          .limit(limit)
      : Promise.resolve([]),
  ]);

  return c.json({
    ok: true,
    data: {
      articles: articleRows,
      briefs: briefRows,
      clusters: clusterRows,
    },
  });
});
