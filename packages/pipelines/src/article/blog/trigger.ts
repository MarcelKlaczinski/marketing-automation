import { db, eq, topicBriefs } from "@marketing-auto/db";
import { type ArticleCollectionType, createLogger } from "@marketing-auto/shared";
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
  /**
   * Spec 62.8: planner-dispatched runs carry the planned_items row id so the
   * shared pipeline worker flips planned_item.status enqueued → in_progress
   * → completed/failed around runPipeline.
   */
  plannedItemId?: string;
  /**
   * Spec 63.7b: Astro collection for the generated article. Threaded by the
   * planner executor when the brief routes to article:blog (comparison,
   * ki-wissen, append_to_existing cluster spokes). Defaults to `"blog"` when
   * absent — preserves legacy behaviour for non-planner triggers. Forwarded
   * to `createBlogArticleFromBrief` (initial collection) AND the pipelineInput
   * (so the bridge → PersistArticleStep sets the final collection too).
   */
  collectionType?: ArticleCollectionType;
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

  const createOpts: { approvalMode?: "manual" | "auto"; collection?: ArticleCollectionType } = {};
  if (input.approvalMode !== undefined) createOpts.approvalMode = input.approvalMode;
  if (input.collectionType !== undefined) createOpts.collection = input.collectionType;
  const articleId = await createBlogArticleFromBrief(brief, createOpts);

  const pipelineInput: Record<string, unknown> = {
    articleId,
    projectId: input.projectId,
    briefId: input.briefId,
  };
  if (input.modelOverride) {
    pipelineInput.modelOverride = input.modelOverride;
  }
  if (input.plannedItemId) {
    pipelineInput.plannedItemId = input.plannedItemId;
  }
  if (input.collectionType) {
    pipelineInput.collectionType = input.collectionType;
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
 * Spec 61.2: forwards optional `collectionType` + comparison tool fields when
 * the caller (articles-standalone, future routes) provides them.
 */
export async function enqueueBlogGenerationPipeline(input: {
  preRunId: string;
  articleId: string;
  projectId: string;
  briefId: string;
  collectionType?: ArticleCollectionType;
  comparisonToolSlugs?: string[];
  comparisonToolNames?: string[];
}): Promise<{ jobId: string }> {
  const pipelineInput: Record<string, unknown> = {
    articleId: input.articleId,
    projectId: input.projectId,
    briefId: input.briefId,
  };
  if (input.collectionType) pipelineInput.collectionType = input.collectionType;
  if (input.comparisonToolSlugs?.length) pipelineInput.comparisonToolSlugs = input.comparisonToolSlugs;
  if (input.comparisonToolNames?.length) pipelineInput.comparisonToolNames = input.comparisonToolNames;

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:blog",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: input.preRunId,
    jobOptions: { jobId: `article-blog-${input.articleId}` },
  });
  return { jobId };
}
