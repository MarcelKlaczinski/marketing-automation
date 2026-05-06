import {
  startPipelineWorker,
  startScheduler,
  registerScheduledJob,
  pipelineRegistry,
  closePipelineInfrastructure,
  ArticleOutlinePipeline,
  ArticleDraftPipeline,
} from "@marketing-auto/pipelines";
import { ArticleSyncPipeline } from "@marketing-auto/adapter-astro-sync";
import { runAuthCleanup } from "../lib/cleanup.ts";
import { runArticleSchedulerTick } from "./article-scheduler.ts";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("worker");
const env = getEnv();

async function main() {
  log.info("Starting workers");

  pipelineRegistry.register(new ArticleOutlinePipeline());
  pipelineRegistry.register(new ArticleDraftPipeline());
  pipelineRegistry.register(new ArticleSyncPipeline());
  log.info({ pipelines: pipelineRegistry.list() }, "Pipelines registered");

  // Register scheduled jobs
  registerScheduledJob({
    name: "auth-cleanup",
    cron: "0 3 * * *", // 03:00 daily
    handler: async () => {
      const { tokensDeleted, sessionsDeleted } = await runAuthCleanup();
      log.info({ tokensDeleted, sessionsDeleted }, "Auth cleanup result");
    },
  });

  if (env.ARTICLE_SCHEDULER_ENABLED) {
    registerScheduledJob({
      name: "article-scheduler",
      cron: "0 3 * * *", // 03:00 daily
      handler: async () => {
        const results = await runArticleSchedulerTick();
        log.info(results, "Article scheduler tick complete");
      },
    });
    log.info("Article scheduler enabled (runs daily at 03:00)");
  } else {
    log.info("Article scheduler disabled (ARTICLE_SCHEDULER_ENABLED not set)");
  }

  const pipelineWorker = startPipelineWorker({ concurrency: 5 });
  const schedulerWorker = await startScheduler();

  log.info("Workers running");

  const shutdown = async () => {
    log.info("Shutting down workers");
    await pipelineWorker.close();
    await schedulerWorker.close();
    await closePipelineInfrastructure();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error({ err }, "Worker startup failed");
  process.exit(1);
});
