import { pruneOldNotifications } from "@marketing-auto/core/notifications";
import { articleDiscovery, articles, db, templateRenders } from "@marketing-auto/db";
import { and, eq, isNotNull, sql } from "@marketing-auto/db";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth.ts";

export const adminRoutes = new Hono();
adminRoutes.use(requireAuth);

adminRoutes.post("/prune-notifications", async (c) => {
  const result = await pruneOldNotifications();
  return c.json({ ok: true, data: result });
});

// Spec 54c: notification counts for admin header badge
const countsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
});

adminRoutes.get("/notification-counts", zValidator("query", countsQuerySchema), async (c) => {
  const { projectId } = c.req.valid("query");

  // Articles with pending suggestions (have suggested_templates but no ready/rendering renders)
  const articleConditions = [
    isNotNull(articles.projectId),
    sql`jsonb_typeof(${articleDiscovery.suggestedTemplates}) = 'array'`,
    sql`jsonb_array_length(${articleDiscovery.suggestedTemplates}) > 0`,
  ];
  if (projectId) {
    articleConditions.push(eq(articles.projectId, projectId));
  }

  const pendingSuggestionsResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articleDiscovery)
    .innerJoin(articles, eq(articleDiscovery.articleId, articles.id))
    .where(
      and(
        ...articleConditions,
        sql`NOT EXISTS (
          SELECT 1 FROM ${templateRenders} tr
          WHERE tr.article_id = ${articleDiscovery.articleId}
            AND tr.status IN ('ready', 'rendering')
        )`
      )
    );

  const pendingSuggestions = pendingSuggestionsResult[0]?.count ?? 0;

  return c.json({ ok: true, data: { pendingSuggestions } });
});
