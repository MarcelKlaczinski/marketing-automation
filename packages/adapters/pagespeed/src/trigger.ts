import { articles, db, pagespeedRuns } from "@marketing-auto/db";
import { enqueuePipeline } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";

const log = createLogger("pagespeed:trigger");

export async function enqueueArticleValidation(input: {
  articleId: string;
  projectId: string;
}): Promise<{ pagespeedRunId: string; jobId: string }> {
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);

  if (!article) throw new Error(`Article ${input.articleId} not found`);

  if (article.status !== "ready_to_publish" && article.status !== "blocked_by_pagespeed") {
    throw new Error(
      `Article status is "${article.status}", expected "ready_to_publish" or "blocked_by_pagespeed"`
    );
  }

  const [run] = await db
    .insert(pagespeedRuns)
    .values({
      projectId: input.projectId,
      articleId: input.articleId,
      status: "pending",
    })
    .returning();

  await db
    .update(articles)
    .set({ status: "validating", updatedAt: new Date() })
    .where(eq(articles.id, input.articleId));

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:pagespeed-validation",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId, pagespeedRunId: run!.id },
    jobOptions: { jobId: `pagespeed-${input.articleId}` },
  });

  log.info({ articleId: input.articleId, runId: run!.id, jobId }, "PageSpeed validation enqueued");

  return { pagespeedRunId: run!.id, jobId };
}
