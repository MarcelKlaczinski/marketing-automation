/**
 * Spec 65.11 — Shared dry-run preview builder.
 *
 * Each of the 5 brief-generators short-circuits before `logTemplateUsage` /
 * `persistRecurringBrief` when `ctx.dryRun === true` and returns the
 * `"dry-run-preview"` GeneratedBriefResult variant. This helper assembles the
 * preview from the inputs the generator already has on hand so the trailing
 * branch in each generator stays a one-liner.
 *
 * The preview MUST mirror what `persistRecurringBrief` would freeze into
 * `recurring_metadata.formatConfig.selectedTemplate` / `selectedEndSlide` /
 * `hookData` so the UI shows exactly what a real run would produce.
 */
import type { GeneratedBriefResult } from "./types.ts";

export interface BuildDryRunPreviewInput {
  toolIds: string[];
  selectedTemplate: {
    templateKey: string;
    selectedVia: "fixed" | "lru" | "llm-rank";
    reasoning?: string;
  };
  selectedEndSlide: {
    endSlideDefinitionId: string;
    endSlideType: string;
    name: string;
    selectedVia: "lru-within-pool" | "format-type-default";
  };
  brief: { topicTitle: string; briefText: string };
  /** Family B only — propagated from generator state when needsHooks=true. */
  hookData?: { hookId: string; pattern: string; rendered: string };
}

export function buildDryRunPreview(input: BuildDryRunPreviewInput): GeneratedBriefResult {
  return {
    status: "dry-run-preview",
    toolIds: input.toolIds,
    templateKey: input.selectedTemplate.templateKey,
    templateSelectedVia: input.selectedTemplate.selectedVia,
    ...(input.selectedTemplate.reasoning && {
      templateReasoning: input.selectedTemplate.reasoning,
    }),
    endSlide: {
      endSlideDefinitionId: input.selectedEndSlide.endSlideDefinitionId,
      endSlideType: input.selectedEndSlide.endSlideType,
      name: input.selectedEndSlide.name,
      selectedVia: input.selectedEndSlide.selectedVia,
    },
    ...(input.hookData && { hookData: input.hookData }),
    preview: input.brief,
  };
}
