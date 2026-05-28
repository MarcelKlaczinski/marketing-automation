/**
 * Spec 65.4 — pickHook integration tests.
 *
 * Mocks `@marketing-auto/adapter-anthropic` to stay offline; uses the real DB
 * for `listLruEligibleHooks` + `markHookUsed`. Each test inserts its own
 * project + hook seeds and cleans up via FK cascade on project delete.
 *
 * IMPORTANT: this file uses `mock.module()` which is process-global — keep
 * the per-package CI isolation (run via `bun --filter @marketing-auto/api test`).
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import {
  createHookTemplate,
  db,
  eq,
  getHookTemplate,
  type HookTemplate,
  listLruEligibleHooks,
  projects,
} from "@marketing-auto/db";

// Controllable mock — each test sets `messagesImpl` to drive behaviour.
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

const { pickHook, buildHookPickerUserMessage } = await import(
  "../../../src/lib/hook-library/pick-hook.ts"
);

describe("pickHook (Spec 65.4)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [row] = await db
      .insert(projects)
      .values({
        slug: `pickhook-${ts}`,
        name: "Pickhook test",
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

  async function seed(
    formatType: string,
    count: number,
  ): Promise<HookTemplate[]> {
    const out: HookTemplate[] = [];
    for (let i = 0; i < count; i++) {
      out.push(
        await createHookTemplate({
          projectId,
          formatType,
          pattern: `${formatType}-pattern-${i}`,
          language: "de",
          variables: ["tool"],
        }),
      );
    }
    return out;
  }

  it("returns null when no candidates exist for the format-type", async () => {
    messagesImpl = null; // LLM must NOT be called
    const r = await pickHook({
      projectId,
      formatType: "nonexistent-type",
      language: "de",
      outputTargets: { article: false, social: true },
    });
    expect(r).toBeNull();
  });

  it("returns LLM-picked hook with reasoning + marks it used", async () => {
    const seeds = await seed("test-llm-happy", 5);
    const targetId = seeds[2]!.id;

    messagesImpl = async () => ({
      raw: JSON.stringify({ pickedHookId: targetId, reasoning: "Best fit by tone." }),
      json: { pickedHookId: targetId, reasoning: "Best fit by tone." },
    });

    const r = await pickHook({
      projectId,
      formatType: "test-llm-happy",
      language: "de",
      outputTargets: { article: false, social: true },
    });

    expect(r).not.toBeNull();
    expect(r?.hookId).toBe(targetId);
    expect(r?.source).toBe("llm");
    expect(r?.reasoning).toBe("Best fit by tone.");

    const after = await getHookTemplate(targetId);
    expect(after?.usageCount).toBe(1);
    expect(after?.lastUsedAt).not.toBeNull();
  });

  it("falls back to first LRU candidate when LLM hallucinates a UUID", async () => {
    await seed("test-llm-hallucination", 3);
    // The LRU helper orders by (lastUsedAt ASC NULLS FIRST, usageCount ASC, id ASC).
    // All seeds share NULL lastUsedAt + 0 usageCount, so tiebreaker is id ASC —
    // which doesn't match insertion order. Query the actual head.
    const lru = await listLruEligibleHooks({
      projectId,
      formatType: "test-llm-hallucination",
      language: "de",
      limit: 10,
    });
    const expectedFirst = lru[0]!.id;

    messagesImpl = async () => ({
      raw: '{"pickedHookId":"00000000-0000-0000-0000-000000000000","reasoning":"made it up"}',
      json: { pickedHookId: "00000000-0000-0000-0000-000000000000", reasoning: "made it up" },
    });

    const r = await pickHook({
      projectId,
      formatType: "test-llm-hallucination",
      language: "de",
      outputTargets: { article: false, social: true },
    });

    expect(r?.hookId).toBe(expectedFirst);
    expect(r?.source).toBe("fallback");
    expect(r?.reasoning).toMatch(/Fallback/);

    const after = await getHookTemplate(expectedFirst);
    expect(after?.usageCount).toBe(1);
  });

  it("falls back when the LLM call throws", async () => {
    await seed("test-llm-throws", 2);
    const lru = await listLruEligibleHooks({
      projectId,
      formatType: "test-llm-throws",
      language: "de",
      limit: 10,
    });
    messagesImpl = async () => {
      throw new Error("simulated LLM 500");
    };

    const r = await pickHook({
      projectId,
      formatType: "test-llm-throws",
      language: "de",
      outputTargets: { article: false, social: true },
    });

    expect(r?.hookId).toBe(lru[0]!.id);
    expect(r?.source).toBe("fallback");
  });

  it("falls back when the LLM returns malformed JSON (Zod parse fails)", async () => {
    await seed("test-llm-zod-fail", 2);
    const lru = await listLruEligibleHooks({
      projectId,
      formatType: "test-llm-zod-fail",
      language: "de",
      limit: 10,
    });
    messagesImpl = async () => ({
      raw: '{"pickedHookId":"not-a-uuid"}',
      json: { pickedHookId: "not-a-uuid" }, // missing reasoning + bad uuid
    });

    const r = await pickHook({
      projectId,
      formatType: "test-llm-zod-fail",
      language: "de",
      outputTargets: { article: false, social: true },
    });

    expect(r?.source).toBe("fallback");
    expect(r?.hookId).toBe(lru[0]!.id);
  });

  it("buildHookPickerUserMessage embeds all candidate IDs + the content context", () => {
    const fakeRow: HookTemplate = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      projectId,
      formatType: "x",
      pattern: "x-pattern",
      language: "de",
      variables: ["tool"],
      dramaIntensity: "subtle",
      usageCount: 3,
      lastUsedAt: new Date("2026-01-15T00:00:00Z"),
      isActive: true,
      createdAt: new Date(),
    };

    const out = buildHookPickerUserMessage([fakeRow], {
      toolNames: ["Claude", "Cursor"],
      professionPool: ["Texter"],
      lifeArea: "Solopreneur-Alltag",
    });

    expect(out).toContain("Claude, Cursor");
    expect(out).toContain("Texter");
    expect(out).toContain("Solopreneur-Alltag");
    expect(out).toContain("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(out).toContain("x-pattern");
    expect(out).toContain("2026-01-15");
  });
});
