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
  discoverComparisonPairs,
  type ComparisonDiscoveryResult,
  type DiscoverComparisonPairsInput,
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
