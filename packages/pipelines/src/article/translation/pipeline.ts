/**
 * article:translation pipeline
 *
 * Generates a target-locale sibling article from an existing source article.
 * Works bidirectionally: DE→EN and EN→DE.
 *
 * Three modes:
 *   fresh_translation   — source article just completed; creates target stub and generates body
 *   refresh_propagation — source article was refreshed; re-translates existing target sibling
 *   manual_resync       — user triggered re-sync; re-translates existing target sibling
 *
 * Decision call (Haiku) picks:
 *   literal  — translate source body directly (faster, cheaper)
 *   adaptive — generate target-locale-specific outline + draft (when source content is too locale-specific)
 *
 * Steps:
 *   1. TranslationSetupStep   — load source article, create/find target stub, load voice refs
 *   2. TranslationDecisionStep — Haiku: literal vs adaptive
 *   3. TranslationBodyStep    — generate target body (literal or adaptive path)
 *   4. PersistBodyStep        — checkpoint: save body
 *   5. ToolLinkerStep         — linkify tool mentions in target locale
 *   6. SelfReviewStep         — quality classification (Haiku 4.5)
 *   7. PersistArticleStep     — final persist, status → final_review
 */
import { articles, db, eq, and } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { checkClusterCompletion } from "../../cluster/full-plan/check-completion.ts";
import { enqueueSchemaExtension } from "../../schema-extension/trigger.ts";
import { buildCanonicalUrl } from "../lib/canonical-url.ts";
import { PersistBodyStep } from "../steps/persist-body.ts";
import { PersistArticleStep } from "../steps/persist-article.ts";
import { SelfReviewStep } from "../steps/self-review.ts";
import { ToolLinkerStep } from "../tool-linker/step.ts";
import { slugify } from "../trigger.ts";
import { TranslationSetupStep, type TranslationSetupOutput } from "./setup-step.ts";
import { TranslationDecisionStep } from "./decision.ts";
import { TranslationBodyStep } from "./body-step.ts";
import { bcp47Tag, buildHeroAltText } from "./lib/locale-strings.ts";

const log = createLogger("pipelines:translation");

// ─── Input / Output ───────────────────────────────────────────────────────────

type TranslationPipelineInput = {
  sourceArticleId: string;
  targetArticleId?: string;
  projectId: string;
  mode: "fresh_translation" | "refresh_propagation" | "manual_resync";
};

const TranslationPipelineInputSchema = z.object({
  sourceArticleId: z.string().uuid(),
  targetArticleId: z.string().uuid().optional(),
  projectId:       z.string().uuid(),
  mode:            z.enum(["fresh_translation", "refresh_propagation", "manual_resync"]),
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
type BodyOutput      = { bodyMd: string; wordCount: number; targetTitle: string; targetMetaDescription: string; targetTags: string[] };
type PersistBody     = { articleId: string; bodyMd: string; wordCount: number };
type ToolLinkerOutput = { bodyMd: string; linksAdded: number; linkedTools: string[] };
type SelfReviewOutput = { score: number; issues: unknown[]; shouldBlock: boolean; summary: string };

// Language-neutral extras copied from source → target (locale-independent fields)
const LANG_INDEPENDENT_EXTRAS = [
  "intentType", "bottomLinksVariant", "primaryTool",
  "pricingTier", "priceFrom", "rating", "features", "pros", "cons",
  "useCases", "toolSlugs", "winner", "verdict", "listicleType",
  "authorPickStrategy",
] as const;

// ─── Persist-Article input builder (Spec 64.3 — pure, testable) ───────────────

export type BuildPersistInputArgs = {
  setup: TranslationSetupOutput;
  body: BodyOutput;
  linked: ToolLinkerOutput;
  selfReview: SelfReviewOutput;
};

export type TranslationPersistInput = {
  articleId: string;
  bodyMd: string;
  wordCount: number;
  heroR2Key: string;
  heroPublicUrl: string;
  heroAltText: string;
  selfReviewScore: number;
  selfReviewIssues: unknown[];
  schemaJsonLd: Record<string, unknown>;
  title?: string;
  slug?: string;
  metaDescription?: string;
  tags?: string[];
  frontmatterExtras?: Record<string, unknown>;
};

/**
 * Build the `persist-article` input from the translation pipeline's
 * setup + body + linker + self-review outputs.
 *
 * Spec 64.3 fixes three sub-bugs in the previous spread+headline pattern:
 *   #3a  heroAltText now built target-locale-native via buildHeroAltText
 *   #3b  schema.description now uses targetMetaDescription (was: source DE description)
 *   #3c  schema.mainEntityOfPage.@id now built via buildCanonicalUrl with target
 *        locale + slug + collection (was: spread of source DE canonical URL)
 *
 * Language-neutral schema fields (author, publisher, datePublished, dateModified,
 * image) are explicitly preserved from the source schema. The naive `...spread`
 * is gone — any unknown source-locale field is now silently dropped, which is
 * intentional per spec §3.2.
 */
export function buildTranslationPersistInput(args: BuildPersistInputArgs): TranslationPersistInput {
  const { setup: s, body, linked, selfReview: sr } = args;

  // Title + metaDescription come from TranslationBodyStep (LLM-generated in target locale).
  // Falls back to source values when the LLM omitted the tagged blocks.
  const targetTitle = body.targetTitle || s.sourceTitle || undefined;
  const targetMetaDescription = body.targetMetaDescription || s.sourceMetaDescription || undefined;
  // Derive target slug from LLM-generated title so articles get a proper locale URL.
  const targetSlug = targetTitle ? slugify(targetTitle) : undefined;

  // Sparser Article-schema reconstruction. Source schema's headline/description/
  // mainEntityOfPage are source-locale and MUST be replaced; only language-neutral
  // identity (author/publisher/dates/image) is preserved.
  const sourceArticleSchema =
    s.sourceSchemaJsonLd.find((e) => e["@type"] === "Article") ?? {};

  const targetArticleSchema: Record<string, unknown> = {
    "@context": sourceArticleSchema["@context"] ?? "https://schema.org",
    "@type": "Article",
    author: sourceArticleSchema.author,
    publisher: sourceArticleSchema.publisher,
    datePublished: sourceArticleSchema.datePublished,
    dateModified: sourceArticleSchema.dateModified,
    image: sourceArticleSchema.image,
    // Spec 64.3 — explicit target-locale BCP-47 tag (was inherited via spread from source).
    inLanguage: bcp47Tag(s.targetLocale),
    headline: targetTitle ?? sourceArticleSchema.headline,
    description: targetMetaDescription ?? sourceArticleSchema.description,
    mainEntityOfPage: targetSlug
      ? {
          "@type": "WebPage",
          "@id": buildCanonicalUrl({
            projectDomain: s.projectDomain,
            locale: s.targetLocale,
            collection: s.sourceCollection,
            slug: targetSlug,
          }),
        }
      : sourceArticleSchema.mainEntityOfPage,
  };

  // Build target frontmatterExtras: copy language-independent fields, drop the rest.
  const sourceExtras = s.sourceFrontmatterExtras ?? {};
  const targetExtras: Record<string, unknown> = {};
  for (const key of LANG_INDEPENDENT_EXTRAS) {
    if (key in sourceExtras) targetExtras[key] = sourceExtras[key];
  }
  if (targetMetaDescription) targetExtras.excerpt = targetMetaDescription;
  if (targetSlug) targetExtras.slug = targetSlug;

  // Hero alt-text rebuilt target-locale-native. Falls back to source title when
  // the LLM omitted the title block (rare).
  const altTitle = targetTitle ?? s.sourceTitle;

  return {
    articleId:        s.targetArticleId,
    bodyMd:           linked.bodyMd,
    wordCount:        body.wordCount,
    heroR2Key:        s.sourceHeroR2Key ?? "",
    heroPublicUrl:    s.sourceHeroPublicUrl ?? "",
    heroAltText:      buildHeroAltText(altTitle, s.targetLocale),
    selfReviewScore:  sr.score,
    selfReviewIssues: sr.issues,
    schemaJsonLd:     targetArticleSchema,
    ...(targetTitle ? { title: targetTitle } : {}),
    ...(targetSlug ? { slug: targetSlug } : {}),
    ...(targetMetaDescription ? { metaDescription: targetMetaDescription } : {}),
    ...(body.targetTags.length > 0 ? { tags: body.targetTags } : {}),
    ...(Object.keys(targetExtras).length > 0 ? { frontmatterExtras: targetExtras } : {}),
  };
}

// ─── TranslationPipeline ──────────────────────────────────────────────────────

export class TranslationPipeline extends Pipeline<
  TranslationPipelineInput,
  z.infer<typeof TranslationPipelineOutputSchema>
> {
  readonly name = "article:translation";
  readonly inputSchema = TranslationPipelineInputSchema;
  readonly outputSchema = TranslationPipelineOutputSchema;

  readonly steps = [
    new TranslationSetupStep(),     // 1. Load source, create/find target, load voice refs
    new TranslationDecisionStep(),  // 2. Haiku: literal vs adaptive
    new TranslationBodyStep(),      // 3. Generate target body
    new PersistBodyStep(),          // 4. Checkpoint
    new ToolLinkerStep(),           // 5. Linkify target locale tools
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
        articleId:         s.targetArticleId,
        projectId:         pipelineInput.projectId,
        sourceTitle:       s.sourceTitle,
        sourceBodyExcerpt: s.sourceBodyExcerpt,
        primaryKeyword:    s.primaryKeyword,
        intentType:        s.intentType,
        briefSource:       s.briefSource,
        sourceLocale:      s.sourceLocale,
        targetLocale:      s.targetLocale,
      };
    }

    // decision → translation-body
    if (fromStep.name === "translation-decision" && toStep.name === "translation-body") {
      const s = setup()!;
      const d = output as DecisionOutput;
      return {
        articleId:          s.targetArticleId,
        projectId:          pipelineInput.projectId,
        decision:           d.decision,
        sourceBodyMd:       s.sourceBodyMd,
        sourceTitle:        s.sourceTitle,
        primaryKeyword:     s.primaryKeyword,
        cornerstoneKeyword: s.cornerstoneKeyword,
        voiceReferences:    s.voiceReferences,
        projectSlug:        s.projectSlug,
        sourceLocale:       s.sourceLocale,
        targetLocale:       s.targetLocale,
      };
    }

    // translation-body → persist-body
    if (fromStep.name === "translation-body" && toStep.name === "persist-body") {
      const s = setup()!;
      const b = output as BodyOutput;
      return {
        articleId: s.targetArticleId,
        bodyMd:    b.bodyMd,
        wordCount: b.wordCount,
      };
    }

    // persist-body → tool-linker
    if (fromStep.name === "persist-body" && toStep.name === "tool-linker") {
      const s = setup()!;
      const p = output as PersistBody;
      return {
        articleId: s.targetArticleId,
        projectId: pipelineInput.projectId,
        locale:    s.targetLocale,
        bodyMd:    p.bodyMd,
      };
    }

    // tool-linker → self-review
    if (fromStep.name === "tool-linker" && toStep.name === "self-review") {
      const s = setup()!;
      const linked = output as ToolLinkerOutput;
      const body = getStepOutput<BodyOutput>("translation-body")!;
      return {
        articleId:          s.targetArticleId,
        bodyMd:             linked.bodyMd,
        wordCount:          body.wordCount,
        cornerstoneKeyword: s.cornerstoneKeyword,
        projectSlug:        s.projectSlug,
      };
    }

    // self-review → persist-article (Spec 64.3 — delegated to pure helper)
    if (fromStep.name === "self-review" && toStep.name === "persist-article") {
      const s = setup()!;
      const linked = getStepOutput<ToolLinkerOutput>("tool-linker")!;
      const body = getStepOutput<BodyOutput>("translation-body")!;
      const sr = output as SelfReviewOutput;
      return buildTranslationPersistInput({ setup: s, body, linked, selfReview: sr });
    }

    return output;
  }

  override async afterComplete(
    output: z.infer<typeof TranslationPipelineOutputSchema>,
    pipelineInput: TranslationPipelineInput,
  ): Promise<void> {
    // output.articleId = target article (from PersistArticleStep)
    try {
      await enqueueSchemaExtension({
        articleId: output.articleId,
        projectId: pipelineInput.projectId,
      });
    } catch (e) {
      log.warn({ err: e, articleId: output.articleId }, "Schema extension enqueue failed after translation");
    }

    // Mark target article as freshly synced from its sibling (divergence tracking, Spec 59.2)
    try {
      await db
        .update(articles)
        .set({ lastSyncedFromSiblingAt: new Date() })
        .where(and(eq(articles.id, output.articleId), eq(articles.projectId, pipelineInput.projectId)));
    } catch (e) {
      log.warn({ err: e, articleId: output.articleId }, "[translation] lastSyncedFromSiblingAt update failed — skipped");
    }

    // Check cluster completion — clusters wait for both DE + EN articles.
    // The blog pipeline fires this check after the source article completes (count < expected),
    // so we must re-check after each target translation completes.
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
