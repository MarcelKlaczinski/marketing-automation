// Spec 62.4 Step 6: top-N signal overage selection.
//
// For each of the top-N normalised signals (in `snapshot.signalTopN`):
//   - skip if a brief derived from this signal is already in floorItems
//     (heuristic: a brief whose sourceSignalId equals the signal id)
//   - infer a content type from the signal source (ProductHunt → social_post,
//     HackerNews → ki_wissen, etc.); unmapped sources are skipped
//   - emit `maxOveragePerSignal` (default 1) items per qualifying signal
//
// Result: a list of "overage_signal" PlanningItemDraft, ready for sibling
// expansion + scheduling.

import { randomUUID } from "node:crypto";
import type { ProjectPlannerConfig } from "@marketing-auto/db";
import type { WeeklyPlanInputSnapshot } from "@marketing-auto/shared";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import {
  PIPELINE_NAME_BY_CONTENT_TYPE,
  type PlanningContentType,
  type PlanningItemDraft,
} from "../types.ts";

export const selectOverageInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof selectOverageInputSchema>;

export const selectOverageOutputSchema = z.object({
  overageItems: z.array(z.unknown()),
});
type Output = z.infer<typeof selectOverageOutputSchema>;

/**
 * Heuristic mapping from signal source → planner content type. Tunable in
 * code; see Spec 62.4 Risk #3. Returns null for sources that don't have a
 * sensible mapping yet.
 */
export function inferContentTypeFromSignal(source: string): PlanningContentType | null {
  switch (source) {
    case "producthunt":
      return "social_post";
    case "hackernews":
      return "ki_wissen";
    case "reddit":
      return "social_post";
    case "vendor_rss":
      return "cluster";
    case "github":
      return "ki_wissen";
    case "dataforseo_trends":
      return "cluster";
    default:
      return null;
  }
}

export class SelectOverageItemsStep extends BaseStep<Input, Output> {
  readonly name = "select-overage-items";
  readonly inputSchema = selectOverageInputSchema;
  readonly outputSchema = selectOverageOutputSchema;

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const config = ctx.getStepOutput<{ config: ProjectPlannerConfig }>("validate-goals")?.config;
    const snapshot = ctx.getStepOutput<{ snapshot: WeeklyPlanInputSnapshot }>(
      "snapshot-inputs",
    )?.snapshot;
    const floorItems =
      ctx.getStepOutput<{ floorItems: PlanningItemDraft[] }>("select-floor-items")?.floorItems ?? [];

    if (!config || !snapshot) {
      throw new Error("select-overage-items: prior step output missing");
    }

    const used = new Set<string>(
      floorItems.map((it) => it.sourceSignalId).filter((id): id is string => id !== null),
    );

    const items: PlanningItemDraft[] = [];
    const eligible = snapshot.signalTopN.slice(0, config.topNSignalsAllowedOverage);

    for (const signal of eligible) {
      if (used.has(signal.signalId)) continue;
      const contentType = inferContentTypeFromSignal(signal.source);
      if (contentType === null) continue;

      for (let i = 0; i < config.maxOveragePerSignal; i++) {
        items.push({
          draftId: randomUUID(),
          contentType,
          pipelineName: PIPELINE_NAME_BY_CONTENT_TYPE[contentType],
          sourceKind: "overage_signal",
          sourceBriefId: null,
          sourceSignalId: signal.signalId,
          parentDraftId: null,
          locale: null,
          pipelineInput: {
            signalId: signal.signalId,
            projectId: input.projectId,
            signalTitle: signal.title,
            // Mirror under `title` so the planner-card cascade
            // (pipelineInput.title → topicTitle → selectionReason) picks it up
            // without a special-cased branch for overage items.
            title: signal.title,
          },
          slotDate: null,
          selectionScore: signal.normalizedScore,
          selectionReason: `Top-${i + 1} signal: ${signal.title} (score ${signal.normalizedScore.toFixed(2)})`,
          estimatedCostEur: null,
        });
      }
    }

    return { overageItems: items };
  }
}
