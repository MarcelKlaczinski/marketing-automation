/**
 * Manual verification script for Spec 62.0a-followup Issue 3 (orphan-substep).
 *
 * Runs the end-to-end batch-resume flow against the real Anthropic Batch API on
 * the `toolwiki` project, then asserts that after resume the prior substep row
 * is `superseded` (not orphan-running). Force-fires the batch-processor's
 * SUBMIT_JOB and PROCESS_JOB on the BullMQ queue so the test doesn't have to
 * wait for the 30-min / 6-hour cron intervals.
 *
 * Usage:
 *   bun --env-file ../../.env apps/api/src/scripts/batch-resume-verify.ts --list
 *   bun --env-file ../../.env apps/api/src/scripts/batch-resume-verify.ts <articleId>
 *
 * Preconditions:
 *   - DB + Redis reachable
 *   - apps/api worker running (BullMQ workers must pick up the enqueued pipeline
 *     AND the batch-processor jobs we add to the queue)
 *   - Real ANTHROPIC_API_KEY in env or vault — this script bills against it
 *
 * Side-effects:
 *   - Temporarily flips `projects.llm_mode = 'batch'` on toolwiki; restored on exit
 *   - INSERTs one parent + one substep `pipeline_runs` row; INSERTs one `batch_requests` row
 *   - Spends ~€0.05 in Anthropic batch credit on the outline step
 *
 * Approx duration: 30s – 60min depending on Anthropic batch queue latency.
 */
import {
  articles,
  batchRequests,
  db,
  eq,
  pipelineRuns,
  projects,
} from "@marketing-auto/db";
import { enqueuePipeline } from "@marketing-auto/pipelines";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { Queue } from "bullmq";
import { readFile } from "node:fs/promises";
import { and, desc, inArray } from "drizzle-orm";
import IORedis from "ioredis";

const log = createLogger("batch-resume-verify");

async function workerIsAlive(): Promise<{ alive: boolean; pid?: number }> {
  try {
    const raw = await readFile("tmp/worker.pid", "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return { alive: false };
    try {
      // process.kill(pid, 0) throws ESRCH when no such process exists; success = alive.
      process.kill(pid, 0);
      return { alive: true, pid };
    } catch {
      return { alive: false, pid };
    }
  } catch {
    return { alive: false };
  }
}

const TOOLWIKI_SLUG = "toolwiki";
const POLL_MS = 10_000;
const TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes hard cap
const BATCH_PROCESSOR_QUEUE = "batch-processor";
const SUBMIT_JOB_NAME = "submit-pending-batch-requests";
const PROCESS_JOB_NAME = "process-batch-results";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const env = getEnv();
  const arg = process.argv[2];

  const [toolwiki] = await db
    .select({ id: projects.id, slug: projects.slug, llmMode: projects.llmMode })
    .from(projects)
    .where(eq(projects.slug, TOOLWIKI_SLUG))
    .limit(1);
  if (!toolwiki) {
    console.error(`❌ Project '${TOOLWIKI_SLUG}' not found.`);
    process.exit(1);
  }

  if (!arg || arg === "--list") {
    // Surface articles in pre-publish states so the test re-outlines a draft, not a live post.
    const safeStatuses: Array<"proposed" | "approved" | "outline_review" | "drafting" | "failed"> = [
      "proposed",
      "approved",
      "outline_review",
      "drafting",
      "failed",
    ];
    const candidates = await db
      .select({
        id: articles.id,
        title: articles.title,
        slug: articles.slug,
        status: articles.status,
      })
      .from(articles)
      .where(and(eq(articles.projectId, toolwiki.id), inArray(articles.status, safeStatuses)))
      .orderBy(desc(articles.updatedAt))
      .limit(20);
    if (candidates.length === 0) {
      console.log(
        `No toolwiki articles in pre-publish states (${safeStatuses.join(", ")}).\n` +
          `You can still pass any toolwiki articleId on the command line — be aware\n` +
          `the script triggers article:outline which will OVERWRITE that article's outline.`
      );
      process.exit(0);
    }
    console.log(
      `Candidates for verification (toolwiki, pre-publish status):\n` +
        candidates
          .map((c) => `  ${c.id}  [${c.status.padEnd(18)}]  ${c.title}`)
          .join("\n") +
        `\n\nUsage: bun --env-file ../../.env apps/api/src/scripts/batch-resume-verify.ts <articleId>`
    );
    process.exit(0);
  }

  const articleId = arg;
  const [article] = await db
    .select({ id: articles.id, title: articles.title, projectId: articles.projectId, status: articles.status })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!article) {
    console.error(`❌ Article ${articleId} not found.`);
    process.exit(1);
  }
  if (article.projectId !== toolwiki.id) {
    console.error(`❌ Article ${articleId} belongs to a different project, expected toolwiki.`);
    process.exit(1);
  }

  console.log(`\n=== Spec 62.0a-followup Issue 3 — batch-resume orphan-substep verification ===`);
  console.log(`Project:        ${toolwiki.slug} (${toolwiki.id})`);
  console.log(`Article:        ${article.title}`);
  console.log(`Article ID:     ${article.id}`);
  console.log(`Article status: ${article.status}`);
  console.log(`Anthropic key:  ${env.ANTHROPIC_API_KEY ? "set" : "<vault>"}`);

  // Preflight: worker must be alive or the pipeline will hang at status='queued' forever.
  const worker = await workerIsAlive();
  if (!worker.alive) {
    console.error(
      `\n❌ Worker is not running${worker.pid ? ` (stale PID ${worker.pid} in tmp/worker.pid)` : " (no tmp/worker.pid)"}.\n` +
        `   Start it first:\n` +
        `     bun --filter @marketing-auto/api run worker:restart\n` +
        `   Then re-run this script.`
    );
    process.exit(1);
  }
  console.log(`Worker:         alive (pid ${worker.pid})`);
  console.log(``);

  const originalMode = toolwiki.llmMode;
  const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const batchQueue = new Queue(BATCH_PROCESSOR_QUEUE, { connection: redis });

  let runId: string | undefined;
  let cleanupDone = false;

  async function cleanup(): Promise<void> {
    if (cleanupDone) return;
    cleanupDone = true;
    try {
      await db
        .update(projects)
        .set({ llmMode: originalMode })
        .where(eq(projects.id, toolwiki!.id));
      console.log(`\n↩ restored toolwiki.llm_mode → '${originalMode}'`);
    } catch (e) {
      log.warn({ err: e }, "cleanup: failed to restore llm_mode");
    }
    try {
      await batchQueue.close();
      await redis.quit();
    } catch {
      /* ignore */
    }
  }
  process.on("SIGINT", async () => {
    console.log(`\n⚠ SIGINT received — cleaning up`);
    await cleanup();
    process.exit(130);
  });

  try {
    // 1. Flip toolwiki to batch mode
    await db
      .update(projects)
      .set({ llmMode: "batch" })
      .where(eq(projects.id, toolwiki.id));
    console.log(`✓ toolwiki.llm_mode → 'batch' (was '${originalMode}')`);

    // 2. Pre-INSERT pipeline_runs row (preRunId pattern) and enqueue
    const [pre] = await db
      .insert(pipelineRuns)
      .values({
        projectId: toolwiki.id,
        pipelineName: "article:outline",
        status: "queued",
        input: { articleId, projectId: toolwiki.id },
      })
      .returning({ id: pipelineRuns.id });
    runId = pre!.id;
    console.log(`✓ pipeline_runs row created (queued): ${runId}`);

    // Bypass enqueueArticleOutlinePipeline (which uses a stable jobId per articleId
    // and silently no-ops on re-enqueue per BullMQ dedup semantics — see the DO-NOT
    // gotcha in root CLAUDE.md about static jobIds for re-trigger flows).
    // For verification runs we want a fresh job every time.
    const verifyJobId = `verify-batch-resume-${articleId}-${Date.now()}`;
    const { jobId } = await enqueuePipeline({
      pipelineName: "article:outline",
      projectId: toolwiki.id,
      input: { articleId, projectId: toolwiki.id },
      preRunId: runId,
      jobOptions: { jobId: verifyJobId },
    });
    console.log(`✓ enqueued article:outline (jobId=${jobId})`);

    // 3. Poll until the parent run reaches batch_pending, then drive batch-processor
    const startMs = Date.now();
    let lastParentStatus = "";
    let lastBatchStatus = "";
    let lastHeartbeatMs = 0;
    let submitFired = false;
    let processFired = false;
    let batchRequestRow: { id: string; status: string } | null = null;

    console.log(`Polling every ${POLL_MS / 1000}s. Heartbeat every 60s. Ctrl-C is safe (restores llm_mode).\n`);

    while (Date.now() - startMs < TIMEOUT_MS) {
      const [run] = await db
        .select({ status: pipelineRuns.status })
        .from(pipelineRuns)
        .where(eq(pipelineRuns.id, runId))
        .limit(1);
      if (!run) {
        console.error(`❌ pipeline_runs row ${runId} disappeared`);
        break;
      }

      if (run.status !== lastParentStatus) {
        console.log(`  [${elapsed(startMs)}] parent_run.status: ${lastParentStatus || "(none)"} → ${run.status}`);
        lastParentStatus = run.status;
        lastHeartbeatMs = Date.now();
      } else if (Date.now() - lastHeartbeatMs > 60_000) {
        const stillMsg =
          run.status === "queued"
            ? "still queued — worker may not be picking up the job"
            : `still ${run.status}`;
        console.log(`  [${elapsed(startMs)}] heartbeat: ${stillMsg}`);
        lastHeartbeatMs = Date.now();
      }

      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        console.log(`\n✓ pipeline_runs reached terminal status: ${run.status}`);
        break;
      }

      if (run.status === "batch_pending") {
        const [batchRow] = await db
          .select({ id: batchRequests.id, status: batchRequests.status })
          .from(batchRequests)
          .where(eq(batchRequests.pipelineRunId, runId))
          .limit(1);
        if (batchRow) {
          batchRequestRow = batchRow;
          if (batchRow.status !== lastBatchStatus) {
            console.log(`  [${elapsed(startMs)}] batch_request.status: ${lastBatchStatus || "(none)"} → ${batchRow.status}`);
            lastBatchStatus = batchRow.status;
          }
          if (batchRow.status === "pending" && !submitFired) {
            await batchQueue.add(
              SUBMIT_JOB_NAME,
              {},
              { jobId: `manual-submit-${Date.now()}`, removeOnComplete: 1, removeOnFail: 1 }
            );
            console.log(`  [${elapsed(startMs)}] forced SUBMIT_JOB (skip 30-min cron)`);
            submitFired = true;
          }
          if (batchRow.status === "submitted" || batchRow.status === "processing") {
            // Fire PROCESS_JOB periodically — it's a no-op until Anthropic returns,
            // but once they do it picks up the result without waiting for the 6h cron.
            if (!processFired || (Date.now() - startMs) % (5 * 60_000) < POLL_MS) {
              await batchQueue.add(
                PROCESS_JOB_NAME,
                {},
                { jobId: `manual-process-${Date.now()}`, removeOnComplete: 1, removeOnFail: 1 }
              );
              if (!processFired) {
                console.log(`  [${elapsed(startMs)}] forced PROCESS_JOB (will retry every ~5min until Anthropic completes)`);
                processFired = true;
              }
            }
          }
          if (batchRow.status === "failed" || batchRow.status === "cancelled" || batchRow.status === "expired") {
            console.log(`\n❌ batch_request terminal status: ${batchRow.status}`);
            break;
          }
        }
      }

      await sleep(POLL_MS);
    }

    if (Date.now() - startMs >= TIMEOUT_MS) {
      console.log(`\n⏱ Timeout after 90 minutes — Anthropic batch did not complete in window.`);
      console.log(`   pipeline_run: ${runId}`);
      console.log(`   batch_request: ${batchRequestRow?.id ?? "(none)"}`);
      console.log(`   You can re-run the verification SELECT manually later.`);
    }

    // 4. The verification SELECT
    console.log(`\n=== Substep inspection ===`);
    const substeps = await db
      .select({
        id: pipelineRuns.id,
        status: pipelineRuns.status,
        stepName: pipelineRuns.stepName,
        startedAt: pipelineRuns.startedAt,
        completedAt: pipelineRuns.completedAt,
      })
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.parentRunId, runId), eq(pipelineRuns.stepName, "outline")))
      .orderBy(pipelineRuns.startedAt);

    console.table(
      substeps.map((s) => ({
        id: s.id.slice(0, 8),
        status: s.status,
        started: s.startedAt?.toISOString() ?? "",
        completed: s.completedAt?.toISOString() ?? "",
      }))
    );

    const supersededRows = substeps.filter((s) => s.status === "superseded");
    const completedRows = substeps.filter((s) => s.status === "completed");
    const orphanRows = substeps.filter((s) => s.status === "running" || s.status === "batch_pending");

    console.log(`\n=== Verdict ===`);
    console.log(`  superseded rows:    ${supersededRows.length}`);
    console.log(`  completed rows:     ${completedRows.length}`);
    console.log(`  orphan rows:        ${orphanRows.length}  (running / batch_pending)`);

    if (substeps.length === 0) {
      console.log(`\n⚠ No outline substep rows yet. Pipeline may still be in progress.`);
    } else if (orphanRows.length > 0) {
      console.log(`\n❌ FAIL — orphan substep(s) remain. Fix did NOT take effect in production code path.`);
      console.log(`   First-orphan id: ${orphanRows[0]!.id}`);
      process.exitCode = 2;
    } else if (supersededRows.length >= 1 && completedRows.length >= 1) {
      console.log(`\n✅ PASS — first substep was superseded, follow-up completed cleanly.`);
    } else if (supersededRows.length === 0 && completedRows.length === 1) {
      console.log(`\n⚠ INCONCLUSIVE — only one substep row (status=completed). The batch may have`);
      console.log(`   completed without ever needing a resume (e.g. step finished synchronously after`);
      console.log(`   batch round-trip but no orphan was ever created). The fix is structurally`);
      console.log(`   verified by the regression test; re-run on a different article if you want a`);
      console.log(`   second observation.`);
    } else {
      console.log(`\n⚠ Unexpected substep pattern — inspect manually.`);
      process.exitCode = 3;
    }
  } finally {
    await cleanup();
  }
  process.exit(process.exitCode ?? 0);
}

function elapsed(startMs: number): string {
  const s = Math.floor((Date.now() - startMs) / 1000);
  const m = Math.floor(s / 60);
  return `${m}m${(s % 60).toString().padStart(2, "0")}s`;
}

await main();
