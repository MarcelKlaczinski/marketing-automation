/**
 * Spec 65.4 — `story_arc_clickbait` format-type (Family B).
 *
 * Hook-driven narrative-arc carousel ("I lost my {profession} job because of
 * {tool}"). The brief-generator (65.5) reads `professionPool + toolToFeature`,
 * asks the 65.4 Hook-Picker for the best LRU-eligible hook pattern, then
 * substitutes the variables. V1 template: `story-arc-clickbait` (65.8 Day 3).
 * The 65.4 spec listed `-dramatic` + `-minimal` as planned variants; V1 ships
 * a single template with `toneIntensity` controlling the narrative register
 * inside one composition (cheaper than two parallel templates; future split
 * is a follow-up if the engagement data justifies it).
 */
import { z } from "zod";
import type { FormatTypeDefinition } from "./registry.ts";

export const storyArcClickbaitConfigSchema = z.object({
  /** Pool of professions to rotate across runs (e.g. ["Texter", "Lehrer", "Designer"]). */
  professionPool: z.array(z.string().min(1)).min(1),
  /** Tool that "caused" the disruption — article-id from `articles WHERE collection='tools'`. */
  toolToFeature: z.string().uuid(),
  /**
   * Narrative framing. `career-disruption` is the canonical AI-replaces-me arc;
   * `productivity-transformation` is the opposite (tool enables career leap);
   * `lifestyle-shift` is broader (working hours / location-independence).
   */
  narrativeAngle: z
    .enum(["career-disruption", "productivity-transformation", "lifestyle-shift"])
    .default("career-disruption"),
  /** `dramatic` = stronger clickbait language; `subtle` = understated, more SEO-safe. */
  toneIntensity: z.enum(["dramatic", "subtle"]).default("dramatic"),
  /**
   * Spec 65.14 — optional incumbent / competitor name used as the
   * `{established}` substitution in contrarian-pattern hooks (e.g.
   * "RIP {established}: {n} tools that end it"). Marcel sets this per
   * definition in the Settings UI when a specific incumbent should anchor
   * the contrarian framing; omitted → the picker skips hooks referencing
   * `{established}` (drops to other patterns in the LRU pool).
   */
  competitorTool: z.string().min(1).optional(),
});

export type StoryArcClickbaitConfig = z.infer<typeof storyArcClickbaitConfigSchema>;

export const storyArcClickbaitDefinition: FormatTypeDefinition = {
  family: "B",
  configSchema: storyArcClickbaitConfigSchema,
  briefGenerator: "story-arc-clickbait-brief-generator",
  eligibleTemplates: ["story-arc-clickbait"],
  needsHooks: true,
  defaultEndSlides: ["tag-friend", "comment-to-get"],
};
