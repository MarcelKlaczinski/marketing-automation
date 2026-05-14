import type { Article } from "@marketing-auto/db";
import type { ProConItem } from "./types.ts";
import { KNOWN_TOOL_ICONS } from "./toolLookup.ts";

export interface ToolContext {
  slug: string;
  name: string;
  logoUrl?: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  priceFrom?: number;
  primaryCategory?: string;
  tagline?: string;
  pros: ProConItem[];
  cons: ProConItem[];
  features: string[];
  useCases: string[];
  rating?: number;
  website?: string;
  affiliateSlug?: string;
  bestFor?: string;
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
}

interface ToolExtras {
  logoUrl?: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  pricing?: string;
  priceFrom?: number;
  primaryCategory?: string;
  tagline?: string;
  pros?: Array<ProConItem | string>;
  cons?: Array<ProConItem | string>;
  features?: string[];
  useCases?: string[];
  rating?: number;
  website?: string;
  affiliateSlug?: string;
  bestFor?: string;
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
}

function normalizeProCons(items: Array<ProConItem | string>): ProConItem[] {
  return items.map((item) => (typeof item === "string" ? { text: item } : item));
}

export function getToolContext(article: Article): ToolContext {
  if (article.collection !== "tools") {
    throw new Error(`Article "${article.slug}" is not in the tools collection`);
  }

  const extras = (article.frontmatterExtras ?? {}) as ToolExtras;

  const rawName = article.title ?? article.slug;
  const ctx: ToolContext = {
    slug: article.slug,
    name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
    pros: normalizeProCons(extras.pros ?? []),
    cons: normalizeProCons(extras.cons ?? []),
    features: extras.features ?? [],
    useCases: extras.useCases ?? [],
  };

  if (extras.logoUrl !== undefined) ctx.logoUrl = extras.logoUrl;
  const resolvedPricingTier = extras.pricingTier ?? (extras.pricing as "free" | "freemium" | "paid" | "enterprise" | undefined);
  if (resolvedPricingTier !== undefined) ctx.pricingTier = resolvedPricingTier;
  if (extras.priceFrom !== undefined) ctx.priceFrom = extras.priceFrom;
  if (extras.primaryCategory !== undefined) ctx.primaryCategory = extras.primaryCategory;
  if (extras.tagline !== undefined) ctx.tagline = extras.tagline;
  if (extras.bestFor !== undefined) ctx.bestFor = extras.bestFor;
  if (extras.rating !== undefined) ctx.rating = extras.rating;
  if (extras.website !== undefined) ctx.website = extras.website;
  if (extras.affiliateSlug !== undefined) ctx.affiliateSlug = extras.affiliateSlug;
  if (extras.iconSvg !== undefined) ctx.iconSvg = extras.iconSvg;
  if (extras.iconInitials !== undefined) ctx.iconInitials = extras.iconInitials;
  if (extras.iconHue !== undefined) ctx.iconHue = extras.iconHue;

  // Apply KNOWN_TOOL_ICONS fallback when article has no icon data
  if (ctx.iconSvg === undefined && ctx.iconInitials === undefined) {
    const defaults = KNOWN_TOOL_ICONS[article.slug];
    if (defaults !== undefined) {
      if (defaults.iconSvg !== undefined) ctx.iconSvg = defaults.iconSvg;
      if (defaults.iconInitials !== undefined) ctx.iconInitials = defaults.iconInitials;
      if (defaults.iconHue !== undefined) ctx.iconHue = defaults.iconHue;
    }
  }

  return ctx;
}
