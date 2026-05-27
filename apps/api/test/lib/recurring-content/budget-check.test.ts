/**
 * Spec 65.V1.5b — Budget tracker helper tests (DB-integration).
 *
 * Coverage: pre-flight gate, post-flight record, monthly rollover (lazy),
 * default-limit creation, limit update, list aggregate.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  and,
  db,
  eq,
  projectRecurringBudgets,
  projects,
} from "@marketing-auto/db";
import {
  DEFAULT_LIMIT_CENTS,
  checkBudgetAvailable,
  currentYearMonth,
  listProjectBudgets,
  recordBudgetConsumption,
  updateBudgetLimit,
} from "../../../src/lib/recurring-content/budget-check.ts";

describe("budget-check (Spec 65.V1.5b)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `budget-check-${ts}`,
        name: "budget-check test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("checkBudgetAvailable creates a default row on first access (dry_run, €5)", async () => {
    const result = await checkBudgetAvailable({
      projectId,
      budgetType: "dry_run",
      expectedCostCents: 20,
    });
    expect(result.allowed).toBe(true);
    expect(result.consumed).toBe(0);
    expect(result.limit).toBe(DEFAULT_LIMIT_CENTS.dry_run);
    expect(result.currentMonth).toBe(currentYearMonth());
  });

  it("checkBudgetAvailable creates a default row on first access (recurring_content_total, €15)", async () => {
    const result = await checkBudgetAvailable({
      projectId,
      budgetType: "recurring_content_total",
      expectedCostCents: 100,
    });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(DEFAULT_LIMIT_CENTS.recurring_content_total);
  });

  it("recordBudgetConsumption adds to current month; subsequent check reflects it", async () => {
    await recordBudgetConsumption({
      projectId,
      budgetType: "dry_run",
      actualCostCents: 30,
    });
    const after = await checkBudgetAvailable({
      projectId,
      budgetType: "dry_run",
      expectedCostCents: 0,
    });
    expect(after.consumed).toBe(30);
    expect(after.allowed).toBe(true);

    await recordBudgetConsumption({
      projectId,
      budgetType: "dry_run",
      actualCostCents: 25,
    });
    const after2 = await checkBudgetAvailable({
      projectId,
      budgetType: "dry_run",
      expectedCostCents: 0,
    });
    expect(after2.consumed).toBe(55);
  });

  it("checkBudgetAvailable returns allowed=false when projected exceeds limit", async () => {
    // dry_run row currently at 55. Limit is 500. Project a 500-cent dry-run:
    const result = await checkBudgetAvailable({
      projectId,
      budgetType: "dry_run",
      expectedCostCents: 500,
    });
    expect(result.allowed).toBe(false);
    expect(result.consumed).toBe(55);
    expect(result.limit).toBe(500);
  });

  it("lazy month-rollover resets consumed when current_month is older", async () => {
    // Manually backdate the row to a prior month.
    const lastMonth = currentYearMonth() - 1;
    await db
      .update(projectRecurringBudgets)
      .set({
        currentMonth: lastMonth,
        currentMonthConsumedCents: 400,
      })
      .where(
        and(
          eq(projectRecurringBudgets.projectId, projectId),
          eq(projectRecurringBudgets.budgetType, "dry_run"),
        ),
      );

    const result = await checkBudgetAvailable({
      projectId,
      budgetType: "dry_run",
      expectedCostCents: 0,
    });
    expect(result.consumed).toBe(0); // reset
    expect(result.currentMonth).toBe(currentYearMonth());

    // recordBudgetConsumption after rollover also resets if it lazily sees stale month.
    await recordBudgetConsumption({
      projectId,
      budgetType: "dry_run",
      actualCostCents: 10,
    });
    const after = await checkBudgetAvailable({
      projectId,
      budgetType: "dry_run",
      expectedCostCents: 0,
    });
    expect(after.consumed).toBe(10);
  });

  it("recordBudgetConsumption also handles month-rollover atomically", async () => {
    const lastMonth = currentYearMonth() - 1;
    await db
      .update(projectRecurringBudgets)
      .set({
        currentMonth: lastMonth,
        currentMonthConsumedCents: 999,
      })
      .where(
        and(
          eq(projectRecurringBudgets.projectId, projectId),
          eq(projectRecurringBudgets.budgetType, "recurring_content_total"),
        ),
      );

    await recordBudgetConsumption({
      projectId,
      budgetType: "recurring_content_total",
      actualCostCents: 50,
    });
    const result = await checkBudgetAvailable({
      projectId,
      budgetType: "recurring_content_total",
      expectedCostCents: 0,
    });
    // Because current_month was stale, the SET CASE branch reset consumed=50, not 999+50.
    expect(result.consumed).toBe(50);
    expect(result.currentMonth).toBe(currentYearMonth());
  });

  it("updateBudgetLimit changes the cap without resetting consumed", async () => {
    // Reset to a known state via recordBudgetConsumption (which lazy-resets).
    await recordBudgetConsumption({
      projectId,
      budgetType: "dry_run",
      actualCostCents: 0,
    });
    await db
      .update(projectRecurringBudgets)
      .set({ currentMonthConsumedCents: 200 })
      .where(
        and(
          eq(projectRecurringBudgets.projectId, projectId),
          eq(projectRecurringBudgets.budgetType, "dry_run"),
        ),
      );

    const result = await updateBudgetLimit({
      projectId,
      budgetType: "dry_run",
      monthlyLimitCents: 1000,
    });
    expect(result.limit).toBe(1000);
    expect(result.consumed).toBe(200);
  });

  it("updateBudgetLimit rejects negative values", async () => {
    await expect(
      updateBudgetLimit({
        projectId,
        budgetType: "dry_run",
        monthlyLimitCents: -1,
      }),
    ).rejects.toThrow();
  });

  it("listProjectBudgets returns both budget types in one call", async () => {
    const result = await listProjectBudgets(projectId);
    expect(result.dry_run.limit).toBe(1000);
    expect(result.recurring_content_total.limit).toBe(
      DEFAULT_LIMIT_CENTS.recurring_content_total,
    );
    expect(result.dry_run.currentMonth).toBe(currentYearMonth());
    expect(result.recurring_content_total.currentMonth).toBe(currentYearMonth());
  });

  it("currentYearMonth returns YYYYMM integer", () => {
    const result = currentYearMonth(new Date(Date.UTC(2026, 4, 27))); // May 2026
    expect(result).toBe(202605);
    expect(currentYearMonth(new Date(Date.UTC(2025, 11, 31)))).toBe(202512);
    expect(currentYearMonth(new Date(Date.UTC(2026, 0, 1)))).toBe(202601);
  });
});
