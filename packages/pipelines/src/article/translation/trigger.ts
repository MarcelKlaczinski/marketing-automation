import { enqueuePipeline } from "../../engine/queue.ts";

export type TranslationMode = "fresh_translation" | "refresh_propagation";

export type EnqueueTranslationInput = {
  sourceArticleId: string;
  projectId: string;
  mode: TranslationMode;
  /** Required when mode='refresh_propagation' — the existing EN article to refresh. */
  targetArticleId?: string;
};

/**
 * Enqueue the translation pipeline for a DE article.
 * Used by BlogPipeline.afterComplete (fresh_translation) and
 * RefreshPipeline.afterComplete (refresh_propagation).
 */
export async function enqueueTranslationPipeline(
  input: EnqueueTranslationInput,
): Promise<{ jobId: string }> {
  const jobId = input.targetArticleId
    ? `article-translation-${input.sourceArticleId}-${input.targetArticleId}`
    : `article-translation-${input.sourceArticleId}`;

  const { jobId: enqueuedJobId } = await enqueuePipeline({
    pipelineName: "article:translation",
    projectId:    input.projectId,
    input: {
      sourceArticleId: input.sourceArticleId,
      projectId:       input.projectId,
      mode:            input.mode,
      ...(input.targetArticleId ? { targetArticleId: input.targetArticleId } : {}),
    },
    jobOptions: { jobId },
  });

  return { jobId: enqueuedJobId };
}
