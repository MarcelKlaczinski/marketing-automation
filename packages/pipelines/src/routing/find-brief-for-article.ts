import { eq, db, topicBriefs, type TopicBrief } from "@marketing-auto/db";

/**
 * Finds the TopicBrief that was routed to create a given article.
 * Used by TopicIntakeStep to resolve keywords from the brief rather than
 * the cluster's satellite_keywords (which is the legacy path).
 *
 * Returns null for articles created before Spec 54.3 (no routed_article_id link).
 */
export async function findBriefForArticle(
  articleId: string,
): Promise<TopicBrief | null> {
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(eq(topicBriefs.routedArticleId, articleId))
    .limit(1);

  return brief ?? null;
}
