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
import {
  buildCloserHeadline,
  type CloserHeadline,
  type CloserToolContext,
} from "./closerEngine.ts";
import { enrichToolUseCaseTokens } from "./enrichment/toolUseCaseTokens.ts";
import {
  type HookArticleContext,
  type HookOutput,
  type HookPattern,
  buildPromiseBlock,
  buildHookPrompt,
  inferArticleType,
  programmaticFallbackHook,
  selectPattern,
  validateHook,
} from "@marketing-auto/core";

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
  // Spec 51a-stunning-v2.1 §1.2 — closer-engine enrichment tokens (surfaced for caption/a11y)
  endSlideToken: z.string().optional(),
  identityVerb: z.string().optional(),
});

// ─── Step 1: LoadArticleStep ─────────────────────────────────────────────────

const LoadArticleInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  theme: z.enum(["dark", "light"]).default("dark"),
  variant: z.enum(["editorial", "stunning"]).default("editorial"),
  preRunId: z.string().uuid().optional(),
});

const LoadArticleOutputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  theme: z.enum(["dark", "light"]),
  variant: z.enum(["editorial", "stunning"]),
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
  variant: "editorial" | "stunning";
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
      variant: input.variant,
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
  keyDifferentiator: z.string().max(60).optional(),
  starStrength: z.string().max(80).optional(),
  // Spec 51a-stunning-v2.1 §1.2 — closer-engine enrichment tokens
  endSlideToken: z.string().optional(),
  identityVerb: z.string().optional(),
});

// Zod schema for the new phrase-based HookOutput (mirrors hookEngine.ts interfaces)
const hookOutputZodSchema = z.object({
  pattern: z.enum(["superlative_question", "number_promise", "negative_frame", "identity_frame", "curiosity_gap"]),
  leadPhrase: z.string(),
  highlightWord: z.string(),
  trailPhrase: z.string(),
  fullText: z.string(),
  promiseBlock: z.object({ line1: z.string(), line2: z.string() }),
});

// Structured closer (Spec 51a-stunning-v2.1 §1.1) — deterministic patterns,
// each line rendered as three independent JSX spans (no concat bug possible).
const closerLineSchema = z.object({
  leadText: z.string(),
  highlightText: z.string(),
  trailText: z.string(),
});

const endCloserSchema = z.object({
  pattern: z.enum(["verdict_recap", "action_frame", "identity_mirror", "open_comment"]),
  line1: closerLineSchema,
  line2: closerLineSchema,
  fullText: z.string(),
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
  // Stunning variant extras (populated when variant === 'stunning')
  coverHookOutput: hookOutputZodSchema.optional(),
  endCloser: endCloserSchema.optional(),
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
    const isStunning = input.variant === "stunning";

    const stunningSuffix = isStunning ? `

STUNNING VARIANT — zusätzliche Felder pro Tool:
- "keyDifferentiator": 1-5 Wörter aus der Tagline die den Kern-Unterschied benennen (werden highlighted)
- "starStrength": die WICHTIGSTE der 4 Strengths (exakt aus dem strengths-Array)` : "";

    const prompt = `You are a social-media content assistant. Extract structured data for an Instagram carousel from this article.

Article title: ${input.articleTitle}
Article URL: ${input.articleUrl}

Article body (markdown):
${input.bodyMd.slice(0, 6000)}

IMPORTANT for cover headlines: Base them on the ACTUAL tools you extract, not the article title.
- If you extract N tools: coverHeadlineLead = "Die {N} besten", coverHeadlineHighlight = the category (e.g. "KI-Bild-Generatoren")
- Do NOT use "X vs. Y" format — a carousel shows a list, not a duel
- coverEyebrow should reflect the category/topic, not the article title
${stunningSuffix}

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
      "bestFor": "short use-case label, max 40 chars",
      "strengths": ["strength 1", "strength 2", "strength 3", "optional strength 4"],
      "pricing": { "tier": "free|freemium|paid", "label": "ab X€/Monat" }${isStunning ? `,
      "keyDifferentiator": "1-5 key words from tagline",
      "starStrength": "most important strength (copy from strengths array)"` : ""}
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
      maxTokens: isStunning ? 3000 : 2048,
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

    const toolsParsed = z.array(extractedToolSchema).min(1).max(10).parse(parsed.tools);
    let tools: Array<z.infer<typeof extractedToolSchema>> = toolsParsed;

    // If LLM still used "vs." pattern, override with count-based headline
    const leadHasVs = /\bvs\.?\b/i.test(parsed.coverHeadlineLead ?? "");
    const highlightHasVs = /\bvs\.?\b/i.test(parsed.coverHeadlineHighlight ?? "");
    const coverHeadlineLead = leadHasVs || highlightHasVs
      ? `Die ${tools.length} besten`
      : (parsed.coverHeadlineLead ?? `Die ${tools.length} besten`);

    // ─── Hook generation (new phrase-based multi-pattern engine) ───────────────
    let coverHookOutput: HookOutput | undefined;
    if (isStunning) {
      const primaryKeyword = parsed.coverHeadlineHighlight ?? tools[0]?.name ?? "KI-Tools";
      const toolNames = tools.map((t) => t.name);
      const articleCtx: HookArticleContext = {
        id: input.articleId,
        title: input.articleTitle,
        toolCount: tools.length,
        primaryKeyword,
        toolNames,
      };
      const articleType = inferArticleType(input.articleTitle, tools.length);
      const pattern = selectPattern(input.articleId, articleType);
      coverHookOutput = await generateHookWithGate(articleCtx, pattern, ctx, anthropic);
    }

    // ─── Tool-use-case-token enrichment + deterministic closer engine ──────────
    let endCloser: CloserHeadline | undefined;
    if (isStunning) {
      const tokenMap = await enrichToolUseCaseTokens(
        tools.map((t) => ({
          slug: t.slug,
          name: t.name,
          tagline: t.tagline,
          ...(t.bestFor !== undefined && { bestFor: t.bestFor }),
        })),
        ctx,
      );
      tools = tools.map((t) => {
        const tokens = tokenMap[t.slug];
        if (!tokens) return t;
        return { ...t, endSlideToken: tokens.endSlideToken, identityVerb: tokens.identityVerb };
      });

      const articleType = inferArticleType(input.articleTitle, tools.length);
      const closerTools: CloserToolContext[] = tools.map((t) => {
        const ctx: CloserToolContext = { name: t.name };
        if (t.endSlideToken !== undefined) ctx.endSlideToken = t.endSlideToken;
        if (t.identityVerb !== undefined) ctx.identityVerb = t.identityVerb;
        return ctx;
      });
      endCloser = buildCloserHeadline(articleType, closerTools);
    }

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
      coverHookOutput,
      endCloser,
    };
  }
}

// ─── Hook generation helper (retry loop + quality gate) ──────────────────────

async function generateHookWithGate(
  article: HookArticleContext,
  pattern: HookPattern,
  ctx: StepContext,
  anthropicClient: typeof anthropic,
  maxRetries = 2,
): Promise<HookOutput> {
  let lastViolations: string[] | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { systemPrompt, userPrompt } = buildHookPrompt(
      pattern,
      {
        articleTitle: article.title,
        toolNames: article.toolNames,
        primaryKeyword: article.primaryKeyword ?? "KI-Tools",
      },
      lastViolations,
    );

    let hookPartial: { leadPhrase: string; highlightWord: string; trailPhrase: string } | null = null;
    try {
      const resp = await anthropicClient.messages({
        projectId: ctx.projectId,
        pipelineRunId: ctx.pipelineRunId,
        operation: COST_OPS.SOCIAL_IMAGE_EXTRACT,
        model: "claude-haiku-4-5",
        systemPrefix: "",
        systemSuffix: systemPrompt,
        userMessage: userPrompt,
        maxTokens: 256,
        estimatedCostEur: 0.001,
        jsonMode: true,
      });
      const raw = resp.raw;
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        hookPartial = JSON.parse(raw.slice(start, end + 1)) as { leadPhrase: string; highlightWord: string; trailPhrase: string };
      }
    } catch {
      ctx.log.warn({ attempt, pattern }, "Hook LLM call failed");
    }

    if (hookPartial) {
      const result = validateHook(hookPartial, pattern);
      if (result.valid) {
        const promiseBlock = buildPromiseBlock(pattern, {
          toolCount: article.toolCount,
          primaryKeyword: article.primaryKeyword ?? "KI-Tools",
        });
        return {
          ...hookPartial,
          pattern,
          fullText: `${hookPartial.leadPhrase} ${hookPartial.highlightWord} ${hookPartial.trailPhrase}`.trim(),
          promiseBlock,
        };
      }
      lastViolations = result.violations;
      ctx.log.warn({ attempt, violations: result.violations }, "Hook validation failed, retrying");
    }
  }

  ctx.log.error({ articleId: article.id, pattern }, "Hook validation failed all retries, using programmatic fallback");
  return programmaticFallbackHook(article, pattern);
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
    const renderListCarouselStunning = socialModule.renderListCarouselStunning as (
      input: Record<string, unknown>
    ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;

    const toolRecap = input.resolvedTools.map((t) => t.slug);

    const carouselInput = {
      theme: input.theme,
      variant: input.variant,
      brandTokens: input.brandTokens,
      slideIndex: 0,
      cover: {
        eyebrow: input.coverEyebrow,
        headlineLead: input.coverHeadlineLead,
        headlineHighlight: input.coverHeadlineHighlight,
        headlineTrail: input.coverHeadlineTrail,
        subhead: input.coverSubhead,
        ...(input.coverHookOutput && { hookOutput: input.coverHookOutput }),
      },
      tools: input.resolvedTools,
      end: {
        headline: input.endHeadline,
        headlineHighlight: input.endHeadlineHighlight,
        articleUrl: input.articleUrl,
        ...(input.endCloser && { closer: input.endCloser }),
        toolRecap,
      },
    };

    await ctx.reportProgress(10, "Bundling Remotion");
    const renderFn = input.variant === "stunning" ? renderListCarouselStunning : renderListCarousel;
    const { slides, sequenceCount } = await renderFn(carouselInput);
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
