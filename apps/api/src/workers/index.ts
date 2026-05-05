import {
  startPipelineWorker,
  startScheduler,
  registerScheduledJob,
  pipelineRegistry,
  closePipelineInfrastructure,
  ArticleOutlinePipeline,
  ArticleDraftPipeline,
} from "@marketing-auto/pipelines";
import { runAuthCleanup } from "../lib/cleanup.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("worker");

async function main() {
  log.info("Starting workers");

  pipelineRegistry.register(new ArticleOutlinePipeline());
  pipelineRegistry.register(new ArticleDraftPipeline());
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
