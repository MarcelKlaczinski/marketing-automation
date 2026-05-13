import { db, articles, and, eq, inArray } from "@marketing-auto/db";
import type { ToolReference } from "./types.ts";

export async function buildToolLookup(
  toolSlugs: string[],
  locale: "de" | "en",
  projectId: string,
): Promise<Map<string, ToolReference>> {
  if (toolSlugs.length === 0) return new Map();

  const toolArticles = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.locale, locale),
        inArray(articles.slug, toolSlugs),
      ),
    );

  return new Map(
    toolArticles.map((t) => {
      const extras = (t.frontmatterExtras ?? {}) as {
        logoUrl?: string;
        pricingTier?: "free" | "freemium" | "paid" | "enterprise";
        priceFrom?: number;
        primaryCategory?: string;
        endSlideToken?: string;
        iconSvg?: string;
        iconInitials?: string;
        iconHue?: number;
      };

      const ref: ToolReference = { slug: t.slug, name: t.title ?? t.slug };
      if (extras.logoUrl !== undefined) ref.logoUrl = extras.logoUrl;
      if (extras.pricingTier !== undefined) ref.pricingTier = extras.pricingTier;
      if (extras.priceFrom !== undefined) ref.priceFrom = extras.priceFrom;
      if (extras.primaryCategory !== undefined) ref.primaryCategory = extras.primaryCategory;
      if (extras.endSlideToken !== undefined) ref.endSlideToken = extras.endSlideToken;
      if (extras.iconSvg !== undefined) ref.iconSvg = extras.iconSvg;
      if (extras.iconInitials !== undefined) ref.iconInitials = extras.iconInitials;
      if (extras.iconHue !== undefined) ref.iconHue = extras.iconHue;

      return [t.slug, ref];
    }),
  );
}
