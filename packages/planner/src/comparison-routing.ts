// Spec 64.18 / Phase C.2: cluster-routing for comparison_discovery briefs.
//
// Background: `discoverComparisonPairs` (Spec 62.3) creates `topic_briefs` rows
// with `source='comparison_discovery'` but historically left `cluster_id=NULL`.
// Downstream (`pipeline-router` `case "comparison"`, `BlogPipeline`) forwards
// `pipelineInput.clusterId` to `articles.cluster_id` if stamped, but never
// invented one. Result: every comparison article landed orphaned from any
// hub-spoke relationship (Discovery: 64.18 / Phase C.1).
//
// This module is the brief-creation-time resolver. It picks the best existing
// cluster in the project's "comparisons" pillar (or a project-configurable
// equivalent) for a tool pair, returning the cluster id + `clusterAction`.
// Pure-function core (`resolveComparisonCluster`) + DI-friendly loader
// (`loadComparisonClusterIndex`); both are unit-testable without the discovery
// algorithm itself.
//
// Routing precedence (matches Discovery 64.18 / Phase C.1 §5 Option 1):
//
//   1. Both tools share `subcategory` → cluster whose `matchTokens` include
//      that subcategory string → `append_to_existing`.
//   2. Either tool's `subcategory` matches a cluster's `matchTokens` →
//      `append_to_existing`. (Anchor on the chatbot/research/translation
//      bucket that the comparison cluster represents.)
//   3. Both tools share `category` AND a cluster's `matchTokens` contain that
//      category → `append_to_existing`.
//   4. No match → `clusterAction='create_new'` (the downstream
//      `pipeline-router`'s `case "comparison":` already routes this to
//      `article:blog` and the resulting article lands with `cluster_id=NULL`,
//      preserving today's behaviour for genuinely uncategorisable pairs).
//
// Multi-Domain: `pillarName` is parameterised (defaults to `"comparisons"`)
// so Bellemann / Balkonkraftwerk can reuse the resolver with a different
// pillar slug. The matcher reads `articles.subcategory` + `articles.category`
// — both promoted columns from the Spec 54.8 importer — so any tenant whose
// astro-sync writes those columns benefits automatically.

import {
  and,
  articles,
  clusters,
  contentPillars,
  db,
  eq,
  inArray,
  isNotNull,
  type Transaction,
} from "@marketing-auto/db";

export type ComparisonClusterAction = "append_to_existing" | "create_new";

/** Tool metadata used by the resolver. Mirrors `loadToolInfo`'s shape in
 *  `comparison-discovery.ts` so the resolver receives the same data the
 *  scorer already loaded. */
export interface ResolverToolInfo {
  slug: string;
  /** From `articles.category` (Spec 54.8 promoted column). */
  category: string | null;
  /** From `articles.subcategory` (Spec 54.8 promoted column). */
  subcategory: string | null;
}

/** One entry per comparison-pillar cluster. `matchTokens` collapses the
 *  cluster's member-article subcategory + category strings + the cluster's
 *  own `primaryKeyword` into a lowercased lookup set used by the resolver. */
export interface ComparisonClusterEntry {
  clusterId: string;
  clusterName: string;
  matchTokens: Set<string>;
}

export type ComparisonRoutingResolution =
  | { clusterAction: "append_to_existing"; clusterId: string; matchedBy: "subcategory" | "category" }
  | { clusterAction: "create_new"; clusterId: null; matchedBy: "none" };

/** Default pillar slug Toolwiki uses (set up via the Spec 002 / Bucket-C
 *  cleanup). Other tenants override via `loadComparisonClusterIndex`. */
export const DEFAULT_COMPARISON_PILLAR = "comparisons";

// ─── Pure resolver (no DB) ────────────────────────────────────────────────────

/**
 * Pure routing decision for one tool pair against a pre-loaded cluster index.
 *
 * Subcategory-anchored matching: if both tools share a subcategory and any
 * comparison cluster's `matchTokens` contains that subcategory string, route
 * there. Otherwise try each tool's subcategory independently (chatbot-anchor
 * pattern from Discovery §5: "ChatGPT vs DeepL" routes to
 * `chatbot-comparisons-2026` because Claude/ChatGPT are the anchors).
 *
 * Falls through to `category`-level match, then `create_new`.
 *
 * The first matching cluster wins (deterministic; spec §7 Q2 noted weighted
 * tie-breaking as a possible V2 extension).
 */
export function resolveComparisonCluster(
  toolA: ResolverToolInfo,
  toolB: ResolverToolInfo,
  clusterIndex: ComparisonClusterEntry[],
): ComparisonRoutingResolution {
  if (clusterIndex.length === 0) {
    return { clusterAction: "create_new", clusterId: null, matchedBy: "none" };
  }

  // Priority 1: both tools share subcategory → look for it in any cluster.
  if (
    toolA.subcategory &&
    toolB.subcategory &&
    toolA.subcategory.toLowerCase() === toolB.subcategory.toLowerCase()
  ) {
    const hit = findClusterByToken(clusterIndex, toolA.subcategory);
    if (hit) {
      return { clusterAction: "append_to_existing", clusterId: hit.clusterId, matchedBy: "subcategory" };
    }
  }

  // Priority 2: either tool's subcategory matches a cluster.
  for (const sub of [toolA.subcategory, toolB.subcategory]) {
    if (!sub) continue;
    const hit = findClusterByToken(clusterIndex, sub);
    if (hit) {
      return { clusterAction: "append_to_existing", clusterId: hit.clusterId, matchedBy: "subcategory" };
    }
  }

  // Priority 3: shared category → look for it in any cluster.
  if (
    toolA.category &&
    toolB.category &&
    toolA.category.toLowerCase() === toolB.category.toLowerCase()
  ) {
    const hit = findClusterByToken(clusterIndex, toolA.category);
    if (hit) {
      return { clusterAction: "append_to_existing", clusterId: hit.clusterId, matchedBy: "category" };
    }
  }

  return { clusterAction: "create_new", clusterId: null, matchedBy: "none" };
}

function findClusterByToken(
  clusterIndex: ComparisonClusterEntry[],
  token: string,
): ComparisonClusterEntry | null {
  const needle = token.toLowerCase();
  for (const entry of clusterIndex) {
    if (entry.matchTokens.has(needle)) return entry;
  }
  return null;
}

// ─── DB loader ────────────────────────────────────────────────────────────────

/**
 * Build the cluster-index for a project by joining `clusters` → `articles`
 * filtered on the configured pillar. The resulting `matchTokens` per cluster
 * collapses every distinct `articles.subcategory` + `articles.category` of
 * member articles, plus the cluster's `primaryKeyword`, into a lowercased
 * lookup Set.
 *
 * Called ONCE per `discoverComparisonPairs` invocation, before `persistPairs`
 * runs the pair loop. Tx-aware so callers running inside an outer transaction
 * (currently none — `persistPairs` opens its own; future Phase-A cleanup
 * scripts might want shared-tx semantics) can pass it through.
 */
export async function loadComparisonClusterIndex(
  projectId: string,
  options: { pillarName?: string; tx?: Transaction } = {},
): Promise<ComparisonClusterEntry[]> {
  const pillarName = options.pillarName ?? DEFAULT_COMPARISON_PILLAR;
  const dbHandle = options.tx ?? db;

  // Two queries: (1) cluster rows in the pillar, (2) the distinct subcategory +
  // category per cluster derived from the project's articles. Cheaper than a
  // SELECT with subqueries — both queries are pillar-scoped and indexed.
  const pillarClusterRows = await dbHandle
    .select({
      id: clusters.id,
      name: clusters.name,
      primaryKeyword: clusters.primaryKeyword,
    })
    .from(clusters)
    .innerJoin(contentPillars, eq(contentPillars.id, clusters.pillarId))
    .where(and(eq(clusters.projectId, projectId), eq(contentPillars.name, pillarName)));

  if (pillarClusterRows.length === 0) return [];

  const clusterIds = pillarClusterRows.map((r) => r.id);
  const memberArticleRows = await dbHandle
    .select({
      clusterId: articles.clusterId,
      category: articles.category,
      subcategory: articles.subcategory,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        isNotNull(articles.clusterId),
        inArray(articles.clusterId, clusterIds),
      ),
    );

  const tokensByCluster = new Map<string, Set<string>>();
  for (const cl of pillarClusterRows) {
    const tokens = new Set<string>();
    if (cl.primaryKeyword) tokens.add(cl.primaryKeyword.toLowerCase());
    // Seed each cluster from its own `name` so a cluster named
    // `chatbot-comparisons-2026` is reachable even without member articles.
    tokens.add(cl.name.toLowerCase());
    for (const segment of cl.name.toLowerCase().split(/[-_\s]+/).filter(Boolean)) {
      tokens.add(segment);
    }
    tokensByCluster.set(cl.id, tokens);
  }

  for (const row of memberArticleRows) {
    if (!row.clusterId) continue;
    const set = tokensByCluster.get(row.clusterId);
    if (!set) continue;
    if (row.subcategory) set.add(row.subcategory.toLowerCase());
    if (row.category) set.add(row.category.toLowerCase());
  }

  const entries: ComparisonClusterEntry[] = pillarClusterRows.map((cl) => {
    const tokens = tokensByCluster.get(cl.id) ?? new Set<string>();
    return { clusterId: cl.id, clusterName: cl.name, matchTokens: tokens };
  });
  return entries;
}
