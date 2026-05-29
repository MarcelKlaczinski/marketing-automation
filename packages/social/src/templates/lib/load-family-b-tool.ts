/**
 * V1.6.1 (Spec 65.5 + 65.8 followup) — shared Family-B tool resolver.
 *
 * Extracted from `lifestyleListicle.ts` so `opinionRecommendation.ts` can reuse
 * the same lazy DB-lookup chain that fills the gap when a legacy brief was
 * persisted without a stamped `featuredTool` / `recommendedTool` object.
 *
 * Resolution:
 *   1. Query `articles` row by id + LEFT JOIN `tool_brand_assets` for logo +
 *      brand colors. Tool icon fast-path via `domainExtras.iconSvg` (Spec 52a).
 *   2. Best-effort SVG fetch when only a R2 `logoUrl` is available. Failure
 *      falls through to the initials-avatar render path.
 *   3. Returns `null` on any DB / network error so the caller can apply its
 *      own fallback (e.g. article-title placeholder, throw, etc.).
 *
 * Lazy `await import("@marketing-auto/db")` keeps the package cold-path-cheap
 * when consumers only need eligibility/buildInput-shape (tests, registry).
 */
import type { FamilyBToolMention } from "../../compositions/_shared/family-b/types.ts";

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
    // Defensive: only accept actual SVG markup, never HTML pages (R2 misroute).
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

export async function loadFamilyBToolFromArticleId(
  toolArticleId: string,
  _projectId: string,
): Promise<FamilyBToolMention | null> {
  try {
    const { db, articles, toolBrandAssets, eq } = await import("@marketing-auto/db");
    // tool_brand_assets is TOOL-SCOPED, not project-scoped (PK = tool_id).
    // Same Claude logo serves every project; no project_id column.
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

    const tool: FamilyBToolMention = {
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
