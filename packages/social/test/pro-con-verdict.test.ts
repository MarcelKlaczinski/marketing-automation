/**
 * Tests for the pro-con-verdict template.
 *
 * Structure:
 *   1. Eligibility — collection + pros/cons array gate
 *   2. Override schema — defaults round-trip
 *   3. Composition schema — input validation
 *   4. Live render — RUN_LIVE_SOCIAL=1 gated
 *
 * Run live suite:
 *   RUN_LIVE_SOCIAL=1 bun test packages/social/test/pro-con-verdict.test.ts
 */

import { describe, expect, it } from "bun:test";
import { proConVerdictTemplate } from "../src/templates/definitions/proConVerdict";
import { proConVerdictOverridesSchema } from "../src/templates/overrides/proConVerdict.overrides";
import { proConVerdictInputSchema } from "../src/compositions/pro-con-verdict/types";
import { PRO_CON_VERDICT_FIXTURES } from "../src/templates/definitions/fixtures/proConVerdict.fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArticle(overrides: Record<string, unknown> = {}) {
  return {
    id: "art-1",
    slug: "loom-review",
    title: "Loom Review",
    collection: "tools",
    locale: "de",
    frontmatterExtras: {
      pros: [
        { text: "Async-Video direkt im Browser" },
        { text: "Auto-Transkription" },
        { text: "Slack-Integration" },
      ],
      cons: [
        { text: "Free-Tier auf 5 Min begrenzt" },
        { text: "Editor schwach" },
        { text: "Keine Live-Recording-Option" },
      ],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Eligibility
// ---------------------------------------------------------------------------

describe("proConVerdictTemplate.eligibility", () => {
  it("returns eligible for a tools article with 3+ pros and 3+ cons", () => {
    const result = proConVerdictTemplate.eligibility(makeArticle(), null);
    expect(result.eligible).toBe(true);
  });

  it("rejects articles not in tools collection", () => {
    const result = proConVerdictTemplate.eligibility(
      makeArticle({ collection: "blog" }),
      null,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/tools/i);
  });

  it("rejects articles with fewer than 3 pros", () => {
    const result = proConVerdictTemplate.eligibility(
      makeArticle({
        frontmatterExtras: {
          pros: [{ text: "Pro 1" }, { text: "Pro 2" }],
          cons: [{ text: "Con 1" }, { text: "Con 2" }, { text: "Con 3" }],
        },
      }),
      null,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/pros/i);
  });

  it("rejects articles with fewer than 3 cons", () => {
    const result = proConVerdictTemplate.eligibility(
      makeArticle({
        frontmatterExtras: {
          pros: [{ text: "Pro 1" }, { text: "Pro 2" }, { text: "Pro 3" }],
          cons: [{ text: "Con 1" }, { text: "Con 2" }],
        },
      }),
      null,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/cons/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Override schema defaults
// ---------------------------------------------------------------------------

describe("proConVerdictOverridesSchema", () => {
  it("parse({}) returns fully-populated defaults", () => {
    const defaults = proConVerdictOverridesSchema.parse({});
    expect(defaults.copy.coverEyebrow.de).toBe("BEWERTUNG");
    expect(defaults.copy.coverEyebrow.en).toBe("REVIEW");
    expect(defaults.copy.prosHeader.de).toBe("VORTEILE");
    expect(defaults.copy.prosHeader.en).toBe("PROS");
    expect(defaults.copy.consHeader.de).toBe("NACHTEILE");
    expect(defaults.copy.consHeader.en).toBe("CONS");
    expect(defaults.copy.verdictEyebrow.de).toBe("VERDIKT");
    expect(defaults.copy.verdictEyebrow.en).toBe("VERDICT");
    expect(defaults.copy.whenToUseLabel.de).toBe("WANN NUTZEN");
    expect(defaults.copy.whenToSkipLabel.en).toBe("WHEN TO SKIP");
    expect(defaults.copy.endCtaText.de).toBe("Mehr im Artikel");
    expect(defaults.layout.includeEndSlide).toBe(true);
    expect(defaults.layout.coverSplitDirection).toBe("diagonal");
    expect(defaults.layout.backgroundIntensity).toBe("medium");
    expect(defaults.eligibility.minPros).toBe(3);
    expect(defaults.eligibility.maxPros).toBe(5);
    expect(defaults.eligibility.minCons).toBe(3);
    expect(defaults.eligibility.maxCons).toBe(5);
  });

  it("strips unknown fields (.strip())", () => {
    const result = proConVerdictOverridesSchema.parse({
      copy: { unknownField: "should be stripped" },
    });
    // @ts-expect-error — intentionally checking unknown field is gone
    expect(result.copy.unknownField).toBeUndefined();
  });

  it("accepts partial overrides and fills in defaults for missing keys", () => {
    const result = proConVerdictOverridesSchema.parse({
      copy: { coverEyebrow: { de: "ANALYSE", en: "ANALYSIS" } },
      layout: { includeEndSlide: false },
    });
    expect(result.copy.coverEyebrow.de).toBe("ANALYSE");
    expect(result.copy.prosHeader.de).toBe("VORTEILE");
    expect(result.layout.includeEndSlide).toBe(false);
    expect(result.layout.showToolLogoOnCover).toBe(true);
  });

  it("rejects invalid coverSplitDirection enum value", () => {
    const result = proConVerdictOverridesSchema.safeParse({
      layout: { coverSplitDirection: "circular" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid backgroundIntensity enum value", () => {
    const result = proConVerdictOverridesSchema.safeParse({
      layout: { backgroundIntensity: "extreme" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Composition input schema
// ---------------------------------------------------------------------------

describe("proConVerdictInputSchema", () => {
  const baseInput = {
    tool: { name: "Loom" },
    pros: [
      "Async-Video direkt im Browser",
      "Auto-Transkription",
      "Slack-Integration",
    ],
    cons: [
      "Free-Tier auf 5 Min begrenzt",
      "Editor schwach",
      "Keine Live-Recording-Option",
    ],
    verdict: {
      snippet: "Loom ist ideal für schnelle async Kommunikation.",
      whenToUse: "Wenn du schnelle Erklärungen ohne Meeting brauchst.",
      whenToSkip: "Wenn du tiefe Video-Editierung oder Live-Streams planst.",
    },
  };

  it("accepts a valid input with verdict", () => {
    const result = proConVerdictInputSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
  });

  it("accepts verdict = null", () => {
    const result = proConVerdictInputSchema.safeParse({ ...baseInput, verdict: null });
    expect(result.success).toBe(true);
  });

  it("rejects fewer than 3 pros", () => {
    const result = proConVerdictInputSchema.safeParse({
      ...baseInput,
      pros: ["Only one pro here"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 cons", () => {
    const result = proConVerdictInputSchema.safeParse({
      ...baseInput,
      cons: ["Con 1", "Con 2", "Con 3", "Con 4", "Con 5", "Con 6"],
    });
    expect(result.success).toBe(false);
  });

  it("defaults theme to dark and locale to de", () => {
    const result = proConVerdictInputSchema.parse(baseInput);
    expect(result.theme).toBe("dark");
    expect(result.locale).toBe("de");
  });
});

// ---------------------------------------------------------------------------
// 4. Fixtures coverage — all three fixture variants are parseable
// ---------------------------------------------------------------------------

describe("PRO_CON_VERDICT_FIXTURES", () => {
  it("exports characteristic, edge-min, edge-max", () => {
    expect(PRO_CON_VERDICT_FIXTURES.characteristic).toBeDefined();
    expect(PRO_CON_VERDICT_FIXTURES["edge-min"]).toBeDefined();
    expect(PRO_CON_VERDICT_FIXTURES["edge-max"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Live render — requires Chrome binary + RUN_LIVE_SOCIAL=1
// ---------------------------------------------------------------------------

const LIVE = process.env.RUN_LIVE_SOCIAL === "1";

describe.skipIf(!LIVE)("renderProConVerdict (live)", () => {
  it(
    "renders 5 PNG slides for the characteristic fixture",
    async () => {
      const { renderProConVerdict } = await import("../render-server");
      const fixture = PRO_CON_VERDICT_FIXTURES.characteristic!;

      const input = proConVerdictInputSchema.parse({
        tool: { name: fixture.input.toolName },
        pros: fixture.input.pros,
        cons: fixture.input.cons,
        verdict: {
          snippet: "Loom ist ideal für schnelle async Kommunikation im Team.",
          whenToUse: "Wenn du schnelle Video-Erklärungen ohne Meeting brauchst.",
          whenToSkip: "Wenn du tiefe Video-Editierung oder Live-Streams planst.",
        },
        theme: "dark",
        locale: "de",
      });

      const result = await renderProConVerdict(input);

      expect(result.sequenceCount).toBe(5);
      expect(result.slides).toHaveLength(5);

      for (const slide of result.slides) {
        expect(slide).toBeInstanceOf(Buffer);
        expect(slide.length).toBeGreaterThan(1000);
      }

      // PNG magic bytes
      const cover = result.slides[0]!;
      expect(cover[0]).toBe(0x89);
      expect(cover[1]).toBe(0x50); // P
      expect(cover[2]).toBe(0x4e); // N
      expect(cover[3]).toBe(0x47); // G
    },
    120_000,
  );

  it(
    "renders 4 slides when includeEndSlide is false",
    async () => {
      const { renderProConVerdict } = await import("../render-server");
      const fixture = PRO_CON_VERDICT_FIXTURES["edge-min"]!;

      const input = proConVerdictInputSchema.parse({
        tool: { name: fixture.input.toolName },
        pros: fixture.input.pros,
        cons: fixture.input.cons,
        verdict: null,
        theme: "light",
        locale: "en",
        overrides: { layout: { includeEndSlide: false } },
        totalSlides: 4,
      });

      const result = await renderProConVerdict(input);
      expect(result.sequenceCount).toBe(4);
      expect(result.slides).toHaveLength(4);
    },
    120_000,
  );

  it(
    "renders edge-max fixture without overflow",
    async () => {
      const { renderProConVerdict } = await import("../render-server");
      const fixture = PRO_CON_VERDICT_FIXTURES["edge-max"]!;

      const input = proConVerdictInputSchema.parse({
        tool: { name: fixture.input.toolName },
        pros: fixture.input.pros,
        cons: fixture.input.cons,
        verdict: {
          snippet: "Maximum length tool has all features packed in but costs a lot.",
          whenToUse:
            "When you need the absolute maximum feature set and budget is no concern for your enterprise team.",
          whenToSkip:
            "When you are a solo developer or small team on a tight budget looking for a simpler workflow.",
        },
        theme: "dark",
        locale: "en",
      });

      const result = await renderProConVerdict(input);
      expect(result.slides).toHaveLength(5);
    },
    120_000,
  );
});
