import { z } from "zod";

// ───── Toolwiki usecases extras (Spec multi-domain-evolution S2.4) ────────────
//
// Models the FRONTMATTER_EXTRAS fields for the `usecases` collection
// (24 articles per Phase-1 audit). Pre-S2.4 these fields lived as untyped
// JSONB entries; the LLM-output path used permissive parsing.
//
// `contentType` distinguishes layout variants — `pillar` and `hub` are
// the live values in the Phase-1 sample; `stub` and `expanded` are
// declared in the Astro schema but not used in any 2026-05 sample. All
// four stay in the enum for forward-compat.

export const UsecaseContentTypeSchema = z.enum([
  "stub",
  "expanded",
  "pillar",
  "hub",
]);
export type UsecaseContentType = z.infer<typeof UsecaseContentTypeSchema>;

export const UsecasesExtrasSchema = z.object({
  /** Free-text tags (per-locale; not validated against a global registry). */
  relatedTags: z.array(z.string().min(2).max(40)).max(12).optional(),
  /** Single industry vertical the usecase targets. */
  industryFocus: z.string().min(2).max(60).optional(),
  /**
   * Tool slugs featured in the usecase article (2-7 per Phase-1 sample
   * convention). The Domain-Registry will add a per-tenant superRefine
   * against the `tools` collection.
   */
  featuredToolSlugs: z.array(z.string().min(1).max(60)).min(2).max(7).optional(),
  /** Optional highlight bullets shown above the body. */
  highlights: z.array(z.string().min(2).max(120)).max(6).optional(),
  contentType: UsecaseContentTypeSchema.optional(),
});
export type UsecasesExtras = z.infer<typeof UsecasesExtrasSchema>;

/**
 * Validate parsed FRONTMATTER_EXTRAS against usecases business rules.
 * Thin wrapper today; future cross-field rules belong here.
 */
export function validateUsecasesExtras(
  raw: unknown,
): { ok: true; data: UsecasesExtras } | { ok: false; error: string } {
  const parsed = UsecasesExtrasSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `usecases frontmatter invalid: ${parsed.error.message}` };
  }
  return { ok: true, data: parsed.data };
}
