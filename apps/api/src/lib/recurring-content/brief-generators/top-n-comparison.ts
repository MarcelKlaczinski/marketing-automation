/**
 * Spec 65.5 §4.2 — `top_n_comparison` brief-generator (Family A).
 *
 * Data-driven "Top N tools in category X" comparison brief. No hook lookup —
 * Family A formats are list-based and rely on the template's slide layout.
 */
import {
  type Article,
  articles,
  db,
  inArray,
  logTemplateUsage,
  sql,
  toolPersonaScores,
} from "@marketing-auto/db";
import {
  type TopNComparisonConfig,
  topNComparisonConfigSchema,
} from "@marketing-auto/shared/format-types";
import { createLogger } from "@marketing-auto/shared";
import { deriveTiers, type TieredTool } from "../derive-tiers.ts";
import { buildBriefText } from "./shared/brief-text.ts";
import {
  BrandAssetsMissingError,
  ensureBrandAssetsAvailable,
} from "./shared/check-brand-assets.ts";
import { buildDryRunPreview } from "./shared/dry-run-preview.ts";
import { pickToolsForBrief } from "./shared/pick-tools.ts";
import { persistRecurringBrief } from "./shared/persist-brief.ts";
import {
  NoEligibleEndSlidesError,
  selectEndSlideForRecurringBrief,
} from "./shared/select-end-slide.ts";
import { selectTemplateForRecurringBrief } from "./shared/select-template.ts";
import {
  articleToResolvedTool,
  type BriefGenContext,
  type GeneratedBriefResult,
} from "./shared/types.ts";

const log = createLogger("recurring-content:top-n-comparison");

/**
 * Spec 65.17 B5 — tool-tier-ranking template key (mirrors Spec 65.cleanup
 * ShippedTemplateKey). Hardcoded literal so the routing is grep-able and
 * doesn't drift if the registry changes.
 */
const TIER_RANKING_TEMPLATE_KEY = "tool-tier-ranking";

/**
 * Compute the aggregate persona-score per tool — mean across ALL personas,
 * rounded to the nearest integer in the 0–10 range.
 * Marcel-decision Q8 (Discovery §3.3): V1.6 uses aggregate scoring; per-persona
 * tiers are deferred to V2.
 */
async function computeAggregatePersonaScores(
  toolIds: string[],
): Promise<Map<string, number>> {
  if (toolIds.length === 0) return new Map();
  // ROUND(...,0)::int collapses SQL+JS rounding into one pass — `deriveTiers`
  // expects integer 0–10 scores; the intermediate decimal form had no callers.
  const rows = await db
    .select({
      toolId: toolPersonaScores.toolId,
      avgScore: sql<number>`ROUND(AVG(${toolPersonaScores.score})::numeric, 0)::int`,
    })
    .from(toolPersonaScores)
    .where(inArray(toolPersonaScores.toolId, toolIds))
    .groupBy(toolPersonaScores.toolId);
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.toolId, r.avgScore);
  }
  return map;
}

export async function generateTopNComparisonBrief(
  ctx: BriefGenContext,
): Promise<GeneratedBriefResult> {
  const config = topNComparisonConfigSchema.parse(ctx.config) satisfies TopNComparisonConfig;

  // Spec 65.17 B5 — tier-mode gates the candidate pool to tools with
  // `tool_persona_scores` AND forces routing to the `tool-tier-ranking`
  // template. The `topN` is clamped to 3-5 (Marcel-decision Q7) before pick.
  const tierModeRequested = config.tierMode === true;
  const effectiveTopN = tierModeRequested ? Math.min(Math.max(config.topN, 3), 5) : config.topN;
  if (tierModeRequested && effectiveTopN !== config.topN) {
    log.info(
      { projectId: ctx.projectId, requested: config.topN, clamped: effectiveTopN },
      "tier-mode clamps topN to the 3-5 tercile range (Marcel Q7)",
    );
  }

  // 1. Pick tools (LLM-curated by default; manual override when set).
  const pickInput: Parameters<typeof pickToolsForBrief>[0] = {
    projectId: ctx.projectId,
    formatType: "top_n_comparison",
    locale: ctx.language,
    config: {
      topN: effectiveTopN,
      excludeRecentlyUsed: config.excludeRecentlyUsed,
      ...(config.manualToolIds && { manualToolIds: config.manualToolIds }),
      ...(config.categorySlug && { categorySlug: config.categorySlug }),
      // Spec 65.17 B5 — pre-filter pool to scored tools so tier-derivation
      // never lands on a tool without persona-data.
      ...(tierModeRequested && { requirePersonaScores: true }),
    },
  };
  if (ctx.previousRunToolIds) pickInput.previousRunToolIds = ctx.previousRunToolIds;
  if (ctx.pipelineRunId !== undefined) pickInput.pipelineRunId = ctx.pipelineRunId;
  const picked = await pickToolsForBrief(pickInput);
  if (picked.toolIds.length < effectiveTopN) {
    return {
      status: "skipped",
      reason: "insufficient-tools",
      detail: `Pool produced ${picked.toolIds.length} tools, need ${effectiveTopN}${
        tierModeRequested ? " (tier-mode requires persona-scored + logo-having tools)" : ""
      }`,
    };
  }

  // 2. Pre-flight brand-assets gate.
  try {
    await ensureBrandAssetsAvailable({ toolIds: picked.toolIds });
  } catch (err) {
    if (err instanceof BrandAssetsMissingError) {
      return {
        status: "skipped",
        reason: "brand-assets-missing",
        missingToolIds: err.missingToolIds,
      };
    }
    throw err;
  }

  // 3. Load full tool rows for the brief-text prompt + template-selection context.
  const toolRows = await db
    .select()
    .from(articles)
    .where(inArray(articles.id, picked.toolIds));
  // Preserve the LLM/manual order — `inArray` doesn't.
  const byId = new Map(toolRows.map((t: Article) => [t.id, t]));
  const orderedTools = picked.toolIds
    .map((id) => byId.get(id))
    .filter((t): t is Article => t !== undefined);
  const resolvedTools = orderedTools.map(articleToResolvedTool);

  // 3a. Spec 65.17 B5 — derive tiers when tier-mode requested. Computes
  //     aggregate persona-scores (mean across personas), runs tercile-ranking
  //     via `deriveTiers`. Skips with notify when the picked pool can't be
  //     fully scored (defensive against tools that lost their score rows
  //     between the SQL pre-filter and this fetch — narrow race window).
  let tieredAssignment: TieredTool[] | null = null;
  if (tierModeRequested) {
    const scoresMap = await computeAggregatePersonaScores(picked.toolIds);
    const missing = picked.toolIds.filter((id) => !scoresMap.has(id));
    if (missing.length > 0) {
      return {
        status: "skipped",
        reason: "insufficient-tools",
        detail: `tier-mode: ${missing.length}/${picked.toolIds.length} tools missing persona-scores after pre-filter (race with score deletion?)`,
      };
    }
    const scoredInput = picked.toolIds.map((toolId) => ({
      toolId,
      score: scoresMap.get(toolId) ?? 0,
    }));
    tieredAssignment = deriveTiers(scoredInput);
  }

  // 4. Select template (3-Layer). Tier-mode overrides the 3-Layer selection
  //    with a fixed routing to `tool-tier-ranking` (Spec 65.17 B5) — the
  //    template is structurally derived from the tier-data, not curated.
  let selectedTemplate: Awaited<ReturnType<typeof selectTemplateForRecurringBrief>>;
  if (tierModeRequested) {
    selectedTemplate = {
      templateKey: TIER_RANKING_TEMPLATE_KEY,
      selectedVia: "fixed",
      reasoning: "Spec 65.17 B5 — tier-mode forces tool-tier-ranking template",
    };
  } else {
    const templateInput: Parameters<typeof selectTemplateForRecurringBrief>[0] = {
      definition: ctx.definition,
      briefContext: {
        toolNames: resolvedTools.map((t) => t.name),
        angle: "comparison",
        ...(config.categorySlug && { persona: config.categorySlug }),
      },
    };
    if (ctx.pipelineRunId !== undefined) templateInput.pipelineRunId = ctx.pipelineRunId;
    selectedTemplate = await selectTemplateForRecurringBrief(templateInput);
  }

  // 4a. Select end-slide (Spec 65.9) — independent of template choice; reads
  //     definition.endSlidePool first, falls back to format-type defaults.
  //     Throws NoEligibleEndSlidesError when the project hasn't seeded any
  //     active end_slide_definitions matching the format-type defaults —
  //     surface as a skip so the worker advances next_run_at and Marcel gets
  //     a notification instead of an infinite-retry loop.
  let selectedEndSlide: Awaited<ReturnType<typeof selectEndSlideForRecurringBrief>>;
  try {
    selectedEndSlide = await selectEndSlideForRecurringBrief({
      definition: ctx.definition,
      projectId: ctx.projectId,
    });
  } catch (err) {
    if (err instanceof NoEligibleEndSlidesError) {
      return {
        status: "skipped",
        reason: "no-end-slide-eligible",
        detail: err.message,
      };
    }
    throw err;
  }

  // 5. Build brief text.
  const formatNarrative = `Top ${config.topN} tools in the "${config.categorySlug ?? "general AI"}" category.`;
  const contextBlock = [
    `Tools selected (in display order):`,
    ...resolvedTools.map(
      (t, i) =>
        `${i + 1}. ${t.name}${t.subcategory ? ` (${t.subcategory})` : ""}${
          t.rating ? ` — rating ${t.rating}` : ""
        }${t.pricing ? ` — pricing ${t.pricing}` : ""}`,
    ),
    "",
    `Pick reasoning: ${picked.reasoning}`,
  ].join("\n");
  const brief = await buildBriefText({
    projectId: ctx.projectId,
    formatType: "top_n_comparison",
    formatNarrative,
    contextBlock,
    locale: ctx.language,
    ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
  });

  // 6. Dry-run short-circuit (Spec 65.11) — every LLM call already ran;
  //    skip LRU bookkeeping + persist + return preview.
  if (ctx.dryRun) {
    return buildDryRunPreview({
      toolIds: picked.toolIds,
      selectedTemplate,
      selectedEndSlide,
      brief: { topicTitle: brief.topicTitle, briefText: brief.briefText },
    });
  }

  // 7. Log template usage (LRU bookkeeping) — fire-and-forget pattern is
  //    fine; missing log entries degrade gracefully to FIFO order.
  await logTemplateUsage({
    recurringDefinitionId: ctx.definition.id,
    templateKey: selectedTemplate.templateKey,
    endSlideType: selectedEndSlide.endSlideType,
  });

  // 8. Persist.
  const persisted = await persistRecurringBrief({
    projectId: ctx.projectId,
    definition: ctx.definition,
    briefText: brief.briefText,
    topicTitle: brief.topicTitle,
    toolIds: picked.toolIds,
    locale: ctx.language,
    selectedTemplate,
    selectedEndSlide,
    runNumber: ctx.runNumber,
    ...(ctx.previousRunToolIds && { previousToolIds: ctx.previousRunToolIds }),
    // Bridge #3 multi-locale sibling-linking — only stamped when the worker
    // is fanning out to multiple locales.
    ...(ctx.runGroupId && { runGroupId: ctx.runGroupId }),
    // Spec 65.V1.5b — worker-resolved auto-approve flag. Default false so a
    // missing field falls through to plan_pending (V1 behaviour).
    autoApprove: ctx.autoApprove ?? false,
    // Spec 65.17 B5 — frozen tier-assignment; consumed by the planner-router
    // when the recurring brief lands in a plan as a `tool-tier-ranking`
    // social_post.
    ...(tieredAssignment && {
      tierData: tieredAssignment.map((t) => ({ toolId: t.toolId, tier: t.tier })),
    }),
  });

  return {
    status: "persisted",
    brief: persisted,
    toolIds: picked.toolIds,
    templateKey: selectedTemplate.templateKey,
  };
}
