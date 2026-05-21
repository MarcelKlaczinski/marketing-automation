// Spec 62.3: Signal-Refresh-Mechanik.
//
// Library export consumed by:
//   - POST /api/projects/:slug/signals/refresh  (manual trigger)
//   - 62.4 Planner pipeline (first step before plan generation)
//
// Lives in packages/planner. Dependency-injects the per-source fetcher callbacks so
// the planner package does NOT depend on signal adapter packages — those adapters all
// import ExternalSignalSource / RawSignal from @marketing-auto/pipelines, which would
// create the cycle pipelines → planner → adapter → pipelines once 62.4 lands the
// pipelines → planner edge. The caller (apps/api routes or 62.4 pipeline) wires
// adapter instances into the `fetchers` map.

import {
  and,
  db,
  eq,
  externalSignals,
  projectConfigurations,
  projectPlannerConfig,
  SignalSourcesSchema,
  sql,
  type NewExternalSignal,
  type SignalSources,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("planner:signal-refresh");

export type SignalSourceName = "producthunt" | "hackernews" | "vendor_rss" | "reddit" | "github";

// Mirror of the RawSignal shape in packages/pipelines/src/signal-sources/types.ts.
// Re-declared here (rather than imported) to avoid the planner → pipelines dep that
// 62.3.5 §2 explicitly forbids. Adapter `.fetch()` return values are structurally
// compatible with this shape — TS catches any future drift at the call site in
// apps/api/src/routes/signals.ts.
export interface RefreshableSignal {
  source: "producthunt" | "hackernews" | "vendor_rss" | "reddit" | "github" | "dataforseo_trends";
  externalId: string;
  title: string;
  url?: string;
  summary?: string;
  author?: string;
  publishedAt?: Date;
  rawPayload: Record<string, unknown>;
  metrics?: Record<string, number>;
}

export interface SignalFetcherContext {
  projectId: string;
  signalSources: SignalSources;
  readCreds: (service: string) => Promise<Record<string, string>>;
}

/**
 * Per-source fetcher. Caller wires the adapter class (e.g. new RedditSignalSource().fetch(...))
 * to this callback. The function should throw an Error whose message contains "credentials"
 * when credentials are missing — this is mapped to status='no_credentials' rather than 'error'.
 * Returning [] is fine and produces status='filter_no_results'.
 */
export type SignalFetcher = (ctx: SignalFetcherContext) => Promise<RefreshableSignal[]>;

export type SignalRefreshStatus =
  | "fresh"             // recent enough; skipped without calling the fetcher
  | "refreshed"         // fetcher ran and produced ≥1 valid signal
  | "skipped"           // source not enabled in signalSources config
  | "no_credentials"    // fetcher threw a "credentials"-flavoured error
  | "filter_no_results" // fetcher returned [] without error
  | "error";

export interface SignalRefreshSourceResult {
  source: SignalSourceName;
  status: SignalRefreshStatus;
  rowsAdded: number;
  lastCollectedAt: Date | null;
  notes?: string;
  error?: string;
}

export interface SignalRefreshResult {
  projectId: string;
  triggeredAt: Date;
  sourceResults: SignalRefreshSourceResult[];
  totalRowsAdded: number;
  durationMs: number;
}

export interface RefreshSignalsForProjectInput {
  projectId: string;
  /** Bypass the staleness gate and call every enabled source. Default false. */
  force?: boolean;
  /**
   * Per-source fetcher callbacks. Caller wires the actual adapter classes here.
   * If a source name is absent from the map, it's treated as 'skipped' with notes.
   */
  fetchers: Partial<Record<SignalSourceName, SignalFetcher>>;
  /** Reads `global_credentials` rows for an adapter service (e.g. "producthunt"). */
  readCreds: (service: string) => Promise<Record<string, string>>;
}

const SOURCE_NAMES: readonly SignalSourceName[] = [
  "producthunt",
  "hackernews",
  "vendor_rss",
  "reddit",
  "github",
] as const;

export async function refreshSignalsForProject(
  input: RefreshSignalsForProjectInput,
): Promise<SignalRefreshResult> {
  const start = Date.now();
  const triggeredAt = new Date();
  const { projectId, force = false, fetchers, readCreds } = input;

  const [signalSources, signalMaxAgeHours] = await Promise.all([
    loadSignalSources(projectId),
    loadSignalMaxAgeHours(projectId),
  ]);

  const fetcherCtx: SignalFetcherContext = { projectId, signalSources, readCreds };
  const sourceResults: SignalRefreshSourceResult[] = [];

  for (const source of SOURCE_NAMES) {
    sourceResults.push(
      await refreshOneSource({
        source,
        projectId,
        force,
        signalMaxAgeHours,
        enabled: isSourceEnabled(source, signalSources),
        fetcher: fetchers[source],
        fetcherCtx,
      }),
    );
  }

  return {
    projectId,
    triggeredAt,
    sourceResults,
    totalRowsAdded: sourceResults.reduce((sum, r) => sum + r.rowsAdded, 0),
    durationMs: Date.now() - start,
  };
}

// ─── Per-source orchestration ─────────────────────────────────────────────────

interface RefreshOneSourceInput {
  source: SignalSourceName;
  projectId: string;
  force: boolean;
  signalMaxAgeHours: number;
  enabled: boolean;
  fetcher: SignalFetcher | undefined;
  fetcherCtx: SignalFetcherContext;
}

async function refreshOneSource(input: RefreshOneSourceInput): Promise<SignalRefreshSourceResult> {
  const { source, projectId, force, signalMaxAgeHours, enabled, fetcher, fetcherCtx } = input;
  const lastCollectedAt = await loadLastCollectedAt(projectId, source);

  if (!enabled) {
    return {
      source,
      status: "skipped",
      rowsAdded: 0,
      lastCollectedAt,
      notes: "Source disabled in signal_sources config",
    };
  }

  if (!fetcher) {
    return {
      source,
      status: "skipped",
      rowsAdded: 0,
      lastCollectedAt,
      notes: "No fetcher wired by caller — adapter binding missing",
    };
  }

  if (!force && isFresh(lastCollectedAt, signalMaxAgeHours)) {
    return {
      source,
      status: "fresh",
      rowsAdded: 0,
      lastCollectedAt,
      notes: `Last collected < ${signalMaxAgeHours}h ago`,
    };
  }

  let signals: RefreshableSignal[];
  try {
    signals = await fetcher(fetcherCtx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/credentials? not configured/i.test(message)) {
      return {
        source,
        status: "no_credentials",
        rowsAdded: 0,
        lastCollectedAt,
        notes: "Adapter reported missing credentials — refresh skipped",
        error: message,
      };
    }
    log.warn({ source, projectId, err }, "signal-refresh: adapter error");
    return {
      source,
      status: "error",
      rowsAdded: 0,
      lastCollectedAt,
      error: message,
    };
  }

  if (signals.length === 0) {
    return {
      source,
      status: "filter_no_results",
      rowsAdded: 0,
      lastCollectedAt,
      notes: "Adapter ran successfully but returned no rows (filter too strict, or no fresh data)",
    };
  }

  const rowsAdded = await persistSignals(projectId, signals);
  const result: SignalRefreshSourceResult = {
    source,
    status: "refreshed",
    rowsAdded,
    lastCollectedAt: new Date(),
  };
  if (rowsAdded < signals.length) {
    result.notes = `${signals.length} fetched, ${rowsAdded} new (rest deduped on (source, externalId))`;
  }
  return result;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function loadSignalSources(projectId: string): Promise<SignalSources> {
  const [row] = await db
    .select({ signalSources: projectConfigurations.signalSources })
    .from(projectConfigurations)
    .where(
      and(
        eq(projectConfigurations.projectId, projectId),
        eq(projectConfigurations.status, "active"),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(`No active project_configuration for project ${projectId}`);
  }
  return SignalSourcesSchema.parse(row.signalSources);
}

async function loadSignalMaxAgeHours(projectId: string): Promise<number> {
  const [row] = await db
    .select({ signalMaxAgeHours: projectPlannerConfig.signalMaxAgeHours })
    .from(projectPlannerConfig)
    .where(eq(projectPlannerConfig.projectId, projectId))
    .limit(1);
  return row?.signalMaxAgeHours ?? 24;
}

async function loadLastCollectedAt(
  projectId: string,
  source: SignalSourceName,
): Promise<Date | null> {
  const [row] = await db
    .select({ collectedAt: externalSignals.collectedAt })
    .from(externalSignals)
    .where(and(eq(externalSignals.projectId, projectId), eq(externalSignals.source, source)))
    .orderBy(sql`${externalSignals.collectedAt} DESC`)
    .limit(1);
  return row?.collectedAt ?? null;
}

async function persistSignals(
  projectId: string,
  signals: RefreshableSignal[],
): Promise<number> {
  const rows: NewExternalSignal[] = signals.map((s) => ({
    projectId,
    source: s.source,
    externalId: s.externalId,
    title: s.title,
    url: s.url ?? null,
    summary: s.summary ?? null,
    author: s.author ?? null,
    publishedAt: s.publishedAt ?? null,
    rawPayload: s.rawPayload,
    metrics: s.metrics ?? {},
  }));

  const inserted = await db.transaction(async (tx) =>
    tx
      .insert(externalSignals)
      .values(rows)
      .onConflictDoNothing({ target: [externalSignals.source, externalSignals.externalId] })
      .returning({ id: externalSignals.id }),
  );

  return inserted.length;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isSourceEnabled(source: SignalSourceName, config: SignalSources): boolean {
  switch (source) {
    case "producthunt":
      return config.producthunt === true;
    case "hackernews":
      return config.hackernews.enabled === true;
    case "vendor_rss":
      return config.vendor_rss.enabled === true;
    case "reddit":
      return config.reddit.enabled === true;
    case "github":
      return config.github.enabled === true;
  }
}

function isFresh(lastCollectedAt: Date | null, maxAgeHours: number): boolean {
  if (!lastCollectedAt) return false;
  const ageMs = Date.now() - lastCollectedAt.getTime();
  return ageMs < maxAgeHours * 60 * 60 * 1000;
}
