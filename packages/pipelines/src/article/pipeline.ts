import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { Pipeline } from "../engine/pipeline.ts";
import { enqueueSchemaExtension } from "../schema-extension/trigger.ts";
import { AssemblyStep } from "./steps/assembly.ts";
import { DraftStep } from "./steps/draft.ts";
import { HeroImageStep } from "./steps/hero-image.ts";
import { OutlineStep } from "./steps/outline.ts";
import { PersistArticleStep } from "./steps/persist-article.ts";
import { PersistOutlineStep } from "./steps/persist-outline.ts";
import { ResearchStep } from "./steps/research.ts";
import { SelfReviewStep } from "./steps/self-review.ts";
import { TopicIntakeStep } from "./steps/topic-intake.ts";
import { continueArticleGeneration } from "./trigger.ts";

const log = createLogger("pipelines:article-draft");

// ───── Job 1: Outline Pipeline ────────────────────────────────────────────────

const OutlineInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  modelOverride: z.string().optional(),
});

// Outline is in DB after PersistOutlineStep — pipeline output only needs nextAction signal.
const OutlineOutputSchema = z.object({
  articleId: z.string().uuid(),
  nextAction: z.enum(["wait_for_review", "auto_continue"]),
});

type TopicIntakeOutput = {
  cornerstoneKeyword: string;
  clusterName: string;
  clusterPillar: string;
  satelliteKeywords: string[];
  projectSlug: string;
  approvalMode: "manual" | "auto";
  locale: "de" | "en";
  translationKey: string | null;
};

export class ArticleOutlinePipeline extends Pipeline<
  z.infer<typeof OutlineInputSchema>,
  z.infer<typeof OutlineOutputSchema>
> {
  readonly name = "article:outline";
  readonly inputSchema = OutlineInputSchema;
  readonly outputSchema = OutlineOutputSchema;
  readonly steps = [
    new TopicIntakeStep(),
    new ResearchStep(),
    new OutlineStep(),
    new PersistOutlineStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof OutlineInputSchema>,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined
  ): unknown {
    // topic-intake → research: pass cornerstone keyword, satellites, project slug, locale
    if (fromStep.name === "topic-intake" && toStep.name === "research") {
      const t = output as TopicIntakeOutput;
      return {
        cornerstoneKeyword: t.cornerstoneKeyword,
        satelliteKeywords: t.satelliteKeywords,
        projectSlug: t.projectSlug,
        locale: t.locale,
      };
    }

    // research → outline: merge topic-intake output with research result
    if (fromStep.name === "research" && toStep.name === "outline") {
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      return {
        cornerstoneKeyword: t.cornerstoneKeyword,
        satelliteKeywords: t.satelliteKeywords,
        clusterName: t.clusterName,
        clusterPillar: t.clusterPillar,
        projectSlug: t.projectSlug,
        research: output,
        locale: t.locale,
        ...(pipelineInput.modelOverride && { modelOverride: pipelineInput.modelOverride }),
      };
    }

    // outline → persist-outline: pull approvalMode from topic-intake output (already in memory)
    if (fromStep.name === "outline" && toStep.name === "persist-outline") {
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        outline: output,
        approvalMode: t.approvalMode,
      };
    }

    return output;
  }

  /**
   * After all steps succeed: if approvalMode = "auto", immediately enqueue the draft pipeline.
   * afterComplete failures are caught by the runner (logs warn, does not re-trigger retries).
   */
  override async afterComplete(
    output: z.infer<typeof OutlineOutputSchema>,
    pipelineInput: z.infer<typeof OutlineInputSchema>
  ): Promise<void> {
    if (output.nextAction === "auto_continue") {
      const continueInput: Parameters<typeof continueArticleGeneration>[0] = {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      };
      if (
        pipelineInput.modelOverride === "claude-opus-4-7" ||
        pipelineInput.modelOverride === "claude-sonnet-4-6"
      ) {
        continueInput.modelOverride = pipelineInput.modelOverride;
      }
      await continueArticleGeneration(continueInput);
    }
  }
}

// ───── Job 2: Draft Pipeline ──────────────────────────────────────────────────

const DraftInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  modelOverride: z.string().optional(),
});

const DraftOutputSchema = z.object({
  articleId: z.string().uuid(),
  wordCount: z.number(),
  selfReviewScore: z.number(),
});

type DraftTopicIntakeOutput = {
  cornerstoneKeyword: string;
  clusterName: string;
  clusterPillar: string;
  satelliteKeywords: string[];
  projectSlug: string;
  approvalMode: "manual" | "auto";
  locale: "de" | "en";
  translationKey: string | null;
};

type DraftStepOutput = {
  bodyMd: string;
  wordCount: number;
};

type SelfReviewOutput = {
  score: number;
  issues: unknown[];
  shouldBlock: boolean;
  summary: string;
};

type HeroImageOutput = {
  r2Key: string;
  publicUrl: string;
  altText: string;
};

type AssemblyOutput = {
  schemaJsonLd: Record<string, unknown>;
};

export class ArticleDraftPipeline extends Pipeline<
  z.infer<typeof DraftInputSchema>,
  z.infer<typeof DraftOutputSchema>
> {
  readonly name = "article:draft";
  readonly inputSchema = DraftInputSchema;
  readonly outputSchema = DraftOutputSchema;
  readonly steps = [
    new TopicIntakeStep(),
    new DraftStep(),
    new SelfReviewStep(),
    new HeroImageStep(),
    new AssemblyStep(),
    new PersistArticleStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof DraftInputSchema>,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined
  ): unknown {
    // topic-intake → draft: pass articleId, projectId, projectSlug, locale + optional modelOverride
    if (fromStep.name === "topic-intake" && toStep.name === "draft") {
      const t = output as DraftTopicIntakeOutput;
      const base = {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        projectSlug: t.projectSlug,
        locale: t.locale,
      };
      if (
        pipelineInput.modelOverride === "claude-opus-4-7" ||
        pipelineInput.modelOverride === "claude-sonnet-4-6"
      ) {
        return { ...base, modelOverride: pipelineInput.modelOverride };
      }
      return base;
    }

    // draft → self-review: body + word count + cornerstone keyword + projectSlug
    if (fromStep.name === "draft" && toStep.name === "self-review") {
      const d = output as DraftStepOutput;
      const t = getStepOutput<DraftTopicIntakeOutput>("topic-intake")!;
      return {
        bodyMd: d.bodyMd,
        wordCount: d.wordCount,
        cornerstoneKeyword: t.cornerstoneKeyword,
        projectSlug: t.projectSlug,
      };
    }

    // self-review → hero-image: just articleId + projectId + projectSlug
    if (fromStep.name === "self-review" && toStep.name === "hero-image") {
      const t = getStepOutput<DraftTopicIntakeOutput>("topic-intake")!;
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        projectSlug: t.projectSlug,
      };
    }

    // hero-image → assembly: just articleId + projectId
    if (fromStep.name === "hero-image" && toStep.name === "assembly") {
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      };
    }

    // assembly → persist-article: collect all outputs
    if (fromStep.name === "assembly" && toStep.name === "persist-article") {
      const d = getStepOutput<DraftStepOutput>("draft")!;
      const sr = getStepOutput<SelfReviewOutput>("self-review")!;
      const hero = getStepOutput<HeroImageOutput>("hero-image")!;
      const asm = output as AssemblyOutput;
      return {
        articleId: pipelineInput.articleId,
        bodyMd: d.bodyMd,
        wordCount: d.wordCount,
        heroR2Key: hero.r2Key,
        heroPublicUrl: hero.publicUrl,
        heroAltText: hero.altText,
        selfReviewScore: sr.score,
        selfReviewIssues: sr.issues,
        schemaJsonLd: asm.schemaJsonLd,
      };
    }

    return output;
  }

  override async afterComplete(
    _output: z.infer<typeof DraftOutputSchema>,
    pipelineInput: z.infer<typeof DraftInputSchema>
  ): Promise<void> {
    try {
      await enqueueSchemaExtension({
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      });
    } catch (e) {
      // Schema extension failure must not retry the whole article pipeline (Spec 20 lesson #6)
      log.warn({ err: e, articleId: pipelineInput.articleId }, "Schema extension enqueue failed");
    }
  }
}
