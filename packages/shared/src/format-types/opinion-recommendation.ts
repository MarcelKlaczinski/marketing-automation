/**
 * Spec 65.4 — `opinion_recommendation` format-type (Family B).
 *
 * Hook-driven opinion piece advocating for one specific tool ("Warum jeder
 * {tool} Premium haben sollte"). Strongly affiliate-leaning; the brief-
 * generator (65.5) emphasises pricing/value-prop when `affiliateAngle` is
 * true. V1 (Spec 65.8 Day 4b) ships a single `opinion-recommendation`
 * template; the 65.4-planned `-dramatic`/`-minimal` split is deferred
 * until engagement data justifies it. `opinionStance` shifts the LLM's
 * register inside the same composition.
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
  /**
   * Spec 65.14 — optional incumbent / competitor name used as the
   * `{established}` substitution in contrarian-pattern hooks (e.g.
   * "Why I switched from {established} to {tool}"). Omitted → picker drops
   * hooks referencing `{established}`.
   */
  competitorTool: z.string().min(1).optional(),
});

export type OpinionRecommendationConfig = z.infer<typeof opinionRecommendationConfigSchema>;

export const opinionRecommendationDefinition: FormatTypeDefinition = {
  family: "B",
  configSchema: opinionRecommendationConfigSchema,
  briefGenerator: "opinion-recommendation-brief-generator",
  eligibleTemplates: ["opinion-recommendation"],
  needsHooks: true,
  defaultEndSlides: ["link-in-bio", "tag-friend"],
};
