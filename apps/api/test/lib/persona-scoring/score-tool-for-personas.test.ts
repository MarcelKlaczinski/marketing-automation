/**
 * Spec 65.3 — scoreToolForPersonas integration tests.
 *
 * Mocks `@marketing-auto/adapter-anthropic` (process-global per Bun's
 * mock.module — keep per-package CI isolation). Uses the real DB for the
 * tool-article seed + upsertPersonaScore writes.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import {
  articles,
  db,
  eq,
  listPersonaScoresForTool,
  projects,
} from "@marketing-auto/db";

let messagesImpl: (() => Promise<{ raw: string; json: unknown }>) | null = null;
mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: async () => {
      if (!messagesImpl) throw new Error("messagesImpl not set in test");
      const r = await messagesImpl();
      return {
        raw: r.raw,
        json: r.json,
        outputTokens: 50,
        cacheStats: {
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalInputTokens: 100,
          freshInputTokens: 100,
          hit: false,
        },
        stopReason: "end_turn",
        messageId: "msg_test",
      };
    },
  },
}));

const { scoreToolForPersonas, buildScoreToolUserMessage } = await import(
  "../../../src/lib/persona-scoring/score-tool-for-personas.ts"
);

describe("scoreToolForPersonas (Spec 65.3)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [row] = await db
      .insert(projects)
      .values({
        slug: `scoretool-${ts}`,
        name: "Score-Tool test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!row) throw new Error("project INSERT failed");
    projectId = row.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  async function seedTool(suffix: string): Promise<string> {
    const ts = Date.now();
    const [row] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `tool-${suffix}-${ts}`,
        title: `Tool ${suffix}`,
        collection: "tools",
        locale: "de",
        status: "proposed",
        source: "imported",
        metaDescription: `${suffix} is a test tool`,
        category: "writing",
      })
      .returning();
    if (!row) throw new Error("article INSERT failed");
    return row.id;
  }

  it("happy path: UPSERTs scores for every persona the LLM returned", async () => {
    const toolId = await seedTool("happy");

    messagesImpl = async () => {
      const scores = [
        { persona: "beginners", score: 8, reasoning: "Easy onboarding." },
        { persona: "students", score: 7, reasoning: "Useful for essays." },
        { persona: "developers", score: 5, reasoning: "Lacks API depth." },
      ];
      return {
        raw: JSON.stringify({ scores }),
        json: { scores },
      };
    };

    const result = await scoreToolForPersonas({
      projectId,
      toolId,
      personas: ["beginners", "students", "developers"],
    });

    expect(result.source).toBe("llm");
    expect(result.written.sort()).toEqual(["beginners", "developers", "students"]);

    const persisted = await listPersonaScoresForTool({ toolId, projectId });
    expect(persisted).toHaveLength(3);
    const beginners = persisted.find((p) => p.persona === "beginners");
    expect(beginners?.score).toBe(8);
    expect(beginners?.reasoning).toBe("Easy onboarding.");
  });

  it("returns source='skipped' when LLM returns malformed JSON (Zod parse fails)", async () => {
    const toolId = await seedTool("malformed");

    messagesImpl = async () => ({
      raw: '{"scores":[{"persona":"x"}]}', // missing score + reasoning
      json: { scores: [{ persona: "x" }] },
    });

    const result = await scoreToolForPersonas({
      projectId,
      toolId,
      personas: ["beginners"],
    });

    expect(result.source).toBe("skipped");
    expect(result.written).toEqual([]);
  });

  it("returns source='failed' with error when the LLM call throws", async () => {
    const toolId = await seedTool("throws");

    messagesImpl = async () => {
      throw new Error("simulated 500");
    };

    const result = await scoreToolForPersonas({
      projectId,
      toolId,
      personas: ["beginners"],
    });

    expect(result.source).toBe("failed");
    expect(result.error).toContain("simulated 500");
    expect(result.written).toEqual([]);
  });

  it("filters out LLM-hallucinated persona slugs that aren't in the requested set", async () => {
    const toolId = await seedTool("hallucination");

    messagesImpl = async () => {
      const scores = [
        { persona: "beginners", score: 9, reasoning: "Real persona." },
        { persona: "imaginary-persona", score: 10, reasoning: "Hallucinated." },
      ];
      return {
        raw: JSON.stringify({ scores }),
        json: { scores },
      };
    };

    const result = await scoreToolForPersonas({
      projectId,
      toolId,
      personas: ["beginners"],
    });

    expect(result.source).toBe("llm");
    expect(result.written).toEqual(["beginners"]);
  });

  it("rejects non-tool articles via assertArticleIsTool", async () => {
    const ts = Date.now();
    const [row] = await db
      .insert(articles)
      .values({
        projectId,
        slug: `not-a-tool-${ts}`,
        title: "Not a tool",
        collection: "blog",
        locale: "de",
        status: "proposed",
        source: "imported",
      })
      .returning();
    if (!row) throw new Error("article INSERT failed");

    messagesImpl = async () => ({
      raw: JSON.stringify({
        scores: [{ persona: "beginners", score: 5, reasoning: "irrelevant" }],
      }),
      json: { scores: [{ persona: "beginners", score: 5, reasoning: "irrelevant" }] },
    });

    const result = await scoreToolForPersonas({
      projectId,
      toolId: row.id,
      personas: ["beginners"],
    });

    expect(result.source).toBe("failed");
    expect(result.error).toMatch(/collection='blog'/);
  });

  it("buildScoreToolUserMessage includes the tool name + every persona definition", () => {
    const tool = {
      id: "00000000-0000-0000-0000-000000000000",
      name: "MyTool",
      description: "A handy assistant",
      category: "Writing",
      subcategory: null,
      metaDescription: null,
    };
    const msg = buildScoreToolUserMessage(tool, ["beginners", "developers"]);
    expect(msg).toContain("MyTool");
    expect(msg).toContain("Writing");
    expect(msg).toContain("beginners:");
    expect(msg).toContain("developers:");
    expect(msg).toContain("People just starting"); // beginners definition
    expect(msg).toContain("Software engineers"); // developers definition
  });
});
