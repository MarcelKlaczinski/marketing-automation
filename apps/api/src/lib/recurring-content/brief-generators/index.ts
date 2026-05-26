/**
 * Spec 65.5 — Brief-Generator registry + dispatcher.
 *
 * `BRIEF_GENERATORS` keys onto the 5 v1 `FormatTypeKey` values from 65.4.
 * `dispatchBriefGenerator()` is the worker's single entry point — it
 * validates the dispatch key, runs the generator, and surfaces a typed
 * `GeneratedBriefResult` discriminated union for downstream logging /
 * notifications.
 */
import { generateHeadToHeadBrief } from "./head-to-head.ts";
import { generateLifestyleListicleBrief } from "./lifestyle-listicle.ts";
import { generateOpinionRecommendationBrief } from "./opinion-recommendation.ts";
import { generateStoryArcClickbaitBrief } from "./story-arc-clickbait.ts";
import { generateTopNComparisonBrief } from "./top-n-comparison.ts";
import type { BriefGenContext, GeneratedBriefResult } from "./shared/types.ts";

export type BriefGeneratorFn = (ctx: BriefGenContext) => Promise<GeneratedBriefResult>;

export const BRIEF_GENERATORS: Record<string, BriefGeneratorFn> = {
  top_n_comparison: generateTopNComparisonBrief,
  head_to_head: generateHeadToHeadBrief,
  story_arc_clickbait: generateStoryArcClickbaitBrief,
  lifestyle_listicle: generateLifestyleListicleBrief,
  opinion_recommendation: generateOpinionRecommendationBrief,
};

export class UnknownFormatTypeError extends Error {
  readonly formatType: string;
  constructor(formatType: string) {
    super(`No brief-generator registered for format-type '${formatType}'`);
    this.name = "UnknownFormatTypeError";
    this.formatType = formatType;
  }
}

export async function dispatchBriefGenerator(
  ctx: BriefGenContext,
): Promise<GeneratedBriefResult> {
  const fn = BRIEF_GENERATORS[ctx.definition.formatType];
  if (!fn) {
    throw new UnknownFormatTypeError(ctx.definition.formatType);
  }
  return await fn(ctx);
}

// Re-export the shared types so callers (worker, tests) can import from one
// place instead of reaching into ./shared/types.ts.
export type { BriefGenContext, GeneratedBriefResult } from "./shared/types.ts";
