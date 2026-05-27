/**
 * Spec 65.7 — `head-to-head-vs` 2-tool carousel template (NEW).
 *
 * 6-slide anatomy: Cover → Tool A → Tool B → Side-by-side → Verdict → End.
 * Tool slides reuse grid-3 components. Side-by-side is unique to head-to-head.
 */
import { z } from "zod";
import type { ContentBounds, GeneratedContent, TemplateDefinition } from "../types.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import type { ToolReference } from "../adapters/types.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { validateAndReprompt } from "../validateGenerated.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { HEAD_TO_HEAD_VS_FIXTURES } from "./fixtures/headToHeadVs.fixtures.ts";
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
  headToHeadVsBounds as compositionBounds,
  headToHeadVsGeneratedSchema,
  type HeadToHeadCompareSlideContent,
  type HeadToHeadVsGenerated,
  type HeadToHeadVsInput,
} from "../../compositions/head-to-head-vs/types.ts";

// ─── Context ──────────────────────────────────────────────────────────────────

export interface HeadToHeadVsRawTool {
  slug: string;
  name?: string;
  score?: number;
  meta?: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  priceFrom?: number;
  pros?: [string, string];
  cons?: [string, string];
}

export interface HeadToHeadVsContext {
  /** Exactly 2 tools. Tool A (index 0) is primary, Tool B (index 1) is challenger. */
  tools: FamilyATool[];
  /** Optional context — comparison angle hint (e.g. "code quality", "free tier limits"). */
  angle?: string;
  /** Winner slug (one of tools[].slug). */
  winner?: string;
}

export const headToHeadVsBounds: ContentBounds = compositionBounds as ContentBounds;
export const headToHeadVsDefinitionBounds: ContentBounds = compositionBounds as ContentBounds;

export { headToHeadVsGeneratedSchema };
export type { HeadToHeadVsGenerated };

// ─── LLM schema ──────────────────────────────────────────────────────────────

const headToHeadVsLlmResponseSchema = z.object({
  cover: z.object({
    headline_lead: z.string().min(4).max(28),
    headline_em: z.string().min(4).max(32),
    subline: z.string().min(40).max(160),
  }),
  compare: z.object({
    criteria: z
      .array(
        z.object({
          label: z.string().min(4).max(28),
          tool_a_verdict: z.string().min(4).max(56),
          tool_b_verdict: z.string().min(4).max(56),
          winner: z.enum(["a", "b", "tie"]),
        }),
      )
      .length(3),
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

type HeadToHeadVsLlmResponse = z.infer<typeof headToHeadVsLlmResponseSchema>;

interface HeadToHeadVsExtra {
  cover: { headlineLead: string; headlineEm: string; subline: string };
  compare: HeadToHeadCompareSlideContent;
  verdict: { winnerSlug: string; reasoning: string };
  end: { headlineLead: string; headlineEm: string };
}

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});
const SLIDE_W = 1080;
const SLIDE_H = 1350;
const SLIDE_TOTAL = 6;

function buildFallbackExtra(ctx: HeadToHeadVsContext, locale: "de" | "en"): HeadToHeadVsExtra {
  const copy = localeCopy(locale);
  const [a, b] = ctx.tools;
  const aName = a?.name ?? "Tool A";
  const bName = b?.name ?? "Tool B";
  const winnerSlug = ctx.winner ?? a?.slug ?? "";
  const winnerName = ctx.tools.find((t) => t.slug === winnerSlug)?.name ?? aName;
  return {
    cover: {
      headlineLead: aName,
      headlineEm: `${copy.versus} ${bName}`,
      subline: locale === "de"
        ? `Welches Tool gewinnt für deinen Use-Case? Direktvergleich mit drei Kriterien und ehrlichem Fazit.`
        : `Which tool wins for your use case? Head-to-head on three criteria with an honest verdict.`,
    },
    compare: {
      criteria: [
        {
          label: locale === "de" ? "Qualität" : "Quality",
          toolAVerdict: aName,
          toolBVerdict: bName,
          winner: ctx.winner === b?.slug ? "b" : "a",
        },
        {
          label: locale === "de" ? "Preis" : "Pricing",
          toolAVerdict: aName,
          toolBVerdict: bName,
          winner: "tie",
        },
        {
          label: locale === "de" ? "Workflow" : "Workflow",
          toolAVerdict: aName,
          toolBVerdict: bName,
          winner: ctx.winner === b?.slug ? "b" : "a",
        },
      ],
    },
    verdict: {
      winnerSlug,
      reasoning: locale === "de"
        ? `${copy.bestFor} den Vergleich: ${winnerName} — die runde Balance aus Qualität, Pricing und Workflow.`
        : `${copy.bestFor} this matchup: ${winnerName} — the balanced mix of quality, pricing, and workflow.`,
    },
    end: {
      headlineLead: copy.moreReviews,
      headlineEm: copy.honestlyTested,
    },
  };
}

function fallbackCaption(tools: FamilyATool[], locale: "de" | "en", articleUrl: string): string {
  const a = tools[0]?.name ?? "Tool A";
  const b = tools[1]?.name ?? "Tool B";
  if (locale === "de") {
    return `${a} vs. ${b}: Welches Tool gewinnt für deinen Use-Case? Ehrlicher Direktvergleich auf drei Kriterien.\n\n→ ${articleUrl}`;
  }
  return `${a} vs. ${b}: Which tool wins for your use case? Honest head-to-head on three criteria.\n\n→ ${articleUrl}`;
}

function fallbackHashtags(locale: "de" | "en"): string[] {
  if (locale === "de") {
    return ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"];
  }
  return ["#AITools", "#AIComparison", "#AIForBusiness", "#SoftwareReview", "#Productivity", "#DigitalTools", "#TechTools"];
}

function buildFallbackGeneratedContent(
  ctx: HeadToHeadVsContext,
  locale: "de" | "en",
  slug: string,
): GeneratedContent {
  const extra = buildFallbackExtra(ctx, locale);
  return {
    hookOutput: {
      text: locale === "de" ? "Welches Tool gewinnt?" : "Which tool wins?",
      pattern: "negative_frame" as const,
    },
    // LLM-fallback path: brandTokens not available inside generateContent(), so
    // emit the V1 single-tenant URL. The render() fallback uses
    // resolveArticleUrl() for multi-tenant safety. Matches single-tool-spotlight.
    caption: fallbackCaption(ctx.tools, locale, `toolwiki.ai/${slug}`),
    hashtags: fallbackHashtags(locale),
    _headToHeadVsExtra: extra,
  } as unknown as GeneratedContent;
}

function buildCompositionInput(
  ctx: HeadToHeadVsContext,
  extra: HeadToHeadVsExtra,
  articleSlug: string,
  locale: "de" | "en",
  theme: "dark" | "light",
  brandTokens: unknown,
): HeadToHeadVsInput {
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const year = new Date().getFullYear();
  const copy = localeCopy(locale);
  const articleUrl = resolveArticleUrl(brandTokens, articleSlug).slice(0, 48);

  const tools = ctx.tools.slice(0, 2).map((t): FamilyATool => {
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

  const [toolA, toolB] = tools;
  if (!toolA || !toolB) throw new Error("head-to-head-vs requires exactly 2 tools");

  return {
    slideIndex: 0,
    slideTotal: SLIDE_TOTAL,
    theme,
    locale,
    cover: {
      eyebrow: locale === "de" ? "Head-to-Head · Direktvergleich" : "Head-to-head · Direct comparison",
      headlineLead: extra.cover.headlineLead,
      headlineEm: extra.cover.headlineEm,
      subline: extra.cover.subline,
      headerNum: `${month}/${year} · ${articleUrl}`.slice(0, 48),
    },
    tools: [toolA, toolB],
    compare: extra.compare,
    verdict: {
      winnerToolSlug: extra.verdict.winnerSlug || toolA.slug,
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

// ─── Render-snapshot export (Spec 65.7-followup-2) ────────────────────────────
// Public wrapper around the private `buildCompositionInput` + `buildFallbackExtra`
// pair so the social-image pipeline's RenderSlidesStep can pre-build the full
// composition input (including `slideTotal`) as the persisted snapshot.
// Mirrors `comparisonGrid3.ts` / `comparisonGrid5.ts` / `headToHeadDeepDive.ts`.
export function buildHeadToHeadVsRenderSnapshot(args: {
  ctx: HeadToHeadVsContext;
  generatedContent: GeneratedContent | undefined;
  articleSlug: string;
  locale: "de" | "en";
  theme: "dark" | "light";
  brandTokens: unknown;
}): { compositionInput: HeadToHeadVsInput; slideTotal: number } {
  const withExtra = args.generatedContent as
    | (GeneratedContent & { _headToHeadVsExtra?: HeadToHeadVsExtra })
    | undefined;
  const extra = withExtra?._headToHeadVsExtra ?? buildFallbackExtra(args.ctx, args.locale);
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

export const headToHeadVsTemplate: TemplateDefinition<HeadToHeadVsContext> = {
  key: "head-to-head-vs",
  displayName: "Head-to-Head (2-Tool)",
  description:
    "6-Slide-Direktvergleich zweier Tools: Cover, beide Tool-Profile, Side-by-Side-Kriterien, Sieger, End-CTA.",
  defaultSlideCount: SLIDE_TOTAL,
  estimatedCostUsd: 0.013,

  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "comparison",
    estimatedEngagementTier: "high",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  renderServerFn: "renderHeadToHeadVs",

  bounds: headToHeadVsDefinitionBounds,
  generatedSchema: headToHeadVsGeneratedSchema,
  slotMap: {},

  eligibility: (article, _discovery) => {
    if (article.collection !== "comparisons") {
      return { eligible: false, reason: "Nur für comparisons-Collection" };
    }
    const extras = (article.domainExtras ?? {}) as {
      toolSlugs?: string[];
      tools?: Array<{ slug?: string }>;
    };
    const toolCount = extras.tools?.length ?? extras.toolSlugs?.length ?? 0;
    if (toolCount !== 2) {
      return {
        eligible: false,
        reason: "Benötigt exakt 2 Tools",
        requirements: ["domainExtras.tools.length === 2"],
      };
    }
    return { eligible: true };
  },

  generateContent: async (article, input, locale, llmCaller) => {
    const ctx = input as HeadToHeadVsContext;
    const [a, b] = ctx.tools;
    if (!a || !b) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    const isDE = locale === "de";
    const localeDirective = isDE
      ? "Output language: German (du-Form, B2B-konversationell). Keine Drama-Phrasen."
      : "Output language: English (concise, direct).";

    const systemPrompt =
      "You write structured JSON for Instagram head-to-head carousel slides comparing 2 AI tools. " +
      "Return ONLY valid JSON — no markdown fences, no preamble.";

    const userPrompt = `Generate Instagram head-to-head carousel content for "${article.title ?? article.slug}".

TOOL A: ${a.name} (score ${a.score}) — ${a.meta}${a.priceFrom != null ? ` — from $${a.priceFrom}/mo` : ""}
TOOL B: ${b.name} (score ${b.score}) — ${b.meta}${b.priceFrom != null ? ` — from $${b.priceFrom}/mo` : ""}
${ctx.angle ? `ANGLE: ${ctx.angle}` : ""}

OUTPUT JSON:
{
  "cover": {
    "headline_lead": "<usually Tool A name>",
    "headline_em": "<'vs. Tool B' or similar accent phrase>",
    "subline": "<1-line summary, 40-160 chars>"
  },
  "compare": {
    "criteria": [
      { "label": "<short criterion>", "tool_a_verdict": "<one-line A verdict>", "tool_b_verdict": "<one-line B verdict>", "winner": "a" | "b" | "tie" },
      { "label": "...", "tool_a_verdict": "...", "tool_b_verdict": "...", "winner": "..." },
      { "label": "...", "tool_a_verdict": "...", "tool_b_verdict": "...", "winner": "..." }
    ]
  },
  "verdict": {
    "winner_slug": "<must be ${a.slug} or ${b.slug}>",
    "reasoning": "<1-2 sentences, 40-220 chars>"
  },
  "end": {
    "headline_lead": "<closing lead, 4-28 chars>",
    "headline_em": "<closing em, 4-32 chars>"
  },
  "hook_text": "<one Instagram hook sentence>",
  "caption": "<Instagram caption, 20-1800 chars>",
  "hashtags": ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"]
}

${localeDirective}`;

    const raw = await llmCaller(systemPrompt, userPrompt);
    if (!raw) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    let parsed: HeadToHeadVsLlmResponse;
    try {
      const extracted = JSON.parse(raw.slice(start, end + 1)) as unknown;
      parsed = await validateAndReprompt(
        extracted,
        async (hints) => {
          const fix = `${userPrompt}\n\nFix:\n${hints.map((h) => `- ${h}`).join("\n")}`;
          const retry = await llmCaller(systemPrompt, fix);
          if (!retry) return {};
          const rs = retry.indexOf("{");
          const re = retry.lastIndexOf("}");
          if (rs === -1 || re === -1) return {};
          try { return JSON.parse(retry.slice(rs, re + 1)) as unknown; } catch { return {}; }
        },
        { schema: headToHeadVsLlmResponseSchema, maxReprompts: 1, locale },
      );
    } catch {
      return buildFallbackGeneratedContent(ctx, locale, article.slug);
    }

    const validSlugs = new Set([a.slug, b.slug]);
    const safeWinnerSlug = validSlugs.has(parsed.verdict.winner_slug)
      ? parsed.verdict.winner_slug
      : a.slug;

    const extra: HeadToHeadVsExtra = {
      cover: {
        headlineLead: parsed.cover.headline_lead,
        headlineEm: parsed.cover.headline_em,
        subline: parsed.cover.subline,
      },
      compare: {
        criteria: parsed.compare.criteria.map((c) => ({
          label: c.label,
          toolAVerdict: c.tool_a_verdict,
          toolBVerdict: c.tool_b_verdict,
          winner: c.winner,
        })) as HeadToHeadCompareSlideContent["criteria"],
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
      _headToHeadVsExtra: extra,
    } as unknown as GeneratedContent;
  },

  buildInput: async (article, _discovery) => {
    const extras = (article.domainExtras ?? {}) as {
      toolSlugs?: string[];
      tools?: HeadToHeadVsRawTool[];
      winner?: string;
      angle?: string;
    };
    const rawTools: HeadToHeadVsRawTool[] = extras.tools ?? [];
    const slugsForLookup = rawTools.map((t) => t.slug).filter((s): s is string => typeof s === "string");
    const locale = (article.locale ?? "de") as "de" | "en";
    const toolLookup = await buildToolLookup(slugsForLookup, locale, article.projectId);

    const tools: FamilyATool[] = rawTools.slice(0, 2).map((raw): FamilyATool => {
      const resolved: ToolReference | undefined = toolLookup.get(raw.slug);
      const resolvedExtra = resolved as
        | (ToolReference & { primaryColor?: string; secondaryColor?: string; tertiaryColor?: string; primaryCategory?: string })
        | undefined;
      const score = raw.score ?? 70;
      const meta = raw.meta ?? resolvedExtra?.primaryCategory ?? raw.slug;
      const tool: FamilyATool = {
        slug: raw.slug,
        name: (raw.name ?? resolved?.name ?? raw.slug).slice(0, 28),
        score,
        scoreTier: deriveScoreTier(score),
        meta: meta.slice(0, 48),
        pricePrefix: "",
        priceAmount: "",
        pros: raw.pros ?? buildFallbackPros(meta, locale),
        cons: raw.cons ?? buildFallbackCons(locale),
        isWinner: false,
        ...(raw.pricingTier !== undefined && { pricingTier: raw.pricingTier }),
        ...(raw.priceFrom !== undefined && { priceFrom: raw.priceFrom }),
      };
      if (resolved?.iconSvg !== undefined) tool.iconSvg = resolved.iconSvg;
      if (resolved?.iconInitials !== undefined) tool.iconInitials = resolved.iconInitials;
      if (resolved?.iconHue !== undefined) tool.iconHue = resolved.iconHue;
      if (resolvedExtra?.primaryColor !== undefined) tool.primaryColor = resolvedExtra.primaryColor;
      if (resolvedExtra?.secondaryColor !== undefined) tool.secondaryColor = resolvedExtra.secondaryColor;
      if (resolvedExtra?.tertiaryColor !== undefined) tool.tertiaryColor = resolvedExtra.tertiaryColor;
      return tool;
    });

    const out: HeadToHeadVsContext = { tools };
    if (extras.winner !== undefined) out.winner = extras.winner;
    if (extras.angle !== undefined) out.angle = extras.angle;
    return out;
  },

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const ctx = input as HeadToHeadVsContext;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const withExtra = context.generatedContent as
      | (GeneratedContent & { _headToHeadVsExtra?: HeadToHeadVsExtra })
      | undefined;
    const extra = withExtra?._headToHeadVsExtra ?? buildFallbackExtra(ctx, locale);

    const compositionInput = buildCompositionInput(ctx, extra, article.slug, locale, theme, brandTokens);

    const socialModule = (await import("../../../render-server.ts")) as unknown as {
      renderHeadToHeadVs: (input: HeadToHeadVsInput) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderHeadToHeadVs(compositionInput);

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "head-to-head-vs",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption: context.generatedContent?.caption ?? fallbackCaption(ctx.tools, locale, resolveArticleUrl(brandTokens, article.slug)),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.013, templateKey: "head-to-head-vs" },
    };
  },

  mockFixtures: HEAD_TO_HEAD_VS_FIXTURES,
};
