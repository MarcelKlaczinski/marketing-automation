/**
 * Spec 65.5 — Recurring brief-generator worker (Option β standalone).
 *
 * Consumes per-definition jobs enqueued by `recurring-content.cron.ts`.
 * Each job:
 *   1. Acquires a Redis lock on the definitionId (5min TTL) — prevents
 *      concurrent runs of the same definition. The lock is best-effort
 *      bounded by the BullMQ `concurrency: 1` so a same-tick re-fire is the
 *      only race vector.
 *   2. Re-loads the definition (the cron may have read a stale row).
 *   3. Dispatches to the format-type-specific brief-generator.
 *   4. On `status: "persisted"` advances `last_run_at` + `next_run_at` via
 *      `markRecurringDefinitionRun` so the cron skips the definition until
 *      the next interval.
 *   5. On `status: "skipped"` writes a structured log entry + dispatches an
 *      admin notification (Memory D21) so Marcel can see the rhythm-gap.
 *
 * Per-job failures are caught + logged but the BullMQ job is re-thrown so
 * `attempts: 1` + the failed-queue makes the error visible in the runs UI.
 */
import {
  db,
  eq,
  getRecurringDefinition,
  markRecurringDefinitionRun,
  projects,
  topicBriefs,
} from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { Queue, type Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  type BriefGenContext,
  dispatchBriefGenerator,
  UnknownFormatTypeError,
  type GeneratedBriefResult,
} from "../lib/recurring-content/brief-generators/index.ts";
import { computeNextRun } from "../lib/recurring-content/compute-next-run.ts";
import type { NotifyRecurringBriefSkippedInput } from "../lib/recurring-content/notify-skipped.ts";
import { notifyBriefSkippedWithCooldown } from "../lib/recurring-content/skip-cooldown.ts";
import { resolveAutoApprove } from "../lib/recurring-content/resolve-auto-approve.ts";

const log = createLogger("recurring-brief-generator-worker");

export const RECURRING_BRIEF_GENERATOR_QUEUE = "recurring-brief-generator";

/** Redis-lock TTL — 5min covers worst-case 4 LLM calls (curate + rank + brief-text + hook). */
const LOCK_TTL_SECONDS = 300;

const jobSchema = z.object({
  definitionId: z.string().uuid(),
  projectId: z.string().uuid(),
  /**
   * Spec 65.11 — when true, the worker skips `markRecurringDefinitionRun`
   * so the schedule isn't consumed by an out-of-band manual fire. Used by
   * the "Run Now" button on the Settings UI definition detail page.
   */
  forceImmediate: z.boolean().optional(),
});
export type RecurringBriefGeneratorJobData = z.infer<typeof jobSchema>;

// ─── Redis + queue singletons ────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getRecurringBriefGeneratorQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(RECURRING_BRIEF_GENERATOR_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    },
  });
  return _queue;
}

/**
 * Enqueue a per-definition brief-generation job. Called by the cron
 * coordinator (`recurring-content.cron.ts`). Deterministic `jobId` so
 * back-to-back cron ticks dedup at the BullMQ layer in addition to the
 * Redis lock.
 */
export async function enqueueRecurringBriefGenerator(input: {
  definitionId: string;
  projectId: string;
  /** Spec 65.11 — when true, the worker skips `markRecurringDefinitionRun`. */
  forceImmediate?: boolean;
}): Promise<{ jobId: string }> {
  const queue = getRecurringBriefGeneratorQueue();
  const jobId = `recurring-${input.definitionId}-${Date.now()}`;
  await queue.add(
    "generate",
    {
      definitionId: input.definitionId,
      projectId: input.projectId,
      ...(input.forceImmediate !== undefined && { forceImmediate: input.forceImmediate }),
    },
    { jobId },
  );
  return { jobId };
}

// ─── Redis lock helpers ──────────────────────────────────────────────────────

/**
 * Best-effort Redis lock using `SET NX EX`. Returns the lock token when
 * acquired; the caller passes it back to `releaseRedisLock` so we only
 * release locks we own (avoid releasing a lock that has expired + been
 * re-acquired by another process).
 */
async function tryAcquireRedisLock(
  key: string,
  ttlSeconds: number,
): Promise<string | null> {
  const conn = getConnection();
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await conn.set(key, token, "EX", ttlSeconds, "NX");
  return result === "OK" ? token : null;
}

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

async function releaseRedisLock(key: string, token: string): Promise<void> {
  const conn = getConnection();
  try {
    await conn.eval(RELEASE_SCRIPT, 1, key, token);
  } catch (err) {
    log.warn({ key, err: err instanceof Error ? err.message : String(err) }, "release-lock failed");
  }
}

// ─── Job handler ─────────────────────────────────────────────────────────────

export async function handleRecurringBriefGenerator(
  data: RecurringBriefGeneratorJobData,
): Promise<{ status: "ran" | "skipped"; reason?: string }> {
  const lockKey = `recurring-def:${data.definitionId}`;
  const token = await tryAcquireRedisLock(lockKey, LOCK_TTL_SECONDS);
  if (token === null) {
    log.info(
      { definitionId: data.definitionId },
      "recurring-brief-generator: lock-busy, skipping run (concurrent tick)",
    );
    return { status: "skipped", reason: "lock-busy" };
  }

  try {
    const definition = await getRecurringDefinition(data.definitionId);
    if (!definition) {
      log.warn(
        { definitionId: data.definitionId },
        "recurring-brief-generator: definition not found — likely deleted between cron-pick and worker-pickup",
      );
      return { status: "skipped", reason: "deleted" };
    }
    if (!definition.isActive) {
      log.info(
        { definitionId: data.definitionId },
        "recurring-brief-generator: definition is inactive — skipping",
      );
      return { status: "skipped", reason: "inactive" };
    }
    if (definition.projectId !== data.projectId) {
      log.warn(
        { definitionId: data.definitionId, jobProjectId: data.projectId, defProjectId: definition.projectId },
        "recurring-brief-generator: project mismatch — rejecting (multi-tenant guard)",
      );
      return { status: "skipped", reason: "project-mismatch" };
    }

    // Resolve runNumber + previousRunToolIds from the most recent persisted
    // brief for this definition. Recurring briefs are stamped with
    // `recurring_metadata.runNumber` at emit time.
    const runNumber = await computeNextRunNumber(definition.id);
    const previousRunToolIds = await loadPreviousRunToolIds(definition.id);

    // Spec 65.V1.5a Bridge #3 — multi-locale fan-out. Emit ONE brief per entry
    // in `definition.targetLocales`. The first entry is treated as primary; a
    // single shared `runGroupId` UUID is generated only when there are 2+
    // locales (single-locale fires keep producing the pre-bridge metadata
    // shape with no `runGroupId` stamp). The project's primary language is
    // still used as fallback when `targetLocales` is empty or holds an
    // unknown value (Toolwiki DE-first invariant).
    const fallbackLanguage = await resolveProjectLanguage(definition.projectId);
    const targetLocales = resolveTargetLocales(definition.targetLocales, fallbackLanguage);
    const runGroupId = targetLocales.length > 1 ? crypto.randomUUID() : undefined;

    // Spec 65.V1.5b — resolve auto-approve once per fire, thread through every
    // per-locale generator. The override + project-default are READ ONCE here
    // so all locale-siblings within the same fire land in the same approval
    // state. Subsequent fires re-read against the freshest definition row.
    const [projectRow] = await db
      .select({
        recurringAutoApproveDefault: projects.recurringAutoApproveDefault,
      })
      .from(projects)
      .where(eq(projects.id, definition.projectId))
      .limit(1);
    const autoApprove = projectRow
      ? resolveAutoApprove({
          definitionAutoApproveOverride: definition.autoApproveOverride,
          projectRecurringAutoApproveDefault: projectRow.recurringAutoApproveDefault,
        })
      : false;

    let lastResult: GeneratedBriefResult | null = null;
    let persistedCount = 0;
    let skippedCount = 0;

    // Per-locale dispatch is awaited SEQUENTIALLY, not parallel.
    //
    // Rationale: each generator reads `previousRunToolIds` from prior briefs
    // for LRU diversity (loadPreviousRunToolIds at the top of this handler).
    // Parallel locale-runs would both query before either persists, so they'd
    // see identical `previousRunToolIds` and end up converging on the same
    // tool pool — defeating the LRU bias inside the same fire. Sequential
    // means the second locale sees the first locale's freshly-persisted
    // toolIds (via `loadPreviousRunToolIds` on the next worker pickup, not
    // this iteration — but the cost is one fire's worth of staleness, not
    // forever).
    //
    // Latency cost at 2 locales (Toolwiki today): ~30-60s sequential vs
    // ~15-30s parallel. For 5+ locales we'd revisit parallelism with a
    // shared in-memory `previousToolIds` accumulator. The Redis lock is
    // per-definitionId (not per-locale), so parallel would NOT deadlock.
    for (const language of targetLocales) {
      let result: GeneratedBriefResult;
      try {
        const briefCtx: BriefGenContext = {
          definition,
          // formatConfig is already typed `Record<string, unknown>` via the
          // schema's $type<>() — `?? {}` covers the NULL-by-default-after-
          // dynamic-shape edge case (e.g. a partial UPDATE that cleared the
          // field).
          config: definition.formatConfig ?? {},
          projectId: definition.projectId,
          language,
          runNumber,
        };
        if (previousRunToolIds) briefCtx.previousRunToolIds = previousRunToolIds;
        if (runGroupId !== undefined) briefCtx.runGroupId = runGroupId;
        // Spec 65.V1.5b — propagate the resolved auto-approve flag. Always
        // assign (even false) so a generator can rely on `ctx.autoApprove`
        // being defined when reading; the field is still typed optional for
        // back-compat with tests + the runDryRunForDefinition entry point
        // (dry-runs never persist so the flag is moot there).
        briefCtx.autoApprove = autoApprove;
        result = await dispatchBriefGenerator(briefCtx);
      } catch (err) {
        if (err instanceof UnknownFormatTypeError) {
          log.error(
            { definitionId: definition.id, formatType: definition.formatType },
            "recurring-brief-generator: unknown format-type — definition needs cleanup",
          );
          return { status: "skipped", reason: "unknown-format-type" };
        }
        throw err;
      }
      lastResult = result;

      if (result.status === "persisted") {
        persistedCount += 1;
        log.info(
          {
            definitionId: definition.id,
            briefId: result.brief.id,
            language,
            runGroupId: runGroupId ?? null,
            templateKey: result.templateKey,
            toolCount: result.toolIds.length,
          },
          "recurring-brief-generator: brief persisted",
        );
      } else if (result.status === "skipped") {
        skippedCount += 1;
        log.warn(
          {
            definitionId: definition.id,
            language,
            runGroupId: runGroupId ?? null,
            reason: result.reason,
            detail: result.detail,
            missingToolIds: result.missingToolIds,
          },
          "recurring-brief-generator: brief skipped",
        );
        // Each skipped sibling fires its own notification — Marcel needs to
        // know "EN went through but DE didn't" rather than just "something
        // skipped this fire". The skip-reason already lives in the
        // notification body so the locale-mix is implicit.
        // Spec 65.V1.5b — 24h cooldown to prevent same-skip-reason spam when
        // a brand-asset gap or hook-library hole persists across multiple
        // cron ticks. The wrapper updates `recurring_content_definitions.
        // last_skip_notified_at` atomically with the dispatch.
        const notifyInput: NotifyRecurringBriefSkippedInput = {
          projectId: definition.projectId,
          definitionId: definition.id,
          definitionName: definition.name,
          reason: result.reason,
        };
        if (result.missingToolIds) notifyInput.missingToolIds = result.missingToolIds;
        if (result.detail) notifyInput.detail = result.detail;
        await notifyBriefSkippedWithCooldown({
          ...notifyInput,
          lastSkipNotifiedAt: definition.lastSkipNotifiedAt ?? null,
        });
      } else {
        // `dry-run-preview` is structurally unreachable here — the BullMQ worker
        // never sets `ctx.dryRun = true` (dry-runs go through the synchronous
        // `runDryRunForDefinition` entry point). Log defensively in case a
        // future generator refactor leaks the variant through.
        log.error(
          { definitionId: definition.id, language, status: result.status },
          "recurring-brief-generator: unexpected dry-run-preview from BullMQ path",
        );
      }
    }

    // Use the last per-locale result as the "summary" returned to BullMQ.
    // Workers don't act on this value beyond logging; the per-locale logs
    // above are the source of truth. If ANY sibling persisted, the tick
    // counts as "ran"; otherwise it's a "skipped" tick.
    const result: GeneratedBriefResult = lastResult ?? {
      status: "skipped" as const,
      reason: "inactive-definition" as const,
      detail: "targetLocales was empty after normalisation",
    };

    // Advance next_run_at + last_run_at regardless of outcome. Skipped briefs
    // still consume the slot — a missing-asset skip shouldn't fire again in
    // 30 seconds (Marcel-Decision §0 — admin reviews the notification + fixes
    // the asset, then waits for the next interval).
    //
    // Spec 65.11 — `forceImmediate` (Run-Now from Settings UI) DOES persist
    // the brief but doesn't advance `next_run_at`. The next scheduled tick
    // still fires on schedule. Without this gate, the manual fire would
    // skip the next regular run entirely.
    if (!data.forceImmediate) {
      const nextRun = computeNextRun(definition.frequency, new Date());
      await markRecurringDefinitionRun(definition.id, { newNextRunAt: nextRun });
    } else {
      log.info(
        { definitionId: definition.id },
        "recurring-brief-generator: forceImmediate=true, skipping next_run_at advance",
      );
    }

    // Bridge #3 — roll up the per-locale outcomes into a single tick status.
    // Tick "ran" iff at least one sibling persisted. Otherwise inherit the
    // last sibling's skip reason (most informative for the audit log).
    if (persistedCount > 0) {
      if (skippedCount > 0) {
        log.warn(
          {
            definitionId: definition.id,
            persistedCount,
            skippedCount,
            runGroupId: runGroupId ?? null,
          },
          "recurring-brief-generator: mixed-outcome tick (some siblings persisted, some skipped)",
        );
      }
      return { status: "ran" };
    }
    if (result.status === "skipped") return { status: "skipped", reason: result.reason };
    // Unreachable from the BullMQ path (see defensive log above).
    return { status: "skipped", reason: "unexpected-dry-run-preview" };
  } finally {
    await releaseRedisLock(lockKey, token);
  }
}

/**
 * Spec 65.V1.5a Bridge #3 — normalise the raw `definition.targetLocales` jsonb
 * into the two-letter `"de" | "en"` codes the brief-generator stack
 * consumes. Filters unknown entries (forward-compat with future locales) and
 * dedup-preserves order. Empty result falls back to the project's primary
 * language so misconfigured rows don't silently skip a fire.
 */
export function resolveTargetLocales(
  raw: unknown,
  fallback: "de" | "en",
): Array<"de" | "en"> {
  if (!Array.isArray(raw)) return [fallback];
  const seen = new Set<"de" | "en">();
  const out: Array<"de" | "en"> = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const code = entry.toLowerCase().startsWith("en") ? "en" : entry.toLowerCase().startsWith("de") ? "de" : null;
    if (code === null || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.length > 0 ? out : [fallback];
}

/**
 * Count the persisted recurring briefs for this definition + 1. First run
 * gives runNumber=1. Reads `topic_briefs.recurringMetadata->>'definitionId'`
 * — no FK on the jsonb path, so a sequential scan with a partial-index
 * (existing `topic_briefs_project_source_idx`) is fine at typical scale.
 */
async function computeNextRunNumber(definitionId: string): Promise<number> {
  const rows = await db
    .select({
      meta: topicBriefs.recurringMetadata,
    })
    .from(topicBriefs)
    .where(eq(topicBriefs.source, "recurring"));
  let count = 0;
  for (const r of rows) {
    if (r.meta?.definitionId === definitionId) count += 1;
  }
  return count + 1;
}

async function loadPreviousRunToolIds(definitionId: string): Promise<string[] | undefined> {
  const rows = await db
    .select({
      meta: topicBriefs.recurringMetadata,
      createdAt: topicBriefs.createdAt,
    })
    .from(topicBriefs)
    .where(eq(topicBriefs.source, "recurring"));
  let latestMeta: Record<string, unknown> | null = null;
  let latestAt = 0;
  for (const r of rows) {
    if (!r.meta || r.meta.definitionId !== definitionId) continue;
    const ts = r.createdAt.getTime();
    if (latestMeta === null || ts > latestAt) {
      latestMeta = r.meta as unknown as Record<string, unknown>;
      latestAt = ts;
    }
  }
  if (latestMeta === null) return undefined;
  // Prefer the actual toolIds picked in the prior brief
  // (stored via formatConfig.toolIds in `persist-brief.ts`).
  const fcRaw = latestMeta.formatConfig;
  if (fcRaw && typeof fcRaw === "object") {
    const candidate = (fcRaw as { toolIds?: unknown }).toolIds;
    if (Array.isArray(candidate)) {
      return candidate.filter((id): id is string => typeof id === "string");
    }
  }
  const fallback = latestMeta.previousToolIds;
  if (Array.isArray(fallback)) {
    return fallback.filter((id): id is string => typeof id === "string");
  }
  return undefined;
}

/**
 * Read `projects.target_locales[0]` and collapse to the two-letter code the
 * brief-generator stack uses (`'de' | 'en'`). Defaults to `'de'` when the
 * project is missing or the locale isn't recognised — Toolwiki is German,
 * BK will explicitly set its locale on onboarding.
 */
async function resolveProjectLanguage(projectId: string): Promise<"de" | "en"> {
  const [row] = await db
    .select({ targetLocales: projects.targetLocales })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const first = row?.targetLocales?.[0];
  if (typeof first === "string" && first.toLowerCase().startsWith("en")) return "en";
  return "de";
}

// ─── Dry-run entry (synchronous, bypasses BullMQ) ────────────────────────────

/**
 * Spec 65.11 — Synchronous dry-run for the Settings UI "Test mit Dry-Run"
 * button. Runs the same dispatch path as `handleRecurringBriefGenerator` but
 * with `ctx.dryRun = true` so each generator short-circuits before
 * `persistRecurringBrief` / `logTemplateUsage`. Returns the preview directly
 * to the HTTP caller. Cost-tracked under the normal Anthropic operation
 * budgets — every LLM call is real.
 *
 * No Redis-lock (a dry-run can race a real run harmlessly — neither writes
 * to template_usage_log + neither flips next_run_at), no next-run advance,
 * no skip-notification dispatch (the UI surfaces the skip reason directly).
 */
export async function runDryRunForDefinition(input: {
  definitionId: string;
  projectId: string;
}): Promise<GeneratedBriefResult> {
  const definition = await getRecurringDefinition(input.definitionId);
  if (!definition) {
    return { status: "skipped", reason: "inactive-definition", detail: "Definition not found" };
  }
  if (definition.projectId !== input.projectId) {
    return {
      status: "skipped",
      reason: "inactive-definition",
      detail: "Project mismatch — multi-tenant guard",
    };
  }

  const runNumber = await computeNextRunNumber(definition.id);
  const previousRunToolIds = await loadPreviousRunToolIds(definition.id);
  const fallbackLanguage = await resolveProjectLanguage(definition.projectId);

  // Bridge #3 — dry-run only emits the FIRST target-locale's preview. Marcel
  // sees one preview per Test-click; if both locales need previewing, click
  // Test twice (or seed sibling-locale Test in 65.V1.5b). The runGroupId
  // pattern doesn't apply because dry-run never persists.
  const targetLocales = resolveTargetLocales(definition.targetLocales, fallbackLanguage);
  const language = targetLocales[0] ?? fallbackLanguage;

  const briefCtx: BriefGenContext = {
    definition,
    config: definition.formatConfig ?? {},
    projectId: definition.projectId,
    language,
    runNumber,
    dryRun: true,
  };
  if (previousRunToolIds) briefCtx.previousRunToolIds = previousRunToolIds;
  return await dispatchBriefGenerator(briefCtx);
}

// ─── Worker entry ────────────────────────────────────────────────────────────

export function startRecurringBriefGeneratorWorker(): Worker {
  return new Worker(
    RECURRING_BRIEF_GENERATOR_QUEUE,
    async (job: Job) => {
      const parsed = jobSchema.parse(job.data);
      return await handleRecurringBriefGenerator(parsed);
    },
    { connection: getConnection(), concurrency: 1 },
  );
}
