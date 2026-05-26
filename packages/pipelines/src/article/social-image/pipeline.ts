import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import {
  ExtractToolsStep,
  GenerateCaptionStep,
  GenerateComparisonGrid4Step,
  LoadArticleStep,
  RenderSlidesStep,
  ResolveAssetsStep,
} from "./steps.ts";
import { StageFamilyBImagesStep } from "./stage-family-b-images.step.ts";

const log = createLogger("pipelines:social-image");

type PipelineInput = {
  articleId: string;
  projectId: string;
  theme: "dark" | "light";
  variant: "stunning";
  locales: string[];
  preRunId?: string;
  // Spec 60.6: when set, RenderSlidesStep uses this key instead of auto-routing by tool count
  templateKey?: string | null;
};

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  theme: z.enum(["dark", "light"]).default("dark"),
  variant: z.enum(["stunning"]).default("stunning"),
  locales: z.array(z.string()).min(1).max(5).default(["de-DE"]),
  preRunId: z.string().uuid().optional(),
  templateKey: z.string().nullable().optional(),
}) as z.ZodType<PipelineInput>;

type SocialPostResult = {
  socialPostId: string;
  locale: string;
  renderJobId: string;
  caption: string;
  hashtags: string[];
};

type PipelineOutput = {
  socialPosts: SocialPostResult[];
};

const OutputSchema = z.object({
  socialPosts: z.array(z.object({
    socialPostId: z.string().uuid(),
    locale: z.string(),
    renderJobId: z.string(),
    caption: z.string(),
    hashtags: z.array(z.string()),
  })).min(1),
}) as z.ZodType<PipelineOutput>;

export class SocialImagePipeline extends Pipeline<PipelineInput, PipelineOutput> {
  readonly name = "article:social-image";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  readonly steps = [
    new LoadArticleStep(),
    new ExtractToolsStep(),
    new ResolveAssetsStep(),
    new GenerateComparisonGrid4Step(),
    new GenerateCaptionStep(),
    // Spec 65.8 Day 5: Family-B photographic-pipeline. Pass-through for
    // non-Family-B templates (zero cost, no I/O); for the 3 Family-B
    // templates, populates `articles.domain_extras.familyBImages[]` with
    // R2-staged WebP URLs + license metadata before RenderSlidesStep.
    new StageFamilyBImagesStep(),
    new RenderSlidesStep(),
  ];

  // Spec 60.6: inject templateKeyOverride from pipeline input into the generate-caption → render-slides transition
  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: PipelineInput,
  ): unknown {
    if (fromStep.name === "generate-caption" && toStep.name === "render-slides" && pipelineInput.templateKey != null) {
      return { ...(output as Record<string, unknown>), templateKeyOverride: pipelineInput.templateKey };
    }
    return output;
  }

  override async afterComplete(output: PipelineOutput, _input: PipelineInput, _runId: string): Promise<void> {
    log.info(
      { localeCount: output.socialPosts.length },
      "Social image pipeline complete — render jobs enqueued"
    );
  }
}

export const socialImagePipeline = new SocialImagePipeline();
