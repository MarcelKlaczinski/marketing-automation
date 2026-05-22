// Spec 64.11 Fix A: Stalled-Render Reconciliation
//
// Worker crashes mid-render leave `social_posts.render_status='rendering'` rows
// orphaned forever, and `pipeline_runs.status='running'` rows similarly stuck.
// BullMQ stall-detection retires the *job* but never touches the app-level row.
//
// This helper runs ONCE at worker startup (BEFORE any worker spawns), so there
// is no race with active processing. It is idempotent — second invocation
// against the same DB state finds 0 rows.
//
// Reset semantics:
//   • social_posts: `rendering` → `pending` AND clear `renderStartedAt` so
//     subsequent reconciliations don't re-pick (the partial index on
//     `(pending|rendering)` keeps either state in the active set; clearing the
//     timestamp is what makes the row look fresh).
//   • pipeline_runs: `running` → `failed` with an `errorMessage` audit trail.
//     The `pipelineRunStatusEnum` has NO `pending` value (the spec's proposed
//     target), so `failed` is the only correct destination — the BullMQ job is
//     gone, requeue is a Marcel decision.

import {
  and,
  db,
  eq,
  isNotNull,
  lt,
  pipelineRuns,
  socialPosts,
  sql,
} from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("workers:render-reconciliation");

const RECONCILE_ERROR_MESSAGE =
  "reconciled: worker startup detected stalled run (BullMQ job lost; pipeline_runs row was orphaned)";

export interface ReconciliationSummary {
  socialPostsReset: number;
  pipelineRunsReset: number;
  cutoffMinutes: number;
}

export async function reconcileStalledRenders(
  opts?: { cutoffMinutes?: number },
): Promise<ReconciliationSummary> {
  const cutoffMinutes = opts?.cutoffMinutes ?? getEnv().RENDER_RECONCILIATION_TIMEOUT_MINUTES;
  // Numeric interval interpolation must go through sql.raw — postgres.js rejects
  // bound parameters in INTERVAL literals. Safe: cutoffMinutes is env-validated as
  // a positive integer (no user input).
  const cutoff = sql<Date>`NOW() - INTERVAL '${sql.raw(String(cutoffMinutes))} minutes'`;

  const socialRows = await db
    .update(socialPosts)
    .set({
      renderStatus: "pending",
      renderStartedAt: null,
    })
    .where(
      and(
        eq(socialPosts.renderStatus, "rendering"),
        isNotNull(socialPosts.renderStartedAt),
        lt(socialPosts.renderStartedAt, cutoff),
      ),
    )
    .returning({ id: socialPosts.id });

  const pipelineRows = await db
    .update(pipelineRuns)
    .set({
      status: "failed",
      errorMessage: RECONCILE_ERROR_MESSAGE,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(pipelineRuns.status, "running"),
        isNotNull(pipelineRuns.startedAt),
        lt(pipelineRuns.startedAt, cutoff),
      ),
    )
    .returning({ id: pipelineRuns.id, pipelineName: pipelineRuns.pipelineName });

  const summary: ReconciliationSummary = {
    socialPostsReset: socialRows.length,
    pipelineRunsReset: pipelineRows.length,
    cutoffMinutes,
  };

  if (summary.socialPostsReset > 0 || summary.pipelineRunsReset > 0) {
    log.warn(
      {
        cutoffMinutes,
        socialPostsReset: summary.socialPostsReset,
        socialPostIds: socialRows.map((r) => r.id),
        pipelineRunsReset: summary.pipelineRunsReset,
        pipelineRunIds: pipelineRows.map((r) => r.id),
        pipelineNames: pipelineRows.map((r) => r.pipelineName),
      },
      "render reconciliation reset stalled rows at worker startup",
    );
  } else {
    log.info({ cutoffMinutes }, "render reconciliation: no stalled rows");
  }

  return summary;
}
