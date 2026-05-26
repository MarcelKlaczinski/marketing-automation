import type { Article } from "@marketing-auto/db";
import type { ArticleDiscovery } from "@marketing-auto/db";
import type { BrandTokens, HookOutput } from "../compositions/list-carousel/types.ts";
import type { SlotType } from "../compositions/_shared/getFontSize.ts";
import type { z } from "zod";

/**
 * Dependency-injected LLM caller passed by the runner (discoveryWorker / preview API).
 * Keeps packages/social free of the Anthropic adapter dependency.
 * Returns raw LLM text response, or null on failure.
 */
export type HookLlmCaller = (systemPrompt: string, userPrompt: string) => Promise<string | null>;

export interface GeneratedContent {
  hookOutput: HookOutput;
  caption: string;
  hashtags: string[];
}

export type TemplateKey =
  | "comparison-grid-4"
  | "comparison-grid-3"
  | "comparison-grid-5"
  | "verdict-per-use-case"
  | "single-tool-spotlight"
  | "news-slide"
  | "concept-explainer-deck"
  | "price-comparison"
  | "pro-con-verdict"
  | "head-to-head-vs"
  | "head-to-head-deep-dive"
  | "story-arc-clickbait"
  | "lifestyle-listicle"
  | "opinion-recommendation";

/**
 * Spec 65.0 Day 4 — name of the function exported by
 * `@marketing-auto/social/render-server` that this template invokes for
 * Remotion rendering. Each template's own `render()` method already calls
 * the function via dynamic import; this field exposes that mapping as
 * metadata so other consumers (the preview endpoint, future planner tools)
 * can dispatch without re-implementing the lookup. Strict union keeps the
 * field in sync with render-server.ts exports — adding a new template
 * means adding both the export and a union member here in the same diff.
 */
export type RenderServerFn =
  | "renderComparisonGrid4"
  | "renderComparisonGrid3"
  | "renderComparisonGrid5"
  | "renderVerdictPerUseCase"
  | "renderSingleToolSpotlight"
  | "renderProConVerdict"
  | "renderHeadToHeadVs"
  | "renderHeadToHeadDeepDive"
  | "renderStoryArcClickbait"
  | "renderLifestyleListicle"
  | "renderOpinionRecommendation";

export type Theme = "dark" | "light";
export type Locale = "de" | "en";

export type OutputFormat    = "carousel" | "reel" | "story";
export type Channel         = "instagram" | "tiktok" | "linkedin";
export type GenerationClass = "frontmatter-derived" | "llm-live";

export interface TemplatePlannerMeta {
  contentType: "comparison" | "tool-spotlight" | "use-case" | "news" | "concept" | "story";
  estimatedEngagementTier: "low" | "medium" | "high";
  recycleableFromExistingArticle: boolean;
  requiresLiveData: boolean;
}

export interface RenderContext<TInput = unknown> {
  article: Article;
  discovery: ArticleDiscovery;
  locale: Locale;
  theme: Theme;
  input: TInput;
  brandTokens?: BrandTokens;        // project override; templates fall back to DEFAULT_BRAND_TOKENS
  overrides?: Record<string, unknown>; // project-scoped template overrides (Spec 57.3)
  generatedContent?: GeneratedContent; // populated by runner via template.generateContent() before render()
}

export interface SlideOutput {
  filePath: string;
  width: number;
  height: number;
}

export interface RenderResult {
  slides: SlideOutput[];
  caption: string;
  hashtags: string[];
  metadata: {
    estimatedCostUsd: number;
    templateKey: TemplateKey;
  };
}

/**
 * Pure, deterministic predicate — can this template render for this article?
 * Speed matters: no async, no DB calls.
 */
export type EligibilityPredicate = (
  article: Article,
  discovery: ArticleDiscovery,
) => EligibilityResult;

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  requirements?: string[];
}

export interface MockFixture<TInput = unknown> {
  name: string;
  description: string;
  input: TInput;
  /**
   * LLM-generated content fields for this fixture.
   * When set, fixtures-respect-bounds.test.ts validates it against template.generatedSchema.
   * Optional — populate as each template is migrated per Spec 59.3.5.
   */
  generatedContent?: unknown;
}

export type MockFixtureMap = Record<string, MockFixture>;

/**
 * Declared character-length bounds for a single LLM-produced field.
 * The LLM prompt references these values; the Zod schema enforces them.
 * Keeping both in sync prevents "prompt says X, schema accepts Y" drift.
 */
export interface FieldBound {
  min: number;
  max: number;
}

/**
 * Bounds for list/array fields — bounded by count AND per-item length.
 */
export interface ListBound {
  max: number;
  perItemMaxChars: number;
}

/**
 * All field-length budgets for a template (character counts per slot).
 * Flat FieldBound/ListBound for top-level fields; nested ContentBounds for
 * grouped slots (e.g. tools.name, footer.ctaLine). Numeric values document
 * exact structural counts (e.g. tools.count = 4). REMOTION.md is the
 * authoritative source; this object must stay in sync.
 */
export interface ContentBounds {
  [key: string]: FieldBound | ListBound | ContentBounds | number;
}

export interface TemplateDefinition<TInput = unknown> {
  key: TemplateKey;
  displayName: string;
  description: string;
  defaultSlideCount: number;
  estimatedCostUsd: number;

  outputFormat: OutputFormat;
  compatibleChannels: Channel[];
  generationClass: GenerationClass;
  plannerMeta: TemplatePlannerMeta;

  /**
   * Spec 65.0 Day 4 — name of the `@marketing-auto/social/render-server`
   * export that this template's `render()` method ultimately invokes.
   * Surfaces the existing dynamic-import target as metadata so the preview
   * endpoint can dispatch via `template.renderServerFn` instead of a
   * separate hardcoded map (two-source enum gotcha, Memory D125).
   */
  renderServerFn: RenderServerFn;

  /**
   * Hard bounds on all LLM-produced fields for this template.
   * Used by the unit test in bounds-bucket-alignment.test.ts.
   * Optional until all templates are migrated (Sessions 2–4 of Spec 59.3.5).
   */
  bounds?: ContentBounds;

  /**
   * Maps each LLM-produced field name to its SlotType for bucket-alignment tests.
   * Fields not rendered in the composition (e.g. captionBody) are omitted.
   * Optional until all templates are migrated.
   */
  slotMap?: Partial<Record<string, SlotType>>;

  /**
   * Zod schema for the template's LLM-generated content fields.
   * Used by validateAndReprompt() and fixture validation tests.
   * Optional until all templates are migrated.
   */
  generatedSchema?: z.ZodType<unknown>;

  eligibility: EligibilityPredicate;

  /**
   * Generate hook + caption + hashtags in a single LLM call.
   * Called by the runner before render(); result is passed via RenderContext.generatedContent.
   * The llmCaller callback wraps the Anthropic adapter — template stays adapter-free.
   * Use generateContentWithGate() from @marketing-auto/core to implement this.
   */
  generateContent: (
    article: Article,
    input: TInput,
    locale: Locale,
    llmCaller: HookLlmCaller,
  ) => Promise<GeneratedContent>;

  buildInput: (article: Article, discovery: ArticleDiscovery) => Promise<TInput>;
  render: (context: RenderContext<TInput>) => Promise<RenderResult>;

  mockFixtures: MockFixtureMap;
}
