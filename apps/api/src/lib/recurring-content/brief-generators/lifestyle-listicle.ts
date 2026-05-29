/**
 * Spec 65.5 §4.5 — `lifestyle_listicle` brief-generator (Family B).
 *
 * Hook-driven life-area listicle ("5 Wege wie {tool} deinen {lifeArea}
 * verändert"). Multi-tool pool — `pickToolsForBrief` runs LLM-curate over a
 * category-filtered candidate set, then the hook-picker decorates the brief.
 */
import { type Article, articles, db, inArray, logTemplateUsage } from "@marketing-auto/db";
import {
  type LifestyleListicleConfig,
  lifestyleListicleConfigSchema,
} from "@marketing-auto/shared/format-types";
import { derivePainPoint } from "../../hook-library/derive-pain-point.ts";
import { pickHook } from "../../hook-library/pick-hook.ts";
import { renderHook } from "../../hook-library/render-hook.ts";
import { buildBriefText } from "./shared/brief-text.ts";
import {
  BrandAssetsMissingError,
  ensureBrandAssetsAvailable,
} from "./shared/check-brand-assets.ts";
import { buildDryRunPreview } from "./shared/dry-run-preview.ts";
import { pickToolsForBrief } from "./shared/pick-tools.ts";
import { persistRecurringBrief } from "./shared/persist-brief.ts";
import { resolveFeaturedTool } from "./shared/resolve-featured-tool.ts";
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

export async function generateLifestyleListicleBrief(
  ctx: BriefGenContext,
): Promise<GeneratedBriefResult> {
  const config = lifestyleListicleConfigSchema.parse(
    ctx.config,
  ) satisfies LifestyleListicleConfig;

  // 1. Tool-pick — multi-tool, optional category + persona filter.
  const pickConfig: Parameters<typeof pickToolsForBrief>[0]["config"] = {
    topN: config.itemCount,
    excludeRecentlyUsed: true,
  };
  // `toolFilter.categorySlugs` is a multi-category filter; the
  // current pickToolsForBrief accepts a single `categorySlug` — use the
  // first entry when set, leave open otherwise. Multi-category support is
  // a future enhancement (would need a new IN-array helper).
  if (config.toolFilter?.categorySlugs?.[0]) {
    pickConfig.categorySlug = config.toolFilter.categorySlugs[0];
  }
  if (config.toolFilter?.personaFilter) {
    pickConfig.persona = config.toolFilter.personaFilter;
  }
  const pickInput: Parameters<typeof pickToolsForBrief>[0] = {
    projectId: ctx.projectId,
    formatType: "lifestyle_listicle",
    locale: ctx.language,
    config: pickConfig,
  };
  if (ctx.previousRunToolIds) pickInput.previousRunToolIds = ctx.previousRunToolIds;
  if (ctx.pipelineRunId !== undefined) pickInput.pipelineRunId = ctx.pipelineRunId;
  const picked = await pickToolsForBrief(pickInput);
  if (picked.toolIds.length < config.itemCount) {
    return {
      status: "skipped",
      reason: "insufficient-tools",
      detail: `Pool produced ${picked.toolIds.length} tools, need ${config.itemCount}`,
    };
  }

  // 2. Pre-flight brand-assets.
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

  const toolRows = await db
    .select()
    .from(articles)
    .where(inArray(articles.id, picked.toolIds));
  const byId = new Map(toolRows.map((t: Article) => [t.id, t] as const));
  const orderedTools = picked.toolIds
    .map((id) => byId.get(id))
    .filter((t): t is Article => t !== undefined);
  const resolvedTools = orderedTools.map(articleToResolvedTool);
  const firstTool = resolvedTools[0];
  if (!firstTool) {
    return { status: "skipped", reason: "insufficient-tools", detail: "Empty resolvedTools" };
  }

  // 3. Hook-pick. Spec 65.14: outputTargets + briefTopic + competitorTool
  //    context, picker pre-filters by drama-intensity allow-list.
  const briefTopic = `${config.itemCount}-item ${config.lifeArea} listicle featuring ${resolvedTools
    .slice(0, 3)
    .map((t) => t.name)
    .join(", ")}${resolvedTools.length > 3 ? " and others" : ""}`;
  const hookInput: Parameters<typeof pickHook>[0] = {
    projectId: ctx.projectId,
    formatType: "lifestyle_listicle",
    language: ctx.language,
    outputTargets: ctx.definition.outputTargets,
    contentContext: {
      toolNames: resolvedTools.map((t) => t.name),
      lifeArea: config.lifeArea,
      briefTopic,
      ...(config.toolFilter?.personaFilter && { narrativeIntent: config.toolFilter.personaFilter }),
      ...(config.competitorTool && { competitorTool: config.competitorTool }),
    },
  };
  if (ctx.pipelineRunId !== undefined) hookInput.pipelineRunId = ctx.pipelineRunId;
  const picked2 = await pickHook(hookInput);
  if (!picked2) {
    return {
      status: "skipped",
      reason: "no-hook",
      detail: `No hooks available for (lifestyle_listicle, ${ctx.language}) in project ${ctx.projectId}`,
    };
  }

  // The lifestyle hook canonically substitutes {tool} + {lifeArea} +
  // optionally {persona}. We pass the head-tool name as `tool` — Marcel can
  // edit pre-render if a different tool should anchor the hook.
  // Spec 65.14: variable-pool extension — n/k from itemCount, painPoint via
  // LLM-derive when the picked pattern needs it, established from config.
  const itemCount = config.itemCount;
  const renderVars: Record<string, string> = {
    tool: firstTool.name,
    lifeArea: config.lifeArea,
    persona: config.toolFilter?.personaFilter ?? "Solopreneur",
    n: String(itemCount),
    k: String(Math.max(1, Math.floor(itemCount / 2))),
  };
  if (picked2.variables.includes("painPoint")) {
    const derived = await derivePainPoint({
      projectId: ctx.projectId,
      language: ctx.language,
      toolNames: resolvedTools.map((t) => t.name),
      briefTopic,
      ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    });
    renderVars.painPoint = derived.painPoint;
  }
  if (picked2.variables.includes("established") && config.competitorTool) {
    renderVars.established = config.competitorTool;
  }
  const renderedHook = renderHook(picked2.pattern, renderVars);
  const hookData = {
    hookId: picked2.hookId,
    pattern: picked2.pattern,
    rendered: renderedHook,
  };

  // 4. Template selection.
  const templateInput: Parameters<typeof selectTemplateForRecurringBrief>[0] = {
    definition: ctx.definition,
    briefContext: {
      toolNames: resolvedTools.map((t) => t.name),
      angle: `${config.lifeArea}-listicle`,
      ...(config.toolFilter?.personaFilter && { persona: config.toolFilter.personaFilter }),
    },
  };
  if (ctx.pipelineRunId !== undefined) templateInput.pipelineRunId = ctx.pipelineRunId;
  const selectedTemplate = await selectTemplateForRecurringBrief(templateInput);

  // 4a. Select end-slide (Spec 65.9). Skip cleanly on no-eligible-end-slides.
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

  // 5. Brief text.
  const formatNarrative = `${config.itemCount}-item lifestyle listicle for "${config.lifeArea}" featuring multiple AI tools.`;
  const contextBlock = [
    `Picked hook (rendered): ${renderedHook}`,
    `Life area: ${config.lifeArea}`,
    `Tools selected (${resolvedTools.length}):`,
    ...resolvedTools.map(
      (t, i) =>
        `${i + 1}. ${t.name}${t.subcategory ? ` (${t.subcategory})` : ""}${
          t.pricing ? ` — ${t.pricing}` : ""
        }`,
    ),
    "",
    `Pick reasoning: ${picked.reasoning}`,
  ].join("\n");
  const brief = await buildBriefText({
    projectId: ctx.projectId,
    formatType: "lifestyle_listicle",
    formatNarrative,
    contextBlock,
    locale: ctx.language,
    ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
  });

  // 6. Dry-run short-circuit (Spec 65.11).
  if (ctx.dryRun) {
    return buildDryRunPreview({
      toolIds: picked.toolIds,
      selectedTemplate,
      selectedEndSlide,
      brief: { topicTitle: brief.topicTitle, briefText: brief.briefText },
      hookData,
    });
  }

  // 7. Log + persist.
  await logTemplateUsage({
    recurringDefinitionId: ctx.definition.id,
    templateKey: selectedTemplate.templateKey,
    endSlideType: selectedEndSlide.endSlideType,
  });

  // V1.6.1 — resolve `featuredTool` payload at persist time so the template's
  // `buildInput()` never needs a runtime DB lookup. Best-effort: null fall-
  // through delegates to the template-side lazy resolver (defense in depth).
  const featuredToolPayload = await resolveFeaturedTool(firstTool.id);

  const persisted = await persistRecurringBrief({
    projectId: ctx.projectId,
    definition: ctx.definition,
    briefText: brief.briefText,
    topicTitle: brief.topicTitle,
    toolIds: picked.toolIds,
    locale: ctx.language,
    selectedTemplate,
    selectedEndSlide,
    hookData,
    runNumber: ctx.runNumber,
    ...(ctx.previousRunToolIds && { previousToolIds: ctx.previousRunToolIds }),
    // Bridge #3 multi-locale sibling-linking — only stamped when the worker
    // is fanning out to multiple locales.
    ...(ctx.runGroupId && { runGroupId: ctx.runGroupId }),
    // Spec 65.V1.5b — worker-resolved auto-approve flag.
    autoApprove: ctx.autoApprove ?? false,
    // V1.6.1 — pre-resolve featuredTool so the template-side fallback path
    // (article.title) never fires for fresh briefs.
    ...(featuredToolPayload && {
      singleTool: { key: "featuredTool" as const, payload: featuredToolPayload },
    }),
  });

  return {
    status: "persisted",
    brief: persisted,
    toolIds: picked.toolIds,
    templateKey: selectedTemplate.templateKey,
    hookData,
  };
}
