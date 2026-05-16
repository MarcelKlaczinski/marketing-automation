import { articles, and, db, eq, topicBriefs } from "@marketing-auto/db";
import type { TopicBrief } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

export class BlogPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlogPipelineError";
  }
}

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
 * Throws BlogPipelineError if the author slug does not exist in the project's
 * authors collection — defense-in-depth against author-picker bugs.
 */
export async function updateArticleAuthor(
  articleId: string,
  authorSlug: string,
  matchStrategy: "historic_score" | "embedding_fallback" | "default_fallback",
): Promise<void> {
  // Read article to get projectId + locale for validation
  const [articleRow] = await db
    .select({ projectId: articles.projectId, locale: articles.locale, frontmatterExtras: articles.frontmatterExtras })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);

  if (!articleRow) {
    throw new BlogPipelineError(`updateArticleAuthor: article ${articleId} not found`);
  }

  const locale = (articleRow.locale as "de" | "en" | null) ?? "de";

  // Validate the author exists in the authors collection before writing
  const authorExists = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, articleRow.projectId),
        eq(articles.collection, "authors"),
        eq(articles.slug, authorSlug),
        eq(articles.locale, locale),
      ),
    )
    .limit(1);

  if (authorExists.length === 0) {
    throw new BlogPipelineError(
      `Cannot persist article ${articleId} with author "${authorSlug}" — author does not exist in project author pool (locale: ${locale}). This indicates a bug in author-picker.`,
    );
  }

  const existing = (articleRow.frontmatterExtras ?? {}) as Record<string, unknown>;

  await db
    .update(articles)
    .set({
      author: authorSlug,
      frontmatterExtras: { ...existing, authorPickStrategy: matchStrategy },
      updatedAt: new Date(),
    })
    .where(eq(articles.id, articleId));
}
