import { articles, db, eq, topicBriefs } from "@marketing-auto/db";
import type { TopicBrief } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pipelines:blog-persist");

/**
 * Create the article row for a blog brief if it does not already exist.
 * Called by the blog trigger before enqueueing the pipeline.
 * If the brief already has routedArticleId set, returns that ID unchanged.
 */
export async function createBlogArticleFromBrief(
  brief: TopicBrief,
  opts: {
    approvalMode?: "manual" | "auto";
  } = {},
): Promise<string> {
  if (brief.routedArticleId) {
    // executeDecision already created the article — reuse it
    await db
      .update(articles)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(articles.id, brief.routedArticleId));
    return brief.routedArticleId;
  }

  const locale = (brief.locale as "de" | "en" | null) ?? "de";

  const [created] = await db
    .insert(articles)
    .values({
      projectId: brief.projectId,
      clusterId: brief.clusterId ?? null,
      slug: brief.suggestedSlug ?? `brief-${brief.id.slice(0, 8)}`,
      title: brief.suggestedTitle ?? brief.topicTitle,
      metaDescription: brief.suggestedMeta ?? null,
      cornerstoneKeyword: brief.primaryKeyword ?? brief.topicTitle,
      locale,
      source: "generated",
      collection: "blog",
      status: "generating",
      intentType: brief.intentType ?? null,
      approvalMode: opts.approvalMode ?? "manual",
    })
    .returning({ id: articles.id });

  const articleId = created!.id;

  // Link brief → article
  await db
    .update(topicBriefs)
    .set({ routedArticleId: articleId, updatedAt: new Date() })
    .where(eq(topicBriefs.id, brief.id));

  log.info({ briefId: brief.id, articleId }, "[blog-persist] article created from brief");
  return articleId;
}

/**
 * Write the picked author slug back to the article row.
 * Also writes authorPickStrategy to frontmatterExtras for audit.
 */
export async function updateArticleAuthor(
  articleId: string,
  authorSlug: string,
  matchStrategy: "historic_score" | "embedding_fallback" | "default_fallback",
): Promise<void> {
  // Read current extras to merge (don't clobber other keys)
  const [row] = await db
    .select({ frontmatterExtras: articles.frontmatterExtras })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);

  const existing = (row?.frontmatterExtras ?? {}) as Record<string, unknown>;

  await db
    .update(articles)
    .set({
      author: authorSlug,
      frontmatterExtras: { ...existing, authorPickStrategy: matchStrategy },
      updatedAt: new Date(),
    })
    .where(eq(articles.id, articleId));
}
