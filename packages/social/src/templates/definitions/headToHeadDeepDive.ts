/**
 * Spec 65.7 — `head-to-head-deep-dive` 9-slide 2-tool deep comparison.
 *
 * Cover → A overview → A features → B overview → B features → Pricing → Use-cases → Verdict → End.
 */
import { z } from "zod";
import type { ContentBounds, GeneratedContent, TemplateDefinition } from "../types.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import type { ToolReference } from "../adapters/types.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { validateAndReprompt } from "../validateGenerated.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { HEAD_TO_HEAD_DEEP_DIVE_FIXTURES } from "./fixtures/headToHeadDeepDive.fixtures.ts";
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
  headToHeadDeepDiveBounds as compositionBounds,
  headToHeadDeepDiveGeneratedSchema,
  type HeadToHeadDeepDiveGenerated,
  type HeadToHeadDeepDiveInput,
  type PricingCompareContent,
  type UseCaseCompareContent,
} from "../../compositions/head-to-head-deep-dive/types.ts";

export interface HeadToHeadDeepDiveRawTool {
  slug: string;
  name?: string;
  score?: number;
  meta?: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  priceFrom?: number;
  pros?: [string, string];
  cons?: [string, string];
  extendedPros?: string[];
  extendedCons?: string[];
}

export interface HeadToHeadDeepDiveContext {
  tools: FamilyATool[];
  angle?: string;
  winner?: string;
}

export const headToHeadDeepDiveBounds: ContentBounds = compositionBounds as ContentBounds;
export const headToHeadDeepDiveDefinitionBounds: ContentBounds = compositionBounds as ContentBounds;

export { headToHeadDeepDiveGeneratedSchema };
export type { HeadToHeadDeepDiveGenerated };

const headToHeadDeepDiveLlmResponseSchema = z.object({
  cover: z.object({
    headline_lead: z.string().min(4).max(28),
    headline_em: z.string().min(4).max(32),
    subline: z.string().min(40).max(160),
  }),
  pricing: z.object({
    title: z.string().min(6).max(40),
    rows: z
      .array(z.object({
        label: z.string().min(4).max(28),
        tool_a: z.string().min(2).max(40),
        tool_b: z.string().min(2).max(40),
      }))
      .length(3),
  }),
  use_cases: z.object({
    title: z.string().min(6).max(40),
    rows: z
      .array(z.object({
        label: z.string().min(4).max(36),
        winner: z.enum(["a", "b"]),
        reason: z.string().min(4).max(56),
      }))
      .min(3)
      .max(5),
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

type HeadToHeadDeepDiveLlmResponse = z.infer<typeof headToHeadDeepDiveLlmResponseSchema>;

interface DeepDiveExtra {
  cover: { headlineLead: string; headlineEm: string; subline: string };
  pricing: PricingCompareContent;
  useCases: UseCaseCompareContent;
  verdict: { winnerSlug: string; reasoning: string };
  end: { headlineLead: string; headlineEm: string };
}

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});
const SLIDE_W = 1080;
const SLIDE_H = 1350;
const SLIDE_TOTAL = 9;

function buildFallbackExtra(ctx: HeadToHeadDeepDiveContext, locale: "de" | "en"): DeepDiveExtra {
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
        ? `Deep Dive: Beide Tools im Detail-Vergleich — Pricing, Use-Cases und ehrliches Fazit.`
        : `Deep dive: both tools compared in detail — pricing, use cases, and an honest verdict.`,
    },
    pricing: {
      title: locale === "de" ? "Pricing & Limits" : "Pricing & limits",
      rows: [
        { label: locale === "de" ? "Plan" : "Plan", toolA: aName, toolB: bName },
        { label: locale === "de" ? "Kosten" : "Cost", toolA: `${a?.priceAmount ?? "—"}`, toolB: `${b?.priceAmount ?? "—"}` },
        { label: locale === "de" ? "Ideal für" : "Best for", toolA: a?.meta.slice(0, 40) ?? "—", toolB: b?.meta.slice(0, 40) ?? "—" },
      ],
    },
    useCases: {
      title: locale === "de" ? "Beste Wahl pro Use-Case" : "Winner per use case",
      rows: [
        { label: locale === "de" ? "Erstellung" : "Creation", winner: "a", reason: aName },
        { label: locale === "de" ? "Iteration" : "Iteration", winner: "b", reason: bName },
        { label: locale === "de" ? "Skalierung" : "Scale", winner: "a", reason: aName },
      ],
    },
    verdict: {
      winnerSlug,
      reasoning: locale === "de"
        ? `${copy.bestFor} den Vergleich: ${winnerName} — die runde Balance aus Qualität, Pricing und Use-Cases.`
        : `${copy.bestFor} this matchup: ${winnerName} — the balanced mix of quality, pricing, and use cases.`,
    },
    end: { headlineLead: copy.moreReviews, headlineEm: copy.honestlyTested },
  };
}

function fallbackCaption(tools: FamilyATool[], locale: "de" | "en", articleUrl: string): string {
  const a = tools[0]?.name ?? "Tool A";
  const b = tools[1]?.name ?? "Tool B";
  if (locale === "de") {
    return `${a} vs. ${b} — Deep-Dive-Vergleich: Pricing, Use-Cases, ehrliches Fazit.\n\n→ ${articleUrl}`;
  }
  return `${a} vs. ${b} — deep-dive comparison: pricing, use cases, honest verdict.\n\n→ ${articleUrl}`;
}

function fallbackHashtags(locale: "de" | "en"): string[] {
  if (locale === "de") {
    return ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"];
  }
  return ["#AITools", "#AIComparison", "#AIForBusiness", "#SoftwareReview", "#Productivity", "#DigitalTools", "#TechTools"];
}

function buildFallbackGeneratedContent(ctx: HeadToHeadDeepDiveContext, locale: "de" | "en", slug: string): GeneratedContent {
  const extra = buildFallbackExtra(ctx, locale);
  return {
    hookOutput: { text: locale === "de" ? "Welches Tool gewinnt im Deep-Dive?" : "Which tool wins the deep dive?", pattern: "negative_frame" as const },
    // LLM-fallback path: brandTokens not available inside generateContent(), so
    // emit the V1 single-tenant URL. The render() fallback uses
    // resolveArticleUrl() for multi-tenant safety. Matches single-tool-spotlight.
    caption: fallbackCaption(ctx.tools, locale, `toolwiki.ai/${slug}`),
    hashtags: fallbackHashtags(locale),
    _headToHeadDeepDiveExtra: extra,
  } as unknown as GeneratedContent;
}

function buildCompositionInput(
  ctx: HeadToHeadDeepDiveContext,
  extra: DeepDiveExtra,
  articleSlug: string,
  locale: "de" | "en",
  theme: "dark" | "light",
  brandTokens: unknown,
): HeadToHeadDeepDiveInput {
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
  if (!toolA || !toolB) throw new Error("head-to-head-deep-dive requires exactly 2 tools");

  return {
    slideIndex: 0,
    slideTotal: SLIDE_TOTAL,
    theme,
    locale,
    cover: {
      eyebrow: locale === "de" ? "Head-to-Head · Deep Dive" : "Head-to-head · Deep dive",
      headlineLead: extra.cover.headlineLead,
      headlineEm: extra.cover.headlineEm,
      subline: extra.cover.subline,
      headerNum: `${month}/${year} · ${articleUrl}`.slice(0, 48),
    },
    tools: [toolA, toolB],
    pricing: extra.pricing,
    useCases: extra.useCases,
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
// Mirrors `comparisonGrid3.ts` / `comparisonGrid5.ts` / `headToHeadVs.ts`.
export function buildHeadToHeadDeepDiveRenderSnapshot(args: {
  ctx: HeadToHeadDeepDiveContext;
  generatedContent: GeneratedContent | undefined;
  articleSlug: string;
  locale: "de" | "en";
  theme: "dark" | "light";
  brandTokens: unknown;
}): { compositionInput: HeadToHeadDeepDiveInput; slideTotal: number } {
  const withExtra = args.generatedContent as
    | (GeneratedContent & { _headToHeadDeepDiveExtra?: DeepDiveExtra })
    | undefined;
  const extra = withExtra?._headToHeadDeepDiveExtra ?? buildFallbackExtra(args.ctx, args.locale);
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

export const headToHeadDeepDiveTemplate: TemplateDefinition<HeadToHeadDeepDiveContext> = {
  key: "head-to-head-deep-dive",
  displayName: "Head-to-Head Deep Dive (2-Tool)",
  description:
    "9-Slide-Deep-Dive zweier Tools: Cover, beide Tool-Profile + Features, Pricing-Vergleich, Use-Case-Sieger, Sieger-Fazit, End-CTA.",
  defaultSlideCount: SLIDE_TOTAL,
  estimatedCostUsd: 0.018,

  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "comparison",
    estimatedEngagementTier: "high",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  renderServerFn: "renderHeadToHeadDeepDive",

  bounds: headToHeadDeepDiveDefinitionBounds,
  generatedSchema: headToHeadDeepDiveGeneratedSchema,
  slotMap: {},

  eligibility: (article, _discovery) => {
    if (article.collection !== "comparisons") {
      return { eligible: false, reason: "Nur für comparisons-Collection" };
    }
    const extras = (article.domainExtras ?? {}) as { toolSlugs?: string[]; tools?: Array<{ slug?: string }> };
    const toolCount = extras.tools?.length ?? extras.toolSlugs?.length ?? 0;
    if (toolCount !== 2) {
      return { eligible: false, reason: "Benötigt exakt 2 Tools", requirements: ["domainExtras.tools.length === 2"] };
    }
    return { eligible: true };
  },

  generateContent: async (article, input, locale, llmCaller) => {
    const ctx = input as HeadToHeadDeepDiveContext;
    const [a, b] = ctx.tools;
    if (!a || !b) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    const isDE = locale === "de";
    const localeDirective = isDE
      ? "Output language: German (du-Form, B2B-konversationell). Keine Drama-Phrasen."
      : "Output language: English (concise, direct).";

    const systemPrompt =
      "You write structured JSON for Instagram deep-dive head-to-head carousel slides. " +
      "Return ONLY valid JSON — no markdown fences, no preamble.";

    const userPrompt = `Generate Instagram deep-dive carousel content for "${article.title ?? article.slug}".

TOOL A: ${a.name} (score ${a.score}) — ${a.meta}${a.priceFrom != null ? ` — from $${a.priceFrom}/mo` : ""}
TOOL B: ${b.name} (score ${b.score}) — ${b.meta}${b.priceFrom != null ? ` — from $${b.priceFrom}/mo` : ""}
${ctx.angle ? `ANGLE: ${ctx.angle}` : ""}

OUTPUT JSON:
{
  "cover": { "headline_lead": "<tool A name>", "headline_em": "<'vs. Tool B' accent>", "subline": "<40-160 chars>" },
  "pricing": {
    "title": "<pricing slide title>",
    "rows": [
      { "label": "Plan", "tool_a": "<Tool A plan name>", "tool_b": "<Tool B plan name>" },
      { "label": "Kosten", "tool_a": "<cost>", "tool_b": "<cost>" },
      { "label": "Ideal für", "tool_a": "<best-for>", "tool_b": "<best-for>" }
    ]
  },
  "use_cases": {
    "title": "<use-case slide title>",
    "rows": [
      { "label": "<use case>", "winner": "a" | "b", "reason": "<one-line why>" },
      { "label": "...", "winner": "...", "reason": "..." },
      { "label": "...", "winner": "...", "reason": "..." }
    ]
  },
  "verdict": { "winner_slug": "<must be ${a.slug} or ${b.slug}>", "reasoning": "<1-2 sentences>" },
  "end": { "headline_lead": "...", "headline_em": "..." },
  "hook_text": "<one hook sentence>",
  "caption": "<20-1800 chars>",
  "hashtags": ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"]
}

${localeDirective}`;

    const raw = await llmCaller(systemPrompt, userPrompt);
    if (!raw) return buildFallbackGeneratedContent(ctx, locale, article.slug);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    let parsed: HeadToHeadDeepDiveLlmResponse;
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
        { schema: headToHeadDeepDiveLlmResponseSchema, maxReprompts: 1, locale },
      );
    } catch {
      return buildFallbackGeneratedContent(ctx, locale, article.slug);
    }

    const validSlugs = new Set([a.slug, b.slug]);
    const safeWinnerSlug = validSlugs.has(parsed.verdict.winner_slug) ? parsed.verdict.winner_slug : a.slug;

    const extra: DeepDiveExtra = {
      cover: {
        headlineLead: parsed.cover.headline_lead,
        headlineEm: parsed.cover.headline_em,
        subline: parsed.cover.subline,
      },
      pricing: {
        title: parsed.pricing.title,
        rows: parsed.pricing.rows.map((r) => ({
          label: r.label,
          toolA: r.tool_a,
          toolB: r.tool_b,
        })) as PricingCompareContent["rows"],
      },
      useCases: {
        title: parsed.use_cases.title,
        rows: parsed.use_cases.rows,
      },
      verdict: { winnerSlug: safeWinnerSlug, reasoning: parsed.verdict.reasoning },
      end: { headlineLead: parsed.end.headline_lead, headlineEm: parsed.end.headline_em },
    };

    return {
      hookOutput: { text: parsed.hook_text.slice(0, 160), pattern: "negative_frame" as const },
      caption: parsed.caption.slice(0, 1800),
      hashtags: parsed.hashtags,
      _headToHeadDeepDiveExtra: extra,
    } as unknown as GeneratedContent;
  },

  buildInput: async (article, _discovery) => {
    const extras = (article.domainExtras ?? {}) as {
      toolSlugs?: string[];
      tools?: HeadToHeadDeepDiveRawTool[];
      winner?: string;
      angle?: string;
    };
    const rawTools: HeadToHeadDeepDiveRawTool[] = extras.tools ?? [];
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
      if (raw.extendedPros !== undefined) tool.extendedPros = raw.extendedPros;
      if (raw.extendedCons !== undefined) tool.extendedCons = raw.extendedCons;
      if (resolved?.iconSvg !== undefined) tool.iconSvg = resolved.iconSvg;
      if (resolved?.iconInitials !== undefined) tool.iconInitials = resolved.iconInitials;
      if (resolved?.iconHue !== undefined) tool.iconHue = resolved.iconHue;
      if (resolvedExtra?.primaryColor !== undefined) tool.primaryColor = resolvedExtra.primaryColor;
      if (resolvedExtra?.secondaryColor !== undefined) tool.secondaryColor = resolvedExtra.secondaryColor;
      if (resolvedExtra?.tertiaryColor !== undefined) tool.tertiaryColor = resolvedExtra.tertiaryColor;
      return tool;
    });

    const out: HeadToHeadDeepDiveContext = { tools };
    if (extras.winner !== undefined) out.winner = extras.winner;
    if (extras.angle !== undefined) out.angle = extras.angle;
    return out;
  },

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const ctx = input as HeadToHeadDeepDiveContext;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const withExtra = context.generatedContent as
      | (GeneratedContent & { _headToHeadDeepDiveExtra?: DeepDiveExtra })
      | undefined;
    const extra = withExtra?._headToHeadDeepDiveExtra ?? buildFallbackExtra(ctx, locale);

    const compositionInput = buildCompositionInput(ctx, extra, article.slug, locale, theme, brandTokens);

    const socialModule = (await import("../../../render-server.ts")) as unknown as {
      renderHeadToHeadDeepDive: (input: HeadToHeadDeepDiveInput) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderHeadToHeadDeepDive(compositionInput);

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "head-to-head-deep-dive",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption: context.generatedContent?.caption ?? fallbackCaption(ctx.tools, locale, resolveArticleUrl(brandTokens, article.slug)),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.018, templateKey: "head-to-head-deep-dive" },
    };
  },

  mockFixtures: HEAD_TO_HEAD_DEEP_DIVE_FIXTURES,
};
