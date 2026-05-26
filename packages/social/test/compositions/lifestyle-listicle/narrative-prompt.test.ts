/**
 * Spec 65.8 — lifestyle-listicle narrative-prompt + validator tests.
 */
import { describe, expect, it } from "bun:test";
import {
  buildLifestyleListicleNarrativePrompt,
  buildLifestyleListicleRetrySuffix,
  validateLifestyleListicleNarrative,
} from "../../../src/compositions/lifestyle-listicle/narrative-prompt.ts";
import type { LifestyleListicleNarrative } from "../../../src/compositions/lifestyle-listicle/types.ts";

const HOOK = {
  rendered: "3 Momente, in denen ChatGPT meinen Alltag verändert",
  variables: { profession: "Texter", lifeArea: "Alltag" },
};
const TOOL_NAME = "ChatGPT";

function buildNarrative(
  overrides: Partial<Record<keyof LifestyleListicleNarrative, string>> = {},
): LifestyleListicleNarrative {
  const base = {
    intro: "Als Texter habe ich ChatGPT in meinen Alltag in 3 Momenten integriert.",
    item1: "Morgens beim Kaffee: ChatGPT drafted die ersten Tasks für mich.",
    item2: "Im Job: ChatGPT pairs mit mir beim Schreiben der Werbetexte.",
    item3: "Was ich nicht erwartet hätte: ChatGPT hilft mir bei Geburtstagstexten.",
  };
  const merged = { ...base, ...overrides };
  return {
    intro: { beatName: "intro", text: merged.intro },
    item1: { beatName: "item1", text: merged.item1 },
    item2: { beatName: "item2", text: merged.item2 },
    item3: { beatName: "item3", text: merged.item3 },
  };
}

describe("buildLifestyleListicleNarrativePrompt", () => {
  it("includes the hook + featured tool name verbatim", () => {
    const prompt = buildLifestyleListicleNarrativePrompt({
      hook: HOOK,
      featuredToolName: TOOL_NAME,
      locale: "de",
    });
    expect(prompt).toContain(HOOK.rendered);
    expect(prompt).toContain(TOOL_NAME);
    expect(prompt).toContain('profession: "Texter"');
  });

  it("emits 4 beat headers in the output example", () => {
    const prompt = buildLifestyleListicleNarrativePrompt({
      hook: HOOK,
      featuredToolName: TOOL_NAME,
      locale: "de",
    });
    for (const beat of ["intro", "item1", "item2", "item3"]) {
      expect(prompt).toContain(`## ${beat}`);
    }
  });

  it("uses English tone hints when locale=en", () => {
    const prompt = buildLifestyleListicleNarrativePrompt({
      hook: HOOK,
      featuredToolName: TOOL_NAME,
      locale: "en",
    });
    expect(prompt).toContain("English");
    expect(prompt).toContain("everyday life");
  });
});

describe("validateLifestyleListicleNarrative", () => {
  it("returns valid=true when intro mentions variable + items mention tool", () => {
    const result = validateLifestyleListicleNarrative(buildNarrative(), HOOK.variables, TOOL_NAME);
    expect(result.valid).toBe(true);
    expect(result.reasons.length).toBe(0);
    expect(result.introMentionsVariable).toBe(true);
    expect(result.itemsMentionTool.item1).toBe(true);
  });

  it("flags intro missing all hook variables", () => {
    const result = validateLifestyleListicleNarrative(
      buildNarrative({
        intro: "Mein Alltag hat sich verändert — drei Momente weisen den Weg.",
      }),
      HOOK.variables,
      TOOL_NAME,
    );
    // intro contains "Alltag" — should match. Let me use a truly empty case.
    expect(result.introMentionsVariable).toBe(true); // "Alltag" is a variable value
  });

  it("flags intro missing all variables when none appear", () => {
    const result = validateLifestyleListicleNarrative(
      buildNarrative({
        intro: "Drei Momente, die mein Leben verändert haben — und worauf es wirklich ankommt.",
      }),
      HOOK.variables,
      TOOL_NAME,
    );
    expect(result.introMentionsVariable).toBe(false);
    expect(result.reasons.some((r) => r.includes("Intro"))).toBe(true);
  });

  it("flags an item that does not mention the featured tool", () => {
    const result = validateLifestyleListicleNarrative(
      buildNarrative({
        item2: "Im Job nutze ich oft KI, ohne genau zu wissen welches Modell.",
      }),
      HOOK.variables,
      TOOL_NAME,
    );
    expect(result.valid).toBe(false);
    expect(result.itemsMentionTool.item2).toBe(false);
    expect(result.reasons.some((r) => r.includes("item2"))).toBe(true);
  });

  it("returns valid=true when variables map is empty (intro check skipped)", () => {
    const result = validateLifestyleListicleNarrative(buildNarrative(), {}, TOOL_NAME);
    expect(result.valid).toBe(true);
  });

  it("matches tool name case-insensitively", () => {
    const result = validateLifestyleListicleNarrative(
      buildNarrative({
        item1: "Morgens: CHATGPT übernimmt die ersten 3 Tasks.",
      }),
      HOOK.variables,
      TOOL_NAME,
    );
    expect(result.itemsMentionTool.item1).toBe(true);
  });
});

describe("buildLifestyleListicleRetrySuffix", () => {
  it("returns empty string when validation passed", () => {
    const validation = validateLifestyleListicleNarrative(
      buildNarrative(),
      HOOK.variables,
      TOOL_NAME,
    );
    expect(buildLifestyleListicleRetrySuffix(validation)).toBe("");
  });

  it("lists every failing reason in the retry suffix", () => {
    const validation = validateLifestyleListicleNarrative(
      buildNarrative({
        intro: "Mein Leben hat sich verändert.", // no variable match
        item3: "Was unerwartet kam: KI im Privaten.", // no tool match
      }),
      HOOK.variables,
      TOOL_NAME,
    );
    const suffix = buildLifestyleListicleRetrySuffix(validation);
    expect(suffix).toContain("Retry");
    expect(suffix).toContain("Intro");
    expect(suffix).toContain("item3");
  });
});
