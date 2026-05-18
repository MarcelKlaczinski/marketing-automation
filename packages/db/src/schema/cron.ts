import { boolean, index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

export const cronJobTypeEnum = pgEnum("cron_job_type", [
  "trends_synthesizer",
  "refresh_detector",
  "quality_analysis",
  "signal_collector_reddit",
]);

export const cronState = pgTable(
  "cron_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jobType: cronJobTypeEnum("job_type").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    cronPattern: text("cron_pattern").notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastRunStatus: text("last_run_status"),
    lastRunError: text("last_run_error"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectJobTypeUnique: unique("cron_state_project_job_type_unique").on(t.projectId, t.jobType),
    activeJobTypeIdx: index("cron_state_active_job_type_idx").on(t.isActive, t.jobType),
  })
);

export type CronState = typeof cronState.$inferSelect;
export type NewCronState = typeof cronState.$inferInsert;
