/**
 * Spec 65.8 Day-5-followup — Family-B render-input builder.
 *
 * Given an article that resolved to one of the 3 Family-B templates
 * (`story-arc-clickbait` / `lifestyle-listicle` / `opinion-recommendation`),
 * this helper produces the `renderInput` snapshot that `RenderSlidesStep`
 * persists into `social_posts.content.renderInput` AND the matching
 * `SocialRenderJobData` for the worker.
 *
 * Flow:
 *   1. Load template definition from registry by templateKey.
 *   2. Call `template.buildInput(article, discovery)` to derive the
 *      composition's `*Context` shape (hook + primaryTool + articleUrl).
 *   3. Wrap `anthropic.messages()` as an LLM caller and invoke
 *      `template.generateContent(article, ctx, locale, llmCaller)`. Returns
 *      `GeneratedContent & { _<key>Extra: <NarrativeShape> }` (Spec 60.1
 *      `_extra` pattern). On LLM failure or validation rejection the
 *      template's own fallback narrative fires — this helper never throws.
 *   4. Read cached photographic backgrounds from
 *      `articles.domain_extras.familyBImages[]` (populated by
 *      `StageFamilyBImagesStep` from Day 5). Maps to the composition's
 *      `images: FamilyBImage[]` field (slideIndex + cdnUrl + photographer).
 *   5. Read frozen end-slide data from
 *      `articles.domain_extras.recurring.formatConfig.selectedEndSlide`
 *      (Spec 65.9 / 65.10) so `<HostSlide>` opt-in fires at render time.
 *   6. Build the per-template `renderInput` snapshot conforming to
 *      `storyArcClickbaitInputSchema` / `lifestyleListicleInputSchema` /
 *      `opinionRecommendationInputSchema`.
 *
 * The narrative LLM call (~€0.05) runs in this step (NOT the worker) so the
 * snapshot is fully self-contained — the worker reads it, spreads brand
 * tokens, and dispatches to the right `render*` function from
 * `@marketing-auto/social/render-server`.
 *
 * V1 scope (Marcel-Decision): per-locale loop runs `generateContent` once per
 * locale, paying the LLM cost per locale. Toolwiki is currently DE-only for
 * recurring content; multi-locale Family-B briefs land later (see Day-5
 * follow-up backlog).
 */
import type { Article, ArticleDiscovery } from "@marketing-auto/db";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import {
  type GeneratedContent,
  type Locale,
  type RenderContext,
  type TemplateDefinition,
  type Theme,
  templateRegistry,
} from "@marketing-auto/social/templates";
import { isFamilyBTemplate } from "./stage-family-b-images.step.ts";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * The 3 Family-B templates wired in Spec 65.8 Day 3-4.
 */
export const FAMILY_B_TEMPLATE_KEYS = [
  "story-arc-clickbait",
  "lifestyle-listicle",
  "opinion-recommendation",
] as const;
export type FamilyBTemplateKey = (typeof FAMILY_B_TEMPLATE_KEYS)[number];

/**
 * Total slide count per Family-B template (matches each composition's
 * `slideTotal` field — story-arc has 7, the other two have 6).
 */
export const FAMILY_B_TOTAL_SLIDES: Record<FamilyBTemplateKey, number> = {
  "story-arc-clickbait": 7,
  "lifestyle-listicle": 6,
  "opinion-recommendation": 6,
};

/**
 * Shape persisted into `social_posts.content.renderInput` for Family-B.
 * The actual per-template snapshot is a Record<string, unknown> matching the
 * composition's input schema (we keep it loose here so the helper stays
 * template-agnostic — Zod parsing happens at the composition boundary).
 */
export interface FamilyBRenderSnapshot {
  /**
   * Discriminator key. Worker uses this to dispatch to the right
   * render-server function.
   */
  kind: "family-b";
  templateKey: FamilyBTemplateKey;
  locale: Locale;
  theme: Theme;
  slideTotal: number;
  /**
   * The composition input — already merged with `theme`/`locale`/`hook`/
   * `narrative`/`primaryTool`/`end`/`images`. Worker spreads `brandTokens`
   * on top from job-data at render time.
   */
  compositionInput: Record<string, unknown>;
}

export interface FamilyBRenderResult {
  /** Snapshot for `social_posts.content.renderInput`. */
  renderInput: FamilyBRenderSnapshot;
  /** Caption to persist on the social_post row (already locale-localized). */
  caption: string;
  /** Hashtags to persist on the social_post row. */
  hashtags: string[];
  /** Total slides the worker will render (informational; also on `renderInput.slideTotal`). */
  slideTotal: number;
}

/**
 * DI seam — tests inject stubs for the LLM caller + template lookup so the
 * helper runs offline.
 */
export interface FamilyBRenderDeps {
  /**
   * LLM caller passed to `template.generateContent`. Default builds a caller
   * inside `buildFamilyBRenderInput` that wraps `anthropic.messages()` with
   * `SOCIAL_HOOK_GENERATION` op + Sonnet 4.6, using the article's `projectId`
   * for cost-tracking attribution (matches the discoveryWorker pattern).
   * Tests inject a stub that ignores projectId entirely.
   */
  llmCaller?: (systemPrompt: string, userPrompt: string) => Promise<string | null>;
  /** Template-lookup hook. Default uses the production registry. */
  loadTemplate?: (key: FamilyBTemplateKey) => TemplateDefinition;
}

/**
 * Build the production LLM caller — bound to a projectId so cost_logs
 * attribute the per-tick LLM spend correctly. Soft-fail (returns null) so
 * the template's own fallback narrative fires when the API rejects /
 * times out.
 */
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

const DEFAULT_LOAD_TEMPLATE = (key: FamilyBTemplateKey): TemplateDefinition =>
  templateRegistry.getById(key);

// ─── Main entry ───────────────────────────────────────────────────────────────

export interface BuildFamilyBRenderArgs {
  templateKey: string;
  article: Article;
  discovery: ArticleDiscovery;
  locale: Locale;
  theme: Theme;
  /**
   * Loosely-typed brand tokens forwarded from the pipeline input — the helper
   * does NOT type-narrow them; the worker spreads them on top of the
   * composition input at render time. Passed through into the LLM context
   * (via `RenderContext.brandTokens`) when the template needs it for the
   * caption-fallback path.
   */
  brandTokens?: Record<string, unknown>;
  /**
   * Staged photographic backgrounds from `articles.domain_extras.familyBImages[]`
   * (populated by `StageFamilyBImagesStep` from Day 5). Each entry maps to a
   * slide index. Slides without a matching entry render the gradient-only
   * fallback (Family-B `SlideComposition` `image={null}` branch). Empty
   * array is acceptable — the carousel still renders, gradient-only across
   * the board.
   */
  stagedImages?: Array<{
    slideIndex: number;
    cdnUrl: string;
    photographer?: string | null;
  }>;
  /**
   * Spec 65.10 — Optional `<HostSlide>` opt-in data from
   * `domain_extras.recurring.formatConfig.selectedEndSlide`. When present,
   * the Family-B composition's `RenderEndSlide` dispatcher swaps the inline
   * end slide for `<HostSlide data={...}/>`. Null/undefined falls through to
   * the inline `<InlineEndSlide>` per template.
   */
  endSlideData?: { type: string; config: Record<string, unknown> } | null;
  /**
   * Spec 65.15 — Bottom-right brand-stamp watermark URL. Null/undefined →
   * no stamp (graceful-null per `DsBrandStamp`). Stamped only on Cover + End
   * slides, never on body slides.
   */
  logoUrl?: string | null;
}

export async function buildFamilyBRenderInput(
  args: BuildFamilyBRenderArgs,
  deps: FamilyBRenderDeps = {},
): Promise<FamilyBRenderResult> {
  if (!isFamilyBTemplate(args.templateKey)) {
    throw new Error(
      `buildFamilyBRenderInput called with non-Family-B templateKey="${args.templateKey}"; check the caller's branch.`,
    );
  }
  const templateKey = args.templateKey as FamilyBTemplateKey;
  const slideTotal = FAMILY_B_TOTAL_SLIDES[templateKey];

  const resolveTemplate = deps.loadTemplate ?? DEFAULT_LOAD_TEMPLATE;
  const llmCaller = deps.llmCaller ?? buildDefaultLlmCaller(args.article.projectId);

  const template = resolveTemplate(templateKey);

  // Step 1 — build the template-specific input (hook + primaryTool + articleUrl).
  const builtInput = await template.buildInput(args.article, args.discovery);

  // Step 2 — LLM call producing narrative + caption + hashtags (Pattern 60.1 _extra).
  const generated = await template.generateContent(
    args.article,
    builtInput,
    args.locale,
    llmCaller,
  );

  // Step 3 — invoke template.render() to produce the composition input. Wait,
  // we DON'T render here — the worker does that. Instead, reuse the template's
  // own input-building convention: compose article + discovery + builtInput +
  // generatedContent into a single snapshot that the worker can spread into
  // the renderServer call.
  //
  // The simplest contract is to pass the SAME thing render() would have
  // received except wrapped in `RenderContext`: the snapshot IS the
  // composition input. We construct it template-agnostically by reading the
  // shared Family-B fields off `builtInput` (hook + primaryTool + articleUrl).
  //
  // Per-template specifics (featuredTool, recommendedTool, end content) come
  // from the same `builtInput` since each Family-B template's `buildInput()`
  // already returns the full context. We let the template's `render()` (when
  // the worker calls it) re-assemble — except the worker calls the
  // `render-server.ts` function directly, NOT template.render().
  //
  // Therefore the helper rebuilds the composition input here by mirroring
  // what each template's `render()` does internally. That logic IS the
  // contract this layer owns.

  const ctx = builtInput as FamilyBBuildInputShape;
  const narrative = extractNarrative(templateKey, generated);

  // Per-template composition input — mirrors what each template's
  // `render()` constructs before calling its render-server function.
  //
  // Known duplication trade-off (Spec 65.8 Day-5-followup §2): each Family-B
  // template's `render()` ALSO builds the composition input from
  // `(buildInput-result + generatedContent)`. We replicate that wiring here
  // because the worker dispatches to `render-server.ts` functions directly
  // (NOT via `template.render()`) per the article:social-image worker
  // contract (Spec 57.2). If a future spec migrates the worker to call
  // `template.render(context)` end-to-end, this helper can be deleted in
  // favour of constructing a `RenderContext` and calling render() directly.
  const compositionInput: Record<string, unknown> = {
    slideIndex: 0,
    slideTotal,
    theme: args.theme,
    locale: args.locale,
    hook: ctx.hook,
    narrative,
    end: buildFamilyBEnd(ctx, args.locale),
    images: normalizeStagedImages(args.stagedImages, slideTotal),
    ...(args.brandTokens !== undefined && { brandTokens: args.brandTokens }),
    ...(args.endSlideData != null && { endSlideData: args.endSlideData }),
    ...(args.logoUrl != null && { logoUrl: args.logoUrl }),
  };

  // Tool-mention field name differs per template — match each schema literally.
  if (templateKey === "story-arc-clickbait") {
    if (ctx.primaryTool) {
      compositionInput.primaryTool = ctx.primaryTool;
    }
  } else if (templateKey === "lifestyle-listicle") {
    // featuredTool is REQUIRED on lifestyle-listicle; fall back to a minimal
    // placeholder if the brief didn't carry one (validator rejects empty).
    compositionInput.featuredTool = ctx.featuredTool ?? ctx.primaryTool ?? FAMILY_B_TOOL_PLACEHOLDER;
  } else if (templateKey === "opinion-recommendation") {
    // recommendedTool is REQUIRED on opinion-recommendation.
    compositionInput.recommendedTool =
      ctx.recommendedTool ?? ctx.primaryTool ?? FAMILY_B_TOOL_PLACEHOLDER;
  }

  return {
    renderInput: {
      kind: "family-b",
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Subset of the Family-B template's `buildInput()` return shape that this
 * helper needs to read. We don't import the per-template Context types
 * directly to keep this file template-agnostic — each Context shape is a
 * superset of these fields (verified at runtime when `generateContent` is
 * called with the typed input).
 */
type FamilyBBuildInputShape = {
  hook: { rendered: string; variables: Record<string, string> };
  articleSlug: string;
  articleUrl: string;
  primaryTool?: FamilyBToolShape;
  featuredTool?: FamilyBToolShape;
  recommendedTool?: FamilyBToolShape;
};

type FamilyBToolShape = {
  slug: string;
  name: string;
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
  primaryColor?: string;
  secondaryColor?: string;
};

/**
 * Fallback tool when a Family-B brief was emitted without a structured
 * primary-tool reference. Family-B templates' Zod schemas require the tool
 * field, so we cannot omit it — the placeholder lets the carousel render
 * gradient-only without a logo chip. The validator's
 * `name.min(1)` is satisfied.
 */
const FAMILY_B_TOOL_PLACEHOLDER: FamilyBToolShape = {
  slug: "unknown",
  name: "—",
};

/**
 * Coerce the staged-image array into the shape the composition's
 * `familyBImageSchema` expects:
 *   `{ slideIndex: number, cdnUrl: string, photographer?: string | null }`
 *
 * Drops entries pointing past the composition's slide range (defensive —
 * shouldn't happen if the orchestrator's `FAMILY_B_IMAGE_SLIDES` map
 * matches the templates' `slideTotal`, but a stale cache from a different
 * template could carry mismatched indices).
 */
function normalizeStagedImages(
  raw: BuildFamilyBRenderArgs["stagedImages"],
  slideTotal: number,
): Array<{ slideIndex: number; cdnUrl: string; photographer?: string | null }> {
  if (!raw || raw.length === 0) return [];
  return raw
    .filter((entry) => entry.slideIndex >= 0 && entry.slideIndex < slideTotal)
    .map((entry) => ({
      slideIndex: entry.slideIndex,
      cdnUrl: entry.cdnUrl,
      ...(entry.photographer !== undefined && { photographer: entry.photographer }),
    }));
}

/**
 * Per-locale default end-slide copy. Mirrors each template's `render()`
 * `end` block. The actual `<HostSlide>` opt-in (Spec 65.10) overrides this
 * at render time when `endSlideData` is present on the renderInput.
 */
function buildFamilyBEnd(ctx: FamilyBBuildInputShape, locale: Locale): Record<string, string> {
  const isDE = locale === "de";
  return {
    headlineLead: isDE ? "Mehr Geschichten" : "More stories",
    headlineEm: isDE ? "ehrlich erzählt." : "honestly told.",
    articleUrl: ctx.articleUrl,
    ctaLine: isDE ? "Vollständige Story →" : "Full story →",
  };
}

/**
 * Pull the narrative payload off the generated-content `_<tplKey>Extra`
 * extension field (Spec 60.1 pattern). Falls back to an empty-but-valid
 * shape so the composition's Zod validator still parses — Family-B slides
 * render placeholder text in that case rather than failing the worker.
 */
function extractNarrative(
  templateKey: FamilyBTemplateKey,
  generated: GeneratedContent,
): Record<string, unknown> {
  const ext = generated as GeneratedContent & {
    _storyArcExtra?: Record<string, unknown>;
    _lifestyleExtra?: Record<string, unknown>;
    _opinionExtra?: Record<string, unknown>;
  };
  if (templateKey === "story-arc-clickbait" && ext._storyArcExtra) {
    return ext._storyArcExtra;
  }
  if (templateKey === "lifestyle-listicle" && ext._lifestyleExtra) {
    return ext._lifestyleExtra;
  }
  if (templateKey === "opinion-recommendation" && ext._opinionExtra) {
    return ext._opinionExtra;
  }
  return buildFallbackNarrative(templateKey);
}

/**
 * Empty-but-valid narrative shape per template so the worker can render
 * gradient-only with placeholder text when the LLM round-trip fails AND the
 * template's own fallback path didn't fire (defense in depth).
 */
function buildFallbackNarrative(templateKey: FamilyBTemplateKey): Record<string, unknown> {
  if (templateKey === "story-arc-clickbait") {
    return {
      setup: { beatName: "setup", text: " " },
      conflict: { beatName: "conflict", text: " " },
      resolution: { beatName: "resolution", text: " " },
      payoff: { beatName: "payoff", text: " " },
      lesson: { beatName: "lesson", text: " " },
    };
  }
  if (templateKey === "lifestyle-listicle") {
    return {
      intro: { beatName: "intro", text: " " },
      item1: { beatName: "item1", text: " " },
      item2: { beatName: "item2", text: " " },
      item3: { beatName: "item3", text: " " },
    };
  }
  return {
    hotTake: { beatName: "hotTake", text: " " },
    reasoning1: { beatName: "reasoning1", text: " " },
    reasoning2: { beatName: "reasoning2", text: " " },
    topPick: { beatName: "topPick", text: " " },
  };
}

// Re-export RenderContext to keep the public surface tight (callers don't
// need to know how the helper threads it through internally). Intentionally
// unused locally but kept as a re-export so apps/api can read the type.
export type { RenderContext };
