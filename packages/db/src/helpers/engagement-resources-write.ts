/**
 * Spec 65.1 — engagement_resources write helpers.
 */
import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type EngagementResource,
  type NewEngagementResource,
  engagementResources,
} from "../schema/engagement-resources.ts";

export async function createEngagementResource(
  input: NewEngagementResource
): Promise<EngagementResource> {
  const rows = await db.insert(engagementResources).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("createEngagementResource: INSERT returned no row");
  return row;
}

export async function updateEngagementResource(
  id: string,
  patch: Partial<NewEngagementResource>
): Promise<EngagementResource | null> {
  const rows = await db
    .update(engagementResources)
    .set(patch)
    .where(eq(engagementResources.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deleteEngagementResource(id: string): Promise<void> {
  await db.delete(engagementResources).where(eq(engagementResources.id, id));
}
