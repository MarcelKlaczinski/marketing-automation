/**
 * Spec 65.8 — `story-arc-clickbait` TemplateDefinition (Family B).
 *
 * 7-slide narrative carousel (Cover / Setup / Conflict / Resolution / Payoff /
 * Lesson / End). Hook comes from Spec 65.4 `pickHook` + `renderHook` (no
 * LLM at render time); narrative + caption + hashtags come from ONE Sonnet
 * call with tagged-block output (Sonnet rejects assistant prefill so no
 * `jsonMode`).
 *
 * Photographic backgrounds are populated by the photographic-pipeline
 * orchestrator (`packages/pipelines/src/article/social-image/photographic/`)
 * BEFORE this template's `render()` runs. Wiring happens in Spec 65.8 Day 5;
 * V1 of this definition renders the gradient-only fallback when `images=[]`.
 *
 * V1 scope (Day 3):
 *   - `generateContent` returns static-fallback `hookOutput` + LLM-generated
 *     narrative + caption + hashtags via one Sonnet call.
 *   - `buildInput` resolves hook from `article.domainExtras.recurring.formatConfig.hookData`
 *     (populated by 65.5 brief-generator), primaryTool from `domainExtras.recurring.primaryTool`.
 *   - `render` calls `renderStoryArcClickbait` via dynamic import.
 *
 * V1.1 (Day 5): photographic-pipeline orchestrator integration + per-slide
 * image staging via the article's `domainExtras.familyBImages[]` array.
 */
import {
  buildStoryArcNarrativePrompt,
  buildStoryArcRetrySuffix,
  STORY_ARC_SYSTEM_PROMPT,
  validateStoryArcNarrative,
} from "../../compositions/story-arc-clickbait/narrative-prompt.ts";
import {
  storyArcClickbaitGeneratedSchema,
  storyArcNarrativeSchema,
  type StoryArcClickbaitInput,
  type StoryArcNarrative,
} from "../../compositions/story-arc-clickbait/types.ts";
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
import { STORY_ARC_CLICKBAIT_FIXTURES } from "./fixtures/storyArcClickbait.fixtures.ts";

// ─── StoryArcContext (buildInput → render contract) ──────────────────────────

export interface StoryArcContext {
  hook: FamilyBHook;
  primaryTool?: FamilyBToolMention | undefined;
  /** Article slug — feeds into the inline end-slide URL via resolveArticleUrl. */
  articleSlug: string;
  /** Already-resolved article URL ("toolwiki.ai/wie-texter-ki" form). */
  articleUrl: string;
}

// ─── Bounds (loose for V1; tighten alongside REMOTION.md in a follow-up) ──────

export const storyArcClickbaitBounds: ContentBounds = {
  hook: { min: 8, max: 160 },
  beat: { min: 20, max: 400 },
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
};

export { storyArcClickbaitGeneratedSchema };

// ─── LLM output parser (tagged-block convention — Sonnet rejects jsonMode) ────

/**
 * Extract a tagged block (e.g. `<CAPTION>…</CAPTION>`) from a free-text LLM
 * response. Returns null when missing — caller falls back to a static value.
 *
 * Same convention used by `LocalizeArticleStep` and other Sonnet steps where
 * jsonMode is unavailable (assistant prefill rejected with HTTP 400).
 */
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

// ─── Static fallback narrative (used when LLM call fails persistent retries) ──

function buildFallbackNarrative(hook: FamilyBHook): StoryArcNarrative {
  const subject = hook.variables.profession ?? hook.variables.lifeArea ?? "you";
  return {
    setup: { beatName: "setup", text: `As a ${subject}, my workday looked the same every morning — open the laptop, open the same tools, repeat.` },
    conflict: { beatName: "conflict", text: `Then AI showed up and suddenly the work I built my ${subject} identity around was a 30-second prompt.` },
    resolution: { beatName: "resolution", text: `I stopped fighting it and started experimenting — using AI as a sparring partner instead of pretending it didn't exist.` },
    payoff: { beatName: "payoff", text: `Today my ${subject} workflow is faster, sharper, and the work I keep doing manually is the work that actually matters.` },
    lesson: { beatName: "lesson", text: `If your ${subject} job feels disrupted, that's not the ending — it's the moment your judgment becomes the product.` },
  };
}

const DEFAULT_HASHTAGS_DE = [
  "#KIFürBusiness",
  "#AIForBusiness",
  "#Produktivität",
  "#KarriereImWandel",
  "#TextMitKI",
  "#KIWorkflow",
  "#FutureOfWork",
] as const;

const DEFAULT_HASHTAGS_EN = [
  "#AIForBusiness",
  "#Productivity",
  "#FutureOfWork",
  "#CareerShift",
  "#AIWorkflow",
  "#WritingWithAI",
  "#AICareer",
] as const;

// ─── TemplateDefinition ───────────────────────────────────────────────────────

export const storyArcClickbaitTemplate: TemplateDefinition<StoryArcContext> = {
  key: "story-arc-clickbait",
  displayName: "Story-Arc Clickbait",
  description: "Hook-driven narrative arc (Setup → Conflict → Resolution → Payoff → Lesson) with optional inline tool mention. Family B Spec 65.8.",
  defaultSlideCount: 7,
  estimatedCostUsd: 0.06, // 1 Sonnet narrative+caption call + future per-slide vision picks (Day 5)
  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "llm-live",
  plannerMeta: {
    contentType: "story",
    estimatedEngagementTier: "high",
    recycleableFromExistingArticle: false,
    requiresLiveData: false,
  },
  renderServerFn: "renderStoryArcClickbait",
  bounds: storyArcClickbaitBounds,
  generatedSchema: storyArcClickbaitGeneratedSchema,

  // ── eligibility ──────────────────────────────────────────────────────────
  eligibility: (article) => {
    // V1 is recurring-content driven — the brief-generator creates an article
    // with `collection='recurring_content'` and stamps the hook + primaryTool
    // into `domainExtras.recurring.formatConfig.hookData/primaryTool`.
    if (article.collection !== "recurring_content") {
      return {
        eligible: false,
        reason: "story-arc-clickbait requires collection='recurring_content'",
        requirements: ["collection=recurring_content", "domainExtras.recurring.formatConfig.hookData set"],
      };
    }
    const recurring = (article.domainExtras as { recurring?: { formatConfig?: { hookData?: unknown } } } | undefined)?.recurring;
    if (!recurring?.formatConfig?.hookData) {
      return {
        eligible: false,
        reason: "recurring article missing hookData",
        requirements: ["domainExtras.recurring.formatConfig.hookData set by Spec 65.5 brief-generator"],
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
          primaryTool?: FamilyBToolMention;
        };
      };
    } | undefined)?.recurring;

    const hookData = recurring?.formatConfig?.hookData;
    const hook: FamilyBHook = {
      rendered: hookData?.rendered ?? article.title ?? article.slug,
      variables: hookData?.variables ?? {},
    };
    const primaryTool = recurring?.formatConfig?.primaryTool;
    // V1 single-tenant articleUrl — Day 5 will swap to resolveArticleUrl(brandTokens, slug)
    // once brandTokens are threaded into buildInput. For now, single-tenant default.
    const articleUrl = `toolwiki.ai/${article.slug}`;

    const ctx: StoryArcContext = {
      hook,
      articleSlug: article.slug,
      articleUrl,
      ...(primaryTool !== undefined && { primaryTool }),
    };
    return ctx;
  },

  // ── generateContent ──────────────────────────────────────────────────────
  generateContent: async (article, input, locale, llmCaller) => {
    const ctx = input as StoryArcContext;

    const systemPrompt = `${STORY_ARC_SYSTEM_PROMPT}\n\nAdditionally, after the 5 narrative beats, emit a CAPTION and HASHTAGS block in EXACTLY this format:\n\n<CAPTION>\n(your caption, 80-280 chars, no hashtags inside)\n</CAPTION>\n\n<HASHTAGS>\n#tag1 #tag2 ... (7 hashtags, no hyphens, mix DE+EN regardless of post locale)\n</HASHTAGS>`;

    const baseUserPrompt = buildStoryArcNarrativePrompt({
      hook: ctx.hook,
      ...(ctx.primaryTool?.name !== undefined && { primaryToolName: ctx.primaryTool.name }),
      locale,
    });

    // First attempt
    let llmRaw = await llmCaller(systemPrompt, baseUserPrompt);
    let narrative = parseAndValidateNarrative(llmRaw, ctx.hook.variables);

    // Single retry with variable-verbatim refinement suffix
    if (!narrative.valid && llmRaw) {
      const retrySuffix = buildStoryArcRetrySuffix(narrative.validation);
      const retryRaw = await llmCaller(systemPrompt, `${baseUserPrompt}\n${retrySuffix}`);
      const retryParsed = parseAndValidateNarrative(retryRaw, ctx.hook.variables);
      if (retryParsed.valid) {
        llmRaw = retryRaw;
        narrative = retryParsed;
      }
    }

    const finalNarrative = narrative.narrative ?? buildFallbackNarrative(ctx.hook);
    const caption = (llmRaw && parseTaggedBlock(llmRaw, "CAPTION")) ?? fallbackCaption(article, ctx, locale);
    const hashtagsRaw = (llmRaw && parseTaggedBlock(llmRaw, "HASHTAGS")) ?? "";
    const parsedHashtags = parseHashtags(hashtagsRaw);
    const hashtags = parsedHashtags.length >= 5
      ? parsedHashtags.slice(0, 10)
      : Array.from(locale === "de" ? DEFAULT_HASHTAGS_DE : DEFAULT_HASHTAGS_EN);

    // Spec 60.1 _extra extension pattern — narrative is the Family-B equivalent
    // of Family-A's `_grid3Extra` / `_verdict`. Render() casts back to read it.
    // HookOutput is the Family-A shape; we synthesize a structural fit since
    // Family-B's hook lives in input directly (not via this field). The Cover
    // slide reads from `input.hook`, NOT from `generatedContent.hookOutput`.
    const words = ctx.hook.rendered.split(" ");
    const result: GeneratedContent & { _storyArcExtra: StoryArcNarrative } = {
      hookOutput: {
        pattern: "identity_frame",
        leadPhrase: words.slice(0, 3).join(" "),
        highlightWord: words.slice(3, 6).join(" ") || ctx.hook.rendered,
        trailPhrase: words.slice(6).join(" "),
        fullText: ctx.hook.rendered,
        promiseBlock: { line1: ctx.hook.rendered, line2: "" },
      },
      caption,
      hashtags,
      _storyArcExtra: finalNarrative,
    };
    return result as unknown as GeneratedContent;
  },

  // ── render ───────────────────────────────────────────────────────────────
  render: async (context) => {
    const ctx = context.input;
    const narrative =
      (context.generatedContent as GeneratedContent & { _storyArcExtra?: StoryArcNarrative } | undefined)?._storyArcExtra
      ?? buildFallbackNarrative(ctx.hook);

    const brandTokens = brandTokensSchema.parse(context.brandTokens ?? {});
    const input: StoryArcClickbaitInput = {
      slideIndex: 0,
      slideTotal: 7,
      theme: context.theme,
      locale: context.locale,
      brandTokens,
      hook: ctx.hook,
      narrative,
      ...(ctx.primaryTool !== undefined && { primaryTool: ctx.primaryTool }),
      end: {
        headlineLead: context.locale === "de" ? "Mehr Geschichten" : "More stories",
        headlineEm: context.locale === "de" ? "ehrlich erzählt." : "honestly told.",
        articleUrl: ctx.articleUrl,
        ctaLine: context.locale === "de" ? "Vollständige Story →" : "Full story →",
      },
      images: [], // V1 — gradient-only fallback. Day 5 populates from familyBImages JSONB.
    };

    const socialModule = (await import("../../../render-server.ts")) as unknown as {
      renderStoryArcClickbait: (
        input: StoryArcClickbaitInput,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderStoryArcClickbait(input);
    const slideOutputs = await writeSlides(
      buffers,
      context.article.id,
      "story-arc-clickbait",
      context.locale,
      context.theme,
      { width: 1080, height: 1350 },
    );
    return {
      slides: slideOutputs,
      caption:
        context.generatedContent?.caption ?? fallbackCaption(context.article, ctx, context.locale),
      hashtags:
        context.generatedContent?.hashtags ??
        Array.from(context.locale === "de" ? DEFAULT_HASHTAGS_DE : DEFAULT_HASHTAGS_EN),
      metadata: { estimatedCostUsd: 0.06, templateKey: "story-arc-clickbait" },
    };
  },

  mockFixtures: STORY_ARC_CLICKBAIT_FIXTURES,
};

// ─── Pure helper: parse narrative from raw LLM output + validate ──────────────

function parseAndValidateNarrative(
  raw: string | null,
  hookVariables: Record<string, string>,
): {
  valid: boolean;
  narrative: StoryArcNarrative | null;
  validation: ReturnType<typeof validateStoryArcNarrative>;
} {
  const noNarrative = {
    valid: false,
    narrative: null,
    validation: validateStoryArcNarrative(
      {
        setup: { beatName: "setup", text: "" },
        conflict: { beatName: "conflict", text: "" },
        resolution: { beatName: "resolution", text: "" },
        payoff: { beatName: "payoff", text: "" },
        lesson: { beatName: "lesson", text: "" },
      } as StoryArcNarrative,
      hookVariables,
    ),
  };
  if (!raw) return noNarrative;
  const split = splitNarrativeByBeats(raw, ["setup", "conflict", "resolution", "payoff", "lesson"]);
  const required = ["setup", "conflict", "resolution", "payoff", "lesson"] as const;
  for (const beat of required) {
    if (!split[beat]) return noNarrative;
  }
  const narrative: StoryArcNarrative = {
    setup: { beatName: "setup", text: split.setup ?? "" },
    conflict: { beatName: "conflict", text: split.conflict ?? "" },
    resolution: { beatName: "resolution", text: split.resolution ?? "" },
    payoff: { beatName: "payoff", text: split.payoff ?? "" },
    lesson: { beatName: "lesson", text: split.lesson ?? "" },
  };
  const zodParsed = storyArcNarrativeSchema.safeParse(narrative);
  if (!zodParsed.success) return noNarrative;
  const validation = validateStoryArcNarrative(narrative, hookVariables);
  return { valid: validation.valid, narrative, validation };
}

function fallbackCaption(
  article: { title: string | null; slug: string },
  ctx: StoryArcContext,
  locale: "de" | "en",
): string {
  const subject = ctx.hook.variables.profession ?? ctx.hook.variables.lifeArea ?? "";
  if (locale === "de") {
    return `Eine ehrliche Geschichte über KI und ${subject} — wie sich der Alltag verändert, ohne den Ton zu verlieren.\n\n${article.title ?? article.slug}`;
  }
  return `An honest story about AI and ${subject} — how the everyday changes without losing the human voice.\n\n${article.title ?? article.slug}`;
}
