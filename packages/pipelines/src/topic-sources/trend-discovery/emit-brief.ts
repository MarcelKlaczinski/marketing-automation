import { voyage } from "@marketing-auto/adapter-voyage";
import { COST_OPS } from "@marketing-auto/core/cost";
import type { ExternalSignal, TopicBriefInsert } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import type { ClusterMatchResult, ScoreBreakdown, SynthesisTopic } from "./types.ts";

const log = createLogger("pipelines:trend-discovery:emit-brief");

// ─── Normalise candidate title for dedup ──────────────────────────────────────

export function normalizeCandidateTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}

// ─── Map candidate + score + match → TopicBriefInsert ─────────────────────────

export type BuildBriefInput = {
  projectId: string;
  locale: "de" | "en";
  candidate: SynthesisTopic;
  score: ScoreBreakdown;
  clusterMatch: ClusterMatchResult;
  signalPool: ExternalSignal[];
};

// Spec 64.15 Phase C: the Voyage embedding is NOT computed inside the pure
// builder below. Callers chain `computeBriefEmbedding(brief, opts)` after
// `buildBriefFromCandidate(...)` to add the embedding field. Splitting the
// I/O from the pure shape lets unit tests exercise builder logic without a
// network dep, and lets non-trend-discovery callers (manual brief creation,
// gap-detection, comparison-discovery) skip the upfront Voyage call and rely
// on lazy-backfill at first plan-runner read.

export function buildBriefFromCandidate(input: BuildBriefInput): TopicBriefInsert {
  const { projectId, locale, candidate, score, clusterMatch, signalPool } = input;

  const candidateSignals = signalPool.filter((s) => candidate.related_signal_ids.includes(s.id));

  // Spec 63.4: knowledge briefs use Hub-Spoke. With a match → append_to_existing
  // (under whatever cluster matched — Marcel's call to allow tools/comparisons
  // hubs too, the planner still routes them to the ki_wissen bucket). Without a
  // match → standalone (new eigenständiger ki-wissen article).
  // Non-knowledge intents keep the legacy create_new fallback.
  const isKnowledge = candidate.intent_type === "knowledge";
  const clusterFields: Pick<TopicBriefInsert, "clusterId" | "clusterAction"> = clusterMatch.matched
    ? { clusterId: clusterMatch.clusterId, clusterAction: "append_to_existing" }
    : isKnowledge
      ? { clusterId: null, clusterAction: "standalone" }
      : { clusterId: null, clusterAction: "create_new" };

  const trendMetadata = {
    trendScore: score.total,
    scoreBreakdown: {
      communityBuzz: score.community_buzz,
      searchVolumeGrowth: score.search_volume_growth,
      officialAnnouncement: score.official_announcement,
      serpVolatility: score.serp_volatility,
      sourceDiversity: score.source_diversity,
      existingCoveragePenalty: score.existing_coverage_penalty,
    },
    signals: candidateSignals.map((s) => ({
      id: s.id,
      source: s.source,
      externalId: s.externalId,
      ...(s.url !== null && s.url !== undefined && { url: s.url }),
      capturedAt: s.collectedAt.toISOString(),
    })),
    freshnessWindow: candidate.freshness_window,
  };

  return {
    projectId,
    source: "trend_discovery",
    topicTitle: candidate.topic_title,
    primaryKeyword: candidate.primary_keyword,
    secondaryKeywords: candidate.secondary_keywords,
    intentType: candidate.intent_type,
    generationMode: candidate.generation_mode,
    suggestedTitle: candidate.suggested_title,
    suggestedSlug: candidate.suggested_slug,
    suggestedMeta: candidate.suggested_meta,
    heroImagePrompt: candidate.hero_image_prompt,
    locale,
    approvalRequired: true,
    approvalStatus: "pending",
    trendMetadata,
    ...clusterFields,
  };
}

// ─── Voyage embedding computation (Spec 64.15 Phase C) ────────────────────────

/**
 * Build the embedding-text string for a brief insert. Mirrors
 * `buildEmbeddingText(TopicBrief)` in diversity-embedding.ts — but works on
 * `TopicBriefInsert` (pre-insert shape) so emit-brief.ts can compute the
 * embedding BEFORE the row reaches the DB.
 *
 * Returns null when neither field carries useful text — `computeBriefEmbedding`
 * then skips the Voyage call and the row inserts with `embedding=NULL`. The
 * lazy-backfill in `ensureBriefEmbedding` covers that case at first read.
 */
function buildInsertEmbeddingText(brief: TopicBriefInsert): string | null {
  const primary = (brief.primaryKeyword ?? "").trim();
  const title = (brief.topicTitle ?? "").trim();
  if (primary && title) return `${primary} ${title}`;
  if (primary) return primary;
  if (title) return title;
  return null;
}

/**
 * Compute the Voyage-3 embedding for a brief-insert and return a new insert
 * object with `embedding` populated. Idempotent + pure-ish: when the input
 * already carries an embedding, the existing value passes through unchanged
 * (callers can pre-compute and chain). When Voyage fails, the function logs
 * a warn and returns the input unchanged so the brief still inserts.
 *
 * Cost: 1 Voyage embed call (~€0.0003) per brief — paid once at brief-creation
 * time instead of N times per plan-run. Spec 64.15 Phase C.
 */
export async function computeBriefEmbedding(
  brief: TopicBriefInsert,
  opts: { projectId: string; pipelineRunId?: string }
): Promise<TopicBriefInsert> {
  if (brief.embedding !== undefined && brief.embedding !== null) {
    return brief;
  }
  const text = buildInsertEmbeddingText(brief);
  if (text === null) {
    return brief;
  }
  try {
    const embedding = await voyage.embed(text, {
      projectId: opts.projectId,
      operation: COST_OPS.VOYAGE_EMBED_TEXT,
      ...(opts.pipelineRunId !== undefined && { pipelineRunId: opts.pipelineRunId }),
    });
    return { ...brief, embedding };
  } catch (err) {
    // Soft failure: brief still inserts without an embedding; lazy-backfill
    // at first plan-runner read will retry.
    log.warn(
      { err, projectId: opts.projectId, topicTitle: brief.topicTitle },
      "computeBriefEmbedding: Voyage embed failed — proceeding without embedding"
    );
    return brief;
  }
}
