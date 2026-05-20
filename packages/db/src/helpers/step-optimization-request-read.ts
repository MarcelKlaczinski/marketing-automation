import { and, desc, eq } from "drizzle-orm";
import { db } from "../client.ts";
import {
  stepOptimizationRequests,
  type StepOptimizationRequest,
} from "../schema/operations.ts";

export type OptimizationRequestStatus = "open" | "addressed" | "discarded";

/**
 * Optimization requests for a project, newest first. Optional status filter.
 * Backs GET /projects/:slug/optimization-requests.
 */
export async function listOptimizationRequestsForProject(input: {
  projectId: string;
  status?: OptimizationRequestStatus;
}): Promise<StepOptimizationRequest[]> {
  const projectFilter = eq(stepOptimizationRequests.projectId, input.projectId);
  const statusFilter = input.status
    ? eq(stepOptimizationRequests.status, input.status)
    : undefined;
  return db
    .select()
    .from(stepOptimizationRequests)
    .where(statusFilter ? and(projectFilter, statusFilter) : projectFilter)
    .orderBy(desc(stepOptimizationRequests.requestedAt));
}

export async function getOptimizationRequestById(
  id: string
): Promise<StepOptimizationRequest | null> {
  const rows = await db
    .select()
    .from(stepOptimizationRequests)
    .where(eq(stepOptimizationRequests.id, id))
    .limit(1);
  return rows[0] ?? null;
}
