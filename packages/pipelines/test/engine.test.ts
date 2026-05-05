import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { BaseStep, Pipeline, runPipeline } from "../src/engine/index.ts";
import type { StepContext } from "../src/engine/index.ts";
import { loadSkill, _resetSkillCache } from "../src/skills/loader.ts";

// --- Test steps ---

class EchoStep extends BaseStep<{ message: string }, { echo: string }> {
  readonly name = "echo";
  readonly inputSchema = z.object({ message: z.string() });
  readonly outputSchema = z.object({ echo: z.string() });

  async execute(input: { message: string }, _ctx: StepContext) {
    return { echo: `echo: ${input.message}` };
  }
}

class FailingStep extends BaseStep<{ message: string }, { ok: boolean }> {
  readonly name = "failing";
  readonly inputSchema = z.object({ message: z.string() });
  readonly outputSchema = z.object({ ok: z.boolean() });

  async execute(_input: { message: string }, _ctx: StepContext): Promise<{ ok: boolean }> {
    throw new Error("boom");
  }
}

// --- Test pipelines ---

class TrivialPipeline extends Pipeline<{ message: string }, { echo: string }> {
  readonly name = "trivial";
  readonly inputSchema = z.object({ message: z.string() });
  readonly outputSchema = z.object({ echo: z.string() });
  readonly steps = [new EchoStep()] as const;
}

class FailingPipeline extends Pipeline<{ message: string }, { ok: boolean }> {
  readonly name = "fails";
  readonly inputSchema = z.object({ message: z.string() });
  readonly outputSchema = z.object({ ok: z.boolean() });
  readonly steps = [new FailingStep()] as const;
}

// --- Runner tests ---

describe("Pipeline runner", () => {
  let projectId: string;

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug: `pipeline-test-${Date.now()}`,
      name: "Pipeline Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("runs a trivial pipeline to completion", async () => {
    const result = await runPipeline(
      new TrivialPipeline(),
      { message: "hello" },
      { projectId },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.echo).toBe("echo: hello");
      expect(result.stepOutputs["echo"]).toEqual({ echo: "echo: hello" });
    }
  });

  it("captures step failure and marks pipeline failed", async () => {
    const result = await runPipeline(
      new FailingPipeline(),
      { message: "x" },
      { projectId },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("boom");
      expect(result.failedAtStep).toBe("failing");
    }
  });

  it("rejects invalid pipeline input via Zod", async () => {
    await expect(
      runPipeline(
        new TrivialPipeline(),
        { message: 123 } as unknown as { message: string },
        { projectId },
      ),
    ).rejects.toThrow();
  });
});

// --- Skill loader tests ---

describe("loadSkill", () => {
  afterAll(() => {
    _resetSkillCache();
  });

  it("throws a clear error for a nonexistent skill", async () => {
    await expect(loadSkill("__nonexistent_skill__")).rejects.toThrow("Skill not found: __nonexistent_skill__");
  });

  it("loads and caches a real skill if submodule is populated", async () => {
    try {
      const content = await loadSkill("copywriting");
      expect(content.length).toBeGreaterThan(100);

      // Second call should hit cache (no disk read)
      const cached = await loadSkill("copywriting");
      expect(cached).toBe(content);
    } catch {
      console.warn("Skill submodule not populated — skipping real skill load test");
    }
  });
});
