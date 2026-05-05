import { describe, it, expect, beforeEach } from "bun:test";
import { db, projects, costLogs } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import {
  track,
  CostLimitExceeded,
  anthropicCostEur,
  replicateImageCostEur,
  dataforseoCostEur,
  elevenlabsCostEur,
  resendCostEur,
  getCurrentSpend,
  getProjectCostSummary,
  EUR_PER_USD,
} from "../src/index.ts";

// ─── Pricing ──────────────────────────────────────────────────────────────────

describe("anthropicCostEur", () => {
  it("computes Sonnet cost correctly (1M input + 500K output ≈ €9.66)", () => {
    const eur = anthropicCostEur({
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });
    // (1*3 + 0.5*15) USD = 10.50 USD * 0.92 = 9.66 EUR
    expect(eur).toBeCloseTo(9.66, 1);
  });

  it("includes cache read costs", () => {
    const eur = anthropicCostEur({
      model: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000, // $0.30 * 0.92 = €0.276
    });
    expect(eur).toBeCloseTo(0.276, 2);
  });

  it("includes cache write costs", () => {
    const eur = anthropicCostEur({
      model: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1_000_000, // $3.75 * 0.92 = €3.45
    });
    expect(eur).toBeCloseTo(3.45, 2);
  });

  it("Haiku is cheaper than Sonnet", () => {
    const haiku = anthropicCostEur({ model: "claude-haiku-4-5", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const sonnet = anthropicCostEur({ model: "claude-sonnet-4-6", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(haiku).toBeLessThan(sonnet);
  });
});

describe("other pricing helpers", () => {
  it("replicateImageCostEur: flux-schnell 10 images", () => {
    const eur = replicateImageCostEur({ model: "black-forest-labs/flux-schnell", count: 10 });
    expect(eur).toBeCloseTo(0.003 * 10 * EUR_PER_USD, 5);
  });

  it("dataforseoCostEur: 100 serpStandard requests", () => {
    const eur = dataforseoCostEur({ operation: "serpStandard", count: 100 });
    expect(eur).toBeCloseTo(0.0006 * 100 * EUR_PER_USD, 5);
  });

  it("elevenlabsCostEur: 1000 characters", () => {
    const eur = elevenlabsCostEur({ characters: 1000 });
    expect(eur).toBeCloseTo(0.30 * EUR_PER_USD, 4);
  });

  it("resendCostEur: 100 emails", () => {
    const eur = resendCostEur({ count: 100 });
    expect(eur).toBeCloseTo(0.0001 * 100 * EUR_PER_USD, 6);
  });
});

// ─── track() ──────────────────────────────────────────────────────────────────

describe("track()", () => {
  let projectId: string;

  beforeEach(async () => {
    const [p] = await db.insert(projects).values({
      slug: `cost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: "Cost Test Project",
      industry: "ai_education",
      pipelineTemplate: "educational",
      costLimits: {
        daily: { anthropic: 1.0 },
        monthly: { anthropic: 10.0 },
        alertAtPercent: 80,
        killAtPercent: 100,
      },
    }).returning();
    projectId = p!.id;
  });

  it("logs a cost_logs row after successful call", async () => {
    await track({
      projectId,
      service: "anthropic",
      operation: "test_op",
      estimatedCostEur: 0.05,
      fn: async () => ({ tokens: 1000 }),
      computeCostEur: () => 0.03,
    });

    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(1);
    expect(Number(logs[0]!.costEur)).toBeCloseTo(0.03, 4);
  });

  it("stores metadata including durationMs and estimatedCostEur", async () => {
    await track({
      projectId,
      service: "anthropic",
      operation: "test_meta",
      estimatedCostEur: 0.05,
      fn: async () => "result",
      computeCostEur: () => 0.02,
      metadata: () => ({ stopReason: "end_turn" }),
    });

    const [log] = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(log!.metadata).toHaveProperty("durationMs");
    expect(log!.metadata).toHaveProperty("estimatedCostEur", 0.05);
    expect(log!.metadata).toHaveProperty("stopReason", "end_turn");
  });

  it("throws CostLimitExceeded when daily limit would be exceeded", async () => {
    await expect(
      track({
        projectId,
        service: "anthropic",
        operation: "test_op",
        estimatedCostEur: 2.0, // exceeds €1 daily limit
        fn: async () => "should not run",
        computeCostEur: () => 2.0,
      }),
    ).rejects.toBeInstanceOf(CostLimitExceeded);
  });

  it("does NOT execute fn() when limit would be exceeded", async () => {
    let called = false;
    await track({
      projectId,
      service: "anthropic",
      operation: "test_op",
      estimatedCostEur: 2.0,
      fn: async () => { called = true; return "ran"; },
      computeCostEur: () => 2.0,
    }).catch(() => {});

    expect(called).toBe(false);

    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(0);
  });

  it("accumulates spend correctly across multiple calls", async () => {
    for (let i = 0; i < 3; i++) {
      await track({
        projectId,
        service: "anthropic",
        operation: "small",
        estimatedCostEur: 0.10,
        fn: async () => "ok",
        computeCostEur: () => 0.10,
      });
    }
    const spend = await getCurrentSpend({ projectId, service: "anthropic" });
    expect(spend.daily).toBeCloseTo(0.30, 4);
    expect(spend.monthly).toBeCloseTo(0.30, 4);
  });

  it("blocks the 4th call when cumulative spend hits daily limit", async () => {
    for (let i = 0; i < 3; i++) {
      await track({
        projectId,
        service: "anthropic",
        operation: "medium",
        estimatedCostEur: 0.30,
        fn: async () => "ok",
        computeCostEur: () => 0.30,
      });
    }
    // Current spend: €0.90. estimatedCostEur €0.20 → projected €1.10 > €1 limit
    await expect(
      track({
        projectId,
        service: "anthropic",
        operation: "medium",
        estimatedCostEur: 0.20,
        fn: async () => "ok",
        computeCostEur: () => 0.20,
      }),
    ).rejects.toBeInstanceOf(CostLimitExceeded);
  });

  it("uses estimatedCostEur when computeCostEur returns invalid value", async () => {
    await track({
      projectId,
      service: "anthropic",
      operation: "bad_cost",
      estimatedCostEur: 0.05,
      fn: async () => "ok",
      computeCostEur: () => NaN,
    });

    const [log] = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(Number(log!.costEur)).toBeCloseTo(0.05, 4);
  });

  it("project with no costLimits configured never throws", async () => {
    const [p] = await db.insert(projects).values({
      slug: `no-limits-${Date.now()}`,
      name: "No Limits Project",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();

    await expect(
      track({
        projectId: p!.id,
        service: "anthropic",
        operation: "huge",
        estimatedCostEur: 9999,
        fn: async () => "ok",
        computeCostEur: () => 9999,
      }),
    ).resolves.toBe("ok");
  });
});

// ─── getCurrentSpend ──────────────────────────────────────────────────────────

describe("getCurrentSpend", () => {
  it("returns zeros for a fresh project", async () => {
    const [p] = await db.insert(projects).values({
      slug: `fresh-${Date.now()}`,
      name: "Fresh Project",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();

    const spend = await getCurrentSpend({ projectId: p!.id, service: "anthropic" });
    expect(spend.daily).toBe(0);
    expect(spend.monthly).toBe(0);
  });
});

// ─── getProjectCostSummary ────────────────────────────────────────────────────

describe("getProjectCostSummary", () => {
  it("returns correct today/month breakdown grouped by service", async () => {
    const [p] = await db.insert(projects).values({
      slug: `summary-test-${Date.now()}`,
      name: "Summary Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();
    const pid = p!.id;

    await track({
      projectId: pid,
      service: "anthropic",
      operation: "op1",
      estimatedCostEur: 0.10,
      fn: async () => "ok",
      computeCostEur: () => 0.10,
    });
    await track({
      projectId: pid,
      service: "replicate",
      operation: "image",
      estimatedCostEur: 0.05,
      fn: async () => "ok",
      computeCostEur: () => 0.05,
    });

    const summary = await getProjectCostSummary(pid);
    expect(summary.today.length).toBe(2);
    expect(summary.totals.todayEur).toBeCloseTo(0.15, 4);
    expect(summary.totals.monthEur).toBeCloseTo(0.15, 4);

    const anthropicEntry = summary.today.find((s) => s.service === "anthropic");
    expect(anthropicEntry?.eur).toBeCloseTo(0.10, 4);
  });
});
