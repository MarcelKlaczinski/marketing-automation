/**
 * Spec 65.5 §4.3 — `head_to_head` brief-generator (Family A).
 *
 * Two-tool comparison brief. Tools are explicit in `format_config`
 * (toolAId + toolBId) — no LLM tool-curation. The brief-text prompt asks
 * for a differentiation angle based on rating/pricing/category overlap.
 */
import { type Article, and, articles, db, eq, inArray, logTemplateUsage } from "@marketing-auto/db";
import {
  type HeadToHeadConfig,
  headToHeadConfigSchema,
} from "@marketing-auto/shared/format-types";
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

export async function generateHeadToHeadBrief(
  ctx: BriefGenContext,
): Promise<GeneratedBriefResult> {
  const config = headToHeadConfigSchema.parse(ctx.config) satisfies HeadToHeadConfig;

  const toolIds = [config.toolAId, config.toolBId];

  // 1. Verify the two tools exist + match project. The project filter is in
  //    the SELECT so a definition with a cross-tenant or deleted UUID
  //    simply produces an empty/short result set — no in-memory cross-tenant
  //    guard needed.
  const rows = await db
    .select()
    .from(articles)
    .where(and(inArray(articles.id, toolIds), eq(articles.projectId, ctx.projectId)));
  const byId = new Map(rows.map((t: Article) => [t.id, t] as const));
  if (!toolIds.every((id) => byId.has(id))) {
    return {
      status: "skipped",
      reason: "insufficient-tools",
      detail: `One or both head-to-head tool IDs not found in project (toolAId=${config.toolAId}, toolBId=${config.toolBId})`,
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

  const orderedTools = toolIds
    .map((id) => byId.get(id))
    .filter((t): t is Article => t !== undefined);
  const resolvedTools = orderedTools.map(articleToResolvedTool);

  // 3. Template selection.
  const templateInput: Parameters<typeof selectTemplateForRecurringBrief>[0] = {
    definition: ctx.definition,
    briefContext: {
      toolNames: resolvedTools.map((t) => t.name),
      ...(config.angleHint && { angle: config.angleHint }),
    },
  };
  if (ctx.pipelineRunId !== undefined) templateInput.pipelineRunId = ctx.pipelineRunId;
  const selectedTemplate = await selectTemplateForRecurringBrief(templateInput);

  // 4. Brief text.
  const [a, b] = resolvedTools;
  if (!a || !b) {
    // Type narrowing — verified above by `valid` check.
    return { status: "skipped", reason: "insufficient-tools", detail: "Unexpected null tool row" };
  }
  const formatNarrative = `Direct head-to-head comparison: ${a.name} vs ${b.name}.${
    config.angleHint ? ` Differentiation angle: ${config.angleHint}.` : ""
  }`;
  const contextBlock = [
    `Tool A: ${a.name}${a.subcategory ? ` (${a.subcategory})` : ""}${
      a.rating ? ` — rating ${a.rating}` : ""
    }${a.pricing ? ` — pricing ${a.pricing}` : ""}`,
    `Tool B: ${b.name}${b.subcategory ? ` (${b.subcategory})` : ""}${
      b.rating ? ` — rating ${b.rating}` : ""
    }${b.pricing ? ` — pricing ${b.pricing}` : ""}`,
  ].join("\n");
  const brief = await buildBriefText({
    projectId: ctx.projectId,
    formatType: "head_to_head",
    formatNarrative,
    contextBlock,
    locale: ctx.language,
    ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
  });

  // 5. Log template usage + persist.
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
    runNumber: ctx.runNumber,
    ...(ctx.previousRunToolIds && { previousToolIds: ctx.previousRunToolIds }),
  });

  return {
    status: "persisted",
    brief: persisted,
    toolIds,
    templateKey: selectedTemplate.templateKey,
  };
}
