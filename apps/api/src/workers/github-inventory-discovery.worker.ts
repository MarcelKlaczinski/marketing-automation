// Spec 64.20 follow-up A2 — Auto-Discovery cron worker.
//
// Discovers candidate AI tools + skills weekly via GitHub Search-API +
// 3 curated awesome-lists, dedupes against existing
// `content_source_inventory.source_identifier`, and inserts new candidates
// with `approved_at = NULL`. Marcel reviews + approves via the existing
// Settings → GitHub-Inventory page with `?approvedOnly=false` filter.
//
// Architecture mirrors github_inventory_refresh.worker.ts (Spec 64.20 §5):
// per-project cron registered by cron-orchestrator, BullMQ Queue with
// concurrency:1, DI seam (`DiscoveryDeps`) for offline tests, no
// cost-log writes (free APIs).

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  contentSourceInventory,
  cronState,
  db,
  eq,
  inArray,
  markCronRunFailed,
  markCronRunSucceeded,
  projects,
} from "@marketing-auto/db";
import {
  discoverViaSearch as defaultDiscoverViaSearch,
  discoverViaAwesomeLists as defaultDiscoverViaAwesomeLists,
  type DiscoveryCandidate,
  type DiscoverViaSearchResult,
  type DiscoverViaAwesomeListsResult,
  type GitHubCredentials,
} from "@marketing-auto/adapter-github-inventory";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { readAdapterCreds as defaultReadAdapterCreds } from "../lib/system-service.ts";

const log = createLogger("github-inventory-discovery");

export const GITHUB_INVENTORY_DISCOVERY_QUEUE = "github-inventory-discovery";

/** Default cron pattern — weekly Sunday 04:00 UTC. Conservative cadence
 *  keeps GitHub Search-API rate-limit headroom + Marcel's review queue
 *  small (~30-50 new candidates per week). */
export const GITHUB_INVENTORY_DISCOVERY_DEFAULT_PATTERN = "0 4 * * 0";

/** Per-tick cap on candidates inserted. Prevents a runaway awesome-list
 *  from flooding the review queue with hundreds of rows. */
const MAX_CANDIDATES_PER_RUN = 100;

// ─── DI seam ─────────────────────────────────────────────────────────────────

export interface DiscoveryDeps {
  readCreds: (service: string) => Promise<Record<string, string>>;
  discoverViaSearch: (input: {
    credentials: GitHubCredentials;
  }) => Promise<DiscoverViaSearchResult>;
  discoverViaAwesomeLists: (input: {
    credentials: GitHubCredentials;
  }) => Promise<DiscoverViaAwesomeListsResult>;
}

const defaultDeps: DiscoveryDeps = {
  readCreds: defaultReadAdapterCreds,
  discoverViaSearch: ({ credentials }) => defaultDiscoverViaSearch({ credentials }),
  discoverViaAwesomeLists: ({ credentials }) =>
    defaultDiscoverViaAwesomeLists({ credentials }),
};

// ─── Redis connection ───────────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getGithubInventoryDiscoveryQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(GITHUB_INVENTORY_DISCOVERY_QUEUE, {
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

const jobSchema = z
  .object({
    projectId: z.string().uuid(),
    type: z.enum(["cron-triggered", "manual"]).optional(),
  })
  .passthrough();

// ─── Cron seed ──────────────────────────────────────────────────────────────

/**
 * Idempotently seed `cron_state` rows for every project. Default
 * `isActive: false` because Auto-Discovery candidates land for Marcel
 * review; he opts-in per-project after seeing the initial 30-50 baseline
 * is curated. Memory D124 — same pattern as comparison-discovery.
 */
export async function seedGithubInventoryDiscoveryCron(): Promise<void> {
  const allProjects = await db.select({ id: projects.id }).from(projects);
  if (allProjects.length === 0) return;
  const values = allProjects.map((p) => ({
    projectId: p.id,
    jobType: "github_inventory_discovery" as const,
    isActive: false,
    cronPattern: GITHUB_INVENTORY_DISCOVERY_DEFAULT_PATTERN,
  }));
  await db.insert(cronState).values(values).onConflictDoNothing();
  log.info(
    { projectCount: allProjects.length, pattern: GITHUB_INVENTORY_DISCOVERY_DEFAULT_PATTERN },
    "Seeded github_inventory_discovery cron_state rows",
  );
}

// ─── Dedup + persist ────────────────────────────────────────────────────────

interface PersistInput {
  projectId: string;
  candidates: DiscoveryCandidate[];
}

interface PersistResult {
  inserted: number;
  skippedDuplicate: number;
  capped: number;
}

/**
 * Filter candidates already present in `content_source_inventory` (either
 * approved or under review) for the project, then INSERT the rest with
 * `approved_at = NULL`. The partial unique index on `(project_id, source,
 * source_identifier) WHERE approved_at IS NOT NULL` does NOT cover
 * unapproved rows, so we add an application-layer dedup against ALL rows
 * (approved + unapproved) to prevent re-discovery on every tick.
 */
async function persistCandidates(input: PersistInput): Promise<PersistResult> {
  if (input.candidates.length === 0) {
    return { inserted: 0, skippedDuplicate: 0, capped: 0 };
  }

  const ids = input.candidates.map((c) => c.sourceIdentifier);
  const existing = await db
    .select({ sourceIdentifier: contentSourceInventory.sourceIdentifier })
    .from(contentSourceInventory)
    .where(
      eq(contentSourceInventory.projectId, input.projectId),
    )
    .then((rows) =>
      // Manual filter — Drizzle's inArray() in WHERE means we'd need a
      // composite (project_id, sourceIdentifier IN (…)) which is fine but
      // the SELECT-all-then-filter is cheap at our row count (<2000 per
      // project) and simpler.
      new Set(
        rows
          .map((r) => r.sourceIdentifier)
          .filter((s) => ids.includes(s)),
      ),
    );

  const fresh: DiscoveryCandidate[] = [];
  let skippedDuplicate = 0;
  for (const c of input.candidates) {
    if (existing.has(c.sourceIdentifier)) {
      skippedDuplicate += 1;
      continue;
    }
    fresh.push(c);
  }

  let capped = 0;
  let toInsert = fresh;
  if (fresh.length > MAX_CANDIDATES_PER_RUN) {
    capped = fresh.length - MAX_CANDIDATES_PER_RUN;
    toInsert = fresh.slice(0, MAX_CANDIDATES_PER_RUN);
    log.warn(
      { projectId: input.projectId, totalFresh: fresh.length, cap: MAX_CANDIDATES_PER_RUN, capped },
      "Discovery candidate count exceeds per-run cap — truncating",
    );
  }

  if (toInsert.length === 0) {
    return { inserted: 0, skippedDuplicate, capped };
  }

  // Heuristic object-type assignment: candidates from awesome-claude-skills
  // lists default to 'skill'; everything else to 'tool'. Marcel can override
  // at approve-time in the Settings UI.
  const rows = toInsert.map((c) => ({
    projectId:           input.projectId,
    source:              "github" as const,
    objectType:
      c.discoverySource === "awesome_list" &&
      typeof c.awesomeListSource === "string" &&
      c.awesomeListSource.includes("claude-skills")
        ? ("skill" as const)
        : ("tool" as const),
    sourceIdentifier:    c.sourceIdentifier,
    displayName:         c.displayName.slice(0, 255),
    description:         c.description?.slice(0, 2000) ?? null,
    homepageUrl:         c.homepageUrl,
    refreshIntervalHours: 168,
    // approvedAt stays NULL — Marcel reviews + approves manually
  }));

  // .onConflictDoNothing on a partial unique index NULL — the partial unique
  // index doesn't cover approved_at=NULL rows, so concurrent ticks could in
  // theory double-insert. Add a non-partial unique index later if this
  // becomes a problem; for V1 the app-layer dedup above is the safety net.
  await db.insert(contentSourceInventory).values(rows);

  return { inserted: toInsert.length, skippedDuplicate, capped };
}

// ─── Tick handler ───────────────────────────────────────────────────────────

export async function handleDiscoveryTick(
  input: z.infer<typeof jobSchema>,
  depsOverride: Partial<DiscoveryDeps> = {},
): Promise<{
  inserted: number;
  skippedDuplicate: number;
  capped: number;
  searchCandidates: number;
  awesomeListCandidates: number;
}> {
  const deps: DiscoveryDeps = { ...defaultDeps, ...depsOverride };

  // PAT from vault — shared key (Spec 59.1b precedent).
  let pat: string;
  try {
    const creds = await deps.readCreds("github");
    if (!creds.personal_access_token) {
      log.warn({}, "GitHub PAT not configured in vault — skipping discovery tick");
      return { inserted: 0, skippedDuplicate: 0, capped: 0, searchCandidates: 0, awesomeListCandidates: 0 };
    }
    pat = creds.personal_access_token;
  } catch (err) {
    log.warn({ err }, "Could not read GitHub PAT from vault — skipping discovery tick");
    return { inserted: 0, skippedDuplicate: 0, capped: 0, searchCandidates: 0, awesomeListCandidates: 0 };
  }

  const githubCreds: GitHubCredentials = { personalAccessToken: pat };
  log.info({ projectId: input.projectId, type: input.type }, "Starting discovery tick");

  // Spec 62.7-followup — record last-run timestamp for the Settings UI. The
  // try/catch wrapper guarantees one mark* call regardless of which branch
  // (success / fetcher-failure / persist-failure) finishes.
  try {
    // Fire both sources in parallel for wall-clock efficiency.
    const [searchResult, awesomeResult] = await Promise.all([
      deps.discoverViaSearch({ credentials: githubCreds }).catch((err) => {
        log.warn({ err }, "Search-API discovery failed");
        return {
          candidates: [] as DiscoveryCandidate[],
          rawCount: 0,
          failedQueries: [{ query: "all", error: err instanceof Error ? err.message : String(err) }],
        } satisfies DiscoverViaSearchResult;
      }),
      deps.discoverViaAwesomeLists({ credentials: githubCreds }).catch((err) => {
        log.warn({ err }, "Awesome-list discovery failed");
        return {
          candidates: [] as DiscoveryCandidate[],
          perListCounts: [] as Array<{ list: string; linksFound: number }>,
          failedLists: [{ list: "all", error: err instanceof Error ? err.message : String(err) }],
        } satisfies DiscoverViaAwesomeListsResult;
      }),
    ]);

    // Merge — Search-API entries override awesome-list entries for the same
    // sourceIdentifier (Search-API knows stars, awesome-list doesn't).
    const merged = new Map<string, DiscoveryCandidate>();
    for (const c of awesomeResult.candidates) merged.set(c.sourceIdentifier, c);
    for (const c of searchResult.candidates) merged.set(c.sourceIdentifier, c);
    const combined = Array.from(merged.values());

    const persistResult = await persistCandidates({
      projectId: input.projectId,
      candidates: combined,
    });

    log.info(
      {
        projectId:               input.projectId,
        type:                    input.type,
        searchCandidates:        searchResult.candidates.length,
        awesomeListCandidates:   awesomeResult.candidates.length,
        mergedCandidates:        combined.length,
        inserted:                persistResult.inserted,
        skippedDuplicate:        persistResult.skippedDuplicate,
        capped:                  persistResult.capped,
        searchFailedQueries:     searchResult.failedQueries.length,
        awesomeListFailedLists:  awesomeResult.failedLists.length,
      },
      "Discovery tick completed",
    );

    // Per-fetcher failures (search OR awesome-list throwing) are already
    // swallowed above and counted in failedQueries/failedLists. The tick
    // itself succeeded — Marcel sees timestamp + status='success' even if
    // individual sources had transient issues.
    await markCronRunSucceeded({
      projectId: input.projectId,
      jobType: "github_inventory_discovery",
    });

    return {
      inserted:              persistResult.inserted,
      skippedDuplicate:      persistResult.skippedDuplicate,
      capped:                persistResult.capped,
      searchCandidates:      searchResult.candidates.length,
      awesomeListCandidates: awesomeResult.candidates.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ projectId: input.projectId, err: message }, "Discovery tick failed");
    await markCronRunFailed({
      projectId: input.projectId,
      jobType: "github_inventory_discovery",
      errorMessage: message,
    });
    throw err;
  }
}

// ─── Worker ────────────────────────────────────────────────────────────────

export function startGithubInventoryDiscoveryWorker() {
  return new Worker(
    GITHUB_INVENTORY_DISCOVERY_QUEUE,
    async (job: Job) => {
      const parsed = jobSchema.parse(job.data);
      await handleDiscoveryTick(parsed);
    },
    { connection: getConnection(), concurrency: 1 },
  );
}

// suppress unused-import warning for inArray — kept reachable for future
// optimisation of persistCandidates' dedup query.
void inArray;
