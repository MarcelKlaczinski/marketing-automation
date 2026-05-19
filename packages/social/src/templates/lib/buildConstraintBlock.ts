import type { ContentBounds, FieldBound, ListBound } from "../types.ts";

/**
 * Format a ContentBounds object as an LLM-prompt section that lists every
 * field's character / count constraints. Locale-aware (DE: "Zeichen" / "Einträge",
 * EN: "chars" / "items").
 *
 * Output is a markdown-ish block ready to inline into a system or user prompt.
 *
 * @example
 * buildConstraintBlock(singleToolSpotlightBounds, "de", { fields: ["verdictQuote", "strengths"] })
 * // →
 * // ZEICHENLIMITS (strikt einhalten):
 * // - verdictQuote: 40–120 Zeichen
 * // - strengths: 3–4 Einträge, jeder 30–70 Zeichen
 */
export function buildConstraintBlock(
  bounds: ContentBounds,
  locale: "de" | "en",
  options?: {
    /** Subset of top-level fields to include. Default: all top-level fields. */
    fields?: string[];
    /** Override the header line. */
    header?: string;
  },
): string {
  const fields = options?.fields ?? Object.keys(bounds);
  const lines: string[] = [];

  for (const key of fields) {
    const bound = bounds[key];
    if (bound === undefined) continue;
    lines.push(...formatBound(key, bound, locale, 0));
  }

  const header =
    options?.header ??
    (locale === "de"
      ? "ZEICHENLIMITS (strikt einhalten):"
      : "CHARACTER LIMITS (must be respected):");

  return `${header}\n${lines.join("\n")}`;
}

function formatBound(
  key: string,
  bound: FieldBound | ListBound | ContentBounds | number,
  locale: "de" | "en",
  depth: number,
): string[] {
  const indent = "  ".repeat(depth);

  if (typeof bound === "number") {
    const exact = locale === "de" ? "exakt" : "exactly";
    return [`${indent}- ${key}: ${exact} ${bound}`];
  }

  if (isFieldBound(bound)) {
    const unit = locale === "de" ? "Zeichen" : "chars";
    return [`${indent}- ${key}: ${bound.min}–${bound.max} ${unit}`];
  }

  if (isListBound(bound)) {
    const unit = locale === "de" ? "Zeichen" : "chars";

    let countLabel: string;
    if ("count" in bound && typeof bound.count === "number") {
      countLabel =
        locale === "de" ? `exakt ${bound.count}` : `exactly ${bound.count}`;
    } else if ("countMin" in bound && "countMax" in bound) {
      countLabel =
        locale === "de"
          ? `${(bound as { countMin: number }).countMin}–${(bound as { countMax: number }).countMax} Einträge`
          : `${(bound as { countMin: number }).countMin}–${(bound as { countMax: number }).countMax} items`;
    } else {
      countLabel =
        locale === "de"
          ? `max ${(bound as ListBound).max}`
          : `max ${(bound as ListBound).max}`;
    }

    const each = (bound as { each?: FieldBound }).each;
    const perItem = each
      ? locale === "de"
        ? `, jeder ${each.min}–${each.max} ${unit}`
        : `, each ${each.min}–${each.max} ${unit}`
      : (bound as ListBound).perItemMaxChars !== undefined
        ? locale === "de"
          ? `, max ${(bound as ListBound).perItemMaxChars} ${unit} pro Eintrag`
          : `, max ${(bound as ListBound).perItemMaxChars} ${unit} each`
        : "";

    // For typed-list bounds (e.g. facts: { count: 4, key: {...}, value: {...} }),
    // also recurse into the FieldBound children so the LLM sees per-field limits.
    const META_KEYS = new Set(["count", "countMin", "countMax", "max", "each", "perItemMaxChars"]);
    const nestedEntries = Object.entries(bound as ContentBounds).filter(
      ([k, v]) => !META_KEYS.has(k) && isFieldBound(v),
    );
    if (nestedEntries.length > 0) {
      const childLines = nestedEntries.flatMap(([k, v]) =>
        formatBound(k, v, locale, depth + 1),
      );
      return [`${indent}- ${key}: ${countLabel}${perItem}`, ...childLines];
    }

    return [`${indent}- ${key}: ${countLabel}${perItem}`];
  }

  // Nested ContentBounds — recurse
  const childLines = Object.entries(bound as ContentBounds).flatMap(
    ([k, v]) => formatBound(k, v, locale, depth + 1),
  );
  return [`${indent}- ${key}:`, ...childLines];
}

function isFieldBound(b: unknown): b is FieldBound {
  return (
    typeof b === "object" &&
    b !== null &&
    "min" in b &&
    "max" in b &&
    !("each" in b) &&
    !("count" in b) &&
    !("countMin" in b) &&
    !("perItemMaxChars" in b) &&
    Object.keys(b as object).every((k) => k === "min" || k === "max")
  );
}

function isListBound(b: unknown): b is ListBound | { countMin: number; countMax: number; each?: FieldBound } | { count: number; each?: FieldBound } {
  return (
    typeof b === "object" &&
    b !== null &&
    ("each" in b || "count" in b || "countMin" in b || "perItemMaxChars" in b)
  );
}
