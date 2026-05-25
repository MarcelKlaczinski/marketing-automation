// Spec 64.20: GitHub-inventory refresh worker.
//
// Cron-orchestrator pattern (mirror of comparison-discovery.worker.ts):
// - One BullMQ repeatable job per active `cron_state` row (job_type='github_inventory_refresh').
// - Job name: `github_inventory_refresh:<projectId>`, dispatched by orchestrator.
// - On tick, this worker reads PAT from vault and refreshes due rows in
//   `content_source_inventory` for that project (CAS-claim → fetch → persist).
//
// Per-row interval is the user-tunable knob; cron tick is `*/15 * * * *` by
// default — set via `INVENTORY_REFRESH_CRON_PATTERN`. Default `is_active: true`
// because empty inventory = no-op tick (the predicate is indexed); Marcel can
// disable per-project via Settings-UI (Day 4).
//
// Errors are persisted per-row via `markInventoryError`. Only an adapter-level
// rate-limit halts the tick (worker-job is marked failed by BullMQ; next */15
// tick picks up after the reset). attempts=1 — no auto-retry to avoid burning
// the rate-limit budget on a known-throttled state.

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  cronState,
  db,
  getInventoryById,
  insertStarSnapshot,
  listInventoryDueForRefresh,
  markCronRunFailed,
  markCronRunSucceeded,
  markInventoryError,
  markInventoryFetching,
  markInventoryOk,
  projectPlannerConfig,
  projects,
  pruneStarSnapshots,
  queryStarsAgo,
  eq,
  type ContentSourceInventory,
  type GithubInventoryMetadata as DbGithubInventoryMetadata,
} from "@marketing-auto/db";
import {
  fetchFullRepoMetadata as defaultFetchFullRepoMetadata,
  GitHubRateLimitError,
  detectSkill as defaultDetectSkill,
  parseSourceIdentifier,
  type DetectSkillResult,
  type FetchFullRepoMetadataResult,
  type GitHubCredentials,
} from "@marketing-auto/adapter-github-inventory";
import {
  detectStarTrend,
  emitReleaseBrief as defaultEmitReleaseBrief,
  emitStarTrendBrief as defaultEmitStarTrendBrief,
  type EmitReleaseBriefInput,
  type EmitReleaseBriefResult,
  type EmitStarTrendBriefInput,
  type EmitStarTrendBriefResult,
} from "@marketing-auto/pipelines";
import {
  createLogger,
  getEnv,
  resolveStarTrendConfig,
  type ResolvedStarTrendConfig,
} from "@marketing-auto/shared";
import { readAdapterCreds as defaultReadAdapterCreds } from "../lib/system-service.ts";

const log = createLogger("github-inventory-refresh");

export const GITHUB_INVENTORY_QUEUE = "github-inventory-refresh";

/** Default cron pattern — `INVENTORY_REFRESH_CRON_PATTERN` env overrides. */
export const GITHUB_INVENTORY_REFRESH_DEFAULT_PATTERN = "*/15 * * * *";

/** Max rows to refresh per worker tick. */
const BATCH_SIZE = 20;

/** Transactional race buffer — grace window for freshly-inserted rows. */
const AGE_BUFFER_SECONDS = 30;

// ─── Redis connection ───────────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getGithubInventoryQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(GITHUB_INVENTORY_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  });
  return _queue;
}

// ─── Job schema ─────────────────────────────────────────────────────────────

/**
 * Both cron-triggered ticks and manual-trigger fires use the same shape.
 * `ids` is non-empty only for "refresh specific rows" trigger; cron ticks omit it.
 */
const jobSchema = z
  .object({
    projectId: z.string().uuid(),
    type: z.enum(["cron-triggered", "refresh-manual"]).optional(),
    ids: z.array(z.string().uuid()).optional(),
  })
  .passthrough();

// ─── Cron seed ──────────────────────────────────────────────────────────────

/**
 * Idempotently seed `cron_state` rows for every project so the orchestrator
 * picks them up on its next tick. Default `is_active: true` because inventory
 * is opt-in by data (empty rows = no-op tick); per-project disable lives in
 * the Settings-UI (Day 4).
 *
 * Lives in worker code (not SQL migration) — Memory D124, same as
 * `seedComparisonDiscoveryCron`.
 */
export async function seedGithubInventoryRefreshCron(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  if (allProjects.length === 0) return;
  const pattern =
    getEnv().INVENTORY_REFRESH_CRON_PATTERN ?? GITHUB_INVENTORY_REFRESH_DEFAULT_PATTERN;
  const values = allProjects.map((p) => ({
    projectId: p.id,
    jobType: "github_inventory_refresh" as const,
    isActive: true,
    cronPattern: pattern,
  }));
  await db.insert(cronState).values(values).onConflictDoNothing();
  log.info(
    { projectCount: allProjects.length, pattern },
    "Seeded github_inventory_refresh cron_state rows",
  );
}

// ─── DI seam for testability ────────────────────────────────────────────────

/**
 * Injectable dependencies for the tick handler. Default values are the
 * production implementations; tests inject fakes to keep the worker offline
 * and the GitHub adapter untouched. Pattern 121 (Pattern from Spec 64.10
 * cleanup-orphan-heroes + Spec 64.15 backfill scripts).
 */
export interface InventoryRefreshDeps {
  /** Vault read for the GitHub PAT. Default: `readAdapterCreds('github')`. */
  readCreds: (service: string) => Promise<Record<string, string>>;
  /** Compose 2 GitHub-API calls into the typed metadata bucket. */
  fetchFullRepoMetadata: (
    fullName: string,
    creds: GitHubCredentials,
  ) => Promise<FetchFullRepoMetadataResult>;
  /** SKILL.md detection for skill-typed rows. */
  detectSkill: (
    sourceIdentifier: string,
    creds: GitHubCredentials,
  ) => Promise<DetectSkillResult>;
  /** Spec 64.20 follow-up A3 — emit release-detection brief on tag change. */
  emitReleaseBrief: (input: EmitReleaseBriefInput) => Promise<EmitReleaseBriefResult>;
  /** Spec 64.21 — emit star-trend brief when threshold crossed. */
  emitStarTrendBrief: (input: EmitStarTrendBriefInput) => Promise<EmitStarTrendBriefResult>;
}

const defaultDeps: InventoryRefreshDeps = {
  readCreds: defaultReadAdapterCreds,
  fetchFullRepoMetadata: defaultFetchFullRepoMetadata,
  detectSkill: defaultDetectSkill,
  emitReleaseBrief: defaultEmitReleaseBrief,
  emitStarTrendBrief: defaultEmitStarTrendBrief,
};

// ─── Star-trend per-project config cache (Spec 64.21) ───────────────────────
//
// `project_planner_config.star_trend_config` is read once per tick (potentially
// for every row in the batch). A simple in-memory Map cache (keyed by
// projectId) avoids N+1 SELECTs. Cache is per-process and per-tick — the next
// cron fire creates a fresh map.

const _starTrendConfigCache = new Map<string, ResolvedStarTrendConfig>();

async function getStarTrendConfigForProject(projectId: string): Promise<ResolvedStarTrendConfig> {
  const cached = _starTrendConfigCache.get(projectId);
  if (cached) return cached;
  const [row] = await db
    .select({ starTrendConfig: projectPlannerConfig.starTrendConfig })
    .from(projectPlannerConfig)
    .where(eq(projectPlannerConfig.projectId, projectId))
    .limit(1);
  const resolved = resolveStarTrendConfig(row?.starTrendConfig ?? null);
  _starTrendConfigCache.set(projectId, resolved);
  return resolved;
}

/**
 * Compare the prior snapshot (windowDays ago) against the freshly-fetched
 * star count. On trigger, emit a star-trend brief. The function is called
 * AFTER `insertStarSnapshot` so the fresh count is in the time-series — but
 * `queryStarsAgo(NOW - windowDays)` returns the snapshot strictly older than
 * the fresh insert (DESC order, cutoff = NOW - windowDays).
 */
async function maybeEmitStarTrend(
  row: ContentSourceInventory,
  currentStarsCount: number,
  latestReleaseTag: string | null,
  deps: InventoryRefreshDeps,
): Promise<void> {
  const config = await getStarTrendConfigForProject(row.projectId);
  const cutoff = new Date(Date.now() - config.windowDays * 24 * 60 * 60 * 1000);
  const prior = await queryStarsAgo(row.id, cutoff);
  if (!prior) {
    // No history old enough — the row was added less than windowDays ago.
    // No detection possible until the time-series accumulates.
    log.debug(
      { id: row.id, currentStarsCount, windowDays: config.windowDays },
      "Star-trend skip — no prior snapshot at or before cutoff",
    );
    return;
  }

  const detection = detectStarTrend({
    priorStarsCount: prior.starsCount,
    currentStarsCount,
    config,
  });
  if (!detection.triggered) return;

  // `trigger: "absolute" | "relative"` after the !triggered guard above.
  if (detection.trigger === "none") return; // defensive; cannot happen post-guard

  const result = await deps.emitStarTrendBrief({
    projectId:        row.projectId,
    inventoryRowId:   row.id,
    sourceIdentifier: row.sourceIdentifier,
    displayName:      row.displayName,
    priorStarsCount:  prior.starsCount,
    currentStarsCount,
    growthAbsolute:   detection.growthAbsolute,
    growthPct:        detection.growthPct,
    trigger:          detection.trigger,
    periodDays:       config.windowDays,
    weeklyCap:        config.weeklyCap,
    latestReleaseTag,
  });
  if (result.briefId) {
    log.info(
      {
        id: row.id,
        briefId: result.briefId,
        priorStarsCount: prior.starsCount,
        currentStarsCount,
        growthAbsolute: detection.growthAbsolute,
        growthPct: detection.growthPct,
        trigger: detection.trigger,
      },
      "Star-trend brief emitted",
    );
  } else if (result.skipped) {
    log.debug(
      { id: row.id, skipped: result.skipped, trigger: detection.trigger },
      "Star-trend emission skipped",
    );
  }
}

/** Retention: 90 days = 3× default 30-day detection window. */
const STAR_HISTORY_RETENTION_DAYS = 90;

/**
 * End-of-tick housekeeping — single DELETE per tick (idempotent, cheap when
 * partitioned by the snapshotAt index). Test-injectable via the deps shape
 * is unnecessary because the function is a no-op on an empty table.
 */
async function pruneStarHistoryAtEndOfTick(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STAR_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await pruneStarSnapshots(cutoff);
    if (deleted > 0) {
      log.info({ deleted, cutoff: cutoff.toISOString() }, "Pruned stale star-history rows");
    }
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Star-history prune failed; will retry next tick",
    );
  }
}

// ─── Per-row refresh ─────────────────────────────────────────────────────────

/**
 * Refresh a single inventory row. Returns `false` on rate-limit so the caller
 * can short-circuit the rest of the batch (no point making more calls when the
 * budget is exhausted).
 *
 * Per-row errors (auth, not-found, transport) are persisted via
 * `markInventoryError` and the loop continues.
 */
async function refreshOne(
  row: ContentSourceInventory,
  creds: GitHubCredentials,
  deps: InventoryRefreshDeps,
): Promise<{ continueBatch: boolean }> {
  const claimed = await markInventoryFetching(row.id);
  if (!claimed) {
    // Concurrently claimed by another worker, OR no longer in a claimable state.
    log.debug({ id: row.id }, "Skipping — could not claim (CAS race or wrong state)");
    return { continueBatch: true };
  }

  try {
    const { fullName, subdir } = parseSourceIdentifier(row.sourceIdentifier);
    const { metadata } = await deps.fetchFullRepoMetadata(fullName, creds);

    // For skill rows, attempt to fetch SKILL.md frontmatter.
    if (row.objectType === "skill") {
      const skill = await deps.detectSkill(row.sourceIdentifier, creds);
      if (skill.frontmatter) {
        metadata.skillFrontmatter = skill.frontmatter;
      } else {
        log.debug({ id: row.id, fullName, subdir }, "No SKILL.md frontmatter detected");
      }
    }

    // Spec 64.20 follow-up A3 — release-detection.
    // Compare prior github_metadata.latestRelease.tag (read from the row
    // BEFORE markInventoryOk overrides it) against the freshly-fetched tag.
    // Emit a brief only when (a) a prior tag existed (not the first-fetch
    // baseline), (b) a new tag exists, (c) they differ.
    const prevMeta = row.githubMetadata as
      | DbGithubInventoryMetadata
      | Record<string, never>;
    const previousReleaseTag =
      "latestRelease" in prevMeta && prevMeta.latestRelease
        ? prevMeta.latestRelease.tag
        : null;
    const newReleaseTag = metadata.latestRelease?.tag ?? null;

    if (
      previousReleaseTag !== null &&
      newReleaseTag !== null &&
      previousReleaseTag !== newReleaseTag &&
      metadata.latestRelease !== null
    ) {
      try {
        const result = await deps.emitReleaseBrief({
          projectId:          row.projectId,
          inventoryRowId:     row.id,
          sourceIdentifier:   row.sourceIdentifier,
          displayName:        row.displayName,
          previousReleaseTag,
          newReleaseTag,
          releaseName:        metadata.latestRelease.name,
          releasePublishedAt: metadata.latestRelease.publishedAt,
          starsCount:         metadata.starsCount,
        });
        if (result.briefId) {
          log.info(
            { id: row.id, briefId: result.briefId, previousReleaseTag, newReleaseTag },
            "Release-detection brief emitted",
          );
        } else if (result.skipped) {
          log.debug(
            { id: row.id, skipped: result.skipped, previousReleaseTag, newReleaseTag },
            "Release-detection emission skipped",
          );
        }
      } catch (err) {
        // Don't fail the refresh tick on brief-emit issues — log + continue.
        log.warn(
          { id: row.id, err: err instanceof Error ? err.message : String(err) },
          "Release-detection brief emission failed; continuing refresh",
        );
      }
    }

    // Spec 64.21 — Star-Trend Story detection. Snapshot the current star count
    // BEFORE `markInventoryOk` so the time-series order matches the metadata
    // write order (read-after-write consistency for the next tick). The
    // detection compares against the snapshot from `windowDays` ago.
    if (typeof metadata.starsCount === "number" && metadata.starsCount >= 0) {
      try {
        await insertStarSnapshot({
          projectId:   row.projectId,
          inventoryId: row.id,
          starsCount:  metadata.starsCount,
        });
        await maybeEmitStarTrend(row, metadata.starsCount, metadata.latestRelease?.tag ?? null, deps);
      } catch (err) {
        // Star-history failure must not break the refresh tick — log + continue
        // (same try/catch posture as release-detection). The next tick will
        // try again from the same baseline.
        log.warn(
          { id: row.id, err: err instanceof Error ? err.message : String(err) },
          "Star-trend snapshot/detection failed; continuing refresh",
        );
      }
    }

    // Adapter + DB types are structurally compatible; the cast resolves the
    // exactOptionalPropertyTypes mismatch on the `watchersCount?: number` /
    // `watchersCount?: number | undefined` divergence.
    await markInventoryOk(row.id, metadata as unknown as DbGithubInventoryMetadata);
    return { continueBatch: true };
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      // Reset to 'pending' so the next tick re-claims it; persist a brief note.
      await markInventoryError(row.id, "rate_limit");
      log.warn(
        {
          id: row.id,
          sourceIdentifier: row.sourceIdentifier,
          resetAt: err.resetAt?.toISOString() ?? null,
        },
        "Rate-limit hit mid-batch — stopping tick",
      );
      return { continueBatch: false };
    }
    const message = err instanceof Error ? err.message : String(err);
    await markInventoryError(row.id, message);
    log.warn(
      { id: row.id, sourceIdentifier: row.sourceIdentifier, err: message },
      "Refresh failed for row",
    );
    return { continueBatch: true };
  }
}

// ─── Tick handler ────────────────────────────────────────────────────────────

/**
 * Handle one cron-triggered or manual-triggered refresh tick.
 *
 * - `cron-triggered`: walks all due rows for the project, up to BATCH_SIZE.
 * - `refresh-manual` (with ids[]): refreshes the explicit set (ignoring interval).
 */
export async function handleInventoryRefresh(
  input: z.infer<typeof jobSchema>,
  depsOverride?: Partial<InventoryRefreshDeps>,
): Promise<void> {
  const deps: InventoryRefreshDeps = { ...defaultDeps, ...depsOverride };

  // PAT from vault — shared `service='github'` key with signal-collector (Spec 59.1b).
  // PAT-missing returns EARLY without writing cron_state.lastRun* — the tick
  // didn't actually run, so recording "success" would lie. Marcel sees "—" in
  // the UI until the next tick after he configures the PAT.
  let pat: string;
  try {
    const creds = await deps.readCreds("github");
    if (!creds.personal_access_token) {
      log.warn({}, "GitHub PAT not configured in vault — skipping tick");
      return;
    }
    pat = creds.personal_access_token;
  } catch (err) {
    log.warn({ err }, "Could not read GitHub PAT from vault — skipping tick");
    return;
  }

  const githubCreds: GitHubCredentials = { personalAccessToken: pat };

  // Spec 62.7-followup — Marcel observed "Letzter Lauf: —" in the UI even
  // after running cron tasks. The cron_state.lastRun* columns existed since
  // migration 0076 but no code path was writing them. This try/finally records
  // success/failure exactly once per tick, regardless of which branch
  // (cron-triggered, refresh-manual, rate-limited mid-batch) actually fired.
  try {
    const rows: ContentSourceInventory[] = input.ids?.length
      ? await Promise.all(input.ids.map((id) => getInventoryById(id))).then((rs) =>
          rs.filter((r): r is ContentSourceInventory => r !== null && r.projectId === input.projectId),
        )
      : await listInventoryDueForRefresh({
          projectId: input.projectId,
          limit: BATCH_SIZE,
          ageBufferSeconds: AGE_BUFFER_SECONDS,
        });

    if (rows.length === 0) {
      log.debug({ projectId: input.projectId, type: input.type }, "No due rows — tick is a no-op");
      // No-op tick still counts as "ran" — record so the UI shows current
      // timestamp instead of staying at "—" forever for inventories with no
      // due rows yet.
      await markCronRunSucceeded({
        projectId: input.projectId,
        jobType: "github_inventory_refresh",
      });
      return;
    }

    log.info(
      { projectId: input.projectId, type: input.type, rowCount: rows.length },
      "Starting inventory-refresh tick",
    );

    let attempted = 0;
    let rateLimited = false;

    for (const row of rows) {
      attempted += 1;
      const result = await refreshOne(row, githubCreds, deps);
      if (!result.continueBatch) {
        rateLimited = true;
        break;
      }
    }

    // Per-row success/failure granularity is in the structured log emitted by
    // `refreshOne`; the tick-level summary stays coarse on purpose.
    log.info(
      {
        projectId: input.projectId,
        type: input.type,
        rowCount: rows.length,
        attempted,
        rateLimited,
      },
      "Inventory-refresh tick completed",
    );

    // Spec 64.21 — end-of-tick housekeeping. Star-history rows accumulate at the
    // refresh-interval cadence; prune anything older than the retention window.
    // Single DELETE per tick, indexed scan via snapshot_at.
    await pruneStarHistoryAtEndOfTick();

    // Drop per-tick cache so subsequent invocations re-read fresh config (e.g.
    // Marcel changed thresholds via Settings UI between ticks).
    _starTrendConfigCache.clear();

    // Tick succeeded — rate-limited mid-batch still counts as success because
    // (a) the rate-limited row is persisted with fetchStatus='error' and
    // (b) subsequent rows just stay pending for the next tick (no error).
    await markCronRunSucceeded({
      projectId: input.projectId,
      jobType: "github_inventory_refresh",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ projectId: input.projectId, err: message }, "Inventory-refresh tick failed");
    await markCronRunFailed({
      projectId: input.projectId,
      jobType: "github_inventory_refresh",
      errorMessage: message,
    });
    throw err; // re-throw so BullMQ marks the job as failed
  }
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export function startGithubInventoryRefreshWorker() {
  return new Worker(
    GITHUB_INVENTORY_QUEUE,
    async (job: Job) => {
      const parsed = jobSchema.parse(job.data);
      await handleInventoryRefresh(parsed);
    },
    { connection: getConnection(), concurrency: 1 },
  );
}
