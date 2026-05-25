export type { TopicSource, TopicSourceContext } from "./types.ts";
export { GapAnalysisTopicSource } from "./gap-analysis/source.ts";
export { mapGapToBrief } from "./gap-analysis/map-gap-to-brief.ts";
export { TrendDiscoveryTopicSource } from "./trend-discovery/index.ts";
export type { SynthesisOutput, SynthesisTopic, ScoreBreakdown } from "./trend-discovery/index.ts";

// Spec 64.20 follow-up A3
export {
  emitReleaseBrief,
  RELEASE_DETECTION_WEEKLY_CAP,
  type EmitReleaseBriefInput,
  type EmitReleaseBriefResult,
} from "./release-detection/index.ts";
