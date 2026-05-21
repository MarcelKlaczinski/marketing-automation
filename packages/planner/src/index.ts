export {
  GOAL_VALIDATION_ERROR_CODES,
  GOAL_VALIDATION_WARNING_CODES,
  validateProjectGoals,
  weeklyCountFromGoal,
  type GoalValidationErrorCode,
  type GoalValidationIssue,
  type GoalValidationResult,
  type GoalValidationWarningCode,
  type ValidateProjectGoalsOptions,
} from "./goal-validator.ts";

export {
  refreshSignalsForProject,
  type RefreshSignalsForProjectInput,
  type RefreshableSignal,
  type SignalFetcher,
  type SignalFetcherContext,
  type SignalRefreshResult,
  type SignalRefreshSourceResult,
  type SignalRefreshStatus,
  type SignalSourceName,
} from "./signal-refresh.ts";

export {
  computePairScore,
  discoverComparisonPairs,
  type ComparisonDiscoveryResult,
  type DiscoverComparisonPairsInput,
  type ScoreInputs,
  type ScoreWeights,
} from "./comparison-discovery.ts";

export {
  loadPendingTopicBriefs,
  PLANNER_HANDLED_SOURCES,
  type LoadPendingTopicBriefsInput,
  type PlannerHandledSource,
} from "./load-topic-briefs.ts";

export {
  computeSignalTopN,
  mergeAndTopN,
  normalizePerSource,
  rawScoreFor,
  type ComputeSignalTopNInput,
  type SignalTopNRow,
} from "./signal-top-n.ts";

export {
  addDaysUtc,
  computeNextIsoWeek,
  getIsoWeek,
  isoWeekEndDate,
  isoWeekStartDate,
} from "./iso-week.ts";

export {
  countSuggestionPool,
  pickFromRefreshSuggestions,
  pickFromSuggestionPool,
  type PickFromRefreshSuggestionsInput,
  type PickFromSuggestionPoolInput,
  type RefreshPoolCandidate,
  type SuggestionPoolCandidate,
} from "./social-source-selectors.ts";

export {
  SOCIAL_ELIGIBLE_COLLECTIONS,
  type SocialEligibleCollection,
} from "./social-eligible-collections.ts";

// Spec 62.8: production-run execution
export {
  getPipelineForItem,
  type LlmMode,
  type RoutedJob,
} from "./execution/pipeline-router.ts";
