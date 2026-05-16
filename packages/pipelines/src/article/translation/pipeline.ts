/**
 * article:translation pipeline
 *
 * Generates an EN sibling article from an existing DE article.
 *
 * Two modes:
 *   fresh_translation  — DE article just completed; creates EN stub and generates body
 *   refresh_propagation — DE article was refreshed; re-translates existing EN sibling
 *
 * Decision call (Haiku) picks:
 *   literal  — translate DE body directly (faster, cheaper)
 *   adaptive — generate EN-specific outline + draft (when DE content is too Germany-specific)
 *
 * Steps:
 *   1. TranslationSetupStep   — load DE article, create/find EN stub, load voice refs
 *   2. TranslationDecisionStep — Haiku: literal vs adaptive
 *   3. TranslationBodyStep    — generate EN body (literal or adaptive path)
 *   4. PersistBodyStep        — checkpoint: save body
 *   5. ToolLinkerStep         — linkify EN tool mentions (/en/tools/slug)
 *   6. SelfReviewStep         — quality classification (Haiku 4.5)
 *   7. PersistArticleStep     — final persist, status → final_review
 */
import { articles, db, eq } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { checkClusterCompletion } from "../../cluster/full-plan/check-completion.ts";
import { enqueueSchemaExtension } from "../../schema-extension/trigger.ts";
import { PersistBodyStep } from "../steps/persist-body.ts";
import { PersistArticleStep } from "../steps/persist-article.ts";
import { SelfReviewStep } from "../steps/self-review.ts";
import { ToolLinkerStep } from "../tool-linker/step.ts";
import { TranslationSetupStep, type TranslationSetupOutput } from "./setup-step.ts";
import { TranslationDecisionStep } from "./decision.ts";
import { TranslationBodyStep } from "./body-step.ts";

const log = createLogger("pipelines:translation");

// ─── Input / Output ───────────────────────────────────────────────────────────

type TranslationPipelineInput = {
  sourceArticleId: string;               // DE article
  targetArticleId?: string;              // EN article (refresh_propagation only)
  projectId: string;
  mode: "fresh_translation" | "refresh_propagation";
};

const TranslationPipelineInputSchema = z.object({
  sourceArticleId: z.string().uuid(),
  targetArticleId: z.string().uuid().optional(),
  projectId:       z.string().uuid(),
  mode:            z.enum(["fresh_translation", "refresh_propagation"]),
}) as z.ZodType<TranslationPipelineInput>;

// Must match PersistArticleStep.outputSchema — the runner uses the last step's output
// directly as the pipeline output (bridge is not called for the final step).
const TranslationPipelineOutputSchema = z.object({
  articleId:       z.string().uuid(),
  wordCount:       z.number(),
  selfReviewScore: z.number(),
});

// ─── Bridge helper types ──────────────────────────────────────────────────────

type DecisionOutput  = { decision: "literal" | "adaptive"; reasoning: string };
type BodyOutput      = { bodyMd: string; wordCount: number };
type PersistBody     = { articleId: string; bodyMd: string; wordCount: number };
type ToolLinkerOutput = { bodyMd: string; linksAdded: number; linkedTools: string[] };
type SelfReviewOutput = { score: number; issues: unknown[]; shouldBlock: boolean; summary: string };

// ─── TranslationPipeline ──────────────────────────────────────────────────────

export class TranslationPipeline extends Pipeline<
  TranslationPipelineInput,
  z.infer<typeof TranslationPipelineOutputSchema>
> {
  readonly name = "article:translation";
  readonly inputSchema = TranslationPipelineInputSchema;
  readonly outputSchema = TranslationPipelineOutputSchema;

  readonly steps = [
    new TranslationSetupStep(),     // 1. Load DE, create/find EN, load voice refs
    new TranslationDecisionStep(),  // 2. Haiku: literal vs adaptive
    new TranslationBodyStep(),      // 3. Generate EN body
    new PersistBodyStep(),          // 4. Checkpoint
    new ToolLinkerStep(),           // 5. Linkify EN tools
    new SelfReviewStep(),           // 6. Quality check
    new PersistArticleStep(),       // 7. Final persist
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: TranslationPipelineInput,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    const setup = () => getStepOutput<TranslationSetupOutput>("translation-setup");

    // setup → decision
    if (fromStep.name === "translation-setup" && toStep.name === "translation-decision") {
      const s = output as TranslationSetupOutput;
      return {
        articleId:      s.enArticleId,
        projectId:      pipelineInput.projectId,
        deTitle:        s.deTitle,
        deBodyExcerpt:  s.deBodyExcerpt,
        primaryKeyword: s.primaryKeyword,
        intentType:     s.intentType,
        briefSource:    s.briefSource,
      };
    }

    // decision → translation-body
    if (fromStep.name === "translation-decision" && toStep.name === "translation-body") {
      const s = setup()!;
      const d = output as DecisionOutput;
      return {
        articleId:          s.enArticleId,
        projectId:          pipelineInput.projectId,
        decision:           d.decision,
        deBodyMd:           s.deBodyMd,
        deTitle:            s.deTitle,
        primaryKeyword:     s.primaryKeyword,
        cornerstoneKeyword: s.cornerstoneKeyword,
        voiceReferences:    s.voiceReferences,
        projectSlug:        s.projectSlug,
      };
    }

    // translation-body → persist-body
    if (fromStep.name === "translation-body" && toStep.name === "persist-body") {
      const s = setup()!;
      const b = output as BodyOutput;
      return {
        articleId: s.enArticleId,
        bodyMd:    b.bodyMd,
        wordCount: b.wordCount,
      };
    }

    // persist-body → tool-linker
    if (fromStep.name === "persist-body" && toStep.name === "tool-linker") {
      const s = setup()!;
      const p = output as PersistBody;
      return {
        articleId: s.enArticleId,
        projectId: pipelineInput.projectId,
        locale:    "en",
        bodyMd:    p.bodyMd,
      };
    }

    // tool-linker → self-review
    if (fromStep.name === "tool-linker" && toStep.name === "self-review") {
      const s = setup()!;
      const linked = output as ToolLinkerOutput;
      const body = getStepOutput<BodyOutput>("translation-body")!;
      return {
        articleId:          s.enArticleId,
        bodyMd:             linked.bodyMd,
        wordCount:          body.wordCount,
        cornerstoneKeyword: s.cornerstoneKeyword,
        projectSlug:        s.projectSlug,
      };
    }

    // self-review → persist-article
    if (fromStep.name === "self-review" && toStep.name === "persist-article") {
      const s = setup()!;
      const linked = getStepOutput<ToolLinkerOutput>("tool-linker")!;
      const body = getStepOutput<BodyOutput>("translation-body")!;
      const sr = output as SelfReviewOutput;

      // Extract EN title from the first # heading in the translated body
      const titleMatch = linked.bodyMd.match(/^#\s+(.+)$/m);
      const enTitle = titleMatch?.[1]?.trim();

      // Find the Article entry from DE schema to update its headline for EN
      const deArticleSchema = s.deSchemaJsonLd.find((e) => e["@type"] === "Article") ?? {};
      const enArticleSchema = enTitle
        ? { ...deArticleSchema, headline: enTitle }
        : deArticleSchema;

      return {
        articleId:        s.enArticleId,
        bodyMd:           linked.bodyMd,
        wordCount:        body.wordCount,
        heroR2Key:        s.deHeroR2Key ?? "",
        heroPublicUrl:    s.deHeroPublicUrl ?? "",
        heroAltText:      s.deHeroAltText ?? "",
        selfReviewScore:  sr.score,
        selfReviewIssues: sr.issues,
        schemaJsonLd:     enArticleSchema,
        ...(enTitle ? { title: enTitle } : {}),
      };
    }

    return output;
  }

  override async afterComplete(
    output: z.infer<typeof TranslationPipelineOutputSchema>,
    pipelineInput: TranslationPipelineInput,
  ): Promise<void> {
    // output.articleId = EN article (from PersistArticleStep)
    try {
      await enqueueSchemaExtension({
        articleId: output.articleId,
        projectId: pipelineInput.projectId,
      });
    } catch (e) {
      log.warn({ err: e, articleId: output.articleId }, "Schema extension enqueue failed after translation");
    }

    // Check cluster completion — needed because the cluster waits for both DE + EN articles.
    // The blog pipeline fires this check after DE completes (count < expected at that point),
    // so we must re-check after each EN translation completes.
    try {
      const [src] = await db
        .select({ clusterGenerationId: articles.clusterGenerationId })
        .from(articles)
        .where(eq(articles.id, pipelineInput.sourceArticleId))
        .limit(1);
      if (src?.clusterGenerationId) {
        await checkClusterCompletion({
          clusterId: src.clusterGenerationId,
          projectId: pipelineInput.projectId,
        });
      }
    } catch (e) {
      log.warn({ err: e, sourceArticleId: pipelineInput.sourceArticleId }, "[translation] checkClusterCompletion failed");
    }
  }
}
