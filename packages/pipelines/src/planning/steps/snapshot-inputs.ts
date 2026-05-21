// Spec 62.4 Step 4: snapshot every input the algorithm read into one JSONB.
// This is persisted on the weekly_plans row at PersistPlanStep time. A
// replay of this snapshot through the deterministic selection steps must
// produce the same planned_items — that property is what makes 62.6's
// debug UI useful.

import { computeSignalTopN, type SignalRefreshResult } from "@marketing-auto/planner";
import type {
  ProjectGoal,
  ProjectPlannerConfig,
  TopicBrief,
} from "@marketing-auto/db";
import {
  type GoalSnapshotEntry,
  type PlannerConfigSnapshot,
  type SignalRefreshResultSnapshot,
  type SignalTopNEntry,
  type TopicBriefSnapshotEntry,
  type WeeklyPlanInputSnapshot,
} from "@marketing-auto/shared";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

export const snapshotInputsInputSchema = z.object({
  projectId: z.string().uuid(),
  topNSignalsAllowedOverage: z.number().int().min(0),
});
type Input = z.infer<typeof snapshotInputsInputSchema>;

export const snapshotInputsOutputSchema = z.object({
  snapshot: z.unknown(),
});
type Output = z.infer<typeof snapshotInputsOutputSchema>;

export class SnapshotInputsStep extends BaseStep<Input, Output> {
  readonly name = "snapshot-inputs";
  readonly inputSchema = snapshotInputsInputSchema;
  readonly outputSchema = snapshotInputsOutputSchema;

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const goalsRaw = ctx.getStepOutput<{ goals: ProjectGoal[] }>("validate-goals")?.goals ?? [];
    const config = ctx.getStepOutput<{ config: ProjectPlannerConfig }>("validate-goals")?.config;
    if (!config) {
      throw new Error("snapshot-inputs: validate-goals.config missing");
    }
    const refreshResult = ctx.getStepOutput<{ signalRefreshResult: SignalRefreshResult }>(
      "refresh-signals",
    )?.signalRefreshResult;
    const briefs = ctx.getStepOutput<{ topicBriefs: TopicBrief[] }>("load-topic-briefs")
      ?.topicBriefs ?? [];

    const topN = await computeSignalTopN({
      projectId: input.projectId,
      topN: input.topNSignalsAllowedOverage,
    });

    const goalSnap: GoalSnapshotEntry[] = goalsRaw.map((g) => ({
      id: g.id,
      contentType: g.contentType,
      cadenceUnit: g.cadenceUnit,
      minCount: g.minCount,
      maxCount: g.maxCount,
      isActive: g.isActive,
    }));

    const configSnap: PlannerConfigSnapshot = {
      weeklyBudgetEur: Number(config.weeklyBudgetEur),
      perTypeMaxEur: config.perTypeMaxEur ?? null,
      topNSignalsAllowedOverage: config.topNSignalsAllowedOverage,
      maxOveragePerSignal: config.maxOveragePerSignal,
      signalMaxAgeHours: config.signalMaxAgeHours,
      excludedPipelines: config.excludedPipelines,
    };

    const briefSnap: TopicBriefSnapshotEntry[] = briefs.map((b) => ({
      id: b.id,
      source: b.source,
      clusterAction: b.clusterAction,
      topicTitle: b.topicTitle,
      locale: b.locale ?? null,
      primaryKeyword: b.primaryKeyword ?? null,
      clusterId: b.clusterId ?? null,
      metadata:
        b.gapMetadata ??
        b.trendMetadata ??
        b.refreshMetadata ??
        b.comparisonMetadata ??
        null,
    }));

    const topNSnap: SignalTopNEntry[] = topN.map((r) => ({
      signalId: r.signalId,
      source: r.source,
      title: r.title,
      url: r.url,
      rawScore: r.rawScore,
      normalizedScore: r.normalizedScore,
    }));

    const refreshSnap: SignalRefreshResultSnapshot | null = refreshResult
      ? {
          projectId: refreshResult.projectId,
          triggeredAt: refreshResult.triggeredAt.toISOString(),
          sourceResults: refreshResult.sourceResults.map((r) => {
            const base: SignalRefreshResultSnapshot["sourceResults"][number] = {
              source: r.source,
              status: r.status,
              rowsAdded: r.rowsAdded,
              lastCollectedAt: r.lastCollectedAt ? r.lastCollectedAt.toISOString() : null,
            };
            if (r.notes !== undefined) base.notes = r.notes;
            if (r.error !== undefined) base.error = r.error;
            return base;
          }),
          totalRowsAdded: refreshResult.totalRowsAdded,
          durationMs: refreshResult.durationMs,
        }
      : {
          projectId: input.projectId,
          triggeredAt: new Date().toISOString(),
          sourceResults: [],
          totalRowsAdded: 0,
          durationMs: 0,
        };

    const snapshot: WeeklyPlanInputSnapshot = {
      goals: goalSnap,
      config: configSnap,
      signalRefreshResult: refreshSnap,
      topicBriefSnapshot: briefSnap,
      signalTopN: topNSnap,
      triggeredAt: new Date().toISOString(),
    };

    return { snapshot };
  }
}
