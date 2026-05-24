// Spec 62.3: Comparison-Pair Discovery.
//
// Library export consumed by:
//   - POST /api/projects/:slug/comparison-discovery/run  (manual trigger)
//   - 62.4 Planner pipeline (alongside trend/gap/refresh briefs as candidate pool)
//
// Algorithm:
//   1. Load `(articleId, referencedTools[], publishedAt)` rows from article_discovery JOIN articles
//      for the project. Phase 1 data source: existing per-article tool references derived from
//      frontmatter (comparison.toolSlugs / blog.primaryTool / usecases.featured+primary).
//   2. Build co-mention matrix: for each article with >= 2 referenced tools, enumerate all
//      canonicalized (a, b) pairs with a < b alphabetically.
//   3. Fetch tool display names + categories from `articles WHERE collection='tools'`.
//   4. Score each pair: normalized coMentionCount + categoryOverlap + recency boost.
//   5. Filter by minCoMentionCount / minScore.
//   6. Optionally exclude pairs already covered by an existing 'comparisons' article.
//   7. Upsert into topic_briefs (source='comparison_discovery') via the partial unique index.

import {
  and,
  articleDiscovery,
  articles,
  ComparisonMetadataSchema,
  db,
  eq,
  inArray,
  isNotNull,
  sql,
  topicBriefs,
  type ComparisonMetadata,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import {
  loadComparisonClusterIndex,
  resolveComparisonCluster,
  type ComparisonClusterEntry,
  type ResolverToolInfo,
} from "./comparison-routing.ts";

const log = createLogger("planner:comparison-discovery");

export interface DiscoverComparisonPairsInput {
  projectId: string;
  /** Minimum number of co-mentioning articles required to consider a pair. Default 2. */
  minCoMentionCount?: number;
  /** Minimum score (0–1) for a pair to be persisted. Default 0.25 (Spec 63.3b: lowered from 0.3 to compensate for the new cross-category penalty pulling scores down ~0.05). */
  minScore?: number;
  /** Skip pairs already covered by a `collection='comparisons'` article. Default true. */
  excludeExistingComparisons?: boolean;
  /** Cap on rows persisted in one run. Default 50. */
  topNToPersist?: number;
  // Spec 63.3b: score-formula knobs. Defaults shift weight from raw popularity
  // (coMention) toward semantic fit (same-category) and add a small penalty for
  // cross-category pairs. Marcel can re-tune post-merge without code changes.
  /** Weight applied to coMentionCount / maxCoMention. Default 0.4 (was 0.6 pre-63.3b). */
  coMentionWeight?: number;
  /** Bonus added when both tools share the same primary category. Default 0.4 (was 0.2). */
  categoryOverlapBonus?: number;
  /** Penalty subtracted when categories differ. Default 0.05 (was 0). */
  crossCategoryPenalty?: number;
  /** Weight applied to recencyBoost (0..1). Default 0.2 (unchanged). */
  recencyWeight?: number;
  // Spec 64.18 / Phase C.2: per-tenant pillar slug for cluster-routing. Defaults
  // to "comparisons" (Toolwiki convention from Spec 002 / Bucket-C cleanup).
  // Bellemann / Balkonkraftwerk override via the HTTP route body or planner
  // config when their own comparison pillar lands.
  comparisonPillarName?: string;
}

export interface ComparisonDiscoveryResult {
  projectId: string;
  pairsFound: number;
  pairsScored: number;
  pairsAboveThreshold: number;
  pairsPersisted: number;
  topPairs: ComparisonMetadata[];
  durationMs: number;
}

interface RawCoMention {
  articleId: string;
  referencedTools: string[];
  effectiveDate: Date;
}

interface PairAggregate {
  toolASlug: string;
  toolBSlug: string;
  coMentionArticleIds: string[];
  mostRecentMentionAt: Date;
}

interface ToolInfo {
  slug: string;
  name: string;
  /** Resolved per the Spec 63.3b cascade (subcategory → category → legacy
   *  domainExtras.primaryCategory). This is what `computePairScore` uses for
   *  same-category bonus. The raw `subcategory` + `category` are kept on the
   *  same struct so Spec 64.18 cluster-routing can prefer subcategory match
   *  over the combined "category" alias. */
  category: string | null;
  /** Raw `articles.subcategory` (Spec 54.8 promoted column). Spec 64.18. */
  subcategory: string | null;
  /** Raw `articles.category` (Spec 54.8 promoted column). Spec 64.18. */
  rawCategory: string | null;
}

const DEFAULT_MIN_CO_MENTION = 2;
// Spec 63.3b: lowered 0.3 → 0.25 because the new score formula adds a
// cross-category penalty (-0.05) that pulls every pair down until tool-category
// metadata is backfilled. The 0.05 delta restores the borderline behaviour the
// pre-63.3b threshold (0.3 without penalty) was producing.
const DEFAULT_MIN_SCORE = 0.25;
const DEFAULT_TOP_N_PERSIST = 50;
// Spec 63.3b: score-formula defaults (positive weights sum to 1.0).
const DEFAULT_COMENTION_WEIGHT = 0.4;
const DEFAULT_CATEGORY_OVERLAP_BONUS = 0.4;
const DEFAULT_CROSS_CATEGORY_PENALTY = 0.05;
const DEFAULT_RECENCY_WEIGHT = 0.2;

export interface ScoreWeights {
  coMentionWeight: number;
  categoryOverlapBonus: number;
  crossCategoryPenalty: number;
  recencyWeight: number;
}

export interface ScoreInputs {
  coMentionCount: number;
  maxCoMention: number;
  categoryOverlap: boolean;
  recencyBoost: number;
}

/**
 * Spec 63.3b: pure score computation, exported for unit-testing the formula
 * independently of the DB pipeline. Defaults match the post-63.3b weights;
 * call sites that need bespoke knobs pass them explicitly.
 */
export function computePairScore(inputs: ScoreInputs, weights?: Partial<ScoreWeights>): number {
  const w = {
    coMentionWeight: weights?.coMentionWeight ?? DEFAULT_COMENTION_WEIGHT,
    categoryOverlapBonus: weights?.categoryOverlapBonus ?? DEFAULT_CATEGORY_OVERLAP_BONUS,
    crossCategoryPenalty: weights?.crossCategoryPenalty ?? DEFAULT_CROSS_CATEGORY_PENALTY,
    recencyWeight: weights?.recencyWeight ?? DEFAULT_RECENCY_WEIGHT,
  };
  const coMentionComponent =
    inputs.maxCoMention > 0 ? inputs.coMentionCount / inputs.maxCoMention : 0;
  const categoryComponent = inputs.categoryOverlap
    ? w.categoryOverlapBonus
    : -w.crossCategoryPenalty;
  return round3(
    coMentionComponent * w.coMentionWeight +
      categoryComponent +
      inputs.recencyBoost * w.recencyWeight,
  );
}

export async function discoverComparisonPairs(
  input: DiscoverComparisonPairsInput,
): Promise<ComparisonDiscoveryResult> {
  const start = Date.now();
  const {
    projectId,
    minCoMentionCount = DEFAULT_MIN_CO_MENTION,
    minScore = DEFAULT_MIN_SCORE,
    excludeExistingComparisons = true,
    topNToPersist = DEFAULT_TOP_N_PERSIST,
  } = input;
  // Spec 63.3b: pull score weights with the new defaults; callers can override.
  const weights: ScoreWeights = {
    coMentionWeight: input.coMentionWeight ?? DEFAULT_COMENTION_WEIGHT,
    categoryOverlapBonus: input.categoryOverlapBonus ?? DEFAULT_CATEGORY_OVERLAP_BONUS,
    crossCategoryPenalty: input.crossCategoryPenalty ?? DEFAULT_CROSS_CATEGORY_PENALTY,
    recencyWeight: input.recencyWeight ?? DEFAULT_RECENCY_WEIGHT,
  };

  // 1. Load co-mention raw data.
  const rawRows = await loadArticleTools(projectId);

  // 2. Build aggregate map keyed by canonical "a|b".
  const aggregates = buildAggregateMap(rawRows);

  // 3. Filter by minCoMentionCount BEFORE the (expensive) tool-info join.
  const survivors = [...aggregates.values()].filter(
    (a) => a.coMentionArticleIds.length >= minCoMentionCount,
  );

  if (survivors.length === 0) {
    return emptyResult(projectId, aggregates.size, 0, 0, 0, start);
  }

  // 4. Resolve tool info (name + category) for every slug in surviving pairs.
  const uniqueSlugs = uniqueSlugSet(survivors);
  const toolInfoBySlug = await loadToolInfo(projectId, uniqueSlugs);

  // 5. Score and build payloads.
  const maxCoMention = Math.max(...survivors.map((a) => a.coMentionArticleIds.length));
  const allScored = survivors.map((agg) => buildPayload(agg, toolInfoBySlug, maxCoMention, weights));

  // 6. Filter by minScore.
  const aboveThreshold = allScored.filter((p) => p.score >= minScore);

  // 7. Exclude pairs already covered.
  const filtered = excludeExistingComparisons
    ? await excludeCoveredPairs(projectId, aboveThreshold)
    : aboveThreshold;

  // 8. Cap + persist.
  const sorted = [...filtered].sort((a, b) => b.score - a.score);
  const toPersist = sorted.slice(0, topNToPersist);

  // Spec 64.18 / Phase C.2: stamp `clusterId` + `clusterAction` on each brief
  // at creation time so downstream `pipeline-router` `case "comparison":` can
  // route the article into the matched comparison-pillar cluster instead of
  // leaving it orphaned (Discovery 64.18 / Phase C.1 §1 root cause).
  const clusterIndex =
    toPersist.length > 0
      ? await loadComparisonClusterIndex(
          projectId,
          input.comparisonPillarName ? { pillarName: input.comparisonPillarName } : {},
        )
      : [];
  await persistPairs(projectId, toPersist, toolInfoBySlug, clusterIndex);

  const routedCount = countRoutedToCluster(toPersist, toolInfoBySlug, clusterIndex);
  log.info(
    {
      projectId,
      pairsFound: aggregates.size,
      pairsScored: allScored.length,
      pairsAboveThreshold: aboveThreshold.length,
      pairsPersisted: toPersist.length,
      pairsRoutedToCluster: routedCount,
      pairsAwaitingCluster: toPersist.length - routedCount,
    },
    "comparison-discovery: complete",
  );

  return {
    projectId,
    pairsFound: aggregates.size,
    pairsScored: allScored.length,
    pairsAboveThreshold: aboveThreshold.length,
    pairsPersisted: toPersist.length,
    topPairs: sorted.slice(0, 20),
    durationMs: Date.now() - start,
  };
}

// ─── 1. Load raw co-mention data ──────────────────────────────────────────────

async function loadArticleTools(projectId: string): Promise<RawCoMention[]> {
  const rows = await db
    .select({
      articleId: articleDiscovery.articleId,
      referencedTools: articleDiscovery.referencedTools,
      publishedAt: articles.publishedAt,
      createdAt: articles.createdAt,
    })
    .from(articleDiscovery)
    .innerJoin(articles, eq(articles.id, articleDiscovery.articleId))
    .where(
      and(
        eq(articles.projectId, projectId),
        isNotNull(articleDiscovery.referencedTools),
        sql`array_length(${articleDiscovery.referencedTools}, 1) >= 2`,
      ),
    );

  return rows.map((r) => ({
    articleId: r.articleId,
    referencedTools: r.referencedTools ?? [],
    effectiveDate: r.publishedAt ?? r.createdAt,
  }));
}

// ─── 2. Aggregate co-mentions per canonical pair ──────────────────────────────

function buildAggregateMap(rows: RawCoMention[]): Map<string, PairAggregate> {
  const map = new Map<string, PairAggregate>();
  for (const row of rows) {
    const slugs = uniqueSorted(row.referencedTools);
    if (slugs.length < 2) continue;
    for (let i = 0; i < slugs.length - 1; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const a = slugs[i];
        const b = slugs[j];
        if (!a || !b || a === b) continue;
        const key = `${a}|${b}`;
        const existing = map.get(key);
        if (existing) {
          existing.coMentionArticleIds.push(row.articleId);
          if (row.effectiveDate > existing.mostRecentMentionAt) {
            existing.mostRecentMentionAt = row.effectiveDate;
          }
        } else {
          map.set(key, {
            toolASlug: a,
            toolBSlug: b,
            coMentionArticleIds: [row.articleId],
            mostRecentMentionAt: row.effectiveDate,
          });
        }
      }
    }
  }
  return map;
}

function uniqueSorted(slugs: string[]): string[] {
  return [...new Set(slugs.map((s) => s.trim()).filter(Boolean))].sort();
}

function uniqueSlugSet(aggs: PairAggregate[]): string[] {
  const set = new Set<string>();
  for (const a of aggs) {
    set.add(a.toolASlug);
    set.add(a.toolBSlug);
  }
  return [...set];
}

// ─── 3. Tool info lookup ──────────────────────────────────────────────────────

async function loadToolInfo(projectId: string, slugs: string[]): Promise<Map<string, ToolInfo>> {
  if (slugs.length === 0) return new Map();
  // Spec 63.3b lookup order (post-investigation 2026-05-21):
  //   1. `articles.subcategory` — 13-bucket editorial taxonomy from Astro toolwiki
  //                                (chatbots-assistants / code-assistants / image-generation /
  //                                etc.); matches the discovery's "vergleichbare Paare" intent
  //                                1:1 with each bucket holding ≥3 tools.
  //   2. `articles.category`    — 7-bucket top-level taxonomy (text-language / business-
  //                                productivity / images-graphics / ...); too coarse to drive
  //                                comparison bonuses on its own (Translation + Research +
  //                                Chatbots all collapse to text-language) but a valid
  //                                fallback when subcategory is missing.
  //   3. `domainExtras.primaryCategory` — legacy fallback for very old rows imported
  //                                before the Spec 54.8 column-promotion.
  // Both `category` and `subcategory` are dedicated text columns on `articles` (promoted
  // in Spec 54.8). They are NOT in `domainExtras` — the astro-sync upsert lifts them
  // out into top-level columns before persisting. Earlier 63.3b code read domainExtras
  // which silently returned `undefined` for every row.
  const rows = await db
    .select({
      slug: articles.slug,
      title: articles.title,
      category: articles.category,
      subcategory: articles.subcategory,
      domainExtras: articles.domainExtras,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        inArray(articles.slug, slugs),
      ),
    );
  const map = new Map<string, ToolInfo>();
  for (const row of rows) {
    const fx = (row.domainExtras ?? {}) as Record<string, unknown>;
    const category =
      (row.subcategory && row.subcategory.length > 0 ? row.subcategory : null) ??
      (row.category && row.category.length > 0 ? row.category : null) ??
      (typeof fx["primaryCategory"] === "string" && fx["primaryCategory"].length > 0
        ? fx["primaryCategory"]
        : null);
    map.set(row.slug, {
      slug: row.slug,
      name: row.title ?? row.slug,
      category,
      // Spec 64.18: keep raw values so the cluster-routing resolver can match
      // subcategory-first without re-querying.
      subcategory: row.subcategory && row.subcategory.length > 0 ? row.subcategory : null,
      rawCategory: row.category && row.category.length > 0 ? row.category : null,
    });
  }
  return map;
}

// ─── 5. Score + build payload ─────────────────────────────────────────────────

function buildPayload(
  agg: PairAggregate,
  toolInfoBySlug: Map<string, ToolInfo>,
  maxCoMention: number,
  weights: ScoreWeights,
): ComparisonMetadata {
  const toolA = toolInfoBySlug.get(agg.toolASlug);
  const toolB = toolInfoBySlug.get(agg.toolBSlug);
  const toolAName = toolA?.name ?? agg.toolASlug;
  const toolBName = toolB?.name ?? agg.toolBSlug;
  const categoryOverlap = computeCategoryOverlap(toolA, toolB);
  const recencyBoost = computeRecencyBoost(agg.mostRecentMentionAt);
  const coMentionCount = agg.coMentionArticleIds.length;

  // Spec 63.3b: score formula extracted into computePairScore() with knobs.
  const score = computePairScore(
    { coMentionCount, maxCoMention, categoryOverlap, recencyBoost },
    weights,
  );

  return {
    toolASlug: agg.toolASlug,
    toolBSlug: agg.toolBSlug,
    toolAName,
    toolBName,
    coMentionCount,
    coMentionArticleIds: dedupeArticleIds(agg.coMentionArticleIds),
    score,
    categoryOverlap,
    recencyBoost,
    reason: buildReason({
      coMentionCount,
      categoryOverlap,
      sharedCategory: categoryOverlap ? toolA?.category ?? null : null,
      recencyBoost,
    }),
  };
}

function computeCategoryOverlap(a: ToolInfo | undefined, b: ToolInfo | undefined): boolean {
  if (!a?.category || !b?.category) return false;
  return a.category.trim().toLowerCase() === b.category.trim().toLowerCase();
}

function computeRecencyBoost(mostRecent: Date): number {
  const ageDays = (Date.now() - mostRecent.getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays <= 30) return 1;
  if (ageDays >= 180) return 0;
  // Linear decay from 1.0 at 30d to 0 at 180d.
  return round3(1 - (ageDays - 30) / 150);
}

function buildReason(input: {
  coMentionCount: number;
  categoryOverlap: boolean;
  sharedCategory: string | null;
  recencyBoost: number;
}): string {
  const parts: string[] = [`Co-mentioned in ${input.coMentionCount} article${input.coMentionCount === 1 ? "" : "s"}`];
  if (input.categoryOverlap && input.sharedCategory) {
    parts.push(`shared category "${input.sharedCategory}"`);
  }
  if (input.recencyBoost > 0.5) parts.push("recent activity");
  return parts.join("; ");
}

function dedupeArticleIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ─── 7. Exclude existing comparisons ──────────────────────────────────────────

async function excludeCoveredPairs(
  projectId: string,
  pairs: ComparisonMetadata[],
): Promise<ComparisonMetadata[]> {
  if (pairs.length === 0) return [];

  // One query per pair via OR'd jsonb @> checks would be N round-trips. Instead, fetch
  // every comparison article's toolSlugs once and check in-memory.
  const existing = await db
    .select({ extras: articles.domainExtras })
    .from(articles)
    .where(and(eq(articles.projectId, projectId), eq(articles.collection, "comparisons")));

  const coveredSet = new Set<string>();
  for (const row of existing) {
    const fx = (row.extras ?? {}) as Record<string, unknown>;
    const raw = fx["toolSlugs"];
    if (!Array.isArray(raw)) continue;
    const slugs = raw.filter((s): s is string => typeof s === "string");
    if (slugs.length < 2) continue;
    // Add every canonical pair from this article's tool list to the covered set.
    const sorted = uniqueSorted(slugs);
    for (let i = 0; i < sorted.length - 1; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        coveredSet.add(`${sorted[i]}|${sorted[j]}`);
      }
    }
  }

  return pairs.filter((p) => !coveredSet.has(`${p.toolASlug}|${p.toolBSlug}`));
}

// ─── 8. Persist via partial-unique-index upsert ───────────────────────────────

async function persistPairs(
  projectId: string,
  pairs: ComparisonMetadata[],
  toolInfoBySlug: Map<string, ToolInfo>,
  clusterIndex: ComparisonClusterEntry[],
): Promise<void> {
  if (pairs.length === 0) return;

  // Validate every payload through Zod before write — guarantees canonicalization invariant.
  for (const pair of pairs) {
    ComparisonMetadataSchema.parse(pair);
    if (pair.toolASlug >= pair.toolBSlug) {
      throw new Error(
        `comparison-discovery: non-canonical pair (${pair.toolASlug}, ${pair.toolBSlug}) — internal bug`,
      );
    }
  }

  // Drizzle's onConflictDoUpdate `target` field accepts only PgColumn refs, not SQL
  // expressions — so we cannot point it at the partial unique index on
  // (project_id, (comparison_metadata->>'toolASlug'), (comparison_metadata->>'toolBSlug')).
  // Instead we do SELECT-then-INSERT/UPDATE inside one transaction. The partial unique
  // index from migration 0072 still backstops concurrent writers (a race would surface as
  // a unique-violation, which is the same safety as ON CONFLICT).
  await db.transaction(async (tx) => {
    for (const pair of pairs) {
      const topicTitle = `${pair.toolAName} vs. ${pair.toolBName}`;
      // Spec 64.18: resolve target cluster once per pair. The pair always has
      // both slugs in `toolInfoBySlug` because `loadToolInfo` was seeded from
      // `uniqueSlugSet(survivors)` upstream — but be defensive and fall back
      // to `create_new` if either lookup misses (e.g. tool article rolled out
      // mid-run). The downstream `pipeline-router` `case "comparison":`
      // handles both routed and unrouted briefs cleanly.
      const routing = computeRouting(pair, toolInfoBySlug, clusterIndex);

      // WHERE predicate matches the migration 0072 partial unique index exactly so the
      // planner uses the index for the existence check (root CLAUDE.md targetWhere rule):
      //   WHERE source = 'comparison_discovery' AND comparison_metadata IS NOT NULL.
      const existing = await tx
        .select({ id: topicBriefs.id })
        .from(topicBriefs)
        .where(
          and(
            eq(topicBriefs.projectId, projectId),
            eq(topicBriefs.source, "comparison_discovery"),
            isNotNull(topicBriefs.comparisonMetadata),
            sql`${topicBriefs.comparisonMetadata}->>'toolASlug' = ${pair.toolASlug}`,
            sql`${topicBriefs.comparisonMetadata}->>'toolBSlug' = ${pair.toolBSlug}`,
          ),
        )
        .limit(1);

      if (existing[0]) {
        // Spec 64.18: re-stamp `clusterId` on every run so a newly-created
        // matching cluster picks up briefs from prior runs that lacked it.
        // `clusterAction` stays `"comparison"` (the planner content-type
        // discriminator); the routing decision lives on `clusterId` alone.
        await tx
          .update(topicBriefs)
          .set({
            comparisonMetadata: pair,
            topicTitle,
            clusterId: routing.clusterId,
            updatedAt: new Date(),
          })
          .where(eq(topicBriefs.id, existing[0].id));
      } else {
        await tx.insert(topicBriefs).values({
          projectId,
          source: "comparison_discovery",
          topicTitle,
          secondaryKeywords: [],
          clusterAction: "comparison",
          ...(routing.clusterId !== null ? { clusterId: routing.clusterId } : {}),
          comparisonMetadata: pair,
          approvalRequired: true,
          approvalStatus: "pending",
        });
      }
    }
  });
}

// Spec 64.18 / Phase C.2: thin wrapper around `resolveComparisonCluster` that
// looks the pair's tools up by slug before calling the pure resolver. Pure
// itself (no I/O) — kept private to the discovery module because it's only
// useful in the persist + log paths.
function computeRouting(
  pair: ComparisonMetadata,
  toolInfoBySlug: Map<string, ToolInfo>,
  clusterIndex: ComparisonClusterEntry[],
): { clusterId: string | null } {
  const toolA = toolInfoBySlug.get(pair.toolASlug);
  const toolB = toolInfoBySlug.get(pair.toolBSlug);
  if (!toolA || !toolB) return { clusterId: null };
  const resolverA: ResolverToolInfo = {
    slug: toolA.slug,
    category: toolA.rawCategory,
    subcategory: toolA.subcategory,
  };
  const resolverB: ResolverToolInfo = {
    slug: toolB.slug,
    category: toolB.rawCategory,
    subcategory: toolB.subcategory,
  };
  const decision = resolveComparisonCluster(resolverA, resolverB, clusterIndex);
  return { clusterId: decision.clusterAction === "append_to_existing" ? decision.clusterId : null };
}

function countRoutedToCluster(
  pairs: ComparisonMetadata[],
  toolInfoBySlug: Map<string, ToolInfo>,
  clusterIndex: ComparisonClusterEntry[],
): number {
  let n = 0;
  for (const p of pairs) {
    if (computeRouting(p, toolInfoBySlug, clusterIndex).clusterId !== null) n++;
  }
  return n;
}

// ─── Empty result builder ─────────────────────────────────────────────────────

function emptyResult(
  projectId: string,
  pairsFound: number,
  pairsScored: number,
  pairsAboveThreshold: number,
  pairsPersisted: number,
  start: number,
): ComparisonDiscoveryResult {
  return {
    projectId,
    pairsFound,
    pairsScored,
    pairsAboveThreshold,
    pairsPersisted,
    topPairs: [],
    durationMs: Date.now() - start,
  };
}
