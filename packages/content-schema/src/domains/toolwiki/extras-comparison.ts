import { z } from "zod";

// ───── Toolwiki comparison extras (Spec 61.2 + multi-domain-evolution S2.4) ─────
//
// Migrated from `packages/pipelines/src/article/frontmatter/comparison.ts`.
// Schemas are pure Zod with no transitive dependencies — safe to consume
// from both the Tool-side pipeline (LLM-output validation) and a future
// Astro repo build hook.
//
// `winner` uses positional labels (tool-a … tool-d) mapped by index to
// toolSlugs[]. When winner = "depends", useCaseVerdicts must be non-empty
// (Astro schema enforces; we validate in pipeline before persisting).
// Pattern 110.

export const ComparisonWinnerSchema = z.enum([
  "tool-a",
  "tool-b",
  "tool-c",
  "tool-d",
  "depends",
  "tie",
]);
export type ComparisonWinner = z.infer<typeof ComparisonWinnerSchema>;

export const UseCaseVerdictSchema = z.object({
  useCase: z.string().min(2).max(40).transform((s) => s.slice(0, 40)),
  winner: z.string().min(2).max(40),
  reason: z.string().min(5).max(120).transform((s) => s.slice(0, 120)),
});
export type UseCaseVerdict = z.infer<typeof UseCaseVerdictSchema>;

/**
 * Subset of comparison fields emitted by the LLM inside FRONTMATTER_EXTRAS.
 * Strict shape kept narrow so we can validate without coupling to the full
 * Astro collection schema (date/locale/seo/etc. are handled by render-mdx).
 */
export const ComparisonExtrasSchema = z.object({
  toolSlugs: z.array(z.string().min(1).max(60)).min(2).max(4),
  winner: ComparisonWinnerSchema,
  verdict: z.string().min(20).max(400).transform((s) => s.slice(0, 400)),
  testMethodology: z
    .string()
    .max(200)
    .transform((s) => s.slice(0, 200))
    .optional(),
  useCaseVerdicts: z.array(UseCaseVerdictSchema).max(9).optional(),
  comparedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ComparisonExtras = z.infer<typeof ComparisonExtrasSchema>;

/** Constraint hints injected into the LLM prompt. */
export const comparisonFrontmatterBounds = {
  toolSlugs: { countMin: 2, countMax: 4, each: { maxChars: 60 } },
  verdict: { maxChars: 400, minChars: 20 },
  testMethodology: { maxChars: 200 },
  useCaseVerdicts: {
    countMin: 3,
    countMax: 9,
    each: { useCase: { maxChars: 40 }, reason: { maxChars: 120 } },
  },
} as const;

/**
 * Validate parsed FRONTMATTER_EXTRAS against comparison-specific business rules.
 * Returns a tagged union — no throws — so the call site keeps full control
 * over error escalation (Pattern 111: throw `ArticlePipelineError` at the
 * call site, not here, to keep this module dependency-free).
 *
 * Rules (Spec 61.2 §4.3):
 *  - toolSlugs length 2..4
 *  - winner === "depends" ⇒ useCaseVerdicts non-empty
 */
export function validateComparisonExtras(
  raw: unknown,
): { ok: true; data: ComparisonExtras } | { ok: false; error: string } {
  const parsed = ComparisonExtrasSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `comparison frontmatter invalid: ${parsed.error.message}` };
  }
  const data = parsed.data;
  if (data.winner === "depends" && (!data.useCaseVerdicts || data.useCaseVerdicts.length === 0)) {
    return {
      ok: false,
      error: `comparison: winner="depends" requires at least one useCaseVerdict`,
    };
  }
  return { ok: true, data };
}
