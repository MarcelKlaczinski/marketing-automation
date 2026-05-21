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
import {
  articles,
  db,
  inArray,
  type ProjectGoal,
  type TopicBrief,
} from "@marketing-auto/db";
import type { WeeklyPlanInputSnapshot } from "@marketing-auto/shared";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import {
  createArticleEmbeddingProvider,
  createPlanRunEmbeddingProvider,
  type ArticleLike,
} from "../lib/diversity-embedding.ts";
import { pickWithDiversity } from "../lib/pick-with-diversity.ts";
import {
  PIPELINE_NAME_BY_CONTENT_TYPE,
  type PlanningItemDraft,
} from "../types.ts";

/**
 * Spec 63.5: extended article-row shape used by the social-post selector.
 * Carries title (for pipelineInput.title), embeddingText (for the diversity
 * picker — title + meta_description), and clusterId (for cluster-embedding
 * fallback when the article is too sparse to embed on its own). Both
 * embeddingText and clusterId are optional — sparse articles still get a
 * planned_item, they just contribute no diversity signal.
 */
export interface ArticleSocialMeta {
  id: string;
  title: string | null;
  embeddingText: string | null;
  clusterId: string | null;
}

/**
 * Default DB-backed batch lookup for article metadata, used by the
 * refresh + pool social-post sub-cases. Returns one entry per requested id
 * with the full ArticleSocialMeta shape (title may still be null — caller
 * decides whether to stamp `pipelineInput.title`).
 *
 * Spec 63.5: replaces the title-only loader so the diversity picker has
 * embedding text + cluster id available without a second DB roundtrip.
 * Injected via `SelectSocialPostDeps` for offline tests.
 */
async function defaultLoadArticleMeta(
  articleIds: string[],
): Promise<Map<string, ArticleSocialMeta>> {
  if (articleIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      metaDescription: articles.metaDescription,
      clusterId: articles.clusterId,
    })
    .from(articles)
    .where(inArray(articles.id, articleIds));
  const out = new Map<string, ArticleSocialMeta>();
  for (const r of rows) {
    const title = typeof r.title === "string" && r.title.length > 0 ? r.title : null;
    const meta = typeof r.metaDescription === "string" ? r.metaDescription.trim() : "";
    const titleText = title ? title.trim() : "";
    const embeddingText = [titleText, meta].filter((s) => s.length > 0).join(" ") || null;
    out.set(r.id, {
      id: r.id,
      title,
      embeddingText,
      clusterId: r.clusterId ?? null,
    });
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
  /**
   * Spec 63.5: extended from the legacy title-only loader to also return
   * embedding text + cluster id for the diversity picker. Backwards-compat
   * shim: tests that injected the old `loadArticleTitles` shape (returning
   * `Map<string, string>`) should migrate to `loadArticleMeta`.
   */
  loadArticleMeta?: typeof defaultLoadArticleMeta;
  /**
   * Spec 63.5: embedding-provider factories. Real runs use the Voyage-backed
   * implementations; tests pass stubs to stay offline.
   */
  createBriefEmbeddingProvider?: typeof createPlanRunEmbeddingProvider;
  createArticleEmbeddingProvider?: typeof createArticleEmbeddingProvider;
}

export class SelectSocialPostItemsStep extends BaseStep<Input, Output> {
  readonly name = "select-social-post-items";
  readonly inputSchema = selectSocialPostInputSchema;
  readonly outputSchema = selectSocialPostOutputSchema;
  private readonly pickRefresh: typeof defaultPickFromRefreshSuggestions;
  private readonly pickPool: typeof defaultPickFromSuggestionPool;
  private readonly loadArticleMeta: typeof defaultLoadArticleMeta;
  private readonly createBriefEmbeddingProvider: typeof createPlanRunEmbeddingProvider;
  private readonly createArticleEmbeddingProvider: typeof createArticleEmbeddingProvider;

  constructor(deps?: SelectSocialPostDeps) {
    super();
    this.pickRefresh = deps?.pickFromRefreshSuggestions ?? defaultPickFromRefreshSuggestions;
    this.pickPool = deps?.pickFromSuggestionPool ?? defaultPickFromSuggestionPool;
    this.loadArticleMeta = deps?.loadArticleMeta ?? defaultLoadArticleMeta;
    this.createBriefEmbeddingProvider =
      deps?.createBriefEmbeddingProvider ?? createPlanRunEmbeddingProvider;
    this.createArticleEmbeddingProvider =
      deps?.createArticleEmbeddingProvider ?? createArticleEmbeddingProvider;
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

    // Batch-load article meta (title + embeddingText + clusterId) for both
    // refresh and pool sub-cases in a single SQL roundtrip. Spec 63.5
    // extended from the title-only helper so the diversity picker has the
    // embedding text without a second DB hit.
    const allArticleIds = [
      ...refreshArticleIds,
      ...poolRows.map((r: SuggestionPoolCandidate) => r.articleId),
    ];
    const articleMetaById = await this.loadArticleMeta(allArticleIds);

    const buildArticleInput = (articleId: string, extras: Record<string, unknown>) => {
      const out: Record<string, unknown> = {
        projectId: input.projectId,
        articleId,
        ...extras,
      };
      const meta = articleMetaById.get(articleId);
      if (meta?.title) out.title = meta.title;
      return out;
    };

    // Spec 63.5: diversity-aware ordering for the refresh + pool sub-cases.
    // fromTodayPlans is NOT re-ordered — it already inherits diversity from
    // the Floor cluster picks (parent linkage). Refresh + pool are
    // article-sourced and benefit from a per-article embedding compared
    // against Floor cluster + social embeddings.
    const snapshot = ctx.getStepOutput<{ snapshot: WeeklyPlanInputSnapshot }>(
      "snapshot-inputs",
    )?.snapshot;
    const diversityConfig = {
      threshold: snapshot?.config.diversityThreshold ?? 0.5,
      malusWeight: snapshot?.config.diversityMalusWeight ?? 0.5,
    };
    const briefs =
      ctx.getStepOutput<{ topicBriefs: TopicBrief[] }>("load-topic-briefs")?.topicBriefs ?? [];
    const briefById = new Map<string, TopicBrief>(briefs.map((b) => [b.id, b]));

    const articleProvider = this.createArticleEmbeddingProvider({
      projectId: input.projectId,
      ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    });
    const briefProvider = this.createBriefEmbeddingProvider({
      projectId: input.projectId,
      ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    });

    // Seed initialPickedEmbeddings with Floor cluster + social_post brief
    // embeddings so the article-sourced picks avoid re-covering Floor topics.
    // fromTodayPlans is also counted: each carries a parent cluster brief id
    // that we can resolve to a vector.
    const seedBriefIds = clusterItems
      .map((it) => it.sourceBriefId)
      .filter((id): id is string => id !== null);
    const initialEmbeddings: (number[] | null)[] = [];
    for (const briefId of seedBriefIds) {
      const brief = briefById.get(briefId);
      if (brief) initialEmbeddings.push(await briefProvider.getForBrief(brief));
    }

    // Adapter: { articleId, source, ...meta } → diversity item shape.
    interface ArticleCandidate {
      articleId: string;
      embeddingText: string | null;
      clusterId: string | null;
      kind: "refresh" | "pool";
      refreshSuggestionId?: string;
    }
    const articleCandidates: ArticleCandidate[] = [
      ...refreshRows.map((row: RefreshPoolCandidate) => {
        const meta = articleMetaById.get(row.articleId);
        return {
          articleId: row.articleId,
          embeddingText: meta?.embeddingText ?? null,
          clusterId: meta?.clusterId ?? null,
          kind: "refresh" as const,
          refreshSuggestionId: row.suggestionId,
        };
      }),
      ...poolRows.map((row: SuggestionPoolCandidate) => {
        const meta = articleMetaById.get(row.articleId);
        return {
          articleId: row.articleId,
          embeddingText: meta?.embeddingText ?? null,
          clusterId: meta?.clusterId ?? null,
          kind: "pool" as const,
        };
      }),
    ];

    const useDiversity =
      diversityConfig.malusWeight > 0 && articleCandidates.length > 1;
    let orderedCandidates: { candidate: ArticleCandidate; auditReason: string | null }[];
    if (useDiversity) {
      const picked = await pickWithDiversity<ArticleCandidate>({
        pool: articleCandidates,
        // Re-order, don't filter — the diversity picker covers the whole
        // pool. Capping happens upstream via perSourceCap.
        target: articleCandidates.length,
        embeddingProvider: {
          getForItem: (c) =>
            articleProvider.getForItem({
              id: c.articleId,
              embeddingText: c.embeddingText,
              clusterId: c.clusterId,
            } satisfies ArticleLike),
        },
        config: diversityConfig,
        // Refresh suggestions outrank pool picks via the base-score weighting
        // (refresh=1.0, pool=0.6). Inside each band, pool order is preserved.
        getBaseScore: (c) => (c.kind === "refresh" ? 1.0 : 0.6),
        getItemId: (c) => c.articleId,
        initialPickedEmbeddings: initialEmbeddings,
      });
      orderedCandidates = picked.picked.map((c, i) => ({
        candidate: c,
        auditReason: picked.reasons[i]?.reason ?? null,
      }));
    } else {
      orderedCandidates = articleCandidates.map((c) => ({ candidate: c, auditReason: null }));
    }

    const fromRefresh: PlanningItemDraft[] = [];
    const fromPool: PlanningItemDraft[] = [];
    for (const { candidate, auditReason } of orderedCandidates) {
      const baseReason =
        candidate.kind === "refresh"
          ? `Social repurpose from refresh suggestion ${candidate.refreshSuggestionId}`
          : `Social repurpose from suggestion pool`;
      const reason = auditReason ? `${baseReason} — ${auditReason}` : baseReason;
      const extras =
        candidate.kind === "refresh" && candidate.refreshSuggestionId !== undefined
          ? { refreshSuggestionId: candidate.refreshSuggestionId }
          : {};
      const planned: PlanningItemDraft = {
        draftId: randomUUID(),
        contentType: "social_post",
        pipelineName: PIPELINE_NAME_BY_CONTENT_TYPE.social_post,
        sourceKind: "floor",
        sourceBriefId: null,
        sourceSignalId: null,
        parentDraftId: null,
        locale: null,
        pipelineInput: buildArticleInput(candidate.articleId, extras),
        slotDate: null,
        selectionScore: null,
        selectionReason: reason,
        estimatedCostEur: null,
      };
      if (candidate.kind === "refresh") {
        fromRefresh.push(planned);
      } else {
        fromPool.push(planned);
      }
    }

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
