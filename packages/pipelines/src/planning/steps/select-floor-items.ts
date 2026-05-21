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
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
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
 *   - cluster_action='translation' → null (auto-triggered by source pipeline)
 *   - cluster_action='refresh'     → null (refresh briefs go via the refresh pipeline directly)
 *   - intentType='knowledge'/'tutorial' on standalone briefs → "ki_wissen"
 *   - everything else (create_new / append_to_existing / standalone) → "cluster"
 */
export function matchBriefToContentType(brief: TopicBrief): PlanningContentType | null {
  if (brief.source === "comparison_discovery" || brief.clusterAction === "comparison") {
    return "comparison";
  }
  if (brief.clusterAction === "translation" || brief.clusterAction === "refresh") {
    return null;
  }
  if (
    brief.clusterAction === "standalone" &&
    (brief.intentType === "knowledge" || brief.intentType === "tutorial")
  ) {
    return "ki_wissen";
  }
  return "cluster";
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
  const input: Record<string, unknown> = { briefId: brief.id, projectId };
  if (contentType === "comparison") input.collectionType = "comparisons";
  if (contentType === "ki_wissen") input.collectionType = "ki-wissen";
  return input;
}

export class SelectFloorItemsStep extends BaseStep<Input, Output> {
  readonly name = "select-floor-items";
  readonly inputSchema = selectFloorInputSchema;
  readonly outputSchema = selectFloorOutputSchema;

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const goals =
      ctx.getStepOutput<{ goals: ProjectGoal[] }>("validate-goals")?.goals ?? [];
    const briefs =
      ctx.getStepOutput<{ topicBriefs: TopicBrief[] }>("load-topic-briefs")?.topicBriefs ?? [];

    // Bucket briefs by matched content type once, then drain FIFO per goal.
    const buckets: Record<PlanningContentType, TopicBrief[]> = {
      cluster: [],
      comparison: [],
      ki_wissen: [],
      social_post: [],
    };
    for (const b of briefs) {
      const ct = matchBriefToContentType(b);
      if (ct !== null) buckets[ct].push(b);
    }

    const floorItems: PlanningItemDraft[] = [];
    const shortfalls: Record<string, number> = {};

    for (const goal of goals.filter((g) => g.isActive && g.minCount > 0)) {
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
      const picked = pool.splice(0, target);

      let pickedIndex = 0;
      for (const brief of picked) {
        pickedIndex += 1;
        // Spec 62.4-followup Issue 1: cluster items omit the locale (=null)
        // because cluster:full-plan → article:blog → article:translation
        // emits DE+EN internally. Comparison + ki_wissen retain the brief's
        // own locale; auto-translation propagates the sibling on completion.
        const itemLocale = contentType === "cluster" ? null : briefLocale(brief);
        floorItems.push({
          draftId: randomUUID(),
          contentType,
          pipelineName: PIPELINE_NAME_BY_CONTENT_TYPE[contentType],
          sourceKind: "floor",
          sourceBriefId: brief.id,
          sourceSignalId: null,
          parentDraftId: null,
          locale: itemLocale,
          pipelineInput: pipelineInputFromBrief(brief, contentType, input.projectId),
          slotDate: null,
          selectionScore: null,
          // selectionReason carries audit detail (item index / cadence target)
          // for the detail-page hover tooltip — Card UI shows a friendly label
          // ("Geplant") instead (Spec 62.4-followup Issue 3).
          selectionReason: `Floor ${contentType} #${pickedIndex}/${target}`,
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
