/**
 * Spec 65.14 — pickHook drama-intensity filter tests.
 *
 * Locks down the Spec 64.16 invariant: when `outputTargets = { article: true,
 * social: false }`, the picker MUST return only `subtle`-tagged hooks. A
 * social caller (default Toolwiki recurring def) receives all three
 * intensities.
 *
 * Also asserts `allowedDramaIntensitiesFor` is pure (no DB hop).
 *
 * IMPORTANT: uses `mock.module()` which is process-global — keep per-package
 * CI isolation via `bun --filter @marketing-auto/api test`.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import {
  createHookTemplate,
  db,
  eq,
  type HookDramaIntensity,
  type HookTemplate,
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

const { pickHook, allowedDramaIntensitiesFor } = await import(
  "../../../src/lib/hook-library/pick-hook.ts"
);

describe("allowedDramaIntensitiesFor (Spec 65.14 §3.5 pure helper)", () => {
  it("article-only → ['subtle']", () => {
    expect(allowedDramaIntensitiesFor({ article: true, social: false })).toEqual(["subtle"]);
  });

  it("social=true → all three intensities (article=true OR false)", () => {
    expect(allowedDramaIntensitiesFor({ article: false, social: true })).toEqual([
      "subtle",
      "moderate",
      "aggressive",
    ]);
    expect(allowedDramaIntensitiesFor({ article: true, social: true })).toEqual([
      "subtle",
      "moderate",
      "aggressive",
    ]);
  });

  it("degenerate { article: false, social: false } defaults to all three (never starve the picker)", () => {
    expect(allowedDramaIntensitiesFor({ article: false, social: false })).toEqual([
      "subtle",
      "moderate",
      "aggressive",
    ]);
  });

  it("partial object (only social=true) → all three", () => {
    expect(allowedDramaIntensitiesFor({ social: true })).toEqual([
      "subtle",
      "moderate",
      "aggressive",
    ]);
  });

  it("partial object (only article=true) → ['subtle']", () => {
    expect(allowedDramaIntensitiesFor({ article: true })).toEqual(["subtle"]);
  });
});

describe("pickHook drama-intensity SQL pre-filter (Spec 65.14)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [row] = await db
      .insert(projects)
      .values({
        slug: `dramafilter-${ts}`,
        name: "Drama-filter test",
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

  async function seedMixedPool(
    formatType: string,
    suffix: string,
  ): Promise<Record<HookDramaIntensity, HookTemplate>> {
    // 1 hook per intensity, fully distinct so the LLM can be asked to pick
    // each individually in subsequent tests.
    const subtle = await createHookTemplate({
      projectId,
      formatType,
      pattern: `subtle-${suffix}: gentle copy about {tool}`,
      language: "de",
      variables: ["tool"],
      dramaIntensity: "subtle",
    });
    const moderate = await createHookTemplate({
      projectId,
      formatType,
      pattern: `moderate-${suffix}: {n} reasons {tool} works`,
      language: "de",
      variables: ["n", "tool"],
      dramaIntensity: "moderate",
    });
    const aggressive = await createHookTemplate({
      projectId,
      formatType,
      pattern: `aggressive-${suffix}: RIP — {tool} killed it`,
      language: "de",
      variables: ["tool"],
      dramaIntensity: "aggressive",
    });
    return { subtle, moderate, aggressive };
  }

  it("Spec 64.16 invariant — article-only outputTargets NEVER returns moderate/aggressive", async () => {
    const { subtle, moderate, aggressive } = await seedMixedPool(
      "drama-article-only",
      "art",
    );
    // LLM picks the subtle row — exercises the happy path AND the filter
    // (LLM is offered only subtle, picks subtle, returns subtle).
    messagesImpl = async () => ({
      raw: JSON.stringify({ pickedHookId: subtle.id, reasoning: "Only choice" }),
      json: { pickedHookId: subtle.id, reasoning: "Only choice" },
    });

    const r = await pickHook({
      projectId,
      formatType: "drama-article-only",
      language: "de",
      outputTargets: { article: true, social: false },
    });

    expect(r).not.toBeNull();
    // The picked hook MUST be the subtle one — never moderate or aggressive.
    expect(r?.hookId).toBe(subtle.id);
    expect(r?.hookId).not.toBe(moderate.id);
    expect(r?.hookId).not.toBe(aggressive.id);
  });

  it("Spec 64.16 invariant — article-only that LLM hallucinates moderate UUID falls back to subtle (never widens)", async () => {
    const { subtle, moderate, aggressive } = await seedMixedPool(
      "drama-article-halluc",
      "hal",
    );
    // LLM picks the moderate row's UUID — but the SQL pre-filter NEVER
    // surfaced it, so the picker treats this as a hallucination and falls
    // back to the first LRU candidate (which is subtle by construction).
    messagesImpl = async () => ({
      raw: JSON.stringify({ pickedHookId: moderate.id, reasoning: "hallucination" }),
      json: { pickedHookId: moderate.id, reasoning: "hallucination" },
    });

    const r = await pickHook({
      projectId,
      formatType: "drama-article-halluc",
      language: "de",
      outputTargets: { article: true, social: false },
    });

    expect(r).not.toBeNull();
    expect(r?.source).toBe("fallback");
    // Crucially: the fallback is subtle. Even with LLM picking the moderate
    // UUID, the pool only contained subtle, so fallback IS subtle.
    expect(r?.hookId).toBe(subtle.id);
    expect(r?.hookId).not.toBe(moderate.id);
    expect(r?.hookId).not.toBe(aggressive.id);
  });

  it("Social outputTargets — LLM can pick any of the three intensities", async () => {
    const { subtle, moderate, aggressive } = await seedMixedPool(
      "drama-social-all",
      "soc",
    );
    // Drive the LLM to pick the aggressive UUID — this MUST succeed because
    // the pool was un-filtered for a social caller.
    messagesImpl = async () => ({
      raw: JSON.stringify({ pickedHookId: aggressive.id, reasoning: "fits brand voice" }),
      json: { pickedHookId: aggressive.id, reasoning: "fits brand voice" },
    });

    const r = await pickHook({
      projectId,
      formatType: "drama-social-all",
      language: "de",
      outputTargets: { article: false, social: true },
    });

    expect(r).not.toBeNull();
    expect(r?.hookId).toBe(aggressive.id);
    expect(r?.source).toBe("llm");
    // Sanity — the other intensities exist in the pool too.
    expect([subtle.id, moderate.id, aggressive.id]).toContain(r!.hookId);
  });

  it("Article-only with NO subtle hooks in pool → returns null (no widening)", async () => {
    // Seed a format with ONLY aggressive hooks; article-only caller gets
    // empty pool → null (NOT a silent widen to aggressive).
    const formatType = "drama-art-only-empty";
    await createHookTemplate({
      projectId,
      formatType,
      pattern: "aggressive-only: RIP {tool}",
      language: "de",
      variables: ["tool"],
      dramaIntensity: "aggressive",
    });
    messagesImpl = null; // LLM must NOT be called

    const r = await pickHook({
      projectId,
      formatType,
      language: "de",
      outputTargets: { article: true, social: false },
    });

    expect(r).toBeNull();
  });

  it("Picker drops hooks needing {established} when competitorTool is undefined", async () => {
    const formatType = "drama-established-drop";
    // Seed two aggressive hooks: one needs {established}, one doesn't.
    const withEstablished = await createHookTemplate({
      projectId,
      formatType,
      pattern: "RIP {established}: {tool} took over",
      language: "de",
      variables: ["established", "tool"],
      dramaIntensity: "aggressive",
    });
    const noEstablished = await createHookTemplate({
      projectId,
      formatType,
      pattern: "Vergiss alles — {tool} ist es",
      language: "de",
      variables: ["tool"],
      dramaIntensity: "aggressive",
    });
    // LLM picks the {established}-bearing UUID — but the pre-filter dropped
    // it (no competitorTool in contentContext), so the picker treats it as
    // hallucination and falls back to the noEstablished hook (only survivor).
    messagesImpl = async () => ({
      raw: JSON.stringify({ pickedHookId: withEstablished.id, reasoning: "halluc" }),
      json: { pickedHookId: withEstablished.id, reasoning: "halluc" },
    });

    const r = await pickHook({
      projectId,
      formatType,
      language: "de",
      outputTargets: { article: false, social: true },
      contentContext: { toolNames: ["Claude"] }, // NO competitorTool
    });

    expect(r).not.toBeNull();
    expect(r?.hookId).toBe(noEstablished.id);
    expect(r?.hookId).not.toBe(withEstablished.id);
  });

  it("Picker keeps {established}-hooks when competitorTool IS supplied", async () => {
    const formatType = "drama-established-keep";
    const withEstablished = await createHookTemplate({
      projectId,
      formatType,
      pattern: "Vergiss {established}: {tool} ist besser",
      language: "de",
      variables: ["established", "tool"],
      dramaIntensity: "aggressive",
    });
    // LLM picks the established-bearing UUID — this time the pre-filter
    // KEEPS it (competitorTool supplied), so the LLM pick stands.
    messagesImpl = async () => ({
      raw: JSON.stringify({ pickedHookId: withEstablished.id, reasoning: "contrarian fit" }),
      json: { pickedHookId: withEstablished.id, reasoning: "contrarian fit" },
    });

    const r = await pickHook({
      projectId,
      formatType,
      language: "de",
      outputTargets: { article: false, social: true },
      contentContext: { toolNames: ["Claude"], competitorTool: "ChatGPT" },
    });

    expect(r).not.toBeNull();
    expect(r?.hookId).toBe(withEstablished.id);
    expect(r?.source).toBe("llm");
  });
});
