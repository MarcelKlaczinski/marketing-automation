import type { TemplateDefinition } from "../types.ts";
import { getComparisonContext, type ComparisonContext } from "../adapters/comparison.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { COMPARISON_STUNNING_FIXTURES } from "./fixtures/comparisonStunning.fixtures.ts";
import {
  generateContentWithGate,
  inferArticleType,
  selectPattern,
} from "@marketing-auto/core";

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});

const SLIDE_W = 1080;
const SLIDE_H = 1350;

export const comparisonStunning3Template: TemplateDefinition<ComparisonContext> = {
  key: "comparison-stunning-3",
  displayName: "3-Tool-Vergleich (Stunning)",
  description:
    "Cover mit Hook, drei Tool-Spotlights, Verdict-Closer. Für Triple-Vergleiche wie Cursor vs. Windsurf vs. Codeium.",
  defaultSlideCount: 5,
  estimatedCostUsd: 0.01,

  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "comparison",
    estimatedEngagementTier: "high",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  eligibility: (article, _discovery) => {
    if (article.collection !== "comparisons") {
      return { eligible: false, reason: "Nur für comparisons-Collection" };
    }

    const extras = (article.frontmatterExtras ?? {}) as { toolSlugs?: string[]; verdict?: string };
    const toolCount = extras.toolSlugs?.length ?? 0;

    if (toolCount !== 3) {
      return {
        eligible: false,
        reason: "Benötigt exakt 3 Tools",
        requirements: ["frontmatter.toolSlugs.length === 3"],
      };
    }
    if (!extras.verdict) {
      return {
        eligible: false,
        reason: "Verdict-Feld fehlt",
        requirements: ["frontmatter.verdict"],
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
        contentType: "comparison",
      },
      llmCaller,
    );
  },

  buildInput: async (article, _discovery) => {
    const extras = (article.frontmatterExtras ?? {}) as { toolSlugs?: string[] };
    const locale = (article.locale ?? "de") as "de" | "en";
    const toolLookup = await buildToolLookup(extras.toolSlugs ?? [], locale, article.projectId);
    return getComparisonContext(article, toolLookup);
  },

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const toolNamesStr = input.tools.map((t) => t.name).join(" vs. ");
    const year = new Date().getFullYear();
    const eyebrow =
      locale === "de"
        ? `TOOL-VERGLEICH · ${year}`
        : `TOOL COMPARISON · ${year}`;

    const hook = context.generatedContent?.hookOutput ?? {
      pattern: "superlative_question" as const,
      leadPhrase: locale === "de" ? "Welches Tool" : "Which tool",
      highlightWord: locale === "de" ? "gewinnt wirklich?" : "really wins?",
      trailPhrase: "",
      fullText: locale === "de" ? "Welches Tool gewinnt wirklich?" : "Which tool really wins?",
      promiseBlock: {
        line1: locale === "de" ? `${toolNamesStr} im Praxistest.` : `${toolNamesStr} put to the test.`,
        line2: locale === "de" ? "Kein Hype. Echte Ergebnisse." : "No hype. Real results.",
      },
    };

    const resolvedTools = input.tools.map((t, i) => ({
      slug: t.slug,
      rank: i + 1,
      name: t.name,
      domain: t.slug + ".com",
      eyebrow: `${String(i + 1).padStart(2, "0")} · ${(t.primaryCategory ?? "KI-TOOL").toUpperCase()}`,
      tagline: input.verdict.slice(0, 120),
      strengths: locale === "de" ? ["Getestet", "Verglichen"] : ["Tested", "Compared"],
      pricing: {
        tier: (t.pricingTier === "enterprise" ? "paid" : (t.pricingTier ?? "freemium")) as "free" | "freemium" | "paid",
        label: t.priceFrom === 0 ? "ab 0€" : t.priceFrom ? `ab ${t.priceFrom}€/Monat` : "Preis auf Anfrage",
      },
      ...(t.iconSvg !== undefined && { iconSvg: t.iconSvg }),
      ...(t.iconInitials !== undefined && { iconInitials: t.iconInitials }),
      ...(t.iconHue !== undefined && { iconHue: t.iconHue }),
      ...(t.endSlideToken !== undefined && { endSlideToken: t.endSlideToken }),
    }));

    const carouselInput = {
      theme,
      variant: "stunning" as const,
      brandTokens,
      slideIndex: 0,
      cover: {
        eyebrow,
        headlineLead: hook.leadPhrase,
        headlineHighlight: hook.highlightWord,
        hookOutput: hook,
      },
      tools: resolvedTools,
      end: {
        headline: locale === "de" ? "Mehr Reviews," : "More reviews,",
        headlineHighlight: locale === "de" ? "ehrlich getestet." : "honestly tested.",
        articleUrl: `toolwiki.ai/${article.slug}`,
        toolRecap: resolvedTools.map((t) => t.slug),
        ...(input.winner !== undefined && {
          closer: {
            pattern: "verdict_recap" as const,
            line1: {
              leadText: input.winner === "depends"
                ? (locale === "de" ? "Unser Fazit:" : "Our verdict:")
                : (locale === "de" ? "Unser Sieger:" : "Our winner:"),
              highlightText: input.winner === "depends"
                ? (locale === "de" ? "kommt drauf an" : "depends")
                : (input.tools.find((t) => t.slug === input.winner)?.name ?? input.winner),
              trailText: ".",
            },
            line2: {
              leadText: locale === "de" ? "Speichere für" : "Save for",
              highlightText: locale === "de" ? "später" : "later",
              trailText: ".",
            },
            fullText: input.winner,
          },
        }),
      },
    };

    const socialModule = await import("../../../render-server.ts") as unknown as {
      renderListCarouselStunning: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderListCarouselStunning(carouselInput as unknown as Record<string, unknown>);

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "comparison-stunning-3",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption: context.generatedContent?.caption ?? fallbackCaption(input, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.01, templateKey: "comparison-stunning-3" },
    };
  },

  mockFixtures: COMPARISON_STUNNING_FIXTURES,
};

function fallbackCaption(input: ComparisonContext, locale: "de" | "en", slug: string): string {
  const toolNames = input.tools.map((t) => t.name).join(" vs. ");
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
