import type { TemplateDefinition, ContentBounds } from "../types.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { comparisonGrid4OverridesSchema } from "../overrides/comparison-grid-4.overrides.ts";
import { COMPARISON_GRID_4_FIXTURES } from "./fixtures/comparisonGrid4.fixtures.ts";
import {
  comparisonGrid4GeneratedSchema,
  scoreTier,
  type ComparisonGrid4Input,
  type ComparisonGrid4Generated,
  type ComparisonGrid4GeneratedSchema,
  comparisonGrid4Bounds as _compositionBounds,
} from "../../compositions/comparison-grid-4/types.ts";
// @marketing-auto/core imported lazily inside generateContent() to avoid
// triggering getEnv() at module evaluation time (breaks unit tests without env vars).

// ─── Grid4Context — input type for this template ─────────────────────────────

export interface Grid4Tool {
  slug: string;
  name: string;
  score: number;
  verdict: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  priceFrom?: number;
  isWinner?: boolean;
  winnerFlagText?: string;
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
}

export interface Grid4Context {
  tools: Grid4Tool[];
  winner?: string;
}

// ─── Bounds (proxy to composition bounds, authoritative: REMOTION.md) ─────────

export const comparisonGrid4DefinitionBounds: ContentBounds = _compositionBounds;
// Named export matching the import used by bounds-match-remotion-md.test.ts
export const comparisonGrid4Bounds: ContentBounds = _compositionBounds;

// ─── Generated schema (for fixture tests) ─────────────────────────────────────

export { comparisonGrid4GeneratedSchema };
export type { ComparisonGrid4GeneratedSchema as ComparisonGrid4Generated };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});

const SLIDE_W = 1080;
const SLIDE_H = 1350;

function buildPriceLabel(
  tool: Grid4Tool,
  locale: "de" | "en",
): string {
  if (tool.pricingTier === "free") return locale === "de" ? "Kostenlos" : "Free";
  if (tool.priceFrom === 0) return locale === "de" ? "Ab 0 $/Mo" : "From $0/mo";
  if (tool.priceFrom) {
    return locale === "de"
      ? `Ab ${tool.priceFrom} $/Mo`
      : `From $${tool.priceFrom}/mo`;
  }
  return locale === "de" ? "Preis auf Anfrage" : "Contact for pricing";
}

function splitVerdict(verdict: string): { verdictStrong: string; verdictRest: string } {
  const commaIdx = verdict.indexOf(",");
  const dotIdx = verdict.indexOf(".");
  const dashIdx = verdict.indexOf(" — ");

  const splitAt =
    commaIdx !== -1 && commaIdx < 50
      ? commaIdx
      : dashIdx !== -1 && dashIdx < 50
        ? dashIdx + 1
        : dotIdx !== -1 && dotIdx < 50
          ? dotIdx
          : Math.min(verdict.length, 44);

  const strong = verdict.slice(0, splitAt).trim();
  const rest = verdict.slice(splitAt).trim();
  return {
    verdictStrong: strong.slice(0, 44),
    verdictRest: rest.slice(0, 52),
  };
}

function buildGenerated(
  context: Grid4Context,
  articleTitle: string | null,
  articleSlug: string,
  locale: "de" | "en",
  overridesValues: ReturnType<typeof comparisonGrid4OverridesSchema.parse>,
): ComparisonGrid4Generated {
  const { tools } = context;
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const year = new Date().getFullYear();
  const categories = [...new Set(tools.map((t) => t.slug.split("-")[0] ?? t.slug))];
  const categoryLabel = categories.slice(0, 2).join("/");

  const titleParts = (articleTitle ?? articleSlug).split(/[–—:]/);
  const headline = (titleParts[0]?.trim() ?? articleSlug).slice(0, 52);
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

  const gridTools = tools.map((t): ComparisonGrid4Generated["tools"][number] => {
    const { verdictStrong, verdictRest } = splitVerdict(t.verdict);
    const isWinner = t.isWinner ?? (context.winner !== undefined && context.winner === t.slug);
    const flagText = t.winnerFlagText ?? (isWinner ? winnerFlagDefault : undefined);
    return {
      name: t.name.slice(0, 16),
      verdictStrong,
      verdictRest,
      score: t.score,
      scoreTier: scoreTier(t.score),
      priceLabel: buildPriceLabel(t, locale),
      isWinner,
      ...(flagText !== undefined && { winnerFlagText: flagText }),
      ...(t.iconSvg !== undefined && { iconSvg: t.iconSvg }),
      ...(t.iconInitials !== undefined && { iconInitials: t.iconInitials }),
      ...(t.iconHue !== undefined && { iconHue: t.iconHue }),
    };
  });

  return {
    headline,
    headlineEm,
    subline: locale === "de"
      ? `${tools.length} Tools im Direktvergleich. Ehrlich bewertet nach Preis, Performance und Praxistauglichkeit.`
      : `${tools.length} tools compared head-to-head. Honestly rated on price, performance, and real-world use.`,
    eyebrow: `${eyebrowPrefix} ${tools.length} ${categoryLabel}`,
    slideNum: "01 / 01",
    ctaLine1,
    ctaLine2: `toolwiki.ai/${articleSlug}`,
    dateLabel: locale === "de"
      ? `Stand ${month}/${year} · toolwiki.ai/${articleSlug}`
      : `As of ${month}/${year} · toolwiki.ai/${articleSlug}`,
    tools: gridTools,
  };
}

function fallbackCaption(tools: Grid4Tool[], locale: "de" | "en", slug: string): string {
  const toolNames = tools.map((t) => t.name).join(", ");
  if (locale === "de") {
    return `${toolNames}: Wir haben alle 4 Tools getestet — hier ist unser ehrliches Fazit.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/${slug}`;
  }
  return `${toolNames}: We tested all 4 tools — here's our honest verdict.\n\nSave this post for your next tool decision.\n\n→ toolwiki.ai/${slug}`;
}

function fallbackHashtags(locale: "de" | "en"): string[] {
  if (locale === "de") {
    return ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"];
  }
  return ["#AITools", "#AIComparison", "#AIForBusiness", "#SoftwareReview", "#Productivity", "#DigitalTools", "#TechTools"];
}

// ─── Template definition ──────────────────────────────────────────────────────

export const comparisonGrid4Template: TemplateDefinition<Grid4Context> = {
  key: "comparison-grid-4",
  displayName: "4-Tool-Vergleich (Grid)",
  description:
    "Vier Tool-Karten in einem fixierten Grid-Stack mit Score, Preis und Verdict. Einzelne Still-PNG pro Artikel.",
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

  renderServerFn: "renderComparisonGrid4",

  bounds: comparisonGrid4DefinitionBounds,
  generatedSchema: comparisonGrid4GeneratedSchema,
  slotMap: {},

  eligibility: (article, _discovery) => {
    if (article.collection !== "comparisons") {
      return { eligible: false, reason: "Nur für comparisons-Collection" };
    }

    const extras = (article.domainExtras ?? {}) as {
      toolSlugs?: string[];
      tools?: Array<{ slug: string; score?: number }>;
    };

    const toolCount =
      extras.tools?.length ?? extras.toolSlugs?.length ?? 0;

    if (toolCount < 4) {
      return {
        eligible: false,
        reason: "Benötigt mindestens 4 Tools mit Score-Daten",
        requirements: ["domainExtras.tools.length >= 4"],
      };
    }

    return { eligible: true };
  },

  generateContent: async (article, input, locale, llmCaller) => {
    const { generateContentWithGate, inferArticleType, selectPattern } = await import("@marketing-auto/core");
    const ctx = input as Grid4Context;
    const toolNames = ctx.tools.map((t) => t.name);
    const articleType = inferArticleType(article.title ?? article.slug, toolNames.length);
    const pattern = selectPattern(article.id, articleType);
    const firstCategory = ctx.tools[0]?.slug.split("-")[0] ?? undefined;
    return generateContentWithGate(
      { id: article.id, title: article.title ?? article.slug, toolCount: toolNames.length, toolNames },
      pattern,
      {
        articleTitle: article.title ?? article.slug,
        toolNames,
        primaryKeyword: toolNames.slice(0, 3).join(", "),
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
      verdict?: string;
      pricingTier?: string;
      priceFrom?: number;
      isWinner?: boolean;
      winnerFlagText?: string;
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

    const tools: Grid4Tool[] = rawTools.slice(0, 4).map((raw): Grid4Tool => {
      const slug = raw.slug ?? "";
      const resolved = toolLookup.get(slug);
      const base: Grid4Tool = {
        slug,
        name: raw.name ?? resolved?.name ?? slug,
        score: raw.score ?? 70,
        verdict: raw.verdict ?? "",
      };
      if (raw.pricingTier !== undefined) {
        base.pricingTier = raw.pricingTier as "free" | "freemium" | "paid" | "enterprise";
      }
      if (raw.priceFrom !== undefined) base.priceFrom = raw.priceFrom;
      if (raw.isWinner !== undefined) base.isWinner = raw.isWinner;
      if (raw.winnerFlagText !== undefined) base.winnerFlagText = raw.winnerFlagText;
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

    const overridesValues = comparisonGrid4OverridesSchema.parse(overrides ?? {});

    const generated = buildGenerated(
      input,
      article.title,
      article.slug,
      locale,
      overridesValues,
    );

    const compositionInput: ComparisonGrid4Input = {
      slideIndex: 0,
      locale,
      theme,
      generated,
      brandTokens,
      ...(overrides !== undefined && { overrides }),
    };

    const socialModule = await import("../../../render-server.ts") as unknown as {
      renderComparisonGrid4: (input: ComparisonGrid4Input) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderComparisonGrid4(compositionInput);

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "comparison-grid-4",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption: context.generatedContent?.caption ?? fallbackCaption(input.tools, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.005, templateKey: "comparison-grid-4" },
    };
  },

  mockFixtures: COMPARISON_GRID_4_FIXTURES,
};
