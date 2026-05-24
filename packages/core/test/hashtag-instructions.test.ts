import { describe, expect, it } from "bun:test";
import {
  buildHashtagInstructions,
  deriveContentType,
  type ContentType,
} from "../src/social-hashtags/buildHashtagInstructions.ts";

// ─── deriveContentType ────────────────────────────────────────────────────────

describe("deriveContentType", () => {
  it.each([
    ["comparison", "comparison"],
    ["vergleich",  "comparison"],
    ["vs",         "comparison"],
    ["vs-test",    "comparison"],
    ["review",     "review"],
    ["bewertung",  "review"],
    ["test",       "review"],
    ["tool-test",  "review"],
    ["general",    "general"],
    ["tutorial",   "general"],
    ["overview",   "general"],
    [null,         "general"],
    [undefined,    "general"],
    ["",           "general"],
  ] as Array<[string | null | undefined, ContentType]>)(
    "intentType %j → %s",
    (intentType, expected) => {
      expect(deriveContentType(intentType)).toBe(expected);
    },
  );
});

// ─── buildHashtagInstructions ─────────────────────────────────────────────────

describe("buildHashtagInstructions — anchor tags", () => {
  // DE-locale output is bilingual (DE+EN anchor tags for dual-search-intent on Instagram).
  // EN-locale output is English-only: the `#KI…` anchors must NOT appear as positive
  // examples. They appear only in the "NO German hashtags" negative-example string,
  // which the test must not conflate with intended output.
  const deCases: Array<[string, ContentType, string[], string[]]> = [
    ["de-DE", "comparison", ["#KITools", "#KIVergleich"],  ["#AITools", "#AIComparison"]],
    ["de-DE", "review",     ["#KITools", "#KIFürBusiness"], ["#AITools", "#AIForBusiness"]],
    ["de-DE", "general",    ["#KITools", "#KIFürBusiness"], ["#AITools", "#AIForBusiness"]],
  ];
  const enCases: Array<[string, ContentType, string[]]> = [
    ["en-US", "comparison", ["#AITools", "#AIComparison"]],
    ["en-US", "review",     ["#AITools", "#AIForBusiness"]],
    ["en-US", "general",    ["#AITools", "#AIForBusiness"]],
  ];

  it.each(deCases)(
    "DE locale=%s contentType=%s → DE anchors=%j EN anchors=%j (bilingual)",
    (locale, contentType, deAnchors, enAnchors) => {
      const output = buildHashtagInstructions({ locale, contentType, toolNames: ["ToolA"] });
      for (const tag of deAnchors) {
        expect(output).toContain(tag);
      }
      for (const tag of enAnchors) {
        expect(output).toContain(tag);
      }
    },
  );

  it.each(enCases)(
    "EN locale=%s contentType=%s → EN anchors=%j (English-only)",
    (locale, contentType, enAnchors) => {
      const output = buildHashtagInstructions({ locale, contentType, toolNames: ["ToolA"] });
      for (const tag of enAnchors) {
        expect(output).toContain(tag);
      }
      // English-only block: confirm the explicit "no German hashtags" rule is present.
      expect(output).toContain("English only");
    },
  );
});

describe("buildHashtagInstructions — rules section", () => {
  const base = { locale: "de-DE", contentType: "general" as ContentType, toolNames: ["Cursor"] };

  it("always emits the 7-tag count instruction", () => {
    const out = buildHashtagInstructions(base);
    expect(out).toContain("EXACTLY 7 tags");
  });

  it("always includes the no-hyphens rule", () => {
    const out = buildHashtagInstructions(base);
    expect(out).toContain("NO hyphens");
  });

  it("always includes the no-year-tags rule", () => {
    const out = buildHashtagInstructions(base);
    expect(out).toContain("NO year tags");
  });

  it("always includes the no-self-promo rule", () => {
    const out = buildHashtagInstructions(base);
    expect(out).toContain("NO self-promotional");
  });

  it("includes tool name hint in the output", () => {
    const out = buildHashtagInstructions({ ...base, toolNames: ["Cursor", "Windsurf"] });
    expect(out).toContain("Cursor");
    expect(out).toContain("Windsurf");
  });

  it("includes toolCategory hint in PascalCase when provided", () => {
    const out = buildHashtagInstructions({ ...base, toolCategory: "code-editors" });
    expect(out).toContain("#CodeEditors");
  });

  it("omits toolCategory from hint when not provided (uses default example instead)", () => {
    const out = buildHashtagInstructions(base);
    // default example hints are present
    expect(out).toMatch(/#Softw|#Produk/);
  });

  it("is a pure function — same inputs produce identical output", () => {
    const a = buildHashtagInstructions(base);
    const b = buildHashtagInstructions(base);
    expect(a).toBe(b);
  });
});
