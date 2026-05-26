/**
 * Spec 65.8 — narrative-prompt builder + variable-verbatim validator tests.
 */
import { describe, expect, it } from "bun:test";
import {
  buildStoryArcNarrativePrompt,
  buildStoryArcRetrySuffix,
  validateStoryArcNarrative,
} from "../../../src/compositions/story-arc-clickbait/narrative-prompt.ts";
import type { StoryArcNarrative } from "../../../src/compositions/story-arc-clickbait/types.ts";

const HOOK = {
  rendered: "Wie ich als Texter meinen Job mit KI gerettet habe",
  variables: { profession: "Texter", lifeArea: "Job" },
};

function buildNarrative(overrides: Partial<Record<keyof StoryArcNarrative, string>> = {}): StoryArcNarrative {
  const base = {
    setup: "Als Texter saß ich täglich vor meinem Job-Dokument.",
    conflict: "Bis plötzlich KI meinen Texter-Job gefährdete.",
    resolution: "Ich begann KI als Texter zu nutzen statt zu fürchten.",
    payoff: "Heute spart mir KI als Texter Stunden im Job.",
    lesson: "Dein Texter-Job lebt von Urteilsvermögen.",
  };
  const merged = { ...base, ...overrides };
  return {
    setup: { beatName: "setup", text: merged.setup },
    conflict: { beatName: "conflict", text: merged.conflict },
    resolution: { beatName: "resolution", text: merged.resolution },
    payoff: { beatName: "payoff", text: merged.payoff },
    lesson: { beatName: "lesson", text: merged.lesson },
  };
}

describe("buildStoryArcNarrativePrompt", () => {
  it("includes the rendered hook + variable list verbatim", () => {
    const prompt = buildStoryArcNarrativePrompt({ hook: HOOK, locale: "de" });
    expect(prompt).toContain(HOOK.rendered);
    expect(prompt).toContain('profession: "Texter"');
    expect(prompt).toContain('lifeArea: "Job"');
  });

  it("emits 5 beat headers in the output example", () => {
    const prompt = buildStoryArcNarrativePrompt({ hook: HOOK, locale: "de" });
    for (const beat of ["setup", "conflict", "resolution", "payoff", "lesson"]) {
      expect(prompt).toContain(`## ${beat}`);
    }
  });

  it("includes the tool block when primaryToolName is set", () => {
    const prompt = buildStoryArcNarrativePrompt({
      hook: HOOK,
      primaryToolName: "ChatGPT",
      locale: "de",
    });
    expect(prompt).toContain("ChatGPT");
    expect(prompt).toContain("resolution");
    expect(prompt).toContain("payoff");
  });

  it("uses German tone hints when locale=de", () => {
    const prompt = buildStoryArcNarrativePrompt({ hook: HOOK, locale: "de" });
    expect(prompt).toContain("Konflikt");
    expect(prompt).toContain("Auflösung");
    expect(prompt).toContain("German");
  });

  it("uses English tone hints when locale=en", () => {
    const prompt = buildStoryArcNarrativePrompt({ hook: HOOK, locale: "en" });
    expect(prompt).toContain("Conflict");
    expect(prompt).toContain("Resolution");
    expect(prompt).toContain("English");
  });
});

describe("validateStoryArcNarrative", () => {
  it("returns valid=true when every beat mentions at least one variable", () => {
    const result = validateStoryArcNarrative(buildNarrative(), HOOK.variables);
    expect(result.valid).toBe(true);
    expect(result.reasons.length).toBe(0);
  });

  it("flags a beat that mentions NO variables", () => {
    const narrative = buildNarrative({
      conflict: "Plötzlich änderte sich alles in meiner Welt.",
    });
    const result = validateStoryArcNarrative(narrative, HOOK.variables);
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBe(1);
    expect(result.reasons[0]).toContain('Beat "conflict"');
    expect(result.missingVariablesByBeat.conflict).toContain("Texter");
    expect(result.missingVariablesByBeat.conflict).toContain("Job");
  });

  it("treats verbatim matching as case-insensitive but word-boundary-aware", () => {
    // "Geotexter" contains "texter" but NOT as a word — should NOT count.
    const narrative = buildNarrative({
      setup: "Als Geotexter saß ich vor dem Schreibtisch.",
    });
    const result = validateStoryArcNarrative(narrative, HOOK.variables);
    // "Job" is missing too (setup line doesn't mention it) — beat fails.
    expect(result.valid).toBe(false);
  });

  it("accepts case-variations (texter ↔ TEXTER ↔ Texter)", () => {
    const narrative = buildNarrative({
      setup: "Als TEXTER startete ich in den Job.",
    });
    const result = validateStoryArcNarrative(narrative, HOOK.variables);
    expect(result.valid).toBe(true);
  });

  it("returns valid=true when variables map is empty", () => {
    const result = validateStoryArcNarrative(buildNarrative(), {});
    expect(result.valid).toBe(true);
  });

  it("skips empty-string variable values", () => {
    const result = validateStoryArcNarrative(buildNarrative(), {
      profession: "Texter",
      lifeArea: "",
    });
    expect(result.valid).toBe(true);
  });
});

describe("buildStoryArcRetrySuffix", () => {
  it("returns empty string when validation passed", () => {
    const validation = validateStoryArcNarrative(buildNarrative(), HOOK.variables);
    expect(buildStoryArcRetrySuffix(validation)).toBe("");
  });

  it("lists each failing beat's reason", () => {
    const narrative = buildNarrative({
      conflict: "Plötzlich änderte sich alles.",
      lesson: "Allgemeine Lebensweisheit.",
    });
    const validation = validateStoryArcNarrative(narrative, HOOK.variables);
    const suffix = buildStoryArcRetrySuffix(validation);
    expect(suffix).toContain("Retry");
    expect(suffix).toContain('Beat "conflict"');
    expect(suffix).toContain('Beat "lesson"');
    expect(suffix).toContain("verbatim");
  });
});
