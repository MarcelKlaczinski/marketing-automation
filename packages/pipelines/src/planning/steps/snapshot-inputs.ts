// Spec 62.4 Step 4: snapshot every input the algorithm read into one JSONB.
// This is persisted on the weekly_plans row at PersistPlanStep time. A
// replay of this snapshot through the deterministic selection steps must
// produce the same planned_items — that property is what makes 62.6's
// debug UI useful.

import { db, eq, projects, type ProjectGoal, type ProjectPlannerConfig, type TopicBrief } from "@marketing-auto/db";
import { type SignalRefreshResult, computeSignalTopN } from "@marketing-auto/planner";
import {
  type GoalSnapshotEntry,
  type PlannerConfigSnapshot,
  type SignalRefreshResultSnapshot,
  type SignalTopNEntry,
  type TopicBriefSnapshotEntry,
  type WeeklyPlanInputSnapshot,
  getEnv,
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
      "refresh-signals"
    )?.signalRefreshResult;
    const briefs =
      ctx.getStepOutput<{ topicBriefs: TopicBrief[] }>("load-topic-briefs")?.topicBriefs ?? [];

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

    // Spec 62.5.1 + 64.6b: capture projects.{llmMode, image_generation_provider,
    // image_generation_resolution} in the snapshot so cost estimates are reproducible —
    // replaying under a different setting would change per-item costs.
    const projectRow = await db
      .select({
        llmMode: projects.llmMode,
        imageGenerationProvider: projects.imageGenerationProvider,
        imageGenerationResolution: projects.imageGenerationResolution,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    const llmMode: "sync" | "batch" =
      projectRow[0]?.llmMode === "batch" ? "batch" : "sync";
    // Spec 64.6b: the snapshot schema is forward-compat with a future Pro
    // toggle, but `projects.image_generation_provider` is narrowed to
    // {"nano-banana-2","flux-1.1-pro"} via Drizzle `$type<>()`. When that DB
    // column widens to include "nano-banana-pro", extend this match to forward
    // the new value (the TS type-error here will fire and force the update).
    const imageGenerationProvider: PlannerConfigSnapshot["imageGenerationProvider"] =
      projectRow[0]?.imageGenerationProvider === "flux-1.1-pro" ? "flux-1.1-pro" : "nano-banana-2";
    const imageGenerationResolution: PlannerConfigSnapshot["imageGenerationResolution"] =
      projectRow[0]?.imageGenerationResolution ?? "1k";

    const configSnap: PlannerConfigSnapshot = {
      weeklyBudgetEur: Number(config.weeklyBudgetEur),
      perTypeMaxEur: config.perTypeMaxEur ?? null,
      topNSignalsAllowedOverage: config.topNSignalsAllowedOverage,
      maxOveragePerSignal: config.maxOveragePerSignal,
      signalMaxAgeHours: config.signalMaxAgeHours,
      excludedPipelines: config.excludedPipelines,
      llmMode,
      // Spec 63.5: freeze diversity-modifier knobs into the snapshot so a
      // replay reproduces the same Floor / Overage / Social-post picks even
      // if Marcel later moves the sliders. Stored as numeric(4,3) on the DB
      // side → string at the Drizzle boundary; coerced to JS number here.
      diversityThreshold: Number(config.diversityThreshold),
      diversityMalusWeight: Number(config.diversityMalusWeight),
      // Spec 64.15 Phase B: freeze the cross-week diversity lookback at plan-
      // generation time so replays reproduce the same picks even if the env
      // changes. Same SSoT discipline as llmMode / diversityThreshold.
      planDiversityLookbackWeeks: getEnv().PLAN_DIVERSITY_LOOKBACK_WEEKS,
      imageGenerationProvider,
      imageGenerationResolution,
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
        b.gapMetadata ?? b.trendMetadata ?? b.refreshMetadata ?? b.comparisonMetadata ?? null,
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
          // Spec 62.6: when this step is reached via a debug-mode resume, the
          // upstream refresh-signals output came through JSONB on the parent
          // run's suspensionCheckpoint — every Date is now a string. In a
          // production run it's still a real Date in memory. Normalize both.
          triggeredAt: toIsoString(refreshResult.triggeredAt),
          sourceResults: refreshResult.sourceResults.map((r) => {
            const base: SignalRefreshResultSnapshot["sourceResults"][number] = {
              source: r.source,
              status: r.status,
              rowsAdded: r.rowsAdded,
              lastCollectedAt: toIsoStringOrNull(r.lastCollectedAt),
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

/**
 * Normalize a Date OR an ISO-string into an ISO-string. Required because the
 * upstream step output may arrive either way: in-memory during a production
 * run (Date), or via JSONB on `pipeline_runs.suspensionCheckpoint` during a
 * debug-mode resume (string). Returns "" for null/undefined since the caller
 * always wants a real ISO string in that branch.
 */
function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
