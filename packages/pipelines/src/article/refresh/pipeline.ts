import { articles, db, markArticleRefreshed } from "@marketing-auto/db";
import { eq } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { enqueueSchemaExtension } from "../../schema-extension/trigger.ts";
import { DraftStep } from "../steps/draft.ts";
import { OutlineStep } from "../steps/outline.ts";
import { PersistBodyStep } from "../steps/persist-body.ts";
import { PersistOutlineStep } from "../steps/persist-outline.ts";
import { SelfReviewStep } from "../steps/self-review.ts";
import { ToolLinkerStep } from "../tool-linker/step.ts";
import { ToolRelevanceStep } from "../tool-linker/resolve-step.ts";
import { findEnSibling } from "../translation/sibling.ts";
import { RefreshIntakeStep, type RefreshIntakeOutput } from "./intake-step.ts";

const log = createLogger("pipelines:refresh");

// ─── Input / Output ───────────────────────────────────────────────────────────

type RefreshPipelineInput = {
  articleId: string;
  projectId: string;
  briefId: string;
};

const RefreshPipelineInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  briefId:   z.string().uuid(),
}) as z.ZodType<RefreshPipelineInput>;

const RefreshPipelineOutputSchema = z.object({
  articleId:       z.string().uuid(),
  versionNumber:   z.number(),
  wordCount:       z.number(),
  selfReviewScore: z.number(),
});

// ─── Bridge step-output type aliases ─────────────────────────────────────────

type ToolRelevanceOutput = { sourceContext: string; toolsContext: string };
type DraftStepOutput     = { bodyMd: string; wordCount: number };
type SelfReviewOutput    = { score: number; issues: unknown[]; shouldBlock: boolean; summary: string };

// ─── RefreshPipeline ──────────────────────────────────────────────────────────

export class RefreshPipeline extends Pipeline<
  RefreshPipelineInput,
  z.infer<typeof RefreshPipelineOutputSchema>
> {
  readonly name = "article:refresh";
  readonly inputSchema = RefreshPipelineInputSchema;
  readonly outputSchema = RefreshPipelineOutputSchema;

  readonly steps = [
    new RefreshIntakeStep(),   // 1. Load context, persist version BEFORE regeneration
    new ToolRelevanceStep(),   // 2. Resolve toolsContext string for prompts
    new OutlineStep(),         // 3. LLM outline (voice + refresh context injected)
    new PersistOutlineStep(),  // 4. Checkpoint: save outline
    new DraftStep(),           // 5. LLM draft (voice + refresh context injected)
    new PersistBodyStep(),     // 6. Checkpoint: save body immediately
    new ToolLinkerStep(),      // 7. Linkify tool mentions
    new SelfReviewStep(),      // 8. Quality check
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: RefreshPipelineInput,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    // refresh-intake → tool-relevance: pass articleId + projectId + briefId
    if (fromStep.name === "refresh-intake" && toStep.name === "tool-relevance") {
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        briefId:   pipelineInput.briefId,
      };
    }

    // tool-relevance → outline: merge refresh-intake context + toolsContext
    if (fromStep.name === "tool-relevance" && toStep.name === "outline") {
      const intake = getStepOutput<RefreshIntakeOutput>("refresh-intake")!;
      const tr = output as ToolRelevanceOutput;
      return {
        articleId:          pipelineInput.articleId,
        cornerstoneKeyword: intake.cornerstoneKeyword,
        satelliteKeywords:  [],
        clusterName:        "",
        clusterPillar:      "",
        projectSlug:        intake.articleSlug,
        research:           { serpResults: [], competitorInsights: [] },
        locale:             intake.locale,
        suggestedTitle:     intake.articleTitle,
        frontmatterSchema:  null,
        // Combine refresh source context + voice references for the LLM
        sourceContext:      [intake.sourceContext, intake.voiceContext].filter(Boolean).join("\n\n"),
        toolsContext:       tr.toolsContext,
      };
    }

    // outline → persist-outline
    if (fromStep.name === "outline" && toStep.name === "persist-outline") {
      return {
        articleId:    pipelineInput.articleId,
        projectId:    pipelineInput.projectId,
        outline:      output,
        approvalMode: "auto", // refreshes never gate on outline approval
      };
    }

    // persist-outline → draft
    if (fromStep.name === "persist-outline" && toStep.name === "draft") {
      const intake = getStepOutput<RefreshIntakeOutput>("refresh-intake")!;
      const tr = getStepOutput<ToolRelevanceOutput>("tool-relevance")!;
      return {
        articleId:         pipelineInput.articleId,
        projectId:         pipelineInput.projectId,
        projectSlug:       intake.articleSlug,
        locale:            intake.locale,
        frontmatterSchema: null,
        sourceContext:     [intake.sourceContext, intake.voiceContext].filter(Boolean).join("\n\n"),
        toolsContext:      tr.toolsContext,
      };
    }

    // draft → persist-body
    if (fromStep.name === "draft" && toStep.name === "persist-body") {
      const d = output as DraftStepOutput;
      return {
        articleId: pipelineInput.articleId,
        bodyMd:    d.bodyMd,
        wordCount: d.wordCount,
      };
    }

    // persist-body → tool-linker
    if (fromStep.name === "persist-body" && toStep.name === "tool-linker") {
      const d = output as DraftStepOutput;
      const intake = getStepOutput<RefreshIntakeOutput>("refresh-intake")!;
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        locale:    intake.locale,
        bodyMd:    d.bodyMd,
      };
    }

    // tool-linker → self-review
    if (fromStep.name === "tool-linker" && toStep.name === "self-review") {
      const linked = output as { bodyMd: string; linksAdded: number; linkedTools: string[] };
      const intake = getStepOutput<RefreshIntakeOutput>("refresh-intake")!;
      const d = getStepOutput<DraftStepOutput>("draft")!;
      return {
        articleId:          pipelineInput.articleId,
        bodyMd:             linked.bodyMd,
        wordCount:          d.wordCount,
        cornerstoneKeyword: intake.cornerstoneKeyword,
        projectSlug:        intake.articleSlug,
      };
    }

    // self-review is the last step — its output feeds RefreshPipelineOutputSchema
    if (fromStep.name === "self-review") {
      const sr = output as SelfReviewOutput;
      const intake = getStepOutput<RefreshIntakeOutput>("refresh-intake")!;
      const d = getStepOutput<DraftStepOutput>("draft")!;
      return {
        articleId:       pipelineInput.articleId,
        versionNumber:   intake.versionNumber,
        wordCount:       d.wordCount,
        selfReviewScore: sr.score,
      };
    }

    return output;
  }

  override async afterComplete(
    _output: z.infer<typeof RefreshPipelineOutputSchema>,
    pipelineInput: RefreshPipelineInput,
  ): Promise<void> {
    // Mark article as refreshed now that body generation succeeded
    try {
      await markArticleRefreshed(pipelineInput.articleId);
    } catch (e) {
      log.warn({ err: e, articleId: pipelineInput.articleId }, "[refresh] markArticleRefreshed failed — skipped");
    }

    // Enqueue schema extension for the refreshed article
    try {
      await enqueueSchemaExtension({ articleId: pipelineInput.articleId, projectId: pipelineInput.projectId });
    } catch (e) {
      log.warn({ err: e, articleId: pipelineInput.articleId }, "Schema extension enqueue failed after refresh");
    }

    // Propagate refresh to sibling if one exists (bidirectional: DE→EN and EN→DE)
    try {
      const [article] = await db
        .select({ id: articles.id, projectId: articles.projectId, locale: articles.locale, translationKey: articles.translationKey })
        .from(articles)
        .where(eq(articles.id, pipelineInput.articleId))
        .limit(1);

      if (article) {
        const sibling = await findEnSibling(article);
        if (sibling) {
          const { enqueueTranslationPipeline } = await import("../translation/trigger.ts");
          await enqueueTranslationPipeline({
            sourceArticleId: article.id,
            targetArticleId: sibling.id,
            projectId:       article.projectId,
            mode:            "refresh_propagation",
          });
          log.info({ articleId: article.id, siblingId: sibling.id, siblingLocale: sibling.locale }, "[refresh] sibling refresh enqueued");
        }
      }
    } catch (e) {
      log.warn({ err: e, articleId: pipelineInput.articleId }, "[refresh] sibling propagation failed — skipped");
    }
  }
}
