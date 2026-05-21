import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../client.ts";
import { projectGoals, type ProjectGoal } from "../schema/operations.ts";

export interface GoalInput {
  id?: string;
  contentType: string;
  cadenceUnit: "per_day" | "per_week";
  minCount: number;
  maxCount: number | null;
  isActive?: boolean;
  note?: string | null;
}

export interface ReplaceProjectGoalsResult {
  inserted: ProjectGoal[];
  updated: ProjectGoal[];
  /** Active rows that were soft-deleted (set to is_active=false). */
  deactivated: ProjectGoal[];
}

/**
 * Spec 62.2: PUT-style upsert for the full active-goal set.
 *
 * Diff logic against active rows:
 *   - Goal in body, no active DB row for same content_type → INSERT
 *   - Goal in body, active DB row exists → UPDATE the existing row (preserves id + created_at)
 *   - Active DB row whose content_type is NOT in body → UPDATE is_active=false (soft delete)
 *
 * Wrapped in a transaction so partial failures roll back.
 */
export async function replaceProjectGoals(input: {
  projectId: string;
  goals: GoalInput[];
}): Promise<ReplaceProjectGoalsResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(projectGoals)
      .where(
        and(eq(projectGoals.projectId, input.projectId), eq(projectGoals.isActive, true))
      );
    const existingByType = new Map(existing.map((g) => [g.contentType, g] as const));
    const incomingTypes = new Set(input.goals.map((g) => g.contentType));

    const inserted: ProjectGoal[] = [];
    const updated: ProjectGoal[] = [];
    const deactivated: ProjectGoal[] = [];
    const now = new Date();

    for (const goal of input.goals) {
      const match = existingByType.get(goal.contentType);
      if (match) {
        const rows = await tx
          .update(projectGoals)
          .set({
            cadenceUnit: goal.cadenceUnit,
            minCount: goal.minCount,
            maxCount: goal.maxCount,
            note: goal.note ?? null,
            isActive: true,
            updatedAt: now,
          })
          .where(eq(projectGoals.id, match.id))
          .returning();
        if (rows[0]) updated.push(rows[0]);
      } else {
        const rows = await tx
          .insert(projectGoals)
          .values({
            projectId: input.projectId,
            contentType: goal.contentType,
            cadenceUnit: goal.cadenceUnit,
            minCount: goal.minCount,
            maxCount: goal.maxCount,
            isActive: true,
            note: goal.note ?? null,
          })
          .returning();
        if (rows[0]) inserted.push(rows[0]);
      }
    }

    const toDeactivate = existing
      .filter((g) => !incomingTypes.has(g.contentType))
      .map((g) => g.id);
    if (toDeactivate.length > 0) {
      const rows = await tx
        .update(projectGoals)
        .set({ isActive: false, updatedAt: now })
        .where(inArray(projectGoals.id, toDeactivate))
        .returning();
      deactivated.push(...rows);
    }

    return { inserted, updated, deactivated };
  });
}

export interface PatchProjectGoalInput {
  id: string;
  projectId: string;
  cadenceUnit?: "per_day" | "per_week";
  minCount?: number;
  maxCount?: number | null;
  isActive?: boolean;
  note?: string | null;
}

/** PATCH a single goal row. Returns the updated row, or null if not found / wrong project. */
export async function patchProjectGoal(
  input: PatchProjectGoalInput
): Promise<ProjectGoal | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.cadenceUnit !== undefined) set.cadenceUnit = input.cadenceUnit;
  if (input.minCount !== undefined) set.minCount = input.minCount;
  if (input.maxCount !== undefined) set.maxCount = input.maxCount;
  if (input.isActive !== undefined) set.isActive = input.isActive;
  if (input.note !== undefined) set.note = input.note;

  const rows = await db
    .update(projectGoals)
    .set(set)
    .where(
      and(eq(projectGoals.id, input.id), eq(projectGoals.projectId, input.projectId))
    )
    .returning();
  return rows[0] ?? null;
}

/** Soft-delete: set is_active=false. Returns true when a row was affected. */
export async function softDeleteProjectGoal(input: {
  id: string;
  projectId: string;
}): Promise<boolean> {
  const rows = await db
    .update(projectGoals)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(projectGoals.id, input.id),
        eq(projectGoals.projectId, input.projectId),
        isNotNull(projectGoals.id)
      )
    )
    .returning({ id: projectGoals.id });
  return rows.length > 0;
}
