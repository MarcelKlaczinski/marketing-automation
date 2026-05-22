import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArticleSyncPipeline } from "@marketing-auto/adapter-astro-sync";
import { RepoImportPipeline } from "@marketing-auto/adapter-astro-sync/import";
import {
  PageSpeedApiValidationPipeline,
  PageSpeedValidationPipeline,
} from "@marketing-auto/adapter-pagespeed";
import {
  ArticleDraftPipeline,
  ArticleOutlinePipeline,
  BlogPipeline,
  ClusterLinkRebuildPipeline,
  ClusterProposePipeline,
  CompetitorAnalysisPipeline,
  CompetitorQuestionsPipeline,
  CornerstoneListPipeline,
  GoLiveChecklistPipeline,
  HeroImageGenerationPipeline,
  LocalizeArticlePipeline,
  PlanWeekPipeline,
  RefreshPipeline,
  SchemaExtensionPipeline,
  SocialImagePipeline,
  TranslationPipeline,
  VoiceRefinementQuestionsPipeline,
  VoiceSynthesisPipeline,
  closePipelineInfrastructure,
  discoverArticleStep,
  pipelineRegistry,
  registerBlogChainCallbacks,
  registerChainCallbacks,
  registerDraftDiscoveryCallback,
  registerLocalizeChainCallbacks,
  registerSchemaChainCallbacks,
  startPipelineWorker,
  startScheduler,
} from "@marketing-auto/pipelines";
import { closeArticleQualityAnalysisQueue } from "@marketing-auto/pipelines/article-quality-analysis-queue";
import { closeSocialRenderQueue } from "@marketing-auto/pipelines/social-render-queue";
import { createLogger } from "@marketing-auto/shared";
import { advanceChain, failChain } from "../lib/chain-orchestrator.ts";
import { buildSignalFetcherMap } from "../lib/signal-fetcher-map.ts";
import { readAdapterCreds } from "../lib/system-service.ts";
import { startArticleQualityAnalysisWorker } from "./article-quality-analysis.worker.ts";
import {
  closeBatchProcessorInfrastructure,
  startBatchProcessorWorker,
} from "./batch-processor.worker.ts";
import {
  closeImageBatchProcessorInfrastructure,
  startImageBatchProcessorWorker,
} from "./image-batch-processor.worker.ts";
import { registerCronOrchestrator, startCronOrchestratorWorker } from "./cron-orchestrator.ts";
import { startDiscoveryWorker } from "./discoveryWorker.ts";
import { startGapAutoApproverWorker } from "./gap-auto-approver.ts";
import {
  seedPlannerWeeklyGenerationCron,
  startPlannerWeeklyGenerationWorker,
} from "./planner-weekly-generation.worker.ts";
import {
  seedComparisonDiscoveryCron,
  startComparisonDiscoveryWorker,
} from "./comparison-discovery.worker.ts";
import { startRefreshDetectorWorker } from "./refresh-detector.ts";
import { startSignalCollectorWorker } from "./signal-collector.ts";
import { startSocialRenderWorker } from "./social-render.worker.ts";
import { startPlanExecutionWorker } from "./plan-execution.worker.ts";
import {
  seedStepPauseCleanupCron,
  startStepPauseCleanupWorker,
} from "./step-pause-cleanup.worker.ts";
import { startTrendSynthesizerWorker, seedTrendSynthesizerCron } from "./trend-synthesizer.ts";
import { reconcileStalledRenders } from "./lib/render-reconciliation.ts";

const log = createLogger("worker");

// ─── PID file ────────────────────────────────────────────────────────────────
// Guarantees at most one worker process is active at any time.
// On startup: gracefully shut down any previous worker found in the PID file.
// On exit: remove the PID file so the next start doesn't wait unnecessarily.

const PID_FILE = join(process.cwd(), "tmp", "worker.pid");

/**
 * Wait up to `timeoutMs` for `pid` to exit. Polls every 200ms via signal 0.
 * Returns true if the process is gone, false if it's still alive at timeout.
 */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
      // Still alive — wait and try again.
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return true;
      // EPERM or other — can't tell. Assume still alive to be safe.
      return false;
    }
  }
  return false;
}

/**
 * Acquire the worker PID lock. Robust against three pre-existing failure modes:
 *
 *  1. **Slow-shutdown race**: `pipelineWorker.close()` waits for active BullMQ
 *     jobs to drain (lockDuration = 10 min). The fixed 2-second wait could
 *     return BEFORE the old worker actually exited; both then run concurrently,
 *     and the old shutdown later `unlink`s the new owner's PID file.
 *     → Fix: poll until the old PID actually exits (up to 20s soft cap), then
 *       SIGKILL as a last resort. Only proceed to writeFile once we've
 *       confirmed the previous worker is gone (or we've forced it).
 *
 *  2. **PID-reuse race**: if the old worker died without releasing the lock
 *     (terminal SIGHUP, OOM, manual `kill -9`), the OS can recycle that PID
 *     for an unrelated process. `process.kill(pid, 0)` would then report it
 *     alive — we'd SIGTERM a stranger.
 *     → Fix: SIGTERM is still unfortunate but unavoidable without /proc-style
 *       process introspection. We log loudly + verify post-write so at least
 *       we know it happened.
 *
 *  3. **Parallel restart**: two concurrent `worker:restart` invocations would
 *     each write their own PID; one loses but believes it owns the lock.
 *     → Fix: after our writeFile, re-read and verify the PID is ours. If not,
 *       another worker won the race — exit cleanly so they can run.
 */
async function acquirePidLock(): Promise<void> {
  await mkdir(join(process.cwd(), "tmp"), { recursive: true });

  let existingPid: number | null = null;
  try {
    const contents = await readFile(PID_FILE, "utf8");
    const parsed = Number.parseInt(contents.trim(), 10);
    if (!Number.isNaN(parsed) && parsed !== process.pid) existingPid = parsed;
  } catch {
    // No PID file — first start or clean state.
  }

  if (existingPid !== null) {
    let aliveBefore = false;
    try {
      process.kill(existingPid, 0);
      aliveBefore = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") {
        log.info({ pid: existingPid }, "Stale PID file — previous worker already dead");
      } else {
        log.warn(
          { pid: existingPid, code: (e as NodeJS.ErrnoException).code },
          "Cannot probe existing worker — starting anyway"
        );
      }
    }

    if (aliveBefore) {
      log.warn({ pid: existingPid }, "Found running worker — sending SIGTERM");
      try {
        process.kill(existingPid, "SIGTERM");
      } catch (e) {
        log.warn(
          { pid: existingPid, code: (e as NodeJS.ErrnoException).code },
          "SIGTERM raised — process may have died between probe and signal"
        );
      }

      // Poll for actual exit up to 20s. Most graceful shutdowns finish within
      // 5–10s; a stuck pipelineWorker.close() (active LLM job) needs more.
      const gone = await waitForExit(existingPid, 20_000);
      if (!gone) {
        log.warn({ pid: existingPid }, "Old worker still alive after 20s — escalating to SIGKILL");
        try {
          process.kill(existingPid, "SIGKILL");
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
          // Already dead between checks — fine.
        }
      }
    }
  }

  // Write our PID and verify ownership (defends against parallel restarts).
  await writeFile(PID_FILE, String(process.pid), "utf8");
  await new Promise((resolve) => setTimeout(resolve, 50));
  try {
    const after = Number.parseInt((await readFile(PID_FILE, "utf8")).trim(), 10);
    if (after !== process.pid) {
      log.error(
        { ownPid: process.pid, fileContents: after },
        "Another worker won the PID race — exiting cleanly to avoid duplicates"
      );
      process.exit(0);
    }
  } catch (e) {
    log.error({ err: e }, "Could not verify PID file after write");
    process.exit(1);
  }

  log.info({ pid: process.pid, pidFile: PID_FILE }, "PID lock acquired");
}

/**
 * Release the PID lock — but ONLY if the file still contains our own PID. The
 * slow-shutdown race: if a new worker started up while we were draining BullMQ
 * jobs in `shutdown()`, the file now points at the NEW worker. Blindly
 * unlinking it would leave the next restart unable to detect the new worker
 * and would let a third worker join without contention.
 */
async function releasePidLock(): Promise<void> {
  try {
    const contents = (await readFile(PID_FILE, "utf8")).trim();
    const filePid = Number.parseInt(contents, 10);
    if (filePid === process.pid) {
      await unlink(PID_FILE);
    } else {
      log.warn(
        { ownPid: process.pid, fileContents: filePid },
        "PID file no longer ours — leaving it for the new owner"
      );
    }
  } catch {
    // Already gone — that's fine.
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await acquirePidLock();

  // Spec 64.11 Fix A: reset stalled `rendering` / `running` rows BEFORE workers
  // spawn so the next poll finds clean state. Idempotent — re-runs find 0 rows.
  // Sequential is intentional (pure DB write, ~10ms; downstream worker spawn
  // depends on the clean state).
  try {
    await reconcileStalledRenders();
  } catch (err) {
    // Reconciliation failure must not block worker startup — workers can still
    // function, just with stale rows that Marcel can clean manually.
    log.error({ err }, "render reconciliation at startup failed — continuing without reset");
  }

  log.info("Starting workers");

  pipelineRegistry.register(new ArticleOutlinePipeline());
  pipelineRegistry.register(new ArticleDraftPipeline());
  pipelineRegistry.register(new BlogPipeline());
  pipelineRegistry.register(new RefreshPipeline());
  pipelineRegistry.register(new HeroImageGenerationPipeline());
  pipelineRegistry.register(new LocalizeArticlePipeline());
  pipelineRegistry.register(new ArticleSyncPipeline());
  pipelineRegistry.register(new SchemaExtensionPipeline());
  pipelineRegistry.register(new ClusterLinkRebuildPipeline());
  pipelineRegistry.register(new PageSpeedValidationPipeline());
  pipelineRegistry.register(new PageSpeedApiValidationPipeline());
  // Cold-start pipelines (Spec 35)
  pipelineRegistry.register(new VoiceRefinementQuestionsPipeline());
  pipelineRegistry.register(new VoiceSynthesisPipeline());
  pipelineRegistry.register(new CompetitorQuestionsPipeline());
  pipelineRegistry.register(new CompetitorAnalysisPipeline());
  pipelineRegistry.register(new ClusterProposePipeline());
  pipelineRegistry.register(new CornerstoneListPipeline());
  pipelineRegistry.register(new GoLiveChecklistPipeline());
  pipelineRegistry.register(new SocialImagePipeline());
  pipelineRegistry.register(new TranslationPipeline());
  // Spec 44: Astro repo import pipeline
  pipelineRegistry.register(new RepoImportPipeline());
  // Spec 62.4: PlanWeekPipeline. Deps captured at registration time:
  // `resolvePipelineSteps` is built AFTER all real pipelines are registered
  // so tier-1 cost estimates can find them by name.
  pipelineRegistry.register(
    new PlanWeekPipeline({
      resolvePipelineSteps: (name) => pipelineRegistry.get(name)?.steps,
      refreshDeps: {
        fetchers: buildSignalFetcherMap(),
        readCreds: readAdapterCreds,
      },
    })
  );
  log.info({ pipelines: pipelineRegistry.list() }, "Pipelines registered");

  // Register scheduled jobs (temporarily disabled)
  // registerScheduledJob({
  //   name: "auth-cleanup",
  //   cron: "0 3 * * *", // 03:00 daily
  //   handler: async () => {
  //     const { tokensDeleted, sessionsDeleted } = await runAuthCleanup();
  //     log.info({ tokensDeleted, sessionsDeleted }, "Auth cleanup result");
  //   },
  // });

  // if (env.ARTICLE_SCHEDULER_ENABLED) {
  //   registerScheduledJob({
  //     name: "article-scheduler",
  //     cron: "0 3 * * *", // 03:00 daily
  //     handler: async () => {
  //       const results = await runArticleSchedulerTick();
  //       log.info(results, "Article scheduler tick complete");
  //     },
  //   });
  //   log.info("Article scheduler enabled (runs daily at 03:00)");
  // } else {
  //   log.info("Article scheduler disabled (ARTICLE_SCHEDULER_ENABLED not set)");
  // }

  // Spec 49d: wire chain advancement callbacks into pipeline afterComplete hooks
  const chainCallbacks = {
    advanceChain: (chainId: string, step: string, runId: string) =>
      advanceChain(chainId, step as import("@marketing-auto/db").ChainStep, runId),
    failChain: (chainId: string, step: string, error: string) =>
      failChain(chainId, step as import("@marketing-auto/db").ChainStep, error),
  };
  registerChainCallbacks(chainCallbacks);
  registerSchemaChainCallbacks(chainCallbacks);
  registerLocalizeChainCallbacks({ advanceChain: chainCallbacks.advanceChain });
  registerBlogChainCallbacks({ advanceChain: chainCallbacks.advanceChain });

  // Spec 54c: sync discovery so suggestions are available when the pipeline run shows "completed"
  registerDraftDiscoveryCallback(async (articleId, projectId) => {
    await discoverArticleStep({ articleId, projectId, mode: "full", forceRefresh: false });
  });

  const pipelineWorker = startPipelineWorker({ concurrency: 5 });
  const discoveryWorker = startDiscoveryWorker();
  const signalCollectorWorker = startSignalCollectorWorker();
  // await registerSignalCollectorCron(); // temporarily disabled
  const trendSynthesizerWorker = startTrendSynthesizerWorker();
  const refreshDetectorWorker = startRefreshDetectorWorker();
  const cronOrchestratorWorker = startCronOrchestratorWorker();
  await registerCronOrchestrator();
  const gapAutoApproverWorker = startGapAutoApproverWorker();
  const socialRenderWorker = startSocialRenderWorker();
  const articleQualityAnalysisWorker = startArticleQualityAnalysisWorker();
  const batchProcessorWorker = startBatchProcessorWorker();
  const imageBatchProcessorWorker = startImageBatchProcessorWorker();
  const stepPauseCleanupWorker = startStepPauseCleanupWorker();
  const plannerWeeklyGenerationWorker = startPlannerWeeklyGenerationWorker();
  const planExecutionWorker = startPlanExecutionWorker();
  const comparisonDiscoveryWorker = startComparisonDiscoveryWorker();
  // Spec 62.0a Section 4.5.3 + 62.7 + 63.3b: seed cron_state rows on startup
  // (idempotent). The orchestrator's next tick (within 60s) picks them up and
  // creates the BullMQ repeat job. Seed lives in code, not SQL migration,
  // because PostgreSQL forbids using a freshly-added enum value in the same
  // session that added it.
  await seedStepPauseCleanupCron();
  await seedPlannerWeeklyGenerationCron();
  await seedComparisonDiscoveryCron();
  await seedTrendSynthesizerCron();
  // registerGapAutoApproverCron() is disabled — import from gap-auto-approver.ts to enable
  const schedulerWorker = await startScheduler();

  log.info("Workers running");

  const shutdown = async () => {
    log.info("Shutting down workers");
    await pipelineWorker.close();
    await discoveryWorker.close();
    await signalCollectorWorker.close();
    await trendSynthesizerWorker.close();
    await refreshDetectorWorker.close();
    await cronOrchestratorWorker.close();
    await gapAutoApproverWorker.close();
    await socialRenderWorker.close();
    await closeSocialRenderQueue();
    await articleQualityAnalysisWorker.close();
    await closeArticleQualityAnalysisQueue();
    await batchProcessorWorker.close();
    await closeBatchProcessorInfrastructure();
    await imageBatchProcessorWorker.close();
    await closeImageBatchProcessorInfrastructure();
    await stepPauseCleanupWorker.close();
    await plannerWeeklyGenerationWorker.close();
    await planExecutionWorker.close();
    await comparisonDiscoveryWorker.close();
    await schedulerWorker.close();
    await closePipelineInfrastructure();
    await releasePidLock();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error({ err }, "Worker startup failed");
  releasePidLock().finally(() => process.exit(1));
});
