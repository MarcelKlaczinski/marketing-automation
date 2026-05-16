import { enqueuePipeline } from "../../engine/queue.ts";

export async function enqueueRefreshPipeline(input: {
  preRunId: string;
  articleId: string;
  projectId: string;
  briefId: string;
}): Promise<{ jobId: string }> {
  const { jobId } = await enqueuePipeline({
    pipelineName: "article:refresh",
    projectId: input.projectId,
    input: {
      articleId: input.articleId,
      projectId: input.projectId,
      briefId:   input.briefId,
    },
    preRunId:   input.preRunId,
    jobOptions: { jobId: `article-refresh-${input.articleId}` },
  });
  return { jobId };
}
