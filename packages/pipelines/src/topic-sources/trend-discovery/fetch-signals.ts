import { createLogger } from "@marketing-auto/shared";
import { db, externalSignals, and, isNull, gte, eq, desc } from "@marketing-auto/db";
import type { ExternalSignal } from "@marketing-auto/db";
import { loadActiveConfig } from "../../config/load-active-config.ts";

const log = createLogger("trend-discovery:fetch-signals");

const SIGNAL_CAP = 80;
const WINDOW_DAYS = 14;

export async function fetchEligibleSignals(projectId: string): Promise<ExternalSignal[]> {
  const config = await loadActiveConfig(projectId);
  const scope = config.topicScope;
  const thresholds = scope.min_signal_thresholds;

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  // Fetch slightly more than the cap to allow for threshold filtering
  const rows = await db
    .select()
    .from(externalSignals)
    .where(
      and(
        eq(externalSignals.projectId, projectId),
        isNull(externalSignals.processedAt),
        gte(externalSignals.collectedAt, cutoff),
      ),
    )
    .orderBy(desc(externalSignals.publishedAt))
    .limit(120);

  const filtered = rows.filter((s) => {
    if (s.source === "hackernews") {
      const minPoints = thresholds.hackernews ?? 3;
      return (s.metrics["points"] ?? 0) >= minPoints;
    }
    if (s.source === "producthunt") {
      const minVotes = thresholds.producthunt ?? 0;
      return (s.metrics["votes"] ?? 0) >= minVotes;
    }
    // vendor_rss and other sources: no metric threshold by default
    return true;
  });

  const capped = filtered.slice(0, SIGNAL_CAP);

  log.info(
    { projectId, total: rows.length, afterFilter: filtered.length, capped: capped.length },
    "signals fetched for synthesis",
  );

  return capped;
}
