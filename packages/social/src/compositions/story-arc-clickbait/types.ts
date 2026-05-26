/**
 * Spec 65.8 — `story-arc-clickbait` Family-B carousel input schema.
 *
 * 7-slide narrative arc (spec §3.2):
 *   slide 0 — Cover (hook from `pickHook` + `renderHook`, no LLM at render)
 *   slide 1 — Setup (scene-setting beat, gradient-only)
 *   slide 2 — Conflict (tension beat, photographic)
 *   slide 3 — Resolution (breakthrough beat with tool mention, photographic)
 *   slide 4 — Payoff (transformation beat, photographic)
 *   slide 5 — Lesson (reflection beat, gradient-only)
 *   slide 6 — End slide (CTA, `<HostSlide>` opt-in via endSlideData)
 *
 * Per spec §3.7 Option γ: 4 image slides (Cover/Conflict/Resolution/Payoff),
 * 2 gradient-only slides (Setup/Lesson). The Cover image is part of the
 * split-layout `cover` variant; the inner narrative slides use `immersive`.
 *
 * Photographic backgrounds come from `articles.domain_extras.familyBImages[]`
 * (populated by the photographic-pipeline orchestrator BEFORE render time).
 * Slides without a matching entry fall back to the gradient surface.
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

// ─── Per-slide-index canonical beat name ──────────────────────────────────────

/**
 * Beat-name ↔ slideIndex mapping. The narrative LLM emits text under
 * `## <beatName>` headers; `splitNarrativeByBeats(narrative, BEAT_NAMES)`
 * parses it back. Cover + End slides are NOT in the LLM output (Cover uses
 * the rendered hook; End is a CTA template).
 */
export const STORY_ARC_BEATS = ["setup", "conflict", "resolution", "payoff", "lesson"] as const;

export type StoryArcBeat = (typeof STORY_ARC_BEATS)[number];

// ─── Narrative payload (LLM-generated, validated post-split) ──────────────────

/**
 * The full 5-beat narrative after splitting. Each beat lines up with a
 * specific slide; missing beats fall back to gradient-only with empty text.
 * Variable-verbatim refinement (Pattern §3.3 Option γ): every beat-text MUST
 * include the hook's `profession`/`lifeArea` variables at least once for
 * narrative cohesion. Refinement runs in `validateStoryArcNarrative()` after
 * Zod parse so the failure mode is visible (caller re-prompts or falls back).
 */
export const storyArcNarrativeSchema = z
  .object({
    setup: familyBNarrativeBeatSchema,
    conflict: familyBNarrativeBeatSchema,
    resolution: familyBNarrativeBeatSchema,
    payoff: familyBNarrativeBeatSchema,
    lesson: familyBNarrativeBeatSchema,
  })
  .strict();

export type StoryArcNarrative = z.infer<typeof storyArcNarrativeSchema>;

// ─── Composition input schema ─────────────────────────────────────────────────

export const storyArcClickbaitInputSchema = z
  .object({
    /** Which slide to render. Worker calls `renderStill` once per slideIndex. */
    slideIndex: z.number().int().min(0).default(0),
    /** Total slides — `7` is canonical but kept flexible for future variants. */
    slideTotal: z.number().int().min(1).default(7),
    /** Hook context + variables (used on Cover + as variable-verbatim refinement source). */
    hook: familyBHookSchema,
    /** 5 narrative beats (slides 1–5). */
    narrative: storyArcNarrativeSchema,
    /**
     * Optional tool mention rendered as an inline chip on Resolution + Payoff
     * slides ("the moment I tried X" / "now my workflow includes X"). Marcel-
     * Decision §0: product-mention in narrative text-flow, NOT a dedicated
     * tool slide.
     */
    primaryTool: familyBToolMentionSchema.optional(),
    /** Inline end-slide content (used when no `endSlideData` is set). */
    end: familyBEndContentSchema,
    /**
     * Photographic backgrounds. Keyed by `slideIndex` so the dispatcher can
     * look up the entry for the current slide in O(N) (N ≤ 7).
     */
    images: z.array(familyBImageSchema).max(7).default([]),
  })
  .merge(familyBCommonInputSchema);

export type StoryArcClickbaitInput = z.infer<typeof storyArcClickbaitInputSchema>;

// ─── Generated schema (LLM-output slice for fixture tests) ────────────────────

/**
 * Slice of the input that comes from the LLM call. Used by
 * `fixtures-respect-bounds.test.ts` (Spec 59.3.5 dual-schema convention).
 * Cover hook is NOT here — it comes from `pickHook` + `renderHook`
 * (Spec 65.4) at brief-generation time, not from the per-render LLM call.
 */
export const storyArcClickbaitGeneratedSchema = z.object({
  narrative: storyArcNarrativeSchema,
});

export type StoryArcClickbaitGenerated = z.infer<typeof storyArcClickbaitGeneratedSchema>;
