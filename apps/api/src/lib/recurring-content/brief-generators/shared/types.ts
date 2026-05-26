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
  /**
   * Spec 65.V1.5a Bridge #3 — shared UUID across sibling briefs from the same
   * multi-locale fire. The worker generates this once per fire (regardless of
   * how many locales are in `definition.targetLocales`) and threads it through
   * every per-locale brief so siblings end up linked via
   * `recurring_metadata.runGroupId`. Undefined when the definition is
   * single-locale (the field is then omitted from the persisted metadata).
   */
  runGroupId?: string;
  /** Threaded into Anthropic calls for cost-attribution. */
  pipelineRunId?: string;
  /**
   * Spec 65.11 dry-run flag.
   *
   * When `true`, the generator runs every LLM call (tool curation, template
   * rank, hook pick, brief-text build) so the preview reflects what a real
   * run would produce — but skips `persistRecurringBrief` and
   * `logTemplateUsage`. Returns the `"dry-run-preview"` result variant.
   *
   * Dry-run costs the same as a real run (LLM calls are real). The Settings
   * UI caps invocations per project per day.
   */
  dryRun?: boolean;
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
      reason:
        | "brand-assets-missing"
        | "insufficient-tools"
        | "no-hook"
        | "inactive-definition"
        | "no-end-slide-eligible";
      missingToolIds?: string[];
      /** Free-text diagnostic for the audit log. */
      detail?: string;
    }
  | {
      /**
       * Spec 65.11 — Dry-run preview. Same shape as `persisted` minus the
       * brief row (no INSERT happened). Surfaces template / end-slide / hook
       * picks and the generated brief-text so Marcel can sanity-check a
       * definition before flipping it active.
       */
      status: "dry-run-preview";
      toolIds: string[];
      templateKey: string;
      templateSelectedVia: "fixed" | "lru" | "llm-rank";
      templateReasoning?: string;
      endSlide: {
        endSlideDefinitionId: string;
        endSlideType: string;
        name: { de: string; en: string };
        selectedVia: "lru-within-pool" | "format-type-default";
      };
      hookData?: { hookId: string; pattern: string; rendered: string };
      preview: { topicTitle: string; briefText: string };
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
