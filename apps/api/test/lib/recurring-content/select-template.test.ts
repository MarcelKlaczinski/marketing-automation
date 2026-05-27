/**
 * Spec 65.5 — 3-Layer Template-Selector tests.
 *
 * Layer 0 (fixed) and Layer 2 (LRU) use the real DB + FORMAT_TYPES registry.
 * Layer 3 (LLM-rank) mocks `@marketing-auto/adapter-anthropic` to exercise:
 *   - happy path: LLM picks a valid candidate
 *   - hallucination fallback: LLM picks an unknown key → LRU
 *   - Zod-parse fallback: LLM returns malformed JSON → LRU
 *   - LLM-throw fallback: adapter throws → LRU
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import {
  db,
  eq,
  logTemplateUsage,
  projects,
  recurringContentDefinitions,
  templateUsageLog,
  type RecurringContentDefinition,
} from "@marketing-auto/db";

let messagesImpl:
  | (() => Promise<{ raw: string; json: unknown }> | { raw: string; json: unknown })
  | null = null;
mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: async () => {
      if (!messagesImpl) throw new Error("messagesImpl not set in test");
      const r = await Promise.resolve(messagesImpl());
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

const { selectTemplateForRecurringBrief } = await import(
  "../../../src/lib/recurring-content/brief-generators/shared/select-template.ts"
);

describe("selectTemplateForRecurringBrief (Spec 65.5)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `select-tpl-${ts}`,
        name: "select-template test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  afterEach(() => {
    messagesImpl = null;
  });

  async function seedDefinition(
    overrides: Partial<typeof recurringContentDefinitions.$inferInsert>,
  ): Promise<RecurringContentDefinition> {
    const [row] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "test-def",
        formatType: "top_n_comparison",
        formatConfig: {},
        frequency: "weekly",
        nextRunAt: new Date(),
        ...overrides,
      })
      .returning();
    if (!row) throw new Error("definition INSERT failed");
    return row;
  }

  it("Layer 0 — fixed strategy returns the configured templateKey", async () => {
    const def = await seedDefinition({
      templateSelectionStrategy: "fixed",
      fixedTemplateKey: "comparison-grid-3",
    });
    const result = await selectTemplateForRecurringBrief({ definition: def });
    expect(result.templateKey).toBe("comparison-grid-3");
    expect(result.selectedVia).toBe("fixed");
  });

  it("Layer 0 — fixed strategy without fixedTemplateKey throws", async () => {
    const def = await seedDefinition({
      templateSelectionStrategy: "fixed",
      fixedTemplateKey: null,
    });
    await expect(selectTemplateForRecurringBrief({ definition: def })).rejects.toThrow();
  });

  it("Layer 1 — single-eligible-template format-types short-circuit to LRU", async () => {
    // Spec 65.cleanup: opinion_recommendation now has exactly 1 eligible
    // template ("opinion-recommendation" — V1-cut from -dramatic / -minimal
    // variants per Spec 65.7 Day 4 §16). This exercises the genuine Layer 1
    // single-eligible short-circuit (was spoofed via the 2-variant array
    // before V1-cut).
    const def = await seedDefinition({
      formatType: "opinion_recommendation",
      templateSelectionStrategy: "lru",
    });
    const result = await selectTemplateForRecurringBrief({ definition: def });
    expect(result.templateKey).toBe("opinion-recommendation");
    expect(result.selectedVia).toBe("lru");
  });

  it("Layer 2 — LRU skips recently-used templates", async () => {
    const def = await seedDefinition({
      formatType: "top_n_comparison",
      templateSelectionStrategy: "lru",
    });
    // top_n_comparison eligible: ["comparison-grid-3", "comparison-grid-5"]
    await logTemplateUsage({
      recurringDefinitionId: def.id,
      templateKey: "comparison-grid-3",
    });
    const result = await selectTemplateForRecurringBrief({ definition: def });
    expect(result.templateKey).toBe("comparison-grid-5");
    expect(result.selectedVia).toBe("lru");
  });

  it("Layer 3 — LLM-rank happy path picks a valid candidate", async () => {
    const def = await seedDefinition({
      formatType: "top_n_comparison",
      templateSelectionStrategy: "llm-picks",
    });
    messagesImpl = () => ({
      raw: '{"pickedTemplateKey":"comparison-grid-5","reasoning":"5 tools fit better here"}',
      json: { pickedTemplateKey: "comparison-grid-5", reasoning: "5 tools fit better here" },
    });
    const result = await selectTemplateForRecurringBrief({
      definition: def,
      briefContext: { toolNames: ["Claude", "ChatGPT", "Gemini", "Mistral", "Llama"] },
    });
    expect(result.templateKey).toBe("comparison-grid-5");
    expect(result.selectedVia).toBe("llm-rank");
    expect(result.reasoning).toBe("5 tools fit better here");
  });

  it("Layer 3 — LLM hallucination falls back to LRU", async () => {
    const def = await seedDefinition({
      formatType: "top_n_comparison",
      templateSelectionStrategy: "llm-picks",
    });
    messagesImpl = () => ({
      raw: '{"pickedTemplateKey":"comparison-grid-99","reasoning":"made up"}',
      json: { pickedTemplateKey: "comparison-grid-99", reasoning: "made up" },
    });
    const result = await selectTemplateForRecurringBrief({ definition: def });
    expect(["comparison-grid-3", "comparison-grid-5"]).toContain(result.templateKey);
    expect(result.selectedVia).toBe("lru");
  });

  it("Layer 3 — LLM Zod parse failure falls back to LRU", async () => {
    const def = await seedDefinition({
      formatType: "top_n_comparison",
      templateSelectionStrategy: "llm-picks",
    });
    messagesImpl = () => ({ raw: "garbage", json: { wrong: "shape" } });
    const result = await selectTemplateForRecurringBrief({ definition: def });
    expect(["comparison-grid-3", "comparison-grid-5"]).toContain(result.templateKey);
    expect(result.selectedVia).toBe("lru");
  });

  it("Layer 3 — LLM throw falls back to LRU", async () => {
    const def = await seedDefinition({
      formatType: "top_n_comparison",
      templateSelectionStrategy: "llm-picks",
    });
    messagesImpl = () => {
      throw new Error("Anthropic unreachable");
    };
    const result = await selectTemplateForRecurringBrief({ definition: def });
    expect(["comparison-grid-3", "comparison-grid-5"]).toContain(result.templateKey);
    expect(result.selectedVia).toBe("lru");
  });

  it("unknown strategy falls back to LRU defensively", async () => {
    const def = await seedDefinition({
      formatType: "top_n_comparison",
      // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid strategy for the defensive fallback test
      templateSelectionStrategy: "weird-future-strategy" as any,
    });
    const result = await selectTemplateForRecurringBrief({ definition: def });
    expect(["comparison-grid-3", "comparison-grid-5"]).toContain(result.templateKey);
    expect(result.selectedVia).toBe("lru");
  });

  // Cleanup the log rows that accumulate across tests so the LRU window
  // doesn't pollute later assertions.
  it("cleanup: drain template_usage_log for the test project", async () => {
    const defs = await db
      .select({ id: recurringContentDefinitions.id })
      .from(recurringContentDefinitions)
      .where(eq(recurringContentDefinitions.projectId, projectId));
    for (const d of defs) {
      await db.delete(templateUsageLog).where(eq(templateUsageLog.recurringDefinitionId, d.id));
    }
    expect(true).toBe(true);
  });
});
