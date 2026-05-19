import { z } from "zod";
import { ContentValidationError, formatValidationHint } from "../errors.ts";

export interface ValidationConfig<T> {
  schema: z.ZodType<T>;
  /** Max number of reprompt attempts. Default: 1. */
  maxReprompts?: number;
  /** What to do when all reprompts are exhausted. Default: "reprompt" → throws ContentValidationError. */
  onValidationFailure?: "reprompt" | "truncate" | "throw";
  /** Locale for hint messages fed back to LLM. Default: "de". */
  locale?: "de" | "en";
}

/**
 * Validates LLM output against a Zod schema.
 * On failure, calls reprompt() with human-readable hints and retries up to maxReprompts times.
 *
 * Usage per template:
 *   return validateAndReprompt(rawOutput, (hints) => llmCall(rebuildPrompt(hints)), {
 *     schema: myTemplateGeneratedSchema,
 *   });
 *
 * The reprompt function should weave the hints back into the LLM prompt so the
 * model knows exactly what to fix. One reprompt is the default — two LLM calls
 * is acceptable cost; three is wasteful.
 */
export async function validateAndReprompt<T>(
  initialOutput: unknown,
  reprompt: (errorHints: string[]) => Promise<unknown>,
  config: ValidationConfig<T>,
): Promise<T> {
  const maxReprompts = config.maxReprompts ?? 1;
  const onFailure = config.onValidationFailure ?? "reprompt";
  const locale = config.locale ?? "de";

  let current = initialOutput;

  for (let attempt = 0; attempt <= maxReprompts; attempt++) {
    const result = config.schema.safeParse(current);
    if (result.success) return result.data;

    const hints = result.error.issues.map((issue) => formatValidationHint(issue, locale));

    if (attempt === maxReprompts) {
      if (onFailure === "truncate") {
        // Last-resort: try to coerce by running the schema's transforms if any,
        // or rethrow so the caller can decide. Truncation is explicit per field
        // in the composition (WebkitLineClamp). We surface the error here.
        throw new ContentValidationError([
          ...hints,
          locale === "de"
            ? "Maximale Wiederholungen erreicht. Inhalt wird abgelehnt."
            : "Max retries reached. Content rejected.",
        ]);
      }
      throw new ContentValidationError(hints);
    }

    current = await reprompt(hints);
  }

  // TypeScript: loop always throws or returns before here
  throw new ContentValidationError(["Unexpected: exhausted reprompt loop without result"]);
}
