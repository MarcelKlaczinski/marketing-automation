import { z } from "zod";

// ───── ki-wissen frontmatter (Spec 61.3) ──────────────────────────────────────
//
// ki-wissen articles are knowledge pillar pages. The LLM emits a few collection-
// specific fields inside FRONTMATTER_EXTRAS (category enum, level enum, icon
// Lucide name, facts[], next[]). Monetization fields (adsenseSlots,
// hasAffiliateLinks) are injected by the Astro schema as `false` defaults —
// the LLM must NOT emit them (Pattern 116).

export const KiWissenCategorySchema = z.enum([
  "Grundlagen",
  "Technik",
  "Ethik & Recht",
  "Praxis",
  "Zukunft",
]);
export type KiWissenCategory = z.infer<typeof KiWissenCategorySchema>;

export const KiWissenLevelSchema = z.enum([
  "Einsteiger",
  "Praktiker",
  "Profi",
]);
export type KiWissenLevel = z.infer<typeof KiWissenLevelSchema>;

/**
 * Subset of ki-wissen fields emitted by the LLM inside FRONTMATTER_EXTRAS.
 * Kept narrow so we can validate without coupling to the full Astro collection
 * schema (date/locale/seo/translationKey/etc. are handled by render-mdx).
 */
export const KiWissenExtrasSchema = z.object({
  category: KiWissenCategorySchema,
  level: KiWissenLevelSchema,
  icon: z.string().min(2).max(40).transform((s) => s.slice(0, 40)),
  facts: z
    .array(z.string().min(2).max(80).transform((s) => s.slice(0, 80)))
    .min(3)
    .max(5),
  next: z
    .array(z.string().min(2).max(40).transform((s) => s.slice(0, 40)))
    .min(2)
    .max(4),
});
export type KiWissenExtras = z.infer<typeof KiWissenExtrasSchema>;

/** Constraint hints injected into the LLM prompt. */
export const kiWissenFrontmatterBounds = {
  icon: { maxChars: 40 },
  facts: { countMin: 3, countMax: 5, each: { maxChars: 80 } },
  next: { countMin: 2, countMax: 4, each: { maxChars: 40 } },
} as const;

/**
 * Validate parsed FRONTMATTER_EXTRAS against ki-wissen business rules.
 * Returns null on success, an error message string on failure.
 *
 * Pattern 111: throw `ArticlePipelineError` at the call site, not here — keeps
 * this module dependency-free.
 *
 * Pattern 116: also reject articles that emit monetization fields (the LLM
 * should never set adsenseSlots / hasAffiliateLinks on ki-wissen).
 */
export function validateKiWissenExtras(
  raw: unknown,
): { ok: true; data: KiWissenExtras } | { ok: false; error: string } {
  const parsed = KiWissenExtrasSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `ki-wissen frontmatter invalid: ${parsed.error.message}` };
  }

  // Pattern 116: monetization must NOT appear in ki-wissen output.
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.adsenseSlots !== undefined) {
      return {
        ok: false,
        error: `ki-wissen: LLM must not emit adsenseSlots (injected as false by Astro schema)`,
      };
    }
    if (obj.hasAffiliateLinks !== undefined) {
      return {
        ok: false,
        error: `ki-wissen: LLM must not emit hasAffiliateLinks (injected as false by Astro schema)`,
      };
    }
  }

  return { ok: true, data: parsed.data };
}
