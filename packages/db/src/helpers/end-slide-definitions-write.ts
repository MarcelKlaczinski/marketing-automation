/**
 * Spec 65.1 — end_slide_definitions write helpers.
 */
import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import {
  type EndSlideDefinition,
  type NewEndSlideDefinition,
  endSlideDefinitions,
} from "../schema/end-slide-definitions.ts";

export async function createEndSlideDefinition(
  input: NewEndSlideDefinition
): Promise<EndSlideDefinition> {
  const rows = await db.insert(endSlideDefinitions).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error("createEndSlideDefinition: INSERT returned no row");
  return row;
}

export async function updateEndSlideDefinition(
  id: string,
  patch: Partial<NewEndSlideDefinition>
): Promise<EndSlideDefinition | null> {
  const rows = await db
    .update(endSlideDefinitions)
    .set(patch)
    .where(eq(endSlideDefinitions.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function setEndSlideActive(id: string, isActive: boolean): Promise<void> {
  await db.update(endSlideDefinitions).set({ isActive }).where(eq(endSlideDefinitions.id, id));
}
