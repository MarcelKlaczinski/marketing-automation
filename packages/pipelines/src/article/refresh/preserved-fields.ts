/**
 * Spec multi-domain-evolution §3.1 / S1.1 — Refresh-Field-Whitelist.
 *
 * Fields below are editorial-curated and MUST survive a Tool re-generation
 * (BlogPipeline.PersistArticleStep). Today they live in two physical places:
 *
 *   - Promoted columns on `articles` (Spec 54.8): tool_pricing, tool_price_from,
 *     tool_rating, tool_votes, tool_affiliate_slug. PersistArticleStep does not
 *     write to these columns today — the COLUMN list below is a defensive
 *     regression guard so a future patch that adds them to the .set() block
 *     fails its tests immediately.
 *
 *   - JSONB entries under `articles.domain_extras`: `featured`,
 *     `pricingVerifiedAt`. These are the live lost-update risk. When
 *     PersistArticleStep replaces the whole extras blob from the bridge,
 *     these editorial values vanish unless we merge them back from the
 *     current row.
 *
 * The whitelist is intentionally narrow. Sprint 3+ (Field-Authority-Markers)
 * may generalize this to a per-domain config; until then keep the surface
 * tight and well-documented.
 */

export const REFRESH_PRESERVED_COLUMNS = [
  "toolPricing",
  "toolPriceFrom",
  "toolRating",
  "toolVotes",
  "toolAffiliateSlug",
] as const;

export type PreservedColumnKey = (typeof REFRESH_PRESERVED_COLUMNS)[number];

export const REFRESH_PRESERVED_EXTRAS_KEYS = ["featured", "pricingVerifiedAt"] as const;

export type PreservedExtrasKey = (typeof REFRESH_PRESERVED_EXTRAS_KEYS)[number];

/**
 * Merge `incoming` extras over `current` extras with the whitelist preserved
 * from `current`. Pure function — no DB, no clock. Safe to call when either
 * side is null/undefined or has unexpected shape.
 *
 * Precedence:
 *   1. `incoming` is the new payload from the bridge (LLM output + bridge
 *      injections). It wins for any key NOT in the whitelist.
 *   2. For whitelisted keys, `current` wins IF the key is present and
 *      non-null in `current`. This lets an editor remove a `featured: true`
 *      by manually editing the MDX (next Astro-Import drops the key, then
 *      Tool-regenerate respects the absence).
 *   3. If `current` is missing the whitelisted key, `incoming` is allowed
 *      to introduce it.
 */
export function mergePreservedExtras(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!incoming) return undefined;
  const result: Record<string, unknown> = { ...incoming };
  if (!current) return result;
  for (const key of REFRESH_PRESERVED_EXTRAS_KEYS) {
    if (Object.hasOwn(current, key) && current[key] != null) {
      result[key] = current[key];
    }
  }
  return result;
}
