// Spec 62.4: shared types for PlanWeekPipeline.
//
// `PlanningItemDraft` is the in-memory representation of one planned_item as
// it flows through the selection / sibling / scheduling / cost steps. It is
// converted to a NewPlannedItem at PersistPlanStep time. Carrying a draft id
// (separate from the eventual DB id) lets ApplySiblingLocale link a sibling
// back to its parent before either row exists in the database.

import { z } from "zod";

export const PLANNING_CONTENT_TYPES = ["cluster", "comparison", "social_post", "ki_wissen"] as const;
export type PlanningContentType = (typeof PLANNING_CONTENT_TYPES)[number];

/**
 * Default pipeline name per content type. Mirrors `CONTENT_TYPE_TO_PIPELINE`
 * from packages/planner/src/goal-validator.ts — but kept inline to avoid
 * importing it as a side-effect (the planner export is `itemType`-keyed and
 * meant for cost estimation, not for hard-coding pipeline names in plan items).
 */
export const PIPELINE_NAME_BY_CONTENT_TYPE: Record<PlanningContentType, string> = {
  cluster: "cluster:full-plan",
  comparison: "article:blog",
  ki_wissen: "article:blog",
  social_post: "article:social-image",
};

/**
 * Used by SnapshotInputsStep → SelectFloorItemsStep → SelectOverageItemsStep →
 * ApplySiblingLocaleStep → DistributeSlotDatesStep → PersistPlanStep. Each
 * step transforms or augments this draft; only PersistPlan converts to
 * `NewPlannedItem`.
 */
export interface PlanningItemDraft {
  /** Stable in-memory id; becomes parent_item_id for siblings. */
  draftId: string;
  contentType: PlanningContentType;
  pipelineName: string;
  sourceKind: "floor" | "overage_signal" | "sibling_locale";
  sourceBriefId: string | null;
  sourceSignalId: string | null;
  parentDraftId: string | null;
  /** "de" / "en" — drives sibling expansion. null means locale-neutral. */
  locale: "de" | "en" | null;
  pipelineInput: Record<string, unknown>;
  /** Filled in by DistributeSlotDatesStep. Empty Date until then. */
  slotDate: Date | null;
  selectionScore: number | null;
  selectionReason: string;
  estimatedCostEur: number | null;
}

// Two-step schema/type definition is the workspace idiom for Zod-with-defaults
// flowing through `ZodType<T>` parameters (see packages/pipelines/CLAUDE.md
// "as z.ZodType<Input>` cast pattern"). Without the cast,
// `z.boolean().default(false)` makes `_input.force` `boolean | undefined` and
// Pipeline's `inputSchema: ZodType<TInput>` declaration rejects it.
const _planWeekPipelineInputSchema = z.object({
  projectId: z.string().uuid(),
  targetYear: z.number().int().min(2020).max(2100),
  targetIsoWeek: z.number().int().min(1).max(53),
  triggeredBy: z.string(),
  /** When true, supersede any existing active plan for the target week. */
  force: z.boolean().default(false),
  /** PreRun bookkeeping passed by triggerWithPreRunId; ignored by steps. */
  preRunId: z.string().uuid().optional(),
});
export type PlanWeekPipelineInput = z.infer<typeof _planWeekPipelineInputSchema>;
export const planWeekPipelineInputSchema =
  _planWeekPipelineInputSchema as z.ZodType<PlanWeekPipelineInput>;

export const planWeekPipelineOutputSchema = z.object({
  weeklyPlanId: z.string().uuid(),
  itemCount: z.number().int().min(0),
  estimatedCostEur: z.number().min(0),
  status: z.literal("draft"),
  supersededPlanId: z.string().uuid().nullable(),
});
export type PlanWeekPipelineOutput = z.infer<typeof planWeekPipelineOutputSchema>;
