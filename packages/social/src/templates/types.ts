import type { Article } from "@marketing-auto/db";
import type { ArticleDiscovery } from "@marketing-auto/db";

export type TemplateKey =
  | "comparison-stunning"
  | "use-case-verdict-per-tool"
  | "single-tool-spotlight"
  | "news-slide"
  | "concept-explainer-deck"
  | "price-comparison"
  | "pro-con-verdict";

export type Theme = "dark" | "light";
export type Locale = "de" | "en";

export interface RenderContext<TInput = unknown> {
  article: Article;
  discovery: ArticleDiscovery;
  locale: Locale;
  theme: Theme;
  input: TInput;
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

  eligibility: EligibilityPredicate;

  buildInput: (article: Article, discovery: ArticleDiscovery) => Promise<TInput>;
  render: (context: RenderContext<TInput>) => Promise<RenderResult>;

  mockFixtures: MockFixtureMap;
}
