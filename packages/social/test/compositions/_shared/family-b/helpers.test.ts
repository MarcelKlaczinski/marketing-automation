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

  // V1.6.1 — Spec 65.8/65.4 followup. Sonnet's tagged-block multi-field output
  // pattern emits `## beatName` blocks followed by `<CAPTION>...</CAPTION>` and
  // `<HASHTAGS>...</HASHTAGS>` blocks. Pre-fix, the splitter greedily captured
  // EVERYTHING from `## topPick` to EOF, leaking the trailing tags into the
  // final beat's text — which then rendered as visible text in the slide.
  // Verified against live DB social_posts.7246dd40-4060-4ecd-9eb9-08861b0e289a
  // narrative.topPick.text on 2026-05-28.
  it("strips trailing <UPPERCASE_TAG>...</UPPERCASE_TAG> blocks from the last beat (V1.6.1)", () => {
    const liveLlmOutput = [
      "## hotTake",
      "Claude ist nicht nur gut — Claude ist das stärkste Sprachmodell, das du gerade unterschätzt.",
      "",
      "## reasoning1",
      "Während alle über ChatGPT reden, liefert Claude längere, strukturiertere Antworten.",
      "",
      "## reasoning2",
      "Claude versteht Kontext über mehrere tausend Wörter hinweg.",
      "",
      "## topPick",
      "Meine Empfehlung: Claude — weil es genau das leistet: langer Kontext, präzise Ausgabe.",
      "",
      "<CAPTION>",
      "Claude wird krass unterschätzt — und wer es noch nicht ernsthaft getestet hat, verpasst das stärkste Werkzeug im Stack.",
      "</CAPTION>",
      "",
      "<HASHTAGS>",
      "#Claude #AITools #Texten #Produktivität #ContentCreation",
      "</HASHTAGS>",
    ].join("\n");

    const result = splitNarrativeByBeats(liveLlmOutput, [
      "hotTake",
      "reasoning1",
      "reasoning2",
      "topPick",
    ]);

    // Every beat is present
    expect(Object.keys(result).sort()).toEqual([
      "hottake",
      "reasoning1",
      "reasoning2",
      "toppick",
    ]);

    // CRITICAL: the last beat must NOT contain the trailing tagged blocks
    expect(result.toppick).toBe(
      "Meine Empfehlung: Claude — weil es genau das leistet: langer Kontext, präzise Ausgabe.",
    );
    expect(result.toppick).not.toContain("<CAPTION>");
    expect(result.toppick).not.toContain("</CAPTION>");
    expect(result.toppick).not.toContain("<HASHTAGS>");
    expect(result.toppick).not.toContain("Claude wird krass unterschätzt");
    expect(result.toppick).not.toContain("#Claude");
  });

  it("strips a tagged block that starts immediately (no blank line) after a beat", () => {
    const result = splitNarrativeByBeats(
      "## setup\nBody line.\n<CAPTION>\nTrailing caption.\n</CAPTION>",
      ["setup"],
    );
    expect(result.setup).toBe("Body line.");
  });

  it("treats lowercase or mixed-case <Tag> as body content, not a stop-marker", () => {
    // We only stop on UPPERCASE-only tags (matches the Sonnet tagged-block
    // convention <CAPTION>/<HASHTAGS>); lowercase `<em>` etc. is legitimate inline content.
    const result = splitNarrativeByBeats(
      "## setup\nBody with <em>emphasis</em> and <strong>strong</strong>.",
      ["setup"],
    );
    expect(result.setup).toBe("Body with <em>emphasis</em> and <strong>strong</strong>.");
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
