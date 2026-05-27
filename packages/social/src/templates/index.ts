export * from "./types.ts";
export * from "./registry.ts";
export * from "./bootstrap.ts";

// Spec 65.7-followup-2 — per-template render-snapshot builders used by the
// social-image pipeline's RenderSlidesStep to pre-build the full composition
// input (including `slideTotal`) as the persisted snapshot. Without these,
// the worker would receive a snapshot missing `slideTotal` and render 0 slides.
export { buildComparisonGrid3RenderSnapshot } from "./definitions/comparisonGrid3.ts";
export { buildComparisonGrid5RenderSnapshot } from "./definitions/comparisonGrid5.ts";
export { buildHeadToHeadVsRenderSnapshot } from "./definitions/headToHeadVs.ts";
export { buildHeadToHeadDeepDiveRenderSnapshot } from "./definitions/headToHeadDeepDive.ts";
export type { Grid3Context } from "./definitions/comparisonGrid3.ts";
export type { Grid5Context } from "./definitions/comparisonGrid5.ts";
export type { HeadToHeadVsContext } from "./definitions/headToHeadVs.ts";
export type { HeadToHeadDeepDiveContext } from "./definitions/headToHeadDeepDive.ts";
export type { FamilyATool } from "../compositions/_shared/family-a/types.ts";
