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
  UploadSlidesStep,
} from "./steps.ts";

const log = createLogger("pipelines:social-image");

type PipelineInput = {
  articleId: string;
  projectId: string;
  theme: "dark" | "light";
  variant: "stunning";
  locales: string[];
  preRunId?: string;
};

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  theme: z.enum(["dark", "light"]).default("dark"),
  variant: z.enum(["stunning"]).default("stunning"),
  locales: z.array(z.string()).min(1).max(5).default(["de-DE"]),
  preRunId: z.string().uuid().optional(),
}) as z.ZodType<PipelineInput>;

type SocialPostResult = {
  socialPostId: string;
  locale: string;
  slideUrls: string[];
  caption: string;
  hashtags: string[];
  totalSlides: number;
};

type PipelineOutput = {
  socialPosts: SocialPostResult[];
};

const OutputSchema = z.object({
  socialPosts: z.array(z.object({
    socialPostId: z.string().uuid(),
    locale: z.string(),
    slideUrls: z.array(z.string()),
    caption: z.string(),
    hashtags: z.array(z.string()),
    totalSlides: z.number().int(),
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
    new RenderSlidesStep(),
    new UploadSlidesStep(),
    new GenerateCaptionStep(),
    new PersistSocialPostStep(),
  ];

  override async afterComplete(output: PipelineOutput, _input: PipelineInput, _runId: string): Promise<void> {
    log.info(
      { localeCount: output.socialPosts.length, totalSlides: output.socialPosts[0]?.totalSlides },
      "Social image carousel generated"
    );
  }
}

export const socialImagePipeline = new SocialImagePipeline();
