/**
 * Spec 65.5 — Brief-Generator dispatch registry shape tests.
 *
 * Pure structural assertions — no DB / LLM. The 5 generators are imported
 * via the registry to guarantee the map is wired correctly.
 */
import { describe, expect, it } from "bun:test";
import {
  BRIEF_GENERATORS,
  dispatchBriefGenerator,
  UnknownFormatTypeError,
} from "../../../src/lib/recurring-content/brief-generators/index.ts";

describe("BRIEF_GENERATORS registry (Spec 65.5)", () => {
  it("registers all 5 v1 format-types", () => {
    expect(Object.keys(BRIEF_GENERATORS).sort()).toEqual(
      [
        "head_to_head",
        "lifestyle_listicle",
        "opinion_recommendation",
        "story_arc_clickbait",
        "top_n_comparison",
      ].sort(),
    );
  });

  it("each entry is a function", () => {
    for (const [key, fn] of Object.entries(BRIEF_GENERATORS)) {
      expect(typeof fn).toBe("function");
      expect(fn.name.length).toBeGreaterThan(0);
      // sanity: name follows the generate*Brief convention
      expect(fn.name).toMatch(/^generate.+Brief$/);
      void key;
    }
  });

  it("dispatchBriefGenerator throws UnknownFormatTypeError on unknown key", async () => {
    // minimal stub ctx — won't be reached because dispatch throws first.
    const ctx = {
      definition: {
        id: "00000000-0000-0000-0000-000000000000",
        formatType: "wat-no-such-format",
      },
      config: {},
      projectId: "00000000-0000-0000-0000-000000000000",
      language: "de" as const,
      runNumber: 1,
    };
    let caught: unknown = null;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the dispatch error path
      await dispatchBriefGenerator(ctx as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnknownFormatTypeError);
    expect((caught as UnknownFormatTypeError).formatType).toBe("wat-no-such-format");
  });
});
