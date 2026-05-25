/**
 * Spec 65.4 — `head_to_head` format-type (Family A).
 *
 * Two-tool comparison carousel. Data-driven — the brief-generator pulls each
 * tool's pros/cons/score and the template (`head-to-head-vs` or
 * `comparison-grid-3` as fallback for two very similar tools) renders.
 */
import { z } from "zod";
import type { FormatTypeDefinition } from "./registry.ts";

export const headToHeadConfigSchema = z.object({
  /** First tool to compare (article-id from `articles` where `collection='tools'`). */
  toolAId: z.string().uuid(),
  /** Second tool to compare. */
  toolBId: z.string().uuid(),
  /**
   * Optional comparison-angle hint passed into the brief-generator's prompt
   * (e.g. "free-tier limits", "code quality"). Leave empty to let the LLM
   * pick the most differentiating angle from the two tool profiles.
   */
  angleHint: z.string().optional(),
});

export type HeadToHeadConfig = z.infer<typeof headToHeadConfigSchema>;

export const headToHeadDefinition: FormatTypeDefinition = {
  family: "A",
  configSchema: headToHeadConfigSchema,
  briefGenerator: "head-to-head-brief-generator",
  // `head-to-head-vs` is the canonical template; `comparison-grid-3` is a
  // graceful fallback for two tools that aren't visually distinct enough.
  eligibleTemplates: ["head-to-head-vs", "comparison-grid-3"],
  needsHooks: false,
  defaultEndSlides: ["link-in-bio"],
};
