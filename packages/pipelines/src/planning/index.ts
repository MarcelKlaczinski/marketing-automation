// Spec 62.4: public exports for PlanWeekPipeline + step classes + helpers.

export { PlanWeekPipeline, type PlanWeekPipelineDeps } from "./plan-week-pipeline.ts";
export {
  planWeekPipelineInputSchema,
  planWeekPipelineOutputSchema,
  PIPELINE_NAME_BY_CONTENT_TYPE,
  type PlanWeekPipelineInput,
  type PlanWeekPipelineOutput,
  type PlanningContentType,
  type PlanningItemDraft,
} from "./types.ts";
export {
  BudgetExceededError,
  PlanGenerationError,
  type PlanGenerationDetail,
} from "./errors.ts";

export { BudgetGateStep } from "./steps/budget-gate.ts";
export { DistributeSlotDatesStep } from "./steps/distribute-slot-dates.ts";
export { EstimateCostStep } from "./steps/estimate-cost.ts";
export { LoadTopicBriefsStep } from "./steps/load-topic-briefs.ts";
export { PersistPlanStep } from "./steps/persist-plan.ts";
export {
  RefreshSignalsStep,
  type RefreshSignalsDeps,
} from "./steps/refresh-signals.ts";
export {
  SelectFloorItemsStep,
  matchBriefToContentType,
  targetWeeklyCount,
} from "./steps/select-floor-items.ts";
export {
  SelectOverageItemsStep,
  inferContentTypeFromSignal,
} from "./steps/select-overage-items.ts";
export {
  SelectSocialPostItemsStep,
  type SelectSocialPostDeps,
} from "./steps/select-social-post-items.ts";
export { SnapshotInputsStep } from "./steps/snapshot-inputs.ts";
export { ValidateGoalsStep } from "./steps/validate-goals.ts";

export {
  enqueuePlanWeekPipeline,
  type EnqueuePlanWeekInput,
} from "./trigger.ts";

// Spec 63.5: diversity lib — exposed for downstream selectors + tests.
export {
  adjustScoreWithDiversity,
  cosineSimilarity,
  type DiversityAdjustment,
  type DiversityConfig,
} from "./lib/diversity-score.ts";
export {
  buildEmbeddingText,
  createPlanRunEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderOptions,
} from "./lib/diversity-embedding.ts";
export {
  normalizeBriefBaseScore,
  pickWithDiversity,
  type DiversityPickReason,
  type PickWithDiversityOptions,
  type PickWithDiversityResult,
} from "./lib/pick-with-diversity.ts";
