/**
 * Chain-Orchestrator for Spec 49d (Per-Gap Automation Chain).
 *
 * Manages the 6-step automation chain:
 *   outline → draft → schema-de → localize → schema-en → [astro-transfer]
 *
 * State is persisted in pipeline_chains. Each pipeline's afterComplete hook
 * calls advanceChain() / failChain() when chainId is present in pipelineInput.
 *
 * No auto-retry on failure (cost-anti-drain convention).
 * Manual recovery via resumeChain() triggered from POST /pipeline-chains/:id/resume.
 */

import {
  articles,
  type ChainStep,
  costLogs,
  db,
  pipelineChains,
  projects,
} from "@marketing-auto/db";
import { enqueuePipeline, slugify } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, inArray, sql } from "drizzle-orm";

const log = createLogger("chain-orchestrator");

// ─── Step Sequence ────────────────────────────────────────────────────────────

const STEP_SEQUENCE: ChainStep[] = [
  "outline",
  "draft",
  "schema-de",
  "localize",
  "schema-en",
  "astro-transfer",
];

function nextStep(
  completedStep: ChainStep,
  autoPublish: boolean
): ChainStep | null {
  const idx = STEP_SEQUENCE.indexOf(completedStep);
  if (idx === -1) return null;
  const candidate = STEP_SEQUENCE[idx + 1];
  if (!candidate) return null;
  // astro-transfer only runs if autoPublish is enabled
  if (candidate === "astro-transfer" && !autoPublish) return null;
  return candidate;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function startChain(input: {
  projectId: string;
  gapId: string;
  articleId: string;
}): Promise<{ chainId: string; firstStep: ChainStep }> {
  const [project] = await db
    .select({ id: projects.id, autoPublish: projects.autoPublish })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) throw new Error(`Project ${input.projectId} not found`);

  const [chain] = await db
    .insert(pipelineChains)
    .values({
      projectId: input.projectId,
      gapId:     input.gapId,
      articleId: input.articleId,
      status:    "running",
      autoPublish: project.autoPublish,
    })
    .returning({ id: pipelineChains.id });

  const chainId = chain!.id;

  const { jobId } = await enqueuePipeline({
    pipelineName: "article:outline",
    projectId: input.projectId,
    input: {
      articleId:    input.articleId,
      projectId:    input.projectId,
      chainId,
      chainStep:    "outline" satisfies ChainStep,
      approvalMode: "manual", // chain controls sequencing, not approvalMode
    },
    jobOptions: { jobId: `chain-${chainId}-outline` },
  });

  await db
    .update(pipelineChains)
    .set({ currentStep: "outline", updatedAt: new Date() })
    .where(eq(pipelineChains.id, chainId));

  log.info({ chainId, articleId: input.articleId, jobId }, "[chain] Started — step outline enqueued");
  return { chainId, firstStep: "outline" };
}

export async function advanceChain(
  chainId: string,
  completedStep: ChainStep,
  runId: string
): Promise<void> {
  const [chain] = await db
    .select()
    .from(pipelineChains)
    .where(eq(pipelineChains.id, chainId))
    .limit(1);

  if (!chain) {
    log.warn({ chainId, completedStep }, "[chain] advanceChain: chain not found");
    return;
  }
  if (chain.status === "failed" || chain.status === "cancelled") {
    log.info({ chainId, completedStep, status: chain.status }, "[chain] advanceChain: chain already terminal — skipping");
    return;
  }

  // Persist this step's run ID
  const updatedStepRuns = { ...(chain.stepRuns as Partial<Record<ChainStep, string>>), [completedStep]: runId };

  // Aggregate cost from all step runs so far
  const runIds = Object.values(updatedStepRuns).filter((id): id is string => Boolean(id));
  const costResult = runIds.length > 0
    ? await db
        .select({ total: sql<string>`COALESCE(SUM(${costLogs.costEur}), 0)` })
        .from(costLogs)
        .where(inArray(costLogs.pipelineRunId, runIds))
    : [{ total: "0" }];
  const totalCostEur = costResult[0]?.total ?? "0";

  const next = nextStep(completedStep, chain.autoPublish);

  if (!next) {
    // Chain complete
    await db
      .update(pipelineChains)
      .set({
        status:      "completed",
        currentStep:  completedStep,
        stepRuns:     updatedStepRuns,
        totalCostEur,
        completedAt:  new Date(),
        updatedAt:    new Date(),
      })
      .where(eq(pipelineChains.id, chainId));
    log.info({ chainId, completedStep, totalCostEur }, "[chain] Completed");
    return;
  }

  // Trigger next step
  await triggerStep(chain.projectId, chainId, next, chain, updatedStepRuns, totalCostEur);
}

export async function failChain(
  chainId: string,
  failedStep: ChainStep,
  errorMessage: string
): Promise<void> {
  await db
    .update(pipelineChains)
    .set({
      status:       "failed",
      failedStep,
      failedAt:     new Date(),
      errorMessage,
      updatedAt:    new Date(),
    })
    .where(eq(pipelineChains.id, chainId));
  log.warn({ chainId, failedStep, errorMessage }, "[chain] Failed");
}

export async function resumeChain(
  chainId: string
): Promise<{ resumedStep: ChainStep }> {
  const [chain] = await db
    .select()
    .from(pipelineChains)
    .where(eq(pipelineChains.id, chainId))
    .limit(1);

  if (!chain) throw new Error(`Chain ${chainId} not found`);
  if (chain.status !== "failed" && chain.status !== "paused") {
    throw new Error(`Chain ${chainId} is not in a resumable state (status: ${chain.status})`);
  }

  const resumeAt = (chain.failedStep ?? chain.currentStep) as ChainStep | null;
  if (!resumeAt) throw new Error(`Chain ${chainId} has no step to resume from`);

  await db
    .update(pipelineChains)
    .set({
      status:      "running",
      failedStep:  null,
      failedAt:    null,
      errorMessage: null,
      updatedAt:   new Date(),
    })
    .where(eq(pipelineChains.id, chainId));

  await triggerStep(
    chain.projectId,
    chainId,
    resumeAt,
    chain,
    chain.stepRuns as Partial<Record<ChainStep, string>>,
    String(chain.totalCostEur ?? "0")
  );

  log.info({ chainId, resumedStep: resumeAt }, "[chain] Resumed");
  return { resumedStep: resumeAt };
}

export async function cancelChain(chainId: string): Promise<void> {
  await db
    .update(pipelineChains)
    .set({
      status:       "cancelled",
      errorMessage: "Cancelled by user",
      updatedAt:    new Date(),
    })
    .where(and(
      eq(pipelineChains.id, chainId),
      // Only cancel if not already terminal
      sql`${pipelineChains.status} NOT IN ('completed', 'failed', 'cancelled')`
    ));
  log.info({ chainId }, "[chain] Cancelled");
}

// ─── Internal: trigger a specific step ───────────────────────────────────────

async function triggerStep(
  projectId: string,
  chainId: string,
  step: ChainStep,
  chain: typeof pipelineChains.$inferSelect,
  updatedStepRuns: Partial<Record<ChainStep, string>>,
  totalCostEur: string
): Promise<void> {
  const articleId = chain.articleId;
  if (!articleId) throw new Error(`Chain ${chainId} has no articleId`);

  let jobId: string;

  switch (step) {
    case "draft": {
      const result = await enqueuePipeline({
        pipelineName: "article:draft",
        projectId,
        input: { articleId, projectId, chainId, chainStep: "draft" satisfies ChainStep },
        jobOptions: { jobId: `chain-${chainId}-draft` },
      });
      jobId = result.jobId;
      break;
    }

    case "schema-de": {
      const result = await enqueuePipeline({
        pipelineName: "article:schema-extension",
        projectId,
        input: { articleId, projectId, chainId, chainStep: "schema-de" satisfies ChainStep },
        jobOptions: { jobId: `chain-${chainId}-schema-de` },
      });
      jobId = result.jobId;
      break;
    }

    case "localize": {
      const siblingArticleId = await createEnSibling(projectId, articleId);
      // Persist sibling ID before triggering so that failure recovery can find it
      await db
        .update(pipelineChains)
        .set({ siblingArticleId, updatedAt: new Date() })
        .where(eq(pipelineChains.id, chainId));

      const [proj] = await db
        .select({ slug: projects.slug })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!proj) throw new Error(`Project ${projectId} not found`);

      const result = await enqueuePipeline({
        pipelineName: "article:localize",
        projectId,
        input: {
          sourceArticleId: articleId,
          targetArticleId: siblingArticleId,
          targetLocale:    "en",
          mode:            "translate",
          projectId,
          projectSlug:     proj.slug,
          chainId,
          chainStep:       "localize" satisfies ChainStep,
        },
        jobOptions: { jobId: `chain-${chainId}-localize` },
      });
      jobId = result.jobId;
      break;
    }

    case "schema-en": {
      const siblingArticleId = chain.siblingArticleId;
      if (!siblingArticleId) throw new Error(`Chain ${chainId} has no siblingArticleId for schema-en step`);

      const result = await enqueuePipeline({
        pipelineName: "article:schema-extension",
        projectId,
        input: {
          articleId: siblingArticleId, // EN article
          projectId,
          chainId,
          chainStep: "schema-en" satisfies ChainStep,
        },
        jobOptions: { jobId: `chain-${chainId}-schema-en` },
      });
      jobId = result.jobId;
      break;
    }

    case "astro-transfer": {
      // Trigger sync for DE article (EN sibling is separate — not in scope for auto-chain)
      const result = await enqueuePipeline({
        pipelineName: "article:astro-sync",
        projectId,
        input: { articleId, projectId, chainId, chainStep: "astro-transfer" satisfies ChainStep },
        jobOptions: { jobId: `chain-${chainId}-astro-transfer` },
      });
      jobId = result.jobId;
      break;
    }

    case "outline": {
      const result = await enqueuePipeline({
        pipelineName: "article:outline",
        projectId,
        input: { articleId, projectId, chainId, chainStep: "outline" satisfies ChainStep, approvalMode: "manual" },
        jobOptions: { jobId: `chain-${chainId}-outline` },
      });
      jobId = result.jobId;
      break;
    }
  }

  await db
    .update(pipelineChains)
    .set({
      currentStep:  step,
      stepRuns:     updatedStepRuns,
      totalCostEur,
      updatedAt:    new Date(),
    })
    .where(eq(pipelineChains.id, chainId));

  log.info({ chainId, step, jobId }, `[chain] Step '${step}' triggered`);
}

// ─── Helper: create EN sibling article stub ───────────────────────────────────

async function createEnSibling(projectId: string, deArticleId: string): Promise<string> {
  const [source] = await db
    .select({
      id:                 articles.id,
      clusterId:          articles.clusterId,
      slug:               articles.slug,
      translationKey:     articles.translationKey,
      title:              articles.title,
      metaDescription:    articles.metaDescription,
      cornerstoneKeyword: articles.cornerstoneKeyword,
      collection:         articles.collection,
      cornerstoneSpecId:  articles.cornerstoneSpecId,
      clusterRole:        articles.clusterRole,
      intentType:         articles.intentType,
    })
    .from(articles)
    .where(eq(articles.id, deArticleId))
    .limit(1);

  if (!source) throw new Error(`Source DE article ${deArticleId} not found`);

  // Ensure translationKey is set
  let translationKey = source.translationKey;
  if (!translationKey) {
    translationKey = slugify(source.slug);
    await db
      .update(articles)
      .set({ translationKey, updatedAt: new Date() })
      .where(eq(articles.id, deArticleId));
  }

  // Check if EN sibling already exists (idempotent resume safety)
  const [existing] = await db
    .select({ id: articles.id, status: articles.status })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.translationKey, translationKey),
        eq(articles.locale, "en")
      )
    )
    .limit(1);

  if (existing) {
    if (existing.status === "generating" || existing.status === "drafting") {
      // Localize pipeline already running — reuse the ID
      return existing.id;
    }
    // Reset status so localize pipeline can proceed
    await db
      .update(articles)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(articles.id, existing.id));
    return existing.id;
  }

  // Create fresh EN stub
  const baseInsert = {
    projectId,
    clusterId:          source.clusterId ?? null,
    locale:             "en" as const,
    translationKey,
    title:              source.title ?? "",
    slug:               `${source.slug}-en`,
    metaDescription:    source.metaDescription,
    cornerstoneKeyword: source.cornerstoneKeyword,
    collection:         source.collection ?? "blog",
    source:             "generated" as const,
    status:             "generating" as const,
    approvalMode:       "manual" as const,
    clusterRole:        source.clusterRole ?? null,
  };

  const insertValues = source.intentType
    ? { ...baseInsert, intentType: source.intentType }
    : baseInsert;

  const [created] = await db
    .insert(articles)
    .values(insertValues)
    .returning({ id: articles.id });

  return created!.id;
}
