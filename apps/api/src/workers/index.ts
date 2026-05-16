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
  HeroImageGenerationPipeline,
  LocalizeArticlePipeline,
  ClusterProposePipeline,
  CompetitorAnalysisPipeline,
  CompetitorQuestionsPipeline,
  CornerstoneListPipeline,
  GoLiveChecklistPipeline,
  SchemaExtensionPipeline,
  SocialImagePipeline,
  VoiceRefinementQuestionsPipeline,
  VoiceSynthesisPipeline,
  closePipelineInfrastructure,
  discoverArticleStep,
  pipelineRegistry,
  registerChainCallbacks,
  registerDraftDiscoveryCallback,
  registerLocalizeChainCallbacks,
  registerSchemaChainCallbacks,
  registerScheduledJob,
  startPipelineWorker,
  startScheduler,
} from "@marketing-auto/pipelines";
import { advanceChain, failChain } from "../lib/chain-orchestrator.ts";
import { startDiscoveryWorker } from "./discoveryWorker.ts";
import { startSignalCollectorWorker, registerSignalCollectorCron } from "./signal-collector.ts";
import { startTrendSynthesizerWorker, registerTrendSynthesizerCron } from "./trend-synthesizer.ts";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { runAuthCleanup } from "../lib/cleanup.ts";
import { runArticleSchedulerTick } from "./article-scheduler.ts";

const log = createLogger("worker");
const env = getEnv();

// ─── PID file ────────────────────────────────────────────────────────────────
// Guarantees at most one worker process is active at any time.
// On startup: gracefully shut down any previous worker found in the PID file.
// On exit: remove the PID file so the next start doesn't wait unnecessarily.

const PID_FILE = join(process.cwd(), "tmp", "worker.pid");

async function acquirePidLock(): Promise<void> {
  await mkdir(join(process.cwd(), "tmp"), { recursive: true });

  let existingPid: number | null = null;
  try {
    const contents = await readFile(PID_FILE, "utf8");
    existingPid = parseInt(contents.trim(), 10);
  } catch {
    // No PID file — first start or clean state.
  }

  if (existingPid !== null && !Number.isNaN(existingPid)) {
    try {
      // Signal 0 checks if the process is alive without sending a real signal.
      process.kill(existingPid, 0);
      // Process is alive — send SIGTERM and wait briefly for it to exit.
      log.warn({ pid: existingPid }, "Found running worker — sending SIGTERM");
      process.kill(existingPid, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        // Process doesn't exist — stale PID file, safe to ignore.
      } else {
        // EPERM or other: can't signal the process (different user, system restriction).
        // Log and continue — new worker starts regardless; old one may still be running.
        log.warn({ pid: existingPid, code }, "Could not signal existing worker — starting anyway");
      }
    }
  }

  await writeFile(PID_FILE, String(process.pid), "utf8");
  log.info({ pid: process.pid, pidFile: PID_FILE }, "PID lock acquired");
}

async function releasePidLock(): Promise<void> {
  try {
    await unlink(PID_FILE);
  } catch {
    // Already gone — that's fine.
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await acquirePidLock();

  log.info("Starting workers");

  pipelineRegistry.register(new ArticleOutlinePipeline());
  pipelineRegistry.register(new ArticleDraftPipeline());
  pipelineRegistry.register(new BlogPipeline());
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
  // Spec 44: Astro repo import pipeline
  pipelineRegistry.register(new RepoImportPipeline());
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

  // Spec 54c: sync discovery so suggestions are available when the pipeline run shows "completed"
  registerDraftDiscoveryCallback(async (articleId, projectId) => {
    await discoverArticleStep({ articleId, projectId, mode: "full", forceRefresh: false });
  });

  const pipelineWorker = startPipelineWorker({ concurrency: 5 });
  const discoveryWorker = startDiscoveryWorker();
  const signalCollectorWorker = startSignalCollectorWorker();
  // await registerSignalCollectorCron(); // temporarily disabled
  const trendSynthesizerWorker = startTrendSynthesizerWorker();
  // await registerTrendSynthesizerCron(); // temporarily disabled
  const schedulerWorker = await startScheduler();

  log.info("Workers running");

  const shutdown = async () => {
    log.info("Shutting down workers");
    await pipelineWorker.close();
    await discoveryWorker.close();
    await signalCollectorWorker.close();
    await trendSynthesizerWorker.close();
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
