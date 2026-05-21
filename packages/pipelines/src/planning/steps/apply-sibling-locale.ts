// Spec 62.4 Step 7: clone DE cluster items into EN siblings.
//
// Only DE cluster items get a sibling. The sibling's pipeline is article:
// translation when a routedArticleId is known (Step 62.0a-followup: the
// per-article `skipAutoTranslationUntil` honors temporary opt-outs). Since
// 62.4 emits planned_items BEFORE any article is generated, we cannot
// reliably check that column from the brief alone — we only know the cluster
// has DE work. The skip check is therefore deferred to 62.8 (execution),
// which sees the freshly generated article. 62.4 always emits the sibling
// draft so the plan stays predictable; 62.8 marks it `skipped` if needed.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import type { PlanningItemDraft } from "../types.ts";

export const applySiblingInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof applySiblingInputSchema>;

export const applySiblingOutputSchema = z.object({
  siblingItems: z.array(z.unknown()),
});
type Output = z.infer<typeof applySiblingOutputSchema>;

export class ApplySiblingLocaleStep extends BaseStep<Input, Output> {
  readonly name = "apply-sibling-locale";
  readonly inputSchema = applySiblingInputSchema;
  readonly outputSchema = applySiblingOutputSchema;

  async execute(_input: Input, ctx: StepContext): Promise<Output> {
    const floor =
      ctx.getStepOutput<{ floorItems: PlanningItemDraft[] }>("select-floor-items")?.floorItems ??
      [];
    const overage =
      ctx.getStepOutput<{ overageItems: PlanningItemDraft[] }>("select-overage-items")
        ?.overageItems ?? [];

    const siblings: PlanningItemDraft[] = [];
    for (const item of [...floor, ...overage]) {
      if (item.contentType !== "cluster") continue;
      if (item.locale !== "de") continue;

      siblings.push({
        draftId: randomUUID(),
        contentType: "cluster",
        pipelineName: "article:translation",
        sourceKind: "sibling_locale",
        sourceBriefId: item.sourceBriefId,
        sourceSignalId: item.sourceSignalId,
        parentDraftId: item.draftId,
        locale: "en",
        pipelineInput: {
          ...item.pipelineInput,
          parentDraftId: item.draftId,
          targetLocale: "en",
        },
        slotDate: null,
        selectionScore: null,
        selectionReason: `Sibling EN for ${item.selectionReason}`,
        estimatedCostEur: null,
      });
    }

    return { siblingItems: siblings };
  }
}
