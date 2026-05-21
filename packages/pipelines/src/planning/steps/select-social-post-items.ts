// Spec 62.4-followup Issue 2: SelectSocialPostItemsStep.
//
// Replaces the missing social_post pathway in 62.4. The original
// `matchBriefToContentType` never returned "social_post" because no
// topic_brief shape implies a social post — social posts are derived from
// articles, not from briefs. This step pulls candidates from three sources
// and emits one PlanningItemDraft per candidate.
//
// Source mix (per spec §3): one third each from
//   (1) today's clusters in the current plan
//   (2) refresh suggestions (active rows in refresh_suggestions)
//   (3) suggestion pool (published articles with no recent template_render)
//
// Caps fall back gracefully — a thin pool yields fewer items. The step
// records a shortfall in its output for visibility in `generation_notes`.
//
// Pipeline I/O is read via ctx.getStepOutput (same convention as
// SelectFloorItemsStep). The two DB readers (refresh suggestions, suggestion
// pool) come from packages/planner/src/social-source-selectors.ts; injecting
// them as `SelectSocialPostDeps` keeps the step deterministically testable
// with hand-built fixtures.

import { randomUUID } from "node:crypto";
import {
  pickFromRefreshSuggestions as defaultPickFromRefreshSuggestions,
  pickFromSuggestionPool as defaultPickFromSuggestionPool,
  type RefreshPoolCandidate,
  type SuggestionPoolCandidate,
} from "@marketing-auto/planner";
import { articles, db, inArray, type ProjectGoal } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import {
  PIPELINE_NAME_BY_CONTENT_TYPE,
  type PlanningItemDraft,
} from "../types.ts";

/**
 * Default DB-backed batch lookup for article titles, used by the
 * refresh + pool social-post sub-cases to stamp `pipelineInput.title`.
 * Returns a `Map<articleId, title>` skipping rows with NULL/empty title so
 * the card cascade falls through to `selectionReason` instead of stamping
 * an empty string. Injected via `SelectSocialPostDeps` for offline tests.
 */
async function defaultLoadArticleTitles(
  articleIds: string[],
): Promise<Map<string, string>> {
  if (articleIds.length === 0) return new Map();
  const rows = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(inArray(articles.id, articleIds));
  const out = new Map<string, string>();
  for (const r of rows) {
    if (typeof r.title === "string" && r.title.length > 0) out.set(r.id, r.title);
  }
  return out;
}

export const selectSocialPostInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof selectSocialPostInputSchema>;

export const selectSocialPostOutputSchema = z.object({
  socialItems: z.array(z.unknown()),
  shortfall: z.number().int().min(0),
});
type Output = z.infer<typeof selectSocialPostOutputSchema>;

/**
 * Two readers the step needs. Both default to the real DB-backed helpers in
 * @marketing-auto/planner. Tests inject fixtures to stay offline.
 */
export interface SelectSocialPostDeps {
  pickFromRefreshSuggestions?: typeof defaultPickFromRefreshSuggestions;
  pickFromSuggestionPool?: typeof defaultPickFromSuggestionPool;
  loadArticleTitles?: typeof defaultLoadArticleTitles;
}

export class SelectSocialPostItemsStep extends BaseStep<Input, Output> {
  readonly name = "select-social-post-items";
  readonly inputSchema = selectSocialPostInputSchema;
  readonly outputSchema = selectSocialPostOutputSchema;
  private readonly pickRefresh: typeof defaultPickFromRefreshSuggestions;
  private readonly pickPool: typeof defaultPickFromSuggestionPool;
  private readonly loadArticleTitles: typeof defaultLoadArticleTitles;

  constructor(deps?: SelectSocialPostDeps) {
    super();
    this.pickRefresh = deps?.pickFromRefreshSuggestions ?? defaultPickFromRefreshSuggestions;
    this.pickPool = deps?.pickFromSuggestionPool ?? defaultPickFromSuggestionPool;
    this.loadArticleTitles = deps?.loadArticleTitles ?? defaultLoadArticleTitles;
  }

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const goals = ctx.getStepOutput<{ goals: ProjectGoal[] }>("validate-goals")?.goals ?? [];
    const socialGoal = goals.find(
      (g) => g.isActive && g.contentType === "social_post" && g.minCount > 0,
    );
    if (!socialGoal) {
      return { socialItems: [], shortfall: 0 };
    }

    const floor =
      ctx.getStepOutput<{ floorItems: PlanningItemDraft[] }>("select-floor-items")?.floorItems ??
      [];
    const overage =
      ctx.getStepOutput<{ overageItems: PlanningItemDraft[] }>("select-overage-items")
        ?.overageItems ?? [];

    const target =
      socialGoal.cadenceUnit === "per_day" ? socialGoal.minCount * 7 : socialGoal.minCount;
    const perSourceCap = Math.ceil(target / 3);

    // 1) From today's planned clusters. We emit one social_post per cluster
    //    item, capped at perSourceCap. The social planned_item references
    //    its parent cluster via parentDraftId; the executor (Spec 62.8)
    //    resolves the freshly-published article when the cluster completes.
    //    slotDate carries over from the parent: scheduling-wise the social
    //    post lives the same day as its source cluster (the executor will
    //    naturally only fire it once the article publishes).
    const clusterItems = [...floor, ...overage].filter(
      (it) => it.contentType === "cluster",
    );
    const fromTodayPlans: PlanningItemDraft[] = [];
    for (const cluster of clusterItems.slice(0, perSourceCap)) {
      // Inherit the parent cluster's headline. Both floor and overage cluster
      // items already carry `pipelineInput.title` (brief.suggestedTitle ??
      // brief.topicTitle for floor; signal.title for overage), so we can copy
      // without a DB roundtrip. Falls back to undefined if the upstream item
      // somehow lacks a title — the card cascade then uses selectionReason.
      const rawTitle = cluster.pipelineInput["title"];
      const parentTitle = typeof rawTitle === "string" ? rawTitle : undefined;
      const childInput: Record<string, unknown> = {
        projectId: input.projectId,
        parentDraftId: cluster.draftId,
        parentBriefId: cluster.sourceBriefId,
      };
      if (parentTitle !== undefined) childInput.title = parentTitle;
      fromTodayPlans.push({
        draftId: randomUUID(),
        contentType: "social_post",
        pipelineName: PIPELINE_NAME_BY_CONTENT_TYPE.social_post,
        sourceKind: "floor",
        sourceBriefId: cluster.sourceBriefId,
        sourceSignalId: cluster.sourceSignalId,
        parentDraftId: cluster.draftId,
        locale: null,
        pipelineInput: childInput,
        slotDate: cluster.slotDate,
        selectionScore: null,
        selectionReason: `Social repurpose of planned cluster (brief ${cluster.sourceBriefId ?? "n/a"})`,
        estimatedCostEur: null,
      });
    }

    // 2) From refresh_suggestions. Each candidate has an articleId — feed
    //    it directly to article:social-image at execution time.
    const refreshRows = await this.pickRefresh({ projectId: input.projectId, limit: perSourceCap });

    // 3) Suggestion pool (top-up). Avoid double-picking articles already
    //    selected from the refresh source.
    const refreshArticleIds = refreshRows.map((r: RefreshPoolCandidate) => r.articleId);
    const remaining = Math.max(0, target - fromTodayPlans.length - refreshRows.length);
    const poolRows =
      remaining > 0
        ? await this.pickPool({
            projectId: input.projectId,
            limit: remaining,
            excludeArticleIds: refreshArticleIds,
          })
        : [];

    // Batch-load article titles for both refresh and pool sub-cases in a
    // single SQL roundtrip. Articles without a title (imported drafts) are
    // omitted from the map; their planned_items omit the `title` field and
    // the card cascade falls back to selectionReason.
    const allArticleIds = [
      ...refreshArticleIds,
      ...poolRows.map((r: SuggestionPoolCandidate) => r.articleId),
    ];
    const articleTitleById = await this.loadArticleTitles(allArticleIds);

    const buildArticleInput = (articleId: string, extras: Record<string, unknown>) => {
      const out: Record<string, unknown> = {
        projectId: input.projectId,
        articleId,
        ...extras,
      };
      const title = articleTitleById.get(articleId);
      if (title !== undefined) out.title = title;
      return out;
    };

    const fromRefresh: PlanningItemDraft[] = refreshRows.map((row: RefreshPoolCandidate) => ({
      draftId: randomUUID(),
      contentType: "social_post",
      pipelineName: PIPELINE_NAME_BY_CONTENT_TYPE.social_post,
      sourceKind: "floor",
      sourceBriefId: null,
      sourceSignalId: null,
      parentDraftId: null,
      locale: null,
      pipelineInput: buildArticleInput(row.articleId, { refreshSuggestionId: row.suggestionId }),
      slotDate: null,
      selectionScore: null,
      selectionReason: `Social repurpose from refresh suggestion ${row.suggestionId}`,
      estimatedCostEur: null,
    }));

    const fromPool: PlanningItemDraft[] = poolRows.map((row: SuggestionPoolCandidate) => ({
      draftId: randomUUID(),
      contentType: "social_post",
      pipelineName: PIPELINE_NAME_BY_CONTENT_TYPE.social_post,
      sourceKind: "floor",
      sourceBriefId: null,
      sourceSignalId: null,
      parentDraftId: null,
      locale: null,
      pipelineInput: buildArticleInput(row.articleId, {}),
      slotDate: null,
      selectionScore: null,
      selectionReason: `Social repurpose from suggestion pool`,
      estimatedCostEur: null,
    }));

    const socialItems = [...fromTodayPlans, ...fromRefresh, ...fromPool];
    const shortfall = Math.max(0, target - socialItems.length);

    if (shortfall > 0) {
      ctx.log.warn(
        {
          target,
          fromTodayPlans: fromTodayPlans.length,
          fromRefresh: fromRefresh.length,
          fromPool: fromPool.length,
          shortfall,
        },
        "select-social-post-items: cadence not fully reachable",
      );
    }

    return { socialItems, shortfall };
  }
}
