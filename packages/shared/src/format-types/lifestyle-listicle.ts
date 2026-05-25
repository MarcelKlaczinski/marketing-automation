/**
 * Spec 65.4 — `lifestyle_listicle` format-type (Family B).
 *
 * Hook-driven life-area listicle ("5 Wege wie {tool} deinen {lifeArea}
 * verändert"). Brief-generator (65.5) picks N tools matching the filter,
 * the Hook-Picker selects an opener pattern, and the template
 * (`lifestyle-listicle-dramatic` / `lifestyle-listicle-minimal`, 65.8) renders.
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
});

export type LifestyleListicleConfig = z.infer<typeof lifestyleListicleConfigSchema>;

export const lifestyleListicleDefinition: FormatTypeDefinition = {
  family: "B",
  configSchema: lifestyleListicleConfigSchema,
  briefGenerator: "lifestyle-listicle-brief-generator",
  eligibleTemplates: ["lifestyle-listicle-dramatic", "lifestyle-listicle-minimal"],
  needsHooks: true,
  defaultEndSlides: ["comment-to-get", "save-share-cta"],
};
