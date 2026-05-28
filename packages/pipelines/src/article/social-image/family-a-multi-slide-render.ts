/**
 * Spec 65.7-followup-2 — Family-A multi-slide render-input builder.
 *
 * Given an article that resolved to one of the 4 multi-slide Family-A
 * carousel templates (`comparison-grid-3` / `comparison-grid-5` /
 * `head-to-head-vs` / `head-to-head-deep-dive`), this helper produces the
 * `renderInput` snapshot that `RenderSlidesStep` persists into
 * `social_posts.content.renderInput` AND the matching `SocialRenderJobData`
 * for the worker.
 *
 * Why this helper exists:
 *   Without it, `RenderSlidesStep` falls through to its list-carousel default
 *   branch, which produces a flat snapshot that lacks the per-template
 *   `slideTotal` field. The worker then calls (e.g.) `renderComparisonGrid5`
 *   with `input.slideTotal === undefined`, and `renderMultiSlideComposition`
 *   loops 0 times — silently producing 0 slides while flipping the row to
 *   `rendered`. The user sees only the draft state with no preview.
 *   (Marcel-hit case: article e5c421a7, social-post 6ecda4f7 on 2026-05-27.)
 *
 * Flow (mirrors `family-b-render.ts` shape):
 *   1. Load template definition from registry by templateKey.
 *   2. Call `template.buildInput(article, discovery)` to derive the
 *      composition's `*Context` shape (tools + winner + category).
 *   3. Wrap `anthropic.messages()` as an LLM caller and invoke
 *      `template.generateContent(article, ctx, locale, llmCaller)`. Returns
 *      `GeneratedContent & { _<key>Extra: <ExtraShape> }` (Spec 60.1 `_extra`
 *      pattern, with key name varying per template). On LLM failure or
 *      validation rejection the template's own fallback path fires.
 *   4. Dispatch to the matching `build<Template>RenderSnapshot()` exported
 *      from each template module. That wrapper reads the `_<key>Extra` field
 *      (or falls back to `buildFallbackExtra(ctx, locale)`) and calls the
 *      template-private `buildCompositionInput()` to assemble the full
 *      composition input — crucially including `slideTotal`.
 *   5. Return a discriminated snapshot `{ kind: "family-a-multi-slide",
 *      templateKey, slideTotal, locale, theme, compositionInput }`.
 *
 * The narrative LLM call (~€0.014 estimated per template) runs in this step
 * (NOT the worker) so the snapshot is fully self-contained. The worker reads
 * the snapshot, spreads `brandTokens` + `overrides`, and dispatches to the
 * right `render*` function from `@marketing-auto/social/render-server`.
 *
 * Scope (V1): the 4 multi-slide Spec 65.7 carousels. Family-A single-still
 * templates (`comparison-grid-4`, `verdict-per-use-case`, `single-tool-spotlight`,
 * `pro-con-verdict`) stay on the flat-snapshot path — they either have their
 * own dedicated branch in `RenderSlidesStep` (grid-4) or are single-still
 * (don't read `slideTotal`).
 */
import type { Article, ArticleDiscovery } from "@marketing-auto/db";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import {
  buildComparisonGrid3RenderSnapshot,
  buildComparisonGrid5RenderSnapshot,
  buildHeadToHeadVsRenderSnapshot,
  buildHeadToHeadDeepDiveRenderSnapshot,
  type GeneratedContent,
  type Grid3Context,
  type Grid5Context,
  type HeadToHeadDeepDiveContext,
  type HeadToHeadVsContext,
  type Locale,
  type TemplateDefinition,
  type Theme,
  templateRegistry,
} from "@marketing-auto/social/templates";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * The 4 Family-A multi-slide carousel templates wired in Spec 65.7.
 * The other 4 Family-A keys (comparison-grid-4 / verdict-per-use-case /
 * single-tool-spotlight / pro-con-verdict) are single-still or have their
 * own dedicated branch — they do NOT go through this helper.
 */
export const FAMILY_A_MULTI_SLIDE_TEMPLATE_KEYS = [
  "comparison-grid-3",
  "comparison-grid-5",
  "head-to-head-vs",
  "head-to-head-deep-dive",
] as const;

export type FamilyAMultiSlideTemplateKey =
  (typeof FAMILY_A_MULTI_SLIDE_TEMPLATE_KEYS)[number];

export function isFamilyAMultiSlideTemplate(
  key: string,
): key is FamilyAMultiSlideTemplateKey {
  return (FAMILY_A_MULTI_SLIDE_TEMPLATE_KEYS as readonly string[]).includes(key);
}

/**
 * Shape persisted into `social_posts.content.renderInput` for the 4
 * multi-slide Family-A carousels. Worker discriminates on `kind` and dispatches.
 */
export interface FamilyAMultiSlideRenderSnapshot {
  kind: "family-a-multi-slide";
  templateKey: FamilyAMultiSlideTemplateKey;
  locale: Locale;
  theme: Theme;
  slideTotal: number;
  /**
   * The fully-assembled composition input matching the template's
   * `<Template>InputSchema` — already contains `slideTotal`, `tools`,
   * `cover`, `compareHeader`/`vs`/`deepDive`, `verdict`, `end`, etc. The
   * worker spreads `brandTokens` + `overrides` from job-data on top before
   * dispatching to the render-server function.
   */
  compositionInput: Record<string, unknown>;
}

export interface FamilyAMultiSlideRenderResult {
  /** Snapshot for `social_posts.content.renderInput`. */
  renderInput: FamilyAMultiSlideRenderSnapshot;
  /** Caption to persist on the social_post row (already locale-localized). */
  caption: string;
  /** Hashtags to persist on the social_post row. */
  hashtags: string[];
  /** Total slides the worker will render (informational; also on snapshot). */
  slideTotal: number;
}

// ─── DI seam ──────────────────────────────────────────────────────────────────

export interface FamilyAMultiSlideRenderDeps {
  /**
   * LLM caller passed to `template.generateContent`. Default wraps
   * `anthropic.messages()` with `SOCIAL_HOOK_GENERATION` op + Sonnet 4.6,
   * using the article's `projectId` for cost-tracking attribution. Tests
   * inject a stub that ignores projectId entirely.
   */
  llmCaller?: (systemPrompt: string, userPrompt: string) => Promise<string | null>;
  /** Template-lookup hook. Default uses the production registry. */
  loadTemplate?: (key: FamilyAMultiSlideTemplateKey) => TemplateDefinition;
}

function buildDefaultLlmCaller(projectId: string) {
  return async (system: string, user: string): Promise<string | null> => {
    try {
      const resp = await anthropic.messages({
        projectId,
        operation: "SOCIAL_HOOK_GENERATION",
        model: "claude-sonnet-4-6",
        systemPrefix: "",
        systemSuffix: system,
        userMessage: user,
        maxTokens: 2048,
        estimatedCostEur: 0.05,
      });
      return resp.raw;
    } catch {
      return null;
    }
  };
}

const DEFAULT_LOAD_TEMPLATE = (
  key: FamilyAMultiSlideTemplateKey,
): TemplateDefinition => templateRegistry.getById(key);

// ─── Main entry ───────────────────────────────────────────────────────────────

export interface BuildFamilyAMultiSlideRenderArgs {
  templateKey: string;
  article: Article;
  discovery: ArticleDiscovery;
  locale: Locale;
  theme: Theme;
  /**
   * Loosely-typed brand tokens forwarded from the pipeline input — passed
   * through into the per-template `buildCompositionInput()` so brand colors
   * + tool icons + article URL resolution honour the project's brand tokens.
   * The worker also spreads them on top of the composition input at render
   * time (defense in depth).
   */
  brandTokens?: unknown;
  /**
   * Spec 65.15 — Bottom-right brand-stamp watermark URL. Null/undefined →
   * no stamp (graceful-null per `DsBrandStamp`). Stamped on Cover (shared
   * across all 4 multi-slide templates) + End slide (via `RenderEndSlide`).
   */
  logoUrl?: string | null;
}

export async function buildFamilyAMultiSlideRenderInput(
  args: BuildFamilyAMultiSlideRenderArgs,
  deps: FamilyAMultiSlideRenderDeps = {},
): Promise<FamilyAMultiSlideRenderResult> {
  if (!isFamilyAMultiSlideTemplate(args.templateKey)) {
    throw new Error(
      `buildFamilyAMultiSlideRenderInput called with non-Family-A-multi-slide templateKey="${args.templateKey}"; check the caller's branch.`,
    );
  }
  const templateKey = args.templateKey;

  const resolveTemplate = deps.loadTemplate ?? DEFAULT_LOAD_TEMPLATE;
  const llmCaller = deps.llmCaller ?? buildDefaultLlmCaller(args.article.projectId);

  const template = resolveTemplate(templateKey);

  // Step 1 — build the template-specific context (tools + winner + category).
  const builtInput = await template.buildInput(args.article, args.discovery);

  // Step 2 — LLM call producing cover/verdict text + caption + hashtags (Spec 60.1 _extra).
  // Falls back to the template's own buildFallbackGeneratedContent() on LLM error.
  const generated = await template.generateContent(
    args.article,
    builtInput,
    args.locale,
    llmCaller,
  );

  // Step 3 — dispatch to the matching per-template snapshot builder. Each
  // builder reads the `_<key>Extra` field off `generated`, falls back to
  // `buildFallbackExtra(ctx, locale)` if missing, then calls the template's
  // private `buildCompositionInput()` which assembles slideTotal + cover +
  // tools + verdict + end into the canonical composition input shape.
  const snapshotBuilderArgs = {
    generatedContent: generated,
    articleSlug: args.article.slug,
    locale: args.locale,
    theme: args.theme,
    brandTokens: args.brandTokens,
  };

  let compositionInput: Record<string, unknown>;
  let slideTotal: number;

  if (templateKey === "comparison-grid-3") {
    const result = buildComparisonGrid3RenderSnapshot({
      ...snapshotBuilderArgs,
      ctx: builtInput as Grid3Context,
    });
    compositionInput = result.compositionInput as unknown as Record<string, unknown>;
    slideTotal = result.slideTotal;
  } else if (templateKey === "comparison-grid-5") {
    const result = buildComparisonGrid5RenderSnapshot({
      ...snapshotBuilderArgs,
      ctx: builtInput as Grid5Context,
    });
    compositionInput = result.compositionInput as unknown as Record<string, unknown>;
    slideTotal = result.slideTotal;
  } else if (templateKey === "head-to-head-vs") {
    const result = buildHeadToHeadVsRenderSnapshot({
      ...snapshotBuilderArgs,
      ctx: builtInput as HeadToHeadVsContext,
    });
    compositionInput = result.compositionInput as unknown as Record<string, unknown>;
    slideTotal = result.slideTotal;
  } else {
    // head-to-head-deep-dive — exhaustive guard via the const-tuple type
    const result = buildHeadToHeadDeepDiveRenderSnapshot({
      ...snapshotBuilderArgs,
      ctx: builtInput as HeadToHeadDeepDiveContext,
    });
    compositionInput = result.compositionInput as unknown as Record<string, unknown>;
    slideTotal = result.slideTotal;
  }

  // Spec 65.15 — Bottom-right brand-stamp watermark. Stamped at the
  // composition input layer so the per-template Cover + RenderEndSlide read it
  // from `familyACommonInputSchema.logoUrl`. Null = no stamp (graceful-null).
  if (args.logoUrl != null) {
    compositionInput.logoUrl = args.logoUrl;
  }

  return {
    renderInput: {
      kind: "family-a-multi-slide",
      templateKey,
      locale: args.locale,
      theme: args.theme,
      slideTotal,
      compositionInput,
    },
    caption: generated.caption,
    hashtags: generated.hashtags,
    slideTotal,
  };
}

// Re-export GeneratedContent type for callers that want to type their own
// mock generators in tests without resolving through the social barrel.
export type { GeneratedContent };
