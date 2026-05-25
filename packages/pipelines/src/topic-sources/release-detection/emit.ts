/**
 * Spec 64.20 follow-up A3 — release-detection brief emitter.
 *
 * Called by `github-inventory-refresh.worker` after a successful
 * `markInventoryOk` whenever the freshly-fetched `latestRelease.tag` differs
 * from the prior tag stored in `content_source_inventory.github_metadata`.
 *
 * Skips emission when:
 *   - previous tag is null (first-fetch baseline — no comparison possible)
 *   - new tag is null (no releases on the repo at all)
 *   - pacing-limit reached (>=5 release-detection briefs this week per project)
 *
 * Returns the brief id when one was inserted, or `null` when skipped. The
 * worker callsite logs the outcome; this helper is pure DB writes.
 */

import {
  and,
  contentSourceInventory,
  db,
  eq,
  gte,
  projects,
  sql,
  TopicBriefInsertSchema,
  topicBriefs,
  type ReleaseMetadata,
  type TopicBriefInsert,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("topic-sources:release-detection:emit");

/**
 * Per-project, per-week cap to prevent release-heavy repos from spamming
 * Marcel's brief inbox. When exceeded, additional emissions silently skip
 * (logged at INFO with the skip reason).
 *
 * Marcel-decision (Spec 64.20 follow-up §A3 question): 5 briefs/week.
 */
export const RELEASE_DETECTION_WEEKLY_CAP = 5;

export interface EmitReleaseBriefInput {
  projectId: string;
  /** The content_source_inventory row id (used as releaseMetadata.inventoryRowId). */
  inventoryRowId: string;
  /** Source identifier from inventory.source_identifier (e.g. "anthropics/claude-code"). */
  sourceIdentifier: string;
  /** Human-facing tool name from inventory.display_name. */
  displayName: string;
  /** Tag observed on the prior tick. Caller MUST have verified this is non-null. */
  previousReleaseTag: string;
  /** Tag observed on this tick. Caller MUST have verified this is non-null + differs. */
  newReleaseTag: string;
  /** Optional release name from GitHub API. */
  releaseName: string | null;
  /** ISO 8601 publishedAt from GitHub API. */
  releasePublishedAt: string;
  /** Repo stars at emission time (used downstream for pacing-sort + brief UI). */
  starsCount?: number;
}

export interface EmitReleaseBriefResult {
  briefId: string | null;
  skipped: "pacing_limit" | "duplicate" | null;
}

/**
 * Resolve the project's primary locale from `projects.target_locales[0]`.
 * Mirrors `getPrimaryLocale` from `trend-discovery/source.ts` — kept local
 * to avoid cross-importing that module's private helper.
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

/**
 * Build the brief topic title in the project's primary locale.
 */
function buildTopicTitle(
  displayName: string,
  newTag: string,
  locale: "de" | "en",
): string {
  return locale === "de"
    ? `Neues Release: ${displayName} ${newTag}`
    : `New release: ${displayName} ${newTag}`;
}

/**
 * Returns the timestamp of the most recent Monday 00:00 UTC. Used as the
 * start-of-week anchor for the per-project pacing window.
 */
function startOfIsoWeekUtc(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  // getUTCDay: 0=Sun..6=Sat; convert to "days since Monday" (Mon=0, Sun=6).
  const dayIdx = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayIdx);
  return d;
}

/**
 * Count release-detection briefs already emitted for this project since the
 * start of the current ISO week (Monday 00:00 UTC).
 */
async function countWeeklyEmissions(projectId: string): Promise<number> {
  const windowStart = startOfIsoWeekUtc();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, projectId),
        eq(topicBriefs.source, "release_detection"),
        gte(topicBriefs.createdAt, windowStart),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Check whether a release-detection brief already exists for this exact
 * (inventoryRowId, newReleaseTag) pair. Defense-in-depth: if the worker
 * fires twice in quick succession (e.g. retry) the same release won't
 * produce two briefs. We don't have a partial unique index so the dup-check
 * is application-layer.
 */
async function existsBriefForRelease(
  projectId: string,
  inventoryRowId: string,
  newTag: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: topicBriefs.id })
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.projectId, projectId),
        eq(topicBriefs.source, "release_detection"),
        sql`(${topicBriefs.releaseMetadata}->>'inventoryRowId')::uuid = ${inventoryRowId}::uuid`,
        sql`${topicBriefs.releaseMetadata}->>'newReleaseTag' = ${newTag}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function emitReleaseBrief(
  input: EmitReleaseBriefInput,
): Promise<EmitReleaseBriefResult> {
  // Idempotency guard — same (row, tag) combo never produces two briefs.
  const exists = await existsBriefForRelease(
    input.projectId,
    input.inventoryRowId,
    input.newReleaseTag,
  );
  if (exists) {
    log.debug(
      {
        projectId: input.projectId,
        inventoryRowId: input.inventoryRowId,
        newTag: input.newReleaseTag,
      },
      "Release brief already emitted — skipping",
    );
    return { briefId: null, skipped: "duplicate" };
  }

  // Pacing — Marcel-decision Spec 64.20-followup §A3 question 3.
  const emittedThisWeek = await countWeeklyEmissions(input.projectId);
  if (emittedThisWeek >= RELEASE_DETECTION_WEEKLY_CAP) {
    log.warn(
      {
        projectId: input.projectId,
        sourceIdentifier: input.sourceIdentifier,
        newTag: input.newReleaseTag,
        emittedThisWeek,
        cap: RELEASE_DETECTION_WEEKLY_CAP,
      },
      "Release-detection pacing cap reached — skipping emission",
    );
    return { briefId: null, skipped: "pacing_limit" };
  }

  const locale = await getPrimaryLocale(input.projectId);

  const metadata: ReleaseMetadata = {
    inventoryRowId:     input.inventoryRowId,
    sourceIdentifier:   input.sourceIdentifier,
    displayName:        input.displayName,
    previousReleaseTag: input.previousReleaseTag,
    newReleaseTag:      input.newReleaseTag,
    releaseName:        input.releaseName,
    releasePublishedAt: input.releasePublishedAt,
    ...(input.starsCount !== undefined && { starsCount: input.starsCount }),
  };

  const briefInsert: TopicBriefInsert = TopicBriefInsertSchema.parse({
    projectId:         input.projectId,
    source:            "release_detection",
    topicTitle:        buildTopicTitle(input.displayName, input.newReleaseTag, locale),
    primaryKeyword:    input.displayName,
    secondaryKeywords: [],
    locale,
    intentType:        "news",
    clusterId:         null,
    clusterAction:     "standalone",
    approvalRequired:  true,
    approvalStatus:    "pending",
    releaseMetadata:   metadata,
  } satisfies TopicBriefInsert);

  // Strip undefined keys before Drizzle insert under exactOptionalPropertyTypes.
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
      previousTag:      input.previousReleaseTag,
      newTag:           input.newReleaseTag,
      emittedThisWeek:  emittedThisWeek + 1,
    },
    "Release-detection brief emitted",
  );

  return { briefId: row.id, skipped: null };
}

// Exposed for unit tests — same-package import path makes the function
// callable from a sibling test file without re-exporting the whole module.
export { startOfIsoWeekUtc, countWeeklyEmissions, existsBriefForRelease };

// Re-export contentSourceInventory for callers that need to compute the
// `inventoryRow.id` mapping — they'd otherwise import from
// @marketing-auto/db directly which is also fine.
export { contentSourceInventory };
