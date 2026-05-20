// Spec 62.0a Section 7 + Section 10 risk register:
// Emit ONE "step_paused" notification per pipeline_run_id so multiple paused steps
// in the same run don't fire repeat notifications. Coalesces by querying for an
// existing unread notification with matching metadata.pipelineRunId.
//
// Severity is "info" — step-pause is an intentional debug-mode signal, not a problem.
// We do NOT fire Web Push (that's reserved for severity="critical" like cost-limit).

import { and, db, eq, isNull, notifications, projects, sql, users } from "@marketing-auto/db";
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
 * Idempotent at the (pipelineRunId, owner) level: if an unread step_paused notification
 * already exists for this run, no second notification is created.
 *
 * Spec 62.0a Section 7 + Section 10. Safe to swallow errors — failure here must not
 * affect the pipeline's suspended-state machine.
 */
export async function notifyStepPaused(input: NotifyStepPausedInput): Promise<void> {
  try {
    // Coalesce: existing unread step_paused notification for THIS run already covers it.
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, STEP_PAUSED_NOTIFICATION_TYPE),
          isNull(notifications.readAt),
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
