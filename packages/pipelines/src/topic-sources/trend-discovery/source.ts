import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import {
  db,
  externalSignals,
  rejectedTopicCandidates,
  and,
  eq,
  gt,
  inArray,
  isNull,
} from "@marketing-auto/db";
import type { TopicBriefInsert } from "@marketing-auto/db";
import type { TopicSource, TopicSourceContext } from "../types.ts";
import { fetchEligibleSignals } from "./fetch-signals.ts";
import { synthesizeTopics } from "./synthesize.ts";
import { checkExistingCoverage } from "./coverage.ts";
import { computeTrendScore } from "./score.ts";
import { findMatchingCluster } from "./cluster-match.ts";
import { buildBriefFromCandidate, normalizeCandidateTitle } from "./emit-brief.ts";
import { loadActiveConfig } from "../../config/load-active-config.ts";
import type { SynthesisTopic } from "./types.ts";

const log = createLogger("trend-discovery:source");

// ─── Input schema ─────────────────────────────────────────────────────────────

const _InputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof _InputSchema>;
const InputSchema = _InputSchema as z.ZodType<Input>;

// ─── TrendDiscoveryTopicSource ────────────────────────────────────────────────

export class TrendDiscoveryTopicSource implements TopicSource<Input> {
  readonly source = "trend_discovery" as const;
  readonly inputSchema = InputSchema;

  async emit(input: Input, ctx: TopicSourceContext): Promise<TopicBriefInsert[]> {
    const { projectId } = input;
    const pipelineRunId = ctx.pipelineRunId;

    // 1. Load eligible signals
    const signals = await fetchEligibleSignals(projectId);
    if (signals.length === 0) {
      log.info({ projectId }, "no eligible signals — skipping synthesis");
      return [];
    }

    // 2. LLM synthesis: cluster signals into topic candidates
    const synthesis = await synthesizeTopics(projectId, signals, pipelineRunId);

    const briefsToEmit: TopicBriefInsert[] = [];

    // 3. Per-candidate evaluation pipeline
    for (const candidate of synthesis.topics) {
      const candidateNormalized = normalizeCandidateTitle(candidate.topic_title);

      // 3a. Check existing-coverage (embedding + Haiku tiebreaker)
      const coverage = await checkExistingCoverage({
        projectId,
        candidate,
        ...(pipelineRunId !== undefined && { pipelineRunId }),
      });

      if (coverage.covered) {
        log.debug(
          { projectId, topicTitle: candidate.topic_title, similarity: coverage.similarity },
          "candidate rejected: existing coverage",
        );
        await this.recordRejection(projectId, candidate, candidateNormalized, "existing_coverage", {
          similarityScore: coverage.similarity,
          matchedArticleId: coverage.matchedArticleId,
        });
        await this.stampSignalsProcessed(candidate.related_signal_ids, null);
        continue;
      }

      // 3b. Check non-expired rejection in rejected_topic_candidates
      const recentlyRejected = await this.wasRecentlyRejected(projectId, candidateNormalized);
      if (recentlyRejected) {
        log.debug(
          { projectId, topicTitle: candidate.topic_title },
          "candidate skipped: recent rejection still active",
        );
        // Signals stay unprocessed — may re-cluster differently on next run
        continue;
      }

      // 3c. Compute trend score
      const score = await computeTrendScore({
        projectId,
        candidate,
        signalPool: signals,
        maxExistingSimilarity: coverage.similarity,
      });

      const config = await loadActiveConfig(projectId);
      const minScore = config.topicScope.min_trend_score;

      if (score.total < minScore) {
        log.debug(
          { projectId, topicTitle: candidate.topic_title, score: score.total, minScore },
          "candidate rejected: low score",
        );
        await this.recordRejection(projectId, candidate, candidateNormalized, "low_score", {
          trendScore: score.total,
        });
        await this.stampSignalsProcessed(candidate.related_signal_ids, null);
        continue;
      }

      // 3d. Find matching cluster (lazy backfill inside findMatchingCluster)
      const clusterMatch = await findMatchingCluster({
        projectId,
        candidate,
        ...(pipelineRunId !== undefined && { pipelineRunId }),
      });

      // 3e. Build TopicBriefInsert (caller owns persistence)
      const brief = buildBriefFromCandidate({
        projectId,
        candidate,
        score,
        clusterMatch,
        signalPool: signals,
      });

      briefsToEmit.push(brief);

      await this.stampSignalsProcessed(candidate.related_signal_ids, null);

      log.info(
        {
          projectId,
          topicTitle: candidate.topic_title,
          score: score.total,
          clusterAction: brief.clusterAction,
          clusterId: brief.clusterId,
        },
        "topic brief queued for emission",
      );
    }

    // 4. Stamp unclustered signals as processed (LLM explicitly skipped them)
    if (synthesis.unclustered_signal_ids.length > 0) {
      await this.stampSignalsProcessed(synthesis.unclustered_signal_ids, null);
    }

    log.info(
      {
        projectId,
        signalsIn: signals.length,
        candidatesEvaluated: synthesis.topics.length,
        briefsEmitted: briefsToEmit.length,
      },
      "trend discovery source emit complete",
    );

    return briefsToEmit;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async wasRecentlyRejected(
    projectId: string,
    candidateTitleNormalized: string,
  ): Promise<boolean> {
    const rows = await db
      .select({ id: rejectedTopicCandidates.id })
      .from(rejectedTopicCandidates)
      .where(
        and(
          eq(rejectedTopicCandidates.projectId, projectId),
          eq(rejectedTopicCandidates.candidateTitleNormalized, candidateTitleNormalized),
          gt(rejectedTopicCandidates.expiresAt, new Date()),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }

  private async recordRejection(
    projectId: string,
    candidate: SynthesisTopic,
    candidateTitleNormalized: string,
    reason: "existing_coverage" | "low_score" | "excluded_by_scope" | "low_signal_volume",
    extras: {
      trendScore?: number;
      similarityScore?: number;
      matchedArticleId?: string | null;
    } = {},
  ): Promise<void> {
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000);

    const baseValues = {
      projectId,
      topicTitle: candidate.topic_title,
      candidateTitleNormalized,
      reason,
      sourceSignalIds: candidate.related_signal_ids,
      expiresAt: thirtyDaysFromNow,
    };

    const optionalValues: {
      trendScore?: number;
      similarityScore?: string;
      matchedArticleId?: string;
    } = {};

    if (extras.trendScore !== undefined) {
      optionalValues.trendScore = extras.trendScore;
    }
    if (extras.similarityScore !== undefined) {
      optionalValues.similarityScore = extras.similarityScore.toFixed(3);
    }
    if (extras.matchedArticleId !== null && extras.matchedArticleId !== undefined) {
      optionalValues.matchedArticleId = extras.matchedArticleId;
    }

    await db.insert(rejectedTopicCandidates).values({
      ...baseValues,
      ...optionalValues,
    });
  }

  private async stampSignalsProcessed(
    signalIds: string[],
    processedInto: string | null,
  ): Promise<void> {
    if (signalIds.length === 0) return;

    await db
      .update(externalSignals)
      .set({ processedAt: new Date(), processedInto })
      .where(
        and(
          inArray(externalSignals.id, signalIds),
          isNull(externalSignals.processedAt),
        ),
      );
  }
}
