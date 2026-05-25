/**
 * Spec 64.21 — Star-Trend Story brief emitter.
 *
 * Mirror of `release-detection/emit.ts` shape — called by the
 * `github-inventory-refresh` worker after a successful `markInventoryOk`
 * when `detectStarTrend()` returns `triggered=true`.
 *
 * Skips emission when:
 *   - duplicate brief already exists for this (inventoryRowId, window) pair
 *   - pacing-limit reached (>= config.weeklyCap briefs this ISO week per project)
 *
 * Returns the brief id when one was inserted, or `null` when skipped. The
 * worker callsite logs the outcome; this helper is pure DB writes.
 */

import {
  and,
  db,
  eq,
  gte,
  projects,
  sql,
  StarTrendMetadataSchema,
  TopicBriefInsertSchema,
  topicBriefs,
  type StarTrendMetadata,
  type TopicBriefInsert,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("topic-sources:star-trend:emit");

export interface EmitStarTrendBriefInput {
  projectId:         string;
  /** The content_source_inventory row id (used as `starTrendMetadata.inventoryRowId`). */
  inventoryRowId:    string;
  /** Source identifier from inventory.source_identifier (e.g. "anthropics/claude-code"). */
  sourceIdentifier:  string;
  /** Human-facing tool name from inventory.display_name. */
  displayName:       string;
  /** Star count at the start of the detection window. Caller MUST have verified the trigger fired. */
  priorStarsCount:   number;
  /** Star count at emission time (= latest refresh). */
  currentStarsCount: number;
  /** growthAbsolute / growthPct / trigger — pass through from `detectStarTrend()`. */
  growthAbsolute:    number;
  growthPct:         number;
  trigger:           "absolute" | "relative";
  /** Window the snapshot pair spans (days) — from `config.windowDays`. */
  periodDays:        number;
  /** Per-project pacing cap from `config.weeklyCap`. */
  weeklyCap:         number;
  /** Latest release tag from inventory.github_metadata, if any. */
  latestReleaseTag?: string | null;
}

export interface EmitStarTrendBriefResult {
  briefId: string | null;
  skipped: "pacing_limit" | "duplicate" | null;
}

/**
 * Resolve the project's primary locale — mirrors release-detection/emit.ts.
 */
async function getPrimaryLocale(projectId: string): Promise<"de" | "en"> {
  const [row] = await db
    .select({ targetLocales: projects.targetLocales })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const locales = (row?.targetLocales as string[] | null) ?? ["de-DE"];
  const primary = locales[0] ?? "de-DE";
  const code = primary.split("-")[0]?.toLowerCase() ?? "de";
  return code === "en" ? "en" : "de";
}

function buildTopicTitle(
  displayName: string,
  growthAbsolute: number,
  periodDays: number,
  locale: "de" | "en",
): string {
  const formatted = growthAbsolute.toLocaleString(locale === "de" ? "de-DE" : "en-US");
  return locale === "de"
    ? `Star-Sprung: ${displayName} +${formatted} Stars in ${periodDays} Tagen`
    : `Star spike: ${displayName} gained ${formatted} stars in ${periodDays} days`;
}

/**
 * Returns the timestamp of the most recent Monday 00:00 UTC. Identical to
 * release-detection — same anchor produces aligned weekly windows across both
 * brief sources, making pacing dashboards comparable.
 */
function startOfIsoWeekUtc(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const dayIdx = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayIdx);
  return d;
}

/**
 * Count star-trend briefs already emitted for this project since the start of
 * the current ISO week. Pacing cap is per-project (not per-inventory).
 */
async function countWeeklyStarTrendBriefs(projectId: string): Promise<number> {
  const windowStart = startOfIsoWeekUtc();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, projectId),
        eq(topicBriefs.source, "star_trend"),
        gte(topicBriefs.createdAt, windowStart),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Defense-in-depth dedup: a star-trend brief for this inventory row within the
 * current detection window already exists. Without this, a worker retry after
 * a partial failure could double-emit. We don't have a partial unique index
 * (the predicate would need a `created_at >= NOW - windowDays` clause which
 * PostgreSQL forbids in partial-index WHERE — same constraint as
 * `rejected_topic_candidates`). Application-layer check is the alternative.
 */
async function existsBriefForStarTrend(
  projectId: string,
  inventoryRowId: string,
  windowDays: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ id: topicBriefs.id })
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, projectId),
        eq(topicBriefs.source, "star_trend"),
        sql`(${topicBriefs.starTrendMetadata}->>'inventoryRowId')::uuid = ${inventoryRowId}::uuid`,
        gte(topicBriefs.createdAt, cutoff),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function emitStarTrendBrief(
  input: EmitStarTrendBriefInput,
): Promise<EmitStarTrendBriefResult> {
  // Idempotency guard — one star_trend brief per (inventoryRow, windowDays).
  // Subsequent triggers within the same window are skipped, preventing
  // chatter when a repo's star-count keeps creeping up across multiple ticks.
  const exists = await existsBriefForStarTrend(
    input.projectId,
    input.inventoryRowId,
    input.periodDays,
  );
  if (exists) {
    log.debug(
      {
        projectId: input.projectId,
        inventoryRowId: input.inventoryRowId,
        periodDays: input.periodDays,
      },
      "Star-trend brief already emitted within window — skipping",
    );
    return { briefId: null, skipped: "duplicate" };
  }

  // Pacing — Marcel-decision Q4 = "Max 3/Woche per Projekt".
  const emittedThisWeek = await countWeeklyStarTrendBriefs(input.projectId);
  if (emittedThisWeek >= input.weeklyCap) {
    log.warn(
      {
        projectId: input.projectId,
        sourceIdentifier: input.sourceIdentifier,
        emittedThisWeek,
        cap: input.weeklyCap,
      },
      "Star-trend pacing cap reached — skipping emission",
    );
    return { briefId: null, skipped: "pacing_limit" };
  }

  const locale = await getPrimaryLocale(input.projectId);

  const metadata: StarTrendMetadata = StarTrendMetadataSchema.parse({
    inventoryRowId:    input.inventoryRowId,
    sourceIdentifier:  input.sourceIdentifier,
    displayName:       input.displayName,
    priorStarsCount:   input.priorStarsCount,
    currentStarsCount: input.currentStarsCount,
    growthAbsolute:    input.growthAbsolute,
    growthPct:         input.growthPct,
    periodDays:        input.periodDays,
    trigger:           input.trigger,
    ...(input.latestReleaseTag !== undefined && { latestReleaseTag: input.latestReleaseTag }),
  });

  const briefInsert: TopicBriefInsert = TopicBriefInsertSchema.parse({
    projectId:         input.projectId,
    source:            "star_trend",
    topicTitle:        buildTopicTitle(input.displayName, input.growthAbsolute, input.periodDays, locale),
    primaryKeyword:    input.displayName,
    secondaryKeywords: [],
    locale,
    intentType:        "news",
    clusterId:         null,
    clusterAction:     "standalone",
    approvalRequired:  true,
    approvalStatus:    "pending",
    starTrendMetadata: metadata,
  } satisfies TopicBriefInsert);

  // Strip undefined keys before Drizzle insert under exactOptionalPropertyTypes
  // (Memory rule — same pattern as release-detection emit.ts).
  const values = Object.fromEntries(
    Object.entries(briefInsert).filter(([, v]) => v !== undefined),
  ) as typeof topicBriefs.$inferInsert;

  const [row] = await db.insert(topicBriefs).values(values).returning({ id: topicBriefs.id });
  if (!row) {
    log.error({ input }, "Brief INSERT returned no row");
    return { briefId: null, skipped: null };
  }

  log.info(
    {
      projectId:        input.projectId,
      briefId:          row.id,
      sourceIdentifier: input.sourceIdentifier,
      priorStarsCount:  input.priorStarsCount,
      currentStarsCount: input.currentStarsCount,
      growthAbsolute:   input.growthAbsolute,
      growthPct:        input.growthPct,
      trigger:          input.trigger,
      emittedThisWeek:  emittedThisWeek + 1,
    },
    "Star-trend brief emitted",
  );

  return { briefId: row.id, skipped: null };
}

// Exposed for unit tests — same convention as release-detection emit.ts.
export { startOfIsoWeekUtc, countWeeklyStarTrendBriefs, existsBriefForStarTrend };
