import { pgTable, uuid, text, timestamp, jsonb, decimal, integer, index } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";
import { articles, socialPosts } from "./content.ts";
import { costServiceEnum, pipelineRunStatusEnum, approvalActionEnum } from "./_enums.ts";

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
  errorStage: text("error_stage").$type<"load" | "schema" | "image" | "render" | "commit" | "db_update">(),

  filesCommitted: jsonb("files_committed").$type<string[]>(),
  bytesCommitted: integer("bytes_committed"),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => ({
  articleIdx: index("astro_sync_runs_article_idx").on(t.articleId),
  projectStatusIdx: index("astro_sync_runs_project_status_idx").on(t.projectId, t.status),
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
