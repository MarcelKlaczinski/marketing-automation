/**
 * Spec 60.1 Session 1 — schema unit tests.
 *
 * Verifies that the rewritten types.ts schemas accept valid data and
 * reject invalid data, and that the composition fixture shapes are valid.
 */

import { describe, expect, it } from "bun:test";
import {
  coverPropsSchema,
  spotlightBodyPropsSchema,
  singleToolSpotlightInputSchema,
} from "../src/compositions/single-tool-spotlight/types";
import {
  SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES,
} from "../src/templates/definitions/fixtures/singleToolSpotlight.fixtures";

// Reusable valid cover fixture
const validCover = {
  eyebrow: "Guides & Tutorials",
  headerNum: "Cluster: Bild-KI · Intro",
  heroTitle: "Bild-KI 2026",
  kicker:
    "Marktübersicht, Modelle und der ehrliche Profi-Workflow nach drei Jahren Praxis.",
  toolLogos: [
    { src: "/a.svg", alt: "Midjourney" },
    { src: "/b.svg", alt: "Flux" },
    { src: "/c.svg", alt: "DALL-E" },
  ],
  toolsMoreText: "+ 4 weitere",
  stats: [
    { value: "4", label: "Schulen der Bild-KI" },
    { value: "9", label: "Tools im Vergleich" },
    { value: "50k", label: "Generierungen getestet" },
  ],
  byline: {
    initials: "SR",
    name: "Sophie Renner",
    role: "Editorin · Visual & Bild-KI",
    readTime: "13 Min Lesen",
  },
  swipeText: "Swipe für den Vergleich",
  footer: {
    ctaLine: "Zum Artikel →",
    url: "toolwiki.ai/bilder",
  },
} as const;

// Reusable valid body fixture
const validBody = {
  eyebrow: "Deep Dive · Tool-Portrait",
  headerNum: "Test 04/2026 · 50k+ Generierungen",
  slideIndex: 1,
  slideTotal: 3,
  tool: {
    logo: "",
    name: "Midjourney",
    version: "v7 · Premium-Ästhetik",
    isLive: true,
  },
  verdictQuote:
    "Für Hero-Visuals und Mood-Boards 2026 immer noch ungeschlagen.",
  score: 92,
  scoreLabel: "Top Aesthetic",
  facts: [
    { key: "Pricing", value: "Ab 10 $/Mo" },
    { key: "Standard", value: "30 $ · 15h GPU" },
    { key: "Für wen", value: "Marketing" },
    { key: "Commercial", value: "Ab Basic" },
  ],
  strengths: [
    "Ästhetik out-of-the-box auf Stockfoto-Niveau.",
    "--sref für konsistenten Brand-Look.",
    "Subtile Hauttöne, anspruchsvolles Licht.",
  ],
  weaknesses: [
    "Text im Bild bleibt schwach (→ Ideogram).",
    "Schwer aus dem MJ-Look auszubrechen.",
    "--cref max. 85 % Charakter-Ähnlichkeit.",
  ],
  footer: {
    ctaLine: "Vollständiger Test →",
    url: "toolwiki.ai/midjourney",
  },
} as const;

describe("coverPropsSchema", () => {
  it("accepts a valid cover", () => {
    expect(() => coverPropsSchema.parse(validCover)).not.toThrow();
  });

  it("rejects empty object", () => {
    expect(() => coverPropsSchema.parse({})).toThrow();
  });

  it("rejects eyebrow below min (7 chars)", () => {
    expect(() =>
      coverPropsSchema.parse({ ...validCover, eyebrow: "Short" }),
    ).toThrow();
  });

  it("rejects eyebrow above max (29 chars)", () => {
    expect(() =>
      coverPropsSchema.parse({ ...validCover, eyebrow: "A".repeat(29) }),
    ).toThrow();
  });

  it("rejects toolLogos below min (empty array)", () => {
    // min is 1 since Spec 60.1 — single-tool spotlight has exactly one logo
    expect(() =>
      coverPropsSchema.parse({
        ...validCover,
        toolLogos: [],
      }),
    ).toThrow();
  });

  it("rejects stats with wrong length (2 entries)", () => {
    expect(() =>
      coverPropsSchema.parse({
        ...validCover,
        stats: [
          { value: "4", label: "Schulen der Bild-KI" },
          { value: "9", label: "Tools im Vergleich" },
        ],
      }),
    ).toThrow();
  });

  it("rejects byline.initials not exactly 2 chars", () => {
    expect(() =>
      coverPropsSchema.parse({
        ...validCover,
        byline: { ...validCover.byline, initials: "SRX" },
      }),
    ).toThrow();
  });

  it("allows optional updateBadge to be absent", () => {
    const { updateBadge: _, ...withoutBadge } = { ...validCover, updateBadge: "Stand: Mai 2026" };
    expect(() => coverPropsSchema.parse(withoutBadge)).not.toThrow();
  });

  it("rejects updateBadge below min when present", () => {
    expect(() =>
      coverPropsSchema.parse({ ...validCover, updateBadge: "kurz" }),
    ).toThrow();
  });
});

describe("spotlightBodyPropsSchema", () => {
  it("accepts a valid body", () => {
    expect(() => spotlightBodyPropsSchema.parse(validBody)).not.toThrow();
  });

  it("rejects empty object", () => {
    expect(() => spotlightBodyPropsSchema.parse({})).toThrow();
  });

  it("rejects verdictQuote below min (39 chars)", () => {
    expect(() =>
      spotlightBodyPropsSchema.parse({
        ...validBody,
        verdictQuote: "Zu kurz für einen Verdict-Satz hier.",
      }),
    ).toThrow();
  });

  it("rejects strengths with only 2 items (min = 3)", () => {
    expect(() =>
      spotlightBodyPropsSchema.parse({
        ...validBody,
        strengths: [
          "Ästhetik out-of-the-box auf Stockfoto-Niveau.",
          "--sref für konsistenten Brand-Look hier.",
        ],
      }),
    ).toThrow();
  });

  it("rejects strengths with 5 items (max = 4)", () => {
    expect(() =>
      spotlightBodyPropsSchema.parse({
        ...validBody,
        strengths: [
          "Ästhetik out-of-the-box auf Stockfoto-Niveau.",
          "--sref für konsistenten Brand-Look hier.",
          "Subtile Hauttöne, anspruchsvolles Licht jetzt.",
          "API seit v6.1 für Studio-Pipelines verfügbar.",
          "Niji-Modus für Anime-Ästhetik sehr gut.",
        ],
      }),
    ).toThrow();
  });

  it("rejects facts with 3 items (must be exactly 4)", () => {
    expect(() =>
      spotlightBodyPropsSchema.parse({
        ...validBody,
        facts: [
          { key: "Pricing", value: "Ab 10 $/Mo" },
          { key: "Standard", value: "30 $ · GPU" },
          { key: "Für wen", value: "Marketing" },
        ],
      }),
    ).toThrow();
  });

  it("rejects score above 99", () => {
    expect(() =>
      spotlightBodyPropsSchema.parse({ ...validBody, score: 100 }),
    ).toThrow();
  });

  it("rejects tool.name below min (3 chars)", () => {
    expect(() =>
      spotlightBodyPropsSchema.parse({
        ...validBody,
        tool: { ...validBody.tool, name: "MJ" },
      }),
    ).toThrow();
  });

  it("rejects tool.name above max (15 chars)", () => {
    expect(() =>
      spotlightBodyPropsSchema.parse({
        ...validBody,
        tool: { ...validBody.tool, name: "TooLongToolName" },
      }),
    ).toThrow();
  });

  it("accepts isLive as optional (absent)", () => {
    const { isLive: _, ...toolWithoutLive } = validBody.tool;
    expect(() =>
      spotlightBodyPropsSchema.parse({ ...validBody, tool: toolWithoutLive }),
    ).not.toThrow();
  });
});

describe("singleToolSpotlightInputSchema", () => {
  it("accepts body-only variant (cover null, end null)", () => {
    expect(() =>
      singleToolSpotlightInputSchema.parse({
        slideIndex: 0,
        slideTotal: 1,
        cover: null,
        body: validBody,
        end: null,
      }),
    ).not.toThrow();
  });

  it("accepts cover-only variant", () => {
    expect(() =>
      singleToolSpotlightInputSchema.parse({
        slideIndex: 0,
        slideTotal: 1,
        cover: validCover,
        body: null,
        end: null,
      }),
    ).not.toThrow();
  });

  it("accepts all-three variant", () => {
    expect(() =>
      singleToolSpotlightInputSchema.parse({
        slideIndex: 1,
        slideTotal: 3,
        cover: validCover,
        body: validBody,
        end: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/midjourney" },
      }),
    ).not.toThrow();
  });

  it("defaults theme to 'dark'", () => {
    const result = singleToolSpotlightInputSchema.parse({
      slideIndex: 0,
      slideTotal: 1,
      cover: null,
      body: validBody,
      end: null,
    });
    expect(result.theme).toBe("dark");
  });

  it("defaults locale to 'de'", () => {
    const result = singleToolSpotlightInputSchema.parse({
      slideIndex: 0,
      slideTotal: 1,
      cover: null,
      body: validBody,
      end: null,
    });
    expect(result.locale).toBe("de");
  });

  it("rejects missing slideIndex", () => {
    expect(() =>
      singleToolSpotlightInputSchema.parse({
        slideTotal: 1,
        cover: null,
        body: validBody,
        end: null,
      }),
    ).toThrow();
  });

  it("rejects invalid theme", () => {
    expect(() =>
      singleToolSpotlightInputSchema.parse({
        slideIndex: 0,
        slideTotal: 1,
        cover: null,
        body: validBody,
        end: null,
        theme: "sepia",
      }),
    ).toThrow();
  });
});

describe("SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES", () => {
  it("characteristic fixture is valid per singleToolSpotlightInputSchema", () => {
    const fixture = SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES.characteristic;
    expect(() => singleToolSpotlightInputSchema.parse(fixture)).not.toThrow();
  });

  it("edge-min fixture is valid per singleToolSpotlightInputSchema", () => {
    const fixture = SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES["edge-min"];
    expect(() => singleToolSpotlightInputSchema.parse(fixture)).not.toThrow();
  });

  it("edge-max fixture is valid per singleToolSpotlightInputSchema", () => {
    const fixture = SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES["edge-max"];
    expect(() => singleToolSpotlightInputSchema.parse(fixture)).not.toThrow();
  });

  it("edge-max has cover populated", () => {
    expect(SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES["edge-max"].cover).not.toBeNull();
  });

  it("characteristic cover is null (body-only fixture)", () => {
    expect(SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES.characteristic.cover).toBeNull();
  });
});
