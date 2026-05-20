import { and, eq, isNull } from "drizzle-orm";
import { db } from "../client.ts";
import { stepPauses, type NewStepPause, type StepPause } from "../schema/operations.ts";

export interface PersistStepPauseInput {
  pipelineRunId: string;
  stepRunId: string;
  stepName: string;
  pipelineName: string;
  projectId: string;
  stepInput: Record<string, unknown>;
  stepOutput: Record<string, unknown>;
  promptUsed: string | null;
}

/**
 * Persist a new pause cycle at suspend time.
 * UNIQUE(step_run_id) prevents duplicates if the runner is re-entered.
 */
export async function persistStepPause(input: PersistStepPauseInput): Promise<StepPause> {
  const values: NewStepPause = {
    pipelineRunId: input.pipelineRunId,
    stepRunId: input.stepRunId,
    stepName: input.stepName,
    pipelineName: input.pipelineName,
    projectId: input.projectId,
    stepInput: input.stepInput,
    stepOutput: input.stepOutput,
    promptUsed: input.promptUsed,
  };
  const rows = await db
    .insert(stepPauses)
    .values(values)
    .onConflictDoNothing({ target: stepPauses.stepRunId })
    .returning();
  if (rows[0]) return rows[0];
  // Conflict path: another caller already persisted — fetch the existing row.
  const existing = await db
    .select()
    .from(stepPauses)
    .where(eq(stepPauses.stepRunId, input.stepRunId))
    .limit(1);
  if (!existing[0]) throw new Error(`step_pauses row missing for stepRunId ${input.stepRunId}`);
  return existing[0];
}

export interface ResolveStepPauseInput {
  stepPauseId: string;
  action: string;
  editedInput?: Record<string, unknown>;
  editedOutput?: Record<string, unknown>;
  editedPrompt?: string;
  userNote?: string;
  resolvedBy: string;
}

/**
 * Atomically resolve a pause. Returns the resolved row or null when the row
 * was already resolved (race between two callers).
 */
export async function resolveStepPause(
  input: ResolveStepPauseInput
): Promise<StepPause | null> {
  const update: Partial<NewStepPause> = {
    action: input.action,
    resolvedAt: new Date(),
    resolvedBy: input.resolvedBy,
  };
  if (input.editedInput !== undefined) update.editedInput = input.editedInput;
  if (input.editedOutput !== undefined) update.editedOutput = input.editedOutput;
  if (input.editedPrompt !== undefined) update.editedPrompt = input.editedPrompt;
  if (input.userNote !== undefined) update.userNote = input.userNote;

  const rows = await db
    .update(stepPauses)
    .set(update)
    .where(and(eq(stepPauses.id, input.stepPauseId), isNull(stepPauses.resolvedAt)))
    .returning();
  return rows[0] ?? null;
}

/**
 * Section 4.5.2: auto-dismiss all unresolved pauses for a pipeline run when the
 * parent transitions to cancelled / failed / superseded.
 */
export async function autoDismissStepPauses(
  pipelineRunId: string,
  reason: string
): Promise<number> {
  const rows = await db
    .update(stepPauses)
    .set({
      action: "auto-dismissed",
      resolvedAt: new Date(),
      resolvedBy: "system",
      userNote: `Parent run ${reason}`,
    })
    .where(and(eq(stepPauses.pipelineRunId, pipelineRunId), isNull(stepPauses.resolvedAt)))
    .returning({ id: stepPauses.id });
  return rows.length;
}
