import { z } from "zod";

// ───── Toolwiki blog extras (Spec multi-domain-evolution S2.4) ────────────────
//
// Models the FRONTMATTER_EXTRAS fields the LLM emits for the Toolwiki `blog`
// collection. Pre-S2.4 these fields lived only as untyped entries inside the
// `articles.frontmatter_extras` JSONB column; no Zod schema validated them
// at the LLM-output boundary (Phase-1-discovery §1 blog inventar).
//
// Sprint-5 Domain-Registry will wire this schema into RenderMdxStep's
// boundary validator (S1.2). For now the schema is exported so DraftStep
// + future tests can use it directly.

/**
 * Article intent classification used by the LLM to pick a draft template
 * variant. The 9 values mirror the prompt-level enum in `DraftStep` /
 * `OutlineStep` / the `deriveIntentFromCollection` helper in
 * `apps/api/src/routes/projects/briefs.ts` (64.14 Phase C).
 *
 * Spec multi-domain-evolution S4.3: this is the canonical Toolwiki source
 * of truth for the article-intent taxonomy. Consumers across the pipeline
 * import `TOOLWIKI_BLOG_INTENT_TYPES` (the `as const` tuple) and join it
 * into LLM prompts so the enum lives in ONE place — not 4 hardcoded
 * copies. Per-tenant overrides will arrive via Sprint 5 Domain-Registry
 * when BK launches with its own intent vocabulary.
 *
 * NOTE: this enum is distinct from `project_configurations.intentTaxonomyDefault`
 * (which is the cluster-gap-detection intent set, currently 4 values:
 * comparison/pricing/alternatives/use_case). The two concepts share a name
 * but have different value sets and consumers; merging them is a Sprint-5+
 * decision.
 */
export const TOOLWIKI_BLOG_INTENT_TYPES = [
  "overview",
  "pricing",
  "features",
  "use-cases",
  "comparison",
  "tutorial",
  "review",
  "ethics",
  "general",
] as const;

export const BlogIntentTypeSchema = z.enum(TOOLWIKI_BLOG_INTENT_TYPES);
export type BlogIntentType = z.infer<typeof BlogIntentTypeSchema>;

/**
 * Renderer hint controlling the post-article link block. Pre-S2.4 this
 * enum lived only in the LLM prompt text (Phase-1-discovery §3.1.4
 * "Bucket C: Toolwiki-specific").
 */
export const BlogBottomLinksVariantSchema = z.enum([
  "default",
  "tool",
  "learning",
  "business",
  "private",
  "comparison",
]);
export type BlogBottomLinksVariant = z.infer<typeof BlogBottomLinksVariantSchema>;

export const BlogExtrasSchema = z.object({
  intentType: BlogIntentTypeSchema.optional(),
  bottomLinksVariant: BlogBottomLinksVariantSchema.optional(),
  /** Tool slug — references the canonical Astro `tools` collection. */
  primaryTool: z.string().min(1).max(80).optional(),
  /** Whether the Hub-Spoke carousel renders at the bottom of the article. */
  showTopicLinks: z.boolean().optional(),
});
export type BlogExtras = z.infer<typeof BlogExtrasSchema>;

/**
 * Validate parsed FRONTMATTER_EXTRAS against blog business rules.
 * Returns a tagged union — no throws (Pattern 111: throw at the call site).
 *
 * Today blog has no cross-field invariants beyond per-field shape, so the
 * function is a thin wrapper. Kept as a function (not a re-export of the
 * Zod schema) so future business rules can be added in one place without
 * breaking callers.
 */
export function validateBlogExtras(
  raw: unknown,
): { ok: true; data: BlogExtras } | { ok: false; error: string } {
  const parsed = BlogExtrasSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `blog frontmatter invalid: ${parsed.error.message}` };
  }
  return { ok: true, data: parsed.data };
}
