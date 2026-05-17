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

/** Pipeline run summary (used in kanban lanes) — shape mirrors ActivityEntry from /pipeline-runs/active */
export interface PipelineRunSummary {
  id: string;
  type: string;
  status: PipelineStatus;
  title: string;
  subtitle: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStep: string | null;
  stepCount: number;
  completedSteps: number;
  costEur: number | null;
  errorMessage: string | null;
  articleSlug: string | null;
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

/** Cluster card data (simplified view for the dashboard card) */
export interface ClusterCardData {
  id: string;
  name: string;
  pillar: string;
  generationStatus: ClusterGenerationStatus;
  articleStatuses: ArticleGenerationStatus[];
  progressPercent: number;
  costEur: number | null;
}

/** Article stub returned inside a cluster status response */
export interface ClusterArticleStub {
  id: string;
  slug: string;
  title: string | null;
  status: string;
  locale: string | null;
  role: string | null;
  heroImagePublicUrl: string | null;
}

/** Pipeline run entry inside cluster status response */
export interface ClusterPipelineRun {
  id: string;
  pipelineName: string;
  status: string;
  articleId: string | null;
  createdAt: string;
}

/** Full response shape for GET /api/projects/:slug/clusters/:id/generation-status */
export interface ClusterStatusResponse {
  cluster: {
    id: string;
    name: string;
    pillarName: string | null;
    primaryKeyword: string | null;
    generationStatus: ClusterGenerationStatus;
    proposedSpokes: unknown[] | null;
    pendingSpokeBriefIds: string[];
  };
  hubArticle: ClusterArticleStub | null;
  spokeArticles: ClusterArticleStub[];
  pipelineRuns: ClusterPipelineRun[];
  cost: { spentEur: number; estimatedEur: number };
  progress: { completed: number; expected: number; percent: number };
}

/** One cost line in a pipeline run detail response */
export interface RunCostEntry {
  id: string;
  operation: string;
  service: string;
  costEur: string | null;
  createdAt: string;
}

/** Full response shape for GET /api/pipeline-runs/:id */
export interface PipelineRunDetailResponse {
  run: {
    id: string;
    pipelineName: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    durationMs: number | null;
    error: string | null;
    retriedFromRunId: string | null;
  };
  steps: Array<{
    id: string;
    stepName: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
    error: string | null;
  }>;
  costs: RunCostEntry[];
  totalCostEur: number;
  article: { id: string; title: string | null; slug: string; status: string; locale: string | null } | null;
  brief: { id: string; source: string; topicTitle: string } | null;
}

/** Cluster list entry from GET /api/projects/:slug/clusters */
export interface ClusterListEntry {
  id: string;
  name: string;
  pillarName: string | null;
  generationStatus: ClusterGenerationStatus | null;
  articleCount: number;
}

/** Dashboard header stats */
export interface DashboardHeaderStats {
  runningCount: number;
  queuedCount: number;
  todayCostEur: number;
}

// ─── Article types (Spec 56.2) ────────────────────────────────────────────────

/** Article list item from GET /api/projects/:slug/articles (cursor mode) */
export interface ArticleListItem {
  id: string;
  slug: string;
  title: string | null;
  cornerstoneKeyword: string | null;
  collection: string | null;
  locale: string | null;
  status: string;
  wordCount: number | null;
  updatedAt: string;
  translationKey: string | null;
  heroImagePublicUrl: string | null;
}

/** Paginated articles response */
export interface ArticlesListResponse {
  items: ArticleListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

/** Article detail from GET /api/articles/:id */
export interface ArticleDetail {
  id: string;
  slug: string;
  title: string | null;
  cornerstoneKeyword: string | null;
  collection: string | null;
  locale: string | null;
  status: string;
  wordCount: number | null;
  bodyMd: string | null;
  outlineMd: string | null;
  frontmatterExtras: Record<string, unknown> | null;
  updatedAt: string;
  createdAt: string;
  heroImagePublicUrl: string | null;
  heroImageAltText: string | null;
  translationSibling: { id: string; locale: string; status: string } | null;
}

/** Article versions list entry */
export interface ArticleVersionEntry {
  id: string;
  versionNumber: number;
  changeReason: string | null;
  wordCount: number | null;
  createdAt: string;
}

// ─── Brief types (Spec 56.2) ──────────────────────────────────────────────────

/** Brief list item from GET /api/projects/:slug/briefs */
export interface BriefListItem {
  id: string;
  topicTitle: string;
  primaryKeyword: string | null;
  source: string;
  approvalStatus: string;
  clusterAction: string | null;
  clusterId: string | null;
  trendMetadata: {
    /** Legacy field used by BriefCard */
    trendScore?: number;
    scoreBreakdown?: { total?: number; [key: string]: unknown };
    signals?: string[];
    [key: string]: unknown;
  } | null;
  createdAt: string;
}

/** Paginated briefs response */
export interface BriefsListResponse {
  section: string;
  items: BriefListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}
