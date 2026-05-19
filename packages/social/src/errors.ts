import { z } from "zod";

export class ContentValidationError extends Error {
  readonly hints: string[];

  constructor(hints: string[]) {
    super(`Content validation failed: ${hints.join("; ")}`);
    this.name = "ContentValidationError";
    this.hints = hints;
  }
}

/**
 * Formats a single Zod issue into a human-readable hint for LLM reprompting.
 * Output language matches the prompt locale (DE by default for this pipeline).
 */
export function formatValidationHint(issue: z.ZodIssue, locale: "de" | "en" = "de"): string {
  const field = issue.path.join(".");

  if (issue.code === "too_big" && issue.type === "string") {
    const max = issue.maximum as number;
    return locale === "de"
      ? `Feld '${field}' ist zu lang. Maximum: ${max} Zeichen. Kürze es.`
      : `Field '${field}' is too long. Maximum: ${max} characters. Shorten it.`;
  }

  if (issue.code === "too_small" && issue.type === "string") {
    const min = issue.minimum as number;
    return locale === "de"
      ? `Feld '${field}' ist zu kurz. Minimum: ${min} Zeichen. Erweitere es.`
      : `Field '${field}' is too short. Minimum: ${min} characters. Expand it.`;
  }

  if (issue.code === "too_big" && issue.type === "array") {
    const max = issue.maximum as number;
    return locale === "de"
      ? `Feld '${field}' hat zu viele Einträge. Maximum: ${max}.`
      : `Field '${field}' has too many entries. Maximum: ${max}.`;
  }

  if (issue.code === "too_small" && issue.type === "array") {
    const min = issue.minimum as number;
    return locale === "de"
      ? `Feld '${field}' hat zu wenig Einträge. Minimum: ${min}.`
      : `Field '${field}' has too few entries. Minimum: ${min}.`;
  }

  return locale === "de"
    ? `Feld '${field}': ${issue.message}`
    : `Field '${field}': ${issue.message}`;
}
