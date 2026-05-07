import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { buildSystemPrompt } from "../src/prompts/builder.ts";
import { _resetProjectContextCache } from "../src/skills/loader.ts";

describe("buildSystemPrompt", () => {
  let projectId: string;
  const slug = `prompt-test-${Date.now()}`;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "Prompt Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        marketingContextMd: "# Test Context\n\nSample content for testing.",
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
    _resetProjectContextCache();
  });

  it("composes prefix and suffix from skill, context, and instructions", async () => {
    let result;
    try {
      result = await buildSystemPrompt({
        skills: "copywriting",
        projectIdOrSlug: slug,
        stepInstructions: "Write a one-line slogan.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Skill not found")) {
        console.warn("Skill not loadable — submodule not populated, skipping");
        return;
      }
      throw e;
    }

    expect(result.cacheablePrefix.length).toBeGreaterThan(50);
    expect(result.cacheablePrefix).toContain("Sample content for testing");
    expect(result.variableSuffix).toContain("Write a one-line slogan.");
    expect(result.full).toBe(`${result.cacheablePrefix}\n\n${result.variableSuffix}`);
  });

  it("throws when project context is missing", async () => {
    expect(
      buildSystemPrompt({
        skills: "copywriting",
        projectIdOrSlug: "definitely-not-a-real-slug",
        stepInstructions: "x",
      })
    ).rejects.toThrow(/No marketing context/);
  });
});
