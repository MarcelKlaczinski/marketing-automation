/**
 * Spec 65.1 — end_slide_definitions read helpers.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../client.ts";
import { type EndSlideDefinition, endSlideDefinitions } from "../schema/end-slide-definitions.ts";

export async function getEndSlideDefinition(id: string): Promise<EndSlideDefinition | null> {
  const rows = await db
    .select()
    .from(endSlideDefinitions)
    .where(eq(endSlideDefinitions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listEndSlideDefinitions(filters: {
  projectId: string;
  type?: string;
  includeInactive?: boolean;
}): Promise<EndSlideDefinition[]> {
  const conditions = [eq(endSlideDefinitions.projectId, filters.projectId)];
  if (!filters.includeInactive) {
    conditions.push(eq(endSlideDefinitions.isActive, true));
  }
  if (filters.type !== undefined) {
    conditions.push(eq(endSlideDefinitions.type, filters.type));
  }
  return await db
    .select()
    .from(endSlideDefinitions)
    .where(and(...conditions))
    .orderBy(asc(endSlideDefinitions.createdAt));
}
