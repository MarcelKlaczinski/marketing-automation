import { enqueuePipeline } from "../../engine/queue.ts";

export type EnqueueSocialImageInput = {
  articleId: string;
  projectId: string;
  theme?: "dark" | "light";
  preRunId?: string;
};

export async function enqueueSocialImagePipeline(
  input: EnqueueSocialImageInput
): Promise<{ jobId: string }> {
  return enqueuePipeline({
    pipelineName: "article:social-image",
    projectId: input.projectId,
    input: {
      articleId: input.articleId,
      projectId: input.projectId,
      theme: input.theme ?? "dark",
    },
    jobOptions: {
      jobId: `social-image-${input.articleId}-${Date.now()}`,
    },
    ...(input.preRunId ? { preRunId: input.preRunId } : {}),
  });
}
