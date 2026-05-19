import { z } from "zod";
import type { TemplateDefinition, ContentBounds } from "../types.ts";
import { getToolContext, type ToolContext } from "../adapters/tool.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { singleToolSpotlightOverridesSchema } from "../overrides/singleToolSpotlight.overrides.ts";
import { SINGLE_TOOL_SPOTLIGHT_FIXTURES } from "./fixtures/singleToolSpotlight.fixtures.ts";
import {
  generateContentWithGate,
  inferArticleType,
  selectPattern,
} from "@marketing-auto/core";

export const singleToolSpotlightBounds = {
  pros: { max: 5, perItemMaxChars: 80 },
  cons: { max: 4, perItemMaxChars: 80 },
  features: { max: 6, perItemMaxChars: 80 },
  useCases: { max: 4, perItemMaxChars: 80 },
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
} as const satisfies ContentBounds;

export const singleToolSpotlightGeneratedSchema = z.object({
  caption: z.string().min(singleToolSpotlightBounds.captionBody.min).max(singleToolSpotlightBounds.captionBody.max),
  hashtags: z.array(z.string().max(singleToolSpotlightBounds.hashtags.perItemMaxChars)).max(singleToolSpotlightBounds.hashtags.max),
});
export type SingleToolSpotlightGenerated = z.infer<typeof singleToolSpotlightGeneratedSchema>;

// Parsed default ensures brandTokens.social.* are never undefined in single-tool renders
const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});

const SLIDE_W = 1080;
const SLIDE_H = 1350;

const SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS = {
  minTools: 1,
  maxTools: 1,
  minSlides: 4,
  maxSlides: 5,
  eligibleCollections: ["tools"],
  fieldBounds: {
    pros:     { minItems: 2, maxItems: 5 },
    cons:     { minItems: 0, maxItems: 4 },
    features: { minItems: 0, maxItems: 6 },
    useCases: { minItems: 0, maxItems: 4 },
  },
};

export const singleToolSpotlightTemplate: TemplateDefinition<ToolContext> = {
  key: "single-tool-spotlight",
  displayName: "Single-Tool-Spotlight",
  description:
    "4–5 Slides für einen einzelnen Tool-Article: Cover, Stärken, Pricing & Für-wen, CTA. Slide 5 optional wenn ≥3 Use-Cases vorhanden.",
  defaultSlideCount: 4,
  estimatedCostUsd: 0.006,

  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "tool-spotlight",
    estimatedEngagementTier: "medium",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  bounds: singleToolSpotlightBounds,
  generatedSchema: singleToolSpotlightGeneratedSchema,
  slotMap: {},

  eligibility: (article, _discovery) => {
    if (article.collection !== "tools") {
      return { eligible: false, reason: "Nur für tools-Collection" };
    }

    const extras = (article.frontmatterExtras ?? {}) as {
      pros?: Array<{ text: string } | string>;
      pricingTier?: string;
      pricing?: string;
    };

    const pros = extras.pros ?? [];
    if (pros.length < SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.minItems) {
      return {
        eligible: false,
        reason: `Benötigt mindestens ${SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.minItems} Pros`,
        requirements: [`frontmatter.pros.length >= ${SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.minItems}`],
      };
    }
    if (pros.length > SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems) {
      return {
        eligible: false,
        reason: `Zu viele Pros (max. ${SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems})`,
        requirements: [`frontmatter.pros.length <= ${SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems}`],
      };
    }

    if (!extras.pricingTier && !extras.pricing) {
      return {
        eligible: false,
        reason: "Pricing-Feld fehlt",
        requirements: ["frontmatter.pricingTier oder frontmatter.pricing"],
      };
    }

    return { eligible: true };
  },

  generateContent: async (article, input, locale, llmCaller) => {
    const ctx = input as ToolContext;
    const articleType = inferArticleType(article.title ?? article.slug, 1);
    const pattern = selectPattern(article.id, articleType);
    return generateContentWithGate(
      { id: article.id, title: article.title ?? article.slug, toolCount: 1, toolNames: [ctx.name] },
      pattern,
      {
        articleTitle: article.title ?? article.slug,
        toolNames: [ctx.name],
        primaryKeyword: ctx.name,
        locale,
        articleSlug: article.slug,
        contentType: "tool-spotlight",
      },
      llmCaller,
    );
  },

  buildInput: async (article, _discovery) => {
    return getToolContext(article);
  },

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;
    const resolvedOverrides = singleToolSpotlightOverridesSchema.parse(context.overrides ?? {});

    const hasUseCaseSlide = input.useCases.length >= 3;
    const totalSlides = hasUseCaseSlide ? 5 : 4;

    const pros = input.pros.slice(0, SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems);
    const cons = input.cons.slice(0, SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.cons.maxItems);
    const features = input.features.slice(0, SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.features.maxItems);
    const useCases = input.useCases.slice(0, SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.useCases.maxItems);

    const pricingTier = (input.pricingTier === "enterprise" ? "paid" : (input.pricingTier ?? "freemium")) as "free" | "freemium" | "paid";

    const carouselInput = {
      theme,
      locale,
      slideIndex: 0,
      totalSlides,
      brandTokens,
      overrides: resolvedOverrides,
      articleSlug: article.slug,
      tool: {
        slug: input.slug,
        name: input.name,
        pros,
        cons,
        features,
        useCases,
        pricingTier,
        ...(input.tagline !== undefined && { tagline: input.tagline }),
        ...(input.website !== undefined && { website: input.website }),
        ...(input.primaryCategory !== undefined && { primaryCategory: input.primaryCategory }),
        ...(input.priceFrom !== undefined && { priceFrom: input.priceFrom }),
        ...(input.rating !== undefined && { rating: input.rating }),
        ...(input.affiliateSlug !== undefined && { affiliateSlug: input.affiliateSlug }),
        ...(input.iconSvg !== undefined && { iconSvg: input.iconSvg }),
        ...(input.iconInitials !== undefined && { iconInitials: input.iconInitials }),
        ...(input.iconHue !== undefined && { iconHue: input.iconHue }),
      },
    };

    // Dynamic import — avoids bundling Remotion into non-render contexts
    const socialModule = await import("../../../render-server.ts") as unknown as {
      renderSingleToolSpotlight: (
        input: Record<string, unknown>,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };

    const { slides: buffers } = await socialModule.renderSingleToolSpotlight(
      carouselInput as unknown as Record<string, unknown>,
    );

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "single-tool-spotlight",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption: context.generatedContent?.caption ?? fallbackCaption(input, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(input, locale),
      metadata: { estimatedCostUsd: 0.006, templateKey: "single-tool-spotlight" },
    };
  },

  mockFixtures: SINGLE_TOOL_SPOTLIGHT_FIXTURES,
};

function fallbackCaption(input: ToolContext, locale: "de" | "en", slug: string): string {
  const topPro = input.pros[0]?.text ?? "";
  if (locale === "de") {
    return (
      `${input.name} im Check — lohnt es sich wirklich?\n\n` +
      (topPro ? `Stärkstes Argument: ${topPro}\n\n` : "") +
      `Speicher diesen Post für deine nächste Tool-Evaluierung.\n\n` +
      `→ toolwiki.ai/${slug}`
    );
  }
  return (
    `${input.name} reviewed — is it worth it?\n\n` +
    (topPro ? `Strongest argument: ${topPro}\n\n` : "") +
    `Save this post for your next tool evaluation.\n\n` +
    `→ toolwiki.ai/${slug}`
  );
}

function fallbackHashtags(input: ToolContext, locale: "de" | "en"): string[] {
  const category = input.primaryCategory?.replace(/\s+/g, "") ?? "KITool";
  if (locale === "de") {
    return [
      "#KITools",
      "#AITools",
      `#${category}`,
      "#KIFürBusiness",
      "#AIForBusiness",
      "#SoftwareTest",
      "#Produktivität",
    ];
  }
  return [
    "#AITools",
    `#${category}`,
    "#AIForBusiness",
    "#DigitalTools",
    "#SoftwareReview",
    "#Productivity",
    "#TechTools",
  ];
}
