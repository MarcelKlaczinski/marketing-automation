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
  /**
   * Spec 65.17 B4 — when enabled, the brief-generator derives Bad/Good/Great
   * tier-buckets from `tool_persona_scores` (Spec 65.3) and routes to the
   * `tool-tier-ranking` template instead of `comparison-grid-3/5`. Requires
   * `persona` to be set on the definition so persona-scoped scores exist for
   * tier-derivation (the brief-generator falls back to tierMode=false with a
   * warn-log when persona is missing).
   *
   * Marcel-decision Q3 (Discovery §3.2) — Option β template-under-existing
   * format-type, avoids the 12-site content_type checklist of a new format-type.
   */
  tierMode: z.boolean().default(false),
});

export type TopNComparisonConfig = z.infer<typeof topNComparisonConfigSchema>;

export const topNComparisonDefinition: FormatTypeDefinition = {
  family: "A",
  configSchema: topNComparisonConfigSchema,
  briefGenerator: "top-n-comparison-brief-generator",
  // 60.2/60.3 shipped the grid templates; 65.17 B4 adds `tool-tier-ranking`
  // as an additional eligible template when `tierMode === true`. Selection
  // routing is handled by the brief-generator (Spec 65.17 B5), not by template
  // registry — the eligible-set is the union; per-brief eligibility is gated
  // by config.
  eligibleTemplates: ["comparison-grid-3", "comparison-grid-5", "tool-tier-ranking"],
  needsHooks: false,
  defaultEndSlides: ["comment-to-get", "link-in-bio"],
};
