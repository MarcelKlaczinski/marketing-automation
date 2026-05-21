import type { TopicBriefInsert, ExternalSignal } from "@marketing-auto/db";
import type { SynthesisTopic, ScoreBreakdown, ClusterMatchResult } from "./types.ts";

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

export function buildBriefFromCandidate(input: BuildBriefInput): TopicBriefInsert {
  const { projectId, locale, candidate, score, clusterMatch, signalPool } = input;

  const candidateSignals = signalPool.filter((s) =>
    candidate.related_signal_ids.includes(s.id),
  );

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
