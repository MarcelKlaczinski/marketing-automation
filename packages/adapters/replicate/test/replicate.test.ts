import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { costLogs, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { generateImage } from "../src/index.ts";

const live = process.env.RUN_LIVE_REPLICATE === "1";
const describeLive = live ? describe : describe.skip;

describeLive("Replicate adapter (LIVE)", () => {
  let projectId: string;
  const slug = `replicate-test-${Date.now()}`;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "Replicate Adapter Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        costLimits: { daily: { replicate: 0.5 }, monthly: { replicate: 5 } },
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("generates a flux-1.1-pro image and stores to R2", async () => {
    const result = await generateImage({
      projectId,
      operation: "test-flux-pro",
      model: "flux-1.1-pro",
      prompt: "minimalist abstract illustration of a circle, monochrome, editorial style",
      aspectRatio: "16:9",
      outputFormat: "webp",
      quality: 90,
      storagePrefix: `${slug}/test`,
      estimatedCostEur: 0.05,
    });

    expect(result.publicUrl).toMatch(/^https:\/\//);
    expect(result.r2Key).toContain(slug);
    expect(result.r2Key.endsWith(".webp")).toBe(true);
    expect(result.bytesStored).toBeGreaterThan(1000);

    const resp = await fetch(result.publicUrl);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("image/webp");

    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(1);
    expect(logs[0]!.service).toBe("replicate");
    expect(Number(logs[0]!.costEur)).toBeGreaterThan(0);
    const meta = logs[0]!.metadata as Record<string, unknown>;
    expect(meta.model).toBe("flux-1.1-pro");
    expect(meta.r2Key).toBe(result.r2Key);
  }, 60_000);

  it("flux-schnell completes faster and cheaper", async () => {
    const start = Date.now();
    const result = await generateImage({
      projectId,
      operation: "test-flux-schnell",
      model: "flux-schnell",
      prompt: "abstract gradient",
      aspectRatio: "1:1",
      storagePrefix: `${slug}/test`,
      estimatedCostEur: 0.01,
    });
    const durationMs = Date.now() - start;

    expect(result.publicUrl).toMatch(/^https:\/\//);
    expect(durationMs).toBeLessThan(15_000);
  }, 30_000);
});

describe("type exports", () => {
  it("exports the right surface", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.generateImage).toBe("function");
    expect(typeof mod.replicate.generateImage).toBe("function");
    expect(mod.REPLICATE_MODELS["flux-1.1-pro"]).toBe("black-forest-labs/flux-1.1-pro");
  });
});
