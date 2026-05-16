import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { enqueueSchemaExtension } from "../../schema-extension/trigger.ts";
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

const log = createLogger("pipelines:blog");

// ─── Input / Output ───────────────────────────────────────────────────────────

// Explicit type annotation needed because Zod .optional() + exactOptionalPropertyTypes
// causes variance issue on ZodType<Input> — use type cast.
type BlogPipelineInput = {
  articleId: string;
  projectId: string;
  briefId: string;
  modelOverride?: "claude-opus-4-7" | "claude-sonnet-4-6";
};

const BlogPipelineInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  briefId: z.string().uuid(),
  modelOverride: z.enum(["claude-opus-4-7", "claude-sonnet-4-6"]).optional(),
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
    new AuthorPickStep(),      // 1. Pick + assign author
    new ToolRelevanceStep(),   // 2. Resolve source + tools context
    new TopicIntakeStep(),     // 3. Load article/cluster/project from DB
    new ResearchStep(),        // 4. SERP research
    new OutlineStep(),         // 5. LLM outline (source + tools context injected)
    new PersistOutlineStep(),  // 6. Checkpoint: save outline
    new DraftStep(),           // 7. LLM draft (source + tools context injected)
    new PersistBodyStep(),     // 8. Checkpoint: save body immediately
    new ToolLinkerStep(),      // 9. Linkify tool mentions
    new SelfReviewStep(),      // 10. Quality check
    new HeroImageStep(),       // 11. Hero image generation
    new AssemblyStep(),        // 12. JSON-LD schema
    new PersistArticleStep(),  // 13. Final persist
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
      const base = {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        projectSlug: t.projectSlug,
        locale: t.locale,
        frontmatterSchema: t.frontmatterSchema,
        sourceContext: tr.sourceContext,
        toolsContext: tr.toolsContext,
      };
      if (pipelineInput.modelOverride) {
        return { ...base, modelOverride: pipelineInput.modelOverride };
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

    // assembly → persist-article: collect all step outputs
    if (fromStep.name === "assembly" && toStep.name === "persist-article") {
      // tool-linker always runs in BlogPipeline (step 9) — guaranteed non-null
      const linked = getStepOutput<{ bodyMd: string }>("tool-linker")!;
      const d = getStepOutput<DraftStepOutput>("draft")!;
      const sr = getStepOutput<SelfReviewOutput>("self-review")!;
      const hero = getStepOutput<HeroImageOutput>("hero-image")!;
      const asm = output as AssemblyOutput;
      return {
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
    }

    return output;
  }

  override async afterComplete(
    _output: z.infer<typeof BlogPipelineOutputSchema>,
    pipelineInput: BlogPipelineInput,
  ): Promise<void> {
    try {
      await enqueueSchemaExtension({
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      });
    } catch (e) {
      log.warn({ err: e, articleId: pipelineInput.articleId }, "Schema extension enqueue failed after blog pipeline");
    }
  }
}
