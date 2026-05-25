/**
 * Spec 65.4 — `opinion_recommendation` format-type (Family B).
 *
 * Hook-driven opinion piece advocating for one specific tool ("Warum jeder
 * {tool} Premium haben sollte"). Strongly affiliate-leaning; the brief-
 * generator (65.5) emphasises pricing/value-prop when `affiliateAngle` is
 * true. Templates: `opinion-recommendation-dramatic` /
 * `opinion-recommendation-minimal` (65.8).
 */
import { z } from "zod";
import type { FormatTypeDefinition } from "./registry.ts";

export const opinionRecommendationConfigSchema = z.object({
  /** Tool being recommended — article-id from `articles WHERE collection='tools'`. */
  recommendedToolId: z.string().uuid(),
  /**
   * Stance the LLM should take.
   *   - `enthusiastic` = straightforward advocacy.
   *   - `critical-but-positive` = "flaws + still worth it" framing.
   *   - `contrarian` = "everyone else says X, but actually Y" framing.
   */
  opinionStance: z
    .enum(["enthusiastic", "critical-but-positive", "contrarian"])
    .default("enthusiastic"),
  /**
   * Whether to mention pricing/value-prop strongly. When true the brief-
   * generator injects price-anchor language; when false the post stays
   * value-prop-only without monetary references.
   */
  affiliateAngle: z.boolean().default(true),
});

export type OpinionRecommendationConfig = z.infer<typeof opinionRecommendationConfigSchema>;

export const opinionRecommendationDefinition: FormatTypeDefinition = {
  family: "B",
  configSchema: opinionRecommendationConfigSchema,
  briefGenerator: "opinion-recommendation-brief-generator",
  eligibleTemplates: ["opinion-recommendation-dramatic", "opinion-recommendation-minimal"],
  needsHooks: true,
  defaultEndSlides: ["link-in-bio", "tag-friend"],
};
