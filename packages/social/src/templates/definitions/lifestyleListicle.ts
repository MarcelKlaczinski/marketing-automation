/**
 * Spec 65.8 — `lifestyle-listicle` TemplateDefinition (Family B).
 *
 * 6-slide listicle (Cover / Intro / Item×3 / End). Same scaffolding as
 * story-arc-clickbait: single Sonnet call with tagged-block output
 * (4 `## beatName` headers + `<CAPTION>` + `<HASHTAGS>`).
 *
 * Validator is softer than story-arc: the INTRO must mention at least one
 * hook variable verbatim, each ITEM must name the featured tool. Items
 * can omit hook variables since each item carries the tool as protagonist.
 *
 * V1 scope (Day 4a): generateContent (1 Sonnet call) + buildInput (reads
 * hook + featuredTool from `domainExtras.recurring.formatConfig`) + render
 * (gradient-only fallback when `images=[]`; photographic-pipeline wires
 * Day 5).
 */
import {
  buildLifestyleListicleNarrativePrompt,
  buildLifestyleListicleRetrySuffix,
  LIFESTYLE_LISTICLE_SYSTEM_PROMPT,
  validateLifestyleListicleNarrative,
} from "../../compositions/lifestyle-listicle/narrative-prompt.ts";
import {
  lifestyleListicleGeneratedSchema,
  lifestyleListicleNarrativeSchema,
  type LifestyleListicleInput,
  type LifestyleListicleNarrative,
} from "../../compositions/lifestyle-listicle/types.ts";
import { splitNarrativeByBeats } from "../../compositions/_shared/family-b/helpers.ts";
import type {
  FamilyBHook,
  FamilyBToolMention,
} from "../../compositions/_shared/family-b/types.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import type {
  ContentBounds,
  GeneratedContent,
  TemplateDefinition,
} from "../types.ts";
import { LIFESTYLE_LISTICLE_FIXTURES } from "./fixtures/lifestyleListicle.fixtures.ts";

// ─── Context (buildInput → render contract) ──────────────────────────────────

export interface LifestyleListicleContext {
  hook: FamilyBHook;
  featuredTool: FamilyBToolMention;
  articleSlug: string;
  articleUrl: string;
}

// ─── Bounds ──────────────────────────────────────────────────────────────────

export const lifestyleListicleBounds: ContentBounds = {
  hook: { min: 8, max: 160 },
  beat: { min: 20, max: 400 },
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
};

export { lifestyleListicleGeneratedSchema };

// ─── Tagged-block parser (same convention as story-arc-clickbait) ─────────────

function parseTaggedBlock(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = text.match(re);
  if (!m) return null;
  return m[1]?.trim() ?? null;
}

function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("#") && /^#[^\s\-#]+$/u.test(s));
}

// ─── Static fallback narrative ────────────────────────────────────────────────

function buildFallbackNarrative(
  hook: FamilyBHook,
  toolName: string,
): LifestyleListicleNarrative {
  const subject = hook.variables.profession ?? hook.variables.lifeArea ?? "my routine";
  return {
    intro: {
      beatName: "intro",
      text: `As a ${subject}, ${toolName} quietly slipped into my routine in three moments worth showing.`,
    },
    item1: {
      beatName: "item1",
      text: `Morning, over coffee: ${toolName} drafts my first three tasks while I'm still waking up.`,
    },
    item2: {
      beatName: "item2",
      text: `Mid-day at my desk: ${toolName} pairs with me on the work that used to drain my afternoon.`,
    },
    item3: {
      beatName: "item3",
      text: `The unexpected one: ${toolName} helps me write the birthday text I always procrastinate on.`,
    },
  };
}

const DEFAULT_HASHTAGS_DE = [
  "#KIAlltag",
  "#AIInDailyLife",
  "#Produktivität",
  "#LifestyleMitKI",
  "#KIWorkflow",
  "#FutureOfWork",
  "#KIFürBusiness",
] as const;

const DEFAULT_HASHTAGS_EN = [
  "#AIInDailyLife",
  "#Productivity",
  "#LifestyleAI",
  "#AIWorkflow",
  "#FutureOfWork",
  "#AIForBusiness",
  "#EverydayAI",
] as const;

// ─── TemplateDefinition ───────────────────────────────────────────────────────

export const lifestyleListicleTemplate: TemplateDefinition<LifestyleListicleContext> = {
  key: "lifestyle-listicle",
  displayName: "Lifestyle Listicle",
  description: "Hook-driven 3-item lifestyle showcase for a single tool across distinct everyday moments. Family B Spec 65.8.",
  defaultSlideCount: 6,
  estimatedCostUsd: 0.06,
  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "llm-live",
  plannerMeta: {
    contentType: "story",
    estimatedEngagementTier: "high",
    recycleableFromExistingArticle: false,
    requiresLiveData: false,
  },
  renderServerFn: "renderLifestyleListicle",
  bounds: lifestyleListicleBounds,
  generatedSchema: lifestyleListicleGeneratedSchema,

  // ── eligibility ──────────────────────────────────────────────────────────
  eligibility: (article) => {
    if (article.collection !== "recurring_content") {
      return {
        eligible: false,
        reason: "lifestyle-listicle requires collection='recurring_content'",
        requirements: ["collection=recurring_content", "domainExtras.recurring.formatConfig.hookData set", "domainExtras.recurring.formatConfig.featuredTool set"],
      };
    }
    const recurring = (article.domainExtras as { recurring?: { formatConfig?: { hookData?: unknown; featuredTool?: unknown } } } | undefined)?.recurring;
    if (!recurring?.formatConfig?.hookData) {
      return {
        eligible: false,
        reason: "recurring article missing hookData",
        requirements: ["domainExtras.recurring.formatConfig.hookData set by Spec 65.5 brief-generator"],
      };
    }
    if (!recurring?.formatConfig?.featuredTool) {
      return {
        eligible: false,
        reason: "recurring article missing featuredTool",
        requirements: ["domainExtras.recurring.formatConfig.featuredTool set by Spec 65.5 brief-generator"],
      };
    }
    return { eligible: true };
  },

  // ── buildInput ───────────────────────────────────────────────────────────
  buildInput: async (article) => {
    const recurring = (article.domainExtras as {
      recurring?: {
        formatConfig?: {
          hookData?: { rendered?: string; variables?: Record<string, string> };
          featuredTool?: FamilyBToolMention;
        };
      };
    } | undefined)?.recurring;

    const hookData = recurring?.formatConfig?.hookData;
    const hook: FamilyBHook = {
      rendered: hookData?.rendered ?? article.title ?? article.slug,
      variables: hookData?.variables ?? {},
    };
    const featuredTool: FamilyBToolMention = recurring?.formatConfig?.featuredTool ?? {
      slug: "unknown",
      name: "the tool",
    };
    const articleUrl = `toolwiki.ai/${article.slug}`;
    return {
      hook,
      featuredTool,
      articleSlug: article.slug,
      articleUrl,
    };
  },

  // ── generateContent ──────────────────────────────────────────────────────
  generateContent: async (article, input, locale, llmCaller) => {
    const ctx = input as LifestyleListicleContext;

    const systemPrompt = `${LIFESTYLE_LISTICLE_SYSTEM_PROMPT}\n\nAdditionally, after the 4 narrative beats, emit a CAPTION and HASHTAGS block in EXACTLY this format:\n\n<CAPTION>\n(your caption, 80-280 chars, no hashtags inside)\n</CAPTION>\n\n<HASHTAGS>\n#tag1 #tag2 ... (7 hashtags, no hyphens, mix DE+EN regardless of post locale)\n</HASHTAGS>`;

    const baseUserPrompt = buildLifestyleListicleNarrativePrompt({
      hook: ctx.hook,
      featuredToolName: ctx.featuredTool.name,
      locale,
    });

    // First attempt
    let llmRaw = await llmCaller(systemPrompt, baseUserPrompt);
    let parsed = parseAndValidateNarrative(llmRaw, ctx.hook.variables, ctx.featuredTool.name);

    // Single retry with refinement suffix
    if (!parsed.valid && llmRaw) {
      const retrySuffix = buildLifestyleListicleRetrySuffix(parsed.validation);
      const retryRaw = await llmCaller(systemPrompt, `${baseUserPrompt}\n${retrySuffix}`);
      const retryParsed = parseAndValidateNarrative(retryRaw, ctx.hook.variables, ctx.featuredTool.name);
      if (retryParsed.valid) {
        llmRaw = retryRaw;
        parsed = retryParsed;
      }
    }

    const finalNarrative =
      parsed.narrative ?? buildFallbackNarrative(ctx.hook, ctx.featuredTool.name);
    const caption =
      (llmRaw && parseTaggedBlock(llmRaw, "CAPTION")) ??
      fallbackCaption(article, ctx, locale);
    const hashtagsRaw = (llmRaw && parseTaggedBlock(llmRaw, "HASHTAGS")) ?? "";
    const parsedHashtags = parseHashtags(hashtagsRaw);
    const hashtags =
      parsedHashtags.length >= 5
        ? parsedHashtags.slice(0, 10)
        : Array.from(locale === "de" ? DEFAULT_HASHTAGS_DE : DEFAULT_HASHTAGS_EN);

    const words = ctx.hook.rendered.split(" ");
    const result: GeneratedContent & { _lifestyleExtra: LifestyleListicleNarrative } = {
      hookOutput: {
        pattern: "number_promise",
        leadPhrase: words.slice(0, 3).join(" "),
        highlightWord: words.slice(3, 6).join(" ") || ctx.hook.rendered,
        trailPhrase: words.slice(6).join(" "),
        fullText: ctx.hook.rendered,
        promiseBlock: { line1: ctx.hook.rendered, line2: "" },
      },
      caption,
      hashtags,
      _lifestyleExtra: finalNarrative,
    };
    return result as unknown as GeneratedContent;
  },

  // ── render ───────────────────────────────────────────────────────────────
  render: async (context) => {
    const ctx = context.input;
    const narrative =
      (context.generatedContent as
        | (GeneratedContent & { _lifestyleExtra?: LifestyleListicleNarrative })
        | undefined)?._lifestyleExtra ?? buildFallbackNarrative(ctx.hook, ctx.featuredTool.name);

    const brandTokens = brandTokensSchema.parse(context.brandTokens ?? {});
    const input: LifestyleListicleInput = {
      slideIndex: 0,
      slideTotal: 6,
      theme: context.theme,
      locale: context.locale,
      brandTokens,
      hook: ctx.hook,
      narrative,
      featuredTool: ctx.featuredTool,
      end: {
        headlineLead: context.locale === "de" ? "Mehr Lifestyle-KI" : "More lifestyle AI",
        headlineEm: context.locale === "de" ? "ehrlich erprobt." : "honestly tested.",
        articleUrl: ctx.articleUrl,
        ctaLine: context.locale === "de" ? "Mehr Geschichten →" : "More stories →",
      },
      images: [],
    };

    const socialModule = (await import("../../../render-server.ts")) as unknown as {
      renderLifestyleListicle: (
        input: LifestyleListicleInput,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderLifestyleListicle(input);
    const slideOutputs = await writeSlides(
      buffers,
      context.article.id,
      "lifestyle-listicle",
      context.locale,
      context.theme,
      { width: 1080, height: 1350 },
    );
    return {
      slides: slideOutputs,
      caption:
        context.generatedContent?.caption ??
        fallbackCaption(context.article, ctx, context.locale),
      hashtags:
        context.generatedContent?.hashtags ??
        Array.from(context.locale === "de" ? DEFAULT_HASHTAGS_DE : DEFAULT_HASHTAGS_EN),
      metadata: { estimatedCostUsd: 0.06, templateKey: "lifestyle-listicle" },
    };
  },

  mockFixtures: LIFESTYLE_LISTICLE_FIXTURES,
};

// ─── Pure helper: parse + validate ────────────────────────────────────────────

function parseAndValidateNarrative(
  raw: string | null,
  hookVariables: Record<string, string>,
  toolName: string,
): {
  valid: boolean;
  narrative: LifestyleListicleNarrative | null;
  validation: ReturnType<typeof validateLifestyleListicleNarrative>;
} {
  const emptyNarrative: LifestyleListicleNarrative = {
    intro: { beatName: "intro", text: "" },
    item1: { beatName: "item1", text: "" },
    item2: { beatName: "item2", text: "" },
    item3: { beatName: "item3", text: "" },
  };
  const noNarrative = {
    valid: false,
    narrative: null,
    validation: validateLifestyleListicleNarrative(emptyNarrative, hookVariables, toolName),
  };
  if (!raw) return noNarrative;
  const split = splitNarrativeByBeats(raw, ["intro", "item1", "item2", "item3"]);
  for (const beat of ["intro", "item1", "item2", "item3"] as const) {
    if (!split[beat]) return noNarrative;
  }
  const narrative: LifestyleListicleNarrative = {
    intro: { beatName: "intro", text: split.intro ?? "" },
    item1: { beatName: "item1", text: split.item1 ?? "" },
    item2: { beatName: "item2", text: split.item2 ?? "" },
    item3: { beatName: "item3", text: split.item3 ?? "" },
  };
  const zodParsed = lifestyleListicleNarrativeSchema.safeParse(narrative);
  if (!zodParsed.success) return noNarrative;
  const validation = validateLifestyleListicleNarrative(narrative, hookVariables, toolName);
  return { valid: validation.valid, narrative, validation };
}

function fallbackCaption(
  article: { title: string | null; slug: string },
  ctx: LifestyleListicleContext,
  locale: "de" | "en",
): string {
  if (locale === "de") {
    return `Drei ehrliche Momente, in denen ${ctx.featuredTool.name} meinen Alltag spürbar verändert hat.\n\n${article.title ?? article.slug}`;
  }
  return `Three honest moments where ${ctx.featuredTool.name} quietly changed my everyday life.\n\n${article.title ?? article.slug}`;
}
