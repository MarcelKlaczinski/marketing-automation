/**
 * Spec 65.7 — `comparison-grid-3` MULTI-SLIDE carousel template (REPLACES single-still).
 *
 * 7-slide anatomy: Cover → Compare-Header → 3 Tools → Verdict → End.
 *
 * Data sourcing:
 *   - Tool slugs + ranking come from `articles.domainExtras.tools[]` (set during
 *     Astro import or 65.5 brief-generator handoff).
 *   - Brand-color + icon resolution via `buildToolLookup()` (lobe-icons →
 *     simple-icons → iconify → avatar chain + `tool_brand_assets` cache).
 *   - LLM-generated cover headline + verdict reasoning via `generateContent()`
 *     using the `_grid3Extra` extension pattern (Spec 60.1 convention).
 *   - Static fallbacks for cover/verdict text when LLM data is absent — every
 *     render path produces a valid slide.
 */
import { z } from "zod";
import type { ContentBounds, GeneratedContent, TemplateDefinition } from "../types.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import type { ToolReference } from "../adapters/types.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { validateAndReprompt } from "../validateGenerated.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { COMPARISON_GRID_3_FIXTURES } from "./fixtures/comparisonGrid3.fixtures.ts";
import {
  buildFallbackCons,
  buildFallbackPros,
  buildPriceComponents,
  localeCopy,
  resolveArticleUrl,
} from "../../compositions/_shared/family-a/helpers.ts";
import {
  scoreTier as deriveScoreTier,
  type FamilyATool,
} from "../../compositions/_shared/family-a/types.ts";
import {
  comparisonGrid3Bounds as compositionBounds,
  comparisonGrid3GeneratedSchema,
  type ComparisonGrid3Generated,
  type ComparisonGrid3Input,
} from "../../compositions/comparison-grid-3/types.ts";

// ─── Grid3Context — buildInput → render contract ──────────────────────────────

export interface Grid3RawTool {
  slug: string;
  name?: string;
  score?: number;
  meta?: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  priceFrom?: number;
  isWinner?: boolean;
  winnerFlagText?: string;
  pros?: [string, string];
  cons?: [string, string];
}

export interface Grid3Context {
  /** Pre-resolved tools (icons + brand colors merged in). */
  tools: FamilyATool[];
  /** Winner slug (one of tools[].slug). When absent, ranking defaults to score-desc. */
  winner?: string;
  /** Cover category descriptor — e.g. "KI-Bild-Generatoren". */
  category?: string;
}

// ─── Bounds (re-exported for definition + REMOTION.md drift test) ─────────────

export const comparisonGrid3Bounds: ContentBounds = compositionBounds as ContentBounds;
export const comparisonGrid3DefinitionBounds: ContentBounds = compositionBounds as ContentBounds;

export { comparisonGrid3GeneratedSchema };
export type { ComparisonGrid3Generated };

// ─── LLM schema (snake_case → camelCase via validateAndReprompt) ──────────────

const grid3LlmResponseSchema = z.object({
  cover: z.object({
    headline_lead: z.string().min(4).max(28),
    headline_em: z.string().min(4).max(32),
    subline: z.string().min(40).max(160),
  }),
  compare_header: z.object({
    title: z.string().min(10).max(72),
    criteria: z.array(z.string().min(4).max(40)).min(2).max(5),
  }),
  verdict: z.object({
    winner_slug: z.string().min(1),
    reasoning: z.string().min(40).max(220),
  }),
  end: z.object({
    headline_lead: z.string().min(4).max(28),
    headline_em: z.string().min(4).max(32),
  }),
  hook_text: z.string().min(20).max(200),
  caption: z.string().min(20).max(1800),
  hashtags: z.array(z.string().regex(/^#[^\s\-#]+$/u)).min(5).max(10),
});

type Grid3LlmResponse = z.infer<typeof grid3LlmResponseSchema>;

interface Grid3Extra {
  cover: { headlineLead: string; headlineEm: string; subline: string };
  compareHeader: { title: string; criteria: string[] };
  verdict: { winnerSlug: string; reasoning: string };
  end: { headlineLead: string; headlineEm: string };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});
const SLIDE_W = 1080;
const SLIDE_H = 1350;
const SLIDE_TOTAL = 7;

// ─── Fallback builders (LLM-failure path) ─────────────────────────────────────

function buildFallbackExtra(ctx: Grid3Context, locale: "de" | "en"): Grid3Extra {
  const copy = localeCopy(locale);
  const cat = ctx.category ?? (locale === "de" ? "KI-Tools" : "AI tools");
  const winnerSlug = ctx.winner ?? ctx.tools[0]?.slug ?? "";
  const winnerName = ctx.tools.find((t) => t.slug === winnerSlug)?.name ?? cat;
  return {
    cover: {
      headlineLead: locale === "de" ? `Die ${ctx.tools.length} besten` : `The top ${ctx.tools.length}`,
      headlineEm: cat,
      subline:
        locale === "de"
          ? `${ctx.tools.length} Tools im Direktvergleich — Pros, Cons, Pricing und Sieger pro Use-Case.`
          : `${ctx.tools.length} tools compared head-to-head — pros, cons, pricing and winners per use case.`,
    },
    compareHeader: {
      title: locale === "de"
        ? `${cat}: Was wir vergleichen.`
        : `${cat}: what we compare.`,
      criteria: locale === "de"
        ? ["Ergebnis-Qualität", "Pricing & Limits", "Workflow-Fit"]
        : ["Output quality", "Pricing & limits", "Workflow fit"],
    },
    verdict: {
      winnerSlug,
      reasoning: locale === "de"
        ? `${copy.bestFor} ${cat}: ${winnerName} — die runde Mischung aus Ergebnis-Qualität und Pricing.`
        : `${copy.bestFor} ${cat}: ${winnerName} — the balanced mix of output quality and pricing.`,
    },
    end: {
      headlineLead: copy.moreReviews,
      headlineEm: copy.honestlyTested,
    },
  };
}

function fallbackCaption(
  tools: FamilyATool[],
  locale: "de" | "en",
  articleUrl: string,
): string {
  const names = tools.map((t) => t.name).join(" vs. ");
  if (locale === "de") {
    return `${names}: Drei Tools, ein ehrliches Fazit — welches passt zu deinem Workflow?\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ ${articleUrl}`;
  }
  return `${names}: Three tools, one honest verdict — which fits your workflow?\n\nSave this post for your next tool decision.\n\n→ ${articleUrl}`;
}

function fallbackHashtags(locale: "de" | "en"): string[] {
  if (locale === "de") {
    return [
      "#KITools",
      "#AITools",
      "#KIVergleich",
      "#AIComparison",
      "#KIFürBusiness",
      "#AIForBusiness",
      "#SoftwareTest",
    ];
  }
  return [
    "#AITools",
    "#AIComparison",
    "#AIForBusiness",
    "#SoftwareReview",
    "#Productivity",
    "#DigitalTools",
    "#TechTools",
  ];
}

function buildFallbackGeneratedContent(
  ctx: Grid3Context,
  locale: "de" | "en",
  slug: string,
): GeneratedContent {
  const extra = buildFallbackExtra(ctx, locale);
  return {
    hookOutput: {
      text: locale === "de" ? "3 Tools, 1 ehrliches Fazit." : "3 tools, 1 honest verdict.",
      pattern: "negative_frame" as const,
    },
    // LLM-fallback path: brandTokens not available inside generateContent(), so
    // emit the V1 single-tenant URL. The render() fallback below uses
    // resolveArticleUrl() for multi-tenant safety. Matches single-tool-spotlight
    // convention.
    caption: fallbackCaption(ctx.tools, locale, `toolwiki.ai/${slug}`),
    hashtags: fallbackHashtags(locale),
    _grid3Extra: extra,
  } as unknown as GeneratedContent;
}

// ─── Render-input assembly ────────────────────────────────────────────────────

function buildCompositionInput(
  ctx: Grid3Context,
  extra: Grid3Extra,
  articleSlug: string,
  locale: "de" | "en",
  theme: "dark" | "light",
  brandTokens: unknown,
): ComparisonGrid3Input {
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const year = new Date().getFullYear();
  const copy = localeCopy(locale);
  const articleUrl = resolveArticleUrl(brandTokens, articleSlug).slice(0, 48);

  const tools = ctx.tools.slice(0, 3).map((t): FamilyATool => {
    const { pricePrefix, priceAmount } = buildPriceComponents(t, locale);
    return {
      ...t,
      pricePrefix,
      priceAmount,
      isWinner: t.isWinner ?? (ctx.winner !== undefined && ctx.winner === t.slug),
      pros: t.pros ?? buildFallbackPros(t.meta, locale),
      cons: t.cons ?? buildFallbackCons(locale),
    };
  });

  return {
    slideIndex: 0,
    slideTotal: SLIDE_TOTAL,
    theme,
    locale,
    cover: {
      eyebrow: `${locale === "de" ? "Vergleich" : "Comparison"} · ${tools.length} ${
        ctx.category ?? (locale === "de" ? "KI-Tools" : "AI tools")
      }`.slice(0, 36),
      headlineLead: extra.cover.headlineLead,
      headlineEm: extra.cover.headlineEm,
      subline: extra.cover.subline,
      headerNum: `${month}/${year} · ${articleUrl}`.slice(0, 48),
    },
    compareHeader: {
      title: extra.compareHeader.title,
      criteria: extra.compareHeader.criteria,
      ...(ctx.category !== undefined && { categoryBadge: ctx.category.slice(0, 28) }),
    },
    tools,
    verdict: {
      winnerToolSlug: extra.verdict.winnerSlug || tools[0]?.slug || "",
      reasoning: extra.verdict.reasoning,
      eyebrow: copy.verdictEyebrow.slice(0, 32),
      ctaLine: copy.fullReview.slice(0, 28),
    },
    end: {
      headlineLead: extra.end.headlineLead,
      headlineEm: extra.end.headlineEm,
      articleUrl,
      ctaLine: copy.fullReview.slice(0, 28),
    },
    brandTokens: brandTokens as Record<string, unknown> | undefined,
  };
}

// ─── Template definition ──────────────────────────────────────────────────────

// ─── Render-snapshot export (Spec 65.7-followup-2) ────────────────────────────
// Public wrapper around the private `buildCompositionInput` + `buildFallbackExtra`
// pair so the social-image pipeline's RenderSlidesStep can pre-build the full
// composition input (including `slideTotal`) as the persisted snapshot.
// Mirrors `comparisonGrid5.ts` / `headToHeadVs.ts` / `headToHeadDeepDive.ts`.
export function buildComparisonGrid3RenderSnapshot(args: {
  ctx: Grid3Context;
  generatedContent: GeneratedContent | undefined;
  articleSlug: string;
  locale: "de" | "en";
  theme: "dark" | "light";
  brandTokens: unknown;
}): { compositionInput: ComparisonGrid3Input; slideTotal: number } {
  const withExtra = args.generatedContent as
    | (GeneratedContent & { _grid3Extra?: Grid3Extra })
    | undefined;
  const extra = withExtra?._grid3Extra ?? buildFallbackExtra(args.ctx, args.locale);
  const compositionInput = buildCompositionInput(
    args.ctx,
    extra,
    args.articleSlug,
    args.locale,
    args.theme,
    args.brandTokens,
  );
  return { compositionInput, slideTotal: SLIDE_TOTAL };
}

export const comparisonGrid3Template: TemplateDefinition<Grid3Context> = {
  key: "comparison-grid-3",
  displayName: "3-Tool-Vergleich (Carousel)",
  description:
    "7-Slide-Karussell für einen 3-Tool-Vergleich: Cover, Vergleichskriterien, drei Tool-Karten, Sieger-Fazit, End-CTA.",
  defaultSlideCount: SLIDE_TOTAL,
  estimatedCostUsd: 0.012, // LLM: cover headline + verdict reasoning + caption + hashtags

  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "comparison",
    estimatedEngagementTier: "high",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  renderServerFn: "renderComparisonGrid3",

  bounds: comparisonGrid3DefinitionBounds,
  generatedSchema: comparisonGrid3GeneratedSchema,
  slotMap: {},

  // ── Eligibility ────────────────────────────────────────────────────────────

  eligibility: (article, _discovery) => {
    if (article.collection !== "comparisons") {
      return { eligible: false, reason: "Nur für comparisons-Collection" };
    }
    const extras = (article.domainExtras ?? {}) as {
      toolSlugs?: string[];
      tools?: Array<{ slug?: string; score?: number }>;
    };
    const toolCount = extras.tools?.length ?? extras.toolSlugs?.length ?? 0;
    if (toolCount < 3) {
      return {
        eligible: false,
        reason: "Benötigt mindestens 3 Tools",
        requirements: ["domainExtras.tools.length >= 3"],
      };
    }
    return { eligible: true };
  },

  // ── generateContent ────────────────────────────────────────────────────────

  generateContent: async (article, input, locale, llmCaller) => {
    const ctx = input as Grid3Context;
    const cat = ctx.category ?? (locale === "de" ? "KI-Tools" : "AI tools");

    const isDE = locale === "de";
    const localeDirective = isDE
      ? "Output language: German (du-Form, B2B-konversationell). Sei prägnant — keine Drama-Phrasen wie 'Kampf um', 'Schlacht', 'Goldrausch'."
      : "Output language: English (concise, direct).";

    const toolBlock = ctx.tools
      .map(
        (t, i) =>
          `  ${i + 1}. ${t.name} (score ${t.score}) — ${t.meta}${
            t.priceFrom != null ? ` — from $${t.priceFrom}/mo` : ""
          }${t.isWinner ? " — WINNER" : ""}`,
      )
      .join("\n");

    const systemPrompt =
      "You write structured JSON for Instagram carousel slides comparing AI tools. " +
      "Return ONLY valid JSON — no markdown fences, no preamble.";

    const userPrompt = `Generate Instagram comparison carousel content for "${article.title ?? article.slug}".

CATEGORY: ${cat}
TOOLS:
${toolBlock}

OUTPUT JSON — exactly these keys:
{
  "cover": {
    "headline_lead": "<lead phrase — e.g. 'Die 3 besten' / 'The top 3'>",
    "headline_em": "<accent phrase — typically the category, e.g. '${cat}'>",
    "subline": "<one-line summary, 40-160 chars>"
  },
  "compare_header": {
    "title": "<one-sentence statement of what's being compared>",
    "criteria": ["<criterion 1>", "<criterion 2>", "<criterion 3>"]
  },
  "verdict": {
    "winner_slug": "<MUST be one of: ${ctx.tools.map((t) => t.slug).join(" | ")}>",
    "reasoning": "<1-2 sentence reasoning why this tool wins, 40-220 chars>"
  },
  "end": {
    "headline_lead": "<closing lead, 4-28 chars>",
    "headline_em": "<closing em phrase, 4-32 chars>"
  },
  "hook_text": "<one Instagram hook sentence>",
  "caption": "<Instagram caption with hook + 2-3 points + CTA, 20-1800 chars>",
  "hashtags": ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"]
}

CONSTRAINTS:
- cover.subline 40-160 chars
- compare_header.criteria 2-5 entries, each 4-40 chars
- verdict.reasoning 40-220 chars
- caption 20-1800 chars
- hashtags 5-10 entries, no hyphens, no year tags
- All German hashtags MUST start with German content keywords (#KITools, etc.)

${localeDirective}`;

    const raw = await llmCaller(systemPrompt, userPrompt);
    if (!raw) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    let parsed: Grid3LlmResponse;
    try {
      const extracted = JSON.parse(raw.slice(start, end + 1)) as unknown;
      parsed = await validateAndReprompt(
        extracted,
        async (hints) => {
          const fixPrompt = `${userPrompt}\n\nFix these validation errors:\n${hints.map((h) => `- ${h}`).join("\n")}`;
          const retryRaw = await llmCaller(systemPrompt, fixPrompt);
          if (!retryRaw) return {};
          const rs = retryRaw.indexOf("{");
          const re = retryRaw.lastIndexOf("}");
          if (rs === -1 || re === -1) return {};
          try {
            return JSON.parse(retryRaw.slice(rs, re + 1)) as unknown;
          } catch {
            return {};
          }
        },
        { schema: grid3LlmResponseSchema, maxReprompts: 1, locale },
      );
    } catch {
      return buildFallbackGeneratedContent(ctx, locale, article.slug);
    }

    // Validate winner slug actually exists in tools[] — otherwise fall back to highest-score tool.
    const validSlugs = new Set(ctx.tools.map((t) => t.slug));
    const safeWinnerSlug = validSlugs.has(parsed.verdict.winner_slug)
      ? parsed.verdict.winner_slug
      : ([...ctx.tools].sort((a, b) => b.score - a.score)[0]?.slug ?? "");

    const extra: Grid3Extra = {
      cover: {
        headlineLead: parsed.cover.headline_lead,
        headlineEm: parsed.cover.headline_em,
        subline: parsed.cover.subline,
      },
      compareHeader: {
        title: parsed.compare_header.title,
        criteria: parsed.compare_header.criteria.slice(0, 5),
      },
      verdict: {
        winnerSlug: safeWinnerSlug,
        reasoning: parsed.verdict.reasoning,
      },
      end: {
        headlineLead: parsed.end.headline_lead,
        headlineEm: parsed.end.headline_em,
      },
    };

    return {
      hookOutput: {
        text: parsed.hook_text.slice(0, 160),
        pattern: "negative_frame" as const,
      },
      caption: parsed.caption.slice(0, 1800),
      hashtags: parsed.hashtags,
      _grid3Extra: extra,
    } as unknown as GeneratedContent;
  },

  // ── buildInput ─────────────────────────────────────────────────────────────

  buildInput: async (article, _discovery) => {
    const extras = (article.domainExtras ?? {}) as {
      toolSlugs?: string[];
      tools?: Grid3RawTool[];
      winner?: string;
      category?: string;
    };
    const rawTools: Grid3RawTool[] = extras.tools ?? [];
    const slugsForLookup = rawTools
      .map((t) => t.slug)
      .filter((s): s is string => typeof s === "string");
    const locale = (article.locale ?? "de") as "de" | "en";
    const toolLookup = await buildToolLookup(slugsForLookup, locale, article.projectId);

    const tools: FamilyATool[] = rawTools.slice(0, 3).map((raw): FamilyATool => {
      const resolved: ToolReference | undefined = toolLookup.get(raw.slug);
      const resolvedExtra = resolved as
        | (ToolReference & {
            primaryColor?: string;
            secondaryColor?: string;
            tertiaryColor?: string;
            primaryCategory?: string;
          })
        | undefined;
      const score = raw.score ?? 70;
      const meta = raw.meta ?? resolvedExtra?.primaryCategory ?? raw.slug;

      const tool: FamilyATool = {
        slug: raw.slug,
        name: (raw.name ?? resolved?.name ?? raw.slug).slice(0, 28),
        score,
        scoreTier: deriveScoreTier(score),
        meta: meta.slice(0, 48),
        // Price components are filled in render-input assembly (locale-aware).
        pricePrefix: "",
        priceAmount: "",
        pros: raw.pros ?? buildFallbackPros(meta, locale),
        cons: raw.cons ?? buildFallbackCons(locale),
        isWinner: raw.isWinner ?? false,
        ...(raw.pricingTier !== undefined && { pricingTier: raw.pricingTier }),
        ...(raw.priceFrom !== undefined && { priceFrom: raw.priceFrom }),
      };

      if (raw.winnerFlagText !== undefined) tool.winnerFlagText = raw.winnerFlagText;
      if (resolved?.iconSvg !== undefined) tool.iconSvg = resolved.iconSvg;
      if (resolved?.iconInitials !== undefined) tool.iconInitials = resolved.iconInitials;
      if (resolved?.iconHue !== undefined) tool.iconHue = resolved.iconHue;
      if (resolvedExtra?.primaryColor !== undefined) tool.primaryColor = resolvedExtra.primaryColor;
      if (resolvedExtra?.secondaryColor !== undefined)
        tool.secondaryColor = resolvedExtra.secondaryColor;
      if (resolvedExtra?.tertiaryColor !== undefined)
        tool.tertiaryColor = resolvedExtra.tertiaryColor;

      return tool;
    });

    const out: Grid3Context = { tools };
    if (extras.winner !== undefined) out.winner = extras.winner;
    if (extras.category !== undefined) out.category = extras.category;
    return out;
  },

  // ── render ─────────────────────────────────────────────────────────────────

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const ctx = input as Grid3Context;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    // Extract LLM-extension data via `_grid3Extra` pattern (Spec 60.1).
    const withExtra = context.generatedContent as
      | (GeneratedContent & { _grid3Extra?: Grid3Extra })
      | undefined;
    const extra = withExtra?._grid3Extra ?? buildFallbackExtra(ctx, locale);

    const compositionInput = buildCompositionInput(ctx, extra, article.slug, locale, theme, brandTokens);

    const socialModule = (await import("../../../render-server.ts")) as unknown as {
      renderComparisonGrid3: (
        input: ComparisonGrid3Input,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderComparisonGrid3(compositionInput);

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "comparison-grid-3",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption:
        context.generatedContent?.caption ??
        fallbackCaption(ctx.tools, locale, resolveArticleUrl(brandTokens, article.slug)),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.012, templateKey: "comparison-grid-3" },
    };
  },

  mockFixtures: COMPARISON_GRID_3_FIXTURES,
};
