import {
  articles,
  astroSyncRuns,
  clusters,
  cornerstoneSpecs,
  db,
  pagespeedRuns,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { enqueuePipeline } from "../engine/queue.ts";

const log = createLogger("article-trigger");

// ─── cornerstoneSpecId-based trigger (Spec 45-46) ────────────────────────────

export type EnqueueArticleGenerationInput = {
  /** Cornerstone-spec UUID — already locale-specific. */
  cornerstoneSpecId: string;
  projectId: string;
  approvalMode?: "manual" | "auto";
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
};

export type EnqueueArticleGenerationResult = {
  articleId: string;
  outlineJobId: string;
  status: "outline_enqueued";
};

/**
 * Enqueue article generation for ONE cornerstone-spec (one locale).
 * Creates an article row linked to the spec, updates the spec status to in_generation,
 * and enqueues Job 1 (outline pipeline).
 */
export async function enqueueArticleGeneration(
  input: EnqueueArticleGenerationInput
): Promise<EnqueueArticleGenerationResult> {
  const [spec] = await db
    .select()
    .from(cornerstoneSpecs)
    .where(
      and(
        eq(cornerstoneSpecs.id, input.cornerstoneSpecId),
        eq(cornerstoneSpecs.projectId, input.projectId)
      )
    )
    .limit(1);

  if (!spec) {
    throw new Error(`Cornerstone-spec ${input.cornerstoneSpecId} not found`);
  }
  if (spec.status === "in_generation" || spec.status === "article_done") {
    throw new Error(
      `Cornerstone-spec ${input.cornerstoneSpecId} already in/past generation (status: ${spec.status})`
    );
  }
  if (spec.status === "rejected") {
    throw new Error(`Cornerstone-spec ${input.cornerstoneSpecId} is rejected`);
  }

  let articleId: string;

  if (spec.articleId) {
    // Spec already linked to an article — reuse it if not actively running
    const [existing] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, spec.articleId))
      .limit(1);
    if (existing) {
      if (existing.status === "generating" || existing.status === "drafting") {
        throw new Error(
          `Article ${existing.id} for spec ${input.cornerstoneSpecId} already in progress`
        );
      }
      articleId = existing.id;
      await db
        .update(articles)
        .set({
          status: "generating",
          approvalMode: input.approvalMode ?? "manual",
          updatedAt: new Date(),
        })
        .where(eq(articles.id, articleId));
    } else {
      // articleId was set but article is gone — create a fresh one
      articleId = await createArticleFromSpec(spec, input);
    }
  } else {
    articleId = await createArticleFromSpec(spec, input);
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
      cornerstoneSpecId: input.cornerstoneSpecId,
      locale: spec.locale,
      approvalMode: input.approvalMode ?? "manual",
      outlineJobId,
    },
    "Article generation enqueued (Job 1)"
  );

  return { articleId, outlineJobId, status: "outline_enqueued" };
}

async function createArticleFromSpec(
  spec: typeof cornerstoneSpecs.$inferSelect,
  input: EnqueueArticleGenerationInput
): Promise<string> {
  const [created] = await db
    .insert(articles)
    .values({
      projectId: input.projectId,
      clusterId: spec.clusterId,
      cornerstoneSpecId: spec.id,
      slug: spec.proposedSlug,
      cornerstoneKeyword: spec.cornerstoneKeyword,
      title: spec.proposedTitle,
      metaDescription: spec.metaDescription,
      locale: spec.locale,
      translationKey: spec.translationKey,
      source: "generated",
      collection: "blog",
      status: "generating",
      approvalMode: input.approvalMode ?? "manual",
    })
    .returning({ id: articles.id });

  const articleId = created!.id;

  await db
    .update(cornerstoneSpecs)
    .set({ articleId, status: "in_generation", updatedAt: new Date() })
    .where(eq(cornerstoneSpecs.id, spec.id));

  return articleId;
}

/**
 * Enqueue article generation for the full approved pair of a cluster (DE+EN).
 * Looks up all approved cornerstone-specs for the cluster, then enqueues them in parallel.
 */
export async function enqueueClusterArticleGeneration(input: {
  clusterId: string;
  projectId: string;
  approvalMode?: "manual" | "auto";
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
}): Promise<{ results: Array<EnqueueArticleGenerationResult & { locale: string }> }> {
  const specs = await db
    .select()
    .from(cornerstoneSpecs)
    .where(
      and(
        eq(cornerstoneSpecs.clusterId, input.clusterId),
        eq(cornerstoneSpecs.projectId, input.projectId),
        eq(cornerstoneSpecs.status, "approved")
      )
    );

  if (specs.length === 0) {
    throw new Error(
      `No approved cornerstone-specs for cluster ${input.clusterId}. Approve specs first.`
    );
  }

  const results = await Promise.all(
    specs.map(async (spec) => {
      const enqueueInput: EnqueueArticleGenerationInput = {
        cornerstoneSpecId: spec.id,
        projectId: input.projectId,
      };
      if (input.approvalMode) enqueueInput.approvalMode = input.approvalMode;
      if (input.modelOverride) enqueueInput.modelOverride = input.modelOverride;
      const r = await enqueueArticleGeneration(enqueueInput);
      return { ...r, locale: spec.locale };
    })
  );

  return { results };
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

// ─── Legacy cornerstoneSlug-based trigger (kept for CLI backwards compat) ────

export type LegacyEnqueueInput = {
  /** @deprecated Use enqueueArticleGeneration with cornerstoneSpecId instead. */
  cornerstoneSlug: string;
  projectId: string;
  approvalMode?: "manual" | "auto";
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
};

/**
 * @deprecated Use enqueueArticleGeneration with cornerstoneSpecId instead.
 * Kept for CLI scripts that still pass cornerstoneSlug.
 */
export async function enqueueArticleGenerationLegacy(
  input: LegacyEnqueueInput
): Promise<EnqueueArticleGenerationResult> {
  log.warn({ cornerstoneSlug: input.cornerstoneSlug }, "Legacy cornerstoneSlug trigger used — migrate to cornerstoneSpecId");

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

  return { articleId, outlineJobId, status: "outline_enqueued" };
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

export type PreRunInput = { preRunId: string; articleId: string; projectId: string };

export async function enqueueArticleOutlinePipeline(
  input: PreRunInput
): Promise<{ jobId: string }> {
  const { jobId } = await enqueuePipeline({
    pipelineName: "article:outline",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    preRunId: input.preRunId,
    jobOptions: { jobId: `article-outline-${input.articleId}` },
  });
  return { jobId };
}

export async function enqueueArticleDraftPipeline(input: PreRunInput): Promise<{ jobId: string }> {
  const { jobId } = await enqueuePipeline({
    pipelineName: "article:draft",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId },
    preRunId: input.preRunId,
    jobOptions: { jobId: `article-draft-${input.articleId}` },
  });
  return { jobId };
}

export async function enqueueArticleSyncPipeline(input: PreRunInput): Promise<{ jobId: string }> {
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
    jobOptions: { jobId: `article-astro-sync-${input.articleId}` },
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
    mode: "local",
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
    jobOptions: { jobId: `article-pagespeed-${input.articleId}` },
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
    jobOptions: { jobId: `article-schema-ext-${input.articleId}` },
  });
  return { jobId };
}

export type HeroPreRunInput = PreRunInput & {
  promptOverride?: string;
  articleSlug: string;
};

export async function enqueueHeroImageGenerationPipeline(
  input: HeroPreRunInput
): Promise<{ jobId: string }> {
  const pipelineInput: Record<string, unknown> = {
    articleId: input.articleId,
    projectId: input.projectId,
    articleSlug: input.articleSlug,
  };
  if (input.promptOverride) pipelineInput.promptOverride = input.promptOverride;

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:hero-generation",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: input.preRunId,
    jobOptions: { jobId: `article-hero-${input.articleId}` },
  });
  return { jobId };
}

export type LocalizePreRunInput = PreRunInput & {
  sourceArticleId: string;
  targetLocale: "de" | "en";
  mode: "translate" | "fresh";
  projectSlug: string;
};

export async function enqueueLocalizeArticlePipeline(
  input: LocalizePreRunInput
): Promise<{ jobId: string }> {
  const { jobId } = await enqueuePipeline({
    pipelineName: "article:localize",
    projectId: input.projectId,
    input: {
      sourceArticleId: input.sourceArticleId,
      targetArticleId: input.articleId, // articleId = pre-created target article
      targetLocale: input.targetLocale,
      mode: input.mode,
      projectId: input.projectId,
      projectSlug: input.projectSlug,
    },
    preRunId: input.preRunId,
    // BullMQ-level dedup: prevents a second job from being queued if the first is still pending/active
    jobOptions: { jobId: `article-localize-${input.articleId}` },
  });
  return { jobId };
}

export type ApiPreRunInput = PreRunInput & { url: string };

export async function enqueuePagespeedApiValidationPipeline(
  input: ApiPreRunInput
): Promise<{ jobId: string }> {
  await db.insert(pagespeedRuns).values({
    projectId: input.projectId,
    articleId: input.articleId,
    pipelineRunId: input.preRunId,
    status: "pending",
    mode: "api",
    testedUrl: input.url,
  });

  // API mode does not change article status — leave it as-is (e.g. published).

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:pagespeed-validation-api",
    projectId: input.projectId,
    input: { articleId: input.articleId, projectId: input.projectId, url: input.url },
    preRunId: input.preRunId,
    jobOptions: { jobId: `article-pagespeed-api-${input.articleId}` },
  });
  return { jobId };
}
