import { z } from "zod";
import {
  comparisonGridOverridesSchema,
  type ComparisonGridOverrides,
} from "./comparisonGrid.overrides.ts";
import {
  comparisonGrid3OverridesSchema,
  type ComparisonGrid3Overrides,
} from "./comparison-grid-3.overrides.ts";
import {
  comparisonGrid4OverridesSchema,
  type ComparisonGrid4Overrides,
} from "./comparison-grid-4.overrides.ts";
import {
  singleToolSpotlightOverridesSchema,
  type SingleToolSpotlightOverrides,
} from "./singleToolSpotlight.overrides.ts";
import {
  verdictPerUseCaseOverridesSchema,
  type VerdictPerUseCaseOverrides,
} from "./verdict-per-use-case.overrides.ts";
import {
  proConVerdictOverridesSchema,
  type ProConVerdictOverrides,
} from "./proConVerdict.overrides.ts";
import type { TemplateKey } from "../types.ts";

export {
  comparisonGridOverridesSchema,
  type ComparisonGridOverrides,
  comparisonGrid3OverridesSchema,
  type ComparisonGrid3Overrides,
  comparisonGrid4OverridesSchema,
  type ComparisonGrid4Overrides,
  singleToolSpotlightOverridesSchema,
  type SingleToolSpotlightOverrides,
  verdictPerUseCaseOverridesSchema,
  type VerdictPerUseCaseOverrides,
  proConVerdictOverridesSchema,
  type ProConVerdictOverrides,
};

// Keys with override schemas. Other TemplateKey values are not yet in production.
export const OVERRIDE_TEMPLATE_KEYS = [
  "comparison-grid-4",
  "comparison-grid-3",
  "single-tool-spotlight",
  "verdict-per-use-case",
  "pro-con-verdict",
] as const satisfies TemplateKey[];

export type OverrideTemplateKey = (typeof OVERRIDE_TEMPLATE_KEYS)[number];

export type TemplateOverrides =
  | { templateKey: "comparison-grid-4"; values: ComparisonGrid4Overrides }
  | { templateKey: "comparison-grid-3"; values: ComparisonGrid3Overrides }
  | { templateKey: "single-tool-spotlight"; values: SingleToolSpotlightOverrides }
  | { templateKey: "verdict-per-use-case"; values: VerdictPerUseCaseOverrides }
  | { templateKey: "pro-con-verdict"; values: ProConVerdictOverrides };

export function getOverrideSchema(templateKey: OverrideTemplateKey): z.ZodObject<z.ZodRawShape> {
  switch (templateKey) {
    case "comparison-grid-4":
      return comparisonGrid4OverridesSchema;
    case "comparison-grid-3":
      return comparisonGrid3OverridesSchema;
    case "single-tool-spotlight":
      return singleToolSpotlightOverridesSchema;
    case "verdict-per-use-case":
      return verdictPerUseCaseOverridesSchema;
    case "pro-con-verdict":
      return proConVerdictOverridesSchema;
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
