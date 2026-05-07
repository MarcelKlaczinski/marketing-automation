import { db, projectPauseStates, projects, users } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { createNotification } from "../notifications/index.ts";

const log = createLogger("cost-enforcement");

export interface PauseInfo {
  pausedAt: string;
  reason: string;
  reasonDetails: Record<string, unknown>;
  service: string | null;
}

// Injectable queue pauser: set by packages/pipelines at worker startup to avoid circular deps.
let _queuePauseFn: ((projectId: string) => Promise<void>) | null = null;
let _queueResumeFn: ((projectId: string) => Promise<void>) | null = null;

export function registerQueuePauser(
  pauseFn: (projectId: string) => Promise<void>,
  resumeFn: (projectId: string) => Promise<void>
): void {
  _queuePauseFn = pauseFn;
  _queueResumeFn = resumeFn;
}

export async function pauseProjectQueues(
  projectId: string,
  reason: string,
  reasonDetails: Record<string, unknown>,
  service: string | null,
  pausedBy?: string
): Promise<void> {
  // Build insert and update objects conditionally (exactOptionalPropertyTypes:
  // nullable columns require null not undefined)
  const insertBase = {
    projectId,
    reason,
    reasonDetails,
    service,
    createdAt: new Date(),
    pausedAt: new Date(),
  };
  const insertRow: typeof projectPauseStates.$inferInsert =
    pausedBy !== undefined ? { ...insertBase, pausedBy } : insertBase;

  const updateBase = {
    reason,
    reasonDetails,
    service,
    pausedAt: new Date(),
  };
  const updateSet: Partial<typeof projectPauseStates.$inferInsert> =
    pausedBy !== undefined ? { ...updateBase, pausedBy } : updateBase;

  await db.insert(projectPauseStates).values(insertRow).onConflictDoUpdate({
    target: projectPauseStates.projectId,
    set: updateSet,
  });

  if (_queuePauseFn) {
    await _queuePauseFn(projectId).catch((err: unknown) => {
      log.warn(
        { err, projectId },
        "Queue pause failed — DB pause state saved, manual resume required"
      );
    });
  }

  log.warn({ projectId, reason, service }, "Project queues paused");

  // Notify all owners (critical — triggers Web Push)
  const [project] = await db
    .select({ slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, "owner"));

  for (const owner of owners) {
    void createNotification({
      userId: owner.id,
      type: "cost_limit_pause",
      severity: "critical",
      title: "Project pipeline paused",
      message: `${project?.name ?? "Project"} paused due to cost limit (${service ?? "unknown"}).`,
      link: project?.slug ? `/projects/${project.slug}` : "/cost",
      metadata: { projectId, reason, service, ...reasonDetails },
    });
  }
}

export async function resumeProjectQueues(projectId: string, resumedBy?: string): Promise<void> {
  await db.delete(projectPauseStates).where(eq(projectPauseStates.projectId, projectId));

  if (_queueResumeFn) {
    await _queueResumeFn(projectId).catch((err: unknown) => {
      log.warn(
        { err, projectId },
        "Queue resume failed — DB pause state already cleared, retry queue.resume() manually"
      );
    });
  }

  log.info({ projectId, resumedBy }, "Project queues resumed");
}

export async function isProjectPaused(projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ projectId: projectPauseStates.projectId })
    .from(projectPauseStates)
    .where(eq(projectPauseStates.projectId, projectId))
    .limit(1);
  return row !== undefined;
}

export async function getPauseInfo(projectId: string): Promise<PauseInfo | null> {
  const [row] = await db
    .select()
    .from(projectPauseStates)
    .where(eq(projectPauseStates.projectId, projectId))
    .limit(1);
  if (!row) return null;
  return {
    pausedAt: row.pausedAt.toISOString(),
    reason: row.reason,
    // reasonDetails is $type<Record<string,unknown>> on the column but Drizzle's jsonb
    // inference widens to unknown at the return site; ?? {} handles null; cast is safe
    reasonDetails: (row.reasonDetails ?? {}) as Record<string, unknown>,
    service: row.service ?? null,
  };
}
