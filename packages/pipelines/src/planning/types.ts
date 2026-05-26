// Spec 62.4: shared types for PlanWeekPipeline.
//
// `PlanningItemDraft` is the in-memory representation of one planned_item as
// it flows through the selection / scheduling / cost steps. It is converted
// to a NewPlannedItem at PersistPlanStep time. Carrying a draft id (separate
// from the eventual DB id) lets SelectSocialPostItemsStep link a social_post
// child to its parent cluster draft before either row exists in the database.

import { z } from "zod";

// Spec 64.1: `cluster_spoke` is the append_to_existing sibling of `cluster`.
// Routes through article:blog (spoke under brief.clusterId), so its default
// pipeline name is the cheaper €1.06 article:blog, not cluster:full-plan.
//
// Spec 65.5: `recurring_content` is the bucket for cron-fired recurring-content
// briefs. Default pipeline is `article:social-image` (social-first per the
// v1 output_targets default); the article-first toggle in `output_targets`
// is honoured by the pipeline-router (Spec 65.5 §3.4 / executor).
export const PLANNING_CONTENT_TYPES = [
  "cluster",
  "cluster_spoke",
  "comparison",
  "social_post",
  "ki_wissen",
  "recurring_content",
] as const;
export type PlanningContentType = (typeof PLANNING_CONTENT_TYPES)[number];

/**
 * Default pipeline name per content type. Mirrors `CONTENT_TYPE_TO_PIPELINE`
 * from packages/planner/src/goal-validator.ts — but kept inline to avoid
 * importing it as a side-effect (the planner export is `itemType`-keyed and
 * meant for cost estimation, not for hard-coding pipeline names in plan items).
 */
export const PIPELINE_NAME_BY_CONTENT_TYPE: Record<PlanningContentType, string> = {
  cluster: "cluster:full-plan",
  cluster_spoke: "article:blog",
  comparison: "article:blog",
  ki_wissen: "article:blog",
  social_post: "article:social-image",
  // Spec 65.5: social-first default — the executor branches on the brief's
  // `recurringMetadata.formatConfig.outputTargets` (frozen at emit time) so an
  // article-only definition gets routed to `article:blog` instead.
  recurring_content: "article:social-image",
};

/**
 * Used by SnapshotInputsStep → SelectFloorItemsStep → SelectOverageItemsStep →
 * SelectSocialPostItemsStep → DistributeSlotDatesStep → PersistPlanStep. Each
 * step transforms or augments this draft; only PersistPlan converts to
 * `NewPlannedItem`.
 *
 * `sibling_locale` source-kind is retained on the type so historical draft/
 * approved plans still parse cleanly; new plans never emit it (Spec 62.4-
 * followup Issue 1 — cluster:full-plan + article:translation produce DE+EN
 * internally).
 */
export interface PlanningItemDraft {
  /** Stable in-memory id; previously also used as parent_item_id for siblings. */
  draftId: string;
  contentType: PlanningContentType;
  pipelineName: string;
  sourceKind: "floor" | "overage_signal" | "sibling_locale";
  sourceBriefId: string | null;
  sourceSignalId: string | null;
  parentDraftId: string | null;
  /**
   * null = pipeline produces both locales internally (current behaviour for
   * cluster items, post-62.4-followup). "de"/"en" = single-locale planned_item
   * (comparison, ki_wissen, and legacy sibling_locale rows).
   */
  locale: "de" | "en" | null;
  pipelineInput: Record<string, unknown>;
  /** Filled in by DistributeSlotDatesStep. null until then. */
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
