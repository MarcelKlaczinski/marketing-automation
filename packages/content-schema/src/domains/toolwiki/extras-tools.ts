import { z } from "zod";

// ───── Toolwiki tools extras (Spec multi-domain-evolution S2.4) ───────────────
//
// Models the FRONTMATTER_EXTRAS fields for the `tools` collection — the
// largest Toolwiki collection by row count (108 of 268 articles per the
// Phase-1 audit). Several of these fields ALSO live as Drizzle-promoted
// columns on `articles` (Spec 54.8): `pricing`, `priceFrom`, `rating`,
// `votes`, `affiliateSlug`, `website` are read out of JSONB by the
// astro-sync importer and written back into the promoted columns. The
// JSONB copies remain authoritative because the LLM-output path writes
// to extras; the promoted columns are derived.
//
// `relatedPillars` is the Phase-1-E1 "härteste Toolwiki-Bindung im Schema"
// — pre-spec it was a hardcoded 12-value `z.enum([...])`. S2.4 loosens it
// to `z.string()` because the value set must vary per-domain (BK has no
// "was-ist-ki" pillar). The Toolwiki Domain-Registry context (Sprint 5)
// will provide the per-tenant value list as a `superRefine` against the
// ki-wissen collection slugs.

export const ToolsExtrasSchema = z.object({
  /** Tool capabilities as short noun phrases. */
  features: z.array(z.string().min(2).max(80)).max(15).optional(),
  /** Positive evaluation bullets. */
  pros: z.array(z.string().min(2).max(120)).max(10).optional(),
  /** Negative evaluation bullets. */
  cons: z.array(z.string().min(2).max(120)).max(10).optional(),
  /** Use-case slogans (e.g. "Code refactoring at scale"). */
  useCases: z.array(z.string().min(2).max(80)).max(10).optional(),
  /** Third-party integrations as canonical product names. */
  integrations: z.array(z.string().min(2).max(60)).max(20).optional(),
  /** Freeform pricing label (e.g. "freemium", "api-based", "from $20/mo"). */
  pricing: z.string().min(1).max(60).optional(),
  /** Numeric entry price in domain currency; renderer formats. */
  priceFrom: z.number().min(0).optional(),
  /** Aggregate rating 0..5. */
  rating: z.number().min(0).max(5).optional(),
  /** Editor-curated vote count. */
  votes: z.number().int().min(0).optional(),
  /** Affiliate-program slug; Astro renderer expands to full URL. */
  affiliateSlug: z.string().min(1).max(60).optional(),
  /** Canonical product website URL (https://). */
  website: z.string().url().optional(),
  /**
   * Slugs into the `ki-wissen` (or future per-domain knowledge) collection.
   * Pre-S2.4 this was a hardcoded `z.enum([...])` of 12 Toolwiki pillar
   * slugs. Loosened to plain string so other tenants can use their own
   * pillar set; the Domain-Registry will add a per-tenant superRefine.
   */
  relatedPillars: z.array(z.string().min(1).max(80)).max(12).optional(),
});
export type ToolsExtras = z.infer<typeof ToolsExtrasSchema>;

/**
 * Validate parsed FRONTMATTER_EXTRAS against tools business rules.
 * Tools today has no cross-field invariants — the function is a thin
 * wrapper but stays in place for forward-compat with future rules
 * (e.g. "if pricing === 'freemium' then priceFrom must be 0").
 */
export function validateToolsExtras(
  raw: unknown,
): { ok: true; data: ToolsExtras } | { ok: false; error: string } {
  const parsed = ToolsExtrasSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `tools frontmatter invalid: ${parsed.error.message}` };
  }
  return { ok: true, data: parsed.data };
}
