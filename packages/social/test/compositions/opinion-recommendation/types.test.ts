/**
 * Spec 65.8 — opinion-recommendation Zod schema tests.
 */
import { describe, expect, it } from "bun:test";
import {
  OPINION_RECOMMENDATION_BEATS,
  opinionRecommendationInputSchema,
  opinionRecommendationNarrativeSchema,
} from "../../../src/compositions/opinion-recommendation/types.ts";

const VALID_NARRATIVE = {
  hotTake: { beatName: "hotTake", text: "Die meisten benutzen KI-Tools wie eine Suchmaschine. Falsch." },
  reasoning1: { beatName: "reasoning1", text: "Erstens: Suche ist nicht Denken — Prompts strukturieren Gedanken." },
  reasoning2: { beatName: "reasoning2", text: "Zweitens: Drei Wochen sind das Minimum, um den Workflow zu kalibrieren." },
  topPick: { beatName: "topPick", text: "Meine Empfehlung: Claude — weil es zum strukturierten Denken zwingt." },
};

describe("OPINION_RECOMMENDATION_BEATS", () => {
  it("declares exactly 4 beats in canonical order", () => {
    expect(OPINION_RECOMMENDATION_BEATS).toEqual([
      "hotTake",
      "reasoning1",
      "reasoning2",
      "topPick",
    ]);
  });
});

describe("opinionRecommendationNarrativeSchema", () => {
  it("accepts a valid 4-beat narrative", () => {
    expect(opinionRecommendationNarrativeSchema.safeParse(VALID_NARRATIVE).success).toBe(true);
  });

  it("rejects missing beats", () => {
    const { reasoning2, ...partial } = VALID_NARRATIVE;
    void reasoning2;
    expect(opinionRecommendationNarrativeSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects unknown beat keys (strict)", () => {
    const result = opinionRecommendationNarrativeSchema.safeParse({
      ...VALID_NARRATIVE,
      bonus: { beatName: "bonus", text: "Extra beat shouldn't pass strict." },
    });
    expect(result.success).toBe(false);
  });
});

describe("opinionRecommendationInputSchema", () => {
  const VALID_INPUT = {
    slideIndex: 0,
    slideTotal: 6,
    theme: "dark" as const,
    locale: "de" as const,
    hook: {
      rendered: "Die meisten Texter benutzen ChatGPT falsch",
      variables: { profession: "Texter", lifeArea: "Workflow" },
    },
    narrative: VALID_NARRATIVE,
    recommendedTool: { slug: "claude", name: "Claude" },
    end: {
      headlineLead: "Mehr Meinungen",
      headlineEm: "ehrlich begründet.",
      articleUrl: "toolwiki.ai/texter-chatgpt-falsch",
      ctaLine: "Vollständige Analyse →",
    },
  };

  it("parses a valid full input", () => {
    expect(opinionRecommendationInputSchema.safeParse(VALID_INPUT).success).toBe(true);
  });

  it("defaults slideTotal to 6", () => {
    const { slideTotal, ...partial } = VALID_INPUT;
    void slideTotal;
    expect(opinionRecommendationInputSchema.parse(partial).slideTotal).toBe(6);
  });

  it("requires recommendedTool", () => {
    const { recommendedTool, ...partial } = VALID_INPUT;
    void recommendedTool;
    expect(opinionRecommendationInputSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects more than 6 images", () => {
    const result = opinionRecommendationInputSchema.safeParse({
      ...VALID_INPUT,
      images: Array.from({ length: 7 }, (_, i) => ({
        slideIndex: i,
        cdnUrl: `https://cdn.example.com/img-${i}.webp`,
      })),
    });
    expect(result.success).toBe(false);
  });
});
