// Spec 62.8: thin wrappers around the planned_item status helpers that also
// fire-and-forget the SSE events expected by the Planner UI.
//
// The DB helpers (packages/db) intentionally have no dependency on
// `@marketing-auto/core/events` — events live in the pipelines layer because
// they're a presentation concern, not a data-layer concern. These wrappers
// are the canonical call sites for status transitions during plan execution.

import { publishPipelineEvent } from "@marketing-auto/core/events";
import {
  markPlannedItemBlocked,
  markPlannedItemCompleted,
  markPlannedItemEnqueued,
  markPlannedItemFailed,
  markPlannedItemInProgress,
  maybeFinalizePlanStatus,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pipelines:status-publisher");

function nowIso(): string {
  return new Date().toISOString();
}

export async function transitionItemEnqueued(input: {
  projectId: string;
  planId: string;
  itemId: string;
  pipelineRunId: string;
}): Promise<boolean> {
  const ok = await markPlannedItemEnqueued({
    itemId: input.itemId,
    pipelineRunId: input.pipelineRunId,
  });
  if (ok) {
    void publishPipelineEvent(input.projectId, {
      type: "plan.item.statusChanged",
      planId: input.planId,
      itemId: input.itemId,
      oldStatus: "pending",
      newStatus: "enqueued",
      pipelineRunId: input.pipelineRunId,
      timestamp: nowIso(),
    });
  }
  return ok;
}

export async function transitionItemInProgress(input: {
  projectId: string;
  planId: string;
  itemId: string;
}): Promise<boolean> {
  const ok = await markPlannedItemInProgress({ itemId: input.itemId });
  if (ok) {
    void publishPipelineEvent(input.projectId, {
      type: "plan.item.statusChanged",
      planId: input.planId,
      itemId: input.itemId,
      oldStatus: "enqueued",
      newStatus: "in_progress",
      timestamp: nowIso(),
    });
  }
  return ok;
}

export async function transitionItemCompleted(input: {
  projectId: string;
  planId: string;
  itemId: string;
}): Promise<boolean> {
  const ok = await markPlannedItemCompleted({ itemId: input.itemId });
  if (ok) {
    void publishPipelineEvent(input.projectId, {
      type: "plan.item.statusChanged",
      planId: input.planId,
      itemId: input.itemId,
      oldStatus: "in_progress",
      newStatus: "completed",
      timestamp: nowIso(),
    });
    await emitPlanStatusIfFinalized(input.projectId, input.planId);
  }
  return ok;
}

export async function transitionItemFailed(input: {
  projectId: string;
  planId: string;
  itemId: string;
  reason: string;
}): Promise<boolean> {
  const ok = await markPlannedItemFailed({ itemId: input.itemId, reason: input.reason });
  if (ok) {
    void publishPipelineEvent(input.projectId, {
      type: "plan.item.statusChanged",
      planId: input.planId,
      itemId: input.itemId,
      oldStatus: "in_progress",
      newStatus: "failed",
      failureReason: input.reason,
      timestamp: nowIso(),
    });
    await emitPlanStatusIfFinalized(input.projectId, input.planId);
  }
  return ok;
}

export async function transitionItemBlocked(input: {
  projectId: string;
  planId: string;
  itemId: string;
  reason: string;
}): Promise<boolean> {
  const ok = await markPlannedItemBlocked({ itemId: input.itemId, reason: input.reason });
  if (ok) {
    void publishPipelineEvent(input.projectId, {
      type: "plan.item.statusChanged",
      planId: input.planId,
      itemId: input.itemId,
      oldStatus: "pending",
      newStatus: "skipped",
      blockReason: input.reason,
      timestamp: nowIso(),
    });
    await emitPlanStatusIfFinalized(input.projectId, input.planId);
  }
  return ok;
}

/**
 * Called from any item-transition site after the DB update succeeds. Emits a
 * `plan.statusChanged` event when (and only when) maybeFinalizePlanStatus
 * actually transitions the plan to completed / partially_failed.
 */
export async function emitPlanStatusIfFinalized(
  projectId: string,
  planId: string,
): Promise<void> {
  try {
    const updated = await maybeFinalizePlanStatus(planId);
    if (!updated) return;
    void publishPipelineEvent(projectId, {
      type: "plan.statusChanged",
      planId,
      // We don't know the prior status without an extra select; we know it
      // was approved | running because maybeFinalizePlanStatus is the only
      // caller that flips to terminal. Report "running" as the prior — the UI
      // overrides via its own optimistic state anyway.
      oldStatus: "running",
      newStatus: updated.status,
      timestamp: nowIso(),
    });
  } catch (err) {
    log.warn({ err, planId }, "emitPlanStatusIfFinalized failed");
  }
}
