// Spec 64.11 Fix B: Pipeline-Completion Push-Notifications
//
// Fires from BullMQ `worker.on('completed' | 'failed')` listeners for long-running
// pipelines (`article:blog`, `social-render`). Success → severity="info" (SSE only).
// Failure → severity="critical" so Web Push wakes Marcel up on his phone.
//
// Mirrors the `notifyStepPaused` pattern (sibling file): fan-out per project
// owner, build a deep link from `projects.slug`, wrap everything in try/catch
// so notification failures never escalate into worker job failures.
//
// Out of scope per Spec §2 deviation:
//   • `cluster:full-plan` — not a registered BullMQ pipeline; runs inline via
//     `runClusterFullPlanFromBrief`. Successful spokes already fire their own
//     `article:blog` notification, so the cluster-level event is redundant.

import { and, articles, db, eq, notifications, projects, sql, users } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { createNotification } from "./index.ts";

const log = createLogger("notifications:pipeline-completion");

export const PIPELINE_COMPLETED_NOTIFICATION_TYPE = "pipeline_completed";

export type PipelineCompletionPipelineName =
  | "article:blog"
  | "social-render";

export type PipelineCompletionStatus = "success" | "failed";

export interface PipelineCompletionInput {
  pipelineName: PipelineCompletionPipelineName;
  projectId: string;
  /** BullMQ job id — for traceability in notification metadata. */
  pipelineRunId: string;
  /** Article context — required for article:blog; optional for social-render. */
  articleId?: string | null;
  /** social-render only. */
  socialPostId?: string | null;
  status: PipelineCompletionStatus;
  /** Failure reason; passed through to the notification body when status=failed. */
  errorMessage?: string;
}

interface NotificationFields {
  title: string;
  message: string;
  link: string;
  metadata: Record<string, unknown>;
}

/**
 * Fire-and-forget notification fan-out for the project's owners. Idempotent at
 * the (type, pipelineRunId) level — multiple successful retries of the same
 * BullMQ job (rare, but possible after a transient `failed → retry → completed`)
 * won't double-notify.
 *
 * Safe to swallow all errors — by the time this runs, the pipeline has already
 * persisted its terminal state. A notification dispatch failure is purely a
 * UX miss, never a correctness issue.
 */
export async function notifyPipelineCompletion(
  input: PipelineCompletionInput,
): Promise<void> {
  // Spec 64.11 kill-switch: PIPELINE_NOTIFICATIONS_ENABLED=false skips dispatch
  // without needing to redeploy. Default true — opt-out is the friction path.
  if (!getEnv().PIPELINE_NOTIFICATIONS_ENABLED) return;

  try {
    // Coalesce: max 1 notification per (type, pipelineRunId). Read-state-aware
    // semantics are intentional — once Marcel has been told, retries are silent.
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, PIPELINE_COMPLETED_NOTIFICATION_TYPE),
          sql`${notifications.metadata}->>'pipelineRunId' = ${input.pipelineRunId}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    const fields = await buildNotificationFields(input);
    if (!fields) return; // unresolved article/project — abort silently

    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"));
    if (owners.length === 0) return;

    const severity = input.status === "success" ? "info" : "critical";

    for (const owner of owners) {
      await createNotification({
        userId: owner.id,
        type: PIPELINE_COMPLETED_NOTIFICATION_TYPE,
        severity,
        title: fields.title,
        message: fields.message,
        link: fields.link,
        metadata: fields.metadata,
      });
    }
  } catch (err) {
    log.warn(
      { err, pipelineRunId: input.pipelineRunId, pipelineName: input.pipelineName },
      "notifyPipelineCompletion failed — pipeline state unaffected",
    );
  }
}

async function buildNotificationFields(
  input: PipelineCompletionInput,
): Promise<NotificationFields | null> {
  const [project] = await db
    .select({ slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!project) {
    log.warn({ projectId: input.projectId }, "project not found — skipping notification");
    return null;
  }

  const projectName = project.name ?? "Project";
  const projectSlug = project.slug ?? null;

  const sharedMetadata: Record<string, unknown> = {
    projectId: input.projectId,
    pipelineName: input.pipelineName,
    pipelineRunId: input.pipelineRunId,
    status: input.status,
    ...(input.articleId ? { articleId: input.articleId } : {}),
    ...(input.socialPostId ? { socialPostId: input.socialPostId } : {}),
  };

  switch (input.pipelineName) {
    case "article:blog": {
      if (!input.articleId) {
        log.warn({ input }, "article:blog completion missing articleId — skipping");
        return null;
      }
      const [article] = await db
        .select({ title: articles.title, slug: articles.slug })
        .from(articles)
        .where(eq(articles.id, input.articleId))
        .limit(1);
      const articleTitle = article?.title ?? "Untitled article";
      const articleSlug = article?.slug ?? null;

      const title =
        input.status === "success"
          ? `${projectName}: article ready — ${articleTitle}`
          : `${projectName}: article generation failed — ${articleTitle}`;
      const message =
        input.status === "success"
          ? "Tap to review."
          : (input.errorMessage ?? "Generation failed; check the pipeline-run detail page.");
      const link =
        projectSlug && articleSlug
          ? `/projects/${projectSlug}/articles/${articleSlug}`
          : projectSlug
            ? `/projects/${projectSlug}/articles`
            : "/inbox";
      return { title, message, link, metadata: sharedMetadata };
    }

    case "social-render": {
      if (!input.socialPostId) {
        log.warn({ input }, "social-render completion missing socialPostId — skipping");
        return null;
      }
      const title =
        input.status === "success"
          ? `${projectName}: social post rendered`
          : `${projectName}: social render failed`;
      const message =
        input.status === "success"
          ? "Tap to preview the slides."
          : (input.errorMessage ?? "Render failed; check the post detail.");
      const link =
        projectSlug
          ? `/projects/${projectSlug}/social`
          : "/inbox";
      return { title, message, link, metadata: sharedMetadata };
    }

    default: {
      const _exhaustive: never = input.pipelineName;
      void _exhaustive;
      return null;
    }
  }
}
