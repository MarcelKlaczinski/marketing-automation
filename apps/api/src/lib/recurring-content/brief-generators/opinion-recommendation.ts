/**
 * Spec 65.5 §4.6 — `opinion_recommendation` brief-generator (Family B).
 *
 * Single-tool opinion piece. The brief-text prompt asks for an advocacy /
 * critical-but-positive / contrarian framing per `opinionStance`. When
 * `affiliateAngle=true` the prompt emphasises pricing + value-prop language.
 */
import { and, articles, db, eq, logTemplateUsage } from "@marketing-auto/db";
import {
  type OpinionRecommendationConfig,
  opinionRecommendationConfigSchema,
} from "@marketing-auto/shared/format-types";
import { pickHook } from "../../hook-library/pick-hook.ts";
import { renderHook } from "../../hook-library/render-hook.ts";
import { buildBriefText } from "./shared/brief-text.ts";
import {
  BrandAssetsMissingError,
  ensureBrandAssetsAvailable,
} from "./shared/check-brand-assets.ts";
import { persistRecurringBrief } from "./shared/persist-brief.ts";
import { selectTemplateForRecurringBrief } from "./shared/select-template.ts";
import {
  articleToResolvedTool,
  type BriefGenContext,
  type GeneratedBriefResult,
} from "./shared/types.ts";

export async function generateOpinionRecommendationBrief(
  ctx: BriefGenContext,
): Promise<GeneratedBriefResult> {
  const config = opinionRecommendationConfigSchema.parse(
    ctx.config,
  ) satisfies OpinionRecommendationConfig;

  const toolIds = [config.recommendedToolId];

  // 1. Verify the recommended tool exists + matches project. Project filter
  //    is in the SELECT so a cross-tenant / stale UUID returns empty.
  const rows = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, config.recommendedToolId), eq(articles.projectId, ctx.projectId)));
  const tool = rows[0];
  if (!tool) {
    return {
      status: "skipped",
      reason: "insufficient-tools",
      detail: `recommendedToolId ${config.recommendedToolId} not found in project ${ctx.projectId}`,
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

  const resolvedTool = articleToResolvedTool(tool);

  // 3. Hook-pick.
  const hookInput: Parameters<typeof pickHook>[0] = {
    projectId: ctx.projectId,
    formatType: "opinion_recommendation",
    language: ctx.language,
    contentContext: {
      toolNames: [resolvedTool.name],
      narrativeIntent: `${config.opinionStance}${config.affiliateAngle ? "-affiliate" : ""}`,
    },
  };
  if (ctx.pipelineRunId !== undefined) hookInput.pipelineRunId = ctx.pipelineRunId;
  const picked = await pickHook(hookInput);
  if (!picked) {
    return {
      status: "skipped",
      reason: "no-hook",
      detail: `No hooks available for (opinion_recommendation, ${ctx.language}) in project ${ctx.projectId}`,
    };
  }

  // Opinion hooks substitute only {tool}. Pass extra vars defensively in
  // case a custom pattern uses {tool}+{stance}.
  const rendered = renderHook(picked.pattern, {
    tool: resolvedTool.name,
    stance: config.opinionStance,
  });
  const hookData = { hookId: picked.hookId, pattern: picked.pattern, rendered };

  // 4. Template selection.
  const templateInput: Parameters<typeof selectTemplateForRecurringBrief>[0] = {
    definition: ctx.definition,
    briefContext: {
      toolNames: [resolvedTool.name],
      angle: `${config.opinionStance}-opinion`,
    },
  };
  if (ctx.pipelineRunId !== undefined) templateInput.pipelineRunId = ctx.pipelineRunId;
  const selectedTemplate = await selectTemplateForRecurringBrief(templateInput);

  // 5. Brief text.
  const stanceLabel: Record<OpinionRecommendationConfig["opinionStance"], string> = {
    enthusiastic: "straightforward advocacy",
    "critical-but-positive": "flaws + still worth it framing",
    contrarian: "contrarian (everyone else says X, but actually Y) framing",
  };
  const formatNarrative = `Single-tool opinion piece — ${stanceLabel[config.opinionStance]}${
    config.affiliateAngle ? ", strong pricing/value-prop emphasis" : ""
  }, featuring ${resolvedTool.name}.`;
  const contextBlock = [
    `Picked hook (rendered): ${rendered}`,
    `Tool: ${resolvedTool.name}${resolvedTool.subcategory ? ` (${resolvedTool.subcategory})` : ""}`,
    `Stance: ${config.opinionStance}`,
    `Affiliate angle: ${config.affiliateAngle ? "ON — emphasise pricing + value-prop" : "OFF — keep value-prop only, no price anchors"}`,
    `Pricing context: ${resolvedTool.pricing ?? "(unknown)"}${
      resolvedTool.priceFrom ? `, from ${resolvedTool.priceFrom}` : ""
    }`,
  ].join("\n");
  const brief = await buildBriefText({
    projectId: ctx.projectId,
    formatType: "opinion_recommendation",
    formatNarrative,
    contextBlock,
    locale: ctx.language,
    ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
  });

  // 6. Log + persist.
  await logTemplateUsage({
    recurringDefinitionId: ctx.definition.id,
    templateKey: selectedTemplate.templateKey,
  });

  const persisted = await persistRecurringBrief({
    projectId: ctx.projectId,
    definition: ctx.definition,
    briefText: brief.briefText,
    topicTitle: brief.topicTitle,
    toolIds,
    locale: ctx.language,
    selectedTemplate,
    hookData,
    runNumber: ctx.runNumber,
    ...(ctx.previousRunToolIds && { previousToolIds: ctx.previousRunToolIds }),
  });

  return {
    status: "persisted",
    brief: persisted,
    toolIds,
    templateKey: selectedTemplate.templateKey,
    hookData,
  };
}
