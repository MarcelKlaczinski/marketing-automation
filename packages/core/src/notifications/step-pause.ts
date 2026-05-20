// Spec 62.0a Section 7 + Section 10 risk register:
// Emit ONE "step_paused" notification per pipeline_run_id so multiple paused steps
// in the same run don't fire repeat notifications. Coalesces by querying for an
// existing unread notification with matching metadata.pipelineRunId.
//
// Severity is "info" — step-pause is an intentional debug-mode signal, not a problem.
// We do NOT fire Web Push (that's reserved for severity="critical" like cost-limit).

import { and, db, eq, notifications, projects, sql, users } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { createNotification } from "./index.ts";

const log = createLogger("notifications:step-pause");

/** Stable notification type string for the step-pause flow. */
export const STEP_PAUSED_NOTIFICATION_TYPE = "step_paused";

export interface NotifyStepPausedInput {
  projectId: string;
  pipelineRunId: string;
  pipelineName: string;
  stepName: string;
  stepPauseId: string;
}

/**
 * Fire-and-forget notification fan-out for the project's owners.
 * Idempotent at the pipelineRunId level: max 1 notification per run, EVER (Spec Section 10
 * risk-register). Once the user has been told a run paused, additional pauses in the same
 * run don't fire new notifications — the user can open the paused-runs view to see them all.
 *
 * Safe to swallow errors — failure here must not affect the pipeline's suspended-state machine.
 */
export async function notifyStepPaused(input: NotifyStepPausedInput): Promise<void> {
  try {
    // Coalesce per spec Section 10: max 1 notification per pipelineRunId regardless of
    // read state. Read notifications still count — the user has already been informed
    // about this run; subsequent pauses are visible inside the run's paused-steps view.
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, STEP_PAUSED_NOTIFICATION_TYPE),
          sql`${notifications.metadata}->>'pipelineRunId' = ${input.pipelineRunId}`
        )
      )
      .limit(1);
    if (existing.length > 0) return;

    const [project] = await db
      .select({ slug: projects.slug, name: projects.name })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, "owner"));
    if (owners.length === 0) return;

    const projectName = project?.name ?? "Project";
    const link = project?.slug ? `/projects/${project.slug}/paused-runs` : "/inbox";

    for (const owner of owners) {
      await createNotification({
        userId: owner.id,
        type: STEP_PAUSED_NOTIFICATION_TYPE,
        severity: "info",
        title: `${projectName}: pipeline paused at "${input.stepName}"`,
        message: `Run ${input.pipelineRunId.slice(0, 8)} (${input.pipelineName}) is waiting for your review.`,
        link,
        metadata: {
          projectId: input.projectId,
          pipelineRunId: input.pipelineRunId,
          pipelineName: input.pipelineName,
          stepName: input.stepName,
          stepPauseId: input.stepPauseId,
        },
      });
    }
  } catch (err) {
    log.warn(
      { err, pipelineRunId: input.pipelineRunId },
      "notifyStepPaused failed — suspended pipeline state is unaffected"
    );
  }
}
