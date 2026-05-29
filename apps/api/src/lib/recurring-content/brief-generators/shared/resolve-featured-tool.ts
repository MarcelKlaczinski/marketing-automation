/**
 * V1.6.1 — resolve the `featuredTool` snapshot for Family-B brief-generators
 * (lifestyle-listicle + opinion-recommendation) at persist time.
 *
 * Post-mortem 2026-05-28: the lifestyle-listicle live narrative contained the
 * literal string `"the tool"` because the template's `buildInput()` lazy DB-
 * lookup of `formatConfig.toolIds[0]` was returning null in production (the
 * fallback `{slug:"unknown", name:"the tool"}` then propagated verbatim
 * through the Sonnet narrative-prompt — every beat dutifully said "the tool").
 *
 * Canonical fix: brief-generator stamps the resolved tool object into
 * `formatConfig.featuredTool` at emit time so the template doesn't need any
 * runtime lookup. The shape matches `FamilyBToolMention` from
 * `@marketing-auto/social` (slug + name + optional icon + brand colors).
 *
 * Best-effort: returns `null` on DB miss or query error so the caller can fall
 * back to the template-side lazy lookup (defense in depth — both layers
 * tolerate missing data).
 */
import { db, articles, eq, toolBrandAssets } from "@marketing-auto/db";

export interface FeaturedToolPayload {
  slug: string;
  name: string;
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
  primaryColor?: string;
  secondaryColor?: string;
}

const _svgCache = new Map<string, string | null>();

async function fetchSvgString(url: string): Promise<string | null> {
  const cached = _svgCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      _svgCache.set(url, null);
      return null;
    }
    const text = await res.text();
    if (!text.trimStart().startsWith("<svg")) {
      _svgCache.set(url, null);
      return null;
    }
    _svgCache.set(url, text);
    return text;
  } catch {
    _svgCache.set(url, null);
    return null;
  }
}

export async function resolveFeaturedTool(
  toolArticleId: string,
): Promise<FeaturedToolPayload | null> {
  try {
    const [row] = await db
      .select({
        slug: articles.slug,
        title: articles.title,
        domainExtras: articles.domainExtras,
        logoUrl: toolBrandAssets.logoUrl,
        primaryColor: toolBrandAssets.primaryColor,
        secondaryColor: toolBrandAssets.secondaryColor,
      })
      .from(articles)
      .leftJoin(toolBrandAssets, eq(toolBrandAssets.toolId, articles.id))
      .where(eq(articles.id, toolArticleId))
      .limit(1);
    if (!row) return null;

    const extras = row.domainExtras as
      | { iconSvg?: string; iconInitials?: string; iconHue?: number }
      | null
      | undefined;

    const tool: FeaturedToolPayload = {
      slug: row.slug,
      name: row.title ?? row.slug,
    };
    if (extras?.iconSvg) {
      tool.iconSvg = extras.iconSvg;
    } else if (row.logoUrl) {
      const fetched = await fetchSvgString(row.logoUrl);
      if (fetched) tool.iconSvg = fetched;
    }
    if (extras?.iconInitials) tool.iconInitials = extras.iconInitials;
    if (extras?.iconHue !== undefined) tool.iconHue = extras.iconHue;
    if (row.primaryColor) tool.primaryColor = row.primaryColor;
    if (row.secondaryColor) tool.secondaryColor = row.secondaryColor;
    return tool;
  } catch {
    return null;
  }
}
