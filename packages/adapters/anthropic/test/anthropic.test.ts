import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects, costLogs } from "@marketing-auto/db";
import { messages } from "../src/client.ts";

const live = process.env.RUN_LIVE_ANTHROPIC === "1";
const describeLive = live ? describe : describe.skip;

describeLive("Anthropic adapter (LIVE)", () => {
  let projectId: string;
  const slug = `anthropic-test-${Date.now()}`;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "Anthropic Adapter Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        costLimits: { daily: { anthropic: 5 }, monthly: { anthropic: 50 } },
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns text from haiku and writes a cost log", async () => {
    const result = await messages({
      projectId,
      operation: "test-haiku",
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "Reply in exactly three words.",
      userMessage: "Greet me.",
      maxTokens: 50,
      estimatedCostEur: 0.01,
    });

    expect(result.raw.length).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);

    const logs = await db
      .select()
      .from(costLogs)
      .where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(1);
    expect(Number(logs[0]!.costEur)).toBeGreaterThan(0);
  });

  it("returns parsed JSON in jsonMode", async () => {
    const result = await messages({
      projectId,
      operation: "test-json",
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: 'Return a JSON object: {"greeting": <string>, "length": <number>}',
      userMessage: "Make a one-word greeting.",
      maxTokens: 100,
      jsonMode: true,
      estimatedCostEur: 0.01,
    });

    expect(result.json).not.toBeNull();
    expect(typeof result.json).toBe("object");
    // json is unknown at runtime; cast is safe because jsonMode guarantees an object
    expect((result.json as Record<string, unknown>).greeting).toBeDefined();
  });

  it(
    "shows cache hit on second call with same prefix",
    async () => {
      const longPrefix = "This is a stable cached system prompt. "
        .repeat(500)
        .slice(0, 18000);

      const first = await messages({
        projectId,
        operation: "cache-warmup",
        model: "claude-haiku-4-5",
        systemPrefix: longPrefix,
        systemSuffix: "Reply briefly.",
        userMessage: "First call.",
        maxTokens: 30,
        estimatedCostEur: 0.05,
      });
      expect(first.raw.length).toBeGreaterThan(0);

      const second = await messages({
        projectId,
        operation: "cache-hit",
        model: "claude-haiku-4-5",
        systemPrefix: longPrefix,
        systemSuffix: "Reply briefly.",
        userMessage: "Second call.",
        maxTokens: 30,
        estimatedCostEur: 0.05,
      });
      expect(second.cacheStats.cacheReadInputTokens).toBeGreaterThan(0);
      expect(second.cacheStats.hit).toBe(true);
    },
    30_000,
  );
});

describe("type exports", () => {
  it("exports the right surface", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.messages).toBe("function");
    expect(typeof mod.anthropic.messages).toBe("function");
    expect(mod.ANTHROPIC_MODELS["claude-sonnet-4-6"]).toBe("claude-sonnet-4-6");
  });
});
