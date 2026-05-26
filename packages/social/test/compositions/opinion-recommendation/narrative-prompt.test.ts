/**
 * Spec 65.8 — opinion-recommendation narrative-prompt + validator tests.
 */
import { describe, expect, it } from "bun:test";
import {
  buildOpinionRecommendationNarrativePrompt,
  buildOpinionRecommendationRetrySuffix,
  validateOpinionRecommendationNarrative,
} from "../../../src/compositions/opinion-recommendation/narrative-prompt.ts";
import type { OpinionRecommendationNarrative } from "../../../src/compositions/opinion-recommendation/types.ts";

const HOOK = {
  rendered: "Die meisten Texter benutzen ChatGPT falsch",
  variables: { profession: "Texter", lifeArea: "Workflow" },
};
const TOOL_NAME = "Claude";

function buildNarrative(
  overrides: Partial<Record<keyof OpinionRecommendationNarrative, string>> = {},
): OpinionRecommendationNarrative {
  const base = {
    hotTake: "Die meisten Texter benutzen ChatGPT falsch. Punkt.",
    reasoning1: "Erster Beleg: Suche ist nicht Denken — Prompts strukturieren Gedanken.",
    reasoning2: "Zweiter Beleg: Drei Wochen sind Minimum, um den Workflow zu kalibrieren.",
    topPick: "Meine Empfehlung: Claude — weil es dich zwingt, strukturiert zu denken.",
  };
  const merged = { ...base, ...overrides };
  return {
    hotTake: { beatName: "hotTake", text: merged.hotTake },
    reasoning1: { beatName: "reasoning1", text: merged.reasoning1 },
    reasoning2: { beatName: "reasoning2", text: merged.reasoning2 },
    topPick: { beatName: "topPick", text: merged.topPick },
  };
}

describe("buildOpinionRecommendationNarrativePrompt", () => {
  it("includes the hook + recommended tool name verbatim", () => {
    const prompt = buildOpinionRecommendationNarrativePrompt({
      hook: HOOK,
      recommendedToolName: TOOL_NAME,
      locale: "de",
    });
    expect(prompt).toContain(HOOK.rendered);
    expect(prompt).toContain(TOOL_NAME);
  });

  it("emits 4 beat headers in the output example", () => {
    const prompt = buildOpinionRecommendationNarrativePrompt({
      hook: HOOK,
      recommendedToolName: TOOL_NAME,
      locale: "de",
    });
    for (const beat of ["hotTake", "reasoning1", "reasoning2", "topPick"]) {
      expect(prompt).toContain(`## ${beat}`);
    }
  });

  it("includes the hedging-blocklist in the rules block", () => {
    const prompt = buildOpinionRecommendationNarrativePrompt({
      hook: HOOK,
      recommendedToolName: TOOL_NAME,
      locale: "de",
    });
    expect(prompt).toContain("FORBIDDEN");
    expect(prompt).toContain("vielleicht");
    expect(prompt).toContain("maybe");
  });
});

describe("validateOpinionRecommendationNarrative", () => {
  it("returns valid=true on declarative hotTake + tool-mentioning topPick", () => {
    const result = validateOpinionRecommendationNarrative(buildNarrative(), TOOL_NAME);
    expect(result.valid).toBe(true);
    expect(result.hotTakeIsDeclarative).toBe(true);
    expect(result.topPickMentionsRecommendation).toBe(true);
  });

  it("flags hotTake containing a question mark", () => {
    const result = validateOpinionRecommendationNarrative(
      buildNarrative({
        hotTake: "Benutzen die meisten Texter ChatGPT falsch?",
      }),
      TOOL_NAME,
    );
    expect(result.valid).toBe(false);
    expect(result.hotTakeIsDeclarative).toBe(false);
    expect(result.reasons.some((r) => r.includes("question"))).toBe(true);
  });

  it("flags hotTake containing German hedging (vielleicht / ich denke)", () => {
    const result = validateOpinionRecommendationNarrative(
      buildNarrative({
        hotTake: "Vielleicht benutzen die meisten Texter ChatGPT falsch.",
      }),
      TOOL_NAME,
    );
    expect(result.valid).toBe(false);
    expect(result.hotTakeHedgingHits).toContain("vielleicht");
  });

  it("flags hotTake containing English hedging (maybe / I think)", () => {
    const result = validateOpinionRecommendationNarrative(
      buildNarrative({
        hotTake: "Maybe most writers are using ChatGPT wrong.",
      }),
      TOOL_NAME,
    );
    expect(result.valid).toBe(false);
    expect(result.hotTakeHedgingHits).toContain("maybe");
  });

  it("flags topPick missing the recommended tool name", () => {
    const result = validateOpinionRecommendationNarrative(
      buildNarrative({
        topPick: "Meine Empfehlung: das richtige Werkzeug für den richtigen Job.",
      }),
      TOOL_NAME,
    );
    expect(result.valid).toBe(false);
    expect(result.topPickMentionsRecommendation).toBe(false);
  });

  it("matches the tool name case-insensitively", () => {
    const result = validateOpinionRecommendationNarrative(
      buildNarrative({
        topPick: "Meine Empfehlung: CLAUDE — die beste Wahl fürs Schreiben.",
      }),
      TOOL_NAME,
    );
    expect(result.topPickMentionsRecommendation).toBe(true);
  });

  it("does NOT match hedging-phrase substrings (word-boundary)", () => {
    // "irgendwie" would substring-match "wie" — but \b-bounded should not flag.
    const result = validateOpinionRecommendationNarrative(
      buildNarrative({
        hotTake: "Sportliche Werkzeuge gewinnen — die meisten unterschätzen sie.",
      }),
      TOOL_NAME,
    );
    expect(result.hotTakeHedgingHits.length).toBe(0);
  });
});

describe("buildOpinionRecommendationRetrySuffix", () => {
  it("returns empty string when validation passed", () => {
    const validation = validateOpinionRecommendationNarrative(buildNarrative(), TOOL_NAME);
    expect(buildOpinionRecommendationRetrySuffix(validation)).toBe("");
  });

  it("lists every failing reason in the retry suffix", () => {
    const validation = validateOpinionRecommendationNarrative(
      buildNarrative({
        hotTake: "Vielleicht sind die meisten Texter zu vorsichtig?",
        topPick: "Eine gute Empfehlung kommt zum Schluss.",
      }),
      TOOL_NAME,
    );
    const suffix = buildOpinionRecommendationRetrySuffix(validation);
    expect(suffix).toContain("Retry");
    expect(suffix).toContain("Hot-Take");
    expect(suffix).toContain("Top-Pick");
  });
});
