import { pgTable, uuid, text, timestamp, jsonb, decimal, numeric, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { articles, socialPosts } from "./content.ts";
import { users } from "./auth.ts";
import { costServiceEnum, pipelineRunStatusEnum, approvalActionEnum } from "./_enums.ts";

export const systemSettings = pgTable("system_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const globalCredentials = pgTable("global_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  service: text("service").notNull(),
  key: text("key").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  serviceKeyUnique: uniqueIndex("global_credentials_service_key_unique").on(table.service, table.key),
}));

export const costLogs = pgTable("cost_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

  service: costServiceEnum("service").notNull(),
  operation: text("operation").notNull(),

  costEur: decimal("cost_eur", { precision: 10, scale: 6 }).notNull(),

  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),

  pipelineRunId: uuid("pipeline_run_id"),
  articleId: uuid("article_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectServiceTimeIdx: index("cost_logs_project_service_time_idx").on(t.projectId, t.service, t.createdAt),
  projectTimeIdx: index("cost_logs_project_time_idx").on(t.projectId, t.createdAt),
  pipelineRunIdx: index("cost_logs_pipeline_run_idx").on(t.pipelineRunId),
}));

export const briefings = pgTable("briefings", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

  date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
  briefingMd: text("briefing_md").notNull(),
  rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectDateIdx: index("briefings_project_date_idx").on(t.projectId, t.date),
}));

export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

  pipelineName: text("pipeline_name").notNull(),
  stepName: text("step_name"),

  status: pipelineRunStatusEnum("status").notNull().default("queued"),

  jobId: text("job_id"),
  parentRunId: uuid("parent_run_id"),

  input: jsonb("input").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),

  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("pipeline_runs_project_idx").on(t.projectId),
  statusIdx: index("pipeline_runs_status_idx").on(t.projectId, t.status),
  pipelineIdx: index("pipeline_runs_pipeline_idx").on(t.pipelineName),
}));

export const astroSyncRuns = pgTable("astro_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Plain UUIDs — no DB FK to articles to avoid circular dep (same pattern as pipelineRuns)
  articleId: uuid("article_id").notNull(),
  pipelineRunId: uuid("pipeline_run_id"),

  status: text("status").$type<"pending" | "succeeded" | "failed">().notNull(),
  commitSha: text("commit_sha"),
  errorMessage: text("error_message"),
  errorStage: text("error_stage").$type<"load" | "schema" | "image" | "render" | "commit" | "db_update" | "stale_read">(),

  filesCommitted: jsonb("files_committed").$type<string[]>(),
  bytesCommitted: integer("bytes_committed"),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => ({
  articleIdx: index("astro_sync_runs_article_idx").on(t.articleId),
  projectStatusIdx: index("astro_sync_runs_project_status_idx").on(t.projectId, t.status),
}));

export const pagespeedRuns = pgTable("pagespeed_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Plain UUID — no DB FK to articles (same circular-dep pattern as pipelineRuns/astroSyncRuns)
  articleId: uuid("article_id").notNull(),
  pipelineRunId: uuid("pipeline_run_id"),

  status: text("status").$type<"pending" | "succeeded" | "failed" | "errored">().notNull(),
  outcome: text("outcome").$type<"pass" | "fail" | "error" | null>().default(null),

  scores: jsonb("scores").$type<Record<string, number> | null>().default(null),
  coreWebVitals: jsonb("core_web_vitals").$type<Record<string, number> | null>().default(null),
  thresholdsUsed: jsonb("thresholds_used").$type<Record<string, number> | null>().default(null),
  failedCategories: jsonb("failed_categories").$type<string[] | null>().default(null),

  errorMessage: text("error_message"),
  errorStage: text("error_stage").$type<"clone" | "build" | "preview" | "lighthouse" | "evaluate" | null>(),

  reportPath: text("report_path"),
  astroCommitSha: text("astro_commit_sha"),
  testedUrl: text("tested_url"),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => ({
  articleIdx: index("pagespeed_runs_article_idx").on(t.articleId),
  projectStatusIdx: index("pagespeed_runs_project_status_idx").on(t.projectId, t.status),
}));

export const schemaExtensionRuns = pgTable("schema_extension_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  // Plain UUID — no DB FK to articles (same circular-dep pattern as pipelineRuns/astroSyncRuns)
  articleId: uuid("article_id").notNull(),
  pipelineRunId: uuid("pipeline_run_id"),

  status: text("status").$type<"pending" | "succeeded" | "failed">().notNull(),
  detectedTypes: jsonb("detected_types").$type<{
    breadcrumb: boolean;
    faq: boolean;
    howto: boolean;
  } | null>().default(null),

  faqQuestionCount: integer("faq_question_count").default(0),
  howtoStepCount: integer("howto_step_count").default(0),

  errorMessage: text("error_message"),
  errorStage: text("error_stage").$type<"detect" | "build" | "persist" | null>(),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => ({
  articleIdx: index("schema_extension_runs_article_idx").on(t.articleId),
  projectStatusIdx: index("schema_extension_runs_project_status_idx").on(t.projectId, t.status),
}));

export const linkRebuildRuns = pgTable("link_rebuild_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  clusterId: uuid("cluster_id"),
  pipelineRunId: uuid("pipeline_run_id"),

  status: text("status").$type<"pending" | "succeeded" | "failed" | "budget_exceeded">().notNull(),
  triggerType: text("trigger_type").$type<"auto_after_sync" | "manual_cli" | "manual_http">().notNull(),

  articlesProcessed: integer("articles_processed").default(0),
  articlesModified: integer("articles_modified").default(0),
  totalLinksAdded: integer("total_links_added").default(0),
  totalCostEur: numeric("total_cost_eur", { precision: 10, scale: 4 }).$type<string>().default("0"),

  errorMessage: text("error_message"),
  errorStage: text("error_stage").$type<"load" | "budget" | "analyze" | "apply" | "persist" | null>(),

  // Plain UUID — no DB FK to articles (same circular-dep pattern as other run tables)
  triggeringArticleId: uuid("triggering_article_id"),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => ({
  clusterIdx: index("link_rebuild_runs_cluster_idx").on(t.clusterId),
  projectStatusIdx: index("link_rebuild_runs_project_status_idx").on(t.projectId, t.status),
}));

// Spec 41: Cost Enforcement — pause state per project (single row, UPSERT semantics)
export const projectPauseStates = pgTable("project_pause_states", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  pausedAt: timestamp("paused_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull(),
  reasonDetails: jsonb("reason_details").$type<Record<string, unknown>>().default({}),
  pausedBy: uuid("paused_by").references(() => users.id, { onDelete: "set null" }),
  service: text("service"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Spec 41: Cost Enforcement — log of alertAtPercent threshold breaches
export const costAlerts = pgTable("cost_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  service: text("service").notNull(),
  thresholdType: text("threshold_type").$type<"daily" | "monthly">().notNull(),
  limitEur: numeric("limit_eur", { precision: 10, scale: 2 }).$type<string>().notNull(),
  spentEur: numeric("spent_eur", { precision: 10, scale: 4 }).$type<string>().notNull(),
  percent: integer("percent").notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectCreatedIdx: index("cost_alerts_project_created_idx").on(t.projectId, t.createdAt),
}));

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),

  articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }),
  socialPostId: uuid("social_post_id").references(() => socialPosts.id, { onDelete: "cascade" }),

  action: approvalActionEnum("action").notNull(),
  comment: text("comment"),

  userId: uuid("user_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("approvals_project_idx").on(t.projectId),
  articleIdx: index("approvals_article_idx").on(t.articleId),
  socialPostIdx: index("approvals_social_post_idx").on(t.socialPostId),
}));
