import { db, eq, topicBriefs } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { enqueuePipeline } from "../../engine/queue.ts";
import { createBlogArticleFromBrief } from "./persist.ts";

const log = createLogger("pipelines:blog-trigger");

export type EnqueueBlogGenerationInput = {
  briefId: string;
  projectId: string;
  approvalMode?: "manual" | "auto";
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
  /** Pre-created pipeline_runs row ID (preRunId pattern for UI polling). */
  preRunId?: string;
};

export type EnqueueBlogGenerationResult = {
  articleId: string;
  jobId: string;
  status: "blog_generation_enqueued";
};

/**
 * Enqueue the blog pipeline for an approved TopicBrief.
 * Creates the article row if executeDecision has not already done so.
 * Uses the preRunId pattern so the UI gets a stable runId before the worker starts.
 */
export async function enqueueBlogGeneration(
  input: EnqueueBlogGenerationInput,
): Promise<EnqueueBlogGenerationResult> {
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(eq(topicBriefs.id, input.briefId))
    .limit(1);

  if (!brief) {
    throw new Error(`TopicBrief ${input.briefId} not found`);
  }
  if (brief.projectId !== input.projectId) {
    throw new Error(`TopicBrief ${input.briefId} does not belong to project ${input.projectId}`);
  }
  if (brief.approvalStatus !== "approved" && brief.approvalStatus !== "routed") {
    throw new Error(
      `TopicBrief ${input.briefId} is not approved (status: ${brief.approvalStatus}). Approve it first.`,
    );
  }

  const createOpts: { approvalMode?: "manual" | "auto" } = {};
  if (input.approvalMode !== undefined) createOpts.approvalMode = input.approvalMode;
  const articleId = await createBlogArticleFromBrief(brief, createOpts);

  const pipelineInput: Record<string, unknown> = {
    articleId,
    projectId: input.projectId,
    briefId: input.briefId,
  };
  if (input.modelOverride) {
    pipelineInput.modelOverride = input.modelOverride;
  }

  const enqueueOpts: Parameters<typeof enqueuePipeline>[0] = {
    pipelineName: "article:blog",
    projectId: input.projectId,
    input: pipelineInput,
    jobOptions: { jobId: `article-blog-${articleId}` },
  };
  if (input.preRunId) {
    enqueueOpts.preRunId = input.preRunId;
  }

  const { jobId } = await enqueuePipeline(enqueueOpts);

  log.info(
    {
      briefId: input.briefId,
      articleId,
      jobId,
      source: brief.source,
      locale: brief.locale,
    },
    "Blog generation enqueued",
  );

  return { articleId, jobId, status: "blog_generation_enqueued" };
}

/**
 * Thin preRunId-aware wrapper for use with triggerWithPreRunId in the API layer.
 */
export async function enqueueBlogGenerationPipeline(input: {
  preRunId: string;
  articleId: string;
  projectId: string;
  briefId: string;
}): Promise<{ jobId: string }> {
  const { jobId } = await enqueuePipeline({
    pipelineName: "article:blog",
    projectId: input.projectId,
    input: {
      articleId: input.articleId,
      projectId: input.projectId,
      briefId: input.briefId,
    },
    preRunId: input.preRunId,
    jobOptions: { jobId: `article-blog-${input.articleId}` },
  });
  return { jobId };
}
