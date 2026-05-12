import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import {
  ExtractToolsStep,
  GenerateCaptionStep,
  LoadArticleStep,
  PersistSocialPostStep,
  RenderSlidesStep,
  ResolveAssetsStep,
  ResearchHashtagsStep,
  UploadSlidesStep,
} from "./steps.ts";

const log = createLogger("pipelines:social-image");

type PipelineInput = {
  articleId: string;
  projectId: string;
  theme: "dark" | "light";
  preRunId?: string;
};

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  theme: z.enum(["dark", "light"]).default("dark"),
  preRunId: z.string().uuid().optional(),
}) as z.ZodType<PipelineInput>;

type PipelineOutput = {
  socialPostId: string;
  slideUrls: string[];
  caption: string;
  hashtags: string[];
  totalSlides: number;
};

const OutputSchema = z.object({
  socialPostId: z.string().uuid(),
  slideUrls: z.array(z.string()),
  caption: z.string(),
  hashtags: z.array(z.string()),
  totalSlides: z.number().int(),
}) as z.ZodType<PipelineOutput>;

export class SocialImagePipeline extends Pipeline<PipelineInput, PipelineOutput> {
  readonly name = "article:social-image";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  readonly steps = [
    new LoadArticleStep(),
    new ExtractToolsStep(),
    new ResolveAssetsStep(),
    new RenderSlidesStep(),
    new UploadSlidesStep(),
    new GenerateCaptionStep(),
    new ResearchHashtagsStep(),
    new PersistSocialPostStep(),
  ];

  override async afterComplete(output: PipelineOutput, _input: PipelineInput, _runId: string): Promise<void> {
    log.info(
      { socialPostId: output.socialPostId, totalSlides: output.totalSlides },
      "Social image carousel generated"
    );
  }
}

export const socialImagePipeline = new SocialImagePipeline();
