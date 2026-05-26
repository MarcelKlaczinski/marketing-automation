/**
 * Spec 65.3 — Lazy persona-score fetch with on-demand re-score.
 *
 * Brief-generators (65.5) call this when they need persona-filtered tool
 * candidates. The function reconciles the cached `tool_persona_scores` rows
 * against a fresh-window cutoff (6 months by default — Marcel-Decision §3.4)
 * and triggers an inline re-score for missing or stale tools so the caller
 * always gets a usable score, never a 404-equivalent.
 *
 * Stale-OR-missing branch:
 *   1. Fetch fresh scores for the requested (project, persona, toolIds)
 *      tuple via `listFreshPersonaScores`.
 *   2. Diff against the input toolIds → `missingOrStale` set.
 *   3. Inline-trigger `scoreToolForPersonas` for each stale tool (in parallel
 *      bounded by `INLINE_CONCURRENCY`). Each tool re-scores ALL personas in
 *      one call (cheaper than scoring one persona at a time).
 *   4. Re-read the fresh-window subset for the just-scored tools and merge.
 *
 * Cost ceiling: the inline branch is gated by an explicit `maxInlineScores`
 * input (default 5). If more tools are stale, the helper returns the fresh
 * subset and reports `skipped` count — the caller can fall back to a wider
 * pool or wait for the next backfill cron.
 */
import {
  and,
  db,
  eq,
  gte,
  inArray,
  toolPersonaScores,
  type ToolPersonaScore,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { scoreToolForPersonas } from "./score-tool-for-personas.ts";

const log = createLogger("persona-scoring:pick");

/** Marcel-Decision §3.4 — 6-month TTL. */
const FRESH_WINDOW_DAYS = 180;
/** Worst case 5 parallel Haiku calls @ ~3s each ≈ 5s total when triggered inline. */
const INLINE_CONCURRENCY = 3;

export interface PickPersonaScoredToolsInput {
  projectId: string;
  persona: string;
  /** Pool of tool IDs to score-rank. Empty → empty result. */
  toolIds: string[];
  /**
   * Floor for the returned set. Default 5 (mid-strong fit). Use 7 for
   * "ideal-fit-only" surfaces. Use 0 to disable filtering and return the
   * full ranked list.
   */
  minScore?: number;
  /** Upper bound on inline re-scores per call. Beyond this, stale tools are skipped. */
  maxInlineScores?: number;
  /** Propagated to Anthropic adapter for cost-attribution. */
  pipelineRunId?: string;
}

export interface PickPersonaScoredToolsResult {
  /** Scores at-or-above `minScore`, sorted score DESC, scoredAt DESC, toolId ASC. */
  scoredTools: ToolPersonaScore[];
  /** Tools the function re-scored inline this call (count, not IDs). */
  rescoredCount: number;
  /** Tools the function skipped re-scoring because the inline cap was hit. */
  skippedCount: number;
}

/**
 * Load fresh (scoredAt >= cutoff) persona-scores for a (project, persona,
 * toolIds) tuple. Stale rows are not returned — the caller treats them as
 * "missing" and may re-score inline.
 */
async function listFreshPersonaScores(input: {
  projectId: string;
  persona: string;
  toolIds: string[];
  cutoff: Date;
}): Promise<ToolPersonaScore[]> {
  if (input.toolIds.length === 0) return [];
  return await db
    .select()
    .from(toolPersonaScores)
    .where(
      and(
        eq(toolPersonaScores.projectId, input.projectId),
        eq(toolPersonaScores.persona, input.persona),
        inArray(toolPersonaScores.toolId, input.toolIds),
        gte(toolPersonaScores.scoredAt, input.cutoff)
      )
    );
}

/**
 * Bounded-concurrency map for the inline re-score batch. Uses a simple
 * shifting-cursor pool — sufficient for INLINE_CONCURRENCY = 3.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      const item = items[idx];
      if (item === undefined) continue;
      results[idx] = await fn(item);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function pickPersonaScoredTools(
  input: PickPersonaScoredToolsInput
): Promise<PickPersonaScoredToolsResult> {
  if (input.toolIds.length === 0) {
    return { scoredTools: [], rescoredCount: 0, skippedCount: 0 };
  }

  const minScore = input.minScore ?? 5;
  const maxInline = input.maxInlineScores ?? 5;
  const cutoff = new Date(Date.now() - FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const fresh = await listFreshPersonaScores({
    projectId: input.projectId,
    persona: input.persona,
    toolIds: input.toolIds,
    cutoff,
  });

  const freshIds = new Set(fresh.map((r) => r.toolId));
  const missingOrStale = input.toolIds.filter((id) => !freshIds.has(id));

  let rescoredCount = 0;
  let skippedCount = 0;
  let justScoredRows: ToolPersonaScore[] = [];

  if (missingOrStale.length > 0) {
    const toRescore = missingOrStale.slice(0, maxInline);
    skippedCount = missingOrStale.length - toRescore.length;

    if (skippedCount > 0) {
      log.info(
        {
          projectId: input.projectId,
          persona: input.persona,
          missingTotal: missingOrStale.length,
          inlineRescored: toRescore.length,
          skipped: skippedCount,
        },
        "pickPersonaScoredTools: inline cap reached — some tools skipped"
      );
    }

    const results = await mapWithConcurrency(toRescore, INLINE_CONCURRENCY, (toolId) =>
      scoreToolForPersonas({
        projectId: input.projectId,
        toolId,
        // Score ALL personas in the inline call — the same Haiku call covers
        // the requested persona plus the other 9 for ~free. Future calls for
        // sibling personas hit the cache.
        ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
      })
    );

    rescoredCount = results.filter((r) => r.source === "llm").length;

    if (rescoredCount > 0) {
      justScoredRows = await listFreshPersonaScores({
        projectId: input.projectId,
        persona: input.persona,
        toolIds: toRescore,
        cutoff,
      });
    }
  }

  const merged = [...fresh, ...justScoredRows];
  const ranked = merged
    .filter((r) => r.score >= minScore)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const aAt = a.scoredAt.getTime();
      const bAt = b.scoredAt.getTime();
      if (aAt !== bAt) return bAt - aAt;
      return a.toolId.localeCompare(b.toolId);
    });

  return { scoredTools: ranked, rescoredCount, skippedCount };
}
