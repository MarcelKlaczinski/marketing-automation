import { enqueuePipeline } from "../../engine/queue.ts";

export type EnqueueSocialImageInput = {
  articleId: string;
  projectId: string;
  theme?: "dark" | "light";
  variant?: "stunning";
  locales?: string[];
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
      variant: input.variant ?? "stunning",
      locales: input.locales ?? ["de-DE"],
    },
    jobOptions: {
      jobId: `social-image-${input.articleId}-${Date.now()}`,
    },
    ...(input.preRunId ? { preRunId: input.preRunId } : {}),
  });
}
