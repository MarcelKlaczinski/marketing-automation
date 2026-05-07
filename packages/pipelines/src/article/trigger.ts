import { articles, astroSyncRuns, clusters, db, pagespeedRuns } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { enqueuePipeline } from "../engine/queue.ts";

const log = createLogger("article-trigger");

export type EnqueueArticleGenerationInput = {
  /** The cornerstone keyword used as the primary article identifier. */
  cornerstoneSlug: string;
  projectId: string;
  /** "manual" pauses after outline; "auto" runs Job 2 immediately on Job 1 completion. */
  approvalMode?: "manual" | "auto";
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
};

export type EnqueueArticleGenerationResult = {
  articleId: string;
  outlineJobId: string;
  status: "outline_enqueued";
};

/**
 * Single entry point used by ALL triggers (CLI single, CLI batch, scheduler, HTTP endpoint).
 * Creates an articles row in "generating" state and enqueues Job 1 (outline pipeline).
 */
export async function enqueueArticleGeneration(
  input: EnqueueArticleGenerationInput
): Promise<EnqueueArticleGenerationResult> {
  const existing = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, input.projectId),
        eq(articles.cornerstoneKeyword, input.cornerstoneSlug)
      )
    )
    .limit(1);

  let articleId: string;

  if (existing.length > 0) {
    const e = existing[0]!;
    if (e.status === "generating" || e.status === "drafting") {
      throw new Error(
        `Article for "${input.cornerstoneSlug}" is already in progress (status: ${e.status}). ` +
          `Wait for it to complete or fail.`
      );
    }
    if (e.status === "published") {
      throw new Error(
        `Article for "${input.cornerstoneSlug}" is already published. ` +
          `To regenerate, set its status to "approved" first.`
      );
    }
    articleId = e.id;
    await db
      .update(articles)
      .set({
        status: "generating",
        approvalMode: input.approvalMode ?? "manual",
        updatedAt: new Date(),
      })
      .where(eq(articles.id, articleId));
  } else {
    const cluster = await findClusterByCornerstone(input.projectId, input.cornerstoneSlug);
    if (!cluster) {
      throw new Error(
        `No cluster found containing cornerstone keyword "${input.cornerstoneSlug}" for project. ` +
          `Run cold-start cluster-plan first.`
      );
    }
    const [created] = await db
      .insert(articles)
      .values({
        projectId: input.projectId,
        clusterId: cluster.id,
        slug: slugify(input.cornerstoneSlug),
        cornerstoneKeyword: input.cornerstoneSlug,
        status: "generating",
        approvalMode: input.approvalMode ?? "manual",
      })
      .returning();
    articleId = created!.id;
  }

  const { jobId: outlineJobId } = await enqueuePipeline({
    pipelineName: "article:outline",
    projectId: input.projectId,
    input: {
      articleId,
      projectId: input.projectId,
      ...(input.modelOverride && { modelOverride: input.modelOverride }),
    },
    jobOptions: { jobId: `article-outline-${articleId}` },
  });

  log.info(
    {
      articleId,
      cornerstoneSlug: input.cornerstoneSlug,
      approvalMode: input.approvalMode ?? "manual",
      outlineJobId,
    },
    "Article generation enqueued (Job 1)"
  );

  return { articleId, outlineJobId, status: "outline_enqueued" };
}

/**
 * Continues a paused article — runs Job 2 (draft + image + assembly).
 * Called via `article:continue` CLI in manual mode, or auto-called at end of Job 1 in auto mode.
 */
export async function continueArticleGeneration(input: {
  articleId: string;
  projectId: string;
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
}): Promise<{ draftJobId: string }> {
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);

  if (!article) throw new Error(`Article ${input.articleId} not found`);
  if (article.status !== "outline_review") {
    throw new Error(
      `Article status is "${article.status}", expected "outline_review". Cannot continue.`
    );
  }
  if (!article.outline) {
    throw new Error(`Article has no outline persisted; Job 1 incomplete.`);
  }

  await db
    .update(articles)
    .set({
      status: "drafting",
      updatedAt: new Date(),
    })
    .where(eq(articles.id, input.articleId));

  const { jobId: draftJobId } = await enqueuePipeline({
    pipelineName: "article:draft",
    projectId: input.projectId,
    input: {
      articleId: input.articleId,
      projectId: input.projectId,
      ...(input.modelOverride && { modelOverride: input.modelOverride }),
    },
    jobOptions: { jobId: `article-draft-${input.articleId}` },
  });

  log.info({ articleId: input.articleId, draftJobId }, "Article generation continued (Job 2)");

  return { draftJobId };
}

// ───── Helpers ────────────────────────────────────────────────────────────────

async function findClusterByCornerstone(projectId: string, cornerstoneKeyword: string) {
  const allClusters = await db.select().from(clusters).where(eq(clusters.projectId, projectId));

  return (
    allClusters.find((c) => {
      const keywords = (c.cornerstoneKeywords as string[]) ?? [];
      return keywords.includes(cornerstoneKeyword);
    }) ?? null
  );
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      // Expand German umlauts before NFD so they don't collapse to a/o/u
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}

// ─── preRunId-aware wrappers (Spec 36) ───────────────────────────────────────
// These are thin wrappers used by HTTP trigger endpoints. The route handler
// creates the pipelineRuns row first (preRunId pattern), then calls one of
// these to enqueue the BullMQ job with the preRunId so the worker updates
// the existing row instead of inserting a new one.

export type PreRunInput = { preRunId: string; articleId: string; projectId: string };

export async function enqueueArticleOutlinePipeline(
  input: PreRunInput
): Promise<{ jobId: string }> {
  const { jobId } = await enqueuePipeline({
    pipelineName: "article:outline",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    preRunId: input.preRunId,
  });
  return { jobId };
}

export async function enqueueArticleDraftPipeline(input: PreRunInput): Promise<{ jobId: string }> {
  const { jobId } = await enqueuePipeline({
    pipelineName: "article:draft",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    preRunId: input.preRunId,
  });
  return { jobId };
}

export async function enqueueArticleSyncPipeline(input: PreRunInput): Promise<{ jobId: string }> {
  // Pre-create the astroSyncRuns row so the pipeline's afterError hook can
  // find and settle it even if the worker crashes before UpdateDbStatusStep.
  await db.insert(astroSyncRuns).values({
    projectId: input.projectId,
    articleId: input.articleId,
    pipelineRunId: input.preRunId,
    status: "pending",
  });

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:astro-sync",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    preRunId: input.preRunId,
  });
  return { jobId };
}

export async function enqueuePagespeedValidationPipeline(
  input: PreRunInput
): Promise<{ jobId: string }> {
  await db.insert(pagespeedRuns).values({
    projectId: input.projectId,
    articleId: input.articleId,
    pipelineRunId: input.preRunId,
    status: "pending",
  });

  await db
    .update(articles)
    .set({ status: "validating", updatedAt: new Date() })
    .where(eq(articles.id, input.articleId));

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:pagespeed-validation",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    preRunId: input.preRunId,
  });
  return { jobId };
}

export async function enqueueSchemaExtensionPipeline(
  input: PreRunInput
): Promise<{ jobId: string }> {
  const { jobId } = await enqueuePipeline({
    pipelineName: "article:schema-extension",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    preRunId: input.preRunId,
  });
  return { jobId };
}
