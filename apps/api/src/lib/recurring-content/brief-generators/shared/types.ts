/**
 * Spec 65.5 — Shared types for the 5 brief-generators + the worker.
 *
 * Each brief-generator is a `(ctx) => Promise<GeneratedBriefResult>`. The
 * dispatch registry (`index.ts`) picks one by `format_type`.
 */
import type {
  Article,
  RecurringContentDefinition,
  TopicBrief,
} from "@marketing-auto/db";

export interface BriefGenContext<TConfig = Record<string, unknown>> {
  definition: RecurringContentDefinition;
  /** The validated `format_config` for the brief-generator's format-type. */
  config: TConfig;
  projectId: string;
  /** BullMQ-job-resolved language (default 'de'). Drives Hook-Library lookups + brief-text locale. */
  language: "de" | "en";
  /** Tool IDs surfaced by previous runs of this definition (for LRU diversity). */
  previousRunToolIds?: string[];
  /** Monotonic counter — 1st, 2nd, 3rd run of this definition. */
  runNumber: number;
  /** Threaded into Anthropic calls for cost-attribution. */
  pipelineRunId?: string;
}

export type GeneratedBriefResult =
  | {
      status: "persisted";
      brief: TopicBrief;
      /** Tool IDs that landed in the brief (subset of pool, after brand-asset filter). */
      toolIds: string[];
      templateKey: string;
      /** When the format-type is Family B, this carries the picked + rendered hook. */
      hookData?: { hookId: string; pattern: string; rendered: string };
    }
  | {
      status: "skipped";
      reason: "brand-assets-missing" | "insufficient-tools" | "no-hook" | "inactive-definition";
      missingToolIds?: string[];
      /** Free-text diagnostic for the audit log. */
      detail?: string;
    };

/**
 * Resolved tool — promoted columns from `articles` plus brand-asset hints
 * that the brief-text builder consumes. Stays loose because the brief-text
 * prompt is free-text; we don't push types into the LLM template.
 */
export interface ResolvedTool {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  pricing: string | null;
  priceFrom: string | null;
  rating: string | null;
  votes: number | null;
  website: string | null;
}

export function articleToResolvedTool(article: Article): ResolvedTool {
  return {
    id: article.id,
    slug: article.slug,
    name: article.title ?? article.slug,
    category: article.category,
    subcategory: article.subcategory,
    pricing: article.toolPricing,
    priceFrom: article.toolPriceFrom,
    rating: article.toolRating,
    votes: article.toolVotes,
    website: article.toolWebsite,
  };
}
