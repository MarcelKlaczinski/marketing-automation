/**
 * Spec 65.8 — story-arc-clickbait Zod schema tests.
 */
import { describe, expect, it } from "bun:test";
import {
  STORY_ARC_BEATS,
  storyArcClickbaitInputSchema,
  storyArcNarrativeSchema,
} from "../../../src/compositions/story-arc-clickbait/types.ts";

const VALID_NARRATIVE = {
  setup: { beatName: "setup", text: "Als Texter saß ich täglich am Schreibtisch und arbeitete an meinem Job." },
  conflict: { beatName: "conflict", text: "Dann kam KI in meinen Job und alles änderte sich für mich als Texter." },
  resolution: { beatName: "resolution", text: "Ich entschied mich, KI in meinen Texter-Workflow einzubauen statt sie zu fürchten." },
  payoff: { beatName: "payoff", text: "Heute spare ich Stunden täglich und mein Texter-Job ist sicherer denn je." },
  lesson: { beatName: "lesson", text: "Dein Job überlebt — wenn dein Urteilsvermögen das Produkt wird, nicht deine Tippfertigkeit." },
};

describe("STORY_ARC_BEATS", () => {
  it("declares exactly 5 beats in canonical order", () => {
    expect(STORY_ARC_BEATS).toEqual(["setup", "conflict", "resolution", "payoff", "lesson"]);
  });
});

describe("storyArcNarrativeSchema", () => {
  it("accepts a valid 5-beat narrative", () => {
    const result = storyArcNarrativeSchema.safeParse(VALID_NARRATIVE);
    expect(result.success).toBe(true);
  });

  it("rejects missing beats", () => {
    const { setup, ...partial } = VALID_NARRATIVE;
    void setup; // intentional discard
    const result = storyArcNarrativeSchema.safeParse(partial);
    expect(result.success).toBe(false);
  });

  it("rejects unknown beat keys (strict)", () => {
    const result = storyArcNarrativeSchema.safeParse({
      ...VALID_NARRATIVE,
      bonus: { beatName: "bonus", text: "Extra beat that shouldn't pass strict." },
    });
    expect(result.success).toBe(false);
  });

  it("rejects beat text below 20-char minimum", () => {
    const result = storyArcNarrativeSchema.safeParse({
      ...VALID_NARRATIVE,
      setup: { beatName: "setup", text: "too short" },
    });
    expect(result.success).toBe(false);
  });
});

describe("storyArcClickbaitInputSchema", () => {
  const VALID_INPUT = {
    slideIndex: 0,
    slideTotal: 7,
    theme: "dark" as const,
    locale: "de" as const,
    hook: {
      rendered: "Wie ich als Texter meinen Job mit KI gerettet habe",
      variables: { profession: "Texter", lifeArea: "Job" },
    },
    narrative: VALID_NARRATIVE,
    end: {
      headlineLead: "Mehr Geschichten",
      headlineEm: "ehrlich erzählt.",
      articleUrl: "toolwiki.ai/wie-texter-ki",
      ctaLine: "Vollständige Story →",
    },
  };

  it("parses a valid full input", () => {
    const result = storyArcClickbaitInputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it("applies slideTotal default of 7 when omitted", () => {
    const { slideTotal, ...partial } = VALID_INPUT;
    void slideTotal;
    const result = storyArcClickbaitInputSchema.parse(partial);
    expect(result.slideTotal).toBe(7);
  });

  it("defaults images to empty array (gradient-only fallback)", () => {
    const result = storyArcClickbaitInputSchema.parse(VALID_INPUT);
    expect(result.images).toEqual([]);
  });

  it("accepts up to 7 image entries", () => {
    const result = storyArcClickbaitInputSchema.safeParse({
      ...VALID_INPUT,
      images: Array.from({ length: 7 }, (_, i) => ({
        slideIndex: i,
        cdnUrl: `https://cdn.example.com/img-${i}.webp`,
        photographer: "Jane Doe",
      })),
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 7 images", () => {
    const result = storyArcClickbaitInputSchema.safeParse({
      ...VALID_INPUT,
      images: Array.from({ length: 8 }, (_, i) => ({
        slideIndex: i,
        cdnUrl: `https://cdn.example.com/img-${i}.webp`,
      })),
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional primaryTool", () => {
    const result = storyArcClickbaitInputSchema.parse({
      ...VALID_INPUT,
      primaryTool: { slug: "chatgpt", name: "ChatGPT", iconInitials: "GP", iconHue: 160 },
    });
    expect(result.primaryTool?.name).toBe("ChatGPT");
  });
});
