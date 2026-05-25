/**
 * Spec 65.1 + 65.4 — Format-Type registry barrel.
 *
 * Re-exports the registry shell (FormatTypeDefinition, FORMAT_TYPES,
 * helpers, FormatTypeKey) plus each v1 format-type's config schema + type +
 * canonical definition so callers can import the strict shape directly.
 */
export * from "./registry.ts";
export * from "./top-n-comparison.ts";
export * from "./head-to-head.ts";
export * from "./story-arc-clickbait.ts";
export * from "./lifestyle-listicle.ts";
export * from "./opinion-recommendation.ts";
