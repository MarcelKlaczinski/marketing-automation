/**
 * Spec 65.8 — Family-B shared-helpers tests.
 */
import { describe, expect, it } from "bun:test";
import {
  buildHookContext,
  splitNarrativeByBeats,
  resolveArticleUrl,
} from "../../../../src/compositions/_shared/family-b/helpers.ts";

describe("buildHookContext", () => {
  it("passes through rendered + variables", () => {
    const ctx = buildHookContext({
      rendered: "Wie ich als Texter…",
      variables: { profession: "Texter", lifeArea: "Job" },
    });
    expect(ctx.rendered).toBe("Wie ich als Texter…");
    expect(ctx.variables).toEqual({ profession: "Texter", lifeArea: "Job" });
  });
});

describe("splitNarrativeByBeats", () => {
  it("splits a flat narrative by `## beatName` headers", () => {
    const narrative = [
      "## setup",
      "Ich saß am Schreibtisch wie immer.",
      "",
      "## conflict",
      "Dann las ich den Text von ChatGPT — und mein Gehirn fror ein.",
      "",
      "## resolution",
      "Ich entschied mich, KI als Werkzeug zu nutzen statt zu fürchten.",
    ].join("\n");

    const result = splitNarrativeByBeats(narrative, ["setup", "conflict", "resolution"]);
    expect(Object.keys(result).sort()).toEqual(["conflict", "resolution", "setup"]);
    expect(result.setup).toContain("Schreibtisch");
    expect(result.conflict).toContain("ChatGPT");
    expect(result.resolution).toContain("Werkzeug");
  });

  it("is case-insensitive for the beat-name match", () => {
    const result = splitNarrativeByBeats("## SETUP\nHello.\n## Conflict\nThere.", ["setup", "conflict"]);
    expect(result.setup).toBe("Hello.");
    expect(result.conflict).toBe("There.");
  });

  it("ignores unknown headers (does not consume their content)", () => {
    const result = splitNarrativeByBeats("## random\nIgnored body\n## setup\nValid.", ["setup"]);
    expect(result.setup).toBe("Valid.");
    expect(Object.keys(result)).toEqual(["setup"]);
  });

  it("returns empty when narrative has no headers", () => {
    const result = splitNarrativeByBeats("Just prose, no headers.", ["setup"]);
    expect(Object.keys(result)).toEqual([]);
  });

  it("returns empty for empty narrative", () => {
    expect(splitNarrativeByBeats("", ["setup"])).toEqual({});
    expect(splitNarrativeByBeats("   \n  ", ["setup"])).toEqual({});
  });

  it("does not match `##` mid-line (anchored to line-start)", () => {
    const result = splitNarrativeByBeats(
      "## setup\nBody mentions ## conflict inline but the regex is line-anchored.",
      ["setup", "conflict"],
    );
    expect(result.setup).toContain("Body mentions");
    expect(result.conflict).toBeUndefined();
  });

  it("trims whitespace around each beat's body", () => {
    const result = splitNarrativeByBeats("## setup\n\n  Body with padding.  \n\n", ["setup"]);
    expect(result.setup).toBe("Body with padding.");
  });
});

describe("resolveArticleUrl (re-export from family-a)", () => {
  it("works as the canonical multi-tenant URL helper", () => {
    const url = resolveArticleUrl(
      { social: { websiteUrl: "https://toolwiki.ai/" } },
      "my-article",
    );
    expect(url).toBe("toolwiki.ai/my-article");
  });

  it("falls back to toolwiki.ai when websiteUrl is missing", () => {
    expect(resolveArticleUrl({}, "x")).toBe("toolwiki.ai/x");
  });
});
