// Spec 62.2: validator-library unit tests. Uses real DB fixtures (same convention as
// weekly-budget.test.ts) — each test creates a fresh project + goals + config, asserts,
// and cleans up via project CASCADE.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  projects,
  projectGoals,
  upsertProjectPlannerConfig,
} from "@marketing-auto/db";
import {
  GOAL_VALIDATION_ERROR_CODES,
  validateProjectGoals,
  weeklyCountFromGoal,
} from "../src/index.ts";
import type { EstimatorStep } from "@marketing-auto/cost-tracker";

const step = (cost: number): EstimatorStep => ({ estimatedCostEur: () => cost });

let projectId: string;

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `gv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "goal-validator-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  if (!row) throw new Error("project insert failed");
  return row.id;
}

beforeEach(async () => {
  projectId = await freshProject();
});

afterEach(async () => {
  // CASCADE wipes project_goals + project_planner_config.
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("weeklyCountFromGoal", () => {
  it("per_day × min_count × 7", () => {
    expect(
      weeklyCountFromGoal({
        cadenceUnit: "per_day",
        minCount: 3,
      } as never)
    ).toBe(21);
  });
  it("per_week × min_count", () => {
    expect(
      weeklyCountFromGoal({
        cadenceUnit: "per_week",
        minCount: 4,
      } as never)
    ).toBe(4);
  });
});

describe("validateProjectGoals — error codes", () => {
  it("NO_GOALS_DEFINED + NO_PLANNER_CONFIG when project has nothing", async () => {
    const result = await validateProjectGoals(projectId);
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code).sort();
    expect(codes).toEqual(["NO_GOALS_DEFINED", "NO_PLANNER_CONFIG"]);
    expect(result.estimatedWeeklyFloorEur).toBeNull();
    expect(result.config).toBeNull();
  });

  it("NO_PLANNER_CONFIG when goals exist but config does not", async () => {
    await db.insert(projectGoals).values({
      projectId,
      contentType: "cluster",
      cadenceUnit: "per_week",
      minCount: 1,
      maxCount: 3,
    });
    const result = await validateProjectGoals(projectId);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("NO_PLANNER_CONFIG");
    expect(codes).not.toContain("NO_GOALS_DEFINED");
  });

  it("FLOOR_EXCEEDS_BUDGET when min costs exceed weekly budget", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 1.0,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    });
    // 1 cluster/day × 7 days × €5/cluster = €35 → way over €1
    await db.insert(projectGoals).values({
      projectId,
      contentType: "cluster",
      cadenceUnit: "per_day",
      minCount: 1,
      maxCount: null,
    });
    const result = await validateProjectGoals(projectId, {
      resolvePipelineSteps: (name) => (name === "cluster:full-plan" ? [step(5)] : undefined),
    });
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("FLOOR_EXCEEDS_BUDGET");
    expect(result.estimatedWeeklyFloorEur).toBe(35);
  });

  it("INVALID_MIN_MAX when max_count < min_count (defensive check)", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 100,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    });
    // Bypass Zod by writing directly to DB
    await db.insert(projectGoals).values({
      projectId,
      contentType: "cluster",
      cadenceUnit: "per_week",
      minCount: 5,
      maxCount: 2,
    });
    const result = await validateProjectGoals(projectId);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("INVALID_MIN_MAX");
  });

  it("error code constants enumerate the exact set", () => {
    expect([...GOAL_VALIDATION_ERROR_CODES].sort()).toEqual([
      "FLOOR_EXCEEDS_BUDGET",
      "INVALID_CADENCE_UNIT",
      "INVALID_MIN_MAX",
      "NO_GOALS_DEFINED",
      "NO_PLANNER_CONFIG",
    ]);
  });
});

describe("validateProjectGoals — warning codes", () => {
  it("FLOOR_NEAR_BUDGET when floor is within 85% of budget", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 10.0,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    });
    // floor = 1 cluster × €9 = €9 → 90% of €10 → FLOOR_NEAR_BUDGET
    await db.insert(projectGoals).values({
      projectId,
      contentType: "cluster",
      cadenceUnit: "per_week",
      minCount: 1,
      maxCount: null,
    });
    const result = await validateProjectGoals(projectId, {
      resolvePipelineSteps: (name) => (name === "cluster:full-plan" ? [step(9)] : undefined),
    });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("FLOOR_NEAR_BUDGET");
  });

  it("SUB_BUDGETS_OVER_GLOBAL when perTypeMaxEur sum exceeds weekly budget", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 10.0,
      perTypeMaxEur: { cluster: 8, comparison: 8, social_post: 8 },
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    });
    await db.insert(projectGoals).values({
      projectId,
      contentType: "cluster",
      cadenceUnit: "per_week",
      minCount: 1,
      maxCount: null,
    });
    const result = await validateProjectGoals(projectId, {
      resolvePipelineSteps: () => [step(0.1)],
    });
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("SUB_BUDGETS_OVER_GLOBAL");
  });

  it("ALL_GOALS_INACTIVE_OR_ZERO when every active goal has min_count=0", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    });
    await db.insert(projectGoals).values({
      projectId,
      contentType: "cluster",
      cadenceUnit: "per_week",
      minCount: 0,
      maxCount: null,
    });
    const result = await validateProjectGoals(projectId, {
      resolvePipelineSteps: () => [step(1)],
    });
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain("ALL_GOALS_INACTIVE_OR_ZERO");
    expect(result.valid).toBe(true);
  });

  it("happy path: realistic toolwiki defaults validate cleanly", async () => {
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 50,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
    });
    await db.insert(projectGoals).values([
      { projectId, contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: null },
      { projectId, contentType: "comparison", cadenceUnit: "per_week", minCount: 1, maxCount: 3 },
      { projectId, contentType: "social_post", cadenceUnit: "per_day", minCount: 3, maxCount: 5 },
      { projectId, contentType: "ki_wissen", cadenceUnit: "per_week", minCount: 3, maxCount: 5 },
    ]);
    const result = await validateProjectGoals(projectId, {
      // Toolwiki-ish numbers: cluster 4.2, comparison 0.3, social 0.02, ki_wissen 0.3
      resolvePipelineSteps: (name) =>
        name === "cluster:full-plan"
          ? [step(4.2)]
          : name === "article:blog"
            ? [step(0.3)]
            : name === "article:social-image"
              ? [step(0.02)]
              : undefined,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.resolvedGoals.length).toBe(4);
    expect(result.estimatedWeeklyFloorEur).not.toBeNull();
    // 7×4.2 (cluster) + 1×0.3 (comparison) + 21×0.02 (social) + 3×0.3 (ki_wissen)
    //   = 29.4 + 0.3 + 0.42 + 0.9 = 31.02
    expect(result.estimatedWeeklyFloorEur).toBeCloseTo(31.02, 2);
  });
});
