import { brandTokensSchema, type BrandTokens } from "@marketing-auto/shared/brand-tokens";

/**
 * Resolve loosely-typed composition input (brandTokens?: unknown) to a fully
 * validated BrandTokens object with all defaults applied. Called at the top
 * of each DS-refreshed slide component (Spec 60.1+).
 */
export function resolveBrandTokens(input: unknown): BrandTokens {
  return brandTokensSchema.parse(input ?? {});
}
