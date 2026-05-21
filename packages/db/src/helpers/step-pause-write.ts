import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "../client.ts";
import { pipelineRuns } from "../schema/operations.ts";
import { type NewStepPause, type StepPause, stepPauses } from "../schema/operations.ts";

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
export async function resolveStepPause(input: ResolveStepPauseInput): Promise<StepPause | null> {
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
 * Spec 62.6 §6.8: auto-dismiss any unresolved pauses on the rerun target step + later
 * steps in the same pipeline run. The current pause being rerun is resolved separately
 * (action='rerun') via the normal atomic UPDATE so the snapshot survives.
 */
export async function autoDismissPausesForSteps(args: {
  pipelineRunId: string;
  stepNames: string[];
  reason: string;
}): Promise<number> {
  if (args.stepNames.length === 0) return 0;
  const rows = await db
    .update(stepPauses)
    .set({
      action: "auto-dismissed",
      resolvedAt: new Date(),
      resolvedBy: "system",
      userNote: `Rerun cleanup: ${args.reason}`,
    })
    .where(
      and(
        eq(stepPauses.pipelineRunId, args.pipelineRunId),
        inArray(stepPauses.stepName, args.stepNames),
        isNull(stepPauses.resolvedAt)
      )
    )
    .returning({ id: stepPauses.id });
  return rows.length;
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

/**
 * Spec 62.6 §6.8: mark child step-run rows for a set of step names as `superseded`.
 * Used by rerun cleanup to invalidate any later step outputs cached as child
 * pipeline_runs rows. Operates on all non-terminal child rows in one statement.
 */
export async function supersedeStepRunsForSteps(args: {
  parentRunId: string;
  stepNames: string[];
}): Promise<number> {
  if (args.stepNames.length === 0) return 0;
  const rows = await db
    .update(pipelineRuns)
    .set({ status: "superseded", completedAt: new Date() })
    .where(
      and(
        eq(pipelineRuns.parentRunId, args.parentRunId),
        inArray(pipelineRuns.stepName, args.stepNames),
        inArray(pipelineRuns.status, [
          "queued",
          "running",
          "batch_pending",
          "paused",
          "completed",
        ] as const)
      )
    )
    .returning({ id: pipelineRuns.id });
  return rows.length;
}

/**
 * Section 4.5.1: mark prior in-flight substeps as `superseded` before the runner
 * re-executes a step (batch-resume, edit-input, edit-prompt). Targets only substep
 * rows (parent_run_id = parentRunId AND step_name = stepName) that are still in a
 * non-terminal state. Returns the number of rows transitioned.
 */
export async function supersedeOldSubstep(parentRunId: string, stepName: string): Promise<number> {
  const rows = await db
    .update(pipelineRuns)
    .set({ status: "superseded", completedAt: new Date() })
    .where(
      and(
        eq(pipelineRuns.parentRunId, parentRunId),
        eq(pipelineRuns.stepName, stepName),
        inArray(pipelineRuns.status, ["running", "batch_pending", "paused"] as const)
      )
    )
    .returning({ id: pipelineRuns.id });
  return rows.length;
}

/**
 * Cleanup-worker variant: find stuck substep rows across ALL parent runs and mark
 * them `superseded`. A substep is "stuck" when status='running', step_name IS NOT NULL,
 * and started_at is older than the cutoff. Returns the number of rows reaped.
 *
 * Defense-in-depth for Section 4.5.3 — handles process-kill scenarios where the
 * runner-level supersedeOldSubstep was never reached.
 */
export async function reapStuckSubsteps(cutoff: Date): Promise<number> {
  const rows = await db
    .update(pipelineRuns)
    .set({ status: "superseded", completedAt: new Date() })
    .where(
      and(
        eq(pipelineRuns.status, "running"),
        // Substeps only — parent rows have step_name = NULL.
        isNotNull(pipelineRuns.stepName),
        // Date → ISO string per the SQL Date-Binding Convention in root CLAUDE.md.
        // lt(col, Date) is fine — Drizzle's typed operators serialize Date correctly.
        lt(pipelineRuns.startedAt, cutoff)
      )
    )
    .returning({ id: pipelineRuns.id });
  return rows.length;
}
