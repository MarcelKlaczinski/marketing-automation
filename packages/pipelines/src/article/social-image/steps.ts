import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS, buildHashtagInstructions, deriveContentType } from "@marketing-auto/core";
import { enqueueSocialRenderJob, type SocialRenderJobData } from "../../engine/social-render-queue.ts";
import {
  articles,
  db,
  fetchTemplateOverrides,
  markTemplateOverrideUsed,
  projects,
  socialPosts,
  type SocialPostRenderInput,
} from "@marketing-auto/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import {
  buildCloserHeadline,
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

// ─── Shared schemas ────────────────────────────────────────────────────────────

const resolvedToolSchema = z.object({
  slug: z.string(),
  rank: z.number().int(),
  name: z.string(),
  domain: z.string(),
  eyebrow: z.string(),
  tagline: z.string(),
  // LLM sometimes exceeds 40 chars — truncate rather than reject
  bestFor: z.string().transform((s) => s.slice(0, 40)).optional(),
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
  variant: z.enum(["stunning"]).default("stunning"),
  locales: z.array(z.string()).min(1).max(5).default(["de-DE"]),
  preRunId: z.string().uuid().optional(),
});

const localeArticleSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  bodyMd: z.string(),
  articleUrl: z.string(),
});

const LoadArticleOutputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  theme: z.enum(["dark", "light"]),
  variant: z.enum(["stunning"]),
  locales: z.array(z.string()),
  articleTitle: z.string(),
  articleSlug: z.string(),
  intentType: z.string().nullable(),
  bodyMd: z.string(),
  articleUrl: z.string(),
  brandTokens: z.record(z.unknown()),
  // Locale-specific sibling articles keyed by locale prefix ("en", "de").
  // Populated when the canonical article has translation siblings.
  localeArticles: z.record(z.string(), localeArticleSchema).optional(),
});

type LoadArticleInput = {
  articleId: string;
  projectId: string;
  theme: "dark" | "light";
  variant: "stunning";
  locales: string[];
  preRunId?: string;
};

/** Default system suffix for JSON-only LLM calls in this module — extracted so the override key works against a stable default. */
const JSON_ONLY_SUFFIX = "Respond with only a valid JSON object. No markdown, no explanation.";

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

    // Load translation siblings when multiple locales are requested or a non-canonical locale
    // is requested. Keyed by locale prefix ("de", "en") for downstream steps.
    let localeArticles: Record<string, z.infer<typeof localeArticleSchema>> | undefined;
    if (article.translationKey && input.locales.length > 0) {
      const siblings = await db
        .select()
        .from(articles)
        .where(and(
          eq(articles.translationKey, article.translationKey),
          eq(articles.projectId, input.projectId),
        ));

      if (siblings.length > 1) {
        localeArticles = {};
        for (const sib of siblings) {
          const localePrefix = ((sib.locale ?? "de").split("-")[0] ?? "de").split("_")[0] ?? "de";
          localeArticles[localePrefix] = {
            id: sib.id,
            title: sib.title ?? sib.slug,
            slug: sib.slug,
            bodyMd: sib.bodyMd ?? "",
            articleUrl: `${cmsBase}/${sib.slug}`,
          };
        }
      }
    }

    return {
      articleId: article.id,
      projectId: project.id,
      projectSlug: project.slug,
      theme: input.theme,
      variant: input.variant,
      locales: input.locales,
      articleTitle: article.title ?? article.slug,
      articleSlug: article.slug,
      intentType: article.intentType ?? null,
      bodyMd: article.bodyMd ?? "",
      articleUrl,
      brandTokens: (project.brandTokens as Record<string, unknown>) ?? {},
      ...(localeArticles ? { localeArticles } : {}),
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
  // LLM sometimes exceeds 40 chars — truncate rather than reject
  bestFor: z.string().transform((s) => s.slice(0, 40)).optional(),
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

// Per-locale extraction result — used when the run spans DE + EN so each locale
// gets its own tool text (tagline, bestFor, strengths, pricing.label, cover copy).
const localeToolsDataSchema = z.object({
  tools: z.array(extractedToolSchema),
  coverEyebrow: z.string(),
  coverHeadlineLead: z.string(),
  coverHeadlineHighlight: z.string(),
  coverHeadlineTrail: z.string().optional(),
  coverSubhead: z.string().optional(),
  endHeadline: z.string(),
  endHeadlineHighlight: z.string(),
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
  // Non-DE locale extractions keyed by locale prefix ("en").
  // Populated when locales contains a non-DE locale AND a sibling article exists.
  localeToolsData: z.record(z.string(), localeToolsDataSchema).optional(),
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
    // For EN-only requests, use the EN sibling article body if available — otherwise the LLM
    // translates on the fly from the DE body (acceptable fallback; EN sibling gives better results).
    const isEnOnly = input.locales.every(l => !l.startsWith("de"));
    const enSibling = isEnOnly ? input.localeArticles?.["en"] : undefined;
    const sourceBody = enSibling?.bodyMd ?? input.bodyMd;
    const sourceTitle = enSibling?.title ?? input.articleTitle;
    const sourceUrl = enSibling?.articleUrl ?? input.articleUrl;

    const stunningSuffix = `

STUNNING VARIANT — additional fields per tool:
- "keyDifferentiator": 1-5 words from the tagline naming the core differentiator (will be highlighted)
- "starStrength": the MOST IMPORTANT of the 4 strengths (copy exactly from the strengths array)`;

    const prompt = `You are a social-media content assistant. Extract structured data for an Instagram carousel from this article.

Article title: ${sourceTitle}
Article URL: ${sourceUrl}

Article body (markdown):
${sourceBody.slice(0, 6000)}

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
      "pricing": { "tier": "free|freemium|paid", "label": "ab X€/Monat" },
      "keyDifferentiator": "1-5 key words from tagline",
      "starStrength": "most important strength (copy from strengths array)"
    }
  ]
}

Extract 3-10 tools. Keep all text in ${isEnOnly ? "ENGLISH" : "GERMAN"} (match the carousel target language).`;

    const response = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SOCIAL_IMAGE_EXTRACT,
      model: "claude-haiku-4-5",
      systemPrefix: "",
      // Spec 62.0a Section 4.4: one edit-prompt override per step covers all 3 LLM calls
      // inside ExtractToolsStep (extract DE, extract EN, generate hook).
      systemSuffix: resolvePrompt(
        ctx,
        this.name,
        () => "Extract structured tool data for Instagram carousel generation. Return valid JSON only."
      ),
      userMessage: prompt,
      maxTokens: 3000,
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
    const defaultLead = isEnOnly ? `The ${tools.length} Best` : `Die ${tools.length} besten`;
    const coverHeadlineLead = leadHasVs || highlightHasVs
      ? defaultLead
      : (parsed.coverHeadlineLead ?? defaultLead);

    // ─── Hook generation (new phrase-based multi-pattern engine) ───────────────
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
    const coverHookOutput: HookOutput = await generateHookWithGate(articleCtx, pattern, ctx, anthropic, this.name);

    // ─── Tool-use-case-token enrichment + deterministic closer engine ──────────
    const tokenMap = await enrichToolUseCaseTokens(
      tools.map((t) => ({
        slug: t.slug,
        name: t.name,
        tagline: t.tagline,
        ...(t.bestFor !== undefined && { bestFor: t.bestFor }),
      })),
      ctx,
      this.name,
    );
    tools = tools.map((t) => {
      const tokens = tokenMap[t.slug];
      if (!tokens) return t;
      return { ...t, endSlideToken: tokens.endSlideToken, identityVerb: tokens.identityVerb };
    });

    const closerArticleType = inferArticleType(input.articleTitle, tools.length);
    const closerTools: CloserToolContext[] = tools.map((t) => {
      const closerCtx: CloserToolContext = { name: t.name };
      if (t.endSlideToken !== undefined) closerCtx.endSlideToken = t.endSlideToken;
      if (t.identityVerb !== undefined) closerCtx.identityVerb = t.identityVerb;
      return closerCtx;
    });
    const endCloser = buildCloserHeadline(closerArticleType, closerTools);

    // ─── EN extraction for bilingual runs ────────────────────────────────────
    // When locales includes a non-DE locale AND an EN sibling exists, run a second
    // Haiku extraction on the EN article body so tool text (bestFor, tagline,
    // strengths, pricing.label) and cover copy are in English, not German.
    let localeToolsData: Record<string, z.infer<typeof localeToolsDataSchema>> | undefined;
    const hasNonDeLocale = input.locales.some((l) => !l.startsWith("de"));
    const enSiblingForExtract = !isEnOnly && hasNonDeLocale ? input.localeArticles?.["en"] : undefined;
    if (enSiblingForExtract) {
      try {
        const enPrompt = `You are a social-media content assistant. Extract structured data for an Instagram carousel from this article.

Article title: ${enSiblingForExtract.title}
Article URL: ${enSiblingForExtract.articleUrl}

Article body (markdown):
${(enSiblingForExtract.bodyMd ?? "").slice(0, 6000)}

IMPORTANT for cover headlines: Base them on the ACTUAL tools you extract, not the article title.
- If you extract N tools: coverHeadlineLead = "The {N} Best", coverHeadlineHighlight = the category (e.g. "AI Image Generators")
- Do NOT use "X vs. Y" format — a carousel shows a list, not a duel
- coverEyebrow should reflect the category/topic, not the article title

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "coverEyebrow": "string up to 40 chars, e.g. 'AI IMAGE GENERATORS 2026'",
  "coverHeadlineLead": "string up to 30 chars — MUST reflect tool count, e.g. 'The 5 Best'",
  "coverHeadlineHighlight": "string up to 40 chars — the tool category, e.g. 'AI Image Generators'",
  "coverHeadlineTrail": "optional string up to 20 chars, e.g. 'Compared'",
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
      "pricing": { "tier": "free|freemium|paid", "label": "from $X/month" },
      "keyDifferentiator": "1-5 key words from tagline that name the core differentiator",
      "starStrength": "copy the most important strength exactly from the strengths array",
      "identityVerb": "short gerund phrase describing what you use this tool for (e.g. 'writing code', 'designing logos', 'generating images')"
    }
  ]
}

Extract ${tools.length} tools in the same order as the DE extraction. Keep ALL text in ENGLISH.`;

        const enResp = await anthropic.messages({
          projectId: ctx.projectId,
          pipelineRunId: ctx.pipelineRunId,
          operation: COST_OPS.SOCIAL_IMAGE_EXTRACT,
          model: "claude-haiku-4-5",
          systemPrefix: "",
          systemSuffix: resolvePrompt(
            ctx,
            this.name,
            () => "Extract structured tool data for Instagram carousel generation. Return valid JSON only."
          ),
          userMessage: enPrompt,
          maxTokens: 3000,
          estimatedCostEur: 0.005,
          jsonMode: true,
        });

        const enRaw = enResp.raw;
        const enStart = enRaw.indexOf("{");
        const enEnd = enRaw.lastIndexOf("}");
        const enClean = enStart >= 0 && enEnd > enStart ? enRaw.slice(enStart, enEnd + 1) : enRaw;
        const enParsed = JSON.parse(enClean) as {
          tools: Array<z.infer<typeof extractedToolSchema> & { identityVerb?: string }>;
          coverEyebrow: string;
          coverHeadlineLead: string;
          coverHeadlineHighlight: string;
          coverHeadlineTrail?: string;
          coverSubhead?: string;
          endHeadline: string;
          endHeadlineHighlight: string;
        };
        const enToolsParsed = z.array(extractedToolSchema).min(1).max(10).parse(enParsed.tools);
        const enLeadHasVs = /\bvs\.?\b/i.test(enParsed.coverHeadlineLead ?? "");
        const enHighlightHasVs = /\bvs\.?\b/i.test(enParsed.coverHeadlineHighlight ?? "");
        const enDefaultLead = `The ${enToolsParsed.length} Best`;
        const enLeadFinal = enLeadHasVs || enHighlightHasVs ? enDefaultLead : (enParsed.coverHeadlineLead ?? enDefaultLead);

        const enData: z.infer<typeof localeToolsDataSchema> = {
          tools: enToolsParsed,
          coverEyebrow: enParsed.coverEyebrow ?? (enSiblingForExtract.title.split(":")[0] ?? enSiblingForExtract.title).toUpperCase().slice(0, 40).trim(),
          coverHeadlineLead: enLeadFinal,
          coverHeadlineHighlight: enParsed.coverHeadlineHighlight ?? "AI Tools",
          endHeadline: enParsed.endHeadline ?? "More reviews,",
          endHeadlineHighlight: enParsed.endHeadlineHighlight ?? "honestly tested.",
          ...(enParsed.coverHeadlineTrail !== undefined && { coverHeadlineTrail: enParsed.coverHeadlineTrail }),
          ...(enParsed.coverSubhead !== undefined && { coverSubhead: enParsed.coverSubhead }),
        };
        localeToolsData = { en: enData };
        ctx.log.info({ toolCount: enToolsParsed.length }, "EN locale extraction succeeded");
      } catch (err) {
        ctx.log.warn({ err: String(err) }, "EN locale extraction failed — EN slides will use DE copy");
      }
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
      ...(localeToolsData !== undefined && { localeToolsData }),
    };
  }
}

// ─── Hook generation helper (retry loop + quality gate) ──────────────────────

async function generateHookWithGate(
  article: HookArticleContext,
  pattern: HookPattern,
  ctx: StepContext,
  anthropicClient: typeof anthropic,
  // Spec 62.0a Section 4.4: stepName threaded from the calling step's `this.name` so the
  // edit-prompt resume override is keyed correctly (same key as the rest of the step).
  stepName: string,
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
        systemSuffix: resolvePrompt(ctx, stepName, () => systemPrompt),
        userMessage: userPrompt,
        maxTokens: 256,
        estimatedCostEur: 0.001,
        jsonMode: true,
      });
      const raw = resp.raw;
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const candidate = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
        if (typeof candidate.leadPhrase === "string" && typeof candidate.highlightWord === "string" && typeof candidate.trailPhrase === "string") {
          hookPartial = candidate as { leadPhrase: string; highlightWord: string; trailPhrase: string };
        }
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

// ─── Step 4: GenerateComparisonGrid4Step ────────────────────────────────────
// Generates ComparisonGrid4Generated content via Sonnet LLM.
// Only runs for comparison-grid-4 (exactly 4 tools). Returns null for other counts.

const GenerateComparisonGrid4InputSchema = ResolveAssetsOutputSchema;
const GenerateComparisonGrid4OutputSchema = ResolveAssetsOutputSchema.extend({
  comparisonGrid4Generated: z.unknown().nullable(),
});

export class GenerateComparisonGrid4Step extends BaseStep<
  z.infer<typeof GenerateComparisonGrid4InputSchema>,
  z.infer<typeof GenerateComparisonGrid4OutputSchema>
> {
  readonly name = "generate-comparison-grid-4";
  readonly inputSchema = GenerateComparisonGrid4InputSchema;
  readonly outputSchema = GenerateComparisonGrid4OutputSchema;

  override estimatedCostEur(): number { return 0.028; }

  async execute(
    input: z.infer<typeof GenerateComparisonGrid4InputSchema>,
    ctx: StepContext,
  ): Promise<z.infer<typeof GenerateComparisonGrid4OutputSchema>> {
    if (input.resolvedTools.length !== 4) {
      return { ...input, comparisonGrid4Generated: null };
    }

    const [
      { comparisonGrid4Bounds, comparisonGrid4LlmResponseSchema, transformLlmResponse },
      { buildConstraintBlock },
    ] = await Promise.all([
      import("../../../../social/src/compositions/comparison-grid-4/types.ts") as Promise<
        typeof import("../../../../social/src/compositions/comparison-grid-4/types.ts")
      >,
      import("../../../../social/src/templates/lib/buildConstraintBlock.ts") as Promise<
        typeof import("../../../../social/src/templates/lib/buildConstraintBlock.ts")
      >,
    ]);

    const localePrefix = ((input.locales[0] ?? "de-DE").split("-")[0] ?? "de") as "de" | "en";
    const isDE = localePrefix !== "en";

    // Query frontmatterExtras to get per-tool scores + prices (not in resolvedTools)
    const [article] = await db
      .select({ frontmatterExtras: articles.frontmatterExtras })
      .from(articles)
      .where(and(eq(articles.id, input.articleId), eq(articles.projectId, input.projectId)))
      .limit(1);

    type RawTool = { slug?: string; score?: number; pricingTier?: string; priceFrom?: number };
    const rawToolMap: Record<string, RawTool> = {};
    const extras = (article?.frontmatterExtras ?? {}) as { tools?: RawTool[] };
    for (const t of extras.tools ?? []) {
      if (t.slug) rawToolMap[t.slug] = t;
    }

    const month = String(new Date().getMonth() + 1).padStart(2, "0");
    const year = new Date().getFullYear();

    const toolsContext = input.resolvedTools
      .map((t) => {
        const raw = rawToolMap[t.slug] ?? {};
        const score = raw.score ?? 70;
        const priceStr =
          raw.pricingTier === "free"
            ? (isDE ? "Kostenlos" : "Free")
            : raw.priceFrom != null
              ? (isDE ? `Ab ${raw.priceFrom} $/Mo` : `From $${raw.priceFrom}/mo`)
              : (isDE ? "Preis auf Anfrage" : "Contact for pricing");
        return `- ${t.name} (slug: ${t.slug}, score: ${score}, price: ${priceStr})`;
      })
      .join("\n");

    const constraintBlock = buildConstraintBlock(comparisonGrid4Bounds, localePrefix, {
      fields: ["eyebrow", "heroTitle", "heroSub", "tools", "footer"],
    });

    const ctaDefault = isDE ? "Vollständiger Test →" : "Full review →";
    const winnerFlagDefault = isDE ? "Testsieger" : "Top pick";
    const outputLocale = isDE ? "German (de), du-form" : "English (en)";
    const slug = input.articleSlug;

    const prompt = `You are an editor for toolwiki.ai. Create content for a comparison-grid-4 Instagram slide.
Output locale: ${outputLocale}

Article context:
- Title: ${input.articleTitle}
- Slug: ${slug}
- Tools (with scores and prices):
${toolsContext}

Format requirements (strictly follow):
${constraintBlock}

Output: Exactly one valid JSON object, no markdown, no explanation.

${isDE ? `{
  "headline": "<main title in German, max 44 chars>",
  "headline_em": "<highlighted keyword in German, max 22 chars>",
  "subline": "<description in German, 60–180 chars>",
  "eyebrow": "<e.g. 'Vergleich · 4 KI-Tools', max 32 chars>",
  "slide_num": "01 / 01",
  "cta_line1": "${ctaDefault}",
  "cta_line2": "toolwiki.ai/${slug}",
  "date_label": "Stand ${month}/${year} · toolwiki.ai/${slug}",
  "tools": [
    {
      "name": "<tool name, max 16 chars>",
      "verdict_strong": "<bold start of German verdict, max 44 chars>",
      "verdict_rest": "<rest of German verdict, max 52 chars>",
      "score": <number from context>,
      "price_label": "<price label in German, max 22 chars>",
      "logo_slug": "<slug from context>",
      "is_winner": <true for highest score, else false>,
      "winner_flag_text": "${winnerFlagDefault}"
    }
  ]
}` : `{
  "headline": "<main title in English, max 44 chars>",
  "headline_em": "<highlighted keyword in English, max 22 chars>",
  "subline": "<description in English, 60–180 chars>",
  "eyebrow": "<e.g. 'Comparison · 4 AI Tools', max 32 chars>",
  "slide_num": "01 / 01",
  "cta_line1": "${ctaDefault}",
  "cta_line2": "toolwiki.ai/${slug}",
  "date_label": "As of ${month}/${year} · toolwiki.ai/${slug}",
  "tools": [
    {
      "name": "<tool name, max 16 chars>",
      "verdict_strong": "<bold start of English verdict, max 44 chars>",
      "verdict_rest": "<rest of English verdict, max 52 chars>",
      "score": <number from context>,
      "price_label": "<price label in English, max 22 chars>",
      "logo_slug": "<slug from context>",
      "is_winner": <true for highest score, else false>,
      "winner_flag_text": "${winnerFlagDefault}"
    }
  ]
}`}`;

    const tryGenerate = async () => {
      const response = await anthropic.messages({
        projectId: ctx.projectId,
        pipelineRunId: ctx.pipelineRunId,
        operation: COST_OPS.SOCIAL_IMAGE_GRID4_GENERATE,
        model: "claude-sonnet-4-6",
        systemPrefix: "",
        // Spec 62.0a Section 4.4: edit-prompt resume override.
        systemSuffix: resolvePrompt(
          ctx,
          this.name,
          () => JSON_ONLY_SUFFIX
        ),
        userMessage: prompt,
        maxTokens: 1200,
        estimatedCostEur: 0.028,
      });
      const raw = response.raw;
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("No JSON found in LLM response");
      return comparisonGrid4LlmResponseSchema.parse(JSON.parse(raw.slice(start, end + 1)));
    };

    let llmResponse: z.infer<typeof comparisonGrid4LlmResponseSchema> | null = null;
    try {
      llmResponse = await tryGenerate();
    } catch (err) {
      ctx.log.warn({ err: String(err) }, "GenerateComparisonGrid4Step: first attempt failed, retrying");
      try {
        llmResponse = await tryGenerate();
      } catch (err2) {
        ctx.log.error({ err: String(err2) }, "GenerateComparisonGrid4Step: both attempts failed, falling back to null");
      }
    }

    if (!llmResponse) {
      return { ...input, comparisonGrid4Generated: null };
    }

    const transformed = transformLlmResponse(llmResponse);

    // Merge icon data from resolvedTools using the logo_slug returned by LLM
    const toolsWithIcons = transformed.tools.map((t, i) => {
      const logoSlug = llmResponse.tools[i]?.logo_slug ?? "";
      const resolved = input.resolvedTools.find(
        (r) => (r as { slug: string }).slug === logoSlug,
      ) as Record<string, unknown> | undefined;
      return {
        ...t,
        ...(resolved?.iconSvg !== undefined && { iconSvg: resolved.iconSvg as string }),
        ...(resolved?.iconInitials !== undefined && { iconInitials: resolved.iconInitials as string }),
        ...(resolved?.iconHue !== undefined && { iconHue: resolved.iconHue as number }),
      };
    });

    ctx.log.info({ locale: localePrefix, toolCount: toolsWithIcons.length }, "GenerateComparisonGrid4Step: content generated");

    return { ...input, comparisonGrid4Generated: { ...transformed, tools: toolsWithIcons } };
  }
}

// ─── Step 5: GenerateCaptionStep ─────────────────────────────────────────────
// Runs before rendering — caption doesn't depend on slide images.

const GenerateCaptionInputSchema = GenerateComparisonGrid4OutputSchema;

const perLocaleOutputSchema = z.object({
  locale: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});

const GenerateCaptionOutputSchema = GenerateCaptionInputSchema.extend({
  perLocaleOutputs: z.array(perLocaleOutputSchema).min(1),
  // Spec 60.6: explicit template key override from pipeline input; null = auto-route (default)
  templateKeyOverride: z.string().nullable().optional(),
});

const captionJsonSchema = z.object({
  caption: z.string().min(20).max(2200),
  hashtags: z.array(
    // Unicode-aware: allows ä/ö/ü/etc. but blocks hyphens and spaces
    z.string().regex(/^#[^\s\-#]+$/u, "Hashtag must start with # with no hyphens or spaces"),
  ).min(5).max(10),
});

const HASHTAG_FALLBACK = [
  "#KITools", "#AITools", "#Produktivität",
  "#DigitalTools", "#KünstlicheIntelligenz", "#TechReview", "#SoftwareTest",
];

export class GenerateCaptionStep extends BaseStep<
  z.infer<typeof GenerateCaptionInputSchema>,
  z.infer<typeof GenerateCaptionOutputSchema>
> {
  readonly name = "generate-caption";
  readonly inputSchema = GenerateCaptionInputSchema;
  readonly outputSchema = GenerateCaptionOutputSchema;

  // Cost scales with locale count; pipeline registers base estimate per step
  override estimatedCostEur(): number { return 0.028; }

  async execute(input: z.infer<typeof GenerateCaptionInputSchema>, ctx: StepContext): Promise<z.infer<typeof GenerateCaptionOutputSchema>> {
    const brandVoice = (input.brandTokens as { voice?: { signaturePhrases?: string[]; addressForm?: string } })?.voice;
    const deSignaturePhrases = brandVoice?.signaturePhrases?.join(", ") ?? "redaktionell verifiziert, ehrlich";
    const deAddressForm = brandVoice?.addressForm ?? "du";
    const contentType = deriveContentType(input.intentType);
    const toolNames = input.resolvedTools.map((t) => t.name);

    const tryGenerate = async (locale: string): Promise<z.infer<typeof captionJsonSchema>> => {
      const isDeLocale = locale.startsWith("de");
      const captionLang = isDeLocale ? "GERMAN" : "ENGLISH";
      const localePrefix = (locale.split("-")[0] ?? "de").split("_")[0] ?? "de";
      const localeSibling = input.localeArticles?.[localePrefix];
      const captionUrl = localeSibling?.articleUrl ?? input.articleUrl;
      const captionTitle = localeSibling?.title ?? input.articleTitle;
      const hashtagSection = buildHashtagInstructions({ locale, contentType, toolNames });
      // Brand voice is defined in German — adapt for non-DE locales so the model stays in English
      const signaturePhrases = isDeLocale ? deSignaturePhrases : "editorially verified, honest, no hype";
      const addressForm = isDeLocale ? deAddressForm : "you";

      const prompt = `Write an Instagram post in ${captionLang} for a carousel about: "${captionTitle}"

The post shows ${input.resolvedTools.length} AI tools in a visual list-carousel format.
Brand voice: ${signaturePhrases}. Use "${addressForm}" form. Max 300 characters in caption. Use 1-2 fitting emojis.
End caption with: Link in Bio → ${captionUrl}

${hashtagSection}

Respond with ONLY a valid JSON object — no markdown, no explanation:
{"caption":"<the caption text>","hashtags":["#Tag1","#Tag2",...]}`;

      // jsonMode not used: claude-sonnet-4-6 rejects assistant prefill (400).
      // JSON extraction is done manually below from raw response text.
      const response = await anthropic.messages({
        projectId: ctx.projectId,
        pipelineRunId: ctx.pipelineRunId,
        operation: COST_OPS.SOCIAL_IMAGE_CAPTION,
        model: "claude-sonnet-4-6",
        systemPrefix: "",
        // Spec 62.0a Section 4.4: edit-prompt resume override.
        systemSuffix: resolvePrompt(
          ctx,
          this.name,
          () => JSON_ONLY_SUFFIX
        ),
        userMessage: prompt,
        maxTokens: 600,
        estimatedCostEur: 0.028,
      });

      const raw = response.raw;
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const clean = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      return captionJsonSchema.parse(JSON.parse(clean));
    };

    const perLocaleOutputs: Array<z.infer<typeof perLocaleOutputSchema>> = [];

    for (const locale of input.locales) {
      // Retry once on parse/validation failure; fall back to safe defaults on second failure.
      let parsed: z.infer<typeof captionJsonSchema> | null = null;
      try {
        parsed = await tryGenerate(locale);
      } catch (err) {
        ctx.log.warn({ err: String(err), locale }, "GenerateCaptionStep: first attempt failed, retrying");
        try {
          parsed = await tryGenerate(locale);
        } catch (err2) {
          ctx.log.error({ err: String(err2), locale }, "GenerateCaptionStep: second attempt failed, using fallback");
        }
      }

      if (parsed) {
        perLocaleOutputs.push({ locale, caption: parsed.caption, hashtags: parsed.hashtags });
      } else {
        perLocaleOutputs.push({
          locale,
          caption: `${input.articleTitle} → ${input.articleUrl}`,
          hashtags: HASHTAG_FALLBACK,
          warnings: ["hashtag_generation_fallback"],
        });
      }
    }

    return { ...input, perLocaleOutputs };
  }
}

// ─── Step 5: RenderSlidesStep (enqueue async Remotion render) ────────────────
// Inserts one social_post row per locale with caption/hashtags, then enqueues
// a BullMQ render job. The worker (social-render.worker.ts) uploads slides to
// R2 and updates renderStatus → rendered + content.slides.

const RenderSlidesInputSchema = GenerateCaptionOutputSchema;

const socialPostResultSchema = z.object({
  socialPostId: z.string().uuid(),
  locale: z.string(),
  renderJobId: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

const RenderSlidesOutputSchema = z.object({
  socialPosts: z.array(socialPostResultSchema).min(1),
});

export class RenderSlidesStep extends BaseStep<
  z.infer<typeof RenderSlidesInputSchema>,
  z.infer<typeof RenderSlidesOutputSchema>
> {
  readonly name = "render-slides";
  readonly inputSchema = RenderSlidesInputSchema;
  readonly outputSchema = RenderSlidesOutputSchema;

  override estimatedCostEur(): number { return 0.002; }

  async execute(input: z.infer<typeof RenderSlidesInputSchema>, ctx: StepContext): Promise<z.infer<typeof RenderSlidesOutputSchema>> {
    // Spec 60.6: respect explicit templateKey from pipeline input; fall back to tool-count routing
    const templateKey = (input.templateKeyOverride ?? null) ??
      (input.resolvedTools.length === 3 ? "comparison-grid-3" : "comparison-grid-4");

    // Resolve project-scoped overrides (falls through to schema defaults if no row exists)
    const { getOverrideSchema, mergeOverrides, isOverrideTemplateKey } = await import("../../../../social/src/templates/overrides/index.ts") as typeof import("../../../../social/src/templates/overrides/index.ts");
    const overrideRow = await fetchTemplateOverrides(input.projectId, templateKey);
    const resolvedOverrides = isOverrideTemplateKey(templateKey)
      ? mergeOverrides(getOverrideSchema(templateKey), overrideRow?.values)
      : (overrideRow?.values ?? {});

    // Fire-and-forget: mark last_used_at (approximate — only writes when older than 1h)
    if (overrideRow) {
      markTemplateOverrideUsed(input.projectId, templateKey).catch((err: unknown) => {
        ctx.log.warn({ err, projectId: input.projectId, templateKey }, "markTemplateOverrideUsed failed");
      });
    }

    const results: Array<z.infer<typeof socialPostResultSchema>> = [];
    const isGrid4 = templateKey === "comparison-grid-4" && input.comparisonGrid4Generated != null;

    for (const loc of input.perLocaleOutputs) {
      const localePrefix = (loc.locale.split("-")[0] ?? "de").split("_")[0] ?? "de";
      const localeSibling = input.localeArticles?.[localePrefix];
      const isDeLocale = loc.locale.startsWith("de");
      const localeTitle = localeSibling?.title ?? input.articleTitle;

      // ─── comparison-grid-4: snapshot is ComparisonGrid4Input-shaped (Spec 60.2) ─
      // The worker reads this snapshot directly and passes it to renderComparisonGrid4().
      // List-carousel fields (coverEyebrow, resolvedTools, etc.) are not stored or needed.
      if (isGrid4) {
        const renderInput: Record<string, unknown> = {
          slideIndex: 0,
          locale: localePrefix === "en" ? "en" : "de",
          theme: input.theme,
          generated: input.comparisonGrid4Generated,
        };

        const [post] = await db
          .insert(socialPosts)
          .values({
            projectId: input.projectId,
            articleId: input.articleId,
            platform: "instagram",
            format: "carousel",
            status: "draft",
            theme: input.theme,
            locale: loc.locale,
            templateKey,
            totalSlides: 0,
            content: {
              kind: "carousel",
              slides: [],
              caption: loc.caption,
              hashtags: loc.hashtags,
              // comparison-grid-4 renderInput is ComparisonGrid4Input-shaped; JSONB column accepts any shape.
              // biome-ignore lint/suspicious/noExplicitAny: intentional shape mismatch — worker reads as Record<string, unknown>
              renderInput: renderInput as unknown as SocialPostRenderInput,
              ...(loc.warnings ? { warnings: loc.warnings } : {}),
            },
            renderStatus: "pending",
            generatedAt: new Date(),
          })
          .returning({ id: socialPosts.id });

        if (!post) throw new Error(`Failed to insert social post for locale ${loc.locale}`);

        // Worker reads renderInput from DB snapshot for grid-4; job data fields beyond these are unused.
        const jobData: SocialRenderJobData = {
          socialPostId: post.id,
          projectId: input.projectId,
          articleId: input.articleId,
          brandTokens: input.brandTokens,
          overrides: resolvedOverrides,
          templateKey,
          locale: loc.locale,
          theme: input.theme,
          variant: input.variant,
          articleTitle: localeTitle,
          articleSlug: localeSibling?.slug ?? input.articleSlug,
          projectSlug: input.projectSlug,
          articleUrl: localeSibling?.articleUrl ?? input.articleUrl,
          // List-carousel fields unused by comparison-grid-4 worker path — worker reads DB snapshot
          resolvedTools: [],
          coverEyebrow: "",
          coverHeadlineLead: "",
          coverHeadlineHighlight: "",
          endHeadline: "",
          endHeadlineHighlight: "",
        };

        const renderJobId = await enqueueSocialRenderJob(jobData);
        ctx.log.info({ socialPostId: post.id, renderJobId, locale: loc.locale, templateKey }, "Social post created + render job enqueued");
        results.push({ socialPostId: post.id, locale: loc.locale, renderJobId, caption: loc.caption, hashtags: loc.hashtags });
        continue;
      }

      // ─── All other templates: list-carousel renderInput ──────────────────────

      // For non-DE locales: use EN-specific extraction results when available.
      const localeData = !isDeLocale ? input.localeToolsData?.[localePrefix] : undefined;

      const localeCoverEyebrow = isDeLocale
        ? input.coverEyebrow
        : (localeData?.coverEyebrow ?? (localeTitle.split(":")[0] ?? localeTitle).toUpperCase().slice(0, 40).trim());
      const localeCoverHeadlineLead = isDeLocale
        ? input.coverHeadlineLead
        : (localeData?.coverHeadlineLead ?? `The ${input.resolvedTools.length} Best`);
      const localeCoverHeadlineHighlight = isDeLocale
        ? input.coverHeadlineHighlight
        : (localeData?.coverHeadlineHighlight ?? input.coverHeadlineHighlight);
      const localeCoverHeadlineTrail = isDeLocale
        ? input.coverHeadlineTrail
        : (localeData?.coverHeadlineTrail ?? (input.coverHeadlineTrail !== undefined ? "Compared" : undefined));
      const localeCoverSubhead = isDeLocale
        ? input.coverSubhead
        : (localeData?.coverSubhead ?? undefined);
      const localeEndHeadline = isDeLocale
        ? input.endHeadline
        : (localeData?.endHeadline ?? input.endHeadline);
      const localeEndHeadlineHighlight = isDeLocale
        ? input.endHeadlineHighlight
        : (localeData?.endHeadlineHighlight ?? input.endHeadlineHighlight);

      const resolvedToolsForLocale: Array<Record<string, unknown>> = localeData
        ? localeData.tools.map((enTool) => {
            const deTool = input.resolvedTools.find((dt) => (dt as { slug: string }).slug === enTool.slug);
            return {
              slug: enTool.slug,
              rank: enTool.rank,
              name: enTool.name,
              domain: enTool.domain,
              eyebrow: (deTool as { eyebrow?: string } | undefined)?.eyebrow ?? enTool.slug.toUpperCase(),
              tagline: enTool.tagline,
              strengths: enTool.strengths,
              pricing: enTool.pricing,
              ...(enTool.bestFor !== undefined && { bestFor: enTool.bestFor }),
              ...(enTool.keyDifferentiator !== undefined && { keyDifferentiator: enTool.keyDifferentiator }),
              ...(enTool.starStrength !== undefined && { starStrength: enTool.starStrength }),
              ...(enTool.identityVerb !== undefined && { identityVerb: enTool.identityVerb }),
              ...((deTool as { iconSvg?: string } | undefined)?.iconSvg !== undefined && { iconSvg: (deTool as { iconSvg: string }).iconSvg }),
              ...((deTool as { iconInitials?: string } | undefined)?.iconInitials !== undefined && { iconInitials: (deTool as { iconInitials: string }).iconInitials }),
              ...((deTool as { iconHue?: number } | undefined)?.iconHue !== undefined && { iconHue: (deTool as { iconHue: number }).iconHue }),
            };
          })
        : (input.resolvedTools as Array<Record<string, unknown>>);

      // Build renderInput snapshot — persisted in content JSONB so re-render can
      // reconstruct SocialRenderJobData without re-running pipeline steps.
      const renderInput: SocialPostRenderInput = {
        templateKey,
        locale: loc.locale,
        theme: input.theme,
        variant: input.variant,
        articleTitle: localeTitle,
        articleSlug: localeSibling?.slug ?? input.articleSlug,
        projectSlug: input.projectSlug,
        articleUrl: localeSibling?.articleUrl ?? input.articleUrl,
        coverEyebrow: localeCoverEyebrow,
        coverHeadlineLead: localeCoverHeadlineLead,
        coverHeadlineHighlight: localeCoverHeadlineHighlight,
        endHeadline: localeEndHeadline,
        endHeadlineHighlight: localeEndHeadlineHighlight,
        resolvedTools: resolvedToolsForLocale,
        ...(localeCoverHeadlineTrail !== undefined && { coverHeadlineTrail: localeCoverHeadlineTrail }),
        ...(localeCoverSubhead !== undefined && { coverSubhead: localeCoverSubhead }),
        ...(isDeLocale && input.coverHookOutput !== undefined && { coverHookOutput: input.coverHookOutput as Record<string, unknown> }),
        ...(isDeLocale && input.endCloser !== undefined && { endCloser: input.endCloser as Record<string, unknown> }),
      };

      const [post] = await db
        .insert(socialPosts)
        .values({
          projectId: input.projectId,
          articleId: input.articleId,
          platform: "instagram",
          format: "carousel",
          status: "draft",
          theme: input.theme,
          locale: loc.locale,
          templateKey,
          totalSlides: 0,
          content: {
            kind: "carousel",
            slides: [],
            caption: loc.caption,
            hashtags: loc.hashtags,
            renderInput,
            ...(loc.warnings ? { warnings: loc.warnings } : {}),
          },
          renderStatus: "pending",
          generatedAt: new Date(),
        })
        .returning({ id: socialPosts.id });

      if (!post) throw new Error(`Failed to insert social post for locale ${loc.locale}`);

      const jobData: SocialRenderJobData = {
        socialPostId: post.id,
        projectId: input.projectId,
        articleId: input.articleId,
        brandTokens: input.brandTokens,
        overrides: resolvedOverrides,
        ...renderInput,
      };

      const renderJobId = await enqueueSocialRenderJob(jobData);
      ctx.log.info({ socialPostId: post.id, renderJobId, locale: loc.locale }, "Social post created + render job enqueued");
      results.push({ socialPostId: post.id, locale: loc.locale, renderJobId, caption: loc.caption, hashtags: loc.hashtags });
    }

    return { socialPosts: results };
  }
}
