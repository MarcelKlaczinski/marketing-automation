/**
 * Spec 65.1 + 65.4 — Format-Type registry.
 *
 * Per Marcel-Decision Q2 (65.1): each `format_type` (e.g. "top_n_comparison",
 * "story_arc_clickbait") owns a Zod schema describing its `format_config`
 * shape. Spec 65.4 populates this registry with the 5 v1 format-types via
 * `Object.assign(FORMAT_TYPES, ...)` at module init; unknown format_types
 * still hit the permissive fallback.
 *
 * Central registration enables:
 *   - Boundary validation at HTTP layer when creating/updating a
 *     `recurring_content_definitions` row.
 *   - Brief-Generator-time validation when the worker reads the definition
 *     to dispatch.
 *   - 65.6 Template-Registry can ask "which templates serve this format_type"
 *     via `FORMAT_TYPES[formatType].eligibleTemplates`.
 *   - 65.5 Brief-Generator can gate Hook-Picker invocation via
 *     `FORMAT_TYPES[formatType].needsHooks` (Family A=false, Family B=true).
 */
import { z } from "zod";
import { headToHeadDefinition } from "./head-to-head.ts";
import { lifestyleListicleDefinition } from "./lifestyle-listicle.ts";
import { opinionRecommendationDefinition } from "./opinion-recommendation.ts";
import { storyArcClickbaitDefinition } from "./story-arc-clickbait.ts";
import { topNComparisonDefinition } from "./top-n-comparison.ts";

export type FormatTypeFamily = "A" | "B";

export interface FormatTypeDefinition {
  /** Family classifier — Family A = list-based (top 5, weekly recap), Family B = hook-based (one-tool spotlight). */
  family: FormatTypeFamily;
  /** Zod schema for the per-definition `format_config` jsonb body. */
  configSchema: z.ZodTypeAny;
  /** Brief-Generator function name (resolved by 65.5 at registration time). */
  briefGenerator: string;
  /** Template-keys eligible to render this format_type. Populated in 65.6. */
  eligibleTemplates: string[];
  /**
   * Whether the brief-generator (65.5) should call the Hook-Picker for this
   * format-type. Family A = false (data-driven headlines), Family B = true
   * (hook-driven narratives). Spec 65.4 §4.7.
   */
  needsHooks: boolean;
  /**
   * End-slide template keys to append by default to renders of this format-
   * type. Brief-generators (65.5) and template registry (65.6) read this when
   * the per-definition `format_config` does not override the end-slide stack.
   */
  defaultEndSlides: string[];
}

/**
 * Mutable registry — populated below at module init from the per-format-type
 * definition files. The skeleton helpers (permissive fallback, test-only
 * register/unregister) still apply to any unknown format_type.
 */
export const FORMAT_TYPES: Record<string, FormatTypeDefinition> = {};

Object.assign(FORMAT_TYPES, {
  top_n_comparison: topNComparisonDefinition,
  head_to_head: headToHeadDefinition,
  story_arc_clickbait: storyArcClickbaitDefinition,
  lifestyle_listicle: lifestyleListicleDefinition,
  opinion_recommendation: opinionRecommendationDefinition,
} satisfies Record<string, FormatTypeDefinition>);

/**
 * Stable string-literal union of the 5 v1 format-types. Callers that need to
 * narrow to a known type (without losing the permissive fallback for unknown
 * types) can use `FormatTypeKey`; the registry stays string-keyed for
 * forward-compat with future v1.5/v2 additions.
 */
export type FormatTypeKey =
  | "top_n_comparison"
  | "head_to_head"
  | "story_arc_clickbait"
  | "lifestyle_listicle"
  | "opinion_recommendation";

/**
 * Resolve the Zod schema for a format_type. Returns a permissive
 * `record(string, unknown)` passthrough when the type isn't registered yet —
 * unknown types validate at brief-generator time (the only consumer that
 * actually needs strict shape) rather than blocking config persistence.
 */
export function getFormatTypeSchema(formatType: string): z.ZodTypeAny {
  const def = FORMAT_TYPES[formatType];
  if (!def) return z.record(z.string(), z.unknown());
  return def.configSchema;
}

export type ValidateFormatConfigResult = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Validate a candidate `format_config` against the registered schema for
 * `formatType`. Unknown format-types pass through unchanged (permissive
 * fallback). Known format-types get strict Zod parsing; the original Zod
 * error message is surfaced for the caller.
 */
export function validateFormatConfig(
  formatType: string,
  config: unknown
): ValidateFormatConfigResult {
  const schema = getFormatTypeSchema(formatType);
  const result = schema.safeParse(config);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.message };
}

/**
 * Test-only helper for registering format-types ad-hoc. Production callers
 * (65.4 et al.) should add entries via static `Object.assign(FORMAT_TYPES, {...})`
 * at module init so the registry survives a hot-restart.
 */
export function __registerFormatTypeForTest(formatType: string, def: FormatTypeDefinition): void {
  FORMAT_TYPES[formatType] = def;
}

/** Test-only — drop a previously registered format-type. */
export function __unregisterFormatTypeForTest(formatType: string): void {
  delete FORMAT_TYPES[formatType];
}
