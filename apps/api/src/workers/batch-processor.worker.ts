// Spec 61.4: Batch processor worker — submits pending Anthropic Batch API requests
// and polls completed batches to resume suspended pipelines.
//
// Two repeatable BullMQ jobs:
//   submit-pending: every 30 minutes — collect pending batch_requests and submit to Anthropic
//   process-results: every 6 hours — poll submitted batches and resume completed pipelines
//
// Uses @anthropic-ai/sdk directly for batch endpoints (not the adapter) — the adapter
// only wraps anthropic.messages(); batch lifecycle endpoints are not exposed there.
import Anthropic from "@anthropic-ai/sdk";
import { batchRequests, costLogs, db, eq, inArray, and, lt } from "@marketing-auto/db";
import { resumePipeline } from "@marketing-auto/pipelines/batch-resume";
import { calculateBatchCostEur } from "@marketing-auto/pipelines/cost-calculator";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const log = createLogger("batch-processor-worker");

const BATCH_PROCESSOR_QUEUE = "batch-processor";
const SUBMIT_JOB = "submit-pending-batch-requests";
const PROCESS_JOB = "process-batch-results";

// Singleton connection — shared with the main pipeline queue connection.
let _connection: IORedis | null = null;
let _queue: Queue | null = null;
let _worker: Worker | null = null;

function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

function getAnthropicClient(): Anthropic {
  const env = getEnv();
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

// ─── Submit pending requests ──────────────────────────────────────────────────

async function submitPendingRequests(): Promise<void> {
  // Collect pending rows older than 15 minutes — Strategy B (Spec 61.4 §4.3)
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const pending = await db
    .select()
    .from(batchRequests)
    .where(and(eq(batchRequests.status, "pending"), lt(batchRequests.createdAt, cutoff)))
    .limit(10_000); // Anthropic max batch size

  if (pending.length === 0) {
    log.debug("submit-pending: no pending requests");
    return;
  }

  log.info({ count: pending.length }, "submit-pending: submitting batch to Anthropic");

  const anthropic = getAnthropicClient();
  const requests = pending.map((row) => {
    const body = row.requestBody as {
      model: string;
      max_tokens: number;
      system: unknown;
      messages: unknown[];
    };
    return {
      custom_id: row.anthropicCustomId,
      params: {
        model: body.model as Anthropic.Model,
        max_tokens: body.max_tokens,
        // Cast to TextBlockParam[] — requestBody was built by batch-llm-client with text blocks only
        ...(body.system !== undefined ? { system: body.system as Anthropic.Messages.TextBlockParam[] } : {}),
        messages: body.messages as Anthropic.Messages.MessageParam[],
      },
    };
  });

  let batch: Anthropic.Messages.MessageBatch;
  try {
    batch = await anthropic.messages.batches.create({ requests });
  } catch (err) {
    log.error({ err }, "submit-pending: Anthropic batch create failed");
    return;
  }

  const ids = pending.map((r) => r.id);
  await db
    .update(batchRequests)
    .set({
      anthropicBatchId: batch.id,
      status: "submitted",
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(inArray(batchRequests.id, ids));

  log.info({ anthropicBatchId: batch.id, count: ids.length }, "submit-pending: batch submitted");
}

// ─── Process completed batches ────────────────────────────────────────────────

async function processBatches(): Promise<void> {
  const submittedStatuses: Array<"submitted" | "processing"> = ["submitted", "processing"];

  // Get distinct batch IDs that are in-flight
  const inFlight = await db
    .selectDistinct({ anthropicBatchId: batchRequests.anthropicBatchId })
    .from(batchRequests)
    .where(inArray(batchRequests.status, submittedStatuses));

  const batchIds = inFlight
    .map((r) => r.anthropicBatchId)
    .filter((id): id is string => id !== null);

  if (batchIds.length === 0) {
    log.debug("process-batches: no in-flight batches");
    return;
  }

  log.info({ count: batchIds.length }, "process-batches: polling Anthropic batches");

  const anthropic = getAnthropicClient();

  for (const anthropicBatchId of batchIds) {
    try {
      await processSingleBatch(anthropic, anthropicBatchId);
    } catch (err) {
      log.error({ err, anthropicBatchId }, "process-batches: error processing batch");
    }
  }
}

async function processSingleBatch(anthropic: Anthropic, anthropicBatchId: string): Promise<void> {
  const batch = await anthropic.messages.batches.retrieve(anthropicBatchId);

  if (batch.processing_status !== "ended") {
    // Not ready — update status to processing so UI can track
    await db
      .update(batchRequests)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(batchRequests.anthropicBatchId, anthropicBatchId));
    log.debug({ anthropicBatchId, status: batch.processing_status }, "Batch still in progress");
    return;
  }

  log.info({ anthropicBatchId }, "Batch ended — fetching results");

  const results = await anthropic.messages.batches.results(anthropicBatchId);
  for await (const item of results) {
    await processResultItem(item);
  }
}

async function processResultItem(item: Anthropic.Messages.MessageBatchIndividualResponse): Promise<void> {
  const [row] = await db
    .select()
    .from(batchRequests)
    .where(eq(batchRequests.anthropicCustomId, item.custom_id))
    .limit(1);

  if (!row) {
    log.warn({ customId: item.custom_id }, "No batch_requests row for custom_id — skipping");
    return;
  }

  if (item.result.type === "succeeded") {
    const msg = item.result.message;
    const content = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const costEur = calculateBatchCostEur(row.model, {
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
    });

    await db
      .update(batchRequests)
      .set({
        status: "completed",
        responseBody: { content, usage: msg.usage } as unknown as Record<string, unknown>,
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        costEur: String(costEur),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(batchRequests.id, row.id));

    // Write to cost_logs so limits + dashboard pick up batch costs (Pattern 120)
    await db.insert(costLogs).values({
      projectId: row.projectId,
      service: "anthropic",
      operation: `batch:${row.model}`,
      costEur: String(costEur),
      metadata: {
        model: row.model,
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        anthropicBatchId: row.anthropicBatchId,
        anthropicCustomId: row.anthropicCustomId,
      },
      ...(row.pipelineRunId ? { pipelineRunId: row.pipelineRunId } : {}),
      ...(row.articleId ? { articleId: row.articleId } : {}),
    });

    log.info(
      { batchRequestId: row.id, customId: item.custom_id, costEur },
      "Batch result succeeded — resuming pipeline"
    );

    // Load the updated row so resumePipeline gets the responseBody
    const [updated] = await db
      .select()
      .from(batchRequests)
      .where(eq(batchRequests.id, row.id))
      .limit(1);

    if (updated) {
      await resumePipeline(updated);
    }
  } else {
    await db
      .update(batchRequests)
      .set({
        status: "failed",
        errorBody: item.result as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(batchRequests.id, row.id));

    log.warn({ batchRequestId: row.id, customId: item.custom_id, type: item.result.type }, "Batch result failed");
  }
}

// ─── Worker + cron registration ───────────────────────────────────────────────

export function startBatchProcessorWorker(): Worker {
  const queue = new Queue(BATCH_PROCESSOR_QUEUE, { connection: getConnection() });
  _queue = queue;

  // Register two repeatable cron jobs
  void queue.add(SUBMIT_JOB, {}, { repeat: { pattern: "*/30 * * * *" }, jobId: SUBMIT_JOB });
  void queue.add(PROCESS_JOB, {}, { repeat: { pattern: "0 */6 * * *" }, jobId: PROCESS_JOB });

  const worker = new Worker(
    BATCH_PROCESSOR_QUEUE,
    async (job) => {
      if (job.name === SUBMIT_JOB) {
        await submitPendingRequests();
      } else if (job.name === PROCESS_JOB) {
        await processBatches();
      }
    },
    {
      connection: getConnection(),
      concurrency: 1,
    }
  );

  worker.on("ready", () => log.info("Batch processor worker started"));
  worker.on("completed", (job) => log.debug({ jobName: job.name }, "Batch processor job done"));
  worker.on("failed", (job, err) => log.error({ jobName: job?.name, err }, "Batch processor job failed"));

  _worker = worker;
  return worker;
}

export async function closeBatchProcessorInfrastructure(): Promise<void> {
  if (_worker) await _worker.close();
  if (_queue) await _queue.close();
  if (_connection) await _connection.quit();
}
