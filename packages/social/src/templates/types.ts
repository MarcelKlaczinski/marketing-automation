import type { Article } from "@marketing-auto/db";
import type { ArticleDiscovery } from "@marketing-auto/db";
import type { BrandTokens, HookOutput } from "../compositions/list-carousel/types.ts";

/**
 * Dependency-injected LLM caller passed by the runner (discoveryWorker / preview API).
 * Keeps packages/social free of the Anthropic adapter dependency.
 * Returns raw LLM text response, or null on failure.
 */
export type HookLlmCaller = (systemPrompt: string, userPrompt: string) => Promise<string | null>;

export type TemplateKey =
  | "comparison-stunning"
  | "comparison-stunning-3"
  | "use-case-verdict-per-tool"
  | "single-tool-spotlight"
  | "news-slide"
  | "concept-explainer-deck"
  | "price-comparison"
  | "pro-con-verdict";

export type Theme = "dark" | "light";
export type Locale = "de" | "en";

export type OutputFormat    = "carousel" | "reel" | "story";
export type Channel         = "instagram" | "tiktok" | "linkedin";
export type GenerationClass = "frontmatter-derived" | "llm-live";

export interface TemplatePlannerMeta {
  contentType: "comparison" | "tool-spotlight" | "use-case" | "news" | "concept";
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
  brandTokens?: BrandTokens; // project override; templates fall back to DEFAULT_BRAND_TOKENS
  hookOutput?: HookOutput;   // populated by runner via template.generateHook() before render()
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
}

export type MockFixtureMap = Record<string, MockFixture>;

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

  eligibility: EligibilityPredicate;

  /**
   * Generate a validated hook for this template's cover/hook slide.
   * Called by the runner before render(); result is passed via RenderContext.hookOutput.
   * The llmCaller callback wraps the Anthropic adapter — template stays adapter-free.
   * Use generateHookWithGate() from @marketing-auto/core to implement this.
   */
  generateHook: (
    article: Article,
    input: TInput,
    locale: Locale,
    llmCaller: HookLlmCaller,
  ) => Promise<HookOutput>;

  buildInput: (article: Article, discovery: ArticleDiscovery) => Promise<TInput>;
  render: (context: RenderContext<TInput>) => Promise<RenderResult>;

  mockFixtures: MockFixtureMap;
}
