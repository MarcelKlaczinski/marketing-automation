/**
 * article:localize pipeline
 *
 * Creates a localised version of an existing article in a target language.
 *
 * Two modes:
 *   translate — full cultural translation of body + outline + frontmatter extras.
 *               Country/legal/currency references are adapted for the target market,
 *               not translated literally (e.g. "legal in Germany?" → "legal in the US?").
 *   fresh     — translates only the title / keyword / meta to seed the target article;
 *               the user then triggers outline + draft from the new article's action panel.
 *
 * Steps:
 *   1. LocalizeArticleStep — LLM-driven translation + cultural adaptation
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db, eq, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { resolveMasterPrompt } from "../../config/index.ts";

// Lazy chain callbacks (Spec 49d — registered at worker startup to avoid circular dep)
let _advanceChain: ((chainId: string, step: string, runId: string) => Promise<void>) | null = null;

export function registerLocalizeChainCallbacks(callbacks: {
  advanceChain: (chainId: string, step: string, runId: string) => Promise<void>;
}): void {
  _advanceChain = callbacks.advanceChain;
}
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { Pipeline } from "../../engine/pipeline.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";
import { slugify } from "../trigger.ts";

const log = createLogger("pipelines:localize");

// ─── Step ────────────────────────────────────────────────────────────────────

const StepInputSchema = z.object({
  sourceArticleId: z.string().uuid(),
  targetArticleId: z.string().uuid(),
  targetLocale: z.enum(["de", "en"]),
  mode: z.enum(["translate", "fresh"]),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
});

const StepOutputSchema = z.object({
  targetArticleId: z.string().uuid(),
  targetLocale: z.string(),
  wordCount: z.number().optional(),
});

// Locale labels for prompts
const LOCALE_LABELS: Record<string, { lang: string; market: string; currency: string }> = {
  de: { lang: "German", market: "DACH (Germany/Austria/Switzerland)", currency: "EUR (€)" },
  en: { lang: "English", market: "US/UK/international English-speaking market", currency: "USD ($)" },
};

/** Parse a tagged block from LLM output: <TAG>...</TAG> */
function parseBlock(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "i");
  const m = text.match(re);
  if (!m) return null;
  return m[0].replace(new RegExp(`^<${tag}>\\s*`, "i"), "").replace(new RegExp(`\\s*<\\/${tag}>$`, "i"), "").trim();
}

class LocalizeArticleStep extends BaseStep<
  z.infer<typeof StepInputSchema>,
  z.infer<typeof StepOutputSchema>
> {
  readonly name = "localize-article";
  readonly inputSchema = StepInputSchema;
  readonly outputSchema = StepOutputSchema;

  override estimatedCostEur(): number {
    // translate mode: large input + large output (full article body)
    // fresh mode: much smaller — only metadata
    return 1.2;
  }

  async execute(input: z.infer<typeof StepInputSchema>, ctx: StepContext) {
    const [sourceArticle] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.sourceArticleId))
      .limit(1);
    if (!sourceArticle) {
      throw new ArticlePipelineError(`Source article ${input.sourceArticleId} not found`, "localize");
    }

    const [proj] = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!proj) throw new ArticlePipelineError("Project not found", "localize");

    const sourceLang = LOCALE_LABELS[sourceArticle.locale ?? "de"] ?? LOCALE_LABELS["de"]!;
    const targetLang = LOCALE_LABELS[input.targetLocale] ?? LOCALE_LABELS["en"]!;

    if (input.mode === "fresh") {
      return this.handleFreshMode(input, sourceArticle, sourceLang, targetLang, ctx);
    }
    return this.handleTranslateMode(input, sourceArticle, sourceLang, targetLang, ctx);
  }

  // ── Fresh mode: translate only title + keyword + meta ──────────────────────

  private async handleFreshMode(
    input: z.infer<typeof StepInputSchema>,
    sourceArticle: typeof articles.$inferSelect,
    sourceLang: { lang: string; market: string; currency: string },
    targetLang: { lang: string; market: string; currency: string },
    ctx: StepContext
  ) {
    const LOCALIZE_FRESH_DEFAULT_PROMPT = `
You are a professional localisation specialist. Your task is to translate article metadata
from ${sourceLang.lang} (${sourceLang.market}) to ${targetLang.lang} (${targetLang.market}).
Adapt all market-specific references naturally — do not translate literally.

Output ONLY these four tagged blocks, nothing else:
<TITLE>translated title</TITLE>
<SLUG>url-slug-in-target-language</SLUG>
<META_DESCRIPTION>translated meta description (max 160 chars)</META_DESCRIPTION>
<KEYWORD>main cornerstone keyword in target language</KEYWORD>
    `.trim();

    const freshStepInstructions = await resolveMasterPrompt({
      projectId: input.projectId,
      promptKey: "article.localize.fresh",
      fallback: LOCALIZE_FRESH_DEFAULT_PROMPT,
    });

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: freshStepInstructions,
    });

    const userMsg = [
      `Title: ${sourceArticle.title ?? ""}`,
      `Slug: ${sourceArticle.slug}`,
      `Meta description: ${sourceArticle.metaDescription ?? ""}`,
      `Cornerstone keyword: ${sourceArticle.cornerstoneKeyword ?? ""}`,
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.ARTICLE_OUTLINE, // cheapest cost bucket
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
      // Applies to ALL 3 LLM calls in this step (one override per step).
      systemSuffix: resolvePrompt(ctx, this.name, () => prompt.variableSuffix),
      userMessage: userMsg,
      maxTokens: 800,
      estimatedCostEur: 0.05,
    });

    const raw = result.raw;
    const title = parseBlock(raw, "TITLE") ?? sourceArticle.title ?? "";
    const slug = parseBlock(raw, "SLUG") ?? slugify(title);
    const metaDescription = parseBlock(raw, "META_DESCRIPTION") ?? sourceArticle.metaDescription ?? "";
    const cornerstoneKeyword = parseBlock(raw, "KEYWORD") ?? sourceArticle.cornerstoneKeyword ?? "";

    await db
      .update(articles)
      .set({
        title,
        slug,
        metaDescription,
        cornerstoneKeyword,
        locale: input.targetLocale,
        status: "proposed",
        updatedAt: new Date(),
      })
      .where(eq(articles.id, input.targetArticleId));

    log.info(
      { targetArticleId: input.targetArticleId, title, locale: input.targetLocale },
      "Fresh localization stub ready"
    );

    return {
      targetArticleId: input.targetArticleId,
      targetLocale: input.targetLocale,
    };
  }

  // ── Translate mode: full cultural adaptation of body + outline + extras ────
  // Two separate API calls to stay within the 8192 output-token limit:
  //   Call 1 — metadata + body (the content that must never be truncated)
  //   Call 2 — outline JSON + frontmatter extras JSON (structural data, small)

  private async handleTranslateMode(
    input: z.infer<typeof StepInputSchema>,
    sourceArticle: typeof articles.$inferSelect,
    sourceLang: { lang: string; market: string; currency: string },
    targetLang: { lang: string; market: string; currency: string },
    ctx: StepContext
  ) {
    if (!sourceArticle.bodyMd) {
      throw new ArticlePipelineError(
        "Source article has no body — run draft pipeline first or use fresh mode",
        "localize"
      );
    }

    const outlineJson = sourceArticle.outline
      ? JSON.stringify(sourceArticle.outline, null, 2)
      : null;
    const extrasJson = sourceArticle.frontmatterExtras && Object.keys(sourceArticle.frontmatterExtras).length > 0
      ? JSON.stringify(sourceArticle.frontmatterExtras, null, 2)
      : null;

    const culturalRules = `
You are a professional localisation specialist and content strategist.

Translate this article from ${sourceLang.lang} (${sourceLang.market}) to
${targetLang.lang} (${targetLang.market}).

## Cultural adaptation rules (CRITICAL — not a literal translation)
1. Country/region references: adapt to the target market
   - Legal questions: "legal in Germany/nach DSGVO?" → "legal in the US/UK?"
   - Regulatory bodies: BaFin → SEC/FCA, TÜV → relevant target-market equivalent
   - Price/currency: ${sourceLang.currency} amounts → approximate ${targetLang.currency} equivalents
   - Examples and case studies: prefer ones familiar to the target audience
2. FAQ questions: re-phrase for the target market's actual search intent.
   Do NOT just translate — rewrite so they match what ${targetLang.market} users actually ask.
3. Brand/tool mentions: keep exact brand names (ChatGPT, Claude, etc.). Never translate proper nouns.
4. MDX components: keep ALL import statements and component tags exactly as-is.
   <HubCarousel .../>, import statements, etc. must not be altered.
5. Code blocks: do NOT translate. Keep all code exactly as-is.
6. Technical terms: keep in their canonical English form (API, JSON, SSO, OAuth, etc.).
7. Markdown structure: preserve all heading LEVELS (##, ###), list structure, bold/italic.
   Translate ALL heading TEXT — including standardised section names:
   DE→EN: "## Kurzantwort" → "## Quick Answer", "## Fazit" → "## Conclusion"
   EN→DE: "## Quick Answer" → "## Kurzantwort", "## Conclusion" → "## Fazit"
   Never keep a German heading in an EN article or vice versa.
    `.trim();

    // ── Call 1: metadata + body ──────────────────────────────────────────────

    const LOCALIZE_TRANSLATE_DEFAULT_PROMPT = `${culturalRules}

## Output format — return EXACTLY these tagged blocks, nothing else:

<TITLE>article title in ${targetLang.lang}</TITLE>
<SLUG>url-slug-in-${input.targetLocale}</SLUG>
<META_DESCRIPTION>meta description in ${targetLang.lang} (max 160 chars)</META_DESCRIPTION>
<KEYWORD>cornerstone keyword in ${targetLang.lang}</KEYWORD>
<BODY>
full translated article body in Markdown (preserving all MDX/imports)
</BODY>`;

    const translateStepInstructions = await resolveMasterPrompt({
      projectId: input.projectId,
      promptKey: "article.localize.translate",
      fallback: LOCALIZE_TRANSLATE_DEFAULT_PROMPT,
    });

    const bodyPrompt = await buildSystemPrompt({
      skills: ["copywriting", "copy-editing", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: translateStepInstructions,
    });

    const bodyUserMsg = [
      `## Source metadata`,
      `Title: ${sourceArticle.title ?? ""}`,
      `Slug: ${sourceArticle.slug}`,
      `Meta: ${sourceArticle.metaDescription ?? ""}`,
      `Keyword: ${sourceArticle.cornerstoneKeyword ?? ""}`,
      "",
      `## Source body (Markdown)`,
      sourceArticle.bodyMd,
      "",
      "Now translate and culturally adapt the metadata and body as instructed.",
    ].join("\n");

    const bodyResult = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.ARTICLE_DRAFT,
      model: "claude-sonnet-4-6",
      systemPrefix: bodyPrompt.cacheablePrefix,
      systemSuffix: resolvePrompt(ctx, this.name, () => bodyPrompt.variableSuffix),
      userMessage: bodyUserMsg,
      maxTokens: 8000,
      estimatedCostEur: this.estimatedCostEur() * 0.8,
    });

    if (bodyResult.stopReason === "max_tokens") {
      log.error(
        { targetArticleId: input.targetArticleId, rawPreview: bodyResult.raw.slice(0, 300) },
        "Localize body call truncated at max_tokens"
      );
      throw new ArticlePipelineError(
        "Translation truncated at token limit — article body too long. Re-trigger to retry.",
        "localize"
      );
    }

    const raw = bodyResult.raw;
    const title = parseBlock(raw, "TITLE") ?? sourceArticle.title ?? "";
    const slug = parseBlock(raw, "SLUG") ?? slugify(title);
    const metaDescription = parseBlock(raw, "META_DESCRIPTION") ?? sourceArticle.metaDescription ?? "";
    const cornerstoneKeyword = parseBlock(raw, "KEYWORD") ?? sourceArticle.cornerstoneKeyword ?? "";

    // BODY is required — if missing, the LLM skipped it or response was malformed
    const bodyMd = parseBlock(raw, "BODY");
    if (!bodyMd) {
      log.error(
        { targetArticleId: input.targetArticleId, rawPreview: raw.slice(0, 500) },
        "Localize response missing <BODY> block — translation failed silently"
      );
      throw new ArticlePipelineError(
        "Translation failed: LLM response did not contain <BODY> block. Re-trigger to retry.",
        "localize"
      );
    }

    // ── Call 2: outline + frontmatter extras (JSON only, small output) ──────
    let outline = sourceArticle.outline;
    let frontmatterExtras: Record<string, unknown> = (sourceArticle.frontmatterExtras as Record<string, unknown> | null) ?? {};

    if (outlineJson || extrasJson) {
      const structureInstructions = `${culturalRules}

## Task
Translate ONLY the JSON structures below. Keep all JSON keys as-is; translate string values only.
Keep enum values (intentType, category, schemaType, etc.) in English — do not translate them.
Adapt market-specific content in string values the same way as the article body.

## Output format — return EXACTLY these tagged blocks that are provided, nothing else:
${outlineJson ? `<OUTLINE>\ntranslated outline JSON (same structure)\n</OUTLINE>` : ""}
${extrasJson ? `<EXTRAS>\ntranslated frontmatter extras JSON (same structure)\n</EXTRAS>` : ""}`;

      const structurePrompt = await buildSystemPrompt({
        skills: ["copywriting", "ai-seo"],
        projectIdOrSlug: input.projectSlug,
        stepInstructions: structureInstructions,
      });

      const structureUserParts: string[] = [
        `## Translated article title (for context): ${title}`,
        "",
      ];
      if (outlineJson) {
        structureUserParts.push("## Source outline JSON", outlineJson, "");
      }
      if (extrasJson) {
        structureUserParts.push("## Source frontmatter extras JSON", extrasJson, "");
      }
      structureUserParts.push("Translate the JSON structures as instructed.");

      const structureResult = await anthropic.messages({
        projectId: ctx.projectId,
        pipelineRunId: ctx.pipelineRunId,
        operation: COST_OPS.ARTICLE_OUTLINE,
        model: "claude-haiku-4-5",
        systemPrefix: structurePrompt.cacheablePrefix,
        systemSuffix: resolvePrompt(ctx, this.name, () => structurePrompt.variableSuffix),
        userMessage: structureUserParts.join("\n"),
        maxTokens: 4000,
        estimatedCostEur: this.estimatedCostEur() * 0.2,
      });

      const raw2 = structureResult.raw;

      if (outlineJson) {
        const outlineBlock = parseBlock(raw2, "OUTLINE");
        if (outlineBlock) {
          try {
            const parsed = JSON.parse(outlineBlock);
            outline = ArticleOutlineSchema.parse(parsed);
          } catch {
            log.warn({ targetArticleId: input.targetArticleId }, "Could not parse translated outline JSON — keeping source");
          }
        }
      }

      if (extrasJson) {
        const extrasBlock = parseBlock(raw2, "EXTRAS");
        if (extrasBlock) {
          try {
            frontmatterExtras = JSON.parse(extrasBlock) as Record<string, unknown>;
          } catch {
            log.warn({ targetArticleId: input.targetArticleId }, "Could not parse translated extras JSON — keeping source");
          }
        }
      }
    }

    const wordCount = bodyMd.trim().split(/\s+/).length;

    await db
      .update(articles)
      .set({
        title,
        slug,
        metaDescription,
        cornerstoneKeyword,
        locale: input.targetLocale,
        bodyMd,
        wordCount,
        outline,
        frontmatterExtras,
        // Carry over hero image from source; generate locale-appropriate alt text
        // (source alt text is in the source locale and must not be copied verbatim)
        heroImageR2Key: sourceArticle.heroImageR2Key,
        heroImagePublicUrl: sourceArticle.heroImagePublicUrl,
        heroImageAltText: input.targetLocale === "de"
          ? `${title} – Beitragsbild`
          : `${title} — Hero Image`,
        status: "final_review",
        draftPipelineRunId: ctx.pipelineRunId,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, input.targetArticleId));

    log.info(
      {
        targetArticleId: input.targetArticleId,
        locale: input.targetLocale,
        wordCount,
        title,
      },
      "Cultural translation completed and persisted"
    );

    return {
      targetArticleId: input.targetArticleId,
      targetLocale: input.targetLocale,
      wordCount,
    };
  }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const InputSchema = z.object({
  sourceArticleId: z.string().uuid(),
  targetArticleId: z.string().uuid(),
  targetLocale:    z.enum(["de", "en"]),
  mode:            z.enum(["translate", "fresh"]),
  projectId:       z.string().uuid(),
  projectSlug:     z.string(),
  // Spec 49d: chain tracking
  chainId:         z.string().uuid().optional(),
  chainStep:       z.string().optional(),
});

type PipelineInput = z.infer<typeof InputSchema>;

export class LocalizeArticlePipeline extends Pipeline<PipelineInput, z.infer<typeof StepOutputSchema>> {
  readonly name = "article:localize";
  readonly inputSchema = InputSchema;
  readonly outputSchema = StepOutputSchema;

  readonly steps = [new LocalizeArticleStep()];

  /** Spec 49d: if part of a chain, advance to schema-en step. */
  override async afterComplete(
    _output: z.infer<typeof StepOutputSchema>,
    input: PipelineInput,
    runId: string
  ): Promise<void> {
    if (input.chainId && _advanceChain) {
      await _advanceChain(input.chainId, "localize", runId);
    }
  }

  /** Reset target article to 'proposed' so the user can re-trigger without manual DB intervention. */
  override async afterError(_error: unknown, input: PipelineInput): Promise<void> {
    try {
      await db
        .update(articles)
        .set({ status: "proposed", updatedAt: new Date() })
        .where(eq(articles.id, input.targetArticleId));
      log.info({ targetArticleId: input.targetArticleId }, "Localize pipeline failed — target article reset to proposed");
    } catch (e) {
      log.warn({ targetArticleId: input.targetArticleId, err: e }, "Failed to reset target article status in afterError");
    }
  }
}
