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
  /**
   * Spec 62.8: planner-dispatched runs carry the planned_items row id so the
   * shared pipeline worker flips planned_item status around runPipeline.
   */
  plannedItemId?: string;
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
  if (input.plannedItemId) pipelineInput.plannedItemId = input.plannedItemId;

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
