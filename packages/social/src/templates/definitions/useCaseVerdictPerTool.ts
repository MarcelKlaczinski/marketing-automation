import type { TemplateDefinition } from "../types.ts";
import { getComparisonContext, type ComparisonContext } from "../adapters/comparison.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { USE_CASE_VERDICT_FIXTURES } from "./fixtures/useCaseVerdict.fixtures.ts";
import type { UseCaseVerdictItem } from "../../compositions/use-case-verdict/types.ts";
import {
  generateContentWithGate,
  inferArticleType,
  selectPattern,
} from "@marketing-auto/core";

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});

const SLIDE_W = 1080;
const SLIDE_H = 1350;

export const useCaseVerdictPerToolTemplate: TemplateDefinition<ComparisonContext> = {
  key: "use-case-verdict-per-tool",
  displayName: "Use-Case-Verdict pro Tool",
  description:
    "Pro Use-Case eine Slide mit Gewinner-Tool und Begründung. Schließt mit Recap-Tally.",
  defaultSlideCount: 7,
  estimatedCostUsd: 0.008,

  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "use-case",
    estimatedEngagementTier: "medium",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  eligibility: (article, _discovery) => {
    if (article.collection !== "comparisons") {
      return { eligible: false, reason: "Nur für comparisons-Collection" };
    }

    const extras = (article.frontmatterExtras ?? {}) as { useCaseVerdicts?: UseCaseVerdictItem[] };
    const verdicts = extras.useCaseVerdicts ?? [];

    if (verdicts.length < 3) {
      return {
        eligible: false,
        reason: "Benötigt mindestens 3 Use-Case-Verdicts",
        requirements: ["frontmatter.useCaseVerdicts.length >= 3"],
      };
    }


    const incomplete = verdicts.filter((v) => !v.winner || !v.reason);
    if (incomplete.length > 0) {
      return {
        eligible: false,
        reason: `${incomplete.length} Verdicts ohne winner/reason`,
        requirements: ["frontmatter.useCaseVerdicts[*].winner", "frontmatter.useCaseVerdicts[*].reason"],
      };
    }

    return { eligible: true };
  },

  generateContent: async (article, input, locale, llmCaller) => {
    const toolNames = (input as ComparisonContext).tools.map((t) => t.name);
    const articleType = inferArticleType(article.title ?? article.slug, toolNames.length);
    const pattern = selectPattern(article.id, articleType);
    return generateContentWithGate(
      { id: article.id, title: article.title ?? article.slug, toolCount: toolNames.length, toolNames },
      pattern,
      {
        articleTitle: article.title ?? article.slug,
        toolNames,
        primaryKeyword: toolNames.join(" vs. "),
        locale,
        articleSlug: article.slug,
        contentType: "use-case",
      },
      llmCaller,
    );
  },

  buildInput: async (article, _discovery) => {
    const extras = (article.frontmatterExtras ?? {}) as { toolSlugs?: string[]; useCaseVerdicts?: UseCaseVerdictItem[] };
    const locale = (article.locale ?? "de") as "de" | "en";
    const toolLookup = await buildToolLookup(extras.toolSlugs ?? [], locale, article.projectId);
    const ctx = getComparisonContext(article, toolLookup);
    // Cap at 7 — 1 cover + 7 verdicts + 2 (tally + recap) = 10 ≤ Instagram carousel limit
    return { ...ctx, useCaseVerdicts: ctx.useCaseVerdicts.slice(0, 7) };
  },

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const resolvedTools = input.tools.map((t) => ({
      slug: t.slug,
      name: t.name,
      ...(t.iconSvg !== undefined && { iconSvg: t.iconSvg }),
      ...(t.iconInitials !== undefined && { iconInitials: t.iconInitials }),
      ...(t.iconHue !== undefined && { iconHue: t.iconHue }),
    }));

    const verdicts = input.useCaseVerdicts.map((v) => ({
      useCase: v.useCase,
      winner: v.winner,
      reason: v.reason,
      ...(v.score !== undefined && { score: v.score }),
    }));

    const carouselInput = {
      theme,
      locale,
      slideIndex: 0,
      websiteUrl: brandTokens.social.websiteUrl ?? "toolwiki.ai",
      instagramHandle: brandTokens.social.instagramHandle ?? "@toolwiki.ai",
      articleSlug: article.slug,
      tools: resolvedTools,
      verdicts,
    };

    // Dynamic import — avoids bundling Remotion into non-render contexts
    const socialModule = await import("../../../render-server.ts") as unknown as {
      renderUseCaseVerdictCarousel: (
        input: Record<string, unknown>,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };

    const { slides: buffers } = await socialModule.renderUseCaseVerdictCarousel(
      carouselInput as unknown as Record<string, unknown>,
    );

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "use-case-verdict-per-tool",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption: context.generatedContent?.caption ?? fallbackCaption(input, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.008, templateKey: "use-case-verdict-per-tool" },
    };
  },

  mockFixtures: USE_CASE_VERDICT_FIXTURES,
};

function computeTally(verdicts: UseCaseVerdictItem[]): Array<{ slug: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of verdicts) {
    counts.set(v.winner, (counts.get(v.winner) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => ({ slug, count }));
}

function fallbackCaption(input: ComparisonContext, locale: "de" | "en", slug: string): string {
  const toolNames = input.tools.map((t) => t.name).join(" vs. ");
  const tally = computeTally(input.useCaseVerdicts);
  const topSlug = tally[0]?.slug ?? "";
  const winner = input.tools.find((t) => t.slug === topSlug)?.name ?? topSlug;
  const count = tally[0]?.count ?? 0;

  if (locale === "de") {
    return (
      `${toolNames}: ${input.useCaseVerdicts.length} Use-Cases, ${input.useCaseVerdicts.length} ehrliche Empfehlungen.\n\n` +
      `${winner} gewinnt ${count} von ${input.useCaseVerdicts.length} Use-Cases.\n\n` +
      `Speicher diesen Post für deine nächste Tool-Entscheidung.\n\n` +
      `→ toolwiki.ai/${slug}`
    );
  }
  return (
    `${toolNames}: ${input.useCaseVerdicts.length} use cases, ${input.useCaseVerdicts.length} honest recommendations.\n\n` +
    `${winner} wins ${count} of ${input.useCaseVerdicts.length} use cases.\n\n` +
    `Save this post for your next tool decision.\n\n` +
    `→ toolwiki.ai/${slug}`
  );
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
      "#UseCase",
    ];
  }
  return [
    "#AITools",
    "#AIComparison",
    "#AIForBusiness",
    "#UseCase",
    "#SoftwareReview",
    "#Productivity",
    "#DigitalTools",
  ];
}
