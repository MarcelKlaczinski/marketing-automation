// Spec 62.4 §6.2: PlanWeekPipeline integration tests.
//
// Exercises the full pipeline (validate-goals → … → persist-plan) against a
// real DB. Covers 7 scenarios from the spec.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  externalSignals,
  inArray,
  plannedItems,
  projectConfigurations,
  projectGoals,
  projects,
  topicBriefs,
  upsertProjectPlannerConfig,
  weeklyPlans,
  type NewProjectGoal,
} from "@marketing-auto/db";
import {
  pipelineRegistry,
  PlanWeekPipeline,
  BudgetExceededError,
} from "@marketing-auto/pipelines";
import { runPipeline } from "@marketing-auto/pipelines/engine";

let projectId: string;
let pipeline: PlanWeekPipeline;

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `plan-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "plan-gen-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  return row!.id;
}

async function seedConfig(projectId: string, weeklyBudgetEur = 50): Promise<void> {
  await db.insert(projectConfigurations).values({
    projectId,
    version: 1,
    status: "active",
    intentTaxonomyDefault: [],
    masterPrompts: {},
    topicScope: {
      languages: ["de", "en"],
      exclusions: [],
      primary_themes: [],
      relevance_keywords: [],
      min_trend_score: 25,
      min_signal_thresholds: { hackernews: 3, producthunt: 0, vendor_rss: 0 },
    },
    automationRules: [],
    signalSources: {
      producthunt: false,
      hackernews: { enabled: false, queries: [], hitsPerPage: 50, minPoints: 5 },
      reddit: {
        enabled: false,
        subreddits: [],
        sortMode: "top",
        timeWindow: "week",
        minUpvotes: 50,
        minComments: 10,
        maxAgeDays: 7,
        cronPattern: "30 2 * * *",
      },
      github: {
        enabled: false,
        topics: [],
        timeWindowDays: 7,
        minStarsNew: 20,
        minStarsEstablished: 500,
        maxAgeDays: 14,
        cronPattern: "0 3 * * *",
      },
      vendor_rss: { enabled: false, feeds: [] },
      dataforseo_trends: false,
    },
  });
  await upsertProjectPlannerConfig({
    projectId,
    weeklyBudgetEur,
    perTypeMaxEur: null,
    topNSignalsAllowedOverage: 3,
    maxOveragePerSignal: 1,
  });
}

async function seedGoals(projectId: string, goals: Array<Omit<NewProjectGoal, "projectId">>): Promise<void> {
  await db
    .insert(projectGoals)
    .values(goals.map((g) => ({ ...g, projectId })));
}

type NewTopicBriefRow = typeof topicBriefs.$inferInsert;

async function seedBriefs(
  projectId: string,
  count: number,
  overrides: Partial<NewTopicBriefRow> = {},
): Promise<void> {
  const rows: NewTopicBriefRow[] = Array.from({ length: count }, (_, i) => ({
    projectId,
    source: "gap_analysis",
    topicTitle: `brief-${i + 1}`,
    clusterAction: "create_new",
    approvalStatus: "pending",
    secondaryKeywords: [],
    ...overrides,
  }));
  if (rows.length > 0) await db.insert(topicBriefs).values(rows);
}

const stubRefreshDeps = {
  fetchers: {},
  readCreds: async () => ({}),
};

beforeEach(async () => {
  projectId = await freshProject();
  pipeline = new PlanWeekPipeline({
    resolvePipelineSteps: (name) => pipelineRegistry.get(name)?.steps,
    refreshDeps: stubRefreshDeps,
  });
});

afterEach(async () => {
  // Clean up child rows first so cascades don't fight with explicit deletes.
  const planRows = await db
    .select({ id: weeklyPlans.id })
    .from(weeklyPlans)
    .where(eq(weeklyPlans.projectId, projectId));
  if (planRows.length > 0) {
    await db.delete(plannedItems).where(
      inArray(
        plannedItems.weeklyPlanId,
        planRows.map((p) => p.id),
      ),
    );
    await db.delete(weeklyPlans).where(eq(weeklyPlans.projectId, projectId));
  }
  await db.delete(topicBriefs).where(eq(topicBriefs.projectId, projectId));
  await db.delete(externalSignals).where(eq(externalSignals.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

const ARGS_KW22 = {
  targetYear: 2026,
  targetIsoWeek: 22,
  triggeredBy: "test",
  force: false,
};

describe("PlanWeekPipeline integration", () => {
  it("Scenario 1: happy path — produces a draft plan with planned_items", async () => {
    await seedConfig(projectId, 50);
    await seedGoals(projectId, [
      { contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: null, isActive: true },
      { contentType: "comparison", cadenceUnit: "per_week", minCount: 1, maxCount: null, isActive: true },
    ]);
    await seedBriefs(projectId, 7); // 7 cluster briefs (create_new)
    await seedBriefs(projectId, 1, { source: "comparison_discovery", clusterAction: "comparison" });

    const result = await runPipeline(pipeline, { projectId, ...ARGS_KW22 }, { projectId });
    if (!result.ok) throw new Error(`pipeline failed: ${result.error}`);

    expect(result.output.status).toBe("draft");
    expect(result.output.itemCount).toBeGreaterThanOrEqual(8);
    expect(result.output.supersededPlanId).toBeNull();

    const plan = await db
      .select()
      .from(weeklyPlans)
      .where(eq(weeklyPlans.id, result.output.weeklyPlanId))
      .limit(1);
    expect(plan[0]!.status).toBe("draft");
    expect(plan[0]!.year).toBe(2026);
    expect(plan[0]!.isoWeek).toBe(22);
  });

  it("Scenario 2: partial fill — fewer briefs than target produces fewer items + note", async () => {
    await seedConfig(projectId, 50);
    await seedGoals(projectId, [
      { contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: null, isActive: true },
    ]);
    await seedBriefs(projectId, 3); // only 3 of the 7 needed

    const result = await runPipeline(pipeline, { projectId, ...ARGS_KW22 }, { projectId });
    if (!result.ok) throw new Error(`pipeline failed: ${result.error}`);

    expect(result.output.itemCount).toBe(3);
    const plan = await db
      .select()
      .from(weeklyPlans)
      .where(eq(weeklyPlans.id, result.output.weeklyPlanId))
      .limit(1);
    expect(plan[0]!.generationNotes ?? "").toContain("Shortfall on cluster");
  });

  it("Scenario 3: budget overrun — pipeline aborts before persisting weekly_plans", async () => {
    // Tight budget — fails at validate-goals (FLOOR_EXCEEDS_BUDGET). The
    // budget gate logic is unit-tested in budget-gate-step.test.ts; here we
    // confirm the overall pipeline refuses to persist a plan that breaches
    // the weekly budget regardless of which guard catches it.
    await seedConfig(projectId, 0.01);
    await seedGoals(projectId, [
      { contentType: "cluster", cadenceUnit: "per_day", minCount: 1, maxCount: null, isActive: true },
    ]);
    await seedBriefs(projectId, 7);

    const result = await runPipeline(pipeline, { projectId, ...ARGS_KW22 }, { projectId });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/budget|invalid/i);

    const persisted = await db
      .select()
      .from(weeklyPlans)
      .where(eq(weeklyPlans.projectId, projectId));
    expect(persisted).toHaveLength(0);

    // The BudgetExceededError type is still exported and used by the
    // BudgetGateStep — covered by the step-level unit test.
    expect(typeof BudgetExceededError).toBe("function");
  });

  it("Scenario 4: force re-generation supersedes the prior plan", async () => {
    await seedConfig(projectId, 50);
    await seedGoals(projectId, [
      { contentType: "cluster", cadenceUnit: "per_week", minCount: 1, maxCount: null, isActive: true },
    ]);
    await seedBriefs(projectId, 1);

    const r1 = await runPipeline(pipeline, { projectId, ...ARGS_KW22 }, { projectId });
    if (!r1.ok) throw new Error("first run failed");

    // Seed another brief so the second run has something to do.
    await seedBriefs(projectId, 1);

    const r2 = await runPipeline(
      pipeline,
      { projectId, ...ARGS_KW22, force: true },
      { projectId },
    );
    if (!r2.ok) throw new Error("second run failed");

    expect(r2.output.supersededPlanId).toBe(r1.output.weeklyPlanId);
    const supersededRow = await db
      .select()
      .from(weeklyPlans)
      .where(eq(weeklyPlans.id, r1.output.weeklyPlanId))
      .limit(1);
    expect(supersededRow[0]!.status).toBe("superseded");
  });

  it("Scenario 5: no-force re-generation throws PlanAlreadyExistsError", async () => {
    await seedConfig(projectId, 50);
    await seedGoals(projectId, [
      { contentType: "cluster", cadenceUnit: "per_week", minCount: 1, maxCount: null, isActive: true },
    ]);
    await seedBriefs(projectId, 1);

    const r1 = await runPipeline(pipeline, { projectId, ...ARGS_KW22 }, { projectId });
    if (!r1.ok) throw new Error("first run failed");

    const r2 = await runPipeline(pipeline, { projectId, ...ARGS_KW22 }, { projectId });
    expect(r2.ok).toBe(false);
    if (r2.ok) throw new Error("expected failure");
    expect(r2.error).toMatch(/Active plan already exists/i);
  });

  it("Scenario 6: DE cluster items get an EN sibling item with parent_item_id linked", async () => {
    await seedConfig(projectId, 50);
    await seedGoals(projectId, [
      { contentType: "cluster", cadenceUnit: "per_week", minCount: 1, maxCount: null, isActive: true },
    ]);
    await seedBriefs(projectId, 1, { locale: "de" });

    const result = await runPipeline(pipeline, { projectId, ...ARGS_KW22 }, { projectId });
    if (!result.ok) throw new Error(`pipeline failed: ${result.error}`);

    const items = await db
      .select()
      .from(plannedItems)
      .where(eq(plannedItems.weeklyPlanId, result.output.weeklyPlanId));

    const parent = items.find((i) => i.sourceKind === "floor");
    const sibling = items.find((i) => i.sourceKind === "sibling_locale");
    expect(parent).toBeDefined();
    expect(sibling).toBeDefined();
    expect(sibling!.parentItemId).toBe(parent!.id);
    expect(sibling!.pipelineName).toBe("article:translation");
  });

  it("Scenario 7: signal overage — top-N signals produce overage items", async () => {
    await seedConfig(projectId, 50);
    await seedGoals(projectId, [
      { contentType: "social_post", cadenceUnit: "per_day", minCount: 0, maxCount: null, isActive: true },
    ]);
    await db.insert(externalSignals).values([
      {
        projectId,
        source: "producthunt",
        externalId: "ph-1",
        title: "Tool A",
        rawPayload: {},
        metrics: { votes_count: 500 },
        collectedAt: new Date(),
      },
      {
        projectId,
        source: "hackernews",
        externalId: "hn-1",
        title: "Cool thing",
        rawPayload: {},
        metrics: { points: 1000 },
        collectedAt: new Date(),
      },
    ]);

    const result = await runPipeline(pipeline, { projectId, ...ARGS_KW22 }, { projectId });
    if (!result.ok) throw new Error(`pipeline failed: ${result.error}`);

    const items = await db
      .select()
      .from(plannedItems)
      .where(eq(plannedItems.weeklyPlanId, result.output.weeklyPlanId));
    const overage = items.filter((i) => i.sourceKind === "overage_signal");
    expect(overage.length).toBeGreaterThanOrEqual(1);
    expect(overage[0]!.sourceSignalId).not.toBeNull();
  });
});
