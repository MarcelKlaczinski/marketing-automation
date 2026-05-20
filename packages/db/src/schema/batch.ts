// Spec 61.4: Anthropic Batch API request tracking.
// Each row represents one LLM call queued for batch processing.
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { articles } from "./content.ts";
import { projects } from "./projects.ts";

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

/**
 * Discriminated union stored in `pipeline_runs.suspension_checkpoint`.
 *
 * - `kind: "batch"` — pipeline is suspended awaiting an Anthropic Batch API result
 *   (Spec 61.4 Pattern 118). `batchRequestId` references `batch_requests.id`.
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
      kind: "step_pause";
      stepKey: string;
      stepPauseId: string;
      accumulatedOutput: Record<string, unknown>;
    };
