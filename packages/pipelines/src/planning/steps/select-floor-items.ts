// Spec 62.4 Step 5: pick floor-cadence items from the topic_briefs queue.
//
// For each active goal:
//   target = goal.cadenceUnit === "per_day" ? minCount * 7 : minCount
//   candidates = topicBriefs filtered by matchBriefToContentType(brief) === goal.contentType
//   selected = first `target` candidates in FIFO order (by created_at, already sorted upstream)
//
// Briefs that match no goal are simply left for SelectOverageItemsStep (they
// won't be selected as overage because that step keys on signals, not briefs).
// Insufficient supply is a soft warning — the plan still persists with what
// it could fill, and the warning surfaces in `generation_notes`.

import { randomUUID } from "node:crypto";
import type { ProjectGoal, TopicBrief } from "@marketing-auto/db";
import type { WeeklyPlanInputSnapshot } from "@marketing-auto/shared";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import {
  createPlanRunEmbeddingProvider,
  type BriefEmbeddingProvider,
} from "../lib/diversity-embedding.ts";
import {
  normalizeBriefBaseScore,
  pickWithDiversity,
  type DiversityPickReason,
} from "../lib/pick-with-diversity.ts";
import {
  PIPELINE_NAME_BY_CONTENT_TYPE,
  PLANNING_CONTENT_TYPES,
  type PlanningContentType,
  type PlanningItemDraft,
} from "../types.ts";

export const selectFloorInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof selectFloorInputSchema>;

export const selectFloorOutputSchema = z.object({
  floorItems: z.array(z.unknown()),
  shortfallsByContentType: z.record(z.string(), z.number().int().min(0)),
});
type Output = z.infer<typeof selectFloorOutputSchema>;

/**
 * Match a brief to one of the goal content types. Returns null when the brief
 * doesn't map to any planner-managed type — e.g. translation briefs, which
 * never need their own planned_item because the `article:blog` pipeline
 * auto-triggers `article:translation` via `afterComplete` (Spec 59.2, bidi).
 *
 * Mapping rules (kept deliberately conservative — refine with usage data):
 *   - source='comparison_discovery' OR cluster_action='comparison' → "comparison"
 *   - intent_type='comparison' AND brief carries ≥2 concrete tool slugs → "comparison"  (Spec 63.3b)
 *   - cluster_action='translation' → null (auto-triggered by source pipeline)
 *   - cluster_action='refresh'     → null (refresh briefs go via the refresh pipeline directly)
 *   - intentType='knowledge'                                → "ki_wissen"  (Spec 63.4 — regardless of clusterAction so Hub-Spoke briefs route correctly)
 *   - intentType='tutorial' AND clusterAction='standalone'  → "ki_wissen"  (tool-agnostic tutorial)
 *   - everything else (create_new / append_to_existing / standalone) → "cluster"
 */
export function matchBriefToContentType(brief: TopicBrief): PlanningContentType | null {
  if (brief.source === "comparison_discovery" || brief.clusterAction === "comparison") {
    return "comparison";
  }
  // Spec 63.3b A.3: trend briefs (and any future source) with intent_type='comparison'
  // may demand a tool-comparison article. The comparison templates require concrete
  // tool slugs (2-4) — without them the planned_item produces a degraded article. We
  // gate the route on `getComparisonToolSlugs(brief).length >= 2` so off-topic /
  // unstructured comparison-intent briefs fall through to the default cluster bucket.
  if (brief.intentType === "comparison" && getComparisonToolSlugs(brief).length >= 2) {
    return "comparison";
  }
  if (brief.clusterAction === "translation" || brief.clusterAction === "refresh") {
    return null;
  }
  // Spec 63.4: knowledge briefs are always theme-centric ki-wissen material, whether
  // they got a Hub-Spoke match (append_to_existing) or stand alone. The DB clusterId
  // (when set) is preserved on the planned_item but the bucket is ki_wissen so the
  // article ends up in the ki-wissen Astro collection.
  if (brief.intentType === "knowledge") {
    return "ki_wissen";
  }
  // Tool-agnostic tutorials without a tool-cluster anchor are best authored as
  // ki-wissen-style content ("Wie schreibt man gute Prompts?" is tutorial format
  // but theme-centric). Tool-specific tutorials with a cluster fall through to
  // the cluster bucket.
  if (brief.intentType === "tutorial" && brief.clusterAction === "standalone") {
    return "ki_wissen";
  }
  return "cluster";
}

/**
 * Spec 63.3b: return concrete tool slugs that anchor a comparison-bucket plan
 * item. Today only `comparison_discovery` briefs carry these (in
 * `comparisonMetadata.toolASlug` + `toolBSlug`); trend briefs with
 * `intentType='comparison'` have no structured tool field yet. The helper is
 * forward-compat: if a future trend-synthesis enhancement populates
 * `comparisonMetadata` (or a sibling jsonb path) on trend briefs, extend this
 * function in one place and the routing rule above will pick it up.
 */
function getComparisonToolSlugs(brief: TopicBrief): string[] {
  const meta = brief.comparisonMetadata;
  if (!meta) return [];
  const slugs: string[] = [];
  if (typeof meta.toolASlug === "string" && meta.toolASlug.length > 0) slugs.push(meta.toolASlug);
  if (typeof meta.toolBSlug === "string" && meta.toolBSlug.length > 0) slugs.push(meta.toolBSlug);
  return slugs;
}

/** Per-goal target weekly count. per_day goals are multiplied by 7. */
export function targetWeeklyCount(goal: Pick<ProjectGoal, "cadenceUnit" | "minCount">): number {
  return goal.cadenceUnit === "per_day" ? goal.minCount * 7 : goal.minCount;
}

function briefLocale(brief: TopicBrief): "de" | "en" | null {
  if (brief.locale === "de" || brief.locale === "en") return brief.locale;
  return null;
}

function pipelineInputFromBrief(
  brief: TopicBrief,
  contentType: PlanningContentType,
  projectId: string,
): Record<string, unknown> {
  // `title` is read by PlannerItemCard for the calendar headline; prefer the
  // LLM-polished `suggestedTitle` when set, otherwise the raw NOT NULL
  // `topicTitle`. Persisting here means the planner emits a ready-to-display
  // headline at plan-generation time — no read-time JOIN against
  // `topic_briefs` is needed.
  const input: Record<string, unknown> = {
    briefId: brief.id,
    projectId,
    title: brief.suggestedTitle ?? brief.topicTitle,
  };
  if (contentType === "comparison") input.collectionType = "comparison";
  if (contentType === "ki_wissen") input.collectionType = "ki-wissen";
  // Spec 63.7b: cluster items need cluster_action + cluster_id + intent_type
  // available at execution time so `getPipelineForItem` (pure router) can
  // decide between cluster:full-plan (create_new — phantom-cluster generation)
  // and article:blog (append_to_existing — spoke under brief.clusterId)
  // WITHOUT a re-query of topic_briefs. Stamped only for cluster items;
  // comparison + ki_wissen items don't use these.
  if (contentType === "cluster") {
    input.clusterAction = brief.clusterAction;
    if (brief.clusterId !== null) input.clusterId = brief.clusterId;
    if (brief.intentType !== null) input.intentType = brief.intentType;
  }
  return input;
}

/**
 * Spec 63.7b: per-item pipelineName selector. Cluster items with
 * `cluster_action='append_to_existing'` execute as `article:blog` (spoke
 * generation under brief.clusterId), not `cluster:full-plan`. Persisting the
 * correct pipelineName at plan-generation time lets the cost estimator's
 * tier-1 step-sum reflect the cheaper article:blog cost instead of the
 * cluster:full-plan default.
 *
 * Keep in sync with `pipeline-router.ts` `case "cluster":` — same predicate.
 */
function pipelineNameForItem(brief: TopicBrief, contentType: PlanningContentType): string {
  if (
    contentType === "cluster" &&
    brief.clusterAction === "append_to_existing" &&
    brief.clusterId !== null
  ) {
    return "article:blog";
  }
  return PIPELINE_NAME_BY_CONTENT_TYPE[contentType];
}

/**
 * Spec 63.5: content types that go through the diversity-aware picker. Other
 * types (comparison, ki_wissen) keep the historic FIFO drain — comparison
 * already has pair-uniqueness, ki_wissen pools tend to be small enough that
 * adding a malus would risk underfilling cadence. social_post Floor items are
 * never produced here (matchBriefToContentType never returns "social_post"
 * — see SelectSocialPostItemsStep for that path), but listing it here keeps
 * the predicate symmetrical with Overage / Social-post selectors.
 */
const DIVERSITY_FLOOR_CONTENT_TYPES: ReadonlySet<PlanningContentType> = new Set([
  "cluster",
  "social_post",
]);

/**
 * Spec 63.5: optional dep-injection for the embedding provider. Real runs
 * use the Voyage-backed provider from `createPlanRunEmbeddingProvider`;
 * tests can pass a stub that returns null synchronously so the picker
 * degrades to FIFO without hitting Voyage / cost_logs.
 */
export interface SelectFloorDeps {
  createEmbeddingProvider?: typeof createPlanRunEmbeddingProvider;
}

export class SelectFloorItemsStep extends BaseStep<Input, Output> {
  readonly name = "select-floor-items";
  readonly inputSchema = selectFloorInputSchema;
  readonly outputSchema = selectFloorOutputSchema;
  private readonly createEmbeddingProvider: typeof createPlanRunEmbeddingProvider;

  constructor(deps?: SelectFloorDeps) {
    super();
    this.createEmbeddingProvider =
      deps?.createEmbeddingProvider ?? createPlanRunEmbeddingProvider;
  }

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const goals =
      ctx.getStepOutput<{ goals: ProjectGoal[] }>("validate-goals")?.goals ?? [];
    const briefs =
      ctx.getStepOutput<{ topicBriefs: TopicBrief[] }>("load-topic-briefs")?.topicBriefs ?? [];

    // Spec 63.5: read diversity knobs from the frozen snapshot so replays
    // reproduce the same picks even if Marcel later moves the sliders.
    // Falls back to (0.5, 0.5) when the snapshot is missing the field —
    // covers pre-63.5 plans being re-executed.
    const snapshot = ctx.getStepOutput<{ snapshot: WeeklyPlanInputSnapshot }>(
      "snapshot-inputs",
    )?.snapshot;
    const diversityConfig = {
      threshold: snapshot?.config.diversityThreshold ?? 0.5,
      malusWeight: snapshot?.config.diversityMalusWeight ?? 0.5,
    };
    // Per-step embedding provider. The Overage selector spins up its own
    // provider and pays Voyage twice for the briefs Floor already picked —
    // ~€0.001 per plan-run, accepted in exchange for not sharing mutable
    // state across step instances. The provider's per-brief cache still
    // dominates within a single step (the iterative picker re-scores the
    // remaining pool each round → ~target × pool lookups).
    const embeddingProvider: BriefEmbeddingProvider = this.createEmbeddingProvider({
      projectId: input.projectId,
      ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    });

    // Bucket briefs by matched content type once, then drain per goal.
    const buckets: Record<PlanningContentType, TopicBrief[]> = {
      cluster: [],
      comparison: [],
      ki_wissen: [],
      social_post: [],
    };
    const bucketIndex = new Map<string, number>(); // brief.id → original pool index
    for (const b of briefs) {
      const ct = matchBriefToContentType(b);
      if (ct !== null) {
        bucketIndex.set(b.id, buckets[ct].length);
        buckets[ct].push(b);
      }
    }

    const floorItems: PlanningItemDraft[] = [];
    const shortfalls: Record<string, number> = {};

    for (const goal of goals.filter((g) => g.isActive && g.minCount > 0)) {
      // social_post goals are owned by SelectSocialPostItemsStep (Spec
      // 62.4-followup Issue 2). No topic_brief shape produces social_post,
      // so iterating here would always report a false-positive shortfall
      // even when the dedicated selector filled the cadence.
      if (goal.contentType === "social_post") continue;
      // `goal.contentType` is `string` at the DB layer (column is plain text
      // with a JSON-Zod validator at insert time). Validate at runtime once
      // per goal so the rest of the loop can use the narrowed type without
      // repeated casts. Goals with an unknown content type are skipped with
      // a warning — protects against future schema drift.
      const contentType = (PLANNING_CONTENT_TYPES as readonly string[]).includes(goal.contentType)
        ? (goal.contentType as PlanningContentType)
        : null;
      if (contentType === null) {
        ctx.log.warn(
          { contentType: goal.contentType, goalId: goal.id },
          "select-floor-items: goal has unknown content type; skipped",
        );
        continue;
      }
      const target = targetWeeklyCount(goal);
      const pool = buckets[contentType] ?? [];

      // Spec 63.5: cluster items go through the diversity-aware picker;
      // comparison + ki_wissen stay on FIFO. Diversity is also a no-op when
      // malusWeight is 0 OR when the pool is too small to matter — the
      // picker will just produce the same FIFO order in that case.
      const useDiversity =
        DIVERSITY_FLOOR_CONTENT_TYPES.has(contentType) &&
        diversityConfig.malusWeight > 0 &&
        pool.length > target;

      let picked: TopicBrief[];
      let diversityReasons: DiversityPickReason[] = [];
      if (useDiversity) {
        const poolSnapshot = [...pool]; // freeze pool index for base-score normalization
        const result = await pickWithDiversity<TopicBrief>({
          pool: poolSnapshot,
          target,
          embeddingProvider,
          config: diversityConfig,
          getBaseScore: (brief) => {
            const idx = bucketIndex.get(brief.id) ?? 0;
            return normalizeBriefBaseScore(brief, idx, poolSnapshot.length);
          },
          getItemId: (brief) => brief.id,
        });
        picked = result.picked;
        diversityReasons = result.reasons;
        // Remove picked briefs from the bucket so the next goal iteration
        // (if any sharing this content type) sees the remaining pool — same
        // semantics as the old `pool.splice` drain.
        const pickedIds = new Set(picked.map((b) => b.id));
        buckets[contentType] = pool.filter((b) => !pickedIds.has(b.id));
      } else {
        picked = pool.splice(0, target);
      }

      let pickedIndex = 0;
      for (const brief of picked) {
        pickedIndex += 1;
        // Spec 62.4-followup Issue 1: cluster items omit the locale (=null)
        // because cluster:full-plan → article:blog → article:translation
        // emits DE+EN internally. Comparison + ki_wissen retain the brief's
        // own locale; auto-translation propagates the sibling on completion.
        const itemLocale = contentType === "cluster" ? null : briefLocale(brief);
        // Spec 63.5: when diversity was applied, append the audit detail
        // (base/malus/sim/final) so Marcel can see in the detail page why a
        // brief was picked or de-prioritised. The card UI keeps the friendly
        // sourceKind label.
        const reasonSuffix = diversityReasons[pickedIndex - 1]?.reason;
        const selectionReason = reasonSuffix
          ? `Floor ${contentType} #${pickedIndex}/${target} — ${reasonSuffix}`
          : `Floor ${contentType} #${pickedIndex}/${target}`;
        floorItems.push({
          draftId: randomUUID(),
          contentType,
          pipelineName: pipelineNameForItem(brief, contentType),
          sourceKind: "floor",
          sourceBriefId: brief.id,
          sourceSignalId: null,
          parentDraftId: null,
          locale: itemLocale,
          pipelineInput: pipelineInputFromBrief(brief, contentType, input.projectId),
          slotDate: null,
          selectionScore: diversityReasons[pickedIndex - 1]?.adjustedScore ?? null,
          // selectionReason carries audit detail (item index / cadence target
          // / diversity malus) for the detail-page hover tooltip — Card UI
          // shows a friendly label ("Geplant") instead (Spec 62.4-followup
          // Issue 3).
          selectionReason,
          estimatedCostEur: null,
        });
      }

      if (picked.length < target) {
        shortfalls[contentType] = target - picked.length;
        ctx.log.warn(
          { contentType, requested: target, available: picked.length },
          "select-floor-items: cadence not fully reachable",
        );
      }
    }

    return { floorItems, shortfallsByContentType: shortfalls };
  }
}
