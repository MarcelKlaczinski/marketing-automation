import { articles, astroSyncRuns, db } from "@marketing-auto/db";
import { enqueuePipeline } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";

const log = createLogger("astro-sync:trigger");

export type EnqueueArticleSyncResult = {
  syncRunId: string;
  jobId: string;
};

export async function enqueueArticleSync(input: {
  articleId: string;
  projectId: string;
}): Promise<EnqueueArticleSyncResult> {
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);
  if (!article) throw new Error(`Article ${input.articleId} not found`);

  if (article.status !== "final_review" && article.status !== "ready_to_publish") {
    throw new Error(
      `Article status is "${article.status}", expected "final_review" or "ready_to_publish"`
    );
  }

  const [syncRun] = await db
    .insert(astroSyncRuns)
    .values({
      projectId: input.projectId,
      articleId: input.articleId,
      status: "pending",
    })
    .returning();

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:astro-sync",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    jobOptions: { jobId: `astro-sync-${input.articleId}` },
  });

  log.info({ articleId: input.articleId, syncRunId: syncRun!.id, jobId }, "Astro sync enqueued");

  return { syncRunId: syncRun!.id, jobId };
}
