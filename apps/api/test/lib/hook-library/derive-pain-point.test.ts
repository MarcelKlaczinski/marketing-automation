/**
 * Spec 65.14 — derivePainPoint tests.
 *
 * Mocks `@marketing-auto/adapter-anthropic` to stay offline. Asserts (1)
 * LLM happy-path returns the LLM-derived painPoint with `source: "llm"`,
 * (2) Zod-rejection falls back to the language-specific generic anchor,
 * (3) LLM-throw falls back, (4) the user-message builder embeds the
 * expected context fields.
 *
 * IMPORTANT: uses `mock.module()` which is process-global — keep per-package
 * CI isolation via `bun --filter @marketing-auto/api test`.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

let messagesImpl: (() => Promise<{ raw: string; json: unknown }>) | null = null;
mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: async () => {
      if (!messagesImpl) throw new Error("messagesImpl not set in test");
      const r = await messagesImpl();
      return {
        raw: r.raw,
        json: r.json,
        outputTokens: 30,
        cacheStats: {
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalInputTokens: 80,
          freshInputTokens: 80,
          hit: false,
        },
        stopReason: "end_turn",
        messageId: "msg_test",
      };
    },
  },
}));

const { derivePainPoint, buildPainPointUserMessage } = await import(
  "../../../src/lib/hook-library/derive-pain-point.ts"
);

describe("derivePainPoint (Spec 65.14)", () => {
  beforeEach(() => {
    messagesImpl = null;
  });

  describe("buildPainPointUserMessage (pure)", () => {
    it("embeds language directive, tools, briefTopic, profession", () => {
      const msg = buildPainPointUserMessage({
        projectId: "p-1",
        language: "de",
        toolNames: ["Claude", "Cursor"],
        briefTopic: "career-disruption story",
        profession: "Texter",
      });
      expect(msg).toContain("German (du-form)");
      expect(msg).toContain("Claude, Cursor");
      expect(msg).toContain("career-disruption story");
      expect(msg).toContain("Texter");
      expect(msg).toContain("1-4 words");
      expect(msg).toContain("Respond with JSON");
    });

    it("EN language directive when language='en'", () => {
      const msg = buildPainPointUserMessage({
        projectId: "p-1",
        language: "en",
        toolNames: ["Cursor"],
      });
      expect(msg).toContain("English");
      expect(msg).not.toContain("German (du-form)");
    });

    it("omits briefTopic + profession lines when undefined", () => {
      const msg = buildPainPointUserMessage({
        projectId: "p-1",
        language: "de",
        toolNames: ["X"],
      });
      expect(msg).not.toContain("Brief topic:");
      expect(msg).not.toContain("Profession:");
    });
  });

  describe("LLM happy path", () => {
    it("returns LLM-derived painPoint with source='llm' and reasoning", async () => {
      messagesImpl = async () => ({
        raw: JSON.stringify({
          painPoint: "stundenlanges Brainstorming",
          reasoning: "Claude removes the blank-page friction",
        }),
        json: {
          painPoint: "stundenlanges Brainstorming",
          reasoning: "Claude removes the blank-page friction",
        },
      });

      const r = await derivePainPoint({
        projectId: "p-1",
        language: "de",
        toolNames: ["Claude"],
        briefTopic: "career-disruption story",
      });

      expect(r.painPoint).toBe("stundenlanges Brainstorming");
      expect(r.source).toBe("llm");
      expect(r.reasoning).toBe("Claude removes the blank-page friction");
    });

    it("trims whitespace from LLM output", async () => {
      messagesImpl = async () => ({
        raw: JSON.stringify({ painPoint: "  boilerplate code  " }),
        json: { painPoint: "  boilerplate code  " },
      });

      const r = await derivePainPoint({
        projectId: "p-1",
        language: "en",
        toolNames: ["Cursor"],
      });

      expect(r.painPoint).toBe("boilerplate code");
      expect(r.source).toBe("llm");
    });
  });

  describe("Soft-fail to generic fallback", () => {
    it("DE language → 'manuelle Arbeit' fallback on Zod parse failure", async () => {
      messagesImpl = async () => ({
        raw: JSON.stringify({ painPoint: "" }), // min(2) Zod check rejects
        json: { painPoint: "" },
      });

      const r = await derivePainPoint({
        projectId: "p-1",
        language: "de",
        toolNames: ["Claude"],
      });

      expect(r.painPoint).toBe("manuelle Arbeit");
      expect(r.source).toBe("fallback");
      expect(r.reasoning).toBeUndefined();
    });

    it("EN language → 'manual work' fallback on Zod parse failure", async () => {
      messagesImpl = async () => ({
        raw: JSON.stringify({ painPoint: "X".repeat(200) }), // max(80) rejects
        json: { painPoint: "X".repeat(200) },
      });

      const r = await derivePainPoint({
        projectId: "p-1",
        language: "en",
        toolNames: ["Claude"],
      });

      expect(r.painPoint).toBe("manual work");
      expect(r.source).toBe("fallback");
    });

    it("LLM throw → generic fallback (DE)", async () => {
      messagesImpl = async () => {
        throw new Error("simulated Haiku 500");
      };

      const r = await derivePainPoint({
        projectId: "p-1",
        language: "de",
        toolNames: ["Claude"],
      });

      expect(r.painPoint).toBe("manuelle Arbeit");
      expect(r.source).toBe("fallback");
    });

    it("LLM throw → generic fallback (EN)", async () => {
      messagesImpl = async () => {
        throw new Error("simulated Haiku 500");
      };

      const r = await derivePainPoint({
        projectId: "p-1",
        language: "en",
        toolNames: ["Cursor"],
      });

      expect(r.painPoint).toBe("manual work");
      expect(r.source).toBe("fallback");
    });
  });
});
