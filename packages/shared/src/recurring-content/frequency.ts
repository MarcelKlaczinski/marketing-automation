/**
 * Spec 65.1 — Frequency validation for `recurring_content_definitions.frequency`.
 *
 * Per Marcel-Decision Q1: keep the column `text` (not enum) but validate at
 * the HTTP boundary against a known set OR a cron-expression shape. Deeper
 * cron parsing (range validation, step intervals, leap-year edge cases) is
 * deferred to a cron-parser library in 65.5; this layer just ensures the
 * input is structurally plausible.
 */
import { z } from "zod";

/** Friendly aliases that the worker translates to a concrete next_run_at. */
export const KNOWN_FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
export type KnownFrequency = (typeof KNOWN_FREQUENCIES)[number];

/**
 * Lightweight shape check for cron expressions. Accepts standard 5-field
 * (minute hour day month dow) and 6-field (with seconds prefix). Each field
 * is allowed to contain any of: `*`, digits, `,`, `-`, `/`, alphabetic
 * day-names (JAN-DEC, SUN-SAT), or `?` (Quartz dialect tolerated for
 * forward-compat).
 */
function looksLikeCronExpression(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return false;
  const fieldShape = /^[*?\d,\-/A-Za-z]+$/;
  return parts.every((p) => fieldShape.test(p));
}

export function isKnownFrequency(value: string): value is KnownFrequency {
  return (KNOWN_FREQUENCIES as readonly string[]).includes(value);
}

export const frequencySchema = z
  .string()
  .min(1, { message: "frequency must not be empty" })
  .refine((val) => isKnownFrequency(val) || looksLikeCronExpression(val), {
    message: "frequency must be weekly|biweekly|monthly OR a valid cron expression",
  });

export type Frequency = z.infer<typeof frequencySchema>;
