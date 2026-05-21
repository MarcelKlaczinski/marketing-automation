// Spec 63.4: emit-brief Hub-Spoke strategy for knowledge briefs.
// Pure unit test — no DB, no LLM.

import { describe, expect, it } from "bun:test";
import { buildBriefFromCandidate } from "../../../src/topic-sources/trend-discovery/emit-brief.ts";
import type {
  ClusterMatchResult,
  ScoreBreakdown,
  SynthesisTopic,
} from "../../../src/topic-sources/trend-discovery/types.ts";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const CLUSTER_ID = "11111111-1111-1111-1111-111111111111";

function candidate(overrides: Partial<SynthesisTopic> = {}): SynthesisTopic {
  return {
    topic_title: "Was ist RAG?",
    primary_keyword: "RAG",
    secondary_keywords: [],
    intent_type: "knowledge",
    generation_mode: "evergreen",
    suggested_title: "Was ist RAG und wie funktioniert es?",
    suggested_slug: "was-ist-rag",
    suggested_meta: "RAG (Retrieval-Augmented Generation) erklärt: Funktionsweise, Anwendungsfälle und Praxis-Tipps.",
    hero_image_prompt: "Abstract knowledge graph with retrieval arrows connecting to a generation node, technical illustration in cool blue tones, minimalist, no text",
    related_signal_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
    freshness_window: "stable",
    relevance_score: 80,
    ...overrides,
  };
}

const SCORE: ScoreBreakdown = {
  community_buzz: 0,
  search_volume_growth: 0,
  official_announcement: 0,
  serp_volatility: 0,
  source_diversity: 0,
  existing_coverage_penalty: 0,
  total: 60,
};

const NO_MATCH: ClusterMatchResult = { matched: false };
const MATCH: ClusterMatchResult = { matched: true, clusterId: CLUSTER_ID, similarity: 0.78 };

describe("buildBriefFromCandidate (Spec 63.4 Hub-Spoke)", () => {
  it("knowledge + no cluster match → standalone", () => {
    const brief = buildBriefFromCandidate({
      projectId: PROJECT_ID,
      locale: "de",
      candidate: candidate(),
      score: SCORE,
      clusterMatch: NO_MATCH,
      signalPool: [],
    });
    expect(brief.clusterAction).toBe("standalone");
    expect(brief.clusterId).toBeNull();
  });

  it("knowledge + cluster match → append_to_existing under that cluster", () => {
    const brief = buildBriefFromCandidate({
      projectId: PROJECT_ID,
      locale: "de",
      candidate: candidate(),
      score: SCORE,
      clusterMatch: MATCH,
      signalPool: [],
    });
    expect(brief.clusterAction).toBe("append_to_existing");
    expect(brief.clusterId).toBe(CLUSTER_ID);
  });

  // Non-knowledge briefs keep the legacy behaviour: match → append, no match → create_new.
  it("tutorial + no match → create_new (legacy behaviour preserved)", () => {
    const brief = buildBriefFromCandidate({
      projectId: PROJECT_ID,
      locale: "de",
      candidate: candidate({ intent_type: "tutorial" }),
      score: SCORE,
      clusterMatch: NO_MATCH,
      signalPool: [],
    });
    expect(brief.clusterAction).toBe("create_new");
    expect(brief.clusterId).toBeNull();
  });

  it("news + match → append_to_existing (legacy behaviour preserved)", () => {
    const brief = buildBriefFromCandidate({
      projectId: PROJECT_ID,
      locale: "de",
      candidate: candidate({ intent_type: "news" }),
      score: SCORE,
      clusterMatch: MATCH,
      signalPool: [],
    });
    expect(brief.clusterAction).toBe("append_to_existing");
    expect(brief.clusterId).toBe(CLUSTER_ID);
  });
});
