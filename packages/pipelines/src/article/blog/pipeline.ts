import { articles, db, eq, projects } from "@marketing-auto/db";
import { type ArticleCollectionType, ARTICLE_COLLECTION_TYPES, createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { enqueueSchemaExtension } from "../../schema-extension/trigger.ts";
import { shouldSkipAutoTranslation } from "../translation/skip-gate.ts";
import { enqueueTranslationPipeline } from "../translation/trigger.ts";
import { enqueueClusterSpokes } from "../../cluster/full-plan/enqueue-spokes.ts";
import { checkClusterCompletion } from "../../cluster/full-plan/check-completion.ts";
import { AuthorPickStep } from "../author-picker/step.ts";
import { AssemblyStep } from "../steps/assembly.ts";
import { DraftStep } from "../steps/draft.ts";
import { HeroImageStep } from "../steps/hero-image.ts";
import { PersistArticleStep } from "../steps/persist-article.ts";
import { PersistBodyStep } from "../steps/persist-body.ts";
import { SelfReviewStep } from "../steps/self-review.ts";
import { TopicIntakeStep } from "../steps/topic-intake.ts";
import { ToolLinkerStep } from "../tool-linker/step.ts";
import { ToolRelevanceStep } from "../tool-linker/resolve-step.ts";
import { ResearchStep } from "../steps/research.ts";
import { OutlineStep } from "../steps/outline.ts";
import { PersistOutlineStep } from "../steps/persist-outline.ts";
import { SocialGenerationStep } from "../steps/social-generation.step.ts";

const log = createLogger("pipelines:blog");

// ─── Chain callbacks (Spec 54.10) ─────────────────────────────────────────────

let _advanceChain: ((chainId: string, step: string, runId: string) => Promise<void>) | null = null;

/** Called once at worker startup to wire in chain advancement for blog chain steps. */
export function registerBlogChainCallbacks(callbacks: {
  advanceChain: (chainId: string, step: string, runId: string) => Promise<void>;
}): void {
  _advanceChain = callbacks.advanceChain;
}

// ─── Input / Output ───────────────────────────────────────────────────────────

// Explicit type annotation needed because Zod .optional() + exactOptionalPropertyTypes
// causes variance issue on ZodType<Input> — use type cast.
type BlogPipelineInput = {
  articleId: string;
  projectId: string;
  briefId: string;
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
  // Spec 54.10: present when triggered by chain orchestrator (blog chain step)
  chainId?: string;
  chainStep?: string;
  // Spec 61.1: collection type drives Astro folder routing; defaults to 'blog'
  collectionType?: ArticleCollectionType;
  // Spec 61.2: comparison-only — 2-4 tool slugs (+ optional display names) the article compares.
  // Ignored when collectionType !== 'comparison'.
  comparisonToolSlugs?: string[];
  comparisonToolNames?: string[];
};

const BlogPipelineInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  briefId: z.string().uuid(),
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
  chainId: z.string().uuid().optional(),
  chainStep: z.string().optional(),
  collectionType: z.enum(ARTICLE_COLLECTION_TYPES).optional(),
  comparisonToolSlugs: z.array(z.string()).min(2).max(4).optional(),
  comparisonToolNames: z.array(z.string()).optional(),
}) as z.ZodType<BlogPipelineInput>;

const BlogPipelineOutputSchema = z.object({
  articleId: z.string().uuid(),
  wordCount: z.number(),
  selfReviewScore: z.number(),
});

// ─── Step output type aliases (used in bridge) ────────────────────────────────

type ToolRelevanceOutput = {
  sourceContext: string;
  toolsContext: string;
};

type TopicIntakeOutput = {
  cornerstoneKeyword: string;
  clusterName: string;
  clusterPillar: string;
  satelliteKeywords: string[];
  projectSlug: string;
  approvalMode: "manual" | "auto";
  locale: "de" | "en";
  translationKey: string | null;
  suggestedTitle: string | null;
  frontmatterSchema: unknown[] | null;
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

// ─── BlogPipeline ─────────────────────────────────────────────────────────────

export class BlogPipeline extends Pipeline<
  BlogPipelineInput,
  z.infer<typeof BlogPipelineOutputSchema>
> {
  readonly name = "article:blog";
  readonly inputSchema = BlogPipelineInputSchema;
  readonly outputSchema = BlogPipelineOutputSchema;

  readonly steps = [
    new AuthorPickStep(),         // 1.  Pick + assign author
    new ToolRelevanceStep(),      // 2.  Resolve source + tools context
    new TopicIntakeStep(),        // 3.  Load article/cluster/project from DB
    new ResearchStep(),           // 4.  SERP research
    new OutlineStep(),            // 5.  LLM outline (source + tools context injected)
    new PersistOutlineStep(),     // 6.  Checkpoint: save outline
    new DraftStep(),              // 7.  LLM draft (source + tools context injected)
    new PersistBodyStep(),        // 8.  Checkpoint: save body immediately
    new ToolLinkerStep(),         // 9.  Linkify tool mentions
    new SelfReviewStep(),         // 10. Quality check
    new HeroImageStep(),          // 11. Hero image generation
    new AssemblyStep(),           // 12. JSON-LD schema
    new PersistArticleStep(),     // 13. Final persist
    new SocialGenerationStep(),   // 14. Optional: auto social renders (skipped when socialAutoRenderLocales unset)
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: BlogPipelineInput,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    // author-pick → tool-relevance: pass articleId + projectId + briefId
    if (fromStep.name === "author-pick" && toStep.name === "tool-relevance") {
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        briefId: pipelineInput.briefId,
      };
    }

    // tool-relevance → topic-intake: topic-intake only needs articleId + projectId
    if (fromStep.name === "tool-relevance" && toStep.name === "topic-intake") {
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      };
    }

    // topic-intake → research
    if (fromStep.name === "topic-intake" && toStep.name === "research") {
      const t = output as TopicIntakeOutput;
      return {
        cornerstoneKeyword: t.cornerstoneKeyword,
        satelliteKeywords: t.satelliteKeywords,
        projectSlug: t.projectSlug,
        locale: t.locale,
      };
    }

    // research → outline: merge topic-intake + research + tool-relevance contexts
    if (fromStep.name === "research" && toStep.name === "outline") {
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      const tr = getStepOutput<ToolRelevanceOutput>("tool-relevance")!;
      const base = {
        articleId: pipelineInput.articleId,
        cornerstoneKeyword: t.cornerstoneKeyword,
        satelliteKeywords: t.satelliteKeywords,
        clusterName: t.clusterName,
        clusterPillar: t.clusterPillar,
        projectSlug: t.projectSlug,
        research: output,
        locale: t.locale,
        suggestedTitle: t.suggestedTitle,
        frontmatterSchema: t.frontmatterSchema,
        sourceContext: tr.sourceContext,
        toolsContext: tr.toolsContext,
      };
      if (pipelineInput.modelOverride) {
        return { ...base, modelOverride: pipelineInput.modelOverride };
      }
      return base;
    }

    // outline → persist-outline
    if (fromStep.name === "outline" && toStep.name === "persist-outline") {
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        outline: output,
        approvalMode: t.approvalMode,
      };
    }

    // persist-outline → draft: merge topic-intake + tool-relevance contexts
    if (fromStep.name === "persist-outline" && toStep.name === "draft") {
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      const tr = getStepOutput<ToolRelevanceOutput>("tool-relevance")!;
      const base: Record<string, unknown> = {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        projectSlug: t.projectSlug,
        locale: t.locale,
        frontmatterSchema: t.frontmatterSchema,
        sourceContext: tr.sourceContext,
        toolsContext: tr.toolsContext,
      };
      if (pipelineInput.modelOverride) {
        base.modelOverride = pipelineInput.modelOverride;
      }
      // Spec 61.2: forward collection type + comparison tool list into DraftStep
      if (pipelineInput.collectionType) {
        base.collectionType = pipelineInput.collectionType;
      }
      if (pipelineInput.comparisonToolSlugs?.length) {
        base.comparisonToolSlugs = pipelineInput.comparisonToolSlugs;
      }
      if (pipelineInput.comparisonToolNames?.length) {
        base.comparisonToolNames = pipelineInput.comparisonToolNames;
      }
      return base;
    }

    // draft → persist-body checkpoint
    if (fromStep.name === "draft" && toStep.name === "persist-body") {
      const d = output as DraftStepOutput;
      return {
        articleId: pipelineInput.articleId,
        bodyMd: d.bodyMd,
        wordCount: d.wordCount,
      };
    }

    // persist-body → tool-linker: pass locale from topic-intake
    if (fromStep.name === "persist-body" && toStep.name === "tool-linker") {
      const d = output as DraftStepOutput; // persist-body passes bodyMd + wordCount
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        locale: t.locale,
        bodyMd: d.bodyMd,
      };
    }

    // tool-linker → self-review: use linkified body
    if (fromStep.name === "tool-linker" && toStep.name === "self-review") {
      const linked = output as { bodyMd: string; linksAdded: number; linkedTools: string[] };
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      const d = getStepOutput<DraftStepOutput>("draft")!;
      return {
        articleId: pipelineInput.articleId,
        bodyMd: linked.bodyMd,
        wordCount: d.wordCount,
        cornerstoneKeyword: t.cornerstoneKeyword,
        projectSlug: t.projectSlug,
      };
    }

    // self-review → hero-image
    if (fromStep.name === "self-review" && toStep.name === "hero-image") {
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        projectSlug: t.projectSlug,
      };
    }

    // hero-image → assembly
    if (fromStep.name === "hero-image" && toStep.name === "assembly") {
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      };
    }

    // persist-article → social-generation: carry pipeline output fields for pass-through
    if (fromStep.name === "persist-article" && toStep.name === "social-generation") {
      const pa = output as { articleId: string; wordCount: number; selfReviewScore: number };
      return { articleId: pa.articleId, wordCount: pa.wordCount, selfReviewScore: pa.selfReviewScore };
    }

    // assembly → persist-article: collect all step outputs
    if (fromStep.name === "assembly" && toStep.name === "persist-article") {
      // tool-linker always runs in BlogPipeline (step 9) — guaranteed non-null
      const linked = getStepOutput<{ bodyMd: string }>("tool-linker")!;
      const d = getStepOutput<DraftStepOutput>("draft")!;
      const sr = getStepOutput<SelfReviewOutput>("self-review")!;
      const hero = getStepOutput<HeroImageOutput>("hero-image")!;
      const asm = output as AssemblyOutput;
      const base = {
        articleId: pipelineInput.articleId,
        bodyMd: linked.bodyMd,
        wordCount: d.wordCount,
        heroR2Key: hero.r2Key,
        heroPublicUrl: hero.publicUrl,
        heroAltText: hero.altText,
        selfReviewScore: sr.score,
        selfReviewIssues: sr.issues,
        schemaJsonLd: asm.schemaJsonLd,
      };
      // Spec 61.1: carry collectionType so PersistArticleStep can write it to DB
      if (pipelineInput.collectionType) {
        return { ...base, collectionType: pipelineInput.collectionType };
      }
      return base;
    }

    return output;
  }

  override async afterComplete(
    _output: z.infer<typeof BlogPipelineOutputSchema>,
    pipelineInput: BlogPipelineInput,
    runId: string,
  ): Promise<void> {
    // Chain advancement: when triggered from the blog chain step, advance to 'localize'.
    if (pipelineInput.chainId && _advanceChain) {
      try {
        await _advanceChain(pipelineInput.chainId, "blog", runId);
      } catch (e) {
        log.warn({ err: e, chainId: pipelineInput.chainId }, "[chain] advanceChain failed after blog pipeline");
      }
      // Schema extension is handled by the chain's schema-en step — skip standalone enqueue.
      return;
    }

    // Non-chain run: enqueue schema extension directly.
    try {
      await enqueueSchemaExtension({
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      });
    } catch (e) {
      log.warn({ err: e, articleId: pipelineInput.articleId }, "Schema extension enqueue failed after blog pipeline");
    }

    // Load article for translation check + cluster generation tracking
    let articleLocale: string | null = null;
    let articleRole: "hub" | "spoke" | null = null;
    let clusterGenerationId: string | null = null;
    let skipAutoTranslationUntil: Date | null = null;
    try {
      const [article] = await db
        .select({
          locale: articles.locale,
          role: articles.role,
          clusterGenerationId: articles.clusterGenerationId,
          skipAutoTranslationUntil: articles.skipAutoTranslationUntil,
        })
        .from(articles)
        .where(eq(articles.id, pipelineInput.articleId))
        .limit(1);
      articleLocale = article?.locale ?? null;
      articleRole = (article?.role ?? null) as "hub" | "spoke" | null;
      clusterGenerationId = article?.clusterGenerationId ?? null;
      skipAutoTranslationUntil = article?.skipAutoTranslationUntil ?? null;
    } catch (e) {
      log.warn({ err: e, articleId: pipelineInput.articleId }, "[blog] failed to load article for afterComplete hooks");
    }

    // Bidirectional auto-trigger: DE→EN or EN→DE depending on article locale.
    // Spec 62.0a-followup Issue 1: per-article skip flag short-circuits BEFORE the
    // project-config load (cheaper) so a flag-set article never reads the project row.
    // Log only when translation would otherwise have triggered (locale in {de,en}) —
    // a non-translatable article + skip flag is silently a no-op.
    try {
      if (articleLocale === "de" || articleLocale === "en") {
        if (shouldSkipAutoTranslation(skipAutoTranslationUntil)) {
          log.info(
            { articleId: pipelineInput.articleId, skipUntil: skipAutoTranslationUntil },
            "[blog] skipping auto-translation — skip_auto_translation_until is in the future"
          );
        } else {
          const [project] = await db
            .select({ targetLocales: projects.targetLocales, translationAutoTrigger: projects.translationAutoTrigger })
            .from(projects)
            .where(eq(projects.id, pipelineInput.projectId))
            .limit(1);

          const autoTrigger = project?.translationAutoTrigger ?? true;
          if (autoTrigger) {
            const targetBcp47 = articleLocale === "de" ? "en-US" : "de-DE";
            const wantsTarget = project?.targetLocales?.includes(targetBcp47) ?? false;

            if (wantsTarget) {
              // Guard: skip if sibling already exists (refresh handles propagation separately)
              const { findSibling } = await import("../translation/sibling.ts");
              const [articleForSibling] = await db
                .select({ id: articles.id, projectId: articles.projectId, locale: articles.locale, translationKey: articles.translationKey })
                .from(articles)
                .where(eq(articles.id, pipelineInput.articleId))
                .limit(1);
              const existingSibling = articleForSibling ? await findSibling(articleForSibling) : null;

              if (!existingSibling) {
                await enqueueTranslationPipeline({
                  sourceArticleId: pipelineInput.articleId,
                  projectId:       pipelineInput.projectId,
                  mode:            "fresh_translation",
                });
                log.info({ articleId: pipelineInput.articleId, articleLocale, targetBcp47 }, "[blog] auto-triggered translation");
              } else {
                log.info({ articleId: pipelineInput.articleId, siblingId: existingSibling.id }, "[blog] sibling already exists — skipping auto-translation");
              }
            }
          }
        }
      }
    } catch (e) {
      log.warn({ err: e, articleId: pipelineInput.articleId }, "[blog] translation auto-trigger failed — skipped");
    }

    // Spec 54.12: Hub completion → enqueue all pending spokes
    if (articleRole === "hub" && clusterGenerationId) {
      try {
        await enqueueClusterSpokes({
          clusterId: clusterGenerationId,
          hubArticleId: pipelineInput.articleId,
        });
        log.info({ articleId: pipelineInput.articleId, clusterId: clusterGenerationId }, "[blog] cluster spokes enqueued after hub completion");
      } catch (e) {
        log.warn({ err: e, articleId: pipelineInput.articleId, clusterId: clusterGenerationId }, "[blog] enqueueClusterSpokes failed — spokes not started");
      }
    }

    // Spec 54.12: After any cluster-generation article completes, check overall completion
    if (clusterGenerationId) {
      try {
        await checkClusterCompletion({
          clusterId: clusterGenerationId,
          projectId: pipelineInput.projectId,
        });
      } catch (e) {
        log.warn({ err: e, clusterId: clusterGenerationId }, "[blog] checkClusterCompletion failed — status not updated");
      }
    }

  }

  /**
   * Runs the full article pipeline including social generation.
   * Stub for Content Planner batch jobs (Theme 62).
   *
   * @param brief   Article generation brief
   * @param social  Social generation config (overrides project defaults)
   *
   * TODO(Theme 62): implement full batch execution with social override support.
   */
  // biome-ignore lint/suspicious/noExplicitAny: stub — not yet implemented
  async runWithSocial(_brief: any, _social?: { templates?: string[]; locales?: ("de" | "en")[]; theme?: "dark" | "light" }): Promise<{ articleId: string; socialJobIds: string[] }> {
    throw new Error("BlogPipeline.runWithSocial() is not yet implemented. Use article:blog pipeline + SocialGenerationStep for auto-generation.");
  }
}
