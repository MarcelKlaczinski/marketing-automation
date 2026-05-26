/**
 * Spec 65.8 — lifestyle-listicle Zod schema tests.
 */
import { describe, expect, it } from "bun:test";
import {
  LIFESTYLE_LISTICLE_BEATS,
  lifestyleListicleInputSchema,
  lifestyleListicleNarrativeSchema,
} from "../../../src/compositions/lifestyle-listicle/types.ts";

const VALID_NARRATIVE = {
  intro: { beatName: "intro", text: "Als Texter integriere ich ChatGPT in 3 Alltagsmomente." },
  item1: { beatName: "item1", text: "Morgens: ChatGPT drafted Tasks während ich den Kaffee koche." },
  item2: { beatName: "item2", text: "Im Job: ChatGPT pairs mit mir bei den Texten für Kunden." },
  item3: { beatName: "item3", text: "Unerwartet: ChatGPT hilft mir Geburtstagstexte zu schreiben." },
};

describe("LIFESTYLE_LISTICLE_BEATS", () => {
  it("declares exactly 4 beats in canonical order", () => {
    expect(LIFESTYLE_LISTICLE_BEATS).toEqual(["intro", "item1", "item2", "item3"]);
  });
});

describe("lifestyleListicleNarrativeSchema", () => {
  it("accepts a valid 4-beat narrative", () => {
    const result = lifestyleListicleNarrativeSchema.safeParse(VALID_NARRATIVE);
    expect(result.success).toBe(true);
  });

  it("rejects missing beats", () => {
    const { item3, ...partial } = VALID_NARRATIVE;
    void item3;
    expect(lifestyleListicleNarrativeSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects unknown beat keys (strict)", () => {
    const result = lifestyleListicleNarrativeSchema.safeParse({
      ...VALID_NARRATIVE,
      bonus: { beatName: "bonus", text: "Extra beat that shouldn't pass strict." },
    });
    expect(result.success).toBe(false);
  });
});

describe("lifestyleListicleInputSchema", () => {
  const VALID_INPUT = {
    slideIndex: 0,
    slideTotal: 6,
    theme: "dark" as const,
    locale: "de" as const,
    hook: {
      rendered: "3 Momente mit ChatGPT",
      variables: { profession: "Texter", lifeArea: "Alltag" },
    },
    narrative: VALID_NARRATIVE,
    featuredTool: { slug: "chatgpt", name: "ChatGPT" },
    end: {
      headlineLead: "Mehr Lifestyle-KI",
      headlineEm: "ehrlich erprobt.",
      articleUrl: "toolwiki.ai/chatgpt-alltag",
      ctaLine: "Mehr Geschichten →",
    },
  };

  it("parses a valid full input", () => {
    expect(lifestyleListicleInputSchema.safeParse(VALID_INPUT).success).toBe(true);
  });

  it("defaults slideTotal to 6", () => {
    const { slideTotal, ...partial } = VALID_INPUT;
    void slideTotal;
    expect(lifestyleListicleInputSchema.parse(partial).slideTotal).toBe(6);
  });

  it("defaults images to empty array", () => {
    expect(lifestyleListicleInputSchema.parse(VALID_INPUT).images).toEqual([]);
  });

  it("rejects more than 6 images", () => {
    const result = lifestyleListicleInputSchema.safeParse({
      ...VALID_INPUT,
      images: Array.from({ length: 7 }, (_, i) => ({
        slideIndex: i,
        cdnUrl: `https://cdn.example.com/img-${i}.webp`,
      })),
    });
    expect(result.success).toBe(false);
  });

  it("requires featuredTool", () => {
    const { featuredTool, ...partial } = VALID_INPUT;
    void featuredTool;
    expect(lifestyleListicleInputSchema.safeParse(partial).success).toBe(false);
  });
});
