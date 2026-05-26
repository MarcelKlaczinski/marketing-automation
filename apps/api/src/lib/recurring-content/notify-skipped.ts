/**
 * Spec 65.5 — Admin notification for a skipped recurring-content brief.
 *
 * Per Marcel-Decision §0 + spec §10 Risk Q1, when a recurring brief is
 * skipped (brand-assets missing / no hook / insufficient tools) we surface
 * an admin notification so Marcel sees the rhythm-gap without polling the
 * UI. Severity is `info` — none of the skip paths today are urgent enough
 * to warrant a Web Push interrupt.
 *
 * Fan-out shape mirrors `notifyToolDataRefreshBatch` (Spec 65.3 Part B):
 * one notification per `users.role='owner'`, fire-and-forget, errors
 * swallowed in try/catch so a failed dispatch never escalates into a
 * pipeline failure.
 */
import { createNotification } from "@marketing-auto/core/notifications";
import { db, eq, projects, users } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("recurring-content:notify-skipped");

const NOTIFICATION_TYPE = "recurring_content.skipped";

export interface NotifyRecurringBriefSkippedInput {
  projectId: string;
  definitionId: string;
  definitionName: string;
  reason: "brand-assets-missing" | "insufficient-tools" | "no-hook" | "inactive-definition";
  missingToolIds?: string[];
  detail?: string;
}

// Backend-generated admin notifications stay English to match the existing
// `notify-batch.ts` convention (Spec 65.3 Part B). The notification panel
// renders these directly without i18n routing — admins read them as-is.
const REASON_LABEL: Record<NotifyRecurringBriefSkippedInput["reason"], string> = {
  "brand-assets-missing": "Brand assets missing for one or more tools",
  "insufficient-tools": "Tool pool too small for the Top-N selection",
  "no-hook": "No hooks registered for (formatType, locale) in the library",
  "inactive-definition": "Definition was deactivated",
};

export async function notifyRecurringBriefSkipped(
  input: NotifyRecurringBriefSkippedInput,
): Promise<void> {
  if (!getEnv().PIPELINE_NOTIFICATIONS_ENABLED) return;

  try {
    const [project] = await db
      .select({ slug: projects.slug, name: projects.name })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) {
      log.warn({ projectId: input.projectId }, "notifyRecurringBriefSkipped: project not found");
      return;
    }

    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"));
    if (owners.length === 0) return;

    const title = `Recurring brief skipped: ${input.definitionName}`;
    const messageLines = [
      `Definition: ${input.definitionName}`,
      `Project: ${project.name}`,
      `Reason: ${REASON_LABEL[input.reason]}`,
    ];
    if (input.detail) messageLines.push(`Details: ${input.detail}`);
    if (input.missingToolIds && input.missingToolIds.length > 0) {
      messageLines.push(`Missing tool IDs (${input.missingToolIds.length}):`);
      for (const id of input.missingToolIds.slice(0, 5)) {
        messageLines.push(`• ${id}`);
      }
      if (input.missingToolIds.length > 5) {
        messageLines.push(`… and ${input.missingToolIds.length - 5} more.`);
      }
    }

    const message = messageLines.join("\n");
    const link = `/projects/${project.slug}/settings/planner`;

    for (const owner of owners) {
      await createNotification({
        userId: owner.id,
        type: NOTIFICATION_TYPE,
        severity: "info",
        title,
        message,
        link,
        metadata: {
          projectId: input.projectId,
          definitionId: input.definitionId,
          reason: input.reason,
          ...(input.missingToolIds && { missingToolIds: input.missingToolIds }),
        },
      });
    }
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        definitionId: input.definitionId,
        err: err instanceof Error ? err.message : String(err),
      },
      "notifyRecurringBriefSkipped failed — recurring run unaffected",
    );
  }
}
