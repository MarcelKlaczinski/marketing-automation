// Spec 61.4: Anthropic Batch API request tracking.
// Each row represents one LLM call queued for batch processing.
//
// Spec 64.7: Image Batch API request tracking (Google Gemini). Parallel
// table to batch_requests — separate provider, separate cost units,
// separate processor worker.
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { articles } from "./content.ts";
import { projects } from "./projects.ts";
import { weeklyPlans } from "./operations.ts";

export const batchRequests = pgTable(
  "batch_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
    // Plain UUID — no DB FK to avoid circular dep between content.ts ↔ operations.ts
    pipelineRunId: uuid("pipeline_run_id"),

    anthropicBatchId: text("anthropic_batch_id"),
    // Correlation key: {runId}:{stepKey} — Pattern 119
    anthropicCustomId: text("anthropic_custom_id").notNull(),

    // pending | submitted | processing | completed | failed | cancelled | expired
    status: text("status").notNull().default("pending"),

    model: text("model").notNull(),
    // 'outline' | 'draft' | 'self_review'
    stepKey: text("step_key").notNull(),
    requestBody: jsonb("request_body").notNull(),
    responseBody: jsonb("response_body"),
    errorBody: jsonb("error_body"),

    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Pattern 120: 50% of sync rates, stored separately
    costEur: numeric("cost_eur", { precision: 10, scale: 6 }),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    anthropicBatchIdIdx: index("idx_batch_requests_anthropic_batch_id").on(t.anthropicBatchId),
    // Partial index: only index rows still in flight
    statusIdx: index("idx_batch_requests_status").on(t.status),
    projectIdx: index("idx_batch_requests_project_id").on(t.projectId),
  })
);

export type BatchRequest = typeof batchRequests.$inferSelect;
export type NewBatchRequest = typeof batchRequests.$inferInsert;

// ─── Spec 64.7: Image Batch Requests (Google Gemini) ──────────────────────────

/**
 * Per-hero-image batch request row. One row per pipeline_run hero-image step
 * in batch mode. The Plan-Coordinator aggregates pending rows per
 * `weekly_plan_id` into ONE Gemini Batch submit.
 *
 * Lifecycle:
 *   pending (HeroImageStep enqueues; gemini_batch_id NULL)
 *     → submitted (plan-coordinator submits batch; gemini_batch_id populated)
 *     → completed (process-results cron writes responseBody + cost)
 *     → resume_enqueued (resume worker re-enqueued pipeline; terminal)
 *
 * The custom_id format is `img-{pipelineRunId}` so the resume worker can locate
 * the suspended pipeline_runs row when the result comes back. Pattern 119 says
 * separator must satisfy `^[a-zA-Z0-9_-]{1,64}$` — `-` is safe.
 */
export const imageBatchRequests = pgTable(
  "image_batch_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // Plan reference — NULL for legacy/test paths that don't go through a plan.
    // ON DELETE SET NULL preserves the audit row.
    weeklyPlanId: uuid("weekly_plan_id").references(() => weeklyPlans.id, {
      onDelete: "set null",
    }),

    // Plain UUID — no DB FK to avoid circular dep between content.ts ↔ operations.ts.
    // Mirrors batch_requests.pipeline_run_id.
    pipelineRunId: uuid("pipeline_run_id"),

    // Google Gemini batch id — populated post-submit by the plan-coordinator.
    geminiBatchId: text("gemini_batch_id"),
    // Stable per-request correlation key: `img-{pipelineRunId}` (Pattern 119).
    geminiCustomId: text("gemini_custom_id").notNull(),

    // pending | submitted | completed | failed | resume_enqueued
    status: text("status").notNull().default("pending"),

    // Frozen request payload (prompt + model + resolution + aspectRatio + seed).
    // Adapter rebuilds the Gemini request from this when the coordinator submits.
    requestBody: jsonb("request_body").$type<ImageBatchRequestBody>().notNull(),
    // Shape: { imageUrl, costEur, seed?, error? }
    responseBody: jsonb("response_body").$type<ImageBatchResponseBody>(),

    // Estimated cost stamped at submit time (image_batch:submit log).
    // Real cost stamped on resume (image_batch:result log).
    estimatedCostEur: numeric("estimated_cost_eur", { precision: 10, scale: 4 }).$type<string>(),
    costEur: numeric("cost_eur", { precision: 10, scale: 4 }).$type<string>(),
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Submit-cron hot path (partial — only in-flight rows).
    statusCreatedIdx: index("idx_image_batch_status_created").on(t.status, t.createdAt),
    // Resume worker lookup by pipeline_run_id.
    pipelineRunIdx: index("idx_image_batch_pipeline_run").on(t.pipelineRunId),
    // Plan-coordinator lookup.
    weeklyPlanIdx: index("idx_image_batch_weekly_plan").on(t.weeklyPlanId),
    // Project-scoped admin queries.
    projectIdx: index("idx_image_batch_project").on(t.projectId),
    // Mirror of the migration's UNIQUE constraint (gemini_batch_id, gemini_custom_id).
    batchCustomUnique: unique("image_batch_requests_batch_custom_unique").on(
      t.geminiBatchId,
      t.geminiCustomId,
    ),
  }),
);

export type ImageBatchRequest = typeof imageBatchRequests.$inferSelect;
export type NewImageBatchRequest = typeof imageBatchRequests.$inferInsert;

/**
 * Frozen request payload for a single image-batch row. Captured at HeroImageStep
 * time so the coordinator can rebuild the Gemini request without re-reading the
 * article outline (which may change between suspend and submit).
 */
export type ImageBatchRequestBody = {
  prompt: string;
  model: "nano-banana-2" | "nano-banana-pro";
  resolution: "0.5k" | "1k" | "2k" | "4k";
  aspectRatio: string;
  seed: number;
  outputFormat: "webp" | "png" | "jpeg";
  storagePrefix: string;
};

/**
 * Response payload written by `image-batch-processor.worker.ts` after the
 * Gemini batch resolves. R2 upload happens BEFORE the response is persisted
 * so `imageUrl` and `r2Key` are stable references the resume worker passes
 * back into HeroImageStep via `ctx.batchResult.content` (JSON-encoded).
 */
export type ImageBatchResponseBody = {
  r2Key: string;
  publicUrl: string;
  costEur: number;
  seed: number | null;
  // Populated on the failure path. Status is then 'failed' and resume re-enqueues
  // the pipeline with the error so HeroImageStep's graceful-skip kicks in.
  error?: string;
};

/**
 * Discriminated union stored in `pipeline_runs.suspension_checkpoint`.
 *
 * - `kind: "batch"` — pipeline is suspended awaiting an Anthropic Batch API result
 *   (Spec 61.4 Pattern 118). `batchRequestId` references `batch_requests.id`.
 * - `kind: "image_batch"` — pipeline is suspended awaiting a Google Gemini Image
 *   Batch result (Spec 64.7). `imageBatchRequestId` references `image_batch_requests.id`.
 * - `kind: "step_pause"` — pipeline is suspended in debug-mode awaiting user
 *   resolution of a step pause (Spec 62.0a). `stepPauseId` references `step_pauses.id`.
 *
 * Rows written before Spec 62.0a-followup do NOT have a `kind` field — readers must
 * fall back to inspecting `batchRequestId` vs `stepPauseId` for legacy rows.
 */
export type SuspensionCheckpoint =
  | {
      kind: "batch";
      stepKey: string;
      batchRequestId: string;
      accumulatedOutput: Record<string, unknown>;
    }
  | {
      kind: "image_batch";
      stepKey: string;
      imageBatchRequestId: string;
      accumulatedOutput: Record<string, unknown>;
    }
  | {
      kind: "step_pause";
      stepKey: string;
      stepPauseId: string;
      accumulatedOutput: Record<string, unknown>;
    };
