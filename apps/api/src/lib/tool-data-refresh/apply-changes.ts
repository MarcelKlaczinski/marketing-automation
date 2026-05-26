/**
 * Spec 65.3 Part B — apply the LLM-extracted snapshot + diff to the DB.
 *
 * Conservative write strategy:
 *   - `articles.tool_data_refresh_metadata` jsonb gets the full audit blob
 *     (snapshot + diff + sources + ring-buffer of recent refreshes).
 *   - `articles.last_refreshed_at` advances to NOW so the staleness scan
 *     picks the next batch.
 *   - `articles.domain_extras.toolDataRefresh` gets the structured extract
 *     so the comparison/draft pipeline can surface "fresh as of <date>"
 *     hints without overwriting Marcel-owned `tool_pricing` / `tool_price_from`.
 *   - On material change, `invalidatePersonaScoresForTool` is called so the
 *     next brief-generator pass re-scores the tool with the fresh facts.
 */
import {
  articles,
  db,
  eq,
  sql,
  type ToolDataRefreshMetadata,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { invalidatePersonaScoresForTool } from "../persona-scoring/invalidate-persona-scores.ts";
import type { ToolDataDiff } from "./compute-diff.ts";
import type { ToolDataExtract } from "./extract-tool-data.ts";

const log = createLogger("tool-data-refresh:apply");

const RING_BUFFER_LIMIT = 5;

export interface ApplyToolDataChangesInput {
  toolId: string;
  extract: ToolDataExtract;
  diff: ToolDataDiff;
  /** Prior metadata blob — used to keep the recent-refreshes ring buffer. */
  priorMetadata: ToolDataRefreshMetadata | null;
}

export interface ApplyToolDataChangesResult {
  toolId: string;
  materialChange: boolean;
  summary: string | null;
  invalidatedPersonaScores: number;
}

/**
 * Apply the structured changes to the DB. Idempotent — calling twice with
 * the same extract produces the same DB state (modulo the ring buffer
 * advancing each time, which is intentional audit history).
 */
export async function applyToolDataChanges(
  input: ApplyToolDataChangesInput
): Promise<ApplyToolDataChangesResult> {
  const now = new Date();
  const nowIso = now.toISOString();

  // Build the ring buffer of recent refreshes. Newest first; cap at 5.
  const priorRing = input.priorMetadata?.recentRefreshes ?? [];
  const newEvent: ToolDataRefreshMetadata["recentRefreshes"][number] = {
    at: nowIso,
    materialChange: input.diff.materialChange,
    summary: input.diff.summary,
  };
  const recentRefreshes = [newEvent, ...priorRing].slice(0, RING_BUFFER_LIMIT);

  const refreshMetadata: ToolDataRefreshMetadata = {
    lastRefreshedAt: nowIso,
    lastMaterialChange: input.diff.materialChange,
    lastChangeSummary: input.diff.summary,
    lastSources: input.extract.sources.slice(0, 5),
    pricingFingerprint: input.diff.newPricingFingerprint,
    featureFingerprint: input.diff.newFeatureFingerprint,
    recentRefreshes,
  };

  // Build the additive jsonb patch for domain_extras. Uses jsonb_set so we
  // only touch the `toolDataRefresh` key — Marcel-owned siblings (toolSlugs,
  // category overrides, etc.) survive untouched.
  const domainExtrasPatch = JSON.stringify({
    refreshedAt: nowIso,
    pricing: input.extract.pricing,
    features: input.extract.features,
    sources: input.extract.sources,
    materialChange: input.diff.materialChange,
    summary: input.diff.summary,
  });

  await db
    .update(articles)
    .set({
      toolDataRefreshMetadata: refreshMetadata,
      lastRefreshedAt: now,
      domainExtras: sql`jsonb_set(
        coalesce(${articles.domainExtras}, '{}'::jsonb),
        '{toolDataRefresh}',
        ${domainExtrasPatch}::jsonb,
        true
      )`,
      updatedAt: now,
    })
    .where(eq(articles.id, input.toolId));

  let invalidatedPersonaScores = 0;
  if (input.diff.materialChange) {
    const reason = input.diff.summary ?? "Tool-data material change detected";
    const result = await invalidatePersonaScoresForTool({
      toolId: input.toolId,
      reason,
    });
    invalidatedPersonaScores = result.deletedCount;
    log.info(
      {
        toolId: input.toolId,
        reason,
        invalidatedPersonaScores,
      },
      "applyToolDataChanges: material change processed"
    );
  } else {
    log.debug(
      { toolId: input.toolId, pricingChanged: input.diff.pricingChanged, featuresChanged: input.diff.featuresChanged },
      "applyToolDataChanges: non-material refresh stored"
    );
  }

  return {
    toolId: input.toolId,
    materialChange: input.diff.materialChange,
    summary: input.diff.summary,
    invalidatedPersonaScores,
  };
}
