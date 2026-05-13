import type { Article } from "@marketing-auto/db";
import type { ProConItem } from "./types.ts";

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
  bestFor?: string;
  iconSvg?: string;
}

interface ToolExtras {
  logoUrl?: string;
  pricingTier?: "free" | "freemium" | "paid" | "enterprise";
  priceFrom?: number;
  primaryCategory?: string;
  tagline?: string;
  pros?: ProConItem[];
  cons?: ProConItem[];
  bestFor?: string;
  iconSvg?: string;
}

export function getToolContext(article: Article): ToolContext {
  if (article.collection !== "tools") {
    throw new Error(`Article "${article.slug}" is not in the tools collection`);
  }

  const extras = (article.frontmatterExtras ?? {}) as ToolExtras;

  return {
    slug: article.slug,
    name: article.title ?? article.slug,
    pros: extras.pros ?? [],
    cons: extras.cons ?? [],
    ...(extras.logoUrl !== undefined && { logoUrl: extras.logoUrl }),
    ...(extras.pricingTier !== undefined && { pricingTier: extras.pricingTier }),
    ...(extras.priceFrom !== undefined && { priceFrom: extras.priceFrom }),
    ...(extras.primaryCategory !== undefined && { primaryCategory: extras.primaryCategory }),
    ...(extras.tagline !== undefined && { tagline: extras.tagline }),
    ...(extras.bestFor !== undefined && { bestFor: extras.bestFor }),
    ...(extras.iconSvg !== undefined && { iconSvg: extras.iconSvg }),
  };
}
