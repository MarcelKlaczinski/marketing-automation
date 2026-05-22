// Spec 64.14: per-project planner config types shared between API + planner +
// pipelines packages. Lives in shared so the planner Zod gate, the API route
// validator, and the SelectOverageItemsStep can all import it without crossing
// the cost-tracker / pipelines boundary.

import { z } from "zod";

/**
 * Planner content_type values that an external signal can be mapped to. Kept
 * in sync with `PLANNING_CONTENT_TYPES` in
 * `packages/pipelines/src/planning/types.ts` (Spec 64.1).
 *
 * Duplicated here on purpose: `@marketing-auto/shared` cannot depend on
 * `@marketing-auto/pipelines`. The values are stable enough (5 entries since
 * 64.1) that drift is unlikely; if a new content_type lands, extend both lists
 * in the same PR. The mismatch would surface in the Zod parse at the HTTP
 * boundary so the failure mode is loud, not silent.
 */
const SIGNAL_CONTENT_TYPE_VALUES = [
  "cluster",
  "cluster_spoke",
  "comparison",
  "social_post",
  "ki_wissen",
] as const;

export const signalSourceContentTypeMapSchema = z
  .record(z.string(), z.enum(SIGNAL_CONTENT_TYPE_VALUES).nullable())
  .describe(
    "Per-project override for inferContentTypeFromSignal. Source key absent = fall back to default. Value null = skip overage emission for that source.",
  );

export type SignalSourceContentTypeMap = z.infer<
  typeof signalSourceContentTypeMapSchema
>;
