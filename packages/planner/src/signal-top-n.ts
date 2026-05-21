// Spec 62.4: deterministic Top-N selection of recent external_signals.
//
// Loads the last 7 days of external_signals for a project, computes a per-row
// raw score from the `metrics` JSONB, then normalises within each source so
// that the highest-ranking signal of each source receives 1.0 and the lowest
// receives 1/n. The normalisation is per-source because the absolute scales
// differ wildly (ProductHunt votes range in the hundreds, HackerNews points
// in the tens of thousands, GitHub stars in the millions for popular repos).
//
// After normalisation, all signals are merged into one list, sorted by
// normalisedScore desc, and the top N are returned. The caller (planner
// SnapshotInputs step) feeds this into `signalTopN` of the input snapshot.

import {
  and,
  db,
  eq,
  externalSignals,
  gte,
  isNull,
  type ExternalSignal,
} from "@marketing-auto/db";

export interface ComputeSignalTopNInput {
  projectId: string;
  /** How many signals to return after the global merge. */
  topN: number;
  /** Look-back window. Default 7 days. */
  windowDays?: number;
  /** Override "now" — useful for deterministic tests. */
  now?: Date;
}

export interface SignalTopNRow {
  signalId: string;
  source: string;
  title: string;
  url: string | null;
  rawScore: number;
  normalizedScore: number;
}

const DEFAULT_WINDOW_DAYS = 7;

/**
 * Heuristic: read a "score-ish" metric from the metrics JSONB. Order of
 * preference matches the dominant metric of each source:
 *   producthunt → votes_count
 *   hackernews  → points
 *   reddit      → score (Reddit's own per-post score)
 *   github      → stars
 *   vendor_rss  → length(summary) (only signal — no native engagement metric)
 *   dataforseo_trends → growthScore
 *
 * Falls back to 0 when nothing useful is present. The normalisation step still
 * works (everyone gets 1/n of the source pool).
 */
export function rawScoreFor(signal: Pick<ExternalSignal, "source" | "metrics" | "summary">): number {
  const m = signal.metrics ?? {};
  const tryNumeric = (...keys: string[]): number => {
    for (const k of keys) {
      const v = m[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    }
    return 0;
  };
  switch (signal.source) {
    case "producthunt":
      return tryNumeric("votes_count", "votes");
    case "hackernews":
      return tryNumeric("points", "score");
    case "reddit":
      return tryNumeric("score", "upvotes", "ups");
    case "github":
      return tryNumeric("stars", "stargazers_count");
    case "dataforseo_trends":
      return tryNumeric("growthScore", "search_volume", "value");
    case "vendor_rss":
      return signal.summary ? Math.min(signal.summary.length, 1000) : 0;
    default:
      return tryNumeric("score", "value");
  }
}

/**
 * Pure normalisation. Exported for unit tests. Input is the candidate set;
 * output preserves order but adds normalisedScore. Per-source rank → 0..1
 * via `rank / n` where rank=1 is the highest within that source.
 *
 * Directionality (load-bearing — SelectOverageItemsStep takes the FIRST N
 * after a desc sort, so a flipped sign here would pick the WORST signals):
 *   rank=1 (highest rawScore in source) → normalizedScore = 1.0
 *   rank=n (lowest  rawScore in source) → normalizedScore = 1/n
 */
export function normalizePerSource(
  candidates: Array<{
    signalId: string;
    source: string;
    title: string;
    url: string | null;
    rawScore: number;
  }>,
): SignalTopNRow[] {
  const bySource = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const list = bySource.get(c.source) ?? [];
    list.push(c);
    bySource.set(c.source, list);
  }
  const result: SignalTopNRow[] = [];
  for (const [, group] of bySource) {
    const sorted = [...group].sort((a, b) => b.rawScore - a.rawScore);
    const n = sorted.length;
    sorted.forEach((row, idx) => {
      const normalizedScore = (n - idx) / n;
      result.push({ ...row, normalizedScore });
    });
  }
  return result;
}

/**
 * Pure cross-source merge + top-N selection. Extracted from `computeSignalTopN`
 * so the directionality (best signal = score 1.0 = first in result) can be
 * asserted without spinning up DB fixtures. SelectOverageItemsStep relies on
 * this contract — flipping the sort would silently route the WORST signals
 * into the planner.
 *
 * Tie-break: when two rows tie on normalizedScore, the higher rawScore wins.
 */
export function mergeAndTopN(rows: SignalTopNRow[], topN: number): SignalTopNRow[] {
  if (topN <= 0) return [];
  const sorted = [...rows].sort(
    (a, b) => b.normalizedScore - a.normalizedScore || b.rawScore - a.rawScore,
  );
  return sorted.slice(0, topN);
}

/** Loads candidate signals, computes raw scores, normalises, returns top N. */
export async function computeSignalTopN(input: ComputeSignalTopNInput): Promise<SignalTopNRow[]> {
  const { projectId, topN, windowDays = DEFAULT_WINDOW_DAYS, now = new Date() } = input;
  if (topN <= 0) return [];

  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);

  // Only "unprocessed" signals so a topic that was already routed into a
  // brief doesn't double-count as overage. processedInto IS NULL captures
  // exactly that — set by the trend-synthesizer or future signal-router.
  const rows = await db
    .select({
      id: externalSignals.id,
      source: externalSignals.source,
      title: externalSignals.title,
      url: externalSignals.url,
      metrics: externalSignals.metrics,
      summary: externalSignals.summary,
    })
    .from(externalSignals)
    .where(
      and(
        eq(externalSignals.projectId, projectId),
        gte(externalSignals.collectedAt, cutoff),
        isNull(externalSignals.processedInto),
      ),
    );

  const candidates = rows.map((r) => ({
    signalId: r.id,
    source: r.source,
    title: r.title,
    url: r.url ?? null,
    rawScore: rawScoreFor({
      source: r.source,
      metrics: r.metrics,
      summary: r.summary,
    }),
  }));

  const normalised = normalizePerSource(candidates);
  return mergeAndTopN(normalised, topN);
}
