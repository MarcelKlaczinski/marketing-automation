import { articles, and, db, desc, eq } from "@marketing-auto/db";
import type { TopicBrief } from "@marketing-auto/db";
import { listToolsByClusterId } from "@marketing-auto/db";
import type { RelevantTools, ToolReference } from "./types.ts";

const MAX_PRIMARY_TOOLS = 6;
const MAX_SECONDARY_TOOLS = 3;

function toToolReference(row: typeof articles.$inferSelect): ToolReference {
  const extras = (row.domainExtras ?? {}) as Record<string, unknown>;
  const featuresRaw = Array.isArray(extras.features) ? extras.features : [];
  return {
    slug: row.slug,
    name: row.title ?? row.slug,
    pricing: row.toolPricing ?? null,
    rating: row.toolRating !== null ? parseFloat(String(row.toolRating)) : null,
    shortDescription: row.metaDescription ? row.metaDescription.slice(0, 200) : null,
    features: featuresRaw
      .filter((f): f is string => typeof f === "string")
      .slice(0, 3),
  };
}

/**
 * Resolve tools relevant to a blog article brief for prompt injection.
 *
 * Primary: tools in the same cluster as the brief (max 6).
 * Secondary: top-3 rated tools in the same category as the cluster's tools,
 *   excluding any already in the primary list.
 */
export async function resolveRelevantTools(
  projectId: string,
  brief: TopicBrief,
  locale: "de" | "en",
): Promise<RelevantTools> {
  // ── Primary: cluster-matched tools ────────────────────────────────────────────
  let primaryRows: Array<typeof articles.$inferSelect> = [];
  if (brief.clusterId) {
    const clusterTools = await listToolsByClusterId(projectId, brief.clusterId, locale);
    primaryRows = clusterTools.slice(0, MAX_PRIMARY_TOOLS);
  }

  const primarySlugs = new Set(primaryRows.map((r) => r.slug));
  const primary = primaryRows.map(toToolReference);

  // ── Secondary: top-3 in category, excluding primary ───────────────────────────
  // Derive category from primary tools; fall back to empty secondary if no category.
  const inferredCategory = primaryRows.find((r) => r.category)?.category ?? null;

  let secondary: ToolReference[] = [];
  if (inferredCategory) {
    const categoryTools = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.collection, "tools"),
          eq(articles.category, inferredCategory),
          eq(articles.locale, locale),
        ),
      )
      .orderBy(desc(articles.toolRating))
      .limit(MAX_SECONDARY_TOOLS + MAX_PRIMARY_TOOLS); // over-fetch so we can exclude primary

    secondary = categoryTools
      .filter((r) => !primarySlugs.has(r.slug))
      .slice(0, MAX_SECONDARY_TOOLS)
      .map(toToolReference);
  }

  return { primary, secondary };
}

/**
 * Format the relevant-tools context as a prompt fragment.
 * Returns empty string if no tools are available.
 */
export function buildToolsContextFragment(tools: RelevantTools): string {
  if (tools.primary.length === 0 && tools.secondary.length === 0) return "";

  const primaryList = tools.primary
    .map(
      (t) =>
        `- ${t.name} (${t.pricing ?? "n/a"}, rating ${t.rating ?? "n/a"}/5): ${t.shortDescription ?? "no description"}`,
    )
    .join("\n");

  const secondaryList = tools.secondary
    .map((t) => `- ${t.name} (${t.pricing ?? "n/a"})`)
    .join("\n");

  const lines = [
    "**Relevant Tools (in scope of this cluster)**:",
    primaryList || "(none)",
  ];

  if (tools.secondary.length > 0) {
    lines.push("", "**Other Top Tools (in same category)**:", secondaryList);
  }

  lines.push(
    "",
    "Reference these tools naturally in the article. Mention by exact name (e.g. \"ChatGPT\", \"Claude\"). The system will auto-link mentions to product pages.",
  );

  return lines.join("\n");
}
