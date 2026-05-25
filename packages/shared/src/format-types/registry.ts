/**
 * Spec 65.1 — Format-Type registry (skeleton).
 *
 * Per Marcel-Decision Q2: each `format_type` (e.g. "top-5-tools", "tool-of-the-
 * week") owns a Zod schema describing its `format_config` shape. The 65.4
 * Hook-Library + Brief-Generator populates this registry with concrete entries
 * for the v1 format-types; until then any unknown format_type is treated
 * permissively (pass-through validation).
 *
 * Central registration enables:
 *   - Boundary validation at HTTP layer when creating/updating a
 *     `recurring_content_definitions` row.
 *   - Brief-Generator-time validation when the worker reads the definition
 *     to dispatch.
 *   - 65.6 Template-Registry can ask "which templates serve this format_type"
 *     via `FORMAT_TYPES[formatType].eligibleTemplates`.
 */
import { z } from "zod";

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
}

/**
 * Mutable registry. Owned by 65.4 (Hook-Library) population path; 65.1 ships
 * the skeleton + permissive-fallback helpers so 65.2/65.3 can wire to it
 * without blocking on 65.4.
 */
export const FORMAT_TYPES: Record<string, FormatTypeDefinition> = {};

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
