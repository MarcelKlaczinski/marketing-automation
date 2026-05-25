/**
 * Spec 65.1 — engagement_resources read helpers.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type EngagementResource,
  type EngagementResourceType,
  engagementResources,
} from "../schema/engagement-resources.ts";

export async function getEngagementResource(id: string): Promise<EngagementResource | null> {
  const rows = await db
    .select()
    .from(engagementResources)
    .where(eq(engagementResources.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Comment-to-get DM responder hot-path. (project_id, keyword) is UNIQUE so
 * at most one row matches per call.
 */
export async function getEngagementResourceByKeyword(input: {
  projectId: string;
  keyword: string;
}): Promise<EngagementResource | null> {
  const rows = await db
    .select()
    .from(engagementResources)
    .where(
      and(
        eq(engagementResources.projectId, input.projectId),
        eq(engagementResources.keyword, input.keyword)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listEngagementResources(filters: {
  projectId: string;
  resourceType?: EngagementResourceType;
}): Promise<EngagementResource[]> {
  const conditions = [eq(engagementResources.projectId, filters.projectId)];
  if (filters.resourceType !== undefined) {
    conditions.push(eq(engagementResources.resourceType, filters.resourceType));
  }
  return await db
    .select()
    .from(engagementResources)
    .where(and(...conditions))
    .orderBy(asc(engagementResources.createdAt));
}
