/**
 * Spec 65.3 Part B — batched admin notification for a refresh tick.
 *
 * Mirrors the Spec 64.11 `notifyPipelineCompletion` shape — fans out one
 * notification per owner-role user, fire-and-forget. The notification body
 * summarises N tools refreshed + M material changes; if at least one
 * material change fired, the severity is `critical` (triggers Web Push).
 * Otherwise it's `info` (SSE only).
 *
 * Per Memory D21 — batch every tick instead of per-tool to prevent
 * notification fatigue. The cron pattern (every 6h, 5 tools/tick) bounds
 * the notification frequency at most 4×/day.
 */
import { createNotification } from "@marketing-auto/core/notifications";
import { db, eq, projects, users } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("tool-data-refresh:notify-batch");

const NOTIFICATION_TYPE = "tool_data_refresh.batch";

export interface NotifyBatchInput {
  projectId: string;
  tickStartedAt: string;
  refreshedCount: number;
  materialChanges: Array<{
    toolId: string;
    toolName: string;
    summary: string | null;
  }>;
  skippedCount: number;
  failedCount: number;
}

/**
 * Dispatch the batch notification. Returns silently when:
 *   - `PIPELINE_NOTIFICATIONS_ENABLED=false` (kill-switch)
 *   - No owners exist (single-user installs that haven't seeded a user yet)
 *   - `refreshedCount === 0` AND no material changes / failures (nothing to say)
 *
 * Errors are caught + logged — a notification failure must NEVER break the
 * refresh tick.
 */
export async function notifyToolDataRefreshBatch(input: NotifyBatchInput): Promise<void> {
  if (!getEnv().PIPELINE_NOTIFICATIONS_ENABLED) return;
  if (input.refreshedCount === 0 && input.materialChanges.length === 0 && input.failedCount === 0) {
    return;
  }

  try {
    const [project] = await db
      .select({ slug: projects.slug, name: projects.name })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) {
      log.warn({ projectId: input.projectId }, "notifyToolDataRefreshBatch: project not found");
      return;
    }

    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"));
    if (owners.length === 0) return;

    const materialCount = input.materialChanges.length;
    const severity = materialCount > 0 ? "critical" : "info";

    const title =
      materialCount > 0
        ? `${materialCount} tool${materialCount === 1 ? "" : "s"} changed in ${project.name}`
        : `Tool-data refresh: ${input.refreshedCount} tool${input.refreshedCount === 1 ? "" : "s"} updated`;

    const messageLines: string[] = [];
    if (materialCount > 0) {
      messageLines.push(`Material changes (${materialCount}):`);
      for (const m of input.materialChanges.slice(0, 5)) {
        messageLines.push(`• ${m.toolName}: ${m.summary ?? "see audit log"}`);
      }
      if (materialCount > 5) {
        messageLines.push(`… and ${materialCount - 5} more.`);
      }
      messageLines.push("");
    }
    messageLines.push(
      `${input.refreshedCount} tools refreshed (${input.skippedCount} skipped, ${input.failedCount} failed).`
    );

    const message = messageLines.join("\n");
    const link = `/projects/${project.slug}/settings/persona-scoring`;

    for (const owner of owners) {
      await createNotification({
        userId: owner.id,
        type: NOTIFICATION_TYPE,
        severity,
        title,
        message,
        link,
        metadata: {
          projectId: input.projectId,
          tickStartedAt: input.tickStartedAt,
          refreshedCount: input.refreshedCount,
          materialCount,
          skippedCount: input.skippedCount,
          failedCount: input.failedCount,
        },
      });
    }
  } catch (err) {
    log.warn(
      {
        projectId: input.projectId,
        err: err instanceof Error ? err.message : String(err),
      },
      "notifyToolDataRefreshBatch failed — tool-data refresh unaffected"
    );
  }
}
