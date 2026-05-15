import type { TopicBriefInsert, ExternalSignal } from "@marketing-auto/db";
import type { SynthesisTopic, ScoreBreakdown, ClusterMatchResult } from "./types.ts";

// ─── Normalise candidate title for dedup ──────────────────────────────────────

export function normalizeCandidateTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, " ");
}

// ─── Map candidate + score + match → TopicBriefInsert ─────────────────────────

export type BuildBriefInput = {
  projectId: string;
  candidate: SynthesisTopic;
  score: ScoreBreakdown;
  clusterMatch: ClusterMatchResult;
  signalPool: ExternalSignal[];
};

export function buildBriefFromCandidate(input: BuildBriefInput): TopicBriefInsert {
  const { projectId, candidate, score, clusterMatch, signalPool } = input;

  const candidateSignals = signalPool.filter((s) =>
    candidate.related_signal_ids.includes(s.id),
  );

  const clusterFields: Pick<TopicBriefInsert, "clusterId" | "clusterAction"> = clusterMatch.matched
    ? { clusterId: clusterMatch.clusterId, clusterAction: "append_to_existing" }
    : { clusterId: null, clusterAction: "create_new" };

  const trendMetadata = {
    trendScore: score.total,
    signals: candidateSignals.map((s) => ({
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
    approvalRequired: true,
    approvalStatus: "pending",
    trendMetadata,
    ...clusterFields,
  };
}
