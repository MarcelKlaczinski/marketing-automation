/**
 * Tests for the pro-con-verdict template (Spec 60.5 DS single-still rewrite).
 *
 * Structure:
 *   1. Eligibility — collection + pros/cons array gate
 *   2. Override schema — defaults round-trip
 *   3. Composition input schema — generated field validation
 *   4. Fixtures coverage — all three fixture variants are defined
 *   5. Live render — RUN_LIVE_SOCIAL=1 gated
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
    domainExtras: {
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

const validGenerated = {
  toolName: "Loom",
  toolCategory: "Video-Messaging",
  iconInitials: "LM",
  iconHue: 180,
  subline: "Loom in Pro und Contra — wofür es sich lohnt, und wo ein anderes Tool besser passt.",
  eyebrow: "Pro & Contra · Tool-Verdict",
  slideNum: "04 / 05",
  ctaLine1: "Vollständiger Test →",
  ctaLine2: "toolwiki.ai/loom",
  dateLabel: "Stand 05/2026 · toolwiki.ai",
  prosHeader: "Stärken",
  consHeader: "Schwächen",
  pros: [
    "Async-Video direkt im Browser",
    "Auto-Transkription inklusive",
    "Slack-Integration nahtlos",
  ],
  cons: [
    "Free-Tier auf 5 Min begrenzt",
    "Video-Editor schwach",
    "Keine Live-Recording-Option",
  ],
  verdictText: "Für async-First Teams erste Wahl — solange du keinen Vollzeit-Editor brauchst.",
  verdictEm: "erste Wahl",
  recommendationTag: "Empfohlen für: Remote-Teams & Content Creator",
};

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
        domainExtras: {
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
        domainExtras: {
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
    expect(defaults.copy.eyebrow.de).toBe("Pro & Contra · Tool-Verdict");
    expect(defaults.copy.eyebrow.en).toBe("Pros & Cons · Tool Verdict");
    expect(defaults.copy.prosHeader.de).toBe("Stärken");
    expect(defaults.copy.prosHeader.en).toBe("Strengths");
    expect(defaults.copy.consHeader.de).toBe("Schwächen");
    expect(defaults.copy.consHeader.en).toBe("Weaknesses");
    expect(defaults.copy.ctaPrefix.de).toBe("Vollständiger Test →");
    expect(defaults.copy.ctaPrefix.en).toBe("Full review →");
    expect(defaults.eligibility.minToolCount).toBe(1);
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
      copy: { eyebrow: { de: "Analyse", en: "Analysis" } },
    });
    expect(result.copy.eyebrow.de).toBe("Analyse");
    expect(result.copy.prosHeader.de).toBe("Stärken");
  });
});

// ---------------------------------------------------------------------------
// 3. Composition input schema
// ---------------------------------------------------------------------------

describe("proConVerdictInputSchema", () => {
  it("accepts a valid generated input", () => {
    const result = proConVerdictInputSchema.safeParse({ generated: validGenerated });
    expect(result.success).toBe(true);
  });

  it("defaults theme to dark and locale to de", () => {
    const result = proConVerdictInputSchema.parse({ generated: validGenerated });
    expect(result.theme).toBe("dark");
    expect(result.locale).toBe("de");
  });

  it("rejects fewer than 3 pros in generated", () => {
    const result = proConVerdictInputSchema.safeParse({
      generated: { ...validGenerated, pros: ["Only one pro"] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 4 cons in generated", () => {
    const result = proConVerdictInputSchema.safeParse({
      generated: {
        ...validGenerated,
        cons: ["Con 1", "Con 2", "Con 3", "Con 4", "Con 5"],
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts light theme", () => {
    const result = proConVerdictInputSchema.safeParse({
      generated: validGenerated,
      theme: "light",
      locale: "en",
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Fixtures coverage — all three fixture variants are defined
// ---------------------------------------------------------------------------

describe("PRO_CON_VERDICT_FIXTURES", () => {
  it("exports characteristic, edge-min, edge-max", () => {
    expect(PRO_CON_VERDICT_FIXTURES.characteristic).toBeDefined();
    expect(PRO_CON_VERDICT_FIXTURES["edge-min"]).toBeDefined();
    expect(PRO_CON_VERDICT_FIXTURES["edge-max"]).toBeDefined();
  });

  it("each fixture has input and generatedContent", () => {
    for (const [key, fixture] of Object.entries(PRO_CON_VERDICT_FIXTURES)) {
      expect(fixture.input, `${key}.input`).toBeDefined();
      expect(fixture.generatedContent, `${key}.generatedContent`).toBeDefined();
    }
  });

  it("generatedContent parses through proConVerdictGeneratedSchema", async () => {
    const { proConVerdictGeneratedSchema } = await import(
      "../src/compositions/pro-con-verdict/types"
    );
    for (const [key, fixture] of Object.entries(PRO_CON_VERDICT_FIXTURES)) {
      const result = proConVerdictGeneratedSchema.safeParse(fixture.generatedContent);
      expect(result.success, `${key} generatedContent should be valid`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Live render — requires Chrome binary + RUN_LIVE_SOCIAL=1
// ---------------------------------------------------------------------------

const LIVE = process.env.RUN_LIVE_SOCIAL === "1";

describe.skipIf(!LIVE)("renderProConVerdict (live)", () => {
  it(
    "renders 1 PNG slide (single-still) for the characteristic fixture",
    async () => {
      const { renderProConVerdict } = await import("../render-server");
      const fixture = PRO_CON_VERDICT_FIXTURES.characteristic!;

      const input = proConVerdictInputSchema.parse({
        generated: fixture.generatedContent,
        theme: "dark",
        locale: "de",
      });

      const result = await renderProConVerdict(input);

      expect(result.sequenceCount).toBe(1);
      expect(result.slides).toHaveLength(1);

      const slide = result.slides[0]!;
      expect(slide).toBeInstanceOf(Buffer);
      expect(slide.length).toBeGreaterThan(1000);

      // PNG magic bytes
      expect(slide[0]).toBe(0x89);
      expect(slide[1]).toBe(0x50); // P
      expect(slide[2]).toBe(0x4e); // N
      expect(slide[3]).toBe(0x47); // G
    },
    120_000,
  );

  it(
    "renders edge-min fixture (EN light) without errors",
    async () => {
      const { renderProConVerdict } = await import("../render-server");
      const fixture = PRO_CON_VERDICT_FIXTURES["edge-min"]!;

      const input = proConVerdictInputSchema.parse({
        generated: fixture.generatedContent,
        theme: "light",
        locale: "en",
      });

      const result = await renderProConVerdict(input);
      expect(result.sequenceCount).toBe(1);
      expect(result.slides).toHaveLength(1);
    },
    120_000,
  );

  it(
    "renders edge-max fixture (DE dark) without overflow errors",
    async () => {
      const { renderProConVerdict } = await import("../render-server");
      const fixture = PRO_CON_VERDICT_FIXTURES["edge-max"]!;

      const input = proConVerdictInputSchema.parse({
        generated: fixture.generatedContent,
        theme: "dark",
        locale: "de",
      });

      const result = await renderProConVerdict(input);
      expect(result.slides).toHaveLength(1);
    },
    120_000,
  );
});
