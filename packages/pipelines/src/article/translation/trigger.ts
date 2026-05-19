import { enqueuePipeline } from "../../engine/queue.ts";

export type TranslationMode = "fresh_translation" | "refresh_propagation" | "manual_resync";

export type EnqueueTranslationInput = {
  sourceArticleId: string;
  projectId: string;
  mode: TranslationMode;
  /** Required when mode='refresh_propagation' or 'manual_resync' — the existing target article. */
  targetArticleId?: string;
  /** Pre-inserted pipeline_runs ID from triggerWithPreRunId (API-triggered runs). */
  preRunId?: string;
};

/**
 * Enqueue the translation pipeline.
 * Used by BlogPipeline.afterComplete (fresh_translation),
 * RefreshPipeline.afterComplete (refresh_propagation), and
 * the POST /articles/:id/translate HTTP endpoint (all modes).
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
    ...(input.preRunId ? { preRunId: input.preRunId } : {}),
    jobOptions: { jobId },
  });

  return { jobId: enqueuedJobId };
}
