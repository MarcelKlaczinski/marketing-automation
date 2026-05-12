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
import { articles, db, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { Pipeline } from "../../engine/pipeline.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
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
    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are a professional localisation specialist. Your task is to translate article metadata
from ${sourceLang.lang} (${sourceLang.market}) to ${targetLang.lang} (${targetLang.market}).
Adapt all market-specific references naturally — do not translate literally.

Output ONLY these four tagged blocks, nothing else:
<TITLE>translated title</TITLE>
<SLUG>url-slug-in-target-language</SLUG>
<META_DESCRIPTION>translated meta description (max 160 chars)</META_DESCRIPTION>
<KEYWORD>main cornerstone keyword in target language</KEYWORD>
      `.trim(),
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
      systemSuffix: prompt.variableSuffix,
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

    const translateInstructions = `
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
7. Markdown structure: preserve all heading levels (##, ###), list structure, bold/italic.

## Output format
Return EXACTLY these tagged blocks in order — nothing else:

<TITLE>article title in ${targetLang.lang}</TITLE>
<SLUG>url-slug-in-${input.targetLocale}</SLUG>
<META_DESCRIPTION>meta description in ${targetLang.lang} (max 160 chars)</META_DESCRIPTION>
<KEYWORD>cornerstone keyword in ${targetLang.lang}</KEYWORD>
${outlineJson ? `<OUTLINE>
translated outline JSON (same structure, translate all string values)
</OUTLINE>` : ""}
<BODY>
full translated article body in Markdown (preserving all MDX/imports)
</BODY>
${extrasJson ? `<EXTRAS>
translated frontmatter extras JSON (same structure, translate string values — keep enum values like intentType, category in English)
</EXTRAS>` : ""}
    `.trim();

    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "copy-editing", "ai-seo"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: translateInstructions,
    });

    const userParts = [
      `## Source metadata`,
      `Title: ${sourceArticle.title ?? ""}`,
      `Slug: ${sourceArticle.slug}`,
      `Meta: ${sourceArticle.metaDescription ?? ""}`,
      `Keyword: ${sourceArticle.cornerstoneKeyword ?? ""}`,
      "",
    ];

    if (outlineJson) {
      userParts.push("## Source outline JSON", outlineJson, "");
    }

    userParts.push("## Source body (Markdown)", sourceArticle.bodyMd, "");

    if (extrasJson) {
      userParts.push("## Source frontmatter extras JSON", extrasJson, "");
    }

    userParts.push("Now translate and adapt everything as instructed.");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.ARTICLE_DRAFT,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userParts.join("\n"),
      maxTokens: 16000,
      estimatedCostEur: this.estimatedCostEur(),
    });

    const raw = result.raw;

    const title = parseBlock(raw, "TITLE") ?? sourceArticle.title ?? "";
    const slug = parseBlock(raw, "SLUG") ?? slugify(title);
    const metaDescription = parseBlock(raw, "META_DESCRIPTION") ?? sourceArticle.metaDescription ?? "";
    const cornerstoneKeyword = parseBlock(raw, "KEYWORD") ?? sourceArticle.cornerstoneKeyword ?? "";

    let outline = sourceArticle.outline;
    const outlineBlock = parseBlock(raw, "OUTLINE");
    if (outlineBlock) {
      try {
        const parsed = JSON.parse(outlineBlock);
        outline = ArticleOutlineSchema.parse(parsed);
      } catch {
        log.warn({ targetArticleId: input.targetArticleId }, "Could not parse translated outline JSON — keeping source");
      }
    }

    const bodyMd = parseBlock(raw, "BODY") ?? sourceArticle.bodyMd;

    let frontmatterExtras: Record<string, unknown> = sourceArticle.frontmatterExtras as Record<string, unknown> ?? {};
    const extrasBlock = parseBlock(raw, "EXTRAS");
    if (extrasBlock) {
      try {
        frontmatterExtras = JSON.parse(extrasBlock) as Record<string, unknown>;
      } catch {
        log.warn({ targetArticleId: input.targetArticleId }, "Could not parse translated extras JSON — keeping source");
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
        // Carry over hero image from source
        heroImageR2Key: sourceArticle.heroImageR2Key,
        heroImagePublicUrl: sourceArticle.heroImagePublicUrl,
        heroImageAltText: sourceArticle.heroImageAltText,
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
  targetLocale: z.enum(["de", "en"]),
  mode: z.enum(["translate", "fresh"]),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
});

type PipelineInput = z.infer<typeof InputSchema>;

export class LocalizeArticlePipeline extends Pipeline<PipelineInput, z.infer<typeof StepOutputSchema>> {
  readonly name = "article:localize";
  readonly inputSchema = InputSchema;
  readonly outputSchema = StepOutputSchema;

  readonly steps = [new LocalizeArticleStep()];
}
