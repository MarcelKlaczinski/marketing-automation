import { enqueuePipeline } from "../../engine/queue.ts";

export type EnqueueSocialImageInput = {
  articleId: string;
  projectId: string;
  theme?: "dark" | "light";
  variant?: "stunning";
  locales?: string[];
  preRunId?: string;
  // Spec 60.6: explicit template key; null = auto-route by tool count (existing behavior)
  templateKey?: string | null;
};

export async function enqueueSocialImagePipeline(
  input: EnqueueSocialImageInput
): Promise<{ jobId: string }> {
  const pipelineInput: Record<string, unknown> = {
    articleId: input.articleId,
    projectId: input.projectId,
    theme: input.theme ?? "dark",
    variant: input.variant ?? "stunning",
    locales: input.locales ?? ["de-DE"],
  };
  if (input.templateKey != null) pipelineInput.templateKey = input.templateKey;

  return enqueuePipeline({
    pipelineName: "article:social-image",
    projectId: input.projectId,
    input: pipelineInput,
    jobOptions: {
      jobId: `social-image-${input.articleId}-${Date.now()}`,
    },
    ...(input.preRunId ? { preRunId: input.preRunId } : {}),
  });
}
