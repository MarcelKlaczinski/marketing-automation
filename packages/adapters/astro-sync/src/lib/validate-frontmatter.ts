import type { FrontmatterField } from "../types.ts";
import type { ValidationFailureDetail } from "../errors.ts";

/**
 * Spec multi-domain-evolution §3.1 / S1.2 — pure boundary validator.
 *
 * Checks an assembled frontmatter object against the Spec-50 JSONB schema
 * snapshot (`FrontmatterField[]`) extracted from the Astro repo's
 * `content.config.ts`. Surfaces three failure modes:
 *
 *   - **missing_required**: field is `required: true && hasDefault: false`
 *     but the frontmatter doesn't carry it
 *   - **type_mismatch**: field is present but the JS type doesn't satisfy
 *     the Astro Zod shape (e.g. `category: 123` for a `string` field)
 *   - **enum_mismatch**: field has `enumValues` and the present value is
 *     not in that set
 *
 * Extra/unknown fields are NOT a failure — the Spec-50 JSONB is a snapshot
 * and may lag the live Astro schema; we rely on the existing `RenderMdxStep`
 * field-filter to drop unknown keys before write. Sprint 5 (Domain-Registry)
 * may tighten this further.
 */
export interface FrontmatterValidationResult {
  success: boolean;
  failures: ValidationFailureDetail[];
}

const MAX_ACTUAL_LEN = 80;

function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return `array(${v.length})`;
  return typeof v;
}

function stringifyActual(v: unknown): string {
  let s: string;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (!s) return "";
  return s.length > MAX_ACTUAL_LEN ? `${s.slice(0, MAX_ACTUAL_LEN)}…` : s;
}

function isIsoDate(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(v);
}

function checkType(field: FrontmatterField, value: unknown): ValidationFailureDetail | null {
  const fail = (expected: string): ValidationFailureDetail => ({
    fieldPath: field.name,
    expected,
    actual: `${describeValue(value)}: ${stringifyActual(value)}`,
    reason: "type_mismatch",
  });

  switch (field.type) {
    case "string":
    case "image":
      // image fields are populated with a path string by transformImageFields;
      // both should be string-typed at the boundary.
      return typeof value === "string" ? null : fail("string");
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : fail("number");
    case "boolean":
      return typeof value === "boolean" ? null : fail("boolean");
    case "date":
      // Astro's z.date() / z.coerce.date() at build time accepts ISO date strings
      // and Date instances. The MDX YAML serializer always emits strings,
      // so a string-shaped check is the realistic boundary.
      return isIsoDate(value) || value instanceof Date ? null : fail("ISO date (YYYY-MM-DD)");
    case "string_array":
      if (!Array.isArray(value)) return fail("string[]");
      return value.every((v) => typeof v === "string") ? null : fail("string[]");
    case "object_array":
      if (!Array.isArray(value)) return fail(field.objectShape ?? "object[]");
      return value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))
        ? null
        : fail(field.objectShape ?? "object[]");
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? null
        : fail("object");
    case "unknown":
      // We can't classify it — accept whatever is there.
      return null;
  }
}

function checkEnum(field: FrontmatterField, value: unknown): ValidationFailureDetail | null {
  if (!field.enumValues?.length) return null;
  if (typeof value !== "string") return null; // type check above will catch
  if (field.enumValues.includes(value)) return null;
  return {
    fieldPath: field.name,
    expected: `one of [${field.enumValues.map((v) => `'${v}'`).join(", ")}]`,
    actual: stringifyActual(value),
    reason: "enum_mismatch",
  };
}

export function validateFrontmatterAgainstSchema(
  frontmatter: Record<string, unknown>,
  fields: FrontmatterField[],
): FrontmatterValidationResult {
  // Empty schema = permissive (matches the existing "Schema parse returned no
  // fields; emitting permissive frontmatter" branch in render-mdx.ts:222).
  if (fields.length === 0) {
    return { success: true, failures: [] };
  }

  const failures: ValidationFailureDetail[] = [];

  for (const field of fields) {
    const present = Object.hasOwn(frontmatter, field.name);
    const value = present ? frontmatter[field.name] : undefined;
    const isNullish = value === null || value === undefined;

    if (!present || isNullish) {
      if (field.required && !field.hasDefault) {
        failures.push({
          fieldPath: field.name,
          expected: `${field.type}${field.enumValues ? ` (enum)` : ""}`,
          actual: "",
          reason: "missing_required",
        });
      }
      continue;
    }

    const typeFailure = checkType(field, value);
    if (typeFailure) {
      failures.push(typeFailure);
      continue; // skip enum check if type already failed
    }

    const enumFailure = checkEnum(field, value);
    if (enumFailure) failures.push(enumFailure);
  }

  return { success: failures.length === 0, failures };
}
