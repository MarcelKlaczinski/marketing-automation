import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { costLogs, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import {
  DataForSeoError,
  keywordOverview,
  rankedKeywords,
  relatedKeywords,
  serp,
} from "../src/index.ts";

const live = process.env.RUN_LIVE_DATAFORSEO === "1";
const describeLive = live ? describe : describe.skip;

describeLive("DataForSEO adapter (LIVE)", () => {
  let projectId: string;
  const slug = `dataforseo-test-${Date.now()}`;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "DataForSEO Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        costLimits: {
          daily: { dataforseo: 1.0 },
          monthly: { dataforseo: 10 },
        },
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("serp returns Germany Google organic results for a German query", async () => {
    const result = await serp({
      projectId,
      operation: "test-serp",
      keyword: "claude vs chatgpt vergleich",
      depth: 10,
      estimatedCostEur: 0.005,
    });

    expect(result.organicResults.length).toBeGreaterThan(3);
    expect(result.organicResults[0]!.url).toMatch(/^https?:\/\//);
    expect(result.checkUrl).toBeDefined();

    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    const last = logs[logs.length - 1]!;
    expect(last.service).toBe("dataforseo");
    expect(Number(last.costEur)).toBeGreaterThan(0);
  }, 30_000);

  it("keywordOverview returns search volume for known keyword", async () => {
    const result = await keywordOverview({
      projectId,
      operation: "test-overview",
      keywords: ["chatgpt", "claude ai", "künstliche intelligenz"],
      estimatedCostEur: 0.05,
    });

    expect(result.items.length).toBe(3);
    const chatgpt = result.items.find((i) => i.keyword === "chatgpt");
    expect(chatgpt?.searchVolume).toBeGreaterThan(10_000);
  }, 30_000);

  it("relatedKeywords returns related ideas", async () => {
    const result = await relatedKeywords({
      projectId,
      operation: "test-related",
      seed: "ki tools",
      limit: 50,
      estimatedCostEur: 0.015,
    });

    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items[0]!.keyword).toBeDefined();
  }, 30_000);

  it("rankedKeywords returns keywords for wikipedia.org", async () => {
    const result = await rankedKeywords({
      projectId,
      operation: "test-ranked",
      domain: "de.wikipedia.org",
      limit: 50,
      maxPosition: 50,
      estimatedCostEur: 0.015,
    });

    expect(result.items.length).toBeGreaterThan(10);
  }, 30_000);

  it("standard mode throws explanatory error", async () => {
    await expect(
      serp({
        projectId,
        operation: "test-standard",
        keyword: "test",
        mode: "standard",
        estimatedCostEur: 0.001,
      })
    ).rejects.toThrow(DataForSeoError);
  });
});

describe("type exports", () => {
  it("exports the right surface", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.serp).toBe("function");
    expect(typeof mod.keywordOverview).toBe("function");
    expect(typeof mod.relatedKeywords).toBe("function");
    expect(typeof mod.rankedKeywords).toBe("function");
    expect(mod.LOCATION_CODES.GERMANY).toBe(2276);
    expect(mod.dataforseo.serp).toBe(mod.serp);
  });
});
