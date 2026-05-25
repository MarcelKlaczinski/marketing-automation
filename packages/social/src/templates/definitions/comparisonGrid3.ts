import type { TemplateDefinition, ContentBounds } from "../types.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { comparisonGrid3OverridesSchema } from "../overrides/comparison-grid-3.overrides.ts";
import { COMPARISON_GRID_3_FIXTURES } from "./fixtures/comparisonGrid3.fixtures.ts";
import {
  comparisonGrid3GeneratedSchema,
  comparisonGrid3Bounds as _compositionBounds,
  scoreTier,
  type ComparisonGrid3Input,
  type ComparisonGrid3GeneratedSchema,
} from "../../compositions/comparison-grid-3/types.ts";
// @marketing-auto/core imported lazily inside generateContent() to avoid
// triggering getEnv() at module evaluation time (breaks unit tests without env vars).

// ─── Grid3Context — input type for this template ─────────────────────────────

export interface Grid3Tool {
  slug: string;
  name: string;
  score: number;
  meta: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  priceFrom?: number;
  isWinner?: boolean;
  winnerFlagText?: string;
  pros?: [string, string];
  cons?: [string, string];
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
}

export interface Grid3Context {
  tools: Grid3Tool[];
  winner?: string;
}

// ─── Bounds (proxy to composition bounds) ─────────────────────────────────────

export const comparisonGrid3DefinitionBounds: ContentBounds = _compositionBounds;
export const comparisonGrid3Bounds: ContentBounds = _compositionBounds;

// ─── Generated schema (for fixture tests) ─────────────────────────────────────

export { comparisonGrid3GeneratedSchema };
export type { ComparisonGrid3GeneratedSchema as ComparisonGrid3Generated };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});

const SLIDE_W = 1080;
const SLIDE_H = 1350;

function buildPriceComponents(
  tool: Grid3Tool,
  locale: "de" | "en",
): { pricePrefix: string; priceAmount: string } {
  if (tool.pricingTier === "free" || tool.priceFrom === 0) {
    return { pricePrefix: "", priceAmount: locale === "de" ? "Kostenlos" : "Free" };
  }
  if (tool.priceFrom) {
    return {
      pricePrefix: locale === "de" ? "Ab" : "From",
      priceAmount: `${tool.priceFrom} $/Mo`,
    };
  }
  return { pricePrefix: "", priceAmount: locale === "de" ? "Preis auf Anfrage" : "Contact" };
}

function buildFallbackPros(tool: Grid3Tool, locale: "de" | "en"): [string, string] {
  const cat = tool.meta || tool.slug;
  return locale === "de"
    ? [`Stark bei: ${cat.slice(0, 28)}`, "Aktiv entwickelt"]
    : [`Strong at: ${cat.slice(0, 28)}`, "Actively developed"];
}

function buildFallbackCons(locale: "de" | "en"): [string, string] {
  return locale === "de"
    ? ["Lernkurve für Einsteiger", "Weniger Integrationen"]
    : ["Learning curve for beginners", "Fewer integrations"];
}

function buildGenerated(
  context: Grid3Context,
  articleTitle: string | null,
  articleSlug: string,
  locale: "de" | "en",
  overridesValues: ReturnType<typeof comparisonGrid3OverridesSchema.parse>,
): ComparisonGrid3Input["generated"] {
  const { tools, winner } = context;
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const year = new Date().getFullYear();

  const titleParts = (articleTitle ?? articleSlug).split(/[–—:]/);
  const headline = (titleParts[0]?.trim() ?? articleSlug).slice(0, 40);
  const headlineEm = (titleParts[1]?.trim() ?? (locale === "de" ? "im Vergleich" : "compared")).slice(0, 22);

  const eyebrowPrefix = locale === "de"
    ? overridesValues.copy.eyebrowPrefix.de
    : overridesValues.copy.eyebrowPrefix.en;
  const ctaLine1 = locale === "de"
    ? overridesValues.copy.ctaPrefix.de
    : overridesValues.copy.ctaPrefix.en;
  const winnerFlagDefault = locale === "de"
    ? overridesValues.copy.winnerFlagText.de
    : overridesValues.copy.winnerFlagText.en;

  const gridTools = tools.map((t): ComparisonGrid3Input["generated"]["tools"][number] => {
    const isWinner = t.isWinner ?? (winner !== undefined && winner === t.slug);
    const flagText = t.winnerFlagText ?? (isWinner ? winnerFlagDefault : undefined);
    const { pricePrefix, priceAmount } = buildPriceComponents(t, locale);
    const pros = t.pros ?? buildFallbackPros(t, locale);
    const cons = t.cons ?? buildFallbackCons(locale);

    const base: ComparisonGrid3Input["generated"]["tools"][number] = {
      name: t.name.slice(0, 18),
      meta: t.meta.slice(0, 32),
      score: t.score,
      scoreTier: scoreTier(t.score),
      pricePrefix,
      priceAmount,
      isWinner,
      pros,
      cons,
    };

    if (flagText !== undefined) base.winnerFlagText = flagText;
    if (t.iconSvg !== undefined) base.iconSvg = t.iconSvg;
    if (t.iconInitials !== undefined) base.iconInitials = t.iconInitials;
    if (t.iconHue !== undefined) base.iconHue = t.iconHue;

    return base;
  });

  return {
    headline,
    headlineEm,
    subline: locale === "de"
      ? `${tools.length} Tools im Direktvergleich — Pros, Cons und wer für welchen Job gewinnt.`
      : `${tools.length} tools compared head-to-head — pros, cons, and who wins for which job.`,
    eyebrow: `${eyebrowPrefix} ${tools.length} Tools`,
    slideNum: "01 / 01",
    ctaLine1,
    ctaLine2: `toolwiki.ai/${articleSlug}`,
    dateLabel: locale === "de"
      ? `Stand ${month}/${year} · toolwiki.ai/${articleSlug}`
      : `As of ${month}/${year} · toolwiki.ai/${articleSlug}`,
    tools: gridTools,
  };
}

function fallbackCaption(tools: Grid3Tool[], locale: "de" | "en", slug: string): string {
  const toolNames = tools.map((t) => t.name).join(" vs. ");
  if (locale === "de") {
    return `${toolNames}: Drei Tools, ein ehrliches Fazit — welches passt zu deinem Workflow?\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/${slug}`;
  }
  return `${toolNames}: Three tools, one honest verdict — which fits your workflow?\n\nSave this post for your next tool decision.\n\n→ toolwiki.ai/${slug}`;
}

function fallbackHashtags(locale: "de" | "en"): string[] {
  if (locale === "de") {
    return ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"];
  }
  return ["#AITools", "#AIComparison", "#AIForBusiness", "#SoftwareReview", "#Productivity", "#DigitalTools", "#TechTools"];
}

// ─── Template definition ──────────────────────────────────────────────────────

export const comparisonGrid3Template: TemplateDefinition<Grid3Context> = {
  key: "comparison-grid-3",
  displayName: "3-Tool-Vergleich (Grid)",
  description:
    "Drei Tool-Karten mit Score, Preis, Pros und Cons in einem auto-height Grid-Stack. Einzelne Still-PNG pro Artikel.",
  defaultSlideCount: 1,
  estimatedCostUsd: 0.005,

  outputFormat: "carousel",
  compatibleChannels: ["instagram"],
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

  eligibility: (article, _discovery) => {
    if (article.collection !== "comparisons") {
      return { eligible: false, reason: "Nur für comparisons-Collection" };
    }

    const extras = (article.domainExtras ?? {}) as {
      toolSlugs?: string[];
      tools?: Array<{ slug: string; score?: number }>;
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

  generateContent: async (article, input, locale, llmCaller) => {
    const { generateContentWithGate, inferArticleType, selectPattern } = await import("@marketing-auto/core");
    const ctx = input as Grid3Context;
    const toolNames = ctx.tools.map((t) => t.name);
    const articleType = inferArticleType(article.title ?? article.slug, toolNames.length);
    const pattern = selectPattern(article.id, articleType);
    const firstCategory = ctx.tools[0]?.meta.split("·")[0]?.trim() ?? undefined;
    return generateContentWithGate(
      { id: article.id, title: article.title ?? article.slug, toolCount: toolNames.length, toolNames },
      pattern,
      {
        articleTitle: article.title ?? article.slug,
        toolNames,
        primaryKeyword: toolNames.join(" vs. "),
        locale,
        articleSlug: article.slug,
        contentType: "comparison",
        ...(firstCategory !== undefined && { toolCategory: firstCategory }),
      },
      llmCaller,
    );
  },

  buildInput: async (article, _discovery) => {
    type RawToolEntry = {
      slug?: string;
      name?: string;
      score?: number;
      meta?: string;
      pricingTier?: string;
      priceFrom?: number;
      isWinner?: boolean;
      winnerFlagText?: string;
      pros?: [string, string];
      cons?: [string, string];
    };

    const extras = (article.domainExtras ?? {}) as {
      toolSlugs?: string[];
      tools?: RawToolEntry[];
      winner?: string;
    };

    const rawTools: RawToolEntry[] = extras.tools ?? [];
    const slugsForLookup = rawTools
      .map((t) => t.slug)
      .filter((s): s is string => typeof s === "string");

    const locale = (article.locale ?? "de") as "de" | "en";
    const toolLookup = await buildToolLookup(slugsForLookup, locale, article.projectId);

    const tools: Grid3Tool[] = rawTools.slice(0, 3).map((raw): Grid3Tool => {
      const slug = raw.slug ?? "";
      const resolved = toolLookup.get(slug);
      const base: Grid3Tool = {
        slug,
        name: raw.name ?? resolved?.name ?? slug,
        score: raw.score ?? 70,
        meta: raw.meta ?? (resolved as { primaryCategory?: string } | undefined)?.primaryCategory ?? slug,
      };
      if (raw.pricingTier !== undefined) base.pricingTier = raw.pricingTier as "free" | "freemium" | "paid" | "enterprise";
      if (raw.priceFrom !== undefined) base.priceFrom = raw.priceFrom;
      if (raw.isWinner !== undefined) base.isWinner = raw.isWinner;
      if (raw.winnerFlagText !== undefined) base.winnerFlagText = raw.winnerFlagText;
      if (raw.pros !== undefined) base.pros = raw.pros;
      if (raw.cons !== undefined) base.cons = raw.cons;
      if (resolved?.iconSvg !== undefined) base.iconSvg = resolved.iconSvg;
      if (resolved?.iconInitials !== undefined) base.iconInitials = resolved.iconInitials;
      if (resolved?.iconHue !== undefined) base.iconHue = resolved.iconHue;
      return base;
    });

    return {
      tools,
      ...(extras.winner !== undefined && { winner: extras.winner }),
    };
  },

  render: async (context) => {
    const { article, input, locale, theme, overrides } = context;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const overridesValues = comparisonGrid3OverridesSchema.parse(overrides ?? {});

    const generated = buildGenerated(
      input,
      article.title,
      article.slug,
      locale,
      overridesValues,
    );

    const compositionInput: ComparisonGrid3Input = {
      slideIndex: 0,
      locale,
      theme,
      generated,
      brandTokens,
      ...(overrides !== undefined && { overrides }),
    };

    const socialModule = await import("../../../render-server.ts") as unknown as {
      renderComparisonGrid3: (input: ComparisonGrid3Input) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
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
      caption: context.generatedContent?.caption ?? fallbackCaption(input.tools, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.005, templateKey: "comparison-grid-3" },
    };
  },

  mockFixtures: COMPARISON_GRID_3_FIXTURES,
};
