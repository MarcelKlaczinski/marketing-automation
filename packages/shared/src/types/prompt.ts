import { z } from "zod";

/**
 * Spec 62.0b: status lifecycle for a step_optimization_request.
 * - `open`      : default; the request is unresolved.
 * - `addressed` : Marcel acted on it (e.g. promoted a new golden, fixed the step's prompt).
 * - `discarded` : noise; the user closed it without action.
 *
 * Plain string column at the DB layer (not a pgEnum) so future statuses can be added
 * without a DDL migration.
 */
export const OPTIMIZATION_REQUEST_STATUSES = ["open", "addressed", "discarded"] as const;
export const optimizationRequestStatusSchema = z.enum(OPTIMIZATION_REQUEST_STATUSES);
export type OptimizationRequestStatus = z.infer<typeof optimizationRequestStatusSchema>;

/**
 * Body of PATCH /api/optimization-requests/:id.
 * Status can only transition to a terminal state (addressed | discarded) — re-opening
 * is not supported in 62.0b (would need explicit UI affordance).
 */
export const updateOptimizationRequestPayloadSchema = z.object({
  status: z.enum(["addressed", "discarded"] as const),
  addressedNote: z.string().max(4000).optional(),
});
export type UpdateOptimizationRequestPayload = z.infer<
  typeof updateOptimizationRequestPayloadSchema
>;
