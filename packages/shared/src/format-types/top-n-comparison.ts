/**
 * Spec 65.4 — `top_n_comparison` format-type (Family A).
 *
 * Data-driven "top N tools in category X" carousel. No hook-library lookup;
 * the brief-generator (65.5) ranks tools by `rankingSource` and the template
 * (`comparison-grid-3` / `comparison-grid-5` / future `comparison-grid-10`)
 * renders a fixed-shape grid.
 */
import { z } from "zod";
import type { FormatTypeDefinition } from "./registry.ts";

export const topNComparisonConfigSchema = z.object({
  /** Tool-Category slug to compare (e.g. "ai-image-generation"). */
  categorySlug: z.string().min(1).describe("Tool-Category slug to compare"),
  /** Number of tools to feature (between 3 and 10). */
  topN: z.number().int().min(3).max(10).default(5),
  /**
   * How to rank candidate tools within the category.
   *   - `manual` requires `manualToolIds` to be set.
   *   - `auto-by-stars` ranks by GitHub stars / popularity proxy.
   *   - `llm-curated` lets the brief-generator pick + justify.
   */
  rankingSource: z.enum(["manual", "auto-by-stars", "llm-curated"]).default("llm-curated"),
  /** Explicit tool article-ids — only consumed when `rankingSource === "manual"`. */
  manualToolIds: z.array(z.string().uuid()).optional(),
  /** Skip tools used in the last 4 runs of this definition (LRU diversity). */
  excludeRecentlyUsed: z.boolean().default(true),
});

export type TopNComparisonConfig = z.infer<typeof topNComparisonConfigSchema>;

export const topNComparisonDefinition: FormatTypeDefinition = {
  family: "A",
  configSchema: topNComparisonConfigSchema,
  briefGenerator: "top-n-comparison-brief-generator",
  // 65.7 will add comparison-grid-10; the other two are 60.2/60.3 shipped.
  eligibleTemplates: ["comparison-grid-3", "comparison-grid-5"],
  needsHooks: false,
  defaultEndSlides: ["comment-to-get", "link-in-bio"],
};
