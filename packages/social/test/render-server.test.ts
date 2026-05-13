/**
 * Tests for packages/social/render-server.ts
 *
 * Structure:
 *   1. Input schema validation — fast, no Remotion/Chrome involved
 *   2. sequenceCount formula — pure arithmetic, no imports beyond this file
 *   3. Live render — requires Chrome + env var RUN_LIVE_SOCIAL=1
 *
 * Run the live suite:
 *   RUN_LIVE_SOCIAL=1 bun test packages/social/test/render-server.test.ts
 */

import { describe, expect, it } from "bun:test";
import { listCarouselInputSchema } from "../src/compositions/list-carousel/types.ts";

// ---------------------------------------------------------------------------
// Shared fixture used in schema tests and the live render test
// ---------------------------------------------------------------------------

const minimalInput = {
  theme: "dark" as const,
  slideIndex: 0,
  brandTokens: {
    colors: {
      primary: "oklch(64% 0.16 248)",
      primaryHue: 248,
      accent: "oklch(72% 0.15 168)",
      surface: "#ffffff",
      surfaceDark: "oklch(16% 0.02 250)",
      ink: "oklch(20% 0.025 250)",
      inkMuted: "oklch(45% 0.025 250)",
    },
    typography: {
      fontFamily: "Space Grotesk",
      headingWeight: 700,
      bodyWeight: 400,
      eyebrowLetterSpacing: "0.08em",
    },
    voice: {
      locale: "de-DE",
      addressForm: "du",
      forbiddenWords: [],
      signaturePhrases: [],
    },
    social: {
      instagramHandle: "@test",
      websiteUrl: "test.com",
      logoAssetKey: "main",
    },
  },
  cover: {
    eyebrow: "KI-TOOLS 2026",
    headlineLead: "Die 3 besten",
    headlineHighlight: "KI-Assistenten",
  },
  tools: [
    {
      slug: "chatgpt",
      rank: 1,
      name: "ChatGPT",
      domain: "chat.openai.com",
      eyebrow: "01 · KI-ASSISTENT",
      tagline: "Der bekannteste KI-Chatbot für Texte und Analyse.",
      strengths: ["Vielseitig", "Schnell", "Günstig"],
      pricing: { tier: "freemium" as const, label: "ab $20/Monat" },
    },
    {
      slug: "claude-ai",
      rank: 2,
      name: "Claude",
      domain: "claude.ai",
      eyebrow: "02 · KI-ASSISTENT",
      tagline: "Stärker bei langen Texten und Reasoning.",
      strengths: ["Lange Kontexte", "Sicher", "Analytisch"],
      pricing: { tier: "freemium" as const, label: "ab $20/Monat" },
    },
    {
      slug: "gemini",
      rank: 3,
      name: "Gemini",
      domain: "gemini.google.com",
      eyebrow: "03 · KI-ASSISTENT",
      tagline: "Googles KI mit starker Search-Integration.",
      strengths: ["Google-Integration", "Kostenlos", "Multimodal"],
      pricing: { tier: "free" as const, label: "Kostenlos" },
    },
  ],
  end: {
    headline: "Mehr Reviews,",
    headlineHighlight: "ehrlich getestet.",
    articleUrl: "https://toolwiki.ai/ki-assistenten",
  },
};

// ---------------------------------------------------------------------------
// 1. Input schema validation
// ---------------------------------------------------------------------------

describe("listCarouselInputSchema validation", () => {
  it("accepts a valid dark-theme input with 3 tools", () => {
    const result = listCarouselInputSchema.safeParse(minimalInput);
    expect(result.success).toBe(true);
  });

  it("rejects input missing the tools array", () => {
    const { tools: _tools, ...withoutTools } = minimalInput;
    const result = listCarouselInputSchema.safeParse(withoutTools);
    expect(result.success).toBe(false);
  });

  it("rejects input with an empty tools array (min 3 required)", () => {
    const result = listCarouselInputSchema.safeParse({ ...minimalInput, tools: [] });
    expect(result.success).toBe(false);
  });

  it("rejects input with fewer than 3 tools (min is 3)", () => {
    const result = listCarouselInputSchema.safeParse({
      ...minimalInput,
      tools: minimalInput.tools.slice(0, 2),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tool with an invalid pricing tier", () => {
    const badTool = {
      ...minimalInput.tools[0],
      pricing: { tier: "enterprise", label: "Custom" },
    };
    const result = listCarouselInputSchema.safeParse({
      ...minimalInput,
      tools: [badTool, ...minimalInput.tools.slice(1)],
    });
    expect(result.success).toBe(false);
  });

  it("applies default theme 'dark' when theme is omitted", () => {
    const { theme: _theme, ...withoutTheme } = minimalInput;
    const result = listCarouselInputSchema.safeParse(withoutTheme);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.theme).toBe("dark");
    }
  });

  it("accepts 'light' as a valid theme value", () => {
    const result = listCarouselInputSchema.safeParse({ ...minimalInput, theme: "light" });
    expect(result.success).toBe(true);
  });

  it("rejects a tool whose strengths array is below the minimum of 2", () => {
    const badTool = { ...minimalInput.tools[0], strengths: ["Einziger"] };
    const result = listCarouselInputSchema.safeParse({
      ...minimalInput,
      tools: [badTool, ...minimalInput.tools.slice(1)],
    });
    expect(result.success).toBe(false);
  });

  it("accepts tools with optional fields omitted (iconUrl, bestFor, emoji)", () => {
    // minimalInput tools deliberately omit iconUrl, bestFor, emoji — this should pass
    const result = listCarouselInputSchema.safeParse(minimalInput);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. sequenceCount formula — pure arithmetic (no Remotion)
//
// render-server.ts computes:  totalSlides = 1 + tools.length + 1
// (1 cover slide + N tool slides + 1 end slide)
// ---------------------------------------------------------------------------

describe("sequenceCount formula", () => {
  const formula = (toolCount: number): number => 1 + toolCount + 1;

  it("returns 5 for 3 tools (cover + 3 + end)", () => {
    expect(formula(3)).toBe(5);
  });

  it("returns 7 for 5 tools (cover + 5 + end)", () => {
    expect(formula(5)).toBe(7);
  });

  it("returns 4 for a minimum carousel of 2 tool slots", () => {
    // Schema enforces min 3 tools, but the formula itself is tool-count-agnostic.
    expect(formula(2)).toBe(4);
  });

  it("returns 12 for the maximum 10 tools (cover + 10 + end)", () => {
    expect(formula(10)).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// 3. Live render — requires Chrome binary + RUN_LIVE_SOCIAL=1
//
// Run with:
//   RUN_LIVE_SOCIAL=1 bun test packages/social/test/render-server.test.ts
//
// This suite is skipped in CI unless the env var is set, because:
//   - bundle() + renderStill() each take 15–30 s
//   - Chrome must be present (installed via postinstall in packages/social)
// ---------------------------------------------------------------------------

const LIVE = process.env.RUN_LIVE_SOCIAL === "1";

describe.skipIf(!LIVE)("renderListCarousel (live render)", () => {
  // Dynamic import so Remotion bundler/renderer are not loaded in fast test runs
  it(
    "renders 5 PNG slides for a 3-tool input and returns correct sequenceCount",
    async () => {
      const { renderListCarousel } = await import("../render-server.ts");

      const result = await renderListCarousel(minimalInput);

      // Shape
      expect(result).toHaveProperty("slides");
      expect(result).toHaveProperty("sequenceCount");

      // sequenceCount must equal 1 + 3 + 1 = 5
      expect(result.sequenceCount).toBe(5);

      // Exactly one Buffer per slide
      expect(result.slides).toHaveLength(5);

      for (const slide of result.slides) {
        // Each slide must be a non-trivial Buffer
        expect(slide).toBeInstanceOf(Buffer);
        expect(slide.length).toBeGreaterThan(1000);
      }

      // First slide must start with PNG magic bytes: 89 50 4E 47
      const cover = result.slides[0];
      expect(cover[0]).toBe(0x89);
      expect(cover[1]).toBe(0x50); // P
      expect(cover[2]).toBe(0x4e); // N
      expect(cover[3]).toBe(0x47); // G
    },
    120_000 // 2-minute timeout for bundle + 5 renderStill calls
  );
});
