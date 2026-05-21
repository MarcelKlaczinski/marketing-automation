import {
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { isNull, sql } from "drizzle-orm";
import type { WeeklyPlanInputSnapshot } from "@marketing-auto/shared";
import { approvalActionEnum, costServiceEnum, pipelineRunStatusEnum } from "./_enums.ts";
import { users } from "./auth.ts";
import { articles, externalSignals, socialPosts, topicBriefs } from "./content.ts";
import { projects } from "./projects.ts";

export const systemSettings = pgTable("system_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const globalCredentials = pgTable(
  "global_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    service: text("service").notNull(),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    serviceKeyUnique: uniqueIndex("global_credentials_service_key_unique").on(
      table.service,
      table.key
    ),
  })
);

export const costLogs = pgTable(
  "cost_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    service: costServiceEnum("service").notNull(),
    operation: text("operation").notNull(),

    costEur: decimal("cost_eur", { precision: 10, scale: 6 }).notNull(),

    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),

    pipelineRunId: uuid("pipeline_run_id"),
    articleId: uuid("article_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectServiceTimeIdx: index("cost_logs_project_service_time_idx").on(
      t.projectId,
      t.service,
      t.createdAt
    ),
    projectTimeIdx: index("cost_logs_project_time_idx").on(t.projectId, t.createdAt),
    pipelineRunIdx: index("cost_logs_pipeline_run_idx").on(t.pipelineRunId),
  })
);

export const briefings = pgTable(
  "briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
    briefingMd: text("briefing_md").notNull(),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectDateIdx: index("briefings_project_date_idx").on(t.projectId, t.date),
  })
);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    pipelineName: text("pipeline_name").notNull(),
    stepName: text("step_name"),

    status: pipelineRunStatusEnum("status").notNull().default("queued"),

    jobId: text("job_id"),
    parentRunId: uuid("parent_run_id"),

    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    // Spec 61.4 + 62.0a: checkpoint when pipeline suspends. Holds either a batch-API
    // resume payload (`kind: "batch"`) or a step-pause resume payload (`kind: "step_pause"`).
    // See `SuspensionCheckpoint` in `./batch.ts` for the discriminated union shape.
    suspensionCheckpoint: jsonb("suspension_checkpoint").$type<Record<string, unknown>>(),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index("pipeline_runs_project_idx").on(t.projectId),
    statusIdx: index("pipeline_runs_status_idx").on(t.projectId, t.status),
    pipelineIdx: index("pipeline_runs_pipeline_idx").on(t.pipelineName),
  })
);

export const astroSyncRuns = pgTable(
  "astro_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Plain UUIDs — no DB FK to articles to avoid circular dep (same pattern as pipelineRuns)
    articleId: uuid("article_id").notNull(),
    pipelineRunId: uuid("pipeline_run_id"),

    status: text("status").$type<"pending" | "succeeded" | "failed">().notNull(),
    commitSha: text("commit_sha"),
    errorMessage: text("error_message"),
    errorStage: text("error_stage").$type<
      "load" | "schema" | "image" | "render" | "commit" | "db_update" | "stale_read"
    >(),

    filesCommitted: jsonb("files_committed").$type<string[]>(),
    bytesCommitted: integer("bytes_committed"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    articleIdx: index("astro_sync_runs_article_idx").on(t.articleId),
    projectStatusIdx: index("astro_sync_runs_project_status_idx").on(t.projectId, t.status),
  })
);

export const pagespeedRuns = pgTable(
  "pagespeed_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Plain UUID — no DB FK to articles (same circular-dep pattern as pipelineRuns/astroSyncRuns)
    articleId: uuid("article_id").notNull(),
    pipelineRunId: uuid("pipeline_run_id"),

    status: text("status").$type<"pending" | "succeeded" | "failed" | "errored">().notNull(),
    outcome: text("outcome").$type<"pass" | "fail" | "error" | null>().default(null),
    mode: text("mode").$type<"local" | "api">().notNull().default("local"),

    scores: jsonb("scores").$type<Record<string, number> | null>().default(null),
    coreWebVitals: jsonb("core_web_vitals").$type<Record<string, number> | null>().default(null),
    thresholdsUsed: jsonb("thresholds_used").$type<Record<string, number> | null>().default(null),
    failedCategories: jsonb("failed_categories").$type<string[] | null>().default(null),

    errorMessage: text("error_message"),
    errorStage: text("error_stage").$type<
      "clone" | "build" | "preview" | "lighthouse" | "evaluate" | null
    >(),

    reportPath: text("report_path"),
    astroCommitSha: text("astro_commit_sha"),
    testedUrl: text("tested_url"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    articleIdx: index("pagespeed_runs_article_idx").on(t.articleId),
    projectStatusIdx: index("pagespeed_runs_project_status_idx").on(t.projectId, t.status),
    projectModeIdx: index("pagespeed_runs_project_mode_idx").on(t.projectId, t.mode),
  })
);

export const schemaExtensionRuns = pgTable(
  "schema_extension_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Plain UUID — no DB FK to articles (same circular-dep pattern as pipelineRuns/astroSyncRuns)
    articleId: uuid("article_id").notNull(),
    pipelineRunId: uuid("pipeline_run_id"),

    status: text("status").$type<"pending" | "succeeded" | "failed">().notNull(),
    detectedTypes: jsonb("detected_types")
      .$type<{
        breadcrumb: boolean;
        faq: boolean;
        howto: boolean;
      } | null>()
      .default(null),

    faqQuestionCount: integer("faq_question_count").default(0),
    howtoStepCount: integer("howto_step_count").default(0),

    errorMessage: text("error_message"),
    errorStage: text("error_stage").$type<"detect" | "build" | "persist" | null>(),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    articleIdx: index("schema_extension_runs_article_idx").on(t.articleId),
    projectStatusIdx: index("schema_extension_runs_project_status_idx").on(t.projectId, t.status),
  })
);

export const linkRebuildRuns = pgTable(
  "link_rebuild_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id"),
    pipelineRunId: uuid("pipeline_run_id"),

    status: text("status")
      .$type<"pending" | "succeeded" | "failed" | "budget_exceeded">()
      .notNull(),
    triggerType: text("trigger_type")
      .$type<"auto_after_sync" | "manual_cli" | "manual_http">()
      .notNull(),

    articlesProcessed: integer("articles_processed").default(0),
    articlesModified: integer("articles_modified").default(0),
    totalLinksAdded: integer("total_links_added").default(0),
    totalCostEur: numeric("total_cost_eur", { precision: 10, scale: 4 })
      .$type<string>()
      .default("0"),

    errorMessage: text("error_message"),
    errorStage: text("error_stage").$type<
      "load" | "budget" | "analyze" | "apply" | "persist" | null
    >(),

    // Plain UUID — no DB FK to articles (same circular-dep pattern as other run tables)
    triggeringArticleId: uuid("triggering_article_id"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    clusterIdx: index("link_rebuild_runs_cluster_idx").on(t.clusterId),
    projectStatusIdx: index("link_rebuild_runs_project_status_idx").on(t.projectId, t.status),
  })
);

// Spec 41: Cost Enforcement — pause state per project (single row, UPSERT semantics)
export const projectPauseStates = pgTable("project_pause_states", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  pausedAt: timestamp("paused_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull(),
  reasonDetails: jsonb("reason_details").$type<Record<string, unknown>>().default({}),
  pausedBy: uuid("paused_by").references(() => users.id, { onDelete: "set null" }),
  service: text("service"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Spec 41: Cost Enforcement — log of alertAtPercent threshold breaches
export const costAlerts = pgTable(
  "cost_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    thresholdType: text("threshold_type").$type<"daily" | "monthly">().notNull(),
    limitEur: numeric("limit_eur", { precision: 10, scale: 2 }).$type<string>().notNull(),
    spentEur: numeric("spent_eur", { precision: 10, scale: 4 }).$type<string>().notNull(),
    percent: integer("percent").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectCreatedIdx: index("cost_alerts_project_created_idx").on(t.projectId, t.createdAt),
  })
);

// Spec 44: tracks each Astro-repo import run (mirror of pipeline_runs for import-specific stats)
export const astroImportRuns = pgTable(
  "astro_import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Plain UUID — no DB FK to pipeline_runs to avoid circular dep
    pipelineRunId: uuid("pipeline_run_id"),

    status: text("status")
      .$type<"pending" | "running" | "succeeded" | "failed">()
      .notNull(),
    triggerSource: text("trigger_source")
      .$type<"manual" | "webhook" | "scheduled">()
      .notNull(),

    filesDiscovered: integer("files_discovered"),
    filesParsed: integer("files_parsed"),
    articlesInserted: integer("articles_inserted"),
    articlesUpdated: integer("articles_updated"),
    articlesUnchanged: integer("articles_unchanged"),
    articlesFailed: integer("articles_failed"),
    pairsLinked: integer("pairs_linked"),
    orphanedArticles: integer("orphaned_articles"),

    headCommitSha: text("head_commit_sha"),
    errorMessage: text("error_message"),
    errorStage: text("error_stage").$type<
      "auth" | "list" | "parse" | "upsert" | "link" | "finalize"
    >(),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index("astro_import_runs_project_idx").on(t.projectId),
    statusIdx: index("astro_import_runs_status_idx").on(t.projectId, t.status),
  })
);

// Spec 62.0a: one row per pause-resume cycle of a step-run.
// A step suspends in debug mode; the user resolves it via one of the 7 actions,
// and the runner re-enqueues the pipeline with a stepPauseResume payload.
// `stepRunId` is unique — re-execution creates a NEW pipeline_runs row, and the previous
// substep is set to status='superseded' (see Section 4.5 of Spec 62.0a).
export const stepPauses = pgTable(
  "step_pauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineRunId: uuid("pipeline_run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    stepRunId: uuid("step_run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    stepName: text("step_name").notNull(),
    pipelineName: text("pipeline_name").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // Frozen at suspend
    stepInput: jsonb("step_input").$type<Record<string, unknown>>().notNull(),
    stepOutput: jsonb("step_output").$type<Record<string, unknown>>().notNull(),
    promptUsed: text("prompt_used"),

    // User decision — one of: approve, edit-output, edit-prompt, edit-input, abort,
    // promote-golden, extract-for-optimization, auto-dismissed.
    action: text("action"),
    editedInput: jsonb("edited_input").$type<Record<string, unknown>>(),
    editedOutput: jsonb("edited_output").$type<Record<string, unknown>>(),
    editedPrompt: text("edited_prompt"),
    userNote: text("user_note"),

    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (t) => ({
    stepRunUnique: uniqueIndex("step_pauses_step_run_id_unique").on(t.stepRunId),
    pipelineRunIdx: index("step_pauses_pipeline_run_id_idx").on(t.pipelineRunId),
    // Partial index — must match the migration WHERE clause exactly (Pattern: drizzle .where()
    // needs an SQL expression, not a bare column ref).
    unresolvedIdx: index("step_pauses_unresolved_idx")
      .on(t.projectId, t.requestedAt)
      .where(isNull(t.resolvedAt)),
  })
);

export type StepPause = typeof stepPauses.$inferSelect;
export type NewStepPause = typeof stepPauses.$inferInsert;

// Spec 62.0a: step-level idempotency cache.
// Key = (pipelineName, stepName, projectId, idempotencyKey).
// Lookup HIT means: step's computed output is reused and execute() is skipped.
// All inserts MUST use onConflictDoNothing (benign write race vs cache-check).
export const idempotencyOutputs = pgTable(
  "idempotency_outputs",
  {
    idempotencyKey: text("idempotency_key").notNull(),
    pipelineName: text("pipeline_name").notNull(),
    stepName: text("step_name").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stepOutput: jsonb("step_output").$type<Record<string, unknown>>().notNull(),
    costEur: numeric("cost_eur", { precision: 10, scale: 6 }).$type<string>().notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.idempotencyKey, t.pipelineName, t.stepName, t.projectId],
    }),
    lookupIdx: index("idempotency_outputs_lookup_idx").on(
      t.pipelineName,
      t.stepName,
      t.projectId,
      t.createdAt
    ),
  })
);

export type IdempotencyOutput = typeof idempotencyOutputs.$inferSelect;
export type NewIdempotencyOutput = typeof idempotencyOutputs.$inferInsert;

// Spec 62.0b: promoted prompt overrides ("goldens") per (step, project).
// body = systemSuffix replacement only (cacheable foundation stays intact).
//
// MULTI-TENANT EXCEPTION: `project_id` is nullable here, breaking the usual non-nullable
// FK convention. Documented exception in Spec 62.0b Section 4.1 — `projectId IS NULL`
// represents a GLOBAL golden that applies across all projects (Tier 3 of the hybrid
// resolution chain). A project-specific golden (Tier 2) always has a non-null project_id.
// The partial unique index uses COALESCE(project_id::text, 'GLOBAL') to keep the
// "one active golden per (step, scope)" invariant for both shapes.
export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stepName: text("step_name").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),

    body: text("body").notNull(),
    sourcePauseId: uuid("source_pause_id").references(() => stepPauses.id, {
      onDelete: "set null",
    }),

    isGolden: boolean("is_golden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    promoteNote: text("promote_note"),
  },
  (t) => ({
    // At most one golden per (step, project). NULL project_id stays comparable via COALESCE.
    oneGoldenPerStep: uniqueIndex("prompt_versions_one_golden_per_step")
      .on(sql`${t.stepName}`, sql`COALESCE(${t.projectId}::text, 'GLOBAL')`)
      .where(sql`${t.isGolden} = true`),
    stepProjectIdx: index("prompt_versions_step_project_idx").on(
      t.stepName,
      t.projectId,
      t.createdAt
    ),
  })
);

export type PromptVersion = typeof promptVersions.$inferSelect;
export type NewPromptVersion = typeof promptVersions.$inferInsert;

// Spec 62.0b: "this output wasn't good, here's why".
// Frozen snapshot of the step_pauses row at request time so the source pause can mutate
// later (or be auto-dismissed by a parent-run cancellation) without invalidating audit.
export const stepOptimizationRequests = pgTable(
  "step_optimization_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stepPauseId: uuid("step_pause_id")
      .notNull()
      .references(() => stepPauses.id, { onDelete: "cascade" }),
    stepName: text("step_name").notNull(),
    pipelineName: text("pipeline_name").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    stepInput: jsonb("step_input").$type<Record<string, unknown>>().notNull(),
    stepOutput: jsonb("step_output").$type<Record<string, unknown>>().notNull(),
    promptUsed: text("prompt_used"),

    userNote: text("user_note").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    requestedBy: text("requested_by"),

    // 'open' | 'addressed' | 'discarded'. Plain text column: future statuses can be added
    // without a DDL migration (per Spec 62.0b design).
    status: text("status").notNull().default("open"),
    addressedAt: timestamp("addressed_at", { withTimezone: true }),
    addressedNote: text("addressed_note"),
  },
  (t) => ({
    openIdx: index("step_optimization_requests_open_idx")
      .on(t.projectId, t.requestedAt)
      .where(sql`${t.status} = 'open'`),
    stepIdx: index("step_optimization_requests_step_idx").on(
      t.stepName,
      t.projectId,
      t.requestedAt
    ),
  })
);

export type StepOptimizationRequest = typeof stepOptimizationRequests.$inferSelect;
export type NewStepOptimizationRequest = typeof stepOptimizationRequests.$inferInsert;

// Spec 62.2: per-project, per-content-type cadence definitions.
// `content_type` is text (not pgEnum) per 62.0a Lesson D12 — Zod gates validation at the
// API/service layer. The partial unique index allows multiple inactive rows for the same
// (project, content_type) but only one active row.
export const projectGoals = pgTable(
  "project_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    cadenceUnit: text("cadence_unit").$type<"per_day" | "per_week">().notNull(),
    minCount: integer("min_count").notNull(),
    maxCount: integer("max_count"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => ({
    oneActivePerType: uniqueIndex("project_goals_one_active_per_type")
      .on(t.projectId, t.contentType)
      .where(sql`${t.isActive} = true`),
    projectIdx: index("project_goals_project_idx")
      .on(t.projectId)
      .where(sql`${t.isActive} = true`),
  })
);

export type ProjectGoal = typeof projectGoals.$inferSelect;
export type NewProjectGoal = typeof projectGoals.$inferInsert;

// Spec 62.2: per-project planner-wide settings (budget + overage policy).
// Singleton-per-project (project_id is PK). Separate from `projects` so 62.4/62.5/62.7 can
// add columns additively without crowding the projects schema.
//
// `weeklyBudgetEur` is Drizzle `numeric(10,2)` → returned/written as string (Drizzle convention
// for numeric). Helpers coerce at the boundary.
export const projectPlannerConfig = pgTable("project_planner_config", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  weeklyBudgetEur: numeric("weekly_budget_eur", { precision: 10, scale: 2 })
    .$type<string>()
    .notNull(),
  perTypeMaxEur: jsonb("per_type_max_eur").$type<Record<string, number>>(),
  topNSignalsAllowedOverage: integer("top_n_signals_allowed_overage").notNull().default(3),
  maxOveragePerSignal: integer("max_overage_per_signal").notNull().default(1),
  // Spec 62.3: per-project staleness threshold for refreshSignalsForProject().
  signalMaxAgeHours: integer("signal_max_age_hours").notNull().default(24),
  // Spec 62.4: pipeline names the planner refuses to schedule. Defaulted via DB
  // (see migration 0074) so existing rows pick up the pagespeed exclusions.
  excludedPipelines: jsonb("excluded_pipelines")
    .$type<string[]>()
    .notNull()
    .default(["article:pagespeed-validation", "article:pagespeed-api-validation"]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectPlannerConfig = typeof projectPlannerConfig.$inferSelect;
export type NewProjectPlannerConfig = typeof projectPlannerConfig.$inferInsert;

// Spec 62.4: PlanWeekPipeline output. One row per (project, year, iso_week)
// active plan; re-generation supersedes the prior via the partial unique index
// `weekly_plans_one_active_per_week`. Status lifecycle:
//   draft → approved → running → completed | partially_failed | cancelled
//                     ↘ superseded (when re-generated)
// CHECK constraints declared in migration 0074 (62.0a Lesson D12 — text+CHECK
// rather than pgEnum). The Drizzle `$type<>()` casts must stay in sync with the
// SQL CHECK list — see `WEEKLY_PLAN_STATUSES` in shared/types/weekly-plan.ts.
export const weeklyPlans = pgTable(
  "weekly_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    year: integer("year").notNull(),
    isoWeek: integer("iso_week").notNull(),
    weekStartDate: date("week_start_date", { mode: "date" }).notNull(),
    weekEndDate: date("week_end_date", { mode: "date" }).notNull(),

    status: text("status")
      .notNull()
      .default("draft")
      .$type<
        | "draft"
        | "approved"
        | "running"
        | "completed"
        | "partially_failed"
        | "cancelled"
        | "superseded"
      >(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    // Self-reference set via raw SQL in migration 0074 — Drizzle doesn't need
    // the explicit .references() for self-FKs; the column is plain uuid here.
    supersededBy: uuid("superseded_by"),

    estimatedCostEur: numeric("estimated_cost_eur", { precision: 10, scale: 2 })
      .$type<string>()
      .notNull(),
    actualCostEur: numeric("actual_cost_eur", { precision: 10, scale: 2 }).$type<string>(),

    inputSnapshot: jsonb("input_snapshot")
      .$type<WeeklyPlanInputSnapshot>()
      .notNull(),
    generationNotes: text("generation_notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial unique: at most one active plan per (project, year, week).
    oneActivePerWeek: uniqueIndex("weekly_plans_one_active_per_week")
      .on(t.projectId, t.year, t.isoWeek)
      .where(sql`${t.status} NOT IN ('superseded', 'cancelled')`),
    statusIdx: index("weekly_plans_status_idx").on(
      t.projectId,
      t.status,
      sql`${t.weekStartDate} DESC`,
    ),
  }),
);

export type WeeklyPlan = typeof weeklyPlans.$inferSelect;
export type NewWeeklyPlan = typeof weeklyPlans.$inferInsert;

// Spec 62.4: per-day work units inside a weekly_plans row. status='pending'
// at insert time; 62.8 advances through enqueued/in_progress/completed/failed.
// `pipeline_run_id` has NO DB-level FK to pipeline_runs — `pipeline_runs` lives
// in this file, but adding a circular FK back from a content-adjacent table is
// not worth the migration churn. The app layer reconciles.
export const plannedItems = pgTable(
  "planned_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weeklyPlanId: uuid("weekly_plan_id")
      .notNull()
      .references(() => weeklyPlans.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    contentType: text("content_type").notNull(),
    pipelineName: text("pipeline_name").notNull(),

    slotDate: date("slot_date", { mode: "date" }).notNull(),

    // Spec 62.4-followup Issue 1: nullable. null = pipeline handles both locales
    // internally (current behaviour for cluster:full-plan and downstream
    // article:translation auto-trigger). 'de' / 'en' are still used by legacy
    // sibling_locale rows kept for audit-trail completeness.
    locale: text("locale").$type<"de" | "en" | null>(),

    sourceKind: text("source_kind").notNull().$type<
      "floor" | "overage_signal" | "sibling_locale"
    >(),
    sourceBriefId: uuid("source_brief_id").references(() => topicBriefs.id, {
      onDelete: "set null",
    }),
    sourceSignalId: uuid("source_signal_id").references(() => externalSignals.id, {
      onDelete: "set null",
    }),
    // Self-FK set in migration 0074 — same treatment as supersededBy.
    parentItemId: uuid("parent_item_id"),

    pipelineInput: jsonb("pipeline_input").$type<Record<string, unknown>>().notNull(),

    estimatedCostEur: numeric("estimated_cost_eur", { precision: 10, scale: 6 })
      .$type<string>()
      .notNull(),
    actualCostEur: numeric("actual_cost_eur", { precision: 10, scale: 6 }).$type<string>(),

    selectionScore: numeric("selection_score", { precision: 5, scale: 4 }).$type<string>(),
    selectionReason: text("selection_reason"),

    status: text("status")
      .notNull()
      .default("pending")
      .$type<
        | "pending"
        | "enqueued"
        | "in_progress"
        | "completed"
        | "failed"
        | "skipped"
        | "cancelled"
      >(),
    pipelineRunId: uuid("pipeline_run_id"),
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    planIdx: index("planned_items_plan_idx").on(t.weeklyPlanId, t.slotDate, t.contentType),
    statusIdx: index("planned_items_status_idx").on(t.projectId, t.status, t.slotDate),
    pipelineRunIdx: index("planned_items_pipeline_run_idx")
      .on(t.pipelineRunId)
      .where(sql`${t.pipelineRunId} IS NOT NULL`),
  }),
);

export type PlannedItem = typeof plannedItems.$inferSelect;
export type NewPlannedItem = typeof plannedItems.$inferInsert;

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }),
    socialPostId: uuid("social_post_id").references(() => socialPosts.id, { onDelete: "cascade" }),

    action: approvalActionEnum("action").notNull(),
    comment: text("comment"),

    userId: uuid("user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectIdx: index("approvals_project_idx").on(t.projectId),
    articleIdx: index("approvals_article_idx").on(t.articleId),
    socialPostIdx: index("approvals_social_post_idx").on(t.socialPostId),
  })
);
