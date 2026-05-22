// Spec 62.4 Step 6: top-N signal overage selection.
//
// For each of the top-N normalised signals (in `snapshot.signalTopN`):
//   - skip if a brief derived from this signal is already in floorItems
//     (heuristic: a brief whose sourceSignalId equals the signal id)
//   - infer a content type from the signal source (ProductHunt → social_post,
//     HackerNews → ki_wissen, etc.); unmapped sources are skipped
//   - emit `maxOveragePerSignal` (default 1) items per qualifying signal
//
// Result: a list of "overage_signal" PlanningItemDraft, ready for sibling
// expansion + scheduling.

import { randomUUID } from "node:crypto";
import type { ProjectGoal, ProjectPlannerConfig, TopicBrief } from "@marketing-auto/db";
import type {
  SignalSourceContentTypeMap,
  SignalTopNEntry,
  WeeklyPlanInputSnapshot,
} from "@marketing-auto/shared";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import {
  createPlanRunEmbeddingProvider,
  createSignalEmbeddingProvider,
} from "../lib/diversity-embedding.ts";
import { pickWithDiversity } from "../lib/pick-with-diversity.ts";
import {
  PIPELINE_NAME_BY_CONTENT_TYPE,
  PLANNING_CONTENT_TYPES,
  type PlanningContentType,
  type PlanningItemDraft,
} from "../types.ts";
import { weeklyMaxFromGoal } from "./select-floor-items.ts";

export const selectOverageInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof selectOverageInputSchema>;

export const selectOverageOutputSchema = z.object({
  overageItems: z.array(z.unknown()),
});
type Output = z.infer<typeof selectOverageOutputSchema>;

/**
 * Spec 64.14 Phase A: default mapping from signal source → planner content
 * type. `null` means "do not emit an overage planned_item for this source"
 * (signal is still collected and fed to the synthesizer for brief
 * generation — only the cheap heuristic overage path is skipped).
 *
 * `hackernews` + `github` were `"ki_wissen"` pre-64.14 — the heuristic dropped
 * planned_items directly without an LLM intent gate, producing ~85% off-topic
 * noise (e.g. "I've joined Anthropic" landing as a ki_wissen article). They
 * are now `null` so only the synthesizer (which DOES gate on intent_type) can
 * produce briefs from them.
 */
export const DEFAULT_SIGNAL_CONTENT_TYPE_MAP: Readonly<
  Record<string, PlanningContentType | null>
> = Object.freeze({
  producthunt: "social_post",
  hackernews: null,
  reddit: "social_post",
  vendor_rss: "cluster",
  github: null,
  dataforseo_trends: "cluster",
});

/**
 * Heuristic mapping from signal source → planner content type. The
 * `override` map is a partial per-project override (Spec 64.14):
 * - Source key present (any value) → use override value (including `null` to
 *   skip emission).
 * - Source key absent → fall back to `DEFAULT_SIGNAL_CONTENT_TYPE_MAP`.
 * - Unknown source not in either map → `null` (skip).
 */
export function inferContentTypeFromSignal(
  source: string,
  override: SignalSourceContentTypeMap | null = null,
): PlanningContentType | null {
  if (override && Object.prototype.hasOwnProperty.call(override, source)) {
    return override[source] ?? null;
  }
  return DEFAULT_SIGNAL_CONTENT_TYPE_MAP[source] ?? null;
}

/**
 * Spec 63.5: optional dep-injection for the embedding providers. Real runs
 * use the Voyage-backed providers; tests pass stubs to keep them offline.
 */
export interface SelectOverageDeps {
  createBriefEmbeddingProvider?: typeof createPlanRunEmbeddingProvider;
  createSignalEmbeddingProvider?: typeof createSignalEmbeddingProvider;
}

export class SelectOverageItemsStep extends BaseStep<Input, Output> {
  readonly name = "select-overage-items";
  readonly inputSchema = selectOverageInputSchema;
  readonly outputSchema = selectOverageOutputSchema;
  private readonly createBriefEmbeddingProvider: typeof createPlanRunEmbeddingProvider;
  private readonly createSignalEmbeddingProvider: typeof createSignalEmbeddingProvider;

  constructor(deps?: SelectOverageDeps) {
    super();
    this.createBriefEmbeddingProvider =
      deps?.createBriefEmbeddingProvider ?? createPlanRunEmbeddingProvider;
    this.createSignalEmbeddingProvider =
      deps?.createSignalEmbeddingProvider ?? createSignalEmbeddingProvider;
  }

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const config = ctx.getStepOutput<{ config: ProjectPlannerConfig }>("validate-goals")?.config;
    const goals = ctx.getStepOutput<{ goals: ProjectGoal[] }>("validate-goals")?.goals ?? [];
    const snapshot = ctx.getStepOutput<{ snapshot: WeeklyPlanInputSnapshot }>(
      "snapshot-inputs",
    )?.snapshot;
    const floorItems =
      ctx.getStepOutput<{ floorItems: PlanningItemDraft[] }>("select-floor-items")?.floorItems ?? [];
    const briefs =
      ctx.getStepOutput<{ topicBriefs: TopicBrief[] }>("load-topic-briefs")?.topicBriefs ?? [];

    if (!config || !snapshot) {
      throw new Error("select-overage-items: prior step output missing");
    }

    // Spec 64.2: build remaining-capacity map per content_type. Overage may
    // emit AT MOST `weeklyMaxFromGoal(goal) - floorPicked(C)` items for any
    // given content_type C. `null` means uncapped (goal.max_count IS NULL).
    // Content_types without a matching goal default to null (preserves pre-
    // 64.2 unlimited behaviour). The map is mutated as we emit so multiple
    // top-N signals of the same type are gated against the running tally,
    // not just the floor baseline. Goals with unknown content types are
    // warn-and-skipped — matches the SelectFloorItemsStep validation pattern
    // so DB-level drift doesn't put garbage into the cap map.
    const remainingCapByCT = new Map<PlanningContentType, number | null>();
    for (const goal of goals) {
      const ct = (PLANNING_CONTENT_TYPES as readonly string[]).includes(goal.contentType)
        ? (goal.contentType as PlanningContentType)
        : null;
      if (ct === null) {
        ctx.log.warn(
          { contentType: goal.contentType, goalId: goal.id },
          "select-overage-items: goal has unknown content type; cap skipped",
        );
        continue;
      }
      const weeklyMax = weeklyMaxFromGoal(goal);
      if (weeklyMax === null) {
        remainingCapByCT.set(ct, null);
        continue;
      }
      const floorUsed = floorItems.filter((it) => it.contentType === ct).length;
      remainingCapByCT.set(ct, Math.max(0, weeklyMax - floorUsed));
    }

    const used = new Set<string>(
      floorItems.map((it) => it.sourceSignalId).filter((id): id is string => id !== null),
    );

    // Spec 63.5: pre-filter signals to the eligible set with a content type +
    // not-already-used-by-Floor. After this we either FIFO (diversity off /
    // small pool) or diversity-pick from the resulting list.
    //
    // Spec 64.14: per-project signal_source_content_type_map override. NULL on
    // the config row = use DEFAULT_SIGNAL_CONTENT_TYPE_MAP. A null mapping for
    // a known source (e.g. hackernews/github in the default) means the signal
    // is skipped here but still available to the trend synthesizer.
    const overrideMap = config.signalSourceContentTypeMap ?? null;
    const candidates: { signal: SignalTopNEntry; contentType: PlanningContentType }[] = [];
    for (const signal of snapshot.signalTopN.slice(0, config.topNSignalsAllowedOverage)) {
      if (used.has(signal.signalId)) continue;
      const contentType = inferContentTypeFromSignal(signal.source, overrideMap);
      if (contentType === null) continue;
      candidates.push({ signal, contentType });
    }

    // Spec 63.5 + 64.1: diversity config + initial picked-set seeded from
    // Floor. We resolve embeddings for each Floor brief whose content type is
    // in DIVERSITY_FLOOR_CONTENT_TYPES (cluster, cluster_spoke, social_post)
    // — the Overage picker then sees them as "already picked" and penalises
    // near-dups. cluster_spoke must be in the seed set so a thematically
    // similar Overage signal isn't picked alongside a Floor spoke of the
    // same theme (e.g. ChatGPT-spoke at Floor + ChatGPT-trend at Overage).
    const diversityConfig = {
      threshold: snapshot.config.diversityThreshold ?? 0.5,
      malusWeight: snapshot.config.diversityMalusWeight ?? 0.5,
    };
    const briefById = new Map<string, TopicBrief>(briefs.map((b) => [b.id, b]));
    const floorDiversityBriefIds = floorItems
      .filter(
        (it) =>
          it.contentType === "cluster" ||
          it.contentType === "cluster_spoke" ||
          it.contentType === "social_post",
      )
      .map((it) => it.sourceBriefId)
      .filter((id): id is string => id !== null);

    const briefProvider = this.createBriefEmbeddingProvider({
      projectId: input.projectId,
      ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    });
    const signalProvider = this.createSignalEmbeddingProvider({
      projectId: input.projectId,
      ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    });

    // Pre-resolve the Floor-picked embeddings BEFORE picking. Voyage returns
    // the same vector deterministically for the same input text, so this is
    // a second Voyage hit per Floor brief; ~€0.001 per plan-run, accepted.
    const initialEmbeddings: (number[] | null)[] = [];
    for (const briefId of floorDiversityBriefIds) {
      const brief = briefById.get(briefId);
      if (!brief) continue;
      initialEmbeddings.push(await briefProvider.getForBrief(brief));
    }

    // Spec 63.5: diversity-aware Overage picking. We pick over the full
    // candidate list once (across all content types) and then emit
    // maxOveragePerSignal copies per picked signal — preserves existing
    // multi-emit behaviour, but the SIGNAL-level pick is now diversity-aware.
    const useDiversity = diversityConfig.malusWeight > 0 && candidates.length > 1;
    let pickedSignals: { signal: SignalTopNEntry; contentType: PlanningContentType; auditReason: string | null }[];
    if (useDiversity) {
      const picked = await pickWithDiversity<{ signal: SignalTopNEntry; contentType: PlanningContentType }>({
        pool: candidates,
        // Overage picks every eligible candidate (capped at length). The
        // diversity modifier only reorders + annotates — not a hard filter.
        target: candidates.length,
        embeddingProvider: {
          // Adapter from candidate → signal embedding.
          getForItem: (c) => signalProvider.getForItem(c.signal),
        },
        config: diversityConfig,
        getBaseScore: (c) => Math.max(0, Math.min(1, c.signal.normalizedScore)),
        getItemId: (c) => c.signal.signalId,
        initialPickedEmbeddings: initialEmbeddings,
      });
      pickedSignals = picked.picked.map((p, i) => ({
        signal: p.signal,
        contentType: p.contentType,
        auditReason: picked.reasons[i]?.reason ?? null,
      }));
    } else {
      pickedSignals = candidates.map((c) => ({
        signal: c.signal,
        contentType: c.contentType,
        auditReason: null,
      }));
    }

    const items: PlanningItemDraft[] = [];
    for (const { signal, contentType, auditReason } of pickedSignals) {
      // Spec 64.2: gate against per-content-type remaining capacity. `null`
      // = uncapped (no max_count goal); 0 = already at cap (skip emit). The
      // per-signal multi-emit (maxOveragePerSignal) is clamped so a single
      // signal can't blow past a tight cap.
      const remaining = remainingCapByCT.get(contentType);
      if (remaining === 0) {
        ctx.log.info(
          { contentType, signalId: signal.signalId, signalTitle: signal.title },
          "select-overage-items: skipped — content_type at max_count cap",
        );
        continue;
      }
      const emitCount =
        remaining === null || remaining === undefined
          ? config.maxOveragePerSignal
          : Math.min(config.maxOveragePerSignal, remaining);
      for (let i = 0; i < emitCount; i++) {
        const baseReason = `Top-${i + 1} signal: ${signal.title} (score ${signal.normalizedScore.toFixed(2)})`;
        const reason = auditReason ? `${baseReason} — ${auditReason}` : baseReason;
        items.push({
          draftId: randomUUID(),
          contentType,
          pipelineName: PIPELINE_NAME_BY_CONTENT_TYPE[contentType],
          sourceKind: "overage_signal",
          sourceBriefId: null,
          sourceSignalId: signal.signalId,
          parentDraftId: null,
          locale: null,
          pipelineInput: {
            signalId: signal.signalId,
            projectId: input.projectId,
            signalTitle: signal.title,
            // Mirror under `title` so the planner-card cascade
            // (pipelineInput.title → topicTitle → selectionReason) picks it up
            // without a special-cased branch for overage items.
            title: signal.title,
          },
          slotDate: null,
          selectionScore: signal.normalizedScore,
          selectionReason: reason,
          estimatedCostEur: null,
        });
      }
      // Decrement remaining capacity for this content_type so the next
      // picked signal of the same type sees the updated budget.
      if (remaining !== null && remaining !== undefined) {
        remainingCapByCT.set(contentType, remaining - emitCount);
      }
    }

    return { overageItems: items };
  }
}
