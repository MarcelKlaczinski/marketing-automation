export type PipelineEvent =
  | { type: "pipeline.started"; runId: string; pipelineName: string; articleId?: string; clusterId?: string; timestamp: string }
  | { type: "pipeline.step.started"; runId: string; stepRunId: string; stepName: string; timestamp: string }
  | { type: "pipeline.step.completed"; runId: string; stepRunId: string; stepName: string; durationMs: number; costEur: number; timestamp: string }
  | { type: "pipeline.completed"; runId: string; pipelineName: string; articleId?: string; totalCostEur: number; durationMs: number; timestamp: string }
  | { type: "pipeline.failed"; runId: string; pipelineName: string; stepName: string; error: string; timestamp: string }
  | { type: "pipeline.cancelled"; runId: string; pipelineName: string; timestamp: string }
  | { type: "cluster.status.changed"; clusterId: string; oldStatus: string; newStatus: string; timestamp: string }
  | { type: "heartbeat"; timestamp: string };
