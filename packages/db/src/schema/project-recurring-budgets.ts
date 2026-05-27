/**
 * Spec 65.V1.5b — Project Recurring Budgets.
 *
 * Per-project monthly cost-cap tracker for two budget categories:
 *   - `dry_run` — wizard/preview dry-runs (Marcel-initiated, gated pre-call
 *     by `checkBudgetAvailable`).
 *   - `recurring_content_total` — recurring-content cron-fires (auto-billed
 *     by `recordBudgetConsumption` after each successful render).
 *
 * Lazy month-rollover semantics: callers compare `current_month` against
 * `now-YYYYMM`; if they differ, the row is reset (`consumed = 0`,
 * `current_month = now-YYYYMM`). A monthly cron may also reset proactively
 * but is not required — the lazy reset keeps the invariant correct.
 *
 * Limits stored as integer cents to avoid float drift. Defaults: €5/month
 * dry-run, €15/month recurring-content-total (set in helper, not schema).
 */
import { check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./projects.ts";

export type RecurringBudgetType = "dry_run" | "recurring_content_total";

export const projectRecurringBudgets = pgTable(
  "project_recurring_budgets",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    budgetType: text("budget_type").notNull().$type<RecurringBudgetType>(),
    monthlyLimitCents: integer("monthly_limit_cents").notNull().default(500),
    currentMonthConsumedCents: integer("current_month_consumed_cents").notNull().default(0),
    /** YYYYMM, e.g. 202605 for May 2026. Drives lazy rollover. */
    currentMonth: integer("current_month").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.budgetType] }),
    projectIdx: index("idx_project_recurring_budgets_project").on(t.projectId),
    budgetTypeCheck: check(
      "project_recurring_budgets_budget_type_check",
      sql`${t.budgetType} IN ('dry_run', 'recurring_content_total')`
    ),
  })
);

export type ProjectRecurringBudget = typeof projectRecurringBudgets.$inferSelect;
export type NewProjectRecurringBudget = typeof projectRecurringBudgets.$inferInsert;
