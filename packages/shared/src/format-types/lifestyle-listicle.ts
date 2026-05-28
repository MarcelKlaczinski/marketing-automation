/**
 * Spec 65.4 — `lifestyle_listicle` format-type (Family B).
 *
 * Hook-driven life-area listicle ("5 Wege wie {tool} deinen {lifeArea}
 * verändert"). Brief-generator (65.5) picks N tools matching the filter,
 * the Hook-Picker selects an opener pattern, and the template renders.
 *
 * V1 (Spec 65.8 Day 4a) ships a single `lifestyle-listicle` template that
 * handles all tone variants via `format_config.itemCount` (3-10) and the
 * brief-generator's chosen narrativeAngle. The 65.4-planned `-dramatic`/
 * `-minimal` split is deferred until engagement data justifies it.
 */
import { z } from "zod";
import type { FormatTypeDefinition } from "./registry.ts";

export const lifestyleListicleConfigSchema = z.object({
  /** Life area being addressed (e.g. "Studium", "Familie", "Solopreneur-Alltag"). */
  lifeArea: z.string().min(1),
  /** Number of items in the listicle (3-10). */
  itemCount: z.number().int().min(3).max(10).default(5),
  /**
   * Optional pool filter for which tools the brief-generator may pick from.
   * Combined as an AND across the filter fields (both must match if set).
   */
  toolFilter: z
    .object({
      categorySlugs: z.array(z.string().min(1)).optional(),
      personaFilter: z.string().min(1).optional(),
    })
    .optional(),
  /**
   * Spec 65.14 — optional incumbent name for contrarian-pattern hooks
   * (`{established}` substitution). When omitted the picker drops hooks
   * referencing `{established}` and falls back to non-contrarian patterns.
   */
  competitorTool: z.string().min(1).optional(),
});

export type LifestyleListicleConfig = z.infer<typeof lifestyleListicleConfigSchema>;

export const lifestyleListicleDefinition: FormatTypeDefinition = {
  family: "B",
  configSchema: lifestyleListicleConfigSchema,
  briefGenerator: "lifestyle-listicle-brief-generator",
  eligibleTemplates: ["lifestyle-listicle"],
  needsHooks: true,
  defaultEndSlides: ["comment-to-get", "save-share-cta"],
};
