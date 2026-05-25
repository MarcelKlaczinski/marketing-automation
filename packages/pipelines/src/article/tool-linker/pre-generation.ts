import {
  articles,
  and,
  contentSourceInventory,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
} from "@marketing-auto/db";
import type { GithubInventoryMetadata, TopicBrief } from "@marketing-auto/db";
import { listToolsByClusterId } from "@marketing-auto/db";
import type { GithubFacts, RelevantTools, ToolReference } from "./types.ts";

const MAX_PRIMARY_TOOLS = 6;
const MAX_SECONDARY_TOOLS = 3;

function toToolReference(
  row: typeof articles.$inferSelect,
  github: GithubFacts | null,
): ToolReference {
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
    github,
  };
}

/**
 * Spec 64.20: batch-load GitHub facts for a set of tool articles. Returns a
 * Map<articleId, GithubFacts | null> — null means "no inventory row OR not
 * yet fetched OR unapproved". Single query, indexed by `article_id`.
 */
async function loadGithubFactsByArticleId(
  articleIds: string[],
): Promise<Map<string, GithubFacts>> {
  const result = new Map<string, GithubFacts>();
  if (articleIds.length === 0) return result;

  const rows = await db
    .select({
      articleId: contentSourceInventory.articleId,
      metadata: contentSourceInventory.githubMetadata,
      lastFetchedAt: contentSourceInventory.lastFetchedAt,
    })
    .from(contentSourceInventory)
    .where(
      and(
        inArray(contentSourceInventory.articleId, articleIds),
        eq(contentSourceInventory.fetchStatus, "ok"),
        isNotNull(contentSourceInventory.approvedAt),
        isNotNull(contentSourceInventory.lastFetchedAt),
      ),
    );

  for (const row of rows) {
    if (!row.articleId || !row.lastFetchedAt) continue;
    const m = row.metadata as GithubInventoryMetadata;
    result.set(row.articleId, {
      starsCount: m.starsCount,
      forksCount: m.forksCount,
      primaryLanguage: m.primaryLanguage,
      license: m.license,
      latestRelease: m.latestRelease
        ? { tag: m.latestRelease.tag, publishedAt: m.latestRelease.publishedAt }
        : null,
      lastFetchedAt: row.lastFetchedAt.toISOString(),
    });
  }
  return result;
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

  // ── Secondary: top-3 in category, excluding primary ───────────────────────────
  // Derive category from primary tools; fall back to empty secondary if no category.
  const inferredCategory = primaryRows.find((r) => r.category)?.category ?? null;

  let secondaryRows: Array<typeof articles.$inferSelect> = [];
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

    secondaryRows = categoryTools
      .filter((r) => !primarySlugs.has(r.slug))
      .slice(0, MAX_SECONDARY_TOOLS);
  }

  // ── Spec 64.20: batch-load GitHub facts for all selected tools ───────────────
  const allArticleIds = [...primaryRows.map((r) => r.id), ...secondaryRows.map((r) => r.id)];
  const githubByArticleId = await loadGithubFactsByArticleId(allArticleIds);

  const primary = primaryRows.map((r) => toToolReference(r, githubByArticleId.get(r.id) ?? null));
  const secondary = secondaryRows.map((r) =>
    toToolReference(r, githubByArticleId.get(r.id) ?? null),
  );

  return { primary, secondary };
}

/**
 * Render a tool's GitHub facts as a compact suffix for the prompt fragment.
 * Returns empty string when no facts are available — caller decides whether
 * to drop the suffix or leave a trailing space.
 *
 * Format: ` · GitHub: 25,000⭐ · MIT · Latest: v1.0.0 (Dec 2024)`
 */
function renderGithubFactsSuffix(facts: GithubFacts | null): string {
  if (!facts) return "";
  const parts: string[] = [`${facts.starsCount.toLocaleString("en-US")}⭐`];
  if (facts.license && facts.license !== "no-license") parts.push(facts.license);
  if (facts.latestRelease) {
    const date = new Date(facts.latestRelease.publishedAt);
    const ym = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    parts.push(`Latest: ${facts.latestRelease.tag} (${ym})`);
  }
  return ` · GitHub: ${parts.join(" · ")}`;
}

/**
 * Format the relevant-tools context as a prompt fragment.
 * Returns empty string if no tools are available.
 *
 * Spec 64.20: when a tool has approved+fetched GitHub data, a compact facts
 * suffix is appended so the LLM can back factual claims with real numbers.
 */
export function buildToolsContextFragment(tools: RelevantTools): string {
  if (tools.primary.length === 0 && tools.secondary.length === 0) return "";

  const primaryList = tools.primary
    .map(
      (t) =>
        `- ${t.name} (${t.pricing ?? "n/a"}, rating ${t.rating ?? "n/a"}/5): ${t.shortDescription ?? "no description"}${renderGithubFactsSuffix(t.github)}`,
    )
    .join("\n");

  const secondaryList = tools.secondary
    .map((t) => `- ${t.name} (${t.pricing ?? "n/a"})${renderGithubFactsSuffix(t.github)}`)
    .join("\n");

  const lines = [
    "**Relevant Tools (in scope of this cluster)**:",
    primaryList || "(none)",
  ];

  if (tools.secondary.length > 0) {
    lines.push("", "**Other Top Tools (in same category)**:", secondaryList);
  }

  const hasAnyGithub =
    tools.primary.some((t) => t.github !== null) ||
    tools.secondary.some((t) => t.github !== null);

  if (hasAnyGithub) {
    lines.push(
      "",
      "Use GitHub facts (stars, license, latest release) shown above to back factual claims. Do NOT invent star counts or release dates — when a tool has no GitHub suffix, simply omit those claims rather than fabricating numbers.",
    );
  }

  lines.push(
    "",
    "Reference these tools naturally in the article. Mention by exact name (e.g. \"ChatGPT\", \"Claude\"). The system will auto-link mentions to product pages.",
  );

  return lines.join("\n");
}
