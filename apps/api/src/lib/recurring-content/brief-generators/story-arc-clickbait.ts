/**
 * Spec 65.5 §4.4 — `story_arc_clickbait` brief-generator (Family B).
 *
 * Hook-driven narrative-arc brief ("I lost my {profession} job to {tool}").
 * The brief-text prompt incorporates the picked hook + narrative angle so
 * the downstream content-generator opens the carousel with the right tone.
 */
import { and, articles, db, eq, logTemplateUsage } from "@marketing-auto/db";
import {
  type StoryArcClickbaitConfig,
  storyArcClickbaitConfigSchema,
} from "@marketing-auto/shared/format-types";
import { pickHook } from "../../hook-library/pick-hook.ts";
import { renderHook } from "../../hook-library/render-hook.ts";
import { buildBriefText } from "./shared/brief-text.ts";
import {
  BrandAssetsMissingError,
  ensureBrandAssetsAvailable,
} from "./shared/check-brand-assets.ts";
import { buildDryRunPreview } from "./shared/dry-run-preview.ts";
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

/** Deterministic per-run profession choice — rotates through the pool. */
function pickProfession(pool: string[], runNumber: number): string {
  if (pool.length === 0) {
    throw new Error("storyArcClickbait: professionPool is empty (Zod schema requires .min(1))");
  }
  return pool[runNumber % pool.length] as string;
}

export async function generateStoryArcClickbaitBrief(
  ctx: BriefGenContext,
): Promise<GeneratedBriefResult> {
  const config = storyArcClickbaitConfigSchema.parse(ctx.config) satisfies StoryArcClickbaitConfig;

  const toolIds = [config.toolToFeature];

  // 1. Verify the tool exists + matches project. Project filter is in the
  //    SELECT so a cross-tenant / stale UUID returns an empty rowset.
  const rows = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, config.toolToFeature), eq(articles.projectId, ctx.projectId)));
  const tool = rows[0];
  if (!tool) {
    return {
      status: "skipped",
      reason: "insufficient-tools",
      detail: `toolToFeature ${config.toolToFeature} not found in project ${ctx.projectId}`,
    };
  }

  // 2. Pre-flight brand-assets.
  try {
    await ensureBrandAssetsAvailable({ toolIds });
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

  // 3. Hook-pick (Family B — definition.needsHooks=true).
  const profession = pickProfession(config.professionPool, ctx.runNumber);
  const resolvedTool = articleToResolvedTool(tool);
  const hookInput: Parameters<typeof pickHook>[0] = {
    projectId: ctx.projectId,
    formatType: "story_arc_clickbait",
    language: ctx.language,
    contentContext: {
      toolNames: [resolvedTool.name],
      professionPool: config.professionPool,
      narrativeIntent: config.narrativeAngle,
    },
  };
  if (ctx.pipelineRunId !== undefined) hookInput.pipelineRunId = ctx.pipelineRunId;
  const picked = await pickHook(hookInput);
  if (!picked) {
    return {
      status: "skipped",
      reason: "no-hook",
      detail: `No hooks available for (story_arc_clickbait, ${ctx.language}) in project ${ctx.projectId}`,
    };
  }

  // 4. Render hook with substituted variables.
  const rendered = renderHook(picked.pattern, {
    profession,
    tool: resolvedTool.name,
  });
  const hookData = {
    hookId: picked.hookId,
    pattern: picked.pattern,
    rendered,
  };

  // 5. Template-select.
  const templateInput: Parameters<typeof selectTemplateForRecurringBrief>[0] = {
    definition: ctx.definition,
    briefContext: {
      toolNames: [resolvedTool.name],
      angle: config.narrativeAngle,
      persona: profession,
    },
  };
  if (ctx.pipelineRunId !== undefined) templateInput.pipelineRunId = ctx.pipelineRunId;
  const selectedTemplate = await selectTemplateForRecurringBrief(templateInput);

  // 5a. Select end-slide (Spec 65.9). Skip cleanly on no-eligible-end-slides.
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

  // 6. Brief text — incorporates hook + narrative-angle framing.
  const formatNarrative = `Hook-driven narrative arc: ${config.narrativeAngle}, ${config.toneIntensity} tone, featuring ${resolvedTool.name} and the profession "${profession}".`;
  const contextBlock = [
    `Picked hook (rendered): ${rendered}`,
    `Hook pattern source: ${picked.pattern}`,
    `Tool: ${resolvedTool.name}${resolvedTool.subcategory ? ` (${resolvedTool.subcategory})` : ""}`,
    `Profession (rotation #${ctx.runNumber}): ${profession}`,
    `Narrative angle: ${config.narrativeAngle}`,
    `Tone intensity: ${config.toneIntensity}`,
  ].join("\n");
  const brief = await buildBriefText({
    projectId: ctx.projectId,
    formatType: "story_arc_clickbait",
    formatNarrative,
    contextBlock,
    locale: ctx.language,
    ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
  });

  // 7. Dry-run short-circuit (Spec 65.11).
  if (ctx.dryRun) {
    return buildDryRunPreview({
      toolIds,
      selectedTemplate,
      selectedEndSlide,
      brief: { topicTitle: brief.topicTitle, briefText: brief.briefText },
      hookData,
    });
  }

  // 8. Log template usage + persist with hookData.
  await logTemplateUsage({
    recurringDefinitionId: ctx.definition.id,
    templateKey: selectedTemplate.templateKey,
    endSlideType: selectedEndSlide.endSlideType,
  });

  const persisted = await persistRecurringBrief({
    projectId: ctx.projectId,
    definition: ctx.definition,
    briefText: brief.briefText,
    topicTitle: brief.topicTitle,
    toolIds,
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
  });

  return {
    status: "persisted",
    brief: persisted,
    toolIds,
    templateKey: selectedTemplate.templateKey,
    hookData,
  };
}
