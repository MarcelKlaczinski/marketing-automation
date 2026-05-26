/**
 * Spec 65.8 — `opinion-recommendation` Family-B carousel input schema.
 *
 * 6-slide opinion piece (spec §3.2):
 *   slide 0 — Cover (hook from `pickHook` + `renderHook`)
 *   slide 1 — Hot-Take (bold-statement beat, photographic — strong visual)
 *   slide 2 — Reasoning #1 (analytical beat, gradient-only — text dense)
 *   slide 3 — Reasoning #2 (analytical beat, gradient-only — text dense)
 *   slide 4 — Top-Pick (tool recommendation with inline tool mention, photographic)
 *   slide 5 — End slide
 *
 * Per spec §3.7 Option γ: 3 image slides (Cover + Hot-Take + Top-Pick),
 * 2 gradient slides (Reasoning #1 + #2), 1 end slide. Hot-Take uses the
 * `editorial` variant (split-layout for bold statement), Reasoning uses
 * `immersive` gradient-only (analytical text reads better without a
 * photographic backdrop), Top-Pick uses `product-context` (the
 * recommended tool is the focus).
 */
import { z } from "zod";
import {
  familyBCommonInputSchema,
  familyBEndContentSchema,
  familyBHookSchema,
  familyBImageSchema,
  familyBNarrativeBeatSchema,
  familyBToolMentionSchema,
} from "../_shared/family-b/types.ts";

// ─── Per-beat name mapping ────────────────────────────────────────────────────

export const OPINION_RECOMMENDATION_BEATS = [
  "hotTake",
  "reasoning1",
  "reasoning2",
  "topPick",
] as const;

export type OpinionRecommendationBeat = (typeof OPINION_RECOMMENDATION_BEATS)[number];

// ─── Narrative payload (LLM-generated) ────────────────────────────────────────

/**
 * 4 beats: hot-take + 2 reasoning + top-pick. The hot-take MUST be a
 * declarative opinion statement (no hedging); reasoning beats are the
 * supporting argument; top-pick names the recommended tool verbatim.
 */
export const opinionRecommendationNarrativeSchema = z
  .object({
    hotTake: familyBNarrativeBeatSchema,
    reasoning1: familyBNarrativeBeatSchema,
    reasoning2: familyBNarrativeBeatSchema,
    topPick: familyBNarrativeBeatSchema,
  })
  .strict();

export type OpinionRecommendationNarrative = z.infer<typeof opinionRecommendationNarrativeSchema>;

// ─── Composition input schema ─────────────────────────────────────────────────

export const opinionRecommendationInputSchema = z
  .object({
    slideIndex: z.number().int().min(0).default(0),
    slideTotal: z.number().int().min(1).default(6),
    hook: familyBHookSchema,
    narrative: opinionRecommendationNarrativeSchema,
    /**
     * The recommended tool for the Top-Pick slide. Opinion-recommendation
     * differs from lifestyle-listicle: only ONE slide uses the tool chip
     * (Top-Pick, slide 4) — the Hot-Take + Reasoning slides are tool-
     * agnostic by design (the opinion comes first, the recommendation lands
     * at the end).
     */
    recommendedTool: familyBToolMentionSchema,
    end: familyBEndContentSchema,
    images: z.array(familyBImageSchema).max(6).default([]),
  })
  .merge(familyBCommonInputSchema);

export type OpinionRecommendationInput = z.infer<typeof opinionRecommendationInputSchema>;

// ─── Generated schema (LLM-output slice for fixture tests) ────────────────────

export const opinionRecommendationGeneratedSchema = z.object({
  narrative: opinionRecommendationNarrativeSchema,
});

export type OpinionRecommendationGenerated = z.infer<typeof opinionRecommendationGeneratedSchema>;
