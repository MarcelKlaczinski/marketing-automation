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

const log = createLogger("planner:comparison-discovery");

export interface DiscoverComparisonPairsInput {
  projectId: string;
  /** Minimum number of co-mentioning articles required to consider a pair. Default 2. */
  minCoMentionCount?: number;
  /** Minimum score (0–1) for a pair to be persisted. Default 0.3. */
  minScore?: number;
  /** Skip pairs already covered by a `collection='comparisons'` article. Default true. */
  excludeExistingComparisons?: boolean;
  /** Cap on rows persisted in one run. Default 50. */
  topNToPersist?: number;
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
  category: string | null;
}

const DEFAULT_MIN_CO_MENTION = 2;
const DEFAULT_MIN_SCORE = 0.3;
const DEFAULT_TOP_N_PERSIST = 50;

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
  const allScored = survivors.map((agg) => buildPayload(agg, toolInfoBySlug, maxCoMention));

  // 6. Filter by minScore.
  const aboveThreshold = allScored.filter((p) => p.score >= minScore);

  // 7. Exclude pairs already covered.
  const filtered = excludeExistingComparisons
    ? await excludeCoveredPairs(projectId, aboveThreshold)
    : aboveThreshold;

  // 8. Cap + persist.
  const sorted = [...filtered].sort((a, b) => b.score - a.score);
  const toPersist = sorted.slice(0, topNToPersist);
  await persistPairs(projectId, toPersist);

  log.info(
    {
      projectId,
      pairsFound: aggregates.size,
      pairsScored: allScored.length,
      pairsAboveThreshold: aboveThreshold.length,
      pairsPersisted: toPersist.length,
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
  const rows = await db
    .select({
      slug: articles.slug,
      title: articles.title,
      frontmatterExtras: articles.frontmatterExtras,
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
    const fx = (row.frontmatterExtras ?? {}) as Record<string, unknown>;
    const category =
      typeof fx["category"] === "string" && fx["category"].length > 0
        ? fx["category"]
        : typeof fx["primaryCategory"] === "string" && fx["primaryCategory"].length > 0
          ? fx["primaryCategory"]
          : null;
    map.set(row.slug, { slug: row.slug, name: row.title ?? row.slug, category });
  }
  return map;
}

// ─── 5. Score + build payload ─────────────────────────────────────────────────

function buildPayload(
  agg: PairAggregate,
  toolInfoBySlug: Map<string, ToolInfo>,
  maxCoMention: number,
): ComparisonMetadata {
  const toolA = toolInfoBySlug.get(agg.toolASlug);
  const toolB = toolInfoBySlug.get(agg.toolBSlug);
  const toolAName = toolA?.name ?? agg.toolASlug;
  const toolBName = toolB?.name ?? agg.toolBSlug;
  const categoryOverlap = computeCategoryOverlap(toolA, toolB);
  const recencyBoost = computeRecencyBoost(agg.mostRecentMentionAt);
  const coMentionCount = agg.coMentionArticleIds.length;

  const coMentionComponent = maxCoMention > 0 ? coMentionCount / maxCoMention : 0;
  const score = round3(coMentionComponent * 0.6 + (categoryOverlap ? 0.2 : 0) + recencyBoost * 0.2);

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
    .select({ extras: articles.frontmatterExtras })
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

async function persistPairs(projectId: string, pairs: ComparisonMetadata[]): Promise<void> {
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
      const existing = await tx
        .select({ id: topicBriefs.id })
        .from(topicBriefs)
        .where(
          and(
            eq(topicBriefs.projectId, projectId),
            eq(topicBriefs.source, "comparison_discovery"),
            sql`${topicBriefs.comparisonMetadata}->>'toolASlug' = ${pair.toolASlug}`,
            sql`${topicBriefs.comparisonMetadata}->>'toolBSlug' = ${pair.toolBSlug}`,
          ),
        )
        .limit(1);

      if (existing[0]) {
        await tx
          .update(topicBriefs)
          .set({
            comparisonMetadata: pair,
            topicTitle,
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
          comparisonMetadata: pair,
          approvalRequired: true,
          approvalStatus: "pending",
        });
      }
    }
  });
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
