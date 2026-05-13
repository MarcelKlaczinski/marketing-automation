import { anthropic } from "@marketing-auto/adapter-anthropic";
import { r2 } from "@marketing-auto/adapter-storage";
import { COST_OPS } from "@marketing-auto/core";
import {
  articles,
  db,
  projects,
  socialPosts,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

const log = createLogger("pipelines:social-image");

// ─── Shared schemas ────────────────────────────────────────────────────────────

const resolvedToolSchema = z.object({
  slug: z.string(),
  rank: z.number().int(),
  name: z.string(),
  domain: z.string(),
  eyebrow: z.string(),
  tagline: z.string(),
  bestFor: z.string().max(40).optional(),
  strengths: z.array(z.string()),
  pricing: z.object({
    tier: z.enum(["free", "freemium", "paid"]),
    label: z.string(),
  }),
  iconSvg: z.string().optional(),   // inline SVG from resolution chain
  iconInitials: z.string().optional(),
  iconHue: z.number().optional(),
});

// ─── Step 1: LoadArticleStep ─────────────────────────────────────────────────

const LoadArticleInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  theme: z.enum(["dark", "light"]).default("dark"),
  preRunId: z.string().uuid().optional(),
});

const LoadArticleOutputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  theme: z.enum(["dark", "light"]),
  articleTitle: z.string(),
  articleSlug: z.string(),
  bodyMd: z.string(),
  articleUrl: z.string(),
  brandTokens: z.record(z.unknown()),
});

type LoadArticleInput = {
  articleId: string;
  projectId: string;
  theme: "dark" | "light";
  preRunId?: string;
};

export class LoadArticleStep extends BaseStep<
  LoadArticleInput,
  z.infer<typeof LoadArticleOutputSchema>
> {
  readonly name = "load-article";
  readonly inputSchema = LoadArticleInputSchema as z.ZodType<LoadArticleInput>;
  readonly outputSchema = LoadArticleOutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof LoadArticleInputSchema>, _ctx: StepContext) {
    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, input.articleId), eq(articles.projectId, input.projectId)))
      .limit(1);
    if (!article) throw new Error(`Article ${input.articleId} not found`);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) throw new Error(`Project ${input.projectId} not found`);

    const cmsBase = (project.cmsConfig as { baseUrl?: string })?.baseUrl ?? `https://${project.domain ?? "example.com"}`;
    const articleUrl = `${cmsBase}/${article.slug}`;

    return {
      articleId: article.id,
      projectId: project.id,
      projectSlug: project.slug,
      theme: input.theme,
      articleTitle: article.title ?? article.slug,
      articleSlug: article.slug,
      bodyMd: article.bodyMd ?? "",
      articleUrl,
      brandTokens: (project.brandTokens as Record<string, unknown>) ?? {},
    };
  }
}

// ─── Step 2: ExtractToolsStep ────────────────────────────────────────────────

const ExtractToolsInputSchema = LoadArticleOutputSchema;

const extractedToolSchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  slug: z.string(),
  domain: z.string(),
  tagline: z.string(),
  bestFor: z.string().max(40).optional(),
  strengths: z.array(z.string()).min(1).max(4),
  pricing: z.object({ tier: z.enum(["free", "freemium", "paid"]), label: z.string() }),
});

const ExtractToolsOutputSchema = ExtractToolsInputSchema.extend({
  extractedTools: z.array(extractedToolSchema).min(1).max(10),
  coverEyebrow: z.string(),
  coverHeadlineLead: z.string(),
  coverHeadlineHighlight: z.string(),
  coverHeadlineTrail: z.string().optional(),
  coverSubhead: z.string().optional(),
  endHeadline: z.string(),
  endHeadlineHighlight: z.string(),
});

export class ExtractToolsStep extends BaseStep<
  z.infer<typeof ExtractToolsInputSchema>,
  z.infer<typeof ExtractToolsOutputSchema>
> {
  readonly name = "extract-tools";
  readonly inputSchema = ExtractToolsInputSchema;
  readonly outputSchema = ExtractToolsOutputSchema;

  override estimatedCostEur(): number { return 0.005; }

  async execute(input: z.infer<typeof ExtractToolsInputSchema>, ctx: StepContext) {
    const prompt = `You are a social-media content assistant. Extract structured data for an Instagram carousel from this article.

Article title: ${input.articleTitle}
Article URL: ${input.articleUrl}

Article body (markdown):
${input.bodyMd.slice(0, 6000)}

IMPORTANT for cover headlines: Base them on the ACTUAL tools you extract, not the article title.
- If you extract N tools: coverHeadlineLead = "Die {N} besten", coverHeadlineHighlight = the category (e.g. "KI-Bild-Generatoren")
- Do NOT use "X vs. Y" format even if the article title says so — a carousel shows a list, not a duel
- coverEyebrow should reflect the category/topic, not the article title

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "coverEyebrow": "string up to 40 chars, e.g. 'KI-BILDGENERATOREN 2026'",
  "coverHeadlineLead": "string up to 30 chars — MUST reflect tool count, e.g. 'Die 5 besten'",
  "coverHeadlineHighlight": "string up to 40 chars — the tool category, e.g. 'KI-Bild-Generatoren'",
  "coverHeadlineTrail": "optional string up to 20 chars, e.g. 'im Vergleich'",
  "coverSubhead": "optional string up to 80 chars",
  "endHeadline": "string up to 40 chars",
  "endHeadlineHighlight": "string up to 40 chars",
  "tools": [
    {
      "rank": 1,
      "name": "Tool Name",
      "slug": "tool-slug",
      "domain": "tool.com",
      "tagline": "one sentence, max 120 chars",
      "bestFor": "short use-case label, max 40 chars, e.g. 'Foto-Editing' or 'Code-Generierung'",
      "strengths": ["strength 1", "strength 2", "strength 3", "optional strength 4"],
      "pricing": { "tier": "free|freemium|paid", "label": "ab X€/Monat" }
    }
  ]
}

Extract 3-10 tools. Keep all text in GERMAN (same language as the article).`;

    const response = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SOCIAL_IMAGE_EXTRACT,
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "Extract structured tool data for Instagram carousel generation. Return valid JSON only.",
      userMessage: prompt,
      maxTokens: 2048,
      estimatedCostEur: 0.005,
      jsonMode: true,
    });

    const rawText = response.raw;
    let parsed: {
      tools: Array<z.infer<typeof extractedToolSchema>>;
      coverEyebrow: string;
      coverHeadlineLead: string;
      coverHeadlineHighlight: string;
      coverHeadlineTrail?: string;
      coverSubhead?: string;
      endHeadline: string;
      endHeadlineHighlight: string;
    };

    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    const cleanText = jsonStart >= 0 && jsonEnd > jsonStart ? rawText.slice(jsonStart, jsonEnd + 1) : rawText;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      throw new Error(`ExtractToolsStep: LLM returned invalid JSON: ${rawText.slice(0, 200)}`);
    }

    const tools = z.array(extractedToolSchema).min(1).max(10).parse(parsed.tools);

    // If LLM still used "vs." pattern, override with count-based headline
    const leadHasVs = /\bvs\.?\b/i.test(parsed.coverHeadlineLead ?? "");
    const highlightHasVs = /\bvs\.?\b/i.test(parsed.coverHeadlineHighlight ?? "");
    const coverHeadlineLead = leadHasVs || highlightHasVs
      ? `Die ${tools.length} besten`
      : (parsed.coverHeadlineLead ?? `Die ${tools.length} besten`);

    return {
      ...input,
      extractedTools: tools,
      coverEyebrow: parsed.coverEyebrow ?? `${input.articleTitle.toUpperCase()}`,
      coverHeadlineLead,
      coverHeadlineHighlight: (leadHasVs || highlightHasVs)
        ? (parsed.coverHeadlineHighlight?.replace(/\s*vs\.?\s*/gi, " & ") ?? input.articleTitle)
        : (parsed.coverHeadlineHighlight ?? input.articleTitle),
      coverHeadlineTrail: parsed.coverHeadlineTrail,
      coverSubhead: parsed.coverSubhead,
      endHeadline: parsed.endHeadline ?? "Mehr Reviews,",
      endHeadlineHighlight: parsed.endHeadlineHighlight ?? "ehrlich getestet.",
    };
  }
}

// ─── Step 3: ResolveAssetsStep ───────────────────────────────────────────────

const ResolveAssetsInputSchema = ExtractToolsOutputSchema;
const ResolveAssetsOutputSchema = ResolveAssetsInputSchema.extend({
  resolvedTools: z.array(resolvedToolSchema),
});

export class ResolveAssetsStep extends BaseStep<
  z.infer<typeof ResolveAssetsInputSchema>,
  z.infer<typeof ResolveAssetsOutputSchema>
> {
  readonly name = "resolve-assets";
  readonly inputSchema = ResolveAssetsInputSchema;
  readonly outputSchema = ResolveAssetsOutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof ResolveAssetsInputSchema>, _ctx: StepContext) {
    const { resolveToolIcon } = await import("../../_lib/resolve-tool-icon.ts");

    const resolvedTools = await Promise.all(
      input.extractedTools.map(async (tool) => {
        const icon = await resolveToolIcon(input.projectId, tool.slug, input.theme);
        return {
          ...tool,
          eyebrow: `${String(tool.rank).padStart(2, "0")} · ${tool.name.toUpperCase()}`,
          bestFor: tool.bestFor,
          // emoji field intentionally omitted — icons are resolved from brand asset library
          iconSvg: icon.type === "svg" ? icon.svg : undefined,
          iconInitials: icon.type === "avatar" ? icon.initials : undefined,
          iconHue: icon.type === "avatar" ? icon.hue : undefined,
        };
      })
    );

    return { ...input, resolvedTools };
  }
}

// ─── Step 4: RenderSlidesStep ────────────────────────────────────────────────

const RenderSlidesInputSchema = ResolveAssetsOutputSchema;
const RenderSlidesOutputSchema = RenderSlidesInputSchema.extend({
  slideBuffers: z.array(z.instanceof(Buffer)),
  totalSlides: z.number().int(),
});

export class RenderSlidesStep extends BaseStep<
  z.infer<typeof RenderSlidesInputSchema>,
  z.infer<typeof RenderSlidesOutputSchema>
> {
  readonly name = "render-slides";
  readonly inputSchema = RenderSlidesInputSchema;
  readonly outputSchema = RenderSlidesOutputSchema;

  override estimatedCostEur(): number { return 0.002; }

  async execute(input: z.infer<typeof RenderSlidesInputSchema>, ctx: StepContext) {
    ctx.log.info({ toolCount: input.resolvedTools.length }, "Rendering Remotion slides");

    // Dynamic import at runtime — social package is a workspace peer
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import avoids circular dep during build
    const socialModule = await import("../../../../social/render-server.ts") as any;
    const renderListCarousel = socialModule.renderListCarousel as (
      input: Record<string, unknown>
    ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;

    const carouselInput = {
      theme: input.theme,
      brandTokens: input.brandTokens,
      slideIndex: 0,
      cover: {
        eyebrow: input.coverEyebrow,
        headlineLead: input.coverHeadlineLead,
        headlineHighlight: input.coverHeadlineHighlight,
        headlineTrail: input.coverHeadlineTrail,
        subhead: input.coverSubhead,
      },
      tools: input.resolvedTools,
      end: {
        headline: input.endHeadline,
        headlineHighlight: input.endHeadlineHighlight,
        articleUrl: input.articleUrl,
      },
    };

    await ctx.reportProgress(10, "Bundling Remotion");
    const { slides, sequenceCount } = await renderListCarousel(carouselInput);
    await ctx.reportProgress(90, `Rendered ${sequenceCount} slides`);

    return { ...input, slideBuffers: slides, totalSlides: sequenceCount };
  }
}

// ─── Step 5: UploadSlidesStep ────────────────────────────────────────────────

const UploadSlidesInputSchema = RenderSlidesOutputSchema;
const UploadSlidesOutputSchema = UploadSlidesInputSchema.extend({
  slideUrls: z.array(z.string()),
});

export class UploadSlidesStep extends BaseStep<
  z.infer<typeof UploadSlidesInputSchema>,
  z.infer<typeof UploadSlidesOutputSchema>
> {
  readonly name = "upload-slides";
  readonly inputSchema = UploadSlidesInputSchema;
  readonly outputSchema = UploadSlidesOutputSchema;

  override estimatedCostEur(): number { return 0.0001; }

  async execute(input: z.infer<typeof UploadSlidesInputSchema>, ctx: StepContext) {
    const timestamp = Date.now();
    const slideUrls: string[] = [];

    for (let i = 0; i < input.slideBuffers.length; i++) {
      const key = `${input.projectSlug}/social/${input.articleSlug}-${timestamp}-slide-${i}.png`;
      const result = await r2.put({
        key,
        body: input.slideBuffers[i]!,
        contentType: "image/png",
      });
      slideUrls.push(result.publicUrl);
      await ctx.reportProgress(
        Math.round((i / input.slideBuffers.length) * 100),
        `Uploaded slide ${i + 1}/${input.slideBuffers.length}`
      );
    }

    log.info({ count: slideUrls.length }, "Slides uploaded to R2");
    return { ...input, slideUrls };
  }
}

// ─── Step 6: GenerateCaptionStep ─────────────────────────────────────────────

const GenerateCaptionInputSchema = UploadSlidesOutputSchema;
const GenerateCaptionOutputSchema = GenerateCaptionInputSchema.extend({
  caption: z.string(),
});

export class GenerateCaptionStep extends BaseStep<
  z.infer<typeof GenerateCaptionInputSchema>,
  z.infer<typeof GenerateCaptionOutputSchema>
> {
  readonly name = "generate-caption";
  readonly inputSchema = GenerateCaptionInputSchema;
  readonly outputSchema = GenerateCaptionOutputSchema;

  override estimatedCostEur(): number { return 0.015; }

  async execute(input: z.infer<typeof GenerateCaptionInputSchema>, ctx: StepContext) {
    const brandVoice = (input.brandTokens as { voice?: { signaturePhrases?: string[]; addressForm?: string } })?.voice;
    const signaturePhrases = brandVoice?.signaturePhrases?.join(", ") ?? "redaktionell verifiziert, ehrlich";
    const addressForm = brandVoice?.addressForm ?? "du";

    const captionPrompt = `Write an Instagram caption in GERMAN for a carousel post about: "${input.articleTitle}"

The post shows ${input.resolvedTools.length} AI tools in a visual list-carousel format.
Brand voice: ${signaturePhrases}. Use "${addressForm}" form. Max 300 characters. Use 1-2 fitting emojis.
End with: Link in Bio → ${input.articleUrl}

Return ONLY the caption text, no JSON.`;

    const response = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SOCIAL_IMAGE_CAPTION,
      model: "claude-sonnet-4-6",
      systemPrefix: "",
      systemSuffix: "You are an Instagram content writer. Return only the caption text.",
      userMessage: captionPrompt,
      maxTokens: 800,
      estimatedCostEur: 0.015,
    });

    const caption = response.raw.trim() || `${input.articleTitle} — ${input.articleUrl}`;

    return { ...input, caption };
  }
}

// ─── Step 7: ResearchHashtagsStep ────────────────────────────────────────────

const ResearchHashtagsInputSchema = GenerateCaptionOutputSchema;
const ResearchHashtagsOutputSchema = ResearchHashtagsInputSchema.extend({
  hashtags: z.array(z.string()),
});

export class ResearchHashtagsStep extends BaseStep<
  z.infer<typeof ResearchHashtagsInputSchema>,
  z.infer<typeof ResearchHashtagsOutputSchema>
> {
  readonly name = "research-hashtags";
  readonly inputSchema = ResearchHashtagsInputSchema;
  readonly outputSchema = ResearchHashtagsOutputSchema;

  override estimatedCostEur(): number { return 0.005; }

  async execute(input: z.infer<typeof ResearchHashtagsInputSchema>, ctx: StepContext) {
    const toolNames = input.resolvedTools.map((t) => t.name).join(", ");

    const response = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SOCIAL_IMAGE_HASHTAGS,
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "Return only a JSON array of hashtag strings.",
      userMessage: `Generate 15-20 Instagram hashtags in German and English for a carousel about: "${input.articleTitle}".\nTools featured: ${toolNames}.\nReturn ONLY a JSON array of strings, e.g. ["#KITools","#ArtificialIntelligence"]`,
      maxTokens: 300,
      estimatedCostEur: 0.005,
      jsonMode: true,
    });

    const rawText = response.raw;
    let hashtags: string[] = [];
    try {
      const match = rawText.match(/\[[\s\S]*\]/);
      hashtags = match ? JSON.parse(match[0]) : [];
    } catch {
      hashtags = ["#KITools", "#ArtificialIntelligence", "#Technologie"];
    }

    return { ...input, hashtags: hashtags.slice(0, 20) };
  }
}

// ─── Step 8: PersistSocialPostStep ───────────────────────────────────────────

const PersistInputSchema = ResearchHashtagsOutputSchema;
const PersistOutputSchema = z.object({
  socialPostId: z.string().uuid(),
  slideUrls: z.array(z.string()),
  caption: z.string(),
  hashtags: z.array(z.string()),
  totalSlides: z.number().int(),
});

export class PersistSocialPostStep extends BaseStep<
  z.infer<typeof PersistInputSchema>,
  z.infer<typeof PersistOutputSchema>
> {
  readonly name = "persist-social-post";
  readonly inputSchema = PersistInputSchema;
  readonly outputSchema = PersistOutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof PersistInputSchema>, _ctx: StepContext) {
    const [post] = await db
      .insert(socialPosts)
      .values({
        projectId: input.projectId,
        articleId: input.articleId,
        platform: "instagram",
        format: "carousel",
        status: "draft",
        theme: input.theme,
        totalSlides: input.totalSlides,
        content: {
          kind: "carousel",
          slides: input.slideUrls.map((url) => ({ imageUrl: url })),
          caption: input.caption,
          hashtags: input.hashtags,
        },
        generatedAt: new Date(),
      })
      .returning({ id: socialPosts.id });

    if (!post) throw new Error("Failed to insert social post");

    return {
      socialPostId: post.id,
      slideUrls: input.slideUrls,
      caption: input.caption,
      hashtags: input.hashtags,
      totalSlides: input.totalSlides,
    };
  }
}
