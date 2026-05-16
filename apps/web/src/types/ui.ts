/**
 * UI-specific types for Spec 56.1 dashboard.
 * API response types come from the api-client layer; these are
 * UI-only shapes for the stores, composables, and components.
 */

/** Pipeline status values mirroring the DB enum */
export type PipelineStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Cluster generation status */
export type ClusterGenerationStatus =
  | "idle"
  | "plan_proposed"
  | "running"
  | "partial"
  | "completed"
  | "failed";

/** Article generation status within a cluster */
export type ArticleGenerationStatus = "idle" | "queued" | "running" | "done" | "failed";

/** Pipeline event types pushed via SSE */
export type PipelineEventType =
  | "pipeline.started"
  | "pipeline.step.started"
  | "pipeline.step.completed"
  | "pipeline.completed"
  | "pipeline.failed"
  | "pipeline.cancelled"
  | "cluster.status.changed";

/** A single SSE pipeline event */
export interface PipelineEvent {
  type: PipelineEventType;
  timestamp: string;
  runId?: string;
  clusterId?: string;
  projectSlug: string;
  payload: Record<string, unknown>;
}

/** Pipeline run summary (used in kanban lanes) */
export interface PipelineRunSummary {
  id: string;
  type: string;
  status: PipelineStatus;
  title: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStep: string | null;
  stepCount: number;
  completedSteps: number;
  costEur: number | null;
  errorMessage: string | null;
}

/** Single pipeline step (used in detail pane timeline) */
export interface PipelineStep {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  costEur: number | null;
}

/** Full pipeline run detail (used in detail pane) */
export interface PipelineRunDetail extends PipelineRunSummary {
  steps: PipelineStep[];
  authorId: string | null;
  wordCount: number | null;
  estimatedCostEur: number | null;
}

/** A project entry in the picker dropdown */
export interface ProjectPickerEntry {
  id: string;
  slug: string;
  name: string;
  industry: string;
  activity: {
    runningCount: number;
    queuedCount: number;
    failedLast24h: number;
  };
  stats: {
    articleCount: number;
    costThisMonthEur: number;
  };
}

/** Authenticated user */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

/** Cost summary for stat card */
export interface CostSummary {
  totalEur: number;
  previousEur: number;
  trendPercent: number;
  sparkline: number[];
  window: "today" | "week" | "month";
}

/** Cluster card data */
export interface ClusterCardData {
  id: string;
  name: string;
  pillar: string;
  generationStatus: ClusterGenerationStatus;
  articleStatuses: ArticleGenerationStatus[];
  progressPercent: number;
  costEur: number | null;
}

/** Dashboard header stats */
export interface DashboardHeaderStats {
  runningCount: number;
  queuedCount: number;
  todayCostEur: number;
}
