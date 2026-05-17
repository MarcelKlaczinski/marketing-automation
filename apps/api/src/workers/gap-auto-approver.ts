import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  and,
  contentGaps,
  db,
  eq,
  inArray,
  projects,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import { COST_OPS } from "@marketing-auto/core";
import {
  decideRoute,
  enqueueArticleOutlinePipeline,
  enqueueBlogGenerationPipeline,
  executeDecision,
} from "@marketing-auto/pipelines";
import { triggerWithPreRunId } from "../routes/_lib/trigger-helpers.ts";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("gap-auto-approver");

export const GAP_AUTO_APPROVER_QUEUE = "gap-auto-approver";

// ─── Redis connection ─────────────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getGapAutoApproverQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(GAP_AUTO_APPROVER_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 60_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 25 },
    },
  });
  return _queue;
}

// ─── Job schema ───────────────────────────────────────────────────────────────

const scanJobSchema = z.object({ type: z.literal("scan-all") });
const projectJobSchema = z.object({
  type: z.literal("approve-project"),
  projectId: z.string().uuid(),
});
const jobSchema = z.discriminatedUnion("type", [scanJobSchema, projectJobSchema]);

// ─── Core logic ───────────────────────────────────────────────────────────────

export async function autoApproveGapsForProject(projectId: string): Promise<void> {
  const activeBriefStatuses: Array<"pending" | "approved"> = ["pending", "approved"];

  // Find open gaps that have a suggested title populated (i.e. /suggest was previously called)
  const pendingGaps = await db
    .select({ id: contentGaps.id, status: contentGaps.status })
    .from(contentGaps)
    .where(
      and(
        eq(contentGaps.projectId, projectId),
        eq(contentGaps.status, "open"),
        sql`${contentGaps.metadata}->>'suggestedTitle' IS NOT NULL`,
      ),
    );

  if (pendingGaps.length === 0) {
    log.debug({ projectId }, "No suggested gaps eligible for auto-approval");
    return;
  }

  const gapIds = pendingGaps.map((g) => g.id);

  // Load active briefs for all eligible gaps in one query
  const briefs = await db
    .select()
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, projectId),
        inArray(topicBriefs.gapId, gapIds),
        inArray(topicBriefs.approvalStatus, activeBriefStatuses),
      ),
    );

  const briefByGapId = new Map(briefs.map((b) => [b.gapId, b]));

  let triggered = 0;
  let skipped = 0;

  for (const gap of pendingGaps) {
    const brief = briefByGapId.get(gap.id);
    if (!brief) {
      log.warn({ gapId: gap.id, projectId }, "No active brief for auto-approval candidate — skipping");
      skipped++;
      continue;
    }

    try {
      const decision = decideRoute(brief);
      const routeResult = await db.transaction(async (tx) => executeDecision(decision, brief, tx));

      if (routeResult.kind === "skipped") {
        log.debug({ gapId: gap.id, reason: routeResult.reason }, "Auto-approval skipped by routing policy");
        skipped++;
        continue;
      }

      if (
        routeResult.kind === "article_created" ||
        routeResult.kind === "translation_created"
      ) {
        const isBlogBrief =
          routeResult.kind === "article_created" &&
          brief.locale !== null &&
          brief.clusterId !== null;

        const triggerResult = await (isBlogBrief
          ? triggerWithPreRunId({
              pipelineName: "article:blog",
              projectId,
              uniqueKey:    { field: "articleId", value: routeResult.articleId },
              costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
              extraInput:   { articleId: routeResult.articleId, briefId: brief.id },
              enqueue:      enqueueBlogGenerationPipeline,
            })
          : triggerWithPreRunId({
              pipelineName: "article:outline",
              projectId,
              uniqueKey:    { field: "articleId", value: routeResult.articleId },
              costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
              extraInput:   { articleId: routeResult.articleId },
              enqueue:      enqueueArticleOutlinePipeline,
            }));

        if ("error" in triggerResult) {
          log.warn({ gapId: gap.id, error: triggerResult.error }, "Auto-approval trigger blocked by cost/pause guard");
          skipped++;
          continue;
        }

        await db
          .update(contentGaps)
          .set({
            filledByArticleId:     routeResult.articleId,
            generationTriggeredAt: new Date(),
            status:                "in_progress",
            updatedAt:             new Date(),
          })
          .where(eq(contentGaps.id, gap.id));

        log.info({ gapId: gap.id, articleId: routeResult.articleId, projectId }, "Gap auto-approved (cron)");
        triggered++;
      } else if (routeResult.kind === "cornerstone_spec_created") {
        await db
          .update(contentGaps)
          .set({
            filledBySpecId:        routeResult.cornerstoneSpecId,
            generationTriggeredAt: new Date(),
            status:                "in_progress",
            updatedAt:             new Date(),
          })
          .where(eq(contentGaps.id, gap.id));

        log.info({ gapId: gap.id, specId: routeResult.cornerstoneSpecId, projectId }, "Gap auto-approved to cornerstone spec (cron)");
        triggered++;
      }
    } catch (err) {
      log.error({ err, gapId: gap.id, projectId }, "Auto-approval failed for gap — skipping");
      skipped++;
    }
  }

  log.info({ projectId, triggered, skipped }, "Gap auto-approval scan complete");
}

// ─── Worker ───────────────────────────────────────────────────────────────────

async function handleJob(job: Job): Promise<void> {
  const parsed = jobSchema.safeParse(job.data);
  if (!parsed.success) {
    log.error({ jobId: job.id, issues: parsed.error.issues }, "Invalid gap-auto-approver job data");
    return;
  }

  if (parsed.data.type === "scan-all") {
    // Find all projects with autoApproveGaps=true and process each
    const eligibleProjects = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(eq(projects.autoApproveGaps, true));

    log.info({ count: eligibleProjects.length }, "Starting daily gap auto-approval scan");

    for (const project of eligibleProjects) {
      try {
        await autoApproveGapsForProject(project.id);
      } catch (err) {
        log.error({ err, projectId: project.id, slug: project.slug }, "Auto-approval scan failed for project");
      }
    }
    return;
  }

  if (parsed.data.type === "approve-project") {
    await autoApproveGapsForProject(parsed.data.projectId);
  }
}

export function startGapAutoApproverWorker(): Worker {
  const worker = new Worker(GAP_AUTO_APPROVER_QUEUE, handleJob, {
    connection: getConnection(),
    concurrency: 1,
    lockDuration: 600_000,
  });

  worker.on("completed", (job) =>
    log.info({ jobId: job.id, type: job.data?.type }, "Gap auto-approver job completed"),
  );
  worker.on("failed", (job, err) =>
    log.error({ err, jobId: job?.id, type: job?.data?.type }, "Gap auto-approver job failed"),
  );

  return worker;
}

// ─── Daily cron registration ──────────────────────────────────────────────────

const GAP_AUTO_APPROVER_CRON = "0 4 * * *"; // 04:00 UTC daily

export async function registerGapAutoApproverCron(): Promise<void> {
  const queue = getGapAutoApproverQueue();
  await queue.add(
    "daily-scan",
    { type: "scan-all" },
    {
      repeat: { pattern: GAP_AUTO_APPROVER_CRON },
      jobId:  "gap-auto-approver:daily-scan",
    },
  );
  log.info({ cron: GAP_AUTO_APPROVER_CRON }, "Gap auto-approver daily cron registered");
}
