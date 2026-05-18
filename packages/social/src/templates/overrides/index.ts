import { z } from "zod";
import {
  comparisonStunningOverridesSchema,
  type ComparisonStunningOverrides,
} from "./comparisonStunning.overrides.ts";
import {
  singleToolSpotlightOverridesSchema,
  type SingleToolSpotlightOverrides,
} from "./singleToolSpotlight.overrides.ts";
import {
  useCaseVerdictOverridesSchema,
  type UseCaseVerdictOverrides,
} from "./useCaseVerdict.overrides.ts";
import type { TemplateKey } from "../types.ts";

export {
  comparisonStunningOverridesSchema,
  type ComparisonStunningOverrides,
  singleToolSpotlightOverridesSchema,
  type SingleToolSpotlightOverrides,
  useCaseVerdictOverridesSchema,
  type UseCaseVerdictOverrides,
};

// Keys with override schemas. Other TemplateKey values are not yet in production.
export const OVERRIDE_TEMPLATE_KEYS = [
  "comparison-stunning",
  "comparison-stunning-3",
  "single-tool-spotlight",
  "use-case-verdict-per-tool",
] as const satisfies TemplateKey[];

export type OverrideTemplateKey = (typeof OVERRIDE_TEMPLATE_KEYS)[number];

export type TemplateOverrides =
  | { templateKey: "comparison-stunning"; values: ComparisonStunningOverrides }
  | { templateKey: "comparison-stunning-3"; values: ComparisonStunningOverrides }
  | { templateKey: "single-tool-spotlight"; values: SingleToolSpotlightOverrides }
  | { templateKey: "use-case-verdict-per-tool"; values: UseCaseVerdictOverrides };

export function getOverrideSchema(templateKey: OverrideTemplateKey): z.ZodObject<z.ZodRawShape> {
  switch (templateKey) {
    case "comparison-stunning":
    case "comparison-stunning-3":
      return comparisonStunningOverridesSchema;
    case "single-tool-spotlight":
      return singleToolSpotlightOverridesSchema;
    case "use-case-verdict-per-tool":
      return useCaseVerdictOverridesSchema;
  }
}

export function isOverrideTemplateKey(key: string): key is OverrideTemplateKey {
  return (OVERRIDE_TEMPLATE_KEYS as readonly string[]).includes(key);
}

/**
 * Merge stored override values with schema defaults.
 * Unknown keys are stripped via .strip() on each schema.
 * When storedValues is undefined/null, all schema defaults are applied.
 */
export function mergeOverrides<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  storedValues: Record<string, unknown> | null | undefined,
): z.infer<T> {
  return schema.parse(storedValues ?? {});
}
