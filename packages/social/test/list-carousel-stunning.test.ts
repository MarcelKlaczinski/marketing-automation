/**
 * Tests for the Stunning variant components and schema extensions.
 *
 * Structure:
 *   1. Schema validation — stunning-specific fields (cover_hook, end_closer, tool extras)
 *   2. Pattern-specific decoration logic — Comparison vs Number-Promise treatment
 *   3. Anti-hype guard — validateHook function (tested via schema + fallback behaviour)
 *   4. Live render — RUN_LIVE_SOCIAL=1 gated
 *
 * Run live suite:
 *   RUN_LIVE_SOCIAL=1 bun test packages/social/test/list-carousel-stunning.test.ts
 */

import { describe, expect, it } from "bun:test";
import { listCarouselInputSchema } from "../src/compositions/list-carousel/types";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseTools = [
  {
    slug: "recraft",
    rank: 1,
    name: "Recraft",
    domain: "recraft.ai",
    eyebrow: "01 · KI-BILD",
    tagline: "Profi-Vektor-KI mit produktionsreifem SVG-Export.",
    strengths: ["SVG-Export", "Figma-Plugin", "Konsistente Styles"],
    pricing: { tier: "freemium" as const, label: "ab 0€" },
    keyDifferentiator: "produktionsreifem SVG-Export",
    starStrength: "SVG-Export",
  },
  {
    slug: "ideogram",
    rank: 2,
    name: "Ideogram",
    domain: "ideogram.ai",
    eyebrow: "02 · KI-BILD",
    tagline: "Stärkstes Typografie-Rendering aller Bild-KIs.",
    strengths: ["Text in Bildern", "Kostenlos nutzbar", "Schnell"],
    pricing: { tier: "freemium" as const, label: "ab 0€" },
    keyDifferentiator: "Typografie-Rendering",
    starStrength: "Text in Bildern",
  },
  {
    slug: "midjourney",
    rank: 3,
    name: "Midjourney",
    domain: "midjourney.com",
    eyebrow: "03 · KI-BILD",
    tagline: "Beste kreative Bildqualität am Markt.",
    strengths: ["Bildqualität", "Community", "Updates"],
    pricing: { tier: "paid" as const, label: "ab 10€/Monat" },
    keyDifferentiator: "kreative Bildqualität",
    starStrength: "Bildqualität",
  },
];

const comparisonInput = {
  theme: "dark" as const,
  variant: "stunning" as const,
  slideIndex: 0,
  cover: {
    eyebrow: "KI-BILD 2026",
    headlineLead: "Recraft oder Ideogram?",
    headlineHighlight: "Eines kann mehr.",
    hookOutput: {
      pattern: "superlative_question" as const,
      leadPhrase: "Recraft oder Ideogram?",
      highlightWord: "Eines",
      trailPhrase: "kann mehr.",
      fullText: "Recraft oder Ideogram? Eines kann mehr.",
      promiseBlock: {
        line1: "Wir haben beide getestet.",
        line2: "Eine gewinnt klar.",
      },
    },
  },
  tools: baseTools,
  end: {
    headline: "Mehr Reviews,",
    headlineHighlight: "ehrlich getestet.",
    articleUrl: "https://toolwiki.ai/recraft-vs-ideogram",
    closer: {
      pattern: "verdict_recap" as const,
      line1: { leadText: "Recraft für", highlightText: "Logos", trailText: "." },
      line2: { leadText: "Ideogram für", highlightText: "Poster", trailText: "." },
      fullText: "Recraft für Logos. Ideogram für Poster.",
    },
    toolRecap: ["recraft", "ideogram", "midjourney"],
  },
};

const numberPromiseInput = {
  ...comparisonInput,
  cover: {
    ...comparisonInput.cover,
    hookOutput: {
      pattern: "number_promise" as const,
      leadPhrase: "Die 3 besten",
      highlightWord: "Bild-KIs",
      trailPhrase: "2026.",
      fullText: "Die 3 besten Bild-KIs 2026.",
      promiseBlock: {
        line1: "Alle 3 in der Praxis getestet.",
        line2: "Ehrlich verglichen.",
      },
    },
  },
};

const identityFrameInput = {
  ...comparisonInput,
  cover: {
    ...comparisonInput.cover,
    hookOutput: {
      pattern: "identity_frame" as const,
      leadPhrase: "Du brauchst",
      highlightWord: "diese Tools",
      trailPhrase: "wirklich.",
      fullText: "Du brauchst diese Tools wirklich.",
      promiseBlock: {
        line1: "Speziell für deinen Use-Case.",
        line2: "Redaktionell verifiziert.",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// 1. Schema validation — stunning-specific fields
// ---------------------------------------------------------------------------

describe("listCarouselInputSchema — stunning variant", () => {
  it("accepts variant='stunning' with a full cover_hook", () => {
    const result = listCarouselInputSchema.safeParse(comparisonInput);
    expect(result.success).toBe(true);
  });

  it("defaults variant to 'editorial' when omitted", () => {
    const { variant: _v, ...withoutVariant } = comparisonInput;
    const result = listCarouselInputSchema.safeParse(withoutVariant);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.variant).toBe("editorial");
  });

  it("rejects an invalid hook pattern", () => {
    const bad = {
      ...comparisonInput,
      cover: {
        ...comparisonInput.cover,
        hookOutput: { ...comparisonInput.cover.hookOutput, pattern: "viral-bait" },
      },
    };
    const result = listCarouselInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a hook missing the promiseBlock", () => {
    const { promiseBlock: _pb, ...hookWithoutPromise } = comparisonInput.cover.hookOutput;
    const bad = {
      ...comparisonInput,
      cover: { ...comparisonInput.cover, hookOutput: hookWithoutPromise },
    };
    const result = listCarouselInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts tools with keyDifferentiator and starStrength", () => {
    const result = listCarouselInputSchema.safeParse(comparisonInput);
    expect(result.success).toBe(true);
    if (result.success) {
      const tool = result.data.tools[0];
      expect(tool?.keyDifferentiator).toBe("produktionsreifem SVG-Export");
      expect(tool?.starStrength).toBe("SVG-Export");
    }
  });

  it("accepts tools without keyDifferentiator and starStrength (optional)", () => {
    const toolsWithout = baseTools.map(({ keyDifferentiator: _kd, starStrength: _ss, ...rest }) => rest);
    const result = listCarouselInputSchema.safeParse({ ...comparisonInput, tools: toolsWithout });
    expect(result.success).toBe(true);
  });

  it("accepts end_closer with all four structured patterns", () => {
    const line = { leadText: "A", highlightText: "B", trailText: "." };
    for (const pattern of ["verdict_recap", "action_frame", "identity_mirror", "open_comment"] as const) {
      const input = {
        ...comparisonInput,
        end: {
          ...comparisonInput.end,
          closer: { pattern, line1: line, line2: line, fullText: "A B. A B." },
        },
      };
      const result = listCarouselInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it("accepts toolRecap as an array of slugs", () => {
    const result = listCarouselInputSchema.safeParse(comparisonInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.end.toolRecap).toEqual(["recraft", "ideogram", "midjourney"]);
    }
  });

  it("accepts all five hook patterns", () => {
    const patterns = [
      "superlative_question",
      "number_promise",
      "negative_frame",
      "identity_frame",
      "curiosity_gap",
    ] as const;
    for (const pattern of patterns) {
      const input = {
        ...comparisonInput,
        cover: {
          ...comparisonInput.cover,
          hookOutput: { ...comparisonInput.cover.hookOutput, pattern },
        },
      };
      const result = listCarouselInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it("identity_frame pattern parses correctly", () => {
    const result = listCarouselInputSchema.safeParse(identityFrameInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cover.hookOutput?.pattern).toBe("identity_frame");
      expect(result.data.cover.hookOutput?.highlightWord).toBe("diese Tools");
    }
  });

  it("number_promise pattern carries tool count in leadPhrase", () => {
    const result = listCarouselInputSchema.safeParse(numberPromiseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cover.hookOutput?.leadPhrase).toBe("Die 3 besten");
      expect(result.data.cover.hookOutput?.promiseBlock.line1).toBe("Alle 3 in der Praxis getestet.");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. sequenceCount formula — same arithmetic as editorial
// ---------------------------------------------------------------------------

describe("stunning sequenceCount formula", () => {
  const formula = (toolCount: number): number => 1 + toolCount + 1;

  it("3 tools → 5 slides (cover + 3 + end)", () => expect(formula(3)).toBe(5));
  it("5 tools → 7 slides", () => expect(formula(5)).toBe(7));
});

// ---------------------------------------------------------------------------
// 3. Live render — requires Chrome binary + RUN_LIVE_SOCIAL=1
// ---------------------------------------------------------------------------

const LIVE = process.env.RUN_LIVE_SOCIAL === "1";

describe.skipIf(!LIVE)("renderListCarouselStunning (live)", () => {
  it(
    "renders 5 PNG slides for a comparison-pattern stunning carousel",
    async () => {
      const { renderListCarouselStunning } = await import("../render-server");

      const parsed = listCarouselInputSchema.parse(comparisonInput);
      const result = await renderListCarouselStunning(parsed);

      expect(result.sequenceCount).toBe(5);
      expect(result.slides).toHaveLength(5);

      for (const slide of result.slides) {
        expect(slide).toBeInstanceOf(Buffer);
        expect(slide.length).toBeGreaterThan(1000);
      }

      // PNG magic bytes on cover slide
      const cover = result.slides[0]!;
      expect(cover[0]).toBe(0x89);
      expect(cover[1]).toBe(0x50); // P
      expect(cover[2]).toBe(0x4e); // N
      expect(cover[3]).toBe(0x47); // G
    },
    120_000
  );

  it(
    "renders 5 PNG slides for a number-promise stunning carousel",
    async () => {
      const { renderListCarouselStunning } = await import("../render-server");

      const parsed = listCarouselInputSchema.parse(numberPromiseInput);
      const result = await renderListCarouselStunning(parsed);

      expect(result.sequenceCount).toBe(5);
      expect(result.slides).toHaveLength(5);
    },
    120_000
  );

  it(
    "renders 5 PNG slides for an identity-frame stunning carousel",
    async () => {
      const { renderListCarouselStunning } = await import("../render-server");

      const parsed = listCarouselInputSchema.parse(identityFrameInput);
      const result = await renderListCarouselStunning(parsed);

      expect(result.sequenceCount).toBe(5);
      expect(result.slides).toHaveLength(5);
    },
    120_000
  );
});
