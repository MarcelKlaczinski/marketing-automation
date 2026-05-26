/**
 * Spec 65.5 §4.2 — `top_n_comparison` brief-generator (Family A).
 *
 * Data-driven "Top N tools in category X" comparison brief. No hook lookup —
 * Family A formats are list-based and rely on the template's slide layout.
 */
import { type Article, articles, db, inArray, logTemplateUsage } from "@marketing-auto/db";
import {
  type TopNComparisonConfig,
  topNComparisonConfigSchema,
} from "@marketing-auto/shared/format-types";
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

export async function generateTopNComparisonBrief(
  ctx: BriefGenContext,
): Promise<GeneratedBriefResult> {
  const config = topNComparisonConfigSchema.parse(ctx.config) satisfies TopNComparisonConfig;

  // 1. Pick tools (LLM-curated by default; manual override when set).
  const pickInput: Parameters<typeof pickToolsForBrief>[0] = {
    projectId: ctx.projectId,
    formatType: "top_n_comparison",
    locale: ctx.language,
    config: {
      topN: config.topN,
      excludeRecentlyUsed: config.excludeRecentlyUsed,
      ...(config.manualToolIds && { manualToolIds: config.manualToolIds }),
      ...(config.categorySlug && { categorySlug: config.categorySlug }),
    },
  };
  if (ctx.previousRunToolIds) pickInput.previousRunToolIds = ctx.previousRunToolIds;
  if (ctx.pipelineRunId !== undefined) pickInput.pipelineRunId = ctx.pipelineRunId;
  const picked = await pickToolsForBrief(pickInput);
  if (picked.toolIds.length < config.topN) {
    return {
      status: "skipped",
      reason: "insufficient-tools",
      detail: `Pool produced ${picked.toolIds.length} tools, need ${config.topN}`,
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

  // 4. Select template (3-Layer).
  const templateInput: Parameters<typeof selectTemplateForRecurringBrief>[0] = {
    definition: ctx.definition,
    briefContext: {
      toolNames: resolvedTools.map((t) => t.name),
      angle: "comparison",
      ...(config.categorySlug && { persona: config.categorySlug }),
    },
  };
  if (ctx.pipelineRunId !== undefined) templateInput.pipelineRunId = ctx.pipelineRunId;
  const selectedTemplate = await selectTemplateForRecurringBrief(templateInput);

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
  });

  return {
    status: "persisted",
    brief: persisted,
    toolIds: picked.toolIds,
    templateKey: selectedTemplate.templateKey,
  };
}
