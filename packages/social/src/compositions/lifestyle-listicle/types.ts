/**
 * Spec 65.8 — `lifestyle-listicle` Family-B carousel input schema.
 *
 * 6-slide listicle (spec §3.2):
 *   slide 0 — Cover (hook from `pickHook` + `renderHook`)
 *   slide 1 — Intro (scene-setting beat, gradient-only)
 *   slide 2 — Item #1 (lifestyle use-case A with tool mention, photographic)
 *   slide 3 — Item #2 (lifestyle use-case B with tool mention, photographic)
 *   slide 4 — Item #3 (lifestyle use-case C with tool mention, photographic)
 *   slide 5 — End slide (`<HostSlide>` opt-in via endSlideData)
 *
 * Per spec §3.7 Option γ: 4 image slides (Cover + 3 Items), 1 gradient slide
 * (Intro), 1 end slide. Cover uses split-layout `cover` variant; Items use
 * `product-context` (70% bg + brand-color overlay — strong product framing).
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

/**
 * The LLM emits text under `## <beatName>` headers; `splitNarrativeByBeats`
 * parses them back. Cover + End slides are NOT in the LLM output.
 */
export const LIFESTYLE_LISTICLE_BEATS = ["intro", "item1", "item2", "item3"] as const;

export type LifestyleListicleBeat = (typeof LIFESTYLE_LISTICLE_BEATS)[number];

// ─── Narrative payload (LLM-generated) ────────────────────────────────────────

/**
 * 4 beats: 1 intro + 3 items. Each item-beat highlights a different
 * lifestyle angle for the featured tool (e.g. "Morgens", "Pendelweg",
 * "Abends" — the LLM picks the angles). Variable-verbatim refinement is
 * looser than story-arc: only the intro MUST mention hook variables;
 * items can omit them since each item names the tool explicitly.
 */
export const lifestyleListicleNarrativeSchema = z
  .object({
    intro: familyBNarrativeBeatSchema,
    item1: familyBNarrativeBeatSchema,
    item2: familyBNarrativeBeatSchema,
    item3: familyBNarrativeBeatSchema,
  })
  .strict();

export type LifestyleListicleNarrative = z.infer<typeof lifestyleListicleNarrativeSchema>;

// ─── Composition input schema ─────────────────────────────────────────────────

export const lifestyleListicleInputSchema = z
  .object({
    slideIndex: z.number().int().min(0).default(0),
    slideTotal: z.number().int().min(1).default(6),
    hook: familyBHookSchema,
    narrative: lifestyleListicleNarrativeSchema,
    /**
     * Tool featured across all 3 items. Lifestyle-listicle is single-tool
     * (each item shows a different lifestyle context for the same tool),
     * UNLIKE comparison templates which are multi-tool.
     */
    featuredTool: familyBToolMentionSchema,
    end: familyBEndContentSchema,
    images: z.array(familyBImageSchema).max(6).default([]),
  })
  .merge(familyBCommonInputSchema);

export type LifestyleListicleInput = z.infer<typeof lifestyleListicleInputSchema>;

// ─── Generated schema (LLM-output slice for fixture tests) ────────────────────

export const lifestyleListicleGeneratedSchema = z.object({
  narrative: lifestyleListicleNarrativeSchema,
});

export type LifestyleListicleGenerated = z.infer<typeof lifestyleListicleGeneratedSchema>;
