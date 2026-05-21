import { z } from "zod";

/**
 * Spec 62.4: Planner-Engine — Zod schemas for weekly_plans + planned_items.
 *
 * These types are shared between the planner pipeline (writer), the Drizzle
 * schema ($type<>() cast), API routes (response shape), and the future
 * 62.5 calendar UI (item rendering).
 */

export const WEEKLY_PLAN_STATUSES = [
  "draft",
  "approved",
  "running",
  "completed",
  "partially_failed",
  "cancelled",
  "superseded",
] as const;
export const weeklyPlanStatusSchema = z.enum(WEEKLY_PLAN_STATUSES);
export type WeeklyPlanStatus = z.infer<typeof weeklyPlanStatusSchema>;

export const PLANNED_ITEM_STATUSES = [
  "pending",
  "enqueued",
  "in_progress",
  "completed",
  "failed",
  "skipped",
  "cancelled",
  // Spec 62.8: terminal state set by Phase E Distribution. 62.8 never writes
  // it directly — only Distribution flips 'completed' → 'published'.
  "published",
] as const;
export const plannedItemStatusSchema = z.enum(PLANNED_ITEM_STATUSES);
export type PlannedItemStatus = z.infer<typeof plannedItemStatusSchema>;

export const PLANNED_ITEM_SOURCE_KINDS = ["floor", "overage_signal", "sibling_locale"] as const;
export const plannedItemSourceKindSchema = z.enum(PLANNED_ITEM_SOURCE_KINDS);
export type PlannedItemSourceKind = z.infer<typeof plannedItemSourceKindSchema>;

/**
 * Frozen identifier for one topic_brief at plan-generation time. Stores the
 * source-specific metadata as `unknown` because the four metadata columns
 * (gap/trend/refresh/comparison) have different shapes — the planner only
 * needs to round-trip the data for debug visibility, not interpret it.
 */
export const topicBriefSnapshotEntrySchema = z.object({
  id: z.string().uuid(),
  source: z.enum([
    "gap_analysis",
    "trend_discovery",
    "refresh_detection",
    "manual",
    "comparison_discovery",
  ]),
  clusterAction: z.enum([
    "append_to_existing",
    "create_new",
    "translation",
    "refresh",
    "standalone",
    "comparison",
  ]),
  topicTitle: z.string(),
  locale: z.string().nullable(),
  primaryKeyword: z.string().nullable(),
  clusterId: z.string().uuid().nullable(),
  metadata: z.unknown().nullable(),
});
export type TopicBriefSnapshotEntry = z.infer<typeof topicBriefSnapshotEntrySchema>;

export const signalTopNEntrySchema = z.object({
  signalId: z.string().uuid(),
  source: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  rawScore: z.number(),
  normalizedScore: z.number().min(0).max(1),
});
export type SignalTopNEntry = z.infer<typeof signalTopNEntrySchema>;

/**
 * Per-source result mirrored from planner's SignalRefreshResult. Kept loose
 * (z.unknown for `error`/`notes`) so the snapshot stays forward-compatible
 * if SignalRefreshSourceResult gains fields.
 */
export const signalRefreshSourceResultSnapshotSchema = z.object({
  source: z.string(),
  status: z.string(),
  rowsAdded: z.number().int().min(0),
  lastCollectedAt: z.string().datetime().nullable(),
  notes: z.string().optional(),
  error: z.string().optional(),
});
export type SignalRefreshSourceResultSnapshot = z.infer<
  typeof signalRefreshSourceResultSnapshotSchema
>;

export const signalRefreshResultSnapshotSchema = z.object({
  projectId: z.string().uuid(),
  triggeredAt: z.string().datetime(),
  sourceResults: z.array(signalRefreshSourceResultSnapshotSchema),
  totalRowsAdded: z.number().int().min(0),
  durationMs: z.number().int().min(0),
});
export type SignalRefreshResultSnapshot = z.infer<typeof signalRefreshResultSnapshotSchema>;

/** Frozen goal-row shape used inside the snapshot — keep loose so future goal columns flow through. */
export const goalSnapshotEntrySchema = z.object({
  id: z.string().uuid(),
  contentType: z.string(),
  cadenceUnit: z.enum(["per_day", "per_week"]),
  minCount: z.number().int(),
  maxCount: z.number().int().nullable(),
  isActive: z.boolean(),
});
export type GoalSnapshotEntry = z.infer<typeof goalSnapshotEntrySchema>;

export const plannerConfigSnapshotSchema = z.object({
  weeklyBudgetEur: z.number(),
  perTypeMaxEur: z.record(z.string(), z.number()).nullable(),
  topNSignalsAllowedOverage: z.number().int().min(0),
  maxOveragePerSignal: z.number().int().min(0),
  signalMaxAgeHours: z.number().int().min(0),
  excludedPipelines: z.array(z.string()),
  // Spec 62.5.1: LLM execution mode at plan-generation time. Required for
  // reproducibility — a snapshot replayed under a different llmMode would
  // produce different cost estimates. Defaults to "sync" for back-compat
  // with snapshots written before 62.5.1.
  llmMode: z.enum(["sync", "batch"]).default("sync"),
});
export type PlannerConfigSnapshot = z.infer<typeof plannerConfigSnapshotSchema>;

/**
 * Persisted in weekly_plans.input_snapshot — everything the algorithm read at
 * trigger time. Reproducible runs: the same snapshot replayed through
 * deterministic selection produces the same planned_items.
 */
export const weeklyPlanInputSnapshotSchema = z.object({
  goals: z.array(goalSnapshotEntrySchema),
  config: plannerConfigSnapshotSchema,
  signalRefreshResult: signalRefreshResultSnapshotSchema,
  topicBriefSnapshot: z.array(topicBriefSnapshotEntrySchema),
  signalTopN: z.array(signalTopNEntrySchema),
  triggeredAt: z.string().datetime(),
});
export type WeeklyPlanInputSnapshot = z.infer<typeof weeklyPlanInputSnapshotSchema>;

/** Body of POST /api/projects/:slug/plans/generate. */
export const generatePlanPayloadSchema = z.object({
  targetYear: z.number().int().min(2020).max(2100),
  targetIsoWeek: z.number().int().min(1).max(53),
  force: z.boolean().optional().default(false),
  /**
   * Spec 62.6.1: when true, the pipeline runs in `debug` mode — the runner persists
   * a `step_pauses` row after every `pausableInDebug()` step and the user resolves
   * each one via the runs UI. Defaults to false (production end-to-end execution).
   */
  debug: z.boolean().optional().default(false),
});
export type GeneratePlanPayload = z.infer<typeof generatePlanPayloadSchema>;

/** PATCH /api/projects/:slug/plans/:planId. */
export const patchWeeklyPlanPayloadSchema = z.object({
  status: z.enum(["approved", "cancelled"]),
  approvedBy: z.string().optional(),
});
export type PatchWeeklyPlanPayload = z.infer<typeof patchWeeklyPlanPayloadSchema>;

/**
 * PATCH /api/projects/:slug/plans/:planId/items/:itemId.
 *
 * Two mutually-exclusive operations (62.5):
 *   - { status: 'cancelled' }              cancel the item (62.4)
 *   - { slotDate: 'YYYY-MM-DD' }           reschedule the item within the plan week (62.5)
 *
 * The handler dispatches on which field is present. Both fields together are
 * rejected (`.refine`) — keeps the route logic single-action per request.
 */
export const patchPlannedItemPayloadSchema = z
  .object({
    status: z.enum(["cancelled"]).optional(),
    slotDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "slotDate must be ISO date YYYY-MM-DD")
      .optional(),
  })
  .refine((v) => (v.status !== undefined) !== (v.slotDate !== undefined), {
    message: "Provide exactly one of `status` or `slotDate`",
  });
export type PatchPlannedItemPayload = z.infer<typeof patchPlannedItemPayloadSchema>;
