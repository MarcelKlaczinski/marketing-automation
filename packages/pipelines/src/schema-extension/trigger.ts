import { eq } from "drizzle-orm";
import { db, articles } from "@marketing-auto/db";
import { enqueuePipeline } from "../engine/queue.ts";

export async function enqueueSchemaExtension(input: {
  articleId: string;
  projectId: string;
}): Promise<{ jobId: string }> {
  const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
  if (!article) throw new Error(`Article ${input.articleId} not found`);

  if (article.status !== "final_review" && article.status !== "schema_extending") {
    throw new Error(
      `Article status "${article.status}", expected "final_review" or "schema_extending"`,
    );
  }

  await db.update(articles).set({
    status: "schema_extending",
    updatedAt: new Date(),
  }).where(eq(articles.id, input.articleId));

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:schema-extension",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    jobOptions: { jobId: `schema-extension-${input.articleId}` },
  });

  return { jobId };
}
