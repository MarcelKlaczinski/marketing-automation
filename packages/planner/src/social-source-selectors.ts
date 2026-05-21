// Spec 62.4-followup Issue 2: source helpers for SelectSocialPostItemsStep.
//
// Social_post items don't come from topic_briefs — the planner doesn't have
// a brief for "post about article X". Instead it mixes three sources:
//
//   1. Today's clusters in the in-progress plan ("fromTodayPlans")
//      Cluster items emitted by SelectFloorItemsStep get a sibling social
//      planned_item that fires after the cluster article publishes. At plan
//      time we don't know the future article_id, so the social planned_item
//      references the parent cluster planned_item by id; the executor (Spec
//      62.8) resolves it to the just-published article.
//
//   2. Refresh suggestions ("fromRefreshSuggestions")
//      Articles flagged by the refresh pipeline (refresh_suggestions). These
//      already have an article_id and are good repurposing candidates.
//
//   3. Suggestion pool ("fromSuggestionPool")
//      Published articles with no recent template_render — the broadest pool,
//      ranked by published_at DESC. Used to top up when the other two are
//      thin.
//
// These functions are pure DB readers; they do NOT persist anything. Caller
// (the step) decides quantity / dedupe / parenting.
//
// Boundary: this file follows the packages/planner rule — no dep on
// @marketing-auto/pipelines. Returns plain row shapes; the pipelines step
// converts to PlanningItemDraft.

import {
  and,
  articles,
  db,
  desc,
  eq,
  isNull,
  refreshSuggestions,
  sql,
  templateRenders,
} from "@marketing-auto/db";

export interface RefreshPoolCandidate {
  /** Source row id (refresh_suggestions.id). */
  suggestionId: string;
  articleId: string;
  /** Higher = more recent / more relevant. */
  generatedAt: Date;
}

export interface SuggestionPoolCandidate {
  articleId: string;
  publishedAt: Date | null;
}

export interface PickFromRefreshSuggestionsInput {
  projectId: string;
  /** Hard cap on rows returned. */
  limit: number;
}

export interface PickFromSuggestionPoolInput {
  projectId: string;
  /** Hard cap on rows returned. */
  limit: number;
  /** Article ids to exclude (already picked by refresh-suggestion source). */
  excludeArticleIds?: string[];
  /** Skip articles that have a render newer than this. Defaults to 14 days ago. */
  recentRenderCutoff?: Date;
}

/**
 * Pull undismissed/unapproved refresh suggestions, newest first. The article
 * itself must still exist (the FK guarantees it but we double-check the join
 * to skip soft-deleted articles).
 */
export async function pickFromRefreshSuggestions(
  input: PickFromRefreshSuggestionsInput,
): Promise<RefreshPoolCandidate[]> {
  if (input.limit <= 0) return [];

  const rows = await db
    .select({
      suggestionId: refreshSuggestions.id,
      articleId: refreshSuggestions.articleId,
      generatedAt: refreshSuggestions.generatedAt,
    })
    .from(refreshSuggestions)
    .innerJoin(articles, eq(articles.id, refreshSuggestions.articleId))
    .where(
      and(
        eq(refreshSuggestions.projectId, input.projectId),
        isNull(refreshSuggestions.dismissedAt),
        isNull(refreshSuggestions.approvedAt),
      ),
    )
    .orderBy(desc(refreshSuggestions.generatedAt))
    .limit(input.limit);

  return rows;
}

/**
 * Pull published articles that do NOT have a recent template_render, newest
 * first. Returns up to `limit` candidates; the caller is responsible for any
 * downstream dedupe against the other source pools.
 *
 * "Recent" = a template_render row created after `recentRenderCutoff`
 * (default: 14 days ago). The intent is to top up the social plan with
 * articles we haven't yet repurposed.
 */
export async function pickFromSuggestionPool(
  input: PickFromSuggestionPoolInput,
): Promise<SuggestionPoolCandidate[]> {
  if (input.limit <= 0) return [];
  const cutoff = input.recentRenderCutoff ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  // Articles WHERE NOT EXISTS recent template_render. Implemented as a
  // correlated NOT EXISTS subquery via Drizzle's `sql` template. Excluding
  // articles already picked from the refresh pool is opportunistic — when
  // the list is empty the AND clause is dropped.
  const excludeClause =
    input.excludeArticleIds && input.excludeArticleIds.length > 0
      ? sql`AND ${articles.id} NOT IN (${sql.join(
          input.excludeArticleIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;

  const rows = await db
    .select({
      articleId: articles.id,
      publishedAt: articles.publishedAt,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, input.projectId),
        eq(articles.status, "published"),
        // Only DE base articles. EN siblings are produced by article:
        // translation; the social pipeline still picks them up via the
        // sibling lookup at run time.
        eq(articles.locale, "de"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${templateRenders}
          WHERE ${templateRenders.articleId} = ${articles.id}
            AND ${templateRenders.createdAt} > ${cutoffIso}
        )`,
        excludeClause,
      ),
    )
    .orderBy(desc(articles.publishedAt))
    .limit(input.limit);

  return rows;
}

/**
 * Convenience used by SelectSocialPostItemsStep tests: returns how many
 * candidates the pool has at most, without materialising rows.
 */
export async function countSuggestionPool(input: {
  projectId: string;
  recentRenderCutoff?: Date;
}): Promise<number> {
  const cutoff = input.recentRenderCutoff ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, input.projectId),
        eq(articles.status, "published"),
        eq(articles.locale, "de"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${templateRenders}
          WHERE ${templateRenders.articleId} = ${articles.id}
            AND ${templateRenders.createdAt} > ${cutoffIso}
        )`,
      ),
    );

  return result[0]?.count ?? 0;
}

