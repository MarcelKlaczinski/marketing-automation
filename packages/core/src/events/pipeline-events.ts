export type PipelineEvent =
  | { type: "pipeline.started"; runId: string; pipelineName: string; articleId?: string; clusterId?: string; timestamp: string }
  | { type: "pipeline.step.started"; runId: string; stepRunId: string; stepName: string; timestamp: string }
  | { type: "pipeline.step.completed"; runId: string; stepRunId: string; stepName: string; durationMs: number; costEur: number; timestamp: string }
  | { type: "pipeline.completed"; runId: string; pipelineName: string; articleId?: string; totalCostEur: number; durationMs: number; timestamp: string }
  | { type: "pipeline.failed"; runId: string; pipelineName: string; stepName: string; error: string; timestamp: string }
  | { type: "pipeline.cancelled"; runId: string; pipelineName: string; timestamp: string }
  | { type: "cluster.status.changed"; clusterId: string; oldStatus: string; newStatus: string; timestamp: string }
  | { type: "heartbeat"; timestamp: string }
  // Spec 56.6: Discovery events
  | { type: "trends.discovered"; projectId: string; newBriefIds: string[]; topScore: number; timestamp: string }
  | { type: "gaps.detected"; projectId: string; clusterId: string; gapIds: string[]; timestamp: string }
  | { type: "refresh.detected"; projectId: string; candidateCount: number; autoApprovedCount: number; timestamp: string }
  // Spec 57.2: Async Remotion render events
  | { type: "social.render.started"; socialPostId: string; projectId: string; articleId: string; timestamp: string }
  | { type: "social.render.completed"; socialPostId: string; projectId: string; articleId: string; slideCount: number; timestamp: string }
  | { type: "social.render.failed"; socialPostId: string; projectId: string; articleId: string; error: string; timestamp: string };
