// Spec 64.15 Phase B: cross-week topic diversity for the Floor selector.
//
// Spec 63.5 added diversity-aware picking WITHIN a single plan. KW21 still
// might cover "RAG" and KW22 the same week — `pickWithDiversity` had no view
// of past plans. This module fills that gap: load the briefs that anchored
// the last N past plans, resolve their embeddings via the existing 63.5
// provider, hand them to `pickWithDiversity` via `initialPickedEmbeddings`
// so the first round already sees a non-trivial diversity context.
//
// The helper is purely additive. When `lookbackWeeks === 0` (env opt-out,
// or pre-64.15 plan replay with default 3 → still safe — fewer historical
// rows just means weaker but still-correct diversity), the call returns an
// empty array and the picker degrades to its pre-Phase-B behaviour.
//
// Embedding resolution chain:
//   1. Phase C: `topic_briefs.embedding` precomputed column (Voyage v3, 1024d).
//      When non-null, the provider returns it directly — no Voyage call.
//   2. On-the-fly Voyage embed of `${primaryKeyword} ${topicTitle}` (lazy
//      backfill into the column when Phase C is wired).
//   3. `clusters.embedding` fallback via brief.clusterId (Spec 63.5 path).
//   4. null — brief contributes no diversity signal but doesn't crash.
//
// Phase B works without Phase C — step 2 in the chain covers the column-
// absent case. Phase C lands a real precomputed embedding so step 2 only
// fires for legacy / manual / comparison briefs that bypass `emit-brief.ts`.

import {
  type TopicBrief,
  and,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  plannedItems,
  topicBriefs,
  weeklyPlans,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import type { BriefEmbeddingProvider } from "./diversity-embedding.ts";

const log = createLogger("pipelines:planner:cross-week-diversity");

/**
 * Load embeddings of the briefs that anchored the last `lookbackWeeks` PAST
 * weekly plans for the project. "Past" = `status` is a non-active terminal
 * value (approved / running / completed / partially_failed); draft and
 * cancelled plans are excluded because they don't represent published intent.
 *
 * Returns an array of `number[]` ready to pass as `pickWithDiversity`'s
 * `initialPickedEmbeddings`. Nulls (briefs without resolvable embedding) are
 * filtered out — the picker treats their absence as "no diversity signal",
 * which matches the within-plan semantics.
 *
 * Idempotent: callers may invoke per-step or per-plan; the embedding provider
 * caches by brief.id so the second call within the same run is a map lookup.
 */
export async function loadHistoricalPlanEmbeddings(
  projectId: string,
  lookbackWeeks: number,
  embeddingProvider: BriefEmbeddingProvider,
  excludePlanId?: string
): Promise<number[][]> {
  if (lookbackWeeks <= 0) {
    return [];
  }

  // 1. Resolve the last N past plans for this project. The (year, iso_week)
  //    composite ORDER BY descending picks the most recent. Active "draft"
  //    plans are excluded — only intent-bearing rows count toward diversity.
  //    `excludePlanId` lets the caller skip the plan being generated when
  //    a row already exists (the typical Spec 62.4 flow inserts at the END
  //    of `persist-plan`, so this is currently a no-op safety belt).
  const planFilter = excludePlanId
    ? and(
        eq(weeklyPlans.projectId, projectId),
        ne(weeklyPlans.id, excludePlanId),
        inArray(weeklyPlans.status, ["approved", "running", "completed", "partially_failed"])
      )
    : and(
        eq(weeklyPlans.projectId, projectId),
        inArray(weeklyPlans.status, ["approved", "running", "completed", "partially_failed"])
      );

  const recentPlans = await db
    .select({ id: weeklyPlans.id })
    .from(weeklyPlans)
    .where(planFilter)
    .orderBy(desc(weeklyPlans.year), desc(weeklyPlans.isoWeek))
    .limit(lookbackWeeks);

  if (recentPlans.length === 0) {
    return [];
  }

  const planIds = recentPlans.map((p) => p.id);

  // 2. Load the briefs joined to those plans via planned_items.source_brief_id.
  //    Distinct on brief id so a brief that anchored two planned_items (a
  //    rarity but possible — e.g. a manual re-trigger) only counts once.
  const briefRows = await db
    .selectDistinct({
      id: topicBriefs.id,
      projectId: topicBriefs.projectId,
      source: topicBriefs.source,
      clusterAction: topicBriefs.clusterAction,
      topicTitle: topicBriefs.topicTitle,
      primaryKeyword: topicBriefs.primaryKeyword,
      clusterId: topicBriefs.clusterId,
      locale: topicBriefs.locale,
      intentType: topicBriefs.intentType,
      secondaryKeywords: topicBriefs.secondaryKeywords,
      gapMetadata: topicBriefs.gapMetadata,
      trendMetadata: topicBriefs.trendMetadata,
      refreshMetadata: topicBriefs.refreshMetadata,
      comparisonMetadata: topicBriefs.comparisonMetadata,
    })
    .from(plannedItems)
    .innerJoin(topicBriefs, eq(plannedItems.sourceBriefId, topicBriefs.id))
    .where(and(inArray(plannedItems.weeklyPlanId, planIds), isNotNull(plannedItems.sourceBriefId)));

  if (briefRows.length === 0) {
    return [];
  }

  // 3. Resolve embeddings through the existing 63.5 provider. The provider's
  //    cache prevents double-Voyage for briefs reused across multiple goals
  //    in the current plan run. Failures inside the provider already log a
  //    warn — we just filter nulls and move on.
  const embeddings: number[][] = [];
  for (const row of briefRows) {
    // Cast through `as unknown as TopicBrief` — the SELECT projection covers
    // every field `buildEmbeddingText` + the provider's cluster-fallback read,
    // but the type alias also includes routing audit columns we don't need.
    const briefShape = row as unknown as TopicBrief;
    const emb = await embeddingProvider.getForBrief(briefShape);
    if (emb !== null) embeddings.push(emb);
  }

  log.debug(
    {
      projectId,
      lookbackWeeks,
      plansFound: recentPlans.length,
      briefsFound: briefRows.length,
      embeddingsResolved: embeddings.length,
    },
    "cross-week-diversity: historical embeddings loaded"
  );

  return embeddings;
}
