import type { TemplateDefinition } from "../types.ts";
import { getToolContext, type ToolContext } from "../adapters/tool.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { SINGLE_TOOL_SPOTLIGHT_FIXTURES } from "./fixtures/singleToolSpotlight.fixtures.ts";

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

  buildInput: async (article, _discovery) => {
    return getToolContext(article);
  },

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const brandTokens = context.brandTokens;

    const hasUseCaseSlide = input.useCases.length >= 3;
    const totalSlides = hasUseCaseSlide ? 5 : 4;

    const pros = input.pros.slice(0, SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems);
    const cons = input.cons.slice(0, SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.cons.maxItems);
    const features = input.features.slice(0, SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.features.maxItems);
    const useCases = input.useCases.slice(0, SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.useCases.maxItems);

    const pricingTier = (input.pricingTier === "enterprise" ? "paid" : (input.pricingTier ?? "freemium")) as "free" | "freemium" | "paid";
    const pricingLabel = buildPricingLabel(pricingTier, input.priceFrom, locale);

    const carouselInput = {
      theme,
      locale,
      slideIndex: 0,
      totalSlides,
      websiteUrl: brandTokens?.social.websiteUrl ?? "toolwiki.ai",
      instagramHandle: brandTokens?.social.instagramHandle ?? "@toolwiki.ai",
      articleSlug: article.slug,
      tool: {
        slug: input.slug,
        name: input.name,
        pros,
        cons,
        features,
        useCases,
        pricingTier,
        pricingLabel,
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
      caption: buildCaption(input, locale, article.slug),
      hashtags: buildHashtags(input, locale),
      metadata: { estimatedCostUsd: 0.006, templateKey: "single-tool-spotlight" },
    };
  },

  mockFixtures: SINGLE_TOOL_SPOTLIGHT_FIXTURES,
};

function buildPricingLabel(tier: "free" | "freemium" | "paid", priceFrom: number | undefined, locale: "de" | "en"): string {
  if (tier === "free") return locale === "de" ? "Kostenlos" : "Free";
  if (tier === "paid") {
    if (priceFrom) return locale === "de" ? `ab ${priceFrom}€/Monat` : `from $${priceFrom}/month`;
    return locale === "de" ? "Kostenpflichtig" : "Paid";
  }
  // freemium
  if (priceFrom) return locale === "de" ? `Freemium · Pro ab ${priceFrom}€/Monat` : `Freemium · Pro from $${priceFrom}/month`;
  return "Freemium";
}

function buildCaption(input: ToolContext, locale: "de" | "en", slug: string): string {
  const topPro = input.pros[0]?.text ?? "";
  if (locale === "de") {
    return (
      `${input.name} im Check — lohnt es sich wirklich?\n\n` +
      (topPro ? `Stärkstes Argument: ${topPro}\n\n` : "") +
      `Speichere diesen Post für wenn du das nächste Tool evaluierst.\n\n` +
      `→ Vollständiger Test: toolwiki.ai/${slug}`
    );
  }
  return (
    `${input.name} reviewed — is it worth it?\n\n` +
    (topPro ? `Strongest argument: ${topPro}\n\n` : "") +
    `Save this post for your next tool evaluation.\n\n` +
    `→ Full review: toolwiki.ai/${slug}`
  );
}

function buildHashtags(input: ToolContext, locale: "de" | "en"): string[] {
  const category = input.primaryCategory?.replace(/\s+/g, "") ?? "KITools";
  if (locale === "de") {
    return [
      "#KITools",
      `#${category}`,
      "#Toolwiki",
      "#KIFürBusiness",
      "#DigitalTools",
      "#SoftwareTest",
      "#Produktivität",
    ];
  }
  return [
    "#AITools",
    `#${category}`,
    "#Toolwiki",
    "#AIForBusiness",
    "#DigitalTools",
    "#SoftwareReview",
    "#Productivity",
  ];
}
